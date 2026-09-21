using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Services;

namespace Pos.Api.Middlewares;

/// <summary>
/// Enforces the tenant lifecycle ladder on every state-changing request.
///
/// Endpoint filters alone could not do this job: they only guard the endpoints somebody
/// remembered to attach them to. Catalogue creation, for one, had no module filter at all, so a
/// Restricted tenant could still edit their menu. The fix is the same shape as the global query
/// filters — make the safe behaviour the DEFAULT and require an explicit exemption to opt out.
///
/// The exemption list is the operational surface a shop needs to keep trading while its account
/// is in arrears: ringing up sales, the kitchen, cash handling, syncing what happened offline.
/// Everything else is treated as back-office and pauses. Anything added to the API in future is
/// back-office until somebody deliberately says otherwise, which is the right way round.
/// </summary>
public class TenantLifecycleMiddleware
{
    private readonly RequestDelegate _next;

    public TenantLifecycleMiddleware(RequestDelegate next) => _next = next;

    /// <summary>
    /// Paths whose WRITES keep working for a tenant in arrears. Matched as prefixes, lowercase.
    /// These are gated separately by RequireTenantStateFilter(Need.Sell), which still stops them
    /// at ReadOnly and below — this list only exempts them from the stricter back-office rule.
    /// </summary>
    private static readonly string[] OperationalWritePaths =
    {
        "/api/orders",
        "/api/kitchen/",
        "/api/cash-shifts",
        "/api/sync/",
        "/api/terminals/heartbeat",
        "/api/devices/activate",
        "/api/delivery/",
        "/api/payments/",
        "/api/call-order/",
        "/api/tables",
        "/api/customers/lookup",
        "/api/labor/clock-in",
        "/api/labor/clock-out",
        "/api/alerts/"
    };

    /// <summary>Paths that must work regardless of billing state: authentication, billing itself,
    /// and the platform console. Locking a customer out of the page where they pay you is the
    /// one mistake this whole feature exists to avoid.</summary>
    private static readonly string[] AlwaysAllowedPaths =
    {
        "/api/auth/",
        "/api/admin/",
        "/api/tenant/my-package",
        "/api/public/",
        "/api/addons/catalog"
    };

    public async Task InvokeAsync(HttpContext context, IEntitlementService entitlements)
    {
        if (!IsMutating(context.Request.Method))
        {
            await _next(context);
            return;
        }

        var path = context.Request.Path.Value?.ToLowerInvariant() ?? string.Empty;
        if (AlwaysAllowedPaths.Any(p => path.StartsWith(p, StringComparison.Ordinal)))
        {
            await _next(context);
            return;
        }

        if (context.IsSuperAdmin())
        {
            await _next(context);
            return;
        }

        var tenantId = context.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty)
        {
            // Unauthenticated: the endpoint's own auth decides. Nothing to enforce yet.
            await _next(context);
            return;
        }

        EffectiveEntitlements ent;
        try
        {
            ent = await entitlements.GetAsync(tenantId.Value);
        }
        catch (InvalidOperationException)
        {
            await _next(context); // tenant vanished mid-request; let the endpoint 401 it
            return;
        }

        var isOperational = OperationalWritePaths.Any(p => path.StartsWith(p, StringComparison.Ordinal));
        var permitted = isOperational ? ent.CanSell : ent.CanUseBackOffice;

        if (permitted)
        {
            await _next(context);
            return;
        }

        context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
        await context.Response.WriteAsJsonAsync(new
        {
            message = ent.Status switch
            {
                TenantStatus.Restricted => isOperational
                    ? "This action is paused on your account."
                    : "Changes are paused until your account is brought up to date. You can still view and export your data, and the POS is still selling.",
                TenantStatus.ReadOnly => "Your account is read-only until payment is received. Your data is still available to view and export.",
                TenantStatus.Suspended => "This account is suspended. Please contact support.",
                TenantStatus.Cancelled => "This account has been closed.",
                _ => "This action is not available on your account right now."
            },
            tenantStatus = ent.Status.ToString(),
            billingAction = true
        });
    }

    private static bool IsMutating(string method) =>
        method is "POST" or "PUT" or "PATCH" or "DELETE";
}

using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Middlewares;

public interface ICurrentUserAccessor
{
    Task<AppUser?> GetCurrentUserAsync(HttpContext context);
}

public class CurrentUserAccessor : ICurrentUserAccessor
{
    private readonly AppDbContext _db;
    public CurrentUserAccessor(AppDbContext db) => _db = db;

    public async Task<AppUser?> GetCurrentUserAsync(HttpContext context)
    {
        var userId = context.GetUserId();
        if (userId == null) return null;
        return await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value && u.IsActive);
    }
}

// Requires a fresh-from-DB permission check. OwnerAdmin and SuperAdmin always pass.
public class RequirePermissionFilter : IEndpointFilter
{
    private readonly Func<AppUser, bool> _check;
    private readonly string _deniedMessage;

    public RequirePermissionFilter(Func<AppUser, bool> check, string deniedMessage = "You don't have permission to perform this action.")
    {
        _check = check;
        _deniedMessage = deniedMessage;
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var accessor = context.HttpContext.RequestServices.GetRequiredService<ICurrentUserAccessor>();
        var user = await accessor.GetCurrentUserAsync(context.HttpContext);
        if (user == null) return Results.Unauthorized();
        if (user.Role == UserRole.OwnerAdmin || user.Role == UserRole.SuperAdmin || _check(user))
            return await next(context);
        return Results.Json(new { message = _deniedMessage }, statusCode: StatusCodes.Status403Forbidden);
    }
}

// Role-baseline + ModulePermission-override check for "back office" modules.
public class RequireModuleFilter : IEndpointFilter
{
    private readonly string _moduleKey;
    private readonly string _action; // "view" | "edit" | "delete" | "export"

    public RequireModuleFilter(string moduleKey, string action)
    {
        _moduleKey = moduleKey;
        _action = action;
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var accessor = context.HttpContext.RequestServices.GetRequiredService<ICurrentUserAccessor>();
        var user = await accessor.GetCurrentUserAsync(context.HttpContext);
        if (user == null) return Results.Unauthorized();

        // Every back-office module routes through this filter, so the tenant lifecycle check
        // lives here rather than being bolted onto 60-odd call sites where it could be forgotten.
        // Reads stay open as long as the account is not hard-locked — a customer who owes money
        // must still be able to see their own figures and export their data.
        var stateGate = await TenantStateGate.CheckAsync(context.HttpContext, _action is "view" or "export");
        if (stateGate != null) return stateGate;

        if (user.Role == UserRole.OwnerAdmin || user.Role == UserRole.SuperAdmin)
            return await next(context);

        var permission = await db.ModulePermissions
            .FirstOrDefaultAsync(mp => mp.UserId == user.Id && mp.ModuleKey == _moduleKey && mp.SubModuleKey == "");

        bool allowed = permission != null
            ? _action switch { "view" => permission.CanView, "edit" => permission.CanEdit, "delete" => permission.CanDelete, "export" => permission.CanExport, _ => false }
            : ModuleBaseline.GetBaseline(user.Role, _moduleKey, _action);

        if (!allowed)
            return Results.Json(new { message = $"You don't have '{_action}' access to '{_moduleKey}'." }, statusCode: StatusCodes.Status403Forbidden);

        return await next(context);
    }
}

public static partial class TenantStateGate
{
    /// <summary>
    /// Returns a 402 result when the tenant's lifecycle state forbids this kind of access, or
    /// null to let the request through. Shared by <see cref="RequireModuleFilter"/> and
    /// <see cref="RequireTenantStateFilter"/> so both answer identically.
    /// </summary>
    public static async Task<IResult?> CheckAsync(HttpContext http, bool readOnlyAccess)
    {
        if (http.IsSuperAdmin()) return null;

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return null; // unauthenticated paths handle their own auth

        var entitlements = http.RequestServices.GetRequiredService<Pos.Api.Services.IEntitlementService>();
        Pos.Api.Services.EffectiveEntitlements ent;
        try
        {
            ent = await entitlements.GetAsync(tenantId.Value);
        }
        catch (InvalidOperationException)
        {
            return Results.Unauthorized();
        }

        var permitted = readOnlyAccess ? ent.CanRead : ent.CanUseBackOffice;
        if (permitted) return null;

        return Results.Json(new
        {
            message = ent.Status switch
            {
                TenantStatus.Restricted => "Changes are paused until your account is brought up to date. You can still view your data, and the POS is still selling.",
                TenantStatus.ReadOnly => "Your account is read-only until payment is received. Your data is still available to view and export.",
                TenantStatus.Suspended => "This account is suspended. Please contact support.",
                TenantStatus.Cancelled => "This account has been closed.",
                _ => "This action is not available on your account right now."
            },
            tenantStatus = ent.Status.ToString(),
            billingAction = true
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

public static class ModuleBaseline
{
    // Modules gated by this baseline. "pos"/"kitchen"/"delivery" are NOT here — any active
    // branch-scoped staff member can use their operational screen; specific risky actions
    // within them (void, discount) are gated separately via RequirePermissionFilter + AppUser.Can* flags.
    private static readonly HashSet<string> ReadOnlyByDefaultModules = new() { "menu", "inventory", "reports", "accounts", "supplychain" };

    /// <summary>The books. An Accountant works here all day and should not need a grant to do it.</summary>
    private static readonly HashSet<string> AccountingModules = new() { "accounts", "reports" };

    /// <summary>Stock and supply. An Inventory User's whole job.</summary>
    private static readonly HashSet<string> StockModules = new() { "inventory", "supplychain" };

    public static bool GetBaseline(UserRole role, string moduleKey, string action)
    {
        if (role == UserRole.BranchManager)
        {
            // Rostering and clocking staff is ordinary branch-manager work, not a request-only
            // back-office function, so "labor" gets edit as well as view by baseline.
            if (moduleKey == "labor")
                return action is "view" or "edit";
            if (ReadOnlyByDefaultModules.Contains(moduleKey))
                return action == "view"; // read/request-only until Owner grants more via ModulePermission UI
            return false; // "admin", "users" modules: no baseline access for BranchManager
        }

        // A bookkeeper who can only LOOK at the ledger cannot do the job, so these get edit by
        // baseline — the point of the role is that nobody has to hand them manager access to
        // post a journal. They still get nothing outside the books: no roster, no staff, no POS.
        if (role == UserRole.Accountant)
        {
            if (AccountingModules.Contains(moduleKey)) return action is "view" or "edit" or "export";
            if (moduleKey == "inventory") return action == "view"; // stock valuation feeds the P&L
            return false;
        }

        // Same reasoning for a storekeeper: receiving stock and raising a PO is the job, so it
        // is baseline. Financial reporting is not — knowing what the shop earns is a separate
        // question from knowing what is on the shelf.
        if (role == UserRole.InventoryUser)
        {
            if (StockModules.Contains(moduleKey)) return action is "view" or "edit";
            if (moduleKey == "menu") return action == "view"; // needs to see items to count them
            return false;
        }

        return false; // Cashier / KitchenChef / Waiter: no baseline back-office access
    }
}

/// <summary>
/// 403s when the caller's tenant is not entitled to a feature.
///
/// This used to re-implement the tier-OR-add-on merge itself, reading SaaSPackageConfig directly.
/// That meant it could not see support overrides at all, so a grant made in the admin console
/// unlocked the screen but not the API behind it. It now asks the entitlement service, which is
/// the only thing that knows the full answer.
/// </summary>
public class RequireFeatureFilter : IEndpointFilter
{
    private readonly string _flagName;

    public RequireFeatureFilter(string flagName) => _flagName = flagName;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.IsSuperAdmin()) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

        var entitlements = http.RequestServices.GetRequiredService<Pos.Api.Services.IEntitlementService>();
        Pos.Api.Services.EffectiveEntitlements ent;
        try
        {
            ent = await entitlements.GetAsync(tenantId.Value);
        }
        catch (InvalidOperationException)
        {
            return Results.Unauthorized(); // tenant no longer exists
        }

        if (!ent.Has(_flagName))
            return Results.Json(
                new { message = $"Your subscription plan does not include this feature ({_flagName}). Please upgrade your package or purchase it as an add-on.", feature = _flagName },
                statusCode: StatusCodes.Status403Forbidden);

        return await next(context);
    }
}

/// <summary>
/// Enforces the tenant lifecycle ladder — the reason a graduated <see cref="TenantStatus"/>
/// exists rather than one IsActive bool.
///
/// The ordering matters commercially: a tenant who has not paid keeps SELLING long after they
/// lose the back office, because taking a restaurant's till away at 8pm on a Friday does not
/// collect the invoice, it just ends the relationship.
/// </summary>
public class RequireTenantStateFilter : IEndpointFilter
{
    public enum Need
    {
        /// <summary>Reading or exporting existing data.</summary>
        Read,
        /// <summary>Creating a sale at the POS.</summary>
        Sell,
        /// <summary>Reports, settings, catalogue editing, admin.</summary>
        BackOffice
    }

    private readonly Need _need;

    public RequireTenantStateFilter(Need need) => _need = need;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.IsSuperAdmin()) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

        var entitlements = http.RequestServices.GetRequiredService<Pos.Api.Services.IEntitlementService>();
        Pos.Api.Services.EffectiveEntitlements ent;
        try
        {
            ent = await entitlements.GetAsync(tenantId.Value);
        }
        catch (InvalidOperationException)
        {
            return Results.Unauthorized();
        }

        var permitted = _need switch
        {
            Need.Read => ent.CanRead,
            Need.Sell => ent.CanSell,
            Need.BackOffice => ent.CanUseBackOffice,
            _ => false
        };

        if (permitted) return await next(context);

        // 402 rather than 403: this is a billing state, not a permissions problem, and the
        // client should route the user to the billing screen rather than saying "access denied".
        return Results.Json(new
        {
            message = _need == Need.Sell
                ? ent.Status switch
                {
                    TenantStatus.ReadOnly => "New sales are paused until payment is received. Please contact your administrator.",
                    TenantStatus.Suspended => "This account is suspended, so the till cannot take new sales.",
                    TenantStatus.Cancelled => "This account has been closed.",
                    _ => "New sales are not available on this account right now."
                }
                : ent.Status switch
                {
                    TenantStatus.Restricted => "Changes are paused until your account is brought up to date. The POS is still selling.",
                    TenantStatus.ReadOnly => "Your account is read-only until payment is received.",
                    TenantStatus.Suspended => "This account is suspended. Please contact support.",
                    TenantStatus.Cancelled => "This account has been closed.",
                    _ => "This action is not available on your account right now."
                },
            tenantStatus = ent.Status.ToString(),
            billingAction = true
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

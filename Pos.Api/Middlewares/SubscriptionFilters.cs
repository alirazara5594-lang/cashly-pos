using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Services;

namespace Pos.Api.Middlewares;

// ============================================================
// SUBSCRIPTION GUARDS
//
// The reusable way to say "this endpoint needs capability X" or "this endpoint creates something
// that counts against limit Y". Attached declaratively:
//
//     .AddEndpointFilter(RequireFeature.For(FeatureCodes.Hq))
//     .AddEndpointFilter(RequireLimit.For(FeatureCodes.Locations))
//
// No endpoint ever names a plan. That is the entire point: pricing can change without a code
// change, and the upgrade message stays accurate because it is derived from the matrix.
// ============================================================

/// <summary>403s when the organisation's plan does not include a capability.</summary>
public class RequireFeatureCodeFilter : IEndpointFilter
{
    private readonly string _featureCode;

    public RequireFeatureCodeFilter(string featureCode) => _featureCode = featureCode;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.IsSuperAdmin()) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

        var subs = http.RequestServices.GetRequiredService<ISubscriptionService>();
        var check = await subs.CheckFeatureAsync(tenantId.Value, _featureCode);
        if (check.Allowed) return await next(context);

        // 402, not 403: this is "your plan does not include this", which the client should turn
        // into an upgrade prompt — not "you are not allowed", which reads as a permissions bug.
        return Results.Json(new
        {
            message = check.Reason ?? $"Your plan does not include {_featureCode}.",
            featureCode = _featureCode,
            upgradeRequired = true
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

/// <summary>
/// 402s when creating one more of something would exceed the plan's allowance.
///
/// Checked BEFORE the handler runs, so the limit message is what the user sees rather than a
/// half-created record and a confusing error.
/// </summary>
public class RequireLimitFilter : IEndpointFilter
{
    private readonly string _featureCode;

    public RequireLimitFilter(string featureCode) => _featureCode = featureCode;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.IsSuperAdmin()) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

        var subs = http.RequestServices.GetRequiredService<ISubscriptionService>();
        var check = await subs.CheckLimitAsync(tenantId.Value, _featureCode);
        if (check.Allowed) return await next(context);

        return Results.Json(new
        {
            message = check.Reason ?? $"You have reached your plan's limit for {_featureCode}.",
            featureCode = _featureCode,
            inUse = check.InUse,
            limit = check.Limit,
            upgradeRequired = true
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

/// <summary>
/// Whole modules gated by route: one table instead of a filter on each of a module's endpoints, so
/// an endpoint added under /api/payroll next year is gated the moment it exists. Added once to the
/// /api group. Requests without a business (the platform admin, anonymous webhooks and public
/// ordering) pass through to the endpoint's own checks.
/// </summary>
public class ModuleFeatureGateFilter : IEndpointFilter
{
    private static readonly (string Prefix, string FeatureCode)[] Gates =
    {
        ("/api/loyalty", FeatureCodes.Loyalty),
        ("/api/gift-cards", FeatureCodes.Loyalty),
        ("/api/promo-codes", FeatureCodes.Loyalty),
        ("/api/labor", FeatureCodes.Labor),
        ("/api/payroll", FeatureCodes.Payroll),
        ("/api/hr/leave-requests", FeatureCodes.Payroll),
        ("/api/accounting", FeatureCodes.Accounting),
        ("/api/inventory", FeatureCodes.Inventory),
        ("/api/recipes", FeatureCodes.Recipes),
        ("/api/suppliers", FeatureCodes.Purchasing),
        ("/api/procurement", FeatureCodes.Purchasing),
        ("/api/integrations/delivery", FeatureCodes.Integrations)
    };

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var path = http.Request.Path;
        var gate = Gates.FirstOrDefault(g => path.StartsWithSegments(g.Prefix, StringComparison.OrdinalIgnoreCase));
        if (gate.FeatureCode == null || http.IsSuperAdmin()) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return await next(context);

        var subs = http.RequestServices.GetRequiredService<ISubscriptionService>();
        var check = await subs.CheckFeatureAsync(tenantId.Value, gate.FeatureCode);
        if (check.Allowed) return await next(context);

        return Results.Json(new
        {
            message = check.Reason ?? $"Your plan does not include {gate.FeatureCode}.",
            featureCode = gate.FeatureCode,
            upgradeRequired = true
        }, statusCode: StatusCodes.Status402PaymentRequired);
    }
}

/// <summary>Terse constructors so endpoint declarations stay readable.</summary>
public static class RequireFeature
{
    public static RequireFeatureCodeFilter For(string featureCode) => new(featureCode);
}

public static class RequireLimit
{
    public static RequireLimitFilter For(string featureCode) => new(featureCode);
}

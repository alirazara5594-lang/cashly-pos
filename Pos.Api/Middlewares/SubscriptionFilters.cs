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

/// <summary>Terse constructors so endpoint declarations stay readable.</summary>
public static class RequireFeature
{
    public static RequireFeatureCodeFilter For(string featureCode) => new(featureCode);
}

public static class RequireLimit
{
    public static RequireLimitFilter For(string featureCode) => new(featureCode);
}

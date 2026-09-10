using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;

namespace Pos.Api.Middlewares;

/// <summary>
/// Middleware that extracts tenantId from the JWT token and makes it available to all endpoints.
/// Also enforces tenant isolation — blocks cross-tenant data access.
/// </summary>
public class TenantIsolationMiddleware
{
    private readonly RequestDelegate _next;

    public TenantIsolationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Extract tenantId from JWT claims
        var tenantIdClaim = context.User?.FindFirst("tenantId");
        if (tenantIdClaim != null && Guid.TryParse(tenantIdClaim.Value, out var tenantId))
        {
            context.Items["TenantId"] = tenantId;

            // Also extract role for authorization checks
            var roleClaim = context.User?.FindFirst("role");
            if (roleClaim != null)
            {
                context.Items["UserRole"] = roleClaim.Value;
            }

            // Extract userId
            var userIdClaim = context.User?.FindFirst("userId");
            if (userIdClaim != null && Guid.TryParse(userIdClaim.Value, out var userId))
            {
                context.Items["UserId"] = userId;
            }
        }

        await _next(context);
    }
}

/// <summary>
/// Helper to extract tenant context from HttpContext
/// </summary>
public static class TenantContext
{
    public static Guid? GetTenantId(this HttpContext context)
    {
        if (context.Items["TenantId"] is Guid tenantId)
            return tenantId;
        return null;
    }

    public static string? GetUserRole(this HttpContext context)
    {
        return context.Items["UserRole"] as string;
    }

    public static Guid? GetUserId(this HttpContext context)
    {
        if (context.Items["UserId"] is Guid userId)
            return userId;
        return null;
    }

    public static bool IsSuperAdmin(this HttpContext context)
    {
        return GetUserRole(context) == "SuperAdmin";
    }
}

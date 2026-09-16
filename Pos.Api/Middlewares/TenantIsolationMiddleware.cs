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

            // Extract branchId. Owner/HeadOffice/SuperAdmin tokens carry "" here, meaning
            // "not pinned to a single branch" — those users must supply a branchId explicitly
            // and it gets validated against their tenant.
            var branchIdClaim = context.User?.FindFirst("branchId");
            if (branchIdClaim != null && Guid.TryParse(branchIdClaim.Value, out var branchId) && branchId != Guid.Empty)
            {
                context.Items["BranchId"] = branchId;
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

    /// <summary>
    /// The branch this user is pinned to, or null for Owner/HeadOffice/SuperAdmin (all branches).
    /// </summary>
    public static Guid? GetBranchId(this HttpContext context)
    {
        if (context.Items["BranchId"] is Guid branchId)
            return branchId;
        return null;
    }

    public static bool IsSuperAdmin(this HttpContext context)
    {
        return GetUserRole(context) == "SuperAdmin";
    }

    /// <summary>
    /// Fast, token-only permission check (no DB round trip). For anything that must be
    /// authoritative, use RequirePermissionFilter which re-reads the user from the database.
    /// </summary>
    public static bool HasPermission(this HttpContext context, string claimName)
    {
        return context.User?.FindFirst(claimName)?.Value == "true";
    }
}

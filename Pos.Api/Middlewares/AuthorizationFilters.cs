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

public static class ModuleBaseline
{
    // Modules gated by this baseline. "pos"/"kitchen"/"delivery" are NOT here — any active
    // branch-scoped staff member can use their operational screen; specific risky actions
    // within them (void, discount) are gated separately via RequirePermissionFilter + AppUser.Can* flags.
    private static readonly HashSet<string> ReadOnlyByDefaultModules = new() { "menu", "inventory", "reports", "accounts", "supplychain" };

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
        return false; // Cashier / KitchenChef / Waiter: no baseline back-office access
    }
}

/// <summary>
/// 403s when the caller's tenant is on a SaaS package whose feature flag is off.
/// Flag name must match a boolean property on <see cref="SaaSPackageConfig"/> (e.g. "HasKitchenDisplay").
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

        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var tier = await db.Tenants.Where(t => t.Id == tenantId.Value).Select(t => (SubscriptionTier?)t.Tier).FirstOrDefaultAsync();
        if (tier == null) return Results.Unauthorized();

        var pkg = await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tier.Value.ToString());
        // If the platform owner hasn't configured a package row for this tier, fail open rather
        // than locking a paying tenant out of their own data.
        if (pkg == null) return await next(context);

        var enabled = _flagName switch
        {
            nameof(SaaSPackageConfig.HasKitchenDisplay) => pkg.HasKitchenDisplay,
            nameof(SaaSPackageConfig.HasDeliveryCOD) => pkg.HasDeliveryCOD,
            nameof(SaaSPackageConfig.HasInventoryManagement) => pkg.HasInventoryManagement,
            nameof(SaaSPackageConfig.HasStockTransfers) => pkg.HasStockTransfers,
            nameof(SaaSPackageConfig.HasDirectorDashboard) => pkg.HasDirectorDashboard,
            nameof(SaaSPackageConfig.HasConsolidatedReports) => pkg.HasConsolidatedReports,
            nameof(SaaSPackageConfig.HasWhatsAppMessaging) => pkg.HasWhatsAppMessaging,
            nameof(SaaSPackageConfig.HasAdvancedReports) => pkg.HasAdvancedReports,
            nameof(SaaSPackageConfig.HasMultiBranch) => pkg.HasMultiBranch,
            _ => true
        };

        if (!enabled)
            return Results.Json(
                new { message = $"Your subscription plan does not include this feature ({_flagName}). Please upgrade your package.", feature = _flagName },
                statusCode: StatusCodes.Status403Forbidden);

        return await next(context);
    }
}

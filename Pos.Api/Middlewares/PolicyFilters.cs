using Microsoft.EntityFrameworkCore;
using Pos.Api.Data;
using Pos.Api.Models;

namespace Pos.Api.Middlewares;

// ============================================================
// BUSINESS POLICY GUARDS
//
// A policy is a decision the owner made about how their business runs (TenantSettings), not a plan
// feature and not a permission. Attached declaratively, like the permission and plan filters:
//
//     .AddEndpointFilter(new RequireCatalogEditFilter())
// ============================================================

/// <summary>
/// Refuses catalogue changes from branch staff when the business runs its catalogue from head
/// office (CatalogControl.HeadOfficeOnly). Owners and head office staff — anyone not pinned to one
/// branch — always pass; so does everyone when branches may edit.
/// </summary>
public class RequireCatalogEditFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.IsSuperAdmin() || http.GetBranchId() == null) return await next(context);

        var tenantId = http.GetTenantId();
        if (tenantId == null || tenantId == Guid.Empty) return await next(context);

        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var control = await db.TenantSettings
            .Where(s => s.TenantId == tenantId.Value)
            .Select(s => (CatalogControl?)s.CatalogControl)
            .FirstOrDefaultAsync();

        if (control != CatalogControl.HeadOfficeOnly) return await next(context);

        return Results.Json(new
        {
            message = "Your head office manages the item list and prices. Ask head office to make this change.",
            policy = nameof(CatalogControl)
        }, statusCode: StatusCodes.Status403Forbidden);
    }
}

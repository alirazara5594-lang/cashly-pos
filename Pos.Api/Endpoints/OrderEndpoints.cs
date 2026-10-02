using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

/// <summary>
/// Order creation, kitchen tickets, open orders, payment initiation, etc.
/// 
/// TODO: Extract the large order-related endpoint blocks from Program.cs into this module.
/// </summary>
public class OrderEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders")
                       .WithTags("Orders");

        group.MapGet("/_module-info", () => Results.Ok(new
        {
            module = nameof(OrderEndpoints),
            status = "skeleton – endpoints still live in Program.cs"
        })).AllowAnonymous();
    }
}

using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

/// <summary>
/// Simple health check endpoints.
/// This file demonstrates the recommended IEndpointModule pattern.
/// Move more endpoints from Program.cs into similar modules over time.
/// </summary>
public class HealthEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api")
                       .WithTags("Health");

        group.MapGet("/health", () => Results.Ok(new
        {
            status = "healthy",
            service = "Cashly POS API",
            timestamp = DateTime.UtcNow
        }))
        .AllowAnonymous()
        .WithName("HealthCheck");

        group.MapGet("/health/ready", () => Results.Ok(new { status = "ready" }))
             .AllowAnonymous()
             .WithName("ReadinessCheck");
    }
}

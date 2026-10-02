using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

/// <summary>
/// Authentication, token refresh, 2FA, and device pairing endpoints.
/// 
/// TODO: Move the corresponding MapPost/MapGet blocks from Program.cs into this class.
/// Start with the least complex ones (e.g. health-style checks) before moving login logic.
/// </summary>
public class AuthEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth")
                       .WithTags("Auth");

        // Example placeholder — replace with real endpoints moved from Program.cs
        // group.MapPost("/login", ...);
        // group.MapPost("/refresh", ...);
        // group.MapPost("/logout", ...);

        // Keep this file compiling even while empty of real routes.
        group.MapGet("/_module-info", () => Results.Ok(new
        {
            module = nameof(AuthEndpoints),
            status = "skeleton – endpoints still live in Program.cs"
        })).AllowAnonymous();
    }
}

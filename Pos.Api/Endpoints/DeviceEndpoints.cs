using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

/// <summary>
/// Device licensing, terminal registration, host check-in, pairing codes.
/// 
/// TODO: Move device-licence and terminal endpoints from Program.cs here.
/// </summary>
public class DeviceEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/devices")
                       .WithTags("Devices");

        group.MapGet("/_module-info", () => Results.Ok(new
        {
            module = nameof(DeviceEndpoints),
            status = "skeleton – endpoints still live in Program.cs"
        })).AllowAnonymous();
    }
}

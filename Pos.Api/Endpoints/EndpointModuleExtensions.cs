using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

/// <summary>
/// Helper to register and map all IEndpointModule implementations.
/// Call this once from Program.cs after building the app.
/// </nsummary>
public static class EndpointModuleExtensions
{
    /// <summary>
    /// Discovers all registered IEndpointModule services and maps their endpoints.
    /// </summary>
    public static WebApplication MapEndpointModules(this WebApplication app)
    {
        var modules = app.Services.GetServices<IEndpointModule>();
        foreach (var module in modules)
        {
            module.MapEndpoints(app);
        }
        return app;
    }

    /// <summary>
    /// Registers the built-in endpoint modules with the DI container.
    /// Add new modules here as you extract them from Program.cs.
    /// </summary>
    public static IServiceCollection AddEndpointModules(this IServiceCollection services)
    {
        services.AddSingleton<IEndpointModule, HealthEndpoints>();
        // Uncomment / add as you migrate:
        // services.AddSingleton<IEndpointModule, AuthEndpoints>();
        // services.AddSingleton<IEndpointModule, OrderEndpoints>();
        // services.AddSingleton<IEndpointModule, DeviceEndpoints>();
        // services.AddSingleton<IEndpointModule, InventoryEndpoints>();
        // services.AddSingleton<IEndpointModule, SubscriptionEndpoints>();
        return services;
    }
}

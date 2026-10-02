# Endpoint Modules

This folder is the recommended home for all HTTP endpoint definitions.

## Why?

`Program.cs` currently contains almost every endpoint (14k+ lines).  
Moving endpoints into focused modules makes the codebase maintainable and reviewable.

## Pattern

Every module implements:

```csharp
public interface IEndpointModule
{
    void MapEndpoints(IEndpointRouteBuilder app);
}
```

## Example skeleton

```csharp
using Microsoft.AspNetCore.Builder;
using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

public class HealthEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        app.MapGet("/health", () => Results.Ok(new { status = "healthy" }))
           .WithTags("Health")
           .AllowAnonymous();
    }
}
```

## Migration plan

1. Create a new file under `Endpoints/` for a domain (Auth, Orders, Inventory…).
2. Move the related `MapGet` / `MapPost` / etc. blocks from `Program.cs` into the new module.
3. Register the module in the composition root.
4. Repeat domain by domain until `Program.cs` only contains service registration and middleware setup.

Start with low-risk groups (Health, simple lookup endpoints) before moving complex order or subscription logic.

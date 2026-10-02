# Endpoint Modules

This folder is the recommended home for all HTTP endpoint definitions.

## Why?

`Program.cs` currently contains almost every endpoint (~14,500 lines).  
Moving endpoints into focused modules makes the codebase maintainable and reviewable.

## Pattern

Every module implements:

```csharp
public interface IEndpointModule
{
    void MapEndpoints(IEndpointRouteBuilder app);
}
```

## How to register modules

In `Program.cs` (service registration section):

```csharp
builder.Services.AddEndpointModules();
```

After `var app = builder.Build();` and middleware setup:

```csharp
app.MapEndpointModules();
```

(The helper methods live in `EndpointModuleExtensions.cs`.)

## Migration plan (recommended order)

1. **Health** – already done as example (`HealthEndpoints.cs`)
2. **Auth** – login, refresh, 2FA, logout
3. **Devices** – licensing, pairing, host check-in
4. **Orders** – create order, kitchen tickets, payments
5. **Inventory / Menu**
6. **Subscriptions & Billing**
7. **Accounting / Labor / Reports**
8. Everything else

### Steps for each domain

1. Create (or open) the corresponding `*Endpoints.cs` file.
2. Cut the related `MapGet` / `MapPost` / `MapPut` / `MapDelete` blocks from `Program.cs`.
3. Paste them inside the `MapEndpoints` method (usually under a `MapGroup`).
4. Register the module in `AddEndpointModules()`.
5. Build and test that domain thoroughly before moving the next one.

Start with low-risk groups. Keep the application compiling and running after every move.

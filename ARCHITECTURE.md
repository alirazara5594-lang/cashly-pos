# Cashly POS – Architecture Guide

## Goals

- Strong multi-tenant isolation
- Data-driven feature gating (no hard-coded plan checks)
- Clear separation between user sessions and device licences
- Offline-capable frontend
- Deployable as Docker containers or Windows Service

---

## Backend Structure (Current → Target)

### Current State
Most HTTP endpoints still live in the very large `Program.cs`.  
This works but makes the codebase hard to navigate and review.

### Target Structure

```
Pos.Api/
├── Endpoints/
│   ├── AuthEndpoints.cs
│   ├── OrderEndpoints.cs
│   ├── InventoryEndpoints.cs
│   ├── MenuEndpoints.cs
│   ├── SubscriptionEndpoints.cs
│   ├── AccountingEndpoints.cs
│   ├── DeviceEndpoints.cs
│   └── ...
├── Services/
├── Data/
├── Models/
├── Middlewares/
└── Program.cs               ← only composition + service registration
```

### How to add a new endpoint module

1. Create a class that implements `IEndpointModule`:

```csharp
using Pos.Api.Interfaces;

namespace Pos.Api.Endpoints;

public class ExampleEndpoints : IEndpointModule
{
    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/example")
                       .WithTags("Example");

        group.MapGet("/", () => Results.Ok("Hello"));
        // ... more endpoints
    }
}
```

2. Register it in `Program.cs`:

```csharp
// After building the app
var endpointModules = app.Services.GetServices<IEndpointModule>();
foreach (var module in endpointModules)
{
    module.MapEndpoints(app);
}
```

(Or register each module explicitly if you prefer.)

---

## Tenant Isolation

1. JWT contains `tenantId`, `userId`, `role`, and optionally `branchId`.
2. `TenantIsolationMiddleware` extracts these into `HttpContext.Items`.
3. `AppDbContext` applies a global query filter based on `ITenantProvider.TenantId`.
4. SuperAdmin uses `Guid.Empty` → filter is disabled for that request.

**Rule:** Never trust a client-supplied tenant ID. Always take it from the authenticated token.

---

## Feature Gating

- Feature codes live in `FeatureCatalog` / `FeatureCodes`.
- Plans (Starter / Standard / Professional) map to sets of feature codes.
- Endpoints and UI check feature codes, **not** plan names.

This makes it easy to add new capabilities without changing business logic.

---

## Device Licensing vs User Sessions

| Token Type       | Contains userId? | Contains issuer? | Purpose              |
|------------------|------------------|------------------|----------------------|
| User sign-in     | Yes              | No               | Staff / manager login |
| Device licence   | No               | Yes              | Terminal identity    |

The JWT validation logic explicitly rejects device licences as user sessions.

---

## Frontend Notes

- State: Zustand (`posStore`)
- Offline: Dexie (IndexedDB) + PWA
- Routing: React Router
- UI: Tailwind + Radix primitives

Large page components should be broken into:
- Container (data + logic)
- Presentational components
- Custom hooks

---

## Recommended Next Steps

1. Extract endpoints from `Program.cs` into the `Endpoints/` folder one domain at a time.
2. Add unit + integration tests focused on tenant isolation and entitlements.
3. Continue reducing the size of large React pages.

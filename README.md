# Cashly POS

**Multi-tenant Point of Sale + Back-office system** for restaurants and retail.

Cashly POS supports counter terminals, waiter tablets, kitchen displays, multi-branch operations, subscriptions, accounting, inventory, labor management, loyalty, fiscal invoicing (Pakistan), and offline-capable frontend.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | .NET 10, ASP.NET Core Minimal APIs, Entity Framework Core, PostgreSQL |
| **Frontend** | React 19 + TypeScript + Vite, Tailwind CSS 4, Zustand, Dexie (offline), PWA |
| **Auth** | JWT + Device Licensing + Role / Permission claims |
| **Deployment** | Docker Compose, Windows Service, Vercel (frontend) |

---

## Project Structure

```
cashly-pos/
├── Pos.Api/                     # .NET 10 backend
│   ├── Data/                    # DbContext, FeatureCatalog, Seeder, Tax profiles
│   ├── Models/                  # Domain entities
│   ├── Services/                # Business logic (Billing, Subscription, Sync, Fiscal...)
│   ├── Middlewares/             # Tenant isolation, auth filters, subscription guards
│   ├── Endpoints/               # (Recommended) Feature-based endpoint modules
│   ├── Migrations/
│   └── Program.cs               # Composition root (currently large – being modularized)
├── pos-frontend/                # React + Vite frontend
│   ├── src/
│   │   ├── pages/               # Feature pages
│   │   ├── components/
│   │   ├── store/               # Zustand store
│   │   └── ...
│   └── ...
├── deploy/                      # Windows install & service scripts
├── docker-compose.yml
└── .env.example
```

---

## Quick Start (Local Development)

### Prerequisites
- .NET 10 SDK
- Node.js 20+
- Docker (recommended) **or** a local PostgreSQL instance

### 1. Clone & configure

```bash
git clone https://github.com/alirazara5594-lang/cashly-pos.git
cd cashly-pos
cp .env.example .env
# Edit .env and set strong values for:
#   POSTGRES_PASSWORD, JWT_KEY, SUPER_ADMIN_PIN
```

### 2. Start with Docker (recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:8080
- API:      http://localhost:5288
- Postgres: localhost:5432

### 3. Or run manually

**Backend**
```bash
cd Pos.Api
dotnet run --launch-profile http
```

**Frontend**
```bash
cd pos-frontend
npm install
npm run dev
```

Frontend will be at http://localhost:5173

---

## Environment Variables

See `.env.example` for the full list. Important ones:

| Variable | Description |
|----------|-------------|
| `POSTGRES_*` | Database connection |
| `JWT_KEY` | Long random secret for signing tokens |
| `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PIN` | Platform SuperAdmin credentials |
| `CORS_ORIGINS` | Extra allowed frontend origins (comma-separated) |
| `VITE_API_BASE_URL` | API URL baked into the frontend build |

---

## Key Concepts

### Multi-tenancy
Every business is a **Tenant**. Data is isolated using:
- Global query filters in `AppDbContext`
- `ITenantProvider` + `TenantIsolationMiddleware`
- JWT claims (`tenantId`, `branchId`, `role`)

SuperAdmin uses `Guid.Empty` as tenant and can see across tenants.

### Device Licensing
Terminals are licensed by type:
- `Counter` – full till (metered)
- `OrderTab` – waiter tablet (metered)
- `KitchenDisplay` – unmetered
- `BackOffice` – unmetered

Device licence tokens are distinct from user sign-in tokens.

### Feature & Subscription Model
Capabilities are data-driven via `FeatureCatalog` and plan matrix (Starter / Standard / Professional).  
Code never checks `if (plan == Professional)` — it checks feature codes such as `hq`, `kds`, `accounting`, etc.

---

## Architecture Notes

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deeper explanation of:
- Tenant isolation
- Endpoint modularization plan
- Recommended future structure

---

## Deployment

### Docker
```bash
docker compose up -d --build
```

### Windows Service
See scripts in the `deploy/` folder:
- `install-cashly.ps1`
- `install-service.ps1`

---

## Contributing / Refactoring Status

The project is currently undergoing structural improvements:

- [x] Proper documentation
- [ ] Split large `Program.cs` into feature endpoint modules
- [ ] Break oversized frontend pages into smaller components + hooks
- [ ] Add automated tests (tenant isolation, entitlements, order flow)

Pull requests that improve modularity and test coverage are very welcome.

---

## License

Private / proprietary (unless otherwise stated by the owner).

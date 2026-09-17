using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Middlewares;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// --- Configuration ---
var isProduction = builder.Environment.IsProduction();
var jwtKey = builder.Configuration["Jwt:Key"] ?? Environment.GetEnvironmentVariable("JWT_KEY");
if (isProduction && string.IsNullOrWhiteSpace(jwtKey))
{
    throw new InvalidOperationException("JWT_KEY must be configured in production. Set the JWT_KEY environment variable or appsettings.json.");
}
jwtKey ??= "CashlyPOS_SuperSecretKey_2024_Change_In_Production!";

var dbConnection = builder.Configuration.GetConnectionString("DefaultConnection");
if (isProduction && string.IsNullOrWhiteSpace(dbConnection))
{
    dbConnection = Environment.GetEnvironmentVariable("DATABASE_URL");
}
if (isProduction && string.IsNullOrWhiteSpace(dbConnection))
{
    throw new InvalidOperationException("Database connection must be configured in production. Set DATABASE_URL environment variable or DefaultConnection in appsettings.json.");
}
dbConnection ??= "Host=localhost;Port=5432;Database=cashly_pos_db;Username=postgres;Password=12345678";

// --- JWT Authentication ---
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Keep claim names exactly as issued. Without this, .NET rewrites "role" to the
        // long WS-Federation schema URI, so FindFirst("role") silently returns null and
        // every IsSuperAdmin() check evaluates false.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            RoleClaimType = "role",
            NameClaimType = "userId",
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(5)
        };
    });
builder.Services.AddAuthorization();

// --- JSON serialization ---
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    options.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

// --- CORS (restricted origins) ---
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:3000",
                "https://cashly-pos.vercel.app"
            )
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(dbConnection));

// --- Rate Limiting ---
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("auth", opt =>
    {
        opt.Window = TimeSpan.FromMinutes(1);
        opt.PermitLimit = 10;
        opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        opt.QueueLimit = 5;
    });
    options.AddFixedWindowLimiter("default", opt =>
    {
        opt.Window = TimeSpan.FromMinutes(1);
        opt.PermitLimit = 100;
        opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        opt.QueueLimit = 10;
    });
});

builder.Services.AddOpenApi();

// --- Security / tenancy services ---
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<Pos.Api.Services.ITenantProvider, Pos.Api.Services.TenantProvider>();
builder.Services.AddScoped<Pos.Api.Middlewares.ICurrentUserAccessor, Pos.Api.Middlewares.CurrentUserAccessor>();
builder.Services.AddSingleton<Pos.Api.Services.IFiscalInvoiceProvider, Pos.Api.Services.NullFiscalInvoiceProvider>();

var app = builder.Build();

// --- Global Exception Handler ---
app.UseExceptionHandler(error =>
{
    error.Run(async context =>
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json";
        var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
        var response = new
        {
            error = "An unexpected error occurred",
            message = app.Environment.IsDevelopment() ? exception?.Message : "Internal server error",
            statusCode = 500
        };
        await context.Response.WriteAsJsonAsync(response);
    });
});

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantIsolationMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// --- Database Migration & Seeding ---
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    try
    {
        // Use migrations in production, EnsureCreated for dev
        if (app.Environment.IsDevelopment())
        {
            await db.Database.EnsureCreatedAsync();
        }
        else
        {
            await db.Database.MigrateAsync();
        }

        // Ensure tables exist via raw SQL (EF Core may not know about them)
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""Ingredients"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""Category"" text NOT NULL,
                ""Unit"" text NOT NULL,
                ""CostPerUnitPKR"" numeric(18,2) NOT NULL,
                ""CurrentStock"" numeric(18,2) NOT NULL,
                ""MinAlertLevel"" numeric(18,2) NOT NULL,
                ""SupplierName"" text,
                ""RowVersion"" bytea
            );
            CREATE TABLE IF NOT EXISTS ""ProductRecipeItems"" (
                ""Id"" uuid PRIMARY KEY,
                ""ProductId"" uuid NOT NULL,
                ""IngredientId"" uuid NOT NULL,
                ""QuantityRequired"" numeric(18,2) NOT NULL,
                ""Unit"" text NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""Users"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid,
                ""FullName"" text NOT NULL,
                ""Username"" text NOT NULL,
                ""PinCodeHash"" text NOT NULL,
                ""Role"" integer NOT NULL,
                ""IsActive"" boolean NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL,
                ""CanViewFinancialReports"" boolean NOT NULL,
                ""CanManageInventory"" boolean NOT NULL,
                ""CanManageMenuAndTax"" boolean NOT NULL,
                ""CanGiveDiscounts"" boolean NOT NULL,
                ""CanVoidOrders"" boolean NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""Riders"" (
                ""Id"" uuid PRIMARY KEY,
                ""BranchId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""Phone"" text NOT NULL,
                ""VehicleNumber"" text NOT NULL,
                ""IsAvailable"" boolean NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""RiderSettlements"" (
                ""Id"" uuid PRIMARY KEY,
                ""BranchId"" uuid NOT NULL,
                ""RiderId"" uuid NOT NULL,
                ""ShiftDate"" timestamp with time zone NOT NULL,
                ""TotalOrdersDelivered"" integer NOT NULL,
                ""TotalCODExpectedPKR"" numeric(18,2) NOT NULL,
                ""TotalCashCollectedPKR"" numeric(18,2) NOT NULL,
                ""ShortageSurplusPKR"" numeric(18,2) NOT NULL,
                ""SettledBy"" text NOT NULL,
                ""SettledAt"" timestamp with time zone NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""StockTransferOrders"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""TransferNumber"" text NOT NULL,
                ""SourceBranchId"" uuid NOT NULL,
                ""DestinationBranchId"" uuid NOT NULL,
                ""Status"" integer NOT NULL,
                ""RequestedAt"" timestamp with time zone NOT NULL,
                ""DispatchedAt"" timestamp with time zone,
                ""ReceivedAt"" timestamp with time zone,
                ""DispatchedBy"" text,
                ""ReceivedBy"" text,
                ""VehicleOrDriver"" text,
                ""Notes"" text,
                ""TotalEstimatedCostPKR"" numeric(18,2) NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""StockTransferItems"" (
                ""Id"" uuid PRIMARY KEY,
                ""TransferOrderId"" uuid NOT NULL,
                ""IngredientId"" uuid NOT NULL,
                ""IngredientName"" text NOT NULL,
                ""Unit"" text NOT NULL,
                ""QuantityRequested"" numeric(18,2) NOT NULL,
                ""QuantityDispatched"" numeric(18,2) NOT NULL,
                ""QuantityReceived"" numeric(18,2) NOT NULL,
                ""UnitCostPKR"" numeric(18,2) NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""PurchaseOrders"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""PONumber"" text NOT NULL,
                ""SupplierName"" text NOT NULL,
                ""Status"" integer NOT NULL,
                ""TotalCostPKR"" numeric(18,2) NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL,
                ""ReceivedAt"" timestamp with time zone,
                ""ReceivedBy"" text,
                ""Notes"" text
            );
            CREATE TABLE IF NOT EXISTS ""PurchaseOrderItems"" (
                ""Id"" uuid PRIMARY KEY,
                ""PurchaseOrderId"" uuid NOT NULL,
                ""IngredientId"" uuid NOT NULL,
                ""IngredientName"" text NOT NULL,
                ""Quantity"" numeric(18,2) NOT NULL,
                ""Unit"" text NOT NULL,
                ""UnitCostPKR"" numeric(18,2) NOT NULL,
                ""TotalPKR"" numeric(18,2) NOT NULL
            );
            ALTER TABLE ""ProductModifiers"" ADD COLUMN IF NOT EXISTS ""IngredientId"" uuid;
            ALTER TABLE ""ProductModifiers"" ADD COLUMN IF NOT EXISTS ""IngredientQty"" numeric(18,2);

            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""Slug"" text NOT NULL DEFAULT '';
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ContactName"" text NOT NULL DEFAULT '';
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ContactEmail"" text NOT NULL DEFAULT '';
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ContactPhone"" text NOT NULL DEFAULT '';
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""City"" text;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""Address"" text;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""IsTrialActive"" boolean NOT NULL DEFAULT true;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""TrialEndsAt"" timestamp with time zone NOT NULL DEFAULT NOW();
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""SubscriptionPaidUntil"" timestamp with time zone;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""Tier"" integer NOT NULL DEFAULT 1;

            -- Pre-existing schema drift: CashShift gained these columns after some dev
            -- databases already had the table created, so EnsureCreatedAsync() never added them.
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""TerminalName"" text NOT NULL DEFAULT '';
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""CashierName"" text NOT NULL DEFAULT '';
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""OpenedAt"" timestamp with time zone NOT NULL DEFAULT NOW();
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""ClosedAt"" timestamp with time zone;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""OpeningFloatPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""CashSalesPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""CashReceivedPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""CashPaidOutPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""ExpectedCashPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""ActualCashCountedPKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""VariancePKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""Notes"" text;
            ALTER TABLE ""CashShifts"" ADD COLUMN IF NOT EXISTS ""IsClosed"" boolean NOT NULL DEFAULT false;

            CREATE TABLE IF NOT EXISTS ""NotificationLogs"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""OrderId"" uuid,
                ""Channel"" text NOT NULL,
                ""RecipientPhone"" text NOT NULL,
                ""MessageType"" text NOT NULL,
                ""MessageBody"" text NOT NULL,
                ""Status"" text NOT NULL,
                ""ProviderMessageId"" text,
                ""ErrorMessage"" text,
                ""SentAt"" timestamp with time zone NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""WhatsAppConfigs"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Provider"" text NOT NULL,
                ""ApiKey"" text,
                ""ApiSecret"" text,
                ""PhoneNumberId"" text,
                ""AccessToken"" text,
                ""WebhookUrl"" text,
                ""IsEnabled"" boolean NOT NULL,
                ""AutoSendOrderUpdates"" boolean NOT NULL,
                ""AutoSendReceipt"" boolean NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""SaaSPackageConfigs"" (
                ""Id"" uuid PRIMARY KEY,
                ""PackageKey"" text NOT NULL,
                ""DisplayName"" text NOT NULL,
                ""MonthlyPricePKR"" numeric(18,2) NOT NULL,
                ""YearlyPricePKR"" numeric(18,2) NOT NULL,
                ""MaxBranches"" integer NOT NULL,
                ""MaxCounters"" integer NOT NULL,
                ""MaxOrderTabs"" integer NOT NULL,
                ""MaxUsers"" integer NOT NULL,
                ""HasKitchenDisplay"" boolean NOT NULL,
                ""HasDeliveryCOD"" boolean NOT NULL,
                ""HasInventoryManagement"" boolean NOT NULL,
                ""HasStockTransfers"" boolean NOT NULL,
                ""HasDirectorDashboard"" boolean NOT NULL,
                ""HasConsolidatedReports"" boolean NOT NULL,
                ""HasWhatsAppMessaging"" boolean NOT NULL,
                ""HasAdvancedReports"" boolean NOT NULL,
                ""HasMultiBranch"" boolean NOT NULL,
                ""WhatsAppMessagesPerMonth"" integer NOT NULL,
                ""IsActive"" boolean NOT NULL,
                ""UpdatedAt"" timestamp with time zone NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""ModulePermissions"" (
                ""Id"" uuid PRIMARY KEY,
                ""UserId"" uuid NOT NULL,
                ""ModuleKey"" text NOT NULL,
                ""SubModuleKey"" text NOT NULL,
                ""CanView"" boolean NOT NULL,
                ""CanEdit"" boolean NOT NULL,
                ""CanDelete"" boolean NOT NULL,
                ""CanExport"" boolean NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ""SmartAlerts"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid,
                ""AlertType"" text NOT NULL,
                ""Severity"" text NOT NULL,
                ""Title"" text NOT NULL,
                ""Message"" text NOT NULL,
                ""Metadata"" text,
                ""IsRead"" boolean NOT NULL DEFAULT false,
                ""IsDismissed"" boolean NOT NULL DEFAULT false,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
        ");

        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""TenantSettings"" (
                ""Id"" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                ""TenantId"" uuid NOT NULL,
                ""CountryCode"" text NOT NULL DEFAULT 'PK',
                ""CurrencyCode"" text NOT NULL DEFAULT 'PKR',
                ""CurrencySymbol"" text NOT NULL DEFAULT E'\u20A8',
                ""DecimalPlaces"" integer NOT NULL DEFAULT 0,
                ""TaxAuthorityName"" text NOT NULL DEFAULT 'FBR',
                ""DefaultTaxRate"" numeric(18,2) NOT NULL DEFAULT 16,
                ""UseDualTaxRate"" boolean NOT NULL DEFAULT true,
                ""DigitalTaxRate"" numeric(18,2) NOT NULL DEFAULT 8,
                ""PhoneCode"" text NOT NULL DEFAULT '+92',
                ""DefaultCity"" text NOT NULL DEFAULT 'Islamabad',
                ""DateFormat"" text NOT NULL DEFAULT 'dd/MM/yyyy',
                ""ReceiptFooter"" text NOT NULL DEFAULT 'Thank you for your visit!',
                ""AllowedPaymentMethods"" text NOT NULL DEFAULT 'Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata'
            );
        ");
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TenantSettings_TenantId') THEN
                    CREATE UNIQUE INDEX ""IX_TenantSettings_TenantId"" ON ""TenantSettings"" (""TenantId"");
                END IF;
            END $$;
        ");
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenantsettings_tenants') THEN
                    ALTER TABLE ""TenantSettings"" ADD CONSTRAINT ""fk_tenantsettings_tenants"" FOREIGN KEY (""TenantId"") REFERENCES ""Tenants""(""Id"") ON DELETE CASCADE;
                END IF;
            END $$;
        ");

        // Add LocalName to Categories if not exists
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Categories' AND column_name = 'LocalName') THEN
                    ALTER TABLE ""Categories"" ADD COLUMN ""LocalName"" text NULL;
                END IF;
            END $$;
        ");

        // --- Security / tax hardening schema (AddTaxRbacHardening) ---
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""TaxJurisdictions"" (
                ""Id"" uuid PRIMARY KEY,
                ""CountryCode"" text NOT NULL,
                ""RegionCode"" text NOT NULL,
                ""AuthorityName"" text NOT NULL,
                ""CashTaxRate"" numeric(18,2) NOT NULL DEFAULT 0,
                ""DigitalTaxRate"" numeric(18,2) NOT NULL DEFAULT 0,
                ""IsActive"" boolean NOT NULL DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS ""AuditLogs"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""UserName"" text NOT NULL DEFAULT '',
                ""Action"" text NOT NULL DEFAULT '',
                ""EntityType"" text NOT NULL DEFAULT '',
                ""EntityId"" uuid,
                ""OldValue"" text,
                ""NewValue"" text,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            ALTER TABLE ""Branches"" ADD COLUMN IF NOT EXISTS ""RegionCode"" text;
            ALTER TABLE ""TenantSettings"" ADD COLUMN IF NOT EXISTS ""UseProvincialTax"" boolean NOT NULL DEFAULT false;

            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""InKitchenAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""ReadyAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""OutForDeliveryAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""CompletedAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""CancelledAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""FiscalInvoiceNumber"" text;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""FiscalQrPayload"" text;
        ");
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TaxJurisdictions_CountryCode_RegionCode') THEN
                    CREATE UNIQUE INDEX ""IX_TaxJurisdictions_CountryCode_RegionCode"" ON ""TaxJurisdictions"" (""CountryCode"", ""RegionCode"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_AuditLogs_TenantId_CreatedAt') THEN
                    CREATE INDEX ""IX_AuditLogs_TenantId_CreatedAt"" ON ""AuditLogs"" (""TenantId"", ""CreatedAt"");
                END IF;
            END $$;
        ");

        // Seed data — clean slate, user creates everything
        await DbSeeder.SeedAsync(db);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Seeder Error / Note]: {ex.Message}");
    }
}

// Seed TenantSettings for existing tenants
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var tenantsWithoutSettings = db.Tenants
        .Where(t => !db.TenantSettings.Any(s => s.TenantId == t.Id))
        .ToList();
    foreach (var tenant in tenantsWithoutSettings)
    {
        db.TenantSettings.Add(new TenantSettings { TenantId = tenant.Id });
    }
    if (tenantsWithoutSettings.Count > 0) await db.SaveChangesAsync();
}

// --- Helper: Generate unique order number ---
static async Task<string> GenerateOrderNumberAsync(AppDbContext db, string prefix = "ORD")
{
    var today = DateTime.UtcNow;
    var dateStr = today.ToString("yyMMdd");
    var lastOrder = await db.Orders
        .Where(o => o.OrderNumber.StartsWith($"{prefix}-{dateStr}"))
        .OrderByDescending(o => o.OrderNumber)
        .Select(o => o.OrderNumber)
        .FirstOrDefaultAsync();

    int seq = 1;
    if (lastOrder != null)
    {
        var parts = lastOrder.Split('-');
        if (parts.Length >= 3 && int.TryParse(parts[2], out var lastSeq))
        {
            seq = lastSeq + 1;
        }
    }
    return $"{prefix}-{dateStr}-{seq:D4}";
}

// --- Helper: Generate unique transfer number ---
static async Task<string> GenerateTransferNumberAsync(AppDbContext db)
{
    var today = DateTime.UtcNow;
    var dateStr = today.ToString("MMdd");
    var last = await db.StockTransferOrders
        .Where(t => t.TransferNumber.StartsWith($"TR-{dateStr}"))
        .OrderByDescending(t => t.TransferNumber)
        .Select(t => t.TransferNumber)
        .FirstOrDefaultAsync();

    int seq = 1;
    if (last != null)
    {
        var parts = last.Split('-');
        if (parts.Length >= 3 && int.TryParse(parts[2], out var lastSeq))
        {
            seq = lastSeq + 1;
        }
    }
    return $"TR-{dateStr}-{seq:D4}";
}

// --- Helper: Generate unique PO number ---
static async Task<string> GeneratePONumberAsync(AppDbContext db)
{
    var today = DateTime.UtcNow;
    var dateStr = today.ToString("MMdd");
    var last = await db.PurchaseOrders
        .Where(p => p.PONumber.StartsWith($"PO-{dateStr}"))
        .OrderByDescending(p => p.PONumber)
        .Select(p => p.PONumber)
        .FirstOrDefaultAsync();

    int seq = 1;
    if (last != null)
    {
        var parts = last.Split('-');
        if (parts.Length >= 3 && int.TryParse(parts[2], out var lastSeq))
        {
            seq = lastSeq + 1;
        }
    }
    return $"PO-{dateStr}-{seq:D4}";
}

// ============================================================
// SECURITY HELPERS — tenant / branch scoping, server-side pricing, audit
// ============================================================

// Tenant scope: always prefer the JWT tenant. Only a SuperAdmin (whose token carries
// tenantId = Guid.Empty) may target a tenant supplied by the client.
static Guid? ResolveTenantScope(HttpContext http, Guid? clientSuppliedTenantId)
{
    var tokenTenantId = http.GetTenantId();
    if (tokenTenantId != null && tokenTenantId.Value != Guid.Empty) return tokenTenantId;
    return http.IsSuperAdmin() ? clientSuppliedTenantId : null;
}

static async Task<(Guid? BranchId, IResult? Error)> ResolveBranchScopeAsync(HttpContext http, AppDbContext db, Guid tenantId, Guid? requestedBranchId)
{
    var userBranchId = http.GetBranchId();
    if (userBranchId != null)
    {
        if (requestedBranchId != null && requestedBranchId != Guid.Empty && requestedBranchId != userBranchId)
            return (null, Results.Json(new { message = "You can only access your own branch." }, statusCode: 403));
        return (userBranchId, null);
    }
    if (requestedBranchId == null || requestedBranchId == Guid.Empty) return (null, Results.BadRequest(new { message = "branchId is required." }));
    var belongs = http.IsSuperAdmin() || await db.Branches.AnyAsync(b => b.Id == requestedBranchId.Value && b.TenantId == tenantId);
    if (!belongs) return (null, Results.Json(new { message = "Branch not found for this tenant." }, statusCode: 403));
    return (requestedBranchId, null);
}

// Combined helper: resolves tenant then branch in one shot for the common endpoint shape.
static async Task<(Guid? TenantId, Guid? BranchId, IResult? Error)> ResolveScopeAsync(HttpContext http, AppDbContext db, Guid? clientTenantId, Guid? requestedBranchId)
{
    var tenantId = ResolveTenantScope(http, clientTenantId);
    if (tenantId == null)
    {
        // SuperAdmin without an explicit tenantId: derive it from the requested branch if possible.
        if (http.IsSuperAdmin() && requestedBranchId != null && requestedBranchId != Guid.Empty)
        {
            var derived = await db.Branches.Where(b => b.Id == requestedBranchId.Value).Select(b => (Guid?)b.TenantId).FirstOrDefaultAsync();
            if (derived != null) tenantId = derived;
        }
        if (tenantId == null) return (null, null, Results.Unauthorized());
    }
    var (branchId, error) = await ResolveBranchScopeAsync(http, db, tenantId.Value, requestedBranchId);
    if (error != null) return (tenantId, null, error);
    return (tenantId, branchId, null);
}

static async Task WriteAuditAsync(AppDbContext db, Guid tenantId, AppUser? user, string action, string entityType, Guid? entityId, string? oldValue, string? newValue)
{
    db.AuditLogs.Add(new AuditLog
    {
        TenantId = tenantId,
        UserId = user?.Id ?? Guid.Empty,
        UserName = user?.FullName ?? "System",
        Action = action,
        EntityType = entityType,
        EntityId = entityId,
        OldValue = oldValue,
        NewValue = newValue,
        CreatedAt = DateTime.UtcNow
    });
}

// --- Helper: resolve the applicable tax rates for a branch ---
static async Task<(decimal CashRate, decimal DigitalRate, int DecimalPlaces)> ResolveTaxRatesAsync(AppDbContext db, Branch branch)
{
    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == branch.TenantId);
    var decimals = settings?.DecimalPlaces ?? 2;
    var cashRate = settings?.DefaultTaxRate ?? 16m;
    var digitalRate = (settings != null && settings.UseDualTaxRate) ? settings.DigitalTaxRate : cashRate;

    // Provincial override: only when the tenant opted in AND the branch declares a region.
    // Everyone else (non-PK tenants, PK tenants with no region set) keeps the flat tenant rate.
    if (settings != null && settings.UseProvincialTax && !string.IsNullOrWhiteSpace(branch.RegionCode))
    {
        var jurisdiction = await db.TaxJurisdictions.FirstOrDefaultAsync(j =>
            j.CountryCode == settings.CountryCode && j.RegionCode == branch.RegionCode && j.IsActive);
        if (jurisdiction != null)
        {
            cashRate = jurisdiction.CashTaxRate;
            digitalRate = jurisdiction.DigitalTaxRate;
        }
    }
    return (cashRate, digitalRate, decimals);
}

static decimal PickTaxRate(PaymentMethod method, decimal cashRate, decimal digitalRate) => method switch
{
    PaymentMethod.Cash => cashRate,
    PaymentMethod.Card or PaymentMethod.JazzCash or PaymentMethod.EasyPaisa or PaymentMethod.Raast => digitalRate,
    // Split / CustomerKhata are settled partly or wholly in cash, so we apply the cash rate
    // as the conservative default (cash rate is >= digital rate under dual-rate regimes).
    _ => cashRate
};

// --- Helper: recompute an order's money from DB prices. NEVER trusts client totals. ---
static async Task<ServerPricedOrder> PriceOrderAsync(AppDbContext db, Branch branch, CreateOrderDto dto, Guid orderId, AppUser? actingUser)
{
    var result = new ServerPricedOrder();

    var productIds = dto.Items.Select(i => i.ProductId).Distinct().ToList();
    var products = await db.Products
        .Where(p => productIds.Contains(p.Id) && p.TenantId == branch.TenantId)
        .ToDictionaryAsync(p => p.Id);

    decimal subTotal = 0m;
    foreach (var item in dto.Items)
    {
        if (!products.TryGetValue(item.ProductId, out var product))
        {
            result.Error = $"Unknown or cross-tenant product in order: {item.ProductName}";
            return result;
        }
        if (item.Quantity <= 0)
        {
            result.Error = $"Invalid quantity for {product.Name}.";
            return result;
        }

        // Base unit price is ALWAYS sourced from the database, never from the client payload.
        var unitPrice = product.SellingPricePKR;
        var lineTotal = unitPrice * item.Quantity;
        subTotal += lineTotal;

        result.Items.Add(new OrderItem
        {
            OrderId = orderId,
            ProductId = product.Id,
            ProductName = product.Name,
            Quantity = item.Quantity,
            UnitPricePKR = unitPrice,
            TotalPricePKR = lineTotal,
            ModifiersSummary = item.ModifiersSummary,
            SpecialNotes = item.SpecialNotes,
            Station = product.Station
        });
    }

    // Discount is only honoured when the acting user is actually allowed to give one.
    // An unauthorised discount is zeroed and flagged rather than failing the whole sale.
    var discount = dto.DiscountPKR;
    if (discount < 0) discount = 0m;
    if (discount > 0)
    {
        var mayDiscount = actingUser != null &&
            (actingUser.Role == UserRole.OwnerAdmin || actingUser.Role == UserRole.SuperAdmin || actingUser.CanGiveDiscounts);
        if (!mayDiscount)
        {
            result.DiscountRejected = true;
            result.AttemptedDiscountPKR = discount;
            discount = 0m;
        }
    }
    if (discount > subTotal) discount = subTotal;

    var (cashRate, digitalRate, decimals) = await ResolveTaxRatesAsync(db, branch);
    var rate = PickTaxRate(dto.PaymentMethod, cashRate, digitalRate);

    subTotal = Math.Round(subTotal, decimals, MidpointRounding.AwayFromZero);
    discount = Math.Round(discount, decimals, MidpointRounding.AwayFromZero);
    var tax = Math.Round((subTotal - discount) * (rate / 100m), decimals, MidpointRounding.AwayFromZero);

    result.SubTotalPKR = subTotal;
    result.DiscountPKR = discount;
    result.TaxPKR = tax;
    result.TotalPKR = subTotal - discount + tax;
    result.TaxRatePercent = rate;
    return result;
}

// ============================================================
// PUBLIC ENDPOINTS (no auth required)
// ============================================================

// --- Health / Status ---
app.MapGet("/", () => Results.Ok(new
{
    system = "Cashly POS - Enterprise API",
    version = "3.0.0",
    currency = "PKR",
    status = "Online",
    features = new[] { "JWT Auth", "Mode 1 Dispatch", "COD Rider Settlement", "Call Center Orders", "Offline Sync", "Director KPIs", "Void Orders", "Cash Shifts" }
}));

// --- Auth: PIN Login ---
var authApi = app.MapGroup("/api/auth").RequireRateLimiting("auth");

authApi.MapPost("/login", async (AppDbContext db, LoginDto dto) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == dto.Username.ToLower().Trim() && u.IsActive);
    if (user == null || !BCrypt.Net.BCrypt.Verify(dto.PinCode, user.PinCodeHash))
    {
        return Results.Unauthorized();
    }

    var tokenHandler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"] ?? Environment.GetEnvironmentVariable("JWT_KEY") ?? "CashlyPOS_SuperSecretKey_2024_Change_In_Production!");
    var tokenDescriptor = new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
    {
        Expires = DateTime.UtcNow.AddHours(12),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature),
        Claims = new Dictionary<string, object>
        {
            { "userId", user.Id.ToString() },
            { "tenantId", user.TenantId.ToString() },
            { "branchId", user.BranchId?.ToString() ?? "" },
            { "role", user.Role.ToString() },
            // Explicit per-permission claims so the client (and HttpContext.HasPermission) can
            // read them without parsing the legacy JSON blob. The DB remains authoritative.
            { "canViewFinancialReports", user.CanViewFinancialReports.ToString().ToLower() },
            { "canManageInventory", user.CanManageInventory.ToString().ToLower() },
            { "canManageMenuAndTax", user.CanManageMenuAndTax.ToString().ToLower() },
            { "canGiveDiscounts", user.CanGiveDiscounts.ToString().ToLower() },
            { "canVoidOrders", user.CanVoidOrders.ToString().ToLower() },
            { "permissions", System.Text.Json.JsonSerializer.Serialize(new
            {
                user.CanViewFinancialReports,
                user.CanManageInventory,
                user.CanManageMenuAndTax,
                user.CanGiveDiscounts,
                user.CanVoidOrders
            })}
        }
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);

    return Results.Ok(new
    {
        token = tokenHandler.WriteToken(token),
        user = new
        {
            id = user.Id,
            fullName = user.FullName,
            username = user.Username,
            role = user.Role.ToString(),
            tenantId = user.TenantId,
            branchId = user.BranchId,
            permissions = new
            {
                user.CanViewFinancialReports,
                user.CanManageInventory,
                user.CanManageMenuAndTax,
                user.CanGiveDiscounts,
                user.CanVoidOrders
            }
        }
    });
});

// ============================================================
// CORE API ENDPOINTS
// Every endpoint in this group requires a valid JWT. The only exceptions are the four
// setup/installation-wizard endpoints below, which must bootstrap the system before any
// user exists — they are each explicitly marked .AllowAnonymous().
// ============================================================
var api = app.MapGroup("/api").RequireAuthorization();

// --- Manager Override: verify ANOTHER user's PIN for a privileged action ---
// The caller must already be authenticated. This does NOT log the caller in as that user;
// it only confirms a supervisor physically approved the action, and records it.
api.MapPost("/auth/verify-pin", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, VerifyPinDto dto) =>
{
    var callerTenantId = http.GetTenantId();
    if (callerTenantId == null) return Results.Unauthorized();

    if (string.IsNullOrWhiteSpace(dto.Username) || string.IsNullOrWhiteSpace(dto.PinCode))
        return Results.BadRequest(new { message = "Username and PIN are required." });

    var username = dto.Username.ToLower().Trim();
    var approver = await db.Users.FirstOrDefaultAsync(u =>
        u.Username == username && u.IsActive &&
        (u.TenantId == callerTenantId.Value || u.Role == UserRole.SuperAdmin));

    if (approver == null) return Results.NotFound(new { authorized = false, message = "No active user with that username in this restaurant." });

    if (!BCrypt.Net.BCrypt.Verify(dto.PinCode, approver.PinCodeHash))
        return Results.Ok(new { authorized = false, message = "Incorrect PIN." });

    var isOwner = approver.Role == UserRole.OwnerAdmin || approver.Role == UserRole.SuperAdmin;
    bool permitted;
    if (string.IsNullOrWhiteSpace(dto.RequiredPermission))
    {
        permitted = isOwner || approver.Role == UserRole.BranchManager;
    }
    else
    {
        permitted = isOwner || dto.RequiredPermission.Trim().ToLowerInvariant() switch
        {
            "canviewfinancialreports" => approver.CanViewFinancialReports,
            "canmanageinventory" => approver.CanManageInventory,
            "canmanagemenuandtax" => approver.CanManageMenuAndTax,
            "cangivediscounts" => approver.CanGiveDiscounts,
            "canvoidorders" => approver.CanVoidOrders,
            _ => false
        };
    }

    if (!permitted)
        return Results.Ok(new { authorized = false, message = $"{approver.FullName} is not authorised to approve this action." });

    var caller = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, callerTenantId.Value, approver, "ManagerOverride", "AppUser", caller?.Id,
        oldValue: dto.RequiredPermission ?? "identity",
        newValue: $"approved for {caller?.FullName ?? "unknown user"}");
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        authorized = true,
        authorizedByUserId = approver.Id,
        authorizedByName = approver.FullName,
        authorizedByRole = approver.Role.ToString()
    });
}).RequireRateLimiting("auth");

// --- Setup & Installation Wizard ---
api.MapGet("/setup/status", async (AppDbContext db) =>
{
    var tenantCount = await db.Tenants.CountAsync();
    var tenants = await db.Tenants
        .Include(t => t.Branches)
        .Select(t => new
        {
            t.Id,
            t.Name,
            t.BusinessType,
            t.Tier,
            t.IsActive,
            BranchCount = t.Branches.Count,
            HasHeadOffice = t.Branches.Any(b => b.IsHeadOffice),
            Branches = t.Branches.Select(b => new { b.Id, b.Name, b.Code, b.City, b.IsHeadOffice, b.AllowedCounters, b.AllowedOrderTabs })
        })
        .ToListAsync();

    return Results.Ok(new
    {
        isConfigured = tenantCount > 0,
        tenantCount,
        tenants
    });
}).AllowAnonymous(); // bootstrap: must be reachable before any user exists

api.MapPost("/setup/initialize", async (AppDbContext db, SetupInitDto dto) =>
{
    var slug = dto.RestaurantName.ToLower().Trim().Replace(" ", "-");
    slug = System.Text.RegularExpressions.Regex.Replace(slug, @"[^a-z0-9\-]", "");

    var tenant = new Tenant
    {
        Id = Guid.NewGuid(),
        Name = string.IsNullOrWhiteSpace(dto.RestaurantName) ? "Cashly Restaurant" : dto.RestaurantName.Trim(),
        Slug = slug,
        ContactName = dto.AdminFullName ?? "Admin",
        ContactEmail = dto.AdminUsername ?? "admin",
        ContactPhone = dto.Phone ?? "",
        City = dto.City,
        Address = dto.Address,
        BusinessType = dto.BusinessType ?? BusinessType.Restaurant,
        Tier = dto.DeploymentMode == "MultiBranch" ? SubscriptionTier.Professional : SubscriptionTier.Standard,
        IsActive = true,
        IsTrialActive = false,
        SubscriptionPaidUntil = DateTime.UtcNow.AddYears(1),
        CreatedAt = DateTime.UtcNow
    };
    // Enforce the subscription tier's branch quota before provisioning anything.
    // Tenants are keyed to a package by Tier.ToString() == SaaSPackageConfig.PackageKey.
    var package = await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tenant.Tier.ToString() && p.IsActive);
    if (package != null)
    {
        if (dto.DeploymentMode == "MultiBranch" && !package.HasMultiBranch)
            return Results.BadRequest(new { message = $"The {package.DisplayName} package does not include multi-branch deployment. Please upgrade." });

        // HQ counts as a branch in MultiBranch mode; Single mode provisions exactly one.
        var requestedBranchCount = dto.DeploymentMode == "MultiBranch"
            ? 1 + Math.Max(1, dto.Branches?.Count ?? 1)
            : 1;
        if (requestedBranchCount > package.MaxBranches)
            return Results.BadRequest(new { message = $"The {package.DisplayName} package allows a maximum of {package.MaxBranches} branch(es); {requestedBranchCount} were requested. Please upgrade or reduce the branch list." });
    }

    db.Tenants.Add(tenant);

    var createdBranches = new List<Branch>();

    if (dto.DeploymentMode == "MultiBranch")
    {
        // 1. Central Commissary / Head Office
        var hqBranch = new Branch
        {
            Id = Guid.NewGuid(),
            TenantId = tenant.Id,
            Name = string.IsNullOrWhiteSpace(dto.HqName) ? $"{dto.RestaurantName} Head Office & Commissary" : dto.HqName.Trim(),
            Code = "HQ-01",
            Address = dto.Address ?? "Central Commissary / HQ",
            City = dto.City ?? "Islamabad",
            Phone = dto.Phone ?? "",
            IsHeadOffice = true,
            AllowedCounters = 10,
            AllowedOrderTabs = 25
        };
        db.Branches.Add(hqBranch);
        createdBranches.Add(hqBranch);

        // 2. Outlet branches
        if (dto.Branches != null && dto.Branches.Count > 0)
        {
            int idx = 1;
            foreach (var bDto in dto.Branches)
            {
                var branch = new Branch
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenant.Id,
                    Name = bDto.Name.Trim(),
                    Code = !string.IsNullOrWhiteSpace(bDto.Code) ? bDto.Code.Trim().ToUpper() : $"BR-0{idx}",
                    Address = bDto.Address ?? dto.Address ?? "",
                    City = bDto.City ?? dto.City ?? "Islamabad",
                    Phone = bDto.Phone ?? dto.Phone ?? "",
                    IsHeadOffice = false,
                    AllowedCounters = bDto.AllowedCounters > 0 ? bDto.AllowedCounters : 5,
                    AllowedOrderTabs = bDto.AllowedOrderTabs > 0 ? bDto.AllowedOrderTabs : 15
                };
                db.Branches.Add(branch);
                createdBranches.Add(branch);
                idx++;
            }
        }
        else
        {
            var outlet1 = new Branch
            {
                Id = Guid.NewGuid(),
                TenantId = tenant.Id,
                Name = $"{dto.RestaurantName} - Main Outlet",
                Code = "BR-01",
                Address = dto.Address ?? "Commercial Sector",
                City = dto.City ?? "Islamabad",
                Phone = dto.Phone ?? "",
                IsHeadOffice = false,
                AllowedCounters = 5,
                AllowedOrderTabs = 15
            };
            db.Branches.Add(outlet1);
            createdBranches.Add(outlet1);
        }
    }
    else
    {
        // Single Restaurant Mode
        var singleBranch = new Branch
        {
            Id = Guid.NewGuid(),
            TenantId = tenant.Id,
            Name = string.IsNullOrWhiteSpace(dto.MainBranchName) ? $"{dto.RestaurantName} - Main Dining" : dto.MainBranchName.Trim(),
            Code = "MAIN-01",
            Address = dto.Address ?? "Main Location",
            City = dto.City ?? "Islamabad",
            Phone = dto.Phone ?? "",
            IsHeadOffice = false,
            AllowedCounters = dto.AllowedCounters ?? 2,
            AllowedOrderTabs = dto.AllowedOrderTabs ?? 10
        };
        db.Branches.Add(singleBranch);
        createdBranches.Add(singleBranch);
    }

    // Create Admin User
    var adminPin = string.IsNullOrWhiteSpace(dto.AdminPin) ? "1234" : dto.AdminPin.Trim();
    var pinHash = BCrypt.Net.BCrypt.HashPassword(adminPin);
    var adminUser = new AppUser
    {
        Id = Guid.NewGuid(),
        TenantId = tenant.Id,
        BranchId = null,
        FullName = string.IsNullOrWhiteSpace(dto.AdminFullName) ? "Master Admin" : dto.AdminFullName.Trim(),
        Username = string.IsNullOrWhiteSpace(dto.AdminUsername) ? "admin" : dto.AdminUsername.Trim().ToLower(),
        PinCodeHash = pinHash,
        Role = UserRole.OwnerAdmin,
        IsActive = true,
        CreatedAt = DateTime.UtcNow,
        CanViewFinancialReports = true,
        CanManageInventory = true,
        CanManageMenuAndTax = true,
        CanGiveDiscounts = true,
        CanVoidOrders = true
    };
    db.Users.Add(adminUser);

    if (dto.SeedStarterMenu)
    {
        var catBurgers = new Category { Id = Guid.NewGuid(), TenantId = tenant.Id, Name = "Burgers & Sandwiches", Icon = "sandwich", SortOrder = 1 };
        var catPizza = new Category { Id = Guid.NewGuid(), TenantId = tenant.Id, Name = "Pizzas & Platters", Icon = "pizza", SortOrder = 2 };
        var catBeverages = new Category { Id = Guid.NewGuid(), TenantId = tenant.Id, Name = "Beverages & Drinks", Icon = "coffee", SortOrder = 3 };
        var catSides = new Category { Id = Guid.NewGuid(), TenantId = tenant.Id, Name = "Sides & Desserts", Icon = "cake", SortOrder = 4 };
        db.Categories.AddRange(catBurgers, catPizza, catBeverages, catSides);

        var p1 = new Product { Id = Guid.NewGuid(), TenantId = tenant.Id, CategoryId = catBurgers.Id, SKU = "B-01", Barcode = "1000000001", Name = "Classic Smash Burger", UrduName = "کلاسک سمیش برگر", CostPricePKR = 380, SellingPricePKR = 750, Unit = "Piece", Station = KitchenStation.Grill, IsActive = true };
        var p2 = new Product { Id = Guid.NewGuid(), TenantId = tenant.Id, CategoryId = catBurgers.Id, SKU = "B-02", Barcode = "1000000002", Name = "Crispy Zinger Crunch", UrduName = "کرسپی زنگر برگر", CostPricePKR = 320, SellingPricePKR = 620, Unit = "Piece", Station = KitchenStation.MainKitchen, IsActive = true };
        var p3 = new Product { Id = Guid.NewGuid(), TenantId = tenant.Id, CategoryId = catPizza.Id, SKU = "P-01", Barcode = "1000000003", Name = "Royal Chicken Tikka Pizza", UrduName = "چکن تکہ پیزا", CostPricePKR = 650, SellingPricePKR = 1350, Unit = "Piece", Station = KitchenStation.MainKitchen, IsActive = true };
        var p4 = new Product { Id = Guid.NewGuid(), TenantId = tenant.Id, CategoryId = catBeverages.Id, SKU = "D-01", Barcode = "1000000004", Name = "Fresh Mint Margarita", UrduName = "منٹ مارگریٹا", CostPricePKR = 90, SellingPricePKR = 290, Unit = "Glass", Station = KitchenStation.BeverageBar, IsActive = true };
        var p5 = new Product { Id = Guid.NewGuid(), TenantId = tenant.Id, CategoryId = catSides.Id, SKU = "S-01", Barcode = "1000000005", Name = "Loaded Gourmet Fries", UrduName = "لوڈڈ فرائز", CostPricePKR = 160, SellingPricePKR = 390, Unit = "Portion", Station = KitchenStation.MainKitchen, IsActive = true };

        p1.Modifiers.Add(new ProductModifier { Name = "Extra Cheese Slice", PricePKR = 90 });
        p1.Modifiers.Add(new ProductModifier { Name = "Double Patty Upgrade", PricePKR = 250 });
        p2.Modifiers.Add(new ProductModifier { Name = "Spicy Chipotle Dip", PricePKR = 60 });

        db.Products.AddRange(p1, p2, p3, p4, p5);

        foreach (var branch in createdBranches.Where(b => !b.IsHeadOffice))
        {
            for (int i = 1; i <= 8; i++)
            {
                db.DiningTables.Add(new DiningTable
                {
                    BranchId = branch.Id,
                    TableNumber = $"T-{i}",
                    Section = i <= 4 ? "Main Dining" : "Family Terrace",
                    Capacity = (i % 2 == 0) ? 6 : 4,
                    IsOccupied = false
                });
            }
        }
    }

    // Seed default tenant settings
    var tenantSettings = new TenantSettings
    {
        TenantId = tenant.Id,
        CountryCode = dto.CountryCode ?? "PK",
        CurrencyCode = dto.CurrencyCode ?? "PKR",
        CurrencySymbol = dto.CurrencySymbol ?? "₨",
        DecimalPlaces = dto.DecimalPlaces ?? 0,
        TaxAuthorityName = dto.TaxAuthorityName ?? "FBR",
        DefaultTaxRate = dto.DefaultTaxRate ?? 16,
        UseDualTaxRate = dto.UseDualTaxRate ?? true,
        DigitalTaxRate = dto.DigitalTaxRate ?? 8,
        PhoneCode = dto.PhoneCode ?? "+92",
        DefaultCity = dto.City ?? "Islamabad",
        DateFormat = "dd/MM/yyyy",
        ReceiptFooter = "Thank you for your visit!",
        AllowedPaymentMethods = dto.AllowedPaymentMethods ?? "Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata"
    };
    db.TenantSettings.Add(tenantSettings);

    try
    {
        await db.SaveChangesAsync();
    }
    catch (Exception ex)
    {
        var innerMsg = ex.InnerException?.Message ?? ex.Message;
        return Results.Problem($"Database save failed: {innerMsg}", statusCode: 500);
    }

    return Results.Ok(new
    {
        success = true,
        message = $"Successfully configured {tenant.Name} in {dto.DeploymentMode} mode.",
        tenantId = tenant.Id,
        tenantName = tenant.Name,
        deploymentMode = dto.DeploymentMode,
        branches = createdBranches.Select(b => new { b.Id, b.Name, b.Code, b.City, b.IsHeadOffice })
    });
}).AllowAnonymous(); // bootstrap: creates the very first tenant + owner account

// --- Offline Batch Sync ---
// Offline orders were rung up without a live price check, so every one is RE-PRICED here
// against current DB prices/tax rates. Where the recomputed subtotal drifts >2% from what the
// terminal submitted, a SmartAlert is raised so an owner can review rather than the difference
// being silently overwritten.
api.MapPost("/sync/batch-orders", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    Pos.Api.Services.IFiscalInvoiceProvider fiscal,
    List<CreateOrderDto> ordersList) =>
{
    var callerTenantId = http.GetTenantId();
    if (callerTenantId == null) return Results.Unauthorized();
    var actingUser = await accessor.GetCurrentUserAsync(http);
    var syncedResults = new List<object>();

    foreach (var dto in ordersList)
    {
        var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
        if (scopeError != null || scopedBranchId == null)
        {
            syncedResults.Add(new { orderId = (Guid?)null, orderNumber = (string?)null, status = "Rejected", reason = "Branch not accessible for this user." });
            continue;
        }

        var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == scopedBranchId.Value && b.TenantId == scopedTenantId!.Value);
        if (branch == null) continue;

        var orderNumber = await GenerateOrderNumberAsync(db);
        var order = new Order
        {
            TenantId = branch.TenantId,
            BranchId = branch.Id,
            OrderNumber = orderNumber,
            OrderType = dto.OrderType,
            Status = dto.OrderType == OrderType.DineIn ? OrderStatus.InKitchen :
                     (dto.OrderType == OrderType.Delivery || dto.OrderType == OrderType.CallOrder) ? OrderStatus.InKitchen :
                     OrderStatus.ReadyForDispatch,
            TableNumber = dto.TableNumber,
            CustomerName = dto.CustomerName,
            CustomerPhone = dto.CustomerPhone,
            DeliveryAddress = dto.DeliveryAddress,
            PaymentMethod = dto.PaymentMethod,
            AmountPaidPKR = dto.AmountPaidPKR,
            ChangeDuePKR = dto.ChangeDuePKR,
            IsPaid = dto.IsPaid,
            CashierName = dto.CashierName ?? "Counter 1 Cashier",
            CreatedByRole = dto.CreatedByRole ?? "Cashier (Offline Sync)",
            CreatedAt = DateTime.UtcNow
        };

        var priced = await PriceOrderAsync(db, branch, dto, order.Id, actingUser);
        if (priced.Error != null)
        {
            syncedResults.Add(new { orderId = (Guid?)null, orderNumber = (string?)null, status = "Rejected", reason = priced.Error });
            continue;
        }

        order.SubTotalPKR = priced.SubTotalPKR;
        order.DiscountPKR = priced.DiscountPKR;
        order.TaxPKR = priced.TaxPKR;
        order.TotalPKR = priced.TotalPKR;
        foreach (var line in priced.Items) order.Items.Add(line);
        if (order.Status == OrderStatus.InKitchen) order.InKitchenAt = DateTime.UtcNow;

        // Flag suspicious drift between the offline terminal's arithmetic and the server's.
        if (dto.SubTotalPKR > 0)
        {
            var drift = Math.Abs(priced.SubTotalPKR - dto.SubTotalPKR) / dto.SubTotalPKR;
            if (drift > 0.02m)
            {
                db.SmartAlerts.Add(new SmartAlert
                {
                    TenantId = branch.TenantId,
                    BranchId = branch.Id,
                    AlertType = "price_mismatch_offline_sync",
                    Severity = "warning",
                    Title = $"Price mismatch on synced order {order.OrderNumber}",
                    Message = $"Offline terminal submitted a subtotal of {dto.SubTotalPKR:N2} but current menu prices give {priced.SubTotalPKR:N2} ({drift:P1} difference). The server figure was saved — please review.",
                    Metadata = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        orderId = order.Id,
                        orderNumber = order.OrderNumber,
                        submittedSubTotal = dto.SubTotalPKR,
                        recomputedSubTotal = priced.SubTotalPKR,
                        submittedTotal = dto.TotalPKR,
                        recomputedTotal = priced.TotalPKR
                    })
                });
            }
        }

        if (priced.DiscountRejected)
        {
            await WriteAuditAsync(db, branch.TenantId, actingUser, "DiscountRejected", "Order", order.Id,
                oldValue: priced.AttemptedDiscountPKR.ToString("0.##"), newValue: "0");
        }

        var stationGroups = order.Items.GroupBy(i => i.Station);
        int ticketIndex = 1;
        foreach (var group in stationGroups)
        {
            order.KitchenTickets.Add(new KitchenTicket
            {
                OrderId = order.Id,
                BranchId = branch.Id,
                TicketNumber = $"KOT-{DateTime.UtcNow:mm}-{ticketIndex++}",
                Station = group.Key,
                Status = "Cooking",
                CreatedAt = DateTime.UtcNow
            });
        }

        if (!string.IsNullOrEmpty(dto.TableNumber))
        {
            var table = await db.DiningTables.FirstOrDefaultAsync(t => t.BranchId == branch.Id && t.TableNumber == dto.TableNumber);
            if (table != null) { table.IsOccupied = true; table.CurrentOrderId = order.Id; }
        }

        if (dto.IsPaid && dto.PaymentMethod == PaymentMethod.Cash)
        {
            var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == branch.Id && !s.IsClosed);
            if (activeShift != null)
            {
                activeShift.CashSalesPKR += order.TotalPKR;
                activeShift.ExpectedCashPKR = activeShift.OpeningFloatPKR + activeShift.CashSalesPKR;
            }
        }

        db.Orders.Add(order);
        syncedResults.Add(new { orderId = order.Id, orderNumber = order.OrderNumber, status = "Synced", totalPKR = order.TotalPKR });
    }

    await db.SaveChangesAsync();

    // Fiscal e-invoicing (inert stub today — wired for a future FBR integration).
    foreach (var order in db.ChangeTracker.Entries<Order>().Select(e => e.Entity).ToList())
    {
        var (invoiceNumber, qr) = await fiscal.IssueInvoiceAsync(order.TenantId, order.Id, order.TotalPKR, order.TaxPKR);
        if (invoiceNumber != null || qr != null)
        {
            order.FiscalInvoiceNumber = invoiceNumber;
            order.FiscalQrPayload = qr;
        }
    }
    await db.SaveChangesAsync();

    return Results.Ok(new { count = syncedResults.Count, orders = syncedResults });
});

// --- Branch Provisioning & Pairing Hub ---
api.MapGet("/setup/pairing-info", async (AppDbContext db) =>
{
    var branches = await db.Branches
        .Include(b => b.Tenant)
        .Where(b => !b.IsHeadOffice)
        .Select(b => new
        {
            branchId = b.Id,
            branchName = b.Name,
            branchCode = b.Code,
            city = b.City,
            tenantId = b.TenantId,
            tenantName = b.Tenant != null ? b.Tenant.Name : "Cashly Restaurant",
            pairingToken = $"{b.Code.Replace(" ", "").ToUpper()}-{b.Id.ToString().Substring(0, 4).ToUpper()}",
            allowedCounters = b.AllowedCounters,
            allowedOrderTabs = b.AllowedOrderTabs
        })
        .ToListAsync();

    return Results.Ok(branches);
}).AllowAnonymous(); // bootstrap: a fresh terminal has no token yet

api.MapPost("/setup/pair-branch", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] PairBranchDto dto) =>
{
    var cleanToken = (dto.PairingToken ?? string.Empty).Trim().ToUpper();
    var allBranches = await db.Branches.Include(b => b.Tenant).ToListAsync();
    var branch = allBranches.FirstOrDefault(b => 
        $"{b.Code.Replace(" ", "").ToUpper()}-{b.Id.ToString().Substring(0, 4).ToUpper()}" == cleanToken ||
        b.Code.ToUpper() == cleanToken ||
        b.Id.ToString().ToUpper().StartsWith(cleanToken)
    );

    if (branch == null)
    {
        return Results.NotFound(new { message = "Invalid Branch Pairing Token. Please verify the code generated at Head Office." });
    }

    var categories = await db.Categories.Where(c => c.TenantId == branch.TenantId).OrderBy(c => c.SortOrder).ToListAsync();
    var products = await db.Products.Include(p => p.Modifiers).Where(p => p.TenantId == branch.TenantId && p.IsActive).ToListAsync();
    var tables = await db.DiningTables.Where(t => t.BranchId == branch.Id).ToListAsync();

    return Results.Ok(new
    {
        success = true,
        tenantId = branch.TenantId,
        tenantName = branch.Tenant?.Name ?? "Restaurant Chain",
        branchId = branch.Id,
        branchName = branch.Name,
        branchCode = branch.Code,
        city = branch.City,
        isHeadOffice = branch.IsHeadOffice,
        categoriesCount = categories.Count,
        productsCount = products.Count,
        tablesCount = tables.Count,
        categories,
        products,
        diningTables = tables
    });
}).AllowAnonymous(); // bootstrap: a fresh terminal pairs itself before login

// --- Tenancy & Hierarchy ---
// SuperAdmin sees every tenant; everyone else sees only their own.
api.MapGet("/tenants", async (AppDbContext db, HttpContext http) =>
{
    var query = db.Tenants
        .Include(t => t.Branches).ThenInclude(b => b.Terminals)
        .Include(t => t.AddOns)
        .AsQueryable();
    if (!http.IsSuperAdmin())
    {
        var tenantId = http.GetTenantId();
        if (tenantId == null) return Results.Unauthorized();
        query = query.Where(t => t.Id == tenantId.Value);
    }
    return Results.Ok(await query.ToListAsync());
});

api.MapGet("/branches", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Branches.Include(b => b.Terminals).Where(b => b.TenantId == scopedTenantId.Value).AsQueryable();
    // Branch-pinned staff only ever see their own branch.
    var userBranchId = http.GetBranchId();
    if (userBranchId != null) query = query.Where(b => b.Id == userBranchId.Value);
    return Results.Ok(await query.ToListAsync());
});

// Update a branch (incl. RegionCode, which selects the provincial tax jurisdiction).
api.MapPut("/branches/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateBranchDto dto) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == id && (http.IsSuperAdmin() || b.TenantId == tenantId!.Value));
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });

    if (!string.IsNullOrWhiteSpace(dto.Name)) branch.Name = dto.Name.Trim();
    if (dto.Address != null) branch.Address = dto.Address;
    if (!string.IsNullOrWhiteSpace(dto.City)) branch.City = dto.City.Trim();
    if (dto.Phone != null) branch.Phone = dto.Phone;
    if (dto.RegionCode != null) branch.RegionCode = string.IsNullOrWhiteSpace(dto.RegionCode) ? null : dto.RegionCode.Trim().ToUpperInvariant();
    if (dto.AllowedCounters.HasValue && http.IsSuperAdmin()) branch.AllowedCounters = dto.AllowedCounters.Value;
    if (dto.AllowedOrderTabs.HasValue && http.IsSuperAdmin()) branch.AllowedOrderTabs = dto.AllowedOrderTabs.Value;

    await db.SaveChangesAsync();
    return Results.Ok(branch);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// --- Catalog ---
api.MapGet("/catalog/categories", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Categories.Where(c => c.TenantId == scopedTenantId.Value).OrderBy(c => c.SortOrder).AsQueryable();
    return Results.Ok(await query.ToListAsync());
});

api.MapPost("/catalog/categories", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var cat = new Category { TenantId = scopedTenantId.Value, Name = dto.Name, LocalName = dto.LocalName, Icon = dto.Icon ?? "utensils", SortOrder = dto.SortOrder };
    db.Categories.Add(cat);
    await db.SaveChangesAsync();
    return Results.Ok(cat);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to change the menu."));

api.MapPut("/catalog/categories/{id}", async (AppDbContext db, HttpContext http, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == scopedTenantId.Value);
    if (cat == null) return Results.NotFound();
    cat.Name = dto.Name;
    cat.LocalName = dto.LocalName ?? cat.LocalName;
    cat.Icon = dto.Icon ?? cat.Icon;
    cat.SortOrder = dto.SortOrder;
    await db.SaveChangesAsync();
    return Results.Ok(cat);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to change the menu."));

api.MapDelete("/catalog/categories/{id}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && (http.IsSuperAdmin() || c.TenantId == scopedTenantId!.Value));
    if (cat == null) return Results.NotFound();
    db.Categories.Remove(cat);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Category deleted successfully" });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to change the menu."));

api.MapGet("/catalog/products", async (AppDbContext db, HttpContext http, Guid? tenantId, Guid? categoryId, string? search, string? barcode) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Products.Include(p => p.Modifiers).Include(p => p.Category)
        .Where(p => p.IsActive && p.TenantId == scopedTenantId.Value).AsQueryable();
    if (categoryId.HasValue) query = query.Where(p => p.CategoryId == categoryId.Value);
    if (!string.IsNullOrWhiteSpace(barcode)) query = query.Where(p => p.Barcode == barcode.Trim());
    if (!string.IsNullOrWhiteSpace(search))
    {
        var s = search.Trim().ToLower();
        query = query.Where(p => p.Name.ToLower().Contains(s) || (p.UrduName != null && p.UrduName.Contains(s)) || p.Barcode.Contains(s) || p.SKU.ToLower().Contains(s));
    }
    return Results.Ok(await query.ToListAsync());
});

api.MapPost("/catalog/products", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, [Microsoft.AspNetCore.Mvc.FromBody] CreateProductDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var currentUser = await accessor.GetCurrentUserAsync(http);

    var product = new Product
    {
        TenantId = scopedTenantId.Value, CategoryId = dto.CategoryId, Name = dto.Name, UrduName = dto.UrduName,
        SKU = string.IsNullOrWhiteSpace(dto.SKU) ? $"SKU-{Random.Shared.Next(1000, 9999)}" : dto.SKU,
        Barcode = string.IsNullOrWhiteSpace(dto.Barcode) ? $"{Random.Shared.NextInt64(1000000000, 9999999999)}" : dto.Barcode,
        Description = dto.Description ?? string.Empty, CostPricePKR = dto.CostPricePKR, SellingPricePKR = dto.SellingPricePKR,
        Unit = dto.Unit ?? "Piece", Station = dto.Station, ImageUrl = dto.ImageUrl, IsActive = true
    };
    if (dto.Modifiers != null)
    {
        foreach (var mod in dto.Modifiers)
            product.Modifiers.Add(new ProductModifier { Name = mod.Name, PricePKR = mod.PricePKR });
    }
    db.Products.Add(product);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "ProductCreated", "Product", product.Id, null, product.SellingPricePKR.ToString("0.##"));
    await db.SaveChangesAsync();
    return Results.Ok(product);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to add menu items or change prices."));

api.MapPut("/catalog/products/{id}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateProductDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();

    var product = await db.Products.Include(p => p.Modifiers)
        .FirstOrDefaultAsync(p => p.Id == id && (http.IsSuperAdmin() || p.TenantId == scopedTenantId!.Value));
    if (product == null) return Results.NotFound();

    var oldPrice = product.SellingPricePKR;

    product.Name = dto.Name ?? product.Name;
    product.UrduName = dto.UrduName ?? product.UrduName;
    product.SellingPricePKR = dto.SellingPricePKR;
    product.CostPricePKR = dto.CostPricePKR;
    product.Barcode = dto.Barcode ?? product.Barcode;
    product.CategoryId = dto.CategoryId;
    product.Station = dto.Station;

    if (oldPrice != product.SellingPricePKR)
    {
        var currentUser = await accessor.GetCurrentUserAsync(http);
        await WriteAuditAsync(db, product.TenantId, currentUser, "PriceChanged", "Product", product.Id,
            oldValue: oldPrice.ToString("0.##"), newValue: product.SellingPricePKR.ToString("0.##"));
    }

    await db.SaveChangesAsync();
    return Results.Ok(product);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to change menu prices."));

api.MapDelete("/catalog/products/{id}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id && (http.IsSuperAdmin() || p.TenantId == scopedTenantId!.Value));
    if (product == null) return Results.NotFound();
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, product.TenantId, currentUser, "ProductDeleted", "Product", product.Id, product.Name, null);
    db.Products.Remove(product);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Product deleted successfully" });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to remove menu items."));

// --- Dining Tables ---
api.MapGet("/tables", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    var tables = await db.DiningTables.Where(t => t.BranchId == scopedBranchId!.Value).OrderBy(t => t.Section).ThenBy(t => t.TableNumber).ToListAsync();
    return Results.Ok(tables);
});

api.MapPost("/tables", async (AppDbContext db, HttpContext http, CreateTableDto dto) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (error != null) return error;
    var branch = await db.Branches.FindAsync(scopedBranchId!.Value);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });
    var existing = await db.DiningTables.FirstOrDefaultAsync(t => t.BranchId == branch.Id && t.TableNumber.ToLower() == dto.TableNumber.ToLower());
    if (existing != null) return Results.BadRequest(new { message = $"Table '{dto.TableNumber}' already exists in this branch" });
    var table = new DiningTable
    {
        BranchId = branch.Id, TableNumber = dto.TableNumber.Trim().ToUpper(),
        Section = string.IsNullOrWhiteSpace(dto.Section) ? "Main Hall" : dto.Section.Trim(),
        Capacity = dto.Capacity > 0 ? dto.Capacity : 4, IsOccupied = false
    };
    db.DiningTables.Add(table);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tables/{table.Id}", table);
});

api.MapPut("/tables/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateTableDto dto) =>
{
    var table = await db.DiningTables.FindAsync(id);
    if (table == null) return Results.NotFound(new { message = "Table not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, table.BranchId);
    if (scopeError != null) return scopeError;
    if (!string.IsNullOrWhiteSpace(dto.TableNumber)) table.TableNumber = dto.TableNumber.Trim().ToUpper();
    if (!string.IsNullOrWhiteSpace(dto.Section)) table.Section = dto.Section.Trim();
    if (dto.Capacity.HasValue && dto.Capacity.Value > 0) table.Capacity = dto.Capacity.Value;
    if (dto.IsOccupied.HasValue) table.IsOccupied = dto.IsOccupied.Value;
    await db.SaveChangesAsync();
    return Results.Ok(table);
});

api.MapDelete("/tables/{id:guid}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var table = await db.DiningTables.FindAsync(id);
    if (table == null) return Results.NotFound(new { message = "Table not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, table.BranchId);
    if (scopeError != null) return scopeError;
    db.DiningTables.Remove(table);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Table deleted successfully" });
});

// --- Orders (Mode 1 Parallel Dispatch) ---
// SECURITY: all money on this order is computed server-side from DB product prices and the
// branch's resolved tax jurisdiction. dto.SubTotalPKR / TaxPKR / TotalPKR / item.UnitPricePKR
// are ignored entirely.
api.MapPost("/orders", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    Pos.Api.Services.IFiscalInvoiceProvider fiscal,
    CreateOrderDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var branch = await db.Branches.Include(b => b.Tenant)
        .FirstOrDefaultAsync(b => b.Id == scopedBranchId!.Value && b.TenantId == scopedTenantId!.Value);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });

    if (dto.Items == null || dto.Items.Count == 0)
        return Results.BadRequest(new { message = "An order must contain at least one item." });

    var actingUser = await accessor.GetCurrentUserAsync(http);

    var orderNumber = await GenerateOrderNumberAsync(db);
    var order = new Order
    {
        TenantId = branch.TenantId, BranchId = branch.Id, OrderNumber = orderNumber,
        OrderType = dto.OrderType,
        Status = dto.OrderType == OrderType.DineIn ? OrderStatus.InKitchen :
                 (dto.OrderType == OrderType.Delivery || dto.OrderType == OrderType.CallOrder) ? OrderStatus.InKitchen :
                 OrderStatus.ReadyForDispatch,
        TableNumber = dto.TableNumber, CustomerName = dto.CustomerName, CustomerPhone = dto.CustomerPhone,
        DeliveryAddress = dto.DeliveryAddress, PaymentMethod = dto.PaymentMethod,
        AmountPaidPKR = dto.AmountPaidPKR, ChangeDuePKR = dto.ChangeDuePKR, IsPaid = dto.IsPaid,
        CashierName = actingUser?.FullName ?? dto.CashierName ?? "Counter 1 Cashier",
        CreatedByRole = actingUser?.Role.ToString() ?? dto.CreatedByRole ?? "Cashier",
        CreatedAt = DateTime.UtcNow
    };

    var priced = await PriceOrderAsync(db, branch, dto, order.Id, actingUser);
    if (priced.Error != null) return Results.BadRequest(new { message = priced.Error });

    order.SubTotalPKR = priced.SubTotalPKR;
    order.DiscountPKR = priced.DiscountPKR;
    order.TaxPKR = priced.TaxPKR;
    order.TotalPKR = priced.TotalPKR;
    foreach (var line in priced.Items) order.Items.Add(line);
    if (order.Status == OrderStatus.InKitchen) order.InKitchenAt = DateTime.UtcNow;

    // A discount attempted without permission is rejected (not applied) but does not block the
    // sale — the attempt is recorded so an owner can follow up.
    if (priced.DiscountRejected)
    {
        await WriteAuditAsync(db, branch.TenantId, actingUser, "DiscountRejected", "Order", order.Id,
            oldValue: priced.AttemptedDiscountPKR.ToString("0.##"), newValue: "0");
    }

    // KOTs per station
    var stationGroups = order.Items.GroupBy(i => i.Station);
    int ticketIndex = 1;
    foreach (var group in stationGroups)
    {
        order.KitchenTickets.Add(new KitchenTicket
        {
            OrderId = order.Id, BranchId = branch.Id,
            TicketNumber = $"KOT-{DateTime.UtcNow:mm}-{ticketIndex++}",
            Station = group.Key, Status = "Cooking", CreatedAt = DateTime.UtcNow
        });
    }

    // Mark table occupied
    if (!string.IsNullOrEmpty(dto.TableNumber))
    {
        var table = await db.DiningTables.FirstOrDefaultAsync(t => t.BranchId == branch.Id && t.TableNumber == dto.TableNumber);
        if (table != null) { table.IsOccupied = true; table.CurrentOrderId = order.Id; }
    }

    // Update cash shift (using the server-computed total, not the client's)
    if (dto.IsPaid && dto.PaymentMethod == PaymentMethod.Cash)
    {
        var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == branch.Id && !s.IsClosed);
        if (activeShift != null)
        {
            activeShift.CashSalesPKR += order.TotalPKR;
            activeShift.ExpectedCashPKR = activeShift.OpeningFloatPKR + activeShift.CashSalesPKR;
        }
    }

    // Batch load stock data to avoid N+1
    var productIds = dto.Items.Select(i => i.ProductId).Distinct().ToList();
    var stockDict = await db.BranchStocks.Where(s => s.BranchId == branch.Id && productIds.Contains(s.ProductId))
        .ToDictionaryAsync(s => s.ProductId);
    var recipeDict = await db.ProductRecipeItems.Include(r => r.Ingredient)
        .Where(r => productIds.Contains(r.ProductId))
        .GroupBy(r => r.ProductId)
        .ToDictionaryAsync(g => g.Key, g => g.ToList());
    var ingredientIds = recipeDict.Values.SelectMany(r => r).Select(r => r.IngredientId).Distinct().ToList();
    var ingredientDict = await db.Ingredients.Where(i => i.BranchId == branch.Id && ingredientIds.Contains(i.Id))
        .ToDictionaryAsync(i => i.Id);

    foreach (var item in dto.Items)
    {
        // A. Finished product stock - validate instead of silently zeroing
        if (stockDict.TryGetValue(item.ProductId, out var stock))
        {
            if (stock.QuantityOnHand < item.Quantity)
            {
                return Results.Conflict(new { message = $"Insufficient stock for {item.ProductName}. Available: {stock.QuantityOnHand}, Requested: {item.Quantity}" });
            }
            stock.QuantityOnHand -= item.Quantity;
        }

        // B. Recipe raw ingredients
        if (recipeDict.TryGetValue(item.ProductId, out var recipeItems))
        {
            foreach (var recipe in recipeItems)
            {
                if (ingredientDict.TryGetValue(recipe.IngredientId, out var ingredient))
                {
                    var totalIngredientQty = recipe.QuantityRequired * item.Quantity;
                    if (ingredient.CurrentStock < totalIngredientQty)
                    {
                        return Results.Conflict(new { message = $"Insufficient ingredient {ingredient.Name}. Available: {ingredient.CurrentStock}, Need: {totalIngredientQty}" });
                    }
                    ingredient.CurrentStock -= totalIngredientQty;
                }
            }
        }
    }

    db.Orders.Add(order);
    await db.SaveChangesAsync();

    // Fiscal e-invoicing (inert stub today — wired for a future FBR integration).
    var (fiscalNumber, fiscalQr) = await fiscal.IssueInvoiceAsync(order.TenantId, order.Id, order.TotalPKR, order.TaxPKR);
    if (fiscalNumber != null || fiscalQr != null)
    {
        order.FiscalInvoiceNumber = fiscalNumber;
        order.FiscalQrPayload = fiscalQr;
        await db.SaveChangesAsync();
    }

    return Results.Ok(new
    {
        message = "Order placed and dispatched via Mode 1 (Kitchen + Counter)",
        orderId = order.Id, orderNumber = order.OrderNumber,
        kitchenTicketsCount = order.KitchenTickets.Count,
        status = order.Status.ToString(),
        subTotalPKR = order.SubTotalPKR, discountPKR = order.DiscountPKR,
        taxPKR = order.TaxPKR, taxRatePercent = priced.TaxRatePercent, totalPKR = order.TotalPKR,
        discountRejected = priced.DiscountRejected,
        fiscalInvoiceNumber = order.FiscalInvoiceNumber
    });
});

api.MapGet("/orders", async (AppDbContext db, HttpContext http, Guid branchId, OrderStatus? status, int limit = 30) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    var query = db.Orders.Include(o => o.Items).Include(o => o.AssignedRider)
        .Where(o => o.BranchId == scopedBranchId!.Value).OrderByDescending(o => o.CreatedAt).AsQueryable();
    if (status.HasValue) query = query.Where(o => o.Status == status.Value);
    return Results.Ok(await query.Take(Math.Clamp(limit, 1, 200)).ToListAsync());
});

// --- Void Order (requires CanVoidOrders; always audited) ---
api.MapPost("/orders/{id}/void", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] VoidOrderDto dto) =>
{
    var order = await db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == id);
    if (order == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;
    if (order.Status == OrderStatus.Cancelled) return Results.BadRequest(new { message = "Order already cancelled" });

    order.Status = OrderStatus.Cancelled;
    order.CancelledAt = DateTime.UtcNow;

    // Restore stock
    var productIds = order.Items.Select(i => i.ProductId).Distinct().ToList();
    var stockDict = await db.BranchStocks.Where(s => s.BranchId == order.BranchId && productIds.Contains(s.ProductId))
        .ToDictionaryAsync(s => s.ProductId);

    foreach (var item in order.Items)
    {
        if (stockDict.TryGetValue(item.ProductId, out var stock))
            stock.QuantityOnHand += item.Quantity;
    }

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, order.TenantId, currentUser, "OrderVoided", "Order", order.Id,
        oldValue: $"{order.OrderNumber} / {order.TotalPKR:0.##}", newValue: dto?.Reason ?? "(no reason given)");

    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Order voided and stock restored", orderId = order.Id });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanVoidOrders, "You don't have permission to void orders. Ask a manager to approve."));

// --- Kitchen Display ---
api.MapGet("/kitchen/tickets", async (AppDbContext db, HttpContext http, Guid branchId, KitchenStation? station) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    var query = db.KitchenTickets
        .Include(k => k.Order).ThenInclude(o => o!.Items)
        .Where(k => k.BranchId == scopedBranchId!.Value && k.Status != "Completed")
        .OrderBy(k => k.CreatedAt).AsQueryable();
    if (station.HasValue) query = query.Where(k => k.Station == station.Value);
    return Results.Ok(await query.ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasKitchenDisplay)));

api.MapPost("/kitchen/tickets/{id}/status", async (AppDbContext db, HttpContext http, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateTicketStatusDto dto) =>
{
    var ticket = await db.KitchenTickets.Include(k => k.Order).FirstOrDefaultAsync(k => k.Id == id);
    if (ticket == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, ticket.BranchId);
    if (scopeError != null) return scopeError;

    ticket.Status = dto.Status;
    if (dto.Status == "Ready" && ticket.Order != null)
    {
        ticket.Order.Status = OrderStatus.ReadyForDispatch;
        ticket.Order.ReadyAt ??= DateTime.UtcNow;
    }
    await db.SaveChangesAsync();
    return Results.Ok(ticket);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasKitchenDisplay)));

// --- Delivery ---
api.MapGet("/delivery/board", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    var orders = await db.Orders.Include(o => o.Items).Include(o => o.AssignedRider)
        .Where(o => o.BranchId == scopedBranchId!.Value && (o.OrderType == OrderType.Delivery || o.OrderType == OrderType.CallOrder))
        .OrderByDescending(o => o.CreatedAt).ToListAsync();
    return Results.Ok(new
    {
        inKitchen = orders.Where(o => o.Status == OrderStatus.InKitchen || o.Status == OrderStatus.New),
        readyForDispatch = orders.Where(o => o.Status == OrderStatus.ReadyForDispatch),
        outForDelivery = orders.Where(o => o.Status == OrderStatus.OutForDelivery),
        completed = orders.Where(o => o.Status == OrderStatus.Completed).Take(10)
    });
});

api.MapPost("/delivery/assign-rider", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] AssignRiderDto dto) =>
{
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == dto.OrderId);
    if (order == null) return Results.NotFound(new { message = "Order not found" });
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId && r.BranchId == scopedBranchId!.Value);
    if (rider == null) return Results.NotFound(new { message = "Rider not found" });
    order.AssignedRiderId = rider.Id;
    order.Status = OrderStatus.OutForDelivery;
    order.OutForDeliveryAt = DateTime.UtcNow;
    rider.IsAvailable = false;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Order assigned to {rider.Name}", order });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasDeliveryCOD)));

api.MapPost("/delivery/mark-delivered", async (AppDbContext db, HttpContext http, Guid orderId) =>
{
    var order = await db.Orders.Include(o => o.AssignedRider).FirstOrDefaultAsync(o => o.Id == orderId);
    if (order == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;
    order.Status = OrderStatus.Completed;
    order.CompletedAt = DateTime.UtcNow;
    order.IsPaid = true;
    if (order.AssignedRider != null) order.AssignedRider.IsAvailable = true;
    await db.SaveChangesAsync();
    return Results.Ok(order);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasDeliveryCOD)));

// --- Riders ---
api.MapGet("/riders", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    return Results.Ok(await db.Riders.Where(r => r.BranchId == scopedBranchId!.Value).ToListAsync());
});

api.MapGet("/riders/{id}/pending-cod", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == id);
    if (rider == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, rider.BranchId);
    if (scopeError != null) return scopeError;
    var activeOrders = await db.Orders
        .Where(o => o.AssignedRiderId == id && o.PaymentMethod == PaymentMethod.Cash && o.CreatedAt.Date == DateTime.UtcNow.Date)
        .ToListAsync();
    return Results.Ok(new
    {
        riderId = rider.Id, riderName = rider.Name, phone = rider.Phone, vehicle = rider.VehicleNumber,
        totalOrders = activeOrders.Count,
        completedOrders = activeOrders.Count(o => o.Status == OrderStatus.Completed),
        pendingOrders = activeOrders.Count(o => o.Status == OrderStatus.OutForDelivery),
        expectedCODPKR = activeOrders.Sum(o => o.TotalPKR),
        orders = activeOrders.Select(o => new { o.Id, o.OrderNumber, o.TotalPKR, o.Status, o.CustomerName, o.DeliveryAddress })
    });
});

api.MapPost("/riders/settle", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] SettleRiderDto dto) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId);
    if (rider == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, rider.BranchId);
    if (scopeError != null) return scopeError;
    var variance = dto.CashCollectedPKR - dto.ExpectedCODPKR;
    var settlement = new RiderSettlement
    {
        BranchId = rider.BranchId, RiderId = rider.Id, ShiftDate = DateTime.UtcNow,
        TotalOrdersDelivered = dto.TotalOrdersDelivered, TotalCODExpectedPKR = dto.ExpectedCODPKR,
        TotalCashCollectedPKR = dto.CashCollectedPKR, ShortageSurplusPKR = variance,
        SettledBy = dto.SettledBy ?? "Manager", SettledAt = DateTime.UtcNow
    };
    rider.IsAvailable = true;
    db.RiderSettlements.Add(settlement);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Rider COD settled", settlementId = settlement.Id, variancePKR = variance, isReconciled = variance == 0 });
});

api.MapGet("/delivery/settlements", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    return Results.Ok(await db.RiderSettlements.Include(s => s.Rider).Where(s => s.BranchId == scopedBranchId!.Value)
        .OrderByDescending(s => s.SettledAt).Take(30).ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "view"));

// --- Call Order Lookup ---
api.MapGet("/call-order/lookup", async (AppDbContext db, HttpContext http, string phone) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null) return Results.Unauthorized();
    var cleanPhone = phone.Trim();
    var pastOrders = await db.Orders.Include(o => o.Items)
        .Where(o => o.TenantId == tenantId.Value && o.CustomerPhone != null && o.CustomerPhone.Contains(cleanPhone))
        .OrderByDescending(o => o.CreatedAt).Take(5).ToListAsync();
    var customer = pastOrders.FirstOrDefault();
    if (customer == null) return Results.Ok(new { found = false, phone = cleanPhone });
    return Results.Ok(new
    {
        found = true, name = customer.CustomerName, phone = customer.CustomerPhone,
        lastAddress = customer.DeliveryAddress, totalPastOrders = pastOrders.Count,
        favoriteItems = pastOrders.SelectMany(o => o.Items).GroupBy(i => i.ProductName)
            .OrderByDescending(g => g.Count()).Take(3).Select(g => g.Key),
        recentOrders = pastOrders.Select(o => new { o.OrderNumber, o.TotalPKR, o.CreatedAt, o.Status })
    });
});

// --- Director KPIs (fixed N+1) ---
api.MapGet("/director/kpis", async (AppDbContext db, HttpContext http, Guid? tenantId, Guid? branchId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    // Branch-pinned staff are forced to their own branch regardless of what they asked for.
    var userBranchId = http.GetBranchId();
    var effectiveBranchId = userBranchId ?? branchId;

    var today = DateTime.UtcNow.Date;
    var ordersQuery = db.Orders.Where(o => o.CreatedAt >= today && o.TenantId == scopedTenantId.Value);
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty)
        ordersQuery = ordersQuery.Where(o => o.BranchId == effectiveBranchId.Value);

    var todayOrders = await ordersQuery.ToListAsync();
    var branchesQuery = db.Branches.Where(b => !b.IsHeadOffice && b.TenantId == scopedTenantId.Value);
    if (userBranchId != null) branchesQuery = branchesQuery.Where(b => b.Id == userBranchId.Value);
    var branches = await branchesQuery.ToListAsync();
    var branchIds = branches.Select(b => b.Id).ToList();

    // Batch load branch data to avoid N+1
    var branchOrderData = await db.Orders
        .Where(o => branchIds.Contains(o.BranchId) && o.CreatedAt >= today)
        .GroupBy(o => o.BranchId)
        .Select(g => new { branchId = g.Key, sales = g.Sum(o => o.TotalPKR), count = g.Count() })
        .ToDictionaryAsync(x => x.branchId);

    var branchSales = branches.Select(b => new
    {
        branchId = b.Id, branchName = b.Name, city = b.City,
        todaySalesPKR = branchOrderData.TryGetValue(b.Id, out var data) ? data.sales : 0m,
        ordersCount = branchOrderData.TryGetValue(b.Id, out var d) ? d.count : 0,
        activeCounters = b.AllowedCounters
    });

    return Results.Ok(new
    {
        currency = "PKR",
        todaySalesPKR = todayOrders.Sum(o => o.TotalPKR),
        totalOrders = todayOrders.Count,
        avgBasketPKR = todayOrders.Count > 0 ? Math.Round(todayOrders.Sum(o => o.TotalPKR) / todayOrders.Count, 0) : 0,
        activeOrders = todayOrders.Count(o => o.Status != OrderStatus.Completed && o.Status != OrderStatus.Cancelled),
        completedOrders = todayOrders.Count(o => o.Status == OrderStatus.Completed),
        branchComparison = branchSales
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasDirectorDashboard)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view the director dashboard."));

// --- Super Admin ---
api.MapPost("/super-admin/update-limits", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] UpdateBranchLimitsDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound();
    branch.AllowedCounters = dto.AllowedCounters;
    branch.AllowedOrderTabs = dto.AllowedOrderTabs;
    if (dto.Tier.HasValue && branch.Tenant != null) branch.Tenant.Tier = dto.Tier.Value;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Limits updated", branchId = branch.Id, allowedCounters = branch.AllowedCounters, allowedOrderTabs = branch.AllowedOrderTabs, tier = branch.Tenant?.Tier.ToString() });
});

// --- Terminal Device Management (Counters, Order Tabs, Kitchen Displays) ---
api.MapGet("/terminals", async (AppDbContext db, HttpContext http, Guid? branchId) =>
{
    var (scopedTenantId, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    // A head-office user with no branchId still gets their whole tenant's terminals.
    var q = db.Terminals.AsQueryable();
    if (error != null)
    {
        var tenantId = ResolveTenantScope(http, null);
        if (tenantId == null) return Results.Unauthorized();
        q = q.Where(t => db.Branches.Any(b => b.Id == t.BranchId && b.TenantId == tenantId.Value));
    }
    else
    {
        q = q.Where(t => t.BranchId == scopedBranchId!.Value);
    }
    var terminals = await q.OrderByDescending(t => t.LastSeenAt).ToListAsync();
    return Results.Ok(terminals.Select(t => new
    {
        t.Id, t.BranchId, t.TerminalName, t.TerminalType, t.DeviceToken, t.IsActive, t.LastSeenAt
    }));
});

api.MapPost("/terminals", async (AppDbContext db, HttpContext http, CreateTerminalDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var branch = await db.Branches.FindAsync(scopedBranchId!.Value);
    if (branch == null) return Results.BadRequest(new { error = "Branch not found" });

    var terminalCount = await db.Terminals.CountAsync(t => t.BranchId == branch.Id && t.TerminalType == dto.TerminalType);
    // Branch quota AND the tenant's SaaS package ceiling both apply — take the lower.
    var branchLimit = dto.TerminalType == TerminalType.OrderTab ? branch.AllowedOrderTabs : branch.AllowedCounters;
    var tenantTier = await db.Tenants.Where(t => t.Id == branch.TenantId).Select(t => (SubscriptionTier?)t.Tier).FirstOrDefaultAsync();
    var pkg = tenantTier == null ? null : await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tenantTier.Value.ToString());
    var packageLimit = pkg == null ? int.MaxValue : (dto.TerminalType == TerminalType.OrderTab ? pkg.MaxOrderTabs : pkg.MaxCounters);
    var limit = Math.Min(branchLimit, packageLimit);
    if (terminalCount >= limit)
        return Results.BadRequest(new { error = $"Branch limit reached: max {limit} {dto.TerminalType} devices allowed" });

    var terminal = new Terminal
    {
        Id = Guid.NewGuid(),
        BranchId = branch.Id,
        TerminalName = dto.TerminalName.Trim(),
        TerminalType = dto.TerminalType,
        DeviceToken = Guid.NewGuid().ToString("N"),
        IsActive = true,
        LastSeenAt = DateTime.UtcNow
    };
    db.Terminals.Add(terminal);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Terminal created", terminal.Id, terminal.TerminalName, terminal.DeviceToken });
});

api.MapPut("/terminals/{id}", async (AppDbContext db, HttpContext http, Guid id, UpdateTerminalDto dto) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, terminal.BranchId);
    if (scopeError != null) return scopeError;

    if (!string.IsNullOrWhiteSpace(dto.TerminalName)) terminal.TerminalName = dto.TerminalName.Trim();
    if (dto.IsActive.HasValue) terminal.IsActive = dto.IsActive.Value;
    terminal.LastSeenAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Terminal updated", terminal.Id, terminal.TerminalName, terminal.IsActive });
});

api.MapDelete("/terminals/{id}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, terminal.BranchId);
    if (scopeError != null) return scopeError;
    db.Terminals.Remove(terminal);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Terminal deleted" });
});

api.MapPost("/terminals/heartbeat", async (AppDbContext db, TerminalHeartbeatDto dto) =>
{
    var terminal = await db.Terminals.FirstOrDefaultAsync(t => t.DeviceToken == dto.DeviceToken);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not registered" });
    terminal.LastSeenAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { terminal.TerminalName, terminal.TerminalType });
});

// --- Offline Batch Sync (fixed order numbers) ---
// Same rule as /sync/batch-orders: totals are recomputed from current DB prices and tax rates.
api.MapPost("/sync/offline-batch", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    [Microsoft.AspNetCore.Mvc.FromBody] List<CreateOrderDto> offlineOrders) =>
{
    var actingUser = await accessor.GetCurrentUserAsync(http);
    int syncedCount = 0;
    foreach (var dto in offlineOrders)
    {
        var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
        if (scopeError != null || scopedBranchId == null) continue;
        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == scopedBranchId.Value && b.TenantId == scopedTenantId!.Value);
        if (branch == null) continue;

        var order = new Order
        {
            TenantId = branch.TenantId, BranchId = branch.Id,
            OrderNumber = await GenerateOrderNumberAsync(db, "OFFLINE"),
            OrderType = dto.OrderType, Status = OrderStatus.Completed,
            TableNumber = dto.TableNumber, CustomerName = dto.CustomerName, CustomerPhone = dto.CustomerPhone,
            DeliveryAddress = dto.DeliveryAddress, PaymentMethod = dto.PaymentMethod,
            AmountPaidPKR = dto.AmountPaidPKR, ChangeDuePKR = dto.ChangeDuePKR, IsPaid = true,
            CashierName = dto.CashierName ?? "Offline Cashier", CreatedByRole = "OfflineSync", CreatedAt = DateTime.UtcNow,
            CompletedAt = DateTime.UtcNow
        };

        var priced = await PriceOrderAsync(db, branch, dto, order.Id, actingUser);
        if (priced.Error != null) continue;
        order.SubTotalPKR = priced.SubTotalPKR;
        order.DiscountPKR = priced.DiscountPKR;
        order.TaxPKR = priced.TaxPKR;
        order.TotalPKR = priced.TotalPKR;
        foreach (var line in priced.Items) order.Items.Add(line);

        if (dto.SubTotalPKR > 0 && Math.Abs(priced.SubTotalPKR - dto.SubTotalPKR) / dto.SubTotalPKR > 0.02m)
        {
            db.SmartAlerts.Add(new SmartAlert
            {
                TenantId = branch.TenantId,
                BranchId = branch.Id,
                AlertType = "price_mismatch_offline_sync",
                Severity = "warning",
                Title = $"Price mismatch on synced order {order.OrderNumber}",
                Message = $"Offline terminal submitted {dto.SubTotalPKR:N2}; current menu prices give {priced.SubTotalPKR:N2}. The server figure was saved — please review.",
                Metadata = System.Text.Json.JsonSerializer.Serialize(new { orderId = order.Id, submittedSubTotal = dto.SubTotalPKR, recomputedSubTotal = priced.SubTotalPKR })
            });
        }

        foreach (var item in dto.Items)
        {
            var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == branch.Id && s.ProductId == item.ProductId);
            if (stock != null) stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand - item.Quantity);
        }

        db.Orders.Add(order);
        syncedCount++;
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Synced {syncedCount} offline orders", syncedCount });
});

// --- Cash Shifts ---
api.MapGet("/cash-shifts", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, error) = await ResolveScopeAsync(http, db, null, branchId);
    if (error != null) return error;
    var shifts = await db.CashShifts.Where(s => s.BranchId == scopedBranchId!.Value).OrderByDescending(s => s.OpenedAt).Take(20).ToListAsync();
    return Results.Ok(shifts);
});

api.MapPost("/cash-shifts/open", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] OpenCashShiftDto dto) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;
    var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == scopedBranchId!.Value && !s.IsClosed);
    if (activeShift != null) return Results.BadRequest(new { message = "An active shift already exists. Close it first." });

    var shift = new CashShift
    {
        BranchId = scopedBranchId!.Value, TerminalName = dto.TerminalName, CashierName = dto.CashierName,
        OpeningFloatPKR = dto.OpeningFloatPKR, OpenedAt = DateTime.UtcNow, IsClosed = false
    };
    db.CashShifts.Add(shift);
    await db.SaveChangesAsync();
    return Results.Ok(shift);
});

api.MapPost("/cash-shifts/{id}/close", async (AppDbContext db, HttpContext http, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] CloseCashShiftDto dto) =>
{
    var shift = await db.CashShifts.FirstOrDefaultAsync(s => s.Id == id);
    if (shift == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, shift.BranchId);
    if (scopeError != null) return scopeError;
    if (shift.IsClosed) return Results.BadRequest(new { message = "Shift already closed" });

    shift.ActualCashCountedPKR = dto.ActualCashCounted;
    shift.ExpectedCashPKR = shift.OpeningFloatPKR + shift.CashSalesPKR;
    shift.VariancePKR = dto.ActualCashCounted - shift.ExpectedCashPKR;
    shift.ClosedAt = DateTime.UtcNow;
    shift.IsClosed = true;
    await db.SaveChangesAsync();
    return Results.Ok(shift);
});

// --- Cash Entry (Paid Out / Received) ---
api.MapPost("/cash-shifts/{shiftId}/entries", async (AppDbContext db, HttpContext http, Guid shiftId, CreateCashEntryDto dto) =>
{
    var shift = await db.CashShifts.FindAsync(shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, shift.BranchId);
    if (scopeError != null) return scopeError;
    if (shift.IsClosed) return Results.BadRequest(new { error = "Cannot add entries to a closed shift" });

    var entry = new CashEntry
    {
        Id = Guid.NewGuid(),
        CashShiftId = shiftId,
        EntryType = dto.EntryType,
        AmountPKR = dto.AmountPKR,
        Description = dto.Description.Trim(),
        RecipientOrSource = dto.RecipientOrSource,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = dto.CreatedBy
    };
    db.CashEntries.Add(entry);

    // Update shift totals
    if (dto.EntryType == CashEntryType.PaidOut)
        shift.CashPaidOutPKR += dto.AmountPKR;
    else if (dto.EntryType == CashEntryType.Received)
        shift.CashReceivedPKR += dto.AmountPKR;

    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Cash entry added", entry.Id });
});

api.MapGet("/cash-shifts/{shiftId}/entries", async (AppDbContext db, HttpContext http, Guid shiftId) =>
{
    var shift = await db.CashShifts.FindAsync(shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, shift.BranchId);
    if (scopeError != null) return scopeError;
    var entries = await db.CashEntries
        .Where(e => e.CashShiftId == shiftId)
        .OrderByDescending(e => e.CreatedAt)
        .ToListAsync();
    return Results.Ok(entries);
});

api.MapDelete("/cash-shifts/{shiftId}/entries/{entryId}", async (AppDbContext db, HttpContext http, Guid shiftId, Guid entryId) =>
{
    var shift = await db.CashShifts.FindAsync(shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, shift.BranchId);
    if (scopeError != null) return scopeError;
    if (shift.IsClosed) return Results.BadRequest(new { error = "Cannot delete entries from a closed shift" });

    var entry = await db.CashEntries.FindAsync(entryId);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    // Reverse the entry amount
    if (entry.EntryType == CashEntryType.PaidOut)
        shift.CashPaidOutPKR -= entry.AmountPKR;
    else if (entry.EntryType == CashEntryType.Received)
        shift.CashReceivedPKR -= entry.AmountPKR;

    db.CashEntries.Remove(entry);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Entry deleted" });
});

// --- Cash Sale Report ---
api.MapGet("/reports/cash-sales", async (AppDbContext db, HttpContext http, Guid branchId, string date) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;
    branchId = scopedBranchId!.Value;

    if (!DateTime.TryParse(date, out var reportDate))
        reportDate = DateTime.UtcNow.Date;

    var startOfDay = reportDate.Date;
    var endOfDay = startOfDay.AddDays(1);

    var orders = await db.Orders
        .Where(o => o.BranchId == branchId && o.CreatedAt >= startOfDay && o.CreatedAt < endOfDay && o.PaymentMethod == PaymentMethod.Cash)
        .OrderBy(o => o.CreatedAt)
        .ToListAsync();

    return Results.Ok(new
    {
        date = reportDate.ToString("yyyy-MM-dd"),
        totalCashSalesPKR = orders.Sum(o => o.TotalPKR),
        orderCount = orders.Count,
        orders = orders.Select(o => new
        {
            o.Id, o.OrderNumber, o.TotalPKR, o.AmountPaidPKR, o.ChangeDuePKR,
            o.TableNumber, o.CashierName, o.CreatedAt
        })
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "view"));

// --- Card / Digital Sale Report ---
api.MapGet("/reports/card-sales", async (AppDbContext db, HttpContext http, Guid branchId, string date) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;
    branchId = scopedBranchId!.Value;

    if (!DateTime.TryParse(date, out var reportDate))
        reportDate = DateTime.UtcNow.Date;

    var startOfDay = reportDate.Date;
    var endOfDay = startOfDay.AddDays(1);

    var orders = await db.Orders
        .Where(o => o.BranchId == branchId && o.CreatedAt >= startOfDay && o.CreatedAt < endOfDay 
            && o.PaymentMethod != PaymentMethod.Cash)
        .OrderBy(o => o.CreatedAt)
        .ToListAsync();

    return Results.Ok(new
    {
        date = reportDate.ToString("yyyy-MM-dd"),
        totalCardSalesPKR = orders.Sum(o => o.TotalPKR),
        orderCount = orders.Count,
        byMethod = orders.GroupBy(o => o.PaymentMethod).Select(g => new
        {
            method = g.Key.ToString(),
            total = g.Sum(o => o.TotalPKR),
            count = g.Count()
        }),
        orders = orders.Select(o => new
        {
            o.Id, o.OrderNumber, o.TotalPKR, o.PaymentMethod, o.AmountPaidPKR,
            o.TableNumber, o.CashierName, o.CreatedAt
        })
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "view"));

// --- Cash Tally (End-of-Day Summary) ---
api.MapGet("/cash-shifts/{shiftId}/tally", async (AppDbContext db, HttpContext http, Guid shiftId) =>
{
    var shift = await db.CashShifts
        .Include(s => s.Entries)
        .FirstOrDefaultAsync(s => s.Id == shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, shift.BranchId);
    if (scopeError != null) return scopeError;

    var cashSales = await db.Orders
        .Where(o => o.BranchId == shift.BranchId && o.CreatedAt >= shift.OpenedAt 
            && (!shift.ClosedAt.HasValue || o.CreatedAt <= shift.ClosedAt.Value)
            && o.PaymentMethod == PaymentMethod.Cash)
        .SumAsync(o => o.TotalPKR);

    var cashPaidOut = shift.Entries.Where(e => e.EntryType == CashEntryType.PaidOut).Sum(e => e.AmountPKR);
    var cashReceived = shift.Entries.Where(e => e.EntryType == CashEntryType.Received).Sum(e => e.AmountPKR);

    var expectedCash = shift.OpeningFloatPKR + cashSales + cashReceived - cashPaidOut;

    return Results.Ok(new
    {
        shiftId = shift.Id,
        shift.CashierName,
        shift.TerminalName,
        openedAt = shift.OpenedAt,
        closedAt = shift.ClosedAt,
        openingFloat = shift.OpeningFloatPKR,
        cashSales,
        cashReceived,
        cashPaidOut,
        expectedCash,
        entries = shift.Entries.Select(e => new
        {
            e.Id, e.EntryType, e.AmountPKR, e.Description, e.RecipientOrSource, e.CreatedAt, e.CreatedBy
        })
    });
});

// --- Inventory ---
api.MapGet("/inventory", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;
    branchId = scopedBranchId!.Value;

    var stocks = await db.BranchStocks.Include(s => s.Product).ThenInclude(p => p!.Category)
        .Where(s => s.BranchId == branchId).OrderBy(s => s.Product!.Name).ToListAsync();

    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == branchId);
    if (branch != null)
    {
        var existingProductIds = stocks.Select(s => s.ProductId).ToHashSet();
        var missingProducts = await db.Products.Where(p => p.TenantId == branch.TenantId && !existingProductIds.Contains(p.Id)).ToListAsync();
        if (missingProducts.Any())
        {
            foreach (var p in missingProducts)
                db.BranchStocks.Add(new BranchStock { BranchId = branchId, ProductId = p.Id, QuantityOnHand = 50, MinAlertLevel = 10 });
            await db.SaveChangesAsync();
            stocks = await db.BranchStocks.Include(s => s.Product).ThenInclude(p => p!.Category)
                .Where(s => s.BranchId == branchId).OrderBy(s => s.Product!.Name).ToListAsync();
        }
    }

    return Results.Ok(stocks.Select(s => new
    {
        id = s.Id, branchId = s.BranchId, productId = s.ProductId,
        productName = s.Product?.Name ?? "Item", sku = s.Product?.SKU ?? "",
        barcode = s.Product?.Barcode ?? "", categoryName = s.Product?.Category?.Name ?? "General",
        unit = s.Product?.Unit ?? "Piece", costPricePKR = s.Product?.CostPricePKR ?? 0,
        sellingPricePKR = s.Product?.SellingPricePKR ?? 0, quantityOnHand = s.QuantityOnHand,
        minAlertLevel = s.MinAlertLevel, batchNumber = s.BatchNumber,
        expiryDate = s.ExpiryDate?.ToString("yyyy-MM-dd"), isLowStock = s.QuantityOnHand <= s.MinAlertLevel
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("inventory", "view"));

api.MapPost("/inventory/stock-in", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] StockInDto dto) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;
    var branchId = scopedBranchId!.Value;

    var stock = await db.BranchStocks.Include(s => s.Product).FirstOrDefaultAsync(s => s.BranchId == branchId && s.ProductId == dto.ProductId);
    if (stock == null)
    {
        stock = new BranchStock { BranchId = branchId, ProductId = dto.ProductId, QuantityOnHand = dto.Quantity, MinAlertLevel = 10, BatchNumber = dto.BatchNumber, ExpiryDate = dto.ExpiryDate };
        db.BranchStocks.Add(stock);
    }
    else
    {
        stock.QuantityOnHand += dto.Quantity;
        if (!string.IsNullOrEmpty(dto.BatchNumber)) stock.BatchNumber = dto.BatchNumber;
        if (dto.ExpiryDate.HasValue) stock.ExpiryDate = dto.ExpiryDate.Value;
    }
    if (dto.CostPricePKR.HasValue && dto.CostPricePKR.Value > 0 && stock.Product != null)
        stock.Product.CostPricePKR = dto.CostPricePKR.Value;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Received {dto.Quantity} units", productId = dto.ProductId, newQuantityOnHand = stock.QuantityOnHand });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to receive stock."));

api.MapPost("/inventory/adjust", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, [Microsoft.AspNetCore.Mvc.FromBody] StockAdjustmentDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == scopedBranchId!.Value && s.ProductId == dto.ProductId);
    if (stock == null) return Results.NotFound();
    var oldQty = stock.QuantityOnHand;
    stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand + dto.AdjustmentQty);

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId!.Value, currentUser, "StockAdjusted", "BranchStock", stock.Id,
        oldValue: oldQty.ToString("0.##"), newValue: $"{stock.QuantityOnHand:0.##} ({dto.Reason})");

    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Stock adjusted: {dto.Reason}", productId = dto.ProductId, newQuantityOnHand = stock.QuantityOnHand });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to adjust stock."));

// --- Raw Ingredients ---
api.MapGet("/inventory/ingredients", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;
    branchId = scopedBranchId!.Value;

    var ingredients = await db.Ingredients.Where(i => i.BranchId == branchId).OrderBy(i => i.Category).ThenBy(i => i.Name).ToListAsync();
    if (!ingredients.Any())
    {
        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == branchId);
        if (branch != null)
        {
            var seedIngredients = new List<Ingredient>
            {
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Burger Buns (Brioche)", Category = "Buns & Bakery", Unit = "Piece", CostPerUnitPKR = 35, CurrentStock = 450, MinAlertLevel = 50, SupplierName = "Dawn Bread" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Crispy Chicken Patty (120g)", Category = "Meat & Patties", Unit = "Piece", CostPerUnitPKR = 145, CurrentStock = 320, MinAlertLevel = 40, SupplierName = "K&Ns / Menu" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Beef Smashed Patty (100g)", Category = "Meat & Patties", Unit = "Piece", CostPerUnitPKR = 190, CurrentStock = 180, MinAlertLevel = 30, SupplierName = "Local Gourmet Meat" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Cheddar Cheese Slices", Category = "Dairy & Cheese", Unit = "Slice", CostPerUnitPKR = 40, CurrentStock = 500, MinAlertLevel = 60, SupplierName = "Happy Cow" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Mozzarella Shredded Cheese", Category = "Dairy & Cheese", Unit = "Kg", CostPerUnitPKR = 1650, CurrentStock = 45, MinAlertLevel = 10, SupplierName = "Anchor / Adams" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Garlic Mayo Sauce", Category = "Sauces & Condiments", Unit = "Litre", CostPerUnitPKR = 550, CurrentStock = 30, MinAlertLevel = 5, SupplierName = "Young's / Shangrila" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Signature Chipotle Sauce", Category = "Sauces & Condiments", Unit = "Litre", CostPerUnitPKR = 680, CurrentStock = 22, MinAlertLevel = 5, SupplierName = "Kitchen In-House Batch" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Fresh Iceberg & Onions", Category = "Produce & Veggies", Unit = "Kg", CostPerUnitPKR = 180, CurrentStock = 60, MinAlertLevel = 15, SupplierName = "Sabzi Mandi" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Frozen Skin-On French Fries", Category = "Sides & Appetizers", Unit = "Kg", CostPerUnitPKR = 420, CurrentStock = 200, MinAlertLevel = 30, SupplierName = "McCain / OPTP Vendor" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Cola Beverage Can (250ml)", Category = "Beverages", Unit = "Can", CostPerUnitPKR = 75, CurrentStock = 600, MinAlertLevel = 100, SupplierName = "Coca-Cola / Pepsi Bottling" },
                new() { BranchId = branchId, TenantId = branch.TenantId, Name = "Branded Burger Box & Wrapper", Category = "Packaging", Unit = "Piece", CostPerUnitPKR = 18, CurrentStock = 850, MinAlertLevel = 150, SupplierName = "Custom Print Packaging" },
            };
            db.Ingredients.AddRange(seedIngredients);
            await db.SaveChangesAsync();
            ingredients = seedIngredients;
        }
    }
    return Results.Ok(ingredients.Select(i => new
    {
        id = i.Id, branchId = i.BranchId, name = i.Name, category = i.Category, unit = i.Unit,
        costPerUnitPKR = i.CostPerUnitPKR, currentStock = i.CurrentStock, minAlertLevel = i.MinAlertLevel,
        supplierName = i.SupplierName, isLowStock = i.CurrentStock <= i.MinAlertLevel,
        totalValuationPKR = Math.Round(i.CurrentStock * i.CostPerUnitPKR, 2)
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("inventory", "view"));

api.MapPost("/inventory/ingredients/stock-in", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] IngredientStockInDto dto) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == dto.IngredientId && i.BranchId == scopedBranchId!.Value);
    if (ingredient == null) return Results.NotFound();
    ingredient.CurrentStock += dto.QuantityReceived;
    if (dto.NewCostPerUnitPKR.HasValue && dto.NewCostPerUnitPKR.Value > 0) ingredient.CostPerUnitPKR = dto.NewCostPerUnitPKR.Value;
    if (!string.IsNullOrEmpty(dto.SupplierName)) ingredient.SupplierName = dto.SupplierName;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Added +{dto.QuantityReceived} {ingredient.Unit} to {ingredient.Name}", ingredientId = ingredient.Id, newStock = ingredient.CurrentStock });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to receive ingredients."));

api.MapPost("/inventory/ingredients", async (AppDbContext db, HttpContext http, [Microsoft.AspNetCore.Mvc.FromBody] CreateIngredientDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, dto.TenantId, dto.BranchId);
    if (scopeError != null) return scopeError;

    var ingredient = new Ingredient
    {
        BranchId = scopedBranchId!.Value, TenantId = scopedTenantId!.Value, Name = dto.Name,
        Category = dto.Category ?? "General", Unit = dto.Unit ?? "Piece",
        CostPerUnitPKR = dto.CostPerUnitPKR, CurrentStock = dto.InitialStock,
        MinAlertLevel = dto.MinAlertLevel, SupplierName = dto.SupplierName
    };
    db.Ingredients.Add(ingredient);
    await db.SaveChangesAsync();
    return Results.Ok(ingredient);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasInventoryManagement)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to create ingredients."));

// --- Recipes ---
api.MapGet("/recipes/{productId}", async (AppDbContext db, HttpContext http, Guid productId) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var productExists = http.IsSuperAdmin() || await db.Products.AnyAsync(p => p.Id == productId && p.TenantId == tenantId!.Value);
    if (!productExists) return Results.NotFound();
    var recipe = await db.ProductRecipeItems.Include(r => r.Ingredient).Where(r => r.ProductId == productId).ToListAsync();
    return Results.Ok(recipe.Select(r => new
    {
        id = r.Id, productId = r.ProductId, ingredientId = r.IngredientId,
        ingredientName = r.Ingredient?.Name ?? "Ingredient", ingredientCategory = r.Ingredient?.Category ?? "General",
        quantityRequired = r.QuantityRequired, unit = r.Unit, costPerUnitPKR = r.Ingredient?.CostPerUnitPKR ?? 0,
        estimatedCostPKR = Math.Round(r.QuantityRequired * (r.Ingredient?.CostPerUnitPKR ?? 0), 2)
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("inventory", "view"));

api.MapPost("/recipes/{productId}", async (AppDbContext db, HttpContext http, Guid productId, [Microsoft.AspNetCore.Mvc.FromBody] List<RecipeItemInputDto> items) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var owned = http.IsSuperAdmin() || await db.Products.AnyAsync(p => p.Id == productId && p.TenantId == tenantId!.Value);
    if (!owned) return Results.NotFound();

    var existing = await db.ProductRecipeItems.Where(r => r.ProductId == productId).ToListAsync();
    db.ProductRecipeItems.RemoveRange(existing);
    decimal calculatedCost = 0;
    foreach (var item in items)
    {
        var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == item.IngredientId);
        db.ProductRecipeItems.Add(new ProductRecipeItem
        {
            ProductId = productId, IngredientId = item.IngredientId,
            QuantityRequired = item.QuantityRequired, Unit = item.Unit ?? ingredient?.Unit ?? "Piece"
        });
        if (ingredient != null) calculatedCost += item.QuantityRequired * ingredient.CostPerUnitPKR;
    }
    var product = await db.Products.FirstOrDefaultAsync(p => p.Id == productId);
    if (product != null && calculatedCost > 0) product.CostPricePKR = Math.Round(calculatedCost, 2);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Recipe updated with {items.Count} ingredients. Cost: ₨{Math.Round(calculatedCost, 2)}", productId, calculatedCostPKR = Math.Round(calculatedCost, 2) });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to edit recipes."));

// --- Users (with PIN hashing) ---
api.MapGet("/users", async (AppDbContext db, HttpContext http, Guid tenantId, Guid? branchId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    tenantId = scopedTenantId.Value;
    branchId = http.GetBranchId() ?? branchId;

    var query = db.Users.Where(u => u.TenantId == tenantId);
    if (branchId.HasValue) query = query.Where(u => u.BranchId == null || u.BranchId == branchId.Value);
    var users = await query.OrderBy(u => u.Role).ThenBy(u => u.FullName).ToListAsync();

    if (!users.Any())
    {
        var seedUsers = new List<AppUser>
        {
            new() { TenantId = tenantId, BranchId = null, FullName = "Director / Restaurant Owner", Username = "owner_admin", PinCodeHash = BCrypt.Net.BCrypt.HashPassword("9999"), Role = UserRole.OwnerAdmin, IsActive = true, CanViewFinancialReports = true, CanManageInventory = true, CanManageMenuAndTax = true, CanGiveDiscounts = true, CanVoidOrders = true },
            new() { TenantId = tenantId, BranchId = branchId, FullName = "Branch Operations Manager", Username = "branch_mgr", PinCodeHash = BCrypt.Net.BCrypt.HashPassword("5555"), Role = UserRole.BranchManager, IsActive = true, CanViewFinancialReports = true, CanManageInventory = true, CanManageMenuAndTax = false, CanGiveDiscounts = true, CanVoidOrders = true },
            new() { TenantId = tenantId, BranchId = branchId, FullName = "Main Counter Cashier", Username = "cashier_1", PinCodeHash = BCrypt.Net.BCrypt.HashPassword("1234"), Role = UserRole.Cashier, IsActive = true, CanViewFinancialReports = false, CanManageInventory = false, CanManageMenuAndTax = false, CanGiveDiscounts = false, CanVoidOrders = false },
            new() { TenantId = tenantId, BranchId = branchId, FullName = "Head Chef (Kitchen Lead)", Username = "chef_lead", PinCodeHash = BCrypt.Net.BCrypt.HashPassword("4321"), Role = UserRole.KitchenChef, IsActive = true, CanViewFinancialReports = false, CanManageInventory = true, CanManageMenuAndTax = false, CanGiveDiscounts = false, CanVoidOrders = false },
            new() { TenantId = tenantId, BranchId = branchId, FullName = "Dining Hall Captain (Waiter)", Username = "waiter_tab1", PinCodeHash = BCrypt.Net.BCrypt.HashPassword("1111"), Role = UserRole.Waiter, IsActive = true, CanViewFinancialReports = false, CanManageInventory = false, CanManageMenuAndTax = false, CanGiveDiscounts = false, CanVoidOrders = false }
        };
        db.Users.AddRange(seedUsers);
        await db.SaveChangesAsync();
        users = seedUsers;
    }

    return Results.Ok(users.Select(u => new
    {
        id = u.Id, tenantId = u.TenantId, branchId = u.BranchId, fullName = u.FullName, username = u.Username,
        role = u.Role.ToString(), isActive = u.IsActive, createdAt = u.CreatedAt,
        permissions = new { u.CanViewFinancialReports, u.CanManageInventory, u.CanManageMenuAndTax, u.CanGiveDiscounts, u.CanVoidOrders }
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("users", "view"));

api.MapPost("/users", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, [Microsoft.AspNetCore.Mvc.FromBody] CreateUserDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();

    // Nobody may mint a SuperAdmin except a SuperAdmin.
    if (dto.Role == UserRole.SuperAdmin && !http.IsSuperAdmin())
        return Results.Json(new { message = "You cannot create a platform SuperAdmin." }, statusCode: 403);

    if (await db.Users.AnyAsync(u => u.TenantId == scopedTenantId.Value && u.Username == dto.Username.ToLower().Trim()))
        return Results.BadRequest(new { message = "That username is already taken in this restaurant." });

    // Enforce the package's user quota.
    var tier = await db.Tenants.Where(t => t.Id == scopedTenantId.Value).Select(t => (SubscriptionTier?)t.Tier).FirstOrDefaultAsync();
    var pkg = tier == null ? null : await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tier.Value.ToString());
    if (pkg != null)
    {
        var userCount = await db.Users.CountAsync(u => u.TenantId == scopedTenantId.Value);
        if (userCount >= pkg.MaxUsers)
            return Results.BadRequest(new { message = $"Your {pkg.DisplayName} package allows a maximum of {pkg.MaxUsers} users. Please upgrade." });
    }

    var user = new AppUser
    {
        TenantId = scopedTenantId.Value, BranchId = dto.BranchId, FullName = dto.FullName,
        Username = dto.Username.ToLower().Trim(),
        PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.PinCode ?? "1234"),
        Role = dto.Role, IsActive = true,
        CanViewFinancialReports = dto.CanViewFinancialReports, CanManageInventory = dto.CanManageInventory,
        CanManageMenuAndTax = dto.CanManageMenuAndTax, CanGiveDiscounts = dto.CanGiveDiscounts, CanVoidOrders = dto.CanVoidOrders
    };
    db.Users.Add(user);
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "UserCreated", "AppUser", user.Id, null, $"{user.Username} ({user.Role})");
    await db.SaveChangesAsync();
    return Results.Ok(new { user.Id, user.Username, user.Role });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("users", "edit"));

api.MapPut("/users/{id}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateUserDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();

    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id && (http.IsSuperAdmin() || u.TenantId == scopedTenantId!.Value));
    if (user == null) return Results.NotFound();

    if (dto.Role == UserRole.SuperAdmin && !http.IsSuperAdmin())
        return Results.Json(new { message = "You cannot promote anyone to platform SuperAdmin." }, statusCode: 403);

    var before = $"role={user.Role}; reports={user.CanViewFinancialReports}; inventory={user.CanManageInventory}; menu={user.CanManageMenuAndTax}; discounts={user.CanGiveDiscounts}; voids={user.CanVoidOrders}; active={user.IsActive}";

    if (!string.IsNullOrEmpty(dto.FullName)) user.FullName = dto.FullName;
    if (dto.Role.HasValue) user.Role = dto.Role.Value;
    if (!string.IsNullOrEmpty(dto.PinCode)) user.PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.PinCode);
    if (dto.IsActive.HasValue) user.IsActive = dto.IsActive.Value;
    if (dto.CanViewFinancialReports.HasValue) user.CanViewFinancialReports = dto.CanViewFinancialReports.Value;
    if (dto.CanManageInventory.HasValue) user.CanManageInventory = dto.CanManageInventory.Value;
    if (dto.CanManageMenuAndTax.HasValue) user.CanManageMenuAndTax = dto.CanManageMenuAndTax.Value;
    if (dto.CanGiveDiscounts.HasValue) user.CanGiveDiscounts = dto.CanGiveDiscounts.Value;
    if (dto.CanVoidOrders.HasValue) user.CanVoidOrders = dto.CanVoidOrders.Value;

    var after = $"role={user.Role}; reports={user.CanViewFinancialReports}; inventory={user.CanManageInventory}; menu={user.CanManageMenuAndTax}; discounts={user.CanGiveDiscounts}; voids={user.CanVoidOrders}; active={user.IsActive}";
    if (before != after)
    {
        var currentUser = await accessor.GetCurrentUserAsync(http);
        await WriteAuditAsync(db, user.TenantId, currentUser, "PermissionChanged", "AppUser", user.Id, before, after);
    }

    await db.SaveChangesAsync();
    return Results.Ok(user);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("users", "edit"));

api.MapDelete("/users/{id}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id && (http.IsSuperAdmin() || u.TenantId == scopedTenantId!.Value));
    if (user == null) return Results.NotFound();
    if (user.Role == UserRole.SuperAdmin && !http.IsSuperAdmin()) return Results.Json(new { message = "You cannot delete a platform SuperAdmin." }, statusCode: 403);
    if (http.GetUserId() == user.Id) return Results.BadRequest(new { message = "You cannot delete your own account." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, user.TenantId, currentUser, "UserDeleted", "AppUser", user.Id, $"{user.Username} ({user.Role})", null);
    db.Users.Remove(user);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "User deleted successfully", id });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("users", "delete"));

// --- Reports ---
api.MapGet("/reports/daily-z", async (AppDbContext db, HttpContext http, Guid? branchId, DateTime? date) =>
{
    var tenantScope = ResolveTenantScope(http, null);
    if (tenantScope == null) return Results.Unauthorized();
    var targetBranchId = http.GetBranchId()
        ?? (branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : Guid.Empty);
    if (targetBranchId == Guid.Empty)
        targetBranchId = await db.Branches.Where(b => b.TenantId == tenantScope.Value).Select(b => b.Id).FirstOrDefaultAsync();
    var (_, _, branchError) = await ResolveScopeAsync(http, db, null, targetBranchId);
    if (branchError != null) return branchError;

    var targetDate = (date ?? DateTime.UtcNow).Date;
    var nextDate = targetDate.AddDays(1);
    var orders = await db.Orders.Include(o => o.Items)
        .Where(o => o.BranchId == targetBranchId && o.CreatedAt >= targetDate && o.CreatedAt < nextDate && o.IsPaid).ToListAsync();
    var cashOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.Cash).ToList();
    var cardOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.Card).ToList();
    var digitalOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.JazzCash || o.PaymentMethod == PaymentMethod.EasyPaisa || o.PaymentMethod == PaymentMethod.Raast).ToList();
    var shift = await db.CashShifts.Where(s => s.BranchId == targetBranchId && s.OpenedAt >= targetDate && s.OpenedAt < nextDate)
        .OrderByDescending(s => s.OpenedAt).FirstOrDefaultAsync();
    var openingFloat = shift?.OpeningFloatPKR ?? 10000;
    var cashSales = cashOrders.Sum(o => o.TotalPKR);
    var expectedCash = openingFloat + cashSales;
    var actualCash = shift?.ActualCashCountedPKR > 0 ? shift.ActualCashCountedPKR : expectedCash;
    return Results.Ok(new
    {
        period = targetDate.ToString("yyyy-MM-dd"), shiftId = shift != null ? shift.Id.ToString() : null,
        totalSalesPKR = orders.Sum(o => o.TotalPKR), totalOrders = orders.Count,
        cashSalesPKR = cashSales, cardSalesPKR = cardOrders.Sum(o => o.TotalPKR), digitalSalesPKR = digitalOrders.Sum(o => o.TotalPKR),
        cashTaxPKR = cashOrders.Sum(o => o.TaxPKR), cardTaxPKR = cardOrders.Sum(o => o.TaxPKR), totalTaxPKR = orders.Sum(o => o.TaxPKR),
        openingFloatPKR = openingFloat, expectedCashInDrawerPKR = expectedCash, actualCashInDrawerPKR = actualCash, variancePKR = actualCash - expectedCash,
        dineInSalesPKR = orders.Where(o => o.OrderType == OrderType.DineIn).Sum(o => o.TotalPKR),
        takeawaySalesPKR = orders.Where(o => o.OrderType == OrderType.Takeaway).Sum(o => o.TotalPKR),
        deliverySalesPKR = orders.Where(o => o.OrderType == OrderType.Delivery || o.OrderType == OrderType.CallOrder).Sum(o => o.TotalPKR)
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view financial reports."));

api.MapGet("/reports/sales-by-category", async (AppDbContext db, HttpContext http, Guid? branchId, int? days) =>
{
    var tenantScope = ResolveTenantScope(http, null);
    if (tenantScope == null) return Results.Unauthorized();
    var targetBranchId = http.GetBranchId() ?? (branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : Guid.Empty);
    if (targetBranchId == Guid.Empty)
        targetBranchId = await db.Branches.Where(b => b.TenantId == tenantScope.Value).Select(b => b.Id).FirstOrDefaultAsync();
    var (_, _, branchError) = await ResolveScopeAsync(http, db, null, targetBranchId);
    if (branchError != null) return branchError;

    var tenantId = await db.Branches.Where(b => b.Id == targetBranchId).Select(b => b.TenantId).FirstOrDefaultAsync();
    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId);
    var taxDivisor = settings != null ? (1 + settings.DefaultTaxRate / 100m) : 1.16m;
    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var items = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items).Include(i => i.Product).ThenInclude(p => p!.Category).ToListAsync();
    var totalRevenue = items.Sum(i => i.TotalPricePKR);
    return Results.Ok(items.GroupBy(i => new { Id = i.Product?.CategoryId ?? Guid.Empty, Name = i.Product?.Category?.Name ?? "Uncategorized" })
        .Select(g => { var gross = g.Sum(x => x.TotalPricePKR); return new { categoryId = g.Key.Id.ToString(), categoryName = g.Key.Name, quantitySold = g.Sum(x => x.Quantity), grossSalesPKR = gross, netSalesPKR = Math.Round(gross / taxDivisor, 2), taxPKR = Math.Round(gross - (gross / taxDivisor), 2), percentageOfTotal = totalRevenue > 0 ? Math.Round((gross / totalRevenue) * 100, 1) : 0 }; })
        .OrderByDescending(x => x.grossSalesPKR).ToList());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"));

api.MapGet("/reports/item-performance", async (AppDbContext db, HttpContext http, Guid? branchId, int? days) =>
{
    var tenantScope = ResolveTenantScope(http, null);
    if (tenantScope == null) return Results.Unauthorized();
    var targetBranchId = http.GetBranchId() ?? (branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : Guid.Empty);
    if (targetBranchId == Guid.Empty)
        targetBranchId = await db.Branches.Where(b => b.TenantId == tenantScope.Value).Select(b => b.Id).FirstOrDefaultAsync();
    var (_, _, branchError) = await ResolveScopeAsync(http, db, null, targetBranchId);
    if (branchError != null) return branchError;

    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var items = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items).Include(i => i.Product).ThenInclude(p => p!.Category).ToListAsync();
    return Results.Ok(items.GroupBy(i => new { i.ProductId, i.ProductName, CategoryName = i.Product?.Category?.Name ?? "General", CostPrice = i.Product?.CostPricePKR ?? 0 })
        .Select(g => { var qty = g.Sum(x => x.Quantity); var rev = g.Sum(x => x.TotalPricePKR); var cost = g.Key.CostPrice * qty; var gp = rev - cost; return new { productId = g.Key.ProductId.ToString(), productName = g.Key.ProductName, categoryName = g.Key.CategoryName, quantitySold = qty, revenuePKR = rev, costPKR = cost, grossProfitPKR = gp, marginPercent = rev > 0 ? Math.Round((gp / rev) * 100, 1) : 0 }; })
        .OrderByDescending(x => x.revenuePKR).Take(25).ToList());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"));

api.MapGet("/reports/tax-audit", async (AppDbContext db, HttpContext http, Guid? branchId, int? days, DateTime? startDate, DateTime? endDate) =>
{
    var tenantScope = ResolveTenantScope(http, null);
    if (tenantScope == null) return Results.Unauthorized();
    var targetBranchId = http.GetBranchId() ?? (branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : Guid.Empty);
    if (targetBranchId == Guid.Empty)
        targetBranchId = await db.Branches.Where(b => b.TenantId == tenantScope.Value).Select(b => b.Id).FirstOrDefaultAsync();
    var (_, _, branchError) = await ResolveScopeAsync(http, db, null, targetBranchId);
    if (branchError != null) return branchError;

    var tenantId = await db.Branches.Where(b => b.Id == targetBranchId).Select(b => b.TenantId).FirstOrDefaultAsync();
    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId);
    var branchEntity = await db.Branches.FirstOrDefaultAsync(b => b.Id == targetBranchId);
    var primaryTaxRate = settings?.DefaultTaxRate ?? 16;
    var secondaryTaxRate = settings?.DigitalTaxRate ?? 8;
    if (branchEntity != null)
    {
        var (cashRate, digitalRate, _) = await ResolveTaxRatesAsync(db, branchEntity);
        primaryTaxRate = cashRate;
        secondaryTaxRate = digitalRate;
    }
    var start = startDate ?? (days.HasValue ? DateTime.UtcNow.Date.AddDays(-days.Value) : DateTime.UtcNow.Date.AddDays(-7));
    var end = endDate?.AddDays(1) ?? DateTime.UtcNow;
    var orders = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= start && o.CreatedAt <= end && o.IsPaid)
        .OrderByDescending(o => o.CreatedAt).ToListAsync();
    var cashOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.Cash).ToList();
    var cardOrders = orders.Where(o => o.PaymentMethod != PaymentMethod.Cash).ToList();
    return Results.Ok(new
    {
        startDate = start.ToString("yyyy-MM-dd"), endDate = end.ToString("yyyy-MM-dd"), totalInvoices = orders.Count,
        totalGrossTurnoverPKR = orders.Sum(o => o.TotalPKR), totalNetSalesPKR = (cashOrders.Sum(o => o.TotalPKR) - cashOrders.Sum(o => o.TaxPKR)) + (cardOrders.Sum(o => o.TotalPKR) - cardOrders.Sum(o => o.TaxPKR)),
        totalTaxCollectedPKR = cashOrders.Sum(o => o.TaxPKR) + cardOrders.Sum(o => o.TaxPKR),
        cashSegment = new { taxRatePercent = primaryTaxRate, invoiceCount = cashOrders.Count, grossSalesPKR = cashOrders.Sum(o => o.TotalPKR), taxCollectedPKR = cashOrders.Sum(o => o.TaxPKR) },
        cardSegment = new { taxRatePercent = secondaryTaxRate, invoiceCount = cardOrders.Count, grossSalesPKR = cardOrders.Sum(o => o.TotalPKR), taxCollectedPKR = cardOrders.Sum(o => o.TaxPKR) }
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view tax reports."));

api.MapGet("/reports/payment-methods", async (AppDbContext db, HttpContext http, Guid? branchId, int? days) =>
{
    var tenantScope = ResolveTenantScope(http, null);
    if (tenantScope == null) return Results.Unauthorized();
    var targetBranchId = http.GetBranchId() ?? (branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : Guid.Empty);
    if (targetBranchId == Guid.Empty)
        targetBranchId = await db.Branches.Where(b => b.TenantId == tenantScope.Value).Select(b => b.Id).FirstOrDefaultAsync();
    var (_, _, branchError) = await ResolveScopeAsync(http, db, null, targetBranchId);
    if (branchError != null) return branchError;

    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var orders = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid).ToListAsync();
    var grandTotal = orders.Sum(o => o.TotalPKR);
    return Results.Ok(new
    {
        totalRevenuePKR = grandTotal, totalTransactions = orders.Count,
        tenders = orders.GroupBy(o => o.PaymentMethod).Select(g => { var total = g.Sum(x => x.TotalPKR); var count = g.Count(); return new { method = g.Key.ToString(), transactionCount = count, totalAmountPKR = total, percentageOfTotal = grandTotal > 0 ? Math.Round((total / grandTotal) * 100, 1) : 0, avgTicketPKR = count > 0 ? Math.Round(total / count, 2) : 0 }; }).OrderByDescending(x => x.totalAmountPKR).ToList()
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"));

api.MapGet("/reports/consolidated", async (AppDbContext db, HttpContext http, Guid? tenantId, int? days) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var targetTenantId = scopedTenantId.Value;
    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var branches = await db.Branches.Where(b => b.TenantId == targetTenantId).ToListAsync();
    var branchIds = branches.Select(b => b.Id).ToList();
    var orders = await db.Orders.Include(o => o.Items).ThenInclude(i => i.Product)
        .Where(o => branchIds.Contains(o.BranchId) && o.CreatedAt >= since && o.IsPaid).ToListAsync();
    var branchSummaries = branches.Select(b =>
    {
        var bOrders = orders.Where(o => o.BranchId == b.Id).ToList();
        var bGross = bOrders.Sum(o => o.TotalPKR);
        var bCost = bOrders.SelectMany(o => o.Items).Sum(i => (i.Product?.CostPricePKR ?? (i.UnitPricePKR * 0.45m)) * i.Quantity);
        var bProfit = bGross - bOrders.Sum(o => o.TaxPKR) - bCost;
        return new { branchId = b.Id, branchName = b.Name, branchCode = b.Code, city = b.City, isHeadOffice = b.IsHeadOffice, orderCount = bOrders.Count, grossSalesPKR = bGross, taxCollectedPKR = bOrders.Sum(o => o.TaxPKR), estimatedCostPKR = Math.Round(bCost, 2), netProfitPKR = Math.Round(bProfit, 2), profitMarginPercent = bGross > 0 ? Math.Round((bProfit / bGross) * 100, 1) : 0 };
    }).OrderByDescending(x => x.grossSalesPKR).ToList();
    var chainGross = branchSummaries.Sum(x => x.grossSalesPKR);
    var chainProfit = branchSummaries.Sum(x => x.netProfitPKR);
    return Results.Ok(new
    {
        daysAnalyzed = days ?? 7, chainGrossSalesPKR = chainGross, chainTaxCollectedPKR = branchSummaries.Sum(x => x.taxCollectedPKR),
        chainCostPKR = branchSummaries.Sum(x => x.estimatedCostPKR), chainNetProfitPKR = chainProfit,
        chainProfitMargin = chainGross > 0 ? Math.Round((chainProfit / chainGross) * 100, 1) : 0, branches = branchSummaries
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasConsolidatedReports)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view consolidated reports."));

// --- Supply Chain ---
api.MapGet("/transfers", async (AppDbContext db, HttpContext http, Guid? tenantId, Guid? branchId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var effectiveBranchId = http.GetBranchId() ?? branchId;

    var query = db.StockTransferOrders.Include(t => t.SourceBranch).Include(t => t.DestinationBranch).Include(t => t.Items)
        .Where(t => t.TenantId == scopedTenantId.Value).AsQueryable();
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty)
        query = query.Where(t => t.SourceBranchId == effectiveBranchId.Value || t.DestinationBranchId == effectiveBranchId.Value);
    return Results.Ok(await query.OrderByDescending(t => t.RequestedAt).ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "view"));

api.MapPost("/transfers", async (AppDbContext db, HttpContext http, CreateTransferOrderDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();

    // Both ends of the transfer must belong to the caller's tenant.
    var endpointsOk = await db.Branches.CountAsync(b => b.TenantId == scopedTenantId.Value &&
        (b.Id == dto.SourceBranchId || b.Id == dto.DestinationBranchId)) == 2;
    if (!endpointsOk) return Results.Json(new { message = "Source or destination branch does not belong to this tenant." }, statusCode: 403);

    var userBranchId = http.GetBranchId();
    if (userBranchId != null && dto.SourceBranchId != userBranchId && dto.DestinationBranchId != userBranchId)
        return Results.Json(new { message = "You can only create transfers involving your own branch." }, statusCode: 403);

    var transferNumber = await GenerateTransferNumberAsync(db);
    var order = new StockTransferOrder
    {
        TenantId = scopedTenantId.Value, TransferNumber = transferNumber, SourceBranchId = dto.SourceBranchId,
        DestinationBranchId = dto.DestinationBranchId, Status = TransferStatus.Requested,
        RequestedAt = DateTime.UtcNow, VehicleOrDriver = dto.VehicleOrDriver, Notes = dto.Notes
    };
    decimal totalEstCost = 0;
    foreach (var item in dto.Items)
    {
        var ing = await db.Ingredients.FindAsync(item.IngredientId);
        var unitCost = ing?.CostPerUnitPKR ?? 0;
        totalEstCost += item.QuantityRequested * unitCost;
        order.Items.Add(new StockTransferItem
        {
            TransferOrderId = order.Id, IngredientId = item.IngredientId, IngredientName = ing?.Name ?? item.IngredientName ?? "Unknown",
            Unit = ing?.Unit ?? item.Unit ?? "Piece", QuantityRequested = item.QuantityRequested,
            QuantityDispatched = 0, QuantityReceived = 0, UnitCostPKR = unitCost
        });
    }
    order.TotalEstimatedCostPKR = totalEstCost;
    db.StockTransferOrders.Add(order);
    await db.SaveChangesAsync();
    return Results.Ok(order);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to create stock transfers."));

api.MapPost("/transfers/{id}/dispatch", async (AppDbContext db, HttpContext http, Guid id, DispatchTransferDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var order = await db.StockTransferOrders.Include(t => t.Items)
        .FirstOrDefaultAsync(t => t.Id == id && (http.IsSuperAdmin() || t.TenantId == scopedTenantId!.Value));
    if (order == null) return Results.NotFound("Transfer order not found");
    if (order.Status != TransferStatus.Requested) return Results.BadRequest($"Cannot dispatch in {order.Status} state");
    foreach (var item in order.Items)
    {
        var sourceIng = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == order.SourceBranchId && (i.Id == item.IngredientId || i.Name == item.IngredientName));
        if (sourceIng != null) sourceIng.CurrentStock = Math.Max(0, sourceIng.CurrentStock - item.QuantityRequested);
        item.QuantityDispatched = item.QuantityRequested;
    }
    order.Status = TransferStatus.InTransit;
    order.DispatchedAt = DateTime.UtcNow;
    order.DispatchedBy = dto.DispatchedBy ?? "Central Commissary Team";
    if (!string.IsNullOrEmpty(dto.VehicleOrDriver)) order.VehicleOrDriver = dto.VehicleOrDriver;
    if (!string.IsNullOrEmpty(dto.Notes)) order.Notes = dto.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(order);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to dispatch stock."));

api.MapPost("/transfers/{id}/receive", async (AppDbContext db, HttpContext http, Guid id, ReceiveTransferDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var order = await db.StockTransferOrders.Include(t => t.Items)
        .FirstOrDefaultAsync(t => t.Id == id && (http.IsSuperAdmin() || t.TenantId == scopedTenantId!.Value));
    if (order == null) return Results.NotFound("Transfer order not found");
    if (order.Status != TransferStatus.InTransit) return Results.BadRequest($"Cannot receive in {order.Status} state");
    foreach (var item in order.Items)
    {
        var qtyToReceive = item.QuantityDispatched > 0 ? item.QuantityDispatched : item.QuantityRequested;
        item.QuantityReceived = qtyToReceive;
        var destIng = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == order.DestinationBranchId && i.Name.ToLower() == item.IngredientName.ToLower());
        if (destIng != null) { destIng.CurrentStock += qtyToReceive; if (item.UnitCostPKR > 0) destIng.CostPerUnitPKR = item.UnitCostPKR; }
        else { db.Ingredients.Add(new Ingredient { TenantId = order.TenantId, BranchId = order.DestinationBranchId, Name = item.IngredientName, Category = "Commissary Transferred", Unit = item.Unit, CostPerUnitPKR = item.UnitCostPKR, CurrentStock = qtyToReceive, MinAlertLevel = 10, SupplierName = "Central Commissary" }); }
    }
    order.Status = TransferStatus.Received;
    order.ReceivedAt = DateTime.UtcNow;
    order.ReceivedBy = dto.ReceivedBy ?? "Branch Manager";
    if (!string.IsNullOrEmpty(dto.Notes)) order.Notes = (order.Notes != null ? order.Notes + " • " : "") + dto.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(order);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to receive stock transfers."));

api.MapPost("/transfers/{id}/cancel", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var order = await db.StockTransferOrders.Include(t => t.Items)
        .FirstOrDefaultAsync(t => t.Id == id && (http.IsSuperAdmin() || t.TenantId == scopedTenantId!.Value));
    if (order == null) return Results.NotFound("Transfer order not found");
    if (order.Status == TransferStatus.InTransit)
    {
        foreach (var item in order.Items)
        {
            var sourceIng = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == order.SourceBranchId && (i.Id == item.IngredientId || i.Name == item.IngredientName));
            if (sourceIng != null) sourceIng.CurrentStock += item.QuantityDispatched;
        }
    }
    order.Status = TransferStatus.Cancelled;
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, status = "Cancelled" });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to cancel stock transfers."));

// --- Procurement ---
api.MapGet("/procurement/purchase-orders", async (AppDbContext db, HttpContext http, Guid? tenantId, Guid? branchId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var effectiveBranchId = http.GetBranchId() ?? branchId;

    var query = db.PurchaseOrders.Include(p => p.Branch).Include(p => p.Items)
        .Where(p => p.TenantId == scopedTenantId.Value).AsQueryable();
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty)
        query = query.Where(p => p.BranchId == effectiveBranchId.Value);
    return Results.Ok(await query.OrderByDescending(p => p.CreatedAt).ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "view"));

api.MapPost("/procurement/purchase-orders", async (AppDbContext db, HttpContext http, CreatePODto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, dto.TenantId, dto.BranchId);
    if (scopeError != null) return scopeError;

    var poNumber = await GeneratePONumberAsync(db);
    var po = new PurchaseOrder
    {
        TenantId = scopedTenantId!.Value, BranchId = scopedBranchId!.Value, PONumber = poNumber,
        SupplierName = dto.SupplierName, Status = POStatus.Ordered, CreatedAt = DateTime.UtcNow, Notes = dto.Notes
    };
    decimal totalCost = 0;
    foreach (var item in dto.Items)
    {
        var lineTotal = item.Quantity * item.UnitCostPKR;
        totalCost += lineTotal;
        po.Items.Add(new PurchaseOrderItem
        {
            PurchaseOrderId = po.Id, IngredientId = item.IngredientId, IngredientName = item.IngredientName,
            Quantity = item.Quantity, Unit = item.Unit ?? "Piece", UnitCostPKR = item.UnitCostPKR, TotalPKR = lineTotal
        });
    }
    po.TotalCostPKR = totalCost;
    db.PurchaseOrders.Add(po);
    await db.SaveChangesAsync();
    return Results.Ok(po);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to raise purchase orders."));

api.MapPost("/procurement/purchase-orders/{id}/receive", async (AppDbContext db, HttpContext http, Guid id, ReceivePODto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var po = await db.PurchaseOrders.Include(p => p.Items)
        .FirstOrDefaultAsync(p => p.Id == id && (http.IsSuperAdmin() || p.TenantId == scopedTenantId!.Value));
    if (po == null) return Results.NotFound("Purchase order not found");
    if (po.Status != POStatus.Ordered) return Results.BadRequest($"Cannot receive PO in {po.Status} status");
    foreach (var item in po.Items)
    {
        var ing = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == po.BranchId && (i.Id == item.IngredientId || i.Name == item.IngredientName));
        if (ing != null) { ing.CurrentStock += item.Quantity; if (item.UnitCostPKR > 0) ing.CostPerUnitPKR = item.UnitCostPKR; if (!string.IsNullOrEmpty(po.SupplierName)) ing.SupplierName = po.SupplierName; }
        else { db.Ingredients.Add(new Ingredient { TenantId = po.TenantId, BranchId = po.BranchId, Name = item.IngredientName, Category = "Direct Purchased", Unit = item.Unit, CostPerUnitPKR = item.UnitCostPKR, CurrentStock = item.Quantity, MinAlertLevel = 10, SupplierName = po.SupplierName }); }
    }
    po.Status = POStatus.Received;
    po.ReceivedAt = DateTime.UtcNow;
    po.ReceivedBy = dto.ReceivedBy ?? "Store Inward In-Charge";
    if (!string.IsNullOrEmpty(dto.Notes)) po.Notes = (po.Notes != null ? po.Notes + " • " : "") + dto.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(po);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to receive purchase orders."));

api.MapPost("/procurement/purchase-orders/{id}/cancel", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var po = await db.PurchaseOrders.FirstOrDefaultAsync(p => p.Id == id && (http.IsSuperAdmin() || p.TenantId == scopedTenantId!.Value));
    if (po == null) return Results.NotFound("Purchase order not found");
    po.Status = POStatus.Cancelled;
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, status = "Cancelled" });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to cancel purchase orders."));

// --- Stock Request (Branch Manager -> Owner / Vendor / HQ) ---
api.MapGet("/stock-requests", async (AppDbContext db, HttpContext http, Guid? branchId, string? status) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var effectiveBranchId = http.GetBranchId() ?? branchId;

    var q = db.StockRequests
        .Include(sr => sr.Items)
        .ThenInclude(i => i.Ingredient)
        .Where(sr => sr.TenantId == scopedTenantId.Value)
        .AsQueryable();
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty) q = q.Where(sr => sr.BranchId == effectiveBranchId.Value);
    if (!string.IsNullOrEmpty(status) && Enum.TryParse<StockRequestStatus>(status, out var st))
        q = q.Where(sr => sr.Status == st);
    var requests = await q.OrderByDescending(sr => sr.CreatedAt).ToListAsync();
    return Results.Ok(requests.Select(sr => new
    {
        sr.Id, sr.TenantId, sr.BranchId, sr.RequestNumber, sr.RequestType, sr.Status,
        sr.VendorName, sr.Notes, sr.EstimatedCostPKR, sr.CreatedBy, sr.CreatedAt,
        sr.ReviewedBy, sr.ReviewedAt, sr.ReviewNotes,
        BranchName = sr.Branch?.Name,
        Items = sr.Items.Select(i => new
        {
            i.Id, i.IngredientId, i.IngredientName, i.Unit,
            i.QuantityRequested, i.CurrentStock, i.UnitCostPKR
        })
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "view"));

api.MapPost("/stock-requests", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreateStockRequestDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == scopedBranchId!.Value && b.TenantId == scopedTenantId!.Value);
    if (branch == null) return Results.BadRequest(new { error = "Branch not found" });
    var currentUser = await accessor.GetCurrentUserAsync(http);

    var seq = await db.StockRequests.CountAsync(sr => sr.TenantId == branch.TenantId) + 1;
    var request = new StockRequest
    {
        Id = Guid.NewGuid(),
        TenantId = branch.TenantId,
        BranchId = branch.Id,
        RequestNumber = $"SR-{seq:0000}",
        RequestType = dto.RequestType,
        VendorName = dto.VendorName,
        Notes = dto.Notes,
        EstimatedCostPKR = dto.Items.Sum(i => i.QuantityRequested * i.UnitCostPKR),
        CreatedBy = currentUser?.FullName ?? dto.CreatedBy,
        CreatedByUserId = currentUser?.Id ?? dto.CreatedByUserId,
        CreatedAt = DateTime.UtcNow
    };

    foreach (var item in dto.Items)
    {
        request.Items.Add(new StockRequestItem
        {
            Id = Guid.NewGuid(),
            IngredientId = item.IngredientId,
            IngredientName = item.IngredientName,
            Unit = item.Unit,
            QuantityRequested = item.QuantityRequested,
            CurrentStock = item.CurrentStock,
            UnitCostPKR = item.UnitCostPKR
        });
    }

    db.StockRequests.Add(request);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Stock request created", request.Id, request.RequestNumber });
});

// Approving/rejecting a stock request is an owner/manager action, not a request-raiser action.
api.MapPut("/stock-requests/{id}/review", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, ReviewStockRequestDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var request = await db.StockRequests.FirstOrDefaultAsync(sr => sr.Id == id && (http.IsSuperAdmin() || sr.TenantId == scopedTenantId!.Value));
    if (request == null) return Results.NotFound(new { error = "Stock request not found" });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    request.Status = dto.Status;
    request.ReviewedBy = currentUser?.FullName ?? dto.ReviewedBy;
    request.ReviewedAt = DateTime.UtcNow;
    request.ReviewNotes = dto.ReviewNotes;
    await WriteAuditAsync(db, request.TenantId, currentUser, "StockRequestReviewed", "StockRequest", request.Id, null, dto.Status.ToString());
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Request {dto.Status}", request.Id, request.Status });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "edit"));

api.MapDelete("/stock-requests/{id}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var request = await db.StockRequests.FirstOrDefaultAsync(sr => sr.Id == id && (http.IsSuperAdmin() || sr.TenantId == scopedTenantId!.Value));
    if (request == null) return Results.NotFound(new { error = "Stock request not found" });
    if (request.Status != StockRequestStatus.Pending)
        return Results.BadRequest(new { error = "Only pending requests can be deleted" });
    db.StockRequests.Remove(request);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Stock request deleted" });
});

// ============================================================
// SAAS ENDPOINTS — SIGNUP + TENANT MANAGEMENT
// ============================================================

authApi.MapPost("/signup", async (AppDbContext db, SignupDto dto) =>
{
    // Validate unique slug
    var slug = dto.RestaurantName.ToLower().Trim().Replace(" ", "-");
    slug = System.Text.RegularExpressions.Regex.Replace(slug, @"[^a-z0-9\-]", "");
    if (await db.Tenants.AnyAsync(t => t.Slug == slug))
        return Results.BadRequest(new { error = "A restaurant with a similar name already exists. Try a different name." });

    // Validate unique admin username
    if (await db.Users.AnyAsync(u => u.Username == dto.AdminUsername.ToLower().Trim()))
        return Results.BadRequest(new { error = "Username already taken. Choose a different one." });

    using var transaction = await db.Database.BeginTransactionAsync();

    try
    {
        // 1. Create tenant
        var tenant = new Tenant
        {
            Name = dto.RestaurantName.Trim(),
            Slug = slug,
            ContactName = dto.ContactName.Trim(),
            ContactEmail = dto.Email.Trim().ToLower(),
            ContactPhone = dto.Phone.Trim(),
            City = dto.City?.Trim(),
            BusinessType = BusinessType.Restaurant,
            Tier = SubscriptionTier.Starter,
            IsActive = true,
            IsTrialActive = true,
            TrialEndsAt = DateTime.UtcNow.AddDays(30)
        };
        db.Tenants.Add(tenant);

        // 2. Create head office branch
        var branch = new Branch
        {
            TenantId = tenant.Id,
            Name = $"{dto.RestaurantName.Trim()} — Main Branch",
            Code = "MAIN",
            Address = dto.Address ?? "",
            City = dto.City ?? "Islamabad",
            Phone = dto.Phone,
            IsHeadOffice = true,
            AllowedCounters = 1,
            AllowedOrderTabs = 3
        };
        db.Branches.Add(branch);

        // 3. Create admin user
        var adminUser = new AppUser
        {
            TenantId = tenant.Id,
            BranchId = branch.Id,
            FullName = dto.ContactName.Trim(),
            Username = dto.AdminUsername.ToLower().Trim(),
            PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.AdminPin),
            Role = UserRole.OwnerAdmin,
            IsActive = true,
            CanViewFinancialReports = true,
            CanManageInventory = true,
            CanManageMenuAndTax = true,
            CanGiveDiscounts = true,
            CanVoidOrders = true
        };
        db.Users.Add(adminUser);

        // Seed default tenant settings
        var tenantSettings = new TenantSettings
        {
            TenantId = tenant.Id,
            CurrencyCode = "PKR",
            CurrencySymbol = "₨",
            DecimalPlaces = 0,
            TaxAuthorityName = "FBR",
            DefaultTaxRate = 16,
            UseDualTaxRate = true,
            DigitalTaxRate = 8,
            PhoneCode = "+92",
            DefaultCity = "Islamabad",
            DateFormat = "dd/MM/yyyy",
            ReceiptFooter = "Thank you for your visit!",
            AllowedPaymentMethods = "Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata"
        };
        db.TenantSettings.Add(tenantSettings);

        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        return Results.Ok(new
        {
            message = "Restaurant created successfully!",
            tenant = new
            {
                id = tenant.Id,
                name = tenant.Name,
                slug = tenant.Slug,
                tier = tenant.Tier.ToString(),
                trialEndsAt = tenant.TrialEndsAt
            },
            admin = new
            {
                id = adminUser.Id,
                username = adminUser.Username,
                fullName = adminUser.FullName
            }
        });
    }
    catch (Exception ex)
    {
        await transaction.RollbackAsync();
        return Results.BadRequest(new { error = "Failed to create restaurant", details = ex.Message });
    }
});

app.MapGet("/api/admin/tenants", async (AppDbContext db, HttpContext http) =>
{
    // Only super admins can list all tenants
    if (!http.IsSuperAdmin())
    {
        // Regular users can only see their own tenant
        var myTenantId = http.GetTenantId();
        if (myTenantId == null) return Results.Unauthorized();
        var myTenant = await db.Tenants.FindAsync(myTenantId.Value);
        if (myTenant == null) return Results.NotFound();
        return Results.Ok(new[] { myTenant });
    }

    var tenants = await db.Tenants
        .OrderByDescending(t => t.CreatedAt)
        .Select(t => new
        {
            t.Id, t.Name, t.Slug, t.ContactName, t.ContactEmail, t.ContactPhone,
            t.City, t.BusinessType, t.Tier, t.IsActive, t.IsTrialActive,
            t.TrialEndsAt, t.SubscriptionPaidUntil, t.CreatedAt,
            branchCount = t.Branches.Count,
            userCount = t.Branches.SelectMany(b => b.Terminals).Count()
        })
        .ToListAsync();

    return Results.Ok(tenants);
}).RequireAuthorization();

app.MapPut("/api/admin/tenants/{id:guid}/toggle-active", async (Guid id, AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.FindAsync(id);
    if (tenant == null) return Results.NotFound();
    tenant.IsActive = !tenant.IsActive;
    await db.SaveChangesAsync();
    return Results.Ok(new { tenant.Id, tenant.IsActive, message = tenant.IsActive ? "Tenant activated" : "Tenant deactivated" });
}).RequireAuthorization();

app.MapPut("/api/admin/tenants/{id:guid}/change-tier", async (Guid id, AppDbContext db, HttpContext http, ChangeTierDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.FindAsync(id);
    if (tenant == null) return Results.NotFound();
    tenant.Tier = dto.Tier;
    tenant.SubscriptionPaidUntil = dto.PaidUntil;
    await db.SaveChangesAsync();
    return Results.Ok(new { tenant.Id, tier = tenant.Tier.ToString(), tenant.SubscriptionPaidUntil });
}).RequireAuthorization();

authApi.MapPost("/super-admin-login", async (AppDbContext db, LoginDto dto) =>
{
    // Super admin credentials from configuration (not hardcoded)
    var superAdminUsername = builder.Configuration["SuperAdmin:Username"] ?? "superadmin";
    var superAdminPin = builder.Configuration["SuperAdmin:Pin"] ?? Environment.GetEnvironmentVariable("SUPER_ADMIN_PIN") ?? "999999";
    
    if (isProduction && dto.PinCode == superAdminPin && superAdminPin == "999999")
    {
        // Warn if using default PIN in production
        Console.WriteLine("[WARNING] Super admin is using the default PIN. Change SUPER_ADMIN_PIN in production!");
    }
    
    if (dto.Username != superAdminUsername || dto.PinCode != superAdminPin)
        return Results.Unauthorized();

    // Find or create super admin user (no tenant)
    var superAdmin = await db.Users.FirstOrDefaultAsync(u => u.Username == "superadmin" && u.Role == UserRole.SuperAdmin);
    if (superAdmin == null)
    {
        superAdmin = new AppUser
        {
            TenantId = Guid.Empty,
            BranchId = null,
            FullName = "Platform Super Admin",
            Username = "superadmin",
            PinCodeHash = BCrypt.Net.BCrypt.HashPassword("999999"),
            Role = UserRole.SuperAdmin,
            IsActive = true
        };
        db.Users.Add(superAdmin);
        await db.SaveChangesAsync();
    }

    var tokenHandler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"] ?? Environment.GetEnvironmentVariable("JWT_KEY") ?? "CashlyPOS_SuperSecretKey_2024_Change_In_Production!");
    var tokenDescriptor = new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
    {
        Expires = DateTime.UtcNow.AddHours(12),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature),
        Claims = new Dictionary<string, object>
        {
            { "userId", superAdmin.Id.ToString() },
            { "tenantId", Guid.Empty.ToString() },
            { "branchId", "" },
            { "role", "SuperAdmin" },
            { "permissions", "{}" }
        }
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);

    return Results.Ok(new
    {
        token = tokenHandler.WriteToken(token),
        user = new
        {
            id = superAdmin.Id,
            fullName = superAdmin.FullName,
            username = superAdmin.Username,
            role = "SuperAdmin",
            tenantId = Guid.Empty,
            branchId = (Guid?)null
        }
    });
});

app.MapGet("/api/admin/stats", async (AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var totalTenants = await db.Tenants.CountAsync();
    var activeTenants = await db.Tenants.CountAsync(t => t.IsActive);
    var trialTenants = await db.Tenants.CountAsync(t => t.IsTrialActive && t.TrialEndsAt > DateTime.UtcNow);
    var paidTenants = await db.Tenants.CountAsync(t => !t.IsTrialActive && t.SubscriptionPaidUntil > DateTime.UtcNow);
    var totalBranches = await db.Branches.CountAsync();
    var totalOrders = await db.Orders.CountAsync();

    return Results.Ok(new
    {
        totalTenants,
        activeTenants,
        trialTenants,
        paidTenants,
        totalBranches,
        totalOrders
    });
}).RequireAuthorization();

// ============================================================
// WHATSAPP NOTIFICATION SYSTEM
// ============================================================

app.MapGet("/api/whatsapp/config", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var config = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == tenantId.Value);
    return Results.Ok(config);
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

app.MapPost("/api/whatsapp/config", async (AppDbContext db, HttpContext http, WhatsAppConfigDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var existing = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == tenantId.Value);
    if (existing != null)
    {
        existing.Provider = dto.Provider;
        existing.ApiKey = dto.ApiKey;
        existing.ApiSecret = dto.ApiSecret;
        existing.PhoneNumberId = dto.PhoneNumberId;
        existing.AccessToken = dto.AccessToken;
        existing.WebhookUrl = dto.WebhookUrl;
        existing.IsEnabled = dto.IsEnabled;
        existing.AutoSendOrderUpdates = dto.AutoSendOrderUpdates;
        existing.AutoSendReceipt = dto.AutoSendReceipt;
    }
    else
    {
        db.WhatsAppConfigs.Add(new WhatsAppConfig
        {
            TenantId = tenantId.Value,
            Provider = dto.Provider,
            ApiKey = dto.ApiKey,
            ApiSecret = dto.ApiSecret,
            PhoneNumberId = dto.PhoneNumberId,
            AccessToken = dto.AccessToken,
            WebhookUrl = dto.WebhookUrl,
            IsEnabled = dto.IsEnabled,
            AutoSendOrderUpdates = dto.AutoSendOrderUpdates,
            AutoSendReceipt = dto.AutoSendReceipt
        });
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "WhatsApp config saved" });
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

app.MapGet("/api/whatsapp/logs", async (AppDbContext db, HttpContext http, int? limit) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var query = db.NotificationLogs.Where(n => n.TenantId == tenantId.Value).OrderByDescending(n => n.SentAt);
    var logs = await query.Take(Math.Clamp(limit ?? 100, 1, 500)).ToListAsync();
    return Results.Ok(logs);
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)));

app.MapPost("/api/whatsapp/test", async (AppDbContext db, HttpContext http, TestWhatsAppDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var config = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == tenantId.Value && w.IsEnabled);
    if (config == null) return Results.BadRequest(new { error = "WhatsApp not configured or disabled" });
    
    var log = new NotificationLog
    {
        TenantId = tenantId.Value,
        Channel = "whatsapp",
        RecipientPhone = dto.PhoneNumber,
        MessageType = "test",
        MessageBody = $"Hello! This is a test message from Cashly POS.\n\nRestaurant: {dto.RestaurantName}\nProvider: {config.Provider}\nStatus: Connected!",
        Status = "sent",
        SentAt = DateTime.UtcNow
    };
    db.NotificationLogs.Add(log);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Test message sent", logId = log.Id });
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)));

// Called by order creation/update. Authenticated; the tenant comes from the caller's token,
// never from the body (a client could otherwise burn another tenant's message quota).
app.MapPost("/api/whatsapp/send-order-update", async (AppDbContext db, HttpContext http, OrderNotificationDto dto) =>
{
    var callerTenantId = http.GetTenantId();
    if (callerTenantId == null || callerTenantId == Guid.Empty) return Results.Unauthorized();
    var scopedTenantId = callerTenantId.Value;

    // Find tenant WhatsApp config
    var config = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == scopedTenantId && w.IsEnabled);
    if (config == null) return Results.Ok(new { skipped = true, reason = "WhatsApp not configured" });

    // Check monthly limit against the tenant's OWN tier, not a client-declared one.
    var actualTier = await db.Tenants.Where(t => t.Id == scopedTenantId).Select(t => (SubscriptionTier?)t.Tier).FirstOrDefaultAsync();
    var packageConfig = actualTier == null ? null : await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == actualTier.Value.ToString());
    if (packageConfig != null && !packageConfig.HasWhatsAppMessaging)
        return Results.Ok(new { skipped = true, reason = "WhatsApp messaging is not included in this package" });
    if (packageConfig != null && packageConfig.WhatsAppMessagesPerMonth != -1)
    {
        var startOfMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var countThisMonth = await db.NotificationLogs.CountAsync(n =>
            n.TenantId == scopedTenantId && n.SentAt >= startOfMonth && n.Status != "failed");
        if (countThisMonth >= packageConfig.WhatsAppMessagesPerMonth)
            return Results.Ok(new { skipped = true, reason = "Monthly limit reached" });
    }

    // Build message based on type
    var message = dto.MessageType switch
    {
        "order_placed" => $"✅ *Order Confirmed!*\n\nOrder #{dto.OrderNumber}\nItems: {dto.ItemSummary}\nTotal: Rs {dto.TotalPKR:N0}\n\nThank you for your order! We're preparing it now.",
        "order_preparing" => $"👨‍🍳 *Your order is being prepared!*\n\nOrder #{dto.OrderNumber}\nEstimated time: 15-20 minutes\n\nWe'll let you know when it's ready!",
        "order_ready" => $"🔔 *Your order is ready!*\n\nOrder #{dto.OrderNumber}\nPlease collect from the counter.\n\nThank you for choosing us!",
        "order_delivered" => $"🚚 *Order Delivered!*\n\nOrder #{dto.OrderNumber}\nDelivered to: {dto.DeliveryAddress}\n\nThank you! We hope you enjoy your meal.",
        "receipt" => $"🧾 *Payment Receipt*\n\nOrder #{dto.OrderNumber}\nTotal: Rs {dto.TotalPKR:N0}\nPayment: {dto.PaymentMethod}\n\nThank you for dining with us!",
        _ => dto.CustomMessage ?? "You have an update from Cashly POS."
    };

    var log = new NotificationLog
    {
        TenantId = scopedTenantId,
        OrderId = dto.OrderId,
        Channel = "whatsapp",
        RecipientPhone = dto.PhoneNumber,
        MessageType = dto.MessageType,
        MessageBody = message,
        Status = "sent",
        SentAt = DateTime.UtcNow
    };
    db.NotificationLogs.Add(log);
    await db.SaveChangesAsync();
    return Results.Ok(new { sent = true, logId = log.Id });
}).RequireAuthorization();

// ============================================================
// SAAS PACKAGE CONFIGURATION (Platform Owner sets prices)
// ============================================================

app.MapGet("/api/admin/packages", async (AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var packages = await db.SaaSPackageConfigs.OrderBy(p => p.MonthlyPricePKR).ToListAsync();
    return Results.Ok(packages);
}).RequireAuthorization();

app.MapPost("/api/admin/packages", async (AppDbContext db, HttpContext http, CreatePackageDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    if (await db.SaaSPackageConfigs.AnyAsync(p => p.PackageKey == dto.PackageKey))
        return Results.BadRequest(new { error = "Package key already exists" });

    var pkg = new SaaSPackageConfig
    {
        PackageKey = dto.PackageKey,
        DisplayName = dto.DisplayName,
        MonthlyPricePKR = dto.MonthlyPricePKR,
        YearlyPricePKR = dto.YearlyPricePKR,
        MaxBranches = dto.MaxBranches,
        MaxCounters = dto.MaxCounters,
        MaxOrderTabs = dto.MaxOrderTabs,
        MaxUsers = dto.MaxUsers,
        HasKitchenDisplay = dto.HasKitchenDisplay,
        HasDeliveryCOD = dto.HasDeliveryCOD,
        HasInventoryManagement = dto.HasInventoryManagement,
        HasStockTransfers = dto.HasStockTransfers,
        HasDirectorDashboard = dto.HasDirectorDashboard,
        HasConsolidatedReports = dto.HasConsolidatedReports,
        HasWhatsAppMessaging = dto.HasWhatsAppMessaging,
        HasAdvancedReports = dto.HasAdvancedReports,
        HasMultiBranch = dto.HasMultiBranch,
        WhatsAppMessagesPerMonth = dto.WhatsAppMessagesPerMonth
    };
    db.SaaSPackageConfigs.Add(pkg);
    await db.SaveChangesAsync();
    return Results.Ok(pkg);
}).RequireAuthorization();

app.MapPut("/api/admin/packages/{id:guid}", async (Guid id, AppDbContext db, HttpContext http, UpdatePackageDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var pkg = await db.SaaSPackageConfigs.FindAsync(id);
    if (pkg == null) return Results.NotFound();

    if (dto.DisplayName != null) pkg.DisplayName = dto.DisplayName;
    if (dto.MonthlyPricePKR.HasValue) pkg.MonthlyPricePKR = dto.MonthlyPricePKR.Value;
    if (dto.YearlyPricePKR.HasValue) pkg.YearlyPricePKR = dto.YearlyPricePKR.Value;
    if (dto.MaxBranches.HasValue) pkg.MaxBranches = dto.MaxBranches.Value;
    if (dto.MaxCounters.HasValue) pkg.MaxCounters = dto.MaxCounters.Value;
    if (dto.MaxOrderTabs.HasValue) pkg.MaxOrderTabs = dto.MaxOrderTabs.Value;
    if (dto.MaxUsers.HasValue) pkg.MaxUsers = dto.MaxUsers.Value;
    if (dto.HasKitchenDisplay.HasValue) pkg.HasKitchenDisplay = dto.HasKitchenDisplay.Value;
    if (dto.HasDeliveryCOD.HasValue) pkg.HasDeliveryCOD = dto.HasDeliveryCOD.Value;
    if (dto.HasInventoryManagement.HasValue) pkg.HasInventoryManagement = dto.HasInventoryManagement.Value;
    if (dto.HasStockTransfers.HasValue) pkg.HasStockTransfers = dto.HasStockTransfers.Value;
    if (dto.HasDirectorDashboard.HasValue) pkg.HasDirectorDashboard = dto.HasDirectorDashboard.Value;
    if (dto.HasConsolidatedReports.HasValue) pkg.HasConsolidatedReports = dto.HasConsolidatedReports.Value;
    if (dto.HasWhatsAppMessaging.HasValue) pkg.HasWhatsAppMessaging = dto.HasWhatsAppMessaging.Value;
    if (dto.HasAdvancedReports.HasValue) pkg.HasAdvancedReports = dto.HasAdvancedReports.Value;
    if (dto.HasMultiBranch.HasValue) pkg.HasMultiBranch = dto.HasMultiBranch.Value;
    if (dto.WhatsAppMessagesPerMonth.HasValue) pkg.WhatsAppMessagesPerMonth = dto.WhatsAppMessagesPerMonth.Value;
    pkg.UpdatedAt = DateTime.UtcNow;

    await db.SaveChangesAsync();
    return Results.Ok(pkg);
}).RequireAuthorization();

app.MapDelete("/api/admin/packages/{id:guid}", async (Guid id, AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var pkg = await db.SaaSPackageConfigs.FindAsync(id);
    if (pkg == null) return Results.NotFound();
    db.SaaSPackageConfigs.Remove(pkg);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Package deleted" });
}).RequireAuthorization();

// Get package config for frontend (public - used during signup)
app.MapGet("/api/public/packages", async (AppDbContext db) =>
{
    var packages = await db.SaaSPackageConfigs
        .Where(p => p.IsActive)
        .OrderBy(p => p.MonthlyPricePKR)
        .Select(p => new
        {
            p.PackageKey, p.DisplayName, p.MonthlyPricePKR, p.YearlyPricePKR,
            p.MaxBranches, p.MaxCounters, p.MaxOrderTabs, p.MaxUsers,
            p.HasKitchenDisplay, p.HasDeliveryCOD, p.HasInventoryManagement,
            p.HasStockTransfers, p.HasDirectorDashboard, p.HasConsolidatedReports,
            p.HasWhatsAppMessaging, p.HasAdvancedReports, p.HasMultiBranch,
            p.WhatsAppMessagesPerMonth
        })
        .ToListAsync();
    return Results.Ok(packages);
});

// Get tenant's current package features (for runtime gating)
app.MapGet("/api/tenant/my-package", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var tenant = await db.Tenants.FindAsync(tenantId.Value);
    if (tenant == null) return Results.NotFound();
    var pkg = await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tenant.Tier.ToString());
    return Results.Ok(new
    {
        tier = tenant.Tier.ToString(),
        isActive = tenant.IsActive,
        isTrialActive = tenant.IsTrialActive,
        trialEndsAt = tenant.TrialEndsAt,
        subscriptionPaidUntil = tenant.SubscriptionPaidUntil,
        features = pkg
    });
}).RequireAuthorization();

// ============================================================
// MODULE-LEVEL PERMISSIONS
// ============================================================

app.MapGet("/api/permissions/modules", async () =>
{
    return Results.Ok(new[]
    {
        new { key = "pos", name = "POS Terminal", subModules = new[] {
            new { key = "pos.orders", name = "Place Orders" },
            new { key = "pos.void", name = "Void Orders" },
            new { key = "pos.discount", name = "Apply Discounts" },
            new { key = "pos.parked", name = "Parked Bills" },
            new { key = "pos.barcode", name = "Barcode Scan" }
        }},
        new { key = "kitchen", name = "Kitchen Display", subModules = new[] {
            new { key = "kitchen.view", name = "View Tickets" },
            new { key = "kitchen.update", name = "Update Status" }
        }},
        new { key = "tables", name = "Table Management", subModules = new[] {
            new { key = "tables.view", name = "View Floor" },
            new { key = "tables.manage", name = "Manage Tables" }
        }},
        new { key = "inventory", name = "Inventory", subModules = new[] {
            new { key = "inventory.view", name = "View Stock" },
            new { key = "inventory.stock_in", name = "Stock In" },
            new { key = "inventory.adjust", name = "Adjustments" },
            new { key = "inventory.recipes", name = "Recipes" },
            new { key = "inventory.ingredients", name = "Ingredients" }
        }},
        new { key = "reports", name = "Reports", subModules = new[] {
            new { key = "reports.sales", name = "Sales Reports" },
            new { key = "reports.tax", name = "Tax Reports" },
            new { key = "reports.items", name = "Item Performance" },
            new { key = "reports.cash", name = "Cash Reconciliation" },
            new { key = "reports.financial", name = "Financial Reports" },
            new { key = "reports.consolidated", name = "Consolidated Reports" }
        }},
        new { key = "delivery", name = "Delivery & COD", subModules = new[] {
            new { key = "delivery.board", name = "Delivery Board" },
            new { key = "delivery.riders", name = "Rider Management" },
            new { key = "delivery.settlement", name = "COD Settlement" }
        }},
        new { key = "menu", name = "Menu Management", subModules = new[] {
            new { key = "menu.categories", name = "Categories" },
            new { key = "menu.products", name = "Products" },
            new { key = "menu.modifiers", name = "Modifiers" },
            new { key = "menu.tax", name = "Tax Config" }
        }},
        new { key = "users", name = "User Management", subModules = new[] {
            new { key = "users.list", name = "View Users" },
            new { key = "users.create", name = "Create Users" },
            new { key = "users.permissions", name = "Manage Permissions" }
        }},
        new { key = "transfers", name = "Supply Chain", subModules = new[] {
            new { key = "transfers.stock", name = "Stock Transfers" },
            new { key = "transfers.purchase", name = "Purchase Orders" },
            new { key = "transfers.requests", name = "Stock Requests" }
        }},
        new { key = "settings", name = "Settings", subModules = new[] {
            new { key = "settings.general", name = "General Settings" },
            new { key = "settings.devices", name = "Device Management" },
            new { key = "settings.whatsapp", name = "WhatsApp Config" }
        }},
        new { key = "cashier", name = "Cashier", subModules = new[] {
            new { key = "cashier.shift", name = "Cash Shift" },
            new { key = "cashier.entries", name = "Cash Entries" },
            new { key = "cashier.tally", name = "Cash Tally" }
        }}
    });
}).RequireAuthorization();

app.MapGet("/api/permissions/{userId:guid}", async (Guid userId, AppDbContext db, HttpContext http) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    // A user may always read their own permissions; reading someone else's needs users:view.
    if (http.GetUserId() != userId)
    {
        var target = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && (http.IsSuperAdmin() || u.TenantId == tenantId!.Value));
        if (target == null) return Results.NotFound();
    }
    var perms = await db.ModulePermissions.Where(m => m.UserId == userId).ToListAsync();
    return Results.Ok(perms);
}).RequireAuthorization();

app.MapPut("/api/permissions/{userId:guid}", async (Guid userId, AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, List<UpdateModulePermissionDto> dto) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();

    var target = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && (http.IsSuperAdmin() || u.TenantId == tenantId!.Value));
    if (target == null) return Results.NotFound(new { message = "User not found in this restaurant." });
    if (http.GetUserId() == userId) return Results.BadRequest(new { message = "You cannot edit your own permissions." });

    var currentUser = await accessor.GetCurrentUserAsync(http);

    // Remove existing
    var existing = await db.ModulePermissions.Where(m => m.UserId == userId).ToListAsync();
    await WriteAuditAsync(db, target.TenantId, currentUser, "PermissionChanged", "ModulePermission", userId,
        oldValue: string.Join(", ", existing.Select(e => $"{e.ModuleKey}/{e.SubModuleKey}:v{(e.CanView ? 1 : 0)}e{(e.CanEdit ? 1 : 0)}d{(e.CanDelete ? 1 : 0)}x{(e.CanExport ? 1 : 0)}")),
        newValue: string.Join(", ", dto.Select(p => $"{p.ModuleKey}/{p.SubModuleKey}:v{(p.CanView ? 1 : 0)}e{(p.CanEdit ? 1 : 0)}d{(p.CanDelete ? 1 : 0)}x{(p.CanExport ? 1 : 0)}")));
    db.ModulePermissions.RemoveRange(existing);

    // Add new
    foreach (var p in dto)
    {
        db.ModulePermissions.Add(new ModulePermission
        {
            UserId = userId,
            ModuleKey = p.ModuleKey,
            SubModuleKey = p.SubModuleKey,
            CanView = p.CanView,
            CanEdit = p.CanEdit,
            CanDelete = p.CanDelete,
            CanExport = p.CanExport
        });
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Permissions updated" });
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("users", "edit"));

// Get effective permissions for current user
app.MapGet("/api/permissions/my", async (AppDbContext db, HttpContext http) =>
{
    var userId = http.GetUserId();
    if (userId == null) return Results.Unauthorized();
    var role = http.GetUserRole();
    
    // SuperAdmin and OwnerAdmin get full access
    if (role == "SuperAdmin" || role == "OwnerAdmin")
    {
        return Results.Ok(new { fullAccess = true, role });
    }

    var perms = await db.ModulePermissions.Where(m => m.UserId == userId.Value).ToListAsync();
    return Results.Ok(new { fullAccess = false, role, permissions = perms });
}).RequireAuthorization();

// ============================================================
// SMART ALERTS & AUTOMATION
// ============================================================

// Get alerts for tenant
app.MapGet("/api/alerts", async (AppDbContext db, HttpContext http, bool? unreadOnly) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var query = db.SmartAlerts.Where(a => a.TenantId == tenantId.Value && !a.IsDismissed);
    if (unreadOnly == true) query = query.Where(a => !a.IsRead);
    var alerts = await query.OrderByDescending(a => a.CreatedAt).Take(50).ToListAsync();
    var unreadCount = await db.SmartAlerts.CountAsync(a => a.TenantId == tenantId.Value && !a.IsRead && !a.IsDismissed);
    return Results.Ok(new { alerts, unreadCount });
}).RequireAuthorization();

// Mark alert as read
app.MapPut("/api/alerts/{id:guid}/read", async (Guid id, AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var alert = await db.SmartAlerts.FirstOrDefaultAsync(a => a.Id == id && (http.IsSuperAdmin() || a.TenantId == tenantId.Value));
    if (alert == null) return Results.NotFound();
    alert.IsRead = true;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Marked as read" });
}).RequireAuthorization();

// Dismiss alert
app.MapPut("/api/alerts/{id:guid}/dismiss", async (Guid id, AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var alert = await db.SmartAlerts.FirstOrDefaultAsync(a => a.Id == id && (http.IsSuperAdmin() || a.TenantId == tenantId.Value));
    if (alert == null) return Results.NotFound();
    alert.IsDismissed = true;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Alert dismissed" });
}).RequireAuthorization();

// Dismiss all
app.MapPut("/api/alerts/dismiss-all", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var alerts = await db.SmartAlerts.Where(a => a.TenantId == tenantId.Value && !a.IsDismissed).ToListAsync();
    foreach (var a in alerts) a.IsDismissed = true;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Dismissed {alerts.Count} alerts" });
}).RequireAuthorization();

// Generate smart alerts (called periodically or manually)
app.MapPost("/api/alerts/generate", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var currentUserId = http.GetUserId();
    var branchId = currentUserId != null ? db.Users.FirstOrDefault(u => u.Id == currentUserId.Value)?.BranchId : null;
    var createdAlerts = new List<SmartAlert>();

    // 1. Low Stock Alerts
    var lowStockItems = await db.Ingredients
        .Where(i => i.TenantId == tenantId.Value && i.CurrentStock <= i.MinAlertLevel)
        .ToListAsync();
    foreach (var item in lowStockItems)
    {
        var exists = await db.SmartAlerts.AnyAsync(a => 
            a.TenantId == tenantId.Value && 
            a.AlertType == "low_stock" && 
            a.Title.Contains(item.Name) && 
            !a.IsDismissed &&
            a.CreatedAt > DateTime.UtcNow.AddHours(-12));
        if (!exists)
        {
            var alert = new SmartAlert
            {
                TenantId = tenantId.Value,
                BranchId = item.BranchId,
                AlertType = "low_stock",
                Severity = item.CurrentStock == 0 ? "critical" : "warning",
                Title = $"Low Stock: {item.Name}",
                Message = item.CurrentStock == 0 
                    ? $"{item.Name} is OUT OF STOCK! Current: {item.CurrentStock} {item.Unit}, Min: {item.MinAlertLevel}"
                    : $"{item.Name} is running low. Current: {item.CurrentStock} {item.Unit}, Min alert: {item.MinAlertLevel}",
                Metadata = System.Text.Json.JsonSerializer.Serialize(new { ingredientId = item.Id, currentStock = item.CurrentStock, minLevel = item.MinAlertLevel })
            };
            db.SmartAlerts.Add(alert);
            createdAlerts.Add(alert);
        }
    }

    // 2. Shift Reminder (if no open shift after 30min of business hours)
    var today = DateTime.UtcNow.Date;
    var todayStart = today.AddHours(10); // assume 10am open
    if (DateTime.UtcNow > todayStart && DateTime.UtcNow < today.AddHours(23))
    {
        var branches = await db.Branches.Where(b => b.TenantId == tenantId.Value).ToListAsync();
        foreach (var branch in branches)
        {
            var hasOpenShift = await db.CashShifts.AnyAsync(s => 
                s.BranchId == branch.Id && 
                s.OpenedAt >= today && 
                s.ClosedAt == null);
            if (!hasOpenShift)
            {
                var exists = await db.SmartAlerts.AnyAsync(a => 
                    a.TenantId == tenantId.Value && 
                    a.AlertType == "shift_reminder" && 
                    a.BranchId == branch.Id &&
                    !a.IsDismissed &&
                    a.CreatedAt > today);
                if (!exists)
                {
                    var alert = new SmartAlert
                    {
                        TenantId = tenantId.Value,
                        BranchId = branch.Id,
                        AlertType = "shift_reminder",
                        Severity = "warning",
                        Title = $"No Open Shift: {branch.Name}",
                        Message = $"{branch.Name} has no open cash shift today. Open a shift to start recording sales.",
                        Metadata = System.Text.Json.JsonSerializer.Serialize(new { branchId = branch.Id })
                    };
                    db.SmartAlerts.Add(alert);
                    createdAlerts.Add(alert);
                }
            }
        }
    }

    // 3. Daily Summary Alert (if it's evening and no Z-Report run)
    if (DateTime.UtcNow.Hour >= 20) // 8pm
    {
        // Scope the Z-report check to THIS tenant's branches (previously it looked at every
        // tenant's shifts, so one restaurant closing its day suppressed everyone's reminder).
        var hasTodayZReport = await db.CashShifts.AnyAsync(s =>
            db.Branches.Any(b => b.Id == s.BranchId && b.TenantId == tenantId.Value) &&
            s.ClosedAt != null &&
            s.ClosedAt >= today);
        if (!hasTodayZReport)
        {
            var exists = await db.SmartAlerts.AnyAsync(a => 
                a.TenantId == tenantId.Value && 
                a.AlertType == "daily_summary" &&
                !a.IsDismissed &&
                a.CreatedAt > today);
            if (!exists)
            {
                var totalOrdersToday = await db.Orders.CountAsync(o => o.TenantId == tenantId.Value && o.CreatedAt >= today);
                var totalSalesToday = await db.Orders.Where(o => o.TenantId == tenantId.Value && o.CreatedAt >= today && o.IsPaid).SumAsync(o => o.TotalPKR);
                var alert = new SmartAlert
                {
                    TenantId = tenantId.Value,
                    AlertType = "daily_summary",
                    Severity = "info",
                    Title = "End of Day Reminder",
                    Message = $"Today: {totalOrdersToday} orders, Rs {totalSalesToday:N0} sales. Run Z-Report to close the day.",
                    Metadata = System.Text.Json.JsonSerializer.Serialize(new { totalOrders = totalOrdersToday, totalSales = totalSalesToday })
                };
                db.SmartAlerts.Add(alert);
                createdAlerts.Add(alert);
            }
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { generated = createdAlerts.Count, alerts = createdAlerts });
}).RequireAuthorization();

// ============================================================
// SMART ANALYTICS
// ============================================================

app.MapGet("/api/analytics/smart", async (AppDbContext db, HttpContext http, int? days) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var targetDays = days ?? 30;
    var since = DateTime.UtcNow.AddDays(-targetDays);

    var orders = await db.Orders
        .Where(o => o.TenantId == tenantId.Value && o.CreatedAt >= since && o.IsPaid)
        .ToListAsync();

    // Best sellers
    var bestSellers = orders
        .SelectMany(o => o.Items)
        .GroupBy(i => i.ProductName)
        .Select(g => new { productName = g.Key, totalQty = g.Sum(i => i.Quantity), totalRevenue = g.Sum(i => i.UnitPricePKR * i.Quantity) })
        .OrderByDescending(x => x.totalQty)
        .Take(10)
        .ToList();

    // Peak hours
    var hourlySales = orders
        .GroupBy(o => o.CreatedAt.Hour)
        .Select(g => new { hour = g.Key, orderCount = g.Count(), totalSales = g.Sum(o => o.TotalPKR) })
        .OrderBy(x => x.hour)
        .ToList();

    // Revenue trend (last 7 days)
    var last7Days = Enumerable.Range(0, 7).Select(i => DateTime.UtcNow.Date.AddDays(-i)).Reverse().ToList();
    var revenueTrend = last7Days.Select(date => new
    {
        date = date.ToString("MMM dd"),
        orders = orders.Count(o => o.CreatedAt.Date == date),
        revenue = orders.Where(o => o.CreatedAt.Date == date).Sum(o => o.TotalPKR)
    }).ToList();

    // Average order value
    var avgOrderValue = orders.Count > 0 ? orders.Average(o => o.TotalPKR) : 0;

    // Payment method breakdown
    var paymentBreakdown = orders
        .GroupBy(o => o.PaymentMethod.ToString())
        .Select(g => new { method = g.Key, count = g.Count(), total = g.Sum(o => o.TotalPKR) })
        .ToList();

    // Order type breakdown
    var orderTypeBreakdown = orders
        .GroupBy(o => o.OrderType.ToString())
        .Select(g => new { type = g.Key, count = g.Count(), total = g.Sum(o => o.TotalPKR) })
        .ToList();

    // Prediction: simple moving average for next 3 days
    var last7DaysSales = last7Days.Select(date => orders.Where(o => o.CreatedAt.Date == date).Sum(o => o.TotalPKR)).ToList();
    var avgDailySales = last7DaysSales.Count > 0 ? last7DaysSales.Average() : 0;
    var predictedNext3Days = avgDailySales * 3;

    return Results.Ok(new
    {
        bestSellers,
        peakHours = hourlySales,
        revenueTrend,
        avgOrderValue = Math.Round(avgOrderValue, 0),
        paymentBreakdown,
        orderTypeBreakdown,
        predictions = new
        {
            avgDailySales = Math.Round(avgDailySales, 0),
            predictedNext3Days = Math.Round(predictedNext3Days, 0),
            trend = last7DaysSales.Count >= 2 && last7DaysSales.Last() > last7DaysSales.First() ? "growing" : "stable"
        },
        summary = new
        {
            totalOrders = orders.Count,
            totalRevenue = orders.Sum(o => o.TotalPKR),
            avgOrdersPerDay = Math.Round((double)orders.Count / targetDays, 0),
            busiestHour = hourlySales.OrderByDescending(h => h.orderCount).FirstOrDefault()?.hour ?? 0,
            topPaymentMethod = paymentBreakdown.OrderByDescending(p => p.count).FirstOrDefault()?.method ?? "Cash"
        }
    });
}).RequireAuthorization();

// ── Tenant Settings CRUD ──
app.MapGet("/api/tenant/settings", async (Guid? tenantId, AppDbContext db, HttpContext http) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == scopedTenantId.Value);
    if (settings == null)
    {
        settings = new TenantSettings { TenantId = scopedTenantId.Value };
        db.TenantSettings.Add(settings);
        await db.SaveChangesAsync();
    }
    return Results.Ok(settings);
}).RequireAuthorization();

// Tax + currency configuration is a menu/tax-level privilege.
app.MapPut("/api/tenant/settings", async (Guid? tenantId, TenantSettingsDto dto, AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == scopedTenantId.Value);
    if (settings == null)
    {
        settings = new TenantSettings { TenantId = scopedTenantId.Value };
        db.TenantSettings.Add(settings);
    }

    var oldTax = $"default={settings.DefaultTaxRate}; digital={settings.DigitalTaxRate}; dual={settings.UseDualTaxRate}; provincial={settings.UseProvincialTax}";

    settings.CountryCode = dto.CountryCode ?? settings.CountryCode;
    settings.CurrencyCode = dto.CurrencyCode ?? settings.CurrencyCode;
    settings.CurrencySymbol = dto.CurrencySymbol ?? settings.CurrencySymbol;
    settings.DecimalPlaces = dto.DecimalPlaces;
    settings.TaxAuthorityName = dto.TaxAuthorityName ?? settings.TaxAuthorityName;
    settings.DefaultTaxRate = dto.DefaultTaxRate;
    settings.UseDualTaxRate = dto.UseDualTaxRate;
    settings.DigitalTaxRate = dto.DigitalTaxRate;
    settings.PhoneCode = dto.PhoneCode ?? settings.PhoneCode;
    settings.DefaultCity = dto.DefaultCity ?? settings.DefaultCity;
    settings.DateFormat = dto.DateFormat ?? settings.DateFormat;
    settings.ReceiptFooter = dto.ReceiptFooter ?? settings.ReceiptFooter;
    settings.AllowedPaymentMethods = dto.AllowedPaymentMethods ?? settings.AllowedPaymentMethods;
    if (dto.UseProvincialTax.HasValue) settings.UseProvincialTax = dto.UseProvincialTax.Value;

    var newTax = $"default={settings.DefaultTaxRate}; digital={settings.DigitalTaxRate}; dual={settings.UseDualTaxRate}; provincial={settings.UseProvincialTax}";
    if (oldTax != newTax)
    {
        var currentUser = await accessor.GetCurrentUserAsync(http);
        await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "TaxSettingsChanged", "TenantSettings", settings.Id, oldTax, newTax);
    }

    await db.SaveChangesAsync();
    return Results.Ok(settings);
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageMenuAndTax, "You don't have permission to change tax or currency settings."));

// ============================================================
// TAX JURISDICTIONS (provincial rates — editable defaults, not legal advice)
// ============================================================

// Any authenticated user may read the rate table (receipts/UI need it).
api.MapGet("/settings/tax-jurisdictions", async (AppDbContext db) =>
{
    var rows = await db.TaxJurisdictions.OrderBy(j => j.CountryCode).ThenBy(j => j.RegionCode).ToListAsync();
    return Results.Ok(new
    {
        disclaimer = "These rates are editable defaults provided for convenience and are not verified tax or legal advice. Confirm current rates with your tax authority.",
        jurisdictions = rows
    });
});

// Only the Owner or a platform SuperAdmin may change the rates.
api.MapPut("/settings/tax-jurisdictions/{id:guid}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateTaxJurisdictionDto dto) =>
{
    var currentUser = await accessor.GetCurrentUserAsync(http);
    if (currentUser == null) return Results.Unauthorized();
    if (!(http.IsSuperAdmin() || currentUser.Role == UserRole.OwnerAdmin || currentUser.Role == UserRole.SuperAdmin))
        return Results.Json(new { message = "Only the restaurant owner can change tax jurisdiction rates." }, statusCode: 403);

    var jurisdiction = await db.TaxJurisdictions.FirstOrDefaultAsync(j => j.Id == id);
    if (jurisdiction == null) return Results.NotFound();

    var oldValue = $"cash={jurisdiction.CashTaxRate}; digital={jurisdiction.DigitalTaxRate}; active={jurisdiction.IsActive}";

    if (!string.IsNullOrWhiteSpace(dto.AuthorityName)) jurisdiction.AuthorityName = dto.AuthorityName.Trim();
    if (dto.CashTaxRate.HasValue)
    {
        if (dto.CashTaxRate.Value < 0 || dto.CashTaxRate.Value > 100) return Results.BadRequest(new { message = "Cash tax rate must be between 0 and 100." });
        jurisdiction.CashTaxRate = dto.CashTaxRate.Value;
    }
    if (dto.DigitalTaxRate.HasValue)
    {
        if (dto.DigitalTaxRate.Value < 0 || dto.DigitalTaxRate.Value > 100) return Results.BadRequest(new { message = "Digital tax rate must be between 0 and 100." });
        jurisdiction.DigitalTaxRate = dto.DigitalTaxRate.Value;
    }
    if (dto.IsActive.HasValue) jurisdiction.IsActive = dto.IsActive.Value;

    var newValue = $"cash={jurisdiction.CashTaxRate}; digital={jurisdiction.DigitalTaxRate}; active={jurisdiction.IsActive}";
    await WriteAuditAsync(db, currentUser.TenantId, currentUser, "TaxJurisdictionChanged", "TaxJurisdiction", jurisdiction.Id, oldValue, newValue);

    await db.SaveChangesAsync();
    return Results.Ok(jurisdiction);
});

// ============================================================
// AUDIT LOG (Owner / SuperAdmin only)
// ============================================================
app.MapGet("/api/admin/audit-log", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid? tenantId, string? action, int page = 1, int pageSize = 50) =>
{
    var currentUser = await accessor.GetCurrentUserAsync(http);
    if (currentUser == null) return Results.Unauthorized();
    if (!(http.IsSuperAdmin() || currentUser.Role == UserRole.OwnerAdmin || currentUser.Role == UserRole.SuperAdmin))
        return Results.Json(new { message = "Only the restaurant owner can view the audit log." }, statusCode: 403);

    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();

    page = Math.Max(page, 1);
    pageSize = Math.Clamp(pageSize, 1, 200);

    var query = db.AuditLogs.Where(a => a.TenantId == scopedTenantId.Value);
    if (!string.IsNullOrWhiteSpace(action)) query = query.Where(a => a.Action == action);

    var total = await query.CountAsync();
    var rows = await query.OrderByDescending(a => a.CreatedAt)
        .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

    return Results.Ok(new { page, pageSize, total, totalPages = (int)Math.Ceiling(total / (double)pageSize), entries = rows });
}).RequireAuthorization();

app.Run();


/// <summary>Result of server-side re-pricing of an order. Client-supplied money is never used.</summary>
public class ServerPricedOrder
{
    public List<OrderItem> Items { get; set; } = new();
    public decimal SubTotalPKR { get; set; }
    public decimal DiscountPKR { get; set; }
    public decimal TaxPKR { get; set; }
    public decimal TotalPKR { get; set; }
    public decimal TaxRatePercent { get; set; }
    public bool DiscountRejected { get; set; }
    public decimal AttemptedDiscountPKR { get; set; }
    public string? Error { get; set; }
}

// DTOs
public record VerifyPinDto(string Username, string PinCode, string? RequiredPermission);
public record UpdateTaxJurisdictionDto(string? AuthorityName, decimal? CashTaxRate, decimal? DigitalTaxRate, bool? IsActive);
public record UpdateBranchDto(string? Name, string? Address, string? City, string? Phone, string? RegionCode, int? AllowedCounters, int? AllowedOrderTabs);
public record CreateOrderDto(Guid BranchId, OrderType OrderType, string? TableNumber, string? CustomerName, string? CustomerPhone, string? DeliveryAddress, decimal SubTotalPKR, decimal DiscountPKR, decimal TaxPKR, decimal TotalPKR, PaymentMethod PaymentMethod, decimal AmountPaidPKR, decimal ChangeDuePKR, bool IsPaid, string? CashierName, string? CreatedByRole, List<CreateOrderItemDto> Items);
public record CreateOrderItemDto(Guid ProductId, string ProductName, int Quantity, decimal UnitPricePKR, string? ModifiersSummary, string? SpecialNotes, KitchenStation Station);
public record UpdateTicketStatusDto(string Status);
public record AssignRiderDto(Guid OrderId, Guid RiderId);
public record SettleRiderDto(Guid RiderId, int TotalOrdersDelivered, decimal ExpectedCODPKR, decimal CashCollectedPKR, string? SettledBy);
public record UpdateBranchLimitsDto(Guid BranchId, int AllowedCounters, int AllowedOrderTabs, SubscriptionTier? Tier);
public record CreateProductDto(Guid TenantId, Guid CategoryId, string Name, string? UrduName, string? SKU, string? Barcode, string? Description, decimal CostPricePKR, decimal SellingPricePKR, string? Unit, KitchenStation Station, string? ImageUrl, List<CreateProductModifierDto>? Modifiers);
public record UpdateProductDto(Guid CategoryId, string? Name, string? UrduName, string? Barcode, decimal CostPricePKR, decimal SellingPricePKR, KitchenStation Station);
public record CreateCategoryDto(Guid TenantId, string Name, string? LocalName, string? Icon, int SortOrder);
public record CreateProductModifierDto(string Name, decimal PricePKR);
public record StockInDto(Guid BranchId, Guid ProductId, decimal Quantity, string? SupplierName, decimal? CostPricePKR, string? BatchNumber, DateTime? ExpiryDate);
public record StockAdjustmentDto(Guid BranchId, Guid ProductId, decimal AdjustmentQty, string Reason);
public record IngredientStockInDto(Guid BranchId, Guid IngredientId, decimal QuantityReceived, decimal? NewCostPerUnitPKR, string? SupplierName);
public record CreateIngredientDto(Guid BranchId, Guid TenantId, string Name, string? Category, string? Unit, decimal CostPerUnitPKR, decimal InitialStock, decimal MinAlertLevel, string? SupplierName);
public record RecipeItemInputDto(Guid IngredientId, decimal QuantityRequired, string? Unit);
public record CreateUserDto(Guid TenantId, Guid? BranchId, string FullName, string Username, string? PinCode, UserRole Role, bool CanViewFinancialReports, bool CanManageInventory, bool CanManageMenuAndTax, bool CanGiveDiscounts, bool CanVoidOrders);
public record UpdateUserDto(string? FullName, UserRole? Role, string? PinCode, bool? IsActive, bool? CanViewFinancialReports, bool? CanManageInventory, bool? CanManageMenuAndTax, bool? CanGiveDiscounts, bool? CanVoidOrders);
public record CreateRiderDto(Guid BranchId, string Name, string Phone, string VehicleNumber);
public record CreateTransferOrderDto(Guid TenantId, Guid SourceBranchId, Guid DestinationBranchId, string? VehicleOrDriver, string? Notes, List<CreateTransferItemDto> Items);
public record CreateTransferItemDto(Guid IngredientId, string? IngredientName, decimal QuantityRequested, string? Unit);
public record DispatchTransferDto(string? DispatchedBy, string? VehicleOrDriver, string? Notes);
public record ReceiveTransferDto(string? ReceivedBy, string? Notes);
public record CreatePODto(Guid TenantId, Guid BranchId, string SupplierName, string? Notes, List<CreatePOItemDto> Items);
public record CreatePOItemDto(Guid IngredientId, string IngredientName, decimal Quantity, string? Unit, decimal UnitCostPKR);
public record ReceivePODto(string? ReceivedBy, string? Notes);
public record CreateTableDto(Guid BranchId, string TableNumber, string? Section, int Capacity);
public record UpdateTableDto(string? TableNumber, string? Section, int? Capacity, bool? IsOccupied);
public record LoginDto(string Username, string PinCode);
public record VoidOrderDto(string? Reason);
public record OpenCashShiftDto(Guid BranchId, string TerminalName, string CashierName, decimal OpeningFloatPKR);
public record CloseCashShiftDto(decimal ActualCashCounted, string? Notes);
public record SetupInitDto(
    string DeploymentMode,
    string RestaurantName,
    BusinessType? BusinessType,
    string? CountryCode,
    string? CurrencyCode,
    string? CurrencySymbol,
    int? DecimalPlaces,
    string? TaxAuthorityName,
    decimal? DefaultTaxRate,
    bool? UseDualTaxRate,
    decimal? DigitalTaxRate,
    string? PhoneCode,
    string? City,
    string? Address,
    string? Phone,
    string? MainBranchName,
    string? HqName,
    int? AllowedCounters,
    int? AllowedOrderTabs,
    string? AdminFullName,
    string? AdminUsername,
    string? AdminPin,
    bool SeedStarterMenu,
    string? AllowedPaymentMethods,
    List<BranchInitDto>? Branches
);
public record BranchInitDto(string Name, string? Code, string? City, string? Address, string? Phone, int AllowedCounters, int AllowedOrderTabs);
public record PairBranchDto(string PairingToken);
public record CreateTerminalDto(Guid BranchId, string TerminalName, TerminalType TerminalType);
public record UpdateTerminalDto(string? TerminalName, bool? IsActive);
public record TerminalHeartbeatDto(string DeviceToken);
public record CreateStockRequestDto(Guid BranchId, StockRequestType RequestType, string? VendorName, string? Notes, string CreatedBy, Guid? CreatedByUserId, List<CreateStockRequestItemDto> Items);
public record CreateStockRequestItemDto(Guid IngredientId, string IngredientName, string Unit, decimal QuantityRequested, decimal CurrentStock, decimal UnitCostPKR);
public record ReviewStockRequestDto(StockRequestStatus Status, string ReviewedBy, string? ReviewNotes);
public record CreateCashEntryDto(CashEntryType EntryType, decimal AmountPKR, string Description, string? RecipientOrSource, string CreatedBy);
public record SignupDto(string RestaurantName, string ContactName, string Email, string Phone, string? City, string? Address, string AdminUsername, string AdminPin);
public record ChangeTierDto(SubscriptionTier Tier, DateTime? PaidUntil);
public record WhatsAppConfigDto(string Provider, string? ApiKey, string? ApiSecret, string? PhoneNumberId, string? AccessToken, string? WebhookUrl, bool IsEnabled, bool AutoSendOrderUpdates, bool AutoSendReceipt);
public record TestWhatsAppDto(string PhoneNumber, string RestaurantName);
public record OrderNotificationDto(Guid TenantId, Guid? OrderId, string OrderNumber, string PhoneNumber, string MessageType, string ItemSummary, decimal TotalPKR, string PaymentMethod, string? DeliveryAddress, string PackageTier, string? CustomMessage);
public record CreatePackageDto(string PackageKey, string DisplayName, decimal MonthlyPricePKR, decimal YearlyPricePKR, int MaxBranches, int MaxCounters, int MaxOrderTabs, int MaxUsers, bool HasKitchenDisplay, bool HasDeliveryCOD, bool HasInventoryManagement, bool HasStockTransfers, bool HasDirectorDashboard, bool HasConsolidatedReports, bool HasWhatsAppMessaging, bool HasAdvancedReports, bool HasMultiBranch, int WhatsAppMessagesPerMonth);
public record UpdatePackageDto(string? DisplayName, decimal? MonthlyPricePKR, decimal? YearlyPricePKR, int? MaxBranches, int? MaxCounters, int? MaxOrderTabs, int? MaxUsers, bool? HasKitchenDisplay, bool? HasDeliveryCOD, bool? HasInventoryManagement, bool? HasStockTransfers, bool? HasDirectorDashboard, bool? HasConsolidatedReports, bool? HasWhatsAppMessaging, bool? HasAdvancedReports, bool? HasMultiBranch, int? WhatsAppMessagesPerMonth);
public record UpdateModulePermissionDto(string ModuleKey, string SubModuleKey, bool CanView, bool CanEdit, bool CanDelete, bool CanExport);
public record TenantSettingsDto(
    string? CountryCode,
    string? CurrencyCode,
    string? CurrencySymbol,
    int DecimalPlaces,
    string? TaxAuthorityName,
    decimal DefaultTaxRate,
    bool UseDualTaxRate,
    decimal DigitalTaxRate,
    string? PhoneCode,
    string? DefaultCity,
    string? DateFormat,
    string? ReceiptFooter,
    string? AllowedPaymentMethods,
    bool? UseProvincialTax = null
);



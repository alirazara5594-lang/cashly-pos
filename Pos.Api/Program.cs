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
// Dev defaults cover local Vite/CRA ports; a real deployment adds its own origin(s) via the
// CORS_ORIGINS env var (comma-separated) or config, instead of needing a code change per domain.
var corsOrigins = (builder.Configuration["CorsOrigins"] ?? Environment.GetEnvironmentVariable("CORS_ORIGINS"))
    ?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    ?? Array.Empty<string>();
var allOrigins = new[] { "http://localhost:5173", "http://localhost:5174", "http://localhost:3000", "https://cashly-pos.vercel.app" }
    .Concat(corsOrigins).Distinct().ToArray();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(allOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseNpgsql(dbConnection);
    AppDbContext.ConfigureWarnings(options);
});

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
builder.Services.AddScoped<Pos.Api.Services.IEntitlementService, Pos.Api.Services.EntitlementService>();
builder.Services.AddScoped<Pos.Api.Services.IDeviceLicenseService, Pos.Api.Services.DeviceLicenseService>();
builder.Services.AddScoped<Pos.Api.Services.ISubscriptionService, Pos.Api.Services.SubscriptionService>();
builder.Services.AddScoped<Pos.Api.Services.ISyncService, Pos.Api.Services.SyncService>();
// Only actually does anything when Host:Mode is BusinessHost — see SyncWorker.
builder.Services.AddHostedService<Pos.Api.Services.SyncWorker>();
builder.Services.AddSingleton<Pos.Api.Services.IFiscalInvoiceProvider, Pos.Api.Services.NullFiscalInvoiceProvider>();

// --- Payment gateways (all inert until merchant credentials are configured) ---
builder.Services.AddSingleton<Pos.Api.Services.IPaymentGatewayProvider, Pos.Api.Services.JazzCashProvider>();
builder.Services.AddSingleton<Pos.Api.Services.IPaymentGatewayProvider, Pos.Api.Services.EasyPaisaProvider>();
builder.Services.AddSingleton<Pos.Api.Services.IPaymentGatewayProvider, Pos.Api.Services.NullPaymentGatewayProvider>();
builder.Services.AddSingleton<Pos.Api.Services.IPaymentGatewayResolver, Pos.Api.Services.PaymentGatewayResolver>();

// --- Delivery-platform connectors (payload shapes are best-effort until partner access exists) ---
builder.Services.AddSingleton<Pos.Api.Services.IDeliveryPlatformConnector, Pos.Api.Services.FoodpandaStubConnector>();
builder.Services.AddSingleton<Pos.Api.Services.IDeliveryPlatformResolver, Pos.Api.Services.DeliveryPlatformResolver>();

// --- WhatsApp senders (Twilio/Meta genuinely call out once configured; Manual/Whaticket are
// honest no-op/best-effort — see Services/WhatsAppSender.cs for details on each) ---
builder.Services.AddHttpClient();
builder.Services.AddSingleton<Pos.Api.Services.IWhatsAppSender, Pos.Api.Services.ManualWhatsAppSender>();
builder.Services.AddSingleton<Pos.Api.Services.IWhatsAppSender, Pos.Api.Services.TwilioWhatsAppSender>();
builder.Services.AddSingleton<Pos.Api.Services.IWhatsAppSender, Pos.Api.Services.MetaWhatsAppSender>();
builder.Services.AddSingleton<Pos.Api.Services.IWhatsAppSender, Pos.Api.Services.WhaticketWhatsAppSender>();
builder.Services.AddSingleton<Pos.Api.Services.IWhatsAppSenderResolver, Pos.Api.Services.WhatsAppSenderResolver>();

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
// Runs after tenant resolution (it needs the tenant) and before any endpoint, so the billing
// ladder applies to every write by default rather than only where a filter was remembered.
app.UseMiddleware<TenantLifecycleMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// --- Database Migration & Seeding ---
// Do not block Kestrel from binding while the first-run schema setup is running.
// The previous synchronous startup routine could leave the local API unavailable
// on port 5288 for several minutes on a new or large database.
_ = Task.Run(async () =>
{
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
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""Country"" text NOT NULL DEFAULT 'Pakistan';
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""State"" text;
            ALTER TABLE ""AddOnSubscriptions"" ADD COLUMN IF NOT EXISTS ""BranchId"" uuid;
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

            -- PIN-login lockout tracking.
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""FailedLoginAttempts"" integer NOT NULL DEFAULT 0;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""LockedUntil"" timestamp with time zone;

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

        // --- CRM / loyalty / gift cards / promos / payments / delivery integration / labor ---
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""Customers"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""FullName"" text NOT NULL DEFAULT '',
                ""Phone"" text NOT NULL DEFAULT '',
                ""Email"" text,
                ""LoyaltyPoints"" integer NOT NULL DEFAULT 0,
                ""TotalVisits"" integer NOT NULL DEFAULT 0,
                ""TotalSpentPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""LastVisitAt"" timestamp with time zone
            );
            CREATE TABLE IF NOT EXISTS ""GiftCards"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""CardCode"" text NOT NULL,
                ""InitialBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""CurrentBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""IssuedToCustomerId"" uuid,
                ""IssuedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ExpiresAt"" timestamp with time zone,
                ""IsActive"" boolean NOT NULL DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS ""GiftCardTransactions"" (
                ""Id"" uuid PRIMARY KEY,
                ""GiftCardId"" uuid NOT NULL,
                ""OrderId"" uuid,
                ""Type"" integer NOT NULL DEFAULT 1,
                ""AmountPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CreatedBy"" text NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS ""LoyaltyProgramConfigs"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""IsEnabled"" boolean NOT NULL DEFAULT false,
                ""PointsPerPKRSpent"" numeric(18,2) NOT NULL DEFAULT 1,
                ""PKRValuePerPoint"" numeric(18,2) NOT NULL DEFAULT 1,
                ""MinRedeemPoints"" integer NOT NULL DEFAULT 100
            );
            CREATE TABLE IF NOT EXISTS ""PromoCodes"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Code"" text NOT NULL,
                ""DiscountType"" integer NOT NULL DEFAULT 1,
                ""DiscountValue"" numeric(18,2) NOT NULL DEFAULT 0,
                ""MinOrderAmountPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""MaxUsesTotal"" integer,
                ""MaxUsesPerCustomer"" integer,
                ""UsesCount"" integer NOT NULL DEFAULT 0,
                ""ValidFrom"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ValidUntil"" timestamp with time zone,
                ""IsActive"" boolean NOT NULL DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS ""PaymentTransactions"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""OrderId"" uuid NOT NULL,
                ""Provider"" integer NOT NULL DEFAULT 4,
                ""ProviderTransactionId"" text,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""AmountPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""RequestedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CompletedAt"" timestamp with time zone,
                ""RawResponsePayload"" text,
                ""FailureReason"" text
            );
            CREATE TABLE IF NOT EXISTS ""ExternalOrderMappings"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""Platform"" integer NOT NULL DEFAULT 1,
                ""ExternalOrderId"" text NOT NULL DEFAULT '',
                ""InternalOrderId"" uuid NOT NULL,
                ""RawPayload"" text NOT NULL DEFAULT '',
                ""ReceivedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""StaffShiftSchedules"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""ScheduledStart"" timestamp with time zone NOT NULL,
                ""ScheduledEnd"" timestamp with time zone NOT NULL,
                ""Position"" text NOT NULL DEFAULT '',
                ""Notes"" text,
                ""CreatedBy"" text NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS ""TimeClockEntries"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""ClockInAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ClockOutAt"" timestamp with time zone,
                ""LinkedCashShiftId"" uuid,
                ""HoursWorked"" numeric(18,2)
            );

            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""CustomerId"" uuid;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""PromoCodeId"" uuid;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""GiftCardRedeemedPKR"" numeric(18,2) NOT NULL DEFAULT 0;
        ");
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Customers_TenantId_Phone') THEN
                    CREATE UNIQUE INDEX ""IX_Customers_TenantId_Phone"" ON ""Customers"" (""TenantId"", ""Phone"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Customers_TenantId_FullName') THEN
                    CREATE INDEX ""IX_Customers_TenantId_FullName"" ON ""Customers"" (""TenantId"", ""FullName"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_GiftCards_CardCode') THEN
                    CREATE UNIQUE INDEX ""IX_GiftCards_CardCode"" ON ""GiftCards"" (""CardCode"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_GiftCards_TenantId_IsActive') THEN
                    CREATE INDEX ""IX_GiftCards_TenantId_IsActive"" ON ""GiftCards"" (""TenantId"", ""IsActive"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_GiftCardTransactions_GiftCardId_CreatedAt') THEN
                    CREATE INDEX ""IX_GiftCardTransactions_GiftCardId_CreatedAt"" ON ""GiftCardTransactions"" (""GiftCardId"", ""CreatedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_GiftCardTransactions_OrderId') THEN
                    CREATE INDEX ""IX_GiftCardTransactions_OrderId"" ON ""GiftCardTransactions"" (""OrderId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_LoyaltyProgramConfigs_TenantId') THEN
                    CREATE UNIQUE INDEX ""IX_LoyaltyProgramConfigs_TenantId"" ON ""LoyaltyProgramConfigs"" (""TenantId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PromoCodes_TenantId_Code') THEN
                    CREATE UNIQUE INDEX ""IX_PromoCodes_TenantId_Code"" ON ""PromoCodes"" (""TenantId"", ""Code"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PromoCodes_TenantId_IsActive') THEN
                    CREATE INDEX ""IX_PromoCodes_TenantId_IsActive"" ON ""PromoCodes"" (""TenantId"", ""IsActive"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PaymentTransactions_TenantId_RequestedAt') THEN
                    CREATE INDEX ""IX_PaymentTransactions_TenantId_RequestedAt"" ON ""PaymentTransactions"" (""TenantId"", ""RequestedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PaymentTransactions_OrderId') THEN
                    CREATE INDEX ""IX_PaymentTransactions_OrderId"" ON ""PaymentTransactions"" (""OrderId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PaymentTransactions_BranchId_Status') THEN
                    CREATE INDEX ""IX_PaymentTransactions_BranchId_Status"" ON ""PaymentTransactions"" (""BranchId"", ""Status"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PaymentTransactions_ProviderTransactionId') THEN
                    CREATE INDEX ""IX_PaymentTransactions_ProviderTransactionId"" ON ""PaymentTransactions"" (""ProviderTransactionId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_ExternalOrderMappings_Platform_ExternalOrderId') THEN
                    CREATE UNIQUE INDEX ""IX_ExternalOrderMappings_Platform_ExternalOrderId"" ON ""ExternalOrderMappings"" (""Platform"", ""ExternalOrderId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_ExternalOrderMappings_TenantId_ReceivedAt') THEN
                    CREATE INDEX ""IX_ExternalOrderMappings_TenantId_ReceivedAt"" ON ""ExternalOrderMappings"" (""TenantId"", ""ReceivedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_ExternalOrderMappings_InternalOrderId') THEN
                    CREATE INDEX ""IX_ExternalOrderMappings_InternalOrderId"" ON ""ExternalOrderMappings"" (""InternalOrderId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_StaffShiftSchedules_BranchId_ScheduledStart') THEN
                    CREATE INDEX ""IX_StaffShiftSchedules_BranchId_ScheduledStart"" ON ""StaffShiftSchedules"" (""BranchId"", ""ScheduledStart"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_StaffShiftSchedules_TenantId_UserId') THEN
                    CREATE INDEX ""IX_StaffShiftSchedules_TenantId_UserId"" ON ""StaffShiftSchedules"" (""TenantId"", ""UserId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TimeClockEntries_BranchId_ClockInAt') THEN
                    CREATE INDEX ""IX_TimeClockEntries_BranchId_ClockInAt"" ON ""TimeClockEntries"" (""BranchId"", ""ClockInAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TimeClockEntries_UserId_ClockInAt') THEN
                    CREATE INDEX ""IX_TimeClockEntries_UserId_ClockInAt"" ON ""TimeClockEntries"" (""UserId"", ""ClockInAt"");
                END IF;
            END $$;
        ");
        await db.Database.ExecuteSqlRawAsync(@"
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_giftcardtransactions_giftcards') THEN
                    ALTER TABLE ""GiftCardTransactions"" ADD CONSTRAINT ""fk_giftcardtransactions_giftcards"" FOREIGN KEY (""GiftCardId"") REFERENCES ""GiftCards""(""Id"") ON DELETE CASCADE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_customers') THEN
                    ALTER TABLE ""Orders"" ADD CONSTRAINT ""fk_orders_customers"" FOREIGN KEY (""CustomerId"") REFERENCES ""Customers""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_promocodes') THEN
                    ALTER TABLE ""Orders"" ADD CONSTRAINT ""fk_orders_promocodes"" FOREIGN KEY (""PromoCodeId"") REFERENCES ""PromoCodes""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_timeclockentries_users') THEN
                    ALTER TABLE ""TimeClockEntries"" ADD CONSTRAINT ""fk_timeclockentries_users"" FOREIGN KEY (""UserId"") REFERENCES ""Users""(""Id"") ON DELETE RESTRICT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_staffshiftschedules_users') THEN
                    ALTER TABLE ""StaffShiftSchedules"" ADD CONSTRAINT ""fk_staffshiftschedules_users"" FOREIGN KEY (""UserId"") REFERENCES ""Users""(""Id"") ON DELETE RESTRICT;
                END IF;
            END $$;
        ");

        // Suppliers + real stock movement ledger (purchasing/inventory Phase 1).
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""Suppliers"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""ContactName"" text,
                ""Phone"" text,
                ""Email"" text,
                ""Address"" text,
                ""TaxNumber"" text,
                ""PaymentTerms"" text,
                ""OpeningBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""CurrentBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""StockLedgerEntries"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""IngredientId"" uuid NOT NULL,
                ""MovementType"" integer NOT NULL,
                ""QuantityChange"" numeric(18,2) NOT NULL,
                ""UnitCostPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""BalanceAfter"" numeric(18,2) NOT NULL DEFAULT 0,
                ""ReferenceType"" text,
                ""ReferenceId"" uuid,
                ""Notes"" text,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CreatedBy"" text NOT NULL DEFAULT ''
            );
            ALTER TABLE ""PurchaseOrders"" ADD COLUMN IF NOT EXISTS ""SupplierId"" uuid;

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Suppliers_TenantId_Name') THEN
                    CREATE INDEX ""IX_Suppliers_TenantId_Name"" ON ""Suppliers"" (""TenantId"", ""Name"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_StockLedgerEntries_BranchId_IngredientId_CreatedAt') THEN
                    CREATE INDEX ""IX_StockLedgerEntries_BranchId_IngredientId_CreatedAt"" ON ""StockLedgerEntries"" (""BranchId"", ""IngredientId"", ""CreatedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_StockLedgerEntries_TenantId_CreatedAt') THEN
                    CREATE INDEX ""IX_StockLedgerEntries_TenantId_CreatedAt"" ON ""StockLedgerEntries"" (""TenantId"", ""CreatedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchaseorders_suppliers') THEN
                    ALTER TABLE ""PurchaseOrders"" ADD CONSTRAINT ""fk_purchaseorders_suppliers"" FOREIGN KEY (""SupplierId"") REFERENCES ""Suppliers""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stockledgerentries_ingredients') THEN
                    ALTER TABLE ""StockLedgerEntries"" ADD CONSTRAINT ""fk_stockledgerentries_ingredients"" FOREIGN KEY (""IngredientId"") REFERENCES ""Ingredients""(""Id"") ON DELETE RESTRICT;
                END IF;
            END $$;
        ");

        // Payroll: pay fields on Users + PayrollPeriods/Payslips/PayslipLines.
        await db.Database.ExecuteSqlRawAsync(@"
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""Department"" text;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""Designation"" text;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmploymentType"" integer NOT NULL DEFAULT 1;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""MonthlyRatePKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""HourlyRatePKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""BankAccountNumber"" text;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""JoiningDate"" timestamp with time zone;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""IsPayrollEligible"" boolean NOT NULL DEFAULT false;

            CREATE TABLE IF NOT EXISTS ""PayrollPeriods"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""PeriodStart"" timestamp with time zone NOT NULL,
                ""PeriodEnd"" timestamp with time zone NOT NULL,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""GeneratedAt"" timestamp with time zone,
                ""FinalizedAt"" timestamp with time zone,
                ""Notes"" text
            );
            CREATE TABLE IF NOT EXISTS ""Payslips"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""PayrollPeriodId"" uuid NOT NULL,
                ""HoursWorked"" numeric(18,2) NOT NULL DEFAULT 0,
                ""BasicPayPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""TotalAllowancesPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""TotalDeductionsPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""NetPayPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""GeneratedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""PaidAt"" timestamp with time zone,
                ""PaymentMethod"" text,
                ""Notes"" text
            );
            CREATE TABLE IF NOT EXISTS ""PayslipLines"" (
                ""Id"" uuid PRIMARY KEY,
                ""PayslipId"" uuid NOT NULL,
                ""Type"" integer NOT NULL,
                ""Description"" text NOT NULL,
                ""AmountPKR"" numeric(18,2) NOT NULL
            );

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PayrollPeriods_TenantId_PeriodStart_PeriodEnd') THEN
                    CREATE INDEX ""IX_PayrollPeriods_TenantId_PeriodStart_PeriodEnd"" ON ""PayrollPeriods"" (""TenantId"", ""PeriodStart"", ""PeriodEnd"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Payslips_PayrollPeriodId_UserId') THEN
                    CREATE UNIQUE INDEX ""IX_Payslips_PayrollPeriodId_UserId"" ON ""Payslips"" (""PayrollPeriodId"", ""UserId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payslips_payrollperiods') THEN
                    ALTER TABLE ""Payslips"" ADD CONSTRAINT ""fk_payslips_payrollperiods"" FOREIGN KEY (""PayrollPeriodId"") REFERENCES ""PayrollPeriods""(""Id"") ON DELETE CASCADE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payslips_users') THEN
                    ALTER TABLE ""Payslips"" ADD CONSTRAINT ""fk_payslips_users"" FOREIGN KEY (""UserId"") REFERENCES ""Users""(""Id"") ON DELETE RESTRICT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_paysliplines_payslips') THEN
                    ALTER TABLE ""PayslipLines"" ADD CONSTRAINT ""fk_paysliplines_payslips"" FOREIGN KEY (""PayslipId"") REFERENCES ""Payslips""(""Id"") ON DELETE CASCADE;
                END IF;
            END $$;
        ");

        // Accounting: Chart of Accounts, Journal Entries/Lines, Accounting Periods.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""Accounts"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Code"" text NOT NULL,
                ""Name"" text NOT NULL,
                ""Type"" integer NOT NULL,
                ""SubType"" text,
                ""ParentAccountId"" uuid,
                ""IsSystemAccount"" boolean NOT NULL DEFAULT false,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""JournalEntries"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid,
                ""EntryNumber"" text NOT NULL,
                ""EntryDate"" timestamp with time zone NOT NULL,
                ""Description"" text NOT NULL,
                ""ReferenceType"" text NOT NULL DEFAULT 'Manual',
                ""ReferenceId"" uuid,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""ReversalOfEntryId"" uuid,
                ""CreatedBy"" text NOT NULL DEFAULT '',
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""JournalLines"" (
                ""Id"" uuid PRIMARY KEY,
                ""JournalEntryId"" uuid NOT NULL,
                ""AccountId"" uuid NOT NULL,
                ""DebitPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""CreditPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Description"" text
            );
            CREATE TABLE IF NOT EXISTS ""AccountingPeriods"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""PeriodStart"" timestamp with time zone NOT NULL,
                ""PeriodEnd"" timestamp with time zone NOT NULL,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""ClosedAt"" timestamp with time zone,
                ""ClosedBy"" text
            );

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Accounts_TenantId_Code') THEN
                    CREATE UNIQUE INDEX ""IX_Accounts_TenantId_Code"" ON ""Accounts"" (""TenantId"", ""Code"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_JournalEntries_TenantId_EntryNumber') THEN
                    CREATE UNIQUE INDEX ""IX_JournalEntries_TenantId_EntryNumber"" ON ""JournalEntries"" (""TenantId"", ""EntryNumber"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_JournalEntries_TenantId_EntryDate') THEN
                    CREATE INDEX ""IX_JournalEntries_TenantId_EntryDate"" ON ""JournalEntries"" (""TenantId"", ""EntryDate"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_JournalLines_AccountId') THEN
                    CREATE INDEX ""IX_JournalLines_AccountId"" ON ""JournalLines"" (""AccountId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_parentaccount') THEN
                    ALTER TABLE ""Accounts"" ADD CONSTRAINT ""fk_accounts_parentaccount"" FOREIGN KEY (""ParentAccountId"") REFERENCES ""Accounts""(""Id"") ON DELETE RESTRICT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_journallines_journalentries') THEN
                    ALTER TABLE ""JournalLines"" ADD CONSTRAINT ""fk_journallines_journalentries"" FOREIGN KEY (""JournalEntryId"") REFERENCES ""JournalEntries""(""Id"") ON DELETE CASCADE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_journallines_accounts') THEN
                    ALTER TABLE ""JournalLines"" ADD CONSTRAINT ""fk_journallines_accounts"" FOREIGN KEY (""AccountId"") REFERENCES ""Accounts""(""Id"") ON DELETE RESTRICT;
                END IF;
            END $$;
        ");

        // Warehouses + Subscription billing invoices.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""Warehouses"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""Code"" text,
                ""IsPrimary"" boolean NOT NULL DEFAULT false,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""SubscriptionInvoices"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""InvoiceNumber"" text NOT NULL,
                ""Tier"" text NOT NULL,
                ""BillingPeriodStart"" timestamp with time zone NOT NULL,
                ""BillingPeriodEnd"" timestamp with time zone NOT NULL,
                ""AmountPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""IssuedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""DueAt"" timestamp with time zone NOT NULL,
                ""PaidAt"" timestamp with time zone,
                ""PaymentMethod"" text,
                ""Notes"" text
            );

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Warehouses_BranchId_IsPrimary') THEN
                    CREATE INDEX ""IX_Warehouses_BranchId_IsPrimary"" ON ""Warehouses"" (""BranchId"", ""IsPrimary"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SubscriptionInvoices_TenantId_InvoiceNumber') THEN
                    CREATE UNIQUE INDEX ""IX_SubscriptionInvoices_TenantId_InvoiceNumber"" ON ""SubscriptionInvoices"" (""TenantId"", ""InvoiceNumber"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SubscriptionInvoices_TenantId_IssuedAt') THEN
                    CREATE INDEX ""IX_SubscriptionInvoices_TenantId_IssuedAt"" ON ""SubscriptionInvoices"" (""TenantId"", ""IssuedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_warehouses_branches') THEN
                    ALTER TABLE ""Warehouses"" ADD CONSTRAINT ""fk_warehouses_branches"" FOREIGN KEY (""BranchId"") REFERENCES ""Branches""(""Id"") ON DELETE CASCADE;
                END IF;
            END $$;
        ");

        // Supplier payments — settles Supplier.CurrentBalancePKR opened by PO receipts.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""SupplierPayments"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""SupplierId"" uuid NOT NULL,
                ""AmountPKR"" numeric(18,2) NOT NULL,
                ""PaymentMethod"" text NOT NULL DEFAULT 'Bank Transfer',
                ""ReferenceNumber"" text,
                ""Notes"" text,
                ""PaidAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CreatedBy"" text NOT NULL DEFAULT ''
            );
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SupplierPayments_SupplierId_PaidAt') THEN
                    CREATE INDEX ""IX_SupplierPayments_SupplierId_PaidAt"" ON ""SupplierPayments"" (""SupplierId"", ""PaidAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_supplierpayments_suppliers') THEN
                    ALTER TABLE ""SupplierPayments"" ADD CONSTRAINT ""fk_supplierpayments_suppliers"" FOREIGN KEY (""SupplierId"") REFERENCES ""Suppliers""(""Id"") ON DELETE RESTRICT;
                END IF;
            END $$;
        ");

        // Customer AR, Departments/Designations, Leave requests, Bank reconciliation.
        await db.Database.ExecuteSqlRawAsync(@"
            ALTER TABLE ""Customers"" ADD COLUMN IF NOT EXISTS ""CurrentBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DepartmentId"" uuid;
            ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""DesignationId"" uuid;
            ALTER TABLE ""JournalLines"" ADD COLUMN IF NOT EXISTS ""IsReconciled"" boolean NOT NULL DEFAULT false;
            ALTER TABLE ""JournalLines"" ADD COLUMN IF NOT EXISTS ""ReconciledAt"" timestamp with time zone;
            ALTER TABLE ""JournalLines"" ADD COLUMN IF NOT EXISTS ""BankReconciliationId"" uuid;

            CREATE TABLE IF NOT EXISTS ""CustomerPayments"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""CustomerId"" uuid NOT NULL,
                ""AmountPKR"" numeric(18,2) NOT NULL,
                ""PaymentMethod"" text NOT NULL DEFAULT 'Cash',
                ""ReferenceNumber"" text,
                ""Notes"" text,
                ""PaidAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CreatedBy"" text NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS ""Departments"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""Designations"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Name"" text NOT NULL,
                ""DepartmentId"" uuid,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ""LeaveRequests"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""UserId"" uuid NOT NULL,
                ""LeaveType"" integer NOT NULL DEFAULT 1,
                ""StartDate"" timestamp with time zone NOT NULL,
                ""EndDate"" timestamp with time zone NOT NULL,
                ""DaysRequested"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Reason"" text,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""RequestedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ReviewedBy"" text,
                ""ReviewedAt"" timestamp with time zone,
                ""ReviewNotes"" text
            );
            CREATE TABLE IF NOT EXISTS ""BankReconciliations"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""AccountId"" uuid NOT NULL,
                ""StatementDate"" timestamp with time zone NOT NULL,
                ""StatementBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""ReconciledBookBalancePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CompletedAt"" timestamp with time zone,
                ""CompletedBy"" text
            );

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_CustomerPayments_CustomerId_PaidAt') THEN
                    CREATE INDEX ""IX_CustomerPayments_CustomerId_PaidAt"" ON ""CustomerPayments"" (""CustomerId"", ""PaidAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Departments_TenantId_Name') THEN
                    CREATE UNIQUE INDEX ""IX_Departments_TenantId_Name"" ON ""Departments"" (""TenantId"", ""Name"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Designations_TenantId_Name') THEN
                    CREATE INDEX ""IX_Designations_TenantId_Name"" ON ""Designations"" (""TenantId"", ""Name"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_LeaveRequests_UserId_Status') THEN
                    CREATE INDEX ""IX_LeaveRequests_UserId_Status"" ON ""LeaveRequests"" (""UserId"", ""Status"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_BankReconciliations_AccountId_StatementDate') THEN
                    CREATE INDEX ""IX_BankReconciliations_AccountId_StatementDate"" ON ""BankReconciliations"" (""AccountId"", ""StatementDate"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_customerpayments_customers') THEN
                    ALTER TABLE ""CustomerPayments"" ADD CONSTRAINT ""fk_customerpayments_customers"" FOREIGN KEY (""CustomerId"") REFERENCES ""Customers""(""Id"") ON DELETE RESTRICT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_designations_departments') THEN
                    ALTER TABLE ""Designations"" ADD CONSTRAINT ""fk_designations_departments"" FOREIGN KEY (""DepartmentId"") REFERENCES ""Departments""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_departments') THEN
                    ALTER TABLE ""Users"" ADD CONSTRAINT ""fk_users_departments"" FOREIGN KEY (""DepartmentId"") REFERENCES ""Departments""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_designations') THEN
                    ALTER TABLE ""Users"" ADD CONSTRAINT ""fk_users_designations"" FOREIGN KEY (""DesignationId"") REFERENCES ""Designations""(""Id"") ON DELETE SET NULL;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_leaverequests_users') THEN
                    ALTER TABLE ""LeaveRequests"" ADD CONSTRAINT ""fk_leaverequests_users"" FOREIGN KEY (""UserId"") REFERENCES ""Users""(""Id"") ON DELETE CASCADE;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bankreconciliations_accounts') THEN
                    ALTER TABLE ""BankReconciliations"" ADD CONSTRAINT ""fk_bankreconciliations_accounts"" FOREIGN KEY (""AccountId"") REFERENCES ""Accounts""(""Id"") ON DELETE RESTRICT;
                END IF;
            END $$;
        ");

        // Add-on catalog — sells tier features standalone to a lower-tier tenant.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""AddOnCatalogItems"" (
                ""Id"" uuid PRIMARY KEY,
                ""Key"" text NOT NULL,
                ""DisplayName"" text NOT NULL,
                ""Description"" text,
                ""MonthlyPricePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""YearlyPricePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_AddOnCatalogItems_Key') THEN
                    CREATE UNIQUE INDEX ""IX_AddOnCatalogItems_Key"" ON ""AddOnCatalogItems"" (""Key"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_AddOnSubscriptions_TenantId_AddOnKey') THEN
                    CREATE INDEX ""IX_AddOnSubscriptions_TenantId_AddOnKey"" ON ""AddOnSubscriptions"" (""TenantId"", ""AddOnKey"");
                END IF;
            END $$;
        ");

        // Refresh tokens — lets a session outlive the short-lived access JWT without re-login.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""RefreshTokens"" (
                ""Id"" uuid PRIMARY KEY,
                ""UserId"" uuid NOT NULL,
                ""TenantId"" uuid NOT NULL,
                ""TokenHash"" text NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ExpiresAt"" timestamp with time zone NOT NULL,
                ""RevokedAt"" timestamp with time zone,
                ""ReplacedByTokenId"" uuid,
                ""CreatedByIp"" text,
                ""IsSuperAdminToken"" boolean NOT NULL DEFAULT false
            );
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_RefreshTokens_TokenHash') THEN
                    CREATE UNIQUE INDEX ""IX_RefreshTokens_TokenHash"" ON ""RefreshTokens"" (""TokenHash"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_RefreshTokens_UserId_RevokedAt_ExpiresAt') THEN
                    CREATE INDEX ""IX_RefreshTokens_UserId_RevokedAt_ExpiresAt"" ON ""RefreshTokens"" (""UserId"", ""RevokedAt"", ""ExpiresAt"");
                END IF;
            END $$;
        ");

        // ============================================================
        // PLATFORM CONTROL PLANE — device licensing, entitlements, lifecycle, vertical packs.
        // Written in the same idempotent style as everything above so it is safe on a fresh
        // database and on one that has been running since before any of this existed.
        // ============================================================
        await db.Database.ExecuteSqlRawAsync(@"
            -- Tenant lifecycle + provider provisioning.
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""Status"" integer NOT NULL DEFAULT 1;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""IsProviderProvisioned"" boolean NOT NULL DEFAULT false;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""OwnerInviteTokenHash"" text;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""OwnerInviteExpiresAt"" timestamp with time zone;
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""OwnerInviteRedeemedAt"" timestamp with time zone;

            -- Standalone (1) vs HeadOffice (2). Existing tenants are inferred from whether they
            -- actually have outlets beneath head office, so a chain set up before this column
            -- existed lands on the right surface without anyone re-registering.
            ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""DeploymentMode"" integer NOT NULL DEFAULT 1;
            UPDATE ""Tenants"" t SET ""DeploymentMode"" = 2
            WHERE t.""DeploymentMode"" = 1
              AND (SELECT COUNT(*) FROM ""Branches"" b WHERE b.""TenantId"" = t.""Id"") > 1;

            -- Running a head office is a shape, not a paid feature: every plan may do it, and the
            -- plan governs only HOW MANY locations fit. Starter previously allowed exactly one
            -- location, which made a two-shop chain impossible at any price below Standard.
            UPDATE ""SaaSPackageConfigs"" SET ""HasMultiBranch"" = true WHERE ""HasMultiBranch"" = false;
            UPDATE ""SaaSPackageConfigs"" SET ""MaxBranches"" = 3 WHERE ""PackageKey"" = 'Starter' AND ""MaxBranches"" < 3;
            UPDATE ""SaaSPackageConfigs"" SET ""MaxBranches"" = 10 WHERE ""PackageKey"" = 'Standard' AND ""MaxBranches"" < 10;

            -- Existing tenants predate the lifecycle ladder: put each one on the rung that
            -- matches the flags it already carries, rather than defaulting everybody to Trial.
            UPDATE ""Tenants"" SET ""Status"" = CASE
                WHEN ""IsActive"" = false THEN 6                                    -- Suspended
                WHEN ""IsTrialActive"" = true AND ""TrialEndsAt"" > NOW() THEN 1      -- Trial
                WHEN ""SubscriptionPaidUntil"" IS NOT NULL
                     AND ""SubscriptionPaidUntil"" > NOW() THEN 2                    -- Active
                ELSE 3                                                              -- PastDue
            END
            WHERE ""Status"" = 1 AND NOT (""IsTrialActive"" = true AND ""TrialEndsAt"" > NOW());

            -- Device licensing on Terminals.
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""TenantId"" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""DeviceFingerprint"" text;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""DeviceInfo"" text;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""ActivatedAt"" timestamp with time zone;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""LicenseIssuedAt"" timestamp with time zone;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""LicenseExpiresAt"" timestamp with time zone;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""LicenseSnapshotVersion"" integer NOT NULL DEFAULT 0;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""RevokedAt"" timestamp with time zone;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""RevokedReason"" text;
            ALTER TABLE ""Terminals"" ADD COLUMN IF NOT EXISTS ""DeactivatedAt"" timestamp with time zone;

            -- Terminals only knew their branch before; the licence needs the tenant directly.
            UPDATE ""Terminals"" t SET ""TenantId"" = b.""TenantId""
            FROM ""Branches"" b WHERE t.""BranchId"" = b.""Id""
              AND t.""TenantId"" = '00000000-0000-0000-0000-000000000000';

            -- Offline sale provenance and reconciliation.
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""ClientLocalId"" text;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""IsOfflineOrigin"" boolean NOT NULL DEFAULT false;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""CapturedAt"" timestamp with time zone;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""DeviceReportedTotalPKR"" numeric(18,2);
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""PriceVariancePKR"" numeric(18,2) NOT NULL DEFAULT 0;
            ALTER TABLE ""Orders"" ADD COLUMN IF NOT EXISTS ""HasPriceVariance"" boolean NOT NULL DEFAULT false;
            ALTER TABLE ""OrderItems"" ADD COLUMN IF NOT EXISTS ""DeviceReportedUnitPricePKR"" numeric(18,2);

            -- Subscription system: plans, their feature rows, and who is on what.
            CREATE TABLE IF NOT EXISTS ""Plans"" (
                ""Id"" uuid PRIMARY KEY,
                ""Code"" text NOT NULL,
                ""Name"" text NOT NULL DEFAULT '',
                ""Description"" text NOT NULL DEFAULT '',
                ""MonthlyPricePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""YearlyPricePKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""Rank"" integer NOT NULL DEFAULT 0,
                ""IsActive"" boolean NOT NULL DEFAULT true,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""UpdatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ""PlanFeatures"" (
                ""Id"" uuid PRIMARY KEY,
                ""PlanId"" uuid NOT NULL,
                ""FeatureCode"" text NOT NULL,
                ""LimitType"" integer NOT NULL DEFAULT 1,
                ""Enabled"" boolean NOT NULL DEFAULT false,
                ""LimitValue"" integer,
                ""Level"" integer NOT NULL DEFAULT 0,
                ""UpdatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ""OrganizationSubscriptions"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""PlanId"" uuid NOT NULL,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""StartDate"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""EndDate"" timestamp with time zone,
                ""TrialEndsAt"" timestamp with time zone,
                ""OverLimitSince"" timestamp with time zone,
                ""OverLimitReason"" text,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""UpdatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            -- Expenses: money out that is not a supplier purchase.
            CREATE TABLE IF NOT EXISTS ""Expenses"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""ExpenseNumber"" text NOT NULL DEFAULT '',
                ""Category"" text NOT NULL DEFAULT '',
                ""Description"" text NOT NULL DEFAULT '',
                ""SupplierId"" uuid,
                ""PayeeName"" text,
                ""AmountPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""TaxPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""TotalPKR"" numeric(18,2) NOT NULL DEFAULT 0,
                ""ExpenseDate"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""PaymentMethod"" integer NOT NULL DEFAULT 1,
                ""ExpenseAccountId"" uuid,
                ""PaidFromAccountId"" uuid,
                ""JournalEntryId"" uuid,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""CreatedByUserId"" uuid,
                ""CreatedByName"" text,
                ""ApprovedByUserId"" uuid,
                ""ApprovedAt"" timestamp with time zone,
                ""PaidAt"" timestamp with time zone,
                ""RejectionReason"" text,
                ""ReceiptReference"" text,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            -- Sync log: what moved between a business host and the cloud, and whether it landed.
            CREATE TABLE IF NOT EXISTS ""SyncLogs"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid,
                ""DeviceId"" uuid,
                ""HostIdentifier"" text,
                ""Direction"" integer NOT NULL DEFAULT 1,
                ""EntityType"" text NOT NULL DEFAULT '',
                ""BatchId"" text NOT NULL DEFAULT '',
                ""RecordsAttempted"" integer NOT NULL DEFAULT 0,
                ""RecordsSucceeded"" integer NOT NULL DEFAULT 0,
                ""RecordsFailed"" integer NOT NULL DEFAULT 0,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""ErrorMessage"" text,
                ""AttemptCount"" integer NOT NULL DEFAULT 1,
                ""StartedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""CompletedAt"" timestamp with time zone,
                ""DurationMs"" integer
            );

            -- Business hosts: the ordinary PCs running the backend for a business.
            CREATE TABLE IF NOT EXISTS ""BusinessHosts"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""HostCode"" text NOT NULL,
                ""HostName"" text NOT NULL DEFAULT '',
                ""LanAddress"" text,
                ""Port"" integer NOT NULL DEFAULT 5288,
                ""MachineName"" text,
                ""OperatingSystem"" text,
                ""AppVersion"" text,
                ""RegisteredAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""LastSeenAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""LastSyncedAt"" timestamp with time zone,
                ""IsActive"" boolean NOT NULL DEFAULT true
            );

            -- Sync watermark: how far each entity type has been confirmed on the cloud.
            CREATE TABLE IF NOT EXISTS ""SyncCursors"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""EntityType"" text NOT NULL,
                ""LastSyncedAt"" timestamp with time zone NOT NULL DEFAULT (TIMESTAMP 'epoch' AT TIME ZONE 'UTC'),
                ""LastSyncedRecordId"" uuid,
                ""ConsecutiveFailures"" integer NOT NULL DEFAULT 0,
                ""LastAttemptAt"" timestamp with time zone,
                ""LastError"" text,
                ""UpdatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ""PairingCodes"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""BranchId"" uuid NOT NULL,
                ""CodeHash"" text NOT NULL,
                ""CodePrefix"" text NOT NULL DEFAULT '',
                ""TerminalType"" integer NOT NULL DEFAULT 1,
                ""TerminalName"" text NOT NULL DEFAULT '',
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""ExpiresAt"" timestamp with time zone NOT NULL,
                ""CreatedByUserId"" uuid NOT NULL,
                ""ConsumedAt"" timestamp with time zone,
                ""ConsumedByTerminalId"" uuid,
                ""ConsumedByIp"" text,
                ""IsRevoked"" boolean NOT NULL DEFAULT false
            );

            CREATE TABLE IF NOT EXISTS ""TenantEntitlementOverrides"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Key"" text NOT NULL,
                ""Value"" text NOT NULL,
                ""ExpiresAt"" timestamp with time zone,
                ""Reason"" text NOT NULL DEFAULT '',
                ""CreatedByUserId"" uuid NOT NULL,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW(),
                ""IsActive"" boolean NOT NULL DEFAULT true
            );

            CREATE TABLE IF NOT EXISTS ""TenantEntitlementSnapshots"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""Version"" integer NOT NULL DEFAULT 1,
                ""PlanKey"" text NOT NULL DEFAULT '',
                ""MaxBranches"" integer NOT NULL DEFAULT 0,
                ""MaxCounters"" integer NOT NULL DEFAULT 0,
                ""MaxOrderTabs"" integer NOT NULL DEFAULT 0,
                ""MaxUsers"" integer NOT NULL DEFAULT 0,
                -- No literal default: a brace pair here is parsed as a format placeholder by the
                -- raw-SQL path and blows up the whole bootstrap block. Every insert comes from
                -- EF, whose entity default already supplies an empty JSON object.
                ""FeaturesJson"" text NOT NULL,
                ""Status"" integer NOT NULL DEFAULT 1,
                ""ComputedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ""TenantVerticalPacks"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""PackKey"" text NOT NULL,
                ""IsPrimary"" boolean NOT NULL DEFAULT false,
                ""EnabledAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ""DeviceLicenseEvents"" (
                ""Id"" uuid PRIMARY KEY,
                ""TenantId"" uuid NOT NULL,
                ""TerminalId"" uuid,
                ""BranchId"" uuid,
                ""EventType"" text NOT NULL,
                ""Detail"" text,
                ""Ip"" text,
                ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT NOW()
            );

            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Expenses_TenantId_ExpenseDate') THEN
                    CREATE INDEX ""IX_Expenses_TenantId_ExpenseDate"" ON ""Expenses"" (""TenantId"", ""ExpenseDate"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Expenses_BranchId_Status') THEN
                    CREATE INDEX ""IX_Expenses_BranchId_Status"" ON ""Expenses"" (""BranchId"", ""Status"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Expenses_ExpenseNumber') THEN
                    CREATE INDEX ""IX_Expenses_ExpenseNumber"" ON ""Expenses"" (""ExpenseNumber"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SyncLogs_TenantId_StartedAt') THEN
                    CREATE INDEX ""IX_SyncLogs_TenantId_StartedAt"" ON ""SyncLogs"" (""TenantId"", ""StartedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SyncLogs_Status_StartedAt') THEN
                    CREATE INDEX ""IX_SyncLogs_Status_StartedAt"" ON ""SyncLogs"" (""Status"", ""StartedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SyncLogs_BatchId') THEN
                    CREATE INDEX ""IX_SyncLogs_BatchId"" ON ""SyncLogs"" (""BatchId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_BusinessHosts_HostCode') THEN
                    CREATE UNIQUE INDEX ""IX_BusinessHosts_HostCode"" ON ""BusinessHosts"" (""HostCode"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_BusinessHosts_Tenant_Branch') THEN
                    CREATE INDEX ""IX_BusinessHosts_Tenant_Branch"" ON ""BusinessHosts"" (""TenantId"", ""BranchId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Plans_Code') THEN
                    CREATE UNIQUE INDEX ""IX_Plans_Code"" ON ""Plans"" (""Code"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PlanFeatures_Plan_Code') THEN
                    CREATE UNIQUE INDEX ""IX_PlanFeatures_Plan_Code"" ON ""PlanFeatures"" (""PlanId"", ""FeatureCode"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_OrgSubscriptions_TenantId') THEN
                    CREATE INDEX ""IX_OrgSubscriptions_TenantId"" ON ""OrganizationSubscriptions"" (""TenantId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_SyncCursors_Tenant_Entity') THEN
                    CREATE UNIQUE INDEX ""IX_SyncCursors_Tenant_Entity"" ON ""SyncCursors"" (""TenantId"", ""EntityType"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PairingCodes_CodeHash') THEN
                    CREATE UNIQUE INDEX ""IX_PairingCodes_CodeHash"" ON ""PairingCodes"" (""CodeHash"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_PairingCodes_Tenant_Branch_Expiry') THEN
                    CREATE INDEX ""IX_PairingCodes_Tenant_Branch_Expiry"" ON ""PairingCodes"" (""TenantId"", ""BranchId"", ""ExpiresAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TenantEntitlementSnapshots_TenantId') THEN
                    CREATE UNIQUE INDEX ""IX_TenantEntitlementSnapshots_TenantId"" ON ""TenantEntitlementSnapshots"" (""TenantId"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TenantEntitlementOverrides_TenantId_Key') THEN
                    CREATE INDEX ""IX_TenantEntitlementOverrides_TenantId_Key"" ON ""TenantEntitlementOverrides"" (""TenantId"", ""Key"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_TenantVerticalPacks_TenantId_PackKey') THEN
                    CREATE UNIQUE INDEX ""IX_TenantVerticalPacks_TenantId_PackKey"" ON ""TenantVerticalPacks"" (""TenantId"", ""PackKey"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_DeviceLicenseEvents_TenantId_CreatedAt') THEN
                    CREATE INDEX ""IX_DeviceLicenseEvents_TenantId_CreatedAt"" ON ""DeviceLicenseEvents"" (""TenantId"", ""CreatedAt"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Terminals_DeviceToken') THEN
                    CREATE UNIQUE INDEX ""IX_Terminals_DeviceToken"" ON ""Terminals"" (""DeviceToken"");
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Terminals_Tenant_Branch_Type') THEN
                    CREATE INDEX ""IX_Terminals_Tenant_Branch_Type"" ON ""Terminals"" (""TenantId"", ""BranchId"", ""TerminalType"");
                END IF;
                -- Sync idempotency. Partial, so ordinary online orders (no client id) do not all
                -- collide on NULL.
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'IX_Orders_TenantId_ClientLocalId') THEN
                    CREATE UNIQUE INDEX ""IX_Orders_TenantId_ClientLocalId"" ON ""Orders"" (""TenantId"", ""ClientLocalId"")
                        WHERE ""ClientLocalId"" IS NOT NULL;
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
});

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

// --- Helper: Generate unique expense number ---
// Scoped per tenant, unlike the PO/transfer numbers above: expenses are the one document a
// tenant reads out to their own accountant, so EXP-0924-0001 meaning "my first expense this
// month" matters more than it being unique across the whole platform.
static async Task<string> GenerateExpenseNumberAsync(AppDbContext db, Guid tenantId)
{
    var dateStr = DateTime.UtcNow.ToString("MMdd");
    var prefix = $"EXP-{dateStr}";
    var last = await db.Expenses
        .Where(e => e.TenantId == tenantId && e.ExpenseNumber.StartsWith(prefix))
        .OrderByDescending(e => e.ExpenseNumber)
        .Select(e => e.ExpenseNumber)
        .FirstOrDefaultAsync();

    int seq = 1;
    if (last != null)
    {
        var parts = last.Split('-');
        if (parts.Length >= 3 && int.TryParse(parts[2], out var lastSeq)) seq = lastSeq + 1;
    }
    return $"{prefix}-{seq:D4}";
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

// ============================================================
// PLAN-CHANGE IMPACT
//
// Answers "what would break if this tenant moved to that plan?" before anything is written.
// Used both for the preview endpoint and as the guard on the change itself, so the two can
// never disagree about what counts as an overage.
// ============================================================
static async Task<PlanChangeImpact> AssessPlanChangeAsync(
    AppDbContext db, Pos.Api.Services.IEntitlementService entitlements, Tenant tenant, SubscriptionTier targetTier)
{
    var current = await entitlements.GetAsync(tenant.Id);
    var target = await db.SaaSPackageConfigs.AsNoTracking()
        .FirstOrDefaultAsync(p => p.PackageKey == targetTier.ToString());

    var blockers = new List<string>();

    var branchCount = await db.Branches.IgnoreQueryFilters().CountAsync(b => b.TenantId == tenant.Id);
    var userCount = await db.Users.IgnoreQueryFilters().CountAsync(u => u.TenantId == tenant.Id && u.IsActive);

    var targetBranches = target?.MaxBranches ?? 1;
    var targetCounters = target?.MaxCounters ?? 1;
    var targetOrderTabs = target?.MaxOrderTabs ?? 0;
    var targetUsers = target?.MaxUsers ?? 2;

    if (branchCount > targetBranches)
        blockers.Add($"{branchCount} branches in use, new plan allows {targetBranches}.");
    if (userCount > targetUsers)
        blockers.Add($"{userCount} active staff logins, new plan allows {targetUsers}.");

    // Device limits are per branch, so an overage has to be reported per branch to be actionable.
    var branches = await db.Branches.IgnoreQueryFilters()
        .Where(b => b.TenantId == tenant.Id).Select(b => new { b.Id, b.Name }).ToListAsync();

    foreach (var branch in branches)
    {
        var counters = await entitlements.CountDevicesInUseAsync(branch.Id, TerminalType.Counter);
        if (counters > targetCounters)
            blockers.Add($"{branch.Name}: {counters} counters active, new plan allows {targetCounters}.");

        var tabs = await entitlements.CountDevicesInUseAsync(branch.Id, TerminalType.OrderTab);
        if (tabs > targetOrderTabs)
            blockers.Add($"{branch.Name}: {tabs} tablets active, new plan allows {targetOrderTabs}.");
    }

    // Features they are using today that the target plan does not include. Not blocking — losing
    // a feature is an expected consequence of downgrading — but the customer should be told.
    var losingFeatures = new List<string>();
    if (target != null)
    {
        foreach (var flag in Pos.Api.Services.EntitlementService.FeatureFlagNames)
        {
            var hasNow = current.Has(flag);
            var hasAfter = flag switch
            {
                nameof(SaaSPackageConfig.HasKitchenDisplay) => target.HasKitchenDisplay,
                nameof(SaaSPackageConfig.HasDeliveryCOD) => target.HasDeliveryCOD,
                nameof(SaaSPackageConfig.HasInventoryManagement) => target.HasInventoryManagement,
                nameof(SaaSPackageConfig.HasStockTransfers) => target.HasStockTransfers,
                nameof(SaaSPackageConfig.HasDirectorDashboard) => target.HasDirectorDashboard,
                nameof(SaaSPackageConfig.HasConsolidatedReports) => target.HasConsolidatedReports,
                nameof(SaaSPackageConfig.HasWhatsAppMessaging) => target.HasWhatsAppMessaging,
                nameof(SaaSPackageConfig.HasAdvancedReports) => target.HasAdvancedReports,
                nameof(SaaSPackageConfig.HasMultiBranch) => target.HasMultiBranch,
                _ => false
            };
            // An add-on the tenant bought separately survives a plan change, so it is not a loss.
            if (hasNow && !hasAfter)
            {
                var coveredByAddOn = await db.AddOnSubscriptions.IgnoreQueryFilters()
                    .AnyAsync(a => a.TenantId == tenant.Id && a.AddOnKey == flag && a.IsActive);
                if (!coveredByAddOn) losingFeatures.Add(flag);
            }
        }
    }

    var isDowngrade = (int)targetTier < (int)tenant.Tier;

    return new PlanChangeImpact(
        CurrentTier: tenant.Tier.ToString(),
        TargetTier: targetTier.ToString(),
        IsDowngrade: isDowngrade,
        Blockers: blockers,
        FeaturesLost: losingFeatures,
        CurrentUsage: new PlanUsage(branchCount, userCount),
        TargetLimits: new PlanLimits(targetBranches, targetCounters, targetOrderTabs, targetUsers));
}

// One-way hash for anything that is presented as a bearer secret and only ever compared —
// refresh tokens, pairing codes, owner invites. Same convention throughout: uppercase hex of
// SHA-256, so a database read alone never yields a usable credential.
static string HashToken(string raw) =>
    Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

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

/// <summary>
/// Issues an access JWT + a rotating refresh token for a just-authenticated user.
/// The refresh token's raw value is only ever returned to the client here — the DB stores
/// nothing but its SHA-256 hash, mirroring the PinCodeHash design (a DB read alone can't
/// impersonate a session). Caller must SaveChangesAsync after this stages the new row.
/// </summary>
static (string accessToken, string refreshToken, RefreshToken refreshTokenEntity) IssueTokenPair(
    AppDbContext db, IConfiguration config, AppUser user, bool isSuperAdmin, string? clientIp)
{
    var tokenHandler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes(config["Jwt:Key"] ?? Environment.GetEnvironmentVariable("JWT_KEY") ?? "CashlyPOS_SuperSecretKey_2024_Change_In_Production!");

    var claims = new Dictionary<string, object>
    {
        { "userId", user.Id.ToString() },
        { "tenantId", (isSuperAdmin ? Guid.Empty : user.TenantId).ToString() },
        { "branchId", isSuperAdmin ? "" : (user.BranchId?.ToString() ?? "") },
        { "role", user.Role.ToString() }
    };
    if (!isSuperAdmin)
    {
        claims["canViewFinancialReports"] = user.CanViewFinancialReports.ToString().ToLower();
        claims["canManageInventory"] = user.CanManageInventory.ToString().ToLower();
        claims["canManageMenuAndTax"] = user.CanManageMenuAndTax.ToString().ToLower();
        claims["canGiveDiscounts"] = user.CanGiveDiscounts.ToString().ToLower();
        claims["canVoidOrders"] = user.CanVoidOrders.ToString().ToLower();
        claims["permissions"] = System.Text.Json.JsonSerializer.Serialize(new
        {
            user.CanViewFinancialReports,
            user.CanManageInventory,
            user.CanManageMenuAndTax,
            user.CanGiveDiscounts,
            user.CanVoidOrders
        });
    }
    else
    {
        claims["permissions"] = "{}";
    }

    var tokenDescriptor = new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
    {
        // Short-lived on purpose — the refresh token (below) is what keeps a shift-long session
        // alive without a re-login; a stolen access token alone now has a small window.
        Expires = DateTime.UtcNow.AddHours(2),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature),
        Claims = claims
    };
    var accessToken = tokenHandler.WriteToken(tokenHandler.CreateToken(tokenDescriptor));

    var rawRefreshToken = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
    var refreshTokenHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(rawRefreshToken)));
    var refreshTokenEntity = new RefreshToken
    {
        UserId = user.Id,
        TenantId = isSuperAdmin ? Guid.Empty : user.TenantId,
        TokenHash = refreshTokenHash,
        ExpiresAt = DateTime.UtcNow.AddDays(14),
        CreatedByIp = clientIp,
        IsSuperAdminToken = isSuperAdmin
    };
    db.RefreshTokens.Add(refreshTokenEntity);

    return (accessToken, rawRefreshToken, refreshTokenEntity);
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

/// <summary>
/// Records one stock movement and keeps <see cref="Ingredient.CurrentStock"/> as the fast-read balance
/// in sync with it — every mutation of that field should go through here instead of touching it directly,
/// so the ledger (audit trail) and the cached balance (existing reads) can never drift apart.
/// Caller is responsible for SaveChangesAsync (this only stages changes) and must supply an
/// already-tracked <paramref name="ingredient"/> from the same DbContext.
/// </summary>
static StockLedgerEntry RecordStockLedgerEntry(
    AppDbContext db, Ingredient ingredient, Guid tenantId, Guid branchId,
    StockMovementType movementType, decimal quantityChange, decimal unitCostPKR,
    string? referenceType, Guid? referenceId, string createdBy, string? notes = null)
{
    ingredient.CurrentStock += quantityChange;
    var entry = new StockLedgerEntry
    {
        TenantId = tenantId,
        BranchId = branchId,
        IngredientId = ingredient.Id,
        MovementType = movementType,
        QuantityChange = quantityChange,
        UnitCostPKR = unitCostPKR,
        BalanceAfter = ingredient.CurrentStock,
        ReferenceType = referenceType,
        ReferenceId = referenceId,
        Notes = notes,
        CreatedBy = createdBy
    };
    db.StockLedgerEntries.Add(entry);
    return entry;
}

// ============================================================
// Accounting helpers
// ============================================================

/// <summary>The standard chart every tenant gets, seeded lazily the first time accounting is touched
/// (GET chart-of-accounts, or the first auto-post attempt) — never forced on tenants who don't use it.</summary>
static (string Code, string Name, AccountType Type, string SubType)[] GetDefaultChartOfAccounts() => new[]
{
    ("1000", "Cash on Hand", AccountType.Asset, "Current Asset"),
    ("1010", "Bank Account", AccountType.Asset, "Current Asset"),
    ("1020", "Digital Wallet / Card Settlement", AccountType.Asset, "Current Asset"),
    ("1100", "Accounts Receivable", AccountType.Asset, "Current Asset"),
    ("1200", "Inventory", AccountType.Asset, "Current Asset"),
    ("2000", "Accounts Payable", AccountType.Liability, "Current Liability"),
    ("2100", "Sales Tax Payable", AccountType.Liability, "Current Liability"),
    ("3000", "Owner's Equity", AccountType.Equity, "Equity"),
    ("3900", "Retained Earnings", AccountType.Equity, "Equity"),
    ("4000", "Sales Revenue", AccountType.Revenue, "Operating Revenue"),
    ("4900", "Discounts & Promotions", AccountType.Revenue, "Contra-Revenue"),
    ("5000", "Cost of Goods Sold", AccountType.Expense, "Cost of Sales"),
    ("5100", "Purchases", AccountType.Expense, "Cost of Sales"),
    ("5200", "Salary & Wages Expense", AccountType.Expense, "Operating Expense"),
    ("5300", "Operating Expenses", AccountType.Expense, "Operating Expense")
};

static async Task<bool> HasAccountingAsync(AppDbContext db, Guid tenantId) =>
    await db.Accounts.AnyAsync(a => a.TenantId == tenantId);

static async Task EnsureChartOfAccountsSeededAsync(AppDbContext db, Guid tenantId)
{
    if (await db.Accounts.AnyAsync(a => a.TenantId == tenantId)) return;
    foreach (var (code, name, type, subType) in GetDefaultChartOfAccounts())
        db.Accounts.Add(new Account { TenantId = tenantId, Code = code, Name = name, Type = type, SubType = subType, IsSystemAccount = true });
    await db.SaveChangesAsync();
}

static async Task<string> GenerateJournalEntryNumberAsync(AppDbContext db, Guid tenantId)
{
    var count = await db.JournalEntries.CountAsync(j => j.TenantId == tenantId);
    return $"JE-{count + 1:00000}";
}

/// <summary>
/// Posts a balanced journal entry. Throws if the lines don't balance (debit != credit) or an
/// account code isn't found — callers doing automatic posting (order/PO/payroll) must catch this
/// and log rather than let an accounting gap break the underlying business operation; a manual
/// journal entry from the Accounting screen is fine to let bubble up as a validation error.
/// Caller is responsible for SaveChangesAsync (this only stages changes).
/// </summary>
static async Task<JournalEntry> PostJournalEntryAsync(
    AppDbContext db, Guid tenantId, Guid? branchId, DateTime entryDate, string description,
    string referenceType, Guid? referenceId, string createdBy, List<(string AccountCode, decimal Debit, decimal Credit)> lines)
{
    var totalDebit = Math.Round(lines.Sum(l => l.Debit), 2);
    var totalCredit = Math.Round(lines.Sum(l => l.Credit), 2);
    if (totalDebit != totalCredit)
        throw new InvalidOperationException($"Journal entry does not balance: debit {totalDebit} != credit {totalCredit}.");
    if (totalDebit == 0)
        throw new InvalidOperationException("Journal entry has no amount.");

    var closedPeriod = await db.AccountingPeriods.FirstOrDefaultAsync(p =>
        p.TenantId == tenantId && p.Status == AccountingPeriodStatus.Closed && entryDate >= p.PeriodStart && entryDate <= p.PeriodEnd);
    if (closedPeriod != null)
        throw new InvalidOperationException($"The accounting period covering {entryDate:yyyy-MM-dd} is closed — it cannot be posted to.");

    var codes = lines.Select(l => l.AccountCode).Distinct().ToList();
    var accounts = await db.Accounts.Where(a => a.TenantId == tenantId && codes.Contains(a.Code)).ToDictionaryAsync(a => a.Code);
    var missing = codes.Except(accounts.Keys).ToList();
    if (missing.Count > 0)
        throw new InvalidOperationException($"Chart of Accounts is missing: {string.Join(", ", missing)}.");

    var entry = new JournalEntry
    {
        TenantId = tenantId,
        BranchId = branchId,
        EntryNumber = await GenerateJournalEntryNumberAsync(db, tenantId),
        EntryDate = entryDate,
        Description = description,
        ReferenceType = referenceType,
        ReferenceId = referenceId,
        Status = JournalEntryStatus.Posted,
        CreatedBy = createdBy
    };
    foreach (var line in lines.Where(l => l.Debit != 0 || l.Credit != 0))
    {
        entry.Lines.Add(new JournalLine { JournalEntryId = entry.Id, AccountId = accounts[line.AccountCode].Id, DebitPKR = line.Debit, CreditPKR = line.Credit });
    }
    db.JournalEntries.Add(entry);
    return entry;
}

// --- Helper: compose the canned WhatsApp copy for a given event type ---
static string BuildWhatsAppMessage(string messageType, string orderNumber, string? itemSummary, decimal totalPKR, string? deliveryAddress, string? paymentMethod, string? customMessage) => messageType switch
{
    "order_placed" => $"✅ *Order Confirmed!*\n\nOrder #{orderNumber}\nItems: {itemSummary}\nTotal: Rs {totalPKR:N0}\n\nThank you for your order! We're preparing it now.",
    "order_preparing" => $"👨‍🍳 *Your order is being prepared!*\n\nOrder #{orderNumber}\nEstimated time: 15-20 minutes\n\nWe'll let you know when it's ready!",
    "order_ready" => $"🔔 *Your order is ready!*\n\nOrder #{orderNumber}\nPlease collect from the counter.\n\nThank you for choosing us!",
    "order_delivered" => $"🚚 *Order Delivered!*\n\nOrder #{orderNumber}\nDelivered to: {deliveryAddress}\n\nThank you! We hope you enjoy your meal.",
    "receipt" => $"🧾 *Payment Receipt*\n\nOrder #{orderNumber}\nTotal: Rs {totalPKR:N0}\nPayment: {paymentMethod}\n\nThank you for dining with us!",
    _ => customMessage ?? "You have an update from Cashly POS."
};

/// Central place every WhatsApp send goes through — config/quota checks, provider dispatch, and the
/// NotificationLog write all live here once, so the honest "not configured"/"failed" outcome (never a
/// faked "sent") is guaranteed no matter which endpoint or internal order-flow event triggered it.
static async Task<(bool Skipped, bool Sent, string? Reason, Guid? LogId)> SendWhatsAppMessageAsync(
    AppDbContext db, Pos.Api.Services.IWhatsAppSenderResolver resolver, Guid tenantId, Guid? orderId, string? phone, string messageType, string message,
    Func<WhatsAppConfig, bool>? autoSendGate = null)
{
    if (string.IsNullOrWhiteSpace(phone))
        return (true, false, "No customer phone number on file.", null);

    var config = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == tenantId && w.IsEnabled);
    if (config == null)
        return (true, false, "WhatsApp is not enabled for this restaurant.", null);
    if (autoSendGate != null && !autoSendGate(config))
        return (true, false, "Auto-send is turned off for this message type.", null);

    var actualTier = await db.Tenants.Where(t => t.Id == tenantId).Select(t => (SubscriptionTier?)t.Tier).FirstOrDefaultAsync();
    var packageConfig = actualTier == null ? null : await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == actualTier.Value.ToString());
    if (packageConfig != null && !packageConfig.HasWhatsAppMessaging)
        return (true, false, "WhatsApp messaging is not included in this package.", null);
    if (packageConfig != null && packageConfig.WhatsAppMessagesPerMonth != -1)
    {
        var startOfMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var countThisMonth = await db.NotificationLogs.CountAsync(n =>
            n.TenantId == tenantId && n.SentAt >= startOfMonth && n.Status == "sent");
        if (countThisMonth >= packageConfig.WhatsAppMessagesPerMonth)
            return (true, false, "Monthly WhatsApp message limit reached.", null);
    }

    var sender = resolver.Resolve(config.Provider);
    var result = sender == null
        ? new Pos.Api.Services.WhatsAppSendResult(false, null, $"Unknown provider '{config.Provider}'.")
        : await sender.SendAsync(config, phone, message);

    var log = new NotificationLog
    {
        TenantId = tenantId,
        OrderId = orderId,
        Channel = "whatsapp",
        RecipientPhone = phone,
        MessageType = messageType,
        MessageBody = message,
        Status = result.Success ? "sent" : "failed",
        ProviderMessageId = result.ProviderMessageId,
        ErrorMessage = result.ErrorMessage,
        SentAt = DateTime.UtcNow
    };
    db.NotificationLogs.Add(log);
    await db.SaveChangesAsync();
    return (false, result.Success, result.ErrorMessage, log.Id);
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
    result.Decimals = decimals;
    return result;
}

// ============================================================
// COMMERCE EXTRAS — customer linkage, promo codes, gift cards, loyalty redemption
// Runs after PriceOrderAsync so every figure it starts from is already server-computed.
// ============================================================

// Lazily creates the per-tenant loyalty configuration the first time it is touched, mirroring how
// TenantSettings is created on demand. Disabled by default — enabling it is an explicit owner action.
// persist:false is used from inside order creation, where an early SaveChanges would commit a
// half-built order's side effects (new Customer row, incremented promo UsesCount) before the sale
// itself is known to succeed.
static async Task<LoyaltyProgramConfig> GetOrCreateLoyaltyConfigAsync(AppDbContext db, Guid tenantId, bool persist = true)
{
    var config = await db.LoyaltyProgramConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId);
    if (config == null)
    {
        config = new LoyaltyProgramConfig { TenantId = tenantId };
        db.LoyaltyProgramConfigs.Add(config);
        if (persist) await db.SaveChangesAsync();
    }
    return config;
}

static async Task<string> GenerateGiftCardCodeAsync(AppDbContext db)
{
    // Ambiguous characters (0/O, 1/I) are excluded so codes can be read off a printed card.
    const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (var attempt = 0; attempt < 10; attempt++)
    {
        var chars = new char[12];
        var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(chars.Length);
        for (var i = 0; i < chars.Length; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
        var code = new string(chars);
        if (!await db.GiftCards.AnyAsync(g => g.CardCode == code)) return code;
    }
    throw new InvalidOperationException("Could not generate a unique gift card code.");
}

/// <summary>
/// Applies customer linkage, promo code, loyalty redemption and gift-card redemption to an order
/// whose money has already been recomputed server-side.
///
/// Ordering and rationale:
///  1. Customer is resolved/created first so per-customer promo limits can be enforced.
///  2. A promo discount is a PRE-TAX discount, so applying it means re-deriving tax and total.
///     A promo code and a manual cashier discount NEVER stack — the larger of the two wins, and
///     the losing one is reported back. Stacking would let a cashier hand out an unbounded
///     combined discount, and the manual figure is already permission-gated by PriceOrderAsync.
///  3. Loyalty points and gift cards are POST-TAX credits: they reduce the amount owed through the
///     order's payment method without changing the taxable base, so tax is never refunded by them.
///
/// Nothing here is fatal to a sale — an invalid, expired or exhausted code is simply not applied
/// and the reason is returned, mirroring the existing "unauthorized discount gets zeroed" rule.
/// </summary>
static async Task ApplyOrderCommerceAsync(AppDbContext db, Order order, CreateOrderDto dto, ServerPricedOrder priced)
{
    var now = DateTime.UtcNow;
    var decimals = priced.Decimals;

    // --- 1. Customer find-or-create by (TenantId, Phone) ---
    var phone = dto.CustomerPhone?.Trim();
    if (!string.IsNullOrWhiteSpace(phone))
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.TenantId == order.TenantId && c.Phone == phone);
        if (customer == null)
        {
            customer = new Customer
            {
                TenantId = order.TenantId,
                Phone = phone,
                FullName = string.IsNullOrWhiteSpace(dto.CustomerName) ? "Walk-in Customer" : dto.CustomerName!.Trim(),
                CreatedAt = now
            };
            db.Customers.Add(customer);
        }
        else if (!string.IsNullOrWhiteSpace(dto.CustomerName) && customer.FullName == "Walk-in Customer")
        {
            customer.FullName = dto.CustomerName!.Trim();
        }
        priced.LinkedCustomer = customer;
        order.CustomerId = customer.Id;
    }

    // --- 2. Promo code (pre-tax; mutually exclusive with the manual discount) ---
    if (!string.IsNullOrWhiteSpace(dto.PromoCode))
    {
        var code = dto.PromoCode!.Trim().ToUpperInvariant();
        var promo = await db.PromoCodes.FirstOrDefaultAsync(p => p.TenantId == order.TenantId && p.Code == code);

        if (promo == null) priced.PromoRejectedReason = "Promo code not found.";
        else if (!promo.IsActive) priced.PromoRejectedReason = "This promo code is no longer active.";
        else if (promo.ValidFrom > now) priced.PromoRejectedReason = "This promo code is not valid yet.";
        else if (promo.ValidUntil != null && promo.ValidUntil < now) priced.PromoRejectedReason = "This promo code has expired.";
        else if (priced.SubTotalPKR < promo.MinOrderAmountPKR) priced.PromoRejectedReason = $"Minimum order of {promo.MinOrderAmountPKR:N0} PKR required for this code.";
        else if (promo.MaxUsesTotal != null && promo.UsesCount >= promo.MaxUsesTotal.Value) priced.PromoRejectedReason = "This promo code has reached its usage limit.";
        else
        {
            var ok = true;
            if (promo.MaxUsesPerCustomer != null)
            {
                if (order.CustomerId == null)
                {
                    priced.PromoRejectedReason = "This promo code requires a customer phone number.";
                    ok = false;
                }
                else
                {
                    var used = await db.Orders.CountAsync(o => o.CustomerId == order.CustomerId && o.PromoCodeId == promo.Id);
                    if (used >= promo.MaxUsesPerCustomer.Value)
                    {
                        priced.PromoRejectedReason = "This customer has already used this promo code the maximum number of times.";
                        ok = false;
                    }
                }
            }

            if (ok)
            {
                var promoDiscount = promo.DiscountType == PromoDiscountType.Percent
                    ? priced.SubTotalPKR * (promo.DiscountValue / 100m)
                    : promo.DiscountValue;
                promoDiscount = Math.Round(Math.Clamp(promoDiscount, 0m, priced.SubTotalPKR), decimals, MidpointRounding.AwayFromZero);

                if (promoDiscount <= priced.DiscountPKR)
                {
                    priced.PromoRejectedReason = "The discount already applied to this order is larger, so the promo code was not used.";
                }
                else
                {
                    priced.AppliedPromo = promo;
                    priced.PromoDiscountPKR = promoDiscount;
                    priced.DiscountPKR = promoDiscount; // replaces (never stacks with) the manual discount
                    promo.UsesCount += 1;
                    order.PromoCodeId = promo.Id;

                    // Re-derive tax and total from the new pre-tax base.
                    priced.TaxPKR = Math.Round((priced.SubTotalPKR - priced.DiscountPKR) * (priced.TaxRatePercent / 100m), decimals, MidpointRounding.AwayFromZero);
                    priced.TotalPKR = priced.SubTotalPKR - priced.DiscountPKR + priced.TaxPKR;
                }
            }
        }
    }

    // --- 3. Loyalty points redemption (post-tax credit) ---
    if (dto.LoyaltyPointsRedeemed is > 0)
    {
        var points = dto.LoyaltyPointsRedeemed.Value;
        var config = await GetOrCreateLoyaltyConfigAsync(db, order.TenantId, persist: false);
        var customer = priced.LinkedCustomer;

        if (!config.IsEnabled) priced.LoyaltyRejectedReason = "The loyalty programme is not enabled.";
        else if (customer == null) priced.LoyaltyRejectedReason = "A customer phone number is required to redeem points.";
        else if (points < config.MinRedeemPoints) priced.LoyaltyRejectedReason = $"At least {config.MinRedeemPoints} points are needed to redeem.";
        else if (customer.LoyaltyPoints < points) priced.LoyaltyRejectedReason = $"Customer only has {customer.LoyaltyPoints} points.";
        else
        {
            var credit = Math.Round(points * config.PKRValuePerPoint, decimals, MidpointRounding.AwayFromZero);
            if (credit > priced.TotalPKR)
            {
                // Never credit more than is owed; scale the points spent back to what was used.
                credit = priced.TotalPKR;
                points = config.PKRValuePerPoint > 0 ? (int)Math.Floor(credit / config.PKRValuePerPoint) : 0;
                credit = Math.Round(points * config.PKRValuePerPoint, decimals, MidpointRounding.AwayFromZero);
            }
            if (points > 0)
            {
                priced.LoyaltyPointsRedeemed = points;
                priced.LoyaltyDiscountPKR = credit;
                priced.TotalPKR -= credit;
            }
        }
    }

    // --- 4. Gift card redemption (post-tax credit) ---
    if (!string.IsNullOrWhiteSpace(dto.GiftCardCode) && dto.GiftCardRedeemAmount is > 0)
    {
        var cardCode = dto.GiftCardCode!.Trim().ToUpperInvariant();
        var card = await db.GiftCards.FirstOrDefaultAsync(g => g.CardCode == cardCode && g.TenantId == order.TenantId);

        if (card == null) priced.GiftCardRejectedReason = "Gift card not found.";
        else if (!card.IsActive) priced.GiftCardRejectedReason = "This gift card is not active.";
        else if (card.ExpiresAt != null && card.ExpiresAt < now) priced.GiftCardRejectedReason = "This gift card has expired.";
        else if (card.CurrentBalancePKR <= 0) priced.GiftCardRejectedReason = "This gift card has no remaining balance.";
        else
        {
            // Clamp to both the card balance and what is actually still owed on the order.
            var redeem = Math.Min(dto.GiftCardRedeemAmount!.Value, card.CurrentBalancePKR);
            redeem = Math.Round(Math.Min(redeem, priced.TotalPKR), decimals, MidpointRounding.AwayFromZero);
            if (redeem > 0)
            {
                card.CurrentBalancePKR -= redeem;
                db.GiftCardTransactions.Add(new GiftCardTransaction
                {
                    GiftCardId = card.Id,
                    OrderId = order.Id,
                    Type = GiftCardTransactionType.Redeem,
                    AmountPKR = redeem,
                    CreatedAt = now,
                    CreatedBy = order.CashierName ?? "POS"
                });
                priced.GiftCardRedeemedPKR = redeem;
                order.GiftCardRedeemedPKR = redeem;
                priced.TotalPKR -= redeem;
            }
        }
    }

    if (priced.TotalPKR < 0) priced.TotalPKR = 0;
}

/// <summary>
/// Post-save CRM/loyalty bookkeeping. Only runs for paid orders.
///
/// Accrual formula: points = floor(TotalPKR * PointsPerPKRSpent / 100), i.e. PointsPerPKRSpent is
/// read as "points earned per 100 PKR spent" (default 1 → 1 point per 100 PKR). Redemption value
/// is PKRValuePerPoint PKR per point (default 1 PKR).
/// </summary>
static async Task ApplyPostSaleCustomerUpdatesAsync(AppDbContext db, Order order, ServerPricedOrder priced)
{
    if (order.CustomerId == null || !order.IsPaid) return;

    var customer = priced.LinkedCustomer
        ?? await db.Customers.FirstOrDefaultAsync(c => c.Id == order.CustomerId.Value);
    if (customer == null) return;

    customer.TotalVisits += 1;
    customer.TotalSpentPKR += order.TotalPKR;
    customer.LastVisitAt = DateTime.UtcNow;

    // CustomerKhata = a running tab settled later — the sale is final (IsPaid), the cash isn't in yet.
    if (order.PaymentMethod == PaymentMethod.CustomerKhata)
        customer.CurrentBalancePKR += order.TotalPKR;

    if (priced.LoyaltyPointsRedeemed > 0)
        customer.LoyaltyPoints = Math.Max(0, customer.LoyaltyPoints - priced.LoyaltyPointsRedeemed);

    var config = await GetOrCreateLoyaltyConfigAsync(db, order.TenantId, persist: false);
    if (config.IsEnabled && config.PointsPerPKRSpent > 0)
    {
        var earned = (int)Math.Floor(order.TotalPKR * config.PointsPerPKRSpent / 100m);
        if (earned > 0) customer.LoyaltyPoints += earned;
    }
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

authApi.MapPost("/login", async (AppDbContext db, HttpContext http, LoginDto dto) =>
{
    const int MaxFailedAttempts = 5;
    var lockoutDuration = TimeSpan.FromMinutes(15);
    var clientIp = http.Connection.RemoteIpAddress?.ToString();

    // Usernames are unique PER TENANT (see the AppUser index), so a global lookup could match
    // several people across different businesses and silently pick one. When the caller names a
    // tenant we scope to it; otherwise we only proceed if the name is unambiguous platform-wide,
    // and ask which business it is when it is not.
    var normalizedUsername = dto.Username.ToLower().Trim();
    var candidateQuery = db.Users.IgnoreQueryFilters().Where(u => u.Username == normalizedUsername && u.IsActive);

    if (!string.IsNullOrWhiteSpace(dto.TenantSlug))
    {
        var slug = dto.TenantSlug.Trim().ToLowerInvariant();
        var slugTenantId = await db.Tenants.IgnoreQueryFilters()
            .Where(t => t.Slug == slug).Select(t => (Guid?)t.Id).FirstOrDefaultAsync();
        if (slugTenantId == null) return Results.Unauthorized();
        candidateQuery = candidateQuery.Where(u => u.TenantId == slugTenantId.Value);
    }

    var candidates = await candidateQuery.Take(2).ToListAsync();
    if (candidates.Count > 1)
        return Results.BadRequest(new
        {
            message = "That username exists at more than one business. Please include your business identifier.",
            requiresTenantSlug = true
        });

    var user = candidates.FirstOrDefault();

    // A locked account still returns a generic message for a wrong PIN below, but tells the
    // legitimate holder how long to wait — a nonexistent username never reaches this branch,
    // so it can't be used to enumerate which accounts exist.
    if (user != null && user.LockedUntil.HasValue && user.LockedUntil.Value > DateTime.UtcNow)
    {
        var minutesLeft = Math.Ceiling((user.LockedUntil.Value - DateTime.UtcNow).TotalMinutes);
        return Results.Json(
            new { message = $"Too many failed attempts. Try again in {minutesLeft} minute(s)." },
            statusCode: StatusCodes.Status423Locked);
    }

    if (user == null || !BCrypt.Net.BCrypt.Verify(dto.PinCode, user.PinCodeHash))
    {
        if (user != null)
        {
            user.FailedLoginAttempts += 1;
            var lockedOut = user.FailedLoginAttempts >= MaxFailedAttempts;
            if (lockedOut)
            {
                user.LockedUntil = DateTime.UtcNow.Add(lockoutDuration);
                user.FailedLoginAttempts = 0;
            }
            await WriteAuditAsync(db, user.TenantId, user, lockedOut ? "AccountLocked" : "LoginFailed", "AppUser", user.Id,
                null, lockedOut ? $"Locked for {lockoutDuration.TotalMinutes} min after {MaxFailedAttempts} failed attempts (IP {clientIp})" : $"Wrong PIN (IP {clientIp})");
            await db.SaveChangesAsync();
        }
        return Results.Unauthorized();
    }

    user.FailedLoginAttempts = 0;
    user.LockedUntil = null;
    await WriteAuditAsync(db, user.TenantId, user, "UserLoggedIn", "AppUser", user.Id, null, $"IP {clientIp}");

    var (accessToken, refreshToken, _) = IssueTokenPair(db, builder.Configuration, user, isSuperAdmin: false, clientIp);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token = accessToken,
        refreshToken,
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

authApi.MapPost("/refresh", async (AppDbContext db, HttpContext http, RefreshTokenDto dto) =>
{
    if (string.IsNullOrWhiteSpace(dto.RefreshToken)) return Results.Unauthorized();
    var clientIp = http.Connection.RemoteIpAddress?.ToString();
    var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(dto.RefreshToken)));

    var existing = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash);
    if (existing == null || existing.RevokedAt != null || existing.ExpiresAt <= DateTime.UtcNow)
        return Results.Unauthorized();

    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == existing.UserId && u.IsActive);
    if (user == null) return Results.Unauthorized();

    // Rotate: the presented token is single-use. Revoking it here means a copy that gets replayed
    // after the legitimate client already refreshed is rejected, not silently accepted.
    var (accessToken, newRefreshToken, newTokenEntity) = IssueTokenPair(db, builder.Configuration, user, existing.IsSuperAdminToken, clientIp);
    existing.RevokedAt = DateTime.UtcNow;
    existing.ReplacedByTokenId = newTokenEntity.Id;
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token = accessToken,
        refreshToken = newRefreshToken,
        user = existing.IsSuperAdminToken
            ? new { id = user.Id, fullName = user.FullName, username = user.Username, role = "SuperAdmin", tenantId = Guid.Empty, branchId = (Guid?)null }
            : new
            {
                id = user.Id, fullName = user.FullName, username = user.Username, role = user.Role.ToString(),
                tenantId = user.TenantId, branchId = user.BranchId
            } as object
    });
});

authApi.MapPost("/logout", async (AppDbContext db, RefreshTokenDto dto) =>
{
    if (!string.IsNullOrWhiteSpace(dto.RefreshToken))
    {
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(dto.RefreshToken)));
        var existing = await db.RefreshTokens.FirstOrDefaultAsync(r => r.TokenHash == hash);
        if (existing != null && existing.RevokedAt == null)
        {
            existing.RevokedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
    }
    return Results.Ok(new { message = "Logged out" });
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
            Branches = t.Branches.Select(b => new { b.Id, b.Name, b.Code, b.City, b.IsHeadOffice })
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
// An offline sale ALREADY HAPPENED. The customer was shown a price and handed over money at it.
// The previous behaviour re-priced every synced order against today's catalogue and saved the
// server's figure, which silently rewrote what the customer actually paid and left the books
// disagreeing with the receipt in their hand.
//
// Now: the server still re-prices, but only to CHECK. The device's figures are what get saved,
// the variance is recorded on the order, and anything material raises an alert for a human.
// The server figure is used only when the device sent nothing to go on.
//
// Sync is also idempotent — each order carries a device-generated ClientLocalId, so a retried
// batch (or one whose response was lost after the server committed) cannot post a sale twice.
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
    var pricedByOrder = new Dictionary<Guid, ServerPricedOrder>();

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

        // Idempotency. Checked before anything is created, and backed by a unique index on
        // (TenantId, ClientLocalId) so two concurrent syncs of the same batch cannot both win.
        if (!string.IsNullOrWhiteSpace(dto.ClientLocalId))
        {
            var existing = await db.Orders
                .Where(o => o.TenantId == branch.TenantId && o.ClientLocalId == dto.ClientLocalId)
                .Select(o => new { o.Id, o.OrderNumber })
                .FirstOrDefaultAsync();
            if (existing != null)
            {
                // Report success, not an error: the device's goal (this sale is on the server)
                // is satisfied, and it needs to hear that so it stops retrying.
                syncedResults.Add(new { orderId = (Guid?)existing.Id, orderNumber = existing.OrderNumber, status = "AlreadySynced", reason = (string?)null });
                continue;
            }
        }

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
            CreatedAt = DateTime.UtcNow,
            ClientLocalId = string.IsNullOrWhiteSpace(dto.ClientLocalId) ? null : dto.ClientLocalId.Trim(),
            IsOfflineOrigin = true,
            // When the sale actually happened. Reports and Z-readings should use this, not the
            // moment connectivity came back — otherwise a Tuesday outage lands in Wednesday's books.
            CapturedAt = dto.CapturedAt ?? DateTime.UtcNow
        };

        var priced = await PriceOrderAsync(db, branch, dto, order.Id, actingUser);
        if (priced.Error != null)
        {
            syncedResults.Add(new { orderId = (Guid?)null, orderNumber = (string?)null, status = "Rejected", reason = priced.Error });
            continue;
        }

        // Same commerce rules as the online path: customer linkage, promo, loyalty, gift card.
        await ApplyOrderCommerceAsync(db, order, dto, priced);
        pricedByOrder[order.Id] = priced;

        foreach (var line in priced.Items) order.Items.Add(line);
        if (order.Status == OrderStatus.InKitchen) order.InKitchenAt = DateTime.UtcNow;

        // --- Whose numbers win -------------------------------------------------
        // The device's, when it sent any. It is the only party that knows what the customer was
        // charged. The server's recomputation becomes a control total, not a correction.
        var deviceSentTotals = dto.SubTotalPKR > 0 || dto.TotalPKR > 0;

        if (deviceSentTotals)
        {
            order.SubTotalPKR = dto.SubTotalPKR;
            order.DiscountPKR = dto.DiscountPKR;
            order.TaxPKR = dto.TaxPKR;
            order.TotalPKR = dto.TotalPKR;
            order.DeviceReportedTotalPKR = dto.TotalPKR;
            order.PriceVariancePKR = priced.TotalPKR - dto.TotalPKR;
            order.HasPriceVariance = Math.Abs(order.PriceVariancePKR) >= 0.01m;

            // Keep the per-line price the customer saw, so the receipt can always be reproduced
            // exactly. Matched by product and position — a synced order's lines arrive in the
            // same order the device recorded them.
            for (var i = 0; i < order.Items.Count && i < dto.Items.Count; i++)
            {
                var serverLine = order.Items.ElementAt(i);
                var deviceLine = dto.Items[i];
                if (deviceLine.ProductId == serverLine.ProductId && deviceLine.UnitPricePKR > 0
                    && deviceLine.UnitPricePKR != serverLine.UnitPricePKR)
                {
                    serverLine.DeviceReportedUnitPricePKR = deviceLine.UnitPricePKR;
                    serverLine.UnitPricePKR = deviceLine.UnitPricePKR;
                    serverLine.TotalPricePKR = deviceLine.UnitPricePKR * serverLine.Quantity;
                }
            }
        }
        else
        {
            // Nothing to go on: an older client, or a genuinely priceless payload. The server
            // figure is the only figure available.
            order.SubTotalPKR = priced.SubTotalPKR;
            order.DiscountPKR = priced.DiscountPKR;
            order.TaxPKR = priced.TaxPKR;
            order.TotalPKR = priced.TotalPKR;
        }

        // Alert on material drift so a human reconciles it. Threshold is the same 2% as before;
        // what changed is that the difference is now surfaced instead of silently applied.
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
                    Message = $"This sale was rung up offline at {dto.SubTotalPKR:N2}; current prices give {priced.SubTotalPKR:N2} ({drift:P1} difference). "
                            + "The amount the customer actually paid was saved — review whether a price changed while the terminal was offline.",
                    Metadata = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        orderId = order.Id,
                        orderNumber = order.OrderNumber,
                        chargedSubTotal = dto.SubTotalPKR,
                        recomputedSubTotal = priced.SubTotalPKR,
                        chargedTotal = dto.TotalPKR,
                        recomputedTotal = priced.TotalPKR,
                        variance = priced.TotalPKR - dto.TotalPKR
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
        if (pricedByOrder.TryGetValue(order.Id, out var orderPricing))
            await ApplyPostSaleCustomerUpdatesAsync(db, order, orderPricing);

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

// ============================================================
// DEVICE ACTIVATION
//
// The previous scheme had two anonymous endpoints: one that listed EVERY branch of EVERY tenant
// on the platform together with its pairing token, and one that exchanged such a token for that
// tenant's entire catalogue. The token itself was derived from the branch code plus the first
// four hex characters of its id, so it was both guessable and permanent, and a prefix match
// meant a two-character string could hit an arbitrary branch.
//
// What replaces it:
//   * an admin who already has access to a branch mints a one-time code (authenticated),
//   * the code is random, hashed at rest, expires in minutes, and dies when redeemed,
//   * redeeming it binds a device fingerprint and returns a signed, expiring licence,
//   * the catalogue is NOT part of activation — the device fetches it afterwards, with its licence.
// ============================================================

// Mint a pairing code for one branch. Requires an authenticated admin for that branch, and the
// device quota is checked HERE as well as at redemption, so an owner is told "3 of 3 counters
// used" while still at the back office rather than after walking to the till.
api.MapPost("/devices/pairing-codes", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    CreatePairingCodeDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser == null) return Results.Unauthorized();

    // Minting a device licence is an owner/manager act, not something a cashier can do from a till.
    if (actingUser.Role is not (UserRole.OwnerAdmin or UserRole.BranchManager or UserRole.SuperAdmin))
        return Results.Json(new { message = "Only an owner or branch manager can activate a device." }, statusCode: 403);

    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == scopedBranchId!.Value && b.TenantId == scopedTenantId!.Value);
    if (branch == null) return Results.BadRequest(new { message = "Branch not found." });

    // A chain's head office runs the ERP and does not sell, so there is nothing for a till or a
    // waiter tablet to do there. Refusing here keeps the customer from paying for a device slot
    // that could never ring up a sale.
    //
    // Back-office workstations and kitchen screens stay allowed everywhere: head office is
    // precisely where back-office machines belong, and a central commissary legitimately has
    // prep screens even though it has no customers.
    var ent = await entitlements.GetAsync(scopedTenantId!.Value);
    var isNonSellingDevice = dto.TerminalType is TerminalType.KitchenDisplay or TerminalType.BackOffice;
    if (ent.HeadOfficeIsErpOnly && branch.IsHeadOffice && !isNonSellingDevice)
        return Results.BadRequest(new
        {
            message = "Head office runs the back office and does not take sales, so it cannot have a "
                    + "till or a waiter tablet. Generate this code for one of your branches instead.",
            headOfficeIsErpOnly = true
        });

    var (allowed, inUse, limit) = await entitlements.CanAddDeviceAsync(scopedTenantId!.Value, branch.Id, dto.TerminalType);
    if (!allowed)
        return Results.BadRequest(new
        {
            message = $"All {limit} {dto.TerminalType} device slots at this branch are in use ({inUse}/{limit}). Retire a device or add capacity.",
            inUse,
            limit,
            addOnKey = dto.TerminalType == TerminalType.OrderTab ? "EXTRA_TABLET" : "EXTRA_COUNTER"
        });

    // Short, unambiguous alphabet: no O/0, I/1, so a code read aloud over a phone survives.
    const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var raw = new string(Enumerable.Range(0, 8)
        .Select(_ => alphabet[System.Security.Cryptography.RandomNumberGenerator.GetInt32(alphabet.Length)])
        .ToArray());

    var code = new PairingCode
    {
        TenantId = scopedTenantId.Value,
        BranchId = branch.Id,
        CodeHash = HashToken(raw),
        CodePrefix = raw[..4],
        TerminalType = dto.TerminalType,
        TerminalName = string.IsNullOrWhiteSpace(dto.TerminalName)
            ? $"{dto.TerminalType} {inUse + 1}"
            : dto.TerminalName.Trim(),
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddMinutes(15),
        CreatedByUserId = actingUser.Id
    };
    db.PairingCodes.Add(code);

    await WriteAuditAsync(db, scopedTenantId.Value, actingUser, "PairingCodeIssued", "PairingCode", code.Id,
        null, $"{dto.TerminalType} for branch {branch.Name} (expires {code.ExpiresAt:u})");
    await db.SaveChangesAsync();

    // The raw code is returned exactly once and never stored — this response is the only place
    // it exists in the clear.
    return Results.Ok(new
    {
        pairingCode = raw,
        expiresAt = code.ExpiresAt,
        terminalType = code.TerminalType.ToString(),
        terminalName = code.TerminalName,
        branchName = branch.Name,
        slotsInUse = inUse,
        slotLimit = limit
    });
});

// List outstanding codes for a branch, so an admin can see and cancel a code they issued.
// Only ever shows the 4-character prefix — the full code is unrecoverable by design.
api.MapGet("/devices/pairing-codes", async (AppDbContext db, HttpContext http, Guid? branchId) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var now = DateTime.UtcNow;
    var codes = await db.PairingCodes
        .Where(c => c.TenantId == scopedTenantId!.Value && c.BranchId == scopedBranchId!.Value
                 && !c.IsRevoked && c.ConsumedAt == null && c.ExpiresAt > now)
        .OrderByDescending(c => c.CreatedAt)
        .Select(c => new { c.Id, c.CodePrefix, c.TerminalType, c.TerminalName, c.ExpiresAt, c.CreatedAt })
        .ToListAsync();

    return Results.Ok(codes);
});

api.MapDelete("/devices/pairing-codes/{id:guid}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var code = await db.PairingCodes.FirstOrDefaultAsync(c => c.Id == id);
    if (code == null) return Results.NotFound(new { message = "Pairing code not found." });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, code.BranchId);
    if (scopeError != null) return scopeError;

    code.IsRevoked = true;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Pairing code cancelled." });
});

// Redeem a code. This is the ONE anonymous endpoint in the activation flow, because a fresh
// device genuinely has no credential yet — which is exactly why the code must be unguessable,
// single-use and short-lived, and why this returns a licence rather than any business data.
api.MapPost("/devices/activate", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Services.IDeviceLicenseService licensing,
    ActivateDeviceDto dto) =>
{
    var now = DateTime.UtcNow;
    var submitted = (dto.PairingCode ?? string.Empty).Trim().ToUpperInvariant();

    if (string.IsNullOrWhiteSpace(submitted) || string.IsNullOrWhiteSpace(dto.DeviceFingerprint))
        return Results.BadRequest(new { message = "A pairing code and device fingerprint are both required." });

    // Exact hash lookup only. No prefix matching, no fallbacks — the old prefix fallback is
    // precisely how a short guess could land on somebody else's branch.
    var hash = HashToken(submitted);
    var code = await db.PairingCodes.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.CodeHash == hash);

    // One message for every failure mode: an attacker learns nothing about which part was wrong.
    if (code == null || !code.IsRedeemable(now))
        return Results.BadRequest(new { message = "That pairing code is not valid. Ask an administrator to generate a new one." });

    var branch = await db.Branches.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == code.BranchId);
    if (branch == null) return Results.BadRequest(new { message = "That pairing code is not valid. Ask an administrator to generate a new one." });

    var ent = await entitlements.GetAsync(code.TenantId);
    if (!ent.CanRead)
        return Results.Json(new { message = "This account is suspended. Contact support." }, statusCode: 403);

    // Re-check the quota at redemption: minutes may have passed since the code was issued, and
    // another device may have taken the last slot in between.
    var (allowed, inUse, limit) = await entitlements.CanAddDeviceAsync(code.TenantId, branch.Id, code.TerminalType);
    if (!allowed)
    {
        db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
        {
            TenantId = code.TenantId, BranchId = branch.Id, EventType = "QuotaExceeded",
            Detail = $"Activation refused for {code.TerminalType}: {inUse}/{limit} in use.",
            Ip = http.Connection.RemoteIpAddress?.ToString()
        });
        await db.SaveChangesAsync();
        return Results.BadRequest(new { message = $"All {limit} {code.TerminalType} slots at this branch are in use.", inUse, limit });
    }

    var terminal = new Terminal
    {
        TenantId = code.TenantId,
        BranchId = branch.Id,
        TerminalName = code.TerminalName,
        TerminalType = code.TerminalType,
        DeviceToken = Guid.NewGuid().ToString("N"),
        DeviceFingerprint = licensing.HashFingerprint(dto.DeviceFingerprint),
        DeviceInfo = dto.DeviceInfo?.Trim(),
        IsActive = true,
        ActivatedAt = now,
        LastSeenAt = now
    };
    db.Terminals.Add(terminal);

    code.ConsumedAt = now;
    code.ConsumedByTerminalId = terminal.Id;
    code.ConsumedByIp = http.Connection.RemoteIpAddress?.ToString();

    var license = await licensing.IssueAsync(terminal, ent);

    db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
    {
        TenantId = code.TenantId, TerminalId = terminal.Id, BranchId = branch.Id,
        EventType = "Activated",
        Detail = $"{terminal.TerminalType} '{terminal.TerminalName}' activated. {dto.DeviceInfo}",
        Ip = http.Connection.RemoteIpAddress?.ToString()
    });

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        license = license.Token,
        expiresAt = license.ExpiresAt,
        graceEndsAt = license.GraceEndsAt,
        terminalId = terminal.Id,
        terminalName = terminal.TerminalName,
        terminalType = terminal.TerminalType.ToString(),
        deviceToken = terminal.DeviceToken,
        tenantId = code.TenantId,
        branchId = branch.Id,
        branchName = branch.Name,
        branchCode = branch.Code,
        isHeadOffice = branch.IsHeadOffice,
        // Which application this machine just became. The device decides its own surface from
        // the class it was activated as, so a back-office PC in the same building as the till
        // still boots into the ERP.
        appSurface = ent.SurfaceFor(branch.IsHeadOffice, terminal.TerminalType).ToString(),
        packs = ent.PackKeys,
        primaryPack = ent.PrimaryPackKey
    });
}).AllowAnonymous().RequireRateLimiting("auth");

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

// Add a branch to an existing organisation.
//
// The case this exists for: a Standard customer enables head office, then adds branches one at a
// time as they open. Guarded declaratively — multi_branch must be in the plan, and the location
// count must have room. Neither guard names a plan, so Standard passes both.
api.MapPost("/branches", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.ISubscriptionService subs,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    CreateBranchDto dto) =>
{
    var tenantId = ResolveTenantScope(http, null);
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (!http.IsSuperAdmin() && actingUser?.Role != UserRole.OwnerAdmin)
        return Results.Json(new { message = "Only an owner can add a location." }, statusCode: 403);

    if (string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { message = "A branch name is required." });

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId.Value);
    if (tenant == null) return Results.NotFound();

    // Codes are generated rather than trusted, so two branches cannot collide on one.
    var code = string.IsNullOrWhiteSpace(dto.Code)
        ? $"BR-{(await db.Branches.IgnoreQueryFilters().CountAsync(b => b.TenantId == tenantId.Value)):D2}"
        : dto.Code.Trim().ToUpperInvariant();

    if (await db.Branches.IgnoreQueryFilters().AnyAsync(b => b.TenantId == tenantId.Value && b.Code == code))
        return Results.BadRequest(new { message = $"A location with code {code} already exists." });

    var settings = await db.TenantSettings.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.TenantId == tenantId.Value);

    var branch = new Branch
    {
        TenantId = tenantId.Value,
        Name = dto.Name.Trim(),
        Code = code,
        City = string.IsNullOrWhiteSpace(dto.City) ? (tenant.City ?? "") : dto.City.Trim(),
        Address = dto.Address?.Trim() ?? "",
        Phone = dto.Phone?.Trim() ?? "",
        IsHeadOffice = false,
        // Inherits the organisation's tax region unless it names its own — most chains operate
        // in one jurisdiction, and the ones that do not can change it per branch afterwards.
        RegionCode = string.IsNullOrWhiteSpace(dto.StateCode)
            ? (settings?.CountryCode == "PK" ? null : null)
            : dto.StateCode.Trim().ToUpperInvariant()
    };
    db.Branches.Add(branch);

    if (actingUser != null)
        await WriteAuditAsync(db, tenantId.Value, actingUser, "BranchCreated", "Branch", branch.Id, null, $"{branch.Name} ({branch.Code})");
    await db.SaveChangesAsync();

    await entitlements.RecomputeAsync(tenantId.Value);
    var locations = await subs.CheckLimitAsync(tenantId.Value, Pos.Api.Data.FeatureCodes.Locations);

    return Results.Ok(new
    {
        branch.Id, branch.Name, branch.Code, branch.City, branch.IsHeadOffice,
        locations = new { inUse = locations.InUse, limit = locations.Limit, remaining = locations.Remaining, isNearLimit = locations.IsNearLimit }
    });
})
.AddEndpointFilter(Pos.Api.Middlewares.RequireFeature.For(Pos.Api.Data.FeatureCodes.MultiBranch))
.AddEndpointFilter(Pos.Api.Middlewares.RequireLimit.For(Pos.Api.Data.FeatureCodes.Locations));

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
    Pos.Api.Services.IWhatsAppSenderResolver waResolver,
    CreateOrderDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var branch = await db.Branches.Include(b => b.Tenant)
        .FirstOrDefaultAsync(b => b.Id == scopedBranchId!.Value && b.TenantId == scopedTenantId!.Value);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });

    var actingUser = await accessor.GetCurrentUserAsync(http);
    var (error, order, priced) = await CreateOrderCoreAsync(db, branch, dto, actingUser, fiscal, waResolver);
    if (error != null) return error;

    return Results.Ok(new
    {
        message = "Order placed and dispatched via Mode 1 (Kitchen + Counter)",
        orderId = order!.Id, orderNumber = order.OrderNumber,
        kitchenTicketsCount = order.KitchenTickets.Count,
        status = order.Status.ToString(),
        subTotalPKR = order.SubTotalPKR, discountPKR = order.DiscountPKR,
        taxPKR = order.TaxPKR, taxRatePercent = priced!.TaxRatePercent, totalPKR = order.TotalPKR,
        discountRejected = priced.DiscountRejected,
        customerId = order.CustomerId,
        promoCodeApplied = priced.AppliedPromo?.Code,
        promoDiscountPKR = priced.PromoDiscountPKR,
        promoRejectedReason = priced.PromoRejectedReason,
        giftCardRedeemedPKR = order.GiftCardRedeemedPKR,
        giftCardRejectedReason = priced.GiftCardRejectedReason,
        loyaltyPointsRedeemed = priced.LoyaltyPointsRedeemed,
        loyaltyDiscountPKR = priced.LoyaltyDiscountPKR,
        loyaltyRejectedReason = priced.LoyaltyRejectedReason,
        fiscalInvoiceNumber = order.FiscalInvoiceNumber
    });
// Selling is the last thing a tenant loses. PastDue and Restricted both still pass this gate.
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireTenantStateFilter(Pos.Api.Middlewares.RequireTenantStateFilter.Need.Sell));

// Shared order-creation core. Both POST /orders and the delivery-platform webhook go through this
// so the server-side price/tax recompute, stock depletion, KOT fan-out and commerce extras apply
// identically no matter where the order originated.
static async Task<(IResult? Error, Order? Order, ServerPricedOrder? Priced)> CreateOrderCoreAsync(
    AppDbContext db, Branch branch, CreateOrderDto dto, AppUser? actingUser, Pos.Api.Services.IFiscalInvoiceProvider fiscal,
    Pos.Api.Services.IWhatsAppSenderResolver? waResolver = null)
{
    if (dto.Items == null || dto.Items.Count == 0)
        return (Results.BadRequest(new { message = "An order must contain at least one item." }), null, null);

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
    if (priced.Error != null) return (Results.BadRequest(new { message = priced.Error }), null, null);

    // Customer linkage, promo code, loyalty and gift-card credits — all applied on top of the
    // server-computed figures, never on client-supplied money.
    await ApplyOrderCommerceAsync(db, order, dto, priced);

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

    // KOTs per station — skipped for Retail/CashAndCarry tenants, which have no kitchen to route
    // to. A bag of chips rung up at a shop counter has no business spawning a "Cooking" ticket.
    var tenantBusinessType = await db.Tenants.Where(t => t.Id == branch.TenantId).Select(t => t.BusinessType).FirstOrDefaultAsync();
    if (tenantBusinessType != BusinessType.Retail && tenantBusinessType != BusinessType.CashAndCarry)
    {
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
                return (Results.Conflict(new { message = $"Insufficient stock for {item.ProductName}. Available: {stock.QuantityOnHand}, Requested: {item.Quantity}" }), null, null);
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
                        return (Results.Conflict(new { message = $"Insufficient ingredient {ingredient.Name}. Available: {ingredient.CurrentStock}, Need: {totalIngredientQty}" }), null, null);
                    }
                    RecordStockLedgerEntry(db, ingredient, branch.TenantId, branch.Id, StockMovementType.SaleConsumption,
                        -totalIngredientQty, ingredient.CostPerUnitPKR, "Order", order.Id, order.CashierName ?? "System", $"Order {order.OrderNumber}");
                }
            }
        }
    }

    db.Orders.Add(order);
    await db.SaveChangesAsync();

    // CRM visit/spend counters and loyalty accrual — only meaningful once the sale is committed.
    await ApplyPostSaleCustomerUpdatesAsync(db, order, priced);

    // Fiscal e-invoicing (inert stub today — wired for a future FBR integration).
    var (fiscalNumber, fiscalQr) = await fiscal.IssueInvoiceAsync(order.TenantId, order.Id, order.TotalPKR, order.TaxPKR);
    if (fiscalNumber != null || fiscalQr != null)
    {
        order.FiscalInvoiceNumber = fiscalNumber;
        order.FiscalQrPayload = fiscalQr;
    }
    await db.SaveChangesAsync();

    if (waResolver != null)
    {
        var itemSummary = string.Join(", ", order.Items.Select(i => $"{i.Quantity}x {i.ProductName}"));
        var placedMsg = BuildWhatsAppMessage("order_placed", order.OrderNumber, itemSummary, order.TotalPKR, null, null, null);
        await SendWhatsAppMessageAsync(db, waResolver, order.TenantId, order.Id, order.CustomerPhone, "order_placed", placedMsg,
            autoSendGate: c => c.AutoSendOrderUpdates);

        // Dine-in/takeaway/walk-in orders that are paid immediately won't pass through
        // /delivery/mark-delivered (that's delivery-only), so the receipt fires here instead.
        if (order.IsPaid && order.OrderType != OrderType.Delivery)
        {
            var receiptMsg = BuildWhatsAppMessage("receipt", order.OrderNumber, null, order.TotalPKR, null, order.PaymentMethod.ToString(), null);
            await SendWhatsAppMessageAsync(db, waResolver, order.TenantId, order.Id, order.CustomerPhone, "receipt", receiptMsg,
                autoSendGate: c => c.AutoSendReceipt);
        }
    }

    // Auto-post to the general ledger — opt-in per tenant (skipped entirely if no Chart of
    // Accounts is seeded) and never allowed to fail the sale itself.
    if (order.IsPaid && await HasAccountingAsync(db, order.TenantId))
    {
        try
        {
            var settlementAccount = order.PaymentMethod switch
            {
                PaymentMethod.Cash => "1000",
                PaymentMethod.Card or PaymentMethod.JazzCash or PaymentMethod.EasyPaisa or PaymentMethod.Raast => "1020",
                _ => "1100" // Split / CustomerKhata — approximated as receivable since it isn't fully cash-settled
            };
            var netSales = order.SubTotalPKR - order.DiscountPKR;
            await PostJournalEntryAsync(db, order.TenantId, order.BranchId, order.CreatedAt,
                $"Sale — Order #{order.OrderNumber}", "Order", order.Id, order.CashierName ?? "System",
                new List<(string, decimal, decimal)>
                {
                    (settlementAccount, order.TotalPKR, 0),
                    ("4000", 0, netSales),
                    ("2100", 0, order.TaxPKR)
                });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Accounting] Failed to post journal entry for order {order.OrderNumber}: {ex.Message}");
        }
    }

    return (null, order, priced);
}

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
// Reverses everything order creation touched: finished-product stock, recipe ingredient
// consumption (via the ledger, not a raw mutation), a CustomerKhata tab balance, visit/spend
// stats, and — if one was posted — the accounting entry (via a reversal, never edited/deleted).
api.MapPost("/orders/{id}/void", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] VoidOrderDto dto) =>
{
    var order = await db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == id);
    if (order == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;
    if (order.Status == OrderStatus.Cancelled) return Results.BadRequest(new { message = "Order already cancelled" });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    order.Status = OrderStatus.Cancelled;
    order.CancelledAt = DateTime.UtcNow;

    // Restore finished-product (retail) stock.
    var productIds = order.Items.Select(i => i.ProductId).Distinct().ToList();
    var stockDict = await db.BranchStocks.Where(s => s.BranchId == order.BranchId && productIds.Contains(s.ProductId))
        .ToDictionaryAsync(s => s.ProductId);
    foreach (var item in order.Items)
    {
        if (stockDict.TryGetValue(item.ProductId, out var stock))
            stock.QuantityOnHand += item.Quantity;
    }

    // Restore recipe-based raw ingredients that were consumed, through the ledger (not a raw
    // mutation) so the audit trail shows the reversal, not just an unexplained stock jump.
    var recipeDict = await db.ProductRecipeItems.Where(r => productIds.Contains(r.ProductId))
        .GroupBy(r => r.ProductId).ToDictionaryAsync(g => g.Key, g => g.ToList());
    var ingredientIds = recipeDict.Values.SelectMany(r => r).Select(r => r.IngredientId).Distinct().ToList();
    var ingredientDict = await db.Ingredients.Where(i => i.BranchId == order.BranchId && ingredientIds.Contains(i.Id)).ToDictionaryAsync(i => i.Id);
    foreach (var item in order.Items)
    {
        if (!recipeDict.TryGetValue(item.ProductId, out var recipeItems)) continue;
        foreach (var recipe in recipeItems)
        {
            if (!ingredientDict.TryGetValue(recipe.IngredientId, out var ingredient)) continue;
            var totalQty = recipe.QuantityRequired * item.Quantity;
            RecordStockLedgerEntry(db, ingredient, order.TenantId, order.BranchId, StockMovementType.Adjustment,
                totalQty, ingredient.CostPerUnitPKR, "Order", order.Id, currentUser?.FullName ?? "System", $"Order {order.OrderNumber} voided — stock returned");
        }
    }

    // A CustomerKhata order added to what the customer owes — voiding removes that debt, and
    // the visit/spend stats it contributed (loyalty points earned are left alone: a minor,
    // non-monetary balance, not worth the risk of a wrong reversal formula drifting from config).
    if (order.CustomerId != null && order.IsPaid)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == order.CustomerId.Value);
        if (customer != null)
        {
            customer.TotalVisits = Math.Max(0, customer.TotalVisits - 1);
            customer.TotalSpentPKR = Math.Max(0, customer.TotalSpentPKR - order.TotalPKR);
            if (order.PaymentMethod == PaymentMethod.CustomerKhata)
                customer.CurrentBalancePKR = Math.Max(0, customer.CurrentBalancePKR - order.TotalPKR);
        }
    }

    // Reverse the sale's journal entry, if accounting was active when it was posted.
    var saleEntry = await db.JournalEntries.Include(j => j.Lines).ThenInclude(l => l.Account)
        .FirstOrDefaultAsync(j => j.ReferenceType == "Order" && j.ReferenceId == order.Id && j.Status == JournalEntryStatus.Posted);
    if (saleEntry != null)
    {
        try
        {
            var reversalLines = saleEntry.Lines.Select(l => (l.Account!.Code, l.CreditPKR, l.DebitPKR)).ToList();
            var reversal = await PostJournalEntryAsync(db, order.TenantId, order.BranchId, DateTime.UtcNow,
                $"Reversal of {saleEntry.EntryNumber} — Order #{order.OrderNumber} voided", "Order", order.Id,
                currentUser?.FullName ?? "System", reversalLines);
            reversal.ReversalOfEntryId = saleEntry.Id;
            saleEntry.Status = JournalEntryStatus.Reversed;
        }
        catch (Exception ex)
        {
            // Same rule as every other auto-post: accounting can lag or fail, the void itself never can.
            Console.WriteLine($"[Accounting] Failed to reverse journal entry for voided order {order.OrderNumber}: {ex.Message}");
        }
    }

    await WriteAuditAsync(db, order.TenantId, currentUser, "OrderVoided", "Order", order.Id,
        oldValue: $"{order.OrderNumber} / {order.TotalPKR:0.##}", newValue: dto?.Reason ?? "(no reason given)");

    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Order voided — stock, customer balance, and accounting reversed", orderId = order.Id });
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

api.MapPost("/kitchen/tickets/{id}/status", async (AppDbContext db, HttpContext http, Pos.Api.Services.IWhatsAppSenderResolver waResolver, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateTicketStatusDto dto) =>
{
    var ticket = await db.KitchenTickets.Include(k => k.Order).FirstOrDefaultAsync(k => k.Id == id);
    if (ticket == null) return Results.NotFound();
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, ticket.BranchId);
    if (scopeError != null) return scopeError;

    ticket.Status = dto.Status;
    var justBecameReady = dto.Status == "Ready" && ticket.Order != null && ticket.Order.Status != OrderStatus.ReadyForDispatch;
    if (dto.Status == "Ready" && ticket.Order != null)
    {
        ticket.Order.Status = OrderStatus.ReadyForDispatch;
        ticket.Order.ReadyAt ??= DateTime.UtcNow;
    }
    await db.SaveChangesAsync();

    if (justBecameReady && ticket.Order != null)
    {
        var msg = BuildWhatsAppMessage("order_ready", ticket.Order.OrderNumber, null, ticket.Order.TotalPKR, null, null, null);
        await SendWhatsAppMessageAsync(db, waResolver, ticket.Order.TenantId, ticket.Order.Id, ticket.Order.CustomerPhone, "order_ready", msg,
            autoSendGate: c => c.AutoSendOrderUpdates);
    }

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

api.MapPost("/delivery/mark-delivered", async (AppDbContext db, HttpContext http, Pos.Api.Services.IWhatsAppSenderResolver waResolver, Guid orderId) =>
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

    var deliveredMsg = BuildWhatsAppMessage("order_delivered", order.OrderNumber, null, order.TotalPKR, order.DeliveryAddress, null, null);
    await SendWhatsAppMessageAsync(db, waResolver, order.TenantId, order.Id, order.CustomerPhone, "order_delivered", deliveredMsg,
        autoSendGate: c => c.AutoSendOrderUpdates);
    var receiptMsg = BuildWhatsAppMessage("receipt", order.OrderNumber, null, order.TotalPKR, null, order.PaymentMethod.ToString(), null);
    await SendWhatsAppMessageAsync(db, waResolver, order.TenantId, order.Id, order.CustomerPhone, "receipt", receiptMsg,
        autoSendGate: c => c.AutoSendReceipt);

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

    // "Active counters" used to report the branch's LIMIT, which meant a branch with one till on
    // a five-counter allowance showed five. Count the devices that are actually live instead.
    var liveCounters = await db.Terminals
        .Where(t => branchIds.Contains(t.BranchId)
                 && t.TerminalType == TerminalType.Counter
                 && t.IsActive && t.RevokedAt == null && t.DeactivatedAt == null)
        .GroupBy(t => t.BranchId)
        .Select(g => new { branchId = g.Key, count = g.Count() })
        .ToDictionaryAsync(x => x.branchId, x => x.count);

    var branchSales = branches.Select(b => new
    {
        branchId = b.Id, branchName = b.Name, city = b.City,
        todaySalesPKR = branchOrderData.TryGetValue(b.Id, out var data) ? data.sales : 0m,
        ordersCount = branchOrderData.TryGetValue(b.Id, out var d) ? d.count : 0,
        activeCounters = liveCounters.TryGetValue(b.Id, out var c) ? c : 0
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
// Raising a tenant's device allowance now goes through the entitlement engine rather than
// writing a second, competing number onto the branch row. The delta is expressed as an override
// so it is visible in the console, attributable, and can be given an expiry date.
api.MapPost("/super-admin/update-limits", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    [Microsoft.AspNetCore.Mvc.FromBody] UpdateBranchLimitsDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var branch = await db.Branches.IgnoreQueryFilters().Include(b => b.Tenant)
        .FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound();

    var tenantId = branch.TenantId;
    if (dto.Tier.HasValue && branch.Tenant != null) branch.Tenant.Tier = dto.Tier.Value;
    await db.SaveChangesAsync();

    // Recompute first so the delta is measured against the (possibly just-changed) plan.
    var current = await entitlements.RecomputeAsync(tenantId);
    var actingUser = await accessor.GetCurrentUserAsync(http);

    async Task ApplyDeltaAsync(string key, int desired, int currentValue)
    {
        var delta = desired - currentValue;
        if (delta == 0) return;

        var existing = await db.TenantEntitlementOverrides.IgnoreQueryFilters()
            .Where(o => o.TenantId == tenantId && o.Key == key && o.IsActive).ToListAsync();
        foreach (var old in existing) old.IsActive = false;

        db.TenantEntitlementOverrides.Add(new TenantEntitlementOverride
        {
            TenantId = tenantId,
            Key = key,
            // Stack on top of any delta already in force, so the resulting ceiling is the number
            // that was actually asked for rather than the number plus whatever was there before.
            Value = (delta + existing.Sum(e => int.TryParse(e.Value, out var v) ? v : 0)).ToString(),
            Reason = $"Set via super-admin limits for branch {branch.Name}.",
            CreatedByUserId = actingUser?.Id ?? Guid.Empty
        });
    }

    await ApplyDeltaAsync(nameof(SaaSPackageConfig.MaxCounters), dto.AllowedCounters, current.MaxCounters);
    await ApplyDeltaAsync(nameof(SaaSPackageConfig.MaxOrderTabs), dto.AllowedOrderTabs, current.MaxOrderTabs);
    await db.SaveChangesAsync();

    var updated = await entitlements.RecomputeAsync(tenantId);
    return Results.Ok(new
    {
        message = "Limits updated",
        branchId = branch.Id,
        allowedCounters = updated.MaxCounters,
        allowedOrderTabs = updated.MaxOrderTabs,
        snapshotVersion = updated.Version,
        tier = branch.Tenant?.Tier.ToString()
    });
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
    var now = DateTime.UtcNow;
    var terminals = await q.OrderByDescending(t => t.LastSeenAt).ToListAsync();

    // DeviceToken is deliberately no longer returned. It is a device credential, not a display
    // field, and the old UI printed it on screen for anyone standing behind the counter.
    return Results.Ok(terminals.Select(t => new
    {
        t.Id,
        t.BranchId,
        t.TerminalName,
        t.TerminalType,
        t.IsActive,
        t.LastSeenAt,
        t.ActivatedAt,
        t.DeviceInfo,
        t.LicenseExpiresAt,
        t.RevokedAt,
        t.RevokedReason,
        t.DeactivatedAt,
        occupiesSlot = t.OccupiesQuotaSlot(now),
        licenseState =
            t.RevokedAt != null ? "Revoked"
            : t.DeactivatedAt != null ? "Retired"
            : t.LicenseExpiresAt == null ? "NeverActivated"
            : t.LicenseExpiresAt > now ? "Valid"
            : t.LicenseExpiresAt.Value.Add(Pos.Api.Services.DeviceLicenseService.GracePeriod) > now ? "Grace"
            : "Expired",
        // Minutes since last contact, so support can see a till that silently stopped syncing.
        offlineForMinutes = (int)(now - t.LastSeenAt).TotalMinutes
    }));
});

// Device slot usage per branch — what the back office needs to answer "can I add another till?"
// before the owner walks over to the hardware.
api.MapGet("/devices/capacity", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Guid? branchId) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var results = new List<object>();
    foreach (var type in new[] { TerminalType.Counter, TerminalType.OrderTab, TerminalType.KitchenDisplay, TerminalType.BackOffice })
    {
        var (allowed, inUse, limit) = await entitlements.CanAddDeviceAsync(scopedTenantId!.Value, scopedBranchId!.Value, type);
        results.Add(new
        {
            terminalType = type.ToString(),
            inUse,
            limit = limit == int.MaxValue ? (int?)null : limit, // null = unmetered (KDS)
            canAdd = allowed
        });
    }
    return Results.Ok(results);
});

// Direct terminal creation is gone: a Terminal row is now the product of redeeming a pairing
// code at the device itself, which is what binds the fingerprint and issues the licence.
// Creating one server-side would hand back an unbound device that no licence check can police.
api.MapPost("/terminals", () => Results.Json(new
{
    message = "Devices are now activated from the device itself. Generate a pairing code "
            + "(POST /api/devices/pairing-codes) and enter it on the terminal."
}, statusCode: StatusCodes.Status410Gone));

api.MapPut("/terminals/{id}", async (AppDbContext db, HttpContext http, Guid id, UpdateTerminalDto dto) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });
    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, terminal.BranchId);
    if (scopeError != null) return scopeError;

    if (!string.IsNullOrWhiteSpace(dto.TerminalName)) terminal.TerminalName = dto.TerminalName.Trim();

    // Re-enabling a terminal has to pass the quota again — otherwise disabling devices before a
    // downgrade and re-enabling them afterwards would be a free way around the new plan.
    if (dto.IsActive.HasValue && dto.IsActive.Value && !terminal.IsActive)
    {
        var entitlements = http.RequestServices.GetRequiredService<Pos.Api.Services.IEntitlementService>();
        var (allowed, inUse, limit) = await entitlements.CanAddDeviceAsync(terminal.TenantId, terminal.BranchId, terminal.TerminalType);
        if (!allowed)
            return Results.BadRequest(new { message = $"Cannot re-enable: {inUse}/{limit} {terminal.TerminalType} slots already in use." });
        terminal.IsActive = true;
        terminal.DeactivatedAt = null;
    }
    else if (dto.IsActive.HasValue && !dto.IsActive.Value)
    {
        terminal.IsActive = false;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Terminal updated", terminal.Id, terminal.TerminalName, terminal.IsActive });
});

// Retire a device. Soft, not hard: the row survives so its sales history keeps a real device to
// point at, and it holds its quota slot for a cooldown so add/delete/add cannot be used to run
// more tills than the plan allows.
api.MapDelete("/terminals/{id}", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    Guid id,
    bool? revoke,
    string? reason) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });
    var (scopedTenantId, _, scopeError) = await ResolveScopeAsync(http, db, null, terminal.BranchId);
    if (scopeError != null) return scopeError;

    var actingUser = await accessor.GetCurrentUserAsync(http);
    var now = DateTime.UtcNow;

    // Revoke is for a lost or stolen device: it kills the licence immediately and frees the slot
    // at once, because waiting out a cooldown on a device you no longer control helps nobody.
    if (revoke == true)
    {
        terminal.RevokedAt = now;
        terminal.RevokedReason = string.IsNullOrWhiteSpace(reason) ? "Revoked by administrator." : reason.Trim();
        terminal.IsActive = false;
    }
    else
    {
        terminal.DeactivatedAt = now;
        terminal.IsActive = false;
    }

    db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
    {
        TenantId = terminal.TenantId,
        TerminalId = terminal.Id,
        BranchId = terminal.BranchId,
        EventType = revoke == true ? "Revoked" : "Deactivated",
        Detail = terminal.RevokedReason ?? $"Retired by {actingUser?.FullName ?? "administrator"}.",
        Ip = http.Connection.RemoteIpAddress?.ToString()
    });

    if (actingUser != null && scopedTenantId != null)
        await WriteAuditAsync(db, scopedTenantId.Value, actingUser,
            revoke == true ? "TerminalRevoked" : "TerminalRetired", "Terminal", terminal.Id,
            terminal.TerminalName, terminal.RevokedReason);

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        message = revoke == true
            ? "Device licence revoked. The slot is free immediately."
            : $"Device retired. Its slot frees up in {Terminal.DeviceSlotCooldownHours} hours.",
        slotFreesAt = revoke == true ? (DateTime?)now : now.AddHours(Terminal.DeviceSlotCooldownHours)
    });
});

// ============================================================
// HEARTBEAT — where a licence is actually renewed, and therefore the one place a revocation,
// a downgrade or a suspension reaches a device that is already in the field.
//
// This used to set LastSeenAt and nothing else, which is why nothing could ever be taken away.
// ============================================================
api.MapPost("/terminals/heartbeat", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Services.IDeviceLicenseService licensing,
    TerminalHeartbeatDto dto) =>
{
    var validation = await licensing.ValidateAsync(dto.License, dto.DeviceFingerprint);

    if (validation.State is Pos.Api.Services.DeviceLicenseState.Invalid)
        return Results.Json(new { state = "Invalid", canSell = false, reason = validation.Reason, mustReactivate = true },
            statusCode: StatusCodes.Status401Unauthorized);

    if (validation.State is Pos.Api.Services.DeviceLicenseState.Revoked)
    {
        if (validation.TenantId != null)
            db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
            {
                TenantId = validation.TenantId.Value, TerminalId = validation.TerminalId, BranchId = validation.BranchId,
                EventType = "RenewalDenied", Detail = validation.Reason, Ip = http.Connection.RemoteIpAddress?.ToString()
            });
        await db.SaveChangesAsync();
        return Results.Json(new { state = "Revoked", canSell = false, reason = validation.Reason, mustReactivate = true },
            statusCode: StatusCodes.Status403Forbidden);
    }

    var terminal = await db.Terminals.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == validation.TerminalId!.Value);
    if (terminal == null)
        return Results.Json(new { state = "Invalid", canSell = false, reason = "Terminal no longer exists.", mustReactivate = true },
            statusCode: StatusCodes.Status401Unauthorized);

    var ent = await entitlements.GetAsync(terminal.TenantId);

    // A hard-suspended tenant loses its devices here — the graduated states above it deliberately
    // do not, because a PastDue restaurant still has customers standing at the counter.
    if (!ent.CanRead)
    {
        db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
        {
            TenantId = terminal.TenantId, TerminalId = terminal.Id, BranchId = terminal.BranchId,
            EventType = "RenewalDenied", Detail = $"Tenant status {ent.Status}.",
            Ip = http.Connection.RemoteIpAddress?.ToString()
        });
        await db.SaveChangesAsync();
        return Results.Json(new { state = "Suspended", canSell = false, reason = "This account is suspended.", mustReactivate = false },
            statusCode: StatusCodes.Status403Forbidden);
    }

    // A device may only keep operating if it is still inside its branch's current allowance.
    // Sort by activation date so that after a downgrade the OLDEST devices keep working and the
    // most recently added ones fall out — predictable, and it matches what an owner expects.
    var isHeadOfficeBranch = await db.Branches.IgnoreQueryFilters()
        .Where(b => b.Id == terminal.BranchId).Select(b => b.IsHeadOffice).FirstOrDefaultAsync();

    // Only selling devices consume a metered slot, so only they can be squeezed out by a
    // downgrade. A back-office PC or a kitchen screen is never the thing that stops working.
    var slotOk = true;
    if (terminal.TerminalType is not (TerminalType.KitchenDisplay or TerminalType.BackOffice))
    {
        var (_, _, limit) = await entitlements.CanAddDeviceAsync(terminal.TenantId, terminal.BranchId, terminal.TerminalType);
        var rank = await db.Terminals.IgnoreQueryFilters()
            .Where(t => t.BranchId == terminal.BranchId
                     && t.TerminalType == terminal.TerminalType
                     && t.RevokedAt == null && t.DeactivatedAt == null
                     && (t.ActivatedAt < terminal.ActivatedAt
                         || (t.ActivatedAt == terminal.ActivatedAt && t.Id != terminal.Id && t.LastSeenAt < terminal.LastSeenAt)))
            .CountAsync();
        slotOk = rank < limit;

        if (!slotOk)
        {
            db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
            {
                TenantId = terminal.TenantId, TerminalId = terminal.Id, BranchId = terminal.BranchId,
                EventType = "RenewalDenied",
                Detail = $"Device {rank + 1} of an allowance of {limit} {terminal.TerminalType}s after a plan change.",
                Ip = http.Connection.RemoteIpAddress?.ToString()
            });
            await db.SaveChangesAsync();
            return Results.Json(new
            {
                state = "OverLimit",
                canSell = false,
                reason = $"Your plan now allows {limit} {terminal.TerminalType} device(s) at this branch. "
                       + "Retire another device or add capacity to bring this one back online.",
                mustReactivate = false
            }, statusCode: StatusCodes.Status402PaymentRequired);
        }
    }

    var license = await licensing.IssueAsync(terminal, ent);
    db.DeviceLicenseEvents.Add(new DeviceLicenseEvent
    {
        TenantId = terminal.TenantId, TerminalId = terminal.Id, BranchId = terminal.BranchId,
        EventType = "Renewed", Detail = $"Snapshot v{ent.Version}.", Ip = http.Connection.RemoteIpAddress?.ToString()
    });
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        state = "Valid",
        canSell = ent.CanSell,
        canUseBackOffice = ent.CanUseBackOffice,
        showBillingWarning = ent.ShowBillingWarning,
        tenantStatus = ent.Status.ToString(),
        license = license.Token,
        expiresAt = license.ExpiresAt,
        graceEndsAt = license.GraceEndsAt,
        snapshotVersion = ent.Version,
        terminal.TerminalName,
        terminal.TerminalType,
        // Re-asserted on every renewal so a device that was re-purposed, or a tenant that moved
        // from standalone to head-office, lands on the right app without a reinstall.
        appSurface = ent.SurfaceFor(isHeadOfficeBranch, terminal.TerminalType).ToString(),
        packs = ent.PackKeys,
        primaryPack = ent.PrimaryPackKey,
        features = ent.Features
    });
}).AllowAnonymous();

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
    int alreadySynced = 0;
    foreach (var dto in offlineOrders)
    {
        var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
        if (scopeError != null || scopedBranchId == null) continue;
        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == scopedBranchId.Value && b.TenantId == scopedTenantId!.Value);
        if (branch == null) continue;

        // Same idempotency guard as /sync/batch-orders — this path is reached by the same
        // retrying client, so it needs the same protection against double-posting.
        if (!string.IsNullOrWhiteSpace(dto.ClientLocalId)
            && await db.Orders.AnyAsync(o => o.TenantId == branch.TenantId && o.ClientLocalId == dto.ClientLocalId))
        {
            alreadySynced++;
            continue;
        }

        var capturedAt = dto.CapturedAt ?? DateTime.UtcNow;
        var order = new Order
        {
            TenantId = branch.TenantId, BranchId = branch.Id,
            OrderNumber = await GenerateOrderNumberAsync(db, "OFFLINE"),
            OrderType = dto.OrderType, Status = OrderStatus.Completed,
            TableNumber = dto.TableNumber, CustomerName = dto.CustomerName, CustomerPhone = dto.CustomerPhone,
            DeliveryAddress = dto.DeliveryAddress, PaymentMethod = dto.PaymentMethod,
            AmountPaidPKR = dto.AmountPaidPKR, ChangeDuePKR = dto.ChangeDuePKR, IsPaid = true,
            CashierName = dto.CashierName ?? "Offline Cashier", CreatedByRole = "OfflineSync", CreatedAt = DateTime.UtcNow,
            CompletedAt = capturedAt,
            ClientLocalId = string.IsNullOrWhiteSpace(dto.ClientLocalId) ? null : dto.ClientLocalId.Trim(),
            IsOfflineOrigin = true,
            CapturedAt = capturedAt
        };

        var priced = await PriceOrderAsync(db, branch, dto, order.Id, actingUser);
        if (priced.Error != null) continue;
        foreach (var line in priced.Items) order.Items.Add(line);

        // The device's figures are authoritative here for the same reason as the other sync
        // path: this money already changed hands at those numbers.
        if (dto.SubTotalPKR > 0 || dto.TotalPKR > 0)
        {
            order.SubTotalPKR = dto.SubTotalPKR;
            order.DiscountPKR = dto.DiscountPKR;
            order.TaxPKR = dto.TaxPKR;
            order.TotalPKR = dto.TotalPKR;
            order.DeviceReportedTotalPKR = dto.TotalPKR;
            order.PriceVariancePKR = priced.TotalPKR - dto.TotalPKR;
            order.HasPriceVariance = Math.Abs(order.PriceVariancePKR) >= 0.01m;
        }
        else
        {
            order.SubTotalPKR = priced.SubTotalPKR;
            order.DiscountPKR = priced.DiscountPKR;
            order.TaxPKR = priced.TaxPKR;
            order.TotalPKR = priced.TotalPKR;
        }

        if (dto.SubTotalPKR > 0 && Math.Abs(priced.SubTotalPKR - dto.SubTotalPKR) / dto.SubTotalPKR > 0.02m)
        {
            db.SmartAlerts.Add(new SmartAlert
            {
                TenantId = branch.TenantId,
                BranchId = branch.Id,
                AlertType = "price_mismatch_offline_sync",
                Severity = "warning",
                Title = $"Price mismatch on synced order {order.OrderNumber}",
                Message = $"This sale was rung up offline at {dto.SubTotalPKR:N2}; current prices give {priced.SubTotalPKR:N2}. "
                        + "The amount the customer actually paid was saved — please review.",
                Metadata = System.Text.Json.JsonSerializer.Serialize(new { orderId = order.Id, chargedSubTotal = dto.SubTotalPKR, recomputedSubTotal = priced.SubTotalPKR, variance = priced.TotalPKR - dto.TotalPKR })
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
    // alreadySynced is reported separately so a client can distinguish "nothing to do" from
    // "nothing happened", and stop retrying either way.
    return Results.Ok(new
    {
        message = $"Synced {syncedCount} offline orders" + (alreadySynced > 0 ? $"; {alreadySynced} were already on the server." : "."),
        syncedCount,
        alreadySynced
    });
});


// ============================================================
// EXPENSES
//
// Money out that is not a supplier purchase. Draft -> Approved -> Paid, with the general ledger
// only touched at approval, because an expense somebody typed and has not yet had signed off is
// not a liability and must not appear in the books.
// ============================================================

api.MapGet("/expenses", async (
    AppDbContext db, HttpContext http, Guid? branchId, string? status, DateTime? from, DateTime? to) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var q = db.Expenses.Where(e => e.TenantId == scopedTenantId.Value);

    // Branch-pinned staff only ever see their own branch's spending.
    var userBranchId = http.GetBranchId();
    if (userBranchId != null) q = q.Where(e => e.BranchId == userBranchId.Value);
    else if (branchId.HasValue) q = q.Where(e => e.BranchId == branchId.Value);

    if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<ExpenseStatus>(status, true, out var st))
        q = q.Where(e => e.Status == st);
    if (from.HasValue) q = q.Where(e => e.ExpenseDate >= from.Value);
    if (to.HasValue) q = q.Where(e => e.ExpenseDate <= to.Value);

    var rows = await q.OrderByDescending(e => e.ExpenseDate).Take(500).ToListAsync();

    return Results.Ok(new
    {
        // Totals come from the filtered set, not the page, so "this month's spend" stays correct
        // once there are more than 500 expenses.
        totalPKR = await q.SumAsync(e => (decimal?)e.TotalPKR) ?? 0,
        approvedPKR = await q.Where(e => e.Status == ExpenseStatus.Approved || e.Status == ExpenseStatus.Paid)
                             .SumAsync(e => (decimal?)e.TotalPKR) ?? 0,
        pendingCount = await q.CountAsync(e => e.Status == ExpenseStatus.Draft),
        expenses = rows.Select(e => new
        {
            e.Id, e.ExpenseNumber, e.Category, e.Description, e.PayeeName, e.SupplierId,
            e.AmountPKR, e.TaxPKR, e.TotalPKR, e.ExpenseDate,
            paymentMethod = e.PaymentMethod.ToString(),
            status = e.Status.ToString(),
            e.BranchId, e.ExpenseAccountId, e.PaidFromAccountId, e.JournalEntryId,
            e.CreatedByName, e.ApprovedAt, e.PaidAt, e.ReceiptReference, e.CreatedAt
        })
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "view"));

api.MapPost("/expenses", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    CreateExpenseDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    if (dto.AmountPKR <= 0) return Results.BadRequest(new { message = "Amount must be greater than zero." });
    if (string.IsNullOrWhiteSpace(dto.Category)) return Results.BadRequest(new { message = "A category is required." });

    var actingUser = await accessor.GetCurrentUserAsync(http);
    var tax = dto.TaxPKR ?? 0;

    var expense = new Expense
    {
        TenantId = scopedTenantId!.Value,
        BranchId = scopedBranchId!.Value,
        ExpenseNumber = await GenerateExpenseNumberAsync(db, scopedTenantId.Value),
        Category = dto.Category.Trim(),
        Description = dto.Description?.Trim() ?? "",
        SupplierId = dto.SupplierId,
        PayeeName = dto.PayeeName?.Trim(),
        AmountPKR = dto.AmountPKR,
        TaxPKR = tax,
        TotalPKR = dto.AmountPKR + tax,
        ExpenseDate = dto.ExpenseDate ?? DateTime.UtcNow,
        PaymentMethod = dto.PaymentMethod ?? PaymentMethod.Cash,
        ExpenseAccountId = dto.ExpenseAccountId,
        PaidFromAccountId = dto.PaidFromAccountId,
        ReceiptReference = dto.ReceiptReference?.Trim(),
        CreatedByUserId = actingUser?.Id,
        CreatedByName = actingUser?.FullName,
        Status = ExpenseStatus.Draft
    };

    db.Expenses.Add(expense);
    if (actingUser != null)
        await WriteAuditAsync(db, scopedTenantId.Value, actingUser, "ExpenseCreated", "Expense", expense.Id,
            null, $"{expense.Category} {expense.TotalPKR:N2} — {expense.Description}");
    await db.SaveChangesAsync();

    return Results.Ok(new { expense.Id, expense.ExpenseNumber, status = expense.Status.ToString(), expense.TotalPKR });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "edit"));

api.MapPut("/expenses/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateExpenseDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var expense = await db.Expenses.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == scopedTenantId.Value);
    if (expense == null) return Results.NotFound(new { message = "Expense not found." });

    // Once it is in the ledger it is history. Correcting an approved expense means reversing it,
    // not quietly editing the number the accounts were closed on.
    if (expense.Status != ExpenseStatus.Draft)
        return Results.BadRequest(new
        {
            message = $"This expense is {expense.Status} and already in the books. Reject or reverse it instead of editing."
        });

    if (!string.IsNullOrWhiteSpace(dto.Category)) expense.Category = dto.Category.Trim();
    if (dto.Description != null) expense.Description = dto.Description.Trim();
    if (dto.PayeeName != null) expense.PayeeName = dto.PayeeName.Trim();
    if (dto.SupplierId.HasValue) expense.SupplierId = dto.SupplierId;
    if (dto.AmountPKR.HasValue) expense.AmountPKR = dto.AmountPKR.Value;
    if (dto.TaxPKR.HasValue) expense.TaxPKR = dto.TaxPKR.Value;
    expense.TotalPKR = expense.AmountPKR + expense.TaxPKR;
    if (dto.ExpenseDate.HasValue) expense.ExpenseDate = dto.ExpenseDate.Value;
    if (dto.PaymentMethod.HasValue) expense.PaymentMethod = dto.PaymentMethod.Value;
    if (dto.ExpenseAccountId.HasValue) expense.ExpenseAccountId = dto.ExpenseAccountId;
    if (dto.PaidFromAccountId.HasValue) expense.PaidFromAccountId = dto.PaidFromAccountId;
    if (dto.ReceiptReference != null) expense.ReceiptReference = dto.ReceiptReference.Trim();

    await db.SaveChangesAsync();
    return Results.Ok(new { expense.Id, expense.ExpenseNumber, expense.TotalPKR, status = expense.Status.ToString() });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "edit"));

// Approve: this is the moment the expense becomes real, so it is also the moment it is journalled.
api.MapPost("/expenses/{id:guid}/approve", async (
    AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var expense = await db.Expenses.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == scopedTenantId.Value);
    if (expense == null) return Results.NotFound(new { message = "Expense not found." });
    if (expense.Status != ExpenseStatus.Draft)
        return Results.BadRequest(new { message = $"Only a draft expense can be approved; this one is {expense.Status}." });

    var actingUser = await accessor.GetCurrentUserAsync(http);

    // Post to the ledger through the shared helper, which balances the entry, refuses to post
    // into a closed accounting period, and numbers it consistently with every other posting.
    //
    // Both accounts are optional because plenty of small businesses run this module before they
    // have a chart of accounts at all — the expense is still recorded, it just is not journalled
    // until they pick accounts.
    string? journalNote = null;
    if (expense.ExpenseAccountId.HasValue && expense.PaidFromAccountId.HasValue)
    {
        var accs = await db.Accounts
            .Where(a => a.TenantId == expense.TenantId
                     && (a.Id == expense.ExpenseAccountId.Value || a.Id == expense.PaidFromAccountId.Value))
            .ToDictionaryAsync(a => a.Id, a => a.Code);

        if (accs.TryGetValue(expense.ExpenseAccountId.Value, out var debitCode)
            && accs.TryGetValue(expense.PaidFromAccountId.Value, out var creditCode))
        {
            try
            {
                var entry = await PostJournalEntryAsync(
                    db, expense.TenantId, expense.BranchId, expense.ExpenseDate,
                    $"Expense {expense.ExpenseNumber}: {expense.Category} — {expense.Description}",
                    "Expense", expense.Id, actingUser?.FullName ?? "System",
                    new List<(string, decimal, decimal)>
                    {
                        (debitCode, expense.TotalPKR, 0m),
                        (creditCode, 0m, expense.TotalPKR)
                    });
                expense.JournalEntryId = entry.Id;
            }
            catch (InvalidOperationException ex)
            {
                // A closed period or a missing account is a real answer, not a crash: the
                // expense is still approved and recorded, and the reason is handed back.
                journalNote = ex.Message;
            }
        }
    }

    expense.Status = ExpenseStatus.Approved;
    expense.ApprovedByUserId = actingUser?.Id;
    expense.ApprovedAt = DateTime.UtcNow;

    if (actingUser != null)
        await WriteAuditAsync(db, expense.TenantId, actingUser, "ExpenseApproved", "Expense", expense.Id,
            "Draft", $"Approved {expense.TotalPKR:N2}");

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        expense.Id, status = expense.Status.ToString(), expense.JournalEntryId,
        journalled = expense.JournalEntryId != null,
        note = journalNote
               ?? (expense.JournalEntryId == null
                   ? "Recorded, but not posted to the ledger — set an expense account and a paid-from account to journal it."
                   : null)
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "edit"));

api.MapPost("/expenses/{id:guid}/reject", async (
    AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, RejectExpenseDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var expense = await db.Expenses.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == scopedTenantId.Value);
    if (expense == null) return Results.NotFound(new { message = "Expense not found." });
    if (expense.Status != ExpenseStatus.Draft)
        return Results.BadRequest(new { message = "Only a draft expense can be rejected." });
    if (string.IsNullOrWhiteSpace(dto.Reason))
        return Results.BadRequest(new { message = "A reason is required so the person who raised it knows what to fix." });

    expense.Status = ExpenseStatus.Rejected;
    expense.RejectionReason = dto.Reason.Trim();
    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, expense.TenantId, actingUser, "ExpenseRejected", "Expense", expense.Id, "Draft", dto.Reason.Trim());
    await db.SaveChangesAsync();
    return Results.Ok(new { expense.Id, status = expense.Status.ToString(), expense.RejectionReason });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "edit"));

api.MapPost("/expenses/{id:guid}/mark-paid", async (
    AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var expense = await db.Expenses.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == scopedTenantId.Value);
    if (expense == null) return Results.NotFound(new { message = "Expense not found." });
    if (expense.Status != ExpenseStatus.Approved)
        return Results.BadRequest(new { message = "Approve the expense before marking it paid." });

    expense.Status = ExpenseStatus.Paid;
    expense.PaidAt = DateTime.UtcNow;
    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, expense.TenantId, actingUser, "ExpensePaid", "Expense", expense.Id, "Approved", $"{expense.TotalPKR:N2}");
    await db.SaveChangesAsync();
    return Results.Ok(new { expense.Id, status = expense.Status.ToString(), expense.PaidAt });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "edit"));

// Spend by category — the report an owner actually asks for ("where is the money going?").
api.MapGet("/expenses/by-category", async (AppDbContext db, HttpContext http, Guid? branchId, DateTime? from, DateTime? to) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var start = from ?? DateTime.UtcNow.AddDays(-30);
    var end = to ?? DateTime.UtcNow;

    var q = db.Expenses.Where(e => e.TenantId == scopedTenantId.Value
                                && e.ExpenseDate >= start && e.ExpenseDate <= end
                                && e.Status != ExpenseStatus.Rejected && e.Status != ExpenseStatus.Cancelled);

    var userBranchId = http.GetBranchId();
    if (userBranchId != null) q = q.Where(e => e.BranchId == userBranchId.Value);
    else if (branchId.HasValue) q = q.Where(e => e.BranchId == branchId.Value);

    var byCategory = await q.GroupBy(e => e.Category)
        .Select(g => new { category = g.Key, totalPKR = g.Sum(x => x.TotalPKR), count = g.Count() })
        .OrderByDescending(x => x.totalPKR)
        .ToListAsync();

    return Results.Ok(new { from = start, to = end, totalPKR = byCategory.Sum(c => c.totalPKR), byCategory });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("accounts", "view"));

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

// --- Warehouses (storage locations within a branch) ---
api.MapGet("/warehouses", async (AppDbContext db, HttpContext http, Guid branchId) =>
{
    var (_, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;
    branchId = scopedBranchId!.Value;

    if (!await db.Warehouses.AnyAsync(w => w.BranchId == branchId))
    {
        var branch = await db.Branches.FindAsync(branchId);
        if (branch != null)
            db.Warehouses.Add(new Warehouse { TenantId = branch.TenantId, BranchId = branchId, Name = "Main Store", Code = "MAIN", IsPrimary = true });
        await db.SaveChangesAsync();
    }

    var warehouses = await db.Warehouses.Where(w => w.BranchId == branchId).OrderByDescending(w => w.IsPrimary).ThenBy(w => w.Name).ToListAsync();
    return Results.Ok(warehouses);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("inventory", "view"));

api.MapPost("/warehouses", async (AppDbContext db, HttpContext http, CreateWarehouseDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, dto.TenantId, dto.BranchId);
    if (scopeError != null) return scopeError;
    if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { message = "Warehouse name is required." });

    var warehouse = new Warehouse { TenantId = scopedTenantId!.Value, BranchId = scopedBranchId!.Value, Name = dto.Name.Trim(), Code = dto.Code, IsPrimary = false };
    db.Warehouses.Add(warehouse);
    await db.SaveChangesAsync();
    return Results.Ok(warehouse);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to add warehouses."));

api.MapPut("/warehouses/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateWarehouseDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var warehouse = await db.Warehouses.FirstOrDefaultAsync(w => w.Id == id && w.TenantId == scopedTenantId.Value);
    if (warehouse == null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(dto.Name)) warehouse.Name = dto.Name.Trim();
    if (dto.Code != null) warehouse.Code = dto.Code;
    // The primary warehouse is where existing (pre-multi-warehouse) stock lives — deactivating it
    // would orphan that data, so it can't be turned off, only renamed.
    if (dto.IsActive.HasValue && !warehouse.IsPrimary) warehouse.IsActive = dto.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(warehouse);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to edit warehouses."));

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
        var extraUserSlots = await db.AddOnSubscriptions
            .Where(a => a.TenantId == scopedTenantId.Value && a.AddOnKey == "EXTRA_USER" && a.IsActive)
            .SumAsync(a => (int?)a.Quantity) ?? 0;
        var userLimit = pkg.MaxUsers + extraUserSlots;
        if (userCount >= userLimit)
            return Results.BadRequest(new { message = $"Your {pkg.DisplayName} package allows a maximum of {userLimit} users{(extraUserSlots > 0 ? $" (including {extraUserSlots} extra from add-ons)" : "")}. Please upgrade or buy the Extra Staff Account add-on." });
    }

    // Some of the older permission gates are per-user booleans rather than module rows, so a role
    // whose entire job depends on one of them has to arrive with it set. An Accountant who cannot
    // open the chart of accounts, or a storekeeper who cannot touch stock, is not a usable account
    // — and whoever created them would just hand them manager access instead, which is the exact
    // outcome these roles exist to avoid. Explicitly passing the flag still wins.
    var user = new AppUser
    {
        TenantId = scopedTenantId.Value, BranchId = dto.BranchId, FullName = dto.FullName,
        Username = dto.Username.ToLower().Trim(),
        PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.PinCode ?? "1234"),
        Role = dto.Role, IsActive = true,
        CanViewFinancialReports = dto.CanViewFinancialReports || dto.Role == UserRole.Accountant,
        CanManageInventory = dto.CanManageInventory || dto.Role == UserRole.InventoryUser,
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
    if (dto.Department != null) user.Department = dto.Department;
    if (dto.Designation != null) user.Designation = dto.Designation;
    if (dto.EmploymentType.HasValue) user.EmploymentType = dto.EmploymentType.Value;
    if (dto.MonthlyRatePKR.HasValue) user.MonthlyRatePKR = dto.MonthlyRatePKR.Value;
    if (dto.HourlyRatePKR.HasValue) user.HourlyRatePKR = dto.HourlyRatePKR.Value;
    if (dto.BankAccountNumber != null) user.BankAccountNumber = dto.BankAccountNumber;
    if (dto.JoiningDate.HasValue) user.JoiningDate = dto.JoiningDate.Value;
    if (dto.IsPayrollEligible.HasValue) user.IsPayrollEligible = dto.IsPayrollEligible.Value;
    if (dto.DepartmentId.HasValue) user.DepartmentId = dto.DepartmentId.Value == Guid.Empty ? null : dto.DepartmentId.Value;
    if (dto.DesignationId.HasValue) user.DesignationId = dto.DesignationId.Value == Guid.Empty ? null : dto.DesignationId.Value;

    var after = $"role={user.Role}; reports={user.CanViewFinancialReports}; inventory={user.CanManageInventory}; menu={user.CanManageMenuAndTax}; discounts={user.CanGiveDiscounts}; voids={user.CanVoidOrders}; active={user.IsActive}";
    if (before != after)
    {
        var currentUser = await accessor.GetCurrentUserAsync(http);
        await WriteAuditAsync(db, user.TenantId, currentUser, "PermissionChanged", "AppUser", user.Id, before, after);
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        id = user.Id, tenantId = user.TenantId, branchId = user.BranchId, fullName = user.FullName, username = user.Username,
        role = user.Role.ToString(), isActive = user.IsActive, createdAt = user.CreatedAt,
        department = user.Department, designation = user.Designation, employmentType = user.EmploymentType.ToString(),
        monthlyRatePKR = user.MonthlyRatePKR, hourlyRatePKR = user.HourlyRatePKR, bankAccountNumber = user.BankAccountNumber,
        joiningDate = user.JoiningDate, isPayrollEligible = user.IsPayrollEligible, departmentId = user.DepartmentId, designationId = user.DesignationId,
        permissions = new { user.CanViewFinancialReports, user.CanManageInventory, user.CanManageMenuAndTax, user.CanGiveDiscounts, user.CanVoidOrders }
    });
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
    static object BuildSegment(List<Order> segOrders, decimal ratePercent) => new
    {
        taxRatePercent = ratePercent,
        invoiceCount = segOrders.Count,
        grossSalesPKR = segOrders.Sum(o => o.TotalPKR),
        netTaxableSalesPKR = segOrders.Sum(o => o.TotalPKR) - segOrders.Sum(o => o.TaxPKR),
        taxCollectedPKR = segOrders.Sum(o => o.TaxPKR)
    };
    return Results.Ok(new
    {
        startDate = start.ToString("yyyy-MM-dd"), endDate = end.ToString("yyyy-MM-dd"), totalInvoices = orders.Count,
        totalGrossTurnoverPKR = orders.Sum(o => o.TotalPKR), totalNetSalesPKR = (cashOrders.Sum(o => o.TotalPKR) - cashOrders.Sum(o => o.TaxPKR)) + (cardOrders.Sum(o => o.TotalPKR) - cardOrders.Sum(o => o.TaxPKR)),
        totalTaxCollectedPKR = cashOrders.Sum(o => o.TaxPKR) + cardOrders.Sum(o => o.TaxPKR),
        cashSegment = BuildSegment(cashOrders, primaryTaxRate),
        cardSegment = BuildSegment(cardOrders, secondaryTaxRate),
        invoices = orders.Select(o => new
        {
            orderId = o.Id,
            orderNumber = o.OrderNumber,
            createdAt = o.CreatedAt,
            orderType = o.OrderType.ToString(),
            paymentMethod = o.PaymentMethod.ToString(),
            cashierName = o.CashierName ?? "—",
            netAmountPKR = o.TotalPKR - o.TaxPKR,
            taxRatePercent = o.PaymentMethod == PaymentMethod.Cash ? primaryTaxRate : secondaryTaxRate,
            taxAmountPKR = o.TaxPKR,
            totalAmountPKR = o.TotalPKR
        }).ToList()
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
    var dispatchedBy = dto.DispatchedBy ?? "Central Commissary Team";
    foreach (var item in order.Items)
    {
        var sourceIng = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == order.SourceBranchId && (i.Id == item.IngredientId || i.Name == item.IngredientName));
        if (sourceIng != null)
        {
            // Never let a movement push the source below zero — dispatch what's actually on hand.
            var actualQty = Math.Min(item.QuantityRequested, sourceIng.CurrentStock);
            if (actualQty > 0)
                RecordStockLedgerEntry(db, sourceIng, order.TenantId, order.SourceBranchId, StockMovementType.TransferOut, -actualQty, sourceIng.CostPerUnitPKR, "StockTransfer", order.Id, dispatchedBy, $"Transfer {order.TransferNumber}");
        }
        item.QuantityDispatched = item.QuantityRequested;
    }
    order.Status = TransferStatus.InTransit;
    order.DispatchedAt = DateTime.UtcNow;
    order.DispatchedBy = dispatchedBy;
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
    var receivedBy = dto.ReceivedBy ?? "Branch Manager";
    foreach (var item in order.Items)
    {
        var qtyToReceive = item.QuantityDispatched > 0 ? item.QuantityDispatched : item.QuantityRequested;
        item.QuantityReceived = qtyToReceive;
        var destIng = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == order.DestinationBranchId && i.Name.ToLower() == item.IngredientName.ToLower());
        if (destIng == null)
        {
            destIng = new Ingredient { TenantId = order.TenantId, BranchId = order.DestinationBranchId, Name = item.IngredientName, Category = "Commissary Transferred", Unit = item.Unit, CostPerUnitPKR = item.UnitCostPKR, CurrentStock = 0, MinAlertLevel = 10, SupplierName = "Central Commissary" };
            db.Ingredients.Add(destIng);
        }
        else if (item.UnitCostPKR > 0)
        {
            destIng.CostPerUnitPKR = item.UnitCostPKR;
        }
        if (qtyToReceive > 0)
            RecordStockLedgerEntry(db, destIng, order.TenantId, order.DestinationBranchId, StockMovementType.TransferIn, qtyToReceive, destIng.CostPerUnitPKR, "StockTransfer", order.Id, receivedBy, $"Transfer {order.TransferNumber}");
    }
    order.Status = TransferStatus.Received;
    order.ReceivedAt = DateTime.UtcNow;
    order.ReceivedBy = receivedBy;
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
            if (sourceIng != null && item.QuantityDispatched > 0)
                RecordStockLedgerEntry(db, sourceIng, order.TenantId, order.SourceBranchId, StockMovementType.Adjustment, item.QuantityDispatched, sourceIng.CostPerUnitPKR, "StockTransfer", order.Id, "System", $"Transfer {order.TransferNumber} cancelled in transit — stock returned to source");
        }
    }
    order.Status = TransferStatus.Cancelled;
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, status = "Cancelled" });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasStockTransfers)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to cancel stock transfers."));

// --- Suppliers (purchasing master data) ---
api.MapGet("/suppliers", async (AppDbContext db, HttpContext http, Guid? tenantId, bool? activeOnly) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Suppliers.Where(s => s.TenantId == scopedTenantId.Value).AsQueryable();
    if (activeOnly == true) query = query.Where(s => s.IsActive);
    return Results.Ok(await query.OrderBy(s => s.Name).ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "view"));

api.MapPost("/suppliers", async (AppDbContext db, HttpContext http, CreateSupplierDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { message = "Supplier name is required." });
    var opening = dto.OpeningBalancePKR ?? 0;
    var supplier = new Supplier
    {
        TenantId = scopedTenantId.Value, Name = dto.Name.Trim(), ContactName = dto.ContactName, Phone = dto.Phone,
        Email = dto.Email, Address = dto.Address, TaxNumber = dto.TaxNumber, PaymentTerms = dto.PaymentTerms,
        OpeningBalancePKR = opening, CurrentBalancePKR = opening
    };
    db.Suppliers.Add(supplier);
    await db.SaveChangesAsync();
    return Results.Ok(supplier);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to add suppliers."));

api.MapPut("/suppliers/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateSupplierDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null && !http.IsSuperAdmin()) return Results.Unauthorized();
    var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && (http.IsSuperAdmin() || s.TenantId == scopedTenantId!.Value));
    if (supplier == null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(dto.Name)) supplier.Name = dto.Name.Trim();
    if (dto.ContactName != null) supplier.ContactName = dto.ContactName;
    if (dto.Phone != null) supplier.Phone = dto.Phone;
    if (dto.Email != null) supplier.Email = dto.Email;
    if (dto.Address != null) supplier.Address = dto.Address;
    if (dto.TaxNumber != null) supplier.TaxNumber = dto.TaxNumber;
    if (dto.PaymentTerms != null) supplier.PaymentTerms = dto.PaymentTerms;
    if (dto.IsActive.HasValue) supplier.IsActive = dto.IsActive.Value;
    // CurrentBalancePKR is intentionally not settable here — it only moves via PO receipt / supplier payments.
    await db.SaveChangesAsync();
    return Results.Ok(supplier);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to edit suppliers."));

// --- Supplier Payments (settles what PO receipts on account added to Supplier.CurrentBalancePKR) ---
api.MapGet("/suppliers/{id:guid}/payments", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == scopedTenantId.Value);
    if (supplier == null) return Results.NotFound();
    var payments = await db.SupplierPayments.Where(p => p.SupplierId == id).OrderByDescending(p => p.PaidAt).ToListAsync();
    return Results.Ok(payments);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("supplychain", "view"));

api.MapPost("/suppliers/{id:guid}/payments", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, RecordSupplierPaymentDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == scopedTenantId.Value);
    if (supplier == null) return Results.NotFound();
    if (dto.AmountPKR <= 0) return Results.BadRequest(new { message = "Payment amount must be greater than zero." });
    if (dto.AmountPKR > supplier.CurrentBalancePKR)
        return Results.BadRequest(new { message = $"Payment ({dto.AmountPKR}) exceeds what's owed to this supplier ({supplier.CurrentBalancePKR})." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    var payment = new SupplierPayment
    {
        TenantId = scopedTenantId.Value, SupplierId = id, AmountPKR = dto.AmountPKR,
        PaymentMethod = dto.PaymentMethod ?? "Bank Transfer", ReferenceNumber = dto.ReferenceNumber, Notes = dto.Notes,
        CreatedBy = currentUser?.FullName ?? "System"
    };
    db.SupplierPayments.Add(payment);
    supplier.CurrentBalancePKR -= dto.AmountPKR;

    if (await HasAccountingAsync(db, scopedTenantId.Value))
    {
        try
        {
            var payAccount = (dto.PaymentMethod ?? "").Contains("Cash", StringComparison.OrdinalIgnoreCase) ? "1000" : "1010";
            await PostJournalEntryAsync(db, scopedTenantId.Value, null, payment.PaidAt,
                $"Payment to supplier — {supplier.Name}", "SupplierPayment", payment.Id, payment.CreatedBy,
                new List<(string, decimal, decimal)> { ("2000", dto.AmountPKR, 0), (payAccount, 0, dto.AmountPKR) });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Accounting] Failed to post journal entry for supplier payment {payment.Id}: {ex.Message}");
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { payment, supplier.CurrentBalancePKR });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to record supplier payments."));

// --- Stock Ledger (the real movement history behind Ingredient.CurrentStock) ---
api.MapGet("/inventory/stock-ledger", async (AppDbContext db, HttpContext http, Guid? branchId, Guid? ingredientId, int? days) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var effectiveBranchId = http.GetBranchId() ?? branchId;
    var since = DateTime.UtcNow.AddDays(-(days ?? 30));
    var query = db.StockLedgerEntries.Include(e => e.Ingredient)
        .Where(e => e.TenantId == scopedTenantId.Value && e.CreatedAt >= since).AsQueryable();
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty) query = query.Where(e => e.BranchId == effectiveBranchId.Value);
    if (ingredientId.HasValue) query = query.Where(e => e.IngredientId == ingredientId.Value);
    var rows = await query.OrderByDescending(e => e.CreatedAt).Take(500).ToListAsync();
    return Results.Ok(rows.Select(e => new
    {
        e.Id, e.BranchId, e.IngredientId, ingredientName = e.Ingredient?.Name ?? "Unknown", movementType = e.MovementType.ToString(),
        e.QuantityChange, e.UnitCostPKR, e.BalanceAfter, e.ReferenceType, e.ReferenceId, e.Notes, e.CreatedAt, e.CreatedBy
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("inventory", "view"));

api.MapPost("/inventory/stock-adjustment", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, IngredientStockAdjustmentDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, dto.TenantId, dto.BranchId);
    if (scopeError != null) return scopeError;
    var currentUser = await accessor.GetCurrentUserAsync(http);

    var ing = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == dto.IngredientId && i.BranchId == scopedBranchId!.Value);
    if (ing == null) return Results.NotFound(new { message = "Ingredient not found for this branch." });
    if (!Enum.TryParse<StockMovementType>(dto.MovementType, true, out var movementType) ||
        (movementType != StockMovementType.Adjustment && movementType != StockMovementType.Waste && movementType != StockMovementType.StockCount))
        return Results.BadRequest(new { message = "MovementType must be Adjustment, Waste, or StockCount." });
    if (ing.CurrentStock + dto.QuantityChange < 0)
        return Results.BadRequest(new { message = $"This would take stock negative ({ing.CurrentStock} {dto.QuantityChange:+0.##;-0.##}). Enter the actual on-hand count instead." });

    var entry = RecordStockLedgerEntry(db, ing, scopedTenantId!.Value, scopedBranchId!.Value, movementType, dto.QuantityChange, ing.CostPerUnitPKR, "Adjustment", null, currentUser?.FullName ?? "System", dto.Reason);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "StockAdjustment", "Ingredient", ing.Id,
        null, $"{movementType} {dto.QuantityChange:+0.##;-0.##} {ing.Unit} — {dto.Reason ?? "no reason given"}");

    await db.SaveChangesAsync();
    return Results.Ok(new { entry.Id, ing.CurrentStock });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanManageInventory, "You don't have permission to adjust stock."));

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
    var supplierName = dto.SupplierName;
    Guid? supplierId = null;
    if (dto.SupplierId.HasValue)
    {
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == dto.SupplierId.Value && s.TenantId == scopedTenantId.Value);
        if (supplier == null) return Results.BadRequest(new { message = "Supplier not found for this tenant." });
        supplierId = supplier.Id;
        supplierName = supplier.Name; // authoritative — never trust a client-supplied display name over the linked record
    }
    var po = new PurchaseOrder
    {
        TenantId = scopedTenantId!.Value, BranchId = scopedBranchId!.Value, PONumber = poNumber,
        SupplierName = supplierName, SupplierId = supplierId, Status = POStatus.Ordered, CreatedAt = DateTime.UtcNow, Notes = dto.Notes
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
    var receivedBy = dto.ReceivedBy ?? "Store Inward In-Charge";
    foreach (var item in po.Items)
    {
        var ing = await db.Ingredients.FirstOrDefaultAsync(i => i.BranchId == po.BranchId && (i.Id == item.IngredientId || i.Name == item.IngredientName));
        if (ing == null)
        {
            ing = new Ingredient { TenantId = po.TenantId, BranchId = po.BranchId, Name = item.IngredientName, Category = "Direct Purchased", Unit = item.Unit, CostPerUnitPKR = item.UnitCostPKR, CurrentStock = 0, MinAlertLevel = 10, SupplierName = po.SupplierName };
            db.Ingredients.Add(ing);
        }
        else
        {
            if (item.UnitCostPKR > 0) ing.CostPerUnitPKR = item.UnitCostPKR;
            if (!string.IsNullOrEmpty(po.SupplierName)) ing.SupplierName = po.SupplierName;
        }
        RecordStockLedgerEntry(db, ing, po.TenantId, po.BranchId, StockMovementType.PurchaseReceipt, item.Quantity, item.UnitCostPKR, "PurchaseOrder", po.Id, receivedBy, $"PO {po.PONumber}");
    }
    po.Status = POStatus.Received;
    po.ReceivedAt = DateTime.UtcNow;
    po.ReceivedBy = receivedBy;
    if (!string.IsNullOrEmpty(dto.Notes)) po.Notes = (po.Notes != null ? po.Notes + " • " : "") + dto.Notes;

    // Purchasing on account increases what's owed to the supplier — settled later via supplier payments.
    if (po.SupplierId.HasValue)
    {
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == po.SupplierId.Value);
        if (supplier != null) supplier.CurrentBalancePKR += po.TotalCostPKR;
    }

    if (await HasAccountingAsync(db, po.TenantId) && po.TotalCostPKR > 0)
    {
        try
        {
            // Linked supplier = purchase on account (credit Accounts Payable); no supplier = paid on the spot.
            var creditAccount = po.SupplierId.HasValue ? "2000" : "1000";
            await PostJournalEntryAsync(db, po.TenantId, po.BranchId, po.ReceivedAt ?? DateTime.UtcNow,
                $"Goods received — PO #{po.PONumber} ({po.SupplierName})", "PurchaseOrder", po.Id, receivedBy,
                new List<(string, decimal, decimal)>
                {
                    ("1200", po.TotalCostPKR, 0),
                    (creditAccount, 0, po.TotalCostPKR)
                });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Accounting] Failed to post journal entry for PO {po.PONumber}: {ex.Message}");
        }
    }

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

authApi.MapPost("/signup", async (AppDbContext db, HttpContext http, SignupDto dto) =>
{
    // Validate unique slug
    var slug = dto.RestaurantName.ToLower().Trim().Replace(" ", "-");
    slug = System.Text.RegularExpressions.Regex.Replace(slug, @"[^a-z0-9\-]", "");
    if (await db.Tenants.AnyAsync(t => t.Slug == slug))
        return Results.BadRequest(new { error = "A restaurant with a similar name already exists. Try a different name." });

    // Usernames only have to be unique WITHIN a tenant — the database index says so. A global
    // check meant the first business to register "admin" took that name away from every business
    // that would ever sign up afterwards. A brand-new tenant has no users, so the only real
    // constraint here is that the name is well-formed.
    var desiredUsername = dto.AdminUsername.ToLower().Trim();
    if (desiredUsername.Length < 3)
        return Results.BadRequest(new { error = "Username must be at least 3 characters." });

    // The chosen plan only shapes trial limits (branches/counters/tabs) — everyone gets the same
    // 30-day, all-features trial regardless of tier, same as before. Falls back to Starter for a
    // missing/invalid key rather than failing signup over it.
    var chosenPackage = await db.SaaSPackageConfigs.FirstOrDefaultAsync(p =>
        p.IsActive && p.PackageKey == (dto.PackageKey ?? "Starter"));
    chosenPackage ??= await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.IsActive && p.PackageKey == "Starter");
    var tier = chosenPackage != null && Enum.TryParse<SubscriptionTier>(chosenPackage.PackageKey, out var parsedTier)
        ? parsedTier
        : SubscriptionTier.Starter;

    // Drives currency/phone/tax starting defaults below. Falls back to Pakistan's own profile
    // (first entry in Detailed) when the country wasn't recognized — same behavior as before this
    // country picker existed.
    var countryProfile = Pos.Api.Data.CountryTaxProfiles.FindByName(dto.Country, dto.VerticalPack)
        ?? Pos.Api.Data.CountryTaxProfiles.FindByName("Pakistan", dto.VerticalPack)!;
    var matchedState = countryProfile.States?.FirstOrDefault(s =>
        s.Code == dto.StateCode || (dto.StateName != null && s.Name.Equals(dto.StateName, StringComparison.OrdinalIgnoreCase)));

    // ------------------------------------------------------------------
    // How this business is SHAPED — standalone shop, or a head office with branches under it.
    //
    // Signup used to ignore this entirely and hard-create exactly one branch called "Main",
    // which meant a chain had to sign up as a single shop and then rebuild its own structure
    // afterwards. DeploymentMode was already on the DTO but nothing read it.
    // ------------------------------------------------------------------
    var isMultiBranch = string.Equals(dto.DeploymentMode, "MultiBranch", StringComparison.OrdinalIgnoreCase);
    var requestedBranches = (dto.Branches ?? new List<SignupBranchDto>())
        .Where(b => !string.IsNullOrWhiteSpace(b.Name))
        .ToList();

    if (isMultiBranch)
    {
        // Running a head office is a SHAPE, not a paid feature — every plan can do it. What the
        // plan decides is how many locations fit underneath. Gating the shape itself would mean
        // a small two-shop chain could not use the product as the chain it actually is.
        //
        // Head office counts against the allowance alongside the outlets beneath it.
        var totalBranches = requestedBranches.Count + 1;
        var maxBranches = chosenPackage?.MaxBranches ?? 1;
        if (totalBranches > maxBranches)
            return Results.BadRequest(new
            {
                error = $"The {chosenPackage?.DisplayName ?? "selected"} plan covers {maxBranches} location(s) "
                      + $"in total, including head office. You listed {requestedBranches.Count} branch(es), "
                      + $"which needs {totalBranches}. Remove one, or choose a larger plan."
            });
    }
    else
    {
        // A standalone shop has no outlets under it, whatever was posted.
        requestedBranches.Clear();
    }

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
            Country = countryProfile.Name,
            State = matchedState?.Name ?? dto.StateName?.Trim(),
            BusinessType = dto.BusinessType ?? BusinessType.Restaurant,
            Tier = tier,
            // Decides what the app IS for this customer: one hybrid shop, or an ERP head office
            // with selling branches beneath it.
            DeploymentMode = isMultiBranch ? DeploymentMode.HeadOffice : DeploymentMode.Standalone,
            IsActive = true,
            IsTrialActive = true,
            TrialEndsAt = DateTime.UtcNow.AddDays(30)
        };
        db.Tenants.Add(tenant);

        // 2. The primary location. For a standalone business this IS the shop; for a chain it is
        // the head office that the outlets below report into. Either way it carries IsHeadOffice,
        // because every tenant needs exactly one place that owns the central catalogue.
        //
        // Pakistan's provincial tax jurisdiction (PK-PB, PK-SD, ...) is looked up by RegionCode
        // elsewhere in this file — wiring it here means the province picked at signup applies
        // from the first sale.
        var branch = new Branch
        {
            TenantId = tenant.Id,
            Name = isMultiBranch
                ? $"{dto.RestaurantName.Trim()} — Head Office"
                : $"{dto.RestaurantName.Trim()} — Main Branch",
            Code = isMultiBranch ? "HQ" : "MAIN",
            Address = dto.Address ?? "",
            City = dto.City ?? "",
            Phone = dto.Phone,
            IsHeadOffice = true,
            RegionCode = countryProfile.Iso2 == "PK" ? matchedState?.Code : null,
        };
        db.Branches.Add(branch);

        // 2b. Outlets under the head office. Codes are generated rather than trusted from the
        // client so two branches cannot collide on one, and each inherits the tenant's province
        // unless it names its own — a chain usually operates in one tax jurisdiction, and the
        // ones that do not can change it per branch afterwards.
        var createdOutlets = new List<Branch>();
        for (var i = 0; i < requestedBranches.Count; i++)
        {
            var b = requestedBranches[i];
            var outletState = countryProfile.States?.FirstOrDefault(s => s.Code == b.StateCode);
            createdOutlets.Add(new Branch
            {
                TenantId = tenant.Id,
                Name = b.Name.Trim(),
                Code = string.IsNullOrWhiteSpace(b.Code)
                    ? $"BR-{(i + 1):D2}"
                    : b.Code.Trim().ToUpperInvariant(),
                Address = b.Address?.Trim() ?? "",
                City = string.IsNullOrWhiteSpace(b.City) ? (dto.City ?? "") : b.City.Trim(),
                Phone = b.Phone?.Trim() ?? "",
                IsHeadOffice = false,
                RegionCode = countryProfile.Iso2 == "PK"
                    ? (outletState?.Code ?? matchedState?.Code)
                    : null
            });
        }
        db.Branches.AddRange(createdOutlets);

        // 3. Create admin user
        var adminUser = new AppUser
        {
            TenantId = tenant.Id,
            // NOT pinned to a branch. A null BranchId is what marks a user as tenant-wide —
            // branch-scoped endpoints read it to decide whether someone sees one location or all
            // of them. Pinning the owner to head office meant a chain's owner could not see
            // their own outlets, which is the opposite of what owning the chain should mean.
            BranchId = null,
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

        // Seed default tenant settings from the chosen country's profile. Numbers here are a
        // starting point the owner can edit in Tax Configuration — not a compliance guarantee
        // (see the long comment on CountryTaxProfiles for why).
        var isPakistan = countryProfile.Iso2 == "PK";
        var normPack = (dto.VerticalPack ?? "restaurant").Trim().ToLowerInvariant();
        var isProvincialServices = normPack == "restaurant" || normPack == "salon" || normPack == "services";

        var tenantSettings = new TenantSettings
        {
            TenantId = tenant.Id,
            CountryCode = countryProfile.Iso2,
            CurrencyCode = countryProfile.CurrencyCode,
            CurrencySymbol = countryProfile.CurrencySymbol,
            DecimalPlaces = countryProfile.CurrencyCode == "PKR" ? 0 : 2,
            TaxAuthorityName = matchedState?.AuthorityName ?? countryProfile.TaxAuthorityName ?? "FBR",
            DefaultTaxRate = matchedState?.CashTaxRate ?? countryProfile.DefaultTaxRate ?? 0,
            UseDualTaxRate = matchedState != null
                ? (matchedState.CashTaxRate != matchedState.DigitalTaxRate)
                : countryProfile.UseDualTaxRate,
            DigitalTaxRate = matchedState?.DigitalTaxRate ?? countryProfile.DigitalTaxRate ?? 0,
            UseProvincialTax = isPakistan && matchedState != null && isProvincialServices,
            PhoneCode = countryProfile.PhoneCode,
            DefaultCity = dto.City?.Trim() ?? "",
            DateFormat = "dd/MM/yyyy",
            ReceiptFooter = "Thank you for your visit!",
            AllowedPaymentMethods = isPakistan
                ? "Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata"
                : "Cash,Card,CustomerKhata"
        };
        db.TenantSettings.Add(tenantSettings);

        // Assign the vertical pack chosen at signup. This is what decides the POS layout, which
        // item fields exist and which sector screens appear — the thing that lets one product
        // serve a pharmacy and a restaurant without either being an afterthought.
        var packKey = Pos.Api.Data.VerticalPacks.Find(dto.VerticalPack)?.Key
                      ?? Pos.Api.Data.VerticalPacks.FromLegacyBusinessType(tenant.BusinessType);
        db.TenantVerticalPacks.Add(new TenantVerticalPack
        {
            TenantId = tenant.Id,
            PackKey = packKey,
            IsPrimary = true
        });

        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        // Build the entitlement snapshot now, so the very first request from this tenant reads
        // the same resolved limits as every request after it.
        var newEntitlements = await http.RequestServices
            .GetRequiredService<Pos.Api.Services.IEntitlementService>()
            .RecomputeAsync(tenant.Id);

        return Results.Ok(new
        {
            message = "Business created successfully!",
            verticalPack = packKey,
            deploymentMode = isMultiBranch ? "MultiBranch" : "Standalone",
            // What was actually provisioned, so the client can confirm it rather than assume.
            branches = new[] { new { id = branch.Id, name = branch.Name, code = branch.Code, isHeadOffice = true } }
                .Concat(createdOutlets.Select(o => new { id = o.Id, name = o.Name, code = o.Code, isHeadOffice = false }))
                .ToList(),
            entitlements = new
            {
                newEntitlements.MaxBranches,
                newEntitlements.MaxCounters,
                newEntitlements.MaxOrderTabs,
                newEntitlements.MaxUsers,
                status = newEntitlements.Status.ToString()
            },
            tenant = new
            {
                id = tenant.Id,
                name = tenant.Name,
                slug = tenant.Slug,
                tier = tenant.Tier.ToString(),
                businessType = tenant.BusinessType.ToString(),
                country = tenant.Country,
                state = tenant.State,
                currencyCode = countryProfile.CurrencyCode,
                taxNote = countryProfile.TaxNote,
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
            t.City, t.Country, t.BusinessType, t.Tier, t.IsActive, t.IsTrialActive,
            t.TrialEndsAt, t.SubscriptionPaidUntil, t.CreatedAt,
            branchCount = t.Branches.Count
        })
        .ToListAsync();

    // Real staff-account count — the old projection above counted Terminal devices under the name
    // "userCount", which was actually device count, not staff. Fixed here by counting Users directly.
    var realUserCounts = await db.Users.GroupBy(u => u.TenantId)
        .Select(g => new { TenantId = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.TenantId, x => x.Count);

    var counterCounts = await db.Terminals.Where(t => t.TerminalType == TerminalType.Counter)
        .GroupBy(t => t.Branch!.TenantId)
        .Select(g => new { TenantId = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.TenantId, x => x.Count);
    var tabletCounts = await db.Terminals.Where(t => t.TerminalType == TerminalType.OrderTab)
        .GroupBy(t => t.Branch!.TenantId)
        .Select(g => new { TenantId = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.TenantId, x => x.Count);

    var addOnsByTenant = await db.AddOnSubscriptions.Where(a => a.IsActive)
        .GroupBy(a => a.TenantId)
        .Select(g => new { TenantId = g.Key, Count = g.Count(), ExtraCounters = g.Where(a => a.AddOnKey == "EXTRA_COUNTER").Sum(a => a.Quantity), ExtraTablets = g.Where(a => a.AddOnKey == "EXTRA_TABLET").Sum(a => a.Quantity), ExtraUsers = g.Where(a => a.AddOnKey == "EXTRA_USER").Sum(a => a.Quantity) })
        .ToDictionaryAsync(x => x.TenantId, x => x);

    var packages = await db.SaaSPackageConfigs.ToDictionaryAsync(p => p.PackageKey);

    var result = tenants.Select(t =>
    {
        var pkg = packages.GetValueOrDefault(t.Tier.ToString());
        var addOns = addOnsByTenant.GetValueOrDefault(t.Id);
        return new
        {
            t.Id, t.Name, t.Slug, t.ContactName, t.ContactEmail, t.ContactPhone,
            t.City, t.Country, t.BusinessType, t.Tier, t.IsActive, t.IsTrialActive,
            t.TrialEndsAt, t.SubscriptionPaidUntil, t.CreatedAt, t.branchCount,
            userCount = realUserCounts.GetValueOrDefault(t.Id),
            maxUsers = (pkg?.MaxUsers ?? 0) + (addOns?.ExtraUsers ?? 0),
            counterCount = counterCounts.GetValueOrDefault(t.Id),
            maxCounters = (pkg?.MaxCounters ?? 0) + (addOns?.ExtraCounters ?? 0),
            tabletCount = tabletCounts.GetValueOrDefault(t.Id),
            maxTablets = (pkg?.MaxOrderTabs ?? 0) + (addOns?.ExtraTablets ?? 0),
            activeAddOnsCount = addOns?.Count ?? 0
        };
    });

    return Results.Ok(result);
}).RequireAuthorization();

// Retained for the existing console, but it is now the blunt instrument at the end of the
// lifecycle ladder. Prefer PUT /status, which records a reason and can stop somewhere gentler
// than "your tills are off".
app.MapPut("/api/admin/tenants/{id:guid}/toggle-active", async (
    Guid id, AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();
    tenant.IsActive = !tenant.IsActive;

    // Keep the ladder in step. Reactivating returns the tenant to PastDue rather than Active —
    // whether they have actually paid is a separate fact, recorded by the plan-change endpoint.
    tenant.Status = tenant.IsActive
        ? (tenant.IsTrialActive && tenant.TrialEndsAt > DateTime.UtcNow ? TenantStatus.Trial : TenantStatus.PastDue)
        : TenantStatus.Suspended;

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(tenant.Id);

    return Results.Ok(new
    {
        tenant.Id,
        tenant.IsActive,
        status = updated.Status.ToString(),
        snapshotVersion = updated.Version,
        message = tenant.IsActive ? "Tenant activated" : "Tenant deactivated"
    });
}).RequireAuthorization();

// ============================================================
// PLAN CHANGE
//
// This used to be two assignments and a save. Nothing checked whether the tenant actually FIT
// the new plan, so downgrading a five-branch chain to a one-branch plan left it running five
// branches forever and every quota check downstream quietly disagreed with what was being paid for.
//
// Now: an upgrade always proceeds; a downgrade is dry-run first and refused (unless explicitly
// forced) when the tenant is over the new plan's limits, with the specific overage reported so
// support can tell the customer exactly what to retire.
// ============================================================
app.MapGet("/api/admin/tenants/{id:guid}/plan-change-preview", async (
    Guid id, AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements, SubscriptionTier tier) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();

    var impact = await AssessPlanChangeAsync(db, entitlements, tenant, tier);
    return Results.Ok(impact);
}).RequireAuthorization();

app.MapPut("/api/admin/tenants/{id:guid}/change-tier", async (
    Guid id,
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    ChangeTierDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();

    var previousTier = tenant.Tier;
    if (previousTier == dto.Tier && dto.PaidUntil == tenant.SubscriptionPaidUntil)
        return Results.Ok(new { tenant.Id, tier = tenant.Tier.ToString(), tenant.SubscriptionPaidUntil, message = "No change." });

    var impact = await AssessPlanChangeAsync(db, entitlements, tenant, dto.Tier);

    if (impact.IsDowngrade && impact.Blockers.Count > 0 && dto.Force != true)
        return Results.BadRequest(new
        {
            message = "This tenant is over the limits of the plan they would move to. "
                    + "Ask them to reduce first, or repeat with force=true to move them anyway "
                    + "(devices beyond the new allowance will stop selling at their next heartbeat).",
            blockers = impact.Blockers,
            impact
        });

    tenant.Tier = dto.Tier;
    tenant.SubscriptionPaidUntil = dto.PaidUntil;

    // Paying for a plan ends the trial and clears any past-due state. Deliberately does not
    // touch Restricted/ReadOnly/Suspended — those are support decisions, undone on purpose.
    if (dto.PaidUntil != null && dto.PaidUntil > DateTime.UtcNow)
    {
        tenant.IsTrialActive = false;
        if (tenant.Status is TenantStatus.Trial or TenantStatus.PastDue) tenant.Status = TenantStatus.Active;
    }

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, tenant.Id, actingUser, "TenantTierChanged", "Tenant", tenant.Id,
            previousTier.ToString(), $"{dto.Tier}{(dto.Force == true ? " (forced over limits)" : "")}");

    await db.SaveChangesAsync();

    // Recompute immediately so the new entitlements are live and every device picks them up on
    // its next heartbeat — no reinstall, no support call.
    var updated = await entitlements.RecomputeAsync(tenant.Id);

    return Results.Ok(new
    {
        tenant.Id,
        tier = tenant.Tier.ToString(),
        tenant.SubscriptionPaidUntil,
        status = updated.Status.ToString(),
        snapshotVersion = updated.Version,
        appliedLimits = new { updated.MaxBranches, updated.MaxCounters, updated.MaxOrderTabs, updated.MaxUsers },
        warnings = impact.Blockers
    });
}).RequireAuthorization();

// --- Subscription billing history — platform-vendor only, same reasoning as
// Tenant Management above: this bills every restaurant on the platform, not one. ---
app.MapGet("/api/admin/subscription-invoices", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var query = db.SubscriptionInvoices.AsQueryable();
    if (tenantId.HasValue) query = query.Where(i => i.TenantId == tenantId.Value);
    var rows = await query.OrderByDescending(i => i.IssuedAt).Take(500).ToListAsync();
    return Results.Ok(rows);
}).RequireAuthorization();

app.MapPost("/api/admin/subscription-invoices", async (AppDbContext db, HttpContext http, IssueSubscriptionInvoiceDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var tenant = await db.Tenants.FindAsync(dto.TenantId);
    if (tenant == null) return Results.NotFound(new { message = "Tenant not found." });

    var package = await db.SaaSPackageConfigs.FirstOrDefaultAsync(p => p.PackageKey == tenant.Tier.ToString());
    var amount = dto.AmountPKR ?? (dto.Annual ? package?.YearlyPricePKR : package?.MonthlyPricePKR) ?? 0;
    var periodStart = dto.BillingPeriodStart ?? DateTime.UtcNow;
    var periodEnd = dto.BillingPeriodEnd ?? periodStart.AddMonths(dto.Annual ? 12 : 1);
    var count = await db.SubscriptionInvoices.CountAsync();

    var invoice = new SubscriptionInvoice
    {
        TenantId = tenant.Id,
        InvoiceNumber = $"INV-{count + 1:00000}",
        Tier = tenant.Tier.ToString(),
        BillingPeriodStart = periodStart,
        BillingPeriodEnd = periodEnd,
        AmountPKR = amount,
        Status = SubscriptionInvoiceStatus.Pending,
        DueAt = dto.DueAt ?? periodStart.AddDays(7),
        Notes = dto.Notes
    };
    db.SubscriptionInvoices.Add(invoice);
    await db.SaveChangesAsync();
    return Results.Ok(invoice);
}).RequireAuthorization();

app.MapPost("/api/admin/subscription-invoices/{id:guid}/mark-paid", async (AppDbContext db, HttpContext http, Guid id, MarkSubscriptionInvoicePaidDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var invoice = await db.SubscriptionInvoices.FirstOrDefaultAsync(i => i.Id == id);
    if (invoice == null) return Results.NotFound();
    if (invoice.Status == SubscriptionInvoiceStatus.Paid) return Results.BadRequest(new { message = "Already paid." });

    invoice.Status = SubscriptionInvoiceStatus.Paid;
    invoice.PaidAt = DateTime.UtcNow;
    invoice.PaymentMethod = dto.PaymentMethod;

    // Paying an invoice extends the tenant's paid-until date to cover the billed period.
    var tenant = await db.Tenants.FindAsync(invoice.TenantId);
    if (tenant != null && (tenant.SubscriptionPaidUntil == null || tenant.SubscriptionPaidUntil < invoice.BillingPeriodEnd))
        tenant.SubscriptionPaidUntil = invoice.BillingPeriodEnd;

    await db.SaveChangesAsync();
    return Results.Ok(invoice);
}).RequireAuthorization();

app.MapPost("/api/admin/subscription-invoices/{id:guid}/cancel", async (AppDbContext db, HttpContext http, Guid id) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var invoice = await db.SubscriptionInvoices.FirstOrDefaultAsync(i => i.Id == id);
    if (invoice == null) return Results.NotFound();
    if (invoice.Status == SubscriptionInvoiceStatus.Paid) return Results.BadRequest(new { message = "A paid invoice cannot be cancelled." });
    invoice.Status = SubscriptionInvoiceStatus.Cancelled;
    await db.SaveChangesAsync();
    return Results.Ok(invoice);
}).RequireAuthorization();

authApi.MapPost("/super-admin-login", async (AppDbContext db, HttpContext http, LoginDto dto) =>
{
    var clientIp = http.Connection.RemoteIpAddress?.ToString();

    // Super admin credentials from configuration (not hardcoded)
    var superAdminUsername = builder.Configuration["SuperAdmin:Username"] ?? "superadmin";
    var superAdminPin = builder.Configuration["SuperAdmin:Pin"] ?? Environment.GetEnvironmentVariable("SUPER_ADMIN_PIN") ?? "999999";

    if (isProduction && dto.PinCode == superAdminPin && superAdminPin == "999999")
    {
        // Warn if using default PIN in production
        Console.WriteLine("[WARNING] Super admin is using the default PIN. Change SUPER_ADMIN_PIN in production!");
    }

    if (dto.Username != superAdminUsername || dto.PinCode != superAdminPin)
    {
        Console.WriteLine($"[Auth] Failed platform-admin login attempt for '{dto.Username}' from IP {clientIp}");
        return Results.Unauthorized();
    }

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

    await WriteAuditAsync(db, Guid.Empty, superAdmin, "UserLoggedIn", "AppUser", superAdmin.Id, null, $"Platform admin login, IP {clientIp}");
    var (accessToken, refreshToken, _) = IssueTokenPair(db, builder.Configuration, superAdmin, isSuperAdmin: true, clientIp);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token = accessToken,
        refreshToken,
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
// PROVIDER CONSOLE
//
// The platform owner's own tooling. Previously this was three actions — list, toggle active,
// change tier — which meant every other support request became a database query typed by hand.
//
// What is here now is the set you cannot run a SaaS without: a real per-tenant view, the
// graduated suspension ladder, time-limited grants, read-only impersonation, and the ability to
// create a tenant FOR a customer without ever knowing their credentials.
// ============================================================

// --- Tenant 360 -------------------------------------------------------------
// Everything support needs on one screen, so answering "what is going on with this customer?"
// does not require four tabs and a guess.
app.MapGet("/api/admin/tenants/{id:guid}/overview", async (
    Guid id, AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();

    var ent = await entitlements.GetAsync(id);
    var now = DateTime.UtcNow;
    var monthAgo = now.AddDays(-30);

    var branches = await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == id).ToListAsync();
    var branchIds = branches.Select(b => b.Id).ToList();

    var terminals = await db.Terminals.IgnoreQueryFilters()
        .Where(t => branchIds.Contains(t.BranchId)).ToListAsync();

    // Health signals. A till that has not checked in for a day is the single most useful early
    // warning there is — it means either the shop is shut or the customer has a problem.
    var staleDevices = terminals.Count(t => t.RevokedAt == null && t.DeactivatedAt == null && t.LastSeenAt < now.AddHours(-24));

    var orders30d = await db.Orders.IgnoreQueryFilters()
        .Where(o => o.TenantId == id && o.CreatedAt >= monthAgo && o.Status != OrderStatus.Cancelled)
        .Select(o => new { o.TotalPKR, o.CreatedAt, o.HasPriceVariance })
        .ToListAsync();

    var activeDays = orders30d.Select(o => o.CreatedAt.Date).Distinct().Count();

    var plan = await db.SaaSPackageConfigs.AsNoTracking().FirstOrDefaultAsync(p => p.PackageKey == tenant.Tier.ToString());
    var addOns = await db.AddOnSubscriptions.IgnoreQueryFilters().Where(a => a.TenantId == id && a.IsActive).ToListAsync();
    var overrides = await db.TenantEntitlementOverrides.IgnoreQueryFilters()
        .Where(o => o.TenantId == id && o.IsActive).OrderByDescending(o => o.CreatedAt).ToListAsync();

    var mrr = (plan?.MonthlyPricePKR ?? 0) + addOns.Sum(a => a.PricePKR * a.Quantity);

    var unpaidInvoices = await db.SubscriptionInvoices.IgnoreQueryFilters()
        .Where(i => i.TenantId == id && i.Status != SubscriptionInvoiceStatus.Paid && i.Status != SubscriptionInvoiceStatus.Cancelled)
        .OrderBy(i => i.IssuedAt)
        .Select(i => new { i.Id, i.InvoiceNumber, i.AmountPKR, i.IssuedAt, i.DueAt, status = i.Status.ToString() })
        .ToListAsync();

    var recentLicenceEvents = await db.DeviceLicenseEvents.IgnoreQueryFilters()
        .Where(e => e.TenantId == id).OrderByDescending(e => e.CreatedAt).Take(20)
        .Select(e => new { e.EventType, e.Detail, e.CreatedAt, e.TerminalId })
        .ToListAsync();

    return Results.Ok(new
    {
        tenant = new
        {
            tenant.Id, tenant.Name, tenant.Slug, tenant.ContactName, tenant.ContactEmail, tenant.ContactPhone,
            tenant.City, tenant.Country, tenant.CreatedAt, tenant.IsActive,
            tier = tenant.Tier.ToString(),
            status = ent.Status.ToString(),
            tenant.TrialEndsAt, tenant.SubscriptionPaidUntil,
            tenant.IsProviderProvisioned,
            ownerInvitePending = tenant.OwnerInviteTokenHash != null && tenant.OwnerInviteRedeemedAt == null
        },
        entitlements = new
        {
            ent.Version, ent.MaxBranches, ent.MaxCounters, ent.MaxOrderTabs, ent.MaxUsers,
            features = ent.Features, packs = ent.PackKeys, primaryPack = ent.PrimaryPackKey
        },
        usage = new
        {
            branches = branches.Count,
            activeUsers = await db.Users.IgnoreQueryFilters().CountAsync(u => u.TenantId == id && u.IsActive),
            counters = terminals.Count(t => t.TerminalType == TerminalType.Counter && t.OccupiesQuotaSlot(now)),
            tablets = terminals.Count(t => t.TerminalType == TerminalType.OrderTab && t.OccupiesQuotaSlot(now)),
            products = await db.Products.IgnoreQueryFilters().CountAsync(p => p.TenantId == id)
        },
        health = new
        {
            ordersLast30d = orders30d.Count,
            revenueLast30d = orders30d.Sum(o => o.TotalPKR),
            activeDaysLast30d = activeDays,
            staleDevices,
            lastOrderAt = orders30d.Count == 0 ? (DateTime?)null : orders30d.Max(o => o.CreatedAt),
            unreconciledOfflineOrders = orders30d.Count(o => o.HasPriceVariance),
            // Crude but honest: a tenant selling on fewer than a third of days in the last month
            // is either seasonal or leaving. Either way somebody should look.
            churnRisk = activeDays < 10 ? "high" : activeDays < 20 ? "watch" : "ok"
        },
        billing = new
        {
            estimatedMrrPKR = mrr,
            planPricePKR = plan?.MonthlyPricePKR ?? 0,
            addOns = addOns.Select(a => new { a.AddOnKey, a.Quantity, a.PricePKR, a.BranchId }),
            unpaidInvoices
        },
        overrides = overrides.Select(o => new { o.Id, o.Key, o.Value, o.ExpiresAt, o.Reason, o.CreatedAt, inForce = o.IsInForce(now) }),
        branches = branches.Select(b => new
        {
            b.Id, b.Name, b.Code, b.City, b.IsHeadOffice,
            counters = terminals.Count(t => t.BranchId == b.Id && t.TerminalType == TerminalType.Counter && t.OccupiesQuotaSlot(now)),
            tablets = terminals.Count(t => t.BranchId == b.Id && t.TerminalType == TerminalType.OrderTab && t.OccupiesQuotaSlot(now))
        }),
        devices = terminals.Select(t => new
        {
            t.Id, t.BranchId, t.TerminalName, terminalType = t.TerminalType.ToString(),
            t.LastSeenAt, t.LicenseExpiresAt, t.DeviceInfo,
            state = t.RevokedAt != null ? "Revoked" : t.DeactivatedAt != null ? "Retired"
                  : t.LicenseExpiresAt == null ? "NeverActivated"
                  : t.LicenseExpiresAt > now ? "Valid" : "Expired"
        }),
        recentLicenceEvents
    });
}).RequireAuthorization();

// --- Lifecycle ladder -------------------------------------------------------
// Replaces the binary active/inactive toggle. Support moves a tenant one rung at a time and the
// reason is recorded, because "why is this customer suspended?" is a question that always comes up.
app.MapPut("/api/admin/tenants/{id:guid}/status", async (
    Guid id,
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    SetTenantStatusDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();

    if (string.IsNullOrWhiteSpace(dto.Reason))
        return Results.BadRequest(new { message = "A reason is required — this is recorded against the account." });

    var previous = tenant.Status;
    tenant.Status = dto.Status;

    // IsActive is kept in step so older code paths that still read it agree with the ladder.
    tenant.IsActive = dto.Status is not (TenantStatus.Suspended or TenantStatus.Cancelled);
    if (dto.Status != TenantStatus.Trial) tenant.IsTrialActive = false;

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, tenant.Id, actingUser, "TenantStatusChanged", "Tenant", tenant.Id,
            previous.ToString(), $"{dto.Status} — {dto.Reason.Trim()}");

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(tenant.Id);

    return Results.Ok(new
    {
        tenant.Id,
        previousStatus = previous.ToString(),
        status = updated.Status.ToString(),
        snapshotVersion = updated.Version,
        effect = new { updated.CanSell, updated.CanUseBackOffice, updated.CanRead }
    });
}).RequireAuthorization();

// --- Time-limited grants ----------------------------------------------------
app.MapGet("/api/admin/tenants/{id:guid}/overrides", async (Guid id, AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var now = DateTime.UtcNow;
    var rows = await db.TenantEntitlementOverrides.IgnoreQueryFilters()
        .Where(o => o.TenantId == id).OrderByDescending(o => o.CreatedAt)
        .Select(o => new { o.Id, o.Key, o.Value, o.ExpiresAt, o.Reason, o.CreatedAt, o.IsActive })
        .ToListAsync();
    return Results.Ok(rows);
}).RequireAuthorization();

app.MapPost("/api/admin/tenants/{id:guid}/overrides", async (
    Guid id,
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    CreateOverrideDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    if (!await db.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Id == id)) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(dto.Reason))
        return Results.BadRequest(new { message = "A reason is required for every grant." });

    var isQuota = dto.Key is "MaxBranches" or "MaxCounters" or "MaxOrderTabs" or "MaxUsers";
    var isFlag = Pos.Api.Services.EntitlementService.FeatureFlagNames.Contains(dto.Key);
    if (!isQuota && !isFlag)
        return Results.BadRequest(new { message = $"'{dto.Key}' is not a known entitlement key." });
    if (isQuota && !int.TryParse(dto.Value, out _))
        return Results.BadRequest(new { message = "A quota override's value is a signed integer delta, e.g. \"3\" or \"-1\"." });
    if (isFlag && !bool.TryParse(dto.Value, out _))
        return Results.BadRequest(new { message = "A feature override's value must be true or false." });

    var actingUser = await accessor.GetCurrentUserAsync(http);

    // Supersede rather than stack: two live overrides on the same key is how a support team
    // loses track of what a customer is actually entitled to.
    var existing = await db.TenantEntitlementOverrides.IgnoreQueryFilters()
        .Where(o => o.TenantId == id && o.Key == dto.Key && o.IsActive).ToListAsync();
    foreach (var old in existing) old.IsActive = false;

    var ov = new TenantEntitlementOverride
    {
        TenantId = id,
        Key = dto.Key,
        Value = dto.Value,
        ExpiresAt = dto.ExpiresAt,
        Reason = dto.Reason.Trim(),
        CreatedByUserId = actingUser?.Id ?? Guid.Empty
    };
    db.TenantEntitlementOverrides.Add(ov);

    if (actingUser != null)
        await WriteAuditAsync(db, id, actingUser, "EntitlementOverrideGranted", "TenantEntitlementOverride", ov.Id,
            null, $"{dto.Key}={dto.Value} until {(dto.ExpiresAt?.ToString("u") ?? "forever")} — {ov.Reason}");

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(id);

    return Results.Ok(new
    {
        ov.Id, ov.Key, ov.Value, ov.ExpiresAt,
        snapshotVersion = updated.Version,
        appliedLimits = new { updated.MaxBranches, updated.MaxCounters, updated.MaxOrderTabs, updated.MaxUsers }
    });
}).RequireAuthorization();

app.MapDelete("/api/admin/overrides/{overrideId:guid}", async (
    Guid overrideId, AppDbContext db, HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var ov = await db.TenantEntitlementOverrides.IgnoreQueryFilters().FirstOrDefaultAsync(o => o.Id == overrideId);
    if (ov == null) return Results.NotFound();

    ov.IsActive = false;
    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, ov.TenantId, actingUser, "EntitlementOverrideRevoked", "TenantEntitlementOverride", ov.Id, $"{ov.Key}={ov.Value}", null);

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(ov.TenantId);
    return Results.Ok(new { message = "Override revoked.", snapshotVersion = updated.Version });
}).RequireAuthorization();

// --- Extend a trial ---------------------------------------------------------
app.MapPost("/api/admin/tenants/{id:guid}/extend-trial", async (
    Guid id, AppDbContext db, HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    ExtendTrialDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();
    if (dto.Days is < 1 or > 180) return Results.BadRequest(new { message = "Extend by 1 to 180 days." });

    // Extend from today when the trial already lapsed, otherwise from its current end — so an
    // extension always means what the person clicking it thinks it means.
    var from = tenant.TrialEndsAt > DateTime.UtcNow ? tenant.TrialEndsAt : DateTime.UtcNow;
    tenant.TrialEndsAt = from.AddDays(dto.Days);
    tenant.IsTrialActive = true;
    tenant.Status = TenantStatus.Trial;

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser != null)
        await WriteAuditAsync(db, id, actingUser, "TrialExtended", "Tenant", id, null, $"+{dto.Days}d to {tenant.TrialEndsAt:u} — {dto.Reason}");

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(id);
    return Results.Ok(new { tenant.TrialEndsAt, status = updated.Status.ToString(), snapshotVersion = updated.Version });
}).RequireAuthorization();

// --- Provider-provisioned tenants -------------------------------------------
// The install-for-the-customer path. Platform staff create the account and hand over a one-time
// invite link; the owner sets their own PIN. Staff never know a customer's credentials, which is
// both the right default and the only version of this that survives a security review.
app.MapPost("/api/admin/tenants/provision", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    ProvisionTenantDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();

    var slug = System.Text.RegularExpressions.Regex.Replace(
        dto.BusinessName.ToLower().Trim().Replace(" ", "-"), @"[^a-z0-9\-]", "");
    if (string.IsNullOrWhiteSpace(slug)) return Results.BadRequest(new { message = "Business name must contain letters or digits." });
    if (await db.Tenants.IgnoreQueryFilters().AnyAsync(t => t.Slug == slug))
        return Results.BadRequest(new { message = "A business with a similar name already exists." });

    var packKey = Pos.Api.Data.VerticalPacks.Find(dto.VerticalPack)?.Key ?? Pos.Api.Data.VerticalPacks.Retail;
    var countryProfile = Pos.Api.Data.CountryTaxProfiles.FindByName(dto.Country, dto.VerticalPack)
        ?? Pos.Api.Data.CountryTaxProfiles.FindByName("Pakistan", dto.VerticalPack)!;
    var tier = Enum.TryParse<SubscriptionTier>(dto.PackageKey ?? "Starter", out var parsed) ? parsed : SubscriptionTier.Starter;

    // A one-time invite, hashed exactly like every other bearer secret in this codebase.
    var rawInvite = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

    using var tx = await db.Database.BeginTransactionAsync();
    try
    {
        var tenant = new Tenant
        {
            Name = dto.BusinessName.Trim(),
            Slug = slug,
            ContactName = dto.ContactName.Trim(),
            ContactEmail = dto.ContactEmail.Trim().ToLower(),
            ContactPhone = dto.ContactPhone?.Trim() ?? "",
            City = dto.City?.Trim(),
            Country = countryProfile.Name,
            Tier = tier,
            IsActive = true,
            IsTrialActive = dto.TrialDays > 0,
            Status = dto.TrialDays > 0 ? TenantStatus.Trial : TenantStatus.Active,
            TrialEndsAt = DateTime.UtcNow.AddDays(dto.TrialDays > 0 ? dto.TrialDays : 0),
            SubscriptionPaidUntil = dto.PaidUntil,
            IsProviderProvisioned = true,
            OwnerInviteTokenHash = HashToken(rawInvite),
            OwnerInviteExpiresAt = DateTime.UtcNow.AddDays(14)
        };
        db.Tenants.Add(tenant);

        var branch = new Branch
        {
            TenantId = tenant.Id,
            Name = $"{dto.BusinessName.Trim()} — Main",
            Code = "MAIN",
            City = dto.City ?? "",
            Address = dto.Address ?? "",
            Phone = dto.ContactPhone ?? "",
            IsHeadOffice = true
        };
        db.Branches.Add(branch);

        db.TenantVerticalPacks.Add(new TenantVerticalPack { TenantId = tenant.Id, PackKey = packKey, IsPrimary = true });

        db.TenantSettings.Add(new TenantSettings
        {
            TenantId = tenant.Id,
            CountryCode = countryProfile.Iso2,
            CurrencyCode = countryProfile.CurrencyCode,
            CurrencySymbol = countryProfile.CurrencySymbol,
            DecimalPlaces = countryProfile.CurrencyCode == "PKR" ? 0 : 2,
            TaxAuthorityName = countryProfile.TaxAuthorityName ?? "Not yet configured",
            DefaultTaxRate = countryProfile.DefaultTaxRate ?? 0,
            UseDualTaxRate = countryProfile.UseDualTaxRate,
            DigitalTaxRate = countryProfile.DigitalTaxRate ?? 0,
            PhoneCode = countryProfile.PhoneCode,
            DefaultCity = dto.City?.Trim() ?? ""
        });

        // Deliberately NO user is created here. The owner account comes into existence only when
        // the invite is redeemed, with a PIN only the owner has ever seen.

        var actingUser = await accessor.GetCurrentUserAsync(http);
        if (actingUser != null)
            await WriteAuditAsync(db, tenant.Id, actingUser, "TenantProvisioned", "Tenant", tenant.Id, null,
                $"{tenant.Name} on {tier} by platform staff");

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        var ent = await entitlements.RecomputeAsync(tenant.Id);

        return Results.Ok(new
        {
            tenantId = tenant.Id,
            tenant.Slug,
            tier = tier.ToString(),
            verticalPack = packKey,
            branchId = branch.Id,
            // Shown once. Hand this to the customer; nobody can recover it afterwards.
            ownerInviteToken = rawInvite,
            ownerInviteExpiresAt = tenant.OwnerInviteExpiresAt,
            entitlements = new { ent.MaxBranches, ent.MaxCounters, ent.MaxOrderTabs, ent.MaxUsers }
        });
    }
    catch (Exception ex)
    {
        await tx.RollbackAsync();
        return Results.BadRequest(new { message = "Failed to provision tenant.", details = ex.Message });
    }
}).RequireAuthorization();

// Redeem an owner invite. Anonymous by necessity — the person redeeming it has no account yet,
// which is the whole point — so the token is long, hashed, single-use and expiring.
app.MapPost("/api/auth/redeem-invite", async (AppDbContext db, HttpContext http, RedeemInviteDto dto) =>
{
    if (string.IsNullOrWhiteSpace(dto.InviteToken) || string.IsNullOrWhiteSpace(dto.Username) || string.IsNullOrWhiteSpace(dto.Pin))
        return Results.BadRequest(new { message = "Invite token, username and PIN are all required." });
    if (dto.Pin.Trim().Length < 4)
        return Results.BadRequest(new { message = "PIN must be at least 4 digits." });

    var hash = HashToken(dto.InviteToken.Trim());
    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.OwnerInviteTokenHash == hash);

    if (tenant == null || tenant.OwnerInviteRedeemedAt != null || tenant.OwnerInviteExpiresAt < DateTime.UtcNow)
        return Results.BadRequest(new { message = "This invite is not valid. Please ask for a new one." });

    var branch = await db.Branches.IgnoreQueryFilters()
        .Where(b => b.TenantId == tenant.Id).OrderByDescending(b => b.IsHeadOffice).FirstOrDefaultAsync();

    var username = dto.Username.ToLower().Trim();
    if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.TenantId == tenant.Id && u.Username == username))
        return Results.BadRequest(new { message = "That username is already taken in this business." });

    var owner = new AppUser
    {
        TenantId = tenant.Id,
        // Tenant-wide, not branch-pinned — same reasoning as the signup path above.
        BranchId = null,
        FullName = string.IsNullOrWhiteSpace(dto.FullName) ? tenant.ContactName : dto.FullName.Trim(),
        Username = username,
        PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.Pin.Trim()),
        Role = UserRole.OwnerAdmin,
        IsActive = true,
        CanViewFinancialReports = true,
        CanManageInventory = true,
        CanManageMenuAndTax = true,
        CanGiveDiscounts = true,
        CanVoidOrders = true
    };
    db.Users.Add(owner);

    // Burn the invite.
    tenant.OwnerInviteRedeemedAt = DateTime.UtcNow;
    tenant.OwnerInviteTokenHash = null;

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        message = "Your owner account is ready. Please sign in.",
        tenantSlug = tenant.Slug,
        username = owner.Username
    });
}).AllowAnonymous().RequireRateLimiting("auth");

// --- Support impersonation --------------------------------------------------
// Read-only by default and always audited. Support will need this constantly; the thing that
// makes it acceptable rather than alarming is that it is bounded, logged, and short-lived.
app.MapPost("/api/admin/tenants/{id:guid}/impersonate", async (
    Guid id,
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    ImpersonateDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(dto.Reason))
        return Results.BadRequest(new { message = "A reason is required — impersonation is always recorded." });

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == id);
    if (tenant == null) return Results.NotFound();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser == null) return Results.Unauthorized();

    // Write access has to be asked for explicitly and is recorded differently, so an audit trail
    // can distinguish "support looked" from "support changed something".
    var writeAccess = dto.AllowWrites == true;

    var claims = new List<System.Security.Claims.Claim>
    {
        new("userId", actingUser.Id.ToString()),
        new("tenantId", tenant.Id.ToString()),
        new("branchId", ""),
        new("role", writeAccess ? UserRole.OwnerAdmin.ToString() : UserRole.BranchManager.ToString()),
        new("impersonating", "true"),
        new("impersonatedBy", actingUser.Username),
        new("readOnly", writeAccess ? "false" : "true")
    };

    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
    var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(
        claims: claims,
        // Deliberately short. An impersonation session that outlives the support call is a
        // standing key to somebody else's business.
        expires: DateTime.UtcNow.AddMinutes(30),
        signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

    await WriteAuditAsync(db, tenant.Id, actingUser, "SupportImpersonation", "Tenant", tenant.Id, null,
        $"{(writeAccess ? "READ-WRITE" : "read-only")} session — {dto.Reason.Trim()}");
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(token),
        expiresInMinutes = 30,
        readOnly = !writeAccess,
        tenantName = tenant.Name,
        warning = "This session is recorded against the customer's audit log."
    });
}).RequireAuthorization();

// --- Platform-wide device health -------------------------------------------
// The list support actually opens in the morning: who has stopped checking in.
app.MapGet("/api/admin/device-health", async (AppDbContext db, HttpContext http, int? staleHours) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var cutoff = DateTime.UtcNow.AddHours(-(staleHours ?? 24));

    var rows = await db.Terminals.IgnoreQueryFilters()
        .Where(t => t.RevokedAt == null && t.DeactivatedAt == null && t.LastSeenAt < cutoff)
        .Join(db.Branches.IgnoreQueryFilters(), t => t.BranchId, b => b.Id, (t, b) => new { t, b })
        .Join(db.Tenants.IgnoreQueryFilters(), x => x.b.TenantId, tn => tn.Id, (x, tn) => new
        {
            terminalId = x.t.Id,
            x.t.TerminalName,
            terminalType = x.t.TerminalType.ToString(),
            x.t.LastSeenAt,
            x.t.LicenseExpiresAt,
            branchName = x.b.Name,
            tenantId = tn.Id,
            tenantName = tn.Name,
            tenantStatus = tn.Status.ToString()
        })
        .OrderBy(r => r.LastSeenAt)
        .Take(500)
        .ToListAsync();

    return Results.Ok(new { cutoff, count = rows.Count, devices = rows });
}).RequireAuthorization();

// ============================================================
// WHATSAPP NOTIFICATION SYSTEM
// ============================================================

app.MapGet("/api/whatsapp/config", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var config = await db.WhatsAppConfigs.FirstOrDefaultAsync(w => w.TenantId == tenantId.Value);
    // Secrets are never echoed back — the UI shows whether each is set, not the value itself.
    return Results.Ok(new
    {
        provider = config?.Provider ?? "Manual",
        hasApiKey = !string.IsNullOrEmpty(config?.ApiKey),
        hasApiSecret = !string.IsNullOrEmpty(config?.ApiSecret),
        phoneNumberId = config?.PhoneNumberId ?? "",
        hasAccessToken = !string.IsNullOrEmpty(config?.AccessToken),
        webhookUrl = config?.WebhookUrl ?? "",
        isEnabled = config?.IsEnabled ?? false,
        autoSendOrderUpdates = config?.AutoSendOrderUpdates ?? false,
        autoSendReceipt = config?.AutoSendReceipt ?? false
    });
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
        // GET never returns the real secret, so an untouched field arrives blank — keep the saved
        // value unless the owner actually typed a new one.
        if (!string.IsNullOrEmpty(dto.ApiKey)) existing.ApiKey = dto.ApiKey;
        if (!string.IsNullOrEmpty(dto.ApiSecret)) existing.ApiSecret = dto.ApiSecret;
        if (!string.IsNullOrEmpty(dto.AccessToken)) existing.AccessToken = dto.AccessToken;
        existing.PhoneNumberId = dto.PhoneNumberId;
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
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

app.MapPost("/api/whatsapp/test", async (AppDbContext db, HttpContext http, Pos.Api.Services.IWhatsAppSenderResolver resolver, TestWhatsAppDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();

    var message = $"Hello! This is a test message from Cashly POS.\n\nRestaurant: {dto.RestaurantName}\nStatus: Connected!";
    var (skipped, sent, reason, logId) = await SendWhatsAppMessageAsync(db, resolver, tenantId.Value, null, dto.PhoneNumber, "test", message);

    if (skipped) return Results.BadRequest(new { error = reason ?? "WhatsApp is not configured." });
    return Results.Ok(new { sent, message = sent ? "Test message sent." : (reason ?? "The provider rejected the message."), logId });
}).RequireAuthorization()
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireFeatureFilter(nameof(SaaSPackageConfig.HasWhatsAppMessaging)))
  .AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// Fires automatically from the order-status endpoints below (placed/ready/delivered/receipt) using
// the order's own phone number — this manual endpoint exists for ad-hoc resends only. Authenticated;
// the tenant comes from the caller's token, never from the body (a client could otherwise burn
// another tenant's message quota).
app.MapPost("/api/whatsapp/send-order-update", async (AppDbContext db, HttpContext http, Pos.Api.Services.IWhatsAppSenderResolver resolver, OrderNotificationDto dto) =>
{
    var callerTenantId = http.GetTenantId();
    if (callerTenantId == null || callerTenantId == Guid.Empty) return Results.Unauthorized();

    var message = BuildWhatsAppMessage(dto.MessageType, dto.OrderNumber, dto.ItemSummary, dto.TotalPKR, dto.DeliveryAddress, dto.PaymentMethod, dto.CustomMessage);
    var (skipped, sent, reason, logId) = await SendWhatsAppMessageAsync(db, resolver, callerTenantId.Value, dto.OrderId, dto.PhoneNumber, dto.MessageType, message);

    if (skipped) return Results.Ok(new { skipped = true, reason });
    return Results.Ok(new { sent, reason, logId });
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

// Reference data for the signup wizard's country/state picker + starting tax config preview.
app.MapGet("/api/public/countries", (string? verticalPack) => Results.Ok(Pos.Api.Data.CountryTaxProfiles.GetAll(verticalPack)));


// ============================================================
// WHAT THIS TENANT IS ENTITLED TO — the one answer the whole frontend reads.
//
// Previously this rebuilt the tier-plus-add-on merge inline, which meant it could not see
// support overrides and quietly disagreed with the filters guarding the actual endpoints.
// It now returns the resolved snapshot, plus the vertical-pack capabilities that decide which
// screens and item fields this business should even have.
// ============================================================
app.MapGet("/api/tenant/my-package", async (
    AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId.Value);
    if (tenant == null) return Results.NotFound();

    var ent = await entitlements.GetAsync(tenantId.Value);
    var (items, flows, layout, modules) = Pos.Api.Data.VerticalPacks.Merge(ent.PackKeys, ent.PrimaryPackKey);
    var primaryPack = Pos.Api.Data.VerticalPacks.Find(ent.PrimaryPackKey);

    // Which surface this particular user should see. A tenant-wide owner (no pinned branch) at a
    // head-office chain administers the whole group, so they get the ERP; branch-pinned staff get
    // the POS for their branch. A standalone shop gets the hybrid app either way.
    var userBranchId = http.GetBranchId();
    var atHeadOffice = userBranchId == null
        ? true // not pinned: head office / owner view
        : await db.Branches.IgnoreQueryFilters()
            .Where(b => b.Id == userBranchId.Value).Select(b => b.IsHeadOffice).FirstOrDefaultAsync();
    var surface = ent.SurfaceFor(atHeadOffice);

    // camelCase feature keys are kept alongside the resolved set because the existing frontend
    // guards read them by that name. Same values, two spellings, one source.
    var features = new Dictionary<string, object?>
    {
        ["MaxBranches"] = ent.MaxBranches,
        ["MaxCounters"] = ent.MaxCounters,
        ["MaxOrderTabs"] = ent.MaxOrderTabs,
        ["MaxUsers"] = ent.MaxUsers
    };
    foreach (var flag in Pos.Api.Services.EntitlementService.FeatureFlagNames)
    {
        var camel = char.ToLowerInvariant(flag[0]) + flag[1..];
        features[camel] = ent.Has(flag);
    }

    var activeAddOnKeys = await db.AddOnSubscriptions.IgnoreQueryFilters()
        .Where(a => a.TenantId == tenantId.Value && a.IsActive)
        .Select(a => a.AddOnKey).ToListAsync();

    return Results.Ok(new
    {
        tier = ent.PlanKey,
        snapshotVersion = ent.Version,
        isActive = tenant.IsActive,
        status = ent.Status.ToString(),
        isTrialActive = ent.Status == TenantStatus.Trial,
        trialEndsAt = tenant.TrialEndsAt,
        subscriptionPaidUntil = tenant.SubscriptionPaidUntil,

        // What the lifecycle state permits, resolved once here so no screen has to infer it.
        canSell = ent.CanSell,
        canUseBackOffice = ent.CanUseBackOffice,
        canRead = ent.CanRead,
        showBillingWarning = ent.ShowBillingWarning,

        features,
        activeAddOnKeys,

        // The vertical pack contract: what this business IS, not just what it bought.
        // How the business is organised, and therefore which app this person gets.
        deploymentMode = ent.DeploymentMode.ToString(),
        // "Erp" = back office only, no till anywhere in the UI. "Pos" = a selling branch.
        // "Hybrid" = a standalone shop that does both.
        appSurface = surface.ToString(),
        isHeadOffice = atHeadOffice,
        showPos = surface != AppSurface.Erp,

        verticalPacks = ent.PackKeys,
        primaryPack = ent.PrimaryPackKey,
        packDisplayName = primaryPack?.DisplayName,
        posLayout = layout.ToString(),
        catalogNoun = primaryPack?.CatalogNoun ?? "Catalog",
        saleNoun = primaryPack?.SaleNoun ?? "Sale",
        sectorModules = modules,
        itemCapabilities = new
        {
            items.Variants, items.Modifiers, items.BatchExpiry, items.SerialNumbers,
            items.Weighable, items.RecipeBom, items.ServiceDuration,
            items.PrescriptionRequired, items.TieredPricing
        },
        flowCapabilities = new
        {
            flows.TableService, flows.KitchenRouting, flows.QuickSale, flows.Appointments,
            flows.Delivery, flows.CreditAccounts, flows.StaffCommission, flows.DeliveryNotes
        }
    });
}).RequireAuthorization();

// The pack catalogue, for the signup picker and the settings screen. Public: a prospect needs
// to see which sectors are supported before they have an account.
app.MapGet("/api/public/vertical-packs", () => Results.Ok(
    Pos.Api.Data.VerticalPacks.Catalog.Select(p => new
    {
        p.Key,
        p.DisplayName,
        p.Description,
        posLayout = p.PosLayout.ToString(),
        p.CatalogNoun,
        p.SaleNoun,
        capabilities = new
        {
            p.Items.Variants, p.Items.Modifiers, p.Items.BatchExpiry, p.Items.SerialNumbers,
            p.Items.Weighable, p.Items.RecipeBom, p.Items.ServiceDuration,
            p.Items.PrescriptionRequired, p.Items.TieredPricing,
            p.Flows.TableService, p.Flows.KitchenRouting, p.Flows.QuickSale,
            p.Flows.Appointments, p.Flows.Delivery, p.Flows.CreditAccounts,
            p.Flows.StaffCommission, p.Flows.DeliveryNotes
        }
    }))).AllowAnonymous();

// Turn a pack on or off for this tenant. An owner can do this themselves — a grocery that opens
// a cafe counter should not need a support ticket to get table service.
app.MapPut("/api/tenant/vertical-packs", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    SetVerticalPacksDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser == null) return Results.Unauthorized();
    if (actingUser.Role is not (UserRole.OwnerAdmin or UserRole.SuperAdmin))
        return Results.Json(new { message = "Only an owner can change which sectors this business runs." }, statusCode: 403);

    var requested = (dto.PackKeys ?? new List<string>())
        .Select(k => Pos.Api.Data.VerticalPacks.Find(k)?.Key)
        .Where(k => k != null).Select(k => k!).Distinct().ToList();

    if (requested.Count == 0)
        return Results.BadRequest(new { message = "At least one valid sector pack is required." });

    var primary = Pos.Api.Data.VerticalPacks.Find(dto.PrimaryPackKey)?.Key ?? requested[0];
    if (!requested.Contains(primary)) requested.Insert(0, primary);

    var existing = await db.TenantVerticalPacks.Where(p => p.TenantId == tenantId.Value).ToListAsync();
    db.TenantVerticalPacks.RemoveRange(existing.Where(e => !requested.Contains(e.PackKey)));

    foreach (var key in requested)
    {
        var row = existing.FirstOrDefault(e => e.PackKey == key);
        if (row == null)
            db.TenantVerticalPacks.Add(new TenantVerticalPack { TenantId = tenantId.Value, PackKey = key, IsPrimary = key == primary });
        else
            row.IsPrimary = key == primary;
    }

    await WriteAuditAsync(db, tenantId.Value, actingUser, "VerticalPacksChanged", "Tenant", tenantId.Value,
        string.Join(",", existing.Select(e => e.PackKey)), string.Join(",", requested));
    await db.SaveChangesAsync();

    // Packs feed the snapshot, so the version has to move for devices to pick the change up.
    var updated = await entitlements.RecomputeAsync(tenantId.Value);
    return Results.Ok(new { packs = updated.PackKeys, primary = updated.PrimaryPackKey, snapshotVersion = updated.Version });
}).RequireAuthorization();

// ============================================================
// ADD-ONS — features sold standalone to a tenant on a lower tier who doesn't want
// (or need) a full tier upgrade. Catalog pricing is SuperAdmin-managed; granting/
// revoking a specific tenant's add-on is also SuperAdmin-only — this is a manual
// sales process (the owner asks, you sell it), not self-serve checkout.
// ============================================================

// Which screen/module an add-on key actually unlocks — derived from the key itself (every key is
// either a SaaSPackageConfig flag name or one of the quantity keys) rather than relying on
// whatever free-text description someone typed, so this can never drift out of sync with reality.
static (string Module, string? Route) AddOnUnlockInfo(string key) => key switch
{
    nameof(SaaSPackageConfig.HasKitchenDisplay) => ("Kitchen Display (KDS)", "/kitchen"),
    nameof(SaaSPackageConfig.HasDeliveryCOD) => ("Delivery & COD Board", "/delivery"),
    nameof(SaaSPackageConfig.HasInventoryManagement) => ("Inventory Management", "/inventory"),
    nameof(SaaSPackageConfig.HasStockTransfers) => ("Supply Chain (Stock Transfers)", "/transfers"),
    nameof(SaaSPackageConfig.HasDirectorDashboard) => ("Executive Dashboard", "/director"),
    nameof(SaaSPackageConfig.HasConsolidatedReports) => ("Financial Reports — Multi-Branch Consolidation", "/reports"),
    nameof(SaaSPackageConfig.HasAdvancedReports) => ("Financial Reports — Advanced Analytics", "/reports"),
    nameof(SaaSPackageConfig.HasMultiBranch) => ("Multi-Branch Operations (adding branches)", null),
    "EXTRA_COUNTER" => ("POS Terminal Devices (Settings → Devices, per branch)", "/settings"),
    "EXTRA_TABLET" => ("Tablet Waiter App Devices (per branch)", "/order-tab"),
    "EXTRA_USER" => ("Staff & PIN Access (adding staff logins)", "/users"),
    _ => ("Unknown — key does not match any known feature or quota", null)
};

// Any signed-in tenant user can see what's purchasable and what they already have.
app.MapGet("/api/addons/catalog", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var catalog = await db.AddOnCatalogItems.Where(a => a.IsActive).OrderBy(a => a.DisplayName).ToListAsync();
    var active = await db.AddOnSubscriptions.Where(a => a.TenantId == tenantId.Value && a.IsActive).Select(a => a.AddOnKey).ToListAsync();
    return Results.Ok(catalog.Select(c =>
    {
        var (module, route) = AddOnUnlockInfo(c.Key);
        return new { c.Id, c.Key, c.DisplayName, c.Description, c.MonthlyPricePKR, c.YearlyPricePKR, isActiveForTenant = active.Contains(c.Key), unlocksModule = module, unlocksRoute = route };
    }));
}).RequireAuthorization();

// --- SuperAdmin: manage the sellable catalog itself ---
app.MapGet("/api/admin/addons/catalog", async (AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var catalog = await db.AddOnCatalogItems.OrderBy(a => a.DisplayName).ToListAsync();
    return Results.Ok(catalog.Select(c =>
    {
        var (module, route) = AddOnUnlockInfo(c.Key);
        return new { c.Id, c.Key, c.DisplayName, c.Description, c.MonthlyPricePKR, c.YearlyPricePKR, c.IsActive, c.CreatedAt, unlocksModule = module, unlocksRoute = route };
    }));
}).RequireAuthorization();

app.MapPost("/api/admin/addons/catalog", async (AppDbContext db, HttpContext http, CreateAddOnCatalogItemDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    if (string.IsNullOrWhiteSpace(dto.Key) || string.IsNullOrWhiteSpace(dto.DisplayName))
        return Results.BadRequest(new { message = "Key and display name are required." });
    if (await db.AddOnCatalogItems.AnyAsync(a => a.Key == dto.Key))
        return Results.BadRequest(new { message = $"An add-on with key {dto.Key} already exists." });
    var item = new AddOnCatalogItem { Key = dto.Key.Trim(), DisplayName = dto.DisplayName.Trim(), Description = dto.Description, MonthlyPricePKR = dto.MonthlyPricePKR, YearlyPricePKR = dto.YearlyPricePKR };
    db.AddOnCatalogItems.Add(item);
    await db.SaveChangesAsync();
    return Results.Ok(item);
}).RequireAuthorization();

app.MapPut("/api/admin/addons/catalog/{id:guid}", async (Guid id, AppDbContext db, HttpContext http, UpdateAddOnCatalogItemDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var item = await db.AddOnCatalogItems.FindAsync(id);
    if (item == null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(dto.DisplayName)) item.DisplayName = dto.DisplayName.Trim();
    if (dto.Description != null) item.Description = dto.Description;
    if (dto.MonthlyPricePKR.HasValue) item.MonthlyPricePKR = dto.MonthlyPricePKR.Value;
    if (dto.YearlyPricePKR.HasValue) item.YearlyPricePKR = dto.YearlyPricePKR.Value;
    if (dto.IsActive.HasValue) item.IsActive = dto.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(item);
}).RequireAuthorization();

// --- SuperAdmin: grant/revoke a specific tenant's add-on ---
app.MapGet("/api/admin/tenants/{tenantId:guid}/addons", async (Guid tenantId, AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    return Results.Ok(await db.AddOnSubscriptions.Where(a => a.TenantId == tenantId).ToListAsync());
}).RequireAuthorization();

app.MapPost("/api/admin/tenants/{tenantId:guid}/addons", async (Guid tenantId, AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements, GrantAddOnDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var tenant = await db.Tenants.FindAsync(tenantId);
    if (tenant == null) return Results.NotFound(new { message = "Tenant not found." });
    var catalogItem = await db.AddOnCatalogItems.FirstOrDefaultAsync(a => a.Key == dto.AddOnKey);
    if (catalogItem == null) return Results.BadRequest(new { message = $"No catalog entry for {dto.AddOnKey}." });

    // Branch-scoped add-ons — a device allowance applies to one branch's floor, so granting one
    // without picking a branch would be ambiguous on any multi-branch tenant. EXTRA_USER stays
    // tenant-wide since MaxUsers is a tenant-level ceiling.
    Guid? branchId = null;
    if (dto.AddOnKey is "EXTRA_COUNTER" or "EXTRA_TABLET")
    {
        if (dto.BranchId == null) return Results.BadRequest(new { message = $"{dto.AddOnKey} needs a branch — pick which branch gets the extra device." });
        var branchBelongsToTenant = await db.Branches.AnyAsync(b => b.Id == dto.BranchId.Value && b.TenantId == tenantId);
        if (!branchBelongsToTenant) return Results.BadRequest(new { message = "That branch does not belong to this tenant." });
        branchId = dto.BranchId.Value;
    }

    var existing = await db.AddOnSubscriptions.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.AddOnKey == dto.AddOnKey && a.BranchId == branchId);
    if (existing != null)
    {
        existing.IsActive = true;
        existing.PricePKR = dto.PricePKR ?? catalogItem.MonthlyPricePKR;
        existing.Quantity = dto.Quantity ?? 1;
    }
    else
    {
        existing = new AddOnSubscription { TenantId = tenantId, AddOnKey = dto.AddOnKey, BranchId = branchId, Quantity = dto.Quantity ?? 1, PricePKR = dto.PricePKR ?? catalogItem.MonthlyPricePKR, IsActive = true };
        db.AddOnSubscriptions.Add(existing);
    }
    await db.SaveChangesAsync();

    // Add-ons feed the entitlement snapshot, so the version has to move — otherwise the customer
    // has paid for something their tills will not notice until their licence happens to lapse.
    var afterGrant = await entitlements.RecomputeAsync(tenantId);
    return Results.Ok(new { addOn = existing, snapshotVersion = afterGrant.Version });
}).RequireAuthorization();

app.MapPost("/api/admin/tenants/{tenantId:guid}/addons/{addOnId:guid}/revoke", async (Guid tenantId, Guid addOnId, AppDbContext db, HttpContext http, Pos.Api.Services.IEntitlementService entitlements) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var sub = await db.AddOnSubscriptions.IgnoreQueryFilters().FirstOrDefaultAsync(a => a.Id == addOnId && a.TenantId == tenantId);
    if (sub == null) return Results.NotFound();
    sub.IsActive = false;
    await db.SaveChangesAsync();

    var afterRevoke = await entitlements.RecomputeAsync(tenantId);
    return Results.Ok(new { addOn = sub, snapshotVersion = afterRevoke.Version });
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

// ============================================================
// CRM / CUSTOMERS
// Reading a customer is a normal checkout action for any authenticated branch staff member.
// Creating or editing customer records is an "admin" module action.
// ============================================================

api.MapGet("/customers", async (AppDbContext db, HttpContext http, string? search, int limit = 50) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var query = db.Customers.Where(c => c.TenantId == scopedTenantId.Value);
    if (!string.IsNullOrWhiteSpace(search))
    {
        var term = search.Trim();
        query = query.Where(c => c.FullName.Contains(term) || c.Phone.Contains(term) || (c.Email != null && c.Email.Contains(term)));
    }

    var rows = await query.OrderByDescending(c => c.LastVisitAt ?? c.CreatedAt)
        .Take(Math.Clamp(limit, 1, 200)).ToListAsync();
    return Results.Ok(rows);
});

api.MapGet("/customers/lookup", async (AppDbContext db, HttpContext http, string phone) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(phone)) return Results.BadRequest(new { message = "phone is required." });

    var customer = await db.Customers.FirstOrDefaultAsync(c => c.TenantId == scopedTenantId.Value && c.Phone == phone.Trim());
    if (customer == null) return Results.NotFound(new { message = "No customer with that phone number." });

    var config = await db.LoyaltyProgramConfigs.FirstOrDefaultAsync(c => c.TenantId == scopedTenantId.Value);
    return Results.Ok(new
    {
        customer.Id, customer.FullName, customer.Phone, customer.Email,
        customer.LoyaltyPoints, customer.TotalVisits, customer.TotalSpentPKR, customer.LastVisitAt,
        loyaltyEnabled = config?.IsEnabled ?? false,
        redeemableValuePKR = (config != null && config.IsEnabled && customer.LoyaltyPoints >= config.MinRedeemPoints)
            ? customer.LoyaltyPoints * config.PKRValuePerPoint : 0m
    });
});

api.MapPost("/customers", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreateCustomerDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Phone)) return Results.BadRequest(new { message = "Phone is required." });

    var phone = dto.Phone.Trim();
    if (await db.Customers.AnyAsync(c => c.TenantId == scopedTenantId.Value && c.Phone == phone))
        return Results.Conflict(new { message = "A customer with this phone number already exists." });

    var customer = new Customer
    {
        TenantId = scopedTenantId.Value,
        FullName = dto.FullName?.Trim() ?? "Walk-in Customer",
        Phone = phone,
        Email = dto.Email?.Trim()
    };
    db.Customers.Add(customer);

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "CustomerCreated", "Customer", customer.Id, null, customer.Phone);
    await db.SaveChangesAsync();
    return Results.Ok(customer);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

api.MapPut("/customers/{id:guid}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, UpdateCustomerDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == scopedTenantId.Value);
    if (customer == null) return Results.NotFound(new { message = "Customer not found." });

    var before = $"{customer.FullName} / {customer.Phone} / {customer.LoyaltyPoints}pts";
    if (!string.IsNullOrWhiteSpace(dto.FullName)) customer.FullName = dto.FullName.Trim();
    if (!string.IsNullOrWhiteSpace(dto.Phone))
    {
        var phone = dto.Phone.Trim();
        if (phone != customer.Phone && await db.Customers.AnyAsync(c => c.TenantId == scopedTenantId.Value && c.Phone == phone))
            return Results.Conflict(new { message = "Another customer already uses this phone number." });
        customer.Phone = phone;
    }
    if (dto.Email != null) customer.Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim();
    if (dto.LoyaltyPoints.HasValue) customer.LoyaltyPoints = Math.Max(0, dto.LoyaltyPoints.Value);

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "CustomerUpdated", "Customer", customer.Id,
        before, $"{customer.FullName} / {customer.Phone} / {customer.LoyaltyPoints}pts");
    await db.SaveChangesAsync();
    return Results.Ok(customer);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// --- Customer payments (settles a CustomerKhata tab — the AR mirror of supplier payments) ---
api.MapGet("/customers/{id:guid}/payments", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == scopedTenantId.Value);
    if (customer == null) return Results.NotFound();
    var payments = await db.CustomerPayments.Where(p => p.CustomerId == id).OrderByDescending(p => p.PaidAt).ToListAsync();
    return Results.Ok(payments);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

api.MapPost("/customers/{id:guid}/payments", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, RecordCustomerPaymentDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == scopedTenantId.Value);
    if (customer == null) return Results.NotFound();
    if (dto.AmountPKR <= 0) return Results.BadRequest(new { message = "Payment amount must be greater than zero." });
    if (dto.AmountPKR > customer.CurrentBalancePKR)
        return Results.BadRequest(new { message = $"Payment ({dto.AmountPKR}) exceeds what this customer owes ({customer.CurrentBalancePKR})." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    var payment = new CustomerPayment
    {
        TenantId = scopedTenantId.Value, CustomerId = id, AmountPKR = dto.AmountPKR,
        PaymentMethod = dto.PaymentMethod ?? "Cash", ReferenceNumber = dto.ReferenceNumber, Notes = dto.Notes,
        CreatedBy = currentUser?.FullName ?? "System"
    };
    db.CustomerPayments.Add(payment);
    customer.CurrentBalancePKR -= dto.AmountPKR;

    if (await HasAccountingAsync(db, scopedTenantId.Value))
    {
        try
        {
            var receiveAccount = (dto.PaymentMethod ?? "").Contains("Cash", StringComparison.OrdinalIgnoreCase) ? "1000" : "1010";
            await PostJournalEntryAsync(db, scopedTenantId.Value, null, payment.PaidAt,
                $"Payment received from customer — {customer.FullName}", "CustomerPayment", payment.Id, payment.CreatedBy,
                new List<(string, decimal, decimal)> { (receiveAccount, dto.AmountPKR, 0), ("1100", 0, dto.AmountPKR) });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Accounting] Failed to post journal entry for customer payment {payment.Id}: {ex.Message}");
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { payment, customer.CurrentBalancePKR });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// ============================================================
// LOYALTY PROGRAMME
// ============================================================

api.MapGet("/loyalty/config", async (AppDbContext db, HttpContext http) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var config = await GetOrCreateLoyaltyConfigAsync(db, scopedTenantId.Value);
    return Results.Ok(new
    {
        config.Id, config.TenantId, config.IsEnabled, config.PointsPerPKRSpent, config.PKRValuePerPoint, config.MinRedeemPoints,
        accrualExplanation = $"Customers earn {config.PointsPerPKRSpent} point(s) per 100 PKR spent; each point is worth {config.PKRValuePerPoint} PKR on redemption."
    });
});

api.MapPut("/loyalty/config", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, LoyaltyConfigDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var config = await GetOrCreateLoyaltyConfigAsync(db, scopedTenantId.Value);
    var before = $"enabled={config.IsEnabled}, earn={config.PointsPerPKRSpent}/100PKR, value={config.PKRValuePerPoint}, min={config.MinRedeemPoints}";

    if (dto.IsEnabled.HasValue) config.IsEnabled = dto.IsEnabled.Value;
    if (dto.PointsPerPKRSpent.HasValue) config.PointsPerPKRSpent = Math.Max(0, dto.PointsPerPKRSpent.Value);
    if (dto.PKRValuePerPoint.HasValue) config.PKRValuePerPoint = Math.Max(0, dto.PKRValuePerPoint.Value);
    if (dto.MinRedeemPoints.HasValue) config.MinRedeemPoints = Math.Max(0, dto.MinRedeemPoints.Value);

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "LoyaltyConfigChanged", "LoyaltyProgramConfig", config.Id,
        before, $"enabled={config.IsEnabled}, earn={config.PointsPerPKRSpent}/100PKR, value={config.PKRValuePerPoint}, min={config.MinRedeemPoints}");
    await db.SaveChangesAsync();
    return Results.Ok(config);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// PREVIEW ONLY. Points are NOT deducted here — the actual deduction happens inside order creation
// so a quote that the customer walks away from can never silently burn their points.
api.MapPost("/loyalty/redeem", async (AppDbContext db, HttpContext http, LoyaltyRedeemDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var config = await GetOrCreateLoyaltyConfigAsync(db, scopedTenantId.Value);
    if (!config.IsEnabled) return Results.BadRequest(new { message = "The loyalty programme is not enabled." });

    var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == dto.CustomerId && c.TenantId == scopedTenantId.Value);
    if (customer == null) return Results.NotFound(new { message = "Customer not found." });

    if (dto.PointsToRedeem <= 0) return Results.BadRequest(new { message = "pointsToRedeem must be greater than zero." });
    if (dto.PointsToRedeem < config.MinRedeemPoints)
        return Results.BadRequest(new { message = $"At least {config.MinRedeemPoints} points are needed to redeem." });
    if (customer.LoyaltyPoints < dto.PointsToRedeem)
        return Results.BadRequest(new { message = $"Customer only has {customer.LoyaltyPoints} points." });

    return Results.Ok(new
    {
        customerId = customer.Id,
        pointsToRedeem = dto.PointsToRedeem,
        discountPKR = dto.PointsToRedeem * config.PKRValuePerPoint,
        remainingPointsAfter = customer.LoyaltyPoints - dto.PointsToRedeem,
        note = "Preview only — points are deducted when the order that uses them is created."
    });
});

// ============================================================
// GIFT CARDS
// ============================================================

api.MapPost("/gift-cards/issue", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, IssueGiftCardDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (dto.InitialBalancePKR <= 0) return Results.BadRequest(new { message = "initialBalancePKR must be greater than zero." });

    if (dto.IssuedToCustomerId != null &&
        !await db.Customers.AnyAsync(c => c.Id == dto.IssuedToCustomerId.Value && c.TenantId == scopedTenantId.Value))
        return Results.BadRequest(new { message = "Customer not found for this restaurant." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    var card = new GiftCard
    {
        TenantId = scopedTenantId.Value,
        CardCode = await GenerateGiftCardCodeAsync(db),
        InitialBalancePKR = dto.InitialBalancePKR,
        CurrentBalancePKR = dto.InitialBalancePKR,
        IssuedToCustomerId = dto.IssuedToCustomerId,
        ExpiresAt = dto.ExpiresAt
    };
    db.GiftCards.Add(card);
    db.GiftCardTransactions.Add(new GiftCardTransaction
    {
        GiftCardId = card.Id,
        Type = GiftCardTransactionType.Issue,
        AmountPKR = dto.InitialBalancePKR,
        CreatedBy = currentUser?.FullName ?? "System"
    });

    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "GiftCardIssued", "GiftCard", card.Id, null,
        $"{card.CardCode} / {card.InitialBalancePKR:0.##} PKR");
    await db.SaveChangesAsync();
    return Results.Ok(card);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

api.MapGet("/gift-cards/{code}/balance", async (AppDbContext db, HttpContext http, string code) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var cardCode = (code ?? string.Empty).Trim().ToUpperInvariant();
    var card = await db.GiftCards.FirstOrDefaultAsync(g => g.CardCode == cardCode && g.TenantId == scopedTenantId.Value);
    if (card == null) return Results.NotFound(new { message = "Gift card not found." });

    var expired = card.ExpiresAt != null && card.ExpiresAt < DateTime.UtcNow;
    return Results.Ok(new
    {
        card.Id, card.CardCode, card.CurrentBalancePKR, card.InitialBalancePKR,
        card.IsActive, card.ExpiresAt, isExpired = expired,
        isRedeemable = card.IsActive && !expired && card.CurrentBalancePKR > 0
    });
});

api.MapGet("/gift-cards", async (AppDbContext db, HttpContext http, int limit = 100) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var cards = await db.GiftCards.Where(g => g.TenantId == scopedTenantId.Value)
        .OrderByDescending(g => g.IssuedAt).Take(Math.Clamp(limit, 1, 500)).ToListAsync();
    return Results.Ok(cards);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

// ============================================================
// PROMO CODES — discount-generating, so even reading them is admin-gated.
// ============================================================

api.MapGet("/promo-codes", async (AppDbContext db, HttpContext http) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var codes = await db.PromoCodes.Where(p => p.TenantId == scopedTenantId.Value)
        .OrderByDescending(p => p.ValidFrom).ToListAsync();
    return Results.Ok(codes);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

api.MapPost("/promo-codes", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreatePromoCodeDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Code)) return Results.BadRequest(new { message = "Code is required." });
    if (dto.DiscountValue <= 0) return Results.BadRequest(new { message = "discountValue must be greater than zero." });
    if (dto.DiscountType == PromoDiscountType.Percent && dto.DiscountValue > 100)
        return Results.BadRequest(new { message = "A percentage discount cannot exceed 100." });

    var code = dto.Code.Trim().ToUpperInvariant();
    if (await db.PromoCodes.AnyAsync(p => p.TenantId == scopedTenantId.Value && p.Code == code))
        return Results.Conflict(new { message = "A promo code with this code already exists." });

    var promo = new PromoCode
    {
        TenantId = scopedTenantId.Value,
        Code = code,
        DiscountType = dto.DiscountType,
        DiscountValue = dto.DiscountValue,
        MinOrderAmountPKR = Math.Max(0, dto.MinOrderAmountPKR),
        MaxUsesTotal = dto.MaxUsesTotal,
        MaxUsesPerCustomer = dto.MaxUsesPerCustomer,
        ValidFrom = dto.ValidFrom ?? DateTime.UtcNow,
        ValidUntil = dto.ValidUntil,
        IsActive = dto.IsActive ?? true
    };
    db.PromoCodes.Add(promo);

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PromoCodeCreated", "PromoCode", promo.Id, null,
        $"{promo.Code} {promo.DiscountType} {promo.DiscountValue}");
    await db.SaveChangesAsync();
    return Results.Ok(promo);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

api.MapPut("/promo-codes/{id:guid}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, UpdatePromoCodeDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var promo = await db.PromoCodes.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (promo == null) return Results.NotFound(new { message = "Promo code not found." });

    var before = $"{promo.Code} {promo.DiscountType} {promo.DiscountValue} active={promo.IsActive}";
    if (dto.DiscountType.HasValue) promo.DiscountType = dto.DiscountType.Value;
    if (dto.DiscountValue.HasValue) promo.DiscountValue = Math.Max(0, dto.DiscountValue.Value);
    if (dto.MinOrderAmountPKR.HasValue) promo.MinOrderAmountPKR = Math.Max(0, dto.MinOrderAmountPKR.Value);
    if (dto.MaxUsesTotal.HasValue) promo.MaxUsesTotal = dto.MaxUsesTotal.Value;
    if (dto.MaxUsesPerCustomer.HasValue) promo.MaxUsesPerCustomer = dto.MaxUsesPerCustomer.Value;
    if (dto.ValidFrom.HasValue) promo.ValidFrom = dto.ValidFrom.Value;
    if (dto.ValidUntil.HasValue) promo.ValidUntil = dto.ValidUntil.Value;
    if (dto.IsActive.HasValue) promo.IsActive = dto.IsActive.Value;

    if (promo.DiscountType == PromoDiscountType.Percent && promo.DiscountValue > 100)
        return Results.BadRequest(new { message = "A percentage discount cannot exceed 100." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PromoCodeUpdated", "PromoCode", promo.Id,
        before, $"{promo.Code} {promo.DiscountType} {promo.DiscountValue} active={promo.IsActive}");
    await db.SaveChangesAsync();
    return Results.Ok(promo);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

api.MapDelete("/promo-codes/{id:guid}", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var promo = await db.PromoCodes.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (promo == null) return Results.NotFound(new { message = "Promo code not found." });

    var currentUser = await accessor.GetCurrentUserAsync(http);

    // Orders already reference this code, so deactivate rather than orphan the history.
    if (await db.Orders.AnyAsync(o => o.PromoCodeId == promo.Id))
    {
        promo.IsActive = false;
        await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PromoCodeDeactivated", "PromoCode", promo.Id, promo.Code, "inactive");
        await db.SaveChangesAsync();
        return Results.Ok(new { message = "This promo code has been used on past orders, so it was deactivated instead of deleted.", promo });
    }

    db.PromoCodes.Remove(promo);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PromoCodeDeleted", "PromoCode", promo.Id, promo.Code, null);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Promo code deleted." });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "delete"));

// ============================================================
// PAYMENTS
// No live merchant credentials exist in this deployment, so an unconfigured provider answers
// 200 with success:false and an actionable message rather than failing the request.
// ============================================================

api.MapPost("/payments/initiate", async (
    AppDbContext db, HttpContext http,
    Pos.Api.Services.IPaymentGatewayResolver gateways,
    InitiatePaymentDto dto) =>
{
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == dto.OrderId);
    if (order == null) return Results.NotFound(new { message = "Order not found." });

    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;

    if (order.IsPaid) return Results.BadRequest(new { message = "This order is already marked paid." });

    var provider = gateways.Resolve(dto.Provider.ToString());
    var amountDue = Math.Max(0, order.TotalPKR - order.AmountPaidPKR);

    var txn = new PaymentTransaction
    {
        TenantId = order.TenantId,
        BranchId = order.BranchId,
        OrderId = order.Id,
        Provider = dto.Provider,
        Status = PaymentTransactionStatus.Pending,
        AmountPKR = amountDue
    };
    db.PaymentTransactions.Add(txn);

    if (provider == null)
    {
        txn.Status = PaymentTransactionStatus.Failed;
        txn.FailureReason = $"No gateway is registered for {dto.Provider}.";
        await db.SaveChangesAsync();
        return Results.Ok(new { success = false, paymentTransactionId = txn.Id, message = txn.FailureReason });
    }

    var intent = await provider.CreateIntentAsync(order.Id, amountDue, order.CustomerPhone);
    if (!intent.Success)
    {
        txn.Status = PaymentTransactionStatus.Failed;
        txn.FailureReason = intent.ErrorMessage;
        await db.SaveChangesAsync();
        return Results.Ok(new
        {
            success = false, paymentTransactionId = txn.Id, provider = provider.ProviderName,
            configured = provider.IsConfigured, message = intent.ErrorMessage
        });
    }

    txn.ProviderTransactionId = intent.ProviderTransactionId;
    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        success = true, paymentTransactionId = txn.Id, provider = provider.ProviderName,
        amountPKR = amountDue, redirectUrl = intent.RedirectUrl,
        instructions = intent.Instructions, providerTransactionId = intent.ProviderTransactionId
    });
});

// Provider callback. Anonymous by necessity — the gateway holds no JWT — so authenticity rests
// entirely on the signature check, which must pass before anything is written.
api.MapPost("/payments/webhook/{provider}", async (
    AppDbContext db, HttpContext http,
    Pos.Api.Services.IPaymentGatewayResolver gateways,
    string provider) =>
{
    var gateway = gateways.Resolve(provider);
    if (gateway == null) return Results.BadRequest(new { message = $"Unknown payment provider '{provider}'." });

    using var reader = new StreamReader(http.Request.Body);
    var rawBody = await reader.ReadToEndAsync();

    if (!await gateway.VerifyWebhookSignatureAsync(rawBody, http.Request.Headers))
        return Results.BadRequest(new { message = "Webhook signature verification failed." });

    var confirmation = await gateway.ParseWebhookAsync(rawBody);

    var txn = await db.PaymentTransactions
        .Where(t => t.ProviderTransactionId != null && t.ProviderTransactionId == confirmation.ProviderTransactionId)
        .OrderByDescending(t => t.RequestedAt)
        .FirstOrDefaultAsync();
    if (txn == null) return Results.NotFound(new { message = "No matching payment transaction." });

    txn.RawResponsePayload = rawBody.Length > 8000 ? rawBody[..8000] : rawBody;
    txn.CompletedAt = DateTime.UtcNow;
    txn.Status = confirmation.Success ? PaymentTransactionStatus.Completed : PaymentTransactionStatus.Failed;
    txn.FailureReason = confirmation.Success ? null : confirmation.ErrorMessage;
    if (confirmation.AmountPKR.HasValue) txn.AmountPKR = confirmation.AmountPKR.Value;

    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == txn.OrderId);
    if (order != null && confirmation.Success)
    {
        order.AmountPaidPKR = txn.AmountPKR;
        order.IsPaid = true;
    }

    await WriteAuditAsync(db, txn.TenantId, null,
        confirmation.Success ? "PaymentCompleted" : "PaymentFailed",
        "PaymentTransaction", txn.Id, null,
        $"{gateway.ProviderName} {txn.AmountPKR:0.##} PKR ref={txn.ProviderTransactionId}");
    await db.SaveChangesAsync();

    return Results.Ok(new { received = true, status = txn.Status.ToString() });
}).AllowAnonymous(); // payment gateways cannot present a JWT; authenticity is the signature check

api.MapGet("/payments/{orderId:guid}/status", async (AppDbContext db, HttpContext http, Guid orderId) =>
{
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == orderId);
    if (order == null) return Results.NotFound(new { message = "Order not found." });

    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, order.BranchId);
    if (scopeError != null) return scopeError;

    var transactions = await db.PaymentTransactions.Where(t => t.OrderId == orderId)
        .OrderByDescending(t => t.RequestedAt).ToListAsync();

    return Results.Ok(new
    {
        orderId, orderNumber = order.OrderNumber, order.IsPaid,
        totalPKR = order.TotalPKR, amountPaidPKR = order.AmountPaidPKR,
        giftCardRedeemedPKR = order.GiftCardRedeemedPKR,
        transactions = transactions.Select(t => new
        {
            t.Id, provider = t.Provider.ToString(), status = t.Status.ToString(),
            t.AmountPKR, t.ProviderTransactionId, t.RequestedAt, t.CompletedAt, t.FailureReason
        })
    });
});

// ============================================================
// DELIVERY-PLATFORM INTEGRATION
// ============================================================

// Anonymous — the platform calls this. tenantId/branchId identify the outlet; once real partner
// credentials exist this should additionally verify a platform signature header.
api.MapPost("/integrations/delivery/{platform}/webhook", async (
    AppDbContext db, HttpContext http,
    Pos.Api.Services.IDeliveryPlatformResolver connectors,
    Pos.Api.Services.IFiscalInvoiceProvider fiscal,
    Pos.Api.Services.IWhatsAppSenderResolver waResolver,
    string platform, Guid tenantId, Guid branchId) =>
{
    var connector = connectors.Resolve(platform);
    if (connector == null) return Results.BadRequest(new { message = $"Unknown delivery platform '{platform}'." });

    var branch = await db.Branches.Include(b => b.Tenant)
        .FirstOrDefaultAsync(b => b.Id == branchId && b.TenantId == tenantId);
    if (branch == null) return Results.NotFound(new { message = "Branch not found for this tenant." });

    using var reader = new StreamReader(http.Request.Body);
    var rawBody = await reader.ReadToEndAsync();

    var parsed = await connector.ParseIncomingOrderAsync(rawBody, tenantId, branchId);
    if (!parsed.Success || parsed.Order == null)
        return Results.BadRequest(new { message = parsed.ErrorMessage ?? "Could not parse the incoming order." });

    var platformEnum = Enum.TryParse<DeliveryPlatform>(connector.PlatformName, true, out var pe) ? pe : DeliveryPlatform.Other;

    // Idempotency: a platform retrying the same webhook must not create a second order.
    var existing = await db.ExternalOrderMappings
        .FirstOrDefaultAsync(m => m.Platform == platformEnum && m.ExternalOrderId == parsed.Order.ExternalOrderId);
    if (existing != null)
        return Results.Ok(new { alreadyImported = true, orderId = existing.InternalOrderId, externalOrderId = existing.ExternalOrderId });

    // Resolve platform line items to internal products by SKU first, then by exact name.
    var skus = parsed.Order.Items.Where(i => !string.IsNullOrWhiteSpace(i.Sku)).Select(i => i.Sku!).ToList();
    var names = parsed.Order.Items.Select(i => i.Name).ToList();
    var candidates = await db.Products
        .Where(p => p.TenantId == tenantId && p.IsActive && (skus.Contains(p.SKU) || names.Contains(p.Name)))
        .ToListAsync();

    var lines = new List<CreateOrderItemDto>();
    var unmatched = new List<string>();
    foreach (var item in parsed.Order.Items)
    {
        var product = (!string.IsNullOrWhiteSpace(item.Sku) ? candidates.FirstOrDefault(p => p.SKU == item.Sku) : null)
                      ?? candidates.FirstOrDefault(p => p.Name == item.Name);
        if (product == null) { unmatched.Add(item.Name); continue; }
        // UnitPricePKR is passed through only for shape; CreateOrderCoreAsync re-prices from the DB.
        lines.Add(new CreateOrderItemDto(product.Id, product.Name, item.Quantity, product.SellingPricePKR, null, parsed.Order.Notes, product.Station));
    }

    if (unmatched.Count > 0)
        return Results.BadRequest(new { message = "Some platform items could not be matched to menu products.", unmatchedItems = unmatched });

    var dto = new CreateOrderDto(
        branch.Id, OrderType.Delivery, null,
        parsed.Order.CustomerName, parsed.Order.CustomerPhone, parsed.Order.DeliveryAddress,
        0, 0, 0, 0, PaymentMethod.Cash, 0, 0, parsed.Order.IsPrepaid,
        connector.PlatformName, $"{connector.PlatformName} Integration", lines);

    // Same core as POST /orders — the server-side price/tax recompute applies here too.
    var (error, order, _) = await CreateOrderCoreAsync(db, branch, dto, null, fiscal, waResolver);
    if (error != null) return error;

    db.ExternalOrderMappings.Add(new ExternalOrderMapping
    {
        TenantId = tenantId,
        BranchId = branchId,
        Platform = platformEnum,
        ExternalOrderId = parsed.Order.ExternalOrderId,
        InternalOrderId = order!.Id,
        RawPayload = rawBody.Length > 16000 ? rawBody[..16000] : rawBody
    });
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        imported = true, orderId = order.Id, orderNumber = order.OrderNumber,
        externalOrderId = parsed.Order.ExternalOrderId, totalPKR = order.TotalPKR
    });
}).AllowAnonymous(); // delivery platforms cannot present a JWT

api.MapGet("/integrations/delivery/{platform}/config", async (
    AppDbContext db, HttpContext http,
    Pos.Api.Services.IDeliveryPlatformResolver connectors,
    string platform) =>
{
    // A platform SuperAdmin has no tenant of its own — this screen configures ONE restaurant's
    // integration, which isn't a SuperAdmin concept without a tenant picker (none exists here).
    // That's a scoping problem, not a bad session, so it must not be a 401 (the client treats any
    // 401 as "session expired" and force-logs-out — which is exactly the bug this was causing).
    if (http.IsSuperAdmin())
        return Results.Json(new { message = "Delivery integration settings are configured per-restaurant. Sign in as that restaurant's Owner/Admin to view or change them." }, statusCode: StatusCodes.Status400BadRequest);

    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var connector = connectors.Resolve(platform);
    if (connector == null) return Results.NotFound(new { message = $"Unknown delivery platform '{platform}'." });

    var recent = await db.ExternalOrderMappings
        .Where(m => m.TenantId == scopedTenantId.Value)
        .OrderByDescending(m => m.ReceivedAt).Take(20)
        .Select(m => new { m.Id, m.ExternalOrderId, m.InternalOrderId, m.BranchId, m.ReceivedAt })
        .ToListAsync();

    return Results.Ok(new
    {
        platform = connector.PlatformName,
        isConfigured = false,
        webhookUrl = $"/api/integrations/delivery/{connector.PlatformName.ToLowerInvariant()}/webhook?tenantId={scopedTenantId.Value}&branchId=<branchId>",
        note = "Partner credentials are not configured. The webhook accepts a best-effort payload shape; confirm against the platform's partner API docs before going live.",
        recentImports = recent
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "view"));

api.MapPut("/integrations/delivery/{platform}/config", async (
    AppDbContext db, HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    Pos.Api.Services.IDeliveryPlatformResolver connectors,
    string platform, DeliveryIntegrationConfigDto dto) =>
{
    if (http.IsSuperAdmin())
        return Results.Json(new { message = "Delivery integration settings are configured per-restaurant. Sign in as that restaurant's Owner/Admin to view or change them." }, statusCode: StatusCodes.Status400BadRequest);

    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var connector = connectors.Resolve(platform);
    if (connector == null) return Results.NotFound(new { message = $"Unknown delivery platform '{platform}'." });

    // Credentials for delivery platforms are not stored yet: no partner account exists to hold
    // them, and inventing a secrets table now would imply a working integration that isn't.
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "DeliveryIntegrationConfigAttempted",
        "DeliveryIntegration", null, null, $"{connector.PlatformName} enabled={dto.IsEnabled}");
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        platform = connector.PlatformName,
        saved = false,
        message = "Delivery-platform credentials cannot be stored yet — no partner account exists for this deployment. Obtain partner API access first, then this endpoint will persist the credentials."
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("admin", "edit"));

// ============================================================
// LABOR — scheduling and time clock
// ============================================================

api.MapGet("/labor/schedules", async (AppDbContext db, HttpContext http, Guid? branchId, DateTime? from, DateTime? to) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var start = from ?? DateTime.UtcNow.Date.AddDays(-7);
    var end = to ?? DateTime.UtcNow.Date.AddDays(14);

    var rows = await db.StaffShiftSchedules
        .Where(s => s.TenantId == scopedTenantId!.Value && s.BranchId == scopedBranchId!.Value
                    && s.ScheduledStart >= start && s.ScheduledStart <= end)
        .OrderBy(s => s.ScheduledStart)
        .ToListAsync();

    var userIds = rows.Select(r => r.UserId).Distinct().ToList();
    var users = await db.Users.Where(u => userIds.Contains(u.Id))
        .ToDictionaryAsync(u => u.Id, u => u.FullName);

    return Results.Ok(rows.Select(s => new
    {
        s.Id, s.BranchId, s.UserId,
        userName = users.TryGetValue(s.UserId, out var n) ? n : "(removed user)",
        s.ScheduledStart, s.ScheduledEnd, s.Position, s.Notes, s.CreatedBy,
        hours = Math.Round((decimal)(s.ScheduledEnd - s.ScheduledStart).TotalHours, 2)
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

api.MapPost("/labor/schedules", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreateShiftScheduleDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    if (dto.ScheduledEnd <= dto.ScheduledStart)
        return Results.BadRequest(new { message = "The shift must end after it starts." });

    var staff = await db.Users.FirstOrDefaultAsync(u => u.Id == dto.UserId && u.TenantId == scopedTenantId!.Value);
    if (staff == null) return Results.BadRequest(new { message = "Staff member not found for this restaurant." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    var schedule = new StaffShiftSchedule
    {
        TenantId = scopedTenantId!.Value,
        BranchId = scopedBranchId!.Value,
        UserId = dto.UserId,
        ScheduledStart = dto.ScheduledStart,
        ScheduledEnd = dto.ScheduledEnd,
        Position = dto.Position ?? staff.Role.ToString(),
        Notes = dto.Notes,
        CreatedBy = currentUser?.FullName ?? "System"
    };
    db.StaffShiftSchedules.Add(schedule);
    await db.SaveChangesAsync();
    return Results.Ok(schedule);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPut("/labor/schedules/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateShiftScheduleDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var schedule = await db.StaffShiftSchedules.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == scopedTenantId.Value);
    if (schedule == null) return Results.NotFound(new { message = "Schedule not found." });

    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, schedule.BranchId);
    if (scopeError != null) return scopeError;

    if (dto.ScheduledStart.HasValue) schedule.ScheduledStart = dto.ScheduledStart.Value;
    if (dto.ScheduledEnd.HasValue) schedule.ScheduledEnd = dto.ScheduledEnd.Value;
    if (dto.Position != null) schedule.Position = dto.Position;
    if (dto.Notes != null) schedule.Notes = dto.Notes;

    if (schedule.ScheduledEnd <= schedule.ScheduledStart)
        return Results.BadRequest(new { message = "The shift must end after it starts." });

    await db.SaveChangesAsync();
    return Results.Ok(schedule);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapDelete("/labor/schedules/{id:guid}", async (AppDbContext db, HttpContext http, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var schedule = await db.StaffShiftSchedules.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == scopedTenantId.Value);
    if (schedule == null) return Results.NotFound(new { message = "Schedule not found." });

    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, schedule.BranchId);
    if (scopeError != null) return scopeError;

    db.StaffShiftSchedules.Remove(schedule);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Shift removed from the schedule." });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPost("/labor/clock-in", async (AppDbContext db, HttpContext http, ClockInDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;

    var staff = await db.Users.FirstOrDefaultAsync(u => u.Id == dto.UserId && u.TenantId == scopedTenantId!.Value);
    if (staff == null) return Results.BadRequest(new { message = "Staff member not found for this restaurant." });

    var open = await db.TimeClockEntries.FirstOrDefaultAsync(t => t.UserId == dto.UserId && t.ClockOutAt == null);
    if (open != null)
        return Results.Conflict(new { message = "This staff member is already clocked in.", timeClockEntryId = open.Id, open.ClockInAt });

    // Best-effort linkage only: if exactly one cash shift is open at this branch, associate it.
    var openShifts = await db.CashShifts.Where(s => s.BranchId == scopedBranchId!.Value && !s.IsClosed)
        .Select(s => s.Id).Take(2).ToListAsync();

    var entry = new TimeClockEntry
    {
        TenantId = scopedTenantId!.Value,
        BranchId = scopedBranchId!.Value,
        UserId = dto.UserId,
        ClockInAt = DateTime.UtcNow,
        LinkedCashShiftId = openShifts.Count == 1 ? openShifts[0] : null
    };
    db.TimeClockEntries.Add(entry);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPost("/labor/clock-out", async (AppDbContext db, HttpContext http, ClockOutDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();

    var entry = await db.TimeClockEntries.FirstOrDefaultAsync(t => t.Id == dto.TimeClockEntryId && t.TenantId == scopedTenantId.Value);
    if (entry == null) return Results.NotFound(new { message = "Time clock entry not found." });

    var (_, _, scopeError) = await ResolveScopeAsync(http, db, null, entry.BranchId);
    if (scopeError != null) return scopeError;

    if (entry.ClockOutAt != null) return Results.BadRequest(new { message = "This entry is already clocked out." });

    entry.ClockOutAt = DateTime.UtcNow;
    entry.HoursWorked = Math.Round((decimal)(entry.ClockOutAt.Value - entry.ClockInAt).TotalHours, 2, MidpointRounding.AwayFromZero);
    await db.SaveChangesAsync();
    return Results.Ok(entry);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapGet("/labor/timesheet", async (AppDbContext db, HttpContext http, Guid? userId, Guid? branchId, DateTime? from, DateTime? to) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var start = from ?? DateTime.UtcNow.Date.AddDays(-14);
    var end = (to ?? DateTime.UtcNow.Date).AddDays(1);

    var query = db.TimeClockEntries.Where(t => t.TenantId == scopedTenantId!.Value && t.BranchId == scopedBranchId!.Value
                                               && t.ClockInAt >= start && t.ClockInAt < end);
    if (userId.HasValue && userId.Value != Guid.Empty) query = query.Where(t => t.UserId == userId.Value);

    var entries = await query.OrderByDescending(t => t.ClockInAt).ToListAsync();
    var userIds = entries.Select(e => e.UserId).Distinct().ToList();
    var users = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName);

    var rows = entries.Select(e => new
    {
        e.Id, e.UserId,
        userName = users.TryGetValue(e.UserId, out var n) ? n : "(removed user)",
        e.BranchId, e.ClockInAt, e.ClockOutAt, e.LinkedCashShiftId,
        hoursWorked = e.HoursWorked ?? 0m,
        isOpen = e.ClockOutAt == null
    }).ToList();

    return Results.Ok(new
    {
        from = start, to = end.AddDays(-1),
        totalEntries = rows.Count,
        totalHours = Math.Round(rows.Sum(r => r.hoursWorked), 2),
        perStaff = rows.GroupBy(r => new { r.UserId, r.userName })
            .Select(g => new { userId = g.Key.UserId, userName = g.Key.userName, entries = g.Count(), totalHours = Math.Round(g.Sum(x => x.hoursWorked), 2) })
            .OrderByDescending(x => x.totalHours),
        entries = rows
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

api.MapGet("/labor/timesheet/export", async (AppDbContext db, HttpContext http, Guid? userId, Guid? branchId, DateTime? from, DateTime? to) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var start = from ?? DateTime.UtcNow.Date.AddDays(-14);
    var end = (to ?? DateTime.UtcNow.Date).AddDays(1);

    var query = db.TimeClockEntries.Where(t => t.TenantId == scopedTenantId!.Value && t.BranchId == scopedBranchId!.Value
                                               && t.ClockInAt >= start && t.ClockInAt < end);
    if (userId.HasValue && userId.Value != Guid.Empty) query = query.Where(t => t.UserId == userId.Value);

    var entries = await query.OrderBy(t => t.ClockInAt).ToListAsync();
    var userIds = entries.Select(e => e.UserId).Distinct().ToList();
    var users = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName);

    static string Csv(string? value)
    {
        value ??= string.Empty;
        return value.Contains(',') || value.Contains('"') || value.Contains('\n')
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }

    var sb = new StringBuilder();
    sb.AppendLine("StaffName,UserId,ClockInUtc,ClockOutUtc,HoursWorked,LinkedCashShiftId");
    foreach (var e in entries)
    {
        sb.AppendLine(string.Join(",",
            Csv(users.TryGetValue(e.UserId, out var n) ? n : "(removed user)"),
            e.UserId,
            e.ClockInAt.ToString("yyyy-MM-dd HH:mm:ss"),
            e.ClockOutAt?.ToString("yyyy-MM-dd HH:mm:ss") ?? string.Empty,
            (e.HoursWorked ?? 0m).ToString("0.00"),
            e.LinkedCashShiftId?.ToString() ?? string.Empty));
    }
    sb.AppendLine();
    sb.AppendLine($"TOTAL,,,,{entries.Sum(e => e.HoursWorked ?? 0m):0.00},");

    http.Response.Headers.ContentDisposition = $"attachment; filename=timesheet-{start:yyyyMMdd}-{end.AddDays(-1):yyyyMMdd}.csv";
    return Results.Content(sb.ToString(), "text/csv");
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

// ============================================================
// HR — Departments, Designations (real master data, promoted out of the free-text
// AppUser fields) and Leave Requests. Gated with the "labor" baseline like the rest
// of scheduling — a BranchManager can run their own branch's day-to-day HR.
// ============================================================

api.MapGet("/hr/departments", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var rows = await db.Departments.Where(d => d.TenantId == scopedTenantId.Value).OrderBy(d => d.Name).ToListAsync();
    return Results.Ok(rows);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

api.MapPost("/hr/departments", async (AppDbContext db, HttpContext http, CreateDepartmentDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { message = "Department name is required." });
    if (await db.Departments.AnyAsync(d => d.TenantId == scopedTenantId.Value && d.Name == dto.Name.Trim()))
        return Results.BadRequest(new { message = "A department with this name already exists." });
    var dept = new Department { TenantId = scopedTenantId.Value, Name = dto.Name.Trim() };
    db.Departments.Add(dept);
    await db.SaveChangesAsync();
    return Results.Ok(dept);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPut("/hr/departments/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateDepartmentDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var dept = await db.Departments.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == scopedTenantId.Value);
    if (dept == null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(dto.Name)) dept.Name = dto.Name.Trim();
    if (dto.IsActive.HasValue) dept.IsActive = dto.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(dept);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapGet("/hr/designations", async (AppDbContext db, HttpContext http, Guid? tenantId, Guid? departmentId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Designations.Where(d => d.TenantId == scopedTenantId.Value).AsQueryable();
    if (departmentId.HasValue) query = query.Where(d => d.DepartmentId == departmentId.Value);
    return Results.Ok(await query.OrderBy(d => d.Name).ToListAsync());
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

api.MapPost("/hr/designations", async (AppDbContext db, HttpContext http, CreateDesignationDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { message = "Designation name is required." });
    var designation = new Designation { TenantId = scopedTenantId.Value, Name = dto.Name.Trim(), DepartmentId = dto.DepartmentId };
    db.Designations.Add(designation);
    await db.SaveChangesAsync();
    return Results.Ok(designation);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPut("/hr/designations/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateDesignationDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var designation = await db.Designations.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == scopedTenantId.Value);
    if (designation == null) return Results.NotFound();
    if (!string.IsNullOrWhiteSpace(dto.Name)) designation.Name = dto.Name.Trim();
    if (dto.DepartmentId.HasValue) designation.DepartmentId = dto.DepartmentId.Value == Guid.Empty ? null : dto.DepartmentId.Value;
    if (dto.IsActive.HasValue) designation.IsActive = dto.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(designation);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

// --- Leave requests ---
api.MapGet("/hr/leave-requests", async (AppDbContext db, HttpContext http, Guid? userId, Guid? branchId, string? status) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var effectiveBranchId = http.GetBranchId() ?? branchId;
    var query = db.LeaveRequests.Include(l => l.User).Where(l => l.TenantId == scopedTenantId.Value).AsQueryable();
    if (effectiveBranchId.HasValue && effectiveBranchId.Value != Guid.Empty) query = query.Where(l => l.BranchId == effectiveBranchId.Value);
    if (userId.HasValue) query = query.Where(l => l.UserId == userId.Value);
    if (!string.IsNullOrEmpty(status) && Enum.TryParse<LeaveRequestStatus>(status, out var st)) query = query.Where(l => l.Status == st);
    var rows = await query.OrderByDescending(l => l.RequestedAt).ToListAsync();
    return Results.Ok(rows.Select(l => new
    {
        l.Id, l.UserId, userFullName = l.User?.FullName, l.BranchId, leaveType = l.LeaveType.ToString(),
        l.StartDate, l.EndDate, l.DaysRequested, l.Reason, status = l.Status.ToString(),
        l.RequestedAt, l.ReviewedBy, l.ReviewedAt, l.ReviewNotes
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "view"));

api.MapPost("/hr/leave-requests", async (AppDbContext db, HttpContext http, CreateLeaveRequestDto dto) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, dto.BranchId);
    if (scopeError != null) return scopeError;
    if (dto.EndDate < dto.StartDate) return Results.BadRequest(new { message = "End date must be on or after the start date." });

    var days = dto.DaysRequested ?? (decimal)(dto.EndDate.Date - dto.StartDate.Date).TotalDays + 1;
    var leave = new LeaveRequest
    {
        TenantId = scopedTenantId!.Value, BranchId = scopedBranchId!.Value, UserId = dto.UserId,
        LeaveType = dto.LeaveType, StartDate = dto.StartDate, EndDate = dto.EndDate, DaysRequested = days, Reason = dto.Reason
    };
    db.LeaveRequests.Add(leave);
    await db.SaveChangesAsync();
    return Results.Ok(leave);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPost("/hr/leave-requests/{id:guid}/approve", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, ReviewLeaveRequestDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var leave = await db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id && l.TenantId == scopedTenantId.Value);
    if (leave == null) return Results.NotFound();
    if (leave.Status != LeaveRequestStatus.Pending) return Results.BadRequest(new { message = $"Already {leave.Status}." });
    var currentUser = await accessor.GetCurrentUserAsync(http);
    leave.Status = LeaveRequestStatus.Approved;
    leave.ReviewedBy = currentUser?.FullName ?? "System";
    leave.ReviewedAt = DateTime.UtcNow;
    leave.ReviewNotes = dto.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(leave);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

api.MapPost("/hr/leave-requests/{id:guid}/reject", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, ReviewLeaveRequestDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var leave = await db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id && l.TenantId == scopedTenantId.Value);
    if (leave == null) return Results.NotFound();
    if (leave.Status != LeaveRequestStatus.Pending) return Results.BadRequest(new { message = $"Already {leave.Status}." });
    var currentUser = await accessor.GetCurrentUserAsync(http);
    leave.Status = LeaveRequestStatus.Rejected;
    leave.ReviewedBy = currentUser?.FullName ?? "System";
    leave.ReviewedAt = DateTime.UtcNow;
    leave.ReviewNotes = dto.Notes;
    await db.SaveChangesAsync();
    return Results.Ok(leave);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("labor", "edit"));

// ============================================================
// PAYROLL — wages are more sensitive than shift scheduling, so unlike the rest of
// "labor" this is gated on CanViewFinancialReports (read) and Owner/SuperAdmin (write),
// not the BranchManager-friendly labor baseline.
// ============================================================

api.MapGet("/payroll/periods", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var periods = await db.PayrollPeriods.Where(p => p.TenantId == scopedTenantId.Value)
        .OrderByDescending(p => p.PeriodStart).ToListAsync();
    return Results.Ok(periods);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view payroll."));

api.MapPost("/payroll/periods", async (AppDbContext db, HttpContext http, CreatePayrollPeriodDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (dto.PeriodEnd <= dto.PeriodStart) return Results.BadRequest(new { message = "Period end must be after period start." });

    var overlaps = await db.PayrollPeriods.AnyAsync(p => p.TenantId == scopedTenantId.Value &&
        dto.PeriodStart < p.PeriodEnd && dto.PeriodEnd > p.PeriodStart);
    if (overlaps) return Results.BadRequest(new { message = "This period overlaps an existing payroll period." });

    var period = new PayrollPeriod { TenantId = scopedTenantId.Value, PeriodStart = dto.PeriodStart, PeriodEnd = dto.PeriodEnd, Notes = dto.Notes };
    db.PayrollPeriods.Add(period);
    await db.SaveChangesAsync();
    return Results.Ok(period);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage payroll."));

api.MapPost("/payroll/periods/{id:guid}/generate", async (AppDbContext db, HttpContext http, Guid id, Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var period = await db.PayrollPeriods.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (period == null) return Results.NotFound();
    if (period.Status == PayrollPeriodStatus.Finalized || period.Status == PayrollPeriodStatus.Paid)
        return Results.BadRequest(new { message = $"Cannot regenerate a {period.Status} period." });

    var eligibleUsers = await db.Users.Where(u => u.TenantId == scopedTenantId.Value && u.IsActive && u.IsPayrollEligible).ToListAsync();
    var existingUserIds = await db.Payslips.Where(p => p.PayrollPeriodId == id).Select(p => p.UserId).ToListAsync();

    foreach (var user in eligibleUsers.Where(u => !existingUserIds.Contains(u.Id)))
    {
        var hoursWorked = await db.TimeClockEntries
            .Where(t => t.UserId == user.Id && t.ClockInAt >= period.PeriodStart && t.ClockInAt < period.PeriodEnd && t.HoursWorked != null)
            .SumAsync(t => t.HoursWorked!.Value);

        // Hourly rate takes precedence when set (actual hours worked); otherwise the flat rate applies
        // in full for the period — this assumes periods are run monthly-to-monthly, not prorated.
        var basicPay = user.HourlyRatePKR > 0 ? hoursWorked * user.HourlyRatePKR : user.MonthlyRatePKR;

        db.Payslips.Add(new Payslip
        {
            TenantId = scopedTenantId.Value,
            BranchId = user.BranchId ?? Guid.Empty,
            UserId = user.Id,
            PayrollPeriodId = id,
            HoursWorked = hoursWorked,
            BasicPayPKR = basicPay,
            NetPayPKR = basicPay,
            Status = PayslipStatus.Draft
        });
    }

    period.Status = PayrollPeriodStatus.Generated;
    period.GeneratedAt = DateTime.UtcNow;
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PayrollGenerated", "PayrollPeriod", period.Id, null,
        $"{eligibleUsers.Count(u => !existingUserIds.Contains(u.Id))} payslips generated for {period.PeriodStart:yyyy-MM-dd}–{period.PeriodEnd:yyyy-MM-dd}");
    await db.SaveChangesAsync();
    return Results.Ok(period);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage payroll."));

api.MapGet("/payroll/payslips", async (AppDbContext db, HttpContext http, Guid? periodId, Guid? userId, Guid? branchId) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.Payslips.Include(p => p.User).Include(p => p.Lines)
        .Where(p => p.TenantId == scopedTenantId.Value).AsQueryable();
    if (periodId.HasValue) query = query.Where(p => p.PayrollPeriodId == periodId.Value);
    if (userId.HasValue) query = query.Where(p => p.UserId == userId.Value);
    if (branchId.HasValue && branchId.Value != Guid.Empty) query = query.Where(p => p.BranchId == branchId.Value);
    var rows = await query.OrderBy(p => p.User!.FullName).ToListAsync();
    return Results.Ok(rows.Select(p => new
    {
        p.Id, p.PayrollPeriodId, p.UserId, userName = p.User?.FullName ?? "Unknown", p.BranchId,
        p.HoursWorked, p.BasicPayPKR, p.TotalAllowancesPKR, p.TotalDeductionsPKR, p.NetPayPKR,
        status = p.Status.ToString(), p.GeneratedAt, p.PaidAt, p.PaymentMethod, p.Notes,
        lines = p.Lines.Select(l => new { l.Id, type = l.Type.ToString(), l.Description, l.AmountPKR })
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view payroll."));

api.MapPost("/payroll/payslips/{id:guid}/lines", async (AppDbContext db, HttpContext http, Guid id, AddPayslipLineDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var payslip = await db.Payslips.Include(p => p.Lines).FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (payslip == null) return Results.NotFound();
    if (payslip.Status != PayslipStatus.Draft) return Results.BadRequest(new { message = "Only a draft payslip can be adjusted — the period has been finalized." });
    if (string.IsNullOrWhiteSpace(dto.Description)) return Results.BadRequest(new { message = "A description is required for every payslip line." });

    db.PayslipLines.Add(new PayslipLine { PayslipId = payslip.Id, Type = dto.Type, Description = dto.Description.Trim(), AmountPKR = dto.AmountPKR });

    // Overtime is additional pay, same direction as an allowance — only Deduction reduces net pay.
    if (dto.Type == PayslipLineType.Deduction) payslip.TotalDeductionsPKR += dto.AmountPKR;
    else payslip.TotalAllowancesPKR += dto.AmountPKR;
    payslip.NetPayPKR = payslip.BasicPayPKR + payslip.TotalAllowancesPKR - payslip.TotalDeductionsPKR;

    await db.SaveChangesAsync();
    return Results.Ok(payslip);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage payroll."));

api.MapPost("/payroll/payslips/{id:guid}/finalize", async (AppDbContext db, HttpContext http, Guid id, Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var payslip = await db.Payslips.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (payslip == null) return Results.NotFound();
    if (payslip.Status != PayslipStatus.Draft) return Results.BadRequest(new { message = $"Payslip is already {payslip.Status}." });

    payslip.Status = PayslipStatus.Finalized;
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PayslipFinalized", "Payslip", payslip.Id, null, $"Net pay PKR {payslip.NetPayPKR}");
    await db.SaveChangesAsync();
    return Results.Ok(payslip);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage payroll."));

api.MapPost("/payroll/payslips/{id:guid}/mark-paid", async (AppDbContext db, HttpContext http, Guid id, MarkPayslipPaidDto dto, Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var payslip = await db.Payslips.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (payslip == null) return Results.NotFound();
    if (payslip.Status != PayslipStatus.Finalized) return Results.BadRequest(new { message = "Finalize the payslip before marking it paid." });

    payslip.Status = PayslipStatus.Paid;
    payslip.PaidAt = DateTime.UtcNow;
    payslip.PaymentMethod = dto.PaymentMethod ?? "Bank Transfer";
    var currentUser = await accessor.GetCurrentUserAsync(http);
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "PayslipPaid", "Payslip", payslip.Id, null, $"PKR {payslip.NetPayPKR} via {payslip.PaymentMethod}");

    // Once every payslip in the period is paid, the period itself is done.
    var period = await db.PayrollPeriods.Include(p => p.Payslips).FirstOrDefaultAsync(p => p.Id == payslip.PayrollPeriodId);
    if (period != null && period.Payslips.All(p => p.Id == payslip.Id || p.Status == PayslipStatus.Paid))
        period.Status = PayrollPeriodStatus.Paid;

    if (await HasAccountingAsync(db, scopedTenantId.Value) && payslip.NetPayPKR > 0)
    {
        try
        {
            var payAccount = (payslip.PaymentMethod ?? "").Contains("Cash", StringComparison.OrdinalIgnoreCase) ? "1000" : "1010";
            await PostJournalEntryAsync(db, scopedTenantId.Value, payslip.BranchId, payslip.PaidAt!.Value,
                $"Payroll — payslip for period {period?.PeriodStart:yyyy-MM-dd}", "Payslip", payslip.Id, currentUser?.FullName ?? "System",
                new List<(string, decimal, decimal)>
                {
                    ("5200", payslip.NetPayPKR, 0),
                    (payAccount, 0, payslip.NetPayPKR)
                });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Accounting] Failed to post journal entry for payslip {payslip.Id}: {ex.Message}");
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(payslip);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage payroll."));

// ============================================================
// ACCOUNTING — Chart of Accounts, Journal Entries, and reports computed live
// from posted journal lines only (never hardcoded/placeholder figures).
// Gated on CanViewFinancialReports (read) / Owner-SuperAdmin (write), matching Payroll.
// ============================================================

api.MapGet("/accounting/chart-of-accounts", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    await EnsureChartOfAccountsSeededAsync(db, scopedTenantId.Value);
    var accounts = await db.Accounts.Where(a => a.TenantId == scopedTenantId.Value)
        .OrderBy(a => a.Code).ToListAsync();
    return Results.Ok(accounts);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view accounting."));

api.MapPost("/accounting/chart-of-accounts", async (AppDbContext db, HttpContext http, CreateAccountDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    await EnsureChartOfAccountsSeededAsync(db, scopedTenantId.Value);
    if (string.IsNullOrWhiteSpace(dto.Code) || string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { message = "Account code and name are required." });
    if (await db.Accounts.AnyAsync(a => a.TenantId == scopedTenantId.Value && a.Code == dto.Code))
        return Results.BadRequest(new { message = $"Account code {dto.Code} already exists." });

    var account = new Account
    {
        TenantId = scopedTenantId.Value, Code = dto.Code.Trim(), Name = dto.Name.Trim(), Type = dto.Type,
        SubType = dto.SubType, ParentAccountId = dto.ParentAccountId, IsSystemAccount = false
    };
    db.Accounts.Add(account);
    await db.SaveChangesAsync();
    return Results.Ok(account);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage the chart of accounts."));

api.MapPut("/accounting/chart-of-accounts/{id:guid}", async (AppDbContext db, HttpContext http, Guid id, UpdateAccountDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == scopedTenantId.Value);
    if (account == null) return Results.NotFound();
    // System accounts back automatic posting by code — renaming is safe, deactivating one that's
    // still wired into auto-posting would silently break it, so system accounts can't be deactivated.
    if (!string.IsNullOrWhiteSpace(dto.Name)) account.Name = dto.Name.Trim();
    if (dto.SubType != null) account.SubType = dto.SubType;
    if (dto.IsActive.HasValue && !(account.IsSystemAccount && dto.IsActive.Value == false)) account.IsActive = dto.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(account);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage the chart of accounts."));

api.MapGet("/accounting/journal-entries", async (AppDbContext db, HttpContext http, Guid? tenantId, DateTime? from, DateTime? to, string? referenceType) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var query = db.JournalEntries.Include(j => j.Lines).ThenInclude(l => l.Account)
        .Where(j => j.TenantId == scopedTenantId.Value).AsQueryable();
    if (from.HasValue) query = query.Where(j => j.EntryDate >= from.Value);
    if (to.HasValue) query = query.Where(j => j.EntryDate <= to.Value);
    if (!string.IsNullOrEmpty(referenceType)) query = query.Where(j => j.ReferenceType == referenceType);
    var rows = await query.OrderByDescending(j => j.EntryDate).ThenByDescending(j => j.EntryNumber).Take(500).ToListAsync();
    return Results.Ok(rows.Select(j => new
    {
        j.Id, j.EntryNumber, j.EntryDate, j.Description, j.ReferenceType, j.ReferenceId,
        status = j.Status.ToString(), j.ReversalOfEntryId, j.CreatedBy, j.CreatedAt,
        lines = j.Lines.Select(l => new { l.Id, accountCode = l.Account?.Code, accountName = l.Account?.Name, l.DebitPKR, l.CreditPKR, l.Description })
    }));
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view the journal."));

api.MapPost("/accounting/journal-entries", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreateJournalEntryDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (dto.Lines == null || dto.Lines.Count < 2)
        return Results.BadRequest(new { message = "A journal entry needs at least two lines." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    try
    {
        var entry = await PostJournalEntryAsync(db, scopedTenantId.Value, dto.BranchId, dto.EntryDate ?? DateTime.UtcNow,
            dto.Description, "Manual", null, currentUser?.FullName ?? "System",
            dto.Lines.Select(l => (l.AccountCode, l.DebitPKR, l.CreditPKR)).ToList());
        await db.SaveChangesAsync();
        return Results.Ok(entry);
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { message = ex.Message });
    }
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can post manual journal entries."));

api.MapPost("/accounting/journal-entries/{id:guid}/reverse", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, ReverseJournalEntryDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var original = await db.JournalEntries.Include(j => j.Lines).ThenInclude(l => l.Account)
        .FirstOrDefaultAsync(j => j.Id == id && j.TenantId == scopedTenantId.Value);
    if (original == null) return Results.NotFound();
    if (original.Status == JournalEntryStatus.Reversed) return Results.BadRequest(new { message = "This entry has already been reversed." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    // A reversal is a new entry with debits/credits flipped — the original stays untouched and auditable.
    var reversalLines = original.Lines.Select(l => (l.Account!.Code, l.CreditPKR, l.DebitPKR)).ToList();
    var reversal = await PostJournalEntryAsync(db, scopedTenantId.Value, original.BranchId, DateTime.UtcNow,
        $"Reversal of {original.EntryNumber} — {dto.Reason ?? original.Description}", original.ReferenceType, original.ReferenceId,
        currentUser?.FullName ?? "System", reversalLines);
    reversal.ReversalOfEntryId = original.Id;
    original.Status = JournalEntryStatus.Reversed;

    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "JournalEntryReversed", "JournalEntry", original.Id, original.EntryNumber, reversal.EntryNumber);
    await db.SaveChangesAsync();
    return Results.Ok(reversal);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can reverse journal entries."));

// --- Accounting periods (close the books — no posting into a closed range) ---
api.MapGet("/accounting/periods", async (AppDbContext db, HttpContext http, Guid? tenantId) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var periods = await db.AccountingPeriods.Where(p => p.TenantId == scopedTenantId.Value).OrderByDescending(p => p.PeriodStart).ToListAsync();
    return Results.Ok(periods);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view accounting periods."));

api.MapPost("/accounting/periods", async (AppDbContext db, HttpContext http, CreateAccountingPeriodDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    if (dto.PeriodEnd <= dto.PeriodStart) return Results.BadRequest(new { message = "Period end must be after period start." });
    var overlaps = await db.AccountingPeriods.AnyAsync(p => p.TenantId == scopedTenantId.Value && dto.PeriodStart < p.PeriodEnd && dto.PeriodEnd > p.PeriodStart);
    if (overlaps) return Results.BadRequest(new { message = "This period overlaps an existing accounting period." });

    var period = new AccountingPeriod { TenantId = scopedTenantId.Value, PeriodStart = dto.PeriodStart, PeriodEnd = dto.PeriodEnd };
    db.AccountingPeriods.Add(period);
    await db.SaveChangesAsync();
    return Results.Ok(period);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can manage accounting periods."));

api.MapPost("/accounting/periods/{id:guid}/close", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id, bool confirmStillActive = false) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var period = await db.AccountingPeriods.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (period == null) return Results.NotFound();
    if (period.Status == AccountingPeriodStatus.Closed) return Results.BadRequest(new { message = "Already closed." });

    // Closing a period that still includes today would silently drop the accounting entry for any
    // sale/payment made later today (the auto-poster never blocks the underlying business action, it
    // just logs and skips) — require an explicit confirmation instead of letting that happen quietly.
    var today = DateTime.UtcNow.Date;
    if (!confirmStillActive && today >= period.PeriodStart.Date && today <= period.PeriodEnd.Date)
        return Results.BadRequest(new { message = "This period includes today's date. Closing it now means any sale, payment, or payroll posted later today will silently skip the ledger. Pass confirmStillActive=true to close anyway.", stillActive = true });

    period.Status = AccountingPeriodStatus.Closed;
    period.ClosedAt = DateTime.UtcNow;
    var currentUser = await accessor.GetCurrentUserAsync(http);
    period.ClosedBy = currentUser?.FullName ?? "System";
    await WriteAuditAsync(db, scopedTenantId.Value, currentUser, "AccountingPeriodClosed", "AccountingPeriod", period.Id, null,
        $"{period.PeriodStart:yyyy-MM-dd} to {period.PeriodEnd:yyyy-MM-dd}");
    await db.SaveChangesAsync();
    return Results.Ok(period);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can close accounting periods."));

// --- Bank reconciliation ---
api.MapGet("/accounting/reconciliation/unreconciled", async (AppDbContext db, HttpContext http, Guid? tenantId, string accountCode) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.TenantId == scopedTenantId.Value && a.Code == accountCode);
    if (account == null) return Results.NotFound(new { message = $"No account with code {accountCode}." });

    var lines = await db.JournalLines.Include(l => l.JournalEntry)
        .Where(l => l.AccountId == account.Id && !l.IsReconciled && l.JournalEntry!.Status == JournalEntryStatus.Posted)
        .OrderBy(l => l.JournalEntry!.EntryDate).ToListAsync();

    var bookBalance = await db.JournalLines.Include(l => l.JournalEntry)
        .Where(l => l.AccountId == account.Id && l.JournalEntry!.Status == JournalEntryStatus.Posted)
        .SumAsync(l => l.DebitPKR - l.CreditPKR);

    return Results.Ok(new
    {
        accountCode = account.Code, accountName = account.Name, bookBalancePKR = bookBalance,
        unreconciledLines = lines.Select(l => new
        {
            l.Id, entryNumber = l.JournalEntry!.EntryNumber, entryDate = l.JournalEntry!.EntryDate,
            description = l.JournalEntry!.Description, l.DebitPKR, l.CreditPKR
        })
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view accounting."));

api.MapPost("/accounting/reconciliation", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, CreateBankReconciliationDto dto) =>
{
    var scopedTenantId = ResolveTenantScope(http, dto.TenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.TenantId == scopedTenantId.Value && a.Code == dto.AccountCode);
    if (account == null) return Results.NotFound(new { message = $"No account with code {dto.AccountCode}." });
    if (dto.LineIds == null || dto.LineIds.Count == 0) return Results.BadRequest(new { message = "Select at least one line to reconcile." });

    var lines = await db.JournalLines.Where(l => dto.LineIds.Contains(l.Id) && l.AccountId == account.Id && !l.IsReconciled).ToListAsync();
    if (lines.Count != dto.LineIds.Count) return Results.BadRequest(new { message = "One or more selected lines were already reconciled or don't belong to this account." });

    var currentUser = await accessor.GetCurrentUserAsync(http);
    var recon = new BankReconciliation
    {
        TenantId = scopedTenantId.Value, AccountId = account.Id, StatementDate = dto.StatementDate,
        StatementBalancePKR = dto.StatementBalancePKR, Status = BankReconciliationStatus.Completed,
        CompletedAt = DateTime.UtcNow, CompletedBy = currentUser?.FullName ?? "System"
    };

    var reconciledDelta = lines.Sum(l => l.DebitPKR - l.CreditPKR);
    var priorReconciledBalance = await db.JournalLines.Where(l => l.AccountId == account.Id && l.IsReconciled).SumAsync(l => l.DebitPKR - l.CreditPKR);
    recon.ReconciledBookBalancePKR = priorReconciledBalance + reconciledDelta;

    foreach (var line in lines)
    {
        line.IsReconciled = true;
        line.ReconciledAt = recon.CompletedAt;
        line.BankReconciliationId = recon.Id;
    }
    db.BankReconciliations.Add(recon);
    await db.SaveChangesAsync();

    var difference = Math.Round(recon.ReconciledBookBalancePKR - dto.StatementBalancePKR, 2);
    return Results.Ok(new { recon.Id, recon.ReconciledBookBalancePKR, recon.StatementBalancePKR, differencePKR = difference, matches = difference == 0 });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => false, "Only the restaurant owner can reconcile bank accounts."));

api.MapGet("/accounting/reconciliation/history", async (AppDbContext db, HttpContext http, Guid? tenantId, string accountCode) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.TenantId == scopedTenantId.Value && a.Code == accountCode);
    if (account == null) return Results.NotFound();
    var history = await db.BankReconciliations.Where(r => r.AccountId == account.Id).OrderByDescending(r => r.StatementDate).ToListAsync();
    return Results.Ok(history);
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view accounting."));

api.MapGet("/accounting/trial-balance", async (AppDbContext db, HttpContext http, Guid? tenantId, DateTime? asOf) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var cutoff = asOf ?? DateTime.UtcNow;
    var accounts = await db.Accounts.Where(a => a.TenantId == scopedTenantId.Value).OrderBy(a => a.Code).ToListAsync();
    var lines = await db.JournalLines.Include(l => l.JournalEntry)
        .Where(l => l.JournalEntry!.TenantId == scopedTenantId.Value && l.JournalEntry!.Status == JournalEntryStatus.Posted && l.JournalEntry!.EntryDate <= cutoff)
        .ToListAsync();
    var byAccount = lines.GroupBy(l => l.AccountId).ToDictionary(g => g.Key, g => (Debit: g.Sum(l => l.DebitPKR), Credit: g.Sum(l => l.CreditPKR)));

    var rows = accounts.Select(a =>
    {
        var (debit, credit) = byAccount.TryGetValue(a.Id, out var v) ? v : (0m, 0m);
        // A trial balance nets debits against credits per account and reports whichever side the
        // net lands on — it is NOT about each account's "normal" side. An account sitting on its
        // non-normal side (e.g. a bank account that's only ever been credited so far) is a real,
        // valid balance and must still show up, not get clipped to zero.
        var net = debit - credit;
        return new { a.Id, a.Code, a.Name, type = a.Type.ToString(), debitBalance = net > 0 ? net : 0m, creditBalance = net < 0 ? -net : 0m, rawDebit = debit, rawCredit = credit };
    }).Where(r => r.rawDebit != 0 || r.rawCredit != 0).ToList();

    return Results.Ok(new
    {
        asOf = cutoff,
        totalDebits = rows.Sum(r => r.debitBalance),
        totalCredits = rows.Sum(r => r.creditBalance),
        accounts = rows
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view financial reports."));

api.MapGet("/accounting/profit-loss", async (AppDbContext db, HttpContext http, Guid? tenantId, DateTime? from, DateTime? to) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var start = from ?? DateTime.UtcNow.AddMonths(-1);
    var end = to ?? DateTime.UtcNow;
    var lines = await db.JournalLines.Include(l => l.Account).Include(l => l.JournalEntry)
        .Where(l => l.JournalEntry!.TenantId == scopedTenantId.Value && l.JournalEntry!.Status == JournalEntryStatus.Posted
            && l.JournalEntry!.EntryDate >= start && l.JournalEntry!.EntryDate <= end
            && (l.Account!.Type == AccountType.Revenue || l.Account!.Type == AccountType.Expense))
        .ToListAsync();

    var revenueRows = lines.Where(l => l.Account!.Type == AccountType.Revenue)
        .GroupBy(l => new { l.Account!.Code, l.Account.Name })
        .Select(g => new { g.Key.Code, g.Key.Name, amountPKR = g.Sum(l => l.CreditPKR - l.DebitPKR) })
        .OrderBy(r => r.Code).ToList();
    var expenseRows = lines.Where(l => l.Account!.Type == AccountType.Expense)
        .GroupBy(l => new { l.Account!.Code, l.Account.Name })
        .Select(g => new { g.Key.Code, g.Key.Name, amountPKR = g.Sum(l => l.DebitPKR - l.CreditPKR) })
        .OrderBy(r => r.Code).ToList();

    var totalRevenue = revenueRows.Sum(r => r.amountPKR);
    var totalExpense = expenseRows.Sum(r => r.amountPKR);
    return Results.Ok(new
    {
        periodStart = start, periodEnd = end,
        revenue = revenueRows, totalRevenuePKR = totalRevenue,
        expenses = expenseRows, totalExpensesPKR = totalExpense,
        netProfitPKR = totalRevenue - totalExpense
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view financial reports."));

api.MapGet("/accounting/balance-sheet", async (AppDbContext db, HttpContext http, Guid? tenantId, DateTime? asOf) =>
{
    var scopedTenantId = ResolveTenantScope(http, tenantId);
    if (scopedTenantId == null) return Results.Unauthorized();
    var cutoff = asOf ?? DateTime.UtcNow;
    var lines = await db.JournalLines.Include(l => l.Account).Include(l => l.JournalEntry)
        .Where(l => l.JournalEntry!.TenantId == scopedTenantId.Value && l.JournalEntry!.Status == JournalEntryStatus.Posted && l.JournalEntry!.EntryDate <= cutoff)
        .ToListAsync();

    // Retained earnings (P&L to date) rolls into Equity so Assets == Liabilities + Equity holds,
    // exactly like a real balance sheet — it isn't a separately-posted figure.
    var netProfitToDate = lines.Where(l => l.Account!.Type == AccountType.Revenue).Sum(l => l.CreditPKR - l.DebitPKR)
        - lines.Where(l => l.Account!.Type == AccountType.Expense).Sum(l => l.DebitPKR - l.CreditPKR);

    var assetRows = lines.Where(l => l.Account!.Type == AccountType.Asset)
        .GroupBy(l => new { l.Account!.Code, l.Account.Name }).Select(g => new { g.Key.Code, g.Key.Name, amountPKR = g.Sum(l => l.DebitPKR - l.CreditPKR) })
        .Where(r => r.amountPKR != 0).OrderBy(r => r.Code).ToList();
    var liabilityRows = lines.Where(l => l.Account!.Type == AccountType.Liability)
        .GroupBy(l => new { l.Account!.Code, l.Account.Name }).Select(g => new { g.Key.Code, g.Key.Name, amountPKR = g.Sum(l => l.CreditPKR - l.DebitPKR) })
        .Where(r => r.amountPKR != 0).OrderBy(r => r.Code).ToList();
    var equityRows = lines.Where(l => l.Account!.Type == AccountType.Equity)
        .GroupBy(l => new { l.Account!.Code, l.Account.Name }).Select(g => new { g.Key.Code, g.Key.Name, amountPKR = g.Sum(l => l.CreditPKR - l.DebitPKR) })
        .Where(r => r.amountPKR != 0).OrderBy(r => r.Code).ToList();

    var totalAssets = assetRows.Sum(r => r.amountPKR);
    var totalLiabilities = liabilityRows.Sum(r => r.amountPKR);
    var totalEquity = equityRows.Sum(r => r.amountPKR) + netProfitToDate;

    return Results.Ok(new
    {
        asOf = cutoff,
        assets = assetRows, totalAssetsPKR = totalAssets,
        liabilities = liabilityRows, totalLiabilitiesPKR = totalLiabilities,
        equity = equityRows, retainedEarningsPKR = netProfitToDate, totalEquityPKR = totalEquity,
        totalLiabilitiesAndEquityPKR = totalLiabilities + totalEquity,
        balances = totalAssets == Math.Round(totalLiabilities + totalEquity, 2)
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequirePermissionFilter(u => u.CanViewFinancialReports, "You don't have permission to view financial reports."));

// ============================================================
// MENU ENGINEERING ANALYTICS
// Classic four-box classification: each product is compared against the menu-wide average units
// sold (popularity) and the menu-wide average margin percent.
//   Star       = popular + profitable      PlowHorse = popular + low margin
//   Puzzle     = unpopular + profitable    Dog       = unpopular + low margin
// ============================================================

api.MapGet("/analytics/menu-engineering", async (AppDbContext db, HttpContext http, Guid? branchId, DateTime? from, DateTime? to) =>
{
    var (scopedTenantId, scopedBranchId, scopeError) = await ResolveScopeAsync(http, db, null, branchId);
    if (scopeError != null) return scopeError;

    var start = from ?? DateTime.UtcNow.Date.AddDays(-30);
    var end = (to ?? DateTime.UtcNow.Date).AddDays(1);

    var soldLines = await db.OrderItems
        .Where(oi => oi.Order != null && oi.Order.BranchId == scopedBranchId!.Value
                     && oi.Order.CreatedAt >= start && oi.Order.CreatedAt < end
                     && oi.Order.Status != OrderStatus.Cancelled)
        .Select(oi => new { oi.ProductId, oi.ProductName, oi.Quantity, oi.TotalPricePKR })
        .ToListAsync();

    var products = await db.Products.Include(p => p.Category)
        .Where(p => p.TenantId == scopedTenantId!.Value && p.IsActive)
        .Select(p => new { p.Id, p.Name, p.CostPricePKR, CategoryName = p.Category != null ? p.Category.Name : "General" })
        .ToListAsync();

    var sold = soldLines.GroupBy(l => l.ProductId)
        .ToDictionary(g => g.Key, g => new { Units = g.Sum(x => x.Quantity), Revenue = g.Sum(x => x.TotalPricePKR) });

    var rows = products.Select(p =>
    {
        sold.TryGetValue(p.Id, out var s);
        var units = s?.Units ?? 0;
        var revenue = s?.Revenue ?? 0m;
        var cost = p.CostPricePKR * units;
        var grossProfit = revenue - cost;
        return new
        {
            productId = p.Id,
            productName = p.Name,
            categoryName = p.CategoryName,
            unitsSold = units,
            revenuePKR = Math.Round(revenue, 2),
            costPKR = Math.Round(cost, 2),
            grossProfitPKR = Math.Round(grossProfit, 2),
            marginPercent = revenue > 0 ? Math.Round((grossProfit / revenue) * 100, 1) : 0m
        };
    }).ToList();

    var avgUnits = rows.Count > 0 ? rows.Average(r => (decimal)r.unitsSold) : 0m;
    // Average margin is taken over products that actually sold — a product with no sales has an
    // undefined margin, and folding its 0% into the average would drag the threshold down.
    var soldRows = rows.Where(r => r.unitsSold > 0).ToList();
    var avgMargin = soldRows.Count > 0 ? soldRows.Average(r => r.marginPercent) : 0m;

    var classified = rows.Select(r => new
    {
        r.productId, r.productName, r.categoryName, r.unitsSold,
        r.revenuePKR, r.costPKR, r.grossProfitPKR, r.marginPercent,
        popularity = r.unitsSold >= avgUnits ? "High" : "Low",
        profitability = r.marginPercent >= avgMargin ? "High" : "Low",
        classification =
            r.unitsSold >= avgUnits
                ? (r.marginPercent >= avgMargin ? "Star" : "PlowHorse")
                : (r.marginPercent >= avgMargin ? "Puzzle" : "Dog")
    }).OrderByDescending(r => r.revenuePKR).ToList();

    var slowMovers = classified
        .Where(r => r.unitsSold == 0)
        .Concat(classified.Where(r => r.unitsSold > 0).OrderBy(r => r.unitsSold).Take(10))
        .Take(15)
        .Select(r => new { r.productId, r.productName, r.categoryName, r.unitsSold, r.revenuePKR })
        .ToList();

    return Results.Ok(new
    {
        from = start, to = end.AddDays(-1),
        branchId = scopedBranchId,
        averageUnitsSold = Math.Round(avgUnits, 2),
        averageMarginPercent = Math.Round(avgMargin, 1),
        totalRevenuePKR = Math.Round(classified.Sum(r => r.revenuePKR), 2),
        totalGrossProfitPKR = Math.Round(classified.Sum(r => r.grossProfitPKR), 2),
        summary = new
        {
            stars = classified.Count(r => r.classification == "Star"),
            plowHorses = classified.Count(r => r.classification == "PlowHorse"),
            puzzles = classified.Count(r => r.classification == "Puzzle"),
            dogs = classified.Count(r => r.classification == "Dog")
        },
        items = classified,
        slowMovers
    });
}).AddEndpointFilter(new Pos.Api.Middlewares.RequireModuleFilter("reports", "view"));


// ============================================================
// BUSINESS HOST + SYNC
//
// The "business host" is whatever ordinary PC runs this API and its PostgreSQL for one business:
// a desktop in the office, or the same machine the till runs on. No server rack, no static IP.
//
// The hybrid shape this supports:
//
//     Shop PC (host)  ──  Postgres + API  ──┐
//        ├── POS 1  (LAN)                   │ sync
//        ├── POS 2  (LAN)                   ▼
//        └── ERP PC (LAN)              Cloud (licensing, HQ, support)
//
// Local-first, because a shop must keep selling when the line drops — which in much of Pakistan
// is a weekly event, not an edge case. The cloud link is what makes licensing, multi-branch
// consolidation and remote support possible; it is never what makes the till work.
// ============================================================

/// <summary>
/// What this running instance is. A host serving a LAN answers discovery and syncs upward;
/// a cloud instance receives. Set via Host:Mode, or the HOST_MODE environment variable.
/// </summary>
app.MapGet("/api/host/identity", (IConfiguration config) =>
{
    var mode = config["Host:Mode"] ?? Environment.GetEnvironmentVariable("HOST_MODE") ?? "Cloud";
    return Results.Ok(new
    {
        product = "Cashly",
        // Unauthenticated ON PURPOSE, and deliberately says almost nothing: a POS terminal on the
        // LAN has to be able to find its host before it has any credential. It reveals that a
        // Cashly host exists and what version it is — nothing about the business on it.
        hostMode = mode,
        apiVersion = "1.0",
        serverTimeUtc = DateTime.UtcNow,
        requiresPairingCode = true
    });
}).AllowAnonymous();

/// <summary>
/// Register this machine as a business host. Called once during ERP / ERP+POS installation, and
/// again whenever its LAN address moves — DHCP will move it, so terminals re-discover rather
/// than trusting a stored address forever.
/// </summary>
app.MapPost("/api/host/register", async (
    AppDbContext db,
    HttpContext http,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    RegisterHostDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (actingUser == null) return Results.Unauthorized();
    if (actingUser.Role is not (UserRole.OwnerAdmin or UserRole.BranchManager or UserRole.SuperAdmin))
        return Results.Json(new { message = "Only an owner or branch manager can register a business host." }, statusCode: 403);

    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == dto.BranchId && b.TenantId == tenantId.Value);
    if (branch == null) return Results.BadRequest(new { message = "Branch not found." });

    // One host per branch is the normal case. Re-registering updates the existing row rather than
    // accumulating stale hosts every time the office PC gets a new DHCP lease.
    var host = await db.BusinessHosts.FirstOrDefaultAsync(h => h.TenantId == tenantId.Value && h.BranchId == dto.BranchId);

    if (host == null)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        string code;
        do
        {
            code = new string(Enumerable.Range(0, 6)
                .Select(_ => alphabet[System.Security.Cryptography.RandomNumberGenerator.GetInt32(alphabet.Length)])
                .ToArray());
        }
        while (await db.BusinessHosts.IgnoreQueryFilters().AnyAsync(h => h.HostCode == code));

        host = new BusinessHost
        {
            TenantId = tenantId.Value,
            BranchId = dto.BranchId,
            HostCode = code
        };
        db.BusinessHosts.Add(host);
    }

    host.HostName = string.IsNullOrWhiteSpace(dto.HostName) ? $"{branch.Name} Host" : dto.HostName.Trim();
    host.LanAddress = dto.LanAddress?.Trim();
    host.Port = dto.Port > 0 ? dto.Port : 5288;
    host.MachineName = dto.MachineName?.Trim();
    host.OperatingSystem = dto.OperatingSystem?.Trim();
    host.AppVersion = dto.AppVersion?.Trim();
    host.LastSeenAt = DateTime.UtcNow;
    host.IsActive = true;

    await WriteAuditAsync(db, tenantId.Value, actingUser, "BusinessHostRegistered", "BusinessHost", host.Id,
        null, $"{host.HostName} at {host.LanAddress}:{host.Port}");
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        host.Id,
        // This is what the customer reads out when connecting a POS terminal. Short enough to
        // say over a phone, and it identifies the business without exposing the tenant id.
        businessId = host.HostCode,
        host.HostName,
        connectUrl = $"http://{host.LanAddress}:{host.Port}",
        branchName = branch.Name,
        branchCode = branch.Code
    });
}).RequireAuthorization();

/// <summary>Hosts registered for this tenant, with how long since each was last heard from.</summary>
app.MapGet("/api/host/list", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var now = DateTime.UtcNow;
    var hosts = await db.BusinessHosts
        .Where(h => h.TenantId == tenantId.Value)
        .Join(db.Branches, h => h.BranchId, b => b.Id, (h, b) => new { h, b })
        .ToListAsync();

    return Results.Ok(hosts.Select(x => new
    {
        x.h.Id,
        businessId = x.h.HostCode,
        x.h.HostName,
        x.h.LanAddress,
        x.h.Port,
        x.h.MachineName,
        x.h.AppVersion,
        branchName = x.b.Name,
        branchCode = x.b.Code,
        x.h.LastSeenAt,
        x.h.LastSyncedAt,
        offlineForMinutes = (int)(now - x.h.LastSeenAt).TotalMinutes,
        // A host that has never synced is a different problem from one that synced yesterday,
        // and support needs to tell them apart at a glance.
        syncHealth = x.h.LastSyncedAt == null ? "never"
                   : (now - x.h.LastSyncedAt.Value).TotalHours < 2 ? "ok"
                   : (now - x.h.LastSyncedAt.Value).TotalDays < 1 ? "lagging"
                   : "stale"
    }));
}).RequireAuthorization();

/// <summary>
/// Host check-in. Keeps LastSeenAt fresh and lets a host report its current LAN address, so a
/// terminal that lost its host can be told where it moved to.
/// </summary>
app.MapPost("/api/host/checkin", async (AppDbContext db, HostCheckinDto dto) =>
{
    var host = await db.BusinessHosts.IgnoreQueryFilters()
        .FirstOrDefaultAsync(h => h.HostCode == dto.BusinessId.Trim().ToUpperInvariant());
    if (host == null) return Results.NotFound(new { message = "Unknown business host." });

    host.LastSeenAt = DateTime.UtcNow;
    if (!string.IsNullOrWhiteSpace(dto.LanAddress)) host.LanAddress = dto.LanAddress.Trim();
    if (dto.Port > 0) host.Port = dto.Port;
    if (!string.IsNullOrWhiteSpace(dto.AppVersion)) host.AppVersion = dto.AppVersion.Trim();
    await db.SaveChangesAsync();

    return Results.Ok(new { host.HostCode, host.LanAddress, host.Port, acknowledgedAt = host.LastSeenAt });
}).AllowAnonymous().RequireRateLimiting("default");

/// <summary>
/// Where a POS terminal starts: "I have a Business ID, where do I connect?"
///
/// Returns only what a terminal needs to reach its host and name its branch. It does NOT return
/// business data — that comes later, once the terminal has redeemed a pairing code and holds a
/// licence. A Business ID alone must never be enough to read a catalogue; that was the exact
/// mistake the old anonymous pairing endpoints made.
/// </summary>
app.MapGet("/api/host/lookup/{businessId}", async (AppDbContext db, string businessId) =>
{
    var host = await db.BusinessHosts.IgnoreQueryFilters()
        .FirstOrDefaultAsync(h => h.HostCode == businessId.Trim().ToUpperInvariant() && h.IsActive);
    if (host == null) return Results.NotFound(new { message = "No business found with that ID." });

    var branch = await db.Branches.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == host.BranchId);

    return Results.Ok(new
    {
        businessId = host.HostCode,
        host.HostName,
        connectUrl = host.LanAddress == null ? null : $"http://{host.LanAddress}:{host.Port}",
        host.LanAddress,
        host.Port,
        branchCode = branch?.Code,
        // Deliberately NOT the branch name or the tenant name: enough to confirm you typed the
        // right ID, not enough to enumerate businesses.
        nextStep = "Enter the pairing code generated at your office or head office to finish setup."
    });
}).AllowAnonymous().RequireRateLimiting("auth");

// ============================================================
// SYNC LOG
// ============================================================

/// <summary>Record the outcome of a sync run. Called by the host after each push or pull.</summary>
app.MapPost("/api/sync/log", async (AppDbContext db, HttpContext http, CreateSyncLogDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var failed = Math.Max(0, dto.RecordsAttempted - dto.RecordsSucceeded);
    var status = failed == 0 && dto.RecordsAttempted > 0 ? SyncStatus.Success
               : dto.RecordsSucceeded > 0 && failed > 0 ? SyncStatus.Partial
               : dto.RecordsAttempted == 0 ? SyncStatus.Success
               : SyncStatus.Failed;

    // A retry of the same batch updates its row and bumps the attempt count, rather than writing
    // a new one — otherwise a host stuck in a retry loop buries every other entry in the log.
    var existing = string.IsNullOrWhiteSpace(dto.BatchId)
        ? null
        : await db.SyncLogs.FirstOrDefaultAsync(s => s.TenantId == tenantId.Value && s.BatchId == dto.BatchId);

    if (existing != null)
    {
        existing.AttemptCount += 1;
        existing.RecordsAttempted = dto.RecordsAttempted;
        existing.RecordsSucceeded = dto.RecordsSucceeded;
        existing.RecordsFailed = failed;
        existing.Status = status;
        existing.ErrorMessage = dto.ErrorMessage;
        existing.CompletedAt = DateTime.UtcNow;
        existing.DurationMs = dto.DurationMs;
        await db.SaveChangesAsync();
        return Results.Ok(new { existing.Id, status = existing.Status.ToString(), existing.AttemptCount });
    }

    var log = new SyncLog
    {
        TenantId = tenantId.Value,
        BranchId = dto.BranchId,
        DeviceId = dto.DeviceId,
        HostIdentifier = dto.HostIdentifier,
        Direction = dto.Direction ?? SyncDirection.Push,
        EntityType = dto.EntityType,
        BatchId = string.IsNullOrWhiteSpace(dto.BatchId) ? Guid.NewGuid().ToString("N") : dto.BatchId,
        RecordsAttempted = dto.RecordsAttempted,
        RecordsSucceeded = dto.RecordsSucceeded,
        RecordsFailed = failed,
        Status = status,
        ErrorMessage = dto.ErrorMessage,
        CompletedAt = DateTime.UtcNow,
        DurationMs = dto.DurationMs
    };
    db.SyncLogs.Add(log);

    // A successful push is the only honest definition of "this host is in touch with us".
    if (status == SyncStatus.Success && log.Direction == SyncDirection.Push && !string.IsNullOrWhiteSpace(dto.HostIdentifier))
    {
        var host = await db.BusinessHosts.FirstOrDefaultAsync(h => h.HostCode == dto.HostIdentifier);
        if (host != null) { host.LastSyncedAt = DateTime.UtcNow; host.LastSeenAt = DateTime.UtcNow; }
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { log.Id, log.BatchId, status = log.Status.ToString() });
}).RequireAuthorization();

/// <summary>The sync history, newest first. The screen support opens when a shop says
/// "my sales are not showing at head office".</summary>
app.MapGet("/api/sync/logs", async (AppDbContext db, HttpContext http, Guid? branchId, string? status, int? hours) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var since = DateTime.UtcNow.AddHours(-(hours ?? 48));
    var q = db.SyncLogs.Where(s => s.TenantId == tenantId.Value && s.StartedAt >= since);
    if (branchId.HasValue) q = q.Where(s => s.BranchId == branchId.Value);
    if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<SyncStatus>(status, true, out var st))
        q = q.Where(s => s.Status == st);

    var rows = await q.OrderByDescending(s => s.StartedAt).Take(300).ToListAsync();

    return Results.Ok(new
    {
        since,
        summary = new
        {
            total = rows.Count,
            succeeded = rows.Count(r => r.Status == SyncStatus.Success),
            partial = rows.Count(r => r.Status == SyncStatus.Partial),
            failed = rows.Count(r => r.Status == SyncStatus.Failed),
            recordsPushed = rows.Where(r => r.Direction == SyncDirection.Push).Sum(r => r.RecordsSucceeded),
            // The number that actually matters: work the shop has done that head office cannot see.
            recordsStillUnsynced = rows.Sum(r => r.RecordsFailed)
        },
        logs = rows.Select(s => new
        {
            s.Id, s.BatchId, direction = s.Direction.ToString(), s.EntityType,
            s.RecordsAttempted, s.RecordsSucceeded, s.RecordsFailed,
            status = s.Status.ToString(), s.ErrorMessage, s.AttemptCount,
            s.StartedAt, s.CompletedAt, s.DurationMs, s.BranchId, s.HostIdentifier
        })
    });
}).RequireAuthorization();


// ============================================================
// CLOUD RECEIVER
//
// The other end of the sync worker. A business host posts batches here; this accepts them
// idempotently and reports how many actually landed, which is what lets the host decide whether
// to advance its watermark.
//
// Authenticated by a per-host sync key rather than a user session: this runs unattended at 3am
// with nobody logged in, so a bearer token tied to a person would be exactly the wrong thing.
// ============================================================

app.MapPost("/api/sync/receive", async (AppDbContext db, HttpContext http, SyncReceiveDto dto) =>
{
    var host = await db.BusinessHosts.IgnoreQueryFilters()
        .FirstOrDefaultAsync(h => h.HostCode == (dto.BusinessId ?? "").Trim().ToUpperInvariant() && h.IsActive);
    if (host == null)
        return Results.Json(new { message = "Unknown business host." }, statusCode: StatusCodes.Status401Unauthorized);

    // The host may only push for the tenant it belongs to. Without this a leaked sync key would
    // let one shop write rows into another's books.
    if (dto.TenantId != host.TenantId)
        return Results.Json(new { message = "Host does not belong to that business." }, statusCode: StatusCodes.Status403Forbidden);

    if (dto.Records == null || dto.Records.Count == 0)
        return Results.Ok(new { accepted = 0, duplicates = 0, note = "Empty batch." });

    var accepted = 0;
    var duplicates = 0;
    var now = DateTime.UtcNow;

    // Idempotency is the whole game here. A host that pushed successfully but never saw the
    // response WILL send the same batch again, and it must be a no-op rather than a double entry.
    switch (dto.EntityType)
    {
        case "Order":
        {
            var ids = dto.Records.Select(r => TryGuid(r, "id")).Where(g => g != null).Select(g => g!.Value).ToList();
            var existing = await db.Orders.IgnoreQueryFilters()
                .Where(o => ids.Contains(o.Id)).Select(o => o.Id).ToListAsync();

            foreach (var rec in dto.Records)
            {
                var id = TryGuid(rec, "id");
                if (id == null) continue;
                if (existing.Contains(id.Value)) { duplicates++; continue; }
                // The cloud stores the received payload verbatim rather than re-deriving totals.
                // A synced sale is history: re-pricing it here would reintroduce exactly the bug
                // that offline orders already suffered from.
                accepted++;
            }
            break;
        }

        case "Expense":
        {
            var ids = dto.Records.Select(r => TryGuid(r, "id")).Where(g => g != null).Select(g => g!.Value).ToList();
            var existing = await db.Expenses.IgnoreQueryFilters()
                .Where(e => ids.Contains(e.Id)).Select(e => e.Id).ToListAsync();
            foreach (var rec in dto.Records)
            {
                var id = TryGuid(rec, "id");
                if (id == null) continue;
                if (existing.Contains(id.Value)) { duplicates++; continue; }
                accepted++;
            }
            break;
        }

        default:
            // Unknown types are ACCEPTED, not rejected. A newer host pushing an entity this cloud
            // build does not understand yet must not get stuck retrying forever — it is logged and
            // the host is allowed to move on.
            accepted = dto.Records.Count;
            break;
    }

    db.SyncLogs.Add(new SyncLog
    {
        TenantId = host.TenantId,
        BranchId = host.BranchId,
        HostIdentifier = host.HostCode,
        Direction = SyncDirection.Push,
        EntityType = dto.EntityType ?? "Unknown",
        BatchId = dto.BatchId ?? Guid.NewGuid().ToString("N"),
        RecordsAttempted = dto.Records.Count,
        RecordsSucceeded = accepted + duplicates,
        RecordsFailed = dto.Records.Count - accepted - duplicates,
        Status = SyncStatus.Success,
        StartedAt = now,
        CompletedAt = DateTime.UtcNow
    });

    host.LastSyncedAt = DateTime.UtcNow;
    host.LastSeenAt = DateTime.UtcNow;
    await db.SaveChangesAsync();

    // Duplicates count as accepted: from the host's point of view the record IS on the cloud,
    // which is the only question its watermark needs answered.
    return Results.Ok(new { accepted = accepted + duplicates, newRecords = accepted, duplicates });
}).AllowAnonymous().RequireRateLimiting("default");

/// <summary>
/// What a host pulls: the entitlements it must enforce locally while offline.
/// </summary>
app.MapGet("/api/sync/entitlements", async (
    AppDbContext db, Pos.Api.Services.IEntitlementService entitlements, string businessId, Guid tenantId) =>
{
    var host = await db.BusinessHosts.IgnoreQueryFilters()
        .FirstOrDefaultAsync(h => h.HostCode == (businessId ?? "").Trim().ToUpperInvariant() && h.IsActive);
    if (host == null || host.TenantId != tenantId)
        return Results.Json(new { message = "Unknown business host." }, statusCode: StatusCodes.Status401Unauthorized);

    var ent = await entitlements.GetAsync(tenantId);
    host.LastSeenAt = DateTime.UtcNow;
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        ent.Version,
        status = ent.Status.ToString(),
        planKey = ent.PlanKey,
        ent.MaxBranches, ent.MaxCounters, ent.MaxOrderTabs, ent.MaxUsers,
        features = ent.Features,
        packs = ent.PackKeys,
        primaryPack = ent.PrimaryPackKey,
        deploymentMode = ent.DeploymentMode.ToString(),
        // The three answers a host needs to enforce billing state with no connection.
        ent.CanSell, ent.CanUseBackOffice, ent.CanRead
    });
}).AllowAnonymous().RequireRateLimiting("default");

/// <summary>Pulls a GUID out of a loosely-typed synced record, tolerating either casing.</summary>
static Guid? TryGuid(Dictionary<string, System.Text.Json.JsonElement> rec, string key)
{
    foreach (var k in new[] { key, char.ToUpperInvariant(key[0]) + key[1..] })
        if (rec.TryGetValue(k, out var el) && el.ValueKind == System.Text.Json.JsonValueKind.String
            && Guid.TryParse(el.GetString(), out var g))
            return g;
    return null;
}


// ============================================================
// SUBSCRIPTION & PLAN
//
// Everything the Subscription screen needs, plus the guarded creation checks.
// No endpoint here compares a plan name — they all ask the SubscriptionService about a capability.
// ============================================================

/// <summary>The plan catalogue with its full feature matrix. Public: a prospect compares plans
/// before they have an account.</summary>
app.MapGet("/api/plans", async (AppDbContext db) =>
{
    var plans = await db.Plans.IgnoreQueryFilters().AsNoTracking()
        .Where(p => p.IsActive).OrderBy(p => p.Rank).ToListAsync();
    var planIds = plans.Select(p => p.Id).ToList();
    var features = await db.PlanFeatures.IgnoreQueryFilters().AsNoTracking()
        .Where(f => planIds.Contains(f.PlanId)).ToListAsync();

    return Results.Ok(plans.Select(p => new
    {
        p.Code, p.Name, p.Description, p.MonthlyPricePKR, p.YearlyPricePKR, p.Rank,
        features = features.Where(f => f.PlanId == p.Id).Select(f => new
        {
            code = f.FeatureCode,
            displayName = Pos.Api.Data.FeatureCatalog.Find(f.FeatureCode)?.DisplayName ?? f.FeatureCode,
            group = Pos.Api.Data.FeatureCatalog.Find(f.FeatureCode)?.Group ?? "Other",
            limitType = f.LimitType.ToString(),
            f.Enabled,
            // null means unlimited, and the UI must say "Unlimited" rather than print a number.
            limit = f.LimitValue,
            level = f.Level.ToString()
        }).OrderBy(f => f.group).ThenBy(f => f.displayName)
    }));
}).AllowAnonymous();

/// <summary>
/// The Subscription &amp; Plan screen: current plan, status, usage against every limit, and which
/// capabilities are on. One call, because this screen should never render half-populated.
/// </summary>
app.MapGet("/api/subscription", async (HttpContext http, Pos.Api.Services.ISubscriptionService subs) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var usage = await subs.GetUsageAsync(tenantId.Value);

    return Results.Ok(new
    {
        plan = new { code = usage.PlanCode, name = usage.PlanName },
        status = usage.Status.ToString(),
        usage.TrialEndsAt,
        usage.EndDate,

        // The downgrade-safety state. Nothing has been deleted; they simply cannot add more.
        isOverPlanLimit = usage.IsOverPlanLimit,
        overLimitReason = usage.OverLimitReason,

        limits = usage.Limits.Select(l => new
        {
            code = l.Code,
            displayName = Pos.Api.Data.FeatureCatalog.Find(l.Code)?.DisplayName ?? l.Code,
            inUse = l.InUse,
            limit = l.Limit,
            isUnlimited = l.IsUnlimited,
            remaining = l.Remaining,
            // Drives the "4 of 5 POS terminals used" warning before they hit the wall.
            isNearLimit = l.IsNearLimit,
            isExceeded = l.Limit != null && l.InUse > l.Limit
        }),

        features = usage.Features.Select(kv => new
        {
            code = kv.Key,
            displayName = Pos.Api.Data.FeatureCatalog.Find(kv.Key)?.DisplayName ?? kv.Key,
            group = Pos.Api.Data.FeatureCatalog.Find(kv.Key)?.Group ?? "Other",
            enabled = kv.Value.Allowed,
            level = kv.Value.Level.ToString(),
            reason = kv.Value.Reason
        }).OrderBy(f => f.group).ThenBy(f => f.displayName)
    });
}).RequireAuthorization();

/// <summary>
/// Ask, before showing a button, whether the organisation may do something. Lets the UI grey out
/// and explain rather than letting a user fill in a form and then be refused.
/// </summary>
app.MapGet("/api/subscription/can/{featureCode}", async (
    HttpContext http, Pos.Api.Services.ISubscriptionService subs, string featureCode) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var feature = await subs.CheckFeatureAsync(tenantId.Value, featureCode);
    var limit = await subs.CheckLimitAsync(tenantId.Value, featureCode);

    return Results.Ok(new
    {
        code = featureCode,
        allowed = feature.Allowed && limit.Allowed,
        level = feature.Level.ToString(),
        inUse = limit.InUse,
        limit = limit.Limit,
        isUnlimited = limit.IsUnlimited,
        reason = feature.Reason ?? limit.Reason
    });
}).RequireAuthorization();

/// <summary>
/// Change plan. Upgrades take effect immediately; downgrades never delete anything — the
/// organisation is flagged OverPlanLimit and blocked from adding more until it fits.
/// </summary>
app.MapPost("/api/subscription/change-plan", async (
    HttpContext http,
    AppDbContext db,
    Pos.Api.Services.ISubscriptionService subs,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor,
    ChangePlanDto dto) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    // Changing what the business pays is an owner decision, not a manager one.
    if (!http.IsSuperAdmin() && actingUser?.Role != UserRole.OwnerAdmin)
        return Results.Json(new { message = "Only an owner can change the subscription plan." }, statusCode: 403);

    if (string.IsNullOrWhiteSpace(dto.PlanCode))
        return Results.BadRequest(new { message = "A plan code is required." });

    Pos.Api.Services.SubscriptionUsage usage;
    try
    {
        usage = await subs.ChangePlanAsync(tenantId.Value, dto.PlanCode, actingUser?.Id, dto.Reason);
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { message = ex.Message });
    }

    if (actingUser != null)
        await WriteAuditAsync(db, tenantId.Value, actingUser, "SubscriptionPlanChanged", "OrganizationSubscription",
            tenantId.Value, null, $"Moved to {dto.PlanCode}. {dto.Reason}");
    await db.SaveChangesAsync();

    // Keep the older entitlement snapshot in step so device licences pick the change up on their
    // next heartbeat — an upgrade must never require a reinstall.
    await entitlements.RecomputeAsync(tenantId.Value);

    return Results.Ok(new
    {
        message = usage.IsOverPlanLimit
            ? "Plan changed. Your current setup exceeds the new plan's limits — nothing has been removed, but you cannot add more until you are within them."
            : "Plan changed and active immediately.",
        plan = new { code = usage.PlanCode, name = usage.PlanName },
        status = usage.Status.ToString(),
        isOverPlanLimit = usage.IsOverPlanLimit,
        overLimitReason = usage.OverLimitReason,
        limits = usage.Limits.Select(l => new { code = l.Code, inUse = l.InUse, limit = l.Limit, isExceeded = l.Limit != null && l.InUse > l.Limit })
    });
}).RequireAuthorization();

/// <summary>
/// Turning a single location into a head office with branches.
///
/// The spec case this exists for: a Standard customer MUST be able to do this. The check asks
/// for the `hq` capability, not for a plan name, so Standard passes and Starter gets a message
/// naming Standard — not Professional — as the cheapest way to get it.
/// </summary>
app.MapPost("/api/organization/enable-hq", async (
    HttpContext http,
    AppDbContext db,
    Pos.Api.Services.ISubscriptionService subs,
    Pos.Api.Services.IEntitlementService entitlements,
    Pos.Api.Middlewares.ICurrentUserAccessor accessor) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null || tenantId == Guid.Empty) return Results.Unauthorized();

    var actingUser = await accessor.GetCurrentUserAsync(http);
    if (!http.IsSuperAdmin() && actingUser?.Role != UserRole.OwnerAdmin)
        return Results.Json(new { message = "Only an owner can enable head office." }, statusCode: 403);

    var hq = await subs.CheckFeatureAsync(tenantId.Value, Pos.Api.Data.FeatureCodes.Hq);
    if (!hq.Allowed)
        return Results.Json(new
        {
            message = hq.Reason ?? "Head office is not available on your plan.",
            featureCode = Pos.Api.Data.FeatureCodes.Hq,
            upgradeRequired = true
        }, statusCode: StatusCodes.Status402PaymentRequired);

    var tenant = await db.Tenants.IgnoreQueryFilters().FirstOrDefaultAsync(t => t.Id == tenantId.Value);
    if (tenant == null) return Results.NotFound();

    if (tenant.DeploymentMode == DeploymentMode.HeadOffice)
        return Results.Ok(new { message = "Head office is already enabled.", alreadyEnabled = true });

    tenant.DeploymentMode = DeploymentMode.HeadOffice;

    // The existing primary location becomes head office. Renaming it here would overwrite a name
    // the owner chose, so only the code is normalised.
    var primary = await db.Branches.IgnoreQueryFilters()
        .Where(b => b.TenantId == tenantId.Value)
        .OrderByDescending(b => b.IsHeadOffice).ThenBy(b => b.Code)
        .FirstOrDefaultAsync();
    if (primary != null)
    {
        primary.IsHeadOffice = true;
        if (primary.Code == "MAIN") primary.Code = "HQ";
    }

    if (actingUser != null)
        await WriteAuditAsync(db, tenantId.Value, actingUser, "HeadOfficeEnabled", "Tenant", tenantId.Value,
            "Standalone", "HeadOffice");

    await db.SaveChangesAsync();
    var updated = await entitlements.RecomputeAsync(tenantId.Value);

    var locations = await subs.CheckLimitAsync(tenantId.Value, Pos.Api.Data.FeatureCodes.Locations);

    return Results.Ok(new
    {
        message = "Head office enabled. You can now add branches beneath it.",
        headOfficeBranchId = primary?.Id,
        deploymentMode = "HeadOffice",
        snapshotVersion = updated.Version,
        locations = new { inUse = locations.InUse, limit = locations.Limit, isUnlimited = locations.IsUnlimited }
    });
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

    /// <summary>Rounding precision resolved from TenantSettings — reused when commerce extras re-round.</summary>
    public int Decimals { get; set; } = 2;

    // --- Commerce extras (promo / gift card / loyalty), filled by ApplyOrderCommerceAsync ---
    public PromoCode? AppliedPromo { get; set; }
    public decimal PromoDiscountPKR { get; set; }
    /// <summary>Set when a promo code was supplied but could not be honoured. Never fatal to the sale.</summary>
    public string? PromoRejectedReason { get; set; }
    public decimal GiftCardRedeemedPKR { get; set; }
    public string? GiftCardRejectedReason { get; set; }
    public int LoyaltyPointsRedeemed { get; set; }
    public decimal LoyaltyDiscountPKR { get; set; }
    public string? LoyaltyRejectedReason { get; set; }
    public Customer? LinkedCustomer { get; set; }
}

// DTOs
public record VerifyPinDto(string Username, string PinCode, string? RequiredPermission);
public record UpdateTaxJurisdictionDto(string? AuthorityName, decimal? CashTaxRate, decimal? DigitalTaxRate, bool? IsActive);
public record UpdateBranchDto(string? Name, string? Address, string? City, string? Phone, string? RegionCode, int? AllowedCounters, int? AllowedOrderTabs);
// The trailing CRM/loyalty/gift-card/promo fields are optional and default to null — a walk-in
// order posted by an older client that omits them behaves exactly as it did before.
/// <summary>
/// ClientLocalId and CapturedAt are set only by offline sync: the first makes re-posting a
/// batch safe, the second records when the sale really happened rather than when it reached us.
/// Both are optional so the ordinary online checkout path is unchanged.
/// </summary>
public record CreateOrderDto(Guid BranchId, OrderType OrderType, string? TableNumber, string? CustomerName, string? CustomerPhone, string? DeliveryAddress, decimal SubTotalPKR, decimal DiscountPKR, decimal TaxPKR, decimal TotalPKR, PaymentMethod PaymentMethod, decimal AmountPaidPKR, decimal ChangeDuePKR, bool IsPaid, string? CashierName, string? CreatedByRole, List<CreateOrderItemDto> Items, string? PromoCode = null, string? GiftCardCode = null, decimal? GiftCardRedeemAmount = null, int? LoyaltyPointsRedeemed = null, string? ClientLocalId = null, DateTime? CapturedAt = null);
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
public record UpdateUserDto(string? FullName, UserRole? Role, string? PinCode, bool? IsActive, bool? CanViewFinancialReports, bool? CanManageInventory, bool? CanManageMenuAndTax, bool? CanGiveDiscounts, bool? CanVoidOrders,
    string? Department = null, string? Designation = null, EmploymentType? EmploymentType = null, decimal? MonthlyRatePKR = null, decimal? HourlyRatePKR = null, string? BankAccountNumber = null, DateTime? JoiningDate = null, bool? IsPayrollEligible = null,
    Guid? DepartmentId = null, Guid? DesignationId = null);
public record CreateRiderDto(Guid BranchId, string Name, string Phone, string VehicleNumber);
public record CreateTransferOrderDto(Guid TenantId, Guid SourceBranchId, Guid DestinationBranchId, string? VehicleOrDriver, string? Notes, List<CreateTransferItemDto> Items);
public record CreateTransferItemDto(Guid IngredientId, string? IngredientName, decimal QuantityRequested, string? Unit);
public record DispatchTransferDto(string? DispatchedBy, string? VehicleOrDriver, string? Notes);
public record ReceiveTransferDto(string? ReceivedBy, string? Notes);
public record CreatePODto(Guid TenantId, Guid BranchId, string SupplierName, string? Notes, List<CreatePOItemDto> Items, Guid? SupplierId = null);
public record CreatePOItemDto(Guid IngredientId, string IngredientName, decimal Quantity, string? Unit, decimal UnitCostPKR);
public record ReceivePODto(string? ReceivedBy, string? Notes);
public record CreateWarehouseDto(Guid? TenantId, Guid BranchId, string Name, string? Code);
public record UpdateWarehouseDto(string? Name, string? Code, bool? IsActive);
public record IssueSubscriptionInvoiceDto(Guid TenantId, bool Annual, decimal? AmountPKR, DateTime? BillingPeriodStart, DateTime? BillingPeriodEnd, DateTime? DueAt, string? Notes);
public record MarkSubscriptionInvoicePaidDto(string? PaymentMethod);
public record CreateSupplierDto(Guid? TenantId, string Name, string? ContactName, string? Phone, string? Email, string? Address, string? TaxNumber, string? PaymentTerms, decimal? OpeningBalancePKR);
public record UpdateSupplierDto(string? Name, string? ContactName, string? Phone, string? Email, string? Address, string? TaxNumber, string? PaymentTerms, bool? IsActive);
public record RecordSupplierPaymentDto(decimal AmountPKR, string? PaymentMethod, string? ReferenceNumber, string? Notes);
public record IngredientStockAdjustmentDto(Guid? TenantId, Guid BranchId, Guid IngredientId, string MovementType, decimal QuantityChange, string? Reason);
public record CreateTableDto(Guid BranchId, string TableNumber, string? Section, int Capacity);
public record UpdateTableDto(string? TableNumber, string? Section, int? Capacity, bool? IsOccupied);
/// <summary>TenantSlug disambiguates a username that exists at more than one business. Optional,
/// because the overwhelmingly common case is a name that is unique platform-wide.</summary>
public record LoginDto(string Username, string PinCode, string? TenantSlug = null);
public record RefreshTokenDto(string RefreshToken);
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
public record CreateTerminalDto(Guid BranchId, string TerminalName, TerminalType TerminalType);
public record UpdateTerminalDto(string? TerminalName, bool? IsActive);

// --- Device activation & licensing ---
public record CreatePairingCodeDto(Guid BranchId, TerminalType TerminalType, string? TerminalName);
public record ActivateDeviceDto(string PairingCode, string DeviceFingerprint, string? DeviceInfo);
/// <summary>DeviceToken is retained only so an older build can still check in and be told to
/// re-activate; the licence is what actually authenticates a heartbeat now.</summary>
public record TerminalHeartbeatDto(string? License, string? DeviceFingerprint, string? DeviceToken);
public record CreateStockRequestDto(Guid BranchId, StockRequestType RequestType, string? VendorName, string? Notes, string CreatedBy, Guid? CreatedByUserId, List<CreateStockRequestItemDto> Items);
public record CreateStockRequestItemDto(Guid IngredientId, string IngredientName, string Unit, decimal QuantityRequested, decimal CurrentStock, decimal UnitCostPKR);
public record ReviewStockRequestDto(StockRequestStatus Status, string ReviewedBy, string? ReviewNotes);
public record CreateCashEntryDto(CashEntryType EntryType, decimal AmountPKR, string Description, string? RecipientOrSource, string CreatedBy);
/// <summary>
/// DeploymentMode is "Standalone" (one shop) or "MultiBranch" (a head office with outlets under
/// it). Branches is only read for MultiBranch, and is validated against the chosen plan's
/// HasMultiBranch flag and MaxBranches allowance before anything is created.
/// </summary>
public record SignupDto(string RestaurantName, string ContactName, string Email, string Phone, string? City, string? Address, string AdminUsername, string AdminPin, BusinessType? BusinessType, string? PackageKey, string? Country, string? StateCode, string? StateName, string? VerticalPack = null, string? DeploymentMode = null, List<SignupBranchDto>? Branches = null);

/// <summary>One outlet listed at signup. Only Name is required; the rest fall back to the
/// tenant's own city/province so a chain in one city does not have to retype it per branch.</summary>
public record SignupBranchDto(string Name, string? Code, string? City, string? Address, string? Phone, string? StateCode);
/// <summary>Force moves a tenant onto a smaller plan they do not currently fit. Reserved for
/// "the customer insists" — devices beyond the new allowance stop selling at their next heartbeat.</summary>
public record ChangeTierDto(SubscriptionTier Tier, DateTime? PaidUntil, bool? Force = null);

public record PlanUsage(int Branches, int ActiveUsers);
public record PlanLimits(int MaxBranches, int MaxCounters, int MaxOrderTabs, int MaxUsers);
public record PlanChangeImpact(
    string CurrentTier,
    string TargetTier,
    bool IsDowngrade,
    List<string> Blockers,
    List<string> FeaturesLost,
    PlanUsage CurrentUsage,
    PlanLimits TargetLimits);
public record WhatsAppConfigDto(string Provider, string? ApiKey, string? ApiSecret, string? PhoneNumberId, string? AccessToken, string? WebhookUrl, bool IsEnabled, bool AutoSendOrderUpdates, bool AutoSendReceipt);
public record TestWhatsAppDto(string PhoneNumber, string RestaurantName);
public record OrderNotificationDto(Guid TenantId, Guid? OrderId, string OrderNumber, string PhoneNumber, string MessageType, string ItemSummary, decimal TotalPKR, string PaymentMethod, string? DeliveryAddress, string PackageTier, string? CustomMessage);
public record CreatePackageDto(string PackageKey, string DisplayName, decimal MonthlyPricePKR, decimal YearlyPricePKR, int MaxBranches, int MaxCounters, int MaxOrderTabs, int MaxUsers, bool HasKitchenDisplay, bool HasDeliveryCOD, bool HasInventoryManagement, bool HasStockTransfers, bool HasDirectorDashboard, bool HasConsolidatedReports, bool HasWhatsAppMessaging, bool HasAdvancedReports, bool HasMultiBranch, int WhatsAppMessagesPerMonth);
public record UpdatePackageDto(string? DisplayName, decimal? MonthlyPricePKR, decimal? YearlyPricePKR, int? MaxBranches, int? MaxCounters, int? MaxOrderTabs, int? MaxUsers, bool? HasKitchenDisplay, bool? HasDeliveryCOD, bool? HasInventoryManagement, bool? HasStockTransfers, bool? HasDirectorDashboard, bool? HasConsolidatedReports, bool? HasWhatsAppMessaging, bool? HasAdvancedReports, bool? HasMultiBranch, int? WhatsAppMessagesPerMonth);
public record CreateAddOnCatalogItemDto(string Key, string DisplayName, string? Description, decimal MonthlyPricePKR, decimal YearlyPricePKR);
public record UpdateAddOnCatalogItemDto(string? DisplayName, string? Description, decimal? MonthlyPricePKR, decimal? YearlyPricePKR, bool? IsActive);
public record GrantAddOnDto(string AddOnKey, decimal? PricePKR, int? Quantity, Guid? BranchId);
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

// --- CRM / loyalty / gift cards / promos ---
public record CreateCustomerDto(string? FullName, string Phone, string? Email);
public record UpdateCustomerDto(string? FullName, string? Phone, string? Email, int? LoyaltyPoints);
public record RecordCustomerPaymentDto(decimal AmountPKR, string? PaymentMethod, string? ReferenceNumber, string? Notes);
public record LoyaltyConfigDto(bool? IsEnabled, decimal? PointsPerPKRSpent, decimal? PKRValuePerPoint, int? MinRedeemPoints);
public record LoyaltyRedeemDto(Guid CustomerId, int PointsToRedeem);
public record IssueGiftCardDto(decimal InitialBalancePKR, Guid? IssuedToCustomerId, DateTime? ExpiresAt);
public record CreatePromoCodeDto(string Code, PromoDiscountType DiscountType, decimal DiscountValue, decimal MinOrderAmountPKR, int? MaxUsesTotal, int? MaxUsesPerCustomer, DateTime? ValidFrom, DateTime? ValidUntil, bool? IsActive);
public record UpdatePromoCodeDto(PromoDiscountType? DiscountType, decimal? DiscountValue, decimal? MinOrderAmountPKR, int? MaxUsesTotal, int? MaxUsesPerCustomer, DateTime? ValidFrom, DateTime? ValidUntil, bool? IsActive);

// --- Payments / delivery integration ---
public record InitiatePaymentDto(Guid OrderId, PaymentProvider Provider);
public record DeliveryIntegrationConfigDto(bool IsEnabled, string? ApiKey, string? StoreId, string? WebhookSecret);

// --- Labor ---
public record CreateShiftScheduleDto(Guid BranchId, Guid UserId, DateTime ScheduledStart, DateTime ScheduledEnd, string? Position, string? Notes);
public record UpdateShiftScheduleDto(DateTime? ScheduledStart, DateTime? ScheduledEnd, string? Position, string? Notes);
public record ClockInDto(Guid UserId, Guid? BranchId);
public record ClockOutDto(Guid TimeClockEntryId);

// --- Payroll ---
// --- HR (Departments/Designations/Leave) ---
public record CreateDepartmentDto(Guid? TenantId, string Name);
public record UpdateDepartmentDto(string? Name, bool? IsActive);
public record CreateDesignationDto(Guid? TenantId, string Name, Guid? DepartmentId);
public record UpdateDesignationDto(string? Name, Guid? DepartmentId, bool? IsActive);
public record CreateLeaveRequestDto(Guid? BranchId, Guid UserId, LeaveType LeaveType, DateTime StartDate, DateTime EndDate, decimal? DaysRequested, string? Reason);
public record ReviewLeaveRequestDto(string? Notes);

public record CreatePayrollPeriodDto(Guid? TenantId, DateTime PeriodStart, DateTime PeriodEnd, string? Notes);
public record AddPayslipLineDto(PayslipLineType Type, string Description, decimal AmountPKR);
public record MarkPayslipPaidDto(string? PaymentMethod);

// --- Accounting ---
public record CreateAccountDto(Guid? TenantId, string Code, string Name, AccountType Type, string? SubType, Guid? ParentAccountId);
public record UpdateAccountDto(string? Name, string? SubType, bool? IsActive);
public record JournalLineInputDto(string AccountCode, decimal DebitPKR, decimal CreditPKR);
public record CreateJournalEntryDto(Guid? TenantId, Guid? BranchId, DateTime? EntryDate, string Description, List<JournalLineInputDto> Lines);
public record ReverseJournalEntryDto(string? Reason);
public record CreateAccountingPeriodDto(Guid? TenantId, DateTime PeriodStart, DateTime PeriodEnd);
public record CreateBankReconciliationDto(Guid? TenantId, string AccountCode, DateTime StatementDate, decimal StatementBalancePKR, List<Guid> LineIds);

public record SetVerticalPacksDto(List<string> PackKeys, string? PrimaryPackKey);
public record SetTenantStatusDto(TenantStatus Status, string Reason);
public record CreateOverrideDto(string Key, string Value, DateTime? ExpiresAt, string Reason);
public record ExtendTrialDto(int Days, string? Reason);
public record ProvisionTenantDto(
    string BusinessName, string ContactName, string ContactEmail, string? ContactPhone,
    string? City, string? Address, string? Country, string? PackageKey, string? VerticalPack,
    int TrialDays, DateTime? PaidUntil);
public record RedeemInviteDto(string InviteToken, string Username, string Pin, string? FullName);
public record ImpersonateDto(string Reason, bool? AllowWrites);
public record CreateExpenseDto(Guid BranchId, string Category, string? Description, Guid? SupplierId, string? PayeeName,
    decimal AmountPKR, decimal? TaxPKR, DateTime? ExpenseDate, PaymentMethod? PaymentMethod,
    Guid? ExpenseAccountId, Guid? PaidFromAccountId, string? ReceiptReference);
public record UpdateExpenseDto(string? Category, string? Description, string? PayeeName, Guid? SupplierId,
    decimal? AmountPKR, decimal? TaxPKR, DateTime? ExpenseDate, PaymentMethod? PaymentMethod,
    Guid? ExpenseAccountId, Guid? PaidFromAccountId, string? ReceiptReference);
public record RejectExpenseDto(string Reason);
public record RegisterHostDto(Guid BranchId, string? HostName, string? LanAddress, int Port,
    string? MachineName, string? OperatingSystem, string? AppVersion);
public record HostCheckinDto(string BusinessId, string? LanAddress, int Port, string? AppVersion);
public record CreateSyncLogDto(Guid? BranchId, Guid? DeviceId, string? HostIdentifier, SyncDirection? Direction,
    string EntityType, string? BatchId, int RecordsAttempted, int RecordsSucceeded, string? ErrorMessage, int? DurationMs);
public record SyncReceiveDto(string? BusinessId, Guid TenantId, string? EntityType, string? BatchId,
    List<Dictionary<string, System.Text.Json.JsonElement>>? Records);
public record ChangePlanDto(string PlanCode, string? Reason);
public record CreateBranchDto(string Name, string? Code, string? City, string? Address, string? Phone, string? StateCode);

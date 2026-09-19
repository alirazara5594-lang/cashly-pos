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

authApi.MapPost("/login", async (AppDbContext db, LoginDto dto) =>
{
    const int MaxFailedAttempts = 5;
    var lockoutDuration = TimeSpan.FromMinutes(15);

    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == dto.Username.ToLower().Trim() && u.IsActive);

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
            if (user.FailedLoginAttempts >= MaxFailedAttempts)
            {
                user.LockedUntil = DateTime.UtcNow.Add(lockoutDuration);
                user.FailedLoginAttempts = 0;
            }
            await db.SaveChangesAsync();
        }
        return Results.Unauthorized();
    }

    user.FailedLoginAttempts = 0;
    user.LockedUntil = null;
    await db.SaveChangesAsync();

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

        // Same commerce rules as the online path: customer linkage, promo, loyalty, gift card.
        await ApplyOrderCommerceAsync(db, order, dto, priced);
        pricedByOrder[order.Id] = priced;

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
});

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
                    ingredient.CurrentStock -= totalIngredientQty;
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
// ADD-ONS — features sold standalone to a tenant on a lower tier who doesn't want
// (or need) a full tier upgrade. Catalog pricing is SuperAdmin-managed; granting/
// revoking a specific tenant's add-on is also SuperAdmin-only — this is a manual
// sales process (the owner asks, you sell it), not self-serve checkout.
// ============================================================

// Any signed-in tenant user can see what's purchasable and what they already have.
app.MapGet("/api/addons/catalog", async (AppDbContext db, HttpContext http) =>
{
    var tenantId = http.GetTenantId();
    if (tenantId == null) return Results.Unauthorized();
    var catalog = await db.AddOnCatalogItems.Where(a => a.IsActive).OrderBy(a => a.DisplayName).ToListAsync();
    var active = await db.AddOnSubscriptions.Where(a => a.TenantId == tenantId.Value && a.IsActive).Select(a => a.AddOnKey).ToListAsync();
    return Results.Ok(catalog.Select(c => new { c.Id, c.Key, c.DisplayName, c.Description, c.MonthlyPricePKR, c.YearlyPricePKR, isActiveForTenant = active.Contains(c.Key) }));
}).RequireAuthorization();

// --- SuperAdmin: manage the sellable catalog itself ---
app.MapGet("/api/admin/addons/catalog", async (AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    return Results.Ok(await db.AddOnCatalogItems.OrderBy(a => a.DisplayName).ToListAsync());
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

app.MapPost("/api/admin/tenants/{tenantId:guid}/addons", async (Guid tenantId, AppDbContext db, HttpContext http, GrantAddOnDto dto) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var tenant = await db.Tenants.FindAsync(tenantId);
    if (tenant == null) return Results.NotFound(new { message = "Tenant not found." });
    var catalogItem = await db.AddOnCatalogItems.FirstOrDefaultAsync(a => a.Key == dto.AddOnKey);
    if (catalogItem == null) return Results.BadRequest(new { message = $"No catalog entry for {dto.AddOnKey}." });

    var existing = await db.AddOnSubscriptions.FirstOrDefaultAsync(a => a.TenantId == tenantId && a.AddOnKey == dto.AddOnKey);
    if (existing != null)
    {
        existing.IsActive = true;
        existing.PricePKR = dto.PricePKR ?? catalogItem.MonthlyPricePKR;
        existing.Quantity = dto.Quantity ?? 1;
    }
    else
    {
        existing = new AddOnSubscription { TenantId = tenantId, AddOnKey = dto.AddOnKey, Quantity = dto.Quantity ?? 1, PricePKR = dto.PricePKR ?? catalogItem.MonthlyPricePKR, IsActive = true };
        db.AddOnSubscriptions.Add(existing);
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing);
}).RequireAuthorization();

app.MapPost("/api/admin/tenants/{tenantId:guid}/addons/{addOnId:guid}/revoke", async (Guid tenantId, Guid addOnId, AppDbContext db, HttpContext http) =>
{
    if (!http.IsSuperAdmin()) return Results.Forbid();
    var sub = await db.AddOnSubscriptions.FirstOrDefaultAsync(a => a.Id == addOnId && a.TenantId == tenantId);
    if (sub == null) return Results.NotFound();
    sub.IsActive = false;
    await db.SaveChangesAsync();
    return Results.Ok(sub);
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

api.MapPost("/accounting/periods/{id:guid}/close", async (AppDbContext db, HttpContext http, Pos.Api.Middlewares.ICurrentUserAccessor accessor, Guid id) =>
{
    var scopedTenantId = ResolveTenantScope(http, null);
    if (scopedTenantId == null) return Results.Unauthorized();
    var period = await db.AccountingPeriods.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == scopedTenantId.Value);
    if (period == null) return Results.NotFound();
    if (period.Status == AccountingPeriodStatus.Closed) return Results.BadRequest(new { message = "Already closed." });

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
        // Normal-balance accounts (Asset/Expense: debit; Liability/Equity/Revenue: credit) are shown
        // net in their natural column so the trial balance reads the way an accountant expects.
        var isDebitNormal = a.Type == AccountType.Asset || a.Type == AccountType.Expense;
        var net = isDebitNormal ? debit - credit : credit - debit;
        return new { a.Id, a.Code, a.Name, type = a.Type.ToString(), debitBalance = isDebitNormal ? Math.Max(0, net) : 0m, creditBalance = !isDebitNormal ? Math.Max(0, net) : 0m, rawDebit = debit, rawCredit = credit };
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
public record CreateOrderDto(Guid BranchId, OrderType OrderType, string? TableNumber, string? CustomerName, string? CustomerPhone, string? DeliveryAddress, decimal SubTotalPKR, decimal DiscountPKR, decimal TaxPKR, decimal TotalPKR, PaymentMethod PaymentMethod, decimal AmountPaidPKR, decimal ChangeDuePKR, bool IsPaid, string? CashierName, string? CreatedByRole, List<CreateOrderItemDto> Items, string? PromoCode = null, string? GiftCardCode = null, decimal? GiftCardRedeemAmount = null, int? LoyaltyPointsRedeemed = null);
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
public record CreateAddOnCatalogItemDto(string Key, string DisplayName, string? Description, decimal MonthlyPricePKR, decimal YearlyPricePKR);
public record UpdateAddOnCatalogItemDto(string? DisplayName, string? Description, decimal? MonthlyPricePKR, decimal? YearlyPricePKR, bool? IsActive);
public record GrantAddOnDto(string AddOnKey, decimal? PricePKR, int? Quantity);
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



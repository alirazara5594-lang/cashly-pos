using System;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Pos.Api.Data;
using Pos.Api.Models;
using Pos.Api.Middlewares;

var builder = WebApplication.CreateBuilder(args);

// --- Configuration ---
var jwtKey = builder.Configuration["Jwt:Key"] ?? Environment.GetEnvironmentVariable("JWT_KEY") ?? "CashlyPOS_SuperSecretKey_2024_Change_In_Production!";
var dbConnection = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? Environment.GetEnvironmentVariable("DATABASE_URL")
    ?? "Host=localhost;Port=5432;Database=cashly_pos_db;Username=postgres;Password=12345678";

// --- JWT Authentication ---
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
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

builder.Services.AddOpenApi();

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
        ");

        // Seed data
        var singleTenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var singleBranchId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
        if (!await db.Products.AnyAsync(p => p.TenantId == singleTenantId))
        {
            var singleCat = new Category { Id = Guid.NewGuid(), TenantId = singleTenantId, Name = "Wraps & Grills", Icon = "sandwich", SortOrder = 1 };
            db.Categories.Add(singleCat);
            var sp1 = new Product
            {
                Id = Guid.NewGuid(),
                TenantId = singleTenantId,
                CategoryId = singleCat.Id,
                SKU = "SB-WRP-01",
                Barcode = "896101112233",
                Name = "Crispy Chicken Wrap",
                UrduName = "کرسپی چکن ریپ",
                Description = "Crispy spiced chicken rolled in tortilla with garlic sauce and greens",
                CostPricePKR = 280,
                SellingPricePKR = 620,
                Unit = "Piece",
                Station = KitchenStation.Grill,
                ImageUrl = "https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=400"
            };
            var sp2 = new Product
            {
                Id = Guid.NewGuid(),
                TenantId = singleTenantId,
                CategoryId = singleCat.Id,
                SKU = "SB-BBQ-01",
                Barcode = "896101112244",
                Name = "Smoky BBQ Platter",
                UrduName = "اسمونکی بی بی کیو پلیٹر",
                Description = "Flame-grilled succulent chicken skewers with mint chutney and fresh paratha",
                CostPricePKR = 520,
                SellingPricePKR = 1150,
                Unit = "Platter",
                Station = KitchenStation.Grill,
                ImageUrl = "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400"
            };
            db.Products.AddRange(sp1, sp2);
            db.BranchStocks.AddRange(
                new BranchStock { Id = Guid.NewGuid(), BranchId = singleBranchId, ProductId = sp1.Id, QuantityOnHand = 75 },
                new BranchStock { Id = Guid.NewGuid(), BranchId = singleBranchId, ProductId = sp2.Id, QuantityOnHand = 60 }
            );
            await db.SaveChangesAsync();
        }

        await DbSeeder.SeedAsync(db);
        await DbSeeder.EnsureDemoUsersAsync(db);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Seeder Error / Note]: {ex.Message}");
    }
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
app.MapPost("/api/auth/login", async (AppDbContext db, LoginDto dto) =>
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
// NOTE: Authorization removed — POS terminal operates without a login screen.
// To re-enable JWT auth in future, add .RequireAuthorization() back and build a login page first.
// ============================================================
var api = app.MapGroup("/api");

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
});

api.MapPost("/setup/initialize", async (AppDbContext db, SetupInitDto dto) =>
{
    var tenant = new Tenant
    {
        Id = Guid.NewGuid(),
        Name = string.IsNullOrWhiteSpace(dto.RestaurantName) ? "Cashly Restaurant" : dto.RestaurantName.Trim(),
        BusinessType = dto.BusinessType ?? BusinessType.Restaurant,
        Tier = dto.DeploymentMode == "MultiBranch" ? SubscriptionTier.Professional : SubscriptionTier.Standard,
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };
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
});

// --- Offline Batch Sync ---
api.MapPost("/sync/batch-orders", async (AppDbContext db, List<CreateOrderDto> ordersList) =>
{
    var syncedResults = new List<object>();

    foreach (var dto in ordersList)
    {
        var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
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
            SubTotalPKR = dto.SubTotalPKR,
            DiscountPKR = dto.DiscountPKR,
            TaxPKR = dto.TaxPKR,
            TotalPKR = dto.TotalPKR,
            PaymentMethod = dto.PaymentMethod,
            AmountPaidPKR = dto.AmountPaidPKR,
            ChangeDuePKR = dto.ChangeDuePKR,
            IsPaid = dto.IsPaid,
            CashierName = dto.CashierName ?? "Counter 1 Cashier",
            CreatedByRole = dto.CreatedByRole ?? "Cashier (Offline Sync)",
            CreatedAt = DateTime.UtcNow
        };

        foreach (var item in dto.Items)
        {
            order.Items.Add(new OrderItem
            {
                OrderId = order.Id,
                ProductId = item.ProductId,
                ProductName = item.ProductName,
                Quantity = item.Quantity,
                UnitPricePKR = item.UnitPricePKR,
                TotalPricePKR = item.UnitPricePKR * item.Quantity,
                ModifiersSummary = item.ModifiersSummary,
                SpecialNotes = item.SpecialNotes,
                Station = item.Station
            });
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
                activeShift.CashSalesPKR += dto.TotalPKR;
                activeShift.ExpectedCashPKR = activeShift.OpeningFloatPKR + activeShift.CashSalesPKR;
            }
        }

        db.Orders.Add(order);
        syncedResults.Add(new { orderId = order.Id, orderNumber = order.OrderNumber, status = "Synced" });
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
});

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
});

// --- Tenancy & Hierarchy ---
api.MapGet("/tenants", async (AppDbContext db) =>
{
    var tenants = await db.Tenants
        .Include(t => t.Branches).ThenInclude(b => b.Terminals)
        .Include(t => t.AddOns)
        .ToListAsync();
    return Results.Ok(tenants);
});

api.MapGet("/branches", async (AppDbContext db, Guid? tenantId) =>
{
    var query = db.Branches.Include(b => b.Terminals).AsQueryable();
    if (tenantId.HasValue) query = query.Where(b => b.TenantId == tenantId.Value);
    return Results.Ok(await query.ToListAsync());
});

// --- Catalog ---
api.MapGet("/catalog/categories", async (AppDbContext db, Guid? tenantId) =>
{
    var query = db.Categories.OrderBy(c => c.SortOrder).AsQueryable();
    if (tenantId.HasValue) query = query.Where(c => c.TenantId == tenantId.Value);
    return Results.Ok(await query.ToListAsync());
});

api.MapPost("/catalog/categories", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var cat = new Category { TenantId = dto.TenantId, Name = dto.Name, Icon = dto.Icon ?? "utensils", SortOrder = dto.SortOrder };
    db.Categories.Add(cat);
    await db.SaveChangesAsync();
    return Results.Ok(cat);
});

api.MapPut("/catalog/categories/{id}", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id);
    if (cat == null) return Results.NotFound();
    cat.Name = dto.Name;
    cat.Icon = dto.Icon ?? cat.Icon;
    cat.SortOrder = dto.SortOrder;
    await db.SaveChangesAsync();
    return Results.Ok(cat);
});

api.MapDelete("/catalog/categories/{id}", async (AppDbContext db, Guid id) =>
{
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id);
    if (cat == null) return Results.NotFound();
    db.Categories.Remove(cat);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Category deleted successfully" });
});

api.MapGet("/catalog/products", async (AppDbContext db, Guid? tenantId, Guid? categoryId, string? search, string? barcode) =>
{
    var query = db.Products.Include(p => p.Modifiers).Include(p => p.Category).Where(p => p.IsActive).AsQueryable();
    if (tenantId.HasValue) query = query.Where(p => p.TenantId == tenantId.Value);
    if (categoryId.HasValue) query = query.Where(p => p.CategoryId == categoryId.Value);
    if (!string.IsNullOrWhiteSpace(barcode)) query = query.Where(p => p.Barcode == barcode.Trim());
    if (!string.IsNullOrWhiteSpace(search))
    {
        var s = search.Trim().ToLower();
        query = query.Where(p => p.Name.ToLower().Contains(s) || (p.UrduName != null && p.UrduName.Contains(s)) || p.Barcode.Contains(s) || p.SKU.ToLower().Contains(s));
    }
    return Results.Ok(await query.ToListAsync());
});

api.MapPost("/catalog/products", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateProductDto dto) =>
{
    var product = new Product
    {
        TenantId = dto.TenantId, CategoryId = dto.CategoryId, Name = dto.Name, UrduName = dto.UrduName,
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
    await db.SaveChangesAsync();
    return Results.Ok(product);
});

api.MapPut("/catalog/products/{id}", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateProductDto dto) =>
{
    var product = await db.Products.Include(p => p.Modifiers).FirstOrDefaultAsync(p => p.Id == id);
    if (product == null) return Results.NotFound();
    product.Name = dto.Name ?? product.Name;
    product.UrduName = dto.UrduName ?? product.UrduName;
    product.SellingPricePKR = dto.SellingPricePKR;
    product.CostPricePKR = dto.CostPricePKR;
    product.Barcode = dto.Barcode ?? product.Barcode;
    product.CategoryId = dto.CategoryId;
    product.Station = dto.Station;
    await db.SaveChangesAsync();
    return Results.Ok(product);
});

api.MapDelete("/catalog/products/{id}", async (AppDbContext db, Guid id) =>
{
    var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id);
    if (product == null) return Results.NotFound();
    db.Products.Remove(product);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Product deleted successfully" });
});

// --- Dining Tables ---
api.MapGet("/tables", async (AppDbContext db, Guid branchId) =>
{
    var tables = await db.DiningTables.Where(t => t.BranchId == branchId).OrderBy(t => t.Section).ThenBy(t => t.TableNumber).ToListAsync();
    return Results.Ok(tables);
});

api.MapPost("/tables", async (AppDbContext db, CreateTableDto dto) =>
{
    var branch = await db.Branches.FindAsync(dto.BranchId);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });
    var existing = await db.DiningTables.FirstOrDefaultAsync(t => t.BranchId == dto.BranchId && t.TableNumber.ToLower() == dto.TableNumber.ToLower());
    if (existing != null) return Results.BadRequest(new { message = $"Table '{dto.TableNumber}' already exists in this branch" });
    var table = new DiningTable
    {
        BranchId = dto.BranchId, TableNumber = dto.TableNumber.Trim().ToUpper(),
        Section = string.IsNullOrWhiteSpace(dto.Section) ? "Main Hall" : dto.Section.Trim(),
        Capacity = dto.Capacity > 0 ? dto.Capacity : 4, IsOccupied = false
    };
    db.DiningTables.Add(table);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tables/{table.Id}", table);
});

api.MapPut("/tables/{id:guid}", async (AppDbContext db, Guid id, UpdateTableDto dto) =>
{
    var table = await db.DiningTables.FindAsync(id);
    if (table == null) return Results.NotFound(new { message = "Table not found" });
    if (!string.IsNullOrWhiteSpace(dto.TableNumber)) table.TableNumber = dto.TableNumber.Trim().ToUpper();
    if (!string.IsNullOrWhiteSpace(dto.Section)) table.Section = dto.Section.Trim();
    if (dto.Capacity.HasValue && dto.Capacity.Value > 0) table.Capacity = dto.Capacity.Value;
    if (dto.IsOccupied.HasValue) table.IsOccupied = dto.IsOccupied.Value;
    await db.SaveChangesAsync();
    return Results.Ok(table);
});

api.MapDelete("/tables/{id:guid}", async (AppDbContext db, Guid id) =>
{
    var table = await db.DiningTables.FindAsync(id);
    if (table == null) return Results.NotFound(new { message = "Table not found" });
    db.DiningTables.Remove(table);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Table deleted successfully" });
});

// --- Orders (Mode 1 Parallel Dispatch) ---
api.MapPost("/orders", async (AppDbContext db, CreateOrderDto dto) =>
{
    var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });

    var orderNumber = await GenerateOrderNumberAsync(db);
    var order = new Order
    {
        TenantId = branch.TenantId, BranchId = branch.Id, OrderNumber = orderNumber,
        OrderType = dto.OrderType,
        Status = dto.OrderType == OrderType.DineIn ? OrderStatus.InKitchen :
                 (dto.OrderType == OrderType.Delivery || dto.OrderType == OrderType.CallOrder) ? OrderStatus.InKitchen :
                 OrderStatus.ReadyForDispatch,
        TableNumber = dto.TableNumber, CustomerName = dto.CustomerName, CustomerPhone = dto.CustomerPhone,
        DeliveryAddress = dto.DeliveryAddress, SubTotalPKR = dto.SubTotalPKR, DiscountPKR = dto.DiscountPKR,
        TaxPKR = dto.TaxPKR, TotalPKR = dto.TotalPKR, PaymentMethod = dto.PaymentMethod,
        AmountPaidPKR = dto.AmountPaidPKR, ChangeDuePKR = dto.ChangeDuePKR, IsPaid = dto.IsPaid,
        CashierName = dto.CashierName ?? "Counter 1 Cashier", CreatedByRole = dto.CreatedByRole ?? "Cashier",
        CreatedAt = DateTime.UtcNow
    };

    foreach (var item in dto.Items)
    {
        order.Items.Add(new OrderItem
        {
            OrderId = order.Id, ProductId = item.ProductId, ProductName = item.ProductName,
            Quantity = item.Quantity, UnitPricePKR = item.UnitPricePKR,
            TotalPricePKR = item.UnitPricePKR * item.Quantity,
            ModifiersSummary = item.ModifiersSummary, SpecialNotes = item.SpecialNotes, Station = item.Station
        });
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

    // Update cash shift
    if (dto.IsPaid && dto.PaymentMethod == PaymentMethod.Cash)
    {
        var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == branch.Id && !s.IsClosed);
        if (activeShift != null)
        {
            activeShift.CashSalesPKR += dto.TotalPKR;
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

    return Results.Ok(new
    {
        message = "Order placed and dispatched via Mode 1 (Kitchen + Counter)",
        orderId = order.Id, orderNumber = order.OrderNumber,
        kitchenTicketsCount = order.KitchenTickets.Count,
        status = order.Status.ToString(), totalPKR = order.TotalPKR
    });
});

api.MapGet("/orders", async (AppDbContext db, Guid branchId, OrderStatus? status, int limit = 30) =>
{
    var query = db.Orders.Include(o => o.Items).Include(o => o.AssignedRider)
        .Where(o => o.BranchId == branchId).OrderByDescending(o => o.CreatedAt).AsQueryable();
    if (status.HasValue) query = query.Where(o => o.Status == status.Value);
    return Results.Ok(await query.Take(limit).ToListAsync());
});

// --- Void Order ---
api.MapPost("/orders/{id}/void", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] VoidOrderDto dto) =>
{
    var order = await db.Orders.Include(o => o.Items).FirstOrDefaultAsync(o => o.Id == id);
    if (order == null) return Results.NotFound();
    if (order.Status == OrderStatus.Cancelled) return Results.BadRequest(new { message = "Order already cancelled" });

    order.Status = OrderStatus.Cancelled;

    // Restore stock
    var productIds = order.Items.Select(i => i.ProductId).Distinct().ToList();
    var stockDict = await db.BranchStocks.Where(s => s.BranchId == order.BranchId && productIds.Contains(s.ProductId))
        .ToDictionaryAsync(s => s.ProductId);

    foreach (var item in order.Items)
    {
        if (stockDict.TryGetValue(item.ProductId, out var stock))
            stock.QuantityOnHand += item.Quantity;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Order voided and stock restored", orderId = order.Id });
});

// --- Kitchen Display ---
api.MapGet("/kitchen/tickets", async (AppDbContext db, Guid branchId, KitchenStation? station) =>
{
    var query = db.KitchenTickets
        .Include(k => k.Order).ThenInclude(o => o!.Items)
        .Where(k => k.BranchId == branchId && k.Status != "Completed")
        .OrderBy(k => k.CreatedAt).AsQueryable();
    if (station.HasValue) query = query.Where(k => k.Station == station.Value);
    return Results.Ok(await query.ToListAsync());
});

api.MapPost("/kitchen/tickets/{id}/status", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateTicketStatusDto dto) =>
{
    var ticket = await db.KitchenTickets.Include(k => k.Order).FirstOrDefaultAsync(k => k.Id == id);
    if (ticket == null) return Results.NotFound();
    ticket.Status = dto.Status;
    if (dto.Status == "Ready" && ticket.Order != null)
        ticket.Order.Status = OrderStatus.ReadyForDispatch;
    await db.SaveChangesAsync();
    return Results.Ok(ticket);
});

// --- Delivery ---
api.MapGet("/delivery/board", async (AppDbContext db, Guid branchId) =>
{
    var orders = await db.Orders.Include(o => o.Items).Include(o => o.AssignedRider)
        .Where(o => o.BranchId == branchId && (o.OrderType == OrderType.Delivery || o.OrderType == OrderType.CallOrder))
        .OrderByDescending(o => o.CreatedAt).ToListAsync();
    return Results.Ok(new
    {
        inKitchen = orders.Where(o => o.Status == OrderStatus.InKitchen || o.Status == OrderStatus.New),
        readyForDispatch = orders.Where(o => o.Status == OrderStatus.ReadyForDispatch),
        outForDelivery = orders.Where(o => o.Status == OrderStatus.OutForDelivery),
        completed = orders.Where(o => o.Status == OrderStatus.Completed).Take(10)
    });
});

api.MapPost("/delivery/assign-rider", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] AssignRiderDto dto) =>
{
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == dto.OrderId);
    if (order == null) return Results.NotFound(new { message = "Order not found" });
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId);
    if (rider == null) return Results.NotFound(new { message = "Rider not found" });
    order.AssignedRiderId = rider.Id;
    order.Status = OrderStatus.OutForDelivery;
    rider.IsAvailable = false;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Order assigned to {rider.Name}", order });
});

api.MapPost("/delivery/mark-delivered", async (AppDbContext db, Guid orderId) =>
{
    var order = await db.Orders.Include(o => o.AssignedRider).FirstOrDefaultAsync(o => o.Id == orderId);
    if (order == null) return Results.NotFound();
    order.Status = OrderStatus.Completed;
    order.IsPaid = true;
    if (order.AssignedRider != null) order.AssignedRider.IsAvailable = true;
    await db.SaveChangesAsync();
    return Results.Ok(order);
});

// --- Riders ---
api.MapGet("/riders", async (AppDbContext db, Guid branchId) =>
    Results.Ok(await db.Riders.Where(r => r.BranchId == branchId).ToListAsync()));

api.MapGet("/riders/{id}/pending-cod", async (AppDbContext db, Guid id) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == id);
    if (rider == null) return Results.NotFound();
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

api.MapPost("/riders/settle", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] SettleRiderDto dto) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId);
    if (rider == null) return Results.NotFound();
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

api.MapGet("/delivery/settlements", async (AppDbContext db, Guid branchId) =>
    Results.Ok(await db.RiderSettlements.Include(s => s.Rider).Where(s => s.BranchId == branchId)
        .OrderByDescending(s => s.SettledAt).Take(30).ToListAsync()));

// --- Call Order Lookup ---
api.MapGet("/call-order/lookup", async (AppDbContext db, string phone) =>
{
    var cleanPhone = phone.Trim();
    var pastOrders = await db.Orders.Include(o => o.Items)
        .Where(o => o.CustomerPhone != null && o.CustomerPhone.Contains(cleanPhone))
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
api.MapGet("/director/kpis", async (AppDbContext db, Guid? tenantId, Guid? branchId) =>
{
    var today = DateTime.UtcNow.Date;
    var ordersQuery = db.Orders.Where(o => o.CreatedAt >= today);
    if (tenantId.HasValue) ordersQuery = ordersQuery.Where(o => o.TenantId == tenantId.Value);
    if (branchId.HasValue) ordersQuery = ordersQuery.Where(o => o.BranchId == branchId.Value);

    var todayOrders = await ordersQuery.ToListAsync();
    var branches = await db.Branches.Where(b => !b.IsHeadOffice).ToListAsync();
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
});

// --- Super Admin ---
api.MapPost("/super-admin/update-limits", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] UpdateBranchLimitsDto dto) =>
{
    var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound();
    branch.AllowedCounters = dto.AllowedCounters;
    branch.AllowedOrderTabs = dto.AllowedOrderTabs;
    if (dto.Tier.HasValue && branch.Tenant != null) branch.Tenant.Tier = dto.Tier.Value;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Limits updated", branchId = branch.Id, allowedCounters = branch.AllowedCounters, allowedOrderTabs = branch.AllowedOrderTabs, tier = branch.Tenant?.Tier.ToString() });
});

// --- Terminal Device Management (Counters, Order Tabs, Kitchen Displays) ---
api.MapGet("/terminals", async (AppDbContext db, Guid? branchId) =>
{
    var q = db.Terminals.AsQueryable();
    if (branchId.HasValue) q = q.Where(t => t.BranchId == branchId.Value);
    var terminals = await q.OrderByDescending(t => t.LastSeenAt).ToListAsync();
    return Results.Ok(terminals.Select(t => new
    {
        t.Id, t.BranchId, t.TerminalName, t.TerminalType, t.DeviceToken, t.IsActive, t.LastSeenAt
    }));
});

api.MapPost("/terminals", async (AppDbContext db, CreateTerminalDto dto) =>
{
    var branch = await db.Branches.FindAsync(dto.BranchId);
    if (branch == null) return Results.BadRequest(new { error = "Branch not found" });

    var terminalCount = await db.Terminals.CountAsync(t => t.BranchId == dto.BranchId && t.TerminalType == dto.TerminalType);
    var limit = dto.TerminalType == TerminalType.OrderTab ? branch.AllowedOrderTabs : branch.AllowedCounters;
    if (terminalCount >= limit)
        return Results.BadRequest(new { error = $"Branch limit reached: max {limit} {dto.TerminalType} devices allowed" });

    var terminal = new Terminal
    {
        Id = Guid.NewGuid(),
        BranchId = dto.BranchId,
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

api.MapPut("/terminals/{id}", async (AppDbContext db, Guid id, UpdateTerminalDto dto) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });

    if (!string.IsNullOrWhiteSpace(dto.TerminalName)) terminal.TerminalName = dto.TerminalName.Trim();
    if (dto.IsActive.HasValue) terminal.IsActive = dto.IsActive.Value;
    terminal.LastSeenAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Terminal updated", terminal.Id, terminal.TerminalName, terminal.IsActive });
});

api.MapDelete("/terminals/{id}", async (AppDbContext db, Guid id) =>
{
    var terminal = await db.Terminals.FindAsync(id);
    if (terminal == null) return Results.NotFound(new { error = "Terminal not found" });
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
api.MapPost("/sync/offline-batch", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] List<CreateOrderDto> offlineOrders) =>
{
    int syncedCount = 0;
    foreach (var dto in offlineOrders)
    {
        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == dto.BranchId);
        if (branch == null) continue;

        var order = new Order
        {
            TenantId = branch.TenantId, BranchId = branch.Id,
            OrderNumber = await GenerateOrderNumberAsync(db, "OFFLINE"),
            OrderType = dto.OrderType, Status = OrderStatus.Completed,
            TableNumber = dto.TableNumber, CustomerName = dto.CustomerName, CustomerPhone = dto.CustomerPhone,
            DeliveryAddress = dto.DeliveryAddress, SubTotalPKR = dto.SubTotalPKR, DiscountPKR = dto.DiscountPKR,
            TaxPKR = dto.TaxPKR, TotalPKR = dto.TotalPKR, PaymentMethod = dto.PaymentMethod,
            AmountPaidPKR = dto.AmountPaidPKR, ChangeDuePKR = dto.ChangeDuePKR, IsPaid = true,
            CashierName = dto.CashierName ?? "Offline Cashier", CreatedByRole = "OfflineSync", CreatedAt = DateTime.UtcNow
        };

        foreach (var item in dto.Items)
        {
            order.Items.Add(new OrderItem
            {
                OrderId = order.Id, ProductId = item.ProductId, ProductName = item.ProductName,
                Quantity = item.Quantity, UnitPricePKR = item.UnitPricePKR,
                TotalPricePKR = item.UnitPricePKR * item.Quantity, Station = item.Station
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
api.MapGet("/cash-shifts", async (AppDbContext db, Guid branchId) =>
{
    var shifts = await db.CashShifts.Where(s => s.BranchId == branchId).OrderByDescending(s => s.OpenedAt).Take(20).ToListAsync();
    return Results.Ok(shifts);
});

api.MapPost("/cash-shifts/open", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] OpenCashShiftDto dto) =>
{
    var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == dto.BranchId && !s.IsClosed);
    if (activeShift != null) return Results.BadRequest(new { message = "An active shift already exists. Close it first." });

    var shift = new CashShift
    {
        BranchId = dto.BranchId, TerminalName = dto.TerminalName, CashierName = dto.CashierName,
        OpeningFloatPKR = dto.OpeningFloatPKR, OpenedAt = DateTime.UtcNow, IsClosed = false
    };
    db.CashShifts.Add(shift);
    await db.SaveChangesAsync();
    return Results.Ok(shift);
});

api.MapPost("/cash-shifts/{id}/close", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] CloseCashShiftDto dto) =>
{
    var shift = await db.CashShifts.FirstOrDefaultAsync(s => s.Id == id);
    if (shift == null) return Results.NotFound();
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
api.MapPost("/cash-shifts/{shiftId}/entries", async (AppDbContext db, Guid shiftId, CreateCashEntryDto dto) =>
{
    var shift = await db.CashShifts.FindAsync(shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
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

api.MapGet("/cash-shifts/{shiftId}/entries", async (AppDbContext db, Guid shiftId) =>
{
    var entries = await db.CashEntries
        .Where(e => e.CashShiftId == shiftId)
        .OrderByDescending(e => e.CreatedAt)
        .ToListAsync();
    return Results.Ok(entries);
});

api.MapDelete("/cash-shifts/{shiftId}/entries/{entryId}", async (AppDbContext db, Guid shiftId, Guid entryId) =>
{
    var shift = await db.CashShifts.FindAsync(shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });
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
api.MapGet("/reports/cash-sales", async (AppDbContext db, Guid branchId, string date) =>
{
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
});

// --- Card / Digital Sale Report ---
api.MapGet("/reports/card-sales", async (AppDbContext db, Guid branchId, string date) =>
{
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
});

// --- Cash Tally (End-of-Day Summary) ---
api.MapGet("/cash-shifts/{shiftId}/tally", async (AppDbContext db, Guid shiftId) =>
{
    var shift = await db.CashShifts
        .Include(s => s.Entries)
        .FirstOrDefaultAsync(s => s.Id == shiftId);
    if (shift == null) return Results.NotFound(new { error = "Cash shift not found" });

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
api.MapGet("/inventory", async (AppDbContext db, Guid branchId) =>
{
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
});

api.MapPost("/inventory/stock-in", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] StockInDto dto) =>
{
    var stock = await db.BranchStocks.Include(s => s.Product).FirstOrDefaultAsync(s => s.BranchId == dto.BranchId && s.ProductId == dto.ProductId);
    if (stock == null)
    {
        stock = new BranchStock { BranchId = dto.BranchId, ProductId = dto.ProductId, QuantityOnHand = dto.Quantity, MinAlertLevel = 10, BatchNumber = dto.BatchNumber, ExpiryDate = dto.ExpiryDate };
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
});

api.MapPost("/inventory/adjust", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] StockAdjustmentDto dto) =>
{
    var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == dto.BranchId && s.ProductId == dto.ProductId);
    if (stock == null) return Results.NotFound();
    stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand + dto.AdjustmentQty);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Stock adjusted: {dto.Reason}", productId = dto.ProductId, newQuantityOnHand = stock.QuantityOnHand });
});

// --- Raw Ingredients ---
api.MapGet("/inventory/ingredients", async (AppDbContext db, Guid branchId) =>
{
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
});

api.MapPost("/inventory/ingredients/stock-in", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] IngredientStockInDto dto) =>
{
    var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == dto.IngredientId && i.BranchId == dto.BranchId);
    if (ingredient == null) return Results.NotFound();
    ingredient.CurrentStock += dto.QuantityReceived;
    if (dto.NewCostPerUnitPKR.HasValue && dto.NewCostPerUnitPKR.Value > 0) ingredient.CostPerUnitPKR = dto.NewCostPerUnitPKR.Value;
    if (!string.IsNullOrEmpty(dto.SupplierName)) ingredient.SupplierName = dto.SupplierName;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Added +{dto.QuantityReceived} {ingredient.Unit} to {ingredient.Name}", ingredientId = ingredient.Id, newStock = ingredient.CurrentStock });
});

api.MapPost("/inventory/ingredients", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateIngredientDto dto) =>
{
    var ingredient = new Ingredient
    {
        BranchId = dto.BranchId, TenantId = dto.TenantId, Name = dto.Name,
        Category = dto.Category ?? "General", Unit = dto.Unit ?? "Piece",
        CostPerUnitPKR = dto.CostPerUnitPKR, CurrentStock = dto.InitialStock,
        MinAlertLevel = dto.MinAlertLevel, SupplierName = dto.SupplierName
    };
    db.Ingredients.Add(ingredient);
    await db.SaveChangesAsync();
    return Results.Ok(ingredient);
});

// --- Recipes ---
api.MapGet("/recipes/{productId}", async (AppDbContext db, Guid productId) =>
{
    var recipe = await db.ProductRecipeItems.Include(r => r.Ingredient).Where(r => r.ProductId == productId).ToListAsync();
    return Results.Ok(recipe.Select(r => new
    {
        id = r.Id, productId = r.ProductId, ingredientId = r.IngredientId,
        ingredientName = r.Ingredient?.Name ?? "Ingredient", ingredientCategory = r.Ingredient?.Category ?? "General",
        quantityRequired = r.QuantityRequired, unit = r.Unit, costPerUnitPKR = r.Ingredient?.CostPerUnitPKR ?? 0,
        estimatedCostPKR = Math.Round(r.QuantityRequired * (r.Ingredient?.CostPerUnitPKR ?? 0), 2)
    }));
});

api.MapPost("/recipes/{productId}", async (AppDbContext db, Guid productId, [Microsoft.AspNetCore.Mvc.FromBody] List<RecipeItemInputDto> items) =>
{
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
});

// --- Users (with PIN hashing) ---
api.MapGet("/users", async (AppDbContext db, Guid tenantId, Guid? branchId) =>
{
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
});

api.MapPost("/users", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateUserDto dto) =>
{
    var user = new AppUser
    {
        TenantId = dto.TenantId, BranchId = dto.BranchId, FullName = dto.FullName,
        Username = dto.Username.ToLower().Trim(),
        PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.PinCode ?? "1234"),
        Role = dto.Role, IsActive = true,
        CanViewFinancialReports = dto.CanViewFinancialReports, CanManageInventory = dto.CanManageInventory,
        CanManageMenuAndTax = dto.CanManageMenuAndTax, CanGiveDiscounts = dto.CanGiveDiscounts, CanVoidOrders = dto.CanVoidOrders
    };
    db.Users.Add(user);
    await db.SaveChangesAsync();
    return Results.Ok(new { user.Id, user.Username, user.Role });
});

api.MapPut("/users/{id}", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateUserDto dto) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id);
    if (user == null) return Results.NotFound();
    if (!string.IsNullOrEmpty(dto.FullName)) user.FullName = dto.FullName;
    if (dto.Role.HasValue) user.Role = dto.Role.Value;
    if (!string.IsNullOrEmpty(dto.PinCode)) user.PinCodeHash = BCrypt.Net.BCrypt.HashPassword(dto.PinCode);
    if (dto.IsActive.HasValue) user.IsActive = dto.IsActive.Value;
    if (dto.CanViewFinancialReports.HasValue) user.CanViewFinancialReports = dto.CanViewFinancialReports.Value;
    if (dto.CanManageInventory.HasValue) user.CanManageInventory = dto.CanManageInventory.Value;
    if (dto.CanManageMenuAndTax.HasValue) user.CanManageMenuAndTax = dto.CanManageMenuAndTax.Value;
    if (dto.CanGiveDiscounts.HasValue) user.CanGiveDiscounts = dto.CanGiveDiscounts.Value;
    if (dto.CanVoidOrders.HasValue) user.CanVoidOrders = dto.CanVoidOrders.Value;
    await db.SaveChangesAsync();
    return Results.Ok(user);
});

api.MapDelete("/users/{id}", async (AppDbContext db, Guid id) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id);
    if (user == null) return Results.NotFound();
    db.Users.Remove(user);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "User deleted successfully", id });
});

// --- Reports ---
api.MapGet("/reports/daily-z", async (AppDbContext db, Guid? branchId, DateTime? date) =>
{
    var targetBranchId = branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : await db.Branches.Select(b => b.Id).FirstOrDefaultAsync();
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
});

api.MapGet("/reports/sales-by-category", async (AppDbContext db, Guid? branchId, int? days) =>
{
    var targetBranchId = branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : await db.Branches.Select(b => b.Id).FirstOrDefaultAsync();
    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var items = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items).Include(i => i.Product).ThenInclude(p => p!.Category).ToListAsync();
    var totalRevenue = items.Sum(i => i.TotalPricePKR);
    return Results.Ok(items.GroupBy(i => new { Id = i.Product?.CategoryId ?? Guid.Empty, Name = i.Product?.Category?.Name ?? "Uncategorized" })
        .Select(g => { var gross = g.Sum(x => x.TotalPricePKR); return new { categoryId = g.Key.Id.ToString(), categoryName = g.Key.Name, quantitySold = g.Sum(x => x.Quantity), grossSalesPKR = gross, netSalesPKR = Math.Round(gross / 1.16m, 2), taxPKR = Math.Round(gross - (gross / 1.16m), 2), percentageOfTotal = totalRevenue > 0 ? Math.Round((gross / totalRevenue) * 100, 1) : 0 }; })
        .OrderByDescending(x => x.grossSalesPKR).ToList());
});

api.MapGet("/reports/item-performance", async (AppDbContext db, Guid? branchId, int? days) =>
{
    var targetBranchId = branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : await db.Branches.Select(b => b.Id).FirstOrDefaultAsync();
    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var items = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items).Include(i => i.Product).ThenInclude(p => p!.Category).ToListAsync();
    return Results.Ok(items.GroupBy(i => new { i.ProductId, i.ProductName, CategoryName = i.Product?.Category?.Name ?? "General", CostPrice = i.Product?.CostPricePKR ?? 0 })
        .Select(g => { var qty = g.Sum(x => x.Quantity); var rev = g.Sum(x => x.TotalPricePKR); var cost = g.Key.CostPrice * qty; var gp = rev - cost; return new { productId = g.Key.ProductId.ToString(), productName = g.Key.ProductName, categoryName = g.Key.CategoryName, quantitySold = qty, revenuePKR = rev, costPKR = cost, grossProfitPKR = gp, marginPercent = rev > 0 ? Math.Round((gp / rev) * 100, 1) : 0 }; })
        .OrderByDescending(x => x.revenuePKR).Take(25).ToList());
});

api.MapGet("/reports/tax-audit", async (AppDbContext db, Guid? branchId, int? days, DateTime? startDate, DateTime? endDate) =>
{
    var targetBranchId = branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : await db.Branches.Select(b => b.Id).FirstOrDefaultAsync();
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
        cashSegment = new { taxRatePercent = 16, invoiceCount = cashOrders.Count, grossSalesPKR = cashOrders.Sum(o => o.TotalPKR), taxCollectedPKR = cashOrders.Sum(o => o.TaxPKR) },
        cardSegment = new { taxRatePercent = 8, invoiceCount = cardOrders.Count, grossSalesPKR = cardOrders.Sum(o => o.TotalPKR), taxCollectedPKR = cardOrders.Sum(o => o.TaxPKR) }
    });
});

api.MapGet("/reports/payment-methods", async (AppDbContext db, Guid? branchId, int? days) =>
{
    var targetBranchId = branchId.HasValue && branchId.Value != Guid.Empty ? branchId.Value : await db.Branches.Select(b => b.Id).FirstOrDefaultAsync();
    var since = DateTime.UtcNow.Date.AddDays(-(days ?? 7));
    var orders = await db.Orders.Where(o => o.BranchId == targetBranchId && o.CreatedAt >= since && o.IsPaid).ToListAsync();
    var grandTotal = orders.Sum(o => o.TotalPKR);
    return Results.Ok(new
    {
        totalRevenuePKR = grandTotal, totalTransactions = orders.Count,
        tenders = orders.GroupBy(o => o.PaymentMethod).Select(g => { var total = g.Sum(x => x.TotalPKR); var count = g.Count(); return new { method = g.Key.ToString(), transactionCount = count, totalAmountPKR = total, percentageOfTotal = grandTotal > 0 ? Math.Round((total / grandTotal) * 100, 1) : 0, avgTicketPKR = count > 0 ? Math.Round(total / count, 2) : 0 }; }).OrderByDescending(x => x.totalAmountPKR).ToList()
    });
});

api.MapGet("/reports/consolidated", async (AppDbContext db, Guid? tenantId, int? days) =>
{
    var targetTenantId = tenantId.HasValue && tenantId.Value != Guid.Empty ? tenantId.Value : await db.Tenants.Select(t => t.Id).FirstOrDefaultAsync();
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
});

// --- Supply Chain ---
api.MapGet("/transfers", async (AppDbContext db, Guid? tenantId, Guid? branchId) =>
{
    var query = db.StockTransferOrders.Include(t => t.SourceBranch).Include(t => t.DestinationBranch).Include(t => t.Items).AsQueryable();
    if (tenantId.HasValue) query = query.Where(t => t.TenantId == tenantId.Value);
    if (branchId.HasValue) query = query.Where(t => t.SourceBranchId == branchId.Value || t.DestinationBranchId == branchId.Value);
    return Results.Ok(await query.OrderByDescending(t => t.RequestedAt).ToListAsync());
});

api.MapPost("/transfers", async (AppDbContext db, CreateTransferOrderDto dto) =>
{
    var transferNumber = await GenerateTransferNumberAsync(db);
    var order = new StockTransferOrder
    {
        TenantId = dto.TenantId, TransferNumber = transferNumber, SourceBranchId = dto.SourceBranchId,
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
});

api.MapPost("/transfers/{id}/dispatch", async (AppDbContext db, Guid id, DispatchTransferDto dto) =>
{
    var order = await db.StockTransferOrders.Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == id);
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
});

api.MapPost("/transfers/{id}/receive", async (AppDbContext db, Guid id, ReceiveTransferDto dto) =>
{
    var order = await db.StockTransferOrders.Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == id);
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
});

api.MapPost("/transfers/{id}/cancel", async (AppDbContext db, Guid id) =>
{
    var order = await db.StockTransferOrders.Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == id);
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
});

// --- Procurement ---
api.MapGet("/procurement/purchase-orders", async (AppDbContext db, Guid? tenantId, Guid? branchId) =>
{
    var query = db.PurchaseOrders.Include(p => p.Branch).Include(p => p.Items).AsQueryable();
    if (tenantId.HasValue) query = query.Where(p => p.TenantId == tenantId.Value);
    if (branchId.HasValue) query = query.Where(p => p.BranchId == branchId.Value);
    return Results.Ok(await query.OrderByDescending(p => p.CreatedAt).ToListAsync());
});

api.MapPost("/procurement/purchase-orders", async (AppDbContext db, CreatePODto dto) =>
{
    var poNumber = await GeneratePONumberAsync(db);
    var po = new PurchaseOrder
    {
        TenantId = dto.TenantId, BranchId = dto.BranchId, PONumber = poNumber,
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
});

api.MapPost("/procurement/purchase-orders/{id}/receive", async (AppDbContext db, Guid id, ReceivePODto dto) =>
{
    var po = await db.PurchaseOrders.Include(p => p.Items).FirstOrDefaultAsync(p => p.Id == id);
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
});

api.MapPost("/procurement/purchase-orders/{id}/cancel", async (AppDbContext db, Guid id) =>
{
    var po = await db.PurchaseOrders.FindAsync(id);
    if (po == null) return Results.NotFound("Purchase order not found");
    po.Status = POStatus.Cancelled;
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, status = "Cancelled" });
});

// --- Stock Request (Branch Manager -> Owner / Vendor / HQ) ---
api.MapGet("/stock-requests", async (AppDbContext db, Guid? branchId, string? status) =>
{
    var q = db.StockRequests
        .Include(sr => sr.Items)
        .ThenInclude(i => i.Ingredient)
        .AsQueryable();
    if (branchId.HasValue) q = q.Where(sr => sr.BranchId == branchId.Value);
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
});

api.MapPost("/stock-requests", async (AppDbContext db, CreateStockRequestDto dto) =>
{
    var branch = await db.Branches.FindAsync(dto.BranchId);
    if (branch == null) return Results.BadRequest(new { error = "Branch not found" });

    var seq = await db.StockRequests.CountAsync(sr => sr.TenantId == branch.TenantId) + 1;
    var request = new StockRequest
    {
        Id = Guid.NewGuid(),
        TenantId = branch.TenantId,
        BranchId = dto.BranchId,
        RequestNumber = $"SR-{seq:0000}",
        RequestType = dto.RequestType,
        VendorName = dto.VendorName,
        Notes = dto.Notes,
        EstimatedCostPKR = dto.Items.Sum(i => i.QuantityRequested * i.UnitCostPKR),
        CreatedBy = dto.CreatedBy,
        CreatedByUserId = dto.CreatedByUserId,
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

api.MapPut("/stock-requests/{id}/review", async (AppDbContext db, Guid id, ReviewStockRequestDto dto) =>
{
    var request = await db.StockRequests.FindAsync(id);
    if (request == null) return Results.NotFound(new { error = "Stock request not found" });

    request.Status = dto.Status;
    request.ReviewedBy = dto.ReviewedBy;
    request.ReviewedAt = DateTime.UtcNow;
    request.ReviewNotes = dto.ReviewNotes;
    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Request {dto.Status}", request.Id, request.Status });
});

api.MapDelete("/stock-requests/{id}", async (AppDbContext db, Guid id) =>
{
    var request = await db.StockRequests.FindAsync(id);
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

app.MapPost("/api/auth/signup", async (AppDbContext db, SignupDto dto) =>
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

app.MapPost("/api/admin/super-admin-login", async (AppDbContext db, LoginDto dto) =>
{
    // Fixed super admin credentials — platform owner only
    if (dto.Username != "superadmin" || dto.PinCode != "999999")
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

app.Run();


// DTOs
public record CreateOrderDto(Guid BranchId, OrderType OrderType, string? TableNumber, string? CustomerName, string? CustomerPhone, string? DeliveryAddress, decimal SubTotalPKR, decimal DiscountPKR, decimal TaxPKR, decimal TotalPKR, PaymentMethod PaymentMethod, decimal AmountPaidPKR, decimal ChangeDuePKR, bool IsPaid, string? CashierName, string? CreatedByRole, List<CreateOrderItemDto> Items);
public record CreateOrderItemDto(Guid ProductId, string ProductName, int Quantity, decimal UnitPricePKR, string? ModifiersSummary, string? SpecialNotes, KitchenStation Station);
public record UpdateTicketStatusDto(string Status);
public record AssignRiderDto(Guid OrderId, Guid RiderId);
public record SettleRiderDto(Guid RiderId, int TotalOrdersDelivered, decimal ExpectedCODPKR, decimal CashCollectedPKR, string? SettledBy);
public record UpdateBranchLimitsDto(Guid BranchId, int AllowedCounters, int AllowedOrderTabs, SubscriptionTier? Tier);
public record CreateProductDto(Guid TenantId, Guid CategoryId, string Name, string? UrduName, string? SKU, string? Barcode, string? Description, decimal CostPricePKR, decimal SellingPricePKR, string? Unit, KitchenStation Station, string? ImageUrl, List<CreateProductModifierDto>? Modifiers);
public record UpdateProductDto(Guid CategoryId, string? Name, string? UrduName, string? Barcode, decimal CostPricePKR, decimal SellingPricePKR, KitchenStation Station);
public record CreateCategoryDto(Guid TenantId, string Name, string? Icon, int SortOrder);
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



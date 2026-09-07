using System;
using System.Linq;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pos.Api.Data;
using Pos.Api.Models;

var builder = WebApplication.CreateBuilder(args);

// Configure JSON serialization to handle enums as strings and ignore circular references
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    options.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

// Add CORS for React Vite frontend
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://localhost:5174", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddOpenApi();

var app = builder.Build();

app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Auto-migrate & seed database
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    try
    {
        await db.Database.EnsureCreatedAsync();

        // Ensure Ingredients & ProductRecipeItems tables exist in Postgres
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
                ""SupplierName"" text
            );

            CREATE TABLE IF NOT EXISTS ""ProductRecipeItems"" (
                ""Id"" uuid PRIMARY KEY,
                ""ProductId"" uuid NOT NULL,
                ""IngredientId"" uuid NOT NULL,
                ""QuantityRequired"" numeric(18,2) NOT NULL,
                ""Unit"" text NOT NULL
            );
        ");

        await DbSeeder.SeedAsync(db);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Seeder Error / Note]: {ex.Message}");
    }
}

// --- Health / Status ---
app.MapGet("/", () => Results.Ok(new
{
    system = "Cashly POS - Enterprise API",
    version = "2.0.0",
    currency = "PKR",
    status = "Online",
    features = new[] { "Mode 1 Dispatch", "COD Rider Settlement", "Call Center Orders", "Offline Sync", "Director KPIs" }
}));

// --- Tenancy & Hierarchy Endpoints ---
app.MapGet("/api/tenants", async (AppDbContext db) =>
{
    var tenants = await db.Tenants
        .Include(t => t.Branches)
            .ThenInclude(b => b.Terminals)
        .Include(t => t.AddOns)
        .ToListAsync();
    return Results.Ok(tenants);
});

app.MapGet("/api/branches", async (AppDbContext db, Guid? tenantId) =>
{
    var query = db.Branches.Include(b => b.Terminals).AsQueryable();
    if (tenantId.HasValue) query = query.Where(b => b.TenantId == tenantId.Value);
    var branches = await query.ToListAsync();
    return Results.Ok(branches);
});

// --- Catalog & Inventory Endpoints ---
app.MapGet("/api/catalog/categories", async (AppDbContext db, Guid? tenantId) =>
{
    var query = db.Categories.OrderBy(c => c.SortOrder).AsQueryable();
    if (tenantId.HasValue) query = query.Where(c => c.TenantId == tenantId.Value);
    var categories = await query.ToListAsync();
    return Results.Ok(categories);
});

app.MapGet("/api/catalog/products", async (AppDbContext db, Guid? tenantId, Guid? categoryId, string? search, string? barcode) =>
{
    var query = db.Products
        .Include(p => p.Modifiers)
        .Include(p => p.Category)
        .Where(p => p.IsActive)
        .AsQueryable();

    if (tenantId.HasValue) query = query.Where(p => p.TenantId == tenantId.Value);
    if (categoryId.HasValue) query = query.Where(p => p.CategoryId == categoryId.Value);
    if (!string.IsNullOrWhiteSpace(barcode)) query = query.Where(p => p.Barcode == barcode.Trim());
    if (!string.IsNullOrWhiteSpace(search))
    {
        var s = search.Trim().ToLower();
        query = query.Where(p => p.Name.ToLower().Contains(s) || (p.UrduName != null && p.UrduName.Contains(s)) || p.Barcode.Contains(s) || p.SKU.ToLower().Contains(s));
    }

    var products = await query.ToListAsync();
    return Results.Ok(products);
});

app.MapPost("/api/catalog/products", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateProductDto dto) =>
{
    var product = new Product
    {
        TenantId = dto.TenantId,
        CategoryId = dto.CategoryId,
        Name = dto.Name,
        UrduName = dto.UrduName,
        SKU = string.IsNullOrWhiteSpace(dto.SKU) ? $"SKU-{Random.Shared.Next(1000, 9999)}" : dto.SKU,
        Barcode = string.IsNullOrWhiteSpace(dto.Barcode) ? $"{Random.Shared.NextInt64(1000000000, 9999999999)}" : dto.Barcode,
        Description = dto.Description ?? string.Empty,
        CostPricePKR = dto.CostPricePKR,
        SellingPricePKR = dto.SellingPricePKR,
        Unit = dto.Unit ?? "Piece",
        Station = dto.Station,
        ImageUrl = dto.ImageUrl,
        IsActive = true
    };

    if (dto.Modifiers != null)
    {
        foreach (var mod in dto.Modifiers)
        {
            product.Modifiers.Add(new ProductModifier
            {
                Name = mod.Name,
                PricePKR = mod.PricePKR
            });
        }
    }

    db.Products.Add(product);
    await db.SaveChangesAsync();
    return Results.Ok(product);
});

app.MapPut("/api/catalog/products/{id}", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateProductDto dto) =>
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

app.MapDelete("/api/catalog/products/{id}", async (AppDbContext db, Guid id) =>
{
    var product = await db.Products.FirstOrDefaultAsync(p => p.Id == id);
    if (product == null) return Results.NotFound();

    db.Products.Remove(product);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Product deleted successfully" });
});

app.MapPost("/api/catalog/categories", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var cat = new Category
    {
        TenantId = dto.TenantId,
        Name = dto.Name,
        Icon = dto.Icon ?? "utensils",
        SortOrder = dto.SortOrder
    };
    db.Categories.Add(cat);
    await db.SaveChangesAsync();
    return Results.Ok(cat);
});

app.MapPut("/api/catalog/categories/{id}", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] CreateCategoryDto dto) =>
{
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id);
    if (cat == null) return Results.NotFound();

    cat.Name = dto.Name;
    cat.Icon = dto.Icon ?? cat.Icon;
    cat.SortOrder = dto.SortOrder;

    await db.SaveChangesAsync();
    return Results.Ok(cat);
});

app.MapDelete("/api/catalog/categories/{id}", async (AppDbContext db, Guid id) =>
{
    var cat = await db.Categories.FirstOrDefaultAsync(c => c.Id == id);
    if (cat == null) return Results.NotFound();

    db.Categories.Remove(cat);
    await db.SaveChangesAsync();
    return Results.Ok(new { message = "Category deleted successfully" });
});



// --- Dining Tables ---
app.MapGet("/api/tables", async (AppDbContext db, Guid branchId) =>
{
    var tables = await db.DiningTables
        .Where(t => t.BranchId == branchId)
        .OrderBy(t => t.TableNumber)
        .ToListAsync();
    return Results.Ok(tables);
});

// --- Mode 1 Parallel Order Dispatch ---
app.MapPost("/api/orders", async (AppDbContext db, CreateOrderDto dto) =>
{
    var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound(new { message = "Branch not found" });

    var orderNumber = $"ORD-{DateTime.UtcNow:HHmmss}-{Random.Shared.Next(100, 999)}";
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
        CreatedByRole = dto.CreatedByRole ?? "Cashier",
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

    // MODE 1 BEST PRACTICE: Parallel Dispatch
    // 1. Immediately create Kitchen Order Tickets (KOT) for each kitchen station
    var stationGroups = order.Items.GroupBy(i => i.Station);
    int ticketIndex = 1;
    foreach (var group in stationGroups)
    {
        var kot = new KitchenTicket
        {
            OrderId = order.Id,
            BranchId = branch.Id,
            TicketNumber = $"KOT-{DateTime.UtcNow:mm}-{ticketIndex++}",
            Station = group.Key,
            Status = "Cooking",
            CreatedAt = DateTime.UtcNow
        };
        order.KitchenTickets.Add(kot);
    }

    // 2. If table is assigned, mark occupied
    if (!string.IsNullOrEmpty(dto.TableNumber))
    {
        var table = await db.DiningTables.FirstOrDefaultAsync(t => t.BranchId == branch.Id && t.TableNumber == dto.TableNumber);
        if (table != null)
        {
            table.IsOccupied = true;
            table.CurrentOrderId = order.Id;
        }
    }

    // 3. If paid in cash, update active shift cash sales
    if (dto.IsPaid && dto.PaymentMethod == PaymentMethod.Cash)
    {
        var activeShift = await db.CashShifts.FirstOrDefaultAsync(s => s.BranchId == branch.Id && !s.IsClosed);
        if (activeShift != null)
        {
            activeShift.CashSalesPKR += dto.TotalPKR;
            activeShift.ExpectedCashPKR = activeShift.OpeningFloatPKR + activeShift.CashSalesPKR;
        }
    }

    // 4. Deduct sold quantities from BranchStock AND Raw Ingredients (Recipe BOM) in real-time
    foreach (var item in dto.Items)
    {
        // A. Finished product stock (if tracked)
        var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == branch.Id && s.ProductId == item.ProductId);
        if (stock != null)
        {
            stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand - item.Quantity);
        }

        // B. Recipe raw ingredients (buns, patties, sauces, cheese, fries, etc.)
        var recipeItems = await db.ProductRecipeItems
            .Include(r => r.Ingredient)
            .Where(r => r.ProductId == item.ProductId)
            .ToListAsync();

        foreach (var recipe in recipeItems)
        {
            var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == recipe.IngredientId && i.BranchId == branch.Id);
            if (ingredient != null)
            {
                var totalIngredientQty = recipe.QuantityRequired * item.Quantity;
                ingredient.CurrentStock = Math.Max(0, ingredient.CurrentStock - totalIngredientQty);
            }
        }
    }

    db.Orders.Add(order);
    await db.SaveChangesAsync();



    return Results.Ok(new
    {
        message = "Order placed and dispatched via Mode 1 (Kitchen + Counter)",
        orderId = order.Id,
        orderNumber = order.OrderNumber,
        kitchenTicketsCount = order.KitchenTickets.Count,
        status = order.Status.ToString(),
        totalPKR = order.TotalPKR
    });
});

app.MapGet("/api/orders", async (AppDbContext db, Guid branchId, OrderStatus? status, int limit = 30) =>
{
    var query = db.Orders
        .Include(o => o.Items)
        .Include(o => o.AssignedRider)
        .Where(o => o.BranchId == branchId)
        .OrderByDescending(o => o.CreatedAt)
        .AsQueryable();

    if (status.HasValue)
    {
        query = query.Where(o => o.Status == status.Value);
    }

    var orders = await query.Take(limit).ToListAsync();
    return Results.Ok(orders);
});

// --- Mode 1 Kitchen KDS Endpoints ---
app.MapGet("/api/kitchen/tickets", async (AppDbContext db, Guid branchId, KitchenStation? station) =>
{
    var query = db.KitchenTickets
        .Include(k => k.Order)
            .ThenInclude(o => o!.Items)
        .Where(k => k.BranchId == branchId && k.Status != "Completed")
        .OrderBy(k => k.CreatedAt)
        .AsQueryable();

    if (station.HasValue) query = query.Where(k => k.Station == station.Value);
    var tickets = await query.ToListAsync();
    return Results.Ok(tickets);
});

app.MapPost("/api/kitchen/tickets/{id}/status", async (AppDbContext db, Guid id, [Microsoft.AspNetCore.Mvc.FromBody] UpdateTicketStatusDto dto) =>
{
    var ticket = await db.KitchenTickets.Include(k => k.Order).FirstOrDefaultAsync(k => k.Id == id);
    if (ticket == null) return Results.NotFound();

    ticket.Status = dto.Status;
    if (dto.Status == "Ready" && ticket.Order != null)
    {
        ticket.Order.Status = OrderStatus.ReadyForDispatch;
    }
    await db.SaveChangesAsync();
    return Results.Ok(ticket);
});

// --- Delivery Dispatch Board & Rider Assignment ---
app.MapGet("/api/delivery/board", async (AppDbContext db, Guid branchId) =>
{
    var orders = await db.Orders
        .Include(o => o.Items)
        .Include(o => o.AssignedRider)
        .Where(o => o.BranchId == branchId && (o.OrderType == OrderType.Delivery || o.OrderType == OrderType.CallOrder))
        .OrderByDescending(o => o.CreatedAt)
        .ToListAsync();

    var board = new
    {
        inKitchen = orders.Where(o => o.Status == OrderStatus.InKitchen || o.Status == OrderStatus.New),
        readyForDispatch = orders.Where(o => o.Status == OrderStatus.ReadyForDispatch),
        outForDelivery = orders.Where(o => o.Status == OrderStatus.OutForDelivery),
        completed = orders.Where(o => o.Status == OrderStatus.Completed).Take(10)
    };

    return Results.Ok(board);
});

app.MapPost("/api/delivery/assign-rider", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] AssignRiderDto dto) =>
{
    var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == dto.OrderId);
    if (order == null) return Results.NotFound(new { message = "Order not found" });

    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId);
    if (rider == null) return Results.NotFound(new { message = "Rider not found" });

    order.AssignedRiderId = rider.Id;
    order.Status = OrderStatus.OutForDelivery;
    rider.IsAvailable = false;

    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Order assigned to {rider.Name} and is now Out for Delivery", order });
});

app.MapPost("/api/delivery/mark-delivered", async (AppDbContext db, Guid orderId) =>
{
    var order = await db.Orders.Include(o => o.AssignedRider).FirstOrDefaultAsync(o => o.Id == orderId);
    if (order == null) return Results.NotFound();

    order.Status = OrderStatus.Completed;
    order.IsPaid = true;
    if (order.AssignedRider != null)
    {
        order.AssignedRider.IsAvailable = true;
    }
    await db.SaveChangesAsync();
    return Results.Ok(order);
});

// --- Riders & COD Cash Reconciliation ---
app.MapGet("/api/riders", async (AppDbContext db, Guid branchId) =>
{
    var riders = await db.Riders.Where(r => r.BranchId == branchId).ToListAsync();
    return Results.Ok(riders);
});

app.MapGet("/api/riders/{id}/pending-cod", async (AppDbContext db, Guid id) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == id);
    if (rider == null) return Results.NotFound();

    var activeOrders = await db.Orders
        .Where(o => o.AssignedRiderId == id && o.PaymentMethod == PaymentMethod.Cash && o.CreatedAt.Date == DateTime.UtcNow.Date)
        .ToListAsync();

    var totalCOD = activeOrders.Sum(o => o.TotalPKR);
    var completedCount = activeOrders.Count(o => o.Status == OrderStatus.Completed);
    var pendingCount = activeOrders.Count(o => o.Status == OrderStatus.OutForDelivery);

    return Results.Ok(new
    {
        riderId = rider.Id,
        riderName = rider.Name,
        phone = rider.Phone,
        vehicle = rider.VehicleNumber,
        totalOrders = activeOrders.Count,
        completedOrders = completedCount,
        pendingOrders = pendingCount,
        expectedCODPKR = totalCOD,
        orders = activeOrders.Select(o => new { o.Id, o.OrderNumber, o.TotalPKR, o.Status, o.CustomerName, o.DeliveryAddress })
    });
});

app.MapPost("/api/riders/settle", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] SettleRiderDto dto) =>
{
    var rider = await db.Riders.FirstOrDefaultAsync(r => r.Id == dto.RiderId);
    if (rider == null) return Results.NotFound();

    var variance = dto.CashCollectedPKR - dto.ExpectedCODPKR;
    var settlement = new RiderSettlement
    {
        BranchId = rider.BranchId,
        RiderId = rider.Id,
        ShiftDate = DateTime.UtcNow,
        TotalOrdersDelivered = dto.TotalOrdersDelivered,
        TotalCODExpectedPKR = dto.ExpectedCODPKR,
        TotalCashCollectedPKR = dto.CashCollectedPKR,
        ShortageSurplusPKR = variance,
        SettledBy = dto.SettledBy ?? "Manager",
        SettledAt = DateTime.UtcNow
    };

    rider.IsAvailable = true;
    db.RiderSettlements.Add(settlement);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        message = "Rider COD successfully settled and reconciled!",
        settlementId = settlement.Id,
        expected = dto.ExpectedCODPKR,
        collected = dto.CashCollectedPKR,
        variancePKR = variance,
        isReconciled = variance == 0
    });
});

// --- Phone Call Order Lookup ---
app.MapGet("/api/call-order/lookup", async (AppDbContext db, string phone) =>
{
    var cleanPhone = phone.Trim();
    var pastOrders = await db.Orders
        .Include(o => o.Items)
        .Where(o => o.CustomerPhone != null && o.CustomerPhone.Contains(cleanPhone))
        .OrderByDescending(o => o.CreatedAt)
        .Take(5)
        .ToListAsync();

    var customer = pastOrders.FirstOrDefault();
    if (customer == null)
    {
        return Results.Ok(new { found = false, phone = cleanPhone });
    }

    return Results.Ok(new
    {
        found = true,
        name = customer.CustomerName,
        phone = customer.CustomerPhone,
        lastAddress = customer.DeliveryAddress,
        totalPastOrders = pastOrders.Count,
        favoriteItems = pastOrders.SelectMany(o => o.Items).GroupBy(i => i.ProductName)
            .OrderByDescending(g => g.Count())
            .Take(3)
            .Select(g => g.Key),
        recentOrders = pastOrders.Select(o => new { o.OrderNumber, o.TotalPKR, o.CreatedAt, o.Status })
    });
});

// --- Director & Executive Real-Time Dashboard KPIs ---
app.MapGet("/api/director/kpis", async (AppDbContext db, Guid? tenantId, Guid? branchId) =>
{
    var ordersQuery = db.Orders.AsQueryable();
    if (tenantId.HasValue) ordersQuery = ordersQuery.Where(o => o.TenantId == tenantId.Value);
    if (branchId.HasValue) ordersQuery = ordersQuery.Where(o => o.BranchId == branchId.Value);

    var today = DateTime.UtcNow.Date;
    var todayOrders = await ordersQuery.Where(o => o.CreatedAt >= today).ToListAsync();

    var grossSalesPKR = todayOrders.Sum(o => o.TotalPKR);
    var totalOrdersCount = todayOrders.Count;
    var avgBasketPKR = totalOrdersCount > 0 ? grossSalesPKR / totalOrdersCount : 0;
    var completedOrders = todayOrders.Count(o => o.Status == OrderStatus.Completed);
    var activeOrders = todayOrders.Count(o => o.Status != OrderStatus.Completed && o.Status != OrderStatus.Cancelled);

    // Multi-branch comparison
    var branches = await db.Branches.Where(b => !b.IsHeadOffice).ToListAsync();
    var branchSales = branches.Select(b => new
    {
        branchId = b.Id,
        branchName = b.Name,
        city = b.City,
        todaySalesPKR = db.Orders.Where(o => o.BranchId == b.Id && o.CreatedAt >= today).Sum(o => (decimal?)o.TotalPKR) ?? 0,
        ordersCount = db.Orders.Count(o => o.BranchId == b.Id && o.CreatedAt >= today),
        activeCounters = b.AllowedCounters
    });

    return Results.Ok(new
    {
        currency = "PKR",
        todaySalesPKR = grossSalesPKR,
        totalOrders = totalOrdersCount,
        avgBasketPKR = Math.Round(avgBasketPKR, 0),
        activeOrders,
        completedOrders,
        branchComparison = branchSales
    });
});

// --- Super Admin Licensing & Quotas Switchboard ---
app.MapPost("/api/super-admin/update-limits", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] UpdateBranchLimitsDto dto) =>
{
    var branch = await db.Branches.Include(b => b.Tenant).FirstOrDefaultAsync(b => b.Id == dto.BranchId);
    if (branch == null) return Results.NotFound();

    branch.AllowedCounters = dto.AllowedCounters;
    branch.AllowedOrderTabs = dto.AllowedOrderTabs;

    if (dto.Tier.HasValue && branch.Tenant != null)
    {
        branch.Tenant.Tier = dto.Tier.Value;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        message = "Limits and licensing successfully updated by Super Admin",
        branchId = branch.Id,
        allowedCounters = branch.AllowedCounters,
        allowedOrderTabs = branch.AllowedOrderTabs,
        tier = branch.Tenant?.Tier.ToString()
    });
});

// --- Offline Batch Sync Endpoint ---
app.MapPost("/api/sync/offline-batch", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] List<CreateOrderDto> offlineOrders) =>
{
    int syncedCount = 0;
    foreach (var dto in offlineOrders)
    {
        var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == dto.BranchId);
        if (branch == null) continue;

        var order = new Order
        {
            TenantId = branch.TenantId,
            BranchId = branch.Id,
            OrderNumber = $"OFFLINE-{DateTime.UtcNow:mmss}-{Random.Shared.Next(100, 999)}",
            OrderType = dto.OrderType,
            Status = OrderStatus.Completed,
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
            IsPaid = true,
            CashierName = dto.CashierName ?? "Offline Cashier",
            CreatedByRole = "OfflineSync",
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
                Station = item.Station
            });
        }

        // Deduct branch stock for synced item
        foreach (var item in dto.Items)
        {
            var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == branch.Id && s.ProductId == item.ProductId);
            if (stock != null)
            {
                stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand - item.Quantity);
            }
        }

        db.Orders.Add(order);
        syncedCount++;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { message = $"Successfully synced {syncedCount} offline orders to cloud database", syncedCount });
});

// --- INVENTORY MANAGEMENT ENDPOINTS ---

// 1. Get branch inventory with low stock indicators
app.MapGet("/api/inventory", async (AppDbContext db, Guid branchId) =>
{
    var stocks = await db.BranchStocks
        .Include(s => s.Product)
        .ThenInclude(p => p!.Category)
        .Where(s => s.BranchId == branchId)
        .OrderBy(s => s.Product!.Name)
        .ToListAsync();

    // If branch doesn't have stocks initialized for some products, auto-initialize
    var branch = await db.Branches.FirstOrDefaultAsync(b => b.Id == branchId);
    if (branch != null)
    {
        var existingProductIds = stocks.Select(s => s.ProductId).ToHashSet();
        var missingProducts = await db.Products
            .Where(p => p.TenantId == branch.TenantId && !existingProductIds.Contains(p.Id))
            .ToListAsync();

        if (missingProducts.Any())
        {
            foreach (var p in missingProducts)
            {
                var newStock = new BranchStock
                {
                    BranchId = branchId,
                    ProductId = p.Id,
                    QuantityOnHand = 50,
                    MinAlertLevel = 10
                };
                db.BranchStocks.Add(newStock);
            }
            await db.SaveChangesAsync();

            // reload
            stocks = await db.BranchStocks
                .Include(s => s.Product)
                .ThenInclude(p => p!.Category)
                .Where(s => s.BranchId == branchId)
                .OrderBy(s => s.Product!.Name)
                .ToListAsync();
        }
    }

    var result = stocks.Select(s => new
    {
        id = s.Id,
        branchId = s.BranchId,
        productId = s.ProductId,
        productName = s.Product?.Name ?? "Item",
        sku = s.Product?.SKU ?? "",
        barcode = s.Product?.Barcode ?? "",
        categoryName = s.Product?.Category?.Name ?? "General",
        unit = s.Product?.Unit ?? "Piece",
        costPricePKR = s.Product?.CostPricePKR ?? 0,
        sellingPricePKR = s.Product?.SellingPricePKR ?? 0,
        quantityOnHand = s.QuantityOnHand,
        minAlertLevel = s.MinAlertLevel,
        batchNumber = s.BatchNumber,
        expiryDate = s.ExpiryDate?.ToString("yyyy-MM-dd"),
        isLowStock = s.QuantityOnHand <= s.MinAlertLevel
    });

    return Results.Ok(result);
});

// 2. Stock-In (Goods Received Note / Supplier replenishment)
app.MapPost("/api/inventory/stock-in", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] StockInDto dto) =>
{
    var stock = await db.BranchStocks
        .Include(s => s.Product)
        .FirstOrDefaultAsync(s => s.BranchId == dto.BranchId && s.ProductId == dto.ProductId);

    if (stock == null)
    {
        stock = new BranchStock
        {
            BranchId = dto.BranchId,
            ProductId = dto.ProductId,
            QuantityOnHand = dto.Quantity,
            MinAlertLevel = 10,
            BatchNumber = dto.BatchNumber,
            ExpiryDate = dto.ExpiryDate
        };
        db.BranchStocks.Add(stock);
    }
    else
    {
        stock.QuantityOnHand += dto.Quantity;
        if (!string.IsNullOrEmpty(dto.BatchNumber)) stock.BatchNumber = dto.BatchNumber;
        if (dto.ExpiryDate.HasValue) stock.ExpiryDate = dto.ExpiryDate.Value;
    }

    // Optionally update cost price if new purchase price is recorded
    if (dto.CostPricePKR.HasValue && dto.CostPricePKR.Value > 0 && stock.Product != null)
    {
        stock.Product.CostPricePKR = dto.CostPricePKR.Value;
    }

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        message = $"Successfully received {dto.Quantity} units into branch inventory",
        productId = dto.ProductId,
        newQuantityOnHand = stock.QuantityOnHand
    });
});

// 3. Stock Adjustment (Wastage, damage, physical stock audit correction)
app.MapPost("/api/inventory/adjust", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] StockAdjustmentDto dto) =>
{
    var stock = await db.BranchStocks.FirstOrDefaultAsync(s => s.BranchId == dto.BranchId && s.ProductId == dto.ProductId);
    if (stock == null) return Results.NotFound();

    stock.QuantityOnHand = Math.Max(0, stock.QuantityOnHand + dto.AdjustmentQty);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        message = $"Stock adjusted for reason: {dto.Reason}",
        productId = dto.ProductId,
        newQuantityOnHand = stock.QuantityOnHand
    });
});

// --- RAW INGREDIENTS & RECIPE BOM (Burger Buns, Patties, Sauces, Cheese, Fries) ---

// 4. Get raw ingredients for branch (with auto-seeder if empty)
app.MapGet("/api/inventory/ingredients", async (AppDbContext db, Guid branchId) =>
{
    var ingredients = await db.Ingredients
        .Where(i => i.BranchId == branchId)
        .OrderBy(i => i.Category)
        .ThenBy(i => i.Name)
        .ToListAsync();

    // Auto-seed realistic ingredients if branch is new
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

            // Auto-link first products to ingredients
            var products = await db.Products.Where(p => p.TenantId == branch.TenantId).ToListAsync();
            var bun = seedIngredients.First(i => i.Name.Contains("Buns"));
            var patty = seedIngredients.First(i => i.Name.Contains("Patty"));
            var cheese = seedIngredients.First(i => i.Name.Contains("Cheese Slices"));
            var sauce = seedIngredients.First(i => i.Name.Contains("Sauce"));
            var box = seedIngredients.First(i => i.Name.Contains("Box"));

            var burgerProduct = products.FirstOrDefault(p => p.Name.ToLower().Contains("burger"));
            if (burgerProduct != null && !await db.ProductRecipeItems.AnyAsync(r => r.ProductId == burgerProduct.Id))
            {
                db.ProductRecipeItems.AddRange(
                    new ProductRecipeItem { ProductId = burgerProduct.Id, IngredientId = bun.Id, QuantityRequired = 1, Unit = "Piece" },
                    new ProductRecipeItem { ProductId = burgerProduct.Id, IngredientId = patty.Id, QuantityRequired = 1, Unit = "Piece" },
                    new ProductRecipeItem { ProductId = burgerProduct.Id, IngredientId = cheese.Id, QuantityRequired = 1, Unit = "Slice" },
                    new ProductRecipeItem { ProductId = burgerProduct.Id, IngredientId = sauce.Id, QuantityRequired = 0.025m, Unit = "Litre" }, // 25ml
                    new ProductRecipeItem { ProductId = burgerProduct.Id, IngredientId = box.Id, QuantityRequired = 1, Unit = "Piece" }
                );
                await db.SaveChangesAsync();
            }
        }
    }

    var result = ingredients.Select(i => new
    {
        id = i.Id,
        branchId = i.BranchId,
        name = i.Name,
        category = i.Category,
        unit = i.Unit,
        costPerUnitPKR = i.CostPerUnitPKR,
        currentStock = i.CurrentStock,
        minAlertLevel = i.MinAlertLevel,
        supplierName = i.SupplierName,
        isLowStock = i.CurrentStock <= i.MinAlertLevel,
        totalValuationPKR = Math.Round(i.CurrentStock * i.CostPerUnitPKR, 2)
    });

    return Results.Ok(result);
});

// 5. Restock / Inward raw ingredient (e.g. Received 200 buns, 20kg chicken, 10kg cheese)
app.MapPost("/api/inventory/ingredients/stock-in", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] IngredientStockInDto dto) =>
{
    var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == dto.IngredientId && i.BranchId == dto.BranchId);
    if (ingredient == null) return Results.NotFound();

    ingredient.CurrentStock += dto.QuantityReceived;
    if (dto.NewCostPerUnitPKR.HasValue && dto.NewCostPerUnitPKR.Value > 0)
    {
        ingredient.CostPerUnitPKR = dto.NewCostPerUnitPKR.Value;
    }
    if (!string.IsNullOrEmpty(dto.SupplierName))
    {
        ingredient.SupplierName = dto.SupplierName;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        message = $"Added +{dto.QuantityReceived} {ingredient.Unit} to {ingredient.Name}",
        ingredientId = ingredient.Id,
        newStock = ingredient.CurrentStock
    });
});

// 6. Create or Add New Raw Ingredient
app.MapPost("/api/inventory/ingredients", async (AppDbContext db, [Microsoft.AspNetCore.Mvc.FromBody] CreateIngredientDto dto) =>
{
    var ingredient = new Ingredient
    {
        BranchId = dto.BranchId,
        TenantId = dto.TenantId,
        Name = dto.Name,
        Category = dto.Category ?? "General",
        Unit = dto.Unit ?? "Piece",
        CostPerUnitPKR = dto.CostPerUnitPKR,
        CurrentStock = dto.InitialStock,
        MinAlertLevel = dto.MinAlertLevel,
        SupplierName = dto.SupplierName
    };

    db.Ingredients.Add(ingredient);
    await db.SaveChangesAsync();
    return Results.Ok(ingredient);
});

// 7. Get Recipe (BOM) for a Product
app.MapGet("/api/recipes/{productId}", async (AppDbContext db, Guid productId) =>
{
    var recipe = await db.ProductRecipeItems
        .Include(r => r.Ingredient)
        .Where(r => r.ProductId == productId)
        .ToListAsync();

    var result = recipe.Select(r => new
    {
        id = r.Id,
        productId = r.ProductId,
        ingredientId = r.IngredientId,
        ingredientName = r.Ingredient?.Name ?? "Ingredient",
        ingredientCategory = r.Ingredient?.Category ?? "General",
        quantityRequired = r.QuantityRequired,
        unit = r.Unit,
        costPerUnitPKR = r.Ingredient?.CostPerUnitPKR ?? 0,
        estimatedCostPKR = Math.Round(r.QuantityRequired * (r.Ingredient?.CostPerUnitPKR ?? 0), 2)
    });

    return Results.Ok(result);
});

// 8. Save / Update Product Recipe (Link burger to bun, patty, sauce, etc.)
app.MapPost("/api/recipes/{productId}", async (AppDbContext db, Guid productId, [Microsoft.AspNetCore.Mvc.FromBody] List<RecipeItemInputDto> items) =>
{
    var existing = await db.ProductRecipeItems.Where(r => r.ProductId == productId).ToListAsync();
    db.ProductRecipeItems.RemoveRange(existing);

    decimal calculatedCost = 0;
    foreach (var item in items)
    {
        var ingredient = await db.Ingredients.FirstOrDefaultAsync(i => i.Id == item.IngredientId);
        var recipeItem = new ProductRecipeItem
        {
            ProductId = productId,
            IngredientId = item.IngredientId,
            QuantityRequired = item.QuantityRequired,
            Unit = item.Unit ?? ingredient?.Unit ?? "Piece"
        };
        db.ProductRecipeItems.Add(recipeItem);

        if (ingredient != null)
        {
            calculatedCost += recipeItem.QuantityRequired * ingredient.CostPerUnitPKR;
        }
    }

    // Auto update product cost price based on sum of raw materials!
    var product = await db.Products.FirstOrDefaultAsync(p => p.Id == productId);
    if (product != null && calculatedCost > 0)
    {
        product.CostPricePKR = Math.Round(calculatedCost, 2);
    }

    await db.SaveChangesAsync();
    return Results.Ok(new
    {
        message = $"Recipe updated with {items.Count} raw ingredients. Calculated product cost: ₨{Math.Round(calculatedCost, 2)}",
        productId,
        calculatedCostPKR = Math.Round(calculatedCost, 2)
    });
});


// --- REPORTS & AUDIT ENGINE ENDPOINTS ---

// 1. Z-Report: Daily Register Close & Cash Reconciliation
app.MapGet("/api/reports/daily-z", async (AppDbContext db, Guid branchId, DateTime? date) =>
{
    var targetDate = (date ?? DateTime.UtcNow).Date;
    var nextDate = targetDate.AddDays(1);

    var orders = await db.Orders
        .Include(o => o.Items)
        .Where(o => o.BranchId == branchId && o.CreatedAt >= targetDate && o.CreatedAt < nextDate && o.IsPaid)
        .ToListAsync();

    var cashOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.Cash).ToList();
    var cardOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.Card).ToList();
    var digitalOrders = orders.Where(o => o.PaymentMethod == PaymentMethod.JazzCash || o.PaymentMethod == PaymentMethod.EasyPaisa || o.PaymentMethod == PaymentMethod.Raast).ToList();

    var cashSales = cashOrders.Sum(o => o.TotalPKR);
    var cardSales = cardOrders.Sum(o => o.TotalPKR);
    var digitalSales = digitalOrders.Sum(o => o.TotalPKR);

    // Cash tax is 16%, Card tax is 8%
    var cashTax = cashOrders.Sum(o => o.TaxPKR);
    var cardTax = cardOrders.Sum(o => o.TaxPKR);
    var totalTax = orders.Sum(o => o.TaxPKR);

    var shift = await db.CashShifts
        .Where(s => s.BranchId == branchId && s.OpenedAt >= targetDate && s.OpenedAt < nextDate)
        .OrderByDescending(s => s.OpenedAt)
        .FirstOrDefaultAsync();

    var openingFloat = shift?.OpeningFloatPKR ?? 10000;
    var expectedCash = openingFloat + cashSales;
    var actualCash = shift?.ActualCashCountedPKR > 0 ? shift.ActualCashCountedPKR : expectedCash;
    var variance = actualCash - expectedCash;

    var dineInSales = orders.Where(o => o.OrderType == OrderType.DineIn).Sum(o => o.TotalPKR);
    var takeawaySales = orders.Where(o => o.OrderType == OrderType.Takeaway).Sum(o => o.TotalPKR);
    var deliverySales = orders.Where(o => o.OrderType == OrderType.Delivery || o.OrderType == OrderType.CallOrder).Sum(o => o.TotalPKR);

    return Results.Ok(new
    {
        period = targetDate.ToString("yyyy-MM-dd"),
        totalSalesPKR = orders.Sum(o => o.TotalPKR),
        totalOrders = orders.Count,
        cashSalesPKR = cashSales,
        cardSalesPKR = cardSales,
        digitalSalesPKR = digitalSales,
        cashTaxPKR = cashTax,
        cardTaxPKR = cardTax,
        totalTaxPKR = totalTax,
        openingFloatPKR = openingFloat,
        expectedCashInDrawerPKR = expectedCash,
        actualCashInDrawerPKR = actualCash,
        variancePKR = variance,
        dineInSalesPKR = dineInSales,
        takeawaySalesPKR = takeawaySales,
        deliverySalesPKR = deliverySales
    });
});

// 2. Sales by Category
app.MapGet("/api/reports/sales-by-category", async (AppDbContext db, Guid branchId, int? days) =>
{
    var numDays = days ?? 7;
    var since = DateTime.UtcNow.Date.AddDays(-numDays);

    var items = await db.Orders
        .Where(o => o.BranchId == branchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items)
        .Include(i => i.Product)
        .ThenInclude(p => p!.Category)
        .ToListAsync();

    var totalRevenue = items.Sum(i => i.TotalPricePKR);

    var grouped = items
        .GroupBy(i => new { Id = i.Product?.CategoryId ?? Guid.Empty, Name = i.Product?.Category?.Name ?? "Uncategorized" })
        .Select(g =>
        {
            var gross = g.Sum(x => x.TotalPricePKR);
            return new
            {
                categoryId = g.Key.Id.ToString(),
                categoryName = g.Key.Name,
                quantitySold = g.Sum(x => x.Quantity),
                grossSalesPKR = gross,
                netSalesPKR = Math.Round(gross / 1.16m, 2),
                taxPKR = Math.Round(gross - (gross / 1.16m), 2),
                percentageOfTotal = totalRevenue > 0 ? Math.Round((gross / totalRevenue) * 100, 1) : 0
            };
        })
        .OrderByDescending(x => x.grossSalesPKR)
        .ToList();

    return Results.Ok(grouped);
});

// 3. Top Products / Item Performance with gross margins
app.MapGet("/api/reports/item-performance", async (AppDbContext db, Guid branchId, int? days) =>
{
    var numDays = days ?? 7;
    var since = DateTime.UtcNow.Date.AddDays(-numDays);

    var items = await db.Orders
        .Where(o => o.BranchId == branchId && o.CreatedAt >= since && o.IsPaid)
        .SelectMany(o => o.Items)
        .Include(i => i.Product)
        .ThenInclude(p => p!.Category)
        .ToListAsync();

    var grouped = items
        .GroupBy(i => new
        {
            ProductId = i.ProductId,
            ProductName = i.ProductName,
            CategoryName = i.Product?.Category?.Name ?? "General",
            CostPrice = i.Product?.CostPricePKR ?? 0
        })
        .Select(g =>
        {
            var qty = g.Sum(x => x.Quantity);
            var rev = g.Sum(x => x.TotalPricePKR);
            var cost = g.Key.CostPrice * qty;
            var grossProfit = rev - cost;
            var margin = rev > 0 ? Math.Round((grossProfit / rev) * 100, 1) : 0;

            return new
            {
                productId = g.Key.ProductId.ToString(),
                productName = g.Key.ProductName,
                categoryName = g.Key.CategoryName,
                quantitySold = qty,
                revenuePKR = rev,
                costPKR = cost,
                grossProfitPKR = grossProfit,
                marginPercent = margin
            };
        })
        .OrderByDescending(x => x.revenuePKR)
        .Take(25)
        .ToList();

    return Results.Ok(grouped);
});

app.Run();


// DTOs
public record CreateOrderDto(
    Guid BranchId,
    OrderType OrderType,
    string? TableNumber,
    string? CustomerName,
    string? CustomerPhone,
    string? DeliveryAddress,
    decimal SubTotalPKR,
    decimal DiscountPKR,
    decimal TaxPKR,
    decimal TotalPKR,
    PaymentMethod PaymentMethod,
    decimal AmountPaidPKR,
    decimal ChangeDuePKR,
    bool IsPaid,
    string? CashierName,
    string? CreatedByRole,
    List<CreateOrderItemDto> Items
);

public record CreateOrderItemDto(
    Guid ProductId,
    string ProductName,
    int Quantity,
    decimal UnitPricePKR,
    string? ModifiersSummary,
    string? SpecialNotes,
    KitchenStation Station
);

public record UpdateTicketStatusDto(string Status);
public record AssignRiderDto(Guid OrderId, Guid RiderId);
public record SettleRiderDto(Guid RiderId, int TotalOrdersDelivered, decimal ExpectedCODPKR, decimal CashCollectedPKR, string? SettledBy);
public record UpdateBranchLimitsDto(Guid BranchId, int AllowedCounters, int AllowedOrderTabs, SubscriptionTier? Tier);


public record CreateProductDto(
    Guid TenantId,
    Guid CategoryId,
    string Name,
    string? UrduName,
    string? SKU,
    string? Barcode,
    string? Description,
    decimal CostPricePKR,
    decimal SellingPricePKR,
    string? Unit,
    KitchenStation Station,
    string? ImageUrl,
    List<CreateProductModifierDto>? Modifiers
);

public record UpdateProductDto(
    Guid CategoryId,
    string? Name,
    string? UrduName,
    string? Barcode,
    decimal CostPricePKR,
    decimal SellingPricePKR,
    KitchenStation Station
);

public record CreateCategoryDto(
    Guid TenantId,
    string Name,
    string? Icon,
    int SortOrder
);

public record CreateProductModifierDto(
    string Name,
    decimal PricePKR
);

public record StockInDto(
    Guid BranchId,
    Guid ProductId,
    decimal Quantity,
    string? SupplierName,
    decimal? CostPricePKR,
    string? BatchNumber,
    DateTime? ExpiryDate
);

public record StockAdjustmentDto(
    Guid BranchId,
    Guid ProductId,
    decimal AdjustmentQty,
    string Reason
);

public record IngredientStockInDto(
    Guid BranchId,
    Guid IngredientId,
    decimal QuantityReceived,
    decimal? NewCostPerUnitPKR,
    string? SupplierName
);

public record CreateIngredientDto(
    Guid BranchId,
    Guid TenantId,
    string Name,
    string? Category,
    string? Unit,
    decimal CostPerUnitPKR,
    decimal InitialStock,
    decimal MinAlertLevel,
    string? SupplierName
);

public record RecipeItemInputDto(
    Guid IngredientId,
    decimal QuantityRequired,
    string? Unit
);



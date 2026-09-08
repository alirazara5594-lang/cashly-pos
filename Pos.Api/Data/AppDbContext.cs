using Microsoft.EntityFrameworkCore;
using Pos.Api.Models;

namespace Pos.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<Terminal> Terminals => Set<Terminal>();
    public DbSet<AddOnSubscription> AddOnSubscriptions => Set<AddOnSubscription>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductModifier> ProductModifiers => Set<ProductModifier>();
    public DbSet<BranchStock> BranchStocks => Set<BranchStock>();
    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<ProductRecipeItem> ProductRecipeItems => Set<ProductRecipeItem>();
    public DbSet<DiningTable> DiningTables => Set<DiningTable>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<KitchenTicket> KitchenTickets => Set<KitchenTicket>();
    public DbSet<Rider> Riders => Set<Rider>();
    public DbSet<RiderSettlement> RiderSettlements => Set<RiderSettlement>();
    public DbSet<CashShift> CashShifts => Set<CashShift>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<StockTransferOrder> StockTransferOrders => Set<StockTransferOrder>();
    public DbSet<StockTransferItem> StockTransferItems => Set<StockTransferItem>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderItem> PurchaseOrderItems => Set<PurchaseOrderItem>();


    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        foreach (var property in modelBuilder.Model.GetEntityTypes()
            .SelectMany(t => t.GetProperties())
            .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
        {
            property.SetColumnType("decimal(18,2)");
        }
    }
}


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

        // Unique constraints
        modelBuilder.Entity<BranchStock>()
            .HasIndex(b => new { b.BranchId, b.ProductId })
            .IsUnique();

        modelBuilder.Entity<DiningTable>()
            .HasIndex(d => new { d.BranchId, d.TableNumber })
            .IsUnique();

        modelBuilder.Entity<AppUser>()
            .HasIndex(u => new { u.TenantId, u.Username })
            .IsUnique();

        // Performance indexes
        modelBuilder.Entity<Order>()
            .HasIndex(o => new { o.BranchId, o.CreatedAt });

        modelBuilder.Entity<Order>()
            .HasIndex(o => o.Status);

        modelBuilder.Entity<Order>()
            .HasIndex(o => o.OrderNumber);

        modelBuilder.Entity<OrderItem>()
            .HasIndex(oi => oi.ProductId);

        modelBuilder.Entity<Ingredient>()
            .HasIndex(i => i.BranchId);

        modelBuilder.Entity<Ingredient>()
            .HasIndex(i => new { i.BranchId, i.Name });

        modelBuilder.Entity<KitchenTicket>()
            .HasIndex(kt => new { kt.BranchId, kt.Status });

        modelBuilder.Entity<Product>()
            .HasIndex(p => new { p.TenantId, p.SKU });

        modelBuilder.Entity<Product>()
            .HasIndex(p => p.Barcode);

        modelBuilder.Entity<ProductRecipeItem>()
            .HasIndex(pr => pr.ProductId);

        modelBuilder.Entity<StockTransferOrder>()
            .HasIndex(st => new { st.TenantId, st.TransferNumber });

        modelBuilder.Entity<PurchaseOrder>()
            .HasIndex(po => new { po.TenantId, po.PONumber });

        // Foreign key relationships with delete behavior
        modelBuilder.Entity<Order>()
            .HasOne(o => o.Branch)
            .WithMany()
            .HasForeignKey(o => o.BranchId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Order>()
            .HasOne(o => o.AssignedRider)
            .WithMany()
            .HasForeignKey(o => o.AssignedRiderId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<OrderItem>()
            .HasOne(oi => oi.Order)
            .WithMany(o => o.Items)
            .HasForeignKey(oi => oi.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<OrderItem>()
            .HasOne(oi => oi.Product)
            .WithMany()
            .HasForeignKey(oi => oi.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<KitchenTicket>()
            .HasOne(kt => kt.Order)
            .WithMany(o => o.KitchenTickets)
            .HasForeignKey(kt => kt.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<BranchStock>()
            .HasOne(bs => bs.Branch)
            .WithMany(b => b.Stocks)
            .HasForeignKey(bs => bs.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<BranchStock>()
            .HasOne(bs => bs.Product)
            .WithMany()
            .HasForeignKey(bs => bs.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<DiningTable>()
            .HasOne(dt => dt.Branch)
            .WithMany(b => b.Tables)
            .HasForeignKey(dt => dt.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Terminal>()
            .HasOne(t => t.Branch)
            .WithMany(b => b.Terminals)
            .HasForeignKey(t => t.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Product>()
            .HasOne(p => p.Category)
            .WithMany(c => c.Products)
            .HasForeignKey(p => p.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<ProductModifier>()
            .HasOne(pm => pm.Product)
            .WithMany(p => p.Modifiers)
            .HasForeignKey(pm => pm.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ProductRecipeItem>()
            .HasOne(pr => pr.Product)
            .WithMany(p => p.RecipeItems)
            .HasForeignKey(pr => pr.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ProductRecipeItem>()
            .HasOne(pr => pr.Ingredient)
            .WithMany()
            .HasForeignKey(pr => pr.IngredientId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Rider>()
            .HasOne(r => r.Branch)
            .WithMany()
            .HasForeignKey(r => r.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<RiderSettlement>()
            .HasOne(rs => rs.Rider)
            .WithMany()
            .HasForeignKey(rs => rs.RiderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<CashShift>()
            .HasOne<CashShift>()
            .WithMany()
            .HasForeignKey(cs => cs.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<StockTransferOrder>()
            .HasOne(st => st.SourceBranch)
            .WithMany()
            .HasForeignKey(st => st.SourceBranchId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<StockTransferOrder>()
            .HasOne(st => st.DestinationBranch)
            .WithMany()
            .HasForeignKey(st => st.DestinationBranchId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<StockTransferItem>()
            .HasOne(sti => sti.TransferOrder)
            .WithMany(st => st.Items)
            .HasForeignKey(sti => sti.TransferOrderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<StockTransferItem>()
            .HasOne(sti => sti.Ingredient)
            .WithMany()
            .HasForeignKey(sti => sti.IngredientId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<PurchaseOrder>()
            .HasOne(po => po.Branch)
            .WithMany()
            .HasForeignKey(po => po.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PurchaseOrderItem>()
            .HasOne(poi => poi.PurchaseOrder)
            .WithMany(po => po.Items)
            .HasForeignKey(poi => poi.PurchaseOrderId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PurchaseOrderItem>()
            .HasOne(poi => poi.Ingredient)
            .WithMany()
            .HasForeignKey(poi => poi.IngredientId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<AddOnSubscription>()
            .HasOne(aos => aos.Tenant)
            .WithMany(t => t.AddOns)
            .HasForeignKey(aos => aos.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

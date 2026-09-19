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
    public DbSet<CashEntry> CashEntries => Set<CashEntry>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<StockTransferOrder> StockTransferOrders => Set<StockTransferOrder>();
    public DbSet<StockTransferItem> StockTransferItems => Set<StockTransferItem>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderItem> PurchaseOrderItems => Set<PurchaseOrderItem>();
    public DbSet<StockLedgerEntry> StockLedgerEntries => Set<StockLedgerEntry>();
    public DbSet<StockRequest> StockRequests => Set<StockRequest>();
    public DbSet<StockRequestItem> StockRequestItems => Set<StockRequestItem>();
    public DbSet<NotificationLog> NotificationLogs => Set<NotificationLog>();
    public DbSet<WhatsAppConfig> WhatsAppConfigs => Set<WhatsAppConfig>();
    public DbSet<SaaSPackageConfig> SaaSPackageConfigs => Set<SaaSPackageConfig>();
    public DbSet<ModulePermission> ModulePermissions => Set<ModulePermission>();
    public DbSet<SmartAlert> SmartAlerts => Set<SmartAlert>();
    public DbSet<TenantSettings> TenantSettings => Set<TenantSettings>();
    public DbSet<TaxJurisdiction> TaxJurisdictions => Set<TaxJurisdiction>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<GiftCard> GiftCards => Set<GiftCard>();
    public DbSet<GiftCardTransaction> GiftCardTransactions => Set<GiftCardTransaction>();
    public DbSet<LoyaltyProgramConfig> LoyaltyProgramConfigs => Set<LoyaltyProgramConfig>();
    public DbSet<PromoCode> PromoCodes => Set<PromoCode>();
    public DbSet<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();
    public DbSet<ExternalOrderMapping> ExternalOrderMappings => Set<ExternalOrderMapping>();
    public DbSet<StaffShiftSchedule> StaffShiftSchedules => Set<StaffShiftSchedule>();
    public DbSet<TimeClockEntry> TimeClockEntries => Set<TimeClockEntry>();
    public DbSet<PayrollPeriod> PayrollPeriods => Set<PayrollPeriod>();
    public DbSet<Payslip> Payslips => Set<Payslip>();
    public DbSet<PayslipLine> PayslipLines => Set<PayslipLine>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalLine> JournalLines => Set<JournalLine>();
    public DbSet<AccountingPeriod> AccountingPeriods => Set<AccountingPeriod>();
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();
    public DbSet<SubscriptionInvoice> SubscriptionInvoices => Set<SubscriptionInvoice>();
    public DbSet<SupplierPayment> SupplierPayments => Set<SupplierPayment>();

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
        modelBuilder.Entity<Tenant>()
            .HasIndex(t => t.Slug)
            .IsUnique();

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

        modelBuilder.Entity<StockRequest>()
            .HasIndex(sr => new { sr.TenantId, sr.RequestNumber });

        modelBuilder.Entity<StockRequest>()
            .HasIndex(sr => new { sr.BranchId, sr.Status });

        modelBuilder.Entity<NotificationLog>()
            .HasIndex(n => new { n.TenantId, n.SentAt });

        modelBuilder.Entity<NotificationLog>()
            .HasIndex(n => n.OrderId);

        modelBuilder.Entity<WhatsAppConfig>()
            .HasIndex(w => w.TenantId)
            .IsUnique();

        modelBuilder.Entity<SaaSPackageConfig>()
            .HasIndex(p => p.PackageKey)
            .IsUnique();

        modelBuilder.Entity<ModulePermission>()
            .HasIndex(mp => new { mp.UserId, mp.ModuleKey, mp.SubModuleKey })
            .IsUnique();

        modelBuilder.Entity<TenantSettings>()
            .HasIndex(ts => ts.TenantId)
            .IsUnique();

        modelBuilder.Entity<TaxJurisdiction>()
            .HasIndex(tj => new { tj.CountryCode, tj.RegionCode })
            .IsUnique();

        modelBuilder.Entity<AuditLog>()
            .HasIndex(al => new { al.TenantId, al.CreatedAt });

        // Unique constraints for document numbers (prevent duplicates from race conditions)
        modelBuilder.Entity<Order>()
            .HasIndex(o => o.OrderNumber)
            .IsUnique();

        modelBuilder.Entity<StockTransferOrder>()
            .HasIndex(st => st.TransferNumber)
            .IsUnique();

        modelBuilder.Entity<PurchaseOrder>()
            .HasIndex(po => po.PONumber)
            .IsUnique();

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

        // --- Suppliers & stock ledger ---

        modelBuilder.Entity<Supplier>()
            .HasIndex(s => new { s.TenantId, s.Name });

        modelBuilder.Entity<PurchaseOrder>()
            .HasOne(po => po.Supplier)
            .WithMany()
            .HasForeignKey(po => po.SupplierId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<StockLedgerEntry>()
            .HasIndex(sl => new { sl.BranchId, sl.IngredientId, sl.CreatedAt });

        modelBuilder.Entity<StockLedgerEntry>()
            .HasIndex(sl => new { sl.TenantId, sl.CreatedAt });

        modelBuilder.Entity<StockLedgerEntry>()
            .HasOne(sl => sl.Ingredient)
            .WithMany()
            .HasForeignKey(sl => sl.IngredientId)
            .OnDelete(DeleteBehavior.Restrict);

        // --- Payroll ---

        modelBuilder.Entity<PayrollPeriod>()
            .HasIndex(pp => new { pp.TenantId, pp.PeriodStart, pp.PeriodEnd });

        modelBuilder.Entity<Payslip>()
            .HasIndex(p => new { p.PayrollPeriodId, p.UserId })
            .IsUnique();

        modelBuilder.Entity<Payslip>()
            .HasOne(p => p.PayrollPeriod)
            .WithMany(pp => pp.Payslips)
            .HasForeignKey(p => p.PayrollPeriodId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Payslip>()
            .HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<PayslipLine>()
            .HasOne(pl => pl.Payslip)
            .WithMany(p => p.Lines)
            .HasForeignKey(pl => pl.PayslipId)
            .OnDelete(DeleteBehavior.Cascade);

        // --- Accounting ---

        modelBuilder.Entity<Account>()
            .HasIndex(a => new { a.TenantId, a.Code })
            .IsUnique();

        modelBuilder.Entity<Account>()
            .HasOne(a => a.ParentAccount)
            .WithMany()
            .HasForeignKey(a => a.ParentAccountId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<JournalEntry>()
            .HasIndex(j => new { j.TenantId, j.EntryNumber })
            .IsUnique();

        modelBuilder.Entity<JournalEntry>()
            .HasIndex(j => new { j.TenantId, j.EntryDate });

        modelBuilder.Entity<JournalLine>()
            .HasOne(jl => jl.JournalEntry)
            .WithMany(j => j.Lines)
            .HasForeignKey(jl => jl.JournalEntryId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<JournalLine>()
            .HasOne(jl => jl.Account)
            .WithMany()
            .HasForeignKey(jl => jl.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<JournalLine>()
            .HasIndex(jl => jl.AccountId);

        modelBuilder.Entity<AccountingPeriod>()
            .HasIndex(ap => new { ap.TenantId, ap.PeriodStart, ap.PeriodEnd });

        // --- Warehouses ---

        modelBuilder.Entity<Warehouse>()
            .HasIndex(w => new { w.BranchId, w.IsPrimary });

        modelBuilder.Entity<Warehouse>()
            .HasOne(w => w.Branch)
            .WithMany()
            .HasForeignKey(w => w.BranchId)
            .OnDelete(DeleteBehavior.Cascade);

        // --- Subscription billing ---

        modelBuilder.Entity<SubscriptionInvoice>()
            .HasIndex(si => new { si.TenantId, si.InvoiceNumber })
            .IsUnique();

        modelBuilder.Entity<SubscriptionInvoice>()
            .HasIndex(si => new { si.TenantId, si.IssuedAt });

        modelBuilder.Entity<SupplierPayment>()
            .HasIndex(sp => new { sp.SupplierId, sp.PaidAt });

        modelBuilder.Entity<SupplierPayment>()
            .HasOne(sp => sp.Supplier)
            .WithMany()
            .HasForeignKey(sp => sp.SupplierId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<AddOnSubscription>()
            .HasOne(aos => aos.Tenant)
            .WithMany(t => t.AddOns)
            .HasForeignKey(aos => aos.TenantId)
            .OnDelete(DeleteBehavior.Cascade);

        // --- CRM / loyalty / gift cards / promos / payments / delivery / labor ---

        modelBuilder.Entity<Customer>()
            .HasIndex(c => new { c.TenantId, c.Phone })
            .IsUnique();

        modelBuilder.Entity<Customer>()
            .HasIndex(c => new { c.TenantId, c.FullName });

        modelBuilder.Entity<GiftCard>()
            .HasIndex(g => g.CardCode)
            .IsUnique();

        modelBuilder.Entity<GiftCard>()
            .HasIndex(g => new { g.TenantId, g.IsActive });

        modelBuilder.Entity<GiftCardTransaction>()
            .HasIndex(gt => new { gt.GiftCardId, gt.CreatedAt });

        modelBuilder.Entity<GiftCardTransaction>()
            .HasIndex(gt => gt.OrderId);

        modelBuilder.Entity<LoyaltyProgramConfig>()
            .HasIndex(l => l.TenantId)
            .IsUnique();

        modelBuilder.Entity<PromoCode>()
            .HasIndex(p => new { p.TenantId, p.Code })
            .IsUnique();

        modelBuilder.Entity<PromoCode>()
            .HasIndex(p => new { p.TenantId, p.IsActive });

        modelBuilder.Entity<PaymentTransaction>()
            .HasIndex(pt => new { pt.TenantId, pt.RequestedAt });

        modelBuilder.Entity<PaymentTransaction>()
            .HasIndex(pt => pt.OrderId);

        modelBuilder.Entity<PaymentTransaction>()
            .HasIndex(pt => new { pt.BranchId, pt.Status });

        modelBuilder.Entity<PaymentTransaction>()
            .HasIndex(pt => pt.ProviderTransactionId);

        modelBuilder.Entity<ExternalOrderMapping>()
            .HasIndex(em => new { em.Platform, em.ExternalOrderId })
            .IsUnique();

        modelBuilder.Entity<ExternalOrderMapping>()
            .HasIndex(em => new { em.TenantId, em.ReceivedAt });

        modelBuilder.Entity<ExternalOrderMapping>()
            .HasIndex(em => em.InternalOrderId);

        modelBuilder.Entity<StaffShiftSchedule>()
            .HasIndex(s => new { s.BranchId, s.ScheduledStart });

        modelBuilder.Entity<StaffShiftSchedule>()
            .HasIndex(s => new { s.TenantId, s.UserId });

        modelBuilder.Entity<TimeClockEntry>()
            .HasIndex(t => new { t.BranchId, t.ClockInAt });

        modelBuilder.Entity<TimeClockEntry>()
            .HasIndex(t => new { t.UserId, t.ClockInAt });

        modelBuilder.Entity<GiftCardTransaction>()
            .HasOne(gt => gt.GiftCard)
            .WithMany()
            .HasForeignKey(gt => gt.GiftCardId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Order>()
            .HasOne(o => o.Customer)
            .WithMany()
            .HasForeignKey(o => o.CustomerId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<Order>()
            .HasOne(o => o.PromoCode)
            .WithMany()
            .HasForeignKey(o => o.PromoCodeId)
            .OnDelete(DeleteBehavior.SetNull);

        // Time records and published schedules survive a user being removed — never cascade.
        modelBuilder.Entity<TimeClockEntry>()
            .HasOne(t => t.User)
            .WithMany()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<StaffShiftSchedule>()
            .HasOne(s => s.User)
            .WithMany()
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

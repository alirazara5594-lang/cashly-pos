using System.Linq.Expressions;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pos.Api.Models;
using Pos.Api.Services;

namespace Pos.Api.Data;

public class AppDbContext : DbContext
{
    private readonly ITenantProvider? _tenantProvider;

    /// <summary>
    /// The tenant every query is implicitly scoped to. Guid.Empty means "no tenant scope" and
    /// disables the filter — that covers three legitimate cases: the SuperAdmin (whose token
    /// deliberately carries Guid.Empty), startup seeding, and design-time tooling. Every other
    /// caller is confined to their own rows whether the endpoint remembered to say so or not.
    /// </summary>
    private Guid CurrentTenantId => _tenantProvider?.TenantId ?? Guid.Empty;

    public AppDbContext(DbContextOptions<AppDbContext> options, ITenantProvider? tenantProvider = null)
        : base(options)
    {
        _tenantProvider = tenantProvider;
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
    public DbSet<CustomerPayment> CustomerPayments => Set<CustomerPayment>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Designation> Designations => Set<Designation>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<BankReconciliation> BankReconciliations => Set<BankReconciliation>();
    public DbSet<AddOnCatalogItem> AddOnCatalogItems => Set<AddOnCatalogItem>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    // --- Subscription / entitlements ---
    public DbSet<Plan> Plans => Set<Plan>();
    public DbSet<PlanFeature> PlanFeatures => Set<PlanFeature>();
    public DbSet<OrganizationSubscription> OrganizationSubscriptions => Set<OrganizationSubscription>();

    // --- Operations ---
    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<SyncCursor> SyncCursors => Set<SyncCursor>();
    public DbSet<SyncLog> SyncLogs => Set<SyncLog>();
    public DbSet<BusinessHost> BusinessHosts => Set<BusinessHost>();

    // --- Platform control plane ---
    public DbSet<PairingCode> PairingCodes => Set<PairingCode>();
    public DbSet<TenantEntitlementOverride> TenantEntitlementOverrides => Set<TenantEntitlementOverride>();
    public DbSet<TenantEntitlementSnapshot> TenantEntitlementSnapshots => Set<TenantEntitlementSnapshot>();
    public DbSet<TenantVerticalPack> TenantVerticalPacks => Set<TenantVerticalPack>();
    public DbSet<DeviceLicenseEvent> DeviceLicenseEvents => Set<DeviceLicenseEvent>();

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

        modelBuilder.Entity<CustomerPayment>()
            .HasIndex(cp => new { cp.CustomerId, cp.PaidAt });

        modelBuilder.Entity<CustomerPayment>()
            .HasOne(cp => cp.Customer)
            .WithMany()
            .HasForeignKey(cp => cp.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        // --- Departments / Designations ---

        modelBuilder.Entity<Department>()
            .HasIndex(d => new { d.TenantId, d.Name })
            .IsUnique();

        modelBuilder.Entity<Designation>()
            .HasIndex(d => new { d.TenantId, d.Name });

        modelBuilder.Entity<Designation>()
            .HasOne(d => d.Department)
            .WithMany()
            .HasForeignKey(d => d.DepartmentId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<AppUser>()
            .HasOne<Department>()
            .WithMany()
            .HasForeignKey(u => u.DepartmentId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<AppUser>()
            .HasOne<Designation>()
            .WithMany()
            .HasForeignKey(u => u.DesignationId)
            .OnDelete(DeleteBehavior.SetNull);

        // --- Leave requests ---

        modelBuilder.Entity<LeaveRequest>()
            .HasIndex(lr => new { lr.UserId, lr.Status });

        modelBuilder.Entity<LeaveRequest>()
            .HasOne(lr => lr.User)
            .WithMany()
            .HasForeignKey(lr => lr.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // --- Bank reconciliation ---

        modelBuilder.Entity<BankReconciliation>()
            .HasIndex(br => new { br.AccountId, br.StatementDate });

        modelBuilder.Entity<BankReconciliation>()
            .HasOne(br => br.Account)
            .WithMany()
            .HasForeignKey(br => br.AccountId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<AddOnCatalogItem>()
            .HasIndex(a => a.Key)
            .IsUnique();

        modelBuilder.Entity<AddOnSubscription>()
            .HasIndex(a => new { a.TenantId, a.AddOnKey });

        modelBuilder.Entity<RefreshToken>()
            .HasIndex(r => r.TokenHash)
            .IsUnique();

        modelBuilder.Entity<RefreshToken>()
            .HasIndex(r => new { r.UserId, r.RevokedAt, r.ExpiresAt });

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

        // --- Subscription indexes ---
        modelBuilder.Entity<Plan>().HasIndex(p => p.Code).IsUnique();
        modelBuilder.Entity<PlanFeature>().HasIndex(f => new { f.PlanId, f.FeatureCode }).IsUnique();
        modelBuilder.Entity<OrganizationSubscription>().HasIndex(s => s.TenantId);

        // --- Operations indexes ---
        modelBuilder.Entity<Expense>().HasIndex(e => new { e.TenantId, e.ExpenseDate });
        modelBuilder.Entity<Expense>().HasIndex(e => new { e.BranchId, e.Status });
        modelBuilder.Entity<Expense>().HasIndex(e => e.ExpenseNumber);
        modelBuilder.Entity<SyncLog>().HasIndex(s => new { s.TenantId, s.StartedAt });
        modelBuilder.Entity<SyncLog>().HasIndex(s => new { s.Status, s.StartedAt });
        modelBuilder.Entity<SyncLog>().HasIndex(s => s.BatchId);
        modelBuilder.Entity<SyncCursor>().HasIndex(c => new { c.TenantId, c.EntityType }).IsUnique();
        modelBuilder.Entity<BusinessHost>().HasIndex(h => h.HostCode).IsUnique();
        modelBuilder.Entity<BusinessHost>().HasIndex(h => new { h.TenantId, h.BranchId });

        // --- New platform-layer indexes ---
        modelBuilder.Entity<PairingCode>().HasIndex(p => p.CodeHash).IsUnique();
        modelBuilder.Entity<PairingCode>().HasIndex(p => new { p.TenantId, p.BranchId, p.ExpiresAt });
        modelBuilder.Entity<TenantEntitlementSnapshot>().HasIndex(s => s.TenantId).IsUnique();
        modelBuilder.Entity<TenantEntitlementOverride>().HasIndex(o => new { o.TenantId, o.Key });
        modelBuilder.Entity<TenantVerticalPack>().HasIndex(p => new { p.TenantId, p.PackKey }).IsUnique();
        modelBuilder.Entity<DeviceLicenseEvent>().HasIndex(e => new { e.TenantId, e.CreatedAt });
        modelBuilder.Entity<Terminal>().HasIndex(t => t.DeviceToken).IsUnique();
        modelBuilder.Entity<Terminal>().HasIndex(t => new { t.TenantId, t.BranchId, t.TerminalType });

        // Sync idempotency: a device-generated id may appear at most once per tenant, so a
        // retried offline batch cannot post the same sale twice. Filtered to non-null because
        // ordinary online orders have no client id and would otherwise all collide on NULL.
        modelBuilder.Entity<Order>()
            .HasIndex(o => new { o.TenantId, o.ClientLocalId })
            .IsUnique()
            .HasFilter("\"ClientLocalId\" IS NOT NULL");

        ApplyTenantIsolation(modelBuilder);
    }

    // ============================================================
    // TENANT ISOLATION — applied by the model, not by each endpoint.
    //
    // Isolation used to be ~200 hand-written .Where(x => x.TenantId == ...) clauses. That is
    // safe exactly as long as nobody ever forgets one, which is not a property a codebase can
    // keep. Here every entity carrying a TenantId gets a global query filter automatically, so
    // the DEFAULT is isolated and a cross-tenant read has to be asked for explicitly with
    // IgnoreQueryFilters(). The existing per-endpoint clauses stay: they are now redundant
    // rather than load-bearing, which is the right direction for a safety property.
    //
    // Deliberately NOT filtered: platform-wide catalogues (SaaSPackageConfig, AddOnCatalogItem,
    // TaxJurisdiction) which are the same for everyone, and child tables (OrderItem, JournalLine,
    // ...) which are reachable only through an already-filtered parent.
    // ============================================================
    private void ApplyTenantIsolation(ModelBuilder modelBuilder)
    {
        var applyMethod = typeof(AppDbContext)
            .GetMethod(nameof(ApplyTenantFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (entityType.BaseType != null) continue; // owned/derived types inherit the root's filter
            var tenantProperty = entityType.FindProperty("TenantId");
            if (tenantProperty == null || tenantProperty.ClrType != typeof(Guid)) continue;

            applyMethod.MakeGenericMethod(entityType.ClrType).Invoke(this, new object[] { modelBuilder });
        }
    }

    private void ApplyTenantFilter<TEntity>(ModelBuilder modelBuilder) where TEntity : class
    {
        // Referencing the CurrentTenantId instance property (rather than a captured local) is
        // what makes EF re-evaluate this per query instead of baking one tenant into the model.
        modelBuilder.Entity<TEntity>().HasQueryFilter(
            e => CurrentTenantId == Guid.Empty || EF.Property<Guid>(e, "TenantId") == CurrentTenantId);
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        base.ConfigureConventions(configurationBuilder);
    }

    /// <summary>
    /// Child tables (OrderItem, JournalLine, ...) intentionally have no filter of their own — they
    /// are only ever reached through a filtered parent. EF warns about that asymmetry on every
    /// required navigation, which would bury real warnings, so it is acknowledged once here.
    /// </summary>
    public static void ConfigureWarnings(DbContextOptionsBuilder options) =>
        options.ConfigureWarnings(w =>
            w.Ignore(CoreEventId.PossibleIncorrectRequiredNavigationWithQueryFilterInteractionWarning));
}

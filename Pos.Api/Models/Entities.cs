using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace Pos.Api.Models;

public enum BusinessType
{
    Restaurant = 1,
    Retail = 2,
    CashAndCarry = 3,
    Hybrid = 4
}

public enum SubscriptionTier
{
    Starter = 1,
    Standard = 2,
    Professional = 3
}

public enum TerminalType
{
    Counter = 1,
    OrderTab = 2,
    KitchenDisplay = 3
}

public enum OrderType
{
    DineIn = 1,
    Takeaway = 2,
    Delivery = 3,
    CallOrder = 4
}

public enum OrderStatus
{
    New = 1,
    InKitchen = 2,
    ReadyForDispatch = 3,
    OutForDelivery = 4,
    Completed = 5,
    Cancelled = 6
}

public enum PaymentMethod
{
    Cash = 1,
    Card = 2,
    JazzCash = 3,
    EasyPaisa = 4,
    Raast = 5,
    CustomerKhata = 6,
    Split = 7
}

public enum KitchenStation
{
    MainKitchen = 1,
    BeverageBar = 2,
    Grill = 3
}

public class Tenant
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty; // unique URL-safe identifier
    public string ContactName { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public string ContactPhone { get; set; } = string.Empty;
    public string? City { get; set; }
    public string? Address { get; set; }
    public BusinessType BusinessType { get; set; } = BusinessType.Restaurant;
    public SubscriptionTier Tier { get; set; } = SubscriptionTier.Starter;
    public bool IsActive { get; set; } = true;
    public bool IsTrialActive { get; set; } = true;
    public DateTime TrialEndsAt { get; set; } = DateTime.UtcNow.AddDays(30);
    public DateTime? SubscriptionPaidUntil { get; set; } // null = not paid yet
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Branch> Branches { get; set; } = new List<Branch>();
    public ICollection<AddOnSubscription> AddOns { get; set; } = new List<AddOnSubscription>();
    public TenantSettings? Settings { get; set; }
}

public class TenantSettings
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string CountryCode { get; set; } = "PK";
    public string CurrencyCode { get; set; } = "PKR";
    public string CurrencySymbol { get; set; } = "₨";
    public int DecimalPlaces { get; set; } = 0;
    public string TaxAuthorityName { get; set; } = "FBR";
    public decimal DefaultTaxRate { get; set; } = 16;
    public bool UseDualTaxRate { get; set; } = true;
    public decimal DigitalTaxRate { get; set; } = 8;
    public string PhoneCode { get; set; } = "+92";
    public string DefaultCity { get; set; } = "Islamabad";
    public string DateFormat { get; set; } = "dd/MM/yyyy";
    public string ReceiptFooter { get; set; } = "Thank you for your visit!";
    public string AllowedPaymentMethods { get; set; } = "Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata";

    /// <summary>
    /// When true, tax rates are resolved per-branch from <see cref="TaxJurisdiction"/> using
    /// Branch.RegionCode. When false, the flat per-tenant DefaultTaxRate/DigitalTaxRate apply.
    /// </summary>
    public bool UseProvincialTax { get; set; } = false;
}

/// <summary>
/// Editable provincial/state tax jurisdiction rates. Seeded with Pakistan defaults — these are
/// editable defaults for convenience, NOT verified legal advice.
/// </summary>
public class TaxJurisdiction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CountryCode { get; set; } = "PK";
    public string RegionCode { get; set; } = string.Empty; // e.g. PK-PB, PK-SD, PK-KP, PK-BA, PK-ICT
    public string AuthorityName { get; set; } = string.Empty;
    public decimal CashTaxRate { get; set; }
    public decimal DigitalTaxRate { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// Immutable trail of security/finance-sensitive actions (price changes, voids, overrides).
/// </summary>
public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty; // denormalized for display
    public string Action { get; set; } = string.Empty;   // PriceChanged, OrderVoided, PermissionChanged, ManagerOverride, ...
    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Branch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string City { get; set; } = "Islamabad";
    public string Phone { get; set; } = string.Empty;
    public bool IsHeadOffice { get; set; } = false;
    public string? RegionCode { get; set; } // e.g. PK-PB, PK-SD, PK-KP, PK-BA, PK-ICT — resolves provincial tax jurisdiction

    // Quotas (Starter: 1, Standard: 3, Pro: 5 base + add-ons)
    public int AllowedCounters { get; set; } = 5;
    public int AllowedOrderTabs { get; set; } = 15;

    public ICollection<Terminal> Terminals { get; set; } = new List<Terminal>();
    public ICollection<DiningTable> Tables { get; set; } = new List<DiningTable>();
    public ICollection<BranchStock> Stocks { get; set; } = new List<BranchStock>();
}

public class Terminal
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string TerminalName { get; set; } = string.Empty;
    public TerminalType TerminalType { get; set; } = TerminalType.Counter;
    public string DeviceToken { get; set; } = Guid.NewGuid().ToString("N");
    public bool IsActive { get; set; } = true;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
}

public class AddOnSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string AddOnKey { get; set; } = string.Empty; // e.g. "EXTRA_COUNTER", "EXTRA_TAB", "FBR_TAX"
    public int Quantity { get; set; } = 1;
    public decimal PricePKR { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? LocalName { get; set; }
    public string Icon { get; set; } = "utensils";
    public int SortOrder { get; set; }
    public ICollection<Product> Products { get; set; } = new List<Product>();
}

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }
    public string SKU { get; set; } = string.Empty;
    public string Barcode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? UrduName { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal CostPricePKR { get; set; }
    public decimal SellingPricePKR { get; set; }
    public string Unit { get; set; } = "Piece"; // Piece, Pack, Kg, Carton
    public string? ImageUrl { get; set; }
    public KitchenStation Station { get; set; } = KitchenStation.MainKitchen;
    public bool IsActive { get; set; } = true;

    public ICollection<ProductModifier> Modifiers { get; set; } = new List<ProductModifier>();
    public ICollection<ProductRecipeItem> RecipeItems { get; set; } = new List<ProductRecipeItem>();
}

public class ProductModifier
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string Name { get; set; } = string.Empty; // e.g. "Extra Cheese", "Spicy Dip"
    public decimal PricePKR { get; set; }
    public Guid? IngredientId { get; set; } // If modifier consumes raw ingredient (e.g. Extra Cheese Slice)
    public decimal? IngredientQty { get; set; }
}

public class Ingredient
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public string Name { get; set; } = string.Empty; // e.g. "Burger Buns", "Chicken Patty", "Cheese Slice"
    public string Category { get; set; } = "General"; // Buns, Meat/Patty, Dairy, Sauces, Produce, Packaging
    public string Unit { get; set; } = "Piece"; // Piece, Gram, Kg, Litre, Slice, Can
    public decimal CostPerUnitPKR { get; set; }
    public decimal CurrentStock { get; set; }
    public decimal MinAlertLevel { get; set; } = 20;
    public string? SupplierName { get; set; }
    [Timestamp]
    public byte[]? RowVersion { get; set; }
}

public class ProductRecipeItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public Guid IngredientId { get; set; }
    public Ingredient? Ingredient { get; set; }
    public decimal QuantityRequired { get; set; } // e.g. 1 bun, 1 patty, 25 grams sauce
    public string Unit { get; set; } = "Piece";
}

public class BranchStock
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public decimal QuantityOnHand { get; set; }
    public decimal MinAlertLevel { get; set; } = 10;
    public string? BatchNumber { get; set; }
    public DateTime? ExpiryDate { get; set; }
    [Timestamp]
    public byte[]? RowVersion { get; set; }
}


public class DiningTable
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string TableNumber { get; set; } = string.Empty;
    public string Section { get; set; } = "Main Hall"; // Main Hall, Terrace, Family Lounge
    public int Capacity { get; set; } = 4;
    public bool IsOccupied { get; set; } = false;
    public Guid? CurrentOrderId { get; set; }
}

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string OrderNumber { get; set; } = string.Empty;
    public OrderType OrderType { get; set; } = OrderType.DineIn;
    public OrderStatus Status { get; set; } = OrderStatus.New;
    public string? TableNumber { get; set; }
    
    // Customer / Delivery info
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? DeliveryAddress { get; set; }
    public Guid? AssignedRiderId { get; set; }
    public Rider? AssignedRider { get; set; }

    // Pricing in PKR
    public decimal SubTotalPKR { get; set; }
    public decimal DiscountPKR { get; set; }
    public decimal TaxPKR { get; set; }
    public decimal TotalPKR { get; set; }
    public PaymentMethod PaymentMethod { get; set; } = PaymentMethod.Cash;
    public decimal AmountPaidPKR { get; set; }
    public decimal ChangeDuePKR { get; set; }
    public bool IsPaid { get; set; } = false;

    public string? CashierName { get; set; }
    public string? CreatedByRole { get; set; } // Cashier, WaiterTab, OnlineWeb, CallCenter
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Stage timestamps (for prep-time / SLA analytics)
    public DateTime? InKitchenAt { get; set; }
    public DateTime? ReadyAt { get; set; }
    public DateTime? OutForDeliveryAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? CancelledAt { get; set; }

    // Fiscal / tax-authority e-invoicing (populated by IFiscalInvoiceProvider; null until configured)
    public string? FiscalInvoiceNumber { get; set; }
    public string? FiscalQrPayload { get; set; }

    // CRM / loyalty / gift-card linkage. All optional — a walk-in order with no linked Customer
    // record behaves exactly as before; CustomerName/CustomerPhone above remain the free-text fields.
    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public Guid? PromoCodeId { get; set; }
    public PromoCode? PromoCode { get; set; }
    /// <summary>
    /// Amount settled by gift card. Applied AFTER tax — it reduces what is owed through the
    /// order's payment method, it is not a tax-affecting discount.
    /// </summary>
    public decimal GiftCardRedeemedPKR { get; set; } = 0;

    public ICollection<OrderItem> Items { get; set; } = new List<OrderItem>();
    public ICollection<KitchenTicket> KitchenTickets { get; set; } = new List<KitchenTicket>();
}

public class OrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public Guid ProductId { get; set; }
    public Product? Product { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPricePKR { get; set; }
    public decimal TotalPricePKR { get; set; }
    public string? ModifiersSummary { get; set; }
    public string? SpecialNotes { get; set; }
    public KitchenStation Station { get; set; } = KitchenStation.MainKitchen;
}

public class KitchenTicket
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Order? Order { get; set; }
    public Guid BranchId { get; set; }
    public string TicketNumber { get; set; } = string.Empty;
    public KitchenStation Station { get; set; } = KitchenStation.MainKitchen;
    public string Status { get; set; } = "Pending"; // Pending, Cooking, Ready
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Rider
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string VehicleNumber { get; set; } = string.Empty;
    public bool IsAvailable { get; set; } = true;
}

public class RiderSettlement
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public Guid RiderId { get; set; }
    public Rider? Rider { get; set; }
    public DateTime ShiftDate { get; set; } = DateTime.UtcNow;
    public int TotalOrdersDelivered { get; set; }
    public decimal TotalCODExpectedPKR { get; set; }
    public decimal TotalCashCollectedPKR { get; set; }
    public decimal ShortageSurplusPKR { get; set; }
    public string SettledBy { get; set; } = string.Empty;
    public DateTime SettledAt { get; set; } = DateTime.UtcNow;
}

public class CashShift
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public string TerminalName { get; set; } = string.Empty;
    public string CashierName { get; set; } = string.Empty;
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public decimal OpeningFloatPKR { get; set; }
    public decimal CashSalesPKR { get; set; }
    public decimal CashReceivedPKR { get; set; } // Cash received from owner/personal
    public decimal CashPaidOutPKR { get; set; } // Cash paid to vendor/owner personal
    public decimal ExpectedCashPKR { get; set; }
    public decimal ActualCashCountedPKR { get; set; }
    public decimal VariancePKR { get; set; }
    public string? Notes { get; set; }
    public bool IsClosed { get; set; } = false;

    public ICollection<CashEntry> Entries { get; set; } = new List<CashEntry>();
}

public enum CashEntryType
{
    PaidOut = 1,      // Cash given to vendor, owner personal use
    Received = 2,     // Cash received from owner
    Adjustment = 3    // Manual adjustment
}

public class CashEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CashShiftId { get; set; }
    public CashShift? CashShift { get; set; }
    public CashEntryType EntryType { get; set; } = CashEntryType.PaidOut;
    public decimal AmountPKR { get; set; }
    public string Description { get; set; } = string.Empty; // e.g. "Paid to vendor for vegetables"
    public string? RecipientOrSource { get; set; } // Vendor name, owner name, etc.
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
}

public class NotificationLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? OrderId { get; set; }
    public string Channel { get; set; } = "whatsapp"; // whatsapp, sms
    public string RecipientPhone { get; set; } = string.Empty;
    public string MessageType { get; set; } = string.Empty; // order_placed, order_preparing, order_ready, order_delivered, receipt
    public string MessageBody { get; set; } = string.Empty;
    public string Status { get; set; } = "queued"; // queued, sent, delivered, failed
    public string? ProviderMessageId { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
}

public class WhatsAppConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Provider { get; set; } = "manual"; // manual, twilio, meta_api, whaticket
    public string? ApiKey { get; set; }
    public string? ApiSecret { get; set; }
    public string? PhoneNumberId { get; set; }
    public string? AccessToken { get; set; }
    public string? WebhookUrl { get; set; }
    public bool IsEnabled { get; set; } = false;
    public bool AutoSendOrderUpdates { get; set; } = true;
    public bool AutoSendReceipt { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SaaSPackageConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string PackageKey { get; set; } = string.Empty; // Starter, Standard, Professional
    public string DisplayName { get; set; } = string.Empty;
    public decimal MonthlyPricePKR { get; set; }
    public decimal YearlyPricePKR { get; set; }
    public int MaxBranches { get; set; }
    public int MaxCounters { get; set; }
    public int MaxOrderTabs { get; set; }
    public int MaxUsers { get; set; }
    public bool HasKitchenDisplay { get; set; }
    public bool HasDeliveryCOD { get; set; }
    public bool HasInventoryManagement { get; set; }
    public bool HasStockTransfers { get; set; }
    public bool HasDirectorDashboard { get; set; }
    public bool HasConsolidatedReports { get; set; }
    public bool HasWhatsAppMessaging { get; set; }
    public bool HasAdvancedReports { get; set; }
    public bool HasMultiBranch { get; set; }
    public int WhatsAppMessagesPerMonth { get; set; } // -1 = unlimited
    public bool IsActive { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class ModulePermission
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public string ModuleKey { get; set; } = string.Empty; // pos, kitchen, inventory, reports, etc.
    public string SubModuleKey { get; set; } = string.Empty; // e.g. pos.void, reports.tax, inventory.stock_in
    public bool CanView { get; set; } = false;
    public bool CanEdit { get; set; } = false;
    public bool CanDelete { get; set; } = false;
    public bool CanExport { get; set; } = false;
}

public class SmartAlert
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; }
    public string AlertType { get; set; } = string.Empty; // low_stock, unusual_sales, shift_reminder, peak_hour, daily_summary
    public string Severity { get; set; } = "info"; // info, warning, critical
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? Metadata { get; set; } // JSON for additional data
    public bool IsRead { get; set; } = false;
    public bool IsDismissed { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum UserRole
{
    SuperAdmin = 0,
    OwnerAdmin = 1,
    BranchManager = 2,
    Cashier = 3,
    KitchenChef = 4,
    Waiter = 5
}

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; } // null = all branches (Owner/Head Office)
    public string FullName { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string PinCodeHash { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Cashier;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Permissions flags
    public bool CanViewFinancialReports { get; set; } = false;
    public bool CanManageInventory { get; set; } = false;
    public bool CanManageMenuAndTax { get; set; } = false;
    public bool CanGiveDiscounts { get; set; } = false;
    public bool CanVoidOrders { get; set; } = false;

    // Account lockout after repeated failed PIN attempts (see /api/auth/login).
    public int FailedLoginAttempts { get; set; } = 0;
    public DateTime? LockedUntil { get; set; }

    // Payroll (additive — a walk-in/legacy user with none of this set simply isn't payroll-eligible).
    // Department/Designation are free-text here rather than their own master-data tables: this stays
    // consistent with how the rest of staff management already works (no separate Employee entity),
    // and can be promoted to real lookup tables later if HQ needs centrally-managed dropdowns.
    public string? Department { get; set; }
    public string? Designation { get; set; }
    public EmploymentType EmploymentType { get; set; } = EmploymentType.FullTime;
    /// <summary>Flat pay per payroll period when set (e.g. a fixed monthly period). Mutually exclusive with HourlyRatePKR in practice, not enforced.</summary>
    public decimal MonthlyRatePKR { get; set; } = 0;
    /// <summary>Used instead of MonthlyRatePKR when pay is computed from actual TimeClockEntry hours.</summary>
    public decimal HourlyRatePKR { get; set; } = 0;
    public string? BankAccountNumber { get; set; }
    public DateTime? JoiningDate { get; set; }
    public bool IsPayrollEligible { get; set; } = false;
    /// <summary>Optional link to real master data — when set, takes display precedence over the
    /// free-text Department/Designation strings above (which remain for backward compatibility).</summary>
    public Guid? DepartmentId { get; set; }
    public Guid? DesignationId { get; set; }
}

public enum EmploymentType
{
    FullTime = 1,
    PartTime = 2,
    Contract = 3
}

public enum TransferStatus
{
    Requested = 1,
    InTransit = 2,
    Received = 3,
    Cancelled = 4
}

public class StockTransferOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string TransferNumber { get; set; } = string.Empty; // e.g. "TR-1001"
    public Guid SourceBranchId { get; set; } // Central Commissary / Warehouse
    public Branch? SourceBranch { get; set; }
    public Guid DestinationBranchId { get; set; } // Receiving Outlet
    public Branch? DestinationBranch { get; set; }
    public TransferStatus Status { get; set; } = TransferStatus.Requested;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DispatchedAt { get; set; }
    public DateTime? ReceivedAt { get; set; }
    public string? DispatchedBy { get; set; }
    public string? ReceivedBy { get; set; }
    public string? VehicleOrDriver { get; set; }
    public string? Notes { get; set; }
    public decimal TotalEstimatedCostPKR { get; set; }

    public ICollection<StockTransferItem> Items { get; set; } = new List<StockTransferItem>();
}

public class StockTransferItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TransferOrderId { get; set; }
    public StockTransferOrder? TransferOrder { get; set; }
    public Guid IngredientId { get; set; }
    public Ingredient? Ingredient { get; set; }
    public string IngredientName { get; set; } = string.Empty;
    public string Unit { get; set; } = "Piece";
    public decimal QuantityRequested { get; set; }
    public decimal QuantityDispatched { get; set; }
    public decimal QuantityReceived { get; set; }
    public decimal UnitCostPKR { get; set; }
}

public enum POStatus
{
    Draft = 1,
    Ordered = 2,
    Received = 3,
    Cancelled = 4
}

public class Supplier
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? ContactName { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Address { get; set; }
    public string? TaxNumber { get; set; } // NTN / STRN etc.
    public string? PaymentTerms { get; set; } // e.g. "Net 30", "Cash on Delivery"
    /// <summary>Amount owed to this supplier when the record was created (migrating an existing balance in).</summary>
    public decimal OpeningBalancePKR { get; set; } = 0;
    /// <summary>Running payable balance — increases on invoice, decreases on payment. Server-maintained only.</summary>
    public decimal CurrentBalancePKR { get; set; } = 0;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class PurchaseOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string PONumber { get; set; } = string.Empty; // e.g. "PO-501"
    /// <summary>Denormalized display name — kept even after linking SupplierId so historical POs
    /// still render correctly if a supplier is later renamed or deactivated.</summary>
    public string SupplierName { get; set; } = string.Empty;
    public Guid? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }
    public POStatus Status { get; set; } = POStatus.Ordered;
    public decimal TotalCostPKR { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReceivedAt { get; set; }
    public string? ReceivedBy { get; set; }
    public string? Notes { get; set; }

    public ICollection<PurchaseOrderItem> Items { get; set; } = new List<PurchaseOrderItem>();
}

public class PurchaseOrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PurchaseOrderId { get; set; }
    public PurchaseOrder? PurchaseOrder { get; set; }
    public Guid IngredientId { get; set; }
    public Ingredient? Ingredient { get; set; }
    public string IngredientName { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public string Unit { get; set; } = "Piece";
    public decimal UnitCostPKR { get; set; }
    public decimal TotalPKR { get; set; }
}

public enum StockRequestType
{
    ToOwner = 1,   // Single Restaurant: BM sends to Owner for approval
    ToVendor = 2,  // Single Restaurant: BM contacts vendor directly
    ToHQ = 3       // Multi-Branch: BM always sends to HQ
}

public enum StockRequestStatus
{
    Pending = 1,
    Approved = 2,
    Rejected = 3,
    Ordered = 4,    // Vendor has been contacted / order placed
    Fulfilled = 5   // Stock received
}

public class StockRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string RequestNumber { get; set; } = string.Empty; // e.g. "SR-1001"
    public StockRequestType RequestType { get; set; } = StockRequestType.ToOwner;
    public StockRequestStatus Status { get; set; } = StockRequestStatus.Pending;
    public string? VendorName { get; set; } // filled if ToVendor
    public string? Notes { get; set; }
    public decimal EstimatedCostPKR { get; set; }
    public string CreatedBy { get; set; } = string.Empty; // BM name
    public Guid? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? ReviewedBy { get; set; } // Owner/HQ name
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewNotes { get; set; }

    public ICollection<StockRequestItem> Items { get; set; } = new List<StockRequestItem>();
}

public class StockRequestItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StockRequestId { get; set; }
    public StockRequest? StockRequest { get; set; }
    public Guid IngredientId { get; set; }
    public Ingredient? Ingredient { get; set; }
    public string IngredientName { get; set; } = string.Empty;
    public string Unit { get; set; } = "Piece";
    public decimal QuantityRequested { get; set; }
    public decimal CurrentStock { get; set; } // snapshot at request time
    public decimal UnitCostPKR { get; set; }
}

/// <summary>
/// Every stock movement, in order, for a given ingredient — the audit trail that
/// <see cref="Ingredient.CurrentStock"/> alone can't provide. That field stays as the fast
/// current-balance cache existing code already reads; this table is additive, written
/// alongside every mutation of it so the balance can always be reconstructed/audited.
/// </summary>
public enum StockMovementType
{
    PurchaseReceipt = 1,
    SaleConsumption = 2,
    TransferOut = 3,
    TransferIn = 4,
    Adjustment = 5,
    Waste = 6,
    OpeningBalance = 7,
    StockCount = 8
}

public class StockLedgerEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid IngredientId { get; set; }
    public Ingredient? Ingredient { get; set; }
    public StockMovementType MovementType { get; set; }
    /// <summary>Signed — positive for stock in, negative for stock out.</summary>
    public decimal QuantityChange { get; set; }
    public decimal UnitCostPKR { get; set; }
    /// <summary>Running balance snapshot immediately after this entry, for fast history reads without re-summing.</summary>
    public decimal BalanceAfter { get; set; }
    public string? ReferenceType { get; set; } // "PurchaseOrder", "StockTransfer", "Order", "Adjustment"
    public Guid? ReferenceId { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
}


// ============================================================
// CRM / Loyalty / Gift cards / Promotions
// ============================================================

public class Customer
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Email { get; set; }
    public int LoyaltyPoints { get; set; } = 0;
    public int TotalVisits { get; set; } = 0;
    public decimal TotalSpentPKR { get; set; } = 0;
    /// <summary>Amount owed on a CustomerKhata (pay-later) tab. Increases when an order is settled
    /// via CustomerKhata, decreases via CustomerPayment — mirrors Supplier.CurrentBalancePKR.</summary>
    public decimal CurrentBalancePKR { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastVisitAt { get; set; }
}

public class GiftCard
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string CardCode { get; set; } = string.Empty; // 8-16 char alphanumeric, globally unique
    public decimal InitialBalancePKR { get; set; }
    public decimal CurrentBalancePKR { get; set; }
    public Guid? IssuedToCustomerId { get; set; }
    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
    public bool IsActive { get; set; } = true;
}

public enum GiftCardTransactionType
{
    Issue = 1,
    Redeem = 2,
    Reload = 3,
    Adjustment = 4
}

public class GiftCardTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid GiftCardId { get; set; }
    public GiftCard? GiftCard { get; set; }
    public Guid? OrderId { get; set; }
    public GiftCardTransactionType Type { get; set; } = GiftCardTransactionType.Issue;
    public decimal AmountPKR { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
}

/// <summary>
/// One row per tenant (like <see cref="TenantSettings"/>), lazily created on first access.
/// Units: PointsPerPKRSpent is "points earned per 100 PKR spent"; PKRValuePerPoint is the
/// redemption value of a single point in PKR.
/// </summary>
public class LoyaltyProgramConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public bool IsEnabled { get; set; } = false;
    public decimal PointsPerPKRSpent { get; set; } = 1;  // 1 point per 100 PKR spent
    public decimal PKRValuePerPoint { get; set; } = 1;   // 1 point = 1 PKR off
    public int MinRedeemPoints { get; set; } = 100;
}

public enum PromoDiscountType
{
    Percent = 1,
    Fixed = 2
}

public class PromoCode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Code { get; set; } = string.Empty; // stored uppercase, unique per tenant
    public PromoDiscountType DiscountType { get; set; } = PromoDiscountType.Percent;
    public decimal DiscountValue { get; set; }
    public decimal MinOrderAmountPKR { get; set; } = 0;
    public int? MaxUsesTotal { get; set; }
    public int? MaxUsesPerCustomer { get; set; }
    public int UsesCount { get; set; } = 0;
    public DateTime ValidFrom { get; set; } = DateTime.UtcNow;
    public DateTime? ValidUntil { get; set; }
    public bool IsActive { get; set; } = true;
}

// ============================================================
// Payments
// ============================================================

public enum PaymentProvider
{
    JazzCash = 1,
    EasyPaisa = 2,
    Card = 3,
    Cash = 4
}

public enum PaymentTransactionStatus
{
    Pending = 1,
    Completed = 2,
    Failed = 3,
    Refunded = 4
}

public class PaymentTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid OrderId { get; set; }
    public PaymentProvider Provider { get; set; } = PaymentProvider.Cash;
    public string? ProviderTransactionId { get; set; }
    public PaymentTransactionStatus Status { get; set; } = PaymentTransactionStatus.Pending;
    public decimal AmountPKR { get; set; }
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? RawResponsePayload { get; set; }
    public string? FailureReason { get; set; }
}

// ============================================================
// Delivery-platform integration
// ============================================================

public enum DeliveryPlatform
{
    Foodpanda = 1,
    Other = 99
}

public class ExternalOrderMapping
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public DeliveryPlatform Platform { get; set; } = DeliveryPlatform.Foodpanda;
    public string ExternalOrderId { get; set; } = string.Empty;
    public Guid InternalOrderId { get; set; }
    public string RawPayload { get; set; } = string.Empty;
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
}

// ============================================================
// Labor: scheduling + time clock
// ============================================================

public class StaffShiftSchedule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTime ScheduledStart { get; set; }
    public DateTime ScheduledEnd { get; set; }
    public string Position { get; set; } = string.Empty; // Cashier, Chef, Waiter, Rider, ...
    public string? Notes { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}

public class TimeClockEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTime ClockInAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClockOutAt { get; set; }
    public Guid? LinkedCashShiftId { get; set; }
    public decimal? HoursWorked { get; set; }
}

// ============================================================
// Payroll — built on top of AppUser (no separate Employee master) and the
// TimeClockEntry hours already being recorded above.
// ============================================================

public enum PayrollPeriodStatus
{
    Open = 1,       // still accruing; payslips not yet generated
    Generated = 2,  // draft payslips exist, can still be adjusted
    Finalized = 3,  // locked — payslips are no longer editable, only payable
    Paid = 4        // all payslips in the period have been marked paid
}

public class PayrollPeriod
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }
    public PayrollPeriodStatus Status { get; set; } = PayrollPeriodStatus.Open;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? GeneratedAt { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public string? Notes { get; set; }

    public ICollection<Payslip> Payslips { get; set; } = new List<Payslip>();
}

public enum PayslipStatus
{
    Draft = 1,
    Finalized = 2,
    Paid = 3
}

public class Payslip
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public Guid PayrollPeriodId { get; set; }
    public PayrollPeriod? PayrollPeriod { get; set; }

    public decimal HoursWorked { get; set; }
    public decimal BasicPayPKR { get; set; }
    public decimal TotalAllowancesPKR { get; set; } = 0;
    public decimal TotalDeductionsPKR { get; set; } = 0;
    public decimal NetPayPKR { get; set; }

    public PayslipStatus Status { get; set; } = PayslipStatus.Draft;
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PaidAt { get; set; }
    public string? PaymentMethod { get; set; }
    public string? Notes { get; set; }

    public ICollection<PayslipLine> Lines { get; set; } = new List<PayslipLine>();
}

public enum PayslipLineType
{
    Allowance = 1,
    Deduction = 2,
    Overtime = 3
}

public class PayslipLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PayslipId { get; set; }
    public Payslip? Payslip { get; set; }
    public PayslipLineType Type { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal AmountPKR { get; set; }
}

// ============================================================
// Accounting — proper double-entry bookkeeping. Every posted JournalEntry's
// lines must balance (total debits == total credits); this is enforced in the
// posting helper (Program.cs: PostJournalEntryAsync), not trusted from callers.
// Accounting is opt-in per tenant: nothing here runs for a tenant with no
// Chart of Accounts seeded, so tenants who never open Accounting are unaffected.
// ============================================================

public enum AccountType
{
    Asset = 1,
    Liability = 2,
    Equity = 3,
    Revenue = 4,
    Expense = 5
}

public class Account
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Code { get; set; } = string.Empty; // e.g. "1000"
    public string Name { get; set; } = string.Empty; // e.g. "Cash on Hand"
    public AccountType Type { get; set; }
    public string? SubType { get; set; } // e.g. "Current Asset", "Cost of Goods Sold"
    public Guid? ParentAccountId { get; set; }
    public Account? ParentAccount { get; set; }
    /// <summary>Seeded accounts the system posts to automatically (Cash, AR, AP, Sales Revenue, ...).
    /// Protected from deletion — renaming is fine, removing one would silently break auto-posting.</summary>
    public bool IsSystemAccount { get; set; } = false;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum JournalEntryStatus
{
    Posted = 1,
    Reversed = 2
}

public class JournalEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; }
    public string EntryNumber { get; set; } = string.Empty; // e.g. "JE-1001"
    public DateTime EntryDate { get; set; } = DateTime.UtcNow;
    public string Description { get; set; } = string.Empty;
    /// <summary>What triggered this — "Order", "PurchaseOrder", "Payslip", or "Manual" for a hand-entered one.</summary>
    public string ReferenceType { get; set; } = "Manual";
    public Guid? ReferenceId { get; set; }
    public JournalEntryStatus Status { get; set; } = JournalEntryStatus.Posted;
    /// <summary>Set on the reversing entry itself, pointing back at the entry it reverses.
    /// Reversal is how a mistake gets corrected — the original entry is never edited or deleted.</summary>
    public Guid? ReversalOfEntryId { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<JournalLine> Lines { get; set; } = new List<JournalLine>();
}

public class JournalLine
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JournalEntryId { get; set; }
    public JournalEntry? JournalEntry { get; set; }
    public Guid AccountId { get; set; }
    public Account? Account { get; set; }
    public decimal DebitPKR { get; set; } = 0;
    public decimal CreditPKR { get; set; } = 0;
    public string? Description { get; set; }
    public bool IsReconciled { get; set; } = false;
    public DateTime? ReconciledAt { get; set; }
    public Guid? BankReconciliationId { get; set; }
}

public enum AccountingPeriodStatus
{
    Open = 1,
    Closed = 2
}

public class AccountingPeriod
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public DateTime PeriodStart { get; set; }
    public DateTime PeriodEnd { get; set; }
    public AccountingPeriodStatus Status { get; set; } = AccountingPeriodStatus.Open;
    public DateTime? ClosedAt { get; set; }
    public string? ClosedBy { get; set; }
}

// ============================================================
// Warehouses — a storage location within a branch. Most tenants have exactly
// one per branch (their kitchen store), which is why every stock endpoint keeps
// scoping by BranchId as the primary key, not WarehouseId — this is additive
// structure for tenants who need more than one storage location per branch
// (e.g. a walk-in freezer separate from dry storage), not a required migration.
// ============================================================

public class Warehouse
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string Name { get; set; } = string.Empty; // e.g. "Main Store", "Walk-in Freezer", "Central Commissary"
    public string? Code { get; set; }
    /// <summary>Every branch's original, implicit storage location — the one existing Ingredient
    /// records belong to before this feature existed. Exactly one per branch.</summary>
    public bool IsPrimary { get; set; } = false;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ============================================================
// Subscription billing history — separate from Tenant.Tier/SubscriptionPaidUntil
// (the tenant's *current* state) and from SaaSPackageConfig (the tier *template*).
// This is the actual invoice trail: what was billed, when, and whether it was paid.
// ============================================================

public enum SubscriptionInvoiceStatus
{
    Pending = 1,
    Paid = 2,
    Overdue = 3,
    Cancelled = 4
}

public class SubscriptionInvoice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string InvoiceNumber { get; set; } = string.Empty; // e.g. "INV-1001"
    public string Tier { get; set; } = string.Empty; // snapshot of the tier billed — a later tier change doesn't rewrite history
    public DateTime BillingPeriodStart { get; set; }
    public DateTime BillingPeriodEnd { get; set; }
    public decimal AmountPKR { get; set; }
    public SubscriptionInvoiceStatus Status { get; set; } = SubscriptionInvoiceStatus.Pending;
    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime DueAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public string? PaymentMethod { get; set; }
    public string? Notes { get; set; }
}

/// <summary>
/// Settles part or all of what's owed to a Supplier. Closes the loop the PO-receive flow opened —
/// receiving a PO on account increases Supplier.CurrentBalancePKR; a payment decreases it and, if
/// accounting is set up for the tenant, posts Debit Accounts Payable / Credit Cash or Bank.
/// </summary>
public class SupplierPayment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid SupplierId { get; set; }
    public Supplier? Supplier { get; set; }
    public decimal AmountPKR { get; set; }
    public string PaymentMethod { get; set; } = "Bank Transfer";
    public string? ReferenceNumber { get; set; } // cheque #, transaction ID, etc.
    public string? Notes { get; set; }
    public DateTime PaidAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
}

/// <summary>
/// Settles part of what a Customer owes on a CustomerKhata (pay-later) tab — the receivables
/// mirror of SupplierPayment. Decreases Customer.CurrentBalancePKR and posts Debit Cash/Bank,
/// Credit Accounts Receivable when accounting is set up for the tenant.
/// </summary>
public class CustomerPayment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public decimal AmountPKR { get; set; }
    public string PaymentMethod { get; set; } = "Cash";
    public string? ReferenceNumber { get; set; }
    public string? Notes { get; set; }
    public DateTime PaidAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
}

// ============================================================
// Departments & Designations — real master data, promoted out of the free-text
// AppUser.Department/Designation strings so HQ can manage one standardized list
// across branches. The free-text fields stay (existing data, walk-in edge cases);
// these are additive, matched by name where possible, not a breaking migration.
// ============================================================

public class Department
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Designation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ============================================================
// Leave requests — a formal approval workflow, distinct from the free-form
// "Notes" field on StaffShiftSchedule/TimeClockEntry.
// ============================================================

public enum LeaveType { Annual = 1, Sick = 2, Casual = 3, Unpaid = 4 }
public enum LeaveRequestStatus { Pending = 1, Approved = 2, Rejected = 3, Cancelled = 4 }

public class LeaveRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public LeaveType LeaveType { get; set; } = LeaveType.Annual;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public decimal DaysRequested { get; set; }
    public string? Reason { get; set; }
    public LeaveRequestStatus Status { get; set; } = LeaveRequestStatus.Pending;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public string? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewNotes { get; set; }
}

// ============================================================
// Bank reconciliation — matches posted JournalLines against a bank statement.
// A completed run's balance either matches the statement or the gap is visible,
// never silently assumed correct.
// ============================================================

public enum BankReconciliationStatus { InProgress = 1, Completed = 2 }

public class BankReconciliation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid AccountId { get; set; } // the bank/cash Account being reconciled
    public Account? Account { get; set; }
    public DateTime StatementDate { get; set; }
    public decimal StatementBalancePKR { get; set; }
    public decimal ReconciledBookBalancePKR { get; set; }
    public BankReconciliationStatus Status { get; set; } = BankReconciliationStatus.InProgress;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? CompletedBy { get; set; }
}

// ============================================================
// Add-on catalog — what's sellable independent of tier, and its price. A grant to
// a specific tenant is the existing AddOnSubscription row (TenantId + AddOnKey);
// this table is the platform-wide definition: what the key means, its price, and
// whether it's currently for sale. RequireFeatureFilter checks tier OR an active
// AddOnSubscription with a matching key — either one unlocks the feature.
// ============================================================

public class AddOnCatalogItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Matches a SaaSPackageConfig flag name (e.g. "HasKitchenDisplay") for a tier
    /// feature sold standalone, or a free-form key (e.g. "EXTRA_COUNTER") for anything else.</summary>
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal MonthlyPricePKR { get; set; }
    public decimal YearlyPricePKR { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

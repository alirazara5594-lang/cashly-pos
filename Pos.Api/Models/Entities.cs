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

public class PurchaseOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BranchId { get; set; }
    public Branch? Branch { get; set; }
    public string PONumber { get; set; } = string.Empty; // e.g. "PO-501"
    public string SupplierName { get; set; } = string.Empty;
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


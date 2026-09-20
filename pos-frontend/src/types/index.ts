export interface TenantSettings {
  id: string;
  tenantId: string;
  currencyCode: string;
  currencySymbol: string;
  decimalPlaces: number;
  taxAuthorityName: string;
  defaultTaxRate: number;
  useDualTaxRate: boolean;
  digitalTaxRate: number;
  phoneCode: string;
  defaultCity: string;
  dateFormat: string;
  receiptFooter: string;
  allowedPaymentMethods: string;
  /**
   * When true the server computes checkout tax from the branch's regionCode
   * TaxJurisdiction (cash vs digital rate). When false it falls back to the
   * flat per-tenant defaultTaxRate / digitalTaxRate above.
   */
  useProvincialTax?: boolean;
}

/**
 * A provincial / regional tax authority row (Pakistan: PRA, SRB, KPRA, BRA, FBR).
 * Served by GET /api/settings/tax-jurisdictions.
 */
export interface TaxJurisdiction {
  id: string;
  countryCode: string;
  regionCode: string;
  authorityName: string;
  cashTaxRate: number;
  digitalTaxRate: number;
  isActive: boolean;
}

export type BusinessType = 'Restaurant' | 'Retail' | 'CashAndCarry' | 'Hybrid';
export type SubscriptionTier = 'Starter' | 'Standard' | 'Professional';

export interface CountryState {
  code: string;
  name: string;
  cashTaxRate: number | null;
  digitalTaxRate: number | null;
}

/** Shape returned by the anonymous GET /api/public/countries, used to build the signup country/state picker. */
export interface CountryProfile {
  name: string;
  iso2: string;
  phoneCode: string;
  currencyCode: string;
  currencySymbol: string;
  taxAuthorityName: string | null;
  defaultTaxRate: number | null;
  digitalTaxRate: number | null;
  useDualTaxRate: boolean;
  useProvincialTax: boolean;
  taxNote: string;
  states: CountryState[] | null;
}

/** Effective, add-on-merged feature flags for the signed-in tenant — the one true answer for
 * "is this feature actually available," since a tier flag OR an active add-on either unlocks it. */
export interface EffectivePackageFeatures {
  maxBranches: number;
  maxCounters: number;
  maxOrderTabs: number;
  maxUsers: number;
  hasKitchenDisplay: boolean;
  hasDeliveryCOD: boolean;
  hasInventoryManagement: boolean;
  hasStockTransfers: boolean;
  hasDirectorDashboard: boolean;
  hasConsolidatedReports: boolean;
  hasWhatsAppMessaging: boolean;
  hasAdvancedReports: boolean;
  hasMultiBranch: boolean;
}

export interface MyPackageInfo {
  tier: string;
  isActive: boolean;
  isTrialActive: boolean;
  trialEndsAt: string;
  subscriptionPaidUntil: string | null;
  features: EffectivePackageFeatures | null;
  activeAddOnKeys: string[];
}

/** Shape returned by the anonymous GET /api/public/packages, used to build the plan picker on signup. */
export interface PublicPackage {
  packageKey: string;
  displayName: string;
  monthlyPricePKR: number;
  yearlyPricePKR: number;
  maxBranches: number;
  maxCounters: number;
  maxOrderTabs: number;
  maxUsers: number;
  hasKitchenDisplay: boolean;
  hasDeliveryCOD: boolean;
  hasInventoryManagement: boolean;
  hasStockTransfers: boolean;
  hasDirectorDashboard: boolean;
  hasConsolidatedReports: boolean;
  hasWhatsAppMessaging: boolean;
  hasAdvancedReports: boolean;
  hasMultiBranch: boolean;
  whatsAppMessagesPerMonth: number;
}
export type TerminalType = 'Counter' | 'OrderTab' | 'KitchenDisplay';
export type OrderType = 'DineIn' | 'Takeaway' | 'Delivery' | 'CallOrder';
export type OrderStatus = 'New' | 'InKitchen' | 'ReadyForDispatch' | 'OutForDelivery' | 'Completed' | 'Cancelled';
export type PaymentMethod = 'Cash' | 'Card' | 'JazzCash' | 'EasyPaisa' | 'Raast' | 'CustomerKhata' | 'Split';
export type KitchenStation = 'MainKitchen' | 'BeverageBar' | 'Grill';

export interface ProductModifier {
  id: string;
  productId: string;
  name: string;
  pricePKR: number;
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId: string;
  category?: Category;
  sku: string;

  barcode: string;
  name: string;
  urduName?: string;
  description: string;
  costPricePKR: number;
  sellingPricePKR: number;
  unit: string;
  imageUrl?: string;
  station: KitchenStation;
  isActive: boolean;
  modifiers?: ProductModifier[];
  recipeItems?: ProductRecipeItem[];
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  localName?: string;
  icon: string;
  sortOrder: number;
}

export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPricePKR: number;
  totalPricePKR: number;
  selectedModifiers?: ProductModifier[];
  modifiersSummary?: string;
  specialNotes?: string;
  station: KitchenStation;
  product?: Product;
}


export interface Order {
  id: string;
  tenantId: string;
  branchId: string;
  orderNumber: string;
  orderType: OrderType;
  status: OrderStatus;
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  assignedRiderId?: string;
  assignedRider?: Rider;
  subTotalPKR: number;
  discountPKR: number;
  taxPKR: number;
  totalPKR: number;
  paymentMethod: PaymentMethod;
  amountPaidPKR: number;
  changeDuePKR: number;
  isPaid: boolean;
  cashierName?: string;
  createdByRole?: string;
  createdAt: string;

  // Stage timestamps (nullable ISO date strings stamped server-side as the order moves)
  inKitchenAt?: string | null;
  readyAt?: string | null;
  outForDeliveryAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;

  // Fiscal / invoice integration
  fiscalInvoiceNumber?: string | null;
  fiscalQrPayload?: string | null;

  items: CartItem[];
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  branchId: string;
  ticketNumber: string;
  station: KitchenStation;
  status: string;
  createdAt: string;
  order?: Order;
}

export interface DiningTable {
  id: string;
  branchId: string;
  tableNumber: string;
  section: string; // e.g. "Ground Floor", "1st Floor (Family)", "Rooftop / Terrace", "Outdoor Lawn"
  capacity: number;
  isOccupied: boolean;
  currentOrderId?: string;
}

export interface Rider {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  isAvailable: boolean;
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone: string;
  isHeadOffice: boolean;
  allowedCounters: number;
  allowedOrderTabs: number;
  /** TaxJurisdiction this branch belongs to, e.g. "PK-PB". Null until assigned. */
  regionCode?: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  businessType: BusinessType;
  tier: SubscriptionTier;
  isActive: boolean;
  branches: Branch[];
  country?: string;
}

export interface DirectorKPIs {
  currency: string;
  todaySalesPKR: number;
  totalOrders: number;
  avgBasketPKR: number;
  activeOrders: number;
  completedOrders: number;
  branchComparison: {
    branchId: string;
    branchName: string;
    city: string;
    todaySalesPKR: number;
    ordersCount: number;
    activeCounters: number;
  }[];
}

export interface BranchStockItem {
  id: string;
  branchId: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  categoryName: string;
  unit: string;
  costPricePKR: number;
  sellingPricePKR: number;
  quantityOnHand: number;
  minAlertLevel: number;
  batchNumber?: string;
  expiryDate?: string;
  isLowStock: boolean;
}

export interface ZReportSummary {
  period: string;
  shiftId?: string;
  totalSalesPKR: number;
  totalOrders: number;
  cashSalesPKR: number;
  cardSalesPKR: number;
  digitalSalesPKR: number;
  cashTaxPKR: number; // 16% Tax
  cardTaxPKR: number; // 8% Tax
  totalTaxPKR: number;
  openingFloatPKR: number;
  expectedCashInDrawerPKR: number;
  actualCashInDrawerPKR: number;
  variancePKR: number;
  dineInSalesPKR: number;
  takeawaySalesPKR: number;
  deliverySalesPKR: number;
}

export interface CategorySalesReport {
  categoryId: string;
  categoryName: string;
  quantitySold: number;
  grossSalesPKR: number;
  netSalesPKR: number;
  taxPKR: number;
  percentageOfTotal: number;
}

export interface ItemPerformanceReport {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  revenuePKR: number;
  costPKR: number;
  grossProfitPKR: number;
  marginPercent: number;
}

export interface RawIngredient {
  id: string;
  branchId: string;
  name: string;
  category: string;
  unit: string;
  costPerUnitPKR: number;
  currentStock: number;
  minAlertLevel: number;
  supplierName?: string;
  isLowStock: boolean;
  totalValuationPKR: number;
}

export interface ProductRecipeItem {
  id: string;
  productId: string;
  ingredientId: string;
  ingredientName?: string;
  ingredientCategory?: string;
  quantityRequired: number;
  unit: string;
  costPerUnitPKR?: number;
  estimatedCostPKR?: number;
  ingredient?: {
    id: string;
    name: string;
    category?: string;
    unit: string;
  };
}

export type UserRole = 'OwnerAdmin' | 'SuperAdmin' | 'BranchManager' | 'Cashier' | 'KitchenChef' | 'Waiter';

/**
 * Module keys actually enforced by the backend permission layer.
 * Kept in sync with ModuleBaseline on the server.
 */
export type ModuleKey =
  | 'pos'
  | 'kitchen'
  | 'delivery'
  | 'menu'
  | 'inventory'
  | 'reports'
  | 'accounts'
  | 'supplychain'
  | 'admin'
  | 'users'
  | 'labor';

export type PermissionAction = 'view' | 'edit' | 'delete' | 'export';

/** A single per-user ModulePermission row returned by GET /api/permissions/my. */
export interface ModulePermission {
  moduleKey: string;
  subModuleKey: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

/** Boolean action flags carried on the user record itself. */
export interface AuthPermissions {
  canViewFinancialReports: boolean;
  canManageInventory: boolean;
  canManageMenuAndTax: boolean;
  canGiveDiscounts: boolean;
  canVoidOrders: boolean;
}

/** Permission keys accepted by POST /api/auth/verify-pin. */
export type OverridePermissionKey = keyof AuthPermissions;

/** The logged-in identity persisted by the pos store. */
export interface CurrentUser {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  tenantId?: string | null;
  branchId?: string | null;
}

export interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: CurrentUser & { permissions?: AuthPermissions };
}

export interface VerifyPinResponse {
  authorized: boolean;
  authorizedByUserId?: string;
  authorizedByName?: string;
}

export interface AppUser {
  id: string;
  tenantId: string;
  branchId?: string;
  fullName: string;
  username: string;
  pinCode: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  permissions: {
    canViewFinancialReports: boolean;
    canManageInventory: boolean;
    canManageMenuAndTax: boolean;
    canGiveDiscounts: boolean;
    canVoidOrders: boolean;
  };
  // Payroll (optional — absent/zero simply means not payroll-eligible)
  department?: string;
  designation?: string;
  employmentType?: 'FullTime' | 'PartTime' | 'Contract';
  monthlyRatePKR?: number;
  hourlyRatePKR?: number;
  bankAccountNumber?: string;
  joiningDate?: string;
  isPayrollEligible?: boolean;
  departmentId?: string;
  designationId?: string;
}

export type TransferStatus = 'Requested' | 'InTransit' | 'Received' | 'Cancelled';

export interface StockTransferItem {
  id: string;
  transferOrderId: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantityRequested: number;
  quantityDispatched: number;
  quantityReceived: number;
  unitCostPKR: number;
}

export interface StockTransferOrder {
  id: string;
  tenantId: string;
  transferNumber: string;
  sourceBranchId: string;
  sourceBranch?: Branch;
  destinationBranchId: string;
  destinationBranch?: Branch;
  status: TransferStatus;
  requestedAt: string;
  dispatchedAt?: string;
  receivedAt?: string;
  dispatchedBy?: string;
  receivedBy?: string;
  vehicleOrDriver?: string;
  notes?: string;
  totalEstimatedCostPKR: number;
  items: StockTransferItem[];
}

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  paymentTerms?: string;
  openingBalancePKR: number;
  currentBalancePKR: number;
  isActive: boolean;
  createdAt: string;
}

export type StockMovementType =
  | 'PurchaseReceipt' | 'SaleConsumption' | 'TransferOut' | 'TransferIn'
  | 'Adjustment' | 'Waste' | 'OpeningBalance' | 'StockCount';

export interface StockLedgerEntry {
  id: string;
  branchId: string;
  ingredientId: string;
  ingredientName: string;
  movementType: StockMovementType;
  quantityChange: number;
  unitCostPKR: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export type POStatus = 'Draft' | 'Ordered' | 'Received' | 'Cancelled';

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  unitCostPKR: number;
  totalPKR: number;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  branch?: Branch;
  poNumber: string;
  supplierName: string;
  supplierId?: string;
  status: POStatus;
  totalCostPKR: number;
  createdAt: string;
  receivedAt?: string;
  receivedBy?: string;
  notes?: string;
  items: PurchaseOrderItem[];
}

export interface RiderSettlementRecord {
  id: string;
  branchId: string;
  riderId: string;
  rider?: Rider;
  shiftDate: string;
  totalOrdersDelivered: number;
  totalCODExpectedPKR: number;
  totalCashCollectedPKR: number;
  shortageSurplusPKR: number;
  settledBy: string;
  settledAt: string;
}

export interface TaxAuditInvoice {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  orderType: string;
  paymentMethod: string;
  cashierName: string;
  netAmountPKR: number;
  taxRatePercent: number; // 16 or 8
  taxAmountPKR: number;
  totalAmountPKR: number;
}

export interface TaxSegment {
  taxRatePercent: number;
  invoiceCount: number;
  grossSalesPKR: number;
  netTaxableSalesPKR: number;
  taxCollectedPKR: number;
}

export interface TaxAuditReport {
  startDate: string;
  endDate: string;
  totalInvoices: number;
  totalGrossTurnoverPKR: number;
  totalNetSalesPKR: number;
  totalTaxCollectedPKR: number;
  cashSegment: TaxSegment;
  cardSegment: TaxSegment;
  invoices: TaxAuditInvoice[];
}

export interface PaymentMethodStat {
  method: string;
  transactionCount: number;
  totalAmountPKR: number;
  percentageOfTotal: number;
  avgTicketPKR: number;
}

export interface PaymentMethodsReport {
  totalRevenuePKR: number;
  totalTransactions: number;
  tenders: PaymentMethodStat[];
}

export interface BranchFinancialSummary {
  branchId: string;
  branchName: string;
  branchCode: string;
  city: string;
  isHeadOffice: boolean;
  orderCount: number;
  grossSalesPKR: number;
  cashSalesPKR: number;
  cardSalesPKR: number;
  digitalSalesPKR: number;
  taxCollectedPKR: number;
  estimatedCostPKR: number;
  netProfitPKR: number;
  profitMarginPercent: number;
}

export interface ConsolidatedFinancialReport {
  daysAnalyzed: number;
  chainGrossSalesPKR: number;
  chainTaxCollectedPKR: number;
  chainCostPKR: number;
  chainNetProfitPKR: number;
  chainProfitMargin: number;
  branches: BranchFinancialSummary[];
}

export type DeploymentMode = 'Single' | 'MultiBranch';

export interface BranchInitPayload {
  name: string;
  code?: string;
  city?: string;
  address?: string;
  phone?: string;
  allowedCounters?: number;
  allowedOrderTabs?: number;
}

export interface SetupInitPayload {
  deploymentMode: DeploymentMode;
  restaurantName: string;
  businessType?: BusinessType;
  city?: string;
  address?: string;
  phone?: string;
  mainBranchName?: string;
  hqName?: string;
  allowedCounters?: number;
  adminFullName?: string;
  adminUsername?: string;
  adminPin?: string;
  seedStarterMenu: boolean;
  branches?: BranchInitPayload[];
}

export interface SetupStatusResponse {
  isConfigured: boolean;
  tenantCount: number;
  tenants: Array<{
    id: string;
    name: string;
    businessType: BusinessType;
    tier: SubscriptionTier;
    isActive: boolean;
    branchCount: number;
    hasHeadOffice: boolean;
    branches: Array<{
      id: string;
      name: string;
      code: string;
      city: string;
      isHeadOffice: boolean;
      allowedCounters: number;
      allowedOrderTabs: number;
    }>;
  }>;
}

export type TerminalOperatingMode = 'CounterPOS' | 'OwnerAdmin' | 'WaiterTab' | 'KitchenKDS';

export interface Terminal {
  id: string;
  branchId: string;
  terminalName: string;
  terminalType: TerminalType;
  deviceToken: string;
  isActive: boolean;
  lastSeenAt: string;
}

export type DepartmentRole = 'Owner' | 'Accounts' | 'Procurement' | 'MenuOps' | 'Cashier' | 'Waiter' | 'Kitchen' | 'BranchManager';

export interface BranchPairingInfo {
  branchId: string;
  branchName: string;
  branchCode: string;
  city: string;
  tenantId: string;
  tenantName: string;
  pairingToken: string;
  allowedCounters: number;
  allowedOrderTabs: number;
}

export interface BranchPairResponse {
  success: boolean;
  tenantId: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  city: string;
  isHeadOffice: boolean;
  categoriesCount: number;
  productsCount: number;
  tablesCount: number;
  categories: Category[];
  products: Product[];
  diningTables: DiningTable[];
}

export type StockRequestType = 'ToOwner' | 'ToVendor' | 'ToHQ';
export type StockRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Ordered' | 'Fulfilled';

export interface StockRequestItem {
  id?: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantityRequested: number;
  currentStock: number;
  unitCostPKR: number;
}

export interface StockRequest {
  id: string;
  tenantId: string;
  branchId: string;
  branchName?: string;
  requestNumber: string;
  requestType: StockRequestType;
  status: StockRequestStatus;
  vendorName?: string;
  notes?: string;
  estimatedCostPKR: number;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  items: StockRequestItem[];
}

// ─────────────────────────────────────────────────────────────
// CRM — Customers & Loyalty
// ─────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  tenantId: string;
  fullName: string;
  phone: string;
  email?: string;
  loyaltyPoints: number;
  totalVisits: number;
  totalSpentPKR: number;
  currentBalancePKR: number;
  createdAt: string;
  lastVisitAt?: string;
}

export interface LoyaltyProgramConfig {
  id: string;
  tenantId: string;
  isEnabled: boolean;
  /** Points earned per 1 PKR spent. */
  pointsPerPKRSpent: number;
  /** PKR a single point is worth when redeemed. */
  pkrValuePerPoint: number;
  minRedeemPoints: number;
}

/** Preview response of POST /api/loyalty/redeem — the points are only really burned at order submit. */
export interface LoyaltyRedeemPreview {
  discountPKR: number;
}

export interface GiftCard {
  id: string;
  tenantId: string;
  cardCode: string;
  initialBalancePKR: number;
  currentBalancePKR: number;
  issuedToCustomerId?: string;
  issuedAt: string;
  expiresAt?: string;
  isActive: boolean;
}

export type PromoDiscountType = 'Percent' | 'Fixed';

export interface PromoCode {
  id: string;
  tenantId: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  minOrderAmountPKR: number;
  maxUsesTotal?: number;
  maxUsesPerCustomer?: number;
  usesCount: number;
  validFrom: string;
  validUntil?: string;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// Payments & Delivery Integrations
// ─────────────────────────────────────────────────────────────

export type PaymentProvider = 'JazzCash' | 'EasyPaisa' | 'Card' | 'Cash';

export interface PaymentInitiateResponse {
  success: boolean;
  redirectUrl?: string;
  instructions?: string;
  providerTransactionId?: string;
  errorMessage?: string;
}

export interface PaymentStatusResponse {
  orderId?: string;
  provider?: PaymentProvider;
  status?: string;
  providerTransactionId?: string;
  errorMessage?: string;
}

export type DeliveryPlatform = 'Foodpanda' | 'Other';

/**
 * The backend's delivery-integration config is still settling, so this stays
 * deliberately loose: only `isEnabled` is relied on, everything else is read
 * defensively and round-tripped back untouched on save.
 */
export interface DeliveryIntegrationConfig {
  platform?: string;
  isEnabled?: boolean;
  apiKey?: string;
  apiSecret?: string;
  storeId?: string;
  webhookUrl?: string;
  isConfigured?: boolean;
  lastSyncAt?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Labor — Scheduling & Time Clock
// ─────────────────────────────────────────────────────────────

export interface StaffShiftSchedule {
  id: string;
  tenantId: string;
  branchId: string;
  userId: string;
  /** Denormalized by the API where available — purely for display. */
  userFullName?: string;
  scheduledStart: string;
  scheduledEnd: string;
  position: string;
  notes?: string;
  createdBy: string;
}

export interface TimeClockEntry {
  id: string;
  tenantId: string;
  branchId: string;
  userId: string;
  userFullName?: string;
  clockInAt: string;
  clockOutAt?: string;
  linkedCashShiftId?: string;
  hoursWorked?: number;
}

// ─────────────────────────────────────────────────────────────
// Payroll
// ─────────────────────────────────────────────────────────────

export type PayrollPeriodStatus = 'Open' | 'Generated' | 'Finalized' | 'Paid';
export type PayslipStatus = 'Draft' | 'Finalized' | 'Paid';
export type PayslipLineType = 'Allowance' | 'Deduction' | 'Overtime';

export interface PayrollPeriod {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollPeriodStatus;
  createdAt: string;
  generatedAt?: string;
  finalizedAt?: string;
  notes?: string;
}

export interface PayslipLine {
  id: string;
  type: PayslipLineType;
  description: string;
  amountPKR: number;
}

export interface Payslip {
  id: string;
  payrollPeriodId: string;
  userId: string;
  userName: string;
  branchId: string;
  hoursWorked: number;
  basicPayPKR: number;
  totalAllowancesPKR: number;
  totalDeductionsPKR: number;
  netPayPKR: number;
  status: PayslipStatus;
  generatedAt: string;
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
  lines: PayslipLine[];
}

// ─────────────────────────────────────────────────────────────
// Warehouses
// ─────────────────────────────────────────────────────────────

export interface Warehouse {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  code?: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────
// Subscription billing (platform-vendor)
// ─────────────────────────────────────────────────────────────

export type SubscriptionInvoiceStatus = 'Pending' | 'Paid' | 'Overdue' | 'Cancelled';

export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  tier: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountPKR: number;
  status: SubscriptionInvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────
// HR — Departments, Designations, Leave
// ─────────────────────────────────────────────────────────────

export interface Department {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface Designation {
  id: string;
  tenantId: string;
  name: string;
  departmentId?: string;
  isActive: boolean;
  createdAt: string;
}

export type LeaveType = 'Annual' | 'Sick' | 'Casual' | 'Unpaid';
export type LeaveRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface LeaveRequest {
  id: string;
  userId: string;
  userFullName?: string;
  branchId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  daysRequested: number;
  reason?: string;
  status: LeaveRequestStatus;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

// ─────────────────────────────────────────────────────────────
// Accounting periods & bank reconciliation
// ─────────────────────────────────────────────────────────────

export type AccountingPeriodStatus = 'Open' | 'Closed';

export interface AccountingPeriod {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  status: AccountingPeriodStatus;
  closedAt?: string;
  closedBy?: string;
}

export interface UnreconciledLine {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  debitPKR: number;
  creditPKR: number;
}

export interface UnreconciledReport {
  accountCode: string;
  accountName: string;
  bookBalancePKR: number;
  unreconciledLines: UnreconciledLine[];
}

export interface BankReconciliation {
  id: string;
  accountId: string;
  statementDate: string;
  statementBalancePKR: number;
  reconciledBookBalancePKR: number;
  status: 'InProgress' | 'Completed';
  completedAt?: string;
  completedBy?: string;
}

// ─────────────────────────────────────────────────────────────
// Customer payments (AR)
// ─────────────────────────────────────────────────────────────

export interface CustomerPayment {
  id: string;
  customerId: string;
  amountPKR: number;
  paymentMethod: string;
  referenceNumber?: string;
  notes?: string;
  paidAt: string;
  createdBy: string;
}

// ─────────────────────────────────────────────────────────────
// Add-ons
// ─────────────────────────────────────────────────────────────

export interface AddOnCatalogItem {
  id: string;
  key: string;
  displayName: string;
  description?: string;
  monthlyPricePKR: number;
  yearlyPricePKR: number;
  isActive: boolean;
  createdAt: string;
  /** Which screen/module this key actually unlocks — derived server-side from the key itself. */
  unlocksModule?: string;
  unlocksRoute?: string | null;
}

export interface TenantAddOnCatalogRow extends AddOnCatalogItem {
  isActiveForTenant: boolean;
}

export interface AddOnSubscriptionRow {
  id: string;
  tenantId: string;
  addOnKey: string;
  quantity: number;
  pricePKR: number;
  isActive: boolean;
  /** Set only for branch-scoped quantity add-ons (EXTRA_COUNTER, EXTRA_TABLET). */
  branchId?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface AuditLogPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  entries: AuditLogEntry[];
}

// ─────────────────────────────────────────────────────────────
// Accounting
// ─────────────────────────────────────────────────────────────

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export interface Account {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: AccountType;
  subType?: string;
  parentAccountId?: string;
  isSystemAccount: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  debitPKR: number;
  creditPKR: number;
  description?: string;
}

export type JournalEntryStatus = 'Posted' | 'Reversed';

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string;
  referenceId?: string;
  status: JournalEntryStatus;
  reversalOfEntryId?: string;
  createdBy: string;
  createdAt: string;
  lines: JournalLine[];
}

export interface TrialBalanceRow {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceReport {
  asOf: string;
  totalDebits: number;
  totalCredits: number;
  accounts: TrialBalanceRow[];
}

export interface ProfitLossReport {
  periodStart: string;
  periodEnd: string;
  revenue: { code: string; name: string; amountPKR: number }[];
  totalRevenuePKR: number;
  expenses: { code: string; name: string; amountPKR: number }[];
  totalExpensesPKR: number;
  netProfitPKR: number;
}

export interface BalanceSheetReport {
  asOf: string;
  assets: { code: string; name: string; amountPKR: number }[];
  totalAssetsPKR: number;
  liabilities: { code: string; name: string; amountPKR: number }[];
  totalLiabilitiesPKR: number;
  equity: { code: string; name: string; amountPKR: number }[];
  retainedEarningsPKR: number;
  totalEquityPKR: number;
  totalLiabilitiesAndEquityPKR: number;
  balances: boolean;
}

// ─────────────────────────────────────────────────────────────
// Menu Engineering
// ─────────────────────────────────────────────────────────────

export type MenuClassification = 'Star' | 'PlowHorse' | 'Puzzle' | 'Dog';

export interface MenuEngineeringRow {
  productId: string;
  name: string;
  unitsSold: number;
  revenuePKR: number;
  costPKR: number;
  grossProfitPKR: number;
  marginPercent: number;
  classification: MenuClassification;
}

export interface MenuEngineeringReport {
  items: MenuEngineeringRow[];
  slowMovers: MenuEngineeringRow[];
}


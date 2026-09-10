export type BusinessType = 'Restaurant' | 'Retail' | 'CashAndCarry' | 'Hybrid';
export type SubscriptionTier = 'Starter' | 'Standard' | 'Professional';
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
}

export interface Tenant {
  id: string;
  name: string;
  businessType: BusinessType;
  tier: SubscriptionTier;
  isActive: boolean;
  branches: Branch[];
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

export type UserRole = 'OwnerAdmin' | 'BranchManager' | 'Cashier' | 'KitchenChef' | 'Waiter';

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


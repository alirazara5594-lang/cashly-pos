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
  ingredientName: string;
  ingredientCategory: string;
  quantityRequired: number;
  unit: string;
  costPerUnitPKR: number;
  estimatedCostPKR: number;
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

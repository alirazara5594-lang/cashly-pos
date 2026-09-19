import axios from 'axios';
import type { 
  Tenant, 
  Branch, 
  Category, 
  Product, 
  Order, 
  KitchenTicket, 
  Rider, 
  DirectorKPIs, 
  OrderType, 
  PaymentMethod,
  BranchStockItem,
  ZReportSummary,
  CategorySalesReport,
  ItemPerformanceReport,
  RawIngredient,
  ProductRecipeItem,
  AppUser,
  StockTransferOrder,
  PurchaseOrder,
  RiderSettlementRecord,
  DiningTable,
  TaxAuditReport,
  PaymentMethodsReport,
  ConsolidatedFinancialReport,
  SetupInitPayload,
  SetupStatusResponse,
  BranchPairingInfo,
  BranchPairResponse,
  LoginResponse,
  ModulePermission,
  OverridePermissionKey,
  TaxJurisdiction,
  VerifyPinResponse,
  Customer,
  LoyaltyProgramConfig,
  LoyaltyRedeemPreview,
  GiftCard,
  PromoCode,
  PromoDiscountType,
  PaymentProvider,
  PaymentInitiateResponse,
  PaymentStatusResponse,
  DeliveryIntegrationConfig,
  StaffShiftSchedule,
  TimeClockEntry,
  MenuEngineeringReport,
  Supplier,
  StockLedgerEntry,
  PayrollPeriod,
  Payslip,
  PayslipLineType,
  Account,
  AccountType,
  JournalEntry,
  TrialBalanceReport,
  ProfitLossReport,
  BalanceSheetReport,
  AuditLogPage,
  AddOnCatalogItem,
  TenantAddOnCatalogRow,
  AddOnSubscriptionRow,
  Warehouse,
  SubscriptionInvoice,
  Department,
  Designation,
  LeaveRequest,
  LeaveType,
  AccountingPeriod,
  UnreconciledReport,
  BankReconciliation,
  CustomerPayment
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// JWT Auth interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cashly_pos_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Endpoints the backend leaves open (no bearer token required). A 401 from any
 * of these is a credential/setup problem, not an expired session, so it must NOT
 * tear down the current session.
 */
const PUBLIC_ENDPOINTS = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/super-admin-login',
  '/api/setup/status',
  '/api/setup/initialize',
  '/api/setup/pairing-info',
  '/api/setup/pair-branch'
];

function isPublicEndpoint(url?: string): boolean {
  if (!url) return false;
  return PUBLIC_ENDPOINTS.some(p => url.startsWith(p));
}

/** Pull the server's message off an axios rejection, falling back to `fallback`. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  return data?.message || data?.error || fallback;
}

/** HTTP status of an axios rejection, when there is one. */
export function getApiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * Session teardown + router-aware redirect for expired tokens.
 *
 * `api.ts` is imported BY the store, so it cannot import the store back without
 * a cycle. Instead App.tsx registers a handler at mount that calls
 * `posStore.logout()` and navigates back to the login gate.
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function registerAuthRedirect(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Every /api/* endpoint except the public ones above now requires a valid JWT.
    // A 401 therefore means the session is invalid or expired: drop it and send
    // the user back to the mandatory login gate.
    if (error.response?.status === 401 && !isPublicEndpoint(error.config?.url)) {
      // Only tear down when a token was actually sent. A 401 on a request that
      // carried no token just means we're not signed in yet (e.g. the setup
      // wizard probing tenants) — tearing down there would eject the user from
      // the installation flow.
      const sentToken = !!error.config?.headers?.Authorization;
      if (sentToken) {
        // Clear the raw keys first so the request interceptor stops sending a
        // dead token even if the handler below is not registered yet.
        localStorage.removeItem('cashly_pos_token');
        localStorage.removeItem('cashly_pos_user');
        try {
          onUnauthorized?.();
        } catch {
          // best-effort; the login gate renders as soon as the store clears
        }
      }
    }
    return Promise.reject(error);
  }
);

export const posApi = {
  // Auth
  login: async (username: string, pinCode: string) => {
    const res = await api.post<LoginResponse>('/api/auth/login', { username, pinCode });
    if (res.data.token) {
      localStorage.setItem('cashly_pos_token', res.data.token);
      localStorage.setItem('cashly_pos_user', JSON.stringify(res.data.user));
    }
    return res.data;
  },
  logout: () => {
    localStorage.removeItem('cashly_pos_token');
    localStorage.removeItem('cashly_pos_user');
  },

  /**
   * Manager Override: a logged-in user who lacks `requiredPermission` asks another
   * user (typically a manager) to authorize a single action with their PIN — no
   * session switch. The backend re-checks the permission; a true here only unlocks UI.
   */
  verifyManagerPin: async (
    username: string,
    pinCode: string,
    requiredPermission: OverridePermissionKey | null
  ) => {
    const res = await api.post<VerifyPinResponse>('/api/auth/verify-pin', {
      username,
      pinCode,
      requiredPermission
    });
    return res.data;
  },

  // Tenancy
  getTenants: async () => {
    const res = await api.get<Tenant[]>('/api/tenants');
    return res.data;
  },
  getBranches: async (tenantId?: string) => {
    const res = await api.get<Branch[]>('/api/branches', { params: { tenantId } });
    return res.data;
  },
  updateBranch: async (id: string, data: {
    name?: string;
    city?: string;
    address?: string;
    phone?: string;
    /** TaxJurisdiction regionCode, e.g. "PK-PB" */
    regionCode?: string | null;
  }) => {
    const res = await api.put<Branch>(`/api/branches/${id}`, data);
    return res.data;
  },

  // Catalog
  getCategories: async (tenantId?: string) => {
    const res = await api.get<Category[]>('/api/catalog/categories', { params: { tenantId } });
    return res.data;
  },
  getProducts: async (params?: { tenantId?: string; categoryId?: string; search?: string; barcode?: string }) => {
    const res = await api.get<Product[]>('/api/catalog/products', { params });
    return res.data;
  },
  createProduct: async (productData: any) => {
    const res = await api.post<Product>('/api/catalog/products', productData);
    return res.data;
  },
  updateProduct: async (id: string, productData: any) => {
    const res = await api.put<Product>(`/api/catalog/products/${id}`, productData);
    return res.data;
  },
  deleteProduct: async (id: string) => {
    const res = await api.delete(`/api/catalog/products/${id}`);
    return res.data;
  },
  createCategory: async (categoryData: any) => {
    const res = await api.post<Category>('/api/catalog/categories', categoryData);
    return res.data;
  },
  updateCategory: async (id: string, categoryData: any) => {
    const res = await api.put<Category>(`/api/catalog/categories/${id}`, categoryData);
    return res.data;
  },
  deleteCategory: async (id: string) => {
    const res = await api.delete(`/api/catalog/categories/${id}`);
    return res.data;
  },

  // Dining Tables & Floor Sections
  getTables: async (branchId: string) => {
    const res = await api.get<DiningTable[]>('/api/tables', { params: { branchId } });
    return res.data;
  },
  createTable: async (data: { branchId: string; tableNumber: string; section?: string; capacity: number }) => {
    const res = await api.post<DiningTable>('/api/tables', data);
    return res.data;
  },
  updateTable: async (id: string, data: { tableNumber?: string; section?: string; capacity?: number; isOccupied?: boolean }) => {
    const res = await api.put<DiningTable>(`/api/tables/${id}`, data);
    return res.data;
  },
  deleteTable: async (id: string) => {
    const res = await api.delete(`/api/tables/${id}`);
    return res.data;
  },

  // Mode 1 Parallel Order Dispatch
  createOrder: async (orderData: {
    branchId: string;
    orderType: OrderType;
    tableNumber?: string;
    customerName?: string;
    customerPhone?: string;
    deliveryAddress?: string;
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
    /**
     * CRM / loyalty extras. All optional and additive — a checkout that omits
     * them behaves exactly as it did before these fields existed.
     */
    customerId?: string;
    promoCode?: string;
    giftCardCode?: string;
    giftCardRedeemAmount?: number;
    loyaltyPointsToRedeem?: number;
    items: {
      productId: string;
      productName: string;
      quantity: number;
      unitPricePKR: number;
      modifiersSummary?: string;
      specialNotes?: string;
      station: string;
    }[];
  }) => {
    const res = await api.post('/api/orders', orderData);
    return res.data;
  },

  getOrders: async (branchId: string, status?: string) => {
    const res = await api.get<Order[]>('/api/orders', { params: { branchId, status } });
    return res.data;
  },

  voidOrder: async (orderId: string, reason?: string) => {
    const res = await api.post(`/api/orders/${orderId}/void`, { reason });
    return res.data;
  },

  // Kitchen KDS
  getKitchenTickets: async (branchId: string, station?: string) => {
    const res = await api.get<KitchenTicket[]>('/api/kitchen/tickets', { params: { branchId, station } });
    return res.data;
  },
  updateTicketStatus: async (ticketId: string, status: string) => {
    const res = await api.post(`/api/kitchen/tickets/${ticketId}/status`, { status });
    return res.data;
  },

  // Delivery Board
  getDeliveryBoard: async (branchId: string) => {
    const res = await api.get<{
      inKitchen: Order[];
      readyForDispatch: Order[];
      outForDelivery: Order[];
      completed: Order[];
    }>('/api/delivery/board', { params: { branchId } });
    return res.data;
  },
  assignRider: async (orderId: string, riderId: string) => {
    const res = await api.post('/api/delivery/assign-rider', { orderId, riderId });
    return res.data;
  },
  markDelivered: async (orderId: string) => {
    const res = await api.post(`/api/delivery/mark-delivered?orderId=${orderId}`);
    return res.data;
  },

  // Riders & COD Settlement
  getRiders: async (branchId: string) => {
    const res = await api.get<Rider[]>('/api/riders', { params: { branchId } });
    return res.data;
  },
  getRiderPendingCOD: async (riderId: string) => {
    const res = await api.get<{
      riderId: string;
      riderName: string;
      phone: string;
      vehicle: string;
      totalOrders: number;
      completedOrders: number;
      pendingOrders: number;
      expectedCODPKR: number;
      orders: any[];
    }>(`/api/riders/${riderId}/pending-cod`);
    return res.data;
  },
  settleRiderCOD: async (data: {
    riderId: string;
    totalOrdersDelivered: number;
    expectedCODPKR: number;
    cashCollectedPKR: number;
    settledBy?: string;
  }) => {
    const res = await api.post('/api/riders/settle', data);
    return res.data;
  },

  // Call Order Lookup
  lookupCustomerPhone: async (phone: string) => {
    const res = await api.get<{
      found: boolean;
      name?: string;
      phone: string;
      lastAddress?: string;
      totalPastOrders?: number;
      favoriteItems?: string[];
      recentOrders?: any[];
    }>('/api/call-order/lookup', { params: { phone } });
    return res.data;
  },

  // Director KPIs
  getDirectorKPIs: async (tenantId?: string, branchId?: string) => {
    const res = await api.get<DirectorKPIs>('/api/director/kpis', { params: { tenantId, branchId } });
    return res.data;
  },

  // Super Admin
  updateBranchLimits: async (data: {
    branchId: string;
    allowedCounters: number;
    allowedOrderTabs: number;
    tier?: string;
  }) => {
    const res = await api.post('/api/super-admin/update-limits', data);
    return res.data;
  },

  // Terminal Device Management
  getTerminals: async (branchId?: string) => {
    const params = branchId ? `?branchId=${branchId}` : '';
    const res = await api.get(`/api/terminals${params}`);
    return res.data;
  },
  createTerminal: async (data: { branchId: string; terminalName: string; terminalType: number }) => {
    const res = await api.post('/api/terminals', data);
    return res.data;
  },
  updateTerminal: async (id: string, data: { terminalName?: string; isActive?: boolean }) => {
    const res = await api.put(`/api/terminals/${id}`, data);
    return res.data;
  },
  deleteTerminal: async (id: string) => {
    const res = await api.delete(`/api/terminals/${id}`);
    return res.data;
  },
  terminalHeartbeat: async (deviceToken: string) => {
    const res = await api.post('/api/terminals/heartbeat', { deviceToken });
    return res.data;
  },

  // Stock Requests (Branch Manager -> Owner/Vendor/HQ)
  getStockRequests: async (branchId?: string, status?: string) => {
    const params: any = {};
    if (branchId) params.branchId = branchId;
    if (status) params.status = status;
    const res = await api.get('/api/stock-requests', { params });
    return res.data;
  },
  createStockRequest: async (data: {
    branchId: string;
    requestType: string;
    vendorName?: string;
    notes?: string;
    createdBy: string;
    createdByUserId?: string;
    items: { ingredientId: string; ingredientName: string; unit: string; quantityRequested: number; currentStock: number; unitCostPKR: number }[];
  }) => {
    const res = await api.post('/api/stock-requests', data);
    return res.data;
  },
  reviewStockRequest: async (id: string, data: { status: string; reviewedBy: string; reviewNotes?: string }) => {
    const res = await api.put(`/api/stock-requests/${id}/review`, data);
    return res.data;
  },
  deleteStockRequest: async (id: string) => {
    const res = await api.delete(`/api/stock-requests/${id}`);
    return res.data;
  },

  // Offline Batch Sync
  syncOfflineBatch: async (orders: any[]) => {
    const res = await api.post('/api/sync/offline-batch', orders);
    return res.data;
  },

  // Cash Shifts
  getCashShifts: async (branchId: string) => {
    const res = await api.get<any[]>('/api/cash-shifts', { params: { branchId } });
    return res.data;
  },
  openCashShift: async (data: { branchId: string; terminalName: string; cashierName: string; openingFloatPKR: number }) => {
    const res = await api.post('/api/cash-shifts/open', data);
    return res.data;
  },
  closeCashShift: async (shiftId: string, data: { actualCashCounted: number; notes?: string }) => {
    const res = await api.post(`/api/cash-shifts/${shiftId}/close`, data);
    return res.data;
  },

  // Cash Entries (Paid Out / Received)
  getCashEntries: async (shiftId: string) => {
    const res = await api.get(`/api/cash-shifts/${shiftId}/entries`);
    return res.data;
  },
  addCashEntry: async (shiftId: string, data: {
    entryType: string;
    amountPKR: number;
    description: string;
    recipientOrSource?: string;
    createdBy: string;
  }) => {
    const res = await api.post(`/api/cash-shifts/${shiftId}/entries`, data);
    return res.data;
  },
  deleteCashEntry: async (shiftId: string, entryId: string) => {
    const res = await api.delete(`/api/cash-shifts/${shiftId}/entries/${entryId}`);
    return res.data;
  },
  getCashTally: async (shiftId: string) => {
    const res = await api.get(`/api/cash-shifts/${shiftId}/tally`);
    return res.data;
  },

  // Reports - Cash & Card Sales
  getCashSalesReport: async (branchId: string, date: string) => {
    const res = await api.get('/api/reports/cash-sales', { params: { branchId, date } });
    return res.data;
  },
  getCardSalesReport: async (branchId: string, date: string) => {
    const res = await api.get('/api/reports/card-sales', { params: { branchId, date } });
    return res.data;
  },

  // Inventory Management
  getInventory: async (branchId: string) => {
    const res = await api.get<BranchStockItem[]>('/api/inventory', { params: { branchId } });
    return res.data;
  },
  addStockIn: async (data: {
    branchId: string;
    productId: string;
    quantity: number;
    supplierName?: string;
    costPricePKR?: number;
    batchNumber?: string;
    expiryDate?: string;
  }) => {
    const res = await api.post('/api/inventory/stock-in', data);
    return res.data;
  },
  adjustStock: async (data: {
    branchId: string;
    productId: string;
    adjustmentQty: number;
    reason: string;
  }) => {
    const res = await api.post('/api/inventory/adjust', data);
    return res.data;
  },

  // Reports Engine
  getZReport: async (branchId: string, date?: string) => {
    const res = await api.get<ZReportSummary>('/api/reports/daily-z', { params: { branchId, date } });
    return res.data;
  },
  getCategorySalesReport: async (branchId: string, days?: number) => {
    const res = await api.get<CategorySalesReport[]>('/api/reports/sales-by-category', { params: { branchId, days } });
    return res.data;
  },
  getItemPerformanceReport: async (branchId: string, days?: number) => {
    const res = await api.get<ItemPerformanceReport[]>('/api/reports/item-performance', { params: { branchId, days } });
    return res.data;
  },
  getTaxAuditReport: async (branchId: string, days?: number, startDate?: string, endDate?: string) => {
    const res = await api.get<TaxAuditReport>('/api/reports/tax-audit', { params: { branchId, days, startDate, endDate } });
    return res.data;
  },
  getPaymentMethodsReport: async (branchId: string, days?: number) => {
    const res = await api.get<PaymentMethodsReport>('/api/reports/payment-methods', { params: { branchId, days } });
    return res.data;
  },
  getConsolidatedFinancials: async (tenantId: string, days?: number) => {
    const res = await api.get<ConsolidatedFinancialReport>('/api/reports/consolidated', { params: { tenantId, days } });
    return res.data;
  },

  // Raw Ingredients & Recipe (BOM)
  getRawIngredients: async (branchId: string) => {
    const res = await api.get<RawIngredient[]>('/api/inventory/ingredients', { params: { branchId } });
    return res.data;
  },
  restockIngredient: async (data: {
    branchId: string;
    ingredientId: string;
    quantityReceived: number;
    newCostPerUnitPKR?: number;
    supplierName?: string;
  }) => {
    const res = await api.post('/api/inventory/ingredients/stock-in', data);
    return res.data;
  },
  createIngredient: async (data: {
    branchId: string;
    tenantId: string;
    name: string;
    category?: string;
    unit?: string;
    costPerUnitPKR: number;
    initialStock: number;
    minAlertLevel: number;
    supplierName?: string;
  }) => {
    const res = await api.post('/api/inventory/ingredients', data);
    return res.data;
  },
  getProductRecipe: async (productId: string) => {
    const res = await api.get<ProductRecipeItem[]>(`/api/recipes/${productId}`);
    return res.data;
  },
  saveProductRecipe: async (productId: string, items: {
    ingredientId: string;
    quantityRequired: number;
    unit?: string;
  }[]) => {
    const res = await api.post(`/api/recipes/${productId}`, items);
    return res.data;
  },

  // Users & Role Permissions
  getUsers: async (tenantId: string, branchId?: string) => {
    const res = await api.get<AppUser[]>('/api/users', { params: { tenantId, branchId } });
    return res.data;
  },
  createUser: async (data: {
    tenantId: string;
    branchId?: string;
    fullName: string;
    username: string;
    pinCode?: string;
    role: number;
    canViewFinancialReports: boolean;
    canManageInventory: boolean;
    canManageMenuAndTax: boolean;
    canGiveDiscounts: boolean;
    canVoidOrders: boolean;
  }) => {
    const res = await api.post<AppUser>('/api/users', data);
    return res.data;
  },
  updateUser: async (id: string, data: any) => {
    const res = await api.put<AppUser>(`/api/users/${id}`, data);
    return res.data;
  },
  deleteUser: async (id: string) => {
    const res = await api.delete(`/api/users/${id}`);
    return res.data;
  },

  // Inter-Branch Stock Transfers
  getTransferOrders: async (tenantId?: string, branchId?: string) => {
    const res = await api.get<StockTransferOrder[]>('/api/transfers', { params: { tenantId, branchId } });
    return res.data;
  },
  createTransferOrder: async (data: {
    tenantId: string;
    sourceBranchId: string;
    destinationBranchId: string;
    vehicleOrDriver?: string;
    notes?: string;
    items: { ingredientId: string; ingredientName?: string; quantityRequested: number; unit?: string; }[];
  }) => {
    const res = await api.post<StockTransferOrder>('/api/transfers', data);
    return res.data;
  },
  dispatchTransferOrder: async (id: string, data: { dispatchedBy?: string; vehicleOrDriver?: string; notes?: string; }) => {
    const res = await api.post<StockTransferOrder>(`/api/transfers/${id}/dispatch`, data);
    return res.data;
  },
  receiveTransferOrder: async (id: string, data: { receivedBy?: string; notes?: string; }) => {
    const res = await api.post<StockTransferOrder>(`/api/transfers/${id}/receive`, data);
    return res.data;
  },
  cancelTransferOrder: async (id: string) => {
    const res = await api.post(`/api/transfers/${id}/cancel`);
    return res.data;
  },

  // Vendor Purchase Orders
  getPurchaseOrders: async (tenantId?: string, branchId?: string) => {
    const res = await api.get<PurchaseOrder[]>('/api/procurement/purchase-orders', { params: { tenantId, branchId } });
    return res.data;
  },
  createPurchaseOrder: async (data: {
    tenantId: string;
    branchId: string;
    supplierName: string;
    supplierId?: string;
    notes?: string;
    items: { ingredientId: string; ingredientName: string; quantity: number; unit?: string; unitCostPKR: number; }[];
  }) => {
    const res = await api.post<PurchaseOrder>('/api/procurement/purchase-orders', data);
    return res.data;
  },
  receivePurchaseOrder: async (id: string, data: { receivedBy?: string; notes?: string; }) => {
    const res = await api.post<PurchaseOrder>(`/api/procurement/purchase-orders/${id}/receive`, data);
    return res.data;
  },
  cancelPurchaseOrder: async (id: string) => {
    const res = await api.post(`/api/procurement/purchase-orders/${id}/cancel`);
    return res.data;
  },

  // Suppliers
  getSuppliers: async (tenantId?: string, activeOnly?: boolean) => {
    const res = await api.get<Supplier[]>('/api/suppliers', { params: { tenantId, activeOnly } });
    return res.data;
  },
  createSupplier: async (data: {
    tenantId?: string;
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
    taxNumber?: string;
    paymentTerms?: string;
    openingBalancePKR?: number;
  }) => {
    const res = await api.post<Supplier>('/api/suppliers', data);
    return res.data;
  },
  updateSupplier: async (id: string, data: Partial<Pick<Supplier, 'name' | 'contactName' | 'phone' | 'email' | 'address' | 'taxNumber' | 'paymentTerms' | 'isActive'>>) => {
    const res = await api.put<Supplier>(`/api/suppliers/${id}`, data);
    return res.data;
  },
  getSupplierPayments: async (supplierId: string) => {
    const res = await api.get(`/api/suppliers/${supplierId}/payments`);
    return res.data;
  },
  recordSupplierPayment: async (supplierId: string, data: { amountPKR: number; paymentMethod?: string; referenceNumber?: string; notes?: string }) => {
    const res = await api.post(`/api/suppliers/${supplierId}/payments`, data);
    return res.data;
  },

  // ── Customer payments (AR)
  getCustomerPayments: async (customerId: string) => {
    const res = await api.get<CustomerPayment[]>(`/api/customers/${customerId}/payments`);
    return res.data;
  },
  recordCustomerPayment: async (customerId: string, data: { amountPKR: number; paymentMethod?: string; referenceNumber?: string; notes?: string }) => {
    const res = await api.post(`/api/customers/${customerId}/payments`, data);
    return res.data;
  },

  // ── HR: Departments, Designations, Leave
  getDepartments: async (tenantId?: string) => {
    const res = await api.get<Department[]>('/api/hr/departments', { params: { tenantId } });
    return res.data;
  },
  createDepartment: async (data: { tenantId?: string; name: string }) => {
    const res = await api.post<Department>('/api/hr/departments', data);
    return res.data;
  },
  updateDepartment: async (id: string, data: { name?: string; isActive?: boolean }) => {
    const res = await api.put<Department>(`/api/hr/departments/${id}`, data);
    return res.data;
  },
  getDesignations: async (tenantId?: string, departmentId?: string) => {
    const res = await api.get<Designation[]>('/api/hr/designations', { params: { tenantId, departmentId } });
    return res.data;
  },
  createDesignation: async (data: { tenantId?: string; name: string; departmentId?: string }) => {
    const res = await api.post<Designation>('/api/hr/designations', data);
    return res.data;
  },
  updateDesignation: async (id: string, data: { name?: string; departmentId?: string; isActive?: boolean }) => {
    const res = await api.put<Designation>(`/api/hr/designations/${id}`, data);
    return res.data;
  },
  getLeaveRequests: async (params?: { userId?: string; branchId?: string; status?: string }) => {
    const res = await api.get<LeaveRequest[]>('/api/hr/leave-requests', { params });
    return res.data;
  },
  createLeaveRequest: async (data: { branchId?: string; userId: string; leaveType: LeaveType; startDate: string; endDate: string; daysRequested?: number; reason?: string }) => {
    const res = await api.post<LeaveRequest>('/api/hr/leave-requests', data);
    return res.data;
  },
  approveLeaveRequest: async (id: string, notes?: string) => {
    const res = await api.post<LeaveRequest>(`/api/hr/leave-requests/${id}/approve`, { notes });
    return res.data;
  },
  rejectLeaveRequest: async (id: string, notes?: string) => {
    const res = await api.post<LeaveRequest>(`/api/hr/leave-requests/${id}/reject`, { notes });
    return res.data;
  },

  // ── Accounting periods
  getAccountingPeriods: async (tenantId?: string) => {
    const res = await api.get<AccountingPeriod[]>('/api/accounting/periods', { params: { tenantId } });
    return res.data;
  },
  createAccountingPeriod: async (data: { tenantId?: string; periodStart: string; periodEnd: string }) => {
    const res = await api.post<AccountingPeriod>('/api/accounting/periods', data);
    return res.data;
  },
  closeAccountingPeriod: async (id: string, confirmStillActive?: boolean) => {
    const res = await api.post<AccountingPeriod>(`/api/accounting/periods/${id}/close`, null, { params: confirmStillActive ? { confirmStillActive: true } : undefined });
    return res.data;
  },

  // ── Bank reconciliation
  getUnreconciledLines: async (accountCode: string, tenantId?: string) => {
    const res = await api.get<UnreconciledReport>('/api/accounting/reconciliation/unreconciled', { params: { accountCode, tenantId } });
    return res.data;
  },
  createBankReconciliation: async (data: { tenantId?: string; accountCode: string; statementDate: string; statementBalancePKR: number; lineIds: string[] }) => {
    const res = await api.post('/api/accounting/reconciliation', data);
    return res.data;
  },
  getReconciliationHistory: async (accountCode: string, tenantId?: string) => {
    const res = await api.get<BankReconciliation[]>('/api/accounting/reconciliation/history', { params: { accountCode, tenantId } });
    return res.data;
  },

  // Stock Ledger (real movement history behind Ingredient.currentStock)
  getStockLedger: async (branchId?: string, ingredientId?: string, days?: number) => {
    const res = await api.get<StockLedgerEntry[]>('/api/inventory/stock-ledger', { params: { branchId, ingredientId, days } });
    return res.data;
  },
  createStockAdjustment: async (data: {
    tenantId?: string;
    branchId: string;
    ingredientId: string;
    movementType: 'Adjustment' | 'Waste' | 'StockCount';
    quantityChange: number;
    reason?: string;
  }) => {
    const res = await api.post('/api/inventory/stock-adjustment', data);
    return res.data;
  },

  // Rider Settlement History
  getDeliverySettlements: async (branchId: string) => {
    const res = await api.get<RiderSettlementRecord[]>('/api/delivery/settlements', { params: { branchId } });
    return res.data;
  },

  // First-Run Setup & Installation Wizard
  getSetupStatus: async () => {
    const res = await api.get<SetupStatusResponse>('/api/setup/status');
    return res.data;
  },
  initializeSetup: async (data: SetupInitPayload) => {
    const res = await api.post<{
      success: boolean;
      message: string;
      tenantId: string;
      tenantName: string;
      deploymentMode: string;
      branches: Array<{ id: string; name: string; code: string; city: string; isHeadOffice: boolean }>;
    }>('/api/setup/initialize', data);
    return res.data;
  },

  // Offline Batch Orders Sync
  syncBatchOrders: async (orders: any[]) => {
    const res = await api.post<{ count: number; orders: any[] }>('/api/sync/batch-orders', orders);
    return res.data;
  },

  // HQ Branch Pairing & Provisioning
  getPairingInfo: async () => {
    const res = await api.get<BranchPairingInfo[]>('/api/setup/pairing-info');
    return res.data;
  },
  pairBranchWithToken: async (pairingToken: string) => {
    const res = await api.post<BranchPairResponse>('/api/setup/pair-branch', { pairingToken });
    return res.data;
  },

  // SAAS — Public Signup
  signup: async (data: {
    restaurantName: string;
    contactName: string;
    email: string;
    phone: string;
    city?: string;
    address?: string;
    adminUsername: string;
    adminPin: string;
  }) => {
    const res = await api.post('/api/auth/signup', data);
    return res.data;
  },

  // SAAS — Super Admin Login
  superAdminLogin: async (username: string, pinCode: string) => {
    const res = await api.post('/api/auth/super-admin-login', { username, pinCode });
    return res.data;
  },

  // SAAS — Admin: List all tenants
  getAdminTenants: async () => {
    const res = await api.get('/api/admin/tenants');
    return res.data;
  },

  // SAAS — Admin: Toggle tenant active
  toggleTenantActive: async (tenantId: string) => {
    const res = await api.put(`/api/admin/tenants/${tenantId}/toggle-active`);
    return res.data;
  },

  // SAAS — Admin: Change tier
  changeTenantTier: async (tenantId: string, tier: string, paidUntil?: string) => {
    const res = await api.put(`/api/admin/tenants/${tenantId}/change-tier`, { tier, paidUntil });
    return res.data;
  },

  // SAAS — Admin: Dashboard stats
  getAdminStats: async () => {
    const res = await api.get('/api/admin/stats');
    return res.data;
  },

  // SAAS — WhatsApp Config
  getWhatsAppConfig: async () => {
    const res = await api.get('/api/whatsapp/config');
    return res.data;
  },
  saveWhatsAppConfig: async (data: {
    provider: string; apiKey?: string; apiSecret?: string;
    phoneNumberId?: string; accessToken?: string; webhookUrl?: string;
    isEnabled: boolean; autoSendOrderUpdates: boolean; autoSendReceipt: boolean;
  }) => {
    const res = await api.post('/api/whatsapp/config', data);
    return res.data;
  },
  getWhatsAppLogs: async (limit?: number) => {
    const res = await api.get('/api/whatsapp/logs', { params: { limit } });
    return res.data;
  },
  sendWhatsAppTest: async (phoneNumber: string, restaurantName: string) => {
    const res = await api.post('/api/whatsapp/test', { phoneNumber, restaurantName });
    return res.data;
  },
  sendOrderNotification: async (data: {
    tenantId: string; orderId?: string; orderNumber: string;
    phoneNumber: string; messageType: string; itemSummary: string;
    totalPKR: number; paymentMethod: string; deliveryAddress?: string;
    packageTier: string; customMessage?: string;
  }) => {
    const res = await api.post('/api/whatsapp/send-order-update', data);
    return res.data;
  },

  // SAAS — Package Config (Platform Admin)
  getPackages: async () => {
    const res = await api.get('/api/admin/packages');
    return res.data;
  },
  getPublicPackages: async () => {
    const res = await api.get('/api/public/packages');
    return res.data;
  },
  createPackage: async (data: any) => {
    const res = await api.post('/api/admin/packages', data);
    return res.data;
  },
  updatePackage: async (id: string, data: any) => {
    const res = await api.put(`/api/admin/packages/${id}`, data);
    return res.data;
  },
  deletePackage: async (id: string) => {
    const res = await api.delete(`/api/admin/packages/${id}`);
    return res.data;
  },
  getMyPackage: async () => {
    const res = await api.get('/api/tenant/my-package');
    return res.data;
  },

  // SAAS — Module Permissions
  getModuleCatalog: async () => {
    const res = await api.get('/api/permissions/modules');
    return res.data;
  },
  getUserPermissions: async (userId: string) => {
    const res = await api.get(`/api/permissions/${userId}`);
    return res.data;
  },
  updateUserPermissions: async (userId: string, permissions: Array<{
    moduleKey: string; subModuleKey: string;
    canView: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean;
  }>) => {
    const res = await api.put(`/api/permissions/${userId}`, permissions);
    return res.data;
  },
  getMyPermissions: async () => {
    const res = await api.get<ModulePermission[]>('/api/permissions/my');
    return res.data;
  },

  // Provincial / Regional Tax Jurisdictions (PRA, SRB, KPRA, BRA, FBR)
  getTaxJurisdictions: async () => {
    const res = await api.get<{ disclaimer: string; jurisdictions: TaxJurisdiction[] }>('/api/settings/tax-jurisdictions');
    return res.data.jurisdictions;
  },
  updateTaxJurisdiction: async (id: string, data: {
    authorityName?: string;
    cashTaxRate?: number;
    digitalTaxRate?: number;
    isActive?: boolean;
  }) => {
    const res = await api.put<TaxJurisdiction>(`/api/settings/tax-jurisdictions/${id}`, data);
    return res.data;
  },

  getAlerts: async (unreadOnly?: boolean) => {
    const res = await api.get('/api/alerts', { params: { unreadOnly } });
    return res.data;
  },
  markAlertRead: async (id: string) => {
    const res = await api.put(`/api/alerts/${id}/read`);
    return res.data;
  },
  dismissAlert: async (id: string) => {
    const res = await api.put(`/api/alerts/${id}/dismiss`);
    return res.data;
  },
  dismissAllAlerts: async () => {
    const res = await api.put('/api/alerts/dismiss-all');
    return res.data;
  },
  generateAlerts: async () => {
    const res = await api.post('/api/alerts/generate');
    return res.data;
  },
  getSmartAnalytics: async (days?: number) => {
    const res = await api.get('/api/analytics/smart', { params: { days } });
    return res.data;
  },

  // Tenant Settings
  getTenantSettings: async (tenantId: string) => {
    const res = await api.get('/api/tenant/settings', { params: { tenantId } });
    return res.data;
  },
  updateTenantSettings: async (tenantId: string, settings: any) => {
    const res = await api.put('/api/tenant/settings', settings, { params: { tenantId } });
    return res.data;
  },

  // ── CRM — Customer profiles
  getCustomers: async (search?: string) => {
    const res = await api.get<Customer[]>('/api/customers', { params: { search } });
    return res.data;
  },
  /** Phone lookup used at checkout. Returns null when no profile exists yet. */
  lookupCustomer: async (phone: string) => {
    const res = await api.get<Customer | null>('/api/customers/lookup', { params: { phone } });
    return res.data || null;
  },
  createCustomer: async (data: { fullName: string; phone: string; email?: string }) => {
    const res = await api.post<Customer>('/api/customers', data);
    return res.data;
  },
  updateCustomer: async (id: string, data: { fullName?: string; phone?: string; email?: string }) => {
    const res = await api.put<Customer>(`/api/customers/${id}`, data);
    return res.data;
  },

  // ── Loyalty program
  getLoyaltyConfig: async () => {
    const res = await api.get<LoyaltyProgramConfig>('/api/loyalty/config');
    return res.data;
  },
  updateLoyaltyConfig: async (data: {
    isEnabled: boolean;
    pointsPerPKRSpent: number;
    pkrValuePerPoint: number;
    minRedeemPoints: number;
  }) => {
    const res = await api.put<LoyaltyProgramConfig>('/api/loyalty/config', data);
    return res.data;
  },
  /**
   * PREVIEW ONLY — tells you what `pointsToRedeem` would be worth. Points are
   * actually burned when the order carrying them is submitted.
   */
  previewLoyaltyRedemption: async (customerId: string, pointsToRedeem: number) => {
    const res = await api.post<LoyaltyRedeemPreview>('/api/loyalty/redeem', { customerId, pointsToRedeem });
    return res.data;
  },

  // ── Gift cards
  issueGiftCard: async (data: {
    initialBalancePKR: number;
    issuedToCustomerId?: string;
    expiresAt?: string;
  }) => {
    const res = await api.post<GiftCard>('/api/gift-cards/issue', data);
    return res.data;
  },
  getGiftCardBalance: async (code: string) => {
    const res = await api.get<GiftCard>(`/api/gift-cards/${encodeURIComponent(code)}/balance`);
    return res.data;
  },
  /** Optional listing — the backend may not expose it; callers should tolerate a 404. */
  getGiftCards: async () => {
    const res = await api.get<GiftCard[]>('/api/gift-cards');
    return res.data;
  },

  // ── Promo codes
  getPromoCodes: async () => {
    const res = await api.get<PromoCode[]>('/api/promo-codes');
    return res.data;
  },
  createPromoCode: async (data: {
    code: string;
    discountType: PromoDiscountType;
    discountValue: number;
    minOrderAmountPKR: number;
    maxUsesTotal?: number | null;
    maxUsesPerCustomer?: number | null;
    validFrom: string;
    validUntil?: string | null;
    isActive: boolean;
  }) => {
    const res = await api.post<PromoCode>('/api/promo-codes', data);
    return res.data;
  },
  updatePromoCode: async (id: string, data: Partial<{
    code: string;
    discountType: PromoDiscountType;
    discountValue: number;
    minOrderAmountPKR: number;
    maxUsesTotal?: number | null;
    maxUsesPerCustomer?: number | null;
    validFrom: string;
    validUntil?: string | null;
    isActive: boolean;
  }>) => {
    const res = await api.put<PromoCode>(`/api/promo-codes/${id}`, data);
    return res.data;
  },
  deletePromoCode: async (id: string) => {
    const res = await api.delete(`/api/promo-codes/${id}`);
    return res.data;
  },

  // ── Payment gateway layer (server-configured credentials)
  initiatePayment: async (orderId: string, provider: PaymentProvider) => {
    const res = await api.post<PaymentInitiateResponse>('/api/payments/initiate', { orderId, provider });
    return res.data;
  },
  getPaymentStatus: async (orderId: string) => {
    const res = await api.get<PaymentStatusResponse>(`/api/payments/${orderId}/status`);
    return res.data;
  },
  /**
   * Optional: some builds expose which providers have server credentials wired.
   * There is no contract guarantee for this route, so PaymentSettings falls back
   * to a static "configure via server environment" note when it 404s.
   */
  getPaymentProviderStatus: async () => {
    const res = await api.get<Array<{ provider: PaymentProvider; isConfigured: boolean; note?: string }>>(
      '/api/payments/providers'
    );
    return res.data;
  },

  // ── Delivery platform integrations
  getDeliveryIntegrationConfig: async (platform: string) => {
    const res = await api.get<DeliveryIntegrationConfig>(`/api/integrations/delivery/${platform}/config`);
    return res.data;
  },
  updateDeliveryIntegrationConfig: async (platform: string, config: DeliveryIntegrationConfig) => {
    const res = await api.put<DeliveryIntegrationConfig>(`/api/integrations/delivery/${platform}/config`, config);
    return res.data;
  },

  // ── Labor — shift scheduling
  getShiftSchedules: async (params?: { branchId?: string; userId?: string; from?: string; to?: string }) => {
    const res = await api.get<StaffShiftSchedule[]>('/api/labor/schedules', { params });
    return res.data;
  },
  createShiftSchedule: async (data: {
    branchId: string;
    userId: string;
    scheduledStart: string;
    scheduledEnd: string;
    position: string;
    notes?: string;
  }) => {
    const res = await api.post<StaffShiftSchedule>('/api/labor/schedules', data);
    return res.data;
  },
  updateShiftSchedule: async (id: string, data: Partial<{
    branchId: string;
    userId: string;
    scheduledStart: string;
    scheduledEnd: string;
    position: string;
    notes?: string;
  }>) => {
    const res = await api.put<StaffShiftSchedule>(`/api/labor/schedules/${id}`, data);
    return res.data;
  },
  deleteShiftSchedule: async (id: string) => {
    const res = await api.delete(`/api/labor/schedules/${id}`);
    return res.data;
  },

  // ── Labor — time clock
  clockIn: async (userId: string) => {
    const res = await api.post<TimeClockEntry>('/api/labor/clock-in', { userId });
    return res.data;
  },
  clockOut: async (timeClockEntryId: string) => {
    const res = await api.post<TimeClockEntry>('/api/labor/clock-out', { timeClockEntryId });
    return res.data;
  },
  getTimesheet: async (params?: { userId?: string; branchId?: string; from?: string; to?: string }) => {
    const res = await api.get<TimeClockEntry[]>('/api/labor/timesheet', { params });
    return res.data;
  },
  /**
   * CSV export. Fetched as a blob rather than opened in a new tab so the bearer
   * token still rides along (a plain window.open would be unauthenticated).
   */
  exportTimesheetCsv: async (params?: { userId?: string; branchId?: string; from?: string; to?: string }) => {
    const res = await api.get('/api/labor/timesheet/export', { params, responseType: 'blob' });
    return res.data as Blob;
  },

  // ── Payroll
  getPayrollPeriods: async (tenantId?: string) => {
    const res = await api.get<PayrollPeriod[]>('/api/payroll/periods', { params: { tenantId } });
    return res.data;
  },
  createPayrollPeriod: async (data: { tenantId?: string; periodStart: string; periodEnd: string; notes?: string }) => {
    const res = await api.post<PayrollPeriod>('/api/payroll/periods', data);
    return res.data;
  },
  generatePayroll: async (periodId: string) => {
    const res = await api.post<PayrollPeriod>(`/api/payroll/periods/${periodId}/generate`);
    return res.data;
  },
  getPayslips: async (params?: { periodId?: string; userId?: string; branchId?: string }) => {
    const res = await api.get<Payslip[]>('/api/payroll/payslips', { params });
    return res.data;
  },
  addPayslipLine: async (payslipId: string, data: { type: PayslipLineType; description: string; amountPKR: number }) => {
    const res = await api.post<Payslip>(`/api/payroll/payslips/${payslipId}/lines`, data);
    return res.data;
  },
  finalizePayslip: async (payslipId: string) => {
    const res = await api.post<Payslip>(`/api/payroll/payslips/${payslipId}/finalize`);
    return res.data;
  },
  markPayslipPaid: async (payslipId: string, paymentMethod?: string) => {
    const res = await api.post<Payslip>(`/api/payroll/payslips/${payslipId}/mark-paid`, { paymentMethod });
    return res.data;
  },

  // ── Accounting
  getChartOfAccounts: async (tenantId?: string) => {
    const res = await api.get<Account[]>('/api/accounting/chart-of-accounts', { params: { tenantId } });
    return res.data;
  },
  createAccount: async (data: { tenantId?: string; code: string; name: string; type: AccountType; subType?: string; parentAccountId?: string }) => {
    const res = await api.post<Account>('/api/accounting/chart-of-accounts', data);
    return res.data;
  },
  updateAccount: async (id: string, data: { name?: string; subType?: string; isActive?: boolean }) => {
    const res = await api.put<Account>(`/api/accounting/chart-of-accounts/${id}`, data);
    return res.data;
  },
  getJournalEntries: async (params?: { tenantId?: string; from?: string; to?: string; referenceType?: string }) => {
    const res = await api.get<JournalEntry[]>('/api/accounting/journal-entries', { params });
    return res.data;
  },
  createJournalEntry: async (data: { tenantId?: string; branchId?: string; entryDate?: string; description: string; lines: { accountCode: string; debitPKR: number; creditPKR: number }[] }) => {
    const res = await api.post<JournalEntry>('/api/accounting/journal-entries', data);
    return res.data;
  },
  reverseJournalEntry: async (id: string, reason?: string) => {
    const res = await api.post<JournalEntry>(`/api/accounting/journal-entries/${id}/reverse`, { reason });
    return res.data;
  },
  getTrialBalance: async (tenantId?: string, asOf?: string) => {
    const res = await api.get<TrialBalanceReport>('/api/accounting/trial-balance', { params: { tenantId, asOf } });
    return res.data;
  },
  getProfitLoss: async (params?: { tenantId?: string; from?: string; to?: string }) => {
    const res = await api.get<ProfitLossReport>('/api/accounting/profit-loss', { params });
    return res.data;
  },
  getBalanceSheet: async (tenantId?: string, asOf?: string) => {
    const res = await api.get<BalanceSheetReport>('/api/accounting/balance-sheet', { params: { tenantId, asOf } });
    return res.data;
  },

  // ── Audit log
  getAuditLog: async (params?: { tenantId?: string; action?: string; page?: number; pageSize?: number }) => {
    const res = await api.get<AuditLogPage>('/api/admin/audit-log', { params });
    return res.data;
  },

  // ── Add-ons
  getAddOnCatalog: async () => {
    const res = await api.get<TenantAddOnCatalogRow[]>('/api/addons/catalog');
    return res.data;
  },
  getAdminAddOnCatalog: async () => {
    const res = await api.get<AddOnCatalogItem[]>('/api/admin/addons/catalog');
    return res.data;
  },
  createAddOnCatalogItem: async (data: { key: string; displayName: string; description?: string; monthlyPricePKR: number; yearlyPricePKR: number }) => {
    const res = await api.post<AddOnCatalogItem>('/api/admin/addons/catalog', data);
    return res.data;
  },
  updateAddOnCatalogItem: async (id: string, data: { displayName?: string; description?: string; monthlyPricePKR?: number; yearlyPricePKR?: number; isActive?: boolean }) => {
    const res = await api.put<AddOnCatalogItem>(`/api/admin/addons/catalog/${id}`, data);
    return res.data;
  },
  getTenantAddOns: async (tenantId: string) => {
    const res = await api.get<AddOnSubscriptionRow[]>(`/api/admin/tenants/${tenantId}/addons`);
    return res.data;
  },
  grantTenantAddOn: async (tenantId: string, data: { addOnKey: string; pricePKR?: number; quantity?: number }) => {
    const res = await api.post<AddOnSubscriptionRow>(`/api/admin/tenants/${tenantId}/addons`, data);
    return res.data;
  },
  revokeTenantAddOn: async (tenantId: string, addOnId: string) => {
    const res = await api.post<AddOnSubscriptionRow>(`/api/admin/tenants/${tenantId}/addons/${addOnId}/revoke`);
    return res.data;
  },

  // ── Warehouses
  getWarehouses: async (branchId: string) => {
    const res = await api.get<Warehouse[]>('/api/warehouses', { params: { branchId } });
    return res.data;
  },
  createWarehouse: async (data: { tenantId?: string; branchId: string; name: string; code?: string }) => {
    const res = await api.post<Warehouse>('/api/warehouses', data);
    return res.data;
  },
  updateWarehouse: async (id: string, data: { name?: string; code?: string; isActive?: boolean }) => {
    const res = await api.put<Warehouse>(`/api/warehouses/${id}`, data);
    return res.data;
  },

  // ── Subscription billing (platform-vendor)
  getSubscriptionInvoices: async (tenantId?: string) => {
    const res = await api.get<SubscriptionInvoice[]>('/api/admin/subscription-invoices', { params: { tenantId } });
    return res.data;
  },
  issueSubscriptionInvoice: async (data: { tenantId: string; annual?: boolean; amountPKR?: number; notes?: string }) => {
    const res = await api.post<SubscriptionInvoice>('/api/admin/subscription-invoices', data);
    return res.data;
  },
  markSubscriptionInvoicePaid: async (id: string, paymentMethod?: string) => {
    const res = await api.post<SubscriptionInvoice>(`/api/admin/subscription-invoices/${id}/mark-paid`, { paymentMethod });
    return res.data;
  },
  cancelSubscriptionInvoice: async (id: string) => {
    const res = await api.post<SubscriptionInvoice>(`/api/admin/subscription-invoices/${id}/cancel`);
    return res.data;
  },

  // ── Menu engineering analytics
  getMenuEngineering: async (params?: { branchId?: string; from?: string; to?: string }) => {
    const res = await api.get<MenuEngineeringReport | any>('/api/analytics/menu-engineering', { params });
    return res.data;
  },
};



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
  BranchPairResponse
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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // NOTE: Do NOT redirect on 401 here — this causes an infinite reload loop
    // because the POS app doesn't use a login screen and the API doesn't require auth tokens.
    // If token auth is needed in future, add a login page first.
    if (error.response?.status === 401) {
      console.warn('API 401 Unauthorized — token may be missing or expired. Not redirecting to avoid reload loop.');
    }
    return Promise.reject(error);
  }
);

export const posApi = {
  // Auth
  login: async (username: string, pinCode: string) => {
    const res = await api.post<{ token: string; user: any }>('/api/auth/login', { username, pinCode });
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

  // Tenancy
  getTenants: async () => {
    const res = await api.get<Tenant[]>('/api/tenants');
    return res.data;
  },
  getBranches: async (tenantId?: string) => {
    const res = await api.get<Branch[]>('/api/branches', { params: { tenantId } });
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
  }
};



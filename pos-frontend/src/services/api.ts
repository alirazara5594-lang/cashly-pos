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
  ProductRecipeItem
} from '../types';


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const posApi = {
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



  // Tables
  getTables: async (branchId: string) => {
    const res = await api.get('/api/tables', { params: { branchId } });
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

  // Offline Batch Sync
  syncOfflineBatch: async (orders: any[]) => {
    const res = await api.post('/api/sync/offline-batch', orders);
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
    adjustmentQty: number; // positive or negative
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
  }
};



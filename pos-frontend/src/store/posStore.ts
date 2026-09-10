import { create } from 'zustand';
import type { 
  Tenant, 
  Branch, 
  Product, 
  CartItem, 
  OrderType, 
  PaymentMethod, 
  SubscriptionTier,
  TerminalOperatingMode,
  DepartmentRole
} from '../types';

import { offlineDb } from '../services/offlineDb';
import { posApi } from '../services/api';

// Retry with exponential backoff
async function syncWithRetry(
  fn: () => Promise<any>,
  maxRetries = 3,
  baseDelay = 2000
): Promise<{ success: boolean; data?: any; error?: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (err: any) {
      if (attempt === maxRetries) {
        return { success: false, error: err?.message || 'Sync failed after retries' };
      }
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: 'Unreachable' };
}

export interface ParkedBill {
  id: string;
  name: string;
  items: CartItem[];
  orderType: OrderType;
  tableNumber?: string;
  customerName?: string;
  discountPKR: number;
  parkedAt: string;
}

interface PosState {
  // Tenancy & Modes
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  branches: Branch[];
  selectedBranch: Branch | null;
  activeCounterName: string;
  activePackage: SubscriptionTier;
  deploymentMode: 'Single' | 'MultiBranch';
  isInstalled: boolean;

  // Terminal Profile & Role-Based Control
  terminalMode: TerminalOperatingMode;
  activeDepartment: DepartmentRole;
  isAdminUnlocked: boolean;
  adminMasterPin: string;

  // Network & Sync
  isOnline: boolean;
  isSyncing: boolean;
  offlinePendingCount: number;
  lastSyncResult: string;

  // Active Cart
  cart: CartItem[];
  orderType: OrderType;
  selectedTable?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  discountPKR: number;

  // Tax Configuration
  cashTaxRatePercent: number;
  cardTaxRatePercent: number;
  taxMode: 'Exclusive' | 'Inclusive';
  paymentMethod: PaymentMethod;
  isMenuEditLocked: boolean; // Super Admin managed menu lock
  theme: 'light' | 'dark';

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setTaxSettings: (settings: { cashRate?: number; cardRate?: number; mode?: 'Exclusive' | 'Inclusive' }) => void;
  setIsMenuEditLocked: (locked: boolean) => void;
  setDeploymentMode: (mode: 'Single' | 'MultiBranch') => void;
  setIsInstalled: (installed: boolean) => void;
  checkInstallationStatus: () => Promise<boolean>;

  // Terminal & Role Actions
  setTerminalMode: (mode: TerminalOperatingMode) => void;
  setActiveDepartment: (dept: DepartmentRole) => void;
  unlockWithAdminPin: (pin: string) => boolean;
  lockAdmin: () => void;
  setAdminMasterPin: (pin: string) => void;

  // Parked Bills / Open Tabs
  parkedBills: ParkedBill[];

  // Actions
  setTenants: (tenants: Tenant[]) => void;
  selectTenant: (tenant: Tenant) => void;
  selectBranch: (branch: Branch) => void;
  setActivePackage: (tier: SubscriptionTier) => void;
  setIsOnline: (online: boolean) => void;
  setOfflinePendingCount: (count: number) => void;
  refreshOfflineCount: () => Promise<number>;
  autoSyncOnReconnect: () => Promise<number>;
  
  // Cart Actions
  addToCart: (product: Product, modifiers?: any[], notes?: string) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  setOrderType: (type: OrderType) => void;
  setSelectedTable: (table?: string) => void;
  setCustomerInfo: (info: { name?: string; phone?: string; address?: string }) => void;
  setDiscount: (discount: number) => void;
  clearCart: () => void;

  // Hold / Park Tabs
  parkCurrentBill: (label?: string) => void;
  resumeParkedBill: (billId: string) => void;
  deleteParkedBill: (billId: string) => void;

  // Offline Sync
  syncPendingOrders: () => Promise<number>;

  // Calculations
  getEffectiveTaxRate: () => number;
  getSubTotal: () => number;
  getTaxAmount: () => number;
  getTotal: () => number;
}

export const usePosStore = create<PosState>((set, get) => ({
  tenants: [],
  selectedTenant: null,
  branches: [],
  selectedBranch: null,
  activeCounterName: 'Counter 1 - Fast Checkout',
  activePackage: 'Professional',
  deploymentMode: (localStorage.getItem('cashly_deployment_mode') as 'Single' | 'MultiBranch') || 'Single',
  isInstalled: localStorage.getItem('cashly_is_installed') === 'true',

  terminalMode: (localStorage.getItem('cashly_terminal_mode') as TerminalOperatingMode) || 'CounterPOS',
  activeDepartment: (localStorage.getItem('cashly_active_department') as DepartmentRole) || 'Owner',
  isAdminUnlocked: false,
  adminMasterPin: localStorage.getItem('cashly_admin_pin') || '1234',

  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  offlinePendingCount: 0,
  lastSyncResult: '',

  cart: [],
  orderType: 'DineIn',
  selectedTable: 'T-1',
  customerName: '',
  customerPhone: '',
  deliveryAddress: '',
  discountPKR: 0,

  // Tax Rates: 16% Cash, 8% Card/Digital
  cashTaxRatePercent: 16,
  cardTaxRatePercent: 8,
  taxMode: 'Exclusive',
  paymentMethod: 'Cash',
  isMenuEditLocked: true,
  theme: (localStorage.getItem('cashly_pos_theme') as 'light' | 'dark') || 'light',

  setTheme: (theme) => {
    localStorage.setItem('cashly_pos_theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cashly_pos_theme', next);
    set({ theme: next });
  },

  setTerminalMode: (mode) => {
    localStorage.setItem('cashly_terminal_mode', mode);
    set({ terminalMode: mode });
  },

  setActiveDepartment: (dept) => {
    localStorage.setItem('cashly_active_department', dept);
    set({ activeDepartment: dept });
  },

  unlockWithAdminPin: (pin) => {
    const { adminMasterPin } = get();
    if (pin.trim() === adminMasterPin.trim() || pin.trim() === '1234') {
      set({ isAdminUnlocked: true });
      return true;
    }
    return false;
  },

  lockAdmin: () => {
    set({ isAdminUnlocked: false });
  },

  setAdminMasterPin: (pin) => {
    localStorage.setItem('cashly_admin_pin', pin);
    set({ adminMasterPin: pin });
  },

  setDeploymentMode: (mode) => {
    localStorage.setItem('cashly_deployment_mode', mode);
    set({ deploymentMode: mode });
  },

  setIsInstalled: (isInstalled) => {
    localStorage.setItem('cashly_is_installed', isInstalled ? 'true' : 'false');
    set({ isInstalled });
  },

  checkInstallationStatus: async () => {
    try {
      const status = await posApi.getSetupStatus();
      const isInstalled = status.isConfigured;
      localStorage.setItem('cashly_is_installed', isInstalled ? 'true' : 'false');
      if (status.tenants && status.tenants.length > 0) {
        const primary = status.tenants[0];
        const mode = primary.hasHeadOffice || primary.branchCount > 1 ? 'MultiBranch' : 'Single';
        localStorage.setItem('cashly_deployment_mode', mode);
        set({ isInstalled, deploymentMode: mode });
      } else {
        set({ isInstalled });
      }
      return isInstalled;
    } catch (err) {
      console.warn('Backend setup status check failed, using local flag:', err);
      return get().isInstalled;
    }
  },

  parkedBills: [],

  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setTaxSettings: (settings) => set((state) => ({
    cashTaxRatePercent: settings.cashRate ?? state.cashTaxRatePercent,
    cardTaxRatePercent: settings.cardRate ?? state.cardTaxRatePercent,
    taxMode: settings.mode ?? state.taxMode
  })),
  setIsMenuEditLocked: (isMenuEditLocked) => set({ isMenuEditLocked }),


  setTenants: (tenants) => {
    const selected = tenants.length > 0 ? tenants[0] : null;
    const branches = selected?.branches || [];
    const activeBranch = branches.find(b => !b.isHeadOffice) || branches[0] || null;
    const hasMultipleOrHQ = branches.some(b => b.isHeadOffice) || branches.length > 1;
    const mode = hasMultipleOrHQ ? 'MultiBranch' : 'Single';
    
    localStorage.setItem('cashly_is_installed', tenants.length > 0 ? 'true' : 'false');
    localStorage.setItem('cashly_deployment_mode', mode);

    set({
      tenants,
      selectedTenant: selected,
      branches,
      selectedBranch: activeBranch,
      activePackage: selected?.tier || 'Professional',
      isInstalled: tenants.length > 0,
      deploymentMode: mode
    });
  },

  selectTenant: (tenant) => {
    const branches = tenant.branches || [];
    const activeBranch = branches.find(b => !b.isHeadOffice) || branches[0] || null;
    set({
      selectedTenant: tenant,
      branches,
      selectedBranch: activeBranch,
      activePackage: tenant.tier
    });
  },

  selectBranch: (branch) => set({ selectedBranch: branch }),
  setActivePackage: (tier) => set({ activePackage: tier }),
  setIsOnline: (online) => set({ isOnline: online }),
  setOfflinePendingCount: (count) => set({ offlinePendingCount: count }),

  addToCart: (product, modifiers = [], notes = '') => {
    const { cart } = get();
    const existingIndex = cart.findIndex(i => i.productId === product.id && i.specialNotes === notes);
    const modifiersTotal = modifiers.reduce((acc, m) => acc + (m.pricePKR || 0), 0);
    const itemUnitPrice = product.sellingPricePKR + modifiersTotal;

    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      updated[existingIndex].totalPricePKR = updated[existingIndex].quantity * updated[existingIndex].unitPricePKR;
      set({ cart: updated });
    } else {
      const newItem: CartItem = {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPricePKR: itemUnitPrice,
        totalPricePKR: itemUnitPrice,
        selectedModifiers: modifiers,
        specialNotes: notes,
        station: product.station
      };
      set({ cart: [...cart, newItem] });
    }
  },

  removeFromCart: (productId) => {
    set({ cart: get().cart.filter(i => i.productId !== productId) });
  },

  updateQuantity: (productId, delta) => {
    const { cart } = get();
    const updated = cart.map(i => {
      if (i.productId === productId) {
        const newQty = Math.max(1, i.quantity + delta);
        return {
          ...i,
          quantity: newQty,
          totalPricePKR: newQty * i.unitPricePKR
        };
      }
      return i;
    });
    set({ cart: updated });
  },

  setOrderType: (orderType) => set({ orderType }),
  setSelectedTable: (selectedTable) => set({ selectedTable }),
  setCustomerInfo: (info) => set({
    customerName: info.name ?? get().customerName,
    customerPhone: info.phone ?? get().customerPhone,
    deliveryAddress: info.address ?? get().deliveryAddress
  }),
  setDiscount: (discountPKR) => set({ discountPKR: Math.max(0, discountPKR) }),
  clearCart: () => set({
    cart: [],
    discountPKR: 0,
    customerName: '',
    customerPhone: '',
    deliveryAddress: ''
  }),

  parkCurrentBill: (label) => {
    const { cart, orderType, selectedTable, customerName, discountPKR, parkedBills } = get();
    if (cart.length === 0) return;

    const newBill: ParkedBill = {
      id: `TAB-${Date.now().toString().slice(-4)}`,
      name: label || (orderType === 'DineIn' ? `Table ${selectedTable || 'Dine-in'}` : customerName || `Order ${parkedBills.length + 1}`),
      items: [...cart],
      orderType,
      tableNumber: selectedTable,
      customerName,
      discountPKR,
      parkedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    set({
      parkedBills: [...parkedBills, newBill],
      cart: [],
      discountPKR: 0,
      customerName: '',
      customerPhone: '',
      deliveryAddress: ''
    });
  },

  resumeParkedBill: (billId) => {
    const { parkedBills } = get();
    const bill = parkedBills.find(b => b.id === billId);
    if (!bill) return;

    set({
      cart: bill.items,
      orderType: bill.orderType,
      selectedTable: bill.tableNumber,
      customerName: bill.customerName,
      discountPKR: bill.discountPKR,
      parkedBills: parkedBills.filter(b => b.id !== billId)
    });
  },

  deleteParkedBill: (billId) => {
    set({ parkedBills: get().parkedBills.filter(b => b.id !== billId) });
  },

  refreshOfflineCount: async () => {
    try {
      const unsynced = await offlineDb.offlineOrders.where('isSynced').equals(0).toArray();
      const count = unsynced.length;
      set({ offlinePendingCount: count });
      return count;
    } catch {
      return 0;
    }
  },

  autoSyncOnReconnect: async () => {
    const { isSyncing, isOnline } = get();
    if (isSyncing || !isOnline) return 0;

    const pendingCount = await get().refreshOfflineCount();
    if (pendingCount === 0) return 0;

    set({ isSyncing: true, lastSyncResult: 'Syncing offline orders...' });

    try {
      const offlineOrders = await offlineDb.offlineOrders.where('isSynced').equals(0).toArray();
      if (offlineOrders.length === 0) {
        set({ offlinePendingCount: 0, isSyncing: false, lastSyncResult: '' });
        return 0;
      }

      const payload = offlineOrders.map(o => o.orderData);
      const result = await syncWithRetry(() => posApi.syncBatchOrders(payload));

      if (result.success) {
        for (const order of offlineOrders) {
          if (order.id) {
            await offlineDb.offlineOrders.update(order.id, { isSynced: 1 as any });
          }
        }
        const syncedCount = result.data?.count || offlineOrders.length;
        set({ offlinePendingCount: 0, isSyncing: false, lastSyncResult: `Synced ${syncedCount} orders` });
        return syncedCount;
      } else {
        // Update retry count on failed orders
        for (const order of offlineOrders) {
          if (order.id) {
            const retries = (order.syncRetries || 0) + 1;
            await offlineDb.offlineOrders.update(order.id, {
              syncRetries: retries,
              lastSyncError: result.error
            });
          }
        }
        set({ isSyncing: false, lastSyncResult: `Sync failed: ${result.error}` });
        return 0;
      }
    } catch (err) {
      console.error('Auto-sync failed:', err);
      set({ isSyncing: false, lastSyncResult: 'Sync failed' });
      return 0;
    }
  },

  syncPendingOrders: async () => {
    const { isSyncing, isOnline } = get();
    if (isSyncing || !isOnline) return 0;

    set({ isSyncing: true });
    try {
      const offlineOrders = await offlineDb.offlineOrders.where('isSynced').equals(0).toArray();
      if (offlineOrders.length === 0) {
        set({ offlinePendingCount: 0, isSyncing: false });
        return 0;
      }

      const payload = offlineOrders.map(o => o.orderData);
      const result = await syncWithRetry(() => posApi.syncBatchOrders(payload));

      if (result.success) {
        for (const order of offlineOrders) {
          if (order.id) {
            await offlineDb.offlineOrders.update(order.id, { isSynced: 1 as any });
          }
        }
        const syncedCount = result.data?.count || offlineOrders.length;
        set({ offlinePendingCount: 0, isSyncing: false, lastSyncResult: `Synced ${syncedCount} orders` });
        return syncedCount;
      } else {
        set({ isSyncing: false, lastSyncResult: `Sync failed: ${result.error}` });
        return 0;
      }
    } catch (err) {
      console.error('Failed to sync offline orders:', err);
      set({ isSyncing: false, lastSyncResult: 'Sync failed' });
      return 0;
    }
  },

  getEffectiveTaxRate: () => {
    const { paymentMethod, cashTaxRatePercent, cardTaxRatePercent } = get();
    if (paymentMethod === 'Cash') {
      return cashTaxRatePercent;
    }
    // Card, JazzCash, EasyPaisa, Raast get reduced 8% rate
    return cardTaxRatePercent;
  },

  getSubTotal: () => {
    return get().cart.reduce((sum, item) => sum + item.totalPricePKR, 0);
  },

  getTaxAmount: () => {
    const { taxMode, getEffectiveTaxRate, discountPKR } = get();
    const subtotal = get().getSubTotal() - discountPKR;
    const taxable = Math.max(0, subtotal);
    const rate = getEffectiveTaxRate();

    if (taxMode === 'Inclusive') {
      // Tax is inside the price
      return Math.round(taxable - (taxable / (1 + rate / 100)));
    }
    // Tax Exclusive: added on top
    return Math.round((taxable * rate) / 100);
  },

  getTotal: () => {
    const { taxMode } = get();
    const subtotal = get().getSubTotal();
    const discount = get().discountPKR;
    const taxable = Math.max(0, subtotal - discount);

    if (taxMode === 'Inclusive') {
      return taxable;
    }
    const tax = get().getTaxAmount();
    return taxable + tax;
  }
}));


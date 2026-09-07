import { create } from 'zustand';
import type { Tenant, Branch, Product, CartItem, OrderType, PaymentMethod, SubscriptionTier } from '../types';


import { offlineDb } from '../services/offlineDb';
import { posApi } from '../services/api';

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
  // Tenancy
  tenants: Tenant[];
  selectedTenant: Tenant | null;
  branches: Branch[];
  selectedBranch: Branch | null;
  activeCounterName: string;
  activePackage: SubscriptionTier;

  // Network & Sync
  isOnline: boolean;
  offlinePendingCount: number;

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

  setPaymentMethod: (method: PaymentMethod) => void;
  setTaxSettings: (settings: { cashRate?: number; cardRate?: number; mode?: 'Exclusive' | 'Inclusive' }) => void;
  setIsMenuEditLocked: (locked: boolean) => void;

  // Parked Bills / Open Tabs
  parkedBills: ParkedBill[];

  // Actions
  setTenants: (tenants: Tenant[]) => void;
  selectTenant: (tenant: Tenant) => void;
  selectBranch: (branch: Branch) => void;
  setActivePackage: (tier: SubscriptionTier) => void;
  setIsOnline: (online: boolean) => void;
  setOfflinePendingCount: (count: number) => void;
  
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

  isOnline: navigator.onLine,
  offlinePendingCount: 0,

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
    set({
      tenants,
      selectedTenant: selected,
      branches,
      selectedBranch: activeBranch,
      activePackage: selected?.tier || 'Professional'
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

  syncPendingOrders: async () => {
    try {
      const offlineOrders = await offlineDb.offlineOrders.where('isSynced').equals(0 as any).toArray();
      if (offlineOrders.length === 0) return 0;

      const payload = offlineOrders.map(o => o.orderData);
      const res = await posApi.syncOfflineBatch(payload);

      // Mark local orders as synced
      for (const order of offlineOrders) {
        if (order.id) {
          await offlineDb.offlineOrders.update(order.id, { isSynced: true });
        }
      }

      set({ offlinePendingCount: 0 });
      return res.syncedCount || offlineOrders.length;
    } catch (err) {
      console.error('Failed to sync offline orders:', err);
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


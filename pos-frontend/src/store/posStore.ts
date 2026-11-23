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
  DepartmentRole,
  TenantSettings,
  CurrentUser,
  AuthPermissions,
  ModulePermission,
  ModuleKey,
  PermissionAction,
  UserRole,
  EffectivePackageFeatures,
  MyPackageInfo,
  SaleUnit,
  ProductModifier,
  BranchTax
} from '../types';
import type { SaleUnitOption } from '../utils/medicine';
import { cartTax } from '../utils/tax';

import { offlineDb, saveSetting, getSetting, type OfflineOrder } from '../services/offlineDb';
import { getApiErrorMessage, getApiServer, isApiUnavailable, posApi } from '../services/api';
import { getStoredTerminal, isActivated } from '../services/deviceLicense';
import { OFFLINE_SESSION_TOKEN } from '../services/offlineStaff';
// The signed-in session: one tab's in the back office, the device's on a connected till.
import { authStorage } from '../services/authStorage';

export const AUTH_USER_STORAGE_KEY = 'cashly_pos_user';
export const AUTH_TOKEN_STORAGE_KEY = 'cashly_pos_token';
const AUTH_PERMISSIONS_STORAGE_KEY = 'cashly_pos_permissions';
const AUTH_MODULE_PERMISSIONS_STORAGE_KEY = 'cashly_pos_module_permissions';
if (authStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === OFFLINE_SESSION_TOKEN) {
  authStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  authStorage.removeItem(AUTH_USER_STORAGE_KEY);
  authStorage.removeItem(AUTH_PERMISSIONS_STORAGE_KEY);
}

/** Backend AppRole enum ordinal -> role name. Mirrors UserManagement's roleNumberMap. */
const ROLE_BY_ORDINAL: Record<number, UserRole> = {
  0: 'SuperAdmin',
  1: 'OwnerAdmin',
  2: 'BranchManager',
  3: 'Cashier',
  4: 'KitchenChef',
  5: 'Waiter',
  6: 'Accountant',
  7: 'InventoryUser',
  8: 'HqAdmin'
};

/**
 * The API may serialize `role` either as the enum name or as its numeric ordinal
 * depending on the endpoint — normalize both into a UserRole string.
 */
export function normalizeRole(role: unknown): UserRole | null {
  if (typeof role === 'number') return ROLE_BY_ORDINAL[role] ?? null;
  if (typeof role === 'string') {
    if (role.trim() === '') return null;
    const asNumber = Number(role);
    if (!Number.isNaN(asNumber) && ROLE_BY_ORDINAL[asNumber]) return ROLE_BY_ORDINAL[asNumber];
    return role as UserRole;
  }
  return null;
}

/** Roles that bypass every module check (mirrors the backend's ModuleBaseline). An HQ admin runs
 *  the business like the owner; only billing and ownership stay the owner's. */
const FULL_ACCESS_ROLES: UserRole[] = ['OwnerAdmin', 'HqAdmin', 'SuperAdmin'];

/** The owner, or an HQ admin: the people who run the whole business. */
export const runsBusiness = (role: unknown) => {
  const r = normalizeRole(role);
  return r === 'OwnerAdmin' || r === 'HqAdmin';
};

/** Modules a BranchManager can VIEW (but not edit) with no explicit permission row. */
const BRANCH_MANAGER_VIEW_MODULES: ModuleKey[] = [
  'menu',
  'inventory',
  'reports',
  'accounts',
  'supplychain'
];

/**
 * Modules a BranchManager can fully manage with no explicit permission row.
 * Staff scheduling and the time clock are a branch manager's day job, so `labor`
 * is edit-level baseline here — unlike the view-only back-office modules above.
 */
const BRANCH_MANAGER_EDIT_MODULES: ModuleKey[] = ['labor'];

const ACTION_FIELD: Record<PermissionAction, keyof ModulePermission> = {
  view: 'canView',
  edit: 'canEdit',
  delete: 'canDelete',
  export: 'canExport'
};

/**
 * Client-side mirror of the backend's ModuleBaseline.GetBaseline.
 *
 * NOTE: this exists purely so the UI can react instantly (hide links, show
 * "Access Denied"). The server independently enforces the same rules on every
 * request — never treat a `true` here as authorization.
 */
export function hasModuleAccess(
  role: UserRole | string | number | null | undefined,
  modulePermissions: ModulePermission[] | null | undefined,
  moduleKey: ModuleKey | string,
  action: PermissionAction = 'view'
): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  if (FULL_ACCESS_ROLES.includes(normalized)) return true;

  // An explicit module-level row (subModuleKey === '') always wins over the baseline.
  const explicit = (modulePermissions || []).find(
    p => p.moduleKey === moduleKey && (p.subModuleKey ?? '') === ''
  );
  if (explicit) return !!explicit[ACTION_FIELD[action]];

  if (normalized === 'BranchManager') {
    if (BRANCH_MANAGER_EDIT_MODULES.includes(moduleKey as ModuleKey)) {
      return true;
    }
    if (BRANCH_MANAGER_VIEW_MODULES.includes(moduleKey as ModuleKey)) {
      return action === 'view';
    }
  }

  return false;
}

function readStoredJson<T>(key: string, fallback: T, storage: Pick<Storage, 'getItem'> = localStorage): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readStoredUser(): CurrentUser | null {
  const raw = readStoredJson<any>(AUTH_USER_STORAGE_KEY, null, authStorage);
  if (!raw || !raw.id) return null;
  return { ...raw, role: normalizeRole(raw.role) ?? 'Cashier' } as CurrentUser;
}

/** The branch picked on the login screen, remembered on this device. */
export const LOGIN_BRANCH_KEY = 'cashly_login_branch';

/**
 * The branch a session opens at: the one the user is signed in at, else the one picked on the
 * login screen, else the branch this till is paired to, else the first location that sells. The
 * head office and warehouses come last — they have no till, so opening the POS there helps no one.
 */
function pickActiveBranch(branches: Branch[], sessionBranchId?: string | null): Branch | null {
  const byId = (id?: string | null) => (id ? branches.find(b => b.id === id) : undefined);
  // The branch chosen on the login screen. The server pins branch staff to it; an owner's session
  // covers every branch, so for them this is simply where the app opens.
  const loginBranchId = (() => {
    try {
      return localStorage.getItem(LOGIN_BRANCH_KEY);
    } catch {
      return null;
    }
  })();
  const tillBranchId = (() => {
    try {
      return isActivated() ? getStoredTerminal()?.branchId ?? null : null;
    } catch {
      return null;
    }
  })();
  return byId(sessionBranchId)
    || byId(loginBranchId)
    || byId(tillBranchId)
    || branches.find(b => b.canSell !== false && !b.isHeadOffice)
    || branches[0]
    || null;
}

// Retry with exponential backoff
// Offline sales go up a few at a time, not all at once: a pharmacy's sale carries its prescription
// photo, and a day of them in one request would be refused for its size. The server keeps each sale
// once (by its clientLocalId), so a batch that fails part-way is safe to send again.
const SYNC_BATCH_SALES = 20;
const SYNC_BATCH_CHARS = 4_000_000;

function inSyncBatches(sales: OfflineOrder[]): OfflineOrder[][] {
  const batches: OfflineOrder[][] = [];
  let current: OfflineOrder[] = [];
  let size = 0;
  for (const sale of sales) {
    const chars = JSON.stringify(sale.orderData).length;
    if (current.length > 0 && (current.length >= SYNC_BATCH_SALES || size + chars > SYNC_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(sale);
    size += chars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function sendOfflineSales(sales: OfflineOrder[], canContinue: () => boolean) {
  let synced = 0;
  let error: string | undefined;
  for (const batch of inSyncBatches(sales)) {
    if (!canContinue()) break;
    let acknowledgements;
    try {
      const result = await posApi.syncBatchOrders(batch.map(o => o.orderData));
      acknowledgements = Array.isArray(result?.orders) ? result.orders : [];
    } catch (err) {
      return { synced, error: getApiErrorMessage(err, 'Could not reach Cashly to send sales.'), disconnected: isApiUnavailable(err) };
    }
    const legacyResponse = acknowledgements.length === batch.length &&
      acknowledgements.every(row => row && typeof row === 'object' && !('clientLocalId' in row));
    const byId = new Map(acknowledgements.filter(row => row?.clientLocalId).map(row => [row.clientLocalId, row]));
    await offlineDb.transaction('rw', offlineDb.offlineOrders, async () => {
      for (const [index, sale] of batch.entries()) {
        if (sale.id === undefined) continue;
        const ack = legacyResponse ? acknowledgements[index] : byId.get(sale.orderData.clientLocalId);
        if (typeof ack?.orderId === 'string' && ack.orderId && (ack.status === 'Synced' || ack.status === 'AlreadySynced')) {
          await offlineDb.offlineOrders.update(sale.id, { isSynced: 1, lastSyncError: undefined });
          synced++;
        } else {
          const message = ack?.reason || 'The server did not confirm this sale.';
          error ??= message;
          await offlineDb.offlineOrders.update(sale.id, { syncRetries: (sale.syncRetries ?? 0) + 1, lastSyncError: message });
        }
      }
    });
  }
  return { synced, error, disconnected: false };
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
  canInitialize: boolean;

  // Terminal Profile & Role-Based Control
  terminalMode: TerminalOperatingMode;
  activeDepartment: DepartmentRole;

  // Authenticated session (mandatory — the route tree is gated on this)
  currentUser: CurrentUser | null;
  token: string | null;
  permissions: AuthPermissions | null;
  modulePermissions: ModulePermission[];
  login: (user: CurrentUser, token: string, permissions: AuthPermissions | null) => void;
  logout: () => void;
  setModulePermissions: (list: ModulePermission[]) => void;
  loadMyModulePermissions: () => Promise<void>;
  can: (moduleKey: ModuleKey | string, action?: PermissionAction) => boolean;

  // Tier + add-on merged feature flags — one true answer for "is X actually unlocked."
  packageFeatures: EffectivePackageFeatures | null;
  /**
   * The full entitlement answer: flags, resolved quotas, where the tenant sits on the billing
   * ladder, and which vertical pack(s) it runs. Screens that need to know WHAT KIND of business
   * this is — which decides the POS layout, the item fields and the wording — read this.
   */
  packageInfo: MyPackageInfo | null;
  loadMyPackageFeatures: () => Promise<void>;

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

  // Tax: the fallback rates below apply only until the branch's own arrive (branchTax).
  cashTaxRatePercent: number;
  cardTaxRatePercent: number;
  /** Whether prices include tax — from the business's Tax Setup, via branchTax. */
  taxMode: 'Exclusive' | 'Inclusive';
  /** What the server taxes a sale at, at this branch (GET /tax/branch-rates); kept on the device for offline. */
  branchTax: BranchTax | null;
  loadBranchTax: (branchId: string) => Promise<void>;
  paymentMethod: PaymentMethod;
  isMenuEditLocked: boolean; // Super Admin managed menu lock
  theme: 'light' | 'dark';
  tenantSettings: TenantSettings | null;
  loadTenantSettings: () => Promise<void>;

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setIsMenuEditLocked: (locked: boolean) => void;
  setDeploymentMode: (mode: 'Single' | 'MultiBranch') => void;
  setIsInstalled: (installed: boolean) => void;
  checkInstallationStatus: () => Promise<boolean>;

  // Terminal & Role Actions
  setTerminalMode: (mode: TerminalOperatingMode) => void;
  setActiveDepartment: (dept: DepartmentRole) => void;

  // Parked Bills / Open Tabs
  parkedBills: ParkedBill[];

  // Actions
  setTenants: (tenants: Tenant[]) => void;
  selectTenant: (tenant: Tenant) => void;
  selectBranch: (branch: Branch) => void;
  setActivePackage: (tier: SubscriptionTier) => void;
  setIsOnline: (online: boolean) => void;
  refreshOfflineCount: () => Promise<number>;
  
  // Cart Actions
  /** `unit`: a medicine sold loose — the box, a strip or a tablet, at its own price (utils/medicine.ts). */
  addToCart: (product: Product, modifiers?: ProductModifier[], notes?: string, unit?: SaleUnitOption) => void;
  /** Lines of the product sold in `saleUnit` (none for a product that is not sold loose). */
  removeFromCart: (productId: string, saleUnit?: SaleUnit) => void;
  updateQuantity: (productId: string, delta: number, saleUnit?: SaleUnit) => void;
  /** Sells a line of a medicine by another unit (box to strip...), merging with a line already in it. */
  setLineSaleUnit: (productId: string, from: SaleUnit | undefined, notes: string | undefined, to: SaleUnitOption) => void;
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
  canInitialize: false,

  terminalMode: (localStorage.getItem('cashly_terminal_mode') as TerminalOperatingMode) || 'CounterPOS',
  activeDepartment: (localStorage.getItem('cashly_active_department') as DepartmentRole) || 'Owner',

  currentUser: readStoredUser(),
  token: authStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
  permissions: readStoredJson<AuthPermissions | null>(AUTH_PERMISSIONS_STORAGE_KEY, null, authStorage),
  modulePermissions: readStoredJson<ModulePermission[]>(AUTH_MODULE_PERMISSIONS_STORAGE_KEY, [], authStorage),
  packageFeatures: null,
  packageInfo: null,

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

  // Tax Rates: 16% Cash, 8% Card/Digital — until the branch's own are loaded.
  cashTaxRatePercent: 16,
  cardTaxRatePercent: 8,
  taxMode: 'Exclusive',
  branchTax: null,
  paymentMethod: 'Cash',
  isMenuEditLocked: true,
  theme: (localStorage.getItem('cashly_pos_theme') as 'light' | 'dark') || 'light',
  tenantSettings: null,

  setTheme: (theme) => {
    localStorage.setItem('cashly_pos_theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cashly_pos_theme', next);
    set({ theme: next });
  },

  login: (user, token, permissions) => {
    const normalized: CurrentUser = { ...user, role: normalizeRole(user.role) ?? 'Cashier' };
    // The axios request interceptor reads the token straight out of the session store,
    // so these two keys must stay in sync with the store.
    if (token === OFFLINE_SESSION_TOKEN) {
      authStorage.removeItem(AUTH_USER_STORAGE_KEY);
      authStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      authStorage.removeItem(AUTH_PERMISSIONS_STORAGE_KEY);
      authStorage.removeItem('cashly_pos_refresh_token');
    } else {
      authStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(normalized));
      authStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      if (permissions) authStorage.setItem(AUTH_PERMISSIONS_STORAGE_KEY, JSON.stringify(permissions));
      else authStorage.removeItem(AUTH_PERMISSIONS_STORAGE_KEY);
    }
    authStorage.removeItem(AUTH_MODULE_PERMISSIONS_STORAGE_KEY);
    set({ currentUser: normalized, token, permissions: permissions ?? null, modulePermissions: [], packageFeatures: null, packageInfo: null });
  },

  logout: () => {
    posApi.logout(); // clears the refresh-token key and best-effort revokes it server-side
    authStorage.removeItem(AUTH_USER_STORAGE_KEY);
    authStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    authStorage.removeItem(AUTH_PERMISSIONS_STORAGE_KEY);
    authStorage.removeItem(AUTH_MODULE_PERMISSIONS_STORAGE_KEY);
    set({
      currentUser: null,
      token: null,
      permissions: null,
      modulePermissions: [],
      packageFeatures: null,
      packageInfo: null
    });
  },

  setModulePermissions: (list) => {
    const safe = Array.isArray(list) ? list : [];
    // authStorage swallows a full or blocked store; the in-memory copy is still fine.
    authStorage.setItem(AUTH_MODULE_PERMISSIONS_STORAGE_KEY, JSON.stringify(safe));
    set({ modulePermissions: safe });
  },

  loadMyModulePermissions: async () => {
    const { currentUser, token, isOnline } = get();
    if (!currentUser || !token || token === OFFLINE_SESSION_TOKEN || !isOnline) return;
    try {
      const data = await posApi.getMyPermissions();
      if (get().currentUser === currentUser) get().setModulePermissions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load module permissions:', err);
    }
  },

  loadMyPackageFeatures: async () => {
    const { currentUser, token, isOnline } = get();
    if (!currentUser || !token) return;
    const cacheKey = `package:${getApiServer()}:${currentUser.tenantId}:${currentUser.id}`;
    const apply = (info: MyPackageInfo) => {
      if (get().currentUser === currentUser) set({ packageFeatures: info.features, packageInfo: info });
    };
    const cached = await getSetting(cacheKey).catch(() => null) as MyPackageInfo | null;
    if (cached) apply(cached);
    if (token === OFFLINE_SESSION_TOKEN || !isOnline) return;
    try {
      const data = await posApi.getMyPackage();
      // Both are kept: `packageFeatures` is what the existing feature guards read, and
      // `packageInfo` carries the billing state and sector contract the guards do not need.
      if (data) {
        apply(data);
        void saveSetting(cacheKey, data).catch(() => {});
      }
    } catch (err) {
      if (!isApiUnavailable(err) && get().currentUser === currentUser) set({ packageFeatures: null, packageInfo: null });
    }
  },

  can: (moduleKey, action = 'view') => {
    const { currentUser, modulePermissions } = get();
    return hasModuleAccess(currentUser?.role, modulePermissions, moduleKey, action);
  },

  setTerminalMode: (mode) => {
    localStorage.setItem('cashly_terminal_mode', mode);
    set({ terminalMode: mode });
  },

  setActiveDepartment: (dept) => {
    localStorage.setItem('cashly_active_department', dept);
    set({ activeDepartment: dept });
  },

  setDeploymentMode: (mode) => {
    localStorage.setItem('cashly_deployment_mode', mode);
    set({ deploymentMode: mode });
  },

  setIsInstalled: (isInstalled) => {
    localStorage.setItem('cashly_is_installed', isInstalled ? 'true' : 'false');
    set(isInstalled ? { isInstalled, canInitialize: false } : { isInstalled });
  },

  checkInstallationStatus: async () => {
    try {
      const status = await posApi.getSetupStatus();
      const isInstalled = status.isConfigured;
      localStorage.setItem('cashly_is_installed', isInstalled ? 'true' : 'false');
      // The business's shape (single shop or head office) comes from the signed-in user's own
      // tenant after login (setTenants), not from this public check.
      set({ isInstalled, canInitialize: status.canInitialize === true });
      return isInstalled;
    } catch (err) {
      console.warn('Backend setup status check failed, using local flag:', err);
      return get().isInstalled;
    }
  },

  parkedBills: [],

  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setIsMenuEditLocked: (isMenuEditLocked) => set({ isMenuEditLocked }),

  loadBranchTax: async (branchId) => {
    const cacheKey = `branchTax:${branchId}`;
    const apply = (tax: BranchTax) => {
      if (get().selectedBranch?.id === branchId) set({ branchTax: tax, taxMode: tax.pricesIncludeTax ? 'Inclusive' : 'Exclusive' });
    };
    const cached = await getSetting(cacheKey).catch(() => null) as BranchTax | null;
    if (cached) apply(cached);
    if (!get().isOnline || get().token === OFFLINE_SESSION_TOKEN) return;
    try {
      const tax = await posApi.getBranchTax(branchId);
      apply(tax);
      // Kept on the device, so a till opened offline still charges the right tax.
      await saveSetting(cacheKey, tax);
    } catch { /* keep the last known rates */ }
  },

  loadTenantSettings: async () => {
    const { selectedTenant } = get();
    if (!selectedTenant?.id) return;
    const cacheKey = `tenantSettings:${selectedTenant.id}`;
    const apply = (settings: TenantSettings) => {
      if (get().selectedTenant?.id === selectedTenant.id) set({ tenantSettings: settings });
    };
    const cached = await getSetting(cacheKey).catch(() => null);
    if (cached) apply(cached);
    if (!get().isOnline || get().token === OFFLINE_SESSION_TOKEN) return;
    try {
      const settings = await posApi.getTenantSettings(selectedTenant.id);
      apply(settings);
      // Kept on the device, so a till opened offline still charges the right tax.
      saveSetting(cacheKey, settings).catch(() => { /* optional */ });
    } catch (err) {
      console.error('Failed to load tenant settings:', err);
    }
  },


  setTenants: (tenants) => {
    const selected = tenants.length > 0 ? tenants[0] : null;
    const branches = selected?.branches || [];
    const activeBranch = pickActiveBranch(branches, get().currentUser?.branchId);
    const hasMultipleOrHQ = branches.some(b => b.isHeadOffice) || branches.length > 1;
    const mode = hasMultipleOrHQ ? 'MultiBranch' : 'Single';
    
    localStorage.setItem('cashly_is_installed', tenants.length > 0 ? 'true' : 'false');
    localStorage.setItem('cashly_deployment_mode', mode);

    set({
      tenants,
      selectedTenant: selected,
      branches,
      selectedBranch: activeBranch,
      branchTax: activeBranch?.id === get().selectedBranch?.id ? get().branchTax : null,
      tenantSettings: selected?.id === get().selectedTenant?.id ? get().tenantSettings : null,
      activePackage: selected?.tier || 'Professional',
      isInstalled: tenants.length > 0,
      deploymentMode: mode
    });
  },

  selectTenant: (tenant) => {
    const branches = tenant.branches || [];
    const activeBranch = pickActiveBranch(branches, get().currentUser?.branchId);
    set({
      selectedTenant: tenant,
      branches,
      selectedBranch: activeBranch,
      branchTax: activeBranch?.id === get().selectedBranch?.id ? get().branchTax : null,
      tenantSettings: tenant.id === get().selectedTenant?.id ? get().tenantSettings : null,
      activePackage: tenant.tier
    });
  },

  selectBranch: (branch) => set({ selectedBranch: branch, branchTax: branch.id === get().selectedBranch?.id ? get().branchTax : null }),
  setActivePackage: (tier) => set({ activePackage: tier }),
  setIsOnline: (online) => set({ isOnline: online }),

  addToCart: (product, modifiers = [], notes = '', unit) => {
    const { cart } = get();
    const existingIndex = cart.findIndex(i => i.productId === product.id && i.specialNotes === notes && i.saleUnit === unit?.unit);
    const modifiersTotal = modifiers.reduce((acc, m) => acc + (m.pricePKR || 0), 0);
    const itemUnitPrice = (unit ? unit.price : product.sellingPricePKR) + modifiersTotal;

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
        station: product.station,
        ...(unit && { saleUnit: unit.unit, unitsPerSaleUnit: unit.units, saleUnitLabel: unit.label }),
        // How it is taxed goes with it, so the cart's tax matches the server's item by item.
        taxTreatment: product.taxTreatment ?? 'Standard',
        taxRatePercent: product.taxRatePercent ?? null
      };
      set({ cart: [...cart, newItem] });
    }
  },

  removeFromCart: (productId, saleUnit) => {
    set({ cart: get().cart.filter(i => !(i.productId === productId && i.saleUnit === saleUnit)) });
  },

  setLineSaleUnit: (productId, from, notes, to) => {
    const { cart } = get();
    const line = cart.find(i => i.productId === productId && i.saleUnit === from && i.specialNotes === notes);
    if (!line || from === to.unit) return;
    const price = to.price + (line.selectedModifiers ?? []).reduce((acc, m) => acc + (m.pricePKR || 0), 0);
    const switched: CartItem = {
      ...line, saleUnit: to.unit, unitsPerSaleUnit: to.units, saleUnitLabel: to.label,
      unitPricePKR: price, totalPricePKR: line.quantity * price
    };
    const into = cart.find(i => i !== line && i.productId === productId && i.saleUnit === to.unit && i.specialNotes === notes);
    set({
      cart: into
        ? cart.filter(i => i !== line).map(i => i === into
            ? { ...i, quantity: i.quantity + line.quantity, totalPricePKR: (i.quantity + line.quantity) * i.unitPricePKR }
            : i)
        : cart.map(i => (i === line ? switched : i))
    });
  },

  updateQuantity: (productId, delta, saleUnit) => {
    const { cart } = get();
    const updated = cart.map(i => {
      if (i.productId === productId && i.saleUnit === saleUnit) {
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
      const count = await offlineDb.offlineOrders.where('isSynced').equals(0).count();
      set({ offlinePendingCount: count });
      return count;
    } catch {
      return 0;
    }
  },

  syncPendingOrders: async () => {
    const { isSyncing, isOnline, currentUser, token } = get();
    if (isSyncing || !isOnline || !currentUser || !token || token === OFFLINE_SESSION_TOKEN) return 0;

    const server = getApiServer();
    const canContinue = () => get().isOnline && get().currentUser === currentUser && getApiServer() === server;
    set({ isSyncing: true, lastSyncResult: '' });
    try {
      const pending = await offlineDb.offlineOrders.where('isSynced').equals(0).sortBy('createdAt');
      const branchIds = new Set([currentUser.branchId, ...get().branches.filter(b => b.tenantId === currentUser.tenantId).map(b => b.id)]);
      const sales = pending.filter(sale =>
        (!sale.apiServer || sale.apiServer === server) &&
        (sale.tenantId ? sale.tenantId === currentUser.tenantId : branchIds.has(sale.orderData.branchId))
      );
      if (!sales.length) return 0;

      set({ lastSyncResult: 'Syncing offline orders…' });
      const result = await sendOfflineSales(sales, canContinue);
      if (result.disconnected && canContinue()) set({ isOnline: false });
      set({ lastSyncResult: result.error ? `Sales still pending: ${result.error}` : `Synced ${result.synced} orders` });
      return result.synced;
    } catch (err) {
      console.error('Failed to sync offline orders:', err);
      set({ lastSyncResult: 'Could not update the offline sales queue.' });
      return 0;
    } finally {
      await get().refreshOfflineCount();
      set({ isSyncing: false });
    }
  },
  getEffectiveTaxRate: () => {
    const { paymentMethod, tenantSettings, cashTaxRatePercent, cardTaxRatePercent, branchTax } = get();
    // The branch's own rates, as the server resolves them (one rate, cash/card, or its province's).
    if (branchTax) return paymentMethod === 'Cash' ? branchTax.cashRate : branchTax.cardRate;
    if (tenantSettings) {
      if (tenantSettings.useDualTaxRate) {
        return paymentMethod === 'Cash' ? tenantSettings.defaultTaxRate : tenantSettings.digitalTaxRate;
      }
      return tenantSettings.defaultTaxRate;
    }
    // Fallback to store values
    if (paymentMethod === 'Cash') return cashTaxRatePercent;
    return cardTaxRatePercent;
  },

  getSubTotal: () => {
    return get().cart.reduce((sum, item) => sum + item.totalPricePKR, 0);
  },

  getTaxAmount: () => {
    const { taxMode, getEffectiveTaxRate, discountPKR, cart, branchTax } = get();
    // Item by item, as the server does: exempt and own-rate items are taxed their own way.
    return cartTax(cart, discountPKR, getEffectiveTaxRate(), taxMode === 'Inclusive', branchTax?.decimals ?? 0).tax;
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


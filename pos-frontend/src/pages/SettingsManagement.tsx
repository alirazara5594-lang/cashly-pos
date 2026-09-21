import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Store, 
  ShieldCheck, 
  Database, 
  Wifi, 
  RefreshCw, 
  Copy, 
  Check, 
  X,

  Lock,
  Unlock, 
  Laptop, 
  Monitor, 
  Tablet, 
  ChefHat, 
  Users, 
  DollarSign,
  Sliders,
  Truck
} from 'lucide-react';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import { posApi } from '../services/api';
import { offlineDb } from '../services/offlineDb';
import type { PendingPairingCode, PairingCodeResponse, DeviceCapacity, DepartmentRole, ModuleKey } from '../types';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Department profiles a user can switch their session view to. Each maps to the
 * module that actually backs it, so a user only sees the profiles they hold
 * `view` access for — this is no longer a free self-select.
 */
const DEPARTMENT_PROFILES: {
  id: DepartmentRole;
  module: ModuleKey;
  title: string;
  subtitle: string;
  accent: 'blue' | 'purple' | 'teal';
  capabilities: string[];
  restriction?: string;
}[] = [
  {
    id: 'Accounts',
    module: 'accounts',
    title: 'Accounts & Finance Dept',
    subtitle: 'Audits, P&L, Tax & Cashflow',
    accent: 'blue',
    capabilities: [
      'Consolidated P&L Analytics',
      'End-of-Day Z-Reports',
      'Tax Audit & Compliance',
      'Payment Tender Mix'
    ],
    restriction: 'POS & Kitchen Hidden'
  },
  {
    id: 'Procurement',
    module: 'supplychain',
    title: 'Purchase & Supply Chain',
    subtitle: 'Central Warehouse & Transfers',
    accent: 'purple',
    capabilities: [
      'Central Commissary Stock',
      'Inter-Branch Transfers Dispatch',
      'Vendor Purchase Orders (PO)',
      'Raw Material Inward'
    ],
    restriction: 'Sales P&L Hidden'
  },
  {
    id: 'Owner',
    module: 'admin',
    title: 'Director & Owner Admin',
    subtitle: 'Full Master Privilege',
    accent: 'teal',
    capabilities: [
      'Executive Director Dashboard',
      'All Reports & Financials',
      'Menu, Recipes, Prices & Tax',
      'Branch Switching & Quotas'
    ]
  }
];

export const SettingsManagement: React.FC = () => {
  const navigate = useNavigate();
  const {
    selectedBranch,
    terminalMode,
    activeDepartment,
    isOnline,
    offlinePendingCount,
    setTerminalMode,
    setActiveDepartment,
    refreshOfflineCount,
    syncPendingOrders,
    currentUser,
    modulePermissions
  } = usePosStore();

  const can = (moduleKey: ModuleKey, action: 'view' | 'edit' = 'view') =>
    hasModuleAccess(currentUser?.role, modulePermissions, moduleKey, action);

  /** Department profiles this user is actually allowed to switch into. */
  const availableDepartments = DEPARTMENT_PROFILES.filter(d => can(d.module));

  const [activeTab, setActiveTab] = useState<'provisioning' | 'terminal' | 'departments' | 'sync' | 'devices'>('terminal');

  const location = useLocation();
  useEffect(() => {
    const tab = (location.state as { tab?: string } | null)?.tab;
    if (tab === 'provisioning' || tab === 'terminal' || tab === 'departments' || tab === 'sync' || tab === 'devices') {
      setActiveTab(tab);
    }
  }, [location.state]);

  // Device activation state
  const [pairingBranches, setPairingBranches] = useState<PendingPairingCode[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  /** The raw code, held only in memory — the server keeps nothing but its hash. */
  const [issuedCode, setIssuedCode] = useState<PairingCodeResponse | null>(null);
  const [deviceCapacity, setDeviceCapacity] = useState<DeviceCapacity[]>([]);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceType, setNewDeviceType] = useState<number>(1);

  // Sync Diagnostics state
  const [dbStats, setDbStats] = useState<{ products: number; categories: number; offlineOrders: number }>({ products: 0, categories: 0, offlineOrders: 0 });
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  // Device & Tab Config state
  const [terminals, setTerminals] = useState<any[]>([]);
  const [newTabName, setNewTabName] = useState('');
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [tabMessage, setTabMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadPairingInfo();
    loadDbStats();
    loadTerminals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snap the department profile to something this user is actually allowed to
  // see — the old switcher let anyone self-select any profile. This writes to the
  // zustand store (an external system), so it belongs in an effect.
  const allowedDepartmentId = availableDepartments[0]?.id;
  const departmentIsAllowed = availableDepartments.some(d => d.id === activeDepartment);
  useEffect(() => {
    if (allowedDepartmentId && !departmentIsAllowed) {
      setActiveDepartment(allowedDepartmentId);
    }
  }, [allowedDepartmentId, departmentIsAllowed, setActiveDepartment]);

  // Outstanding pairing codes for THIS branch. The old version called an endpoint that listed
  // every branch of every tenant on the platform, with its pairing token — that endpoint is gone.
  const loadPairingInfo = async () => {
    if (!selectedBranch?.id) return;
    try {
      const data = await posApi.listPairingCodes(selectedBranch.id);
      setPairingBranches(data as any);
    } catch (err) {
      console.warn('Failed to load pairing codes:', err);
    }
  };

  const loadDbStats = async () => {
    try {
      const pCount = await offlineDb.products.count();
      const cCount = await offlineDb.categories.count();
      const oCount = await offlineDb.offlineOrders.count();
      setDbStats({ products: pCount, categories: cCount, offlineOrders: oCount });
    } catch {
      // ignore
    }
  };

  const loadTerminals = async () => {
    try {
      const data = await posApi.getTerminals(selectedBranch?.id);
      setTerminals(data);
    } catch (err) {
      console.warn('Failed to load terminals:', err);
    }
    if (selectedBranch?.id) {
      try {
        setDeviceCapacity(await posApi.getDeviceCapacity(selectedBranch.id));
      } catch {
        // Capacity is informational — the server still enforces the real limit on mint.
      }
    }
  };

  const handleGeneratePairingCode = async () => {
    if (!selectedBranch?.id) return;
    try {
      const res = await posApi.createPairingCode({
        branchId: selectedBranch.id,
        terminalType: newDeviceType,
        terminalName: newDeviceName.trim() || undefined
      });
      setIssuedCode(res);
      setNewDeviceName('');
      setTabMessage(null);
      loadPairingInfo();
      loadTerminals();
    } catch (err: any) {
      setIssuedCode(null);
      setTabMessage({
        type: 'error',
        text: err?.response?.data?.message || err?.response?.data?.error || 'Could not generate a pairing code.'
      });
      setTimeout(() => setTabMessage(null), 6000);
    }
  };

  const handleCancelPairingCode = async (id: string) => {
    try {
      await posApi.cancelPairingCode(id);
      loadPairingInfo();
    } catch (err) {
      console.warn('Failed to cancel pairing code:', err);
    }
  };

  /**
   * A device is no longer created from the back office — that produced a Terminal row bound to
   * no hardware, which no licence check could police. Instead this mints a one-time code that
   * the tablet itself redeems, which is what binds the device and issues its licence.
   *
   * The raw code comes back exactly once, so it is put on screen immediately and never refetched.
   */
  const handleAddTerminal = async () => {
    if (!newTabName.trim() || !selectedBranch?.id) return;
    try {
      const res = await posApi.createPairingCode({
        branchId: selectedBranch.id,
        terminalType: 2, // OrderTab
        terminalName: newTabName.trim()
      });
      setNewTabName('');
      setIssuedCode(res);
      setTabMessage({
        type: 'success',
        text: `Pairing code ${res.pairingCode} — enter it on the tablet within 15 minutes. It will not be shown again.`
      });
      loadTerminals();
      loadPairingInfo();
    } catch (err: any) {
      setTabMessage({
        type: 'error',
        text: err?.response?.data?.message || err?.response?.data?.error || 'Failed to create pairing code'
      });
      setTimeout(() => setTabMessage(null), 5000);
    }
  };

  const handleRenameTerminal = async (id: string) => {
    if (!editingTabName.trim()) return;
    try {
      await posApi.updateTerminal(id, { terminalName: editingTabName.trim() });
      setEditingTabId(null);
      setEditingTabName('');
      loadTerminals();
    } catch (err) {
      console.warn('Failed to rename terminal:', err);
    }
  };

  const handleToggleTerminal = async (id: string, currentActive: boolean) => {
    try {
      await posApi.updateTerminal(id, { isActive: !currentActive });
      loadTerminals();
    } catch (err) {
      console.warn('Failed to toggle terminal:', err);
    }
  };

  /**
   * Retiring is the normal case and keeps the row (its sales history needs a device to point
   * at); the slot frees after a cooldown so add/delete/add cannot be used to run more tills
   * than the plan allows. Revoking is for a lost or stolen device: the licence dies at once.
   */
  const handleDeleteTerminal = async (id: string, revoke = false) => {
    const prompt = revoke
      ? 'Revoke this device\'s licence? It will stop working immediately. Use this for a lost or stolen device.'
      : 'Retire this device? Its slot frees up after a short cooldown.';
    if (!confirm(prompt)) return;
    try {
      const res = await posApi.retireTerminal(id, revoke ? { revoke: true, reason: 'Revoked from settings' } : undefined);
      setTabMessage({ type: 'success', text: res?.message ?? 'Device retired.' });
      setTimeout(() => setTabMessage(null), 4000);
      loadTerminals();
    } catch (err) {
      console.warn('Failed to retire terminal:', err);
    }
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };


  const handleForceSync = async () => {
    setIsSyncingNow(true);
    await syncPendingOrders();
    await refreshOfflineCount();
    await loadDbStats();
    setIsSyncingNow(false);
  };

  return (
    <div className="flex-1 p-6 md:p-8 bg-slate-50 text-slate-900 overflow-y-auto min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center text-white font-black shadow-lg shadow-teal-500/20">
                <Sliders className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                  System Settings & Device Provisioning
                </h1>
                <p className="text-xs text-slate-500">
                  Manage restaurant profile, HQ branch pairing tokens, counter kiosk locks, and department roles.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/setup')}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 border border-slate-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-teal-600" />
              Re-run Setup Wizard
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'terminal' 
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
            Terminal Role & Kiosk Lock
          </button>

          <button
            onClick={() => setActiveTab('provisioning')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'provisioning' 
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            HQ Branch Provisioning & Tokens
          </button>

          <button
            onClick={() => setActiveTab('departments')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'departments' 
                ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            Department Roles & Module Access
          </button>

          <button
            onClick={() => setActiveTab('devices')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'devices' 
                ? 'bg-blue-500 text-white shadow-md shadow-blue-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Tablet className="w-4 h-4" />
            Device & Tab Config
          </button>

          <button
            onClick={() => setActiveTab('sync')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'sync' 
                ? 'bg-purple-500 text-white shadow-md shadow-purple-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Database className="w-4 h-4" />
            Offline DB & Cloud Sync
          </button>
        </div>

        {/* TAB 1: TERMINAL & KIOSK LOCK MODE (Counter PC vs Owner Laptop) */}
        {activeTab === 'terminal' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-teal-600" />
                  Terminal Role on this Computer / Device
                </h2>
                <p className="text-xs text-slate-500">
                  Configure whether this specific PC is a <strong>Front Cashier Billing Counter</strong> (locked from owner reports/pricing) or an <strong>Owner Laptop</strong>.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Mode: Cashier Counter */}
                <div 
                  onClick={() => setTerminalMode('CounterPOS')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    terminalMode === 'CounterPOS' 
                      ? 'border-teal-500 bg-teal-50 shadow-lg shadow-teal-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
                      <Store className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Cashier Billing Counter</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">High-speed billing register on billing PC.</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-teal-600">✓ Fast POS Checkout</li>
                      <li className="text-teal-600">✓ Tables, Floor & KDS</li>
                      <li className="text-teal-600">✓ Cash Shift Register</li>
                      <li className="text-rose-500 font-semibold">🔒 Reports & Menu Locked</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    terminalMode === 'CounterPOS' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {terminalMode === 'CounterPOS' ? 'ACTIVE ON THIS PC' : 'Select'}
                  </span>
                </div>

                {/* Mode: Owner Laptop */}
                <div 
                  onClick={() => setTerminalMode('OwnerAdmin')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    terminalMode === 'OwnerAdmin' 
                      ? 'border-teal-500 bg-teal-50 shadow-lg shadow-teal-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
                      <Laptop className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Owner Laptop / Back Office</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Full access for owner and executives.</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-teal-600">✓ Profit Analytics & P&L</li>
                      <li className="text-teal-600">✓ End-of-Day Z-Reports</li>
                      <li className="text-teal-600">✓ Edit Menu Prices & Recipes</li>
                      <li className="text-teal-600">✓ Staff PINs & Settings</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    terminalMode === 'OwnerAdmin' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {terminalMode === 'OwnerAdmin' ? 'ACTIVE ON THIS PC' : 'Select'}
                  </span>
                </div>

                {/* Mode: Waiter Tab */}
                <div 
                  onClick={() => setTerminalMode('WaiterTab')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    terminalMode === 'WaiterTab' 
                      ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                      <Tablet className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Waiter Mobile Tab</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">For mobile tablets used on the dining floor.</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-blue-600">✓ Dining Tables Selection</li>
                      <li className="text-blue-600">✓ Send Order to Kitchen</li>
                      <li className="text-rose-500 font-semibold">🔒 Cash Drawer Locked</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    terminalMode === 'WaiterTab' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {terminalMode === 'WaiterTab' ? 'ACTIVE ON THIS PC' : 'Select'}
                  </span>
                </div>

                {/* Mode: Kitchen KDS */}
                <div 
                  onClick={() => setTerminalMode('KitchenKDS')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    terminalMode === 'KitchenKDS' 
                      ? 'border-amber-500 bg-amber-50 shadow-lg shadow-amber-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                      <ChefHat className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Kitchen Display (KDS)</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Full-screen ticket display in kitchen.</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-amber-600">✓ Cooking Station Tickets</li>
                      <li className="text-amber-600">✓ Mark Orders Ready</li>
                      <li className="text-rose-500 font-semibold">🔒 All Billing Hidden</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    terminalMode === 'KitchenKDS' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {terminalMode === 'KitchenKDS' ? 'ACTIVE ON THIS PC' : 'Select'}
                  </span>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: DEVICE ACTIVATION — one-time pairing codes */}
        {activeTab === 'provisioning' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-teal-600" />
                  Device Activation
                </h2>
                <p className="text-xs text-slate-500">
                  Generate a one-time code, then enter it on the till or tablet itself. The code
                  expires in 15 minutes, works once, and binds that device to this branch.
                </p>
              </div>

              {/* Slot usage. Shown before anything is generated so an owner learns they are at
                  their limit here, rather than after walking over to the hardware. */}
              {deviceCapacity.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {deviceCapacity.map((cap) => (
                    <div key={cap.terminalType} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] uppercase font-semibold text-slate-500">
                        {cap.terminalType === 'OrderTab' ? 'Tablets' : cap.terminalType === 'Counter' ? 'Counters' : 'Kitchen Displays'}
                      </div>
                      <div className="text-lg font-black text-slate-900">
                        {cap.inUse}
                        <span className="text-sm font-bold text-slate-400">
                          {cap.limit === null ? ' / unlimited' : ` / ${cap.limit}`}
                        </span>
                      </div>
                      {!cap.canAdd && (
                        <div className="text-[10px] text-amber-600 font-semibold mt-1">All slots in use</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Generate */}
              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-slate-700">Generate a pairing code</div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={newDeviceType}
                    onChange={(e) => setNewDeviceType(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                  >
                    <option value={1}>Counter (full till)</option>
                    <option value={2}>Tablet / mPOS</option>
                    <option value={3}>Kitchen Display</option>
                  </select>
                  <input
                    type="text"
                    value={newDeviceName}
                    onChange={(e) => setNewDeviceName(e.target.value)}
                    placeholder="Device name, e.g. Counter 2"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                  />
                  <button
                    onClick={handleGeneratePairingCode}
                    className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
                  >
                    Generate Code
                  </button>
                </div>
              </div>

              {/* The code, shown once. There is no way to recover it afterwards — only a SHA-256
                  hash is stored — so it stays on screen until dismissed. */}
              {issuedCode && (
                <div className="p-5 rounded-xl bg-teal-50 border-2 border-teal-300 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase font-bold text-teal-700">
                        Enter this on the {issuedCode.terminalType === 'OrderTab' ? 'tablet' : 'device'}
                      </div>
                      <div className="text-3xl font-black text-teal-700 font-mono tracking-[0.3em]">
                        {issuedCode.pairingCode}
                      </div>
                      <div className="text-[11px] text-teal-700">
                        {issuedCode.terminalName} · {issuedCode.branchName} · expires{' '}
                        {new Date(issuedCode.expiresAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleCopyToken(issuedCode.pairingCode)}
                        className="px-3 py-1.5 rounded-md bg-white hover:bg-teal-100 text-teal-700 text-xs font-semibold flex items-center gap-1.5 border border-teal-300 transition"
                      >
                        {copiedToken === issuedCode.pairingCode
                          ? (<><Check className="w-3.5 h-3.5" /> Copied</>)
                          : (<><Copy className="w-3.5 h-3.5" /> Copy</>)}
                      </button>
                      <button
                        onClick={() => setIssuedCode(null)}
                        className="px-3 py-1.5 rounded-md bg-transparent hover:bg-teal-100 text-teal-700 text-xs font-semibold border border-transparent transition"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-teal-800 bg-white/60 rounded-lg px-3 py-2 border border-teal-200">
                    This code will not be shown again. If it is lost, cancel it below and generate another.
                  </div>
                </div>
              )}

              {/* Outstanding codes — prefix only; the full value is unrecoverable by design. */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">Codes awaiting activation</div>
                {pairingBranches.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <ShieldCheck className="w-7 h-7 text-slate-400 mx-auto" />
                    <p className="text-xs text-slate-500">No codes outstanding for this branch.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pairingBranches.map((code: any) => (
                      <div key={code.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="text-sm font-bold text-slate-900 font-mono">
                            {code.codePrefix}<span className="text-slate-400">••••</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {code.terminalName} · expires {new Date(code.expiresAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <button
                          onClick={() => handleCancelPairingCode(code.id)}
                          className="px-3 py-1.5 rounded-md bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold border border-slate-200 hover:border-rose-200 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 shrink-0 text-teal-600 mt-0.5" />
                <div>
                  <strong className="text-slate-900">On the device:</strong> open Cashly POS, choose
                  <strong> Activate this device</strong>, and enter the code. The device receives a
                  licence tied to that machine, renewed automatically whenever it is online. It keeps
                  selling offline, and only stops if it goes unreachable for an extended period.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DEPARTMENT ROLES & MODULE ACCESS */}
        {activeTab === 'departments' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  Head Office & Branch Department Role Views
                </h2>
                <p className="text-xs text-slate-500">
                  Switch the department view for this session. Only the profiles your account has been
                  granted are shown — assignments come from Module Permissions, not from this screen.
                </p>
              </div>

              {availableDepartments.length === 0 ? (
                <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
                  <Lock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-900 block">No department profiles assigned</strong>
                    Your account has no back-office module access. Ask an owner to grant you the
                    relevant modules under Module Permissions.
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {availableDepartments.map(dept => {
                      const isActive = activeDepartment === dept.id;
                      const accentText =
                        dept.accent === 'blue' ? 'text-blue-600'
                        : dept.accent === 'purple' ? 'text-purple-600'
                        : 'text-teal-600';
                      const accentBorder =
                        dept.accent === 'blue' ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10'
                        : dept.accent === 'purple' ? 'border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/10'
                        : 'border-teal-500 bg-teal-50 shadow-lg shadow-teal-500/10';
                      const accentBadge =
                        dept.accent === 'blue' ? 'bg-blue-500 text-white'
                        : dept.accent === 'purple' ? 'bg-purple-500 text-white'
                        : 'bg-teal-500 text-white';
                      const accentIconBox =
                        dept.accent === 'blue' ? 'bg-blue-50 border-blue-200 text-blue-600'
                        : dept.accent === 'purple' ? 'bg-purple-50 border-purple-200 text-purple-600'
                        : 'bg-teal-50 border-teal-200 text-teal-600';
                      const Icon = dept.id === 'Accounts' ? DollarSign : dept.id === 'Procurement' ? Truck : ShieldCheck;

                      return (
                        <div
                          key={dept.id}
                          onClick={() => setActiveDepartment(dept.id)}
                          className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                            isActive ? accentBorder : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${accentIconBox}`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-900">{dept.title}</h3>
                              <p className="text-[11px] text-slate-500 mt-0.5">{dept.subtitle}</p>
                            </div>
                            <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                              {dept.capabilities.map(c => (
                                <li key={c} className={accentText}>✓ {c}</li>
                              ))}
                              {dept.restriction && (
                                <li className="text-rose-500 font-semibold">🔒 {dept.restriction}</li>
                              )}
                              <li className="text-slate-400 font-mono text-[10px] pt-1">
                                module: {dept.module}{can(dept.module, 'edit') ? ' (edit)' : ' (view only)'}
                              </li>
                            </ul>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                            isActive ? accentBadge : 'bg-slate-100 text-slate-500'
                          }`}>
                            {isActive ? 'ACTIVE PROFILE' : `Switch to ${dept.title.split(' ')[0]}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {availableDepartments.length < DEPARTMENT_PROFILES.length && (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 flex items-start gap-2.5">
                      <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>
                        {DEPARTMENT_PROFILES.length - availableDepartments.length} further department
                        profile(s) are hidden because your account does not have access to their modules.
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: OFFLINE DB & SYNC DIAGNOSTICS */}
        {activeTab === 'sync' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-purple-600" />
                    Offline-First Local Storage & Sync Engine
                  </h2>
                  <p className="text-xs text-slate-500">
                    Inspect local IndexedDB data cache and pending offline orders queue.
                  </p>
                </div>

                <button
                  onClick={handleForceSync}
                  disabled={isSyncingNow || !isOnline}
                  className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs flex items-center gap-2 disabled:opacity-50 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingNow ? 'animate-spin' : ''}`} />
                  {isSyncingNow ? 'Syncing Queue...' : 'Force Sync to HQ'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Network Connection</span>
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    {isOnline ? (
                      <span className="text-teal-600 flex items-center gap-1.5"><Wifi className="w-4 h-4" /> Online (Connected)</span>
                    ) : (
                      <span className="text-amber-600 flex items-center gap-1.5"><Wifi className="w-4 h-4" /> Offline (Local Mode)</span>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Cached Menu Products</span>
                  <div className="text-sm font-bold text-slate-900 font-mono">{dbStats.products} Products</div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Cached Categories</span>
                  <div className="text-sm font-bold text-slate-900 font-mono">{dbStats.categories} Categories</div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Pending Offline Orders</span>
                  <div className={`text-sm font-bold font-mono ${offlinePendingCount > 0 ? 'text-amber-600' : 'text-teal-600'}`}>
                    {offlinePendingCount} Invoices
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: DEVICE & TAB CONFIGURATION */}
        {activeTab === 'devices' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Tablet className="w-4 h-4 text-blue-600" />
                  Device & Tab Configuration
                </h2>
                <p className="text-xs text-slate-500">
                  Manage waiter tablet devices, POS counters, and kitchen display screens for this branch.
                </p>
              </div>

              {/* Branch Info & Limits */}
              {selectedBranch && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Branch</div>
                    <div className="text-xs font-bold text-slate-900">{selectedBranch.name}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Max Counters</div>
                    <div className="text-xs font-bold text-teal-600 font-mono">
                      {terminals.filter(t => t.terminalType === 'Counter').length} / {selectedBranch.allowedCounters || 5}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Max Order Tabs</div>
                    <div className="text-xs font-bold text-blue-600 font-mono">
                      {terminals.filter(t => t.terminalType === 'OrderTab').length} / {selectedBranch.allowedOrderTabs || 15}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 uppercase">Kitchen Displays</div>
                    <div className="text-xs font-bold text-amber-600 font-mono">
                      {terminals.filter(t => t.terminalType === 'KitchenDisplay').length}
                    </div>
                  </div>
                </div>
              )}

              {/* Add New Tab */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="New tab name (e.g., Floor Tab 3)"
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTerminal()}
                  className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
                <button
                  onClick={handleAddTerminal}
                  disabled={!newTabName.trim()}
                  className="px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white font-bold text-xs transition"
                >
                  + Add Order Tab
                </button>
              </div>

              {tabMessage && (
                <div className={`px-3 py-2 rounded-xl text-xs font-semibold ${
                  tabMessage.type === 'success' ? 'bg-teal-50 text-teal-600 border border-teal-200' : 'bg-rose-50 text-rose-600 border border-rose-200'
                }`}>
                  {tabMessage.text}
                </div>
              )}

              {/* Terminal Devices List */}
              <div className="space-y-2">
                {terminals.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    No devices registered yet. Add your first tab above.
                  </div>
                ) : (
                  terminals.map(t => (
                    <div key={t.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                      t.isActive 
                        ? 'bg-white border-slate-200' 
                        : 'bg-slate-50 border-slate-200 opacity-60'
                    }`}>
                      {/* Type Icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                        t.terminalType === 'Counter' ? 'bg-teal-50 text-teal-600' :
                        t.terminalType === 'OrderTab' ? 'bg-blue-50 text-blue-600' :
                        'bg-amber-50 text-amber-600'
                      }`}>
                        {t.terminalType === 'Counter' ? 'POS' : t.terminalType === 'OrderTab' ? 'TAB' : 'KDS'}
                      </div>

                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        {editingTabId === t.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingTabName}
                              onChange={(e) => setEditingTabName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRenameTerminal(t.id)}
                              className="flex-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                              autoFocus
                            />
                            <button onClick={() => handleRenameTerminal(t.id)} className="text-teal-600 hover:text-teal-500 text-xs">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditingTabId(null)} className="text-slate-400 hover:text-slate-600 text-xs">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="font-bold text-xs text-slate-900">{t.terminalName}</div>
                        )}
                        <div className="text-[10px] text-slate-500 font-mono">Token: {t.deviceToken.slice(0, 12)}...</div>
                      </div>

                      {/* Status */}
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${t.isActive ? 'bg-teal-400' : 'bg-slate-300'}`} />
                        <span className="text-[10px] text-slate-500">{t.isActive ? 'Active' : 'Disabled'}</span>
                      </div>

                      {/* Last Seen */}
                      <div className="text-[10px] text-slate-500 min-w-[80px] text-right">
                        {new Date(t.lastSeenAt).toLocaleDateString()}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingTabId(t.id); setEditingTabName(t.terminalName); }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
                          title="Rename"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleTerminal(t.id, t.isActive)}
                          className={`p-1.5 rounded-lg hover:bg-slate-100 transition ${
                            t.isActive ? 'text-teal-600 hover:text-teal-500' : 'text-slate-400 hover:text-slate-600'
                          }`}
                          title={t.isActive ? 'Disable' : 'Enable'}
                        >
                          {t.isActive ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteTerminal(t.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition"
                          title="Delete"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Info Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] space-y-1.5">
                <div className="font-bold text-slate-900">How Device Registration Works</div>
                <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                  <li>Each device gets a unique Device Token on creation</li>
                  <li>When a waiter opens the app and selects "Waiter" mode, the device auto-registers with this token</li>
                  <li>Disable a tab to lock a lost/stolen tablet from placing orders</li>
                  <li>Max limits enforced by your subscription tier</li>
                </ul>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

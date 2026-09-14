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
  Download, 
  Key, 
  Lock, 
  Unlock, 
  Laptop, 
  Monitor, 
  Tablet, 
  ChefHat, 
  Users, 
  DollarSign, 
  Percent, 
  Sliders, 
  Truck
} from 'lucide-react';
import { usePosStore } from '../store/posStore';
import { posApi } from '../services/api';
import { offlineDb } from '../services/offlineDb';
import type { BranchPairingInfo } from '../types';
import { useNavigate } from 'react-router-dom';

export const SettingsManagement: React.FC = () => {
  const navigate = useNavigate();
  const { 
    selectedTenant, 
    selectedBranch, 
    deploymentMode, 
    terminalMode, 
    activeDepartment, 
    isAdminUnlocked, 
    adminMasterPin, 
    isOnline,
    offlinePendingCount,
    setTerminalMode, 
    setActiveDepartment, 
    setAdminMasterPin, 
    lockAdmin,
    refreshOfflineCount,
    syncPendingOrders,
    cashTaxRatePercent,
    cardTaxRatePercent,
    taxMode,
    setTaxSettings
  } = usePosStore();

  const [activeTab, setActiveTab] = useState<'profile' | 'provisioning' | 'terminal' | 'departments' | 'sync' | 'devices'>('terminal');

  // HQ Branch Pairing state
  const [pairingBranches, setPairingBranches] = useState<BranchPairingInfo[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [hqUrl, setHqUrl] = useState(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288');

  // PIN modal state
  const [newAdminPin, setNewAdminPin] = useState(adminMasterPin);
  const [pinChangeMessage, setPinChangeMessage] = useState<string | null>(null);

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
  }, []);

  const loadPairingInfo = async () => {
    try {
      const data = await posApi.getPairingInfo();
      setPairingBranches(data);
    } catch (err) {
      console.warn('Failed to load pairing info:', err);
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
  };

  const handleAddTerminal = async () => {
    if (!newTabName.trim() || !selectedBranch?.id) return;
    try {
      await posApi.createTerminal({
        branchId: selectedBranch.id,
        terminalName: newTabName.trim(),
        terminalType: 2 // OrderTab
      });
      setNewTabName('');
      setTabMessage({ type: 'success', text: 'Tab device added' });
      loadTerminals();
      setTimeout(() => setTabMessage(null), 2500);
    } catch (err: any) {
      setTabMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to add tab' });
      setTimeout(() => setTabMessage(null), 3000);
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

  const handleDeleteTerminal = async (id: string) => {
    if (!confirm('Delete this terminal device?')) return;
    try {
      await posApi.deleteTerminal(id);
      loadTerminals();
    } catch (err) {
      console.warn('Failed to delete terminal:', err);
    }
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleCopyFullConfig = (branch: BranchPairingInfo) => {
    const config = {
      tenantId: branch.tenantId,
      tenantName: branch.tenantName,
      branchId: branch.branchId,
      branchName: branch.branchName,
      branchCode: branch.branchCode,
      hqApiUrl: hqUrl,
      pairingToken: branch.pairingToken,
      generatedAt: new Date().toISOString()
    };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopiedToken(`CONFIG-${branch.branchId}`);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleDownloadConfig = (branch: BranchPairingInfo) => {
    const config = {
      tenantId: branch.tenantId,
      tenantName: branch.tenantName,
      branchId: branch.branchId,
      branchName: branch.branchName,
      branchCode: branch.branchCode,
      hqApiUrl: hqUrl,
      pairingToken: branch.pairingToken,
      generatedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashly-branch-config-${branch.branchCode.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSavePin = () => {
    if (newAdminPin.trim().length >= 4) {
      setAdminMasterPin(newAdminPin.trim());
      setPinChangeMessage('Master Admin PIN successfully updated!');
      setTimeout(() => setPinChangeMessage(null), 3000);
    }
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
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition ${
              activeTab === 'profile' 
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Store className="w-4 h-4" />
            Business & Tax Configuration
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

              {/* Master Admin PIN Override Setting */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-teal-600" />
                    <span className="text-sm font-bold text-slate-900">Master Admin Override PIN</span>
                    {isAdminUnlocked ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200 font-bold flex items-center gap-1">
                        <Unlock className="w-3 h-3" /> TEMPORARILY UNLOCKED
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 font-bold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> LOCKED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Allows the restaurant owner to temporarily unlock admin screens directly on the cashier counter PC without switching computers.
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <input 
                    type="password"
                    maxLength={6}
                    value={newAdminPin}
                    onChange={(e) => setNewAdminPin(e.target.value)}
                    placeholder="New PIN (e.g. 1234)"
                    className="w-28 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 text-center font-mono focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                  <button
                    onClick={handleSavePin}
                    className="px-3 py-1.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs transition"
                  >
                    Update PIN
                  </button>
                  {isAdminUnlocked && (
                    <button
                      onClick={lockAdmin}
                      className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold transition"
                    >
                      Lock Now
                    </button>
                  )}
                </div>
              </div>

              {pinChangeMessage && (
                <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-600 text-xs flex items-center gap-2">
                  <Check className="w-4 h-4" /> {pinChangeMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: HQ PROVISIONING & BRANCH PAIRING TOKENS */}
        {activeTab === 'provisioning' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600" />
                    HQ Branch Provisioning & Auto-Pairing Center
                  </h2>
                  <p className="text-xs text-slate-500">
                    Use these unique pairing tokens to install and automatically bind branch counter PCs to Head Office.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">HQ Server URL:</span>
                  <input 
                    type="text" 
                    value={hqUrl}
                    onChange={(e) => setHqUrl(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1 text-xs text-slate-900 font-mono focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              {pairingBranches.length === 0 ? (
                <div className="p-8 text-center rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <Store className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-700">No Outlet Branches Found</p>
                  <p className="text-xs text-slate-500">Add outlet branches in Multi-Branch mode to generate quick pairing tokens.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {pairingBranches.map((branch) => (
                      <div key={branch.branchId} className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4 flex flex-col justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <Store className="w-4 h-4 text-teal-600" />
                              {branch.branchName}
                            </h3>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200 font-mono font-bold">
                              {branch.branchCode}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">City: {branch.city} • Allowed Counters: {branch.allowedCounters}</p>

                          <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between">
                            <div className="space-y-0.5">
                              <span className="text-[10px] text-slate-500 uppercase font-semibold">Branch Pairing Token</span>
                              <div className="text-sm font-extrabold text-teal-600 font-mono tracking-wider">
                                {branch.pairingToken}
                              </div>
                            </div>
                            <button
                              onClick={() => handleCopyToken(branch.pairingToken)}
                              className="px-3 py-1.5 rounded-md bg-teal-50 hover:bg-teal-100 text-teal-600 text-xs font-semibold flex items-center gap-1.5 border border-teal-200 transition"
                            >
                              {copiedToken === branch.pairingToken ? (
                                <>
                                  <Check className="w-3.5 h-3.5" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" /> Copy Code
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                          <button
                            onClick={() => handleCopyFullConfig(branch)}
                            className="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 transition"
                          >
                            <Copy className="w-3.5 h-3.5 text-slate-500" />
                            {copiedToken === `CONFIG-${branch.branchId}` ? 'Config Copied!' : 'Copy Config JSON'}
                          </button>
                          <button
                            onClick={() => handleDownloadConfig(branch)}
                            className="py-1.5 px-3 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 text-xs font-semibold flex items-center justify-center gap-1.5 border border-teal-200 transition"
                            title="Download setup file for branch counter PC"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-700 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 shrink-0 text-teal-600 mt-0.5" />
                    <div>
                      <strong className="text-slate-900">How to use on branch PC:</strong> Open Cashly POS on the outlet PC $\rightarrow$ Click <strong>"Connect to HQ Chain"</strong> in the Setup Wizard $\rightarrow$ Paste this Token. The system will configure the branch database and lock to POS mode automatically.
                    </div>
                  </div>
                </div>
              )}
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
                  Select which department profile to view in this session. Each department is restricted exclusively to its operational modules.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Department: Accounts & Finance */}
                <div 
                  onClick={() => setActiveDepartment('Accounts')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    activeDepartment === 'Accounts' 
                      ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                      <DollarSign className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Accounts & Finance Dept</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Audits, P&L, Tax & Cashflow</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-blue-600">✓ Consolidated P&L Analytics</li>
                      <li className="text-blue-600">✓ End-of-Day Z-Reports</li>
                      <li className="text-blue-600">✓ Tax Audit & FBR Register</li>
                      <li className="text-blue-600">✓ Payment Tender Mix</li>
                      <li className="text-rose-500 font-semibold">🔒 POS & Kitchen Hidden</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    activeDepartment === 'Accounts' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {activeDepartment === 'Accounts' ? 'ACTIVE PROFILE' : 'Switch to Accounts'}
                  </span>
                </div>

                {/* Department: Purchase & Procurement */}
                <div 
                  onClick={() => setActiveDepartment('Procurement')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    activeDepartment === 'Procurement' 
                      ? 'border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
                      <Truck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Purchase & Supply Chain</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Central Warehouse & Transfers</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-purple-600">✓ Central Commissary Stock</li>
                      <li className="text-purple-600">✓ Inter-Branch Transfers Dispatch</li>
                      <li className="text-purple-600">✓ Vendor Purchase Orders (PO)</li>
                      <li className="text-purple-600">✓ Raw Material Inward</li>
                      <li className="text-rose-500 font-semibold">🔒 Sales P&L Hidden</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    activeDepartment === 'Procurement' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {activeDepartment === 'Procurement' ? 'ACTIVE PROFILE' : 'Switch to Supply Chain'}
                  </span>
                </div>

                {/* Department: Owner / Master Admin */}
                <div 
                  onClick={() => setActiveDepartment('Owner')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition flex flex-col justify-between ${
                    activeDepartment === 'Owner' 
                      ? 'border-teal-500 bg-teal-50 shadow-lg shadow-teal-500/10' 
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Director & Owner Admin</h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">Full Master Privilege</p>
                    </div>
                    <ul className="text-[11px] text-slate-700 space-y-1 pt-2 border-t border-slate-200">
                      <li className="text-teal-600">✓ Executive Director Dashboard</li>
                      <li className="text-teal-600">✓ All Reports & Financials</li>
                      <li className="text-teal-600">✓ Menu, Recipes, Prices & Tax</li>
                      <li className="text-teal-600">✓ Branch Switching & Quotas</li>
                      <li className="text-teal-600 font-semibold">★ Full Unrestricted Access</li>
                    </ul>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-3 inline-block ${
                    activeDepartment === 'Owner' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {activeDepartment === 'Owner' ? 'ACTIVE PROFILE' : 'Switch to Owner'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: BUSINESS PROFILE & TAX */}
        {activeTab === 'profile' && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Store className="w-4 h-4 text-amber-600" />
                  Business Profile & Tax Configuration
                </h2>
                <p className="text-xs text-slate-500">
                  Manage restaurant branding, tax rates (FBR compliance), and operating details.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Restaurant / Brand Name</label>
                  <input 
                    type="text" 
                    defaultValue={selectedTenant?.name || 'Cashly Restaurant'} 
                    disabled
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Deployment Architecture</label>
                  <input 
                    type="text" 
                    value={deploymentMode === 'MultiBranch' ? '🏢 Multi-Branch Enterprise Chain' : '🏪 Single Restaurant Location'} 
                    disabled
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">Current Outlet Name</label>
                  <input 
                    type="text" 
                    defaultValue={selectedBranch?.name || 'Main Dining Branch'} 
                    disabled
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700"
                  />
                </div>
              </div>

              {/* Tax Settings */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Percent className="w-4 h-4 text-amber-600" />
                  Tax Rates & FBR Differential Rates
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Cash Payment Tax Rate (%)</label>
                    <input 
                      type="number" 
                      value={cashTaxRatePercent}
                      onChange={(e) => setTaxSettings({ cashRate: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Card / Digital Tax Rate (%)</label>
                    <input 
                      type="number" 
                      value={cardTaxRatePercent}
                      onChange={(e) => setTaxSettings({ cardRate: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Tax Mode</label>
                    <select 
                      value={taxMode}
                      onChange={(e) => setTaxSettings({ mode: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="Exclusive">Tax Exclusive (Added on top)</option>
                      <option value="Inclusive">Tax Inclusive (Inside item price)</option>
                    </select>
                  </div>
                </div>
              </div>
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

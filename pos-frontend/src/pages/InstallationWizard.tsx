import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Store, 
  ShieldCheck, 
  Database, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  Wifi, 
  UtensilsCrossed,
  MapPin,
  Phone,
  Lock,
  User,
  DollarSign,
  Key
} from 'lucide-react';
import { posApi } from '../services/api';
import { offlineDb } from '../services/offlineDb';
import { usePosStore } from '../store/posStore';
import type { BusinessType, DeploymentMode, BranchInitPayload } from '../types';

export const InstallationWizard: React.FC = () => {
  const navigate = useNavigate();
  const { setTenants, setDeploymentMode, setIsInstalled } = usePosStore();

  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [deploymentMode, setMode] = useState<DeploymentMode>('Single');
  const [restaurantName, setRestaurantName] = useState('My Restaurant');
  const [businessType, setBusinessType] = useState<BusinessType>('Restaurant');
  const [currency, setCurrency] = useState('PKR');
  const [city, setCity] = useState('Islamabad');
  const [address, setAddress] = useState('Main Commercial Area');
  const [phone, setPhone] = useState('051-1234567');

  // Single Branch Settings
  const [mainBranchName, setMainBranchName] = useState('Main Dining Branch');
  const [allowedCounters, setAllowedCounters] = useState<number>(3);

  // Multi-Branch Settings
  const [hqName, setHqName] = useState('Head Office & Central Commissary');
  const [branches, setBranches] = useState<BranchInitPayload[]>([
    { name: 'Downtown Outlet', code: 'BR-01', city: 'Islamabad', address: 'Sector F-7 Markaz', phone: '051-2651122', allowedCounters: 5, allowedOrderTabs: 15 },
    { name: 'Gulberg Outlet', code: 'BR-02', city: 'Lahore', address: 'Main Boulevard, Gulberg III', phone: '042-3578912', allowedCounters: 5, allowedOrderTabs: 15 }
  ]);

  // Admin Account
  const [adminFullName, setAdminFullName] = useState('Restaurant Owner');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPin, setAdminPin] = useState('1234');

  // Offline & Starter Options
  const [enableOfflineDb, setEnableOfflineDb] = useState(true);
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288');
  const [seedStarterMenu, setSeedStarterMenu] = useState(true);

  // Quick Branch Pairing State
  const [showTokenPairing, setShowTokenPairing] = useState(false);
  const [pairingInputToken, setPairingInputToken] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  // Multi-branch row manipulation
  const addBranchRow = () => {
    const idx = branches.length + 1;
    setBranches([
      ...branches,
      { name: `Branch ${idx}`, code: `BR-0${idx}`, city: city || 'Islamabad', address: '', phone: '', allowedCounters: 3, allowedOrderTabs: 10 }
    ]);
  };

  const removeBranchRow = (index: number) => {
    if (branches.length <= 1) return;
    setBranches(branches.filter((_, i) => i !== index));
  };

  const updateBranchField = (index: number, field: keyof BranchInitPayload, val: any) => {
    const next = [...branches];
    next[index] = { ...next[index], [field]: val };
    setBranches(next);
  };

  const handlePairWithToken = async () => {
    if (!pairingInputToken.trim()) return;
    setIsPairing(true);
    setErrorMessage(null);

    try {
      const res = await posApi.pairBranchWithToken(pairingInputToken.trim());
      if (res && res.success) {
        setDeploymentMode('MultiBranch');
        setIsInstalled(true);
        localStorage.setItem('cashly_is_installed', 'true');
        localStorage.setItem('cashly_deployment_mode', 'MultiBranch');
        localStorage.setItem('cashly_terminal_mode', 'CounterPOS');
        localStorage.setItem('cashly_api_url', apiUrl);

        // Cache products and categories in local IndexedDB
        if (res.categories) {
          await offlineDb.categories.bulkPut(res.categories);
        }
        if (res.products) {
          await offlineDb.products.bulkPut(res.products);
        }

        const tenants = await posApi.getTenants();
        setTenants(tenants);

        navigate('/');
      }
    } catch (err: any) {
      console.error('Branch pairing failed:', err);
      setErrorMessage(err?.response?.data?.message || 'Failed to pair branch. Verify the pairing token and ensure HQ server is reachable.');
    } finally {
      setIsPairing(false);
    }
  };

  const handleCompleteSetup = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const payload = {
        deploymentMode,
        restaurantName,
        businessType,
        city,
        address,
        phone,
        mainBranchName,
        hqName,
        allowedCounters,
        adminFullName,
        adminUsername,
        adminPin,
        seedStarterMenu,
        branches: deploymentMode === 'MultiBranch' ? branches : undefined
      };

      await posApi.initializeSetup(payload);

      // Save mode and installation flags
      setDeploymentMode(deploymentMode);
      setIsInstalled(true);
      localStorage.setItem('cashly_is_installed', 'true');
      localStorage.setItem('cashly_deployment_mode', deploymentMode);
      localStorage.setItem('cashly_offline_enabled', enableOfflineDb ? 'true' : 'false');
      localStorage.setItem('cashly_api_url', apiUrl);

      // Fetch fresh tenants list to refresh store
      const tenants = await posApi.getTenants();
      setTenants(tenants);

      // Navigate to destination
      if (deploymentMode === 'MultiBranch') {
        navigate('/director');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      console.error('Setup initialization failed:', err);
      setErrorMessage(err?.response?.data?.message || err.message || 'Failed to initialize setup. Please verify the backend API is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Banner */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <UtensilsCrossed className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              Cashly POS <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30">Installation Wizard</span>
            </h1>
            <p className="text-xs text-slate-400">First-Time Deployment & Architecture Onboarding</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="hidden md:flex items-center gap-2 text-xs">
          {[
            { num: 1, label: 'Architecture Mode' },
            { num: 2, label: 'Restaurant & Outlets' },
            { num: 3, label: 'Admin Security' },
            { num: 4, label: 'Offline & Sync' },
            { num: 5, label: 'Deploy' }
          ].map((s) => (
            <div 
              key={s.num} 
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all ${
                step === s.num 
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 font-semibold' 
                  : step > s.num 
                  ? 'bg-slate-800/80 border-slate-700 text-slate-300' 
                  : 'border-transparent text-slate-500'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s.num ? 'bg-emerald-500 text-slate-950' : step > s.num ? 'bg-emerald-500/40 text-white' : 'bg-slate-800 text-slate-400'
              }`}>
                {step > s.num ? '✓' : s.num}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Form Content */}
      <div className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10 flex flex-col justify-center">
        {errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: Select Architecture Mode */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center md:text-left space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">Choose Your Restaurant Setup Mode</h2>
              <p className="text-sm text-slate-400">Select whether Cashly POS will power a single standalone location or a multi-branch chain with central Head Office.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Single Restaurant Option */}
              <div 
                onClick={() => setMode('Single')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                  deploymentMode === 'Single'
                    ? 'border-emerald-500 bg-emerald-950/20 shadow-xl shadow-emerald-500/10 ring-1 ring-emerald-500/40'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {deploymentMode === 'Single' && (
                  <div className="absolute top-4 right-4 text-emerald-400">
                    <CheckCircle2 className="w-6 h-6 fill-emerald-500 text-slate-950" />
                  </div>
                )}
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Single Restaurant Outlet</h3>
                    <p className="text-xs text-slate-400 mt-1">Independent standalone cafe, diner, takeaway, or full-service dining restaurant.</p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span> Direct Counter POS & Split-Second Billing
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span> Table Floor Management & Waiter Tabs
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span> Kitchen Display System (KDS)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span> Local Stock & Cash Shift Register
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span> Clean, streamlined navigation (no commissary overhead)
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 text-xs font-semibold text-emerald-400 flex items-center gap-1">
                  Fastest setup • Recommended for single spots
                </div>
              </div>

              {/* Multi-Branch Chain Option */}
              <div 
                onClick={() => setMode('MultiBranch')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                  deploymentMode === 'MultiBranch'
                    ? 'border-indigo-500 bg-indigo-950/20 shadow-xl shadow-indigo-500/10 ring-1 ring-indigo-500/40'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {deploymentMode === 'MultiBranch' && (
                  <div className="absolute top-4 right-4 text-indigo-400">
                    <CheckCircle2 className="w-6 h-6 fill-indigo-500 text-slate-950" />
                  </div>
                )}
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Multi-Branch Chain with Head Office (HQ)</h3>
                    <p className="text-xs text-slate-400 mt-1">For multi-location chains with a Central Commissary / Warehouse and branch outlets.</p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">✓</span> Central Commissary & Central Recipe Management
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">✓</span> Inter-Branch Stock Transfers (Dispatch → Receive)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">✓</span> Centralized Vendor Purchase Orders (PO)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">✓</span> Consolidated Director / C-Level Analytics
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-indigo-400 font-bold">✓</span> Branch Switcher & Multi-Branch Access Control
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 text-xs font-semibold text-indigo-400 flex items-center gap-1">
                  Enterprise-grade • Full commissary supply chain
                </div>
              </div>
            </div>

            {/* Quick Pair Branch Option */}
            <div className="pt-4 border-t border-slate-800/80">
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Installing on a Restaurant Branch Counter PC?</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    If your Head Office has already generated a <strong>Branch Pairing Token</strong>, connect this PC to HQ instantly in 5 seconds.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowTokenPairing(!showTokenPairing)}
                  className="px-4 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <Key className="w-3.5 h-3.5" />
                  {showTokenPairing ? 'Hide Token Input' : '⚡ Connect with Branch Token'}
                </button>
              </div>

              {showTokenPairing && (
                <div className="mt-3 p-4 rounded-2xl bg-slate-900 border border-indigo-500/40 space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-4 space-y-1">
                      <label className="text-xs font-semibold text-slate-300">HQ Server API URL</label>
                      <input 
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="http://localhost:5288"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="md:col-span-5 space-y-1">
                      <label className="text-xs font-semibold text-slate-300">Branch Pairing Token (From HQ Settings)</label>
                      <input 
                        type="text"
                        value={pairingInputToken}
                        onChange={(e) => setPairingInputToken(e.target.value)}
                        placeholder="e.g. RG-DT-8912"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-emerald-400 font-mono font-bold tracking-wider uppercase focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <button
                        type="button"
                        disabled={isPairing || !pairingInputToken.trim()}
                        onClick={handlePairWithToken}
                        className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition cursor-pointer"
                      >
                        {isPairing ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                            Pairing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 fill-slate-950" /> Pair & Launch Branch POS
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: Restaurant & Outlets Profile */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">Business Profile & Outlets</h2>
              <p className="text-sm text-slate-400">Enter your restaurant details, currency, and physical branch locations.</p>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-emerald-400" /> Restaurant / Brand Name
                  </label>
                  <input 
                    type="text" 
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    placeholder="e.g. Royal Grill & Kitchen"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-emerald-400" /> Business Type
                  </label>
                  <select 
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Restaurant">Restaurant / Café / Dine-in</option>
                    <option value="Retail">Retail Store</option>
                    <option value="CashAndCarry">Cash & Carry / Mart</option>
                    <option value="Hybrid">Hybrid Food & Retail</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Operating Currency
                  </label>
                  <select 
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="PKR">PKR (Pakistani Rupee)</option>
                    <option value="USD">USD ($)</option>
                    <option value="AED">AED (Dirham)</option>
                    <option value="SAR">SAR (Riyal)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" /> Primary City
                  </label>
                  <input 
                    type="text" 
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Islamabad"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" /> Address / Main Area
                  </label>
                  <input 
                    type="text" 
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Sector F-7 Markaz"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-400" /> Official Phone / UAN
                  </label>
                  <input 
                    type="text" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 051-111-443-443"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Mode-specific branch configuration */}
              {deploymentMode === 'Single' ? (
                <div className="pt-4 border-t border-slate-800 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Store className="w-4 h-4 text-emerald-400" /> Single Outlet Configuration
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Outlet Branch Name</label>
                      <input 
                        type="text" 
                        value={mainBranchName}
                        onChange={(e) => setMainBranchName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300">Allowed Counter Terminals</label>
                      <input 
                        type="number" 
                        value={allowedCounters}
                        onChange={(e) => setAllowedCounters(parseInt(e.target.value) || 1)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pt-4 border-t border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-indigo-400" /> Multi-Branch & HQ Setup
                      </h3>
                      <p className="text-xs text-slate-400">Head Office Commissary + Initial Outlets</p>
                    </div>
                    <button 
                      type="button"
                      onClick={addBranchRow}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Another Branch
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">Central Head Office / Commissary Name</label>
                    <input 
                      type="text" 
                      value={hqName}
                      onChange={(e) => setHqName(e.target.value)}
                      placeholder="e.g. Royal Grill Head Office & Central Commissary"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-3 pt-2">
                    <label className="text-xs font-semibold text-slate-300">Initial Outlets / Branches:</label>
                    {branches.map((b, idx) => (
                      <div key={idx} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                        <div className="md:col-span-4">
                          <input 
                            type="text"
                            placeholder="Branch Name"
                            value={b.name}
                            onChange={(e) => updateBranchField(idx, 'name', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <input 
                            type="text"
                            placeholder="Code (e.g. RG-01)"
                            value={b.code}
                            onChange={(e) => updateBranchField(idx, 'code', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 uppercase"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <input 
                            type="text"
                            placeholder="City"
                            value={b.city}
                            onChange={(e) => updateBranchField(idx, 'city', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <input 
                            type="text"
                            placeholder="Address"
                            value={b.address}
                            onChange={(e) => updateBranchField(idx, 'address', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="md:col-span-1 flex justify-end">
                          <button 
                            type="button"
                            disabled={branches.length <= 1}
                            onClick={() => removeBranchRow(idx)}
                            className="p-1.5 text-slate-500 hover:text-red-400 disabled:opacity-30 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: Admin & Security Credentials */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">Master Admin Account</h2>
              <p className="text-sm text-slate-400">Create the primary owner/admin credentials with full system permissions.</p>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-400" /> Full Name
                  </label>
                  <input 
                    type="text" 
                    value={adminFullName}
                    onChange={(e) => setAdminFullName(e.target.value)}
                    placeholder="e.g. Muhammad Ali"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-400" /> Admin Username
                  </label>
                  <input 
                    type="text" 
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-400" /> Master Security PIN (4-6 Digits)
                  </label>
                  <input 
                    type="password" 
                    maxLength={6}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    placeholder="1234"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400 space-y-2">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> Default Permissions Granted:
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-slate-300">
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ Full Financial Reports</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ Menu & Tax Adjustments</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ Inventory Management</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ Order Void & Discounts</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ User & Role Management</span>
                  <span className="flex items-center gap-1.5 text-emerald-400">✓ Central Transfers & POs</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Offline & Sync Architecture */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">Offline & Sync Configuration</h2>
              <p className="text-sm text-slate-400">Configure how Cashly POS behaves when the internet drops in the restaurant.</p>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-6">
              {/* Local-First IndexedDB Toggle */}
              <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">Local-First Storage Engine (IndexedDB)</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Saves product catalogs, modifiers, dining tables, and offline invoices locally in the browser/desktop cache. Billing never stops even if WiFi disconnects.
                  </p>
                </div>
                <input 
                  type="checkbox" 
                  checked={enableOfflineDb}
                  onChange={(e) => setEnableOfflineDb(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer mt-1"
                />
              </div>

              {/* Cloud Sync API Server */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" /> Backend / Cloud API Server URL
                </label>
                <input 
                  type="text" 
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:5288"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-500">
                  When internet restores, pending offline tickets automatically sync to this central database endpoint.
                </p>
              </div>

              {/* Starter Menu Seed */}
              <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-bold text-white">Load Starter Fast-Food & Café Menu Template</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Pre-loads sample categories (Burgers, Pizzas, Beverages, Sides), modifiers, and dining floor tables so you can test POS immediately.
                  </p>
                </div>
                <input 
                  type="checkbox" 
                  checked={seedStarterMenu}
                  onChange={(e) => setSeedStarterMenu(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer mt-1"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: Review & Deploy */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">Ready to Initialize Cashly POS</h2>
              <p className="text-sm text-slate-400">Review your deployment summary before finalizing installation.</p>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Deployment Architecture</span>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    {deploymentMode === 'Single' ? (
                      <span className="text-emerald-400 flex items-center gap-1"><Store className="w-4 h-4" /> Single Restaurant Outlet</span>
                    ) : (
                      <span className="text-indigo-400 flex items-center gap-1"><Building2 className="w-4 h-4" /> Multi-Branch Chain with HQ</span>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Restaurant Name & Currency</span>
                  <div className="text-sm font-bold text-white">
                    {restaurantName} ({currency})
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Locations Configured</span>
                  <div className="text-slate-300">
                    {deploymentMode === 'Single' ? (
                      <span>1 Branch: {mainBranchName} ({city})</span>
                    ) : (
                      <span>1 HQ ({hqName}) + {branches.length} Outlets ({branches.map(b => b.name).join(', ')})</span>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Master Admin Account</span>
                  <div className="text-slate-300">
                    Username: <span className="text-emerald-400 font-mono font-semibold">{adminUsername}</span> • Name: {adminFullName}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>All parameters validated. Clicking <strong>Complete Installation</strong> will configure database schemas, initialize users, and launch the POS terminal.</span>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Navigation Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800/80 mt-6">
          {step > 1 ? (
            <button 
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : <div />}

          {step < 5 ? (
            <button 
              type="button"
              onClick={() => setStep(step + 1)}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
            >
              Next Step <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button 
              type="button"
              disabled={loading}
              onClick={handleCompleteSetup}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-extrabold text-sm flex items-center gap-2 shadow-xl shadow-emerald-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  Initializing System...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-slate-950" /> Complete Installation & Launch POS
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-900 bg-slate-950 px-6 py-3 text-center text-xs text-slate-600">
        Cashly POS v3.0 • Local-First Offline & Multi-Branch Cloud Architecture
      </div>
    </div>
  );
};

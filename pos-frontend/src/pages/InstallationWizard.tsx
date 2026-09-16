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
  Key,
  Monitor,
  Tablet,
  Zap
} from 'lucide-react';
import { posApi } from '../services/api';
import { COUNTRIES, getCountryByCode } from '../data/countries';
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
  const [countryCode, setCountryCode] = useState('PK');
  const [city, setCity] = useState('Islamabad');
  const [address, setAddress] = useState('Main Commercial Area');
  const [phone, setPhone] = useState('051-1234567');

  // Single Branch Settings
  const [mainBranchName, setMainBranchName] = useState('Main Dining Branch');
  const [allowedCounters, setAllowedCounters] = useState<number>(2);
  const [allowedOrderTabs, setAllowedOrderTabs] = useState<number>(10);
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Standard' | 'Professional'>('Standard');

  const PLANS: { key: 'Starter' | 'Standard' | 'Professional'; label: string; counters: number; tablets: number; badge?: string; color: string; ring: string; borderActive: string; bgActive: string; badgeColor: string }[] = [
    {
      key: 'Starter',
      label: 'Starter',
      counters: 1,
      tablets: 3,
      color: 'emerald',
      ring: 'ring-emerald-500',
      borderActive: 'border-emerald-500',
      bgActive: 'bg-emerald-50',
      badgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    },
    {
      key: 'Standard',
      label: 'Standard',
      counters: 2,
      tablets: 10,
      badge: 'Most Popular',
      color: 'teal',
      ring: 'ring-teal-500',
      borderActive: 'border-teal-500',
      bgActive: 'bg-teal-50',
      badgeColor: 'bg-teal-50 text-teal-600 border-teal-200',
    },
    {
      key: 'Professional',
      label: 'Professional',
      counters: 5,
      tablets: 25,
      color: 'amber',
      ring: 'ring-amber-500',
      borderActive: 'border-amber-500',
      bgActive: 'bg-amber-50',
      badgeColor: 'bg-amber-50 text-amber-600 border-amber-200',
    },
  ];

  const handleSelectPlan = (plan: typeof PLANS[number]) => {
    setSelectedPlan(plan.key);
    setAllowedCounters(plan.counters);
    setAllowedOrderTabs(plan.tablets);
  };

  const handleCountryChange = (code: string) => {
    const preset = getCountryByCode(code);
    if (!preset) return;
    setCountryCode(code);
    setCurrency(preset.currencyCode);
    setCity(preset.defaultCity);
    setPhone(preset.phoneCode + '-');
  };

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

        // Tenants now require a session. This is best-effort here — App reloads
        // them properly once the user signs in at the login gate.
        try {
          setTenants(await posApi.getTenants());
        } catch {
          console.info('Tenant list will load after sign-in.');
        }

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
        countryCode,
        currencyCode: getCountryByCode(countryCode)?.currencyCode || currency,
        currencySymbol: getCountryByCode(countryCode)?.currencySymbol || '₨',
        decimalPlaces: getCountryByCode(countryCode)?.decimals || 0,
        taxAuthorityName: getCountryByCode(countryCode)?.taxAuthority || 'FBR',
        defaultTaxRate: getCountryByCode(countryCode)?.defaultTaxRate ?? 16,
        useDualTaxRate: getCountryByCode(countryCode)?.useDualTaxRate ?? true,
        digitalTaxRate: getCountryByCode(countryCode)?.digitalTaxRate ?? 8,
        phoneCode: getCountryByCode(countryCode)?.phoneCode || '+92',
        allowedPaymentMethods: getCountryByCode(countryCode)?.paymentMethods || 'Cash,Card,JazzCash,EasyPaisa,Raast,CustomerKhata',
        city,
        address,
        phone,
        mainBranchName,
        hqName,
        allowedCounters,
        allowedOrderTabs: deploymentMode === 'Single' ? allowedOrderTabs : undefined,
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

      // Fetch fresh tenants list to refresh store. Best-effort: this endpoint now
      // requires a session, and the admin created above has not signed in yet —
      // App reloads tenants right after login.
      try {
        setTenants(await posApi.getTenants());
      } catch {
        console.info('Tenant list will load after sign-in.');
      }

      // Navigate to destination. Unauthenticated, this lands on the login gate,
      // which is exactly where a freshly-installed system should start.
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between selection:bg-emerald-500 selection:text-white">
      {/* Top Banner */}
      <div className="border-b border-slate-200 bg-white backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <UtensilsCrossed className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              Cashly POS <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-semibold border border-emerald-200">Installation Wizard</span>
            </h1>
            <p className="text-xs text-slate-500">First-Time Deployment & Architecture Onboarding</p>
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
                  ? 'bg-emerald-500 border-emerald-500 text-white font-semibold' 
                  : step > s.num 
                  ? 'bg-slate-100 border-slate-200 text-slate-700' 
                  : 'border-transparent text-slate-500'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s.num ? 'bg-white text-emerald-600' : step > s.num ? 'bg-emerald-500/40 text-white' : 'bg-slate-200 text-slate-500'
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
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-sm flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: Select Architecture Mode */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center md:text-left space-y-1">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Choose Your Restaurant Setup Mode</h2>
              <p className="text-sm text-slate-500">Select whether Cashly POS will power a single standalone location or a multi-branch chain with central Head Office.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Single Restaurant Option */}
              <div 
                onClick={() => setMode('Single')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                  deploymentMode === 'Single'
                    ? 'border-emerald-500 bg-emerald-50 shadow-xl shadow-emerald-500/10 ring-1 ring-emerald-500/40'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                {deploymentMode === 'Single' && (
                  <div className="absolute top-4 right-4 text-emerald-400">
                    <CheckCircle2 className="w-6 h-6 fill-emerald-500 text-white" />
                  </div>
                )}
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Single Restaurant Outlet</h3>
                    <p className="text-xs text-slate-500 mt-1">Independent standalone cafe, diner, takeaway, or full-service dining restaurant.</p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-700 pt-2 border-t border-slate-200">
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Direct Counter POS & Split-Second Billing
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Table Floor Management & Waiter Tabs
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Kitchen Display System (KDS)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Local Stock & Cash Shift Register
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-emerald-600 font-bold">✓</span> Clean, streamlined navigation (no commissary overhead)
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  Fastest setup • Recommended for single spots
                </div>
              </div>

              {/* Multi-Branch Chain Option */}
              <div 
                onClick={() => setMode('MultiBranch')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                  deploymentMode === 'MultiBranch'
                    ? 'border-teal-500 bg-teal-50 shadow-xl shadow-teal-500/10 ring-1 ring-teal-500/40'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                {deploymentMode === 'MultiBranch' && (
                  <div className="absolute top-4 right-4 text-teal-400">
                    <CheckCircle2 className="w-6 h-6 fill-teal-500 text-white" />
                  </div>
                )}
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Multi-Branch Chain with Head Office (HQ)</h3>
                    <p className="text-xs text-slate-500 mt-1">For multi-location chains with a Central Commissary / Warehouse and branch outlets.</p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-700 pt-2 border-t border-slate-200">
                    <li className="flex items-center gap-2">
                      <span className="text-teal-600 font-bold">✓</span> Central Commissary & Central Recipe Management
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-teal-600 font-bold">✓</span> Inter-Branch Stock Transfers (Dispatch → Receive)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-teal-600 font-bold">✓</span> Centralized Vendor Purchase Orders (PO)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-teal-600 font-bold">✓</span> Consolidated Director / C-Level Analytics
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-teal-600 font-bold">✓</span> Branch Switcher & Multi-Branch Access Control
                    </li>
                  </ul>
                </div>

                <div className="mt-6 pt-4 text-xs font-semibold text-teal-600 flex items-center gap-1">
                  Enterprise-grade • Full commissary supply chain
                </div>
              </div>
            </div>

            {/* Quick Pair Branch Option */}
            <div className="pt-4 border-t border-slate-200">
              <div className="p-4 rounded-2xl bg-white border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-bold text-slate-900">Installing on a Restaurant Branch Counter PC?</h3>
                  </div>
                  <p className="text-xs text-slate-500">
                    If your Head Office has already generated a <strong>Branch Pairing Token</strong>, connect this PC to HQ instantly in 5 seconds.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowTokenPairing(!showTokenPairing)}
                  className="px-4 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-600 border border-teal-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  <Key className="w-3.5 h-3.5" />
                  {showTokenPairing ? 'Hide Token Input' : '⚡ Connect with Branch Token'}
                </button>
              </div>

              {showTokenPairing && (
                <div className="mt-3 p-4 rounded-2xl bg-white border border-teal-500/40 space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-4 space-y-1">
                      <label className="text-xs font-semibold text-slate-600">HQ Server API URL</label>
                      <input 
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="http://localhost:5288"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                    </div>

                    <div className="md:col-span-5 space-y-1">
                      <label className="text-xs font-semibold text-slate-600">Branch Pairing Token (From HQ Settings)</label>
                      <input 
                        type="text"
                        value={pairingInputToken}
                        onChange={(e) => setPairingInputToken(e.target.value)}
                        placeholder="e.g. RG-DT-8912"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono font-bold tracking-wider uppercase focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <button
                        type="button"
                        disabled={isPairing || !pairingInputToken.trim()}
                        onClick={handlePairWithToken}
                        className="w-full py-2 px-4 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-teal-500/20 disabled:opacity-50 transition cursor-pointer"
                      >
                        {isPairing ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Pairing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 fill-white" /> Pair & Launch Branch POS
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
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Business Profile & Outlets</h2>
              <p className="text-sm text-slate-500">Enter your restaurant details, currency, and physical branch locations.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-emerald-600" /> Restaurant / Brand Name
                  </label>
                  <input 
                    type="text" 
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    placeholder="e.g. Royal Grill & Kitchen"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-emerald-600" /> Business Type
                  </label>
                  <select 
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  >
                    <option value="Restaurant">Restaurant / Café / Dine-in</option>
                    <option value="Retail">Retail Store</option>
                    <option value="CashAndCarry">Cash & Carry / Mart</option>
                    <option value="Hybrid">Hybrid Food & Retail</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-600" /> Country & Currency
                  </label>
                  <select 
                    value={countryCode}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.currencyCode} {c.currencySymbol})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Primary City
                  </label>
                  <input 
                    type="text" 
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Islamabad"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" /> Address / Main Area
                  </label>
                  <input 
                    type="text" 
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Sector F-7 Markaz"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" /> Official Phone / UAN
                  </label>
                  <input 
                    type="text" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 051-111-443-443"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              {/* Mode-specific branch configuration */}
              {deploymentMode === 'Single' ? (
                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Store className="w-4 h-4 text-emerald-600" /> Single Outlet Configuration
                  </h3>

                  {/* Outlet name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Outlet Branch Name</label>
                    <input
                      type="text"
                      value={mainBranchName}
                      onChange={(e) => setMainBranchName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  {/* Plan selection cards */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-600" /> Select Terminal Plan
                      <span className="text-slate-500 font-normal ml-1">— auto-sets your counter &amp; tablet users</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {PLANS.map((plan) => {
                        const isActive = selectedPlan === plan.key;
                        const borderClass = isActive ? plan.borderActive : 'border-slate-200';
                        const bgClass = isActive ? plan.bgActive : 'bg-white hover:bg-slate-50';
                        const ringClass = isActive ? `ring-1 ${plan.ring}` : '';
                        return (
                          <div
                            key={plan.key}
                            onClick={() => handleSelectPlan(plan)}
                            className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-150 flex flex-col gap-3 ${borderClass} ${bgClass} ${ringClass}`}
                          >
                            {/* Top row: plan name + badge */}
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-slate-900">{plan.label}</span>
                              {plan.badge && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${plan.badgeColor}`}>
                                  {plan.badge}
                                </span>
                              )}
                              {isActive && (
                                <CheckCircle2 className="w-4 h-4 text-white fill-current opacity-80 shrink-0" />
                              )}
                            </div>

                            {/* Auto Counter */}
                            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                              <Monitor className="w-4 h-4 text-slate-500 shrink-0" />
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Auto Counter</p>
                                <p className="text-lg font-extrabold text-slate-900 leading-tight">{plan.counters}</p>
                              </div>
                            </div>

                            {/* Tablet Users */}
                            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                              <Tablet className="w-4 h-4 text-slate-500 shrink-0" />
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Tablet Users</p>
                                <p className="text-lg font-extrabold text-slate-900 leading-tight">{plan.tablets}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Live summary of selected plan */}
                    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                      <Monitor className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span><span className="text-slate-900 font-semibold">{allowedCounters}</span> Auto Counter{allowedCounters !== 1 ? 's' : ''}</span>
                      <span className="text-slate-300">·</span>
                      <Tablet className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span><span className="text-slate-900 font-semibold">{allowedOrderTabs}</span> Tablet User{allowedOrderTabs !== 1 ? 's' : ''}</span>
                      <span className="ml-auto text-slate-500">Plan: <span className="text-slate-900 font-semibold">{selectedPlan}</span></span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-teal-600" /> Multi-Branch & HQ Setup
                      </h3>
                      <p className="text-xs text-slate-500">Head Office Commissary + Initial Outlets</p>
                    </div>
                    <button 
                      type="button"
                      onClick={addBranchRow}
                      className="px-3 py-1.5 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Another Branch
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600">Central Head Office / Commissary Name</label>
                    <input 
                      type="text" 
                      value={hqName}
                      onChange={(e) => setHqName(e.target.value)}
                      placeholder="e.g. Royal Grill Head Office & Central Commissary"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-4 pt-2">
                    <label className="text-xs font-semibold text-slate-600">Initial Outlets / Branches:</label>
                    {branches.map((b, idx) => {
                      // Determine which plan this branch currently matches (for highlight)
                      const branchPlanKey = PLANS.find(
                        (p) => p.counters === b.allowedCounters && p.tablets === b.allowedOrderTabs
                      )?.key ?? null;

                      return (
                        <div key={idx} className="rounded-xl bg-white border border-slate-200 overflow-hidden">
                          {/* Branch header */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                            <span className="text-xs font-bold text-teal-600 flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5" /> Branch {idx + 1}
                            </span>
                            <button
                              type="button"
                              disabled={branches.length <= 1}
                              onClick={() => removeBranchRow(idx)}
                              className="p-1 text-slate-500 hover:text-rose-500 disabled:opacity-30 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="p-4 space-y-4">
                            {/* Fields row */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              <div>
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Branch Name</label>
                                <input
                                  type="text"
                                  placeholder="e.g. Downtown Outlet"
                                  value={b.name}
                                  onChange={(e) => updateBranchField(idx, 'name', e.target.value)}
                                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Code</label>
                                <input
                                  type="text"
                                  placeholder="e.g. BR-01"
                                  value={b.code}
                                  onChange={(e) => updateBranchField(idx, 'code', e.target.value)}
                                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 uppercase"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">City</label>
                                <input
                                  type="text"
                                  placeholder="e.g. Islamabad"
                                  value={b.city}
                                  onChange={(e) => updateBranchField(idx, 'city', e.target.value)}
                                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Address</label>
                                <input
                                  type="text"
                                  placeholder="e.g. Sector F-7 Markaz"
                                  value={b.address}
                                  onChange={(e) => updateBranchField(idx, 'address', e.target.value)}
                                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                                />
                              </div>
                            </div>

                            {/* Plan selector */}
                            <div className="space-y-2">
                              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                <Zap className="w-3 h-3 text-amber-600" /> Terminal Plan
                              </label>
                              <div className="grid grid-cols-3 gap-2">
                                {PLANS.map((plan) => {
                                  const isActive = branchPlanKey === plan.key;
                                  return (
                                    <div
                                      key={plan.key}
                                      onClick={() => {
                                        updateBranchField(idx, 'allowedCounters', plan.counters);
                                        updateBranchField(idx, 'allowedOrderTabs', plan.tablets);
                                      }}
                                      className={`relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-150 flex flex-col gap-2 ${
                                        isActive
                                          ? `${plan.borderActive} ${plan.bgActive} ring-1 ${plan.ring}`
                                          : 'border-slate-200 bg-white hover:bg-slate-50'
                                      }`}
                                    >
                                      {/* Plan name + check */}
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-slate-900">{plan.label}</span>
                                        {plan.badge && (
                                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${plan.badgeColor}`}>
                                            {plan.badge}
                                          </span>
                                        )}
                                        {isActive && (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-white fill-current opacity-80 shrink-0" />
                                        )}
                                      </div>

                                      {/* Auto Counter */}
                                      <div className="flex items-center gap-2 p-2 rounded-md bg-slate-50 border border-slate-200">
                                        <Monitor className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                        <div>
                                          <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold leading-none">Auto Counter</p>
                                          <p className="text-base font-extrabold text-slate-900 leading-tight">{plan.counters}</p>
                                        </div>
                                      </div>

                                      {/* Tablet Users */}
                                      <div className="flex items-center gap-2 p-2 rounded-md bg-slate-50 border border-slate-200">
                                        <Tablet className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                        <div>
                                          <p className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold leading-none">Tablet Users</p>
                                          <p className="text-base font-extrabold text-slate-900 leading-tight">{plan.tablets}</p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {/* Per-branch live summary */}
                              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                                <Monitor className="w-3 h-3 text-slate-500 shrink-0" />
                                <span><span className="text-slate-900 font-semibold">{b.allowedCounters ?? 0}</span> Auto Counter{(b.allowedCounters ?? 0) !== 1 ? 's' : ''}</span>
                                <span className="text-slate-300">·</span>
                                <Tablet className="w-3 h-3 text-slate-500 shrink-0" />
                                <span><span className="text-slate-900 font-semibold">{b.allowedOrderTabs ?? 0}</span> Tablet User{(b.allowedOrderTabs ?? 0) !== 1 ? 's' : ''}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Master Admin Account</h2>
              <p className="text-sm text-slate-500">Create the primary owner/admin credentials with full system permissions.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-600" /> Full Name
                  </label>
                  <input 
                    type="text" 
                    value={adminFullName}
                    onChange={(e) => setAdminFullName(e.target.value)}
                    placeholder="e.g. Muhammad Ali"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-600" /> Admin Username
                  </label>
                  <input 
                    type="text" 
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-600" /> Master Security PIN (4-6 Digits)
                  </label>
                  <input 
                    type="password" 
                    maxLength={6}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    placeholder="1234"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-2">
                <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Default Permissions Granted:
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-slate-700">
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ Full Financial Reports</span>
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ Menu & Tax Adjustments</span>
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ Inventory Management</span>
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ Order Void & Discounts</span>
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ User & Role Management</span>
                  <span className="flex items-center gap-1.5 text-emerald-600">✓ Central Transfers & POs</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Offline & Sync Architecture */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Offline & Sync Configuration</h2>
              <p className="text-sm text-slate-500">Configure how Cashly POS behaves when the internet drops in the restaurant.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
              {/* Local-First IndexedDB Toggle */}
              <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-bold text-slate-900">Local-First Storage Engine (IndexedDB)</span>
                  </div>
                  <p className="text-xs text-slate-500">
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
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-emerald-600" /> Backend / Cloud API Server URL
                </label>
                <input 
                  type="text" 
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:5288"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-500">
                  When internet restores, pending offline tickets automatically sync to this central database endpoint.
                </p>
              </div>

              {/* Starter Menu Seed */}
              <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-bold text-slate-900">Load Starter Fast-Food & Café Menu Template</span>
                  </div>
                  <p className="text-xs text-slate-500">
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
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Ready to Initialize Cashly POS</h2>
              <p className="text-sm text-slate-500">Review your deployment summary before finalizing installation.</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Deployment Architecture</span>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    {deploymentMode === 'Single' ? (
                      <span className="text-emerald-600 flex items-center gap-1"><Store className="w-4 h-4" /> Single Restaurant Outlet</span>
                    ) : (
                      <span className="text-teal-600 flex items-center gap-1"><Building2 className="w-4 h-4" /> Multi-Branch Chain with HQ</span>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Restaurant Name & Currency</span>
                  <div className="text-sm font-bold text-slate-900">
                    {restaurantName} ({currency})
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Locations Configured</span>
                  <div className="text-slate-700">
                    {deploymentMode === 'Single' ? (
                      <span>1 Branch: {mainBranchName} ({city})</span>
                    ) : (
                      <span>1 HQ ({hqName}) + {branches.length} Outlets ({branches.map(b => b.name).join(', ')})</span>
                    )}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold">Master Admin Account</span>
                  <div className="text-slate-700">
                    Username: <span className="text-emerald-600 font-mono font-semibold">{adminUsername}</span> • Name: {adminFullName}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 text-xs flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>All parameters validated. Clicking <strong>Complete Installation</strong> will configure database schemas, initialize users, and launch the POS terminal.</span>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Navigation Buttons */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-200 mt-6">
          {step > 1 ? (
            <button 
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : <div />}

          {step < 5 ? (
            <button 
              type="button"
              onClick={() => setStep(step + 1)}
              className="px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-teal-500/20 transition-all cursor-pointer"
            >
              Next Step <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button 
              type="button"
              disabled={loading}
              onClick={handleCompleteSetup}
              className="px-8 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-extrabold text-sm flex items-center gap-2 shadow-xl shadow-teal-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Initializing System...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-white" /> Complete Installation & Launch POS
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500">
        Cashly POS v3.0 • Local-First Offline & Multi-Branch Cloud Architecture
      </div>
    </div>
  );
};

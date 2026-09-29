import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Store, 
  ShieldCheck, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Plus, 
  Trash2, 
  UtensilsCrossed, 
  MapPin, 
  Phone, 
  Lock, 
  User, 
  DollarSign, 
  Monitor, 
  Mail, 
  Server, 
  Network, 
  Copy, 
  Check 
} from 'lucide-react';
import { posApi, setApiBaseUrl, getApiErrorMessage } from '../services/api';
import { COUNTRIES, getCountryByCode } from '../data/countries';
import { usePosStore } from '../store/posStore';
import { activate as activateDevice, getStoredTerminal } from '../services/deviceLicense';
import type { 
  BusinessType, 
  DeploymentMode, 
  BranchInitPayload, 
  BusinessStructure, 
  CatalogControl, 
  PurchasingControl,
  InstallationSystemType,
  ErpDeploymentRole,
  PosServerTopology
} from '../types';

const CHAIN_HQ_NAME = 'Head Office & Central Commissary';

export const InstallationWizard: React.FC<{ forceSignup?: boolean }> = ({ forceSignup = false }) => {
  const navigate = useNavigate();
  const { setTenants, setDeploymentMode, setIsInstalled } = usePosStore();

  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Registration vs Install mode
  const [signupMode, setSignupMode] = useState<boolean>(forceSignup);
  const [signupSuccess, setSignupSuccess] = useState<{ 
    restaurantName: string; 
    username: string; 
    pin: string; 
    serverUrl?: string; 
    systemType: InstallationSystemType;
    erpRole?: ErpDeploymentRole;
  } | null>(null);

  // 1. Primary System Choice: POS Only vs POS + ERP
  const [systemType, setSystemType] = useState<InstallationSystemType>('POS_ERP');

  // 2. Selected Plan: Starter, Standard, Professional
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Standard' | 'Professional'>('Standard');

  // 3. For POS + ERP: Install ERP Server (HQ) vs Install POS Terminal (Connect)
  const [erpRole, setErpRole] = useState<ErpDeploymentRole>('ERP_SERVER');

  // 4. Connection Topology for POS Terminal: Same Server vs Different Server
  const [serverTopology, setServerTopology] = useState<PosServerTopology>('SAME_SERVER');
  const [pairingInputToken, setPairingInputToken] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  // Form State
  const [restaurantName, setRestaurantName] = useState('Royal Grill & Kitchen');
  const [businessType, setBusinessType] = useState<BusinessType>('Restaurant');
  const [currency, setCurrency] = useState('PKR');
  const [countryCode, setCountryCode] = useState('PK');
  const [city, setCity] = useState('Islamabad');
  const [address, setAddress] = useState('Sector F-7 Markaz');
  const [phone, setPhone] = useState('051-1234567');

  // Single Branch Settings (POS Only)
  const [mainBranchName, setMainBranchName] = useState('Main Dining Branch');
  const [allowedCounters, setAllowedCounters] = useState<number>(2);
  const [allowedOrderTabs, setAllowedOrderTabs] = useState<number>(10);

  // HQ & Branches (POS + ERP)
  const [hqName, setHqName] = useState(CHAIN_HQ_NAME);
  const [hqHoldsStock, setHqHoldsStock] = useState(true);
  const hqCity = city;
  const hqAddress = address;

  // Legal Entity defaults
  const legalName = '';
  const ntn = '';
  const strn = '';

  // Policies defaults
  const catalogControl: CatalogControl = 'HeadOfficeOnly';
  const branchPricing = false;
  const purchasingControl: PurchasingControl = 'HeadOfficeBuys';
  const allowNegativeStock = true;
  const bookAccounts = true;

  // Initial Branches (Unlimited on all plans for POS + ERP)
  const [branches, setBranches] = useState<BranchInitPayload[]>([
    { name: 'Downtown Outlet', code: 'BR-01', city: 'Islamabad', address: 'Sector F-7 Markaz', phone: '051-2651122', allowedCounters: 5, allowedOrderTabs: 15 },
    { name: 'Gulberg Outlet', code: 'BR-02', city: 'Lahore', address: 'Main Boulevard, Gulberg III', phone: '042-3578912', allowedCounters: 5, allowedOrderTabs: 15 }
  ]);

  // Admin Account
  const [adminFullName, setAdminFullName] = useState('Restaurant Owner');
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPin, setAdminPin] = useState('1234');
  const [adminEmail, setAdminEmail] = useState('');

  // Offline & Server Settings
  const enableOfflineDb = true;
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288');
  const seedStarterMenu = true;

  // Detect configured server on mount
  useEffect(() => {
    if (forceSignup) return;
    let cancelled = false;
    posApi.getSetupStatus()
      .then((status) => {
        if (!cancelled && status?.isConfigured) setSignupMode(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [forceSignup]);

  const handleCountryChange = (code: string) => {
    const preset = getCountryByCode(code);
    if (!preset) return;
    setCountryCode(code);
    setCurrency(preset.currencyCode);
    setCity(preset.defaultCity);
    setPhone(preset.phoneCode + '-');
  };

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

  // Plan Configurations for POS Only
  const POS_ONLY_PLANS = [
    {
      key: 'Starter' as const,
      label: 'Starter',
      counters: 1,
      tablets: 3,
      badge: undefined,
      description: 'Ideal for single food stalls, small cafes, and takeout joints.',
      features: ['1 Counter Billing Terminal', '3 Waiter / Order Tablets', 'Direct Receipt Printing', 'Daily Shift Cash Register']
    },
    {
      key: 'Standard' as const,
      label: 'Standard',
      counters: 2,
      tablets: 10,
      badge: 'Most Popular',
      description: 'Full-service dine-in cafes and standalone busy restaurants.',
      features: ['2 Counter Billing Terminals', '10 Waiter Tablets & QR Tables', 'Kitchen Display System (KDS)', 'Floor & Table Layout Manager']
    },
    {
      key: 'Professional' as const,
      label: 'Professional',
      counters: 5,
      tablets: 25,
      badge: 'High Volume',
      description: 'High-speed fast food and multi-station large dining restaurants.',
      features: ['5 Counter Billing Terminals', '25 Waiter Tablets', 'Multi-Kitchen Routing & KDS', 'Customer Khata & VIP Loyalty']
    }
  ];

  // Plan Configurations for POS + ERP
  const POS_ERP_PLANS = [
    {
      key: 'Starter' as const,
      label: 'Starter',
      badge: undefined,
      description: 'Central management for emerging multi-outlet food brands.',
      features: [
        '🏢 Central Head Office & Branch Operations',
        '🖥️ Counter Terminals & Waiter Tablets',
        '📦 Central Menu & Inventory Sync',
        '📊 Branch Sales Reports'
      ]
    },
    {
      key: 'Standard' as const,
      label: 'Standard',
      badge: 'Most Popular',
      description: 'Growing restaurant chains with central purchasing & branch operations.',
      features: [
        '🏢 Central Head Office & Branch Operations',
        '🖥️ Counter Terminals & Waiter Tablets',
        '🔄 Inter-Branch Stock Transfers & Vendor POs',
        '📈 Consolidated Director Analytics & P&L',
        '👥 Role-Based Department Permissions'
      ]
    },
    {
      key: 'Professional' as const,
      label: 'Professional',
      badge: 'Enterprise',
      description: 'Established enterprise food chains, commissaries & franchises.',
      features: [
        '🏢 Enterprise Multi-Branch Control',
        '🖥️ Tills, Order Tablets & Kitchen Displays',
        '🏭 Central Commissary & Production Recipes',
        '📒 Full Chart of Accounts & General Ledger',
        '🛡️ Multi-Warehouse & External API Sync'
      ]
    }
  ];

  // Pair POS Terminal with ERP
  const handlePairWithToken = async () => {
    setIsPairing(true);
    setErrorMessage(null);

    const targetUrl = serverTopology === 'SAME_SERVER' ? 'http://localhost:5288' : apiUrl.trim();

    try {
      setApiBaseUrl(targetUrl);
      
      // If code was provided, activate with token
      if (pairingInputToken.trim()) {
        await activateDevice(pairingInputToken.trim());
      }

      const terminal = getStoredTerminal();
      setDeploymentMode('MultiBranch');
      setIsInstalled(true);
      localStorage.setItem('cashly_is_installed', 'true');
      localStorage.setItem('cashly_deployment_mode', 'MultiBranch');
      localStorage.setItem(
        'cashly_terminal_mode',
        terminal?.type === 'OrderTab' ? 'WaiterTab' : terminal?.type === 'KitchenDisplay' ? 'KitchenKDS' : 'CounterPOS'
      );

      navigate('/');
    } catch (err: any) {
      console.error('POS pairing failed:', err);
      setErrorMessage(getApiErrorMessage(
        err,
        'Could not connect to ERP. Ensure the ERP server is running and your pairing code is valid.'
      ));
    } finally {
      setIsPairing(false);
    }
  };

  // Step Validation
  const validateStep = (s: number): string | null => {
    // Step 1: System choice is always valid
    if (s === 1) return null;

    // Step 2: Plan selection is always valid
    if (s === 2) return null;

    // Step 3 (for POS + ERP only): Station Role
    if (s === 3 && systemType === 'POS_ERP') {
      if (erpRole === 'POS_TERMINAL') {
        if (serverTopology === 'DIFFERENT_SERVER' && !apiUrl.trim()) {
          return 'Head Office / ERP Server URL is required.';
        }
      }
      return null;
    }

    // Business Profile Step (Step 3 for POS_ONLY, Step 4 for POS_ERP)
    const profileStep = systemType === 'POS_ERP' ? 4 : 3;
    if (s === profileStep) {
      if (!restaurantName.trim()) return 'Restaurant / Brand name is required.';
      if (systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') {
        if (!hqName.trim()) return 'Head Office Name is required.';
        if (branches.some(b => !b.name.trim())) return 'All branch outlets must have a name.';
      } else if (systemType === 'POS_ONLY') {
        if (!mainBranchName.trim()) return 'Outlet branch name is required.';
      }
    }

    // Security Step (Step 4 for POS_ONLY, Step 5 for POS_ERP)
    const securityStep = systemType === 'POS_ERP' ? 5 : 4;
    if (s === securityStep) {
      if (!adminFullName.trim()) return 'Full name is required.';
      if (adminUsername.trim().length < 3) return 'Username must be at least 3 characters.';
      if (!/^\d{4,6}$/.test(adminPin.trim())) return 'Security PIN must be 4 to 6 digits.';
      if (signupMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) {
        return 'A valid email address is required to register the business.';
      }
    }

    return null;
  };

  const maxSteps = systemType === 'POS_ERP' ? 6 : 5;

  const handleNext = () => {
    const err = validateStep(step);
    if (err) {
      setErrorMessage(err);
      return;
    }
    setErrorMessage(null);
    setStep(step + 1);
  };

  const handleCompleteSetup = async () => {
    const stepError = validateStep(step);
    if (stepError) {
      setErrorMessage(stepError);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const isChain = systemType === 'POS_ERP';
    const structure: BusinessStructure = isChain ? 'ChainWithHeadOffice' : 'SingleShop';
    const deploymentMode: DeploymentMode = isChain ? 'MultiBranch' : 'Single';

    const company = {
      legalName: legalName.trim() || undefined,
      tradeName: legalName.trim() && legalName.trim() !== restaurantName.trim() ? restaurantName.trim() : undefined,
      taxRegistrationNumber: ntn.trim() || undefined,
      salesTaxRegistrationNumber: strn.trim() || undefined
    };

    const headOffice = isChain
      ? {
          name: hqName.trim() || undefined,
          city: hqCity.trim() || undefined,
          address: hqAddress.trim() || undefined,
          holdsStock: hqHoldsStock
        }
      : undefined;

    const policies = isChain
      ? { catalogControl, branchPricing, purchasingControl, allowNegativeStock }
      : { allowNegativeStock };

    try {
      // Signup Mode (Cloud / Multi-Tenant)
      if (signupMode) {
        const country = getCountryByCode(countryCode);
        await posApi.signup({
          restaurantName: restaurantName.trim(),
          contactName: adminFullName.trim(),
          email: adminEmail.trim(),
          phone: phone.trim(),
          city: city.trim() || undefined,
          address: address.trim() || undefined,
          country: country?.name,
          adminUsername: adminUsername.trim().toLowerCase(),
          adminPin: adminPin.trim(),
          businessType,
          packageKey: selectedPlan,
          deploymentMode: deploymentMode === 'MultiBranch' ? 'MultiBranch' : 'Standalone',
          businessStructure: structure,
          branches: isChain
            ? branches.filter(b => b.name.trim()).map(b => ({
                name: b.name.trim(),
                code: b.code?.trim() || undefined,
                city: b.city?.trim() || undefined,
                address: b.address?.trim() || undefined,
                phone: b.phone?.trim() || undefined
              }))
            : [{
                name: mainBranchName.trim(),
                city: city.trim() || undefined,
                address: address.trim() || undefined,
                phone: phone.trim() || undefined
              }],
          company,
          headOffice,
          policies,
          setUpAccounting: bookAccounts,
          installationType: systemType,
          appSurface: isChain && erpRole === 'ERP_SERVER' ? 'Erp' : 'Pos'
        });

        setSignupSuccess({
          restaurantName: restaurantName.trim(),
          username: adminUsername.trim().toLowerCase(),
          pin: adminPin.trim(),
          serverUrl: apiUrl || 'http://localhost:5288',
          systemType,
          erpRole
        });
        return;
      }

      // Fresh Local Setup Initialize
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
        allowedOrderTabs: isChain ? undefined : allowedOrderTabs,
        adminFullName,
        adminUsername,
        adminPin,
        seedStarterMenu,
        branches: isChain ? branches : undefined,
        businessStructure: structure,
        company,
        headOffice,
        policies,
        setUpAccounting: bookAccounts,
        selectedPlan,
        installationType: systemType,
        appSurface: isChain && erpRole === 'ERP_SERVER' ? 'Erp' : 'Pos'
      };

      await posApi.initializeSetup(payload);

      setDeploymentMode(deploymentMode);
      setIsInstalled(true);
      localStorage.setItem('cashly_is_installed', 'true');
      localStorage.setItem('cashly_deployment_mode', deploymentMode);
      localStorage.setItem('cashly_offline_enabled', enableOfflineDb ? 'true' : 'false');
      localStorage.setItem('cashly_system_type', systemType);

      if (isChain && erpRole === 'ERP_SERVER') {
        localStorage.setItem('cashly_terminal_mode', 'DirectorBackOffice');
      } else {
        localStorage.setItem('cashly_terminal_mode', 'CounterPOS');
      }

      setApiBaseUrl(apiUrl);

      try {
        setTenants(await posApi.getTenants());
      } catch {
        console.info('Tenant list will reload after login.');
      }

      // Show setup success screen with credentials and connection details
      setSignupSuccess({
        restaurantName: restaurantName.trim(),
        username: adminUsername.trim().toLowerCase(),
        pin: adminPin.trim(),
        serverUrl: apiUrl || 'http://localhost:5288',
        systemType,
        erpRole
      });
    } catch (err: any) {
      console.error('Setup failed:', err);
      setErrorMessage(getApiErrorMessage(
        err,
        signupMode ? 'Registration failed. Please try again.' : 'Failed to initialize setup. Please verify the backend API is running.'
      ));
    } finally {
      setLoading(false);
    }
  };

  // SUCCESS SCREEN
  if (signupSuccess) {
    const isErp = signupSuccess.systemType === 'POS_ERP' && signupSuccess.erpRole === 'ERP_SERVER';

    return (
      <div className="h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 overflow-y-auto selection:bg-teal-500 selection:text-white">
        <div className="w-full max-w-xl text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 mb-2">
              {isErp ? 'Head Office ERP is Live!' : "You're All Set!"}
            </h1>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-900">{signupSuccess.restaurantName}</span> has been successfully initialized.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Active Plan: <span className="font-semibold text-teal-600">{selectedPlan}</span>
            </p>
          </div>

          {/* Master Admin Login Credentials */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-2.5 shadow-sm">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600" /> Master Admin Login
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-xs text-slate-500">Username</span>
              <span className="text-sm text-slate-900 font-mono font-bold">{signupSuccess.username}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-slate-500">Master PIN</span>
              <span className="text-sm text-slate-900 font-mono font-bold">{signupSuccess.pin}</span>
            </div>
          </div>

          {/* If Head Office ERP was installed: show Connection Credentials Box for POS Terminals */}
          {isErp && (
            <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-left space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-sky-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-sky-600" /> POS Terminal Connection Hub
                </div>
                <span className="text-[10px] bg-sky-200/60 text-sky-800 font-semibold px-2 py-0.5 rounded-full">
                  For Branch Counter Tills
                </span>
              </div>
              <p className="text-xs text-sky-700">
                To connect counter computers or waiter tablets to this Head Office, install Cashly on that PC, choose <strong>POS + ERP → Install POS Terminal</strong>, and enter this Server URL:
              </p>
              <div className="flex items-center gap-2 bg-white border border-sky-200 rounded-lg p-2">
                <span className="text-xs font-mono font-bold text-slate-800 flex-1 truncate">
                  {signupSuccess.serverUrl || 'http://localhost:5288'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(signupSuccess.serverUrl || 'http://localhost:5288');
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 2000);
                  }}
                  className="p-1 text-sky-600 hover:text-sky-800 transition"
                  title="Copy URL"
                >
                  {copiedUrl ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate(isErp ? '/director' : '/')}
            className="w-full py-3.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition shadow-lg shadow-teal-500/25 cursor-pointer flex items-center justify-center gap-2"
          >
            {isErp ? (
              <>
                <Building2 className="w-4 h-4" /> Open ERP Director Dashboard
              </>
            ) : (
              <>
                <Store className="w-4 h-4" /> Open POS Terminal
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // WIZARD STEPS DEFINITION
  const wizardSteps = systemType === 'POS_ERP' 
    ? [
        { num: 1, label: 'System Mode' },
        { num: 2, label: 'Plan & Edition' },
        { num: 3, label: 'Station Role' },
        { num: 4, label: 'HQ & Branches' },
        { num: 5, label: 'Admin Security' },
        { num: 6, label: signupMode ? 'Create' : 'Deploy' }
      ]
    : [
        { num: 1, label: 'System Mode' },
        { num: 2, label: 'Plan & Edition' },
        { num: 3, label: 'Shop Profile' },
        { num: 4, label: 'Admin Security' },
        { num: 5, label: signupMode ? 'Create' : 'Deploy' }
      ];

  return (
    <div className="h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-teal-500 selection:text-white overflow-hidden">
      {/* Top Banner */}
      <div className="shrink-0 border-b border-slate-200 bg-white backdrop-blur px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center shadow shadow-teal-500/20 shrink-0">
            <UtensilsCrossed className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          </div>
          <h1 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
            Cashly POS <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 font-semibold border border-teal-200">{signupMode ? 'Register' : 'Setup'}</span>
          </h1>
        </div>

        {/* Step indicators */}
        <div className="hidden md:flex items-center gap-1.5 text-xs">
          {wizardSteps.map((s) => (
            <div
              key={s.num}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-all ${
                step === s.num
                  ? 'bg-teal-500 border-teal-500 text-white font-semibold'
                  : step > s.num
                  ? 'bg-slate-100 border-slate-200 text-slate-700'
                  : 'border-transparent text-slate-400'
              }`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                step === s.num ? 'bg-white text-teal-600' : step > s.num ? 'bg-teal-500/30 text-teal-700' : 'bg-slate-200 text-slate-500'
              }`}>
                {step > s.num ? '✓' : s.num}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {/* The plan step gets more room so its three edition cards are not cramped. */}
        <div className={`${step === 2 ? 'max-w-6xl' : 'max-w-4xl'} w-full mx-auto p-6 md:p-8`}>
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-sm flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-rose-400 animate-ping shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: Primary System Selection (POS Only vs POS + ERP) */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center md:text-left space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">How will you run Cashly?</h2>
                <p className="text-sm text-slate-500">
                  Select whether you need a standalone point-of-sale register or a complete multi-station Head Office ERP network.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. POS ONLY */}
                <div
                  onClick={() => setSystemType('POS_ONLY')}
                  className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                    systemType === 'POS_ONLY'
                      ? 'border-teal-500 bg-teal-50/60 shadow-lg shadow-teal-500/10 ring-1 ring-teal-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-3.5">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0">
                        <Store className="w-6 h-6" />
                        {systemType === 'POS_ONLY' && (
                          <span className="absolute -top-1.5 -right-1.5 drop-shadow">
                            <CheckCircle2 className="w-4 h-4 fill-teal-500 text-white" />
                          </span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">POS Only</h3>
                        <p className="text-xs text-teal-600 font-semibold">Standalone Single-Store Counter</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      For cafes, restaurants, takeaway counters, and food trucks that do not require a separate head office.
                    </p>

                    <ul className="space-y-2 text-xs text-slate-700 pt-3 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Direct Counter POS & Instant Bill Printing
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Table Floor Management & Waiter Tablets
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Kitchen Display System (KDS)
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Local Stock & Cash Shift Register
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-teal-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Instant Setup • No Central HQ Needed
                  </div>
                </div>

                {/* 2. POS + ERP */}
                <div
                  onClick={() => setSystemType('POS_ERP')}
                  className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                    systemType === 'POS_ERP'
                      ? 'border-teal-500 bg-teal-50/60 shadow-lg shadow-teal-500/10 ring-1 ring-teal-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-3.5">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0">
                        <Building2 className="w-6 h-6" />
                        {systemType === 'POS_ERP' && (
                          <span className="absolute -top-1.5 -right-1.5 drop-shadow">
                            <CheckCircle2 className="w-4 h-4 fill-teal-500 text-white" />
                          </span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-900">POS + ERP</h3>
                        <p className="text-xs text-teal-600 font-semibold">Head Office & Multi-Station / Chain</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      For businesses with an HQ/Back Office, central commissary, multiple branches, or separate billing stations.
                    </p>

                    <ul className="space-y-2 text-xs text-slate-700 pt-3 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Central Head Office & Multi-Branch Network
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Centralized Supply Chain & Inter-Branch Transfers
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Director Analytics & Enterprise Accounting
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> 1-Click Connection for Branch POS Terminals
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-teal-700 flex items-center gap-1.5">
                    <Network className="w-3.5 h-3.5" /> Multi-Station & Enterprise Ready
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Plan Selection (Starter, Standard, Professional) */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="text-center md:text-left space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Choose Your Plan Edition</h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-800">
                    {systemType === 'POS_ERP' ? 'POS + ERP Editions' : 'POS Only Editions'}
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  {systemType === 'POS_ERP'
                    ? 'Select the edition that fits your business scale and operational requirements.'
                    : 'Select the terminal capacity that fits your single-location restaurant.'}
                </p>
              </div>

              {/* POS + ERP Plans */}
              {systemType === 'POS_ERP' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {POS_ERP_PLANS.map((plan) => {
                      const isActive = selectedPlan === plan.key;
                      return (
                        <div
                          key={plan.key}
                          onClick={() => setSelectedPlan(plan.key)}
                          className={`relative p-6 md:p-7 min-h-[22rem] rounded-2xl border-2 cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                            isActive
                              ? 'border-teal-500 bg-teal-50/50 shadow-md ring-1 ring-teal-500/40'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="space-y-4">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xl font-extrabold text-slate-900">{plan.label}</span>
                              {plan.badge && (
                                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-700 border border-teal-200">
                                  {plan.badge}
                                </span>
                              )}
                              {isActive && (
                                <CheckCircle2 className="w-5 h-5 fill-teal-500 text-white shrink-0" />
                              )}
                            </div>

                            <p className="text-sm text-slate-500 leading-snug">{plan.description}</p>

                            <div className="pt-3 border-t border-slate-200 space-y-2.5">
                              {plan.features.map((feat, fidx) => (
                                <div key={fidx} className="text-sm text-slate-700 flex items-start gap-1.5">
                                  <span className="leading-snug">{feat}</span>
                                </div>
                              ))}
                            </div>
                          </div>


                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* POS Only Plans */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {POS_ONLY_PLANS.map((plan) => {
                    const isActive = selectedPlan === plan.key;
                    return (
                      <div
                        key={plan.key}
                        onClick={() => {
                          setSelectedPlan(plan.key);
                          setAllowedCounters(plan.counters);
                          setAllowedOrderTabs(plan.tablets);
                        }}
                        className={`relative p-6 md:p-7 min-h-[22rem] rounded-2xl border-2 cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                          isActive
                            ? 'border-teal-500 bg-teal-50/50 shadow-md ring-1 ring-teal-500/40'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xl font-extrabold text-slate-900">{plan.label}</span>
                            {plan.badge && (
                              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-700 border border-teal-200">
                                {plan.badge}
                              </span>
                            )}
                            {isActive && (
                              <CheckCircle2 className="w-5 h-5 fill-teal-500 text-white shrink-0" />
                            )}
                          </div>

                          <p className="text-sm text-slate-500 leading-snug">{plan.description}</p>

                          <div className="grid grid-cols-2 gap-3 py-2">
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Counters</span>
                              <span className="text-xl font-black text-slate-900">{plan.counters}</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Tablets</span>
                              <span className="text-xl font-black text-slate-900">{plan.tablets}</span>
                            </div>
                          </div>

                          <div className="pt-3 border-t border-slate-200 space-y-2.5">
                            {plan.features.map((feat, fidx) => (
                              <div key={fidx} className="text-sm text-slate-700 flex items-center gap-1.5">
                                <span className="text-teal-600 font-bold">✓</span> {feat}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mt-5 pt-3 border-t border-slate-100 text-xs text-teal-700 font-semibold">
                          Single Outlet • Instant Deploy
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 3 (for POS + ERP only): Station Role (Install ERP vs Install POS) */}
          {step === 3 && systemType === 'POS_ERP' && (
            <div className="space-y-6">
              <div className="text-center md:text-left space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">What are you setting up on this PC?</h2>
                <p className="text-sm text-slate-500">
                  Choose whether this computer will act as the Central Head Office (ERP Server) or a Branch Counter POS.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 1. Install ERP (HQ Server) */}
                <div
                  onClick={() => setErpRole('ERP_SERVER')}
                  className={`relative p-5 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                    erpRole === 'ERP_SERVER'
                      ? 'border-teal-500 bg-teal-50/60 shadow-lg shadow-teal-500/10 ring-1 ring-teal-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-11 h-11 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 shrink-0">
                        <Server className="w-5 h-5" />
                        {erpRole === 'ERP_SERVER' && (
                          <span className="absolute -top-1.5 -right-1.5 drop-shadow">
                            <CheckCircle2 className="w-4 h-4 fill-teal-500 text-white" />
                          </span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Install ERP (Head Office Server)</h3>
                        <p className="text-[11px] text-teal-600 font-semibold">Master Hub & Central Database</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600">
                      This machine runs the Central ERP: Accounting, Menu Engineering, Central Inventory, and Branch Setup.
                    </p>

                    <ul className="space-y-1.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Creates the Master Business & Initial Outlets
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Generates Connection Credentials for Branch POS
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-teal-700">
                    Recommended for your main office or primary server PC
                  </div>
                </div>

                {/* 2. Install POS (Branch / Counter Terminal) */}
                <div
                  onClick={() => setErpRole('POS_TERMINAL')}
                  className={`relative p-5 rounded-2xl border-2 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                    erpRole === 'POS_TERMINAL'
                      ? 'border-sky-500 bg-sky-50/60 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-11 h-11 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
                        <Monitor className="w-5 h-5" />
                        {erpRole === 'POS_TERMINAL' && (
                          <span className="absolute -top-1.5 -right-1.5 drop-shadow">
                            <CheckCircle2 className="w-4 h-4 fill-sky-500 text-white" />
                          </span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Install POS (Connect to ERP)</h3>
                        <p className="text-[11px] text-sky-600 font-semibold">Branch Counter / Till Terminal</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600">
                      This machine sits at an outlet counter and communicates with the ERP server (on this PC or over network).
                    </p>

                    <ul className="space-y-1.5 text-xs text-slate-700 pt-2 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-sky-600 font-bold">✓</span> Quick connection on Same PC or Remote Cloud
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-sky-600 font-bold">✓</span> Orders & stock sync automatically with HQ
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-sky-700">
                    Connects to existing ERP in seconds
                  </div>
                </div>
              </div>

              {/* If "Install POS" is selected: show Topology connection box */}
              {erpRole === 'POS_TERMINAL' && (
                <div className="p-5 rounded-2xl bg-white border border-sky-300 space-y-4 shadow-sm">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Network className="w-4 h-4 text-sky-600" /> Where is your ERP located?
                    </h3>
                    <p className="text-xs text-slate-500">
                      Select whether ERP is running on this same machine or on a different server/cloud.
                    </p>
                  </div>

                  {/* Topology Toggle */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setServerTopology('SAME_SERVER');
                        setApiUrl('http://localhost:5288');
                      }}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        serverTopology === 'SAME_SERVER'
                          ? 'border-sky-500 bg-sky-50 text-slate-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Same Computer / Localhost</span>
                        {serverTopology === 'SAME_SERVER' && <CheckCircle2 className="w-4 h-4 text-sky-600" />}
                      </div>
                      <span className="text-[11px] text-slate-500 block mt-1 font-normal">
                        ERP & POS run together on this same PC (connects to localhost:5288).
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setServerTopology('DIFFERENT_SERVER')}
                      className={`p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                        serverTopology === 'DIFFERENT_SERVER'
                          ? 'border-sky-500 bg-sky-50 text-slate-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Different Server / Cloud</span>
                        {serverTopology === 'DIFFERENT_SERVER' && <CheckCircle2 className="w-4 h-4 text-sky-600" />}
                      </div>
                      <span className="text-[11px] text-slate-500 block mt-1 font-normal">
                        ERP runs on a separate office PC or Cloud server over LAN/Internet.
                      </span>
                    </button>
                  </div>

                  {/* Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 items-end">
                    <div className="md:col-span-6 space-y-1">
                      <label className="text-xs font-semibold text-slate-600">HQ / ERP Server URL</label>
                      <input 
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="http://localhost:5288"
                        disabled={serverTopology === 'SAME_SERVER'}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60"
                      />
                    </div>

                    <div className="md:col-span-6 space-y-1">
                      <label className="text-xs font-semibold text-slate-600">Branch Pairing Code (Optional)</label>
                      <input 
                        type="text"
                        value={pairingInputToken}
                        onChange={(e) => setPairingInputToken(e.target.value)}
                        placeholder="e.g. RG-DT-8912"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono font-bold tracking-wider uppercase focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      disabled={isPairing}
                      onClick={handlePairWithToken}
                      className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 disabled:opacity-50 transition cursor-pointer"
                    >
                      {isPairing ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Connecting to ERP...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 fill-white" /> Connect & Launch POS Terminal
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4 for POS_ERP / STEP 3 for POS_ONLY: Business Profile & Branches */}
          {((step === 4 && systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') || (step === 3 && systemType === 'POS_ONLY')) && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {systemType === 'POS_ERP' ? 'Head Office & Outlets Setup' : 'Restaurant & Store Profile'}
                </h2>
                <p className="text-sm text-slate-500">
                  {systemType === 'POS_ERP'
                    ? 'Configure your Central Head Office and add your initial selling branch outlets (Unlimited!).'
                    : 'Enter your restaurant details, currency, and single store location.'}
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-teal-600" /> Restaurant / Brand Name*
                    </label>
                    <input 
                      type="text" 
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      placeholder="e.g. Royal Grill & Kitchen"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <UtensilsCrossed className="w-3.5 h-3.5 text-teal-600" /> Business Type
                    </label>
                    <select 
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value as BusinessType)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    >
                      <option value="Restaurant">Restaurant / Café / Dine-in</option>
                      <option value="Retail">Retail Store</option>
                      <option value="CashAndCarry">Cash & Carry / Mart</option>
                      <option value="Hybrid">Hybrid Food & Retail</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-teal-600" /> Country & Currency
                    </label>
                    <select 
                      value={countryCode}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.currencyCode})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-teal-600" /> Primary City
                    </label>
                    <input 
                      type="text" 
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Islamabad"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-teal-600" /> Address / Main Area
                    </label>
                    <input 
                      type="text" 
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="e.g. Sector F-7 Markaz"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-teal-600" /> Official Phone / UAN
                    </label>
                    <input 
                      type="text" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 051-111-443-443"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                </div>

                {/* If POS Only: Single Outlet Name */}
                {systemType === 'POS_ONLY' && (
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-teal-600" /> Outlet Branch Name
                    </label>
                    <input
                      type="text"
                      value={mainBranchName}
                      onChange={(e) => setMainBranchName(e.target.value)}
                      placeholder="e.g. Main Dining Branch"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>
                )}

                {/* If POS + ERP: Head Office + Initial Outlets */}
                {systemType === 'POS_ERP' && (
                  <div className="pt-3 border-t border-slate-200 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-teal-600" /> Central Head Office / Back Office Name*
                      </label>
                      <input
                        type="text"
                        value={hqName}
                        onChange={(e) => setHqName(e.target.value)}
                        placeholder="e.g. Royal Grill Head Office & Central Commissary"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                      />
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={hqHoldsStock}
                          onChange={(e) => setHqHoldsStock(e.target.checked)}
                          className="w-4 h-4 accent-teal-500"
                        />
                        The head office keeps central stock (a central warehouse or kitchen that supplies the branches)
                      </label>
                    </div>

                    {/* Initial Outlets Table */}
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            <Store className="w-3.5 h-3.5 text-teal-600" /> Selling Branch Outlets
                          </h4>
                          <p className="text-[11px] text-slate-500">Configure your initial branch locations.</p>
                        </div>
                        <button 
                          type="button"
                          onClick={addBranchRow}
                          className="px-3 py-1.5 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Another Branch
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                        {branches.map((b, idx) => (
                          <div key={idx} className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                            <div className="flex items-center justify-between pb-1 border-b border-slate-200/60">
                              <span className="text-xs font-bold text-teal-700">Branch #{idx + 1}</span>
                              <button
                                type="button"
                                disabled={branches.length <= 1}
                                onClick={() => removeBranchRow(idx)}
                                className="text-slate-400 hover:text-rose-500 disabled:opacity-30 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-500 font-semibold">Name</label>
                                <input
                                  type="text"
                                  value={b.name}
                                  onChange={(e) => updateBranchField(idx, 'name', e.target.value)}
                                  placeholder="e.g. Downtown Outlet"
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-semibold">Code</label>
                                <input
                                  type="text"
                                  value={b.code}
                                  onChange={(e) => updateBranchField(idx, 'code', e.target.value)}
                                  placeholder="BR-01"
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 uppercase"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-semibold">City</label>
                                <input
                                  type="text"
                                  value={b.city}
                                  onChange={(e) => updateBranchField(idx, 'city', e.target.value)}
                                  placeholder="e.g. Islamabad"
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-semibold">Address</label>
                                <input
                                  type="text"
                                  value={b.address}
                                  onChange={(e) => updateBranchField(idx, 'address', e.target.value)}
                                  placeholder="e.g. Main Blvd"
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5 for POS_ERP / STEP 4 for POS_ONLY: Admin Security Credentials */}
          {((step === 5 && systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') || (step === 4 && systemType === 'POS_ONLY')) && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Master Admin Account</h2>
                <p className="text-sm text-slate-500">Create the primary owner/admin credentials with full permissions.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-teal-600" /> Full Name*
                    </label>
                    <input 
                      type="text" 
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      placeholder="e.g. Muhammad Ali"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-teal-600" /> Admin Username*
                    </label>
                    <input 
                      type="text" 
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-teal-600" /> Master PIN (4-6 Digits)*
                    </label>
                    <input 
                      type="password" 
                      maxLength={6}
                      value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value)}
                      placeholder="1234"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  {signupMode && (
                    <div className="space-y-1.5 md:col-span-3">
                      <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-teal-600" /> Email Address*
                      </label>
                      <input 
                        type="email" 
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="owner@example.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-2">
                  <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-teal-600" /> Master Permissions Included:
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-slate-700">
                    <span className="flex items-center gap-1.5 text-teal-600">✓ Full Financial Reports</span>
                    <span className="flex items-center gap-1.5 text-teal-600">✓ Menu & Tax Adjustments</span>
                    <span className="flex items-center gap-1.5 text-teal-600">✓ Inventory Management</span>
                    <span className="flex items-center gap-1.5 text-teal-600">✓ User & Role Management</span>
                    <span className="flex items-center gap-1.5 text-teal-600">✓ Central Transfers & POs</span>
                    <span className="flex items-center gap-1.5 text-teal-600">✓ Device Activation Codes</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FINAL STEP: Review & Deploy */}
          {((step === 6 && systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') || (step === 5 && systemType === 'POS_ONLY')) && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Review & Deploy</h2>
                <p className="text-sm text-slate-500">Please review your setup before initializing the system.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Architecture Mode</span>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      {systemType === 'POS_ERP' ? (
                        <span className="text-teal-700 flex items-center gap-1.5">
                          <Building2 className="w-4 h-4" /> POS + ERP (Head Office Server)
                        </span>
                      ) : (
                        <span className="text-teal-700 flex items-center gap-1.5">
                          <Store className="w-4 h-4" /> POS Only (Standalone Counter)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Selected Plan Edition</span>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span className="text-teal-700">{selectedPlan} Edition</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Brand & Locations</span>
                    <div className="text-xs text-slate-700">
                      <strong>{restaurantName}</strong> ({currency})
                      <div className="mt-1 text-slate-500">
                        {systemType === 'POS_ERP' ? (
                          <span>HQ: {hqName} + {branches.length} Outlets ({branches.map(b => b.name).join(', ')})</span>
                        ) : (
                          <span>1 Outlet: {mainBranchName} ({city})</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Master Admin Account</span>
                    <div className="text-xs text-slate-700">
                      Username: <span className="text-teal-700 font-mono font-bold">{adminUsername}</span> ({adminFullName})
                      {signupMode && adminEmail && <div className="text-slate-500">{adminEmail}</div>}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-xs flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>
                    Everything looks ready. Click <strong>{signupMode ? 'Create Business Account' : 'Complete Setup & Launch'}</strong> to initialize your database and launch Cashly.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-6 md:px-10 py-4">
        <div className={`${step === 2 ? 'max-w-6xl' : 'max-w-4xl'} w-full mx-auto flex items-center justify-between gap-4`}>
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-2 transition cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : <div />}

          <span className="hidden lg:inline text-[11px] text-slate-400">
            Cashly POS v3.0 • Local-First Offline & Multi-Branch Cloud Architecture
          </span>

          {step < maxSteps ? (
            // If on Station Role and chose to pair POS terminal, the pair button is inside the box
            step === 3 && systemType === 'POS_ERP' && erpRole === 'POS_TERMINAL' ? (
              <div />
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-teal-500/20 transition cursor-pointer"
              >
                Next Step <ArrowRight className="w-4 h-4" />
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={handleCompleteSetup}
              className="px-8 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-extrabold text-sm flex items-center gap-2 shadow-xl shadow-teal-500/20 disabled:opacity-50 transition cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {signupMode ? 'Creating Account…' : 'Initializing System...'}
                </>
              ) : signupMode ? (
                <>
                  <Sparkles className="w-4 h-4 fill-white" /> Create Business Account
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 fill-white" /> Complete Setup & Launch
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

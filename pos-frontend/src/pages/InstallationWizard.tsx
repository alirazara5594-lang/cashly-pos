import React, { useEffect, useRef, useState } from 'react';
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
  User, 
  Monitor, 
  Mail, 
  Server, 
  Network, 
  Copy,
  Check,
  KeyRound,
  Globe,
  AlertCircle,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  ShoppingBag,
  ShoppingCart,
  X
} from 'lucide-react';
import { restaurantLinkParts, restaurantSignInLink, suggestWebName, webNameProblem } from '../services/restaurantAddress';
import { posApi, setApiBaseUrl, getApiErrorMessage } from '../services/api';
import { COUNTRIES, getCountryByCode } from '../data/countries';
import { usePosStore } from '../store/posStore';
import { activate as activateDevice, getStoredTerminal } from '../services/deviceLicense';
import { tierLabel } from '../utils/tierLabel';
import type { 
  BusinessType, 
  DeploymentMode, 
  BranchInitPayload, 
  BusinessStructure, 
  CatalogControl, 
  PurchasingControl,
  InstallationSystemType,
  ErpDeploymentRole,
  PosServerTopology,
  PublicPackage,
  SubscriptionTier
} from '../types';

// The first two steps carry the choices the whole rest of the wizard hangs off: what this business
// is (one outlet, or a head office over outlets), then which version it runs on. Version used to be
// asked later and only for a single outlet, which left a chain with no say at all and the head
// office silently pinned to one edition.
//
// The install step exists for one question only: what THIS PC is — the head office ERP, or a till
// connecting to one. A cloud registration skips it, because registering always creates the
// business and a till joins one at /connect instead. Outlets keep their own version, chosen per
// branch by head office on the HQ & Outlets step.
//
// The business itself and its locations are two short steps rather than one long one: who the
// business is (name, type, country, web address), then where it is (the outlet, or the head
// office and its outlets).
const VERSION_STEP = 2;
const INSTALL_STEP = 3;
const BUSINESS_STEP = 4;
const LOCATIONS_STEP = 5;
const SECURITY_STEP = 6;
const REVIEW_STEP = 7;

const POS_EDITIONS: SubscriptionTier[] = ['Starter', 'Standard', 'Professional'];

/**
 * The kinds of business a registration offers. Each carries the sector pack it signs up with
 * (Data/VerticalPacks.cs) — the same one the server would derive from the type — except a
 * pharmacy: a retail business on the Pharmacy pack (batch and expiry tracking). Only a
 * registration can carry a pack, so the pharmacy is not offered to a local install.
 */
const BUSINESS_TYPES: { id: string; type: BusinessType; pack: string; label: string; hint: string; icon: typeof Store; registrationOnly?: boolean }[] = [
  { id: 'restaurant', type: 'Restaurant', pack: 'restaurant', label: 'Restaurant / café', hint: 'Dine-in, takeaway, delivery', icon: UtensilsCrossed },
  { id: 'retail', type: 'Retail', pack: 'retail', label: 'Retail store', hint: 'Shops and boutiques', icon: ShoppingBag },
  { id: 'pharmacy', type: 'Retail', pack: 'pharmacy', label: 'Pharmacy / medical store', hint: 'Medicines, batch & expiry', icon: Pill, registrationOnly: true },
  { id: 'grocery', type: 'CashAndCarry', pack: 'grocery', label: 'Cash & carry / mart', hint: 'Grocery and wholesale', icon: ShoppingCart },
  { id: 'hybrid', type: 'Hybrid', pack: 'restaurant', label: 'Food & retail', hint: 'A café with a shop', icon: Store }
];

// One look for every field on the form steps.
const inputCls = 'w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed';
const labelCls = 'flex items-center justify-between gap-2 text-[13px] font-semibold text-slate-700 mb-1.5';
const optionalTag = <span className="text-xs font-medium text-slate-400">Optional</span>;

/** All one digit (0000) or a straight run up or down (1234, 654321). */
const isEasyPin = (pin: string) => {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = pin.split('').map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every(s => s === 1) || steps.every(s => s === -1);
};

export const InstallationWizard: React.FC<{ forceSignup?: boolean }> = ({ forceSignup = false }) => {
  const navigate = useNavigate();
  const { setTenants, setDeploymentMode, setIsInstalled } = usePosStore();

  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  // Creating the business is the one step here that cannot be undone from the app, so the final
  // button asks first instead of creating straight away.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Registration vs Install mode
  const [signupMode, setSignupMode] = useState<boolean>(forceSignup);
  const [signupSuccess, setSignupSuccess] = useState<{ 
    restaurantName: string; 
    username: string; 
    pin: string; 
    serverUrl?: string;
    systemType: InstallationSystemType;
    erpRole?: ErpDeploymentRole;
    /** The restaurant's own sign-in address name (registration only). */
    webName?: string;
    /** A "confirm your email" link went out (registration, when email is set up). */
    confirmationEmailSent?: boolean;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Each step opens at its top, and a problem scrolls into view rather than sitting above the fold.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [step]);

  // 1. Primary System Choice: POS Only vs POS + ERP
  const [systemType, setSystemType] = useState<InstallationSystemType>('POS_ERP');

  // 2. Selected Plan: Starter, Standard, Professional (shown as Enterprise)
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Standard' | 'Professional'>('Standard');

  // 3. For POS + ERP: Install ERP Server (HQ) vs Install POS Terminal (Connect)
  const [erpRole, setErpRole] = useState<ErpDeploymentRole>('ERP_SERVER');

  // 4. Connection Topology for POS Terminal: Same Server vs Different Server
  const [serverTopology, setServerTopology] = useState<PosServerTopology>('SAME_SERVER');
  const [pairingInputToken, setPairingInputToken] = useState('');
  const [isPairing, setIsPairing] = useState(false);

  // Form State. A public registration starts blank (the placeholders show examples): sample values
  // left in place would register a fake business, and the second visitor to keep them hits a name
  // that is already taken.
  const [restaurantName, setRestaurantName] = useState(forceSignup ? '' : 'Royal Grill & Kitchen');
  // Which kind of business (BUSINESS_TYPES): its type and its sector pack follow from it.
  const [businessKind, setBusinessKind] = useState('restaurant');
  const kind = BUSINESS_TYPES.find(k => k.id === businessKind) ?? BUSINESS_TYPES[0];
  const businessType: BusinessType = kind.type;
  const [currency, setCurrency] = useState('PKR');
  const [countryCode, setCountryCode] = useState('PK');
  const [city, setCity] = useState(forceSignup ? '' : 'Islamabad');
  const [address, setAddress] = useState(forceSignup ? '' : 'Sector F-7 Markaz');
  const [phone, setPhone] = useState(forceSignup ? '' : '051-1234567');

  // Single Branch Settings (POS Only)
  // Named after the business until the owner types their own.
  const [mainBranchInput, setMainBranchInput] = useState('');
  const [mainBranchEdited, setMainBranchEdited] = useState(false);
  const mainBranchName = mainBranchEdited
    ? mainBranchInput
    : (restaurantName.trim() ? `${restaurantName.trim()} — Main Branch` : '');

  // HQ & Branches (POS + ERP)
  // Named after the business ("Royal Grill Head Office") until the owner types their own.
  const [hqNameInput, setHqNameInput] = useState('');
  const [hqNameEdited, setHqNameEdited] = useState(false);
  const hqName = hqNameEdited
    ? hqNameInput
    : (restaurantName.trim() ? `${restaurantName.trim()} Head Office` : '');
  const [hqHoldsStock, setHqHoldsStock] = useState(true);
  // Rarely-changed head office settings stay out of the way until asked for.
  const [showHqOptions, setShowHqOptions] = useState(false);
  // A head office with no outlets yet is allowed, but worth one question before going on.
  const [noOutletHint, setNoOutletHint] = useState(false);
  const [outletsSkipped, setOutletsSkipped] = useState(false);
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

  // Initial branches: optional. Starts empty so no demo branches get created by accident; the
  // owner can add branches here or at any time later from Locations & Head Office.
  const [branches, setBranches] = useState<BranchInitPayload[]>([]);

  // Admin Account. Never a default username or PIN on a registration: admin / 1234 kept by a
  // visitor is an account anyone can guess.
  const [adminFullName, setAdminFullName] = useState(forceSignup ? '' : 'Restaurant Owner');
  const [adminUsername, setAdminUsername] = useState(forceSignup ? '' : 'admin');
  const [adminPin, setAdminPin] = useState(forceSignup ? '' : '1234');
  const [adminEmail, setAdminEmail] = useState('');
  // Back-office sign-in for a new registration (email + password); the PIN is for the tills.
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  // The owner's own mobile (registration only): one free trial per number, checked for
  // uniqueness by the server — no code to type.
  const [ownerMobile, setOwnerMobile] = useState('');
  // Start with the sample menu? Null until the owner decides: then food businesses get it.
  const [sampleMenuChoice, setSampleMenuChoice] = useState<boolean | null>(null);
  const wantsSampleMenu = sampleMenuChoice ?? (businessType === 'Restaurant' || businessType === 'Hybrid');

  // The restaurant's own sign-in address (/r/<name> now, <name>.<domain> later): suggested from the
  // restaurant's name until the owner edits it, and checked with the server as they type.
  const [webNameInput, setWebNameInput] = useState('');
  const [webNameEdited, setWebNameEdited] = useState(false);
  const webName = webNameEdited ? webNameInput : suggestWebName(restaurantName);
  const [webCheck, setWebCheck] = useState<{ name: string; available: boolean; problem: string | null; alternative: string | null } | null>(null);
  // The name whose check got no answer from the server, so the page says so instead of "Checking…" forever.
  const [webCheckFailedFor, setWebCheckFailedFor] = useState<string | null>(null);
  const checkWebNameNow = (name: string, isCancelled: () => boolean = () => false) =>
    posApi.checkWebName(name)
      .then(r => { if (!isCancelled()) { setWebCheck(r); setWebCheckFailedFor(null); } })
      .catch(() => { if (!isCancelled()) setWebCheckFailedFor(name); });
  useEffect(() => {
    if (!signupMode || webNameProblem(webName)) return;
    let cancelled = false;
    const timer = setTimeout(() => { checkWebNameNow(webName, () => cancelled); }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [webName, signupMode]);
  const webNameLocalProblem = webNameProblem(webName);
  const webCheckNow = webCheck && webCheck.name === webName ? webCheck : null;
  const webCheckFailed = !webCheckNow && webCheckFailedFor === webName;
  const webLinkParts = restaurantLinkParts();

  // Offline & Server Settings
  const enableOfflineDb = true;
  const [apiUrl, setApiUrl] = useState(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5288');
  const seedStarterMenu = true;

  // What each POS version really allows, as the server has it priced, so the cards and branch
  // pickers never promise a number the server would not honour.
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  useEffect(() => {
    let cancelled = false;
    posApi.getPublicPackages()
      .then(rows => { if (!cancelled) setPackages(Array.isArray(rows) ? rows : []); })
      .catch(() => { /* the cards fall back to their built-in figures */ });
    return () => { cancelled = true; };
  }, []);
  const packageFor = (key: string) => packages.find(p => p.packageKey.toLowerCase() === key.toLowerCase());
  // A head-office business pays the Head Office ERP once, then each outlet its version's
  // per-outlet price (Services/BillingService.cs) — so a registration shows that, never the
  // single-shop price.
  const [erpMonthly, setErpMonthly] = useState<number | null>(null);
  useEffect(() => {
    if (!signupMode) return;
    let cancelled = false;
    posApi.getPublicPlatformPrices()
      .then(rows => { if (!cancelled) setErpMonthly(rows.find(r => r.key === 'HEAD_OFFICE_ERP')?.monthlyPricePKR ?? null); })
      .catch(() => { /* the cards just leave the ERP price out */ });
    return () => { cancelled = true; };
  }, [signupMode]);
  const countText = (n: number | undefined, fallback: number) => {
    const value = n ?? fallback;
    return value >= 999 ? 'Unlimited' : String(value);
  };
  const money = (n: number | undefined) =>
    n == null ? null : `PKR ${Math.round(n).toLocaleString('en-US')}`;
  /** "1 till, 3 tablets" for a POS version. */
  const allowanceLine = (key: SubscriptionTier) => {
    const pkg = packageFor(key);
    const fallback = VERSIONS.find(p => p.key === key);
    const tills = countText(pkg?.maxCounters, fallback?.counters ?? 1);
    const tablets = countText(pkg?.maxOrderTabs, fallback?.tablets ?? 0);
    const kds = pkg ? pkg.hasKitchenDisplay : key !== 'Starter';
    return `${tills} till${tills === '1' ? '' : 's'}, ${tablets} tablet${tablets === '1' ? '' : 's'}${kds ? ', kitchen screens' : ''}`;
  };
  /** The same, for one outlet of a head office: what it gets, and what head office pays for it. */
  const outletLine = (edition: SubscriptionTier) => {
    const base = allowanceLine(edition);
    const pkg = packageFor(edition);
    return signupMode && pkg?.branchMonthlyPricePKR
      ? `${base} · ${money(pkg.branchMonthlyPricePKR)}/mo per outlet`
      : base;
  };

  // Set when a till connects to the head office: which branch it joined and that branch's version.
  const [connectedInfo, setConnectedInfo] = useState<{
    branchName?: string;
    terminalName?: string;
    posEdition?: string | null;
    posAllowance?: { counters: number | null; tablets: number | null; kitchenDisplay: boolean } | null;
  } | null>(null);

  // Detect configured server on mount
  useEffect(() => {
    if (forceSignup) return;
    let cancelled = false;
    posApi.getSetupStatus()
      .then((status) => {
        if (!cancelled && status?.isConfigured) {
          setSignupMode(true);
          // Registering always creates a business; a till joins one at /connect instead.
          setErpRole('ERP_SERVER');
          setAdminUsername('');
          setAdminPin('');
        }
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
    // Blank name so the owner types the real one; the code is generated if left empty. The new
    // outlet starts on the version picked on step 1. Its till/tablet ceilings are not sent: they
    // come from that version's package on the server, never from the wizard.
    setNoOutletHint(false);
    setBranches([
      ...branches,
      {
        name: '', code: '', city: city || '', address: '', phone: '',
        posEdition: selectedPlan,
        sameAddressAsHq: false
      }
    ]);
  };

  const removeBranchRow = (index: number) => {
    setBranches(branches.filter((_, i) => i !== index));
  };

  const updateBranchField = (index: number, field: keyof BranchInitPayload, val: any) => {
    const next = [...branches];
    next[index] = { ...next[index], [field]: val };
    setBranches(next);
  };

  // The three versions. The figures a customer is promised come from the server when it answers
  // (packageFor); these are only what the cards fall back to, and they are kept equal to the
  // catalogue's own ceilings so a fallback never promises more than a plan really grants.
  const VERSIONS = [
    {
      key: 'Starter' as const,
      label: 'Starter',
      counters: 1,
      tablets: 2,
      kitchenScreens: 0,
      badge: undefined,
      description: 'Ideal for single food stalls, small cafes, and takeout joints.',
      tagline: 'Small cafés, stalls & takeaways',
      features: ['Direct Receipt Printing', 'Daily Shift Cash Register', 'Waiter / Order Tablets']
    },
    {
      key: 'Standard' as const,
      label: 'Standard',
      counters: 3,
      tablets: 8,
      kitchenScreens: 2,
      badge: 'Most Popular',
      description: 'Full-service dine-in cafes and standalone busy restaurants.',
      tagline: 'Busy dine-in restaurants',
      features: ['Kitchen Display System (KDS)', 'Waiter Tablets & QR Tables', 'Floor & Table Layout Manager']
    },
    {
      key: 'Professional' as const,
      label: tierLabel('Professional'),
      counters: 8,
      tablets: 20,
      kitchenScreens: 999,
      badge: 'High Volume',
      description: 'High-speed fast food and multi-station large dining restaurants.',
      tagline: 'High volume, many kitchen stations',
      features: ['Multi-Kitchen Routing & KDS', 'Customer Khata & VIP Loyalty', 'Highest till & tablet capacity']
    }
  ];

  // What a version costs on step 1: a single shop pays the version's price, an outlet of a head
  // office its per-outlet price. Null when the server has no price to show.
  const versionPrice = (key: SubscriptionTier) => {
    const pkg = packageFor(key);
    if (!pkg) return null;
    const monthly = systemType === 'POS_ERP' ? pkg.branchMonthlyPricePKR ?? 0 : pkg.monthlyPricePKR;
    const yearly = systemType === 'POS_ERP' ? pkg.branchYearlyPricePKR ?? 0 : pkg.yearlyPricePKR;
    return monthly > 0 ? { monthly, yearly } : null;
  };
  const yearlySaving = (monthly: number, yearly: number) => {
    if (monthly <= 0 || yearly <= 0 || yearly >= monthly * 12) return null;
    const months = (monthly * 12 - yearly) / monthly;
    return Number.isInteger(months) ? `${months} month${months === 1 ? '' : 's'} free` : `save ${Math.round((1 - yearly / (monthly * 12)) * 100)}%`;
  };
  const cheapestSingleShop = Math.min(...VERSIONS.map(v => packageFor(v.key)?.monthlyPricePKR ?? Infinity).filter(n => n > 0));

  // What each version adds, read off the switches the server really has on for it, so a card
  // never promises a feature the plan would not grant. Without the server, the built-in list.
  const OUTLET_FEATURES: { flag: keyof PublicPackage; label: string }[] = [
    { flag: 'hasKitchenDisplay', label: 'Kitchen display (KDS)' },
    { flag: 'hasDeliveryCOD', label: 'Delivery & cash on delivery' },
    { flag: 'hasInventoryManagement', label: 'Inventory management' },
    { flag: 'hasAdvancedReports', label: 'Advanced reports' },
    { flag: 'hasWhatsAppMessaging', label: 'WhatsApp notifications' },
    { flag: 'hasDirectorDashboard', label: 'Executive dashboard' }
  ];
  const versionFeatures = (index: number): { lead?: string; items: string[] } => {
    const plan = VERSIONS[index];
    const pkg = packageFor(plan.key);
    if (!pkg) return { items: plan.features };
    const has = (p: PublicPackage | undefined, flag: keyof PublicPackage) => p?.[flag] === true;
    if (index === 0) {
      const items = ['Tills, receipts & cash shifts'];
      if ((pkg.maxOrderTabs ?? 0) > 0) items.push('Tables & waiter tablets');
      for (const f of OUTLET_FEATURES) if (has(pkg, f.flag)) items.push(f.label);
      return { items };
    }
    const previous = packageFor(VERSIONS[index - 1].key);
    const items = OUTLET_FEATURES.filter(f => has(pkg, f.flag) && !has(previous, f.flag)).map(f => f.label);
    if ((pkg.maxOrderTabs ?? 0) > 0 && (previous?.maxOrderTabs ?? 0) === 0) items.unshift('Tables & waiter tablets');
    // Then the room it adds, in plain words.
    const kitchen = pkg.maxKitchenDisplays ?? 0, previousKitchen = previous?.maxKitchenDisplays ?? 0;
    if (kitchen >= 999 && previousKitchen < 999) items.push('Unlimited kitchen screens');
    if (pkg.maxCounters > (previous?.maxCounters ?? 0) || pkg.maxOrderTabs > (previous?.maxOrderTabs ?? 0)) {
      const tills = countText(pkg.maxCounters, 1), tablets = countText(pkg.maxOrderTabs, 0);
      items.push(`Up to ${tills} till${tills === '1' ? '' : 's'} & ${tablets} tablet${tablets === '1' ? '' : 's'}${systemType === 'POS_ERP' ? ' per outlet' : ''}`);
    }
    if (items.length === 0) items.push('More tills, tablets and kitchen screens');
    return { lead: `Everything in ${VERSIONS[index - 1].label}, plus`, items };
  };

  // Pair POS Terminal with ERP
  const handlePairWithToken = async () => {
    setIsPairing(true);
    setErrorMessage(null);

    const targetUrl = serverTopology === 'SAME_SERVER' ? 'http://localhost:5288' : apiUrl.trim();

    try {
      setApiBaseUrl(targetUrl);

      // If code was provided, activate with token
      const status = pairingInputToken.trim() ? await activateDevice(pairingInputToken.trim()) : null;

      const terminal = getStoredTerminal();
      setDeploymentMode('MultiBranch');
      setIsInstalled(true);
      localStorage.setItem('cashly_is_installed', 'true');
      localStorage.setItem('cashly_deployment_mode', 'MultiBranch');
      localStorage.setItem(
        'cashly_terminal_mode',
        terminal?.type === 'OrderTab' ? 'WaiterTab' : terminal?.type === 'KitchenDisplay' ? 'KitchenKDS' : 'CounterPOS'
      );

      // Show which branch this till joined and the POS version head office gave that branch.
      if (status) {
        setConnectedInfo({
          branchName: status.branchName,
          terminalName: status.terminalName,
          posEdition: status.posEdition,
          posAllowance: status.posAllowance
        });
        return;
      }
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

  // A problem with a step: what is wrong and, when it is one field, which (its element id).
  type StepProblem = { text: string; field?: string };
  const [problem, setProblem] = useState<(StepProblem & { step: number }) | null>(null);

  /** Moves to a step, dropping the last step's problems with it. */
  const goToStep = (n: number) => {
    setProblem(null);
    setErrorMessage(null);
    setStep(n);
  };

  /** Shows a problem where it is: at its field (focused and scrolled to), or as a floating notice. */
  const showProblem = (found: StepProblem, at: number) => {
    if (at !== step) goToStep(at);
    setProblem({ ...found, step: at });
    if (!found.field) { setErrorMessage(found.text); return; }
    // After the step has rendered, so the field exists.
    setTimeout(() => {
      const el = document.getElementById(found.field!);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    }, 60);
  };

  // Step Validation
  const validateStep = (s: number): StepProblem | null => {
    // Setup type and version both default, so those steps are always valid
    if (s === 1 || s === VERSION_STEP) return null;

    // Install (local head office only): what this PC is, plus the address of the ERP it connects to
    if (s === INSTALL_STEP) {
      if (systemType === 'POS_ERP' && erpRole === 'POS_TERMINAL'
          && serverTopology === 'DIFFERENT_SERVER' && !apiUrl.trim()) {
        return { text: 'Head Office / ERP Server URL is required.' };
      }
      return null;
    }

    // The business: name and web address
    if (s === BUSINESS_STEP) {
      if (!restaurantName.trim()) return { text: 'Enter your business name.', field: 'wiz-business-name' };
      if (signupMode) {
        if (webNameLocalProblem) return { text: `Web address: ${webNameLocalProblem}`, field: 'wiz-web-name' };
        if (!webCheckNow) {
          // Ask again now, so pressing Continue a moment later can go through.
          checkWebNameNow(webName);
          return webCheckFailed
            ? { text: 'Could not check your web address: the Cashly server did not answer. Make sure it is running, then press Continue again.' }
            : { text: 'Still checking your web address — try again in a moment.', field: 'wiz-web-name' };
        }
        if (!webCheckNow.available) return { text: `Web address: ${webCheckNow.problem ?? 'already taken.'}`, field: 'wiz-web-name' };
      }
    }

    // Its locations: the outlet, or the head office and its outlets
    if (s === LOCATIONS_STEP) {
      if (systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') {
        if (!hqName.trim()) return { text: 'Enter a name for the head office.', field: 'wiz-location-name' };
        const unnamed = branches.findIndex(b => !b.name.trim());
        if (unnamed >= 0) return { text: 'Give this outlet a name, or remove it.', field: `wiz-outlet-${unnamed}-name` };
      } else if (systemType === 'POS_ONLY') {
        if (!mainBranchName.trim()) return { text: 'Enter a name for your outlet.', field: 'wiz-location-name' };
      }
    }

    // Security Step
    if (s === SECURITY_STEP) {
      // In the order the fields appear: about you, the back-office sign-in, then the till sign-in.
      if (!adminFullName.trim()) return { text: 'Enter your full name.', field: 'wiz-owner-name' };
      if (signupMode && ownerMobile.replace(/\D/g, '').length < 10) {
        return { text: 'Enter your mobile number, for example 0300 1234567.', field: 'wiz-owner-mobile' };
      }
      if (signupMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) {
        return { text: 'Enter a valid email address.', field: 'wiz-owner-email' };
      }
      if (signupMode) {
        if (adminPassword.length < 8 || !/[A-Za-z]/.test(adminPassword) || !/\d/.test(adminPassword)) {
          return { text: 'Use at least 8 characters, with letters and numbers.', field: 'wiz-owner-password' };
        }
        if (adminPassword !== adminPasswordConfirm) return { text: 'The two passwords do not match.', field: 'wiz-owner-password2' };
      }
      if (adminUsername.trim().length < 3) return { text: 'Use at least 3 characters.', field: 'wiz-owner-username' };
      if (!/^\d{4,6}$/.test(adminPin.trim())) return { text: 'Use 4 to 6 digits.', field: 'wiz-owner-pin' };
      if (signupMode && isEasyPin(adminPin.trim())) {
        return { text: 'Too easy to guess — avoid 1234, 0000 and the like.', field: 'wiz-owner-pin' };
      }
    }

    return null;
  };

  const maxSteps = REVIEW_STEP;

  // The steps this path walks through, in order. The install step is only "what is this PC", so
  // it exists for a local head-office install and nowhere else (see the note above BUSINESS_STEP).
  const stepOrder = systemType === 'POS_ERP' && !signupMode
    ? [1, VERSION_STEP, INSTALL_STEP, BUSINESS_STEP, LOCATIONS_STEP, SECURITY_STEP, REVIEW_STEP]
    : [1, VERSION_STEP, BUSINESS_STEP, LOCATIONS_STEP, SECURITY_STEP, REVIEW_STEP];
  const nextStepAfter = (s: number) => stepOrder.find(n => n > s) ?? s;
  const previousStepBefore = (s: number) => [...stepOrder].reverse().find(n => n < s) ?? 1;

  const handleNext = () => {
    const found = validateStep(step);
    if (found) {
      showProblem(found, step);
      return;
    }
    setErrorMessage(null);
    setProblem(null);
    // A head office with no outlets yet: ask once, rather than warn before they have started.
    if (step === LOCATIONS_STEP && systemType === 'POS_ERP' && !outletsSkipped && branches.every(b => !b.name.trim())) {
      setNoOutletHint(true);
      return;
    }
    goToStep(nextStepAfter(step));
  };

  /** "Continue without outlets": a head office alone is fine; outlets can be added later. */
  const continueWithoutOutlets = () => {
    setOutletsSkipped(true);
    setNoOutletHint(false);
    setBranches(branches.filter(b => b.name.trim()));
    goToStep(nextStepAfter(step));
  };

  /** A shop marked "same building as head office" takes the head office's city and address. */
  const branchAddress = (b: BranchInitPayload) => ({
    city: (b.sameAddressAsHq ? hqCity : b.city)?.trim() || undefined,
    address: (b.sameAddressAsHq ? hqAddress : b.address)?.trim() || undefined
  });

  /** The final button: check the step, then ask before anything is created. */
  const requestCompleteSetup = () => {
    // The stepper lets you jump between steps without validating, so re-check the Admin
    // Security step here too — a cleared verification must not reach Create.
    const securityProblem = signupMode ? validateStep(SECURITY_STEP) : null;
    if (securityProblem) { showProblem(securityProblem, SECURITY_STEP); return; }
    const stepProblem = validateStep(step);
    if (stepProblem) { showProblem(stepProblem, step); return; }
    setErrorMessage(null);
    setConfirmOpen(true);
  };

  const handleCompleteSetup = async () => {
    setConfirmOpen(false);
    const securityProblem = signupMode ? validateStep(SECURITY_STEP) : null;
    if (securityProblem) { showProblem(securityProblem, SECURITY_STEP); return; }
    const stepProblem = validateStep(step);
    if (stepProblem) { showProblem(stepProblem, step); return; }

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
          phone: phone.trim() || undefined,
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
        const created = await posApi.signup({
          restaurantName: restaurantName.trim(),
          contactName: adminFullName.trim(),
          email: adminEmail.trim(),
          phone: phone.trim(),
          city: city.trim() || undefined,
          address: address.trim() || undefined,
          country: country?.name,
          adminUsername: adminUsername.trim().toLowerCase(),
          adminPin: adminPin.trim(),
          adminPassword,
          webName,
          businessType,
          // Sent for every kind, not only a pharmacy: without it the server assumes a restaurant
          // for the starting tax settings, which a shop or a mart is not.
          verticalPack: kind.pack,
          // The version chosen on step 1 is the business's own. A head office runs the ERP on it
          // and every outlet inherits it as a default, overridable per outlet from here.
          packageKey: selectedPlan,
          deploymentMode: deploymentMode === 'MultiBranch' ? 'MultiBranch' : 'Standalone',
          businessStructure: structure,
          branches: isChain
            ? branches.filter(b => b.name.trim()).map(b => ({
                name: b.name.trim(),
                code: b.code?.trim() || undefined,
                ...branchAddress(b),
                phone: b.phone?.trim() || undefined,
                posEdition: b.posEdition ?? selectedPlan
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
          // A registration is never a till joining a head office (that is /connect).
          appSurface: isChain ? 'Erp' : 'Pos',
          ownerMobile: ownerMobile.trim(),
          seedSampleMenu: wantsSampleMenu
        });

        setSignupSuccess({
          restaurantName: restaurantName.trim(),
          username: adminUsername.trim().toLowerCase(),
          pin: adminPin.trim(),
          serverUrl: apiUrl || 'http://localhost:5288',
          systemType,
          erpRole: 'ERP_SERVER',
          webName,
          confirmationEmailSent: (created as { confirmationEmailSent?: boolean } | undefined)?.confirmationEmailSent === true
        });
        // The sign-in screen on this device fills in the new owner's email (and the restaurant, for
        // the username fallback).
        try {
          localStorage.setItem('cashly_login_email', adminEmail.trim().toLowerCase());
          localStorage.setItem('cashly_restaurant', restaurantName.trim());
        } catch { /* optional */ }
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
        adminFullName,
        adminUsername,
        adminPin,
        seedStarterMenu,
        // sameAddressAsHq is the wizard's own; undefined is left out of the request.
        branches: isChain
          ? branches.map(b => ({ ...b, ...branchAddress(b), sameAddressAsHq: undefined, posEdition: b.posEdition ?? selectedPlan }))
          : undefined,
        businessStructure: structure,
        company,
        headOffice,
        policies,
        setUpAccounting: bookAccounts,
        // Both paths send the version chosen on step 1: it is the tier the tenant is keyed to.
        selectedPlan,
        installationType: systemType,
        appSurface: isChain && erpRole === 'ERP_SERVER' ? 'Erp' : 'Pos'
      };

      await posApi.initializeSetup(payload);

      setDeploymentMode(deploymentMode);
      setIsInstalled(true);
      localStorage.setItem('cashly_is_installed', 'true');
      localStorage.setItem('cashly_restaurant', restaurantName.trim());
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

  // TILL CONNECTED: the branch this PC joined and the POS version head office gave that branch.
  // The till never chooses a version; it only reports the one it is running under.
  if (connectedInfo) {
    const allowance = connectedInfo.posAllowance;
    const unlimited = (n: number | null | undefined) => (n == null ? 'Unlimited' : String(n));
    return (
      <div className="h-screen bg-white text-slate-900 flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-lg text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-sky-100 flex items-center justify-center mx-auto">
            <Monitor className="w-8 h-8 text-sky-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">This till is connected</h1>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-900">{connectedInfo.terminalName || 'This device'}</span> now belongs to{' '}
              <span className="font-bold text-slate-900">{connectedInfo.branchName || 'its branch'}</span>.
            </p>
          </div>

          {connectedInfo.posEdition && (
            <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">POS version</span>
                <span className="text-sm font-bold text-teal-700">{tierLabel(connectedInfo.posEdition)}</span>
              </div>
              {allowance && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] uppercase font-semibold text-slate-400">Tills</div>
                    <div className="text-base font-semibold text-slate-900">{unlimited(allowance.counters)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] uppercase font-semibold text-slate-400">Tablets</div>
                    <div className="text-base font-semibold text-slate-900">{unlimited(allowance.tablets)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] uppercase font-semibold text-slate-400">Kitchen screens</div>
                    <div className="text-base font-semibold text-slate-900">{allowance.kitchenDisplay ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-400">
                Head office sets this branch's POS version. To change it, ask head office (Locations & Head Office).
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full py-3.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition shadow-lg shadow-teal-500/25 cursor-pointer flex items-center justify-center gap-2"
          >
            <Store className="w-4 h-4" /> Continue to staff sign-in
          </button>
        </div>
      </div>
    );
  }

  // SUCCESS SCREEN
  if (signupSuccess) {
    const isErp = signupSuccess.systemType === 'POS_ERP' && signupSuccess.erpRole === 'ERP_SERVER';
    const firstName = adminFullName.trim().split(/\s+/)[0];
    const signInLink = signupMode && signupSuccess.webName ? restaurantSignInLink(signupSuccess.webName) : null;
    const nextSteps = signupMode ? [
      'Sign in to the back office with your email and password.',
      wantsSampleMenu ? 'Try a sale with the sample menu, then add your own.' : 'Add your menu and prices.',
      isErp ? 'Connect each outlet’s tills with a pairing code from Locations.' : 'Connect your tills and tablets with a pairing code.'
    ] : [];
    const row = (term: string, value: React.ReactNode, last = false) => (
      <div className={`flex items-center justify-between gap-4 py-2.5 ${last ? '' : 'border-b border-slate-100'}`}>
        <span className="text-xs text-slate-500">{term}</span>
        <span className="text-sm text-slate-900 font-semibold text-right min-w-0 truncate">{value}</span>
      </div>
    );

    return (
      <div className="h-screen bg-slate-50 text-slate-900 overflow-y-auto selection:bg-teal-500 selection:text-white">
        <div className="min-h-full flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-xl space-y-5">
            <div className="text-center space-y-3">
              <span className="w-16 h-16 rounded-full bg-teal-600 flex items-center justify-center mx-auto shadow-lg shadow-teal-600/25 ring-8 ring-teal-600/10">
                <Check className="w-8 h-8 text-white stroke-[3]" />
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {signupMode ? `Welcome to Cashly${firstName ? `, ${firstName}` : ''}!` : isErp ? 'Your head office is ready' : 'You’re all set'}
              </h1>
              <p className="text-sm text-slate-600">
                <strong className="text-slate-900">{signupSuccess.restaurantName}</strong> is ready
                {signupMode ? ' — your 30-day free trial has started.' : '.'}
              </p>
              <p className="text-xs text-slate-500">
                {isErp ? 'Cashly POS + ERP · each outlet runs its own POS version' : `Cashly POS · ${tierLabel(selectedPlan)}`}
              </p>
            </div>

            {signupSuccess.confirmationEmailSent && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-white border border-slate-200">
                <Mail className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-600">
                  We sent a link to <strong className="text-slate-900">{adminEmail.trim().toLowerCase()}</strong>. Open it to confirm your email.
                </p>
              </div>
            )}

            {/* How the owner signs in. The PIN is never shown back — they typed it a moment ago. */}
            <div className="rounded-2xl bg-white border border-slate-200 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                <ShieldCheck className="w-4 h-4 text-teal-600" /> Your sign-in
              </div>
              {row('Business', signupSuccess.restaurantName)}
              {signupMode && adminEmail.trim() && row('Back office email', adminEmail.trim().toLowerCase())}
              {row('Username', <span className="font-mono">{signupSuccess.username}</span>)}
              {row('PIN', <span className="tracking-widest text-slate-400">••••</span>, true)}
              <p className="mt-3 text-xs text-slate-500">
                {signupMode
                  ? <>Back office: your <strong>email and password</strong>. At a till or tablet: your <strong>username and PIN</strong>.</>
                  : 'Sign in with your business name, username and the PIN you chose.'}
              </p>
            </div>

            {/* The business's own sign-in address: staff sign in there with just username + PIN, and
                tills are connected there with a pairing code. */}
            {signInLink && (
              <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Globe className="w-4 h-4 text-teal-600" /> Your staff sign-in address
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 pl-3.5 pr-1.5 py-1.5">
                  <span className="text-sm font-mono font-bold text-slate-800 flex-1 truncate">{signInLink.replace(/^https?:\/\//, '')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(signInLink).catch(() => {});
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                  >
                    {copiedLink ? <><Check className="w-3.5 h-3.5 text-teal-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Send it to your staff (WhatsApp is fine): they open it and sign in with their username and PIN.
                  Tills and tablets connect from the same address with <strong>Connect a till or tablet</strong>.
                </p>
              </div>
            )}

            {/* Head Office ERP installed on this machine: the server address its tills connect to. */}
            {isErp && !signupMode && (
              <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Network className="w-4 h-4 text-teal-600" /> Connect your outlets’ tills
                </div>
                <p className="text-xs text-slate-600">
                  On each till PC, install Cashly, choose <strong>Cashly POS + ERP → Install POS Terminal</strong>, and enter this server address:
                </p>
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 pl-3.5 pr-1.5 py-1.5">
                  <span className="text-sm font-mono font-bold text-slate-800 flex-1 truncate">{signupSuccess.serverUrl || 'http://localhost:5288'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(signupSuccess.serverUrl || 'http://localhost:5288').catch(() => {});
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                  >
                    {copiedUrl ? <><Check className="w-3.5 h-3.5 text-teal-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
              </div>
            )}

            {nextSteps.length > 0 && (
              <div className="rounded-2xl bg-white border border-slate-200 p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">What’s next</div>
                <ol className="space-y-2.5">
                  {nextSteps.map((text, i) => (
                    <li key={text} className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="w-6 h-6 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                      <span className="pt-0.5">{text}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                // A new owner signs in at the main sign-in, with the email they just registered (it is
                // filled in). The business's own address above is for their staff.
                navigate(signupMode ? '/' : isErp ? '/director' : '/', { replace: true });
              }}
              className="w-full py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm transition shadow-lg shadow-teal-600/20 cursor-pointer flex items-center justify-center gap-2"
            >
              {signupMode ? (
                // A new registration is not signed in yet; the next screen is the login.
                <><KeyRound className="w-4 h-4" /> Sign in to Cashly</>
              ) : isErp ? (
                <><Building2 className="w-4 h-4" /> Open the head office</>
              ) : (
                <><Store className="w-4 h-4" /> Open the POS</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1's two shapes of business. A registration shows what each costs, as it is billed.
  const setupTypes: {
    key: InstallationSystemType; icon: typeof Store; title: string; tagline: string; text: string;
    points: string[]; footIcon: typeof Store; foot: string; price: React.ReactNode;
  }[] = [
    {
      key: 'POS_ONLY', icon: Store, title: 'Cashly POS', tagline: 'For a single outlet',
      text: 'One restaurant, café or store with no separate head office. Tills, kitchen, stock and reports all run from the outlet, with the back office included.',
      points: ['Tills & instant bill printing', 'Tables & waiter tablets', 'Kitchen screens', 'Stock, cash shifts & reports'],
      footIcon: Sparkles, foot: 'Quick setup · back office included',
      price: signupMode && Number.isFinite(cheapestSingleShop)
        ? <>From <strong className="text-slate-900">{money(cheapestSingleShop)}</strong> a month</> : null
    },
    {
      key: 'POS_ERP', icon: Building2, title: 'Cashly POS + ERP', tagline: 'Head office + one or more outlets',
      text: 'The head office runs the ERP — menu, buying, stock, accounts and reports — and each outlet runs the POS. For one outlet with a head office, a chain, or a central kitchen.',
      points: ['One head office for all your branches', 'Central buying & stock transfers', 'Group reports & accounting', "Connect each branch's tills with a code"],
      footIcon: Network, foot: 'ERP at head office · POS at every outlet',
      price: signupMode && erpMonthly != null
        ? <><strong className="text-slate-900">{money(erpMonthly)}</strong> a month + each outlet</> : null
    }
  ];
  // What the chosen setup and version cost after the trial, for the review step.
  const selectedVersionPrice = versionPrice(selectedPlan);
  const stepOneCost = !signupMode || !selectedVersionPrice ? null
    : systemType === 'POS_ERP'
      ? `${erpMonthly != null ? `${money(erpMonthly)} + ` : ''}${money(selectedVersionPrice.monthly)} per outlet a month after the free trial`
      : `${money(selectedVersionPrice.monthly)} a month after the free trial`;

  // The Version step on a wide screen: one table, a column per version and a row per figure, so
  // every difference fits on one screen. It needs the server's figures; without them the cards stand in.
  const comparable = VERSIONS.every(v => packageFor(v.key));
  const yes = (
    <span className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center" aria-label="Included">
      <Check className="w-3 h-3 text-teal-700 stroke-[3]" />
    </span>
  );
  const no = <span className="text-slate-300 font-normal" aria-label="Not included">—</span>;
  const perOutlet = systemType === 'POS_ERP' ? ' per outlet' : '';
  const compareGroups: { title: string; rows: { label: string; value: (p: PublicPackage) => React.ReactNode }[] }[] = [
    {
      title: 'Allowance',
      rows: [
        { label: `Tills${perOutlet}`, value: p => countText(p.maxCounters, 1) },
        { label: `Waiter tablets${perOutlet}`, value: p => ((p.maxOrderTabs ?? 0) === 0 ? no : countText(p.maxOrderTabs, 0)) },
        {
          // Screens need the kitchen display switch as well as a count; without either they are an add-on.
          label: `Kitchen screens${perOutlet}`,
          value: p => (!p.hasKitchenDisplay || (p.maxKitchenDisplays ?? 0) === 0
            ? <span className="text-xs font-semibold text-slate-500">Add-on</span>
            : countText(p.maxKitchenDisplays, 0))
        },
        { label: 'Staff logins', value: p => countText(p.maxUsers, 1) },
        // A head office's messages come from the ERP, not the outlets' version.
        ...(systemType === 'POS_ONLY'
          ? [{
              label: 'WhatsApp messages a month',
              value: (p: PublicPackage) => (p.whatsAppMessagesPerMonth < 0 ? 'Unlimited' : p.whatsAppMessagesPerMonth === 0 ? no : p.whatsAppMessagesPerMonth.toLocaleString())
            }]
          : [])
      ]
    },
    {
      title: 'Features',
      rows: OUTLET_FEATURES
        .filter(feature => feature.flag !== 'hasKitchenDisplay')
        .map(feature => ({ label: feature.label, value: (p: PublicPackage) => (p[feature.flag] === true ? yes : no) }))
    }
  ];

  // A step's title block: the same on every form step.
  const stepHeader = (title: string, subtitle: React.ReactNode) => (
    <div className="space-y-1.5">
      <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">{title}</h2>
      <p className="text-[15px] text-slate-500 max-w-2xl">{subtitle}</p>
    </div>
  );
  // A field's problem, if the last check found one there: a red edge, and the reason beneath it.
  const fieldProblem = (id: string) => (problem && problem.step === step && problem.field === id ? problem.text : null);
  const problemEdge = (id: string) => (fieldProblem(id) ? ' border-rose-400! bg-rose-50/30' : '');
  const problemNote = (id: string) => {
    const text = fieldProblem(id);
    return text ? (
      <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {text}
      </p>
    ) : null;
  };

  // A section's name inside a card, with an optional note beside it.
  const groupLabel = (title: string, note?: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {note && <span className="text-xs text-slate-400">{note}</span>}
    </div>
  );

  // The password's strength against the rule the server holds it to (8+, letters and numbers).
  const passwordMeetsRule = adminPassword.length >= 8 && /[A-Za-z]/.test(adminPassword) && /\d/.test(adminPassword);
  const passwordStrong = passwordMeetsRule
    && (adminPassword.length >= 12 || /[^A-Za-z0-9]/.test(adminPassword) || (/[a-z]/.test(adminPassword) && /[A-Z]/.test(adminPassword)));
  const passwordStrength = !passwordMeetsRule
    ? { bars: 1, bar: 'bg-rose-500', text: 'text-rose-600', label: 'Needs 8+ letters & numbers' }
    : passwordStrong
      ? { bars: 3, bar: 'bg-teal-600', text: 'text-teal-700', label: 'Strong' }
      : { bars: 2, bar: 'bg-teal-500', text: 'text-teal-700', label: 'Good' };

  // The review step: every answer once, grouped the way the steps asked them.
  const namedOutlets = branches.filter(b => b.name.trim());
  const reviewSections: { title: string; icon: typeof Store; step: number; rows: [string, React.ReactNode][] }[] = [
    {
      title: 'Plan', icon: Sparkles, step: VERSION_STEP,
      rows: [
        ['Setup', systemType === 'POS_ERP' ? 'Cashly POS + ERP — head office & outlets' : 'Cashly POS — single outlet'],
        ['Version', `${tierLabel(selectedPlan)} · ${allowanceLine(selectedPlan)}`],
        ...(stepOneCost ? [['After the trial', stepOneCost.replace(' after the free trial', '')] as [string, React.ReactNode]] : [])
      ]
    },
    {
      title: 'Business', icon: Store, step: BUSINESS_STEP,
      rows: [
        ['Name', restaurantName.trim() || '—'],
        ['Type', kind.label],
        ['Country', `${getCountryByCode(countryCode)?.name ?? countryCode} · ${currency}`],
        ...(signupMode && webName
          ? [['Staff sign-in', restaurantSignInLink(webName).replace(/^https?:\/\//, '')] as [string, React.ReactNode]]
          : [])
      ]
    },
    {
      title: systemType === 'POS_ERP' ? 'Head office & outlets' : 'Outlet',
      icon: systemType === 'POS_ERP' ? Building2 : MapPin, step: LOCATIONS_STEP,
      rows: systemType === 'POS_ERP'
        ? [
            ['Head office', [hqName.trim(), city.trim()].filter(Boolean).join(' · ') || '—'],
            ['Outlets', namedOutlets.length === 0 ? 'None yet — add them any time from Locations' : (
              <ul className="space-y-1">
                {namedOutlets.map((b, i) => (
                  <li key={i}>
                    {b.name.trim()} <span className="text-slate-500 font-normal">· {tierLabel(b.posEdition ?? selectedPlan)}{b.sameAddressAsHq ? ' · same building as head office' : ''}</span>
                  </li>
                ))}
              </ul>
            )]
          ]
        : [
            ['Outlet', mainBranchName.trim() || '—'],
            ...((city.trim() || address.trim())
              ? [['Address', [address.trim(), city.trim()].filter(Boolean).join(', ')] as [string, React.ReactNode]]
              : [])
          ]
    },
    {
      title: 'Owner account', icon: User, step: SECURITY_STEP,
      rows: [
        ['Name', adminFullName.trim() || '—'],
        ...(signupMode
          ? [['Email', adminEmail.trim().toLowerCase() || '—'], ['Mobile', ownerMobile.trim() || '—']] as [string, React.ReactNode][]
          : []),
        ['Username', <span className="font-mono">{adminUsername.trim().toLowerCase() || '—'}</span>],
        ['PIN', <span className="tracking-widest text-slate-400">••••</span>]
      ]
    }
  ];

  // WIZARD STEPS DEFINITION
  const wizardSteps =(systemType === 'POS_ERP' && !signupMode
    ? [
        { num: 1, label: 'Setup Type' },
        { num: VERSION_STEP, label: 'Version' },
        { num: INSTALL_STEP, label: 'Install ERP or POS' },
        { num: BUSINESS_STEP, label: 'Business Details' },
        { num: LOCATIONS_STEP, label: 'HQ & Outlets' },
        { num: SECURITY_STEP, label: 'Admin Security' },
        { num: REVIEW_STEP, label: signupMode ? 'Review & Create' : 'Review & Deploy' }
      ]
    : [
        { num: 1, label: 'Setup Type' },
        { num: VERSION_STEP, label: 'Version' },
        { num: BUSINESS_STEP, label: 'Business Details' },
        { num: LOCATIONS_STEP, label: systemType === 'POS_ERP' ? 'HQ & Outlets' : 'Your Outlet' },
        { num: SECURITY_STEP, label: 'Admin Security' },
        { num: REVIEW_STEP, label: signupMode ? 'Review & Create' : 'Review & Deploy' }
      ]).filter(s => stepOrder.includes(s.num));
  // The Continue button names where it goes.
  const nextLabel = step < maxSteps ? wizardSteps.find(s => s.num === nextStepAfter(step))?.label : undefined;

  return (
    <div className="h-screen bg-white text-slate-900 flex flex-col selection:bg-teal-500 selection:text-white overflow-hidden [&_button:focus]:outline-none [&_button:focus-visible]:ring-4 [&_button:focus-visible]:ring-teal-500/25">
      {/* Top Banner */}
      <div className="shrink-0 border-b border-slate-200 bg-white backdrop-blur px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center shadow shadow-teal-500/20 shrink-0">
            <UtensilsCrossed className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          </div>
          <h1 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
            Cashly POS <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-600 font-semibold border border-teal-200">{signupMode ? 'Register' : 'Setup'}</span>
          </h1>
        </div>

        {/* On a phone the step bar below is hidden; this says where they are instead. */}
        <span className="lg:hidden text-xs font-semibold text-slate-500">
          Step {Math.max(1, wizardSteps.findIndex(s => s.num === step) + 1)} of {wizardSteps.length}
          {' · '}
          <span className="text-teal-700">{wizardSteps.find(s => s.num === step)?.label}</span>
        </span>
        {signupMode && (
          <button type="button" onClick={() => navigate('/')} className="hidden md:inline text-[13px] text-slate-500 hover:text-slate-700 cursor-pointer">
            Already have an account? <span className="font-bold text-teal-700">Sign in</span>
          </button>
        )}
      </div>

      {/* Step bar: its own row, so every step is named in full. A finished step can be clicked to go back to it. */}
      <nav aria-label="Registration steps" className="hidden lg:block shrink-0 border-b border-slate-200 bg-white px-6 py-3">
        <ol className="max-w-5xl mx-auto flex items-center">
          {wizardSteps.map((s, position) => {
            const done = step > s.num;
            const current = step === s.num;
            return (
              <li key={s.num} className={`flex items-center ${position < wizardSteps.length - 1 ? 'flex-1' : ''}`}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => { setErrorMessage(null); goToStep(s.num); }}
                  aria-current={current ? 'step' : undefined}
                  className={`flex items-center gap-2 shrink-0 ${done ? 'cursor-pointer group' : 'cursor-default'}`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${
                    current ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-600/20'
                      : done ? 'bg-teal-50 border-teal-500 text-teal-700 group-hover:bg-teal-100'
                      : 'bg-white border-slate-300 text-slate-400'
                  }`}>
                    {done ? <Check className="w-3.5 h-3.5" /> : position + 1}
                  </span>
                  <span className={`text-[13px] whitespace-nowrap ${
                    current ? 'font-bold text-teal-700' : done ? 'font-semibold text-slate-700 group-hover:text-teal-700' : 'font-medium text-slate-400'
                  }`}>
                    {s.label}
                  </span>
                </button>
                {position < wizardSteps.length - 1 && (
                  <span className={`flex-1 h-0.5 mx-3 rounded-full ${done ? 'bg-teal-500' : 'bg-slate-200'}`} />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Main Content Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onInputCapture={(e) => { if (problem?.field && (e.target as HTMLElement).id === problem.field) setProblem(null); }}
      >
        {/* Step 1 needs room for the two setup cards and the three version cards beneath them. */}
        <div className={`${step === 1 || step === VERSION_STEP || step === INSTALL_STEP ? 'max-w-6xl' : step === REVIEW_STEP ? 'max-w-5xl' : 'max-w-4xl'} w-full mx-auto px-6 md:px-8 py-6`}>

          {/* STEP 1: what this business is — one outlet, or a head office over outlets */}
          {step === 1 && (
            <div className="space-y-12">
              <section className="space-y-6">
                <div className="space-y-2 text-center md:text-left">
                  {signupMode && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-bold">
                      <Sparkles className="w-3 h-3" /> Free for 30 days · no card needed
                    </span>
                  )}
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">How is your business set up?</h2>
                  <p className="text-[15px] text-slate-500 max-w-2xl md:mx-0 mx-auto">
                    Pick what fits today. A single outlet can add a head office later without starting again.
                  </p>
                </div>

                <div role="radiogroup" aria-label="How your business is set up" className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {setupTypes.map(option => {
                    const active = systemType === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSystemType(option.key)}
                        className={`group relative text-left p-6 rounded-2xl border bg-white transition-all duration-200 flex flex-col focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/25 cursor-pointer ${
                          active
                            ? 'border-teal-500 ring-4 ring-teal-500/10 shadow-lg shadow-teal-900/5'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                            active ? 'bg-teal-600 text-white shadow-md shadow-teal-600/25' : 'bg-teal-50 text-teal-600 border border-teal-100'
                          }`}>
                            <option.icon className="w-6 h-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-slate-900 leading-tight">{option.title}</h3>
                            <p className="text-[13px] font-semibold text-teal-700 mt-1">{option.tagline}</p>
                          </div>
                          <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            active ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white group-hover:border-slate-400'
                          }`}>
                            {active && <Check className="w-3 h-3 text-white stroke-[3]" />}
                          </span>
                        </div>

                        <p className="mt-4 text-[13px] text-slate-600 leading-relaxed">{option.text}</p>

                        <ul className="mt-4 pt-4 border-t border-slate-100 grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
                          {option.points.map(point => (
                            <li key={point} className="flex items-start gap-2 text-[13px] text-slate-700">
                              <span className="mt-px w-4 h-4 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                                <Check className="w-2.5 h-2.5 text-teal-600 stroke-[3]" />
                              </span>
                              {point}
                            </li>
                          ))}
                        </ul>

                        <div className="mt-auto pt-5 flex items-center justify-between gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
                            <option.footIcon className="w-3.5 h-3.5" /> {option.foot}
                          </span>
                          {option.price && <span className="text-xs text-slate-500">{option.price}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* VERSION: its own step, straight after the setup type. It decides what the whole rest of
              the setup is allowed to create, and a head office business needs it asked too — not
              just a single outlet. */}
          {step === VERSION_STEP && (
            <div className="space-y-12">
              <section className="space-y-4">
                <div className="flex flex-col-reverse md:flex-row md:items-end md:justify-between gap-2 text-center md:text-left">
                  <div className="space-y-1">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Which version do you need?</h2>
                    <p className="text-[15px] text-slate-500">
                      {systemType === 'POS_ERP'
                        ? 'Head office and new outlets start on this version — each outlet can have its own.'
                        : 'The allowance your outlet runs on. Move up or down any time from Plan & Add-ons.'}
                    </p>
                  </div>
                  <span className="self-center md:self-end inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold shrink-0">
                    {systemType === 'POS_ERP' ? <Building2 className="w-3 h-3 text-teal-600" /> : <Store className="w-3 h-3 text-teal-600" />}
                    {systemType === 'POS_ERP' ? 'Cashly POS + ERP' : 'Cashly POS'}
                    <button type="button" onClick={() => goToStep(1)} className="ml-1 text-teal-700 hover:text-teal-800 hover:underline underline-offset-2 cursor-pointer">Change</button>
                  </span>
                </div>

                {/* The base fee a head office pays once, as a band over the whole comparison: the
                    ERP, plus whichever version each outlet runs. */}
                {systemType === 'POS_ERP' && signupMode && erpMonthly != null && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                      <Building2 className="w-3.5 h-3.5" />
                    </span>
                    <p className="min-w-0 flex-1 text-[13px] text-slate-500">
                      <strong className="font-semibold text-slate-900">Head Office ERP</strong>
                      {' '}— once for the whole business: menu, buying, stock, accounts and reports
                    </p>
                    <div className="shrink-0 text-right">
                      <span className="text-lg font-bold text-slate-900 tabular-nums">{money(erpMonthly)}</span>
                      <span className="text-xs font-semibold text-slate-500"> /month</span>
                    </div>
                    <span className="hidden lg:flex items-center gap-1.5 pl-4 border-l border-slate-200 text-xs font-semibold text-teal-700 shrink-0">
                      <Plus className="w-3.5 h-3.5" /> each outlet’s version below
                    </span>
                  </div>
                )}

                {comparable && (
                  <div role="radiogroup" aria-label="Version" className="hidden md:grid grid-cols-[minmax(200px,0.85fr)_repeat(3,minmax(0,1fr))] gap-x-3 pt-3">
                    {/* The row names. A transparent border keeps them level with the columns' 1px border. */}
                    <div className="border border-transparent">
                      <div className="h-[150px] lg:h-[120px] flex flex-col justify-end pb-3 pr-3">
                        <div className="text-sm font-semibold text-slate-900">Compare versions</div>
                        <p className="text-xs text-slate-500 mt-1 leading-snug">
                          {systemType === 'POS_ERP' && signupMode
                            ? 'Prices are per outlet, on top of the Head Office ERP.'
                            : signupMode ? 'Every version starts with a 30-day free trial.' : 'You can change version later.'}
                        </p>
                      </div>
                      {compareGroups.map(group => (
                        <React.Fragment key={group.title}>
                          <div className="h-7 flex items-end pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</div>
                          {group.rows.map(row => (
                            <div key={row.label} className="h-7 flex items-center text-[13px] font-medium text-slate-600 border-b border-slate-100 whitespace-nowrap overflow-hidden" title={row.label}>{row.label}</div>
                          ))}
                        </React.Fragment>
                      ))}
                    </div>

                    {VERSIONS.map(plan => {
                      const pkg = packageFor(plan.key);
                      if (!pkg) return null;
                      const active = selectedPlan === plan.key;
                      const price = signupMode ? versionPrice(plan.key) : null;
                      const saving = price ? yearlySaving(price.monthly, price.yearly) : null;
                      return (
                        <button
                          key={plan.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setSelectedPlan(plan.key)}
                          className={`group relative text-left rounded-2xl border transition-all duration-200 flex flex-col focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/25 cursor-pointer ${
                            active
                              ? 'border-teal-500 bg-teal-50/40 ring-4 ring-teal-500/10 shadow-lg shadow-teal-900/5'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5'
                          }`}
                        >
                          {plan.badge && plan.key === 'Standard' && (
                            <span className="absolute -top-3 left-5 px-2.5 py-1 rounded-full bg-teal-600 text-white text-[11px] font-bold uppercase tracking-wider shadow-sm">
                              {plan.badge}
                            </span>
                          )}
                          <div className="h-[150px] lg:h-[120px] px-5 pt-4 pb-3 flex flex-col" title={plan.description}>
                            <div className="flex items-start justify-between gap-3">
                              <span className="text-base font-semibold text-slate-900 leading-tight">{plan.label}</span>
                              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                                active ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white group-hover:border-slate-400'
                              }`}>
                                {active && <Check className="w-3 h-3 text-white stroke-[3]" />}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500 truncate">{plan.tagline}</p>
                            {price && (
                              <div className="mt-auto">
                                <div className="flex items-baseline gap-1 flex-wrap">
                                  <span className="text-xl leading-none font-bold text-slate-900 tracking-tight tabular-nums">{money(price.monthly)}</span>
                                  <span className="text-xs font-semibold text-slate-500">{systemType === 'POS_ERP' ? '/mo per outlet' : '/month'}</span>
                                </div>
                                {price.yearly > 0 && (
                                  <div className="mt-1 text-xs text-slate-500">
                                    or {money(price.yearly)} a year{saving && <span className="font-bold text-teal-700"> · {saving}</span>}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {compareGroups.map(group => (
                            <React.Fragment key={group.title}>
                              <div className="h-7" />
                              {group.rows.map(row => (
                                <div key={row.label} className="h-7 mx-5 flex items-center justify-center text-sm font-semibold text-slate-900 border-b border-slate-100">
                                  {row.value(pkg)}
                                </div>
                              ))}
                            </React.Fragment>
                          ))}
                          <div className="h-2" />
                        </button>
                      );
                    })}
                  </div>
                )}

                <div role="radiogroup" aria-label="Version" className={`${comparable ? 'md:hidden ' : ''}grid grid-cols-1 md:grid-cols-3 gap-5 pt-2`}>
                  {VERSIONS.map((plan, index) => {
                    const active = selectedPlan === plan.key;
                    const pkg = packageFor(plan.key);
                    const price = signupMode ? versionPrice(plan.key) : null;
                    const saving = price ? yearlySaving(price.monthly, price.yearly) : null;
                    const { lead, items } = versionFeatures(index);
                    const kitchen = pkg?.maxKitchenDisplays ?? plan.kitchenScreens;
                    const allowances: [string, string][] = [
                      ['Tills', countText(pkg?.maxCounters, plan.counters)],
                      ['Tablets', countText(pkg?.maxOrderTabs, plan.tablets)],
                      ['Kitchen', kitchen === 0 ? 'Add-on' : countText(kitchen, plan.kitchenScreens)]
                    ];
                    return (
                      <button
                        key={plan.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedPlan(plan.key)}
                        className={`group relative text-left p-6 rounded-2xl border bg-white transition-all duration-200 flex flex-col focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/25 cursor-pointer ${
                          active
                            ? 'border-teal-500 ring-4 ring-teal-500/10 shadow-lg shadow-teal-900/5'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/5'
                        }`}
                      >
                        {plan.badge && plan.key === 'Standard' && (
                          <span className="absolute -top-3 left-6 px-2.5 py-1 rounded-full bg-teal-600 text-white text-[11px] font-bold uppercase tracking-wider shadow-sm">
                            {plan.badge}
                          </span>
                        )}

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-slate-900">{plan.label}</div>
                            <p className="text-[13px] text-slate-500 leading-snug mt-1">{plan.description}</p>
                          </div>
                          <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            active ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white group-hover:border-slate-400'
                          }`}>
                            {active && <Check className="w-3 h-3 text-white stroke-[3]" />}
                          </span>
                        </div>

                        {/* Only a registration is billed. A first-run local install buys nothing. */}
                        {price && (
                          <div className="mt-5">
                            <div className="flex items-baseline gap-1 flex-wrap">
                              <span className="text-[22px] leading-none font-bold text-slate-900 tracking-tight tabular-nums">{money(price.monthly)}</span>
                              <span className="text-xs font-semibold text-slate-500">{systemType === 'POS_ERP' ? '/month per outlet' : '/month'}</span>
                            </div>
                            {price.yearly > 0 && (
                              <div className="mt-2 text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                                or {money(price.yearly)} a year
                                {saving && <span className="px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 font-bold">{saving}</span>}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-5">
                          <div className="grid grid-cols-3 rounded-xl border border-slate-200 divide-x divide-slate-200 overflow-hidden">
                            {allowances.map(([label, value]) => (
                              <div key={label} className="px-1.5 py-2.5 text-center bg-slate-50/70">
                                <div className="text-sm font-semibold text-slate-900 leading-tight">{value}</div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-0.5 truncate">{label}</div>
                              </div>
                            ))}
                          </div>
                          {systemType === 'POS_ERP' && <div className="mt-1.5 text-xs text-slate-400 text-center">for each outlet</div>}
                        </div>

                        <div className="mt-5 pt-5 border-t border-slate-100 flex-1">
                          {lead && <div className="text-xs font-bold text-slate-500 mb-2.5">{lead}</div>}
                          <ul className="space-y-2.5">
                            {items.map(item => (
                              <li key={item} className="flex items-start gap-2 text-[13px] text-slate-700">
                                <span className="mt-px w-4 h-4 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                                  <Check className="w-2.5 h-2.5 text-teal-600 stroke-[3]" />
                                </span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {/* INSTALL STEP (local POS + ERP): what this PC is — the head office ERP, or a till connecting to it */}
          {step === INSTALL_STEP && systemType === 'POS_ERP' && (
            <div className="space-y-6">
              <div className="text-center md:text-left space-y-1">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">What are you setting up on this PC?</h2>
                <p className="text-sm text-slate-500">
                  The ERP is the same for every business. Each branch's POS version (Starter, Standard or
                  Enterprise) is chosen by head office when the branch is added.
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
                        <p className="text-xs text-teal-600 font-semibold">Master Hub & Central Database</p>
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
                        <p className="text-xs text-sky-600 font-semibold">Branch Counter / Till Terminal</p>
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
                      <span className="text-xs text-slate-500 block mt-1 font-normal">
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
                      <span className="text-xs text-slate-500 block mt-1 font-normal">
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
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-mono font-semibold tracking-wider uppercase focus:outline-none focus:border-sky-500"
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

          {/* BUSINESS: who it is, and where its staff sign in — one card, one screen. */}
          {step === BUSINESS_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
            <div className="space-y-5">
              {stepHeader('Tell us about your business', 'The name your customers know, and the address your staff sign in at.')}

              <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
                <div>
                  <label htmlFor="wiz-business-name" className={labelCls}>
                    <span>Business name</span><span className="text-xs font-medium text-slate-400">On receipts, reports and invoices</span>
                  </label>
                  <input
                    id="wiz-business-name"
                    type="text"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    autoFocus
                    placeholder="e.g. Royal Grill & Kitchen"
                    className={`${inputCls} text-base font-semibold${problemEdge('wiz-business-name')}`}
                  />
                  {problemNote('wiz-business-name')}
                </div>

                <div>
                  <div className={labelCls}>What kind of business is it?</div>
                  <div role="radiogroup" aria-label="Business type" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {BUSINESS_TYPES.map(t => {
                      const active = businessType === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setBusinessType(t.key)}
                          className={`flex items-center gap-3 text-left p-3 rounded-xl border bg-white transition focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/25 cursor-pointer ${
                            active ? 'border-teal-500 ring-4 ring-teal-500/10' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                            <t.icon className="w-4 h-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-bold text-slate-900 truncate">{t.label}</span>
                            <span className="block text-xs text-slate-500 truncate">{t.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={`grid grid-cols-1 gap-5 ${signupMode ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'md:grid-cols-2'}`}>
                  <div>
                    <label htmlFor="wiz-country" className={labelCls}>Country &amp; currency</label>
                    <select
                      id="wiz-country"
                      value={countryCode}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className={`${inputCls} cursor-pointer`}
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.currencyCode})</option>
                      ))}
                    </select>
                  </div>

                  {/* The business's own sign-in address — where its staff sign in with just username + PIN.
                      Filled in from the business name, so it is never empty-and-red before they have typed. */}
                  {signupMode && (
                    <div>
                      <label htmlFor="wiz-web-name" className={labelCls}>Staff sign-in address</label>
                      <div className={`flex items-stretch rounded-xl border overflow-hidden bg-white transition focus-within:ring-4 focus-within:ring-teal-500/10${problemEdge('wiz-web-name')} ${
                        !webName ? 'border-slate-300 focus-within:border-teal-500'
                          : webNameLocalProblem || (webCheckNow && !webCheckNow.available) ? 'border-rose-300'
                          : webCheckNow?.available ? 'border-teal-500' : 'border-slate-300'
                      }`}>
                        <span className="px-3 flex items-center text-sm text-slate-500 bg-slate-50 border-r border-slate-200 shrink-0">{webLinkParts.prefix}</span>
                        <input
                          id="wiz-web-name"
                          type="text"
                          value={webName}
                          onChange={(e) => {
                            setWebNameEdited(true);
                            setWebNameInput(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30));
                          }}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="filled in from your business name"
                          className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none !shadow-none"
                        />
                        {webLinkParts.suffix && (
                          <span className="px-3 flex items-center text-sm text-slate-500 bg-slate-50 border-l border-slate-200 shrink-0">{webLinkParts.suffix}</span>
                        )}
                        {webName && (
                          <span className="px-3 flex items-center shrink-0">
                            {webNameLocalProblem || webCheckFailed || (webCheckNow && !webCheckNow.available)
                              ? <AlertCircle className="w-4 h-4 text-rose-500" />
                              : !webCheckNow ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                              : <span className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center"><Check className="w-3 h-3 text-white stroke-[3]" /></span>}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs leading-snug">
                        {!webName ? (
                          <span className="text-slate-500">Your staff open this address to sign in with their username and PIN.</span>
                        ) : webNameLocalProblem ? (
                          <span className="text-rose-600">{webNameLocalProblem}</span>
                        ) : webCheckFailed ? (
                          <span className="text-rose-600">
                            Could not check this address: the Cashly server did not answer.{' '}
                            <button type="button" className="underline font-semibold cursor-pointer" onClick={() => checkWebNameNow(webName)}>
                              Try again
                            </button>
                          </span>
                        ) : !webCheckNow ? (
                          <span className="text-slate-500">Checking it is free…</span>
                        ) : webCheckNow.available ? (
                          <span className="text-teal-700 font-semibold">Available — your staff sign in here. It cannot be changed later without Cashly support.</span>
                        ) : (
                          <span className="text-rose-600">
                            {webCheckNow.problem}
                            {webCheckNow.alternative && (
                              <>
                                {' '}
                                <button type="button" className="underline font-semibold cursor-pointer"
                                  onClick={() => { setWebNameEdited(true); setWebNameInput(webCheckNow.alternative!); }}>
                                  Use {webCheckNow.alternative}
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* LOCATIONS: its one outlet, or the head office and its outlets. */}
          {step === LOCATIONS_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
            <div className="space-y-5">
              {stepHeader(
                systemType === 'POS_ERP' ? 'Your head office & outlets' : 'Where is your outlet?',
                systemType === 'POS_ERP'
                  ? 'The head office runs the ERP; each outlet runs a POS. You can add more outlets any time later.'
                  : 'Its tills and tablets connect later with a pairing code.'
              )}

              {/* The outlet (Cashly POS), or the head office (Cashly POS + ERP): name, then where it is. */}
              <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  {groupLabel(
                    systemType === 'POS_ERP' ? 'Head office' : 'Outlet',
                    systemType === 'POS_ERP' ? 'Where the ERP runs — menu, buying, stock, accounts and reports' : 'Printed on receipts and shown on reports'
                  )}
                  {/* Rarely changed, so out of the way until asked for. */}
                  {systemType === 'POS_ERP' && (
                    <button
                      type="button"
                      onClick={() => setShowHqOptions(v => !v)}
                      aria-expanded={showHqOptions}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-teal-700 transition cursor-pointer shrink-0"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHqOptions ? 'rotate-180' : ''}`} /> More options
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
                  <div>
                    <label htmlFor="wiz-location-name" className={labelCls}>{systemType === 'POS_ERP' ? 'Head office name' : 'Outlet name'}</label>
                    <input
                      id="wiz-location-name"
                      type="text"
                      value={systemType === 'POS_ERP' ? hqName : mainBranchName}
                      onChange={(e) => {
                        if (systemType === 'POS_ERP') { setHqNameEdited(true); setHqNameInput(e.target.value); }
                        else { setMainBranchEdited(true); setMainBranchInput(e.target.value); }
                      }}
                      className={`${inputCls} font-semibold${problemEdge('wiz-location-name')}`}
                    />
                    {problemNote('wiz-location-name')}
                  </div>
                  <div>
                    <label htmlFor="wiz-city" className={labelCls}><span>City</span>{optionalTag}</label>
                    <input id="wiz-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lahore" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="wiz-address" className={labelCls}><span>Address</span>{optionalTag}</label>
                    <input id="wiz-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 MM Alam Road, Gulberg" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="wiz-phone" className={labelCls}><span>Phone</span>{optionalTag}</label>
                    <input id="wiz-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="042-111-443-443" className={inputCls} />
                  </div>
                </div>

                {/* The version chosen on its own step, still visible where the outlet is named. */}
                {systemType === 'POS_ONLY' && (
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-[13px] text-slate-600 min-w-0">
                      Runs on <strong className="text-slate-900">{tierLabel(selectedPlan)}</strong> · {allowanceLine(selectedPlan)}
                    </p>
                    <button type="button" onClick={() => goToStep(VERSION_STEP)} className="text-xs font-bold text-teal-700 hover:text-teal-800 shrink-0 cursor-pointer">
                      Change
                    </button>
                  </div>
                )}

                {systemType === 'POS_ERP' && showHqOptions && (
                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={hqHoldsStock}
                      onChange={(e) => setHqHoldsStock(e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-teal-600"
                    />
                    <span className="text-xs text-slate-600">
                      <strong className="block text-sm font-semibold text-slate-900">The head office keeps stock</strong>
                      A central store or kitchen that supplies the outlets.
                    </span>
                  </label>
                )}
              </section>

              {/* Cashly POS + ERP: the outlets under the head office. */}
              {systemType === 'POS_ERP' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
                  {groupLabel(branches.length > 0 ? `Outlets · ${branches.length}` : 'Outlets', 'Each runs its own POS on the version you pick for it')}

                  {branches.length === 0 && (
                    <button
                      type="button"
                      onClick={addBranchRow}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/40 text-left transition cursor-pointer group"
                    >
                      <span className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-teal-100 text-slate-500 group-hover:text-teal-700 flex items-center justify-center shrink-0 transition-colors">
                        <Plus className="w-5 h-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-900">Add your first outlet</span>
                        <span className="block text-xs text-slate-500">Or skip it — outlets can be added any time from Locations.</span>
                      </span>
                    </button>
                  )}

                  {branches.map((b, idx) => {
                    const edition = b.posEdition ?? selectedPlan;
                    return (
                      <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 text-xs font-semibold flex items-center justify-center shrink-0">{idx + 1}</span>
                          <input
                            id={`wiz-outlet-${idx}-name`}
                            type="text"
                            aria-label={`Outlet ${idx + 1} name`}
                            value={b.name}
                            onChange={(e) => updateBranchField(idx, 'name', e.target.value)}
                            autoFocus={idx === branches.length - 1 && !b.name}
                            placeholder="Outlet name, e.g. Gulberg"
                            className={`${inputCls} font-semibold${problemEdge(`wiz-outlet-${idx}-name`)}`}
                          />
                          <button
                            type="button"
                            onClick={() => removeBranchRow(idx)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition shrink-0 cursor-pointer"
                            title="Remove this outlet"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {fieldProblem(`wiz-outlet-${idx}-name`) && <div className="sm:pl-11 -mt-1">{problemNote(`wiz-outlet-${idx}-name`)}</div>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 sm:pl-11">
                          <input
                            type="text"
                            aria-label={`Outlet ${idx + 1} city`}
                            value={b.sameAddressAsHq ? hqCity : b.city}
                            onChange={(e) => updateBranchField(idx, 'city', e.target.value)}
                            disabled={!!b.sameAddressAsHq}
                            placeholder="City (optional)"
                            className={inputCls}
                          />
                          <input
                            type="text"
                            aria-label={`Outlet ${idx + 1} address`}
                            value={b.sameAddressAsHq ? hqAddress : b.address}
                            onChange={(e) => updateBranchField(idx, 'address', e.target.value)}
                            disabled={!!b.sameAddressAsHq}
                            placeholder={b.sameAddressAsHq ? 'Same as head office' : 'Address (optional)'}
                            className={inputCls}
                          />
                          <label className="inline-flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={!!b.sameAddressAsHq}
                              onChange={(e) => updateBranchField(idx, 'sameAddressAsHq', e.target.checked)}
                              className="w-4 h-4 accent-teal-600"
                            />
                            Same building as head office
                          </label>
                        </div>

                        {/* This outlet's POS version: what its tills can do, and what it is billed for. */}
                        <div className="sm:pl-11 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div role="radiogroup" aria-label={`Outlet ${idx + 1} POS version`} className="inline-flex p-1 rounded-xl bg-slate-100 shrink-0">
                            {POS_EDITIONS.map(option => {
                              const active = edition === option;
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  onClick={() => updateBranchField(idx, 'posEdition', option)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                    active ? 'bg-white text-teal-700 shadow-sm ring-1 ring-teal-500/50' : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {tierLabel(option)}
                                </button>
                              );
                            })}
                          </div>
                          <span className="text-xs text-slate-500">{outletLine(edition)}</span>
                        </div>
                      </div>
                    );
                  })}

                  {branches.length > 0 && (
                    <button
                      type="button"
                      onClick={addBranchRow}
                      className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50/40 text-xs font-bold text-teal-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add another outlet
                    </button>
                  )}

                  {/* Asked only when they try to go on with no outlets, never before they start. */}
                  {noOutletHint && (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-3">
                      <p>
                        <strong>No outlets yet.</strong> That's fine — add them later from Locations &amp; Head Office.
                        If you have no separate head office, <strong>Cashly POS</strong> already includes the back office.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={addBranchRow}
                          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold transition cursor-pointer">
                          Add an outlet
                        </button>
                        <button type="button" onClick={continueWithoutOutlets}
                          className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 transition cursor-pointer">
                          Continue without outlets
                        </button>
                        <button type="button"
                          onClick={() => { setNoOutletHint(false); setSystemType('POS_ONLY'); setErrorMessage(null); goToStep(1); }}
                          className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold hover:bg-amber-100 transition cursor-pointer">
                          Switch to Cashly POS
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* SECURITY: the owner's account — back-office sign-in, and the PIN for tills — in one card. */}
          {step === SECURITY_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
            <div className="space-y-5">
              {stepHeader('Create your owner account', 'You get every permission. Your staff get their own logins later, with only what they need.')}

              <section className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
                <div className="p-6">
                  {groupLabel('About you', signupMode ? 'One free trial per mobile number' : undefined)}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="wiz-owner-name" className={labelCls}>Full name</label>
                      <input id="wiz-owner-name" type="text" value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)}
                        autoComplete="name" placeholder="e.g. Muhammad Ali" className={inputCls + problemEdge('wiz-owner-name')} />
                      {problemNote('wiz-owner-name')}
                    </div>
                    {signupMode && (
                      <div>
                        <label htmlFor="wiz-owner-mobile" className={labelCls}>Mobile number</label>
                        <input id="wiz-owner-mobile" type="tel" value={ownerMobile} onChange={(e) => setOwnerMobile(e.target.value)}
                          autoComplete="tel" placeholder="e.g. 0300 1234567" className={inputCls + problemEdge('wiz-owner-mobile')} />
                      {problemNote('wiz-owner-mobile')}
                      </div>
                    )}
                  </div>
                </div>

                {/* The back-office sign-in, the way Toast does it: email + password. The PIN is for the tills. */}
                {signupMode && (
                  <div className="p-6">
                    {groupLabel('Back office sign-in', 'Reports, menu and settings — your email and password')}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="wiz-owner-email" className={labelCls}><span>Email address</span><span className="text-xs font-medium text-slate-400">One business each</span></label>
                        <input id="wiz-owner-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
                          autoComplete="email" placeholder="owner@example.com" className={inputCls + problemEdge('wiz-owner-email')} />
                      {problemNote('wiz-owner-email')}
                      </div>
                      <div>
                        <label htmlFor="wiz-owner-password" className={labelCls}>Password</label>
                        <div className="relative">
                          <input id="wiz-owner-password" type={showPassword ? 'text' : 'password'} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                            autoComplete="new-password" placeholder="8+ letters & numbers" className={`${inputCls} pr-10${problemEdge('wiz-owner-password')}`} />
                          <button type="button" onClick={() => setShowPassword(v => !v)} title={showPassword ? 'Hide' : 'Show'}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer">
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        {problemNote('wiz-owner-password')}
                        {adminPassword && !fieldProblem('wiz-owner-password') && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 grid grid-cols-3 gap-1">
                              {[1, 2, 3].map(n => (
                                <span key={n} className={`h-1 rounded-full ${n <= passwordStrength.bars ? passwordStrength.bar : 'bg-slate-200'}`} />
                              ))}
                            </div>
                            <span className={`text-xs font-semibold whitespace-nowrap ${passwordStrength.text}`}>{passwordStrength.label}</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <label htmlFor="wiz-owner-password2" className={labelCls}>Confirm password</label>
                        <input id="wiz-owner-password2" type={showPassword ? 'text' : 'password'} value={adminPasswordConfirm} onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                          autoComplete="new-password" className={inputCls + problemEdge('wiz-owner-password2')} />
                      {problemNote('wiz-owner-password2')}
                        {adminPasswordConfirm && !fieldProblem('wiz-owner-password2') && (
                          <p className={`mt-2 text-xs font-semibold ${adminPasswordConfirm === adminPassword ? 'text-teal-700' : 'text-rose-600'}`}>
                            {adminPasswordConfirm === adminPassword ? 'Passwords match' : 'The two passwords do not match yet'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-6">
                  {groupLabel('Till & tablet sign-in', 'At a till or tablet you sign in with your username and PIN')}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="wiz-owner-username" className={labelCls}>Username</label>
                      <input id="wiz-owner-username" type="text" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)}
                        autoComplete="username" spellCheck={false} placeholder="e.g. ali.owner" className={inputCls + problemEdge('wiz-owner-username')} />
                      {problemNote('wiz-owner-username')}
                    </div>
                    <div>
                      <label htmlFor="wiz-owner-pin" className={labelCls}><span>PIN</span><span className="text-xs font-medium text-slate-400">4 to 6 digits</span></label>
                      <div className="relative">
                        <input id="wiz-owner-pin" type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={6} value={adminPin}
                          onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          autoComplete="off" placeholder="••••" className={`${inputCls} pr-10 tracking-[0.3em] font-semibold${problemEdge('wiz-owner-pin')}`} />
                        <button type="button" onClick={() => setShowPin(v => !v)} title={showPin ? 'Hide' : 'Show'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer">
                          {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {problemNote('wiz-owner-pin')}
                      {signupMode && adminPin.length >= 4 && isEasyPin(adminPin) && !fieldProblem('wiz-owner-pin') && (
                        <p className="mt-2 text-xs font-semibold text-rose-600">Too easy to guess — avoid 1234, 0000 and the like.</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <p className="flex items-start gap-2 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                As the owner you can see every report and change the menu, prices, stock, staff and devices.
              </p>
            </div>
          )}

          {/* REVIEW: everything once, with a way back to each part — a two-by-two summary. */}
          {step === REVIEW_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
            <div className="space-y-5">
              {stepHeader(
                signupMode ? 'Review & create' : 'Review & deploy',
                'Check everything once. Most of it can be changed later in Settings.'
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {reviewSections.map(section => (
                  <div key={section.title} className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                        <section.icon className="w-4 h-4 text-teal-600" /> {section.title}
                      </h3>
                      <button type="button" onClick={() => goToStep(section.step)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-800 cursor-pointer">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </div>
                    <dl className="space-y-1.5">
                      {section.rows.map(([term, value]) => (
                        <div key={term} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                          <dt className="text-xs text-slate-500 pt-px">{term}</dt>
                          <dd className="text-sm text-slate-900 font-medium break-words">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>

              <div className={`grid grid-cols-1 gap-4 ${signupMode ? 'md:grid-cols-2' : ''}`}>
                {/* A few items to try a sale with straight away; one click removes them later. */}
                {signupMode && (
                  <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-white cursor-pointer hover:bg-slate-50 transition">
                    <input
                      type="checkbox"
                      checked={wantsSampleMenu}
                      onChange={(e) => setSampleMenuChoice(e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-teal-600"
                    />
                    <span className="text-xs text-slate-600">
                      <strong className="block text-sm font-semibold text-slate-900">Start with a sample menu</strong>
                      Five food items to try a sale straight away; remove them in one click from Getting started.
                    </span>
                  </label>
                )}

                <div className="flex items-start gap-3 p-4 rounded-2xl bg-teal-50 border border-teal-200">
                  <Sparkles className="w-5 h-5 text-teal-600 shrink-0" />
                  <p className="text-xs text-teal-900 leading-relaxed">
                    {signupMode ? (
                      <><strong className="block text-sm">Your 30-day free trial starts today</strong>No card needed. Press <strong>Create Business Account</strong> when you are ready.</>
                    ) : (
                      <>Everything is ready. Press <strong>Complete Setup &amp; Launch</strong> to create the database and open Cashly.</>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* A problem that is not one field's: floats over the page, so nothing below it moves. */}
      {errorMessage && (
        <div
          role="alert"
          className="fixed z-40 top-16 lg:top-28 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg flex items-start gap-3 p-3.5 rounded-2xl bg-white border border-rose-200 shadow-2xl shadow-slate-900/15"
        >
          <span className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </span>
          <p className="flex-1 min-w-0 pt-1.5 text-sm text-slate-800">{errorMessage}</p>
          <button type="button" onClick={() => setErrorMessage(null)} title="Dismiss"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-6 md:px-10 py-4">
        <div className={`${step === 1 || step === VERSION_STEP || step === INSTALL_STEP ? 'max-w-6xl' : step === REVIEW_STEP ? 'max-w-5xl' : 'max-w-4xl'} w-full mx-auto flex items-center justify-between gap-4`}>
          {step > 1 ? (
            <button
              type="button"
              onClick={() => goToStep(previousStepBefore(step))}
              className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-semibold text-sm flex items-center gap-2 transition cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : <div />}

          {/* What has been chosen so far, and what it means — never a price; that is on the cards. */}
          {(() => {
            const setup = setupTypes.find(t => t.key === systemType);
            const version = step > 1 ? VERSIONS.find(v => v.key === selectedPlan) : undefined;
            if (!setup) return null;
            return (
              <div className="hidden md:flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                  <setup.icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 text-left">
                  <div className="text-[13px] font-semibold text-slate-900 truncate">
                    {setup.title}{version ? ` · ${version.label}` : ''}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {setup.tagline}{version ? ` · ${version.tagline}` : ''}
                  </div>
                </div>
              </div>
            );
          })()}

          {step < maxSteps ? (
            // If on Station Role and chose to pair POS terminal, the pair button is inside the box
            step === INSTALL_STEP && systemType === 'POS_ERP' && erpRole === 'POS_TERMINAL' ? (
              <div />
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm flex items-center gap-2 shadow-sm shadow-teal-900/10 transition cursor-pointer"
              >
                <span>Continue{nextLabel && <span className="hidden lg:inline"> to {nextLabel}</span>}</span> <ArrowRight className="w-4 h-4" />
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={requestCompleteSetup}
              className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm flex items-center gap-2 shadow-sm shadow-teal-900/10 disabled:opacity-50 transition cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {signupMode ? 'Creating your account…' : 'Setting up…'}
                </>
              ) : signupMode ? (
                <>
                  Create Business Account <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Complete Setup &amp; Launch <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Confirm before creating */}
      {confirmOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-create-title"
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                  {systemType === 'POS_ERP' ? <Building2 className="w-5 h-5" /> : <Store className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="confirm-create-title" className="text-base font-semibold text-slate-900 leading-tight">
                    {signupMode ? `Create ${restaurantName.trim() || 'this business'}?` : `Set up ${restaurantName.trim() || 'this business'}?`}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">This creates the business, its locations and your owner account.</p>
                </div>
              </div>

              <dl className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200">
                {([
                  ['Setup', systemType === 'POS_ERP'
                    ? `Cashly POS + ERP · ${tierLabel(selectedPlan)}`
                    : `Cashly POS · ${tierLabel(selectedPlan)}`],
                  ['Locations', systemType === 'POS_ERP'
                    ? namedOutlets.length === 0
                      ? `${hqName} only — add outlets later`
                      : `${hqName} + ${namedOutlets.length} outlet${namedOutlets.length === 1 ? '' : 's'}`
                    : mainBranchName],
                  ['Owner login', <span className="font-mono">{adminUsername.trim().toLowerCase()}</span>]
                ] as [string, React.ReactNode][]).map(([term, value]) => (
                  <div key={term} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <dt className="text-xs text-slate-500">{term}</dt>
                    <dd className="text-sm font-semibold text-slate-900 text-right min-w-0 truncate">{value}</dd>
                  </div>
                ))}
              </dl>

              <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                It happens straight away and cannot be undone from the app.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Go back and check
              </button>
              <button
                type="button"
                onClick={handleCompleteSetup}
                className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                {signupMode ? 'Yes, create it' : 'Yes, set it up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

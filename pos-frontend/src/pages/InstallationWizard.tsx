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
  Check,
  KeyRound,
  Globe
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

const CHAIN_HQ_NAME = 'Head Office & Central Commissary';

// Step 2 is where the paths differ: POS Only picks its POS version, while POS + ERP picks what this
// PC is (the head office ERP, or a till connecting to one). A cloud registration skips that
// question: registering always creates the business, and a till joins one at /connect. The ERP is
// the same for everyone; POS versions are chosen per branch by head office.
const PROFILE_STEP = 3;
const SECURITY_STEP = 4;
const REVIEW_STEP = 5;

const POS_EDITIONS: SubscriptionTier[] = ['Starter', 'Standard', 'Professional'];

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
  const [businessType, setBusinessType] = useState<BusinessType>('Restaurant');
  const [currency, setCurrency] = useState('PKR');
  const [countryCode, setCountryCode] = useState('PK');
  const [city, setCity] = useState(forceSignup ? '' : 'Islamabad');
  const [address, setAddress] = useState(forceSignup ? '' : 'Sector F-7 Markaz');
  const [phone, setPhone] = useState(forceSignup ? '' : '051-1234567');

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
  // The owner's own mobile (registration only): one free trial per number. When the server sends
  // mobile codes (WhatsApp or SMS), the number is proven with one before the business is created.
  const [ownerMobile, setOwnerMobile] = useState('');
  const [mobileCodes, setMobileCodes] = useState<{ enabled: boolean; channel: string } | null>(null);
  const [mobileCode, setMobileCode] = useState('');
  const [mobileCodeSent, setMobileCodeSent] = useState(false);
  const [mobileBusy, setMobileBusy] = useState(false);
  const [mobileNote, setMobileNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [mobileProof, setMobileProof] = useState<{ mobile: string; proof: string } | null>(null);
  const needsMobileCode = signupMode && !!mobileCodes?.enabled;
  // A proof is for the number it was made for; editing the number needs a new code.
  const mobileVerified = !!mobileProof && mobileProof.mobile === ownerMobile.trim();
  useEffect(() => {
    if (!signupMode) return;
    let cancelled = false;
    posApi.getMobileVerification()
      .then(r => { if (!cancelled) setMobileCodes(r); })
      .catch(() => { /* no codes: the number is only checked for being new */ });
    return () => { cancelled = true; };
  }, [signupMode]);
  // Start with the sample menu? Null until the owner decides: then food businesses get it.
  const [sampleMenuChoice, setSampleMenuChoice] = useState<boolean | null>(null);
  const wantsSampleMenu = sampleMenuChoice ?? (businessType === 'Restaurant' || businessType === 'Hybrid');

  // The restaurant's own sign-in address (/r/<name> now, <name>.<domain> later): suggested from the
  // restaurant's name until the owner edits it, and checked with the server as they type.
  const [webNameInput, setWebNameInput] = useState('');
  const [webNameEdited, setWebNameEdited] = useState(false);
  const webName = webNameEdited ? webNameInput : suggestWebName(restaurantName);
  const [webCheck, setWebCheck] = useState<{ name: string; available: boolean; problem: string | null; alternative: string | null } | null>(null);
  useEffect(() => {
    if (!signupMode || webNameProblem(webName)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      posApi.checkWebName(webName)
        .then(r => { if (!cancelled) setWebCheck(r); })
        .catch(() => { /* checked again when they press Next */ });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [webName, signupMode]);
  const webNameLocalProblem = webNameProblem(webName);
  const webCheckNow = webCheck && webCheck.name === webName ? webCheck : null;
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
  const countText = (n: number | undefined, fallback: number) => {
    const value = n ?? fallback;
    return value >= 999 ? 'Unlimited' : String(value);
  };
  /** "1 till, 3 tablets" for a POS version. */
  const allowanceLine = (key: SubscriptionTier) => {
    const pkg = packageFor(key);
    const fallback = POS_ONLY_PLANS.find(p => p.key === key);
    const tills = countText(pkg?.maxCounters, fallback?.counters ?? 1);
    const tablets = countText(pkg?.maxOrderTabs, fallback?.tablets ?? 0);
    const kds = pkg ? pkg.hasKitchenDisplay : key !== 'Starter';
    return `${tills} till${tills === '1' ? '' : 's'}, ${tablets} tablet${tablets === '1' ? '' : 's'}${kds ? ', kitchen screens' : ''}`;
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
    // Blank name so the owner types the real one; the code is generated if left empty.
    setBranches([
      ...branches,
      { name: '', code: '', city: city || '', address: '', phone: '', allowedCounters: 3, allowedOrderTabs: 10, posEdition: 'Standard', sameAddressAsHq: false }
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

  // Plan Configurations for POS Only
  const POS_ONLY_PLANS = [
    {
      key: 'Starter' as const,
      label: 'Starter',
      counters: 1,
      tablets: 3,
      badge: undefined,
      description: 'Ideal for single food stalls, small cafes, and takeout joints.',
      features: ['Direct Receipt Printing', 'Daily Shift Cash Register', 'Waiter / Order Tablets']
    },
    {
      key: 'Standard' as const,
      label: 'Standard',
      counters: 2,
      tablets: 10,
      badge: 'Most Popular',
      description: 'Full-service dine-in cafes and standalone busy restaurants.',
      features: ['Kitchen Display System (KDS)', 'Waiter Tablets & QR Tables', 'Floor & Table Layout Manager']
    },
    {
      key: 'Professional' as const,
      label: tierLabel('Professional'),
      counters: 5,
      tablets: 25,
      badge: 'High Volume',
      description: 'High-speed fast food and multi-station large dining restaurants.',
      features: ['Multi-Kitchen Routing & KDS', 'Customer Khata & VIP Loyalty', 'Highest till & tablet capacity']
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

  // Step Validation
  const validateStep = (s: number): string | null => {
    // Step 1: System choice is always valid
    if (s === 1) return null;

    // Step 2: POS Only picks its POS version (always valid); POS + ERP picks what this PC is.
    if (s === 2) {
      if (systemType === 'POS_ERP' && erpRole === 'POS_TERMINAL'
          && serverTopology === 'DIFFERENT_SERVER' && !apiUrl.trim()) {
        return 'Head Office / ERP Server URL is required.';
      }
      return null;
    }

    // Business Profile Step
    if (s === PROFILE_STEP) {
      if (!restaurantName.trim()) return 'Restaurant / Brand name is required.';
      if (signupMode) {
        if (webNameLocalProblem) return `Web address: ${webNameLocalProblem}`;
        if (!webCheckNow) return 'Still checking your web address — try again in a moment.';
        if (!webCheckNow.available) return `Web address: ${webCheckNow.problem ?? 'already taken.'}`;
      }
      if (systemType === 'POS_ERP' && erpRole === 'ERP_SERVER') {
        if (!hqName.trim()) return 'Head Office Name is required.';
        if (branches.some(b => !b.name.trim())) return 'All branch outlets must have a name.';
      } else if (systemType === 'POS_ONLY') {
        if (!mainBranchName.trim()) return 'Outlet branch name is required.';
      }
    }

    // Security Step
    if (s === SECURITY_STEP) {
      if (!adminFullName.trim()) return 'Full name is required.';
      if (adminUsername.trim().length < 3) return 'Username must be at least 3 characters.';
      if (!/^\d{4,6}$/.test(adminPin.trim())) return 'Security PIN must be 4 to 6 digits.';
      if (signupMode && isEasyPin(adminPin.trim())) {
        return 'Choose a PIN that is harder to guess — not 1234, 0000 or similar.';
      }
      if (signupMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) {
        return 'A valid email address is required to register the business.';
      }
      if (signupMode && ownerMobile.replace(/\D/g, '').length < 10) {
        return 'Enter your mobile number, for example 0300 1234567.';
      }
      if (needsMobileCode && !mobileVerified) {
        return 'Verify your mobile number: press Send code, then type the code we send you.';
      }
      if (signupMode) {
        if (adminPassword.length < 8 || !/[A-Za-z]/.test(adminPassword) || !/\d/.test(adminPassword)) {
          return 'Choose a password of at least 8 characters, with letters and numbers.';
        }
        if (adminPassword !== adminPasswordConfirm) return 'The two passwords do not match.';
      }
    }

    return null;
  };

  const maxSteps = REVIEW_STEP;

  // The steps this path walks through, in order. A cloud registration with a head office has no
  // "what is this PC" step (see the note on PROFILE_STEP).
  const stepOrder = systemType === 'POS_ERP' && signupMode
    ? [1, PROFILE_STEP, SECURITY_STEP, REVIEW_STEP]
    : [1, 2, PROFILE_STEP, SECURITY_STEP, REVIEW_STEP];
  const nextStepAfter = (s: number) => stepOrder.find(n => n > s) ?? s;
  const previousStepBefore = (s: number) => [...stepOrder].reverse().find(n => n < s) ?? 1;

  const handleNext = () => {
    const err = validateStep(step);
    if (err) {
      setErrorMessage(err);
      return;
    }
    setErrorMessage(null);
    setStep(nextStepAfter(step));
  };

  const sendMobileCode = async () => {
    setMobileBusy(true);
    setMobileNote(null);
    try {
      const res = await posApi.sendMobileCode(ownerMobile.trim(), getCountryByCode(countryCode)?.name);
      setMobileCodeSent(true);
      setMobileNote({
        tone: 'ok',
        text: res.channel === 'Console'
          ? 'Development mode: the code is printed in the backend window.'
          : `We sent a 6-digit code by ${res.channel}. It works for ${res.expiresInMinutes} minutes.`
      });
    } catch (err) {
      setMobileNote({ tone: 'err', text: getApiErrorMessage(err, 'Could not send the code. Try again in a moment.') });
    } finally {
      setMobileBusy(false);
    }
  };

  const verifyMobileCode = async () => {
    setMobileBusy(true);
    setMobileNote(null);
    try {
      const res = await posApi.verifyMobileCode(ownerMobile.trim(), mobileCode.trim(), getCountryByCode(countryCode)?.name);
      setMobileProof({ mobile: ownerMobile.trim(), proof: res.proof });
      setMobileNote({ tone: 'ok', text: 'Mobile number verified.' });
    } catch (err) {
      setMobileNote({ tone: 'err', text: getApiErrorMessage(err, 'That code is not right.') });
    } finally {
      setMobileBusy(false);
    }
  };

  /** A shop marked "same building as head office" takes the head office's city and address. */
  const branchAddress = (b: BranchInitPayload) => ({
    city: (b.sameAddressAsHq ? hqCity : b.city)?.trim() || undefined,
    address: (b.sameAddressAsHq ? hqAddress : b.address)?.trim() || undefined
  });

  /** The final button: check the step, then ask before anything is created. */
  const requestCompleteSetup = () => {
    const stepError = validateStep(step);
    if (stepError) {
      setErrorMessage(stepError);
      return;
    }
    setErrorMessage(null);
    setConfirmOpen(true);
  };

  const handleCompleteSetup = async () => {
    setConfirmOpen(false);
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
          // POS Only: the plan is its POS version. POS + ERP: the ERP is the same for everyone and
          // each branch carries its own version; Standard is only what a branch falls back to.
          packageKey: isChain ? 'Standard' : selectedPlan,
          deploymentMode: deploymentMode === 'MultiBranch' ? 'MultiBranch' : 'Standalone',
          businessStructure: structure,
          branches: isChain
            ? branches.filter(b => b.name.trim()).map(b => ({
                name: b.name.trim(),
                code: b.code?.trim() || undefined,
                ...branchAddress(b),
                phone: b.phone?.trim() || undefined,
                posEdition: b.posEdition ?? 'Standard'
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
          seedSampleMenu: wantsSampleMenu,
          mobileProof: mobileVerified ? mobileProof?.proof : undefined
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
        allowedCounters,
        allowedOrderTabs: isChain ? undefined : allowedOrderTabs,
        adminFullName,
        adminUsername,
        adminPin,
        seedStarterMenu,
        // sameAddressAsHq is the wizard's own; undefined is left out of the request.
        branches: isChain
          ? branches.map(b => ({ ...b, ...branchAddress(b), sameAddressAsHq: undefined, posEdition: b.posEdition ?? 'Standard' }))
          : undefined,
        businessStructure: structure,
        company,
        headOffice,
        policies,
        setUpAccounting: bookAccounts,
        // Only a single shop picks a plan here (its POS version); see the signup branch above.
        selectedPlan: isChain ? undefined : selectedPlan,
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
            <h1 className="text-2xl font-black text-slate-900 mb-2">This till is connected</h1>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-900">{connectedInfo.terminalName || 'This device'}</span> now belongs to{' '}
              <span className="font-bold text-slate-900">{connectedInfo.branchName || 'its branch'}</span>.
            </p>
          </div>

          {connectedInfo.posEdition && (
            <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">POS version</span>
                <span className="text-sm font-extrabold text-teal-700">{tierLabel(connectedInfo.posEdition)}</span>
              </div>
              {allowance && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Tills</div>
                    <div className="text-lg font-black text-slate-900">{unlimited(allowance.counters)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Tablets</div>
                    <div className="text-lg font-black text-slate-900">{unlimited(allowance.tablets)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Kitchen screens</div>
                    <div className="text-lg font-black text-slate-900">{allowance.kitchenDisplay ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-400">
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

    return (
      <div className="h-screen bg-white text-slate-900 flex items-center justify-center p-4 overflow-y-auto selection:bg-teal-500 selection:text-white">
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
              {isErp ? (
                <>Full ERP included · <span className="font-semibold text-teal-600">each shop has its own POS version</span></>
              ) : (
                <>POS version: <span className="font-semibold text-teal-600">{tierLabel(selectedPlan)}</span></>
              )}
            </p>
          </div>

          {/* Master Admin Login Credentials */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-2.5 shadow-sm">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-teal-600" /> Master Admin Login
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-xs text-slate-500">Restaurant</span>
              <span className="text-sm text-slate-900 font-bold">{signupSuccess.restaurantName}</span>
            </div>
            {signupMode && adminEmail.trim() && (
              <div className="flex justify-between items-center py-1 border-b border-slate-100">
                <span className="text-xs text-slate-500">Back office email</span>
                <span className="text-sm text-slate-900 font-bold">{adminEmail.trim().toLowerCase()}</span>
              </div>
            )}
            <div className="flex justify-between items-center py-1 border-b border-slate-100">
              <span className="text-xs text-slate-500">Username</span>
              <span className="text-sm text-slate-900 font-mono font-bold">{signupSuccess.username}</span>
            </div>
            {/* The PIN is never shown back — the owner typed it a moment ago. */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-slate-500">Master PIN</span>
              <span className="text-sm text-slate-400 font-mono font-bold tracking-widest">••••</span>
            </div>
            <p className="text-[11px] text-slate-400">
              {signupMode
                ? <>Back office: sign in with your <strong>email and password</strong>. On a till or tablet: just your <strong>PIN</strong>.</>
                : 'Sign in with your restaurant name, username and the PIN you chose during setup.'}
            </p>
            {signupSuccess.confirmationEmailSent && (
              <p className="text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1.5">
                We sent a link to <strong>{adminEmail.trim().toLowerCase()}</strong>. Open it to confirm your email.
              </p>
            )}
          </div>

          {/* The restaurant's own sign-in address: staff sign in there with just username + PIN, and
              tills are connected there with a pairing code. */}
          {signupMode && signupSuccess.webName && (
            <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-left space-y-2">
              <div className="text-xs font-bold text-teal-900 uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-teal-600" /> Your restaurant's sign-in address
              </div>
              <div className="flex items-center gap-2 bg-white border border-teal-200 rounded-lg p-2">
                <span className="text-sm font-mono font-bold text-slate-800 flex-1 truncate">
                  {restaurantSignInLink(signupSuccess.webName).replace(/^https?:\/\//, '')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(restaurantSignInLink(signupSuccess.webName!)).catch(() => {});
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="p-1 text-teal-600 hover:text-teal-800 transition"
                  title="Copy the address"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-teal-800">
                Send it to your staff (WhatsApp is fine): they open it and sign in with just their username and PIN.
                Connect tills and tablets from the same address with <strong>Connect a till or tablet</strong>.
              </p>
            </div>
          )}

          {/* If Head Office ERP was installed on this machine: the server address its tills connect to */}
          {isErp && !signupMode && (
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
            onClick={() => {
              // A new registration goes to its own restaurant's sign-in address.
              if (signupMode && signupSuccess.webName) window.location.assign(restaurantSignInLink(signupSuccess.webName));
              else navigate(signupMode ? '/' : isErp ? '/director' : '/');
            }}
            className="w-full py-3.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition shadow-lg shadow-teal-500/25 cursor-pointer flex items-center justify-center gap-2"
          >
            {signupMode ? (
              // A new registration is not signed in yet; the next screen is the login.
              <>
                <KeyRound className="w-4 h-4" /> Go to Sign In
              </>
            ) : isErp ? (
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
  const wizardSteps = (systemType === 'POS_ERP'
    ? [
        { num: 1, label: 'Your Business' },
        { num: 2, label: 'Install ERP or POS' },
        { num: PROFILE_STEP, label: 'HQ & Branches' },
        { num: SECURITY_STEP, label: 'Admin Security' },
        { num: REVIEW_STEP, label: signupMode ? 'Create' : 'Deploy' }
      ]
    : [
        { num: 1, label: 'Your Business' },
        { num: 2, label: 'POS Version' },
        { num: PROFILE_STEP, label: 'Shop Profile' },
        { num: SECURITY_STEP, label: 'Admin Security' },
        { num: REVIEW_STEP, label: signupMode ? 'Create' : 'Deploy' }
      ]).filter(s => stepOrder.includes(s.num));

  return (
    <div className="h-screen bg-white text-slate-900 flex flex-col selection:bg-teal-500 selection:text-white overflow-hidden">
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
          {wizardSteps.map((s, position) => (
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
                {step > s.num ? '✓' : position + 1}
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
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">How is your business set up?</h2>
                <p className="text-sm text-slate-500">
                  Pick what fits today. A single outlet can open a head office later without starting again.
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
                        <h3 className="text-lg font-bold text-slate-900">Single Outlet</h3>
                        <p className="text-xs text-teal-600 font-semibold">Cashly POS</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      One restaurant, café or store, with the back office included. An office in another room or
                      building is fine.
                    </p>

                    <ul className="space-y-2 text-xs text-slate-700 pt-3 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Tills & instant bill printing
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Tables & waiter tablets
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Kitchen screens
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Stock, cash shifts & reports
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-teal-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Quick setup · back office included
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
                        <h3 className="text-lg font-bold text-slate-900">Multi-Outlet & Chains</h3>
                        <p className="text-xs text-teal-600 font-semibold">Cashly POS + ERP</p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      A head office that runs the menu, buying and reports for all your branches, or a central kitchen.
                      Each branch has its own tills.
                    </p>

                    <ul className="space-y-2 text-xs text-slate-700 pt-3 border-t border-slate-200">
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> One head office for all your branches
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Central buying & stock transfers
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Group reports & accounting
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-teal-600 font-bold">✓</span> Connect each branch's tills with a code
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 pt-3 text-xs font-semibold text-teal-700 flex items-center gap-1.5">
                    <Network className="w-3.5 h-3.5" /> Head office & branches
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 (POS Only): the shop's POS version. POS + ERP has no plan step: the ERP is
              the same for everyone, and each branch's POS version is chosen by head office. */}
          {step === 2 && systemType === 'POS_ONLY' && (
            <div className="space-y-5">
              <div className="text-center md:text-left space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Choose Your POS Version</h2>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-800">
                    Single Outlet
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  Select the till and tablet capacity that fits your restaurant.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {POS_ONLY_PLANS.map((plan) => {
                    const isActive = selectedPlan === plan.key;
                    const pkg = packageFor(plan.key);
                    return (
                      <div
                        key={plan.key}
                        onClick={() => {
                          setSelectedPlan(plan.key);
                          setAllowedCounters(pkg?.maxCounters ?? plan.counters);
                          setAllowedOrderTabs(pkg?.maxOrderTabs ?? plan.tablets);
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
                              <span className="text-xl font-black text-slate-900">{countText(pkg?.maxCounters, plan.counters)}</span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
                              <span className="text-[10px] uppercase font-bold text-slate-400 block">Tablets</span>
                              <span className="text-xl font-black text-slate-900">{countText(pkg?.maxOrderTabs, plan.tablets)}</span>
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
            </div>
          )}

          {/* STEP 2 (POS + ERP): what this PC is — the head office ERP, or a till connecting to it */}
          {step === 2 && systemType === 'POS_ERP' && (
            <div className="space-y-6">
              <div className="text-center md:text-left space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">What are you setting up on this PC?</h2>
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

          {/* STEP 3: Business Profile (& Branches for POS + ERP) */}
          {step === PROFILE_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                  {systemType === 'POS_ERP' ? 'Head Office & Outlets Setup' : 'Restaurant & Store Profile'}
                </h2>
                <p className="text-sm text-slate-500">
                  {systemType === 'POS_ERP'
                    ? 'Set up your Head Office. Add your shops now, or later from Locations & Head Office.'
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

                {/* The restaurant's own sign-in address — where its staff sign in with just username + PIN. */}
                {signupMode && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-teal-600" /> Your sign-in web address*
                    </label>
                    <div className={`flex items-stretch rounded-xl border overflow-hidden bg-slate-50 ${
                      webNameLocalProblem || (webCheckNow && !webCheckNow.available) ? 'border-rose-300' : webCheckNow?.available ? 'border-teal-400' : 'border-slate-200'
                    }`}>
                      <span className="px-3 flex items-center text-xs text-slate-500 bg-slate-100 border-r border-slate-200 shrink-0">{webLinkParts.prefix}</span>
                      <input
                        type="text"
                        value={webName}
                        onChange={(e) => {
                          setWebNameEdited(true);
                          setWebNameInput(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30));
                        }}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="royalgrill"
                        className="flex-1 min-w-0 bg-transparent px-2 py-2 text-sm font-bold text-slate-900 focus:outline-none"
                      />
                      {webLinkParts.suffix && (
                        <span className="px-3 flex items-center text-xs text-slate-500 bg-slate-100 border-l border-slate-200 shrink-0">{webLinkParts.suffix}</span>
                      )}
                    </div>
                    <p className="text-[11px]">
                      {webNameLocalProblem ? (
                        <span className="text-rose-600">{webNameLocalProblem}</span>
                      ) : !webCheckNow ? (
                        <span className="text-slate-400">Checking…</span>
                      ) : webCheckNow.available ? (
                        <span className="text-teal-700 font-semibold">✓ Available</span>
                      ) : (
                        <span className="text-rose-600">
                          {webCheckNow.problem}
                          {webCheckNow.alternative && (
                            <>
                              {' '}
                              <button type="button" className="underline font-semibold"
                                onClick={() => { setWebNameEdited(true); setWebNameInput(webCheckNow.alternative!); }}>
                                Use {webCheckNow.alternative}
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Your staff open this address to sign in with just their username and PIN. It cannot be changed later without Cashly support.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-teal-600" /> {systemType === 'POS_ERP' ? 'Head Office City' : 'City'}
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
                      <MapPin className="w-3.5 h-3.5 text-teal-600" /> {systemType === 'POS_ERP' ? 'Head Office Address' : 'Shop Address'}
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
                    <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-800">
                      <strong>The full ERP is included</strong>: accounts, purchasing, stock transfers, reports and every branch.
                      You only choose a <strong>POS version for each shop</strong>, which decides its tills, tablets and kitchen screens.
                    </div>
                    {/* A head office earns its keep with two or more outlets, or a central store. A single
                        outlet with an office does not need one: its back office is already included. */}
                    {branches.length <= 1 && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="flex-1 min-w-60">
                          <strong>Only one outlet, and no central kitchen or warehouse?</strong> Then you don't need a head office:
                          <strong> Single Outlet</strong> already includes the back office (menu, stock, reports), even from an office in another building.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (branches[0]?.name.trim()) setMainBranchName(branches[0].name.trim());
                            setSystemType('POS_ONLY');
                            setErrorMessage(null);
                            setStep(2);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 font-bold hover:bg-amber-100 transition cursor-pointer"
                        >
                          Switch to Single Outlet
                        </button>
                      </div>
                    )}
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
                            <Store className="w-3.5 h-3.5 text-teal-600" /> Selling Branch Outlets <span className="normal-case font-normal text-slate-400">(optional)</span>
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {signupMode
                              ? <>These are your shops. Each shop's tills are connected later with <strong>Connect a till or tablet</strong> and a pairing code.</>
                              : <>These are your shops. Each shop's counter PC is connected later with <strong>Install POS</strong> and a pairing code.</>}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Head office in the same building as a shop? Tick <strong>Same building as head office</strong> on that shop.
                            They stay separate locations, so the shop's stock, cash and reports never mix with the office's.
                          </p>
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
                        {branches.length === 0 && (
                          <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500 text-center">
                            No shops added yet. That's fine: only the head office is created now, and you can add
                            shops at any time from <strong>Locations & Head Office</strong>.
                          </div>
                        )}
                        {branches.map((b, idx) => (
                          <div key={idx} className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3 pb-1 border-b border-slate-200/60">
                              <span className="text-xs font-bold text-teal-700">Branch #{idx + 1}</span>
                              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!b.sameAddressAsHq}
                                  onChange={(e) => updateBranchField(idx, 'sameAddressAsHq', e.target.checked)}
                                  className="w-3.5 h-3.5 accent-teal-500"
                                />
                                Same building as head office
                              </label>
                              <button
                                type="button"
                                onClick={() => removeBranchRow(idx)}
                                className="text-slate-400 hover:text-rose-500 transition"
                                title="Remove this shop"
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
                                  value={b.sameAddressAsHq ? hqCity : b.city}
                                  onChange={(e) => updateBranchField(idx, 'city', e.target.value)}
                                  disabled={!!b.sameAddressAsHq}
                                  placeholder="e.g. Islamabad"
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500 font-semibold">Address</label>
                                <input
                                  type="text"
                                  value={b.sameAddressAsHq ? hqAddress : b.address}
                                  onChange={(e) => updateBranchField(idx, 'address', e.target.value)}
                                  disabled={!!b.sameAddressAsHq}
                                  placeholder={b.sameAddressAsHq ? 'Same as head office' : 'e.g. Main Blvd'}
                                  className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                                />
                              </div>
                            </div>
                            {/* This shop's POS version: what its tills can do, and what it is billed for. */}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">POS version</span>
                              {POS_EDITIONS.map(edition => {
                                const active = (b.posEdition ?? 'Standard') === edition;
                                return (
                                  <button
                                    key={edition}
                                    type="button"
                                    onClick={() => updateBranchField(idx, 'posEdition', edition)}
                                    className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold transition cursor-pointer ${
                                      active ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                    {tierLabel(edition)} <span className="font-normal text-slate-400">({allowanceLine(edition)})</span>
                                  </button>
                                );
                              })}
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

          {/* STEP 4: Admin Security Credentials */}
          {step === SECURITY_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
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
                      placeholder="e.g. ali.owner"
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
                      placeholder="4 to 6 digits"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  {signupMode && (
                    <>
                      {/* The back-office sign-in, the way Toast does it: email + password. The PIN
                          above is for the tills. */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-teal-600" /> Email Address*
                        </label>
                        <input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          autoComplete="email"
                          placeholder="owner@example.com"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-teal-600" /> Password*
                        </label>
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          autoComplete="new-password"
                          placeholder="8+ characters, letters and numbers"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-teal-600" /> Confirm Password*
                        </label>
                        <input
                          type="password"
                          value={adminPasswordConfirm}
                          onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                          autoComplete="new-password"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-teal-600" /> Your Mobile Number*
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="tel"
                            value={ownerMobile}
                            onChange={(e) => {
                              setOwnerMobile(e.target.value);
                              // A different number needs its own code.
                              setMobileCodeSent(false);
                              setMobileCode('');
                              setMobileNote(null);
                            }}
                            autoComplete="tel"
                            placeholder="e.g. 0300 1234567"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500"
                          />
                          {needsMobileCode && !mobileVerified && (
                            <button
                              type="button"
                              onClick={sendMobileCode}
                              disabled={mobileBusy || ownerMobile.replace(/\D/g, '').length < 10}
                              className="px-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold shrink-0 transition cursor-pointer"
                            >
                              {mobileCodeSent ? 'Resend' : 'Send code'}
                            </button>
                          )}
                          {needsMobileCode && mobileVerified && (
                            <span className="px-2.5 flex items-center gap-1 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-xs font-bold shrink-0">
                              <Check className="w-3.5 h-3.5" /> Verified
                            </span>
                          )}
                        </div>
                        {needsMobileCode && mobileCodeSent && !mobileVerified && (
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={mobileCode}
                              onChange={(e) => setMobileCode(e.target.value.replace(/\D/g, ''))}
                              autoComplete="one-time-code"
                              placeholder="6-digit code"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm font-mono font-bold tracking-widest text-slate-900 focus:outline-none focus:border-teal-500"
                            />
                            <button
                              type="button"
                              onClick={verifyMobileCode}
                              disabled={mobileBusy || mobileCode.length !== 6}
                              className="px-3 rounded-xl bg-white border border-teal-300 text-teal-700 hover:bg-teal-50 disabled:opacity-40 text-xs font-bold shrink-0 transition cursor-pointer"
                            >
                              Verify
                            </button>
                          </div>
                        )}
                        {mobileNote ? (
                          <p className={`text-[11px] ${mobileNote.tone === 'ok' ? 'text-teal-700' : 'text-rose-600'}`}>{mobileNote.text}</p>
                        ) : (
                          <p className="text-[11px] text-slate-400">
                            One free trial per mobile number{needsMobileCode ? `. We send a code by ${mobileCodes?.channel === 'Console' ? 'text' : mobileCodes?.channel} to check it is yours.` : '.'}
                          </p>
                        )}
                      </div>
                      <p className="md:col-span-3 text-[11px] text-slate-500 -mt-1">
                        <strong>Back office</strong> (reports, menu, settings): sign in with your email and password.{' '}
                        <strong>Tills and tablets</strong>: just your PIN.
                      </p>
                    </>
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
          {step === REVIEW_STEP && (systemType === 'POS_ONLY' || erpRole === 'ERP_SERVER') && (
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
                          <Building2 className="w-4 h-4" /> Multi-Outlet & Chains · Cashly POS + ERP
                        </span>
                      ) : (
                        <span className="text-teal-700 flex items-center gap-1.5">
                          <Store className="w-4 h-4" /> Single Outlet · Cashly POS
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                      {systemType === 'POS_ERP' ? 'ERP & POS Versions' : 'POS Version'}
                    </span>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      {systemType === 'POS_ERP' ? (
                        <span className="text-teal-700">Full ERP included · POS version per shop</span>
                      ) : (
                        <span className="text-teal-700">{tierLabel(selectedPlan)} ({allowanceLine(selectedPlan)})</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Brand & Locations</span>
                    <div className="text-xs text-slate-700">
                      <strong>{restaurantName}</strong> ({currency})
                      <div className="mt-1 text-slate-500">
                        {systemType === 'POS_ERP' ? (
                          <span>
                            HQ: {hqName}
                            {branches.length === 0
                              ? ' (no shops yet; add them later from Locations)'
                              : ` + ${branches.length} outlet${branches.length === 1 ? '' : 's'} (${branches.map(b => `${b.name}: ${tierLabel(b.posEdition ?? 'Standard')}${b.sameAddressAsHq ? ', same building as HQ' : ''}`).join('; ')})`}
                          </span>
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
                      {signupMode && ownerMobile && <div className="text-slate-500">{ownerMobile}</div>}
                    </div>
                  </div>
                </div>

                {/* A few items to try a sale with straight away; one click removes them later. */}
                {signupMode && (
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wantsSampleMenu}
                      onChange={(e) => setSampleMenuChoice(e.target.checked)}
                      className="w-4 h-4 mt-0.5 accent-teal-500"
                    />
                    <span>
                      <strong>Start with a sample menu</strong> (5 food items) so you can try a sale straight away.
                      Remove it with one click from <strong>Getting started</strong> once your own menu is in.
                    </span>
                  </label>
                )}

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
              onClick={() => setStep(previousStepBefore(step))}
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
            step === 2 && systemType === 'POS_ERP' && erpRole === 'POS_TERMINAL' ? (
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
              onClick={requestCompleteSetup}
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

      {/* Confirm before creating */}
      {confirmOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-create-title"
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-create-title" className="text-lg font-extrabold text-slate-900">
              {signupMode ? `Create ${restaurantName.trim() || 'this business'}?` : `Set up ${restaurantName.trim() || 'this business'}?`}
            </h3>
            <div className="text-sm text-slate-600 space-y-1.5">
              <div>
                <span className="text-slate-400">Setup:</span>{' '}
                {systemType === 'POS_ERP'
                  ? 'Multi-Outlet & Chains (Cashly POS + ERP) · full ERP, POS version per outlet'
                  : `Single Outlet (Cashly POS) · ${tierLabel(selectedPlan)} POS version`}
              </div>
              <div>
                <span className="text-slate-400">Locations:</span>{' '}
                {systemType === 'POS_ERP'
                  ? branches.length === 0
                    ? `${hqName} only (add shops later)`
                    : `${hqName} + ${branches.length} outlet${branches.length === 1 ? '' : 's'}`
                  : mainBranchName}
              </div>
              <div>
                <span className="text-slate-400">Owner login:</span>{' '}
                <span className="font-mono font-bold text-slate-900">{adminUsername.trim().toLowerCase()}</span>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              This creates the business, its locations and the owner account straight away. It cannot be undone from the app.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                Go back and check
              </button>
              <button
                type="button"
                onClick={handleCompleteSetup}
                className="px-5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer"
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

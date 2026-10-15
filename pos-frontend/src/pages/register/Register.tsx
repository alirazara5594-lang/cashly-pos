import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Copy, Eye, EyeOff, Link2, Loader2, MonitorSmartphone,
  Plus, Store, Trash2
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { COUNTRIES } from '../../data/countries';
import { restaurantLinkParts, restaurantSignInLink, suggestWebName, webNameProblem } from '../../services/restaurantAddress';
import type { CountryProfile, PublicPackage, SubscriptionTier } from '../../types';
import {
  BUSINESS_KINDS, ERP_FALLBACK_MONTHLY, PLANS, PRIVACY_URL, TERMS_URL, TERMS_VERSION, deviceLine, emailOk, isEasyPin,
  money, passwordProblem, planCopy, planFigures, planName, RECOMMENDED_PLAN, type KindId, type ProductKind
} from './registerCatalog';

// ============================================================
// REGISTRATION — a new business, in the way it will run.
//
// The first question is the product: Cashly POS (one shop, the till and its back office in one app)
// or Cashly POS + ERP (a head office running the ERP, with outlets that each sell on their own POS).
// Each then has its own short path. A POS + ERP business is set up in phases: install the ERP
// (business, head office, owner), add its outlets, then — after registration, from the ERP — link
// each outlet's POS with a pairing code.
//
// The local-install wizard (/setup, pages/InstallationWizard.tsx) is separate: it sets up a
// business server on a PC; this registers a business on Cashly.
// ============================================================

type StepId = 'business' | 'plan' | 'headOffice' | 'owner' | 'outlets' | 'review';
interface StepDef { id: StepId; title: string; phase?: 1 | 2 }

const POS_STEPS: StepDef[] = [
  { id: 'business', title: 'Your business' },
  { id: 'plan', title: 'Your plan' },
  { id: 'owner', title: 'Owner account' },
  { id: 'review', title: 'Review and create' }
];
const ERP_STEPS: StepDef[] = [
  { id: 'business', title: 'Your business', phase: 1 },
  { id: 'headOffice', title: 'Head office', phase: 1 },
  { id: 'owner', title: 'Owner account', phase: 1 },
  { id: 'outlets', title: 'Outlets and their POS', phase: 2 },
  { id: 'review', title: 'Review and create', phase: 2 }
];
const PHASES: Record<1 | 2 | 3, string> = { 1: 'Install the ERP', 2: 'Add outlets', 3: "Link each outlet's POS" };

interface Outlet { name: string; city: string; address: string; edition: SubscriptionTier }
interface Problem { field?: string; text: string }
interface Created { product: ProductKind; name: string; webName: string; username: string; email?: string; outlets: string[] }

// Every step fits one screen: compact fields, and tighter still on a short laptop screen.
const inputCls = 'w-full h-10 px-3.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 transition';
const labelCls = 'block text-sm font-semibold text-slate-700 mb-1';
const hintCls = 'mt-1 text-xs text-slate-500 truncate';
const stepCls = 'space-y-5 [@media(max-height:760px)]:space-y-3';
const gridCls = 'grid md:grid-cols-2 gap-x-4 gap-y-3';

export const Register: React.FC = () => {
  const [product, setProduct] = useState<ProductKind | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const steps = product === 'erp' ? ERP_STEPS : POS_STEPS;
  const step = steps[stepIndex];

  // ── The business ──
  const [kindId, setKindId] = useState<KindId>('restaurant');
  const kind = BUSINESS_KINDS.find(k => k.id === kindId) ?? BUSINESS_KINDS[0];
  const [name, setName] = useState('');
  const [webNameInput, setWebNameInput] = useState('');
  const [webNameEdited, setWebNameEdited] = useState(false);
  const webName = webNameEdited ? webNameInput : suggestWebName(name);
  const [webCheck, setWebCheck] = useState<{ name: string; available: boolean; problem: string | null; alternative: string | null } | null>(null);
  const [webCheckFailedFor, setWebCheckFailedFor] = useState<string | null>(null);
  const [countries, setCountries] = useState<CountryProfile[]>([]);
  const [countryIso, setCountryIso] = useState('PK');
  const [stateCode, setStateCode] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [legalName, setLegalName] = useState('');
  const [ntn, setNtn] = useState('');
  const [strn, setStrn] = useState('');

  // ── Plan (Cashly POS) ──
  const [plan, setPlan] = useState<SubscriptionTier>('Standard');

  // ── Head office and outlets (POS + ERP) ──
  const [hqNameInput, setHqNameInput] = useState('');
  const [hqNameEdited, setHqNameEdited] = useState(false);
  const hqName = hqNameEdited ? hqNameInput : (name.trim() ? `${name.trim()} Head Office` : '');
  const [hqHoldsStock, setHqHoldsStock] = useState(true);
  const [outlets, setOutlets] = useState<Outlet[]>([]);

  // ── Owner ──
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [sampleItems, setSampleItems] = useState<boolean | null>(null);
  const wantsSample = sampleItems ?? kind.food;
  const [agreed, setAgreed] = useState(false);
  // The last day of the 30-day free trial, if registered now.
  const [trialEnds] = useState(() => new Date(Date.now() + 30 * 86400000));

  // ── Progress ──
  const [problem, setProblem] = useState<(Problem & { step: StepId }) | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [stepIndex, product, created]);

  // Prices and allowances, as the server has them.
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [erpMonthly, setErpMonthly] = useState(ERP_FALLBACK_MONTHLY);
  useEffect(() => {
    let cancelled = false;
    posApi.getPublicPackages().then(rows => { if (!cancelled && Array.isArray(rows)) setPackages(rows); }).catch(() => { /* built-in figures */ });
    posApi.getPublicPlatformPrices()
      .then(rows => { const erp = rows.find(r => r.key === 'HEAD_OFFICE_ERP'); if (!cancelled && erp?.monthlyPricePKR) setErpMonthly(erp.monthlyPricePKR); })
      .catch(() => { /* built-in figure */ });
    return () => { cancelled = true; };
  }, []);

  // Countries and their provinces (with the starting tax rates for this kind of business).
  useEffect(() => {
    let cancelled = false;
    posApi.getCountries(kind.pack)
      .then(rows => { if (!cancelled && Array.isArray(rows)) setCountries(rows); })
      .catch(() => { /* the built-in country list stands in */ });
    return () => { cancelled = true; };
  }, [kind.pack]);
  const countryList = countries.length > 0
    ? countries.map(c => ({ iso2: c.iso2, name: c.name }))
    : COUNTRIES.map(c => ({ iso2: c.code, name: c.name }));
  const country = countries.find(c => c.iso2 === countryIso) ?? null;
  const countryName = countryList.find(c => c.iso2 === countryIso)?.name ?? 'Pakistan';
  const states = country?.states ?? [];
  const chosenState = states.find(s => s.code === stateCode) ?? null;

  // The web address is checked with the server as it is typed.
  useEffect(() => {
    if (webNameProblem(webName)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      posApi.checkWebName(webName)
        .then(r => { if (!cancelled) { setWebCheck(r); setWebCheckFailedFor(null); } })
        .catch(() => { if (!cancelled) setWebCheckFailedFor(webName); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [webName]);
  const webLocalProblem = name.trim() || webNameEdited ? webNameProblem(webName) : null;
  const webCheckNow = webCheck && webCheck.name === webName ? webCheck : null;
  const linkParts = restaurantLinkParts();

  const ownerPinOnly = product === 'pos';
  const outletFigures = (tier: SubscriptionTier) => planFigures(tier, packages);
  const monthlyTotal = product === 'erp'
    ? erpMonthly + outlets.reduce((sum, o) => sum + outletFigures(o.edition).branchMonthly, 0)
    : planFigures(plan, packages).monthly;

  // ── Checking a step ──
  const validate = (id: StepId): Problem | null => {
    if (id === 'business') {
      if (!name.trim()) return { field: 'reg-name', text: 'Enter your business name.' };
      const local = webNameProblem(webName);
      if (local) return { field: 'reg-web', text: local };
      if (!webCheckNow) return webCheckFailedFor === webName
        ? { field: 'reg-web', text: 'Could not check the web address: the Cashly server did not answer. Make sure it is running, then try again.' }
        : { field: 'reg-web', text: 'Still checking the web address. Try again in a moment.' };
      if (!webCheckNow.available) return { field: 'reg-web', text: webCheckNow.problem ?? 'That web address is taken.' };
      if (states.length > 0 && !stateCode) return { field: 'reg-state', text: 'Choose your province. It sets your starting sales tax rate.' };
    }
    if (id === 'headOffice' && !hqName.trim()) return { field: 'reg-hq-name', text: 'Give the head office a name.' };
    if (id === 'owner') {
      if (!fullName.trim()) return { field: 'reg-owner-name', text: 'Enter your full name.' };
      if (mobile.replace(/\D/g, '').length < 10) return { field: 'reg-mobile', text: 'Enter your mobile number, for example 0300 1234567.' };
      if (!ownerPinOnly) {
        if (!emailOk(email)) return { field: 'reg-email', text: 'Enter a valid email address.' };
        const pw = passwordProblem(password);
        if (pw) return { field: 'reg-password', text: pw };
        if (password !== password2) return { field: 'reg-password2', text: 'The two passwords do not match.' };
      }
      if (username.trim().length < 3) return { field: 'reg-username', text: 'Use at least 3 characters.' };
      if (!/^[a-z0-9._-]+$/i.test(username.trim())) return { field: 'reg-username', text: 'Use letters, numbers, dots, dashes or underscores.' };
      if (ownerPinOnly ? !/^\d{6}$/.test(pin) : !/^\d{4,6}$/.test(pin))
        return { field: 'reg-pin', text: ownerPinOnly ? 'Use 6 digits. Your PIN is how you sign in everywhere.' : 'Use 4 to 6 digits.' };
      if (isEasyPin(pin)) return { field: 'reg-pin', text: 'Too easy to guess. Avoid 1234, 0000 and the like.' };
    }
    if (id === 'outlets') {
      const unnamed = outlets.findIndex(o => !o.name.trim());
      if (unnamed >= 0) return { field: `reg-outlet-${unnamed}`, text: 'Give this outlet a name, or remove it.' };
    }
    if (id === 'review' && !agreed) return { field: 'reg-agree', text: 'Please agree to the Terms of Service and Privacy Policy.' };
    return null;
  };

  const show = (found: Problem, at: StepId) => {
    const idx = steps.findIndex(s => s.id === at);
    if (idx >= 0 && idx !== stepIndex) setStepIndex(idx);
    setProblem({ ...found, step: at });
    if (found.field) setTimeout(() => {
      const el = document.getElementById(found.field!);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    }, 60);
  };

  const next = () => {
    const found = validate(step.id);
    if (found) { show(found, step.id); return; }
    setProblem(null);
    if (step.id === 'review') { void create(); return; }
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setProblem(null);
    if (stepIndex === 0) { setProduct(null); return; }
    setStepIndex(i => i - 1);
  };

  const create = async () => {
    // Every step again, in case one was left half-done.
    for (const s of steps) {
      const found = validate(s.id);
      if (found) { show(found, s.id); return; }
    }
    setSubmitting(true);
    setProblem(null);
    const isErp = product === 'erp';
    try {
      await posApi.signup({
        restaurantName: name.trim(),
        contactName: fullName.trim(),
        email: isErp ? email.trim() : undefined,
        adminPassword: isErp ? password : undefined,
        phone: mobile.trim(),
        city: city.trim() || undefined,
        address: address.trim() || undefined,
        country: countryName,
        stateCode: chosenState?.code,
        stateName: chosenState?.name,
        adminUsername: username.trim().toLowerCase(),
        adminPin: pin,
        webName,
        businessType: kind.type,
        verticalPack: kind.pack,
        // A head office's own tier is only the default for outlets added later.
        packageKey: isErp ? (outlets[0]?.edition ?? 'Standard') : plan,
        deploymentMode: isErp ? 'MultiBranch' : 'Standalone',
        businessStructure: isErp ? 'ChainWithHeadOffice' : 'SingleShop',
        branches: isErp
          ? outlets.map(o => ({ name: o.name.trim(), city: o.city.trim() || undefined, address: o.address.trim() || undefined, posEdition: o.edition }))
          : [{ name: `${name.trim()} — Main Branch`, city: city.trim() || undefined, address: address.trim() || undefined, phone: mobile.trim() }],
        company: isErp && (legalName.trim() || ntn.trim() || strn.trim())
          ? {
              legalName: legalName.trim() || undefined,
              tradeName: legalName.trim() && legalName.trim() !== name.trim() ? name.trim() : undefined,
              taxRegistrationNumber: ntn.trim() || undefined,
              salesTaxRegistrationNumber: strn.trim() || undefined
            }
          : undefined,
        headOffice: isErp ? { name: hqName.trim(), city: city.trim() || undefined, address: address.trim() || undefined, phone: mobile.trim(), holdsStock: hqHoldsStock } : undefined,
        policies: isErp
          ? { catalogControl: 'HeadOfficeOnly', branchPricing: false, purchasingControl: 'HeadOfficeBuys', allowNegativeStock: true }
          : { allowNegativeStock: true },
        setUpAccounting: true,
        installationType: isErp ? 'POS_ERP' : 'POS_ONLY',
        appSurface: isErp ? 'Erp' : 'Pos',
        ownerMobile: mobile.trim(),
        seedSampleMenu: wantsSample,
        acceptedTerms: agreed,
        termsVersion: TERMS_VERSION
      });
      // The sign-in screen on this device starts where this owner signs in.
      try {
        if (isErp) localStorage.setItem('cashly_login_email', email.trim().toLowerCase());
        else localStorage.removeItem('cashly_login_email');
        localStorage.setItem('cashly_restaurant', name.trim());
      } catch { /* optional */ }
      setCreated({
        product: isErp ? 'erp' : 'pos', name: name.trim(), webName, username: username.trim().toLowerCase(),
        email: isErp ? email.trim() : undefined, outlets: outlets.map(o => o.name.trim())
      });
    } catch (err) {
      setProblem({ step: 'review', text: getApiErrorMessage(err, 'Registration did not go through. Check your connection and try again.') });
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (id: string) => (problem && problem.step === step?.id && problem.field === id ? problem.text : null);
  const errorText = (id: string) => fieldError(id) && <p className="mt-1 text-xs font-semibold text-rose-600" role="alert">{fieldError(id)}</p>;
  const ring = (id: string) => (fieldError(id) ? ' border-rose-400 focus:border-rose-500 focus:ring-rose-500/15' : '');

  // ============================================================
  // Pieces of the page
  // ============================================================

  const brandPanel = (
    <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 text-white flex-col p-8 xl:p-10">
      <div aria-hidden className="absolute -right-28 -top-28 w-80 h-80 rounded-full bg-white/5" />
      <a href="/" className="relative flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white text-teal-800 flex items-center justify-center font-bold text-lg">C</div>
        <span className="text-lg font-bold">Cashly <span className="text-teal-200">POS</span></span>
      </a>

      <div className="relative flex-1 mt-12">
        {!product || created ? (
          <div className="space-y-4">
            <p className="text-2xl font-bold leading-tight">Register your business</p>
            <ul className="space-y-2.5 text-sm text-teal-50">
              {['Free for 30 days', 'No card needed', 'Restaurants, shops, pharmacies and marts', 'Cancel any time'].map(t => (
                <li key={t} className="flex items-center gap-2"><Check className="w-4 h-4 text-teal-200 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-200">{product === 'erp' ? 'Cashly POS + ERP' : 'Cashly POS'}</p>
              <p className="mt-1 text-sm text-teal-50">{product === 'erp' ? 'A head office with outlets' : 'One shop, till and back office together'}</p>
            </div>
            {(product === 'erp' ? [1, 2, 3] as const : [0] as const).map(phase => {
              const phaseSteps = steps.filter(s => (s.phase ?? 0) === phase);
              return (
                <div key={phase} className="space-y-2">
                  {phase !== 0 && (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-teal-200">Phase {phase} · {PHASES[phase]}</p>
                  )}
                  {phaseSteps.map(s => {
                    const idx = steps.indexOf(s);
                    const done = idx < stepIndex;
                    const current = idx === stepIndex;
                    return (
                      <div key={s.id} className={`flex items-center gap-3 text-sm ${current ? 'font-bold text-white' : done ? 'text-teal-100' : 'text-teal-200/70'}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          done ? 'bg-teal-400 text-teal-950' : current ? 'bg-white text-teal-800' : 'border border-teal-300/50'
                        }`}>
                          {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                        </span>
                        {s.title}
                      </div>
                    );
                  })}
                  {phase === 3 && (
                    <p className="flex items-center gap-3 text-sm text-teal-200/70">
                      <span className="w-6 h-6 rounded-full border border-teal-300/50 flex items-center justify-center shrink-0"><Link2 className="w-3 h-3" /></span>
                      After registration, from the ERP
                    </p>
                  )}
                </div>
              );
            })}
            <div className="pt-4 border-t border-white/10">
              <p className="text-xs text-teal-200">After the free trial</p>
              <p className="text-xl font-bold">{money(monthlyTotal)} <span className="text-sm font-semibold text-teal-200">/ month</span></p>
            </div>
          </div>
        )}
      </div>

      <p className="relative text-sm text-teal-100">Already registered? <a href="/" className="font-bold text-white hover:underline">Sign in</a></p>
    </aside>
  );

  // ── Step 0: which product ──
  // Two plain questions. Two or more shops, or a separate head office, means POS + ERP. One shop
  // with no head office means Cashly POS — suggested only once both are answered, since a "yes" to
  // the head office still means POS + ERP. (Opening more shops later is not a reason for the ERP
  // now: a Cashly POS business can add a head office when it grows.)
  const [qSeveralShops, setQSeveralShops] = useState<boolean | null>(null);
  const [qHeadOffice, setQHeadOffice] = useState<boolean | null>(null);
  const suggestion: ProductKind | null =
    qSeveralShops === true || qHeadOffice === true ? 'erp'
      : qSeveralShops === false && qHeadOffice === false ? 'pos'
      : null;

  const productCard = (k: ProductKind) => {
    const isErp = k === 'erp';
    const fromPrice = isErp ? `ERP ${money(erpMonthly)} / month + each outlet from ${money(planFigures('Starter', packages).branchMonthly)}`
      : `From ${money(planFigures('Starter', packages).monthly)} / month`;
    const suggested = suggestion === k;
    return (
      <button type="button" onClick={() => { setProduct(k); setStepIndex(0); setProblem(null); }}
        className={`group text-left rounded-2xl border-2 p-5 [@media(max-height:760px)]:py-4 flex flex-col gap-2.5 transition cursor-pointer hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/30 ${
          suggested ? 'border-teal-500 bg-teal-50/40 shadow-lg' : 'border-slate-200 bg-white hover:border-teal-400'
        }`}>
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0">
            {isErp ? <Building2 className="w-5 h-5" /> : <Store className="w-5 h-5" />}
          </span>
          <h2 className="text-xl font-bold text-slate-900">{isErp ? 'Cashly POS + ERP' : 'Cashly POS'}</h2>
          {suggested && <span className="ml-auto text-[11px] font-bold px-2 py-1 rounded-full bg-teal-600 text-white whitespace-nowrap">Suggested</span>}
        </div>
        <p className="text-sm text-slate-600">
          {isErp ? 'A head office that runs the ERP, and outlets that each sell on their own POS.' : 'One shop. The till and its back office in one app.'}
        </p>
        <ul className="space-y-1.5 text-sm text-slate-700">
          {(isErp
            ? ['Central products, prices, buying and stock', 'Accounts for each company, payroll, consolidated reports', 'Each outlet chooses its own POS version', 'Outlets link to the ERP with a pairing code']
            : ['Sell, take payments, print receipts', 'Stock, customers and reports for the shop', 'Starter, Standard or Enterprise', 'Add a head office later if you grow']
          ).map(t => <li key={t} className="flex gap-2"><Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" /> {t}</li>)}
        </ul>
        <div className="mt-auto pt-3 border-t border-slate-200 space-y-0.5">
          <p className="text-xs text-slate-500">Owner signs in with <strong className="text-slate-700">{isErp ? 'email and password' : 'username and PIN'}</strong></p>
          <p className="text-sm font-bold text-slate-900">{fromPrice}</p>
        </div>
        <span className="inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-teal-600 group-hover:bg-teal-700 text-white text-sm font-bold transition">
          Choose {isErp ? 'POS + ERP' : 'Cashly POS'} <ArrowRight className="w-4 h-4" />
        </span>
      </button>
    );
  };

  /** One question with two answers; `yes` and `no` name the answers ("Two or more" / "One shop"). */
  const question = (value: boolean | null, set: (v: boolean) => void, label: string, yes = 'Yes', no = 'No') => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 [@media(max-height:760px)]:py-1.5">
      <span className="text-sm text-slate-700">{label}</span>
      <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
        {[false, true].map(v => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => set(v)}
            className={`px-3.5 h-8 rounded-lg text-xs font-bold border transition cursor-pointer ${
              value === v ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-teal-400'
            }`}>
            {v ? yes : no}
          </button>
        ))}
      </div>
    </div>
  );

  const chooser = (
    <div className="space-y-4 [@media(max-height:760px)]:space-y-3">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">How will you use Cashly?</h1>
        <p className="text-sm text-slate-600">Choose the setup that matches how your business runs. Both are free for 30 days.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {productCard('pos')}
        {productCard('erp')}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-2.5">
        <p className="text-sm font-bold text-slate-900 pt-1">Not sure? Answer two questions</p>
        <div className="divide-y divide-slate-200">
          {question(qSeveralShops, setQSeveralShops, 'How many shops do you run?', 'Two or more', 'One shop')}
          {question(qHeadOffice, setQHeadOffice, 'Do you need a separate head office to manage stock, buying and accounts?')}
        </div>
        {suggestion && (
          <p className="pb-1.5 text-sm text-teal-800 font-semibold">
            {suggestion === 'erp'
              ? 'Cashly POS + ERP fits you: a head office runs the ERP, each shop sells on its own POS.'
              : 'Cashly POS fits you: one shop, till and back office in one app. Grow later? Add a head office.'}
          </p>
        )}
      </div>
    </div>
  );

  // ── Steps ──
  const stepHeader = (title: string, sub: string) => (
    <div className="space-y-1">
      {step?.phase && <p className="text-xs font-bold uppercase tracking-wider text-teal-700">Phase {step.phase} · {PHASES[step.phase]}</p>}
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 [@media(max-height:760px)]:hidden">{sub}</p>
    </div>
  );

  const businessStep = (
    <div className={stepCls}>
      {stepHeader('Tell us about your business', 'The kind of business decides which screens you get: tables and a kitchen for food, batches and prescriptions for a pharmacy.')}
      <fieldset>
        <legend className={labelCls}>What kind of business is it?</legend>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {BUSINESS_KINDS.map(k => {
            const Icon = k.icon;
            const on = k.id === kindId;
            return (
              <button key={k.id} type="button" onClick={() => { setKindId(k.id); setStateCode(''); }} aria-pressed={on} title={k.hint}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left transition cursor-pointer min-w-0 ${on ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon className="w-4 h-4" /></span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-slate-900 leading-tight">{k.label}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{k.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className={gridCls}>
        <div>
          <label htmlFor="reg-name" className={labelCls}>Business name</label>
          <input id="reg-name" value={name} onChange={e => { setName(e.target.value); setProblem(null); }} placeholder="e.g. Royal Grill" className={inputCls + ring('reg-name')} autoComplete="organization" />
          {errorText('reg-name')}
        </div>
        <div>
          <label htmlFor="reg-web" className={labelCls}>Staff sign-in address</label>
          <div className={`flex items-center h-11 rounded-xl border bg-white overflow-hidden focus-within:ring-4 focus-within:ring-teal-500/15 focus-within:border-teal-500 ${fieldError('reg-web') ? 'border-rose-400' : 'border-slate-300'}`}>
            {linkParts.prefix && <span className="pl-3.5 text-sm text-slate-400 whitespace-nowrap">{linkParts.prefix}</span>}
            <input id="reg-web" value={webName} spellCheck={false}
              onChange={e => { setWebNameEdited(true); setWebNameInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setProblem(null); }}
              placeholder="royalgrill" className="flex-1 min-w-0 h-full px-1 text-sm text-slate-900 focus:outline-none" />
            {linkParts.suffix && <span className="pr-3.5 text-sm text-slate-400 whitespace-nowrap">{linkParts.suffix}</span>}
          </div>
          {errorText('reg-web') || (
            <p className={hintCls}>
              {webLocalProblem ? <span className="text-rose-600">{webLocalProblem}</span>
                : !webName ? 'Your staff open this address to sign in.'
                : webCheckNow ? (webCheckNow.available ? <span className="text-teal-700 font-semibold">Available</span>
                  : <span className="text-rose-600">{webCheckNow.problem ?? 'Taken.'}{webCheckNow.alternative ? ` Try ${webCheckNow.alternative}.` : ''}</span>)
                : webCheckFailedFor === webName ? <span className="text-amber-700">Could not check right now.</span>
                : 'Checking…'}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="reg-country" className={labelCls}>Country</label>
          <select id="reg-country" value={countryIso} onChange={e => { setCountryIso(e.target.value); setStateCode(''); }} className={inputCls}>
            {countryList.map(c => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
          </select>
        </div>
        {states.length > 0 && (
          <div>
            <label htmlFor="reg-state" className={labelCls}>Province</label>
            <select id="reg-state" value={stateCode} onChange={e => { setStateCode(e.target.value); setProblem(null); }} className={inputCls + ring('reg-state')}>
              <option value="">Choose…</option>
              {states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            {errorText('reg-state') || (chosenState && (
              <p className={hintCls}>Starting tax {chosenState.cashTaxRate ?? 0}%{chosenState.digitalTaxRate != null && chosenState.digitalTaxRate !== chosenState.cashTaxRate ? ` (${chosenState.digitalTaxRate}% by card)` : ''}{chosenState.authorityName ? `, ${chosenState.authorityName}` : ''}. Change it in Tax Setup.</p>
            ))}
          </div>
        )}
        <div>
          <label htmlFor="reg-city" className={labelCls}>City <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="reg-city" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Lahore" className={inputCls} autoComplete="address-level2" />
        </div>
        <div className={states.length > 0 ? '' : 'md:col-span-1'}>
          <label htmlFor="reg-address" className={labelCls}>Address <span className="font-normal text-slate-400">(optional)</span></label>
          <input id="reg-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Printed on receipts" className={inputCls} autoComplete="street-address" />
        </div>
      </div>

      {product === 'erp' && (
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 group">
          <summary className="cursor-pointer text-sm font-bold text-slate-900 list-none flex items-center justify-between">
            Company registration (NTN, STRN) <span className="text-xs font-semibold text-slate-400">Optional · add later in Tax Setup</span>
          </summary>
          <div className="grid md:grid-cols-3 gap-3 mt-3 pb-1">
            <div>
              <label htmlFor="reg-legal" className={labelCls}>Legal name</label>
              <input id="reg-legal" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="e.g. Royal Foods (Pvt) Ltd" className={inputCls} />
            </div>
            <div>
              <label htmlFor="reg-ntn" className={labelCls}>NTN</label>
              <input id="reg-ntn" value={ntn} onChange={e => setNtn(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="reg-strn" className={labelCls}>STRN</label>
              <input id="reg-strn" value={strn} onChange={e => setStrn(e.target.value)} className={inputCls} />
            </div>
          </div>
        </details>
      )}
    </div>
  );

  const planStep = (
    <div className={stepCls}>
      {stepHeader('Choose your plan', `For a ${kind.label.toLowerCase()}. Free for 30 days with every feature; you pay only if you stay.`)}
      <div className="grid md:grid-cols-3 gap-3 pt-1">
        {PLANS.map(tier => {
          const f = planFigures(tier, packages);
          const copy = planCopy(kindId, tier);
          const on = plan === tier;
          const recommended = RECOMMENDED_PLAN === tier;
          return (
            <button key={tier} type="button" onClick={() => setPlan(tier)} aria-pressed={on}
              className={`relative text-left rounded-2xl border-2 p-4 flex flex-col gap-2 transition cursor-pointer ${on ? 'border-teal-500 bg-teal-50/50 shadow-lg' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              {recommended && <span className="absolute -top-2.5 left-4 text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-600 text-white">Recommended</span>}
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-slate-900">{planName(tier)}</span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'border-teal-600 bg-teal-600' : 'border-slate-300'}`}>
                  {on && <Check className="w-3 h-3 text-white" />}
                </span>
              </div>
              <p className="text-[13px] text-slate-600 leading-snug">{copy.fits}</p>
              <p>
                <span className="text-xl font-bold text-slate-900">{money(f.monthly)}</span>
                <span className="text-sm text-slate-500"> / month</span>
                <span className="block text-xs text-slate-500">or {money(f.yearly)} a year</span>
              </p>
              <p className="text-xs font-semibold text-teal-800 bg-teal-50 rounded-lg px-2.5 py-1">{deviceLine(f, kind.food)}</p>
              <ul className="space-y-1 text-[13px] leading-snug text-slate-700">
                {tier !== 'Starter' && <li className="text-xs font-semibold text-slate-500">Everything in {planName(PLANS[PLANS.indexOf(tier) - 1])}, plus:</li>}
                {copy.adds.map(a => <li key={a} className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" /> {a}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">Prices exclude tax. Extra tills, tablets and per-shop services (FBR / PRA invoicing, online payments, QR ordering) can be added any time from Plan &amp; Add-ons.</p>
    </div>
  );

  const headOfficeStep = (
    <div className={stepCls}>
      {stepHeader('Your head office', 'The ERP runs here: products and prices, buying, stock, accounts and reports for every outlet. The head office itself does not sell.')}
      <div className={gridCls}>
        <div>
          <label htmlFor="reg-hq-name" className={labelCls}>Head office name</label>
          <input id="reg-hq-name" value={hqName} onChange={e => { setHqNameEdited(true); setHqNameInput(e.target.value); setProblem(null); }} className={inputCls + ring('reg-hq-name')} />
          {errorText('reg-hq-name')}
        </div>
        <div className="flex items-end">
          <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer w-full">
            <input type="checkbox" checked={hqHoldsStock} onChange={e => setHqHoldsStock(e.target.checked)} className="mt-0.5 w-4 h-4 accent-teal-600" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Keeps stock</span>
              <span className="block text-xs text-slate-500">A central store that sends stock to outlets.</span>
            </span>
          </label>
        </div>
      </div>
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 grid sm:grid-cols-3 gap-4 text-sm">
        {[
          { icon: Building2, t: 'Phase 1', d: 'The ERP at your head office, set up now.' },
          { icon: Store, t: 'Phase 2', d: 'Your outlets and the POS version each one runs.' },
          { icon: Link2, t: 'Phase 3', d: "Each outlet's till links to the ERP with a pairing code." }
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex gap-3">
            <Icon className="w-5 h-5 text-teal-600 shrink-0" />
            <span><span className="block font-bold text-slate-900">{t}</span><span className="text-slate-600">{d}</span></span>
          </div>
        ))}
      </div>
    </div>
  );

  const secretType = showSecrets ? 'text' : 'password';
  const ownerStep = (
    <div className={stepCls}>
      {stepHeader('Your owner account', ownerPinOnly
        ? 'No email needed. You sign in everywhere — till and back office — with your username and 6-digit PIN.'
        : 'You sign in to the ERP with your email and password. Your username and PIN sign you in at any outlet till.')}
      <div className={gridCls}>
        <div>
          <label htmlFor="reg-owner-name" className={labelCls}>Full name</label>
          <input id="reg-owner-name" value={fullName} onChange={e => { setFullName(e.target.value); setProblem(null); }} className={inputCls + ring('reg-owner-name')} autoComplete="name" />
          {errorText('reg-owner-name')}
        </div>
        <div>
          <label htmlFor="reg-mobile" className={labelCls}>Mobile number</label>
          <input id="reg-mobile" type="tel" value={mobile} onChange={e => { setMobile(e.target.value); setProblem(null); }} placeholder="0300 1234567" className={inputCls + ring('reg-mobile')} autoComplete="tel" />
          {errorText('reg-mobile') || <p className={hintCls}>One free trial per number. Support uses it to confirm it is you.</p>}
        </div>
        {!ownerPinOnly && (
          <>
            <div className="md:col-span-2">
              <label htmlFor="reg-email" className={labelCls}>Email</label>
              <input id="reg-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setProblem(null); }} placeholder="you@yourbusiness.com" className={inputCls + ring('reg-email')} autoComplete="email" />
              {errorText('reg-email')}
            </div>
            <div>
              <label htmlFor="reg-password" className={labelCls}>Password</label>
              <input id="reg-password" type={secretType} value={password} onChange={e => { setPassword(e.target.value); setProblem(null); }} className={inputCls + ring('reg-password')} autoComplete="new-password" />
              {errorText('reg-password') || <p className={hintCls}>At least 8 characters, with letters and numbers.</p>}
            </div>
            <div>
              <label htmlFor="reg-password2" className={labelCls}>Confirm password</label>
              <input id="reg-password2" type={secretType} value={password2} onChange={e => { setPassword2(e.target.value); setProblem(null); }} className={inputCls + ring('reg-password2')} autoComplete="new-password" />
              {errorText('reg-password2')}
            </div>
          </>
        )}
        <div>
          <label htmlFor="reg-username" className={labelCls}>Username</label>
          <input id="reg-username" value={username} onChange={e => { setUsername(e.target.value.replace(/\s/g, '')); setProblem(null); }} placeholder="e.g. ali" className={inputCls + ring('reg-username')} autoComplete="username" spellCheck={false} />
          {errorText('reg-username')}
        </div>
        <div>
          <label htmlFor="reg-pin" className={labelCls}>{ownerPinOnly ? '6-digit PIN' : 'Till PIN (4 to 6 digits)'}</label>
          <input id="reg-pin" type={secretType} inputMode="numeric" value={pin} maxLength={6}
            onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setProblem(null); }} className={inputCls + ' tracking-[0.4em] font-mono' + ring('reg-pin')} autoComplete="new-password" />
          {errorText('reg-pin') || <p className={hintCls}>Not 1234, 0000 or your birth year.</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button type="button" onClick={() => setShowSecrets(v => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-teal-700 cursor-pointer">
          {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showSecrets ? 'Hide' : 'Show'} {ownerPinOnly ? 'PIN' : 'password and PIN'}
        </button>
        {kind.food && (
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={wantsSample} onChange={e => setSampleItems(e.target.checked)} className="w-4 h-4 accent-teal-600" />
            Start with a few sample items, to try a sale straight away
          </label>
        )}
      </div>
    </div>
  );

  const addOutlet = () => setOutlets(list => [...list, { name: '', city: city.trim(), address: '', edition: 'Standard' }]);
  const outletsStep = (
    <div className={stepCls}>
      {stepHeader('Your outlets and their POS', 'Each outlet sells with its own POS and pays for its own version. Add them now, or later from the ERP (Locations).')}
      <div className="grid sm:grid-cols-3 gap-2">
        {PLANS.map(tier => {
          const f = outletFigures(tier);
          return (
            <div key={tier} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <p className="text-sm font-bold text-slate-900">{planName(tier)} <span className="font-semibold text-slate-500">· {money(f.branchMonthly)} / month</span></p>
              <p className="text-xs text-slate-500 truncate" title={planCopy(kindId, tier).fits}>{planCopy(kindId, tier).fits}</p>
              <p className="text-xs font-semibold text-teal-800 mt-1">{deviceLine(f, kind.food)}</p>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {outlets.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
            No outlets yet. You can register with the head office alone and add outlets from the ERP.
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="hidden md:grid grid-cols-12 gap-3 px-3 pt-2.5 pb-1 text-xs font-semibold text-slate-500">
              <span className="col-span-4">Outlet name</span>
              <span className="col-span-3">City</span>
              <span className="col-span-4">POS version</span>
            </div>
            {/* A long list scrolls inside this box; the page itself stays on one screen. */}
            <div className="max-h-[34vh] overflow-y-auto px-3 pb-3 pt-2 md:pt-0 space-y-2">
              {outlets.map((o, i) => (
                <div key={i} className="grid grid-cols-12 gap-x-3 gap-y-2 items-start">
                  <div className="col-span-12 md:col-span-4">
                    <input id={`reg-outlet-${i}`} aria-label={`Outlet ${i + 1} name`} value={o.name}
                      onChange={e => { const v = e.target.value; setOutlets(list => list.map((x, j) => j === i ? { ...x, name: v } : x)); setProblem(null); }}
                      placeholder={`Outlet ${i + 1}, e.g. Gulberg`} className={inputCls + ring(`reg-outlet-${i}`)} />
                    {errorText(`reg-outlet-${i}`)}
                  </div>
                  <div className="col-span-5 md:col-span-3">
                    <input aria-label={`Outlet ${i + 1} city`} value={o.city} placeholder="City"
                      onChange={e => { const v = e.target.value; setOutlets(list => list.map((x, j) => j === i ? { ...x, city: v } : x)); }} className={inputCls} />
                  </div>
                  <div className="col-span-5 md:col-span-4">
                    <select aria-label={`Outlet ${i + 1} POS version`} value={o.edition}
                      onChange={e => { const v = e.target.value as SubscriptionTier; setOutlets(list => list.map((x, j) => j === i ? { ...x, edition: v } : x)); }} className={inputCls}>
                      {PLANS.map(t => <option key={t} value={t}>{planName(t)} · {money(outletFigures(t).branchMonthly)} / month</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 md:col-span-1 flex justify-end">
                    <button type="button" onClick={() => setOutlets(list => list.filter((_, j) => j !== i))} aria-label={`Remove outlet ${i + 1}`}
                      className="h-10 w-10 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <button type="button" onClick={addOutlet}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border-2 border-teal-600 text-teal-700 hover:bg-teal-50 text-sm font-bold transition cursor-pointer">
          <Plus className="w-4 h-4" /> Add an outlet
        </button>
      </div>
    </div>
  );

  const reviewRow = (label: string, value: React.ReactNode, editTo: StepId) => (
    <div className="flex items-start justify-between gap-4 py-2 [@media(max-height:760px)]:py-1.5">
      <span className="text-sm text-slate-500 w-40 shrink-0">{label}</span>
      <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 break-words">{value}</span>
      <button type="button" onClick={() => { setProblem(null); setStepIndex(steps.findIndex(s => s.id === editTo)); }} className="text-xs font-bold text-teal-700 hover:text-teal-800 cursor-pointer">Edit</button>
    </div>
  );
  const signInAddress = restaurantSignInLink(webName).replace(/^https?:\/\//, '');
  const reviewStep = (
    <div className={stepCls}>
      {stepHeader('Review and create', 'Check the details, then create your business. Your 30-day free trial starts today.')}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 divide-y divide-slate-100">
        {reviewRow('Setup', product === 'erp' ? 'Cashly POS + ERP (head office and outlets)' : 'Cashly POS (one shop)', 'business')}
        {reviewRow('Business', `${name.trim()} · ${kind.label}`, 'business')}
        {reviewRow('Location', [city.trim(), chosenState?.name, countryName].filter(Boolean).join(', '), 'business')}
        {reviewRow('Staff sign-in address', signInAddress, 'business')}
        {product === 'pos' && reviewRow('Plan', `${planName(plan)} · ${money(planFigures(plan, packages).monthly)} / month`, 'plan')}
        {product === 'erp' && reviewRow('Head office', `${hqName.trim()}${hqHoldsStock ? ' · keeps stock' : ''}`, 'headOffice')}
        {product === 'erp' && reviewRow('Outlets', outlets.length === 0 ? 'None yet. Add them from the ERP.'
          : outlets.map(o => `${o.name.trim()} (${planName(o.edition)})`).join(', '), 'outlets')}
        {reviewRow('Owner', `${fullName.trim()} · ${mobile.trim()}`, 'owner')}
        {reviewRow('Owner signs in with', product === 'erp' ? `${email.trim()} and password; username ${username.trim().toLowerCase()} + PIN at tills` : `username ${username.trim().toLowerCase()} and 6-digit PIN`, 'owner')}
      </div>

      <div className="rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-teal-900">Free until {trialEnds.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="text-xs text-teal-800">
            {product === 'erp'
              ? `Then ${money(erpMonthly)} for the ERP${outlets.length ? ` + ${money(monthlyTotal - erpMonthly)} for ${outlets.length} outlet${outlets.length === 1 ? '' : 's'}` : ''} a month. No card needed now.`
              : 'No card needed now. Pay only if you stay.'}
          </p>
        </div>
        <p className="text-2xl font-bold text-teal-900">{money(monthlyTotal)}<span className="text-sm font-semibold"> / month</span></p>
      </div>

      <label htmlFor="reg-agree" className={`flex items-start gap-3 px-4 py-3 rounded-2xl border cursor-pointer ${fieldError('reg-agree') ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'}`}>
        <input id="reg-agree" type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setProblem(null); }} className="mt-0.5 w-4 h-4 accent-teal-600" />
        <span className="text-sm text-slate-700">
          I agree to the{' '}
          {TERMS_URL ? <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-semibold text-teal-700 underline">Terms of Service</a> : <strong>Terms of Service</strong>}
          {' '}and{' '}
          {PRIVACY_URL ? <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-semibold text-teal-700 underline">Privacy Policy</a> : <strong>Privacy Policy</strong>}
          , and confirm I may register this business.
        </span>
      </label>
      {errorText('reg-agree')}
    </div>
  );

  // ── After registration ──
  const success = created && (() => {
    const isErp = created.product === 'erp';
    const link = restaurantSignInLink(created.webName);
    const copyLink = () => {
      navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => { /* the link is on screen */ });
    };
    return (
      <div className="space-y-8">
        <div className="space-y-3">
          <CheckCircle2 className="w-12 h-12 text-teal-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{isErp ? 'Your ERP is ready' : 'Your POS is ready'}</h1>
          <p className="text-slate-600">
            <strong className="text-slate-900">{created.name}</strong> is registered. Your free trial runs for 30 days.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <p className="text-sm font-bold text-slate-900">Staff sign-in address</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 break-all px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-800">{link}</code>
            <button type="button" onClick={copyLink} className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              {copied ? <><Check className="w-4 h-4 text-teal-600" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {isErp ? <>You sign in to the ERP with <strong>{created.email}</strong>. Staff at the outlets use this address with their username and PIN.</>
              : <>Sign in with username <strong>{created.username}</strong> and your PIN. Keep this address on the till's browser.</>}
          </p>
        </div>

        {isErp ? (
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-900">What happens next</p>
            <ol className="space-y-3">
              <li className="flex gap-3"><span className="w-7 h-7 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center shrink-0"><Check className="w-4 h-4" /></span>
                <span className="text-sm text-slate-700"><strong className="text-slate-900">Phase 1 · ERP installed.</strong> Sign in with your email to set up products, prices, suppliers and tax.</span></li>
              <li className="flex gap-3"><span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${created.outlets.length ? 'bg-teal-600 text-white' : 'border-2 border-teal-600 text-teal-700'}`}>{created.outlets.length ? <Check className="w-4 h-4" /> : 2}</span>
                <span className="text-sm text-slate-700"><strong className="text-slate-900">Phase 2 · Outlets.</strong> {created.outlets.length ? `${created.outlets.join(', ')} added.` : 'Add your outlets in the ERP under Locations.'} You can add more any time.</span></li>
              <li className="flex gap-3"><span className="w-7 h-7 rounded-full border-2 border-teal-600 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">3</span>
                <span className="text-sm text-slate-700"><strong className="text-slate-900">Phase 3 · Link each outlet's POS.</strong> In the ERP open <strong>Locations</strong> and press <strong>Connect a till</strong> on an outlet to get a pairing code. At the outlet, open Cashly in the browser, choose <strong>Connect a till or tablet</strong> and type the code. The till is then linked: sales, stock and products flow to the ERP.</span></li>
            </ol>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-bold text-slate-900">Get started</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { t: 'Sell on this computer', d: 'Sign in and the till opens. Nothing to install.' },
                { t: 'Add your products', d: wantsSample ? 'Try a sale with the sample items first.' : 'Add products and prices, or import them.' },
                { t: 'Check your tax', d: 'Tax Setup has your province rate; confirm it with your accountant.' },
                { t: 'Another till or tablet', d: 'Settings → Devices makes a pairing code for it.' }
              ].map(({ t, d }) => (
                <div key={t} className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-sm font-bold text-slate-900">{t}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{d}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <a href={isErp ? '/' : link}
            className="inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition shadow-lg shadow-teal-600/20">
            {isErp ? 'Sign in to the ERP' : 'Open my POS'} <ArrowRight className="w-4 h-4" />
          </a>
          {isErp && (
            <a href="/connect" className="inline-flex items-center gap-2 h-12 px-5 rounded-2xl border-2 border-slate-300 text-slate-700 hover:bg-slate-50 font-bold transition">
              <MonitorSmartphone className="w-4 h-4" /> This computer is an outlet till
            </a>
          )}
        </div>
      </div>
    );
  })();

  const stepContent: Record<StepId, React.ReactNode> = {
    business: businessStep, plan: planStep, headOffice: headOfficeStep, owner: ownerStep, outlets: outletsStep, review: reviewStep
  };
  const generalProblem = problem && !problem.field ? problem.text : null;
  const progressLabel = useMemo(() => (product ? `Step ${stepIndex + 1} of ${steps.length}` : ''), [product, stepIndex, steps.length]);

  return (
    <div className="h-screen w-full flex bg-white text-slate-900">
      {brandPanel}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Phone header */}
        <div className="lg:hidden flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <a href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold">C</div>
            <span className="font-bold">Cashly <span className="text-teal-600">POS</span></span>
          </a>
          <span className="text-xs font-semibold text-slate-500">{created ? 'Done' : progressLabel || <a href="/" className="text-teal-700">Sign in</a>}</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-5 md:px-10 py-6 [@media(max-height:760px)]:py-4">
            {created ? success : !product ? chooser : stepContent[step.id]}
            {generalProblem && !created && (
              <div className="mt-6 px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-sm font-semibold text-rose-700" role="alert">{generalProblem}</div>
            )}
          </div>
        </div>

        {/* Back / Continue, always in reach */}
        {product && !created && (
          <div className="border-t border-slate-200 bg-white px-5 md:px-10 py-3.5">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
              <button type="button" onClick={back} disabled={submitting}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer">
                <ArrowLeft className="w-4 h-4" /> {stepIndex === 0 ? 'Change setup' : 'Back'}
              </button>
              <span className="hidden sm:block text-xs font-semibold text-slate-400">{progressLabel}</span>
              <button type="button" onClick={next} disabled={submitting}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-bold transition shadow-lg shadow-teal-600/20 cursor-pointer">
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                  : step.id === 'review' ? <>Create my business <ArrowRight className="w-4 h-4" /></>
                  : <>Continue <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

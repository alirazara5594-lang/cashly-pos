import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store,
  User,
  Mail,
  Phone,
  MapPin,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Layers,
  Check,
  ChevronDown,
  Globe
} from 'lucide-react';
import { posApi } from '../services/api';
import type {
  BusinessType,
  PublicPackage,
  CountryProfile,
  VerticalPackInfo,
  ItemCapabilities,
  FlowCapabilities
} from '../types';

/**
 * The business list is not hard-coded here — it comes from the server's vertical-pack catalogue,
 * which is what actually decides the POS layout, the item fields and the wording this business
 * will see. Adding a sector is a server-side data change; this screen just renders the list.
 */

/**
 * Plain-English labels for the capability flags a pack turns on, so the person choosing can see
 * what the choice means. "Pharmacy" versus "Retail" tells you nothing until you can see that one
 * gives you batch and expiry tracking and the other does not.
 *
 * Only flags present on the selected pack are rendered, so this list can safely outgrow any one
 * sector, and a capability added server-side simply needs a label added here to become visible.
 */
const PACK_HIGHLIGHTS: { key: keyof (ItemCapabilities & FlowCapabilities); label: string }[] = [
  { key: 'tableService', label: 'Tables & floor plan' },
  { key: 'kitchenRouting', label: 'Kitchen tickets' },
  { key: 'modifiers', label: 'Item options' },
  { key: 'recipeBom', label: 'Recipes & ingredients' },
  { key: 'quickSale', label: 'Fast barcode checkout' },
  { key: 'variants', label: 'Size / colour variants' },
  { key: 'batchExpiry', label: 'Batch & expiry tracking' },
  { key: 'prescriptionRequired', label: 'Prescriptions' },
  { key: 'weighable', label: 'Weighed items & scale' },
  { key: 'serialNumbers', label: 'Serial numbers' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'serviceDuration', label: 'Timed services' },
  { key: 'staffCommission', label: 'Staff commission' },
  { key: 'tieredPricing', label: 'Volume pricing' },
  { key: 'creditAccounts', label: 'Customer credit' },
  { key: 'deliveryNotes', label: 'Delivery notes' },
  { key: 'delivery', label: 'Delivery & riders' }
];

/**
 * Legacy BusinessType still exists on the tenant record and a few older screens read it, so a
 * pack choice is mapped back onto it. The pack is authoritative; this keeps old code coherent.
 */
function packToLegacyBusinessType(packKey: string): BusinessType {
  switch (packKey) {
    case 'restaurant': return 'Restaurant';
    case 'grocery':
    case 'wholesale': return 'CashAndCarry';
    default: return 'Retail';
  }
}

/** ISO2 -> 🇵🇰-style flag emoji, via the regional-indicator-symbol Unicode trick. */
function isoToFlagEmoji(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return '🌐';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}

/** Local-number placeholder shown under the dial code, per country's everyday format. */
function phonePlaceholderFor(iso2: string): string {
  switch (iso2) {
    case 'PK': return '300-1234567';
    case 'AE': return '50-123-4567';
    case 'SA': return '50-123-4567';
    case 'GB': return '7911-123456';
    case 'US':
    case 'CA': return '(201) 555-0123';
    case 'IN': return '98765-43210';
    default: return 'phone number';
  }
}

/**
 * Groups digits as the user types into the everyday format for a handful of countries this
 * product actually targets (dashes as visual grouping only — the raw digits are what's sent).
 * Everything else just gets digit-only input with no mask, since a made-up grouping for a
 * country we've never verified would be worse than no grouping at all.
 */
function formatPhoneLocal(iso2: string, raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (iso2 === 'PK') {
    const d = digits.replace(/^0/, '').slice(0, 10);
    return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  }
  if (iso2 === 'AE' || iso2 === 'SA') {
    const d = digits.replace(/^0/, '').slice(0, 9);
    if (d.length > 5) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length > 2) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return d;
  }
  if (iso2 === 'US' || iso2 === 'CA') {
    const d = digits.slice(0, 10);
    if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return d;
  }
  return digits.slice(0, 15);
}

const TOTAL_STEPS = 5;

export const TenantSignup: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [verticalPacks, setVerticalPacks] = useState<VerticalPackInfo[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);

  const [countries, setCountries] = useState<CountryProfile[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);

  const [form, setForm] = useState({
    restaurantName: '',
    businessType: 'Restaurant' as BusinessType,
    /** The sector pack — what actually shapes this tenant's product. */
    verticalPack: 'restaurant',
    city: '',
    address: '',
    country: 'Pakistan',
    stateCode: '',
    stateName: '',
    contactName: '',
    email: '',
    phone: '',
    phoneCountryIso2: 'PK',
    adminUsername: '',
    adminPin: '',
    adminPinConfirm: '',
    packageKey: 'Starter'
  });

  useEffect(() => {
    let cancelled = false;
    posApi.getPublicPackages()
      .then(data => { if (!cancelled) setPackages(Array.isArray(data) ? data : []); })
      .catch(() => { /* plan picker degrades to "Starter" default, signup still works */ })
      .finally(() => { if (!cancelled) setPackagesLoading(false); });
    posApi.getCountries()
      .then(data => { if (!cancelled) setCountries(Array.isArray(data) ? data : []); })
      .catch(() => { /* falls back to a plain text country field if this doesn't load */ })
      .finally(() => { if (!cancelled) setCountriesLoading(false); });
    posApi.getVerticalPackCatalog()
      .then(data => { if (!cancelled) setVerticalPacks(Array.isArray(data) ? data : []); })
      .catch(() => { /* the server still defaults the pack from BusinessType if this fails */ });
    return () => { cancelled = true; };
  }, []);

  const selectedCountry = countries.find(c => c.name === form.country) || null;
  const phoneDialCountry: Pick<CountryProfile, 'iso2' | 'phoneCode'> =
    countries.find(c => c.iso2 === form.phoneCountryIso2) || { iso2: 'PK', phoneCode: '+92' };

  // Reset the picked state whenever the country changes underneath it — a leftover
  // Punjab/Sindh code from Pakistan makes no sense once UAE is selected.
  useEffect(() => {
    setForm(prev => ({ ...prev, stateCode: '', stateName: '' }));
  }, [form.country]);

  const update = useCallback(<K extends keyof typeof form>(field: K, value: typeof form[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  }, []);

  /** The pack currently chosen, for the capability preview under the dropdown. */
  const selectedPack = verticalPacks.find(p => p.key === form.verticalPack) ?? null;

  // Step 1 — business type only. The dropdown always holds a valid value once the catalogue
  // loads, so the only real failure is answering before it arrives.
  const validateStep1 = () => {
    if (!form.verticalPack) return setError('Choose what kind of business this is'), false;
    return true;
  };

  // Step 2 — plan. `packageKey` defaults to Starter, so this only guards the loading window.
  const validateStep2 = () => {
    if (!form.packageKey) return setError('Choose a plan to continue'), false;
    return true;
  };

  // Step 3 — the business itself: what it is called and where it is.
  const validateStep3 = () => {
    if (!form.restaurantName.trim()) return setError('Business name is required'), false;
    return true;
  };

  // Step 4 — the owner's account. Kept apart from step 3 so a credential problem never sends
  // someone back to re-check their address, and vice versa.
  const validateStep4 = () => {
    if (!form.contactName.trim()) return setError('Your name is required'), false;
    if (!form.email.trim() || !form.email.includes('@')) return setError('Valid email is required'), false;
    if (!form.phone.trim()) return setError('Phone number is required'), false;
    if (!form.adminUsername.trim() || form.adminUsername.length < 3) return setError('Username must be at least 3 characters'), false;
    if (!form.adminPin || form.adminPin.length !== 4) return setError('PIN must be exactly 4 digits'), false;
    if (form.adminPin !== form.adminPinConfirm) return setError('PINs do not match'), false;
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
    else if (step === 3 && validateStep3()) setStep(4);
    else if (step === 4 && validateStep4()) setStep(5);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await posApi.signup({
        restaurantName: form.restaurantName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: `${phoneDialCountry.phoneCode} ${form.phone.trim()}`.trim(),
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        country: form.country,
        stateCode: form.stateCode || undefined,
        stateName: form.stateName.trim() || undefined,
        adminUsername: form.adminUsername.trim().toLowerCase(),
        adminPin: form.adminPin,
        businessType: form.businessType,
        packageKey: form.packageKey,
        verticalPack: form.verticalPack
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPackage = packages.find(p => p.packageKey === form.packageKey);

  if (success) {
    return (
      <div className="min-h-screen h-screen overflow-y-auto bg-slate-50 flex items-start sm:items-center justify-center p-4 py-8">
        <div className="w-full max-w-lg text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-teal-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 mb-2">You're all set!</h1>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-900">{form.restaurantName}</span> is now live on Cashly POS
              {selectedPackage ? <> on the <span className="font-bold text-slate-900">{selectedPackage.displayName}</span> plan</> : null}.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Your 30-day free trial has started. No credit card required.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-2">
            <div className="text-xs text-slate-500">Login credentials:</div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Username</span>
              <span className="text-xs text-slate-900 font-mono font-bold">{form.adminUsername}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">PIN</span>
              <span className="text-xs text-slate-900 font-mono font-bold">{form.adminPin}</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition shadow-lg shadow-teal-500/25"
          >
            Open POS Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl space-y-3 max-h-full overflow-y-auto">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto shadow-lg shadow-teal-500/25">
            <Store className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">Register Your Business</h1>
          <p className="text-sm text-slate-600">Start your 30-day free trial. No credit card required.</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 justify-center">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                step >= s ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' : 'bg-slate-100 text-slate-500'
              }`}>{s}</div>
              {s < TOTAL_STEPS && <div className={`w-8 h-0.5 ${step > s ? 'bg-teal-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Which business is this? Everything downstream — the POS layout, the item
            fields, the wording, which sector screens exist — follows from this one answer,
            so it is asked first and on its own. */}
        {step === 1 && (
          <div className="space-y-4 p-6 rounded-2xl bg-white border border-slate-200">
            <div className="space-y-1">
              <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">What kind of business?</h2>
              <p className="text-sm text-slate-500">This sets up the right screens and fields for your trade. You can add more later.</p>
            </div>

            <div className="relative">
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <select
                value={form.verticalPack}
                onChange={(e) => {
                  update('verticalPack', e.target.value);
                  // Keep the legacy BusinessType field coherent for older screens that read it.
                  update('businessType', packToLegacyBusinessType(e.target.value));
                }}
                disabled={verticalPacks.length === 0}
                className="w-full pl-9 pr-9 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none disabled:opacity-50"
              >
                {verticalPacks.length === 0
                  ? <option>Loading business types…</option>
                  : verticalPacks.map(pack => (
                      <option key={pack.key} value={pack.key}>{pack.displayName}</option>
                    ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>

            {/* What the choice actually buys them. Shown because "Pharmacy" vs "Retail" is not
                self-explanatory until you see that one gives you batch/expiry and the other does not. */}
            {selectedPack && (
              <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 space-y-2.5">
                <p className="text-xs text-teal-800 leading-relaxed">{selectedPack.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {PACK_HIGHLIGHTS
                    .filter(h => selectedPack.capabilities?.[h.key])
                    .map(h => (
                      <span key={h.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-teal-200 text-[11px] font-semibold text-teal-700">
                        <Check className="w-3 h-3" /> {h.label}
                      </span>
                    ))}
                </div>
                <div className="pt-1.5 border-t border-teal-200 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-teal-800">
                  <span><span className="opacity-70">Your catalog:</span> <strong>{selectedPack.catalogNoun}</strong></span>
                  <span><span className="opacity-70">Each sale:</span> <strong>{selectedPack.saleNoun}</strong></span>
                </div>
              </div>
            )}

            <button
              onClick={handleNext}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Plan */}
        {step === 2 && (
          <div className="space-y-3.5 p-6 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">Choose Your Plan</h2>
            <p className="text-sm text-slate-500">Every plan gets the full 30-day trial — this just sets your branch/counter/user limits after that. Switch anytime.</p>

            {packagesLoading ? (
              <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading plans…
              </div>
            ) : packages.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">
                Couldn't load plans — you'll start on Starter and can upgrade later.
              </div>
            ) : (
              <div className="space-y-2.5">
                {packages.map(pkg => {
                  const active = form.packageKey === pkg.packageKey;
                  return (
                    <button
                      key={pkg.packageKey}
                      type="button"
                      onClick={() => update('packageKey', pkg.packageKey)}
                      className={`w-full text-left p-3.5 rounded-xl border transition flex items-start justify-between gap-3 ${
                        active ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-black ${active ? 'text-teal-700' : 'text-slate-900'}`}>{pkg.displayName}</span>
                          {active && <Check className="w-4 h-4 text-teal-600" />}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {pkg.maxBranches >= 999 ? 'Unlimited branches' : `${pkg.maxBranches} branch${pkg.maxBranches > 1 ? 'es' : ''}`}
                          {' · '}
                          {pkg.maxCounters} counter{pkg.maxCounters > 1 ? 's' : ''}
                          {' · '}
                          {pkg.maxOrderTabs} tablet{pkg.maxOrderTabs > 1 ? 's' : ''}
                          {' · '}
                          {pkg.maxUsers >= 999 ? 'unlimited' : pkg.maxUsers} users
                          {pkg.hasKitchenDisplay ? ' · Kitchen display' : ''}
                          {pkg.hasDeliveryCOD ? ' · Delivery/COD' : ''}
                          {pkg.hasInventoryManagement ? ' · Inventory' : ''}
                          {pkg.hasMultiBranch ? ' · Multi-branch' : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-base font-black ${active ? 'text-teal-700' : 'text-slate-900'}`}>₨{pkg.monthlyPricePKR.toLocaleString()}</div>
                        <div className="text-xs text-slate-400">/month</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: The business itself — its name and where it trades. Drives currency and
            the starting tax profile, which is why the country/province picker lives here. */}
        {step === 3 && (
          <div className="space-y-3.5 p-6 rounded-2xl bg-white border border-slate-200">
            <div className="space-y-1">
              <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">Business Details</h2>
              <p className="text-sm text-slate-500">Where you trade. This sets your currency and starting tax rates.</p>
            </div>

            <div className="relative">
              <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.restaurantName}
                onChange={(e) => update('restaurantName', e.target.value)}
                placeholder="Business name"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  disabled={countriesLoading}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none disabled:opacity-50"
                >
                  {countriesLoading
                    ? <option>Loading…</option>
                    : countries.map(c => <option key={c.iso2} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder="City"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>
            </div>

            {selectedCountry?.states && selectedCountry.states.length > 0 ? (
              <select
                value={form.stateCode}
                onChange={(e) => {
                  const st = selectedCountry.states?.find(s => s.code === e.target.value);
                  setForm(prev => ({ ...prev, stateCode: e.target.value, stateName: st?.name || '' }));
                }}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none"
              >
                <option value="">{form.country === 'Pakistan' ? 'Province' : 'State/Region'} (optional)</option>
                {selectedCountry.states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            ) : (
              <input
                value={form.stateName}
                onChange={(e) => update('stateName', e.target.value)}
                placeholder="State/Province (optional)"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            )}

            <input
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              placeholder="Address (optional)"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
            />

            {selectedCountry && (() => {
              const st = selectedCountry.states?.find(s => s.code === form.stateCode);
              const cash = st?.cashTaxRate ?? selectedCountry.defaultTaxRate;
              const digital = st?.digitalTaxRate ?? selectedCountry.digitalTaxRate;
              const usesDual = selectedCountry.useDualTaxRate || st?.cashTaxRate != null;
              return (
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-snug">
                  <span className="font-bold text-slate-800">
                    Starting tax{st ? ` (${st.name})` : ''}: {selectedCountry.currencyCode} · {
                      usesDual && cash != null
                        ? `${cash}% cash / ${digital}% digital`
                        : cash != null
                          ? `${cash}% flat`
                          : 'not configured'
                    }.
                  </span> Editable anytime in Tax Configuration.
                </div>
              );
            })()}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: The owner's own account — kept separate from the business details because
            it is a different kind of answer (who you are, not where the shop is) and because
            the PIN deserves a screen where it is the only thing being asked for. */}
        {step === 4 && (
          <div className="space-y-3.5 p-6 rounded-2xl bg-white border border-slate-200">
            <div className="space-y-1">
              <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">Owner Account</h2>
              <p className="text-sm text-slate-500">This becomes your Owner/Admin login — full access to everything.</p>
            </div>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Your full name"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="Email address"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <div className="relative shrink-0 w-28">
                <select
                  value={form.phoneCountryIso2}
                  onChange={(e) => update('phoneCountryIso2', e.target.value)}
                  disabled={countriesLoading}
                  className="w-full pl-2.5 pr-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none disabled:opacity-50"
                >
                  {countriesLoading
                    ? <option>…</option>
                    : countries.map(c => (
                        <option key={c.iso2} value={c.iso2}>{isoToFlagEmoji(c.iso2)} {c.phoneCode}</option>
                      ))}
                </select>
              </div>
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={form.phone}
                  onChange={(e) => update('phone', formatPhoneLocal(form.phoneCountryIso2, e.target.value))}
                  placeholder={phonePlaceholderFor(form.phoneCountryIso2)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono"
                />
              </div>
            </div>

            <div className="h-px bg-slate-100" />

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.adminUsername}
                onChange={(e) => update('adminUsername', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="Admin username"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.adminPin}
                  onChange={(e) => update('adminPin', e.target.value.replace(/\D/g, ''))}
                  placeholder="4-digit PIN"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono tracking-[0.3em]"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.adminPinConfirm}
                  onChange={(e) => update('adminPinConfirm', e.target.value.replace(/\D/g, ''))}
                  placeholder="Confirm PIN"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono tracking-[0.3em]"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}


        {/* Step 5: Review & Create */}
        {step === 5 && (
          <div className="space-y-2.5 p-5 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">Review &amp; Create</h2>

            <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
              {[
                { label: 'Business', value: form.restaurantName },
                { label: 'Sector', value: verticalPacks.find(p => p.key === form.verticalPack)?.displayName ?? form.verticalPack },
                { label: 'Country', value: form.country },
                ...(form.stateName ? [{ label: form.country === 'Pakistan' ? 'Province' : 'State/Region', value: form.stateName }] : []),
                { label: 'City', value: form.city || 'Islamabad' },
                { label: 'Contact', value: form.contactName },
                { label: 'Email', value: form.email },
                { label: 'Phone', value: `${phoneDialCountry.phoneCode} ${form.phone}`.trim() },
                { label: 'Admin Username', value: form.adminUsername },
                { label: 'Admin PIN', value: '••••' },
                { label: 'Plan', value: selectedPackage?.displayName ?? form.packageKey }
              ].map((item, i) => (
                <div key={i} className="flex justify-between gap-2 py-1 border-b border-slate-100">
                  <span className="text-xs text-slate-500 shrink-0">{item.label}</span>
                  <span className="text-xs text-slate-900 font-semibold truncate text-right">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-700">
              <strong>Free Trial:</strong> 30 days, all features unlocked regardless of plan. No credit card required.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(4)}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Create Account
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center">
          <button
            onClick={() => navigate('/')}
            className="text-xs text-slate-500 hover:text-slate-900 transition"
          >
            Already have an account? Login
          </button>
        </div>
      </div>
    </div>
  );
};

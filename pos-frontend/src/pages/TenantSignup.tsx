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
  UtensilsCrossed,
  ShoppingBag,
  Package,
  Layers,
  Check,
  Globe
} from 'lucide-react';
import { posApi } from '../services/api';
import type { BusinessType, PublicPackage, CountryProfile } from '../types';

const BUSINESS_TYPES: { value: BusinessType; label: string; hint: string; icon: React.ElementType }[] = [
  { value: 'Restaurant', label: 'Restaurant / Cafe', hint: 'Dine-in, takeaway, delivery, kitchen tickets', icon: UtensilsCrossed },
  { value: 'Retail', label: 'Retail Shop', hint: 'Counter sales, barcodes, stock', icon: ShoppingBag },
  { value: 'CashAndCarry', label: 'Cash & Carry / Wholesale', hint: 'Bulk sales, supplier purchasing', icon: Package },
  { value: 'Hybrid', label: 'Hybrid', hint: 'A mix of dine-in and retail counter sales', icon: Layers }
];

const TOTAL_STEPS = 4;

export const TenantSignup: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);

  const [countries, setCountries] = useState<CountryProfile[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);

  const [form, setForm] = useState({
    restaurantName: '',
    businessType: 'Restaurant' as BusinessType,
    city: '',
    address: '',
    country: 'Pakistan',
    stateCode: '',
    stateName: '',
    contactName: '',
    email: '',
    phone: '',
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
    return () => { cancelled = true; };
  }, []);

  const selectedCountry = countries.find(c => c.name === form.country) || null;

  // Reset the picked state whenever the country changes underneath it — a leftover
  // Punjab/Sindh code from Pakistan makes no sense once UAE is selected.
  useEffect(() => {
    setForm(prev => ({ ...prev, stateCode: '', stateName: '' }));
  }, [form.country]);

  const update = useCallback(<K extends keyof typeof form>(field: K, value: typeof form[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  }, []);

  const validateStep1 = () => {
    if (!form.restaurantName.trim()) return setError('Business name is required'), false;
    if (!form.businessType) return setError('Choose what kind of business this is'), false;
    return true;
  };

  const validateStep2 = () => {
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
    else if (step === 3) setStep(4);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await posApi.signup({
        restaurantName: form.restaurantName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        country: form.country,
        stateCode: form.stateCode || undefined,
        stateName: form.stateName.trim() || undefined,
        adminUsername: form.adminUsername.trim().toLowerCase(),
        adminPin: form.adminPin,
        businessType: form.businessType,
        packageKey: form.packageKey
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
        <div className="w-full max-w-md text-center space-y-6">
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
    <div className="h-screen overflow-hidden bg-slate-50 flex items-center justify-center p-3">
      <div className="w-full max-w-lg space-y-2.5 max-h-full overflow-y-auto">
        {/* Header */}
        <div className="text-center space-y-0.5">
          <div className="w-9 h-9 rounded-xl bg-teal-500 flex items-center justify-center mx-auto shadow-lg shadow-teal-500/25">
            <Store className="w-4.5 h-4.5 text-white" />
          </div>
          <h1 className="text-lg font-black text-slate-900">Register Your Business</h1>
          <p className="text-xs text-slate-600">Start your 30-day free trial. No credit card required.</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-1.5 justify-center">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-5.5 h-5.5 rounded-full flex items-center justify-center text-[10px] font-bold transition ${
                step >= s ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' : 'bg-slate-100 text-slate-500'
              }`}>{s}</div>
              {s < TOTAL_STEPS && <div className={`w-6 h-0.5 ${step > s ? 'bg-teal-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: What kind of business + basics */}
        {step === 1 && (
          <div className="space-y-2.5 p-4 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">What are you running?</h2>

            <div className="grid grid-cols-2 gap-2">
              {BUSINESS_TYPES.map(bt => {
                const Icon = bt.icon;
                const active = form.businessType === bt.value;
                return (
                  <button
                    key={bt.value}
                    type="button"
                    onClick={() => update('businessType', bt.value)}
                    className={`text-left px-2.5 py-2 rounded-xl border transition flex items-center gap-2 ${
                      active ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-600' : 'text-slate-400'}`} />
                    <span className={`text-[11px] font-bold leading-tight ${active ? 'text-teal-700' : 'text-slate-800'}`}>{bt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="relative">
              <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.restaurantName}
                onChange={(e) => update('restaurantName', e.target.value)}
                placeholder="Business name"
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  disabled={countriesLoading}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none disabled:opacity-50"
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
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {selectedCountry?.states && selectedCountry.states.length > 0 ? (
                <select
                  value={form.stateCode}
                  onChange={(e) => {
                    const st = selectedCountry.states?.find(s => s.code === e.target.value);
                    setForm(prev => ({ ...prev, stateCode: e.target.value, stateName: st?.name || '' }));
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none appearance-none"
                >
                  <option value="">{form.country === 'Pakistan' ? 'Province' : 'State/Region'} (optional)</option>
                  {selectedCountry.states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              ) : (
                <input
                  value={form.stateName}
                  onChange={(e) => update('stateName', e.target.value)}
                  placeholder="State/Province (optional)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              )}
              <input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder="Address (optional)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            {selectedCountry && (
              <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-600 leading-snug">
                <span className="font-bold text-slate-800">Starting tax: {selectedCountry.currencyCode} · {
                  selectedCountry.useDualTaxRate
                    ? `${selectedCountry.defaultTaxRate}% cash / ${selectedCountry.digitalTaxRate}% digital`
                    : selectedCountry.defaultTaxRate != null
                      ? `${selectedCountry.defaultTaxRate}% flat`
                      : 'not configured'
                }.</span> Editable anytime in Tax Configuration.
              </div>
            )}

            <button
              onClick={handleNext}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Contact + Owner login */}
        {step === 2 && (
          <div className="space-y-4 p-5 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">You &amp; Your Login</h2>
            <p className="text-xs text-slate-500">This becomes your Owner/Admin account — full access to everything.</p>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Your full name"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="Email address"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="Phone number (e.g. 0300-1234567)"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div className="h-px bg-slate-100" />

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={form.adminUsername}
                onChange={(e) => update('adminUsername', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="Admin username"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono"
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
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono tracking-[0.3em]"
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
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono tracking-[0.3em]"
                />
              </div>
            </div>

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

        {/* Step 3: Choose a plan */}
        {step === 3 && (
          <div className="space-y-4 p-5 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">Choose Your Plan</h2>
            <p className="text-xs text-slate-500">Every plan gets the full 30-day trial — this just sets your branch/counter/user limits after that. Switch anytime.</p>

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
                          <span className={`text-xs font-black ${active ? 'text-teal-700' : 'text-slate-900'}`}>{pkg.displayName}</span>
                          {active && <Check className="w-3.5 h-3.5 text-teal-600" />}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {pkg.maxBranches >= 999 ? 'Unlimited branches' : `${pkg.maxBranches} branch${pkg.maxBranches > 1 ? 'es' : ''}`}
                          {' · '}
                          {pkg.maxCounters} counter{pkg.maxCounters > 1 ? 's' : ''}
                          {' · '}
                          {pkg.maxUsers >= 999 ? 'unlimited' : pkg.maxUsers} users
                          {pkg.hasKitchenDisplay ? ' · Kitchen display' : ''}
                          {pkg.hasMultiBranch ? ' · Multi-branch' : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-black ${active ? 'text-teal-700' : 'text-slate-900'}`}>₨{pkg.monthlyPricePKR.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">/month</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

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

        {/* Step 4: Review & Create */}
        {step === 4 && (
          <div className="space-y-4 p-5 rounded-2xl bg-white border border-slate-200">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">Review &amp; Create</h2>

            <div className="space-y-2">
              {[
                { label: 'Business', value: form.restaurantName },
                { label: 'Type', value: BUSINESS_TYPES.find(b => b.value === form.businessType)?.label },
                { label: 'Country', value: form.country },
                ...(form.stateName ? [{ label: form.country === 'Pakistan' ? 'Province' : 'State/Region', value: form.stateName }] : []),
                { label: 'City', value: form.city || 'Islamabad' },
                { label: 'Contact', value: form.contactName },
                { label: 'Email', value: form.email },
                { label: 'Phone', value: form.phone },
                { label: 'Admin Username', value: form.adminUsername },
                { label: 'Admin PIN', value: '••••' },
                { label: 'Plan', value: selectedPackage?.displayName ?? form.packageKey }
              ].map((item, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-xs text-slate-500">{item.label}</span>
                  <span className="text-xs text-slate-900 font-semibold">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-700">
              <strong>Free Trial:</strong> 30 days, all features unlocked regardless of plan. No credit card required.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(3)}
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

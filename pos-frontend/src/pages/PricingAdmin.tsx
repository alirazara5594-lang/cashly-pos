import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, ChefHat, Infinity as InfinityIcon, Lock, MapPin, MessageSquare,
  Monitor, RefreshCw, RotateCcw, Save, Sparkles, Tablet, Users, X
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { PlanOption, PlatformPrice } from '../types';
import { tierLabel } from '../utils/tierLabel';
import { pkr } from '../utils/renewals';
import { usePosStore } from '../store/posStore';

interface PackageData {
  id: string;
  name: string;
  slug: string;
  monthlyPricePKR: number;
  yearlyPricePKR: number;
  maxBranches: number;
  maxCounters: number;
  maxTabs: number;
  maxKitchenDisplays: number;
  maxUsers: number;
  branchMonthlyPricePKR: number;
  branchYearlyPricePKR: number;
  whatsappMessagesPerMonth: number;
  features: string[];
}

type PriceField = 'monthlyPricePKR' | 'yearlyPricePKR' | 'branchMonthlyPricePKR' | 'branchYearlyPricePKR';
type LimitField = 'maxBranches' | 'maxCounters' | 'maxTabs' | 'maxKitchenDisplays' | 'maxUsers' | 'whatsappMessagesPerMonth';

const HEAD_OFFICE_ERP = 'HEAD_OFFICE_ERP';
/** FeatureCatalog.UnlimitedCount on the server: a limit of this or more means no limit at all. */
const UNLIMITED = 999;
const PLAN_ORDER = ['Starter', 'Standard', 'Professional'];
const PLAN_DOT: Record<string, string> = { Starter: 'bg-blue-500', Standard: 'bg-amber-500', Professional: 'bg-purple-500' };

/**
 * Every feature this screen can switch on maps to a real Has* column on the package row —
 * anything else cannot be saved, so it is not offered.
 */
const PACKAGE_FEATURES: { key: string; label: string; flag: keyof PlanOption }[] = [
  { key: 'kitchen_display', label: 'Kitchen Display', flag: 'hasKitchenDisplay' },
  { key: 'delivery_cod', label: 'Delivery & COD', flag: 'hasDeliveryCOD' },
  { key: 'inventory', label: 'Inventory', flag: 'hasInventoryManagement' },
  { key: 'stock_transfers', label: 'Stock Transfers', flag: 'hasStockTransfers' },
  { key: 'director_dashboard', label: 'Executive Dashboard', flag: 'hasDirectorDashboard' },
  { key: 'consolidated_reports', label: 'Consolidated Reports', flag: 'hasConsolidatedReports' },
  { key: 'whatsapp_notifications', label: 'WhatsApp Notifications', flag: 'hasWhatsAppMessaging' },
  { key: 'advanced_reports', label: 'Advanced Reports', flag: 'hasAdvancedReports' },
  { key: 'multi_branch', label: 'Multi-Branch', flag: 'hasMultiBranch' }
];

const PRICE_GROUPS: { title: string; note: string; rows: { field: PriceField; label: string; per: 'month' | 'year'; monthly?: PriceField }[] }[] = [
  {
    title: 'Single shop',
    note: 'What a business with one shop pays for this version.',
    rows: [
      { field: 'monthlyPricePKR', label: 'Monthly', per: 'month' },
      { field: 'yearlyPricePKR', label: 'Yearly', per: 'year', monthly: 'monthlyPricePKR' }
    ]
  },
  {
    title: 'Each outlet of a head office',
    note: 'Charged per outlet, on top of the Head Office ERP.',
    rows: [
      { field: 'branchMonthlyPricePKR', label: 'Monthly, per outlet', per: 'month' },
      { field: 'branchYearlyPricePKR', label: 'Yearly, per outlet', per: 'year', monthly: 'branchMonthlyPricePKR' }
    ]
  }
];

const LIMIT_ROWS: { field: LimitField; label: string; note: string; icon: React.FC<{ className?: string }>; unlimitedValue: number; fallback: number; zeroText?: string }[] = [
  { field: 'maxBranches', label: 'Locations', note: 'Shops and warehouses, per business', icon: MapPin, unlimitedValue: UNLIMITED, fallback: 1 },
  { field: 'maxCounters', label: 'Tills', note: 'Per shop', icon: Monitor, unlimitedValue: UNLIMITED, fallback: 1 },
  { field: 'maxTabs', label: 'Order tablets', note: 'Per shop', icon: Tablet, unlimitedValue: UNLIMITED, fallback: 1 },
  { field: 'maxKitchenDisplays', label: 'Kitchen screens', note: 'Per shop · 0 means sold as an add-on', icon: ChefHat, unlimitedValue: UNLIMITED, fallback: 1, zeroText: 'Add-on only' },
  { field: 'maxUsers', label: 'Staff logins', note: 'Per business', icon: Users, unlimitedValue: UNLIMITED, fallback: 5 },
  { field: 'whatsappMessagesPerMonth', label: 'WhatsApp messages', note: 'A month, for single shops — a head office gets the ERP’s', icon: MessageSquare, unlimitedValue: -1, fallback: 1000 }
];

const isUnlimited = (value: number, unlimitedValue: number) => (unlimitedValue < 0 ? value < 0 : value >= UNLIMITED);
const limitText = (value: number, unlimitedValue: number) => (isUnlimited(value, unlimitedValue) ? 'unlimited' : value.toLocaleString());
const digits = (s: string) => Number(s.replace(/\D/g, '') || 0);

/** What paying for the year saves against twelve monthly payments, or a warning if it costs more. */
const yearlyHint = (monthly: number, yearly: number): { text: string; cls: string } | null => {
  if (monthly <= 0 || yearly <= 0) return null;
  const full = monthly * 12;
  if (yearly > full) return { text: `More than 12 monthly payments (${pkr(full)})`, cls: 'text-amber-700' };
  if (yearly === full) return { text: 'Same as 12 months — no yearly discount', cls: 'text-slate-400' };
  const months = (full - yearly) / monthly;
  const free = Number.isInteger(months) ? `${months} month${months === 1 ? '' : 's'} free` : `${months.toFixed(1)} months free`;
  return { text: `${free} · ${Math.round((1 - yearly / full) * 100)}% off`, cls: 'text-teal-700' };
};

const fieldCls = 'w-full py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tabular-nums text-right text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed';

/** A price box: PKR in front, /mo or /yr behind, thousands separated except while typing. */
const MoneyInput: React.FC<{ value: number; onChange: (n: number) => void; per: 'month' | 'year'; label: string }> = ({ value, onChange, per, label }) => {
  const [typing, setTyping] = useState(false);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">PKR</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={typing ? String(value) : value.toLocaleString()}
        onFocus={(e) => { setTyping(true); requestAnimationFrame(() => e.target.select()); }}
        onBlur={() => setTyping(false)}
        onChange={(e) => onChange(digits(e.target.value))}
        className={`${fieldCls} pl-11 pr-10`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400 pointer-events-none">/{per === 'month' ? 'mo' : 'yr'}</span>
    </div>
  );
};

/** A count with an ∞ button beside it: unlimited is a choice, not a magic number to remember. */
const LimitInput: React.FC<{ value: number; onChange: (n: number) => void; unlimitedValue: number; fallback: number; label: string }> = ({ value, onChange, unlimitedValue, fallback, label }) => {
  const unlimited = isUnlimited(value, unlimitedValue);
  const [typing, setTyping] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      {unlimited ? (
        <div className="flex-1 min-w-0 py-2 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 text-xs font-bold text-center">Unlimited</div>
      ) : (
        <input type="text" inputMode="numeric" aria-label={label}
          value={typing ? String(value) : value.toLocaleString()}
          onFocus={(e) => { setTyping(true); requestAnimationFrame(() => e.target.select()); }}
          onBlur={() => setTyping(false)}
          onChange={(e) => onChange(digits(e.target.value))}
          className={`${fieldCls} flex-1 min-w-0 px-3`} />
      )}
      <button type="button" onClick={() => onChange(unlimited ? fallback : unlimitedValue)} aria-pressed={unlimited}
        title={unlimited ? 'Set a limit instead' : 'Make it unlimited'}
        className={`p-2 rounded-xl border transition shrink-0 disabled:cursor-not-allowed ${unlimited ? 'bg-teal-500 border-teal-500 text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-teal-600 hover:border-teal-300'}`}>
        <InfinityIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

const Switch: React.FC<{ on: boolean; onToggle: () => void; label: string }> = ({ on, onToggle, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed ${on ? 'bg-teal-500' : 'bg-slate-200'}`}>
    <span className={`inline-block h-4 w-4 rounded-full bg-[#fff] shadow-sm transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
  </button>
);

/** Under a box: what it was before this edit, so a change is never invisible. */
const Was: React.FC<{ show: boolean; text: string }> = ({ show, text }) =>
  show ? <div className="mt-1 text-[10px] font-semibold text-amber-700 text-right">was {text}</div> : null;

export const PricingAdmin: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);

  // Prices are a platform owner's decision; the server refuses anyone else whatever this says.
  const isUnlocked = !currentUser?.platformRole || currentUser.platformRole === 'Owner';

  const [packages, setPackages] = useState<PackageData[]>([]);
  const [saved, setSaved] = useState<PackageData[]>([]);
  const [erpPrice, setErpPrice] = useState<PlatformPrice | null>(null);
  const [savedErp, setSavedErp] = useState<PlatformPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // How many businesses each version (and the ERP) has — a price change reaches all of them.
  const [onPlan, setOnPlan] = useState<Record<string, number>>({});
  const [headOffices, setHeadOffices] = useState(0);
  useEffect(() => {
    let cancelled = false;
    posApi.getAdminTenants()
      .then(rows => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        let hq = 0;
        for (const t of rows) {
          if (t.status === 'Cancelled') continue;
          counts[t.tier] = (counts[t.tier] ?? 0) + 1;
          if (t.deploymentMode === 'HeadOffice') hq++;
        }
        setOnPlan(counts);
        setHeadOffices(hq);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([posApi.getPackages(), posApi.getPlatformPrices().catch(() => [] as PlatformPrice[])])
      .then(([data, prices]) => {
        if (cancelled) return;
        // The API returns the raw package row; the screen works with friendly names and the
        // Has* columns expressed as a feature list so the switches show what is actually on.
        const rows: PackageData[] = (Array.isArray(data) ? data : []).map((p) => ({
          id: p.id,
          name: p.displayName || p.packageKey,
          slug: p.packageKey,
          monthlyPricePKR: p.monthlyPricePKR ?? 0,
          yearlyPricePKR: p.yearlyPricePKR ?? 0,
          maxBranches: p.maxBranches ?? 1,
          maxCounters: p.maxCounters ?? 1,
          maxTabs: p.maxOrderTabs ?? 1,
          maxKitchenDisplays: p.maxKitchenDisplays ?? 0,
          maxUsers: p.maxUsers ?? 1,
          branchMonthlyPricePKR: p.branchMonthlyPricePKR ?? 0,
          branchYearlyPricePKR: p.branchYearlyPricePKR ?? 0,
          whatsappMessagesPerMonth: p.whatsAppMessagesPerMonth ?? 0,
          features: PACKAGE_FEATURES.filter(f => p[f.flag] === true).map(f => f.key)
        }));
        const rank = (slug: string) => (PLAN_ORDER.includes(slug) ? PLAN_ORDER.indexOf(slug) : PLAN_ORDER.length);
        rows.sort((a, b) => rank(a.slug) - rank(b.slug));
        const erp = (Array.isArray(prices) ? prices : []).find(p => p.key === HEAD_OFFICE_ERP) ?? null;
        setPackages(rows);
        setSaved(rows);
        setErpPrice(erp);
        setSavedErp(erp);
        setLoadError(null);
      })
      .catch(err => {
        // No made-up packages here: saving them would write demo numbers over the real ones.
        if (!cancelled) setLoadError(getApiErrorMessage(err, 'Could not load the packages.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = () => { setLoading(true); setTick(t => t + 1); };

  const setField = (id: string, field: PriceField | LimitField, value: number) => {
    if (!isUnlocked) return;
    setPackages(list => list.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  };
  const toggleFeature = (id: string, feature: string) => {
    if (!isUnlocked) return;
    setPackages(list => list.map(p => (p.id !== id ? p : {
      ...p, features: p.features.includes(feature) ? p.features.filter(f => f !== feature) : [...p.features, feature]
    })));
  };

  // ── Everything edited since the last save, in words: drives the save bar and the review ──
  const savedOf = (id: string) => saved.find(p => p.id === id);
  const priceChanges: { text: string; reach: string }[] = [];
  const otherChanges: string[] = [];
  const reach = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 'es'}`;
  for (const pkg of packages) {
    const before = savedOf(pkg.id);
    if (!before) continue;
    const name = tierLabel(pkg.slug);
    for (const group of PRICE_GROUPS) for (const row of group.rows) {
      if (before[row.field] !== pkg[row.field])
        priceChanges.push({
          text: `${name} · ${row.label.toLowerCase()}: ${pkr(before[row.field])} → ${pkr(pkg[row.field])}`,
          reach: reach(onPlan[pkg.slug] ?? 0, 'business')
        });
    }
    for (const row of LIMIT_ROWS) {
      if (before[row.field] !== pkg[row.field])
        otherChanges.push(`${name} · ${row.label.toLowerCase()}: ${limitText(before[row.field], row.unlimitedValue)} → ${limitText(pkg[row.field], row.unlimitedValue)}`);
    }
    for (const f of PACKAGE_FEATURES) {
      const was = before.features.includes(f.key), now = pkg.features.includes(f.key);
      if (was !== now) otherChanges.push(`${name} · ${f.label}: ${now ? 'switched on' : 'switched off'}`);
    }
  }
  if (savedErp && erpPrice) {
    if (savedErp.monthlyPricePKR !== erpPrice.monthlyPricePKR)
      priceChanges.push({ text: `Head Office ERP · monthly: ${pkr(savedErp.monthlyPricePKR)} → ${pkr(erpPrice.monthlyPricePKR)}`, reach: reach(headOffices, 'head office') });
    if (savedErp.yearlyPricePKR !== erpPrice.yearlyPricePKR)
      priceChanges.push({ text: `Head Office ERP · yearly: ${pkr(savedErp.yearlyPricePKR)} → ${pkr(erpPrice.yearlyPricePKR)}`, reach: reach(headOffices, 'head office') });
    if (savedErp.includedWhatsAppMessages !== erpPrice.includedWhatsAppMessages)
      otherChanges.push(`Head Office ERP · WhatsApp messages: ${limitText(savedErp.includedWhatsAppMessages, -1)} → ${limitText(erpPrice.includedWhatsAppMessages, -1)}`);
  }
  const changeCount = priceChanges.length + otherChanges.length;

  // Closing the tab with edits still open loses them; the browser asks first.
  useEffect(() => {
    if (changeCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changeCount]);

  const discard = () => {
    setPackages(saved);
    setErpPrice(savedErp);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!isUnlocked) return;
    setSaving(true);
    setMessage(null);
    try {
      for (const pkg of packages) {
        const before = savedOf(pkg.id);
        if (before && JSON.stringify(before) === JSON.stringify(pkg)) continue;
        // Explicit payload in the DTO's own field names.
        const payload: Record<string, unknown> = {
          displayName: pkg.name,
          monthlyPricePKR: pkg.monthlyPricePKR,
          yearlyPricePKR: pkg.yearlyPricePKR,
          maxBranches: pkg.maxBranches,
          maxCounters: pkg.maxCounters,
          maxOrderTabs: pkg.maxTabs,
          maxKitchenDisplays: pkg.maxKitchenDisplays,
          maxUsers: pkg.maxUsers,
          branchMonthlyPricePKR: pkg.branchMonthlyPricePKR,
          branchYearlyPricePKR: pkg.branchYearlyPricePKR,
          whatsAppMessagesPerMonth: pkg.whatsappMessagesPerMonth
        };
        for (const f of PACKAGE_FEATURES) payload[f.flag] = pkg.features.includes(f.key);
        await posApi.updatePackage(pkg.id, payload);
      }
      if (erpPrice && JSON.stringify(erpPrice) !== JSON.stringify(savedErp)) {
        await posApi.updatePlatformPrice(erpPrice.key, {
          monthlyPricePKR: erpPrice.monthlyPricePKR,
          yearlyPricePKR: erpPrice.yearlyPricePKR,
          includedWhatsAppMessages: erpPrice.includedWhatsAppMessages
        });
      }
      setMessage({
        type: 'success',
        text: priceChanges.length > 0
          ? 'Saved. New prices apply from each business’s next invoice and to what owners see when they buy.'
          : 'Saved.'
      });
      setSaved(packages);
      setSavedErp(erpPrice);
      setConfirming(false);
      setTick(t => t + 1);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not save every change — check the figures and try again.') });
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse" aria-busy="true">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-[520px] rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (loadError && packages.length === 0) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center space-y-3">
        <AlertTriangle className="w-6 h-6 text-rose-600 mx-auto" />
        <p className="text-sm font-semibold text-rose-700">{loadError}</p>
        <button onClick={reload} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      </div>
    );
  }

  // A worked example from the live figures, so the ERP's price is read the way it is billed.
  const example = packages.find(p => p.slug === 'Standard') ?? packages[0];
  const exampleTotal = erpPrice && example ? erpPrice.monthlyPricePKR + 3 * example.branchMonthlyPricePKR : 0;

  const groupRow = (title: string, note?: string) => (
    <tr className="bg-slate-50 border-t border-slate-200">
      <td colSpan={packages.length + 1} className="px-5 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        {note && <span className="ml-2 text-[11px] text-slate-400">{note}</span>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
          A single shop pays its version’s price. A head-office business pays the <strong className="text-slate-700">Head Office ERP</strong> once,
          plus each outlet’s per-outlet price. Changes reach every business’s next invoice — invoices already issued keep their amounts.
        </p>
        {!isUnlocked && (
          <span className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border bg-slate-50 text-slate-600 border-slate-200">
            <Lock className="w-3.5 h-3.5 text-slate-400" /> View only — prices are changed by a platform owner
          </span>
        )}
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border ${
          message.type === 'success' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-rose-50 text-rose-700 border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100" title="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* The Head Office ERP: billed once per head-office business, on top of its outlets' versions. */}
      {erpPrice && savedErp && (
        <fieldset disabled={!isUnlocked} className="rounded-2xl border border-slate-200 bg-white p-5 min-w-0">
          <div className="flex flex-col lg:flex-row gap-5">
            <div className="flex items-start gap-3 lg:w-[30%] shrink-0">
              <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-teal-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-900">{erpPrice.displayName || 'Head Office ERP'}</h2>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">{reach(headOffices, 'head office')}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Charged once to every POS + ERP business, whichever versions its outlets run.
                </p>
              </div>
            </div>
            <div className="flex-1 grid sm:grid-cols-3 gap-4 min-w-0">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Monthly</label>
                <MoneyInput label="Head Office ERP monthly price" per="month" value={erpPrice.monthlyPricePKR}
                  onChange={(n) => setErpPrice({ ...erpPrice, monthlyPricePKR: n })} />
                <Was show={savedErp.monthlyPricePKR !== erpPrice.monthlyPricePKR} text={pkr(savedErp.monthlyPricePKR)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Yearly</label>
                <MoneyInput label="Head Office ERP yearly price" per="year" value={erpPrice.yearlyPricePKR}
                  onChange={(n) => setErpPrice({ ...erpPrice, yearlyPricePKR: n })} />
                {(() => {
                  const hint = yearlyHint(erpPrice.monthlyPricePKR, erpPrice.yearlyPricePKR);
                  return hint && <div className={`mt-1 text-[10px] font-semibold text-right ${hint.cls}`}>{hint.text}</div>;
                })()}
                <Was show={savedErp.yearlyPricePKR !== erpPrice.yearlyPricePKR} text={pkr(savedErp.yearlyPricePKR)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">WhatsApp messages a month</label>
                <LimitInput label="Head Office ERP WhatsApp messages a month" value={erpPrice.includedWhatsAppMessages} unlimitedValue={-1} fallback={1000}
                  onChange={(n) => setErpPrice({ ...erpPrice, includedWhatsAppMessages: n })} />
                <Was show={savedErp.includedWhatsAppMessages !== erpPrice.includedWhatsAppMessages} text={limitText(savedErp.includedWhatsAppMessages, -1)} />
              </div>
            </div>
          </div>
          {example && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-start gap-2 text-[11px] text-slate-500">
              <Sparkles className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-px" />
              <span>
                Example: a head office with 3 {tierLabel(example.slug)} outlets pays {pkr(erpPrice.monthlyPricePKR)} + 3 × {pkr(example.branchMonthlyPricePKR)}
                {' = '}<strong className="text-slate-800">{pkr(exampleTotal)} a month</strong>.
              </span>
            </div>
          )}
        </fieldset>
      )}

      {/* The POS versions side by side: one row per figure, so the versions are compared, not hunted for. */}
      <fieldset disabled={!isUnlocked} className="rounded-2xl border border-slate-200 bg-white min-w-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs border-collapse">
            <colgroup>
              <col className="w-[28%]" />
              {packages.map(p => <col key={p.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="px-5 py-4 text-left align-bottom">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">POS versions</div>
                  <div className="text-[11px] font-medium text-slate-400 mt-1">Every shop runs one of these.</div>
                </th>
                {packages.map(pkg => {
                  const count = onPlan[pkg.slug] ?? 0;
                  return (
                    <th key={pkg.id} className="px-5 py-4 text-left align-top border-l border-slate-100 font-normal">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${PLAN_DOT[pkg.slug] ?? 'bg-slate-400'}`} />
                        <span className="text-sm font-bold text-slate-900">{pkg.name === pkg.slug ? tierLabel(pkg.slug) : pkg.name}</span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-xl font-bold tabular-nums text-slate-900">{pkr(pkg.monthlyPricePKR)}</span>
                        <span className="text-[11px] text-slate-500">/month</span>
                      </div>
                      <div className="text-[11px] text-slate-500">or {pkr(pkg.yearlyPricePKR)} a year</div>
                      <Link to={`/super-admin?tab=tenants&plan=${pkg.slug}`} title="See them in Businesses"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 hover:text-teal-900">
                        {reach(count, 'business')} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PRICE_GROUPS.map(group => (
                <React.Fragment key={group.title}>
                  {groupRow(group.title, group.note)}
                  {group.rows.map(row => (
                    <tr key={row.field} className="border-t border-slate-100">
                      <th scope="row" className="px-5 py-3 text-left align-top font-semibold text-slate-700">{row.label}</th>
                      {packages.map(pkg => {
                        const before = savedOf(pkg.id);
                        const hint = row.monthly ? yearlyHint(pkg[row.monthly], pkg[row.field]) : null;
                        return (
                          <td key={pkg.id} className="px-5 py-3 align-top border-l border-slate-100">
                            <MoneyInput label={`${tierLabel(pkg.slug)} ${row.label}`} per={row.per} value={pkg[row.field]}
                              onChange={(n) => setField(pkg.id, row.field, n)} />
                            {hint && <div className={`mt-1 text-[10px] font-semibold text-right ${hint.cls}`}>{hint.text}</div>}
                            <Was show={!!before && before[row.field] !== pkg[row.field]} text={pkr(before?.[row.field])} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}

              {groupRow('Limits', 'Use ∞ for no limit.')}
              {LIMIT_ROWS.map(row => (
                <tr key={row.field} className="border-t border-slate-100">
                  <th scope="row" className="px-5 py-3 text-left align-top font-normal">
                    <div className="flex items-center gap-2 font-semibold text-slate-700"><row.icon className="w-3.5 h-3.5 text-slate-400" /> {row.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 pl-5.5">{row.note}</div>
                  </th>
                  {packages.map(pkg => {
                    const before = savedOf(pkg.id);
                    return (
                      <td key={pkg.id} className="px-5 py-3 align-top border-l border-slate-100">
                        <LimitInput label={`${tierLabel(pkg.slug)} ${row.label}`} value={pkg[row.field]} unlimitedValue={row.unlimitedValue}
                          fallback={before && !isUnlimited(before[row.field], row.unlimitedValue) ? before[row.field] : row.fallback}
                          onChange={(n) => setField(pkg.id, row.field, n)} />
                        {row.zeroText && pkg[row.field] === 0 && <div className="mt-1 text-[10px] font-semibold text-slate-500 text-right">{row.zeroText}</div>}
                        <Was show={!!before && before[row.field] !== pkg[row.field]} text={before ? limitText(before[row.field], row.unlimitedValue) : ''} />
                      </td>
                    );
                  })}
                </tr>
              ))}

              {groupRow('Features')}
              {PACKAGE_FEATURES.map(f => (
                <tr key={f.key} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <th scope="row" className="px-5 py-2.5 text-left font-semibold text-slate-700">{f.label}</th>
                  {packages.map(pkg => {
                    const on = pkg.features.includes(f.key);
                    const before = savedOf(pkg.id);
                    const changed = !!before && before.features.includes(f.key) !== on;
                    return (
                      <td key={pkg.id} className="px-5 py-2.5 border-l border-slate-100">
                        <div className="flex items-center gap-2">
                          <Switch on={on} onToggle={() => toggleFeature(pkg.id, f.key)} label={`${f.label} in ${tierLabel(pkg.slug)}`} />
                          <span className={`text-[11px] font-semibold ${on ? 'text-slate-700' : 'text-slate-400'}`}>{on ? 'Included' : 'Not included'}</span>
                          {changed && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Changed, not saved yet" />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      {/* Unsaved edits: one bar, always in reach, until they are saved or thrown away. */}
      {isUnlocked && changeCount > 0 && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 pl-4 pr-2 py-2 rounded-2xl bg-white border border-slate-200 shadow-2xl">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-xs font-bold text-slate-900 mr-2">{changeCount} unsaved change{changeCount === 1 ? '' : 's'}</span>
          <button onClick={discard} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" /> Discard
          </button>
          <button onClick={() => setConfirming(true)} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Review &amp; save
          </button>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setConfirming(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Save {changeCount} change{changeCount === 1 ? '' : 's'}?</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Check them once — they reach every business on these versions.</p>
              </div>
              <button onClick={() => setConfirming(false)} disabled={saving} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 pb-4 overflow-y-auto space-y-4">
              {priceChanges.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Prices — from each business’s next invoice
                  </div>
                  <ul className="space-y-1.5">
                    {priceChanges.map(c => (
                      <li key={c.text} className="flex items-start justify-between gap-3 text-xs text-slate-800">
                        <span className="tabular-nums">{c.text}</span>
                        <span className="shrink-0 text-[10px] font-semibold text-slate-500 mt-0.5">{c.reach}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {otherChanges.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Limits &amp; features</div>
                  <ul className="space-y-1.5">
                    {otherChanges.map(c => <li key={c} className="text-xs text-slate-700">{c}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-slate-500">Invoices already issued keep their amounts. Price changes are recorded in the Activity Log with your name.</p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} disabled={saving} className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">Keep editing</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

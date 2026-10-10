import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Save,
  CheckCircle2,
  AlertTriangle,
  Package,
  Users,
  Monitor,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  Building2,
  Lock
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { PlanOption, PlatformPrice } from '../types';
import { tierLabel } from '../utils/tierLabel';
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

const HEAD_OFFICE_ERP = 'HEAD_OFFICE_ERP';

/**
 * Every feature this screen can switch on maps to a real Has* column on the package row —
 * anything else cannot be saved, so it is not offered. The old list showed toggles the
 * backend silently discarded.
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

export const PricingAdmin: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);

  // Prices are a platform owner's decision; the server refuses anyone else whatever this says.
  const isUnlocked = !currentUser?.platformRole || currentUser.platformRole === 'Owner';

  const [packages, setPackages] = useState<PackageData[]>([]);
  const [saved, setSaved] = useState<PackageData[]>([]);
  const [erpPrice, setErpPrice] = useState<PlatformPrice | null>(null);
  const [savedErp, setSavedErp] = useState<PlatformPrice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, prices] = await Promise.all([
        posApi.getPackages(),
        posApi.getPlatformPrices().catch(() => [] as PlatformPrice[])
      ]);
      // The API returns the raw package row; the screen works with friendly names and the
      // Has* columns expressed as a feature list so the toggles show what is actually on.
      const rows: PackageData[] = Array.isArray(data) ? data.map((p) => ({
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
        features: PACKAGE_FEATURES.filter(f => p[f.flag] === true).map(f => f.key),
      })) : [];
      setPackages(rows);
      setSaved(rows);
      const erp = (Array.isArray(prices) ? prices : []).find(p => p.key === HEAD_OFFICE_ERP) ?? null;
      setErpPrice(erp);
      setSavedErp(erp);
    } catch (err) {
      // No made-up packages here: saving them would write demo numbers over the real ones.
      setPackages([]);
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load packages') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const updatePackage = (id: string, field: keyof PackageData, value: any) => {
    if (!isUnlocked) return;
    setPackages(packages.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const toggleFeature = (pkgId: string, feature: string) => {
    if (!isUnlocked) return;
    setPackages(packages.map(p => {
      if (p.id !== pkgId) return p;
      const features = p.features.includes(feature)
        ? p.features.filter(f => f !== feature)
        : [...p.features, feature];
      return { ...p, features };
    }));
  };

  const handleSaveAll = async () => {
    if (!isUnlocked) return;
    setSaving(true);
    setMessage(null);
    try {
      for (const pkg of packages) {
        // Explicit payload in the DTO's own field names — the old spread sent UI-only keys
        // (name, maxTabs, features) that the backend ignored, so saves looked like they
        // worked while changing nothing.
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
      if (erpPrice) {
        await posApi.updatePlatformPrice(erpPrice.key, {
          monthlyPricePKR: erpPrice.monthlyPricePKR,
          yearlyPricePKR: erpPrice.yearlyPricePKR,
          includedWhatsAppMessages: erpPrice.includedWhatsAppMessages
        });
      }
      setMessage({ type: 'success', text: 'Saved. The new prices apply to each business\'s next invoice, and to what owners see when they buy.' });
      setConfirming(false);
      await loadData();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save some packages') });
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
  const priceChanges: string[] = [];
  for (const pkg of packages) {
    const before = saved.find(p => p.id === pkg.id);
    if (!before) continue;
    const label = tierLabel(pkg.slug);
    if (before.monthlyPricePKR !== pkg.monthlyPricePKR) priceChanges.push(`${label} monthly: ${money(before.monthlyPricePKR)} → ${money(pkg.monthlyPricePKR)}`);
    if (before.yearlyPricePKR !== pkg.yearlyPricePKR) priceChanges.push(`${label} yearly: ${money(before.yearlyPricePKR)} → ${money(pkg.yearlyPricePKR)}`);
    if (before.branchMonthlyPricePKR !== pkg.branchMonthlyPricePKR) priceChanges.push(`${label} per outlet monthly: ${money(before.branchMonthlyPricePKR)} → ${money(pkg.branchMonthlyPricePKR)}`);
    if (before.branchYearlyPricePKR !== pkg.branchYearlyPricePKR) priceChanges.push(`${label} per outlet yearly: ${money(before.branchYearlyPricePKR)} → ${money(pkg.branchYearlyPricePKR)}`);
  }
  if (savedErp && erpPrice && savedErp.monthlyPricePKR !== erpPrice.monthlyPricePKR)
    priceChanges.push(`Head Office ERP monthly: ${money(savedErp.monthlyPricePKR)} → ${money(erpPrice.monthlyPricePKR)}`);
  if (savedErp && erpPrice && savedErp.yearlyPricePKR !== erpPrice.yearlyPricePKR)
    priceChanges.push(`Head Office ERP yearly: ${money(savedErp.yearlyPricePKR)} → ${money(erpPrice.yearlyPricePKR)}`);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-teal-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading packages...</p>
        </div>
      </div>
    );
  }

  const tierColors: Record<string, string> = {
    Starter: 'border-blue-300',
    Standard: 'border-amber-300',
    Professional: 'border-purple-300',
  };

  const tierBadge: Record<string, string> = {
    Starter: 'bg-blue-50 text-blue-700 border border-blue-200',
    Standard: 'bg-amber-50 text-amber-700 border border-amber-200',
    Professional: 'bg-purple-50 text-purple-700 border border-purple-200',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 max-w-2xl">
          Prices, limits and features of each POS version, and the Head Office ERP. A change applies to every business's next
          invoice and to what owners see when they buy — invoices already issued keep their amounts.
        </p>
        {isUnlocked ? (
          <button
            onClick={() => (priceChanges.length > 0 ? setConfirming(true) : handleSaveAll())}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        ) : (
          <span className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border bg-slate-50 text-slate-600 border-slate-200">
            <Lock className="w-4 h-4 text-slate-400" /> View only — prices are changed by a platform owner.
          </span>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Change prices for everyone?</h3>
            <ul className="text-xs text-slate-700 space-y-1 list-disc pl-5">
              {priceChanges.map(c => <li key={c}>{c}</li>)}
            </ul>
            <p className="text-[11px] text-slate-500">Every business on these versions pays the new price from its next invoice. This is recorded with your name.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Not now</button>
              <button onClick={handleSaveAll} disabled={saving} className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold disabled:opacity-50">
                {saving ? 'Saving…' : 'Yes, change them'}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* The Head Office ERP is billed once per business, on top of each shop's POS version. */}
      {erpPrice && (
        <fieldset
          disabled={!isUnlocked}
          className="p-5 rounded-2xl bg-white border border-teal-200 space-y-3 min-w-0 m-0 disabled:opacity-90"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-500" />
            <h2 className="text-base font-black text-slate-900">{erpPrice.displayName || 'Head Office ERP'}</h2>
          </div>
          <p className="text-[11px] text-slate-500">
            Charged once to every POS + ERP business, whatever versions its shops run. Each shop then pays its version's branch price below.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Monthly Price (PKR)</label>
              <input
                type="number"
                min={0}
                value={erpPrice.monthlyPricePKR}
                onChange={(e) => setErpPrice({ ...erpPrice, monthlyPricePKR: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Yearly Price (PKR)</label>
              <input
                type="number"
                min={0}
                value={erpPrice.yearlyPricePKR}
                onChange={(e) => setErpPrice({ ...erpPrice, yearlyPricePKR: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                <MessageSquare className="w-3 h-3" /> WhatsApp Messages / Month
              </label>
              <input
                type="number"
                min={-1}
                value={erpPrice.includedWhatsAppMessages}
                onChange={(e) => setErpPrice({ ...erpPrice, includedWhatsAppMessages: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
          </div>
        </fieldset>
      )}

      {/* fieldset disables every input at once while the page is permission-locked */}
      <fieldset
        disabled={!isUnlocked}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5 min-w-0 border-0 p-0 m-0 disabled:opacity-90"
      >
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`p-5 rounded-2xl bg-white border ${tierColors[pkg.slug] || 'border-slate-200'} space-y-5`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-teal-500" />
                <h2 className="text-base font-black text-slate-900">{pkg.name}</h2>
              </div>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${tierBadge[pkg.slug] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {tierLabel(pkg.slug)}
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Monthly Price (PKR)</label>
              <input
                type="number"
                value={pkg.monthlyPricePKR}
                onChange={(e) => updatePackage(pkg.id, 'monthlyPricePKR', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Yearly Price (PKR)</label>
              <input
                type="number"
                value={pkg.yearlyPricePKR}
                onChange={(e) => updatePackage(pkg.id, 'yearlyPricePKR', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            {/* What one shop of a head-office business pays for this version */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Branch / Month (PKR)</label>
                <input
                  type="number"
                  min={0}
                  value={pkg.branchMonthlyPricePKR}
                  onChange={(e) => updatePackage(pkg.id, 'branchMonthlyPricePKR', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Branch / Year (PKR)</label>
                <input
                  type="number"
                  min={0}
                  value={pkg.branchYearlyPricePKR}
                  onChange={(e) => updatePackage(pkg.id, 'branchYearlyPricePKR', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <p className="col-span-2 text-[10px] text-slate-400 -mt-1">Charged per shop when a POS + ERP business runs this version.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                  <Building2 className="w-3 h-3" /> Max Branches
                </label>
                <input
                  type="number"
                  value={pkg.maxBranches}
                  onChange={(e) => updatePackage(pkg.id, 'maxBranches', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                  <Monitor className="w-3 h-3" /> Max Counters
                </label>
                <input
                  type="number"
                  value={pkg.maxCounters}
                  onChange={(e) => updatePackage(pkg.id, 'maxCounters', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                  <Monitor className="w-3 h-3" /> Max Tabs
                </label>
                <input
                  type="number"
                  value={pkg.maxTabs}
                  onChange={(e) => updatePackage(pkg.id, 'maxTabs', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1" title="Per shop; 999 = unlimited, 0 = sold as an add-on">
                  <Monitor className="w-3 h-3" /> Kitchen Screens
                </label>
                <input
                  type="number"
                  min={0}
                  value={pkg.maxKitchenDisplays}
                  onChange={(e) => updatePackage(pkg.id, 'maxKitchenDisplays', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                  <Users className="w-3 h-3" /> Max Users
                </label>
                <input
                  type="number"
                  value={pkg.maxUsers}
                  onChange={(e) => updatePackage(pkg.id, 'maxUsers', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase mb-1">
                <MessageSquare className="w-3 h-3" /> WhatsApp Messages / Month (-1 = unlimited)
              </label>
              <input
                type="number"
                value={pkg.whatsappMessagesPerMonth}
                onChange={(e) => updatePackage(pkg.id, 'whatsappMessagesPerMonth', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Features</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {PACKAGE_FEATURES.map((feature) => {
                  const isEnabled = pkg.features.includes(feature.key);
                  return (
                    <button
                      key={feature.key}
                      onClick={() => toggleFeature(pkg.id, feature.key)}
                      className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:bg-teal-50 transition text-left"
                    >
                      <span className="text-[11px] text-slate-700 font-medium">{feature.label}</span>
                      {isEnabled ? (
                        <ToggleRight className="w-6 h-6 text-teal-500 shrink-0" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-slate-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </fieldset>
    </div>
  );
};

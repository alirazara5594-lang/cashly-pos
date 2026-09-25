import React, { useState, useEffect } from 'react';
import {
  CreditCard,
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
  Lock,
  KeyRound,
  ShieldCheck
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { PlanOption } from '../types';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import { ManagerOverrideModal, type ManagerOverrideResult } from '../components/ManagerOverrideModal';

interface PackageData {
  id: string;
  name: string;
  slug: string;
  monthlyPricePKR: number;
  yearlyPricePKR: number;
  maxBranches: number;
  maxCounters: number;
  maxTabs: number;
  maxUsers: number;
  whatsappMessagesPerMonth: number;
  features: string[];
}

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
  const permissions = usePosStore(s => s.permissions);
  const modulePermissions = usePosStore(s => s.modulePermissions);

  // Package pricing is a platform-admin surface; the server rejects writes from
  // anyone without it regardless of what this flag says.
  const canEditPricing =
    hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit') ||
    !!permissions?.canManageMenuAndTax;

  const [override, setOverride] = useState<ManagerOverrideResult | null>(null);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const isUnlocked = canEditPricing || !!override;

  const [packages, setPackages] = useState<PackageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await posApi.getPackages();
      // The API returns the raw package row; the screen works with friendly names and the
      // Has* columns expressed as a feature list so the toggles show what is actually on.
      setPackages(Array.isArray(data) ? data.map((p) => ({
        id: p.id,
        name: p.displayName || p.packageKey,
        slug: p.packageKey,
        monthlyPricePKR: p.monthlyPricePKR ?? 0,
        yearlyPricePKR: p.yearlyPricePKR ?? 0,
        maxBranches: p.maxBranches ?? 1,
        maxCounters: p.maxCounters ?? 1,
        maxTabs: p.maxOrderTabs ?? 1,
        maxUsers: p.maxUsers ?? 1,
        whatsappMessagesPerMonth: p.whatsappMessagesPerMonth ?? 0,
        features: PACKAGE_FEATURES.filter(f => p[f.flag] === true).map(f => f.key),
      })) : []);
    } catch (err) {
      console.error('Failed to load packages:', err);
      setPackages([
        {
          id: '1', name: 'Starter', slug: 'starter',
          monthlyPricePKR: 4999, yearlyPricePKR: 47990,
          maxBranches: 1, maxCounters: 2, maxTabs: 3, maxUsers: 5,
          whatsappMessagesPerMonth: 100,
          features: ['kitchen_display', 'delivery_cod', 'inventory', 'multi_branch'],
        },
        {
          id: '2', name: 'Standard', slug: 'standard',
          monthlyPricePKR: 12999, yearlyPricePKR: 124990,
          maxBranches: 3, maxCounters: 5, maxTabs: 10, maxUsers: 15,
          whatsappMessagesPerMonth: 500,
          features: ['kitchen_display', 'delivery_cod', 'inventory', 'stock_transfers', 'director_dashboard', 'whatsapp_notifications', 'advanced_reports', 'multi_branch'],
        },
        {
          id: '3', name: 'Professional', slug: 'professional',
          monthlyPricePKR: 29999, yearlyPricePKR: 287990,
          maxBranches: -1, maxCounters: -1, maxTabs: -1, maxUsers: -1,
          whatsappMessagesPerMonth: -1,
          features: PACKAGE_FEATURES.map(f => f.key),
        },
      ]);
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
          maxUsers: pkg.maxUsers,
          whatsappMessagesPerMonth: pkg.whatsappMessagesPerMonth
        };
        for (const f of PACKAGE_FEATURES) payload[f.flag] = pkg.features.includes(f.key);
        await posApi.updatePackage(pkg.id, payload);
      }
      setMessage({
        type: 'success',
        text: override?.authorizedByName
          ? `All packages updated — authorized by ${override.authorizedByName}`
          : 'All packages updated successfully'
      });
      setOverride(null);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save some packages') });
    } finally {
      setSaving(false);
    }
  };

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-teal-500" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">Packages & Pricing</h1>
            <p className="text-xs text-slate-500">Manage subscription tiers, limits, and features</p>
          </div>
        </div>
        {isUnlocked ? (
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        ) : (
          <button
            onClick={() => setIsOverrideOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition cursor-pointer"
            title="You do not have permission to change package pricing — a manager can authorize this"
          >
            <KeyRound className="w-4 h-4" />
            Manager Override
          </button>
        )}
      </div>

      {!canEditPricing && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border ${
          override
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : 'bg-slate-50 text-slate-600 border-slate-200'
        }`}>
          {override ? <ShieldCheck className="w-4 h-4 text-teal-600" /> : <Lock className="w-4 h-4 text-slate-400" />}
          {override
            ? `Override active — ${override.authorizedByName || 'a manager'} authorized these changes. It expires once you save.`
            : 'View only: your account cannot change package pricing. Use Manager Override to unlock.'}
        </div>
      )}

      <ManagerOverrideModal
        isOpen={isOverrideOpen}
        onClose={() => setIsOverrideOpen(false)}
        requiredPermission="canManageMenuAndTax"
        actionLabel="Change subscription package pricing, limits, and features"
        onAuthorized={(result) => setOverride(result)}
      />

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* fieldset disables every input at once while the page is permission-locked */}
      <fieldset
        disabled={!isUnlocked}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5 min-w-0 border-0 p-0 m-0 disabled:opacity-90"
      >
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`p-5 rounded-2xl bg-white border ${tierColors[pkg.name] || 'border-slate-200'} space-y-5`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-teal-500" />
                <h2 className="text-base font-black text-slate-900">{pkg.name}</h2>
              </div>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${tierBadge[pkg.name] || 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                {pkg.slug}
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

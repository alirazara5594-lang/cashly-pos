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
  Building2
} from 'lucide-react';
import { posApi } from '../services/api';

interface PackageData {
  id: string;
  name: string;
  slug: string;
  description: string;
  monthlyPricePKR: number;
  yearlyPricePKR: number;
  maxBranches: number;
  maxCounters: number;
  maxTabs: number;
  maxUsers: number;
  whatsappMessagesPerMonth: number;
  features: string[];
}

const AVAILABLE_FEATURES = [
  'pos',
  'kitchen_display',
  'delivery_board',
  'inventory',
  'supply_chain',
  'reports',
  'multi_branch',
  'staff_management',
  'dining_tables',
  'whatsapp_notifications',
  'online_ordering',
  'loyalty_program',
  'advanced_reports',
  'api_access',
];

export const PricingAdmin: React.FC = () => {
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await posApi.getPackages();
      setPackages(Array.isArray(data) ? data.map((p: any) => ({
        ...p,
        monthlyPricePKR: p.monthlyPricePKR ?? 0,
        yearlyPricePKR: p.yearlyPricePKR ?? 0,
        maxBranches: p.maxBranches ?? 1,
        maxCounters: p.maxCounters ?? 1,
        maxTabs: p.maxTabs ?? 1,
        maxUsers: p.maxUsers ?? 1,
        whatsappMessagesPerMonth: p.whatsappMessagesPerMonth ?? 0,
        features: p.features ?? [],
      })) : []);
    } catch (err) {
      console.error('Failed to load packages:', err);
      setPackages([
        {
          id: '1', name: 'Starter', slug: 'starter',
          description: 'Single-branch restaurant with basic POS',
          monthlyPricePKR: 4999, yearlyPricePKR: 47990,
          maxBranches: 1, maxCounters: 2, maxTabs: 3, maxUsers: 5,
          whatsappMessagesPerMonth: 100,
          features: ['pos', 'kitchen_display', 'delivery_board', 'reports', 'staff_management', 'dining_tables'],
        },
        {
          id: '2', name: 'Standard', slug: 'standard',
          description: 'Multi-branch with inventory & supply chain',
          monthlyPricePKR: 12999, yearlyPricePKR: 124990,
          maxBranches: 3, maxCounters: 5, maxTabs: 10, maxUsers: 15,
          whatsappMessagesPerMonth: 500,
          features: ['pos', 'kitchen_display', 'delivery_board', 'inventory', 'supply_chain', 'reports', 'multi_branch', 'staff_management', 'dining_tables', 'whatsapp_notifications'],
        },
        {
          id: '3', name: 'Professional', slug: 'professional',
          description: 'Enterprise-grade with all features',
          monthlyPricePKR: 29999, yearlyPricePKR: 287990,
          maxBranches: -1, maxCounters: -1, maxTabs: -1, maxUsers: -1,
          whatsappMessagesPerMonth: -1,
          features: AVAILABLE_FEATURES,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const updatePackage = (id: string, field: keyof PackageData, value: any) => {
    setPackages(packages.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const toggleFeature = (pkgId: string, feature: string) => {
    setPackages(packages.map(p => {
      if (p.id !== pkgId) return p;
      const features = p.features.includes(feature)
        ? p.features.filter(f => f !== feature)
        : [...p.features, feature];
      return { ...p, features };
    }));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const pkg of packages) {
        await posApi.updatePackage(pkg.id, pkg);
      }
      setMessage({ type: 'success', text: 'All packages updated successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save some packages' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading packages...</p>
        </div>
      </div>
    );
  }

  const tierColors: Record<string, string> = {
    Starter: 'border-blue-500/30',
    Standard: 'border-amber-500/30',
    Professional: 'border-purple-500/30',
  };

  const tierBadge: Record<string, string> = {
    Starter: 'bg-blue-950 text-blue-400 border border-blue-800',
    Standard: 'bg-amber-950 text-amber-400 border border-amber-800',
    Professional: 'bg-purple-950 text-purple-400 border border-purple-800',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Packages & Pricing</h1>
            <p className="text-xs text-slate-400">Manage subscription tiers, limits, and features</p>
          </div>
        </div>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`p-5 rounded-2xl bg-slate-900 border ${tierColors[pkg.name] || 'border-slate-800'} space-y-5`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-400" />
                <h2 className="text-base font-black text-white">{pkg.name}</h2>
              </div>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${tierBadge[pkg.name] || 'bg-slate-800 text-slate-400'}`}>
                {pkg.slug}
              </span>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Description</label>
              <input
                value={pkg.description}
                onChange={(e) => updatePackage(pkg.id, 'description', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Monthly Price (PKR)</label>
              <input
                type="number"
                value={pkg.monthlyPricePKR}
                onChange={(e) => updatePackage(pkg.id, 'monthlyPricePKR', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Yearly Price (PKR)</label>
              <input
                type="number"
                value={pkg.yearlyPricePKR}
                onChange={(e) => updatePackage(pkg.id, 'yearlyPricePKR', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1">
                  <Building2 className="w-3 h-3" /> Max Branches
                </label>
                <input
                  type="number"
                  value={pkg.maxBranches}
                  onChange={(e) => updatePackage(pkg.id, 'maxBranches', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1">
                  <Monitor className="w-3 h-3" /> Max Counters
                </label>
                <input
                  type="number"
                  value={pkg.maxCounters}
                  onChange={(e) => updatePackage(pkg.id, 'maxCounters', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1">
                  <Monitor className="w-3 h-3" /> Max Tabs
                </label>
                <input
                  type="number"
                  value={pkg.maxTabs}
                  onChange={(e) => updatePackage(pkg.id, 'maxTabs', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1">
                  <Users className="w-3 h-3" /> Max Users
                </label>
                <input
                  type="number"
                  value={pkg.maxUsers}
                  onChange={(e) => updatePackage(pkg.id, 'maxUsers', Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase mb-1">
                <MessageSquare className="w-3 h-3" /> WhatsApp Messages / Month (-1 = unlimited)
              </label>
              <input
                type="number"
                value={pkg.whatsappMessagesPerMonth}
                onChange={(e) => updatePackage(pkg.id, 'whatsappMessagesPerMonth', Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Features</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {AVAILABLE_FEATURES.map((feature) => {
                  const isEnabled = pkg.features.includes(feature);
                  return (
                    <button
                      key={feature}
                      onClick={() => toggleFeature(pkg.id, feature)}
                      className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:bg-slate-800 transition text-left"
                    >
                      <span className="text-[11px] text-slate-300 font-medium">{feature.replace(/_/g, ' ')}</span>
                      {isEnabled ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400 shrink-0" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-slate-600 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

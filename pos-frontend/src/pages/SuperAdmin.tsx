import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldCheck,
  Building2,
  Users,
  TrendingUp,
  DollarSign,
  ToggleLeft,
  ToggleRight,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  CreditCard,
  MessageSquare,
  Receipt,
  Puzzle,
  Plus,
  Copy,
  X,
  LayoutDashboard,
  Activity
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { PricingAdmin } from './PricingAdmin';
import { WhatsAppConfig } from './WhatsAppConfig';
import { SubscriptionBilling } from './SubscriptionBilling';
import { AddOnManagement } from './AddOnManagement';
import { TenantDetailPanel, type TenantPanelTab } from '../components/TenantDetailPanel';
import type { AdminTenantRow, AdminPlatformStats, DeviceHealthReport } from '../types';

type SuperTab = 'dashboard' | 'tenants' | 'packages' | 'whatsapp' | 'billing' | 'addons';
const SUPER_TABS: SuperTab[] = ['dashboard', 'tenants', 'packages', 'whatsapp', 'billing', 'addons'];
const PANEL_TABS = ['overview', 'plan', 'addons', 'entitlements', 'deploy', 'devices', 'audit'] as const;

export const SuperAdmin: React.FC = () => {
  // Shareable console state: /super-admin?tab=whatsapp&tenant=<id>&ptab=plan restores
  // exactly what the operator was looking at (dashboard rows link straight into panels).
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as SuperTab | null;
  const urlPanelTab = searchParams.get('ptab') as (typeof PANEL_TABS)[number] | null;

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'trial' | 'paid'>('all');
  const [activeTab, setActiveTab] = useState<SuperTab>(
    urlTab && SUPER_TABS.includes(urlTab) ? urlTab : 'dashboard'
  );
  /** Tenant whose detail panel is open — the console's main working surface. */
  const [openTenantId, setOpenTenantId] = useState<string | null>(searchParams.get('tenant'));
  const [openPanelTab, setOpenPanelTab] = useState<TenantPanelTab>(
    urlPanelTab && (PANEL_TABS as readonly string[]).includes(urlPanelTab) ? urlPanelTab : 'overview'
  );
  const [provisionOpen, setProvisionOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== 'dashboard') params.set('tab', activeTab);
    if (openTenantId) params.set('tenant', openTenantId);
    if (openTenantId && openPanelTab !== 'overview') params.set('ptab', openPanelTab);
    setSearchParams(params, { replace: true });
  }, [activeTab, openTenantId, openPanelTab, setSearchParams]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tenantsData, statsData] = await Promise.all([
        posApi.getAdminTenants(),
        posApi.getAdminStats()
      ]);
      setTenants(tenantsData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleToggleActive = async (tenantId: string) => {
    try {
      await posApi.toggleTenantActive(tenantId);
      setTenants(tenants.map(t =>
        t.id === tenantId ? { ...t, isActive: !t.isActive } : t
      ));
    } catch (err) {
      console.error('Failed to toggle tenant:', err);
    }
  };

  const filteredTenants = tenants.filter(t => {
    const matchesSearch = !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.contactEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.city?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = filterStatus === 'all' ||
      (filterStatus === 'active' && t.isActive) ||
      (filterStatus === 'inactive' && !t.isActive) ||
      (filterStatus === 'trial' && t.isTrialActive) ||
      (filterStatus === 'paid' && !t.isTrialActive && t.subscriptionPaidUntil);

    return matchesSearch && matchesFilter;
  });

  const tierColor = (tier: string) => {
    switch (tier) {
      case 'Starter': return 'bg-blue-100 text-blue-700 border border-blue-200';
      case 'Standard': return 'bg-amber-100 text-amber-700 border border-amber-200';
      case 'Professional': return 'bg-purple-100 text-purple-700 border border-purple-200';
      default: return 'bg-slate-100 text-slate-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading platform data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">Platform Admin</h1>
            <p className="text-xs text-slate-500">Manage all registered restaurants</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setProvisionOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Provision tenant
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 w-fit">
        {[
          { key: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
          { key: 'tenants' as const, label: 'Tenants', icon: Building2 },
          { key: 'packages' as const, label: 'Packages & Pricing', icon: CreditCard },
          { key: 'billing' as const, label: 'Subscription Billing', icon: Receipt },
          { key: 'addons' as const, label: 'Add-ons', icon: Puzzle },
          { key: 'whatsapp' as const, label: 'WhatsApp Logs', icon: MessageSquare },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === tab.key
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && (
        <DashboardTab
          stats={stats}
          onOpenTenant={(id, tab) => {
            setOpenPanelTab(tab);
            setOpenTenantId(id);
          }}
        />
      )}

      {activeTab === 'tenants' && (
        <>
          {/* Search + Filter */}
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, city..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>
            <div className="relative">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="appearance-none pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="trial">On Trial</option>
                <option value="paid">Paid</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Tenants Table */}
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Restaurant</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Contact</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Location / Type</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Tier</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Status</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Usage vs. Plan</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Branches</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Expiry</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTenants.map((t) => (
                    <tr key={t.id} className="bg-white hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{t.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{t.contactName}</div>
                        <div className="text-[10px] text-slate-500">{t.contactEmail}</div>
                        <div className="text-[10px] text-slate-500">{t.contactPhone}</div>
                      </td>
                      <td className="text-center px-4 py-3">
                        <div className="text-slate-700">{t.city || '—'}{t.country ? `, ${t.country}` : ''}</div>
                        <div className="text-[10px] text-slate-400">{t.businessType || '—'}</div>
                      </td>
                      <td className="text-center px-4 py-3">
                        <div className="relative inline-block">
                          {/* The select never applies directly — picking a tier opens the
                              panel's Plan tab, which previews blockers and confirms. */}
                          <select
                            value={t.tier}
                            onChange={(e) => {
                              if (e.target.value !== t.tier) {
                                setOpenPanelTab('plan');
                                setOpenTenantId(t.id);
                              }
                            }}
                            className={`appearance-none pl-2 pr-6 py-1 rounded-lg text-[10px] font-bold cursor-pointer focus:outline-none ${tierColor(t.tier)}`}
                          >
                            <option value="Starter">Starter</option>
                            <option value="Standard">Standard</option>
                            <option value="Professional">Professional</option>
                          </select>
                          <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-60" />
                        </div>
                      </td>
                      <td className="text-center px-4 py-3">
                        {t.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200 text-[10px] font-bold">
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" /> Inactive
                          </span>
                        )}
                      </td>
                      <td className="text-center px-4 py-3">
                        <div className="flex flex-col gap-0.5 text-[10px] font-mono text-slate-600">
                          <span className={(t.counterCount ?? 0) >= (t.maxCounters ?? 0) ? 'text-amber-600 font-bold' : ''}>
                            Counters {t.counterCount ?? 0}/{t.maxCounters ?? 0}
                          </span>
                          <span className={(t.tabletCount ?? 0) >= (t.maxTablets ?? 0) ? 'text-amber-600 font-bold' : ''}>
                            Tablets {t.tabletCount ?? 0}/{t.maxTablets ?? 0}
                          </span>
                          <span className={(t.userCount ?? 0) >= (t.maxUsers ?? 0) ? 'text-amber-600 font-bold' : ''}>
                            Users {t.userCount ?? 0}/{t.maxUsers ?? 0}
                          </span>
                          {!!t.activeAddOnsCount && (
                            <span className="inline-flex items-center justify-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 font-bold">
                              <Puzzle className="w-2.5 h-2.5" /> {t.activeAddOnsCount} add-on{t.activeAddOnsCount > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-4 py-3 font-mono text-slate-700">{t.branchCount}</td>
                      <td className="text-center px-4 py-3">
                        {t.isTrialActive ? (
                          <span className="text-amber-600 text-[10px] font-bold">
                            Trial: {new Date(t.trialEndsAt).toLocaleDateString()}
                          </span>
                        ) : t.subscriptionPaidUntil ? (
                          <span className="text-teal-600 text-[10px] font-bold">
                            Paid: {new Date(t.subscriptionPaidUntil).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-red-600 text-[10px] font-bold">Expired</span>
                        )}
                      </td>
                      <td className="text-center px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Everything beyond on/off lives in the detail panel: the lifecycle
                              ladder, grants, trial extension, device health, impersonation. */}
                          <button
                            onClick={() => {
                              setOpenPanelTab('overview');
                              setOpenTenantId(t.id);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition"
                            title="Open this tenant"
                          >
                            Manage
                          </button>
                          <button
                            onClick={() => handleToggleActive(t.id)}
                            className={`p-1.5 rounded-lg transition ${
                              t.isActive
                                ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                                : 'bg-red-100 text-red-700 hover:bg-red-200'
                            }`}
                            title={t.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {t.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTenants.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No restaurants found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'packages' && <PricingAdmin />}
      {activeTab === 'billing' && <SubscriptionBilling />}
      {activeTab === 'addons' && <AddOnManagement />}
      {activeTab === 'whatsapp' && <WhatsAppConfig />}

      {openTenantId && (
        <TenantDetailPanel
          tenantId={openTenantId}
          initialTab={openPanelTab}
          onClose={() => setOpenTenantId(null)}
          onChanged={loadData}
        />
      )}

      {provisionOpen && (
        <ProvisionModal
          onClose={() => setProvisionOpen(false)}
          onDone={() => {
            setProvisionOpen(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};

/**
 * Creates a tenant from the console and shows the owner invite exactly once — the token is
 * a bearer secret the server only stores hashed, so this screen is the only chance to copy it.
 */
const ProvisionModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Pakistan');
  const [packageKey, setPackageKey] = useState('Starter');
  const [verticalPack, setVerticalPack] = useState('restaurant');
  const [trialDays, setTrialDays] = useState('30');
  const [paidUntil, setPaidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    tenantId: string; slug: string; tier: string;
    ownerInviteToken: string; ownerInviteExpiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!businessName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Business name, contact name and email are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await posApi.provisionTenant({
        businessName: businessName.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        packageKey,
        verticalPack,
        trialDays: Number(trialDays) || 0,
        paidUntil: paidUntil ? new Date(paidUntil).toISOString() : undefined
      });
      setResult(res);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not provision this tenant.'));
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.ownerInviteToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be unavailable — the token stays selectable on screen */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">
            {result ? 'Tenant provisioned' : 'Provision a tenant'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="p-5 space-y-3">
            <div className="px-3 py-2 rounded-xl bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-700">
              {result.slug} is live on {result.tier}.
            </div>
            <div>
              <div className="text-[10px] uppercase font-black text-slate-500 mb-1">Owner invite token (shown once)</div>
              <div className="p-3 rounded-xl bg-slate-900 text-teal-300 font-mono text-[11px] break-all select-all">
                {result.ownerInviteToken}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                Hand this to the owner — they redeem it in the app to create their username and
                PIN. It expires {new Date(result.ownerInviteExpiresAt).toLocaleDateString()} and
                cannot be recovered afterwards.
              </p>
            </div>
            <button
              onClick={copyToken}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy token'}
            </button>
            <button
              onClick={onDone}
              className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {error && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Business name *"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Contact name *"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Phone"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Contact email *"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Country"
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Plan</span>
                <select
                  value={packageKey}
                  onChange={(e) => setPackageKey(e.target.value)}
                  className="mt-0.5 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="Starter">Starter</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">Professional</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Vertical pack</span>
                <select
                  value={verticalPack}
                  onChange={(e) => setVerticalPack(e.target.value)}
                  className="mt-0.5 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="restaurant">Restaurant</option>
                  <option value="retail">Retail</option>
                  <option value="grocery">Grocery</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="salon">Salon</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="apparel">Apparel</option>
                  <option value="services">Services</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Trial days</span>
                <input
                  type="number"
                  min={0}
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="mt-0.5 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Paid until</span>
                <input
                  type="date"
                  value={paidUntil}
                  onChange={(e) => setPaidUntil(e.target.value)}
                  className="mt-0.5 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </label>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              Creates the tenant, its main location, settings and entitlements — no user account
              yet. The owner account is created when they redeem the invite below.
            </p>
            <button
              disabled={busy}
              onClick={submit}
              className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
            >
              {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Provision
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Platform health at a glance: money in, tenants by plan, renewals coming up, and the tills
 * that have gone quiet. Every row that maps to a tenant opens straight into its panel.
 */
const DashboardTab: React.FC<{
  stats: AdminPlatformStats | null;
  onOpenTenant: (id: string, tab: TenantPanelTab) => void;
}> = ({ stats, onOpenTenant }) => {
  const [health, setHealth] = useState<DeviceHealthReport | null>(null);

  useEffect(() => {
    posApi.getDeviceHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  const cards = [
    { label: 'Total Restaurants', value: stats.totalTenants.toLocaleString(), icon: Building2, color: 'text-blue-600' },
    { label: 'Active', value: stats.activeTenants.toLocaleString(), icon: CheckCircle2, color: 'text-teal-600' },
    { label: 'On Trial', value: stats.trialTenants.toLocaleString(), icon: Clock, color: 'text-amber-600' },
    { label: 'Paid Subscribers', value: stats.paidTenants.toLocaleString(), icon: DollarSign, color: 'text-green-600' },
    { label: 'MRR', value: `PKR ${Math.round(stats.mrrPKR).toLocaleString()}`, icon: TrendingUp, color: 'text-purple-600' },
    { label: 'Branches', value: stats.totalBranches.toLocaleString(), icon: Building2, color: 'text-indigo-600' },
    { label: 'Orders', value: stats.totalOrders.toLocaleString(), icon: Users, color: 'text-pink-600' },
    { label: 'In arrears', value: stats.arrears.toLocaleString(), icon: AlertTriangle, color: 'text-rose-600' },
    { label: 'Expiring ≤14d', value: stats.expiringSoonCount.toLocaleString(), icon: Receipt, color: 'text-amber-600' },
    { label: 'Dark tills (24h)', value: (health?.count ?? stats.staleDevices).toLocaleString(), icon: Activity, color: 'text-rose-600' }
  ];

  const maxMix = Math.max(1, ...stats.planMix.map(p => p.count));
  const stale = health?.devices.slice(0, 5) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((c, i) => (
          <div key={i} className="p-4 rounded-xl bg-white border border-slate-200">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className={`w-4 h-4 ${c.color}`} />
              <span className="text-[10px] font-semibold text-slate-500 uppercase">{c.label}</span>
            </div>
            <div className={`text-xl font-black ${c.color} truncate`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Plan mix</div>
          {stats.planMix.length === 0 && <p className="text-xs text-slate-500">No active tenants.</p>}
          {stats.planMix.map(p => (
            <div key={p.tier} className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-slate-700">{p.tier}</span>
                <span className="font-mono text-slate-500">
                  {p.count} · {Math.round((p.count / Math.max(1, stats.activeTenants)) * 100)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    p.tier === 'Professional' ? 'bg-purple-500' : p.tier === 'Standard' ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${(p.count / maxMix) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Renewals in the next 14 days</div>
          {stats.expiringSoon.length === 0 && (
            <p className="text-xs text-slate-500">Nothing expiring soon.</p>
          )}
          {stats.expiringSoon.map(t => (
            <button
              key={t.id}
              onClick={() => onOpenTenant(t.id, 'plan')}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-300 transition text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{t.name}</div>
                <div className="text-[10px] text-slate-500">{t.tier}</div>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-amber-600">
                {new Date(t.paidUntil).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {stale.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">
            Tills quiet for over a day
          </div>
          {stale.map(d => (
            <button
              key={d.terminalId}
              onClick={() => onOpenTenant(d.tenantId, 'devices')}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 hover:border-rose-300 transition text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">
                  {d.terminalName} <span className="font-normal text-slate-500">· {d.branchName}</span>
                </div>
                <div className="text-[10px] text-slate-500">{d.tenantName}</div>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-rose-600">
                {new Date(d.lastSeenAt).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

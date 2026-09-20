import React, { useState, useEffect } from 'react';
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
  Puzzle
} from 'lucide-react';
import { posApi } from '../services/api';
import { PricingAdmin } from './PricingAdmin';
import { WhatsAppConfig } from './WhatsAppConfig';
import { SubscriptionBilling } from './SubscriptionBilling';
import { AddOnManagement } from './AddOnManagement';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  city: string;
  country?: string;
  businessType: string;
  tier: string;
  isActive: boolean;
  isTrialActive: boolean;
  trialEndsAt: string;
  subscriptionPaidUntil: string | null;
  createdAt: string;
  branchCount: number;
  userCount: number;
  maxUsers?: number;
  counterCount?: number;
  maxCounters?: number;
  tabletCount?: number;
  maxTablets?: number;
  activeAddOnsCount?: number;
}

interface AdminStats {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  paidTenants: number;
  totalBranches: number;
  totalOrders: number;
}

export const SuperAdmin: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'trial' | 'paid'>('all');
  const [changingTier, setChangingTier] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tenants' | 'packages' | 'whatsapp' | 'billing' | 'addons'>('tenants');

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

  const handleChangeTier = async (tenantId: string, newTier: string) => {
    setChangingTier(tenantId);
    try {
      await posApi.changeTenantTier(tenantId, newTier, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
      setTenants(tenants.map(t =>
        t.id === tenantId ? { ...t, tier: newTier, isTrialActive: false } : t
      ));
    } catch (err) {
      console.error('Failed to change tier:', err);
    } finally {
      setChangingTier(null);
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
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200 w-fit">
        {[
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
      {activeTab === 'tenants' && (
        <>
          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {[
                { label: 'Total Restaurants', value: stats.totalTenants, icon: Building2, color: 'text-blue-600' },
                { label: 'Active', value: stats.activeTenants, icon: CheckCircle2, color: 'text-teal-600' },
                { label: 'On Trial', value: stats.trialTenants, icon: Clock, color: 'text-amber-600' },
                { label: 'Paid Subscribers', value: stats.paidTenants, icon: DollarSign, color: 'text-green-600' },
                { label: 'Total Branches', value: stats.totalBranches, icon: TrendingUp, color: 'text-purple-600' },
                { label: 'Total Orders', value: stats.totalOrders, icon: Users, color: 'text-pink-600' }
              ].map((stat, i) => (
                <div key={i} className="p-4 rounded-xl bg-white border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">{stat.label}</span>
                  </div>
                  <div className={`text-2xl font-black ${stat.color}`}>{stat.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}

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
                          <select
                            value={t.tier}
                            onChange={(e) => handleChangeTier(t.id, e.target.value)}
                            disabled={changingTier === t.id}
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
    </div>
  );
};

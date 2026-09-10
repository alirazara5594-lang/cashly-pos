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
  ChevronDown
} from 'lucide-react';
import { posApi } from '../services/api';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  city: string;
  businessType: string;
  tier: string;
  isActive: boolean;
  isTrialActive: boolean;
  trialEndsAt: string;
  subscriptionPaidUntil: string | null;
  createdAt: string;
  branchCount: number;
  userCount: number;
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
      case 'Starter': return 'bg-blue-950 text-blue-400 border border-blue-800';
      case 'Standard': return 'bg-amber-950 text-amber-400 border border-amber-800';
      case 'Professional': return 'bg-purple-950 text-purple-400 border border-purple-800';
      default: return 'bg-slate-800 text-slate-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading platform data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Platform Admin</h1>
            <p className="text-xs text-slate-400">Manage all registered restaurants</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Restaurants', value: stats.totalTenants, icon: Building2, color: 'text-blue-400' },
            { label: 'Active', value: stats.activeTenants, icon: CheckCircle2, color: 'text-emerald-400' },
            { label: 'On Trial', value: stats.trialTenants, icon: Clock, color: 'text-amber-400' },
            { label: 'Paid Subscribers', value: stats.paidTenants, icon: DollarSign, color: 'text-green-400' },
            { label: 'Total Branches', value: stats.totalBranches, icon: TrendingUp, color: 'text-purple-400' },
            { label: 'Total Orders', value: stats.totalOrders, icon: Users, color: 'text-pink-400' }
          ].map((stat, i) => (
            <div key={i} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="text-[10px] font-semibold text-slate-400 uppercase">{stat.label}</span>
              </div>
              <div className={`text-2xl font-black ${stat.color}`}>{stat.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, city..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="appearance-none pl-3 pr-8 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
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
      <div className="rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800">
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Restaurant</th>
                <th className="text-left px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Contact</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">City</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Tier</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Status</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Branches</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Expiry</th>
                <th className="text-center px-4 py-3 font-bold text-slate-400 uppercase text-[10px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredTenants.map((t) => (
                <tr key={t.id} className="bg-slate-950 hover:bg-slate-900 transition">
                  {/* Restaurant Name */}
                  <td className="px-4 py-3">
                    <div className="font-bold text-white">{t.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{t.slug}</div>
                  </td>

                  {/* Contact */}
                  <td className="px-4 py-3">
                    <div className="text-slate-300">{t.contactName}</div>
                    <div className="text-[10px] text-slate-500">{t.contactEmail}</div>
                    <div className="text-[10px] text-slate-500">{t.contactPhone}</div>
                  </td>

                  {/* City */}
                  <td className="text-center px-4 py-3 text-slate-300">{t.city || '—'}</td>

                  {/* Tier */}
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

                  {/* Status */}
                  <td className="text-center px-4 py-3">
                    {t.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800 text-[10px] font-bold">
                        <AlertTriangle className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </td>

                  {/* Branches */}
                  <td className="text-center px-4 py-3 font-mono text-slate-300">{t.branchCount}</td>

                  {/* Expiry */}
                  <td className="text-center px-4 py-3">
                    {t.isTrialActive ? (
                      <span className="text-amber-400 text-[10px] font-bold">
                        Trial: {new Date(t.trialEndsAt).toLocaleDateString()}
                      </span>
                    ) : t.subscriptionPaidUntil ? (
                      <span className="text-emerald-400 text-[10px] font-bold">
                        Paid: {new Date(t.subscriptionPaidUntil).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-red-400 text-[10px] font-bold">Expired</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="text-center px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(t.id)}
                      className={`p-1.5 rounded-lg transition ${
                        t.isActive
                          ? 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900'
                          : 'bg-red-950 text-red-400 hover:bg-red-900'
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
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    No restaurants found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

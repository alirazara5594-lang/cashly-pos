import React, { useState, useEffect, useMemo } from 'react';
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
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Puzzle,
  Plus,
  Copy,
  X,
  Activity,
  ArrowUpDown,
  MoreVertical,
  Mail,
  Phone,
  MessageCircle,
  Download,
  Check,
  Eye,
  ArrowRight,
  XCircle,
  RotateCcw
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { beginSupportSession } from '../services/supportSession';
import { PricingAdmin } from './PricingAdmin';
import { WhatsAppConfig } from './WhatsAppConfig';
import { SubscriptionBilling } from './SubscriptionBilling';
import { AddOnManagement } from './AddOnManagement';
import { TenantDetailPanel, type TenantPanelTab } from '../components/TenantDetailPanel';
import { RenewalsBoard } from '../components/SubscriptionParts';
import { KIND_LABEL, daysText, needsAttention } from '../utils/renewals';
import type { AdminTenantRow, AdminPlatformStats, DeviceHealthReport, SubscriptionPartRow, RenewalsSummary } from '../types';
import { tierLabel } from '../utils/tierLabel';

type SuperTab = 'dashboard' | 'tenants' | 'renewals' | 'packages' | 'whatsapp' | 'billing' | 'addons';
const SUPER_TABS: SuperTab[] = ['dashboard', 'tenants', 'renewals', 'packages', 'whatsapp', 'billing', 'addons'];
const PANEL_TABS = ['overview', 'plan', 'subscriptions', 'addons', 'entitlements', 'deploy', 'devices', 'audit'] as const;

/** Each section's heading; the sidebar is where they are picked. */
const TAB_TITLES: Record<SuperTab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'The whole platform at a glance' },
  tenants: { title: 'Tenants', subtitle: 'Every registered business' },
  renewals: { title: 'Renewals', subtitle: 'ERP, POS and tablets — each renewing on its own date' },
  packages: { title: 'Packages & Pricing', subtitle: 'Plans, prices and what each includes' },
  billing: { title: 'Subscription Billing', subtitle: 'Invoices and payments from businesses' },
  addons: { title: 'Add-ons', subtitle: 'Extras businesses can add to their plan' },
  whatsapp: { title: 'WhatsApp Logs', subtitle: 'Messages sent by the platform' }
};

export const SuperAdmin: React.FC = () => {
  // Shareable console state: /super-admin?tab=whatsapp&tenant=<id>&ptab=plan restores
  // exactly what the operator was looking at (dashboard rows link straight into panels).
  // The tab lives in the address, so the sidebar's links open it directly.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as SuperTab | null;
  const urlPanelTab = searchParams.get('ptab') as (typeof PANEL_TABS)[number] | null;

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'trial' | 'paid' | 'expiring'>('all');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterVertical, setFilterVertical] = useState<string>('all');
  const [sortField, setSortField] = useState<'name' | 'tier' | 'status' | 'branches' | 'expiry' | 'createdAt'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Quick Action & Safety Modals
  const [confirmToggleTenant, setConfirmToggleTenant] = useState<AdminTenantRow | null>(null);
  const [quickExtendTenant, setQuickExtendTenant] = useState<AdminTenantRow | null>(null);
  const [extendDays, setExtendDays] = useState<number>(14);
  const [extendReason, setExtendReason] = useState<string>('');
  const [quickImpersonateTenant, setQuickImpersonateTenant] = useState<AdminTenantRow | null>(null);
  const [impersonateReason, setImpersonateReason] = useState<string>('');
  const [actionMenuTenantId, setActionMenuTenantId] = useState<string | null>(null);
  const [copiedSlugId, setCopiedSlugId] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState<boolean>(false);
  const activeTab: SuperTab = urlTab && SUPER_TABS.includes(urlTab) ? urlTab : 'dashboard';
  /** Tenant whose detail panel is open — the console's main working surface. */
  const [openTenantId, setOpenTenantId] = useState<string | null>(searchParams.get('tenant'));
  const [openPanelTab, setOpenPanelTab] = useState<TenantPanelTab>(
    urlPanelTab && (PANEL_TABS as readonly string[]).includes(urlPanelTab) ? urlPanelTab : 'overview'
  );
  const [provisionOpen, setProvisionOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuTenantId) {
        const target = e.target as HTMLElement;
        if (!target.closest('.tenant-action-menu-container')) {
          setActionMenuTenantId(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionMenuTenantId]);

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

  const tenantStats = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter(t => t.isActive).length;
    const trial = tenants.filter(t => t.isTrialActive).length;
    const inactive = tenants.filter(t => !t.isActive).length;
    const expiringSoon = tenants.filter(t => {
      const exp = t.isTrialActive ? t.trialEndsAt : t.subscriptionPaidUntil;
      if (!exp) return false;
      const diff = new Date(exp).getTime() - Date.now();
      return diff > 0 && diff <= 14 * 86400000;
    }).length;
    return { total, active, trial, inactive, expiringSoon };
  }, [tenants]);

  const businessTypes = useMemo(() => {
    const set = new Set<string>();
    tenants.forEach(t => {
      if (t.businessType) set.add(t.businessType);
    });
    return Array.from(set).sort();
  }, [tenants]);

  const filteredAndSortedTenants = useMemo(() => {
    const result = tenants.filter(t => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.contactName.toLowerCase().includes(q) ||
        t.contactEmail.toLowerCase().includes(q) ||
        (t.contactPhone && t.contactPhone.toLowerCase().includes(q)) ||
        (t.city && t.city.toLowerCase().includes(q));

      const matchesStatus = filterStatus === 'all' ||
        (filterStatus === 'active' && t.isActive) ||
        (filterStatus === 'inactive' && !t.isActive) ||
        (filterStatus === 'trial' && t.isTrialActive) ||
        (filterStatus === 'paid' && !t.isTrialActive && t.subscriptionPaidUntil) ||
        (filterStatus === 'expiring' && (() => {
          const exp = t.isTrialActive ? t.trialEndsAt : t.subscriptionPaidUntil;
          if (!exp) return false;
          const diff = new Date(exp).getTime() - Date.now();
          return diff > 0 && diff <= 14 * 86400000;
        })());

      const matchesTier = filterTier === 'all' || t.tier.toLowerCase() === filterTier.toLowerCase();
      const matchesVertical = filterVertical === 'all' || (t.businessType && t.businessType.toLowerCase() === filterVertical.toLowerCase());

      return matchesSearch && matchesStatus && matchesTier && matchesVertical;
    });

    result.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'tier') {
        const order: Record<string, number> = { Starter: 1, Standard: 2, Professional: 3 };
        comparison = (order[a.tier] || 0) - (order[b.tier] || 0);
      } else if (sortField === 'status') {
        comparison = Number(b.isActive) - Number(a.isActive);
      } else if (sortField === 'branches') {
        comparison = (a.branchCount || 0) - (b.branchCount || 0);
      } else if (sortField === 'expiry') {
        const dateA = a.isTrialActive ? (a.trialEndsAt ? new Date(a.trialEndsAt).getTime() : 0) : (a.subscriptionPaidUntil ? new Date(a.subscriptionPaidUntil).getTime() : 0);
        const dateB = b.isTrialActive ? (b.trialEndsAt ? new Date(b.trialEndsAt).getTime() : 0) : (b.subscriptionPaidUntil ? new Date(b.subscriptionPaidUntil).getTime() : 0);
        comparison = dateA - dateB;
      } else if (sortField === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [tenants, searchQuery, filterStatus, filterTier, filterVertical, sortField, sortDir]);

  const totalPages = Math.ceil(filteredAndSortedTenants.length / pageSize) || 1;
  const paginatedTenants = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAndSortedTenants.slice(start, start + pageSize);
  }, [filteredAndSortedTenants, page, pageSize]);

  const handleSort = (field: 'name' | 'tier' | 'status' | 'branches' | 'expiry' | 'createdAt') => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const renderSortIcon = (field: typeof sortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-300 ml-1 inline-block" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-teal-600 ml-1 inline-block" />
      : <ChevronDown className="w-3 h-3 text-teal-600 ml-1 inline-block" />;
  };

  const handleExportCSV = () => {
    const headers = ['Restaurant Name', 'Slug', 'Contact Person', 'Email', 'Phone', 'City', 'Country', 'Business Type', 'Tier', 'Status', 'Branches', 'Expiry Date', 'Created At'];
    const rows = filteredAndSortedTenants.map(t => [
      `"${(t.name || '').replace(/"/g, '""')}"`,
      `"${(t.slug || '').replace(/"/g, '""')}"`,
      `"${(t.contactName || '').replace(/"/g, '""')}"`,
      `"${(t.contactEmail || '').replace(/"/g, '""')}"`,
      `"${(t.contactPhone || '').replace(/"/g, '""')}"`,
      `"${(t.city || '').replace(/"/g, '""')}"`,
      `"${(t.country || '').replace(/"/g, '""')}"`,
      `"${(t.businessType || '').replace(/"/g, '""')}"`,
      `"${t.tier || ''}"`,
      `"${t.isActive ? (t.isTrialActive ? 'On Trial' : 'Active') : 'Inactive'}"`,
      t.branchCount ?? 1,
      `"${t.isTrialActive ? (t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : '') : (t.subscriptionPaidUntil ? new Date(t.subscriptionPaidUntil).toLocaleDateString() : 'Expired')}"`,
      `"${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cashly_tenants_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
    <div className="space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">{TAB_TITLES[activeTab].title}</h1>
            <p className="text-xs text-slate-500">{TAB_TITLES[activeTab].subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(activeTab === 'dashboard' || activeTab === 'tenants') && (
            <button
              onClick={() => setProvisionOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Provision tenant
            </button>
          )}
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && (
        <DashboardTab
          stats={stats}
          onOpenTenant={(id, tab) => {
            setOpenPanelTab(tab);
            setOpenTenantId(id);
          }}
          onSeeRenewals={() => setSearchParams({ tab: 'renewals' })}
        />
      )}

      {activeTab === 'renewals' && (
        <RenewalsBoard
          onOpenTenant={(id) => {
            setOpenPanelTab('subscriptions');
            setOpenTenantId(id);
          }}
        />
      )}

      {activeTab === 'tenants' && (
        <>
          {/* Quick Stats / Filter Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'All Tenants', count: tenantStats.total, status: 'all', color: 'border-slate-200 bg-white hover:border-slate-400 text-slate-800' },
              { label: 'Active', count: tenantStats.active, status: 'active', color: 'border-teal-200 bg-teal-50/50 hover:border-teal-400 text-teal-800' },
              { label: 'On Trial', count: tenantStats.trial, status: 'trial', color: 'border-amber-200 bg-amber-50/50 hover:border-amber-400 text-amber-800' },
              { label: 'Expiring ≤14d', count: tenantStats.expiringSoon, status: 'expiring', color: 'border-rose-200 bg-rose-50/50 hover:border-rose-400 text-rose-800' },
              { label: 'Inactive / Off', count: tenantStats.inactive, status: 'inactive', color: 'border-slate-200 bg-slate-50 hover:border-slate-400 text-slate-600' }
            ].map(pill => (
              <button
                key={pill.status}
                onClick={() => {
                  setFilterStatus(pill.status as any);
                  setPage(1);
                }}
                className={`p-3 rounded-2xl border text-left transition shadow-2xs ${pill.color} ${
                  filterStatus === pill.status ? 'ring-2 ring-teal-500 font-bold' : ''
                }`}
              >
                <div className="text-[10px] uppercase font-bold tracking-wider opacity-70">{pill.label}</div>
                <div className="text-xl font-black mt-0.5">{pill.count}</div>
              </button>
            ))}
          </div>

          {/* Search + Multi-filter Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by restaurant name, slug, email, phone, city..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value as any);
                    setPage(1);
                  }}
                  className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="trial">On Trial</option>
                  <option value="expiring">Expiring Soon (≤14d)</option>
                  <option value="paid">Paid</option>
                  <option value="inactive">Inactive</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Tier Filter */}
              <div className="relative">
                <select
                  value={filterTier}
                  onChange={(e) => {
                    setFilterTier(e.target.value);
                    setPage(1);
                  }}
                  className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Plans</option>
                  <option value="Starter">Starter</option>
                  <option value="Standard">Standard</option>
                  <option value="Professional">{tierLabel('Professional')}</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              {/* Vertical / Type Filter */}
              {businessTypes.length > 0 && (
                <div className="relative">
                  <select
                    value={filterVertical}
                    onChange={(e) => {
                      setFilterVertical(e.target.value);
                      setPage(1);
                    }}
                    className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none cursor-pointer capitalize"
                  >
                    <option value="all">All Sectors</option>
                    {businessTypes.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                </div>
              )}

              {/* Reset Filters */}
              {(filterStatus !== 'all' || filterTier !== 'all' || filterVertical !== 'all' || searchQuery) && (
                <button
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterTier('all');
                    setFilterVertical('all');
                    setSearchQuery('');
                    setPage(1);
                  }}
                  title="Reset filters"
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              )}

              {/* Export to CSV */}
              <button
                onClick={handleExportCSV}
                title="Export filtered records to CSV"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold transition"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Tenants Table */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 select-none">
                    <th
                      onClick={() => handleSort('name')}
                      className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px] cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center gap-1">
                        <span>Restaurant</span>
                        {renderSortIcon('name')}
                      </div>
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Contact</th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Location / Type</th>
                    <th
                      onClick={() => handleSort('tier')}
                      className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Tier</span>
                        {renderSortIcon('tier')}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('status')}
                      className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Status</span>
                        {renderSortIcon('status')}
                      </div>
                    </th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Usage vs. Plan</th>
                    <th
                      onClick={() => handleSort('branches')}
                      className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Branches</span>
                        {renderSortIcon('branches')}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('expiry')}
                      className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] cursor-pointer hover:text-slate-800"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Expiry</span>
                        {renderSortIcon('expiry')}
                      </div>
                    </th>
                    <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedTenants.map((t) => (
                    <tr key={t.id} className="bg-white hover:bg-slate-50/70 transition">
                      {/* Restaurant */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500/10 to-teal-500/25 text-teal-800 font-bold flex items-center justify-center shrink-0 text-xs border border-teal-200/40 shadow-2xs">
                            {t.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <button
                              onClick={() => {
                                setOpenPanelTab('overview');
                                setOpenTenantId(t.id);
                              }}
                              className="font-bold text-slate-900 hover:text-teal-600 transition text-left truncate block max-w-[200px]"
                              title="Open tenant overview"
                            >
                              {t.name}
                            </button>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">{t.slug}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(t.slug);
                                  setCopiedSlugId(t.id);
                                  setTimeout(() => setCopiedSlugId(null), 1500);
                                }}
                                title="Copy slug"
                                className="text-slate-400 hover:text-slate-600 transition"
                              >
                                {copiedSlugId === t.id ? <Check className="w-2.5 h-2.5 text-teal-600" /> : <Copy className="w-2.5 h-2.5" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="px-4 py-3">
                        <div className="text-slate-800 font-medium">{t.contactName}</div>
                        <div className="mt-0.5">
                          <a
                            href={`mailto:${t.contactEmail}`}
                            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-teal-600 transition"
                            title={`Email ${t.contactEmail}`}
                          >
                            <Mail className="w-2.5 h-2.5 opacity-60 shrink-0" />
                            <span className="truncate max-w-[150px]">{t.contactEmail}</span>
                          </a>
                        </div>
                        {t.contactPhone && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <a
                              href={`tel:${t.contactPhone}`}
                              className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-teal-600 font-mono transition"
                              title={`Call ${t.contactPhone}`}
                            >
                              <Phone className="w-2.5 h-2.5 opacity-60 shrink-0" />
                              <span>{t.contactPhone}</span>
                            </a>
                            <a
                              href={`https://wa.me/${t.contactPhone.replace(/[^0-9]/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Chat on WhatsApp"
                              className="p-0.5 rounded text-teal-600 hover:bg-teal-50 transition"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </td>

                      {/* Location / Type */}
                      <td className="text-center px-4 py-3">
                        <div className="text-slate-700">{t.city || '—'}{t.country ? `, ${t.country}` : ''}</div>
                        <div className="text-[10px] text-slate-400 capitalize">{t.businessType || '—'}</div>
                      </td>

                      {/* Tier */}
                      <td className="text-center px-4 py-3">
                        <button
                          onClick={() => {
                            setOpenPanelTab('plan');
                            setOpenTenantId(t.id);
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition hover:opacity-80 shadow-2xs ${tierColor(t.tier)}`}
                          title="View or change plan"
                        >
                          <span>{tierLabel(t.tier)}</span>
                          <ArrowRight className="w-2.5 h-2.5 opacity-60" />
                        </button>
                      </td>

                      {/* Status */}
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

                      {/* Usage vs. Plan - PRESERVED EXACTLY AS REQUESTED */}
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

                      {/* Branches */}
                      <td className="text-center px-4 py-3 font-mono text-slate-700">{t.branchCount}</td>

                      {/* Expiry */}
                      <td className="text-center px-4 py-3">
                        {t.isTrialActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                            <Clock className="w-3 h-3" />
                            Trial: {new Date(t.trialEndsAt).toLocaleDateString()}
                          </span>
                        ) : t.subscriptionPaidUntil ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-bold">
                            Paid: {new Date(t.subscriptionPaidUntil).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                            Expired
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="text-center px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5 relative tenant-action-menu-container">
                          <button
                            onClick={() => {
                              setOpenPanelTab('overview');
                              setOpenTenantId(t.id);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold transition shadow-2xs"
                            title="Open this tenant"
                          >
                            Manage
                          </button>
                          <div className="relative">
                            <button
                              onClick={() => setActionMenuTenantId(actionMenuTenantId === t.id ? null : t.id)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition"
                              title="More options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {actionMenuTenantId === t.id && (
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30 text-left">
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    setQuickImpersonateTenant(t);
                                    setImpersonateReason('');
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition"
                                >
                                  <Eye className="w-3.5 h-3.5 text-blue-500" />
                                  Support Session (Login)
                                </button>
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    setQuickExtendTenant(t);
                                    setExtendDays(14);
                                    setExtendReason('');
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition"
                                >
                                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                                  Extend Trial
                                </button>
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    setOpenPanelTab('plan');
                                    setOpenTenantId(t.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition"
                                >
                                  <DollarSign className="w-3.5 h-3.5 text-teal-500" />
                                  Plan & Billing
                                </button>
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    setOpenPanelTab('deploy');
                                    setOpenTenantId(t.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition"
                                >
                                  <Building2 className="w-3.5 h-3.5 text-purple-500" />
                                  Branches & Outlets
                                </button>
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    navigator.clipboard.writeText(t.slug);
                                    setCopiedSlugId(t.id);
                                    setTimeout(() => setCopiedSlugId(null), 1500);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition"
                                >
                                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                                  Copy Slug
                                </button>
                                <div className="my-1 border-t border-slate-100" />
                                <button
                                  onClick={() => {
                                    setActionMenuTenantId(null);
                                    setConfirmToggleTenant(t);
                                  }}
                                  className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 font-bold transition ${
                                    t.isActive ? 'text-rose-600 hover:bg-rose-50' : 'text-teal-600 hover:bg-teal-50'
                                  }`}
                                >
                                  {t.isActive ? (
                                    <>
                                      <ToggleLeft className="w-3.5 h-3.5" />
                                      Deactivate Tenant
                                    </>
                                  ) : (
                                    <>
                                      <ToggleRight className="w-3.5 h-3.5" />
                                      Activate Tenant
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredAndSortedTenants.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-500">
                        No restaurants found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredAndSortedTenants.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/50">
                <div className="text-xs text-slate-500">
                  Showing <span className="font-bold text-slate-800">{Math.min((page - 1) * pageSize + 1, filteredAndSortedTenants.length)}</span> to{' '}
                  <span className="font-bold text-slate-800">{Math.min(page * pageSize, filteredAndSortedTenants.length)}</span> of{' '}
                  <span className="font-bold text-slate-800">{filteredAndSortedTenants.length}</span> tenants
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span>Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 focus:outline-none focus:border-teal-500"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-2 text-xs font-bold text-slate-700">
                      {page} / {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 transition"
                      title="Next page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
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

      {/* Safety Confirmation Modal for Deactivating / Reactivating Tenant */}
      {confirmToggleTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setConfirmToggleTenant(null)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                confirmToggleTenant.isActive ? 'bg-rose-100 text-rose-600' : 'bg-teal-100 text-teal-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {confirmToggleTenant.isActive ? `Deactivate ${confirmToggleTenant.name}?` : `Reactivate ${confirmToggleTenant.name}?`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {confirmToggleTenant.isActive
                    ? 'This will immediately disconnect all active POS terminals, tablets, and logins for this restaurant.'
                    : 'This will restore access for all staff and terminals.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setConfirmToggleTenant(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                disabled={modalBusy}
                onClick={async () => {
                  setModalBusy(true);
                  try {
                    const id = confirmToggleTenant.id;
                    setConfirmToggleTenant(null);
                    await handleToggleActive(id);
                  } finally {
                    setModalBusy(false);
                  }
                }}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold transition flex items-center gap-1.5 ${
                  confirmToggleTenant.isActive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {modalBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                {confirmToggleTenant.isActive ? 'Yes, Deactivate' : 'Yes, Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Extend Trial Modal */}
      {quickExtendTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setQuickExtendTenant(null)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-black text-slate-900">Extend Trial: {quickExtendTenant.name}</h3>
              </div>
              <button onClick={() => setQuickExtendTenant(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500">Add Days</label>
                <div className="flex gap-2 mt-1">
                  {[7, 14, 30, 60].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setExtendDays(d)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${
                        extendDays === d ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      +{d}d
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={extendDays}
                  onChange={(e) => setExtendDays(Number(e.target.value) || 1)}
                  className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                  placeholder="Custom days..."
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500">Reason (Required for audit log)</label>
                <input
                  value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  placeholder="e.g. Sales extension requested / Onboarding assistance"
                  className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setQuickExtendTenant(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                disabled={!extendReason.trim() || modalBusy}
                onClick={async () => {
                  setModalBusy(true);
                  try {
                    await posApi.extendTrial(quickExtendTenant.id, extendDays, extendReason.trim());
                    setQuickExtendTenant(null);
                    setExtendReason('');
                    await loadData();
                  } catch (err) {
                    alert(getApiErrorMessage(err, 'Failed to extend trial.'));
                  } finally {
                    setModalBusy(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                {modalBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Extension
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Impersonate Support Session Modal */}
      {quickImpersonateTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setQuickImpersonateTenant(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-slate-700" />
              <h3 className="text-sm font-black text-slate-900">Support Session</h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Open <strong>{quickImpersonateTenant.name}</strong> in read-only support mode. This session is time-limited and written to the customer's audit log.
            </p>
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500">Reason</label>
              <textarea
                value={impersonateReason}
                onChange={(e) => setImpersonateReason(e.target.value)}
                placeholder="Why are you opening this customer's account?"
                rows={3}
                className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setQuickImpersonateTenant(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                disabled={!impersonateReason.trim() || modalBusy}
                onClick={async () => {
                  setModalBusy(true);
                  try {
                    const res = await posApi.impersonateTenant(quickImpersonateTenant.id, impersonateReason.trim(), false);
                    setQuickImpersonateTenant(null);
                    setImpersonateReason('');
                    beginSupportSession(res);
                  } catch (err) {
                    alert(getApiErrorMessage(err, 'Could not start a support session.'));
                  } finally {
                    setModalBusy(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                {modalBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Launch Session
              </button>
            </div>
          </div>
        </div>
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
              {result.slug} is live on {tierLabel(result.tier)}.
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
                  <option value="Professional">{tierLabel('Professional')}</option>
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
  onSeeRenewals: () => void;
}> = ({ stats, onOpenTenant, onSeeRenewals }) => {
  const [health, setHealth] = useState<DeviceHealthReport | null>(null);
  // Renewals per part: the ERP, each outlet's POS and each extra tablet, each on its own date.
  const [renewals, setRenewals] = useState<SubscriptionPartRow[]>([]);
  const [renewalCounts, setRenewalCounts] = useState<RenewalsSummary | null>(null);

  useEffect(() => {
    posApi.getDeviceHealth().then(setHealth).catch(() => setHealth(null));
    posApi.getRenewals().then(setRenewals).catch(() => setRenewals([]));
    posApi.getRenewalsSummary().then(setRenewalCounts).catch(() => setRenewalCounts(null));
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
    { label: 'Branches', value: stats.totalBranches.toLocaleString(), icon: Building2, color: 'text-cyan-700' },
    { label: 'Orders', value: stats.totalOrders.toLocaleString(), icon: Users, color: 'text-pink-600' },
    { label: 'In arrears', value: stats.arrears.toLocaleString(), icon: AlertTriangle, color: 'text-rose-600' },
    {
      label: 'Renewals due ≤14d',
      value: (renewalCounts ? renewalCounts.all.expiring + renewalCounts.all.overdue : stats.expiringSoonCount).toLocaleString(),
      icon: Receipt,
      color: 'text-amber-600'
    },
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
                <span className="font-bold text-slate-700">{tierLabel(p.tier)}</span>
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

        {/* Each part renews on its own date, so the counts are by what is renewing. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Renewals in the next 14 days</div>
            <button onClick={onSeeRenewals} className="text-[11px] font-bold text-teal-700 hover:text-teal-900">See all</button>
          </div>
          {renewalCounts && (
            <div className="grid grid-cols-4 gap-2">
              {([
                ['ERP', renewalCounts.erp],
                ['POS', renewalCounts.pos],
                ['Tablets', renewalCounts.tablet],
                ['Add-ons', renewalCounts.addOn]
              ] as const).map(([label, counts]) => (
                <div key={label} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-500">{label}</div>
                  <div className="text-base font-black text-amber-600">{counts.expiring}</div>
                  <div className={`text-[10px] ${counts.overdue > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                    {counts.overdue} overdue
                  </div>
                </div>
              ))}
            </div>
          )}
          {renewals.filter(needsAttention).length === 0 && (
            <p className="text-xs text-slate-500">Nothing renewing soon or overdue.</p>
          )}
          {renewals.filter(needsAttention).slice(0, 5).map(p => (
            <button
              key={p.id}
              onClick={() => onOpenTenant(p.tenantId, 'subscriptions')}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-300 transition text-left"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{p.tenantName}</div>
                <div className="text-[10px] text-slate-500 truncate">{KIND_LABEL[p.kind]} · {p.name}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-bold ${(p.daysLeft ?? 0) < 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                {p.renewsAt ? new Date(p.renewsAt).toLocaleDateString() : ''} · {daysText(p.daysLeft)}
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

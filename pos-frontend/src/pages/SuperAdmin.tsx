import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, Building2, TrendingUp, DollarSign, Search, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Receipt, Puzzle, Plus, Copy, X, Activity, ArrowUpDown,
  MoreVertical, Mail, Phone, MessageCircle, Download, Check, Eye, ArrowRight, XCircle, RotateCcw, UserPlus,
  CalendarClock, HandCoins, Wallet, LogOut
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { beginSupportSession } from '../services/supportSession';
import { usePosStore } from '../store/posStore';
import { PricingAdmin } from './PricingAdmin';
import { WhatsAppConfig } from './WhatsAppConfig';
import { SubscriptionBilling } from './SubscriptionBilling';
import { AddOnManagement } from './AddOnManagement';
import { PlatformSettingsPage } from './platform/PlatformSettingsPage';
import { MessageLog } from './platform/MessageLog';
import { PlatformTeam } from './platform/PlatformTeam';
import { ActivityLog } from './platform/ActivityLog';
import { RevenueReports } from './platform/RevenueReports';
import { Announcements } from './platform/Announcements';
import { TenantDetailPanel } from '../components/TenantDetailPanel';
import { RenewalsBoard } from '../components/SubscriptionParts';
import { AccountSecurityModal } from '../components/AccountSecurityModal';
import { KIND_LABEL, daysText, needsAttention, pkr, dateOf, whatsAppNumber, panelTabFrom, type TenantPanelTab } from '../utils/renewals';
import type { AdminTenantRow, AdminPlatformStats, BillingSummary, DeviceHealthReport, FollowUp, SubscriptionPartRow, RenewalsSummary } from '../types';
import { tierLabel } from '../utils/tierLabel';

type SuperTab = 'dashboard' | 'tenants' | 'renewals' | 'billing' | 'revenue' | 'packages' | 'addons'
  | 'messages' | 'announcements' | 'whatsapp' | 'team' | 'activity' | 'settings';
const SUPER_TABS: SuperTab[] = ['dashboard', 'tenants', 'renewals', 'billing', 'revenue', 'packages', 'addons',
  'messages', 'announcements', 'whatsapp', 'team', 'activity', 'settings'];

/** Each section's heading; the sidebar is where they are picked. */
const TAB_TITLES: Record<SuperTab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'The whole platform at a glance' },
  tenants: { title: 'Businesses', subtitle: 'Every business on Cashly' },
  renewals: { title: 'Renewals', subtitle: 'ERP, each outlet\'s POS and each tablet — each renewing on its own date' },
  billing: { title: 'Billing', subtitle: 'Invoices, payments and what is owed' },
  revenue: { title: 'Revenue', subtitle: 'Money in, recurring revenue, customers won and lost' },
  packages: { title: 'Packages & Pricing', subtitle: 'POS versions, the Head Office ERP, prices and limits' },
  addons: { title: 'Add-ons', subtitle: 'Extras businesses can add, and who has them' },
  messages: { title: 'Message Log', subtitle: 'Reminders, invoices and messages the platform sent' },
  announcements: { title: 'Announcements', subtitle: 'Banners shown inside customers\' apps' },
  whatsapp: { title: 'Customer WhatsApp', subtitle: 'A business\'s own WhatsApp line to its customers' },
  team: { title: 'Platform Team', subtitle: 'Who runs Cashly, and what each may change' },
  activity: { title: 'Activity Log', subtitle: 'Everything the team and the billing automation did' },
  settings: { title: 'Settings', subtitle: 'Your company, payment details and how billing runs' }
};

const STATUS_LOOK: Record<string, { label: string; cls: string }> = {
  Trial: { label: 'Trial', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  Active: { label: 'Active', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  PastDue: { label: 'Past due', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Restricted: { label: 'Restricted', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  ReadOnly: { label: 'Read-only', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  Suspended: { label: 'Suspended', cls: 'bg-rose-600 text-white border-rose-600' },
  Cancelled: { label: 'Closed', cls: 'bg-slate-200 text-slate-600 border-slate-300' }
};

type StatusFilter = 'all' | 'active' | 'trial' | 'issues' | 'renewing' | 'off';
type SortField = 'name' | 'tier' | 'status' | 'monthly' | 'renewal' | 'createdAt' | 'lastSeen';

const isOpen = (t: AdminTenantRow) => t.status !== 'Suspended' && t.status !== 'Cancelled';
const hasIssues = (t: AdminTenantRow) =>
  t.status === 'PastDue' || t.status === 'Restricted' || t.status === 'ReadOnly'
  || (!!t.nextRenewal && ['Expired', 'PaymentDue', 'Stopped'].includes(t.nextRenewal.status));
const matchesStatus = (t: AdminTenantRow, f: StatusFilter) =>
  f === 'all' ? true
    : f === 'active' ? t.status === 'Active'
    : f === 'trial' ? t.status === 'Trial'
    : f === 'issues' ? isOpen(t) && hasIssues(t)
    : f === 'renewing' ? t.nextRenewal?.status === 'Expiring'
    : !isOpen(t);

const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

export const SuperAdmin: React.FC = () => {
  // Shareable console state: /super-admin?tab=billing&tenant=<id>&ptab=billing restores exactly
  // what the operator was looking at. The sidebar's links open sections directly.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as SuperTab | null;
  const activeTab: SuperTab = urlTab && SUPER_TABS.includes(urlTab) ? urlTab : 'dashboard';
  const currentUser = usePosStore(s => s.currentUser);
  const logout = usePosStore(s => s.logout);

  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsTwoStep, setNeedsTwoStep] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterTier, setFilterTier] = useState('all');
  const [filterVertical, setFilterVertical] = useState('all');
  const [filterShape, setFilterShape] = useState('all');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [quickExtendTenant, setQuickExtendTenant] = useState<AdminTenantRow | null>(null);
  const [extendDays, setExtendDays] = useState(14);
  const [extendReason, setExtendReason] = useState('');
  const [quickImpersonateTenant, setQuickImpersonateTenant] = useState<AdminTenantRow | null>(null);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [actionMenuTenantId, setActionMenuTenantId] = useState<string | null>(null);
  const [copiedSlugId, setCopiedSlugId] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);
  // "Quiet for a day" is judged against when the console was opened, not re-read on every render.
  const [openedAt] = useState(() => Date.now());

  const openTenantId = searchParams.get('tenant');
  const openPanelTab = panelTabFrom(searchParams.get('ptab'));
  const openTenant = (id: string, tab: TenantPanelTab = 'overview') => {
    const next = new URLSearchParams(searchParams);
    next.set('tenant', id);
    if (tab === 'overview') next.delete('ptab'); else next.set('ptab', tab);
    setSearchParams(next);
  };
  const closeTenant = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('tenant');
    next.delete('ptab');
    setSearchParams(next);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuTenantId && !(e.target as HTMLElement).closest('.tenant-action-menu-container')) setActionMenuTenantId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionMenuTenantId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([posApi.getAdminTenants(), posApi.getAdminStats()])
      .then(([tenantsData, statsData]) => {
        if (cancelled) return;
        setTenants(tenantsData);
        setStats(statsData);
        setNeedsTwoStep(false);
      })
      .catch(err => {
        if (cancelled) return;
        const body = (err as { response?: { data?: { twoFactorSetupRequired?: boolean } } }).response?.data;
        if (body?.twoFactorSetupRequired) setNeedsTwoStep(true);
        else console.error('Failed to load admin data:', err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadTick]);

  const loadData = () => { setLoading(true); setLoadTick(t => t + 1); };

  const tenantStats = useMemo(() => ({
    all: tenants.length,
    active: tenants.filter(t => matchesStatus(t, 'active')).length,
    trial: tenants.filter(t => matchesStatus(t, 'trial')).length,
    issues: tenants.filter(t => matchesStatus(t, 'issues')).length,
    renewing: tenants.filter(t => matchesStatus(t, 'renewing')).length,
    off: tenants.filter(t => matchesStatus(t, 'off')).length
  }), [tenants]);

  const businessTypes = useMemo(() => Array.from(new Set(tenants.map(t => t.businessType).filter(Boolean))).sort(), [tenants]);

  const filteredAndSortedTenants = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const result = tenants.filter(t => {
      const matchesSearch = !q || t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)
        || t.contactName.toLowerCase().includes(q) || t.contactEmail.toLowerCase().includes(q)
        || (t.contactPhone ?? '').toLowerCase().includes(q) || (t.city ?? '').toLowerCase().includes(q);
      return matchesSearch && matchesStatus(t, filterStatus)
        && (filterTier === 'all' || t.tier === filterTier)
        && (filterVertical === 'all' || t.businessType === filterVertical)
        && (filterShape === 'all' || t.deploymentMode === filterShape);
    });
    const order: Record<string, number> = { Starter: 1, Standard: 2, Professional: 3 };
    result.sort((a, b) => {
      let c: number;
      if (sortField === 'name') c = a.name.localeCompare(b.name);
      else if (sortField === 'tier') c = (order[a.tier] || 0) - (order[b.tier] || 0);
      else if (sortField === 'status') c = (a.status ?? '').localeCompare(b.status ?? '');
      else if (sortField === 'monthly') c = (a.monthlyPKR ?? 0) - (b.monthlyPKR ?? 0);
      else if (sortField === 'renewal') c = new Date(a.nextRenewal?.renewsAt ?? '2999-01-01').getTime() - new Date(b.nextRenewal?.renewsAt ?? '2999-01-01').getTime();
      else if (sortField === 'lastSeen') c = new Date(a.lastSeenAt ?? 0).getTime() - new Date(b.lastSeenAt ?? 0).getTime();
      else c = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === 'asc' ? c : -c;
    });
    return result;
  }, [tenants, searchQuery, filterStatus, filterTier, filterVertical, filterShape, sortField, sortDir]);

  const totalPages = Math.ceil(filteredAndSortedTenants.length / pageSize) || 1;
  const paginatedTenants = filteredAndSortedTenants.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir(field === 'renewal' || field === 'name' ? 'asc' : 'desc'); }
    setPage(1);
  };
  const sortIcon = (field: SortField) => sortField !== field
    ? <ArrowUpDown className="w-3 h-3 text-slate-300 ml-1 inline-block" />
    : sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-teal-600 ml-1 inline-block" /> : <ChevronDown className="w-3 h-3 text-teal-600 ml-1 inline-block" />;

  const handleExportCSV = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Business', 'Web name', 'Contact', 'Email', 'Phone', 'City', 'Sector', 'Shape', 'Outlets', 'Plan', 'Status',
      'Pays a month (PKR)', 'Next renewal', 'Renews on', 'Last seen', 'Created'];
    const rows = filteredAndSortedTenants.map(t => [
      t.name, t.slug, t.contactName, t.contactEmail, t.contactPhone, t.city, t.businessType,
      t.deploymentMode === 'HeadOffice' ? 'Head office' : 'Single shop', t.outletCount ?? '', tierLabel(t.tier), STATUS_LOOK[t.status ?? '']?.label ?? t.status,
      Math.round(t.monthlyPKR ?? 0), t.nextRenewal?.partName ?? '', t.nextRenewal?.renewsAt ? dateOf(t.nextRenewal.renewsAt) : '',
      t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : '', dateOf(t.createdAt)
    ].map(cell).join(','));
    const blob = new Blob(['﻿' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cashly_businesses_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const tierColor = (tier: string) =>
    tier === 'Starter' ? 'bg-blue-100 text-blue-700 border border-blue-200'
      : tier === 'Standard' ? 'bg-amber-100 text-amber-700 border border-amber-200'
      : tier === 'Professional' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-slate-100 text-slate-500';

  if (needsTwoStep) {
    return (
      <div className="p-6 flex justify-center">
        <div className="max-w-md w-full rounded-2xl border border-teal-200 bg-white p-6 space-y-4 text-center shadow-sm">
          <ShieldCheck className="w-10 h-10 text-teal-600 mx-auto" />
          <h1 className="text-lg font-black text-slate-900">Turn on 2-step sign-in first</h1>
          <p className="text-xs text-slate-600">
            This console can change every business on Cashly, so everyone on the team protects their account with a code from an
            authenticator app (Google Authenticator, Microsoft Authenticator…). It takes a minute.
          </p>
          <button onClick={() => setSecurityOpen(true)} className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-sm font-bold">Set it up now</button>
          <button onClick={() => logout()} className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Done — sign out and back in
          </button>
          <p className="text-[11px] text-slate-500">When 2-step is on, sign out and sign in again with your email, password and the code.</p>
        </div>
        {securityOpen && <AccountSecurityModal onClose={() => setSecurityOpen(false)} />}
      </div>
    );
  }

  if (loading && tenants.length === 0 && !stats) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-teal-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading platform data...</p>
        </div>
      </div>
    );
  }

  const pills: { key: StatusFilter; label: string; color: string }[] = [
    { key: 'all', label: 'All businesses', color: 'border-slate-200 bg-white text-slate-800' },
    { key: 'active', label: 'Active', color: 'border-teal-200 bg-teal-50/50 text-teal-800' },
    { key: 'trial', label: 'On trial', color: 'border-sky-200 bg-sky-50/50 text-sky-800' },
    { key: 'issues', label: 'Payment issues', color: 'border-rose-200 bg-rose-50/50 text-rose-800' },
    { key: 'renewing', label: 'Renewing ≤14d', color: 'border-amber-200 bg-amber-50/50 text-amber-800' },
    { key: 'off', label: 'Suspended / closed', color: 'border-slate-200 bg-slate-50 text-slate-600' }
  ];
  const selectCls = 'appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:outline-none cursor-pointer';

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-teal-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-slate-900">{TAB_TITLES[activeTab].title}</h1>
            <p className="text-xs text-slate-500 truncate">{TAB_TITLES[activeTab].subtitle}</p>
          </div>
        </div>
        {(activeTab === 'dashboard' || activeTab === 'tenants') && (
          <div className="flex items-center gap-2">
            <button onClick={() => setProvisionOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition">
              <Plus className="w-3.5 h-3.5" /> New business
            </button>
            <button onClick={loadData} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        )}
      </div>

      {currentUser?.isSetupAccount && activeTab !== 'team' && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          You are signed in with the shared setup PIN. Add yourself to the platform team with your own email, then sign in as yourself.
          <button onClick={() => setSearchParams({ tab: 'team' })} className="font-bold underline">Open Platform Team</button>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <DashboardTab stats={stats} onOpenTenant={openTenant} onGo={(tab) => setSearchParams({ tab })} />
      )}

      {activeTab === 'renewals' && <RenewalsBoard onOpenTenant={(id) => openTenant(id, 'billing')} />}
      {activeTab === 'billing' && <SubscriptionBilling onOpenTenant={(id) => openTenant(id, 'billing')} />}
      {activeTab === 'revenue' && <RevenueReports />}
      {activeTab === 'packages' && <PricingAdmin />}
      {activeTab === 'addons' && <AddOnManagement onOpenTenant={(id) => openTenant(id, 'plan')} />}
      {activeTab === 'messages' && <MessageLog onOpenTenant={(id) => openTenant(id, 'billing')} />}
      {activeTab === 'announcements' && <Announcements />}
      {activeTab === 'whatsapp' && <WhatsAppConfig />}
      {activeTab === 'team' && <PlatformTeam />}
      {activeTab === 'activity' && <ActivityLog onOpenTenant={(id) => openTenant(id, 'activity')} />}
      {activeTab === 'settings' && <PlatformSettingsPage />}

      {activeTab === 'tenants' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {pills.map(pill => (
              <button key={pill.key} onClick={() => { setFilterStatus(pill.key); setPage(1); }}
                className={`p-3 rounded-2xl border text-left transition ${pill.color} ${filterStatus === pill.key ? 'ring-2 ring-teal-500' : ''}`}>
                <div className="text-[10px] uppercase font-bold tracking-wider opacity-70">{pill.label}</div>
                <div className="text-xl font-black mt-0.5">{tenantStats[pill.key]}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder="Search by business, web name, owner, email, phone, city…"
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><XCircle className="w-3.5 h-3.5" /></button>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <select value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(1); }} className={selectCls}>
                  <option value="all">All plans</option><option value="Starter">Starter</option><option value="Standard">Standard</option><option value="Professional">{tierLabel('Professional')}</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
              <div className="relative">
                <select value={filterShape} onChange={(e) => { setFilterShape(e.target.value); setPage(1); }} className={selectCls}>
                  <option value="all">Any shape</option><option value="Standalone">Single shops</option><option value="HeadOffice">With head office</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
              {businessTypes.length > 0 && (
                <div className="relative">
                  <select value={filterVertical} onChange={(e) => { setFilterVertical(e.target.value); setPage(1); }} className={`${selectCls} capitalize`}>
                    <option value="all">All sectors</option>
                    {businessTypes.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                </div>
              )}
              {(filterStatus !== 'all' || filterTier !== 'all' || filterVertical !== 'all' || filterShape !== 'all' || searchQuery) && (
                <button onClick={() => { setFilterStatus('all'); setFilterTier('all'); setFilterVertical('all'); setFilterShape('all'); setSearchQuery(''); setPage(1); }}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold">
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              )}
              <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold">
                <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 select-none text-[10px] uppercase text-slate-500 font-bold">
                    <th onClick={() => handleSort('name')} className="text-left px-4 py-3 cursor-pointer hover:text-slate-800">Business {sortIcon('name')}</th>
                    <th className="text-left px-4 py-3">Owner</th>
                    <th className="text-left px-4 py-3">Shape</th>
                    <th onClick={() => handleSort('tier')} className="text-center px-4 py-3 cursor-pointer hover:text-slate-800">Plan {sortIcon('tier')}</th>
                    <th onClick={() => handleSort('status')} className="text-center px-4 py-3 cursor-pointer hover:text-slate-800">Status {sortIcon('status')}</th>
                    <th className="text-center px-4 py-3">Usage</th>
                    <th onClick={() => handleSort('monthly')} className="text-right px-4 py-3 cursor-pointer hover:text-slate-800">Pays / month {sortIcon('monthly')}</th>
                    <th onClick={() => handleSort('renewal')} className="text-left px-4 py-3 cursor-pointer hover:text-slate-800">Next renewal {sortIcon('renewal')}</th>
                    <th onClick={() => handleSort('lastSeen')} className="text-left px-4 py-3 cursor-pointer hover:text-slate-800">Last seen {sortIcon('lastSeen')}</th>
                    <th className="text-center px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedTenants.map(t => {
                    const look = STATUS_LOOK[t.status ?? ''] ?? { label: t.status ?? '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
                    const renewal = t.nextRenewal;
                    const overdue = renewal && ['Expired', 'PaymentDue', 'Stopped'].includes(renewal.status);
                    const wa = whatsAppNumber(t.contactPhone);
                    const stale = !t.lastSeenAt || openedAt - new Date(t.lastSeenAt).getTime() > 86400000;
                    return (
                      <tr key={t.id} className="bg-white hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3">
                          <button onClick={() => openTenant(t.id)} className="font-bold text-slate-900 hover:text-teal-600 text-left truncate block max-w-[200px]" title="Open">{t.name}</button>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                            <span className="font-mono truncate max-w-[120px]">{t.slug}</span>
                            <button onClick={() => { navigator.clipboard.writeText(t.slug); setCopiedSlugId(t.id); setTimeout(() => setCopiedSlugId(null), 1500); }} title="Copy web name">
                              {copiedSlugId === t.id ? <Check className="w-2.5 h-2.5 text-teal-600" /> : <Copy className="w-2.5 h-2.5" />}
                            </button>
                            {t.city && <span>· {t.city}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-800 font-medium">{t.contactName}</div>
                          <a href={`mailto:${t.contactEmail}`} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-teal-600"><Mail className="w-2.5 h-2.5" /><span className="truncate max-w-[150px]">{t.contactEmail}</span></a>
                          {t.contactPhone && (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                              <a href={`tel:${t.contactPhone}`} className="flex items-center gap-1 hover:text-teal-600 font-mono"><Phone className="w-2.5 h-2.5" />{t.contactPhone}</a>
                              {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="text-teal-600" title="WhatsApp"><MessageCircle className="w-3 h-3" /></a>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {t.deploymentMode === 'HeadOffice' ? `Head office + ${t.outletCount ?? 0} outlet${t.outletCount === 1 ? '' : 's'}` : 'Single shop'}
                          <div className="text-[10px] text-slate-400 capitalize">{t.businessType || '—'}</div>
                        </td>
                        <td className="text-center px-4 py-3">
                          <button onClick={() => openTenant(t.id, 'plan')} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold hover:opacity-80 ${tierColor(t.tier)}`}>
                            {tierLabel(t.tier)} <ArrowRight className="w-2.5 h-2.5 opacity-60" />
                          </button>
                        </td>
                        <td className="text-center px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${look.cls}`}>{look.label}</span></td>
                        <td className="text-center px-4 py-3">
                          <div className={`flex flex-col gap-0.5 text-[10px] font-mono ${(t.outletsOverLimit ?? 0) > 0 ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>
                            <span>Tills {t.counterCount ?? 0}/{(t.maxCounters ?? 0) >= 9999 ? '∞' : t.maxCounters ?? 0}</span>
                            <span>Tablets {t.tabletCount ?? 0}/{(t.maxTablets ?? 0) >= 9999 ? '∞' : t.maxTablets ?? 0}</span>
                            {(t.outletsOverLimit ?? 0) > 0 && <span title="Outlets running more devices than their own POS version allows">{t.outletsOverLimit} outlet(s) over</span>}
                            {!!t.activeAddOnsCount && <span className="inline-flex items-center justify-center gap-1 text-purple-700"><Puzzle className="w-2.5 h-2.5" />{t.activeAddOnsCount} add-on{t.activeAddOnsCount > 1 ? 's' : ''}</span>}
                          </div>
                        </td>
                        <td className="text-right px-4 py-3 font-mono font-bold text-slate-800">{t.monthlyPKR ? pkr(t.monthlyPKR) : '—'}</td>
                        <td className="px-4 py-3">
                          {renewal ? (
                            <button onClick={() => openTenant(t.id, 'billing')} className="text-left">
                              <div className={`font-semibold ${overdue ? 'text-rose-600' : renewal.status === 'Expiring' ? 'text-amber-700' : 'text-slate-700'}`}>
                                {renewal.renewsAt ? dateOf(renewal.renewsAt) : '—'}{renewal.status === 'Stopped' && ' · stopped'}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate max-w-[180px]">{KIND_LABEL[renewal.kind]} · {renewal.partName}</div>
                              {renewal.daysLeft != null && <div className={`text-[10px] ${overdue ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{daysText(renewal.daysLeft)}</div>}
                            </button>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={`px-4 py-3 text-[11px] ${stale && isOpen(t) ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>{ago(t.lastSeenAt)}</td>
                        <td className="text-center px-4 py-3">
                          <div className="flex items-center justify-center gap-1.5 relative tenant-action-menu-container">
                            <button onClick={() => openTenant(t.id)} className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold">Manage</button>
                            <div className="relative">
                              <button onClick={() => setActionMenuTenantId(actionMenuTenantId === t.id ? null : t.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" title="More">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {actionMenuTenantId === t.id && (
                                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30 text-left">
                                  {[
                                    { icon: Wallet, color: 'text-teal-600', label: 'Billing & payments', on: () => openTenant(t.id, 'billing') },
                                    { icon: Eye, color: 'text-blue-500', label: 'Support session', on: () => { setQuickImpersonateTenant(t); setImpersonateReason(''); } },
                                    { icon: Clock, color: 'text-amber-500', label: 'Extend trial', on: () => { setQuickExtendTenant(t); setExtendDays(14); setExtendReason(''); } },
                                    { icon: Building2, color: 'text-purple-500', label: 'Locations & devices', on: () => openTenant(t.id, 'locations') },
                                    { icon: HandCoins, color: 'text-slate-500', label: 'Notes & follow-ups', on: () => openTenant(t.id, 'activity') },
                                    { icon: AlertTriangle, color: 'text-rose-500', label: 'Change status…', on: () => openTenant(t.id, 'overview') }
                                  ].map(item => (
                                    <button key={item.label} onClick={() => { setActionMenuTenantId(null); item.on(); }}
                                      className="w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium">
                                      <item.icon className={`w-3.5 h-3.5 ${item.color}`} /> {item.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAndSortedTenants.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-12 text-slate-500">No businesses match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredAndSortedTenants.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/50">
                <div className="text-xs text-slate-500">
                  Showing <b className="text-slate-800">{Math.min((page - 1) * pageSize + 1, filteredAndSortedTenants.length)}</b>–<b className="text-slate-800">{Math.min(page * pageSize, filteredAndSortedTenants.length)}</b> of <b className="text-slate-800">{filteredAndSortedTenants.length}</b>
                </div>
                <div className="flex items-center gap-3">
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs">
                    <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                  </select>
                  <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <span className="text-xs font-bold text-slate-700">{page} / {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {openTenantId && (
        <TenantDetailPanel tenantId={openTenantId} initialTab={openPanelTab} onClose={closeTenant} onChanged={loadData} />
      )}

      {quickExtendTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setQuickExtendTenant(null)} />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><Clock className="w-5 h-5 text-amber-600" /> Extend trial: {quickExtendTenant.name}</h3>
              <button onClick={() => setQuickExtendTenant(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2">
              {[7, 14, 30, 60].map(d => (
                <button key={d} onClick={() => setExtendDays(d)} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${extendDays === d ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>+{d}d</button>
              ))}
            </div>
            <input type="number" min={1} max={180} value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value) || 1)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs" />
            <input value={extendReason} onChange={(e) => setExtendReason(e.target.value)} placeholder="Reason (recorded)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setQuickExtendTenant(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Cancel</button>
              <button disabled={!extendReason.trim() || modalBusy}
                onClick={async () => {
                  setModalBusy(true);
                  try { await posApi.extendTrial(quickExtendTenant.id, extendDays, extendReason.trim()); setQuickExtendTenant(null); loadData(); }
                  catch (err) { alert(getApiErrorMessage(err, 'Failed to extend trial.')); }
                  finally { setModalBusy(false); }
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold">Extend</button>
            </div>
          </div>
        </div>
      )}

      {quickImpersonateTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setQuickImpersonateTenant(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><Eye className="w-5 h-5" /> Support session</h3>
            <p className="text-xs text-slate-500">Open <strong>{quickImpersonateTenant.name}</strong> read-only, for 30 minutes, written to their audit log.</p>
            <textarea value={impersonateReason} onChange={(e) => setImpersonateReason(e.target.value)} placeholder="Why are you opening this customer's account?" rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setQuickImpersonateTenant(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Cancel</button>
              <button disabled={!impersonateReason.trim() || modalBusy}
                onClick={async () => {
                  setModalBusy(true);
                  try { const res = await posApi.impersonateTenant(quickImpersonateTenant.id, impersonateReason.trim(), false); setQuickImpersonateTenant(null); beginSupportSession(res); }
                  catch (err) { alert(getApiErrorMessage(err, 'Could not start a support session.')); }
                  finally { setModalBusy(false); }
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 disabled:opacity-40 text-white text-xs font-bold">Open session</button>
            </div>
          </div>
        </div>
      )}

      {provisionOpen && (
        <ProvisionModal onClose={() => setProvisionOpen(false)} onDone={(tenantId) => { setProvisionOpen(false); loadData(); if (tenantId) openTenant(tenantId); }} />
      )}
    </div>
  );
};

/**
 * Creates a business from the console, in the shape it really has, and hands over the owner's
 * invite exactly once — the token is a secret the server only stores hashed.
 */
const ProvisionModal: React.FC<{ onClose: () => void; onDone: (tenantId?: string) => void }> = ({ onClose, onDone }) => {
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Pakistan');
  const [packageKey, setPackageKey] = useState('Starter');
  const [verticalPack, setVerticalPack] = useState('restaurant');
  const [structure, setStructure] = useState('SingleShop');
  const [firstOutlet, setFirstOutlet] = useState('');
  const [trialDays, setTrialDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ tenantId: string; slug: string; tier: string; ownerInviteToken: string; ownerInviteExpiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    if (!businessName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Business name, owner name and email are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setResult(await posApi.provisionTenant({
        businessName: businessName.trim(), contactName: contactName.trim(), contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined, city: city.trim() || undefined, country: country.trim() || undefined,
        packageKey, verticalPack, trialDays: Number(trialDays) || 0,
        businessStructure: structure, firstOutletName: firstOutlet.trim() || undefined
      }));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not create this business.'));
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = result ? `${window.location.origin}/invite?code=${result.ownerInviteToken}` : '';
  const inviteText = `Assalam o Alaikum ${contactName}, your Cashly account for ${businessName} is ready. Open this link to choose your username and PIN: ${inviteLink}`;
  const wa = whatsAppNumber(contactPhone);
  const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><UserPlus className="w-4 h-4 text-teal-600" /> {result ? 'Business created' : 'New business'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        {result ? (
          <div className="p-5 space-y-3">
            <div className="px-3 py-2 rounded-xl bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-700">{businessName} is live on {tierLabel(result.tier)}.</div>
            <div>
              <div className="text-[10px] uppercase font-black text-slate-500 mb-1">Owner invite link (shown once)</div>
              <div className="p-3 rounded-xl bg-slate-900 text-teal-300 font-mono text-[11px] break-all select-all">{inviteLink}</div>
              <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
                The owner opens it, chooses a username and PIN, and signs in. It works once, until {dateOf(result.ownerInviteExpiresAt)}, and cannot be shown again.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(inviteLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}
                className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5">
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
              </button>
              {wa ? (
                <a href={`https://wa.me/${wa}?text=${encodeURIComponent(inviteText)}`} target="_blank" rel="noopener noreferrer"
                  className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-teal-700 text-xs font-bold flex items-center justify-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp from my phone
                </a>
              ) : <span />}
            </div>
            <button disabled={!!sent}
              onClick={async () => {
                try {
                  const r = await posApi.sendTenantMessage(result.tenantId, 'Your Cashly account is ready', inviteText);
                  setSent(r.sent > 0 ? 'Sent by WhatsApp/email.' : 'Could not send — no WhatsApp line or email set up yet (Settings). Copy the link instead.');
                } catch (err) { setSent(getApiErrorMessage(err, 'Could not send.')); }
              }}
              className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-60">
              {sent ?? 'Send it from the platform (WhatsApp + email)'}
            </button>
            <button onClick={() => onDone(result.tenantId)} className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold">Done — open the business</button>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">{error}</div>}
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business name *" className={inputCls} />
            <div className="grid grid-cols-2 gap-2">
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Owner name *" className={inputCls} />
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Owner mobile" className={inputCls} />
            </div>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Owner email *" className={inputCls} />
            <div className="grid grid-cols-2 gap-2">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputCls} />
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className={inputCls} />
            </div>
            <label className="block">
              <span className="text-[10px] uppercase font-bold text-slate-500">Shape</span>
              <select value={structure} onChange={(e) => setStructure(e.target.value)} className={`mt-0.5 ${inputCls}`}>
                <option value="SingleShop">Single shop (POS and back office together)</option>
                <option value="SingleShopWithHeadOffice">One shop with a separate head office</option>
                <option value="ChainWithHeadOffice">Chain: head office + outlets</option>
              </select>
            </label>
            {structure !== 'SingleShop' && (
              <input value={firstOutlet} onChange={(e) => setFirstOutlet(e.target.value)} placeholder="First outlet's name (e.g. Gulberg)" className={inputCls} />
            )}
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">{structure === 'SingleShop' ? 'Plan' : 'Outlet POS'}</span>
                <select value={packageKey} onChange={(e) => setPackageKey(e.target.value)} className={`mt-0.5 ${inputCls}`}>
                  <option value="Starter">Starter</option><option value="Standard">Standard</option><option value="Professional">{tierLabel('Professional')}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Sector</span>
                <select value={verticalPack} onChange={(e) => setVerticalPack(e.target.value)} className={`mt-0.5 ${inputCls}`}>
                  {['restaurant', 'retail', 'grocery', 'pharmacy', 'salon', 'wholesale', 'apparel', 'services'].map(v => <option key={v} value={v} className="capitalize">{v[0].toUpperCase() + v.slice(1)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase font-bold text-slate-500">Trial days</span>
                <input type="number" min={0} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className={`mt-0.5 ${inputCls}`} />
              </label>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              Creates the business, its locations, settings and plan — but no login. The owner makes theirs from the invite, so nobody at Cashly ever knows their PIN.
              Payment is recorded later, per part, on Billing.
            </p>
            <button disabled={busy} onClick={submit} className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5">
              {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Create business
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * The platform at a glance: money, customers, renewals, follow-ups and quiet tills. Every row that
 * maps to a business opens straight into its panel.
 */
const DashboardTab: React.FC<{
  stats: AdminPlatformStats | null;
  onOpenTenant: (id: string, tab?: TenantPanelTab) => void;
  onGo: (tab: SuperTab) => void;
}> = ({ stats, onOpenTenant, onGo }) => {
  const [health, setHealth] = useState<DeviceHealthReport | null>(null);
  const [renewals, setRenewals] = useState<SubscriptionPartRow[]>([]);
  const [renewalCounts, setRenewalCounts] = useState<RenewalsSummary | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);

  useEffect(() => {
    posApi.getDeviceHealth().then(setHealth).catch(() => setHealth(null));
    posApi.getRenewals().then(setRenewals).catch(() => setRenewals([]));
    posApi.getRenewalsSummary().then(setRenewalCounts).catch(() => setRenewalCounts(null));
    posApi.getBillingSummary().then(setBilling).catch(() => setBilling(null));
    posApi.getFollowUps(7).then(setFollowUps).catch(() => setFollowUps([]));
  }, []);

  if (!stats) return <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 text-slate-400 animate-spin" /></div>;

  const conversion = stats.trialCohort ? Math.round(((stats.trialConverted ?? 0) / stats.trialCohort) * 100) : null;
  const cards: { label: string; value: string; sub?: string; icon: React.FC<{ className?: string }>; color: string; go?: SuperTab }[] = [
    { label: 'Businesses', value: stats.activeTenants.toLocaleString(), sub: `${stats.totalTenants} ever · ${stats.closed30d ?? 0} closed in 30 days`, icon: Building2, color: 'text-slate-900', go: 'tenants' },
    { label: 'On trial', value: stats.trialTenants.toLocaleString(), sub: conversion == null ? undefined : `${conversion}% of trials become paying`, icon: Clock, color: 'text-sky-600', go: 'tenants' },
    { label: 'Paying', value: stats.paidTenants.toLocaleString(), icon: CheckCircle2, color: 'text-teal-600', go: 'tenants' },
    { label: 'Monthly revenue', value: pkr(stats.mrrPKR), sub: stats.potentialMrrPKR ? `${pkr(stats.potentialMrrPKR)} once trials pay` : undefined, icon: TrendingUp, color: 'text-teal-700', go: 'revenue' },
    { label: 'Collected this month', value: billing ? pkr(billing.collectedThisMonthPKR) : '…', sub: billing ? `last month ${pkr(billing.collectedLastMonthPKR)}` : undefined, icon: Wallet, color: 'text-teal-700', go: 'billing' },
    { label: 'Owed to you', value: billing ? pkr(billing.owedPKR) : '…', sub: billing ? `${pkr(billing.overduePKR)} overdue` : undefined, icon: DollarSign, color: billing && billing.overduePKR > 0 ? 'text-rose-600' : 'text-slate-900', go: 'billing' },
    { label: 'New sign-ups', value: (stats.newSignups7d ?? 0).toLocaleString(), sub: `this week · ${stats.newSignups30d ?? 0} in 30 days`, icon: UserPlus, color: 'text-purple-600', go: 'tenants' },
    { label: 'Renewals due', value: renewalCounts ? (renewalCounts.all.expiring + renewalCounts.all.overdue).toLocaleString() : '…', sub: renewalCounts ? `${renewalCounts.all.overdue} overdue · ${renewalCounts.all.stopped ?? 0} stopped` : undefined, icon: CalendarClock, color: 'text-amber-600', go: 'renewals' },
    { label: 'Follow-ups due', value: (stats.followUpsDue ?? 0).toLocaleString(), sub: 'calls and promises to pay', icon: HandCoins, color: (stats.followUpsDue ?? 0) > 0 ? 'text-amber-600' : 'text-slate-900' },
    { label: 'Quiet tills (24h)', value: (health?.count ?? stats.staleDevices).toLocaleString(), sub: `${(stats.ordersLast30d ?? 0).toLocaleString()} sales in 30 days`, icon: Activity, color: 'text-rose-600' }
  ];
  const maxMix = Math.max(1, ...stats.planMix.map(p => p.count));
  const stale = health?.devices.slice(0, 5) ?? [];
  const attention = renewals.filter(needsAttention);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <button key={c.label} onClick={() => c.go && onGo(c.go)} disabled={!c.go}
            className="p-4 rounded-xl bg-white border border-slate-200 text-left hover:border-teal-300 disabled:hover:border-slate-200 transition">
            <div className="flex items-center gap-2 mb-1.5">
              <c.icon className={`w-4 h-4 ${c.color}`} />
              <span className="text-[10px] font-semibold text-slate-500 uppercase">{c.label}</span>
            </div>
            <div className={`text-xl font-black ${c.color} truncate`}>{c.value}</div>
            {c.sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{c.sub}</div>}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Renewals needing attention</div>
            <button onClick={() => onGo('renewals')} className="text-[11px] font-bold text-teal-700 hover:text-teal-900">See all</button>
          </div>
          {renewalCounts && (
            <div className="grid grid-cols-4 gap-2">
              {([['ERP', renewalCounts.erp], ['POS', renewalCounts.pos], ['Tablets', renewalCounts.tablet], ['Add-ons', renewalCounts.addOn]] as const).map(([label, counts]) => (
                <div key={label} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-500">{label}</div>
                  <div className="text-base font-black text-amber-600">{counts.expiring}</div>
                  <div className={`text-[10px] ${counts.overdue > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{counts.overdue} overdue</div>
                </div>
              ))}
            </div>
          )}
          {attention.length === 0 && <p className="text-xs text-slate-500">Nothing renewing soon or overdue.</p>}
          {attention.slice(0, 6).map(p => (
            <button key={p.id} onClick={() => onOpenTenant(p.tenantId, 'billing')}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-teal-300 text-left">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{p.tenantName}</div>
                <div className="text-[10px] text-slate-500 truncate">{KIND_LABEL[p.kind]} · {p.name}{p.openInvoiceNumber ? ` · ${p.openInvoiceNumber}` : ''}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-bold ${(p.daysLeft ?? 0) < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{dateOf(p.renewsAt)} · {daysText(p.daysLeft)}</span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Follow-ups (next 7 days)</div>
          {followUps.length === 0 && <p className="text-xs text-slate-500">No follow-ups due. Add them from a business's Activity tab.</p>}
          {followUps.slice(0, 6).map(f => (
            <button key={f.id} onClick={() => onOpenTenant(f.tenantId, 'activity')}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left ${f.overdue ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'} hover:border-teal-300`}>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{f.tenantName} · {f.kind === 'Promise' ? `promised ${f.promisedAmountPKR ? pkr(f.promisedAmountPKR) : 'payment'}` : f.kind}</div>
                <div className="text-[10px] text-slate-500 truncate">{f.body}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-bold ${f.overdue ? 'text-rose-600' : 'text-slate-500'}`}>{dateOf(f.followUpAt)}</span>
            </button>
          ))}

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Plan mix</div>
            {stats.planMix.map(p => (
              <div key={p.tier} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-700">{tierLabel(p.tier)}</span>
                  <span className="font-mono text-slate-500">{p.count} · {Math.round((p.count / Math.max(1, stats.activeTenants)) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${p.tier === 'Professional' ? 'bg-purple-500' : p.tier === 'Standard' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${(p.count / maxMix) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {stale.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Tills quiet for over a day</div>
          {stale.map(d => (
            <button key={d.terminalId} onClick={() => onOpenTenant(d.tenantId, 'locations')}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 hover:border-rose-300 text-left">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{d.terminalName} <span className="font-normal text-slate-500">· {d.branchName}</span></div>
                <div className="text-[10px] text-slate-500">{d.tenantName}</div>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-rose-600">{ago(d.lastSeenAt)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /> Monthly revenue counts parts paid up today; renewals and money live on Renewals and Billing.</p>
    </div>
  );
};

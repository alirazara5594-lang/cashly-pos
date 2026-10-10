import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Menu, X, Search, Plus, Bell, Sun, Moon, ChevronDown, ChevronRight, LogOut, ShieldCheck, UserCog, Settings2,
  Building2, Receipt, CalendarClock, HandCoins, WifiOff, LayoutDashboard, TrendingUp, CreditCard, Puzzle,
  MessageSquare, Megaphone, MessageCircle, History, CheckCircle2, UserPlus
} from 'lucide-react';
import { usePosStore } from '../store/posStore';
import { useClickOutside } from '../hooks/useClickOutside';
import { posApi } from '../services/api';
import { AccountSecurityModal } from './AccountSecurityModal';
import { pkr } from '../utils/renewals';
import type { AdminTenantRow, SubscriptionInvoice } from '../types';

/** Where in the console the person is, as the sidebar names it. */
const SECTIONS: Record<string, { label: string; icon: React.FC<{ className?: string }> }> = {
  dashboard: { label: 'Dashboard', icon: LayoutDashboard },
  tenants: { label: 'Businesses', icon: Building2 },
  renewals: { label: 'Renewals', icon: CalendarClock },
  billing: { label: 'Billing', icon: Receipt },
  revenue: { label: 'Revenue', icon: TrendingUp },
  packages: { label: 'Packages & Pricing', icon: CreditCard },
  addons: { label: 'Add-ons', icon: Puzzle },
  messages: { label: 'Message Log', icon: MessageSquare },
  announcements: { label: 'Announcements', icon: Megaphone },
  whatsapp: { label: 'Customer WhatsApp', icon: MessageCircle },
  team: { label: 'Team', icon: UserCog },
  activity: { label: 'Activity Log', icon: History },
  settings: { label: 'Settings', icon: Settings2 }
};

const ROLE_TEXT: Record<string, string> = {
  Owner: 'Platform owner', Billing: 'Billing', Support: 'Support', Sales: 'Sales'
};

const initials = (name?: string) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'C';

const iconBtn = 'relative p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

interface Attention { renewalsOverdue: number; renewalsSoon: number; invoicesOverdue: number; overduePKR: number; followUps: number }

/**
 * The platform console's header: where you are, one search for any business or invoice, quick
 * "new" actions, what needs attention now, and your own account — nothing about a till or a shop,
 * which the platform team does not have.
 */
export const PlatformHeader: React.FC<{
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  onLogout?: () => void;
}> = ({ onToggleSidebar, isSidebarOpen, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const currentUser = usePosStore(s => s.currentUser);
  const theme = usePosStore(s => s.theme);
  const toggleTheme = usePosStore(s => s.toggleTheme);
  const isOnline = usePosStore(s => s.isOnline);

  const onConsole = location.pathname.startsWith('/super-admin');
  const section = SECTIONS[onConsole ? searchParams.get('tab') ?? 'dashboard' : 'dashboard'] ?? SECTIONS.dashboard;
  const SectionIcon = section.icon;
  const isOwner = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
  const roleText = currentUser?.isSetupAccount ? 'Setup account' : ROLE_TEXT[currentUser?.platformRole ?? 'Owner'] ?? 'Platform team';
  const canManageOwnSignIn = !!currentUser?.platformRole && !currentUser.isSetupAccount;
  const go = (search: string) => navigate(`/super-admin${search}`);

  // ── Search: businesses by name, web name, owner, phone or city; invoices by number ──
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [tenants, setTenants] = useState<AdminTenantRow[] | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[] | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useClickOutside(searchRef, () => setSearchOpen(false), searchOpen);

  const loadSearchData = () => {
    if (tenants === null) posApi.getAdminTenants().then(setTenants).catch(() => setTenants([]));
    if (invoices === null) posApi.getSubscriptionInvoices().then(setInvoices).catch(() => setInvoices([]));
  };

  // Ctrl+K (or ⌘K) jumps to the search from anywhere in the console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  type Result = { key: string; title: string; detail: string; kind: 'business' | 'invoice'; open: () => void };
  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, '');
    const businesses = (tenants ?? []).filter(t =>
      t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || t.contactName.toLowerCase().includes(q)
      || t.contactEmail.toLowerCase().includes(q) || (t.city ?? '').toLowerCase().includes(q)
      || (digits.length >= 4 && (t.contactPhone ?? '').replace(/\D/g, '').includes(digits))
    ).slice(0, 6).map<Result>(t => ({
      key: `b-${t.id}`, kind: 'business', title: t.name,
      detail: [t.contactName, t.city, t.slug].filter(Boolean).join(' · '),
      open: () => navigate(`/super-admin?tab=tenants&tenant=${t.id}`)
    }));
    const bills = (invoices ?? []).filter(i =>
      i.invoiceNumber.toLowerCase().includes(q) || (q.length >= 3 && (i.tenantName ?? '').toLowerCase().includes(q) && businesses.length === 0)
    ).slice(0, 5).map<Result>(i => ({
      key: `i-${i.id}`, kind: 'invoice', title: i.invoiceNumber,
      detail: `${i.tenantName ?? ''} · ${pkr(i.amountPKR)} · ${i.status === 'PartiallyPaid' ? 'part paid' : i.status.toLowerCase()}`,
      open: () => navigate(`/super-admin?tab=billing&invoice=${i.id}`)
    }));
    return [...businesses, ...bills];
  }, [query, tenants, invoices, navigate]);

  const choose = (r: Result) => {
    r.open();
    setQuery('');
    setSearchOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  // ── What needs attention now ──
  const [attention, setAttention] = useState<Attention | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  useClickOutside(bellRef, () => setBellOpen(false), bellOpen);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      posApi.getRenewalsSummary().catch(() => null),
      posApi.getBillingSummary().catch(() => null),
      posApi.getFollowUps(0).catch(() => [])
    ]).then(([renewals, billing, followUps]) => {
      if (cancelled) return;
      setAttention({
        renewalsOverdue: renewals?.all.overdue ?? 0,
        renewalsSoon: renewals?.all.expiring ?? 0,
        invoicesOverdue: billing?.overdueCount ?? 0,
        overduePKR: billing?.overduePKR ?? 0,
        followUps: followUps.length
      });
    });
    return () => { cancelled = true; };
  }, [location.pathname, location.search]);
  const needsAction = attention ? attention.renewalsOverdue + attention.invoicesOverdue + attention.followUps : 0;

  // ── New … and the account menu ──
  const [newOpen, setNewOpen] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);
  useClickOutside(newRef, () => setNewOpen(false), newOpen);
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  useClickOutside(userRef, () => setUserOpen(false), userOpen);
  const [securityOpen, setSecurityOpen] = useState(false);

  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition';
  const panel = 'absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl p-1.5 z-50';

  return (
    <header className="bg-white/95 backdrop-blur border-b border-slate-200 sticky top-0 z-40 h-14 px-3 sm:px-4 flex items-center gap-3 rounded-2xl">
      {/* Where you are */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {onToggleSidebar && (
          <button onClick={onToggleSidebar} className={iconBtn} title={isSidebarOpen ? 'Close the menu' : 'Open the menu'}>
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}
        <nav className="hidden md:flex items-center gap-1.5 text-xs min-w-0" aria-label="Breadcrumb">
          <button onClick={() => go('')} className="font-semibold text-slate-500 hover:text-teal-700 transition whitespace-nowrap">Cashly platform</button>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <span className="flex items-center gap-1.5 font-black text-slate-900 whitespace-nowrap">
            <SectionIcon className="w-4 h-4 text-teal-600" /> {section.label}
          </span>
        </nav>
      </div>

      {/* One search for everything */}
      <div className="flex-1 flex justify-center min-w-0">
        <div className="relative w-full max-w-md" ref={searchRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); setSearchOpen(true); }}
            onFocus={() => { loadSearchData(); setSearchOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, results.length - 1))); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
              else if (e.key === 'Enter' && results[highlight]) { e.preventDefault(); choose(results[highlight]); }
              else if (e.key === 'Escape') { setSearchOpen(false); inputRef.current?.blur(); }
            }}
            placeholder="Search businesses, owners, phones, invoices…"
            className="w-full pl-9 pr-14 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition"
          />
          <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] font-semibold text-slate-400">Ctrl K</kbd>
          {searchOpen && query.trim() && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl p-1.5 z-50 max-h-96 overflow-y-auto">
              {tenants === null ? (
                <div className="px-3 py-3 text-xs text-slate-400">Searching…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-500">Nothing matches “{query.trim()}”.</div>
              ) : results.map((r, i) => (
                <button key={r.key} onMouseEnter={() => setHighlight(i)} onClick={() => choose(r)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${i === highlight ? 'bg-teal-50' : 'hover:bg-slate-50'}`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${r.kind === 'business' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}`}>
                    {r.kind === 'business' ? <Building2 className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-900 truncate">{r.title}</span>
                    <span className="block text-[11px] text-slate-500 truncate">{r.detail}</span>
                  </span>
                  <span className="ml-auto text-[10px] font-bold uppercase text-slate-400">{r.kind === 'business' ? 'Business' : 'Invoice'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions and your account */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {!isOnline && (
          <span className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-[11px] font-bold" title="No connection to the server">
            <WifiOff className="w-3.5 h-3.5" /> Offline
          </span>
        )}

        <div className="relative" ref={newRef}>
          <button onClick={() => setNewOpen(v => !v)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
            <Plus className="w-3.5 h-3.5" /> New <ChevronDown className="w-3 h-3 opacity-80" />
          </button>
          {newOpen && (
            <div className={`${panel} w-56`}>
              <button className={menuItem} onClick={() => { setNewOpen(false); go('?tab=tenants&new=1'); }}>
                <UserPlus className="w-4 h-4 text-teal-600" /> New business
              </button>
              <button className={menuItem} onClick={() => { setNewOpen(false); go('?tab=billing&new=1'); }}>
                <Receipt className="w-4 h-4 text-amber-600" /> New invoice
              </button>
              {isOwner && (
                <button className={menuItem} onClick={() => { setNewOpen(false); go('?tab=announcements&new=1'); }}>
                  <Megaphone className="w-4 h-4 text-sky-600" /> New announcement
                </button>
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={bellRef}>
          <button onClick={() => setBellOpen(v => !v)} className={iconBtn} title="What needs attention">
            <Bell className="w-5 h-5" />
            {needsAction > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white">
                {needsAction > 99 ? '99+' : needsAction}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className={`${panel} w-80`}>
              <div className="px-3 pt-2 pb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Needs attention</div>
              {!attention ? (
                <div className="px-3 py-3 text-xs text-slate-400">Checking…</div>
              ) : needsAction === 0 && attention.renewalsSoon === 0 ? (
                <div className="px-3 py-4 text-xs text-slate-500 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-600" /> All clear — nothing overdue or due soon.</div>
              ) : (
                <>
                  {[
                    { show: attention.renewalsOverdue > 0, icon: CalendarClock, tone: 'text-rose-600 bg-rose-50', title: `${attention.renewalsOverdue} renewal${attention.renewalsOverdue === 1 ? '' : 's'} overdue`, detail: 'Unpaid parts, stopped or about to be', to: '?tab=renewals' },
                    { show: attention.invoicesOverdue > 0, icon: Receipt, tone: 'text-rose-600 bg-rose-50', title: `${attention.invoicesOverdue} invoice${attention.invoicesOverdue === 1 ? '' : 's'} overdue`, detail: `${pkr(attention.overduePKR)} still owed`, to: '?tab=billing' },
                    { show: attention.followUps > 0, icon: HandCoins, tone: 'text-amber-600 bg-amber-50', title: `${attention.followUps} follow-up${attention.followUps === 1 ? '' : 's'} due`, detail: 'Calls and promises to pay', to: '' },
                    { show: attention.renewalsSoon > 0, icon: CalendarClock, tone: 'text-amber-600 bg-amber-50', title: `${attention.renewalsSoon} renewing in 14 days`, detail: 'Invoices go out before the date', to: '?tab=renewals' }
                  ].filter(i => i.show).map(i => (
                    <button key={i.title} onClick={() => { setBellOpen(false); go(i.to); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 transition">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${i.tone}`}><i.icon className="w-4 h-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-slate-900">{i.title}</span>
                        <span className="block text-[11px] text-slate-500">{i.detail}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <button onClick={toggleTheme} className={iconBtn} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5" />}
        </button>

        <div className="relative" ref={userRef}>
          <button onClick={() => setUserOpen(v => !v)}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-slate-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white text-xs font-black flex items-center justify-center shadow-sm">
              {initials(currentUser?.fullName)}
            </span>
            <span className="hidden lg:block text-left leading-tight">
              <span className="block text-xs font-bold text-slate-900 max-w-[160px] truncate">{currentUser?.fullName}</span>
              <span className="block text-[10px] font-semibold text-slate-500">{roleText}</span>
            </span>
            <ChevronDown className="hidden lg:block w-3.5 h-3.5 text-slate-400" />
          </button>
          {userOpen && (
            <div className={`${panel} w-64`}>
              <div className="px-3 py-2.5 border-b border-slate-100 mb-1">
                <div className="text-xs font-black text-slate-900 truncate">{currentUser?.fullName}</div>
                <div className="text-[11px] text-slate-500 truncate">{currentUser?.email ?? (currentUser?.isSetupAccount ? 'Shared setup PIN' : '')}</div>
                <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-[10px] font-bold">{roleText}</span>
              </div>
              {canManageOwnSignIn && (
                <button className={menuItem} onClick={() => { setUserOpen(false); setSecurityOpen(true); }}>
                  <ShieldCheck className="w-4 h-4 text-teal-600" /> My sign-in &amp; 2-step
                </button>
              )}
              {isOwner && (
                <>
                  <button className={menuItem} onClick={() => { setUserOpen(false); go('?tab=team'); }}>
                    <UserCog className="w-4 h-4 text-slate-500" /> Team
                  </button>
                  <button className={menuItem} onClick={() => { setUserOpen(false); go('?tab=settings'); }}>
                    <Settings2 className="w-4 h-4 text-slate-500" /> Platform settings
                  </button>
                </>
              )}
              <div className="my-1 border-t border-slate-100" />
              <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-bold text-rose-600 hover:bg-rose-50 transition" onClick={() => { setUserOpen(false); onLogout?.(); }}>
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {securityOpen && <AccountSecurityModal onClose={() => setSecurityOpen(false)} />}
    </header>
  );
};

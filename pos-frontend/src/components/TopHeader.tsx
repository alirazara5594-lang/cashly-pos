import React, { useState, useRef, useEffect } from 'react';
import {
  WifiOff,
  RefreshCw,
  PhoneCall,
  ChevronDown,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  Laptop,
  Tablet,
  ChefHat,
  Check,
  ArrowLeftRight,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { usePosStore, normalizeRole } from '../store/posStore';
import { useBusinessShape } from '../hooks/useBusinessShape';
import { AlertsBell } from './AlertsBell';
import { AccountSecurityModal } from './AccountSecurityModal';
import { PlatformHeader } from './PlatformHeader';
import { getSupportSession } from '../services/supportSession';
import { useClickOutside } from '../hooks/useClickOutside';
import { posApi, getApiErrorMessage } from '../services/api';
import type { MyBranch, TerminalOperatingMode } from '../types';
import { tierLabel } from '../utils/tierLabel';

/** This device's screen profiles, as the mode menu lists them. */
const MODES: { mode: TerminalOperatingMode; icon: React.FC<{ className?: string }>; label: string; short: string; desc: string }[] = [
  { mode: 'CounterPOS', icon: Monitor, label: 'Cashier counter', short: 'Counter', desc: 'POS checkout only' },
  { mode: 'OwnerAdmin', icon: Laptop, label: 'Owner / back office', short: 'Owner', desc: 'Full access — reports, menu, staff' },
  { mode: 'WaiterTab', icon: Tablet, label: 'Waiter tablet', short: 'Waiter', desc: 'Dining tables & orders' },
  { mode: 'KitchenKDS', icon: ChefHat, label: 'Kitchen display', short: 'Kitchen', desc: 'Cooking tickets only' }
];

const initials = (name?: string) =>
  (name ?? '').split(/[\s—-]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'C';

// One size and one quiet style for every header control, as in the platform console's header.
const iconBtn = 'relative h-9 w-9 inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const panel = 'absolute top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl p-1.5 z-50';
const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer';

/** "Head office" / "Warehouse" beside a location's name; nothing for an ordinary branch. */
function locationTag(b: { locationType?: string; isHeadOffice?: boolean }): string {
  const type = b.locationType ?? (b.isHeadOffice ? 'HeadOffice' : 'Branch');
  return type === 'HeadOffice' ? 'Head office' : type === 'Warehouse' ? 'Warehouse' : '';
}

/** A role as people say it, not as the system stores it ("OwnerAdmin" → "Owner"). */
const ROLE_LABELS: Record<string, string> = {
  SuperAdmin: 'Platform admin',
  OwnerAdmin: 'Owner',
  HqAdmin: 'HQ admin',
  BranchManager: 'Branch manager',
  Cashier: 'Cashier',
  KitchenChef: 'Kitchen',
  Waiter: 'Waiter',
  Accountant: 'Accountant',
  InventoryUser: 'Inventory'
};

interface TopHeaderProps {
  onOpenCallOrder: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  currentUser?: any;
  /** Fast handoff: end this session and return to the login gate. */
  onSwitchUser?: () => void;
  onLogout?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  onOpenCallOrder,
  onToggleSidebar,
  isSidebarOpen,
  currentUser,
  onSwitchUser,
  onLogout
}) => {
  const { 
    tenants, 
    selectedTenant, 
    selectedBranch, 
    activePackage, 
    isOnline, 
    offlinePendingCount, 
    selectTenant, 
    selectBranch, 
    setIsOnline, 
    syncPendingOrders,
    theme,
    toggleTheme,
    terminalMode,
    setTerminalMode,
    cart,
    tenantSettings
  } = usePosStore();
  // Head office runs the ERP and sells nothing: no till profiles, no phone orders to ring up.
  const { atHeadOffice: atHeadOfficeOnly, outlets, locations } = useBusinessShape();
  // The platform admin's own console belongs to no restaurant, so nothing about one shows here.
  // ("View as customer" signs in with the restaurant's role, so it is not this.)
  const isPlatformAdmin = normalizeRole(currentUser?.role) === 'SuperAdmin';
  const atHeadOffice = atHeadOfficeOnly || isPlatformAdmin;

  const [showTenantDropdown, setShowTenantDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  // Password and 2-step sign-in for the person signed in (not the platform admin's own account).
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  // Not the platform admin's own account, and not a support session (it has no sign-in of its own).
  // A named platform team member manages their own password and 2-step sign-in too; the shared
  // setup-PIN account has neither.
  const canManageOwnSignIn = !!currentUser && !getSupportSession()
    && (currentUser.role !== 'SuperAdmin' || (!!currentUser.platformRole && !currentUser.isSetupAccount));

  // Staff pinned to a branch switch on the server: the session moves to another branch they
  // cover, so what they ring up lands there. Owners and head office staff already see every
  // location and only change the view.
  const isPinned = !!currentUser?.branchId;
  const [pinnedBranches, setPinnedBranches] = useState<MyBranch[]>([]);
  const myBranches = isPinned ? pinnedBranches : [];
  const [switchError, setSwitchError] = useState('');
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!isPinned) return;
    let cancelled = false;
    posApi.getMyBranches()
      .then(rows => { if (!cancelled) setPinnedBranches(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setPinnedBranches([]); });
    return () => { cancelled = true; };
  }, [isPinned, currentUser?.id, currentUser?.branchId]);

  const handleSwitchBranch = async (branchId: string) => {
    if (branchId === currentUser?.branchId) {
      setShowTenantDropdown(false);
      return;
    }
    if (cart.length > 0 && !window.confirm('The sale in progress will be cleared. Switch branch anyway?')) return;
    setSwitching(true);
    setSwitchError('');
    try {
      await posApi.switchBranch(branchId);
      // Start clean at the new branch: its prices, its stock, its tills and its reports.
      window.location.reload();
    } catch (err) {
      setSwitchError(getApiErrorMessage(err, 'Could not switch branch.'));
      setSwitching(false);
    }
  };

  // Click anywhere outside dismisses a dropdown. Each ref wraps trigger +
  // panel, so the trigger's own toggle keeps working (a plain outside-mousedown
  // would close the panel a beat before the click re-opened it).
  const [showUserMenu, setShowUserMenu] = useState(false);
  const tenantMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(tenantMenuRef, () => setShowTenantDropdown(false), showTenantDropdown);
  useClickOutside(modeMenuRef, () => setShowModeDropdown(false), showModeDropdown);
  useClickOutside(userMenuRef, () => setShowUserMenu(false), showUserMenu);

  // Terminal mode is just this device's screen profile (which nav layout to show) —
  // it carries no authorization. Access to any given screen is decided by the real
  // signed-in user's role/permissions (RequireModule), so switching it never needs a PIN.
  const handleModeSwitch = (mode: TerminalOperatingMode) => {
    setTerminalMode(mode);
    setShowModeDropdown(false);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncPendingOrders();
    setIsSyncing(false);
  };

  // Somewhere else to switch to.
  const isMultiBranchChain = isPinned
    ? myBranches.length > 1
    : locations.length > 1;
  const branchTag = selectedBranch ? locationTag(selectedBranch) : '';
  const outletCount = atHeadOfficeOnly
    ? (outlets.length === 0 ? 'no outlets yet' : `${outlets.length} outlet${outlets.length === 1 ? '' : 's'}`)
    : '';
  const locationLine = [
    selectedBranch?.name || selectedTenant?.name || '',
    branchTag,
    outletCount,
    tenantSettings?.currencyCode || 'PKR'
  ].filter(Boolean).join(' · ');
  const tierBadge =
    activePackage === 'Professional' ? 'bg-purple-50 text-purple-700 border-purple-200' :
    activePackage === 'Standard' ? 'bg-blue-50 text-blue-700 border-blue-200' :
    'bg-amber-50 text-amber-700 border-amber-200';
  const currentMode = MODES.find(m => m.mode === terminalMode);
  const ModeIcon = currentMode?.icon ?? Laptop;
  const userName: string = currentUser?.fullName || currentUser?.username || '';
  const roleLabel = currentUser?.role === 'SuperAdmin' && currentUser?.platformRole && !currentUser?.isSetupAccount
    ? `Platform ${currentUser.platformRole.toLowerCase()}`
    : ROLE_LABELS[normalizeRole(currentUser?.role) ?? ''] ?? 'Staff';
  // The platform admin looking inside this business: leaving ends the support session, and there
  // is no one to hand the till to.
  const inSupportSession = !!getSupportSession();

  // The platform team has its own console header: no till, no shop, no phone orders.
  if (isPlatformAdmin) {
    return <PlatformHeader onToggleSidebar={onToggleSidebar} isSidebarOpen={isSidebarOpen} onLogout={onLogout} />;
  }

  return (
    <header className="bg-white/95 backdrop-blur border-b border-slate-200 text-slate-900 sticky top-0 z-40 h-14 px-3 sm:px-4 flex items-center justify-between gap-3 rounded-2xl">
      {/* Where you are */}
      <div className="flex items-center gap-2 min-w-0">
        {onToggleSidebar && (
          <button onClick={onToggleSidebar} className={iconBtn} title={isSidebarOpen ? 'Close the menu' : 'Open the menu'}>
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}

        <div className="relative min-w-0" ref={tenantMenuRef}>
          <button
            onClick={() => isMultiBranchChain && setShowTenantDropdown(!showTenantDropdown)}
            className={`flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-xl text-left min-w-0 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
              isMultiBranchChain ? 'hover:bg-slate-100 cursor-pointer' : 'cursor-default'
            }`}
            title={isMultiBranchChain ? 'Switch location' : undefined}
          >
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-sm">
              {initials(selectedTenant?.name)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-bold text-slate-900 truncate max-w-[110px] sm:max-w-[200px]">
                  {selectedTenant?.name || 'Restaurant'}
                </span>
                <span className={`hidden sm:inline-flex shrink-0 px-1.5 py-px rounded-md border text-[9px] font-bold uppercase tracking-wider ${tierBadge}`}>
                  {tierLabel(activePackage)}
                </span>
              </span>
              <span className="block mt-0.5 text-[11px] text-slate-500 truncate max-w-[140px] sm:max-w-[260px]">{locationLine}</span>
            </span>
            {isMultiBranchChain && <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
          </button>

          {showTenantDropdown && isPinned && (
            <div className={`${panel} left-0 w-72`}>
              <div className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Work at another branch</div>
              {myBranches.map(b => {
                const isCurrent = b.id === currentUser?.branchId;
                const tag = locationTag(b);
                return (
                  <button
                    key={b.id}
                    disabled={switching}
                    onClick={() => handleSwitchBranch(b.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left text-xs transition disabled:opacity-50 ${
                      isCurrent ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-700 hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      {b.name}
                      {tag && <span className="ml-1 text-[10px] font-medium text-slate-400">({tag})</span>}
                      {b.isHome && <span className="ml-1 text-[10px] font-medium text-teal-600">· your branch</span>}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 text-[10px] font-medium text-slate-400">
                      {b.city}
                      {isCurrent && <Check className="w-3.5 h-3.5 text-teal-600" />}
                    </span>
                  </button>
                );
              })}
              {switchError && (
                <div className="mt-1 px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold">
                  {switchError}
                </div>
              )}
            </div>
          )}

          {showTenantDropdown && !isPinned && (
            <div className={`${panel} left-0 w-72 max-h-96 overflow-y-auto`}>
              <div className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Switch business / branch</div>
              {tenants.map(t => (
                <div key={t.id} className="pb-1">
                  <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-bold text-slate-900">
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 px-1.5 py-px rounded-md bg-slate-100 border border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      {tierLabel(t.tier)}
                    </span>
                  </div>
                  {t.branches?.map(b => {
                    const isCurrent = selectedBranch?.id === b.id;
                    const tag = locationTag(b);
                    return (
                      <button
                        key={b.id}
                        onClick={() => {
                          selectTenant(t);
                          selectBranch(b);
                          setShowTenantDropdown(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left text-xs transition cursor-pointer ${
                          isCurrent ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          {b.name}
                          {tag && <span className="ml-1 text-[10px] font-medium text-slate-400">({tag})</span>}
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0 text-[10px] font-medium text-slate-400">
                          {b.city}
                          {isCurrent && <Check className="w-3.5 h-3.5 text-teal-600" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The till's tools and your account */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* The real connection, which the app follows on its own. Only a developer's machine can
            pretend to go offline, to try the offline till. */}
        <button
          onClick={import.meta.env.DEV ? () => setIsOnline(!isOnline) : undefined}
          className={`h-9 inline-flex items-center gap-2 px-2.5 rounded-xl text-xs font-semibold transition ${
            import.meta.env.DEV ? 'cursor-pointer' : 'cursor-default'
          } ${
            isOnline
              ? `text-slate-600 ${import.meta.env.DEV ? 'hover:bg-slate-100' : ''}`
              : 'bg-rose-50 border border-rose-200 text-rose-600'
          }`}
          title={isOnline
            ? 'Connected. Sales sync to the cloud as they happen.'
            : 'No connection. Sales are kept on this device and sync when it is back.'}
        >
          {isOnline ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
              <span className="hidden md:inline">Online</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4" />
              <span className="hidden sm:inline">Offline</span>
            </>
          )}
        </button>

        {offlinePendingCount > 0 && (
          <button
            onClick={handleManualSync}
            disabled={!isOnline || isSyncing}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
            title="Sales kept on this device, waiting to reach the cloud"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sync ({offlinePendingCount})</span>
          </button>
        )}

        {!atHeadOffice && (
          <div className="relative" ref={modeMenuRef}>
            <button
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              className="h-9 inline-flex items-center gap-1.5 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              title="Switch terminal mode"
            >
              <ModeIcon className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">{currentMode?.short ?? 'Back office'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showModeDropdown && (
              <div className={`${panel} right-0 w-64`}>
                <div className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terminal mode</div>
                {MODES.map(({ mode, icon: Icon, label, desc }) => {
                  const active = terminalMode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleModeSwitch(mode)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
                        active ? 'bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        active ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-xs font-bold ${active ? 'text-teal-700' : 'text-slate-900'}`}>{label}</span>
                        <span className="block text-[11px] text-slate-500">{desc}</span>
                      </span>
                      {active && <Check className="w-4 h-4 ml-auto text-teal-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!atHeadOffice && (
          <button
            onClick={onOpenCallOrder}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            title="Take a phone order"
          >
            <PhoneCall className="w-4 h-4" />
            <span className="hidden sm:inline">Call order</span>
          </button>
        )}

        <AlertsBell />

        <button onClick={toggleTheme} className={iconBtn} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5" />}
        </button>

        {currentUser && (
          <>
            <span className="hidden sm:block w-px h-6 bg-slate-200 mx-1" />
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="flex items-center gap-2 pl-1 pr-1.5 lg:pr-2 py-1 rounded-xl hover:bg-slate-100 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                title="Your account"
              >
                <span className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {initials(userName)}
                </span>
                <span className="hidden lg:block text-left leading-tight">
                  <span className="block text-xs font-bold text-slate-900 max-w-[140px] truncate">{userName}</span>
                  <span className="block text-[10px] font-semibold text-slate-500">{roleLabel}</span>
                </span>
                <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-slate-400" />
              </button>

              {showUserMenu && (
                <div className={`${panel} right-0 w-64`}>
                  <div className="px-3 py-2.5 border-b border-slate-100 mb-1">
                    <div className="text-xs font-bold text-slate-900 truncate">{userName}</div>
                    {(currentUser.email || currentUser.username) && (
                      <div className="text-[11px] text-slate-500 truncate">{currentUser.email || currentUser.username}</div>
                    )}
                    <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-[10px] font-bold">
                      {roleLabel}
                    </span>
                  </div>
                  {!inSupportSession && (
                    <button className={menuItem} onClick={() => { setShowUserMenu(false); onSwitchUser?.(); }}>
                      <ArrowLeftRight className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>
                        <span className="block">Switch user</span>
                        <span className="block text-[10px] font-medium text-slate-400">Hand this till to the next person</span>
                      </span>
                    </button>
                  )}
                  {canManageOwnSignIn && (
                    <button className={menuItem} onClick={() => { setShowUserMenu(false); setIsSecurityOpen(true); }}>
                      <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" /> My sign-in &amp; security
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-bold text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                    onClick={() => { setShowUserMenu(false); onLogout?.(); }}
                  >
                    <LogOut className="w-4 h-4 shrink-0" /> {inSupportSession ? 'End support session' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {isSecurityOpen && <AccountSecurityModal onClose={() => setIsSecurityOpen(false)} />}
      </div>
    </header>
  );
};

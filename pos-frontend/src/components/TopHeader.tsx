import React, { useState, useRef, useEffect } from 'react';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  PhoneCall, 
  Layers, 
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
  User,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { usePosStore, normalizeRole } from '../store/posStore';
import { useBusinessShape } from '../hooks/useBusinessShape';
import { AlertsBell } from './AlertsBell';
import { AccountSecurityModal } from './AccountSecurityModal';
import { getSupportSession } from '../services/supportSession';
import { useClickOutside } from '../hooks/useClickOutside';
import { posApi, getApiErrorMessage } from '../services/api';
import type { MyBranch } from '../types';
import { tierLabel } from '../utils/tierLabel';

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
  const canManageOwnSignIn = !!currentUser && currentUser.role !== 'SuperAdmin' && !getSupportSession();

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
  const tenantMenuRef = useRef<HTMLDivElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(tenantMenuRef, () => setShowTenantDropdown(false), showTenantDropdown);
  useClickOutside(modeMenuRef, () => setShowModeDropdown(false), showModeDropdown);

  // Terminal mode is just this device's screen profile (which nav layout to show) —
  // it carries no authorization. Access to any given screen is decided by the real
  // signed-in user's role/permissions (RequireModule), so switching it never needs a PIN.
  const handleModeSwitch = (mode: string) => {
    setTerminalMode(mode as any);
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

  return (
    <>
      <header className="bg-white border-b border-slate-200 text-slate-900 sticky top-0 z-40 px-4 py-2 flex items-center justify-between gap-4 h-14 rounded-2xl">
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition cursor-pointer"
              title="Toggle Sidebar Navigation"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {isPlatformAdmin ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              <div className="text-left">
                <div className="text-slate-900 font-semibold">Cashly platform</div>
                <div className="text-slate-500 text-[10px]">Every business on Cashly</div>
              </div>
            </div>
          ) : (
          <div className="relative" ref={tenantMenuRef}>
            <button
              onClick={() => isMultiBranchChain && setShowTenantDropdown(!showTenantDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium transition ${
                isMultiBranchChain ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
              }`}
              title={isMultiBranchChain ? 'Switch location' : undefined}
            >
              <Layers className="w-3.5 h-3.5 text-teal-600" />
              <div className="text-left">
                <div className="text-slate-900 font-semibold flex items-center gap-1.5">
                  {selectedTenant?.name || 'Restaurant'}
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                    activePackage === 'Professional' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                    activePackage === 'Standard' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                    'bg-amber-100 text-amber-700 border border-amber-200'
                  }`}>
                    {tierLabel(activePackage)}
                  </span>
                </div>
                <div className="text-slate-500 text-[10px]">
                  {selectedBranch?.name || selectedTenant?.name || ''}
                  {branchTag && ` · ${branchTag}`}
                  {outletCount && ` · ${outletCount}`}
                </div>
              </div>
              {isMultiBranchChain && <ChevronDown className="w-3 h-3 text-slate-500 ml-1" />}
            </button>

            {showTenantDropdown && isPinned && (
              <div className="absolute left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl p-2 z-50 text-sm">
                <div className="px-2 py-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Work at another branch</div>
                <div className="mt-1 space-y-1">
                  {myBranches.map(b => {
                    const isCurrent = b.id === currentUser?.branchId;
                    const tag = locationTag(b);
                    return (
                      <button
                        key={b.id}
                        disabled={switching}
                        onClick={() => handleSwitchBranch(b.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between disabled:opacity-50 ${
                          isCurrent ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-600 hover:bg-slate-50 cursor-pointer'
                        }`}
                      >
                        <span>
                          {b.name}
                          {tag && <span className="ml-1 text-[10px] text-slate-400">({tag})</span>}
                          {b.isHome && <span className="ml-1 text-[10px] text-teal-600">· your branch</span>}
                        </span>
                        <span className="text-[10px] opacity-75">{b.city}</span>
                      </button>
                    );
                  })}
                </div>
                {switchError && (
                  <div className="mt-1 px-2 py-1.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold">
                    {switchError}
                  </div>
                )}
              </div>
            )}

            {showTenantDropdown && !isPinned && (
              <div className="absolute left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl p-2 z-50 text-sm">
                <div className="px-2 py-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Switch Business / Branch</div>
                <div className="mt-1 space-y-1">
                  {tenants.map(t => (
                    <div key={t.id} className="p-1.5 rounded-lg hover:bg-slate-50">
                      <div className="font-semibold text-slate-900 flex items-center justify-between">
                        <span>{t.name}</span>
                        <span className="text-[10px] px-1 bg-slate-100 text-teal-600 rounded border border-slate-200">{tierLabel(t.tier)}</span>
                      </div>
                      <div className="mt-1 pl-2 space-y-1">
                        {t.branches?.map(b => (
                          <button
                            key={b.id}
                            onClick={() => {
                              selectTenant(t);
                              selectBranch(b);
                              setShowTenantDropdown(false);
                            }}
                            className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between ${
                              selectedBranch?.id === b.id ? 'bg-teal-50 text-teal-700 font-bold' : 'text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <span>
                              {b.name}
                              {locationTag(b) && <span className="ml-1 text-[10px] text-slate-400">({locationTag(b)})</span>}
                            </span>
                            <span className="text-[10px] opacity-75">{b.city}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!atHeadOffice && (
          <div className="relative" ref={modeMenuRef}>
            <button
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                terminalMode === 'CounterPOS' ? 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200' :
                terminalMode === 'OwnerAdmin' ? 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100' :
                terminalMode === 'WaiterTab' ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' :
                'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
              }`}
              title="Switch terminal mode"
            >
              {terminalMode === 'CounterPOS' && <Monitor className="w-3.5 h-3.5" />}
              {terminalMode === 'OwnerAdmin' && <Laptop className="w-3.5 h-3.5" />}
              {terminalMode === 'WaiterTab' && <Tablet className="w-3.5 h-3.5" />}
              {terminalMode === 'KitchenKDS' && <ChefHat className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">
                {terminalMode === 'CounterPOS' ? 'Counter' :
                 terminalMode === 'OwnerAdmin' ? 'Owner' :
                 terminalMode === 'WaiterTab' ? 'Waiter' : 'Kitchen'}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showModeDropdown && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-2xl p-2 z-50">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Terminal Mode</div>
                {[
                  { mode: 'CounterPOS' as const, icon: Monitor, label: 'Cashier Counter', desc: 'POS checkout only', color: 'teal' },
                  { mode: 'OwnerAdmin' as const, icon: Laptop, label: 'Owner / Back Office', desc: 'Full access — reports, menu, staff', color: 'teal' },
                  { mode: 'WaiterTab' as const, icon: Tablet, label: 'Waiter Tablet', desc: 'Dining tables & orders', color: 'blue' },
                  { mode: 'KitchenKDS' as const, icon: ChefHat, label: 'Kitchen Display', desc: 'Cooking tickets only', color: 'amber' }
                ].map(({ mode, icon: Icon, label, desc, color }) => (
                  <button
                    key={mode}
                    onClick={() => handleModeSwitch(mode)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition cursor-pointer ${
                      terminalMode === mode
                        ? `bg-${color}-50 border border-${color}-200 text-${color}-700`
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${terminalMode === mode ? `text-${color}-600` : 'text-slate-500'}`} />
                    <div>
                      <div className="text-xs font-semibold">{label}</div>
                      <div className="text-[10px] text-slate-500">{desc}</div>
                    </div>
                    {terminalMode === mode && <Check className="w-3.5 h-3.5 ml-auto text-teal-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {currentUser && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onSwitchUser}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 text-xs font-semibold transition cursor-pointer"
                title="Switch User — sign out and hand the terminal to the next staff member"
              >
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{currentUser.fullName || currentUser.username}</span>
                <span className="hidden lg:inline text-[9px] px-1.5 py-0.5 rounded bg-white text-teal-600 border border-slate-200 font-bold uppercase tracking-wider">
                  {ROLE_LABELS[normalizeRole(currentUser.role) ?? ''] ?? 'Staff'}
                </span>
              </button>
              {canManageOwnSignIn && (
                <button
                  onClick={() => setIsSecurityOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 text-xs font-semibold transition cursor-pointer"
                  title="My sign-in & security — password and 2-step sign-in"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onLogout}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-semibold transition cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {isSecurityOpen && <AccountSecurityModal onClose={() => setIsSecurityOpen(false)} />}

          {!atHeadOffice && (
            <button
              onClick={onOpenCallOrder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-gradient text-xs font-semibold transition cursor-pointer"
              title="Take a phone order"
            >
              <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
              <span className="hidden sm:inline">Call Order</span>
            </button>
          )}

          <AlertsBell />

          {/* The real connection, which the app follows on its own. Only a developer's machine can
              pretend to go offline, to try the offline till. */}
          <button
            onClick={import.meta.env.DEV ? () => setIsOnline(!isOnline) : undefined}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
              import.meta.env.DEV ? 'cursor-pointer' : 'cursor-default'
            } ${
              isOnline
                ? 'bg-teal-50 border-teal-200 text-teal-600'
                : 'bg-rose-50 border-rose-200 text-rose-600 animate-pulse'
            }`}
            title={isOnline
              ? 'Connected. Sales sync to the cloud as they happen.'
              : 'No connection. Sales are kept on this device and sync when it is back.'}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-teal-600" />
                <span className="hidden sm:inline">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                <span className="hidden sm:inline">Offline Mode</span>
              </>
            )}
          </button>

          {offlinePendingCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={!isOnline || isSyncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold transition shadow-md shadow-teal-500/25 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync ({offlinePendingCount})</span>
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-600 transition cursor-pointer"
            title={theme === 'dark' ? 'Switch to Crisp Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-teal-600" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          {!isPlatformAdmin && (
            <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-teal-600" title="Currency">
              {tenantSettings?.currencyCode || 'PKR'}
            </div>
          )}
        </div>
      </header>
    </>
  );
};

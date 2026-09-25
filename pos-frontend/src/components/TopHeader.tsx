import React, { useState, useRef } from 'react';
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
  LogOut
} from 'lucide-react';
import { usePosStore } from '../store/posStore';
import { AlertsBell } from './AlertsBell';
import { useClickOutside } from '../hooks/useClickOutside';

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
    setTerminalMode
  } = usePosStore();

  const [showTenantDropdown, setShowTenantDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

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

  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;

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

          <div className="relative" ref={tenantMenuRef}>
            <button 
              onClick={() => isMultiBranchChain && setShowTenantDropdown(!showTenantDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium transition ${
                isMultiBranchChain ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
              }`}
              title={isMultiBranchChain ? 'Click to switch restaurant branch' : 'Single Restaurant Location'}
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
                    {activePackage}
                  </span>
                </div>
                <div className="text-slate-500 text-[10px]">
                  {selectedBranch?.isHeadOffice ? 'Head Office' : selectedBranch?.name || 'Main Hall'}
                  {!isMultiBranchChain && ' (Single Location)'}
                </div>
              </div>
              {isMultiBranchChain && <ChevronDown className="w-3 h-3 text-slate-500 ml-1" />}
            </button>

            {showTenantDropdown && (
              <div className="absolute left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl p-2 z-50 text-sm">
                <div className="px-2 py-1 text-xs font-bold text-slate-500 uppercase tracking-wider">Switch Business / Branch</div>
                <div className="mt-1 space-y-1">
                  {tenants.map(t => (
                    <div key={t.id} className="p-1.5 rounded-lg hover:bg-slate-50">
                      <div className="font-semibold text-slate-900 flex items-center justify-between">
                        <span>{t.name}</span>
                        <span className="text-[10px] px-1 bg-slate-100 text-teal-600 rounded border border-slate-200">{t.tier}</span>
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
                            <span>{b.name} {b.isHeadOffice ? '(Head Office)' : ''}</span>
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
        </div>

        <div className="flex items-center gap-2">
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
                  {currentUser.role || 'Staff'}
                </span>
              </button>
              <button
                onClick={onLogout}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-semibold transition cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            onClick={onOpenCallOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg btn-gradient text-xs font-semibold transition cursor-pointer"
            title="Open Phone Call Order Intake"
          >
            <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
            <span className="hidden sm:inline">Call Order</span>
          </button>

          <AlertsBell />

          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
              isOnline
                ? 'bg-teal-50 border-teal-200 text-teal-600 hover:bg-teal-100'
                : 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100 animate-pulse'
            }`}
            title="Click to toggle simulated offline/online state"
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

          <div className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-teal-600">
            PKR
          </div>
        </div>
      </header>
    </>
  );
};

import React, { useState } from 'react';
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
  Lock,
  Unlock,
  Key,
  Monitor,
  Laptop,
  Tablet,
  ChefHat,
  Check,
  User
} from 'lucide-react';
import { usePosStore } from '../store/posStore';

interface TopHeaderProps {
  onOpenCallOrder: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  currentUser?: any;
  onOpenLogin?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ 
  onOpenCallOrder, 
  onToggleSidebar,
  isSidebarOpen,
  currentUser,
  onOpenLogin
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
    isAdminUnlocked,
    unlockWithAdminPin,
    lockAdmin
  } = usePosStore();

  const [showTenantDropdown, setShowTenantDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Admin PIN Unlock Modal State
  const [showPinModal, setShowPinModal] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState(false);

  const handleModeSwitch = (mode: string) => {
    if (mode === 'OwnerAdmin') {
      setPendingMode(mode);
      setShowModeDropdown(false);
      setShowPinModal(true);
      setEnteredPin('');
      setPinError(false);
    } else {
      setTerminalMode(mode as any);
      setShowModeDropdown(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = unlockWithAdminPin(enteredPin);
    if (success && pendingMode) {
      setTerminalMode(pendingMode as any);
      setShowPinModal(false);
      setPendingMode(null);
      setEnteredPin('');
      setPinError(false);
    } else {
      setPinError(true);
      setEnteredPin('');
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncPendingOrders();
    setIsSyncing(false);
  };

  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;

  return (
    <>
      <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-40 px-4 py-2 flex items-center justify-between gap-4 h-14">
        {/* Left side: Hamburger toggle + Restaurant Switcher */}
        <div className="flex items-center gap-3">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="Toggle Sidebar Navigation"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {/* Restaurant & Branch Switcher */}
          <div className="relative">
            <button 
              onClick={() => isMultiBranchChain && setShowTenantDropdown(!showTenantDropdown)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/90 border border-slate-700 text-xs font-medium transition ${
                isMultiBranchChain ? 'hover:bg-slate-700/80 cursor-pointer' : 'cursor-default'
              }`}
              title={isMultiBranchChain ? 'Click to switch restaurant branch' : 'Single Restaurant Location'}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <div className="text-left">
                <div className="text-white font-semibold flex items-center gap-1.5">
                  {selectedTenant?.name || 'Restaurant'}
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                    activePackage === 'Professional' ? 'bg-purple-900/80 text-purple-300 border border-purple-700' :
                    activePackage === 'Standard' ? 'bg-blue-900/80 text-blue-300 border border-blue-700' :
                    'bg-amber-900/80 text-amber-300 border border-amber-700'
                  }`}>
                    {activePackage}
                  </span>
                </div>
                <div className="text-slate-400 text-[10px]">
                  {selectedBranch?.isHeadOffice ? 'Head Office' : selectedBranch?.name || 'Main Hall'}
                  {!isMultiBranchChain && ' (Single Location)'}
                </div>
              </div>
              {isMultiBranchChain && <ChevronDown className="w-3 h-3 text-slate-400 ml-1" />}
            </button>

            {showTenantDropdown && (
              <div className="absolute left-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-sm">
                <div className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider">Switch Business / Branch</div>
                <div className="mt-1 space-y-1">
                  {tenants.map(t => (
                    <div key={t.id} className="p-1.5 rounded-lg hover:bg-slate-700/50">
                      <div className="font-semibold text-white flex items-center justify-between">
                        <span>{t.name}</span>
                        <span className="text-[10px] px-1 bg-slate-900 text-emerald-400 rounded border border-slate-700">{t.tier}</span>
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
                              selectedBranch?.id === b.id ? 'bg-emerald-600 text-white font-bold' : 'text-slate-300 hover:bg-slate-600'
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

        {/* Right Action Icons: Terminal Mode Switcher, Admin Unlock, Network, Sync, Theme, Currency */}
        <div className="flex items-center gap-2">
          {/* Terminal Mode Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                terminalMode === 'CounterPOS' ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700/80' :
                terminalMode === 'OwnerAdmin' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20' :
                terminalMode === 'WaiterTab' ? 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20' :
                'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
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
              <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-2 z-50">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Terminal Mode</div>
                {[
                  { mode: 'CounterPOS' as const, icon: Monitor, label: 'Cashier Counter', desc: 'POS checkout only', color: 'emerald' },
                  { mode: 'OwnerAdmin' as const, icon: Laptop, label: 'Owner / Back Office', desc: 'Full access — reports, menu, staff', color: 'indigo' },
                  { mode: 'WaiterTab' as const, icon: Tablet, label: 'Waiter Tablet', desc: 'Dining tables & orders', color: 'blue' },
                  { mode: 'KitchenKDS' as const, icon: ChefHat, label: 'Kitchen Display', desc: 'Cooking tickets only', color: 'amber' }
                ].map(({ mode, icon: Icon, label, desc, color }) => (
                  <button
                    key={mode}
                    onClick={() => handleModeSwitch(mode)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition cursor-pointer ${
                      terminalMode === mode
                        ? `bg-${color}-500/20 border border-${color}-500/30 text-${color}-300`
                        : 'text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${terminalMode === mode ? `text-${color}-400` : 'text-slate-400'}`} />
                    <div>
                      <div className="text-xs font-semibold">{label}</div>
                      <div className="text-[10px] text-slate-500">{desc}</div>
                    </div>
                    {terminalMode === mode && <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Admin PIN Unlock (Counter POS mode) */}
          {terminalMode === 'CounterPOS' && (
            isAdminUnlocked ? (
              <button
                onClick={lockAdmin}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer"
                title="Click to lock back to cashier mode"
              >
                <Unlock className="w-3 h-3 text-emerald-400" />
                <span className="hidden sm:inline">Admin Unlocked</span>
              </button>
            ) : (
              <button
                onClick={() => setShowPinModal(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition cursor-pointer"
                title="Owner Master PIN Unlock"
              >
                <Lock className="w-3 h-3" />
                <span className="hidden sm:inline">Admin Unlock</span>
              </button>
            )
          )}

          {/* User Login Button */}
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition cursor-pointer"
            title="Login / Switch User"
          >
            <User className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{currentUser?.fullName || currentUser?.username || 'Login'}</span>
          </button>

          {/* Quick Call Order Intake */}
          <button
            onClick={onOpenCallOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition cursor-pointer"
            title="Open Phone Call Order Intake"
          >
            <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
            <span className="hidden sm:inline">Call Order</span>
          </button>

          {/* Network Status Toggle */}
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
              isOnline
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400 hover:bg-emerald-950/60'
                : 'bg-rose-950/60 border-rose-800 text-rose-400 hover:bg-rose-950/80 animate-pulse'
            }`}
            title="Click to toggle simulated offline/online state"
          >
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Offline Mode</span>
              </>
            )}
          </button>

          {/* Offline Sync Button */}
          {offlinePendingCount > 0 && (
            <button
              onClick={handleManualSync}
              disabled={!isOnline || isSyncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync ({offlinePendingCount})</span>
            </button>
          )}

          {/* Theme Toggle Button (Light / Dark Mode) */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
            title={theme === 'dark' ? 'Switch to Crisp Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          {/* PKR Currency Indicator */}
          <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-400">
            PKR ₨
          </div>
        </div>
      </header>

      {/* Admin PIN Modal (for mode switch or admin unlock) */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {pendingMode === 'OwnerAdmin' ? 'Switch to Owner Mode' : 'Owner Master PIN'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {pendingMode === 'OwnerAdmin'
                      ? 'Enter admin PIN to access full back office'
                      : 'Unlock owner screens on this counter'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPinModal(false);
                  setPendingMode(null);
                  setEnteredPin('');
                  setPinError(false);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePinSubmit} className="space-y-4">
              <div className="space-y-1 text-center">
                <input 
                  type="password"
                  maxLength={6}
                  autoFocus
                  value={enteredPin}
                  onChange={(e) => {
                    setEnteredPin(e.target.value);
                    setPinError(false);
                  }}
                  placeholder="••••"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-white focus:outline-none focus:border-amber-500"
                />
                {pinError && (
                  <p className="text-xs text-red-400 font-semibold pt-1">Incorrect PIN. Try again.</p>
                )}
                <p className="text-[11px] text-slate-500 pt-1">Default PIN: 1234</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'Clear', 0, 'Enter'].map((val, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (val === 'Clear') setEnteredPin('');
                      else if (val === 'Enter') handlePinSubmit(new Event('submit') as any);
                      else setEnteredPin(prev => prev + val.toString());
                    }}
                    className={`py-3 rounded-xl font-bold text-sm transition cursor-pointer ${
                      val === 'Enter' 
                        ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold col-span-1' 
                        : val === 'Clear' 
                        ? 'bg-slate-800 text-red-400 hover:bg-slate-700 text-xs' 
                        : 'bg-slate-800/80 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

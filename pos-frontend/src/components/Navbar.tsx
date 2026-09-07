import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Store, 
  ChefHat, 
  Tablet, 
  Bike, 
  PhoneCall, 
  BarChart3, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  Layers,
  ChevronDown,
  BookOpen,
  Boxes,
  FileText
} from 'lucide-react';

import { usePosStore } from '../store/posStore';


interface NavbarProps {
  onOpenCallOrder: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCallOrder }) => {
  const location = useLocation();
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
    syncPendingOrders 
  } = usePosStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [showTenantDropdown, setShowTenantDropdown] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncPendingOrders();
    setIsSyncing(false);
  };

  const navLinks = [
    { path: '/', label: 'POS Register', icon: Store },
    { path: '/kitchen', label: 'Kitchen KDS', icon: ChefHat },
    { path: '/order-tab', label: 'Order Tab', icon: Tablet },
    { path: '/delivery', label: 'Delivery', icon: Bike },
    { path: '/inventory', label: 'Inventory', icon: Boxes },
    { path: '/reports', label: 'Reports', icon: FileText },
    { path: '/menu', label: 'Menu & Tax', icon: BookOpen },
    { path: '/director', label: 'Director', icon: BarChart3 },
    { path: '/super-admin', label: 'Super Admin', icon: ShieldCheck },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-50">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        {/* Logo & Tenant / Branch Switcher */}
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-white hover:opacity-90">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-emerald-500/20">
              C
            </div>
            <span>Cashly <span className="text-emerald-400 font-semibold text-sm px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60">POS</span></span>
          </Link>

          {/* Tenant & Branch Selector */}
          <div className="relative">
            <button 
              onClick={() => setShowTenantDropdown(!showTenantDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium transition"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <div className="text-left">
                <div className="text-white font-semibold flex items-center gap-1.5">
                  {selectedTenant?.name || 'Cheezious Fast Food'}
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                    activePackage === 'Professional' ? 'bg-purple-900/80 text-purple-300 border border-purple-700' :
                    activePackage === 'Standard' ? 'bg-blue-900/80 text-blue-300 border border-blue-700' :
                    'bg-amber-900/80 text-amber-300 border border-amber-700'
                  }`}>
                    {activePackage}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px]">{selectedBranch?.name || 'F-7 Markaz'}</div>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400 ml-1" />
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
                            className={`w-full text-left text-xs px-2 py-1 rounded flex items-center justify-between ${
                              selectedBranch?.id === b.id ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-600/50'
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

        {/* Center Navigation Links (Horizontal scroll on tablets & compact screens) */}
        <nav className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800 overflow-x-auto no-scrollbar max-w-[60vw]">
          {navLinks.map(({ path, label, icon: Icon }) => {
            const isActive = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Action Icons: Call Order, Online/Offline & Sync */}
        <div className="flex items-center gap-2">
          {/* Quick Call Order Trigger */}
          <button
            onClick={onOpenCallOrder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold transition"
            title="Open Phone Call Order Intake"
          >
            <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
            <span className="hidden sm:inline">Call Order</span>
          </button>

          {/* Network Status Toggle (Interactive simulation for Offline mode) */}
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync ({offlinePendingCount})</span>
            </button>
          )}

          {/* PKR Currency Indicator */}
          <div className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-400">
            PKR ₨
          </div>
        </div>
      </div>
    </header>
  );
};

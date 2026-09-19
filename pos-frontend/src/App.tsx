import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { CallOrderModal } from './components/CallOrderModal';
import { PosTerminal } from './pages/PosTerminal';
import { LoginGate } from './components/LoginGate';
import { RequireModule } from './components/RequireModule';
import { usePosStore } from './store/posStore';
import { posApi, registerAuthRedirect } from './services/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';

// PosTerminal is the "/" landing route — loaded eagerly so the first screen after
// login never shows a loading flash. Every other page is code-split: each becomes
// its own chunk fetched on navigation instead of bloating the initial bundle
// (this is what the "chunks are larger than 500kB" build warning was pointing at).
const KitchenDisplay = lazy(() => import('./pages/KitchenDisplay').then(m => ({ default: m.KitchenDisplay })));
const OrderTab = lazy(() => import('./pages/OrderTab').then(m => ({ default: m.OrderTab })));
const DeliveryBoard = lazy(() => import('./pages/DeliveryBoard').then(m => ({ default: m.DeliveryBoard })));
const MenuManagement = lazy(() => import('./pages/MenuManagement').then(m => ({ default: m.MenuManagement })));
const TaxConfiguration = lazy(() => import('./pages/TaxConfiguration').then(m => ({ default: m.TaxConfiguration })));
const AccountingManagement = lazy(() => import('./pages/AccountingManagement').then(m => ({ default: m.AccountingManagement })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLog })));
const DirectorDashboard = lazy(() => import('./pages/DirectorDashboard').then(m => ({ default: m.DirectorDashboard })));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin').then(m => ({ default: m.SuperAdmin })));
const InventoryManagement = lazy(() => import('./pages/InventoryManagement').then(m => ({ default: m.InventoryManagement })));
const SupplyChainManagement = lazy(() => import('./pages/SupplyChainManagement').then(m => ({ default: m.SupplyChainManagement })));
const ReportsManagement = lazy(() => import('./pages/ReportsManagement').then(m => ({ default: m.ReportsManagement })));
const UserManagement = lazy(() => import('./pages/UserManagement').then(m => ({ default: m.UserManagement })));
const FloorManagement = lazy(() => import('./pages/FloorManagement').then(m => ({ default: m.FloorManagement })));
const InstallationWizard = lazy(() => import('./pages/InstallationWizard').then(m => ({ default: m.InstallationWizard })));
const SettingsManagement = lazy(() => import('./pages/SettingsManagement').then(m => ({ default: m.SettingsManagement })));
const StockRequests = lazy(() => import('./pages/StockRequests').then(m => ({ default: m.StockRequests })));
const TenantSignup = lazy(() => import('./pages/TenantSignup').then(m => ({ default: m.TenantSignup })));
const WhatsAppConfig = lazy(() => import('./pages/WhatsAppConfig').then(m => ({ default: m.WhatsAppConfig })));
const PricingAdmin = lazy(() => import('./pages/PricingAdmin').then(m => ({ default: m.PricingAdmin })));
const ModulePermissions = lazy(() => import('./pages/ModulePermissions').then(m => ({ default: m.ModulePermissions })));
const SmartAnalytics = lazy(() => import('./pages/SmartAnalytics').then(m => ({ default: m.SmartAnalytics })));
const CustomerManagement = lazy(() => import('./pages/CustomerManagement').then(m => ({ default: m.CustomerManagement })));
const LoyaltyGiftCards = lazy(() => import('./pages/LoyaltyGiftCards').then(m => ({ default: m.LoyaltyGiftCards })));
const PromoCodes = lazy(() => import('./pages/PromoCodes').then(m => ({ default: m.PromoCodes })));
const LaborManagement = lazy(() => import('./pages/LaborManagement').then(m => ({ default: m.LaborManagement })));
const MenuEngineering = lazy(() => import('./pages/MenuEngineering').then(m => ({ default: m.MenuEngineering })));
const PaymentSettings = lazy(() => import('./pages/PaymentSettings').then(m => ({ default: m.PaymentSettings })));
const DeliveryIntegrationSettings = lazy(() => import('./pages/DeliveryIntegrationSettings').then(m => ({ default: m.DeliveryIntegrationSettings })));
const MyAddOns = lazy(() => import('./pages/MyAddOns').then(m => ({ default: m.MyAddOns })));

/** Shown while a lazily-loaded route's chunk is being fetched — brief on a normal
 * connection, but real on a slow one, so it's a spinner, not a blank screen. */
function RouteLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center h-full min-h-[50vh]">
      <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
    </div>
  );
}

function MainLayoutInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    setTenants,
    theme,
    setIsOnline,
    refreshOfflineCount,
    isInstalled,
    checkInstallationStatus,
    autoSyncOnReconnect,
    currentUser,
    token,
    logout,
    loadMyModulePermissions
  } = usePosStore();
  const { addToast } = useToast();
  const [isCallOrderOpen, setIsCallOrderOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  const isAuthenticated = !!currentUser && !!token;

  // Teach the axios 401 handler how to end the session and return to the gate.
  useEffect(() => {
    registerAuthRedirect(() => {
      usePosStore.getState().logout();
      navigate('/', { replace: true });
    });
    return () => registerAuthRedirect(null);
  }, [navigate]);

  // Refresh module permissions whenever a session becomes active (e.g. after a
  // reload that restored the token from localStorage).
  useEffect(() => {
    if (isAuthenticated) {
      loadMyModulePermissions();
    }
  }, [isAuthenticated, currentUser?.id, loadMyModulePermissions]);

  // Tenants / branches now require a bearer token, so they load only once a
  // session exists — not during the pre-login setup check.
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadTenantData = async () => {
      try {
        const tenants = await posApi.getTenants();
        setTenants(tenants);
        await usePosStore.getState().loadTenantSettings();
      } catch (err) {
        console.error('Failed to load tenant data:', err);
      }
    };
    loadTenantData();
  }, [isAuthenticated, currentUser?.id, setTenants]);

  useEffect(() => {
    const initializeData = async () => {
      try {
        // Public endpoint — must run before any login so first-run setup works.
        await checkInstallationStatus();
        await refreshOfflineCount();
      } catch (err) {
        console.error('Failed to load initial data:', err);
      } finally {
        setIsCheckingSetup(false);
      }
    };

    initializeData();

    const handleOnline = async () => {
      setIsOnline(true);
      addToast('Internet connection restored', 'success');
      const synced = await autoSyncOnReconnect();
      if (synced > 0) {
        addToast(`${synced} offline order${synced > 1 ? 's' : ''} synced successfully`, 'success', 6000);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      addToast('Working offline — orders will sync when internet returns', 'info', 4000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline, refreshOfflineCount, checkInstallationStatus, autoSyncOnReconnect, addToast]);

  // Full-screen dedicated view for Installation Wizard
  if (location.pathname === '/setup') {
    return <InstallationWizard />;
  }

  // If first-time run with zero configuration and not on setup, redirect to setup.
  // This MUST stay ahead of the login gate — installation happens with no login.
  if (!isCheckingSetup && !isInstalled && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  // Public self-serve signup must stay reachable without a session.
  if (location.pathname === '/signup') {
    return <TenantSignup />;
  }

  // Hold the route tree back until the setup check resolves, so an unauthenticated
  // user never sees application screens flash before the gate.
  if (isCheckingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-purple-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-teal-500/25 animate-pulse">
            C
          </div>
          <p className="text-xs text-slate-500 font-semibold">Starting Cashly POS…</p>
        </div>
      </div>
    );
  }

  // MANDATORY LOGIN GATE — runs after installation checks, before the route tree.
  // No application screen is reachable by URL without an authenticated session.
  if (!isAuthenticated) {
    return <LoginGate />;
  }

  return (
    <div className={`min-h-screen flex flex-col bg-mesh selection:bg-emerald-500 selection:text-slate-950 font-sans transition-colors duration-200 ${
      theme === 'light' ? 'theme-light' : 'theme-dark'
    }`}>
      {/* Left Side Navigation Sidebar with grouped submodules */}
      <Sidebar 
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area (Offset by left sidebar width) */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${
        isSidebarCollapsed ? 'lg:pl-18' : 'lg:pl-64'
      }`}>
        {/* Top Header Bar */}
        <TopHeader 
          onOpenCallOrder={() => setIsCallOrderOpen(true)}
          onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          isSidebarOpen={isMobileSidebarOpen}
          currentUser={currentUser}
          onSwitchUser={() => {
            // Fast cashier handoff: drop the session and fall straight back to the
            // login gate on the next render — no full page reload.
            logout();
            navigate('/', { replace: true });
          }}
          onLogout={() => {
            logout();
            navigate('/', { replace: true });
          }}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Operational screens — open to any signed-in active user (no module gate). */}
            <Route path="/" element={<PosTerminal />} />
            <Route path="/kitchen" element={<KitchenDisplay />} />
            <Route path="/order-tab" element={<OrderTab />} />
            <Route path="/delivery" element={<DeliveryBoard />} />
            {/* Customer lookup is part of taking an order, so viewing stays open to
                any signed-in user; the page itself gates creating/editing on `admin` edit. */}
            <Route path="/customers" element={<CustomerManagement />} />

            {/* Menu / catalog / pricing → `menu` module */}
            <Route path="/menu" element={<RequireModule module="menu"><MenuManagement /></RequireModule>} />
            <Route path="/tax-configuration" element={<RequireModule module="accounts"><TaxConfiguration /></RequireModule>} />
            <Route path="/accounting" element={<RequireModule module="accounts"><AccountingManagement /></RequireModule>} />
            <Route path="/audit-log" element={<RequireModule module="admin"><AuditLog /></RequireModule>} />
            <Route path="/floors" element={<RequireModule module="menu"><FloorManagement /></RequireModule>} />

            {/* Stock → `inventory` module */}
            <Route path="/inventory" element={<RequireModule module="inventory"><InventoryManagement /></RequireModule>} />
            <Route path="/stock-requests" element={<RequireModule module="inventory"><StockRequests /></RequireModule>} />

            {/* Commissary / procurement → `supplychain` module */}
            <Route path="/transfers" element={<RequireModule module="supplychain"><SupplyChainManagement /></RequireModule>} />

            {/* Reporting & analytics → `reports` module */}
            <Route path="/reports" element={<RequireModule module="reports"><ReportsManagement /></RequireModule>} />
            <Route path="/director" element={<RequireModule module="reports"><DirectorDashboard /></RequireModule>} />
            <Route path="/analytics" element={<RequireModule module="reports"><SmartAnalytics /></RequireModule>} />
            <Route path="/menu-engineering" element={<RequireModule module="reports"><MenuEngineering /></RequireModule>} />

            {/* Staff scheduling & time clock → `labor` module (BranchManager-editable baseline) */}
            <Route path="/labor" element={<RequireModule module="labor"><LaborManagement /></RequireModule>} />

            {/* Financial settings & tax configuration → `accounts` module */}
            <Route path="/settings" element={<RequireModule module="accounts"><SettingsManagement /></RequireModule>} />

            {/* Staff administration → `users` module */}
            <Route path="/users" element={<RequireModule module="users"><UserManagement /></RequireModule>} />
            <Route path="/permissions" element={<RequireModule module="users" action="edit"><ModulePermissions /></RequireModule>} />

            {/* Platform / super-admin surface → `admin` module */}
            <Route path="/super-admin" element={<RequireModule module="admin" superAdminOnly><SuperAdmin /></RequireModule>} />
            <Route path="/pricing-admin" element={<RequireModule module="admin" superAdminOnly><PricingAdmin /></RequireModule>} />
            <Route path="/whatsapp-config" element={<RequireModule module="admin"><WhatsAppConfig /></RequireModule>} />

            {/* CRM, loyalty and integration settings → `admin` module */}
            <Route path="/loyalty" element={<RequireModule module="admin"><LoyaltyGiftCards /></RequireModule>} />
            <Route path="/promo-codes" element={<RequireModule module="admin"><PromoCodes /></RequireModule>} />
            <Route path="/payment-settings" element={<RequireModule module="admin"><PaymentSettings /></RequireModule>} />
            <Route path="/delivery-integrations" element={<RequireModule module="admin"><DeliveryIntegrationSettings /></RequireModule>} />
            <Route path="/my-addons" element={<RequireModule module="admin"><MyAddOns /></RequireModule>} />

            <Route path="/signup" element={<TenantSignup />} />
            <Route path="/setup" element={<InstallationWizard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>

      <CallOrderModal
        isOpen={isCallOrderOpen}
        onClose={() => setIsCallOrderOpen(false)}
      />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <MainLayoutInner />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;


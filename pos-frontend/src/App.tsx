import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { CallOrderModal } from './components/CallOrderModal';
import { PosTerminal } from './pages/PosTerminal';
import { LoginGate } from './components/LoginGate';
import { RequireModule } from './components/RequireModule';
import { RequireFeature } from './components/RequireFeature';
import { usePosStore, normalizeRole } from './store/posStore';
import { posApi, registerAuthRedirect, registerBillingHandler } from './services/api';
import { AccountStatusBanner } from './components/AccountStatusBanner';
import { GettingStarted } from './components/GettingStarted';
import { heartbeat, isActivated, type DeviceStatus } from './services/deviceLicense';
import { rememberRestaurantAddress, webNameFromPath } from './services/restaurantAddress';
import { endSupportSession, getSupportSession } from './services/supportSession';
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
const LocationsManagement = lazy(() => import('./pages/LocationsManagement').then(m => ({ default: m.LocationsManagement })));
const ReturnsManagement = lazy(() => import('./pages/ReturnsManagement').then(m => ({ default: m.ReturnsManagement })));
const OpenOrders = lazy(() => import('./pages/OpenOrders').then(m => ({ default: m.OpenOrders })));
const PublicOrder = lazy(() => import('./pages/PublicOrder').then(m => ({ default: m.PublicOrder })));
const ConnectDevice = lazy(() => import('./pages/ConnectDevice').then(m => ({ default: m.ConnectDevice })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));
const ConfirmEmail = lazy(() => import('./pages/ConfirmEmail').then(m => ({ default: m.ConfirmEmail })));

/** The only screens of the platform admin, who owns no restaurant. */
const PLATFORM_ADMIN_PATHS = ['/super-admin', '/pricing-admin'];

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
    checkInstallationStatus,
    autoSyncOnReconnect,
    currentUser,
    token,
    logout,
    loadMyModulePermissions,
    loadMyPackageFeatures,
    packageInfo
  } = usePosStore();
  const { addToast } = useToast();
  const [isCallOrderOpen, setIsCallOrderOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  /** Head office of a chain: back office only, no till anywhere. Resolved server-side. */
  // ERP-only when EITHER this machine was activated as a back-office workstation, or the
  // tenant's shape puts this session at a chain's head office. The device wins, which is how a
  // single restaurant runs a till downstairs and the accounts PC upstairs off one account.
  const isErpOnly = deviceStatus?.appSurface === 'Erp' || packageInfo?.appSurface === 'Erp';

  /**
   * The platform vendor, not a customer. They own no tenant, so every tenant-scoped screen is
   * meaningless to them — and worse than meaningless: those screens fetch with whatever tenant
   * happens to be selected, and before the tenant list resolves that is nothing at all. An
   * unscoped catalogue request 401s, the response interceptor reads that as a dead session, and
   * the platform admin is thrown straight back to the login card.
   *
   * The sidebar already hides every tenant screen from this role; the router has to agree.
   */
  const isPlatformSuperAdmin = normalizeRole(currentUser?.role) === 'SuperAdmin';

  const isAuthenticated = !!currentUser && !!token;
  /** The platform admin inside a restaurant ("View as customer"), when one is open. */
  const supportSession = isAuthenticated ? getSupportSession() : null;

  // Teach the axios 401 handler how to end the session and return to the gate.
  useEffect(() => {
    registerAuthRedirect(() => {
      // A support session that ran out goes back to the platform admin, not to the sign-in page.
      if (getSupportSession()) {
        endSupportSession();
        return;
      }
      usePosStore.getState().logout();
      navigate('/', { replace: true });
    });
    return () => registerAuthRedirect(null);
  }, [navigate]);

  // A 402 means the ACCOUNT is in arrears, not that the session is bad — so this refreshes the
  // billing state and surfaces it, rather than signing anybody out.
  useEffect(() => {
    registerBillingHandler((_status, message) => {
      addToast(message, 'error', 8000);
      loadMyPackageFeatures();
    });
    return () => registerBillingHandler(() => {});
  }, [addToast, loadMyPackageFeatures]);

  /**
   * Device licence heartbeat.
   *
   * Runs once on mount and then hourly. A licence lasts 26 hours with a 14-day grace window, so
   * this is deliberately unhurried: the point is to catch a revocation or a plan change within a
   * day, not to poll. Failure here is not treated as a licence problem — an unreachable server
   * leaves the device on its cached verdict and it carries on selling.
   */
  useEffect(() => {
    if (!isActivated()) {
      setDeviceStatus(null);
      return;
    }

    let cancelled = false;
    const beat = async () => {
      const status = await heartbeat();
      if (!cancelled) setDeviceStatus(status);
    };

    beat();
    const timer = setInterval(beat, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isAuthenticated]);

  // Refresh module permissions whenever a session becomes active (e.g. after a
  // reload that restored the token from localStorage).
  useEffect(() => {
    if (isAuthenticated) {
      loadMyModulePermissions();
      loadMyPackageFeatures();
    }
  }, [isAuthenticated, currentUser?.id, loadMyModulePermissions, loadMyPackageFeatures]);

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

  // A guest ordering from a table QR code or a pickup link: no installation check, no sign-in.
  if (location.pathname.startsWith('/order/')) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/order/:token" element={<PublicOrder />} />
        </Routes>
      </Suspense>
    );
  }

  // A restaurant's own sign-in link (<site>/r/<webName>): this device remembers the restaurant and
  // opens its sign-in, which then asks only username + PIN. (With a domain, the subdomain says it.)
  const linkWebName = webNameFromPath(location.pathname);
  if (linkWebName) {
    rememberRestaurantAddress(linkWebName);
    return <Navigate to="/" replace />;
  }

  // The sign-in screen comes first for everyone signed out. The setup wizard is for someone
  // already signed in (Settings → Re-run Setup Wizard); a visitor who lands on /setup — an old
  // bookmark, or the redirect older versions made — goes to sign in. New businesses register at
  // /signup and new devices connect at /connect, both linked from the sign-in screen.
  if (location.pathname === '/setup') {
    return isAuthenticated ? <InstallationWizard /> : <Navigate to="/" replace />;
  }

  // The link from a "forgot password" email. Reachable signed out, like /signup.
  if (location.pathname === '/reset-password') {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ResetPassword />
      </Suspense>
    );
  }

  // The link from a "confirm your email" message. Reachable signed in or out.
  if (location.pathname === '/confirm-email') {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ConfirmEmail />
      </Suspense>
    );
  }

  // Pairing a till, tablet, kitchen screen or office PC with a code from its manager.
  if (location.pathname === '/connect') {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <ConnectDevice />
      </Suspense>
    );
  }

  // Public self-serve signup must stay reachable without a session. It is the SAME wizard as
  // /setup, just forced into registration mode (creates a tenant via /api/auth/signup with a
  // 30-day trial instead of the first-run initialize).
  if (location.pathname === '/signup') {
    return <InstallationWizard forceSignup />;
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

  // The platform admin owns no restaurant: a restaurant screen would ask the server for "this
  // restaurant", be refused with a 401, and sign them out. Any address other than the platform
  // screens goes to Tenant Management instead (View as customer is the way into a restaurant).
  if (isPlatformSuperAdmin && !PLATFORM_ADMIN_PATHS.includes(location.pathname)) {
    return <Navigate to="/super-admin" replace />;
  }

  return (
    <div className={`min-h-screen flex flex-col bg-mesh selection:bg-teal-500 selection:text-slate-950 font-sans transition-colors duration-200 ${
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
            // A support session just ends, back to the platform admin's own session.
            if (supportSession) { endSupportSession(); return; }
            // Fast cashier handoff: drop the session and fall straight back to the
            // login gate on the next render — no full page reload.
            logout();
            navigate('/', { replace: true });
          }}
          onLogout={() => {
            if (supportSession) { endSupportSession(); return; }
            logout();
            navigate('/', { replace: true });
          }}
        />

        {/* The platform admin looking inside a restaurant ("View as customer"). */}
        {supportSession && (
          <div className="px-4 py-2 bg-purple-600 text-white text-xs flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
            <strong>Support session:</strong>
            <span>
              viewing {supportSession.tenantName}{supportSession.readOnly ? ' (read-only)' : ''} until{' '}
              {new Date(supportSession.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              Recorded in their audit log.
            </span>
            <button
              onClick={endSupportSession}
              className="ml-auto px-3 py-1 rounded-lg bg-white text-purple-700 font-bold hover:bg-purple-50 transition"
            >
              End support session
            </button>
          </div>
        )}

        {/* Account and device state, above everything. Graduated, never a hard block. */}
        <AccountStatusBanner packageInfo={packageInfo} deviceStatus={deviceStatus} />

        {/* The owner's first-days checklist; gone once it is all done or they hide it. */}
        {normalizeRole(currentUser?.role) === 'OwnerAdmin' && !supportSession && currentUser?.tenantId && (
          <GettingStarted key={currentUser.tenantId} tenantId={currentUser.tenantId} />
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Operational screens — open to any signed-in active user (no module gate).
                At the head office of a chain there is no selling at all, so these routes do not
                exist: "/" becomes the executive dashboard and the till URLs redirect. Hiding the
                links alone would not be enough — a bookmarked /order-tab has to land somewhere
                sensible too. */}
            <Route path="/" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace />
                : isErpOnly ? <Navigate to="/director" replace />
                : <PosTerminal />} />
            <Route path="/kitchen" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace />
                : isErpOnly ? <Navigate to="/director" replace />
                : <RequireFeature flag="hasKitchenDisplay" label="Kitchen Display (KDS)"><KitchenDisplay /></RequireFeature>} />
            <Route path="/order-tab" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace />
                : isErpOnly ? <Navigate to="/director" replace />
                : <OrderTab />} />
            <Route path="/delivery" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace />
                : isErpOnly ? <Navigate to="/director" replace />
                : <RequireFeature flag="hasDeliveryCOD" label="Delivery & COD Board"><DeliveryBoard /></RequireFeature>} />
            {/* Customer lookup is part of taking an order, so viewing stays open to
                any signed-in user; the page itself gates creating/editing on `admin` edit. */}
            <Route path="/customers" element={<CustomerManagement />} />
            {/* Finding a sale is open to the counter; recording the refund needs the void
                permission, which the server checks. */}
            <Route path="/returns" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace /> : <ReturnsManagement />} />
            {/* Unpaid orders (waiter tablets, QR codes, pickup links) waiting for payment. */}
            <Route path="/open-orders" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace /> : <OpenOrders />} />

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

            {/* Locations, head office, legal entities and business policies → `admin` module */}
            <Route path="/locations" element={
              isPlatformSuperAdmin ? <Navigate to="/super-admin" replace />
                : <RequireModule module="admin"><LocationsManagement /></RequireModule>} />

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

            <Route path="/signup" element={<InstallationWizard forceSignup />} />
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


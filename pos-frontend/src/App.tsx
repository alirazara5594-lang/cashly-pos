import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { CallOrderModal } from './components/CallOrderModal';
import { PosTerminal } from './pages/PosTerminal';
import { KitchenDisplay } from './pages/KitchenDisplay';
import { OrderTab } from './pages/OrderTab';
import { DeliveryBoard } from './pages/DeliveryBoard';
import { MenuManagement } from './pages/MenuManagement';
import { DirectorDashboard } from './pages/DirectorDashboard';
import { SuperAdmin } from './pages/SuperAdmin';
import { InventoryManagement } from './pages/InventoryManagement';
import { SupplyChainManagement } from './pages/SupplyChainManagement';
import { ReportsManagement } from './pages/ReportsManagement';
import { UserManagement } from './pages/UserManagement';
import { FloorManagement } from './pages/FloorManagement';
import { InstallationWizard } from './pages/InstallationWizard';
import { SettingsManagement } from './pages/SettingsManagement';
import { StockRequests } from './pages/StockRequests';
import { TenantSignup } from './pages/TenantSignup';
import { UserLoginModal } from './components/UserLoginModal';
import { usePosStore } from './store/posStore';
import { posApi } from './services/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';

function MainLayoutInner() {
  const location = useLocation();
  const { setTenants, theme, setIsOnline, refreshOfflineCount, isInstalled, checkInstallationStatus, autoSyncOnReconnect } = usePosStore();
  const { addToast } = useToast();
  const [isCallOrderOpen, setIsCallOrderOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('cashly_pos_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  useEffect(() => {
    const initializeData = async () => {
      try {
        const configured = await checkInstallationStatus();
        if (configured) {
          const tenants = await posApi.getTenants();
          setTenants(tenants);
        }
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
  }, [setTenants, setIsOnline, refreshOfflineCount, checkInstallationStatus, autoSyncOnReconnect, addToast]);

  // Full-screen dedicated view for Installation Wizard
  if (location.pathname === '/setup') {
    return <InstallationWizard />;
  }

  // If first-time run with zero configuration and not on setup, redirect to setup
  if (!isCheckingSetup && !isInstalled && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return (
    <div className={`min-h-screen flex selection:bg-emerald-500 selection:text-slate-950 font-sans transition-colors duration-200 ${
      theme === 'light' ? 'theme-light bg-slate-100 text-slate-900' : 'bg-slate-950 text-slate-100'
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
          onOpenLogin={() => setIsLoginModalOpen(true)}
          onLogout={() => {
            setCurrentUser(null);
            localStorage.removeItem('cashly_pos_user');
            localStorage.removeItem('cashly_pos_token');
          }}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<PosTerminal />} />
            <Route path="/floors" element={<FloorManagement />} />
            <Route path="/kitchen" element={<KitchenDisplay />} />
            <Route path="/order-tab" element={<OrderTab />} />
            <Route path="/delivery" element={<DeliveryBoard />} />
            <Route path="/inventory" element={<InventoryManagement />} />
            <Route path="/transfers" element={<SupplyChainManagement />} />
            <Route path="/reports" element={<ReportsManagement />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/menu" element={<MenuManagement />} />
            <Route path="/director" element={<DirectorDashboard />} />
            <Route path="/super-admin" element={<SuperAdmin />} />
            <Route path="/signup" element={<TenantSignup />} />
            <Route path="/settings" element={<SettingsManagement />} />
            <Route path="/stock-requests" element={<StockRequests />} />
            <Route path="/setup" element={<InstallationWizard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <CallOrderModal
        isOpen={isCallOrderOpen}
        onClose={() => setIsCallOrderOpen(false)}
      />

      <UserLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLogin={(user) => {
          setCurrentUser(user);
          localStorage.setItem('cashly_pos_user', JSON.stringify(user));
        }}
        onLogout={() => {
          setCurrentUser(null);
          localStorage.removeItem('cashly_pos_user');
          localStorage.removeItem('cashly_pos_token');
        }}
        currentUser={currentUser}
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


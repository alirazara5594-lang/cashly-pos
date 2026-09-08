import { useEffect } from 'react';
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
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
import { usePosStore } from './store/posStore';
import { posApi } from './services/api';

export function App() {
  const { setTenants } = usePosStore();
  const [isCallOrderOpen, setIsCallOrderOpen] = useState(false);

  useEffect(() => {
    const initializeData = async () => {
      try {
        const tenants = await posApi.getTenants();
        setTenants(tenants);
      } catch (err) {
        console.error('Failed to load tenants:', err);
      }
    };

    initializeData();
  }, [setTenants]);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-slate-950 font-sans">
        <Navbar onOpenCallOrder={() => setIsCallOrderOpen(true)} />

        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<PosTerminal />} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>


        <CallOrderModal
          isOpen={isCallOrderOpen}
          onClose={() => setIsCallOrderOpen(false)}
        />
      </div>
    </BrowserRouter>
  );
}

export default App;

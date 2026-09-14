import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  ShoppingBag, 
  Wallet, 
  Building2, 
  Store, 
  ArrowUpRight, 
  RefreshCw,
  Award,
  Users,
  Layers
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { DirectorKPIs } from '../types';

export const DirectorDashboard: React.FC = () => {
  const { selectedTenant, selectedBranch, activePackage } = usePosStore();
  const [kpis, setKpis] = useState<DirectorKPIs | null>(null);
  const [viewScope, setViewScope] = useState<'chain' | 'branch'>('chain');
  const [isLoading, setIsLoading] = useState(false);

  const fetchKPIs = async () => {
    setIsLoading(true);
    try {
      const data = await posApi.getDirectorKPIs(
        selectedTenant?.id, 
        viewScope === 'branch' ? selectedBranch?.id : undefined
      );
      setKpis(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIs();
    const interval = setInterval(fetchKPIs, 10000);
    return () => clearInterval(interval);
  }, [selectedTenant?.id, selectedBranch?.id, viewScope]);

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      {/* Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
              Director & Executive Portal
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 font-bold uppercase">
              {activePackage} Tier
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time live performance, revenue metrics, and branch audits for business owners & directors
          </p>
        </div>

        {/* Scope Toggle: Chain vs Branch */}
        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-white border border-slate-200 rounded-xl">
            <button
              onClick={() => setViewScope('chain')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                viewScope === 'chain'
                  ? 'bg-purple-500 text-white shadow-md shadow-purple-500/25'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Consolidated Chain</span>
            </button>
            <button
              onClick={() => setViewScope('branch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                viewScope === 'branch'
                  ? 'bg-purple-500 text-white shadow-md shadow-purple-500/25'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>{selectedBranch?.name || 'Selected Branch'}</span>
            </button>
          </div>

          <button
            onClick={fetchKPIs}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
            title="Refresh Live Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top 4 KPI Metric Cards - Clean Normal Height */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Today's Revenue */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 relative overflow-hidden shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Today's Gross Sales</span>
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">
              {(kpis?.todaySalesPKR || 0).toLocaleString()}
            </div>
            <div className="text-[10px] text-teal-600 flex items-center gap-1 mt-0.5 font-semibold">
              <ArrowUpRight className="w-3 h-3" /> +14.8% vs yesterday
            </div>
          </div>
        </div>

        {/* Metric 2: Total Orders */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 relative overflow-hidden shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Orders Processed</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">{kpis?.totalOrders || 0}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              <strong className="text-teal-600">{kpis?.completedOrders || 0} completed</strong> • {kpis?.activeOrders || 0} active
            </div>
          </div>
        </div>

        {/* Metric 3: Average Basket Value */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 relative overflow-hidden shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Avg Ticket / Basket</span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">
              {(kpis?.avgBasketPKR || 0).toLocaleString()}
            </div>
            <div className="text-[10px] text-purple-600 mt-0.5">
              High average spending per receipt
            </div>
          </div>
        </div>

        {/* Metric 4: Cash Drawer Status */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 relative overflow-hidden shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Live Cash Drawer Float</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-teal-600 leading-tight">58,500</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Active Shift: <strong>Hamza POS</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Branch Performance Comparison (Core to Professional & Standard Packages) */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-500" />
              <span>Branch Revenue & Counter Utilization</span>
            </h2>
            <p className="text-xs text-slate-500">
              Live breakdown of all branches connected to {selectedTenant?.name || 'Restaurant HQ'}
            </p>
          </div>
          <span className="text-xs font-mono text-teal-600 font-bold">Currency: PKR</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <th className="pb-3">Branch Location</th>
                <th className="pb-3">City</th>
                <th className="pb-3 text-center">Licensed Counters</th>
                <th className="pb-3 text-center">Today's Orders</th>
                <th className="pb-3 text-right">Revenue (PKR)</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(kpis?.branchComparison || [
                { branchId: '1', branchName: 'Downtown Branch', city: 'Islamabad', activeCounters: 5, ordersCount: 42, todaySalesPKR: 114500 },
                { branchId: '2', branchName: 'Uptown Branch', city: 'Lahore', activeCounters: 5, ordersCount: 38, todaySalesPKR: 98200 },
                { branchId: '3', branchName: 'Express Outlet', city: 'Rawalpindi', activeCounters: 3, ordersCount: 29, todaySalesPKR: 64100 },
              ]).map((branch, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition">
                  <td className="py-3 font-bold text-slate-900 flex items-center gap-2">
                    <Store className="w-4 h-4 text-purple-500" />
                    <span>{branch.branchName}</span>
                  </td>
                  <td className="py-3 text-slate-700">{branch.city}</td>
                  <td className="py-3 text-center font-mono font-bold text-blue-600">{branch.activeCounters} Counters</td>
                  <td className="py-3 text-center font-bold text-slate-900">{branch.ordersCount}</td>
                  <td className="py-3 text-right font-black text-teal-600 text-sm">
                    {branch.todaySalesPKR.toLocaleString()}
                  </td>
                  <td className="py-3 text-right">
                    <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 border border-teal-200 text-[10px] font-bold">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fast Insights & Top Products */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-500" />
            <span>Top Performing Items (Today)</span>
          </h3>
          <div className="space-y-2">
            {[
              { name: 'Crown Crust Pizza (Large)', count: 24, revenue: '42,000' },
              { name: 'Zinger Supreme Burger', count: 35, revenue: '24,150' },
              { name: 'Grand Family Feast', count: 6, revenue: '23,100' },
              { name: 'Cheesy Loaded Fries', count: 28, revenue: '13,720' },
            ].map((item, idx) => (
              <div key={idx} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs text-slate-900">{item.name}</span>
                  <div className="text-[10px] text-slate-500">{item.count} units sold</div>
                </div>
                <span className="font-black text-xs text-teal-600">{item.revenue}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span>Cashier Shift Performance & Float</span>
          </h3>
          <div className="space-y-2">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Cashier on Duty:</span>
                <strong className="text-slate-900">Hamza POS (Counter 1)</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Shift Started:</span>
                <span className="text-slate-700">4 hours ago (11:00 AM)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Opening Cash Float:</span>
                <span className="text-slate-700">10,000</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="text-slate-500 font-bold">Total Cash in Till:</span>
                <span className="text-teal-600 font-black">58,500</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

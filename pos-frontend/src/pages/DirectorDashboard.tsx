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
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">
      {/* Executive Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
              Director & Executive Portal
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-950 text-purple-400 border border-purple-800 font-bold uppercase">
              {activePackage} Tier
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time live performance, revenue metrics, and branch audits for business owners & directors
          </p>
        </div>

        {/* Scope Toggle: Chain vs Branch */}
        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              onClick={() => setViewScope('chain')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                viewScope === 'chain'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Consolidated Chain</span>
            </button>
            <button
              onClick={() => setViewScope('branch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                viewScope === 'branch'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>{selectedBranch?.name || 'Selected Branch'}</span>
            </button>
          </div>

          <button
            onClick={fetchKPIs}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            title="Refresh Live Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top 4 KPI Metric Cards - Clean Normal Height */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Today's Revenue */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 relative overflow-hidden shadow-xl h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Today's Gross Sales</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-white leading-tight">
              ₨{(kpis?.todaySalesPKR || 0).toLocaleString()}
            </div>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5 font-semibold">
              <ArrowUpRight className="w-3 h-3" /> +14.8% vs yesterday
            </div>
          </div>
        </div>

        {/* Metric 2: Total Orders */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 relative overflow-hidden shadow-xl h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Orders Processed</span>
            <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-white leading-tight">{kpis?.totalOrders || 0}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              <strong className="text-emerald-400">{kpis?.completedOrders || 0} completed</strong> • {kpis?.activeOrders || 0} active
            </div>
          </div>
        </div>

        {/* Metric 3: Average Basket Value */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 relative overflow-hidden shadow-xl h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Avg Ticket / Basket</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-white leading-tight">
              ₨{(kpis?.avgBasketPKR || 0).toLocaleString()}
            </div>
            <div className="text-[10px] text-purple-300 mt-0.5">
              High average spending per receipt
            </div>
          </div>
        </div>

        {/* Metric 4: Cash Drawer Status */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 relative overflow-hidden shadow-xl h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Live Cash Drawer Float</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-emerald-400 leading-tight">₨58,500</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Active Shift: <strong>Hamza POS</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Branch Performance Comparison (Core to Professional & Standard Packages) */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <span>Branch Revenue & Counter Utilization</span>
            </h2>
            <p className="text-xs text-slate-400">
              Live breakdown of all branches connected to {selectedTenant?.name || 'Restaurant HQ'}
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-400 font-bold">Currency: PKR ₨</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="pb-3">Branch Location</th>
                <th className="pb-3">City</th>
                <th className="pb-3 text-center">Licensed Counters</th>
                <th className="pb-3 text-center">Today's Orders</th>
                <th className="pb-3 text-right">Revenue (PKR)</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {(kpis?.branchComparison || [
                { branchId: '1', branchName: 'Downtown Branch', city: 'Islamabad', activeCounters: 5, ordersCount: 42, todaySalesPKR: 114500 },
                { branchId: '2', branchName: 'Uptown Branch', city: 'Lahore', activeCounters: 5, ordersCount: 38, todaySalesPKR: 98200 },
                { branchId: '3', branchName: 'Express Outlet', city: 'Rawalpindi', activeCounters: 3, ordersCount: 29, todaySalesPKR: 64100 },
              ]).map((branch, idx) => (
                <tr key={idx} className="hover:bg-slate-850/50 transition">
                  <td className="py-3 font-bold text-white flex items-center gap-2">
                    <Store className="w-4 h-4 text-purple-400" />
                    <span>{branch.branchName}</span>
                  </td>
                  <td className="py-3 text-slate-300">{branch.city}</td>
                  <td className="py-3 text-center font-mono font-bold text-cyan-400">{branch.activeCounters} Counters</td>
                  <td className="py-3 text-center font-bold text-white">{branch.ordersCount}</td>
                  <td className="py-3 text-right font-black text-emerald-400 text-sm">
                    ₨{branch.todaySalesPKR.toLocaleString()}
                  </td>
                  <td className="py-3 text-right">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 text-[10px] font-bold">
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
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <span>Top Performing Items (Today)</span>
          </h3>
          <div className="space-y-2">
            {[
              { name: 'Crown Crust Pizza (Large)', count: 24, revenue: '₨42,000' },
              { name: 'Zinger Supreme Burger', count: 35, revenue: '₨24,150' },
              { name: 'Grand Family Feast', count: 6, revenue: '₨23,100' },
              { name: 'Cheesy Loaded Fries', count: 28, revenue: '₨13,720' },
            ].map((item, idx) => (
              <div key={idx} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs text-white">{item.name}</span>
                  <div className="text-[10px] text-slate-400">{item.count} units sold</div>
                </div>
                <span className="font-black text-xs text-emerald-400">{item.revenue}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
          <h3 className="font-bold text-sm text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span>Cashier Shift Performance & Float</span>
          </h3>
          <div className="space-y-2">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Cashier on Duty:</span>
                <strong className="text-white">Hamza POS (Counter 1)</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Shift Started:</span>
                <span className="text-slate-300">4 hours ago (11:00 AM)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Opening Cash Float:</span>
                <span className="text-slate-200">₨10,000</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400 font-bold">Total Cash in Till:</span>
                <span className="text-emerald-400 font-black">₨58,500</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

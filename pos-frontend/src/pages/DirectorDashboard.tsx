import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  TrendingUp,
  ShoppingBag,
  Wallet,
  Store,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Award,
  Users,
  Layers
} from 'lucide-react';
import { posApi, getApiErrorMessage, ALL_LOCATIONS } from '../services/api';
import { usePosStore } from '../store/posStore';
import { useBusinessShape } from '../hooks/useBusinessShape';
import { LocationPicker } from '../components/LocationPicker';
import type { DirectorKPIs } from '../types';

/** "+12% vs this time yesterday", from real figures only — or nothing to compare against. */
function comparison(today: number, yesterday: number | undefined): { text: string; up: boolean | null } {
  if (yesterday == null) return { text: '', up: null };
  if (yesterday <= 0) return { text: today > 0 ? 'No sales by this time yesterday' : 'No sales yet today', up: null };
  const change = Math.round(((today - yesterday) / yesterday) * 1000) / 10;
  return { text: `${change > 0 ? '+' : ''}${change}% vs this time yesterday`, up: change >= 0 };
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The owner's and head office's overview of today. Every figure comes from the server: an empty
 * business shows empty states, never sample numbers.
 */
export const DirectorDashboard: React.FC = () => {
  const { selectedTenant, currentUser } = usePosStore();
  const { atHeadOffice, severalLocations, outlets, locations } = useBusinessShape();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<DirectorKPIs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // The whole business by default; one outlet to look closer. Staff pinned to a branch only ever
  // see their own, which the server enforces.
  const [scope, setScope] = useState<string>(ALL_LOCATIONS);
  const isPinned = !!currentUser?.branchId;
  const tenantId = selectedTenant?.id;

  const fetchKPIs = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await posApi.getDirectorKPIs(tenantId, scope === ALL_LOCATIONS ? undefined : scope);
      setKpis(data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load today\'s figures.'));
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, scope]);

  useEffect(() => {
    fetchKPIs();
    const interval = setInterval(fetchKPIs, 10000);
    return () => clearInterval(interval);
  }, [fetchKPIs]);

  const currency = kpis?.currency ?? 'PKR';
  const money = (n: number | undefined) => `${currency} ${(n ?? 0).toLocaleString()}`;
  const sales = comparison(kpis?.todaySalesPKR ?? 0, kpis?.yesterdaySameTimeSalesPKR);
  const openShifts = kpis?.openShifts ?? [];
  const topItems = kpis?.topItems ?? [];
  const branches = kpis?.branchComparison ?? [];
  // Head office compares its outlets; a business with one location has nothing to compare.
  const pickable = atHeadOffice ? outlets : locations;
  const showPicker = !isPinned && severalLocations && pickable.length > 0;
  const showBranches = severalLocations && scope === ALL_LOCATIONS;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Today at {atHeadOffice ? 'your outlets' : selectedTenant?.name ?? 'your business'}. Updates every 10 seconds.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {showPicker && (
            <LocationPicker
              value={scope}
              onChange={setScope}
              locations={pickable}
              allLabel={atHeadOffice ? 'All outlets' : 'Whole business'}
              label="Showing"
            />
          )}
          <button
            onClick={fetchKPIs}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Head office before its first outlet: the next step, not empty charts. */}
      {atHeadOffice && outlets.length === 0 && (
        <div className="p-5 rounded-2xl bg-teal-50 border border-teal-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold text-sm text-teal-900">Add your first outlet</div>
            <div className="text-xs text-teal-800 mt-0.5">Sales, tills and stock all happen at outlets. Once one is selling, its figures appear here.</div>
          </div>
          <button
            onClick={() => navigate('/locations')}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition"
          >
            Add an outlet
          </button>
        </div>
      )}

      {/* Today's numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Today's Sales</span>
            <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">{money(kpis?.todaySalesPKR)}</div>
            {sales.text && (
              <div className={`text-[10px] flex items-center gap-1 mt-0.5 font-semibold ${
                sales.up === null ? 'text-slate-500' : sales.up ? 'text-teal-600' : 'text-rose-600'
              }`}>
                {sales.up === true && <ArrowUpRight className="w-3 h-3" />}
                {sales.up === false && <ArrowDownRight className="w-3 h-3" />}
                {sales.text}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Orders</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">{kpis?.totalOrders ?? 0}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              <strong className="text-teal-600">{kpis?.completedOrders ?? 0} completed</strong> • {kpis?.activeOrders ?? 0} open
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Average Order</span>
            <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">{money(kpis?.avgBasketPKR)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Per order today</div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm h-[115px] flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cash in Open Tills</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-xl font-black text-slate-900 leading-tight">{money(kpis?.cashInOpenTillsPKR)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {openShifts.length === 0 ? 'No till open right now' : `${openShifts.length} till${openShifts.length === 1 ? '' : 's'} open`}
            </div>
          </div>
        </div>
      </div>

      {/* Outlets side by side */}
      {showBranches && (
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-600" />
              <span>Outlets Today</span>
            </h2>
            <p className="text-xs text-slate-500">Sales and live tills at each outlet.</p>
          </div>

          {branches.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No outlets selling yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="pb-3">Outlet</th>
                    <th className="pb-3">City</th>
                    <th className="pb-3 text-center">Tills Live</th>
                    <th className="pb-3 text-center">Orders</th>
                    <th className="pb-3 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {branches.map(branch => (
                    <tr key={branch.branchId} className="hover:bg-slate-50 transition">
                      <td className="py-3 font-bold text-slate-900">
                        <span className="flex items-center gap-2">
                          <Store className="w-4 h-4 text-teal-600" />
                          {branch.branchName}
                        </span>
                      </td>
                      <td className="py-3 text-slate-700">{branch.city || '—'}</td>
                      <td className="py-3 text-center font-mono font-bold text-slate-700">{branch.activeCounters}</td>
                      <td className="py-3 text-center font-bold text-slate-900">{branch.ordersCount}</td>
                      <td className="py-3 text-right font-black text-teal-600 text-sm">{money(branch.todaySalesPKR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Best sellers and open tills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-500" />
            <span>Best Sellers Today</span>
          </h3>
          {topItems.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No sales yet today.</div>
          ) : (
            <div className="space-y-2">
              {topItems.map(item => (
                <div key={item.name} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-slate-900">{item.name}</span>
                    <div className="text-[10px] text-slate-500">{item.quantity} sold</div>
                  </div>
                  <span className="font-black text-xs text-teal-600">{money(item.revenuePKR)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span>Open Tills</span>
          </h3>
          {openShifts.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No till is open right now.</div>
          ) : (
            <div className="space-y-2">
              {openShifts.map(s => (
                <div key={s.shiftId} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <strong className="text-slate-900">{s.cashierName || 'Cashier'}{s.terminalName ? ` · ${s.terminalName}` : ''}</strong>
                    {severalLocations && s.branchName && <span className="text-slate-500">{s.branchName}</span>}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Opened at {timeOf(s.openedAt)} with</span>
                    <span className="text-slate-700">{money(s.openingFloatPKR)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500 font-bold">Should be in the drawer</span>
                    <span className="text-teal-600 font-black">{money(s.expectedCashPKR)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

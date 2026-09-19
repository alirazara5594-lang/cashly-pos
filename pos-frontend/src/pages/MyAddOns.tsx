import React, { useState, useEffect, useCallback } from 'react';
import { Puzzle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { TenantAddOnCatalogRow } from '../types';

export const MyAddOns: React.FC = () => {
  const [catalog, setCatalog] = useState<TenantAddOnCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await posApi.getAddOnCatalog();
      setCatalog(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load add-ons'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = catalog.filter(c => c.isActiveForTenant);
  const available = catalog.filter(c => !c.isActiveForTenant);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Puzzle className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Add-ons</h1>
            <p className="text-[11px] text-slate-500 mt-1">Features beyond your current plan — contact us to activate any of these.</p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition">
          <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && <div className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">{error}</div>}

      {active.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Active on Your Account</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map(item => (
              <div key={item.id} className="p-4 rounded-2xl bg-white border border-teal-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">{item.displayName}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                </div>
                {item.description && <p className="text-[11px] text-slate-500">{item.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Available Add-ons</h2>
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">Loading…</div>
        ) : available.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">
            {catalog.length === 0 ? 'No add-ons are available yet.' : 'Everything in the catalog is already active on your account.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {available.map(item => (
              <div key={item.id} className="p-4 rounded-2xl bg-white border border-slate-200 space-y-1.5">
                <span className="text-sm font-bold text-slate-900">{item.displayName}</span>
                {item.description && <p className="text-[11px] text-slate-500">{item.description}</p>}
                <div className="flex items-baseline gap-1 pt-1">
                  <span className="text-base font-black text-teal-600">{item.monthlyPricePKR.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400">PKR / month</span>
                </div>
                <p className="text-[10px] text-slate-400">or {item.yearlyPricePKR.toLocaleString()} PKR / year</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

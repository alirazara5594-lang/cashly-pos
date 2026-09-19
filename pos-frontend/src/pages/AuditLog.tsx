import React, { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { AuditLogEntry } from '../types';

const ACTION_COLORS: Record<string, string> = {
  PriceChanged: 'bg-amber-50 text-amber-700 border-amber-200',
  OrderVoided: 'bg-rose-50 text-rose-700 border-rose-200',
  PermissionChanged: 'bg-purple-50 text-purple-700 border-purple-200',
  ManagerOverride: 'bg-blue-50 text-blue-700 border-blue-200',
  TaxJurisdictionChanged: 'bg-amber-50 text-amber-700 border-amber-200',
  StockAdjustment: 'bg-orange-50 text-orange-700 border-orange-200',
  UserDeleted: 'bg-rose-50 text-rose-700 border-rose-200',
  PayrollGenerated: 'bg-teal-50 text-teal-700 border-teal-200',
  PayslipFinalized: 'bg-teal-50 text-teal-700 border-teal-200',
  PayslipPaid: 'bg-teal-50 text-teal-700 border-teal-200',
  JournalEntryReversed: 'bg-rose-50 text-rose-700 border-rose-200'
};

export const AuditLog: React.FC = () => {
  const { selectedTenant } = usePosStore();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await posApi.getAuditLog({ tenantId: selectedTenant.id, action: actionFilter || undefined, page, pageSize: 50 });
      setEntries(data.entries || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load audit log'));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTenant?.id, actionFilter, page]);

  useEffect(() => { load(); }, [load]);

  const knownActions = Array.from(new Set(entries.map(e => e.action)));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <History className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Audit Log</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Every privileged change — price edits, permission changes, voids, stock adjustments, payroll, accounting postings — {total} total.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
            >
              <option value="">All actions</option>
              {knownActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Who</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">Loading audit log…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">No audit entries yet.</td></tr>
              ) : entries.map(e => (
                <tr key={e.id} className="hover:bg-slate-50 align-top">
                  <td className="px-4 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-xs font-bold text-slate-900 whitespace-nowrap">{e.userName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border whitespace-nowrap ${ACTION_COLORS[e.action] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-500 whitespace-nowrap">{e.entityType}</td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-600">
                    {e.oldValue && <div><span className="text-slate-400">from:</span> {e.oldValue}</div>}
                    {e.newValue && <div><span className="text-slate-400">to:</span> {e.newValue}</div>}
                    {!e.oldValue && !e.newValue && '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-600 transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-600 transition"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

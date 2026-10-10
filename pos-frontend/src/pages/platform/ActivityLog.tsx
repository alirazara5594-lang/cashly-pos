import React, { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import type { ActivityPage, TeamMember } from '../../types';

/** A readable name for a recorded action: "SubscriptionPaymentRecorded" becomes "Subscription payment recorded". */
const actionLabel = (action: string) => action.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()).replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`);

/**
 * Everything the platform team did — and the billing automation — across every business: who
 * changed a price, recorded a payment, opened a support session, stopped a part.
 */
export const ActivityLog: React.FC<{ onOpenTenant?: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [data, setData] = useState<ActivityPage | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTeam().then(rows => { if (!cancelled) setTeam(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformActivity({ actorId: actorId || undefined, action: action || undefined, search: query || undefined, page, pageSize: 50 })
      .then(res => { if (!cancelled) { setData(res); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load the activity log.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [actorId, action, query, page, tick]);

  const selectCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-teal-500';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); setLoading(true); }} className={selectCls}>
          <option value="">Everyone</option>
          {team.map(m => <option key={m.id} value={m.id}>{m.fullName}</option>)}
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); setLoading(true); }} className={selectCls}>
          <option value="">Any action</option>
          {data?.actions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); setPage(1); setLoading(true); }} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search what changed… (Enter)"
            className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-64 focus:outline-none focus:border-teal-500" />
        </form>
        <button onClick={() => { setLoading(true); setTick(t => t + 1); }} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {data && <span className="text-[11px] text-slate-400 ml-auto">{data.total.toLocaleString()} entries</span>}
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Who</th>
                <th className="px-4 py-2.5">Business</th>
                <th className="px-4 py-2.5">What</th>
                <th className="px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.entries.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nothing recorded.</td></tr>}
              {data?.entries.map(e => (
                <tr key={e.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 font-mono text-[10px]">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{e.userName}</td>
                  <td className="px-4 py-2.5">
                    {e.tenantName ? (
                      <button onClick={() => onOpenTenant?.(e.tenantId)} className="font-semibold text-slate-700 hover:text-teal-700 text-left">{e.tenantName}</button>
                    ) : <span className="text-slate-400">Platform</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{actionLabel(e.action)}</td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-md">
                    {e.oldValue && <span className="text-rose-500 line-through mr-1">{e.oldValue}</span>}
                    {e.oldValue && e.newValue && '→ '}
                    {e.newValue && <span>{e.newValue}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); setLoading(true); }} className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold disabled:opacity-40">Previous</button>
          <span className="text-xs text-slate-500">{page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => { setPage(p => p + 1); setLoading(true); }} className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
};

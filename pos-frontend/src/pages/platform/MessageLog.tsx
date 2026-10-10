import React, { useEffect, useState } from 'react';
import { RefreshCw, Mail, MessageCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import type { PlatformMessagePage } from '../../types';

const KIND_LABEL: Record<string, string> = {
  reminder: 'Renewal reminder', invoice: 'Invoice', payment: 'Payment receipt', stopped: 'Paused for non-payment',
  message: 'Message from the team', invite: 'Owner invite', test: 'Test'
};

/**
 * Every WhatsApp message and email the platform sent to businesses — reminders, invoices, receipts —
 * and the ones that did not go, with why. A business's own WhatsApp to its customers is separate.
 */
export const MessageLog: React.FC<{ onOpenTenant?: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [data, setData] = useState<PlatformMessagePage | null>(null);
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformMessages({ channel: channel || undefined, status: status || undefined, kind: kind || undefined, page, pageSize: 50 })
      .then(res => { if (!cancelled) { setData(res); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load messages.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channel, status, kind, page, tick]);

  const filter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => { setter(e.target.value); setPage(1); setLoading(true); };
  const count = (s: string) => data?.last30Days.find(x => x.status === s)?.count ?? 0;
  const selectCls = 'px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:border-teal-500';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 max-w-xl">
        {[['sent', 'Sent (30 days)', 'text-teal-700'], ['failed', 'Failed', 'text-rose-600'], ['skipped', 'Not sent (nothing set up)', 'text-slate-500']].map(([s, label, tone]) => (
          <div key={s} className="p-3 rounded-2xl bg-white border border-slate-200">
            <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
            <div className={`text-xl font-black ${tone}`}>{count(s)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={channel} onChange={filter(setChannel)} className={selectCls}>
          <option value="">WhatsApp and email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <select value={status} onChange={filter(setStatus)} className={selectCls}>
          <option value="">Any result</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Not sent</option>
        </select>
        <select value={kind} onChange={filter(setKind)} className={selectCls}>
          <option value="">Any kind</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={() => { setLoading(true); setTick(t => t + 1); }} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5 w-8"></th>
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Business</th>
              <th className="px-4 py-2.5">What</th>
              <th className="px-4 py-2.5">To</th>
              <th className="px-4 py-2.5">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.entries.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No messages yet.</td></tr>
            )}
            {data?.entries.map(m => (
              <React.Fragment key={m.id}>
                <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                  <td className="px-4 py-2.5 text-slate-400">{expanded === m.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    {m.tenantId ? (
                      <button onClick={(e) => { e.stopPropagation(); onOpenTenant?.(m.tenantId!); }} className="font-bold text-slate-800 hover:text-teal-700">{m.tenantName ?? '—'}</button>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      {m.channel === 'email' ? <Mail className="w-3 h-3 text-slate-400" /> : <MessageCircle className="w-3 h-3 text-teal-600" />}
                      {KIND_LABEL[m.kind] ?? m.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono">{m.recipient || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                      m.status === 'sent' ? 'bg-teal-50 text-teal-700 border-teal-200' : m.status === 'failed' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}>{m.status === 'skipped' ? 'not sent' : m.status}</span>
                    {m.error && <div className="text-[10px] text-slate-500 mt-0.5 max-w-xs">{m.error}</div>}
                  </td>
                </tr>
                {expanded === m.id && (
                  <tr className="bg-slate-50/60">
                    <td></td>
                    <td colSpan={5} className="px-4 py-3">
                      {m.subject && <div className="text-[11px] font-bold text-slate-700 mb-1">{m.subject}</div>}
                      <pre className="whitespace-pre-wrap text-[11px] text-slate-700 font-sans">{m.body}</pre>
                      <div className="text-[10px] text-slate-400 mt-1">Sent by {m.sentByName ?? '—'}</div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
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

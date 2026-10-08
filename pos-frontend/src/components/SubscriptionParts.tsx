import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, Server, Store, Tablet, Puzzle, CheckCircle2, CalendarDays } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { KIND_LABEL, daysText, needsAttention } from '../utils/renewals';
import type { SubscriptionPartRow, SubscriptionPartKind } from '../types';

/**
 * Renewals per part. A business pays for several things — the head office's ERP, each outlet's
 * POS, each tablet beyond what an outlet's POS includes, and add-ons — and each renews on its own
 * date, counted from when it was installed.
 */

const KIND_ICON: Record<SubscriptionPartKind, React.FC<{ className?: string }>> = {
  Erp: Server,
  Pos: Store,
  Tablet: Tablet,
  AddOn: Puzzle
};

const dateOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const PartStatusBadge: React.FC<{ part: SubscriptionPartRow }> = ({ part }) => {
  const look: Record<SubscriptionPartRow['status'], { label: string; cls: string }> = {
    NotInstalled: { label: 'No till yet', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    Trial: { label: 'Free trial', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    Active: { label: 'Paid', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
    Expiring: { label: part.inTrial ? 'Trial ending' : 'Renewing soon', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    PaymentDue: { label: 'Payment due', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    Expired: { label: 'Expired', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    Ended: { label: 'Not in use', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  };
  const { label, cls } = look[part.status];
  return <span className={`inline-flex px-2 py-0.5 rounded-lg border text-[10px] font-bold whitespace-nowrap ${cls}`}>{label}</span>;
};

interface SubscriptionPartsTableProps {
  parts: SubscriptionPartRow[];
  /** Show which business each part belongs to (the platform-wide list). */
  showTenant?: boolean;
  onOpenTenant?: (tenantId: string) => void;
  /** The platform admin may record payments and set dates; a customer only reads. */
  canManage?: boolean;
  onChanged?: (updated: SubscriptionPartRow) => void;
  emptyText?: string;
}

export const SubscriptionPartsTable: React.FC<SubscriptionPartsTableProps> = ({
  parts, showTenant, onOpenTenant, canManage, onChanged, emptyText
}) => {
  // One row at a time opens for recording a payment or setting a date.
  const [editing, setEditing] = useState<{ id: string; mode: 'paid' | 'date' } | null>(null);
  const [annual, setAnnual] = useState(false);
  const [periods, setPeriods] = useState(1);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (part: SubscriptionPartRow, mode: 'paid' | 'date') => {
    setEditing({ id: part.id, mode });
    setAnnual(part.annual);
    setPeriods(1);
    setDate((part.renewsAt ?? new Date().toISOString()).slice(0, 10));
    setError(null);
  };

  const save = async (part: SubscriptionPartRow) => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const updated = editing.mode === 'paid'
        ? await posApi.markSubscriptionPartPaid(part.id, annual, periods)
        : await posApi.setSubscriptionPartPaidUntil(part.id, `${date}T00:00:00Z`);
      setEditing(null);
      onChanged?.(updated);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  if (parts.length === 0) {
    return <div className="py-10 text-center text-xs text-slate-500">{emptyText ?? 'Nothing here.'}</div>;
  }

  const columns = 5 + (showTenant ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
            {showTenant && <th className="py-3 px-4">Business</th>}
            <th className="py-3 px-4">What</th>
            <th className="py-3 px-4">Installed</th>
            <th className="py-3 px-4">Renews</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4 text-right">Price</th>
            {canManage && <th className="py-3 px-4 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {parts.map(part => {
            const Icon = KIND_ICON[part.kind];
            const isEditing = editing?.id === part.id;
            const canAct = canManage && part.isActive && part.status !== 'NotInstalled';
            return (
              <React.Fragment key={part.id}>
                <tr className={`hover:bg-slate-50 transition ${part.isActive ? '' : 'opacity-60'}`}>
                  {showTenant && (
                    <td className="py-3 px-4">
                      {onOpenTenant ? (
                        <button onClick={() => onOpenTenant(part.tenantId)} className="font-bold text-slate-900 hover:text-teal-700 text-left">
                          {part.tenantName ?? '—'}
                        </button>
                      ) : (
                        <span className="font-bold text-slate-900">{part.tenantName ?? '—'}</span>
                      )}
                    </td>
                  )}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                        <Icon className="w-3 h-3" /> {KIND_LABEL[part.kind]}
                      </span>
                      <span className="font-semibold text-slate-800">{part.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                    {part.installedAt ? dateOf(part.installedAt) : <span className="text-slate-400">Not yet</span>}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-semibold text-slate-800">{part.isActive ? dateOf(part.renewsAt) : `Ended ${dateOf(part.endedAt)}`}</div>
                    {part.isActive && part.daysLeft != null && (
                      <div className={`text-[10px] ${part.daysLeft < 0 ? 'text-rose-600 font-bold' : part.status === 'Expiring' ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>
                        {daysText(part.daysLeft)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4"><PartStatusBadge part={part} /></td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700 whitespace-nowrap">
                    {part.pricePKR > 0 ? `PKR ${Math.round(part.pricePKR).toLocaleString()} / ${part.annual ? 'year' : 'month'}` : '—'}
                  </td>
                  {canManage && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canAct && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => open(part, 'paid')}
                            className="px-2.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[10px] font-bold transition"
                          >
                            Mark paid
                          </button>
                          <button
                            onClick={() => open(part, 'date')}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition"
                            title="Set the date it is paid up to — a correction or a free period"
                          >
                            Set date
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
                {isEditing && (
                  <tr className="bg-teal-50/40">
                    <td colSpan={columns} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {editing!.mode === 'paid' ? (
                          <>
                            <span className="font-semibold text-slate-700">Payment received for</span>
                            <input
                              type="number"
                              min={1}
                              max={36}
                              value={periods}
                              onChange={(e) => setPeriods(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
                              className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-center font-bold"
                            />
                            <select
                              value={annual ? 'year' : 'month'}
                              onChange={(e) => setAnnual(e.target.value === 'year')}
                              className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold"
                            >
                              <option value="month">{periods === 1 ? 'month' : 'months'}</option>
                              <option value="year">{periods === 1 ? 'year' : 'years'}</option>
                            </select>
                            <span className="text-slate-500">— counted on from {dateOf(part.paidUntil ?? part.trialEndsAt ?? part.installedAt)}, its own renewal date.</span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-700">Paid up to</span>
                            <input
                              type="date"
                              value={date}
                              onChange={(e) => setDate(e.target.value)}
                              className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold"
                            />
                          </>
                        )}
                        <button
                          onClick={() => save(part)}
                          disabled={busy || (editing!.mode === 'date' && !date)}
                          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold transition flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 font-semibold">
                          Cancel
                        </button>
                        {error && <span className="text-rose-600 font-semibold">{error}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

type KindFilter = 'all' | SubscriptionPartKind;
type StatusFilter = 'attention' | 'expiring' | 'overdue' | 'trial' | 'all';

/**
 * The platform's Renewals page: every part of every business, soonest first, filterable by what
 * it is and where it stands. A business name opens its panel.
 */
export const RenewalsBoard: React.FC<{ onOpenTenant: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [parts, setParts] = useState<SubscriptionPartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // Bumped by Refresh; the list loads whenever it moves.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    posApi.getRenewals()
      .then(rows => { if (!cancelled) { setParts(rows); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load renewals.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const load = () => {
    setLoading(true);
    setRefreshTick(t => t + 1);
  };

  const byKind = parts.filter(p => kind === 'all' || p.kind === kind);
  const matchesStatus = (p: SubscriptionPartRow, s: StatusFilter) =>
    s === 'all' ? true
      : s === 'attention' ? needsAttention(p)
      : s === 'expiring' ? p.status === 'Expiring'
      : s === 'overdue' ? p.status === 'Expired' || p.status === 'PaymentDue'
      : p.status === 'Trial' || (p.status === 'Expiring' && p.inTrial);
  const term = search.trim().toLowerCase();
  const shown = byKind
    .filter(p => matchesStatus(p, status))
    .filter(p => !term || (p.tenantName ?? '').toLowerCase().includes(term) || p.name.toLowerCase().includes(term));

  const kindChips: { key: KindFilter; label: string }[] = [
    { key: 'all', label: 'Everything' },
    { key: 'Erp', label: 'ERP' },
    { key: 'Pos', label: 'POS' },
    { key: 'Tablet', label: 'Tablets' },
    { key: 'AddOn', label: 'Add-ons' }
  ];
  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'attention', label: 'Needs attention' },
    { key: 'expiring', label: 'Renewing in 14 days' },
    { key: 'overdue', label: 'Expired / unpaid' },
    { key: 'trial', label: 'On trial' }
  ];
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${active ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {kindChips.map(c => (
          <button key={c.key} onClick={() => setKind(c.key)} className={chip(kind === c.key)}>
            {c.label}
            <span className="ml-1.5 opacity-70">{c.key === 'all' ? parts.length : parts.filter(p => p.kind === c.key).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {statusChips.map(c => (
          <button key={c.key} onClick={() => setStatus(c.key)} className={chip(status === c.key)}>
            {c.label}
            <span className="ml-1.5 opacity-70">{byKind.filter(p => matchesStatus(p, c.key)).length}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business or outlet…"
            className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs w-56 focus:outline-none focus:border-teal-500"
          />
        </div>
        <button onClick={load} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && parts.length === 0 ? (
          <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 text-slate-400 animate-spin" /></div>
        ) : (
          <SubscriptionPartsTable
            parts={shown}
            showTenant
            onOpenTenant={onOpenTenant}
            canManage
            onChanged={(updated) => setParts(prev => prev.map(p => (p.id === updated.id ? updated : p)))}
            emptyText={parts.length === 0 ? 'No businesses have anything to renew yet.' : 'Nothing matches these filters.'}
          />
        )}
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5" />
        Each part renews from its own installation date: the ERP from registration, an outlet's POS from its first till,
        an extra tablet from its activation. Anything installed during the free trial is covered until the trial ends.
      </p>
    </div>
  );
};

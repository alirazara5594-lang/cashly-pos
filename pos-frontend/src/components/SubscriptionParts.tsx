import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, Server, Store, Tablet, Puzzle, CheckCircle2, CalendarDays, MessageCircle, Receipt, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { KIND_LABEL, daysText, needsAttention, isOverdue, pkr, dateOf, whatsAppNumber, PAYMENT_METHODS } from '../utils/renewals';
import type { SubscriptionPartRow, SubscriptionPartKind } from '../types';

/**
 * Renewals per part. A business pays for several things — the head office's ERP, each outlet's
 * POS, each tablet beyond what an outlet's POS includes, and add-ons — and each renews on its own
 * date, counted from when it was installed. Money is recorded against an invoice, which moves the
 * part on; a part left unpaid can be stopped on its own.
 */

const KIND_ICON: Record<SubscriptionPartKind, React.FC<{ className?: string }>> = {
  Erp: Server,
  Pos: Store,
  Tablet: Tablet,
  AddOn: Puzzle
};

export const PartStatusBadge: React.FC<{ part: SubscriptionPartRow }> = ({ part }) => {
  const look: Record<SubscriptionPartRow['status'], { label: string; cls: string }> = {
    NotInstalled: { label: 'No till yet', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    Trial: { label: 'Free trial', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    Active: { label: 'Paid', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
    Expiring: { label: part.inTrial ? 'Trial ending' : 'Renewing soon', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    PaymentDue: { label: 'Payment due', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    Expired: { label: 'Expired', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    Stopped: { label: 'Stopped — unpaid', cls: 'bg-rose-600 text-white border-rose-600' },
    Ended: { label: 'Not in use', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  };
  const { label, cls } = look[part.status];
  return <span className={`inline-flex px-2 py-0.5 rounded-lg border text-[10px] font-bold whitespace-nowrap ${cls}`}>{label}</span>;
};

type EditMode = 'payment' | 'invoice' | 'date' | 'stop' | 'more';

interface SubscriptionPartsTableProps {
  parts: SubscriptionPartRow[];
  /** Show which business each part belongs to (the platform-wide list). */
  showTenant?: boolean;
  onOpenTenant?: (tenantId: string) => void;
  /** The platform admin records payments, raises invoices, sets dates and stops parts. */
  canManage?: boolean;
  /** The business's owner may ask for an invoice to renew a part. */
  canRenew?: boolean;
  /** Something changed: the caller reloads. */
  onChanged?: () => void;
  emptyText?: string;
}

const inputCls = 'px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-teal-500';

export const SubscriptionPartsTable: React.FC<SubscriptionPartsTableProps> = ({
  parts, showTenant, onOpenTenant, canManage, canRenew, onChanged, emptyText
}) => {
  // One row at a time opens a form under it.
  const [editing, setEditing] = useState<{ id: string; mode: EditMode } | null>(null);
  const [annual, setAnnual] = useState(false);
  const [periods, setPeriods] = useState(1);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Bank Transfer');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (part: SubscriptionPartRow, mode: EditMode) => {
    setEditing(editing?.id === part.id && editing.mode === mode ? null : { id: part.id, mode });
    setAnnual(part.annual);
    setPeriods(1);
    setAmount('');
    setMethod('Bank Transfer');
    setReference('');
    setReceivedOn(new Date().toLocaleDateString('en-CA'));
    setDate((part.renewsAt ?? new Date().toISOString()).slice(0, 10));
    setReason('');
    setError(null);
    setNotice(null);
  };

  const priceFor = (part: SubscriptionPartRow) =>
    (annual ? part.yearlyPricePKR ?? (part.annual ? part.pricePKR : part.pricePKR * 10) : part.monthlyPricePKR ?? (part.annual ? part.pricePKR / 12 : part.pricePKR)) * periods;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      setNotice(done);
      onChanged?.();
    } catch (err) {
      setError(getApiErrorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const save = (part: SubscriptionPartRow) => {
    if (!editing) return;
    if (editing.mode === 'payment') {
      return run(() => posApi.recordSubscriptionPartPayment(part.id, {
        periods, annual,
        amountPKR: amount ? Number(amount) : undefined,
        method, reference: reference.trim() || undefined,
        receivedAt: receivedOn ? `${receivedOn}T12:00:00Z` : undefined
      }), `Payment recorded for ${part.name}.`);
    }
    if (editing.mode === 'invoice') {
      return run(() => posApi.invoiceSubscriptionPart(part.id, { periods, annual }), `Invoice raised for ${part.name}. Find it on Billing.`);
    }
    if (editing.mode === 'date') {
      return run(() => posApi.setSubscriptionPartPaidUntil(part.id, `${date}T00:00:00Z`, reason.trim() || undefined), `${part.name} is now covered to ${dateOf(date)}.`);
    }
    if (editing.mode === 'stop') {
      const stopping = !part.stoppedAt;
      return run(() => posApi.setSubscriptionPartStopped(part.id, stopping, reason.trim()),
        stopping ? `${part.name} is stopped. Only this part stops.` : `${part.name} is running again.`);
    }
  };

  const renew = async (part: SubscriptionPartRow) => {
    setBusy(true);
    setError(null);
    try {
      const invoice = await posApi.renewMyPart(part.id);
      setNotice(`Invoice ${invoice.invoiceNumber} for ${pkr(invoice.amountPKR)} is ready below, with how to pay.`);
      onChanged?.();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not prepare the invoice.'));
    } finally {
      setBusy(false);
    }
  };

  if (parts.length === 0) {
    return <div className="py-10 text-center text-xs text-slate-500">{emptyText ?? 'Nothing here.'}</div>;
  }

  const columns = 5 + (showTenant ? 1 : 0) + (canManage || canRenew ? 1 : 0);
  const smallBtn = 'px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition whitespace-nowrap';

  return (
    <div className="overflow-x-auto">
      {(notice || (error && !editing)) && (
        <div className={`mx-4 mt-3 px-3 py-2 rounded-xl text-xs font-semibold border ${notice ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {notice ?? error}
        </div>
      )}
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
            {showTenant && <th className="py-3 px-4">Business</th>}
            <th className="py-3 px-4">What</th>
            <th className="py-3 px-4">Installed</th>
            <th className="py-3 px-4">Renews</th>
            <th className="py-3 px-4">Status</th>
            <th className="py-3 px-4 text-right">Price</th>
            {(canManage || canRenew) && <th className="py-3 px-4 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {parts.map(part => {
            const Icon = KIND_ICON[part.kind];
            const isEditing = editing?.id === part.id;
            const canAct = part.isActive && part.status !== 'NotInstalled';
            const phone = whatsAppNumber(part.tenantPhone);
            const reminder = `Assalam o Alaikum${part.tenantName ? ` ${part.tenantName} team` : ''}, this is Cashly. ${part.name} `
              + (isOverdue(part) ? `was due on ${dateOf(part.renewsAt)}` : `renews on ${dateOf(part.renewsAt)}`)
              + ` (${pkr(part.pricePKR)} / ${part.annual ? 'year' : 'month'})${part.openInvoiceNumber ? `, invoice ${part.openInvoiceNumber}` : ''}. Please arrange the payment. Thank you!`;
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
                    {part.openInvoiceNumber && (
                      <div className="mt-0.5 text-[10px] text-amber-700 font-semibold flex items-center gap-1">
                        <Receipt className="w-3 h-3" /> On {part.openInvoiceNumber}, not paid yet
                      </div>
                    )}
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
                    {part.pricePKR > 0 ? `${pkr(part.pricePKR)} / ${part.annual ? 'year' : 'month'}` : '—'}
                  </td>
                  {(canManage || canRenew) && (
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canAct && canManage && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => open(part, 'payment')} className={`${smallBtn} bg-teal-500 hover:bg-teal-600 text-white`}>
                            Record payment
                          </button>
                          {!part.openInvoiceId && (
                            <button onClick={() => open(part, 'invoice')} className={`${smallBtn} bg-slate-100 hover:bg-slate-200 text-slate-700`}
                              title="Raise an invoice for its next period">
                              Invoice
                            </button>
                          )}
                          <button onClick={() => open(part, 'more')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="More">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      {canAct && canRenew && !canManage && part.pricePKR > 0 && (needsAttention(part) || part.status === 'Trial') && (
                        part.openInvoiceNumber
                          ? <span className="text-[10px] font-bold text-amber-700">Pay {part.openInvoiceNumber} below</span>
                          : (
                            <button disabled={busy} onClick={() => renew(part)} className={`${smallBtn} bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white`}>
                              Renew
                            </button>
                          )
                      )}
                    </td>
                  )}
                </tr>
                {isEditing && (
                  <tr className="bg-teal-50/40">
                    <td colSpan={columns} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {editing!.mode === 'more' && (
                          <>
                            <button onClick={() => open(part, 'date')} className={`${smallBtn} bg-white border border-slate-200 text-slate-700`}>
                              <CalendarDays className="w-3 h-3 inline mr-1" />Set covered-to date (no payment)
                            </button>
                            <button onClick={() => open(part, 'stop')} className={`${smallBtn} bg-white border ${part.stoppedAt ? 'border-teal-200 text-teal-700' : 'border-rose-200 text-rose-600'}`}>
                              {part.stoppedAt ? <><PlayCircle className="w-3 h-3 inline mr-1" />Let it run again</> : <><PauseCircle className="w-3 h-3 inline mr-1" />Stop this part now</>}
                            </button>
                            {phone ? (
                              <a href={`https://wa.me/${phone}?text=${encodeURIComponent(reminder)}`} target="_blank" rel="noopener noreferrer"
                                className={`${smallBtn} bg-white border border-teal-200 text-teal-700 inline-flex items-center gap-1`}>
                                <MessageCircle className="w-3 h-3" /> WhatsApp reminder
                              </a>
                            ) : (
                              <span className="text-[10px] text-slate-400">No mobile number on file for a WhatsApp reminder.</span>
                            )}
                            <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 font-semibold">Close</button>
                          </>
                        )}

                        {(editing!.mode === 'payment' || editing!.mode === 'invoice') && (
                          <>
                            {part.openInvoiceNumber && editing!.mode === 'payment' ? (
                              <span className="font-semibold text-slate-700">Money received against {part.openInvoiceNumber}</span>
                            ) : (
                              <>
                                <span className="font-semibold text-slate-700">{editing!.mode === 'payment' ? 'Payment for' : 'Invoice for'}</span>
                                <input type="number" min={1} max={36} value={periods}
                                  onChange={(e) => setPeriods(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
                                  className={`${inputCls} w-16 text-center font-bold`} />
                                <select value={annual ? 'year' : 'month'} onChange={(e) => setAnnual(e.target.value === 'year')} className={`${inputCls} font-semibold`}>
                                  <option value="month">{periods === 1 ? 'month' : 'months'}</option>
                                  <option value="year">{periods === 1 ? 'year' : 'years'}</option>
                                </select>
                                <span className="text-slate-500">from {dateOf(part.renewsAt ?? part.installedAt)} — list price {pkr(priceFor(part))}</span>
                              </>
                            )}
                            {editing!.mode === 'payment' && (
                              <>
                                <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)}
                                  placeholder={part.openInvoiceNumber ? 'Amount (blank = what it owes)' : 'Amount (blank = full price)'}
                                  className={`${inputCls} w-44`} />
                                <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / receipt no." className={`${inputCls} w-44`} />
                                <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={inputCls} title="Date received" />
                              </>
                            )}
                          </>
                        )}

                        {editing!.mode === 'date' && (
                          <>
                            <span className="font-semibold text-slate-700">Covered up to</span>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} font-semibold`} />
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (a correction, a free month…)" className={`${inputCls} w-64`} />
                            <span className="text-[10px] text-slate-500">No money is recorded.</span>
                          </>
                        )}

                        {editing!.mode === 'stop' && (
                          <>
                            <span className="font-semibold text-slate-700">{part.stoppedAt ? 'Let it run again before it is paid?' : 'Stop only this part now?'}</span>
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (recorded)" className={`${inputCls} w-64`} />
                          </>
                        )}

                        {editing!.mode !== 'more' && (
                          <>
                            <button
                              onClick={() => save(part)}
                              disabled={busy || (editing!.mode === 'date' && !date) || (editing!.mode === 'stop' && !reason.trim())}
                              className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold transition flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {busy ? 'Saving…' : editing!.mode === 'payment' ? 'Record payment' : editing!.mode === 'invoice' ? 'Raise invoice' : 'Save'}
                            </button>
                            <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 font-semibold">
                              Cancel
                            </button>
                          </>
                        )}
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
type StatusFilter = 'attention' | 'expiring' | 'overdue' | 'stopped' | 'trial' | 'invoiced' | 'all';

/**
 * The platform's Renewals page: every part of every business, soonest first, filterable by what
 * it is and where it stands. A business name opens its panel.
 */
export const RenewalsBoard: React.FC<{ onOpenTenant: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [parts, setParts] = useState<SubscriptionPartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('attention');
  const [search, setSearch] = useState('');
  // Bumped by Refresh (and after any change); the list loads whenever it moves.
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
      : s === 'stopped' ? p.status === 'Stopped'
      : s === 'invoiced' ? !!p.openInvoiceId
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
    { key: 'attention', label: 'Needs attention' },
    { key: 'expiring', label: 'Renewing in 14 days' },
    { key: 'overdue', label: 'Expired / unpaid' },
    { key: 'stopped', label: 'Stopped' },
    { key: 'invoiced', label: 'Invoiced, not paid' },
    { key: 'trial', label: 'On trial' },
    { key: 'all', label: 'All' }
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
            onChanged={load}
            emptyText={parts.length === 0 ? 'No businesses have anything to renew yet.' : 'Nothing matches these filters.'}
          />
        )}
      </div>
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5" />
        Each part renews from its own installation date: the ERP from registration, an outlet's POS from its first till,
        an extra tablet from its activation. Recording a payment raises (or uses) its invoice, so every rupee is on record.
      </p>
    </div>
  );
};

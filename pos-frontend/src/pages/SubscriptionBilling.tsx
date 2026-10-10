import React, { useState, useEffect, useMemo } from 'react';
import { Plus, RefreshCw, Search, Zap, Receipt, Wallet } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { BillingSummaryCards, IssueInvoiceModal, InvoiceDrawer, InvoiceStatusBadge } from '../components/PlatformBilling';
import { dateOf, pkr } from '../utils/renewals';
import type { AutomationReport, BillingSummary, SubscriptionInvoice, SubscriptionPaymentRow } from '../types';

type StatusFilter = 'open' | 'Overdue' | 'PartiallyPaid' | 'Paid' | 'Cancelled' | 'all';

/**
 * Cashly's billing: what every business owes and has paid. Invoices are raised per renewal (by
 * themselves, or here), payments are recorded one by one with how and a reference, and the money
 * cards add it all up.
 */
export const SubscriptionBilling: React.FC<{ onOpenTenant?: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [payments, setPayments] = useState<SubscriptionPaymentRow[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [report, setReport] = useState<AutomationReport | null>(null);
  const [running, setRunning] = useState(false);
  // Bumped after any change; everything reloads when it moves.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      posApi.getSubscriptionInvoices(),
      posApi.getSubscriptionPayments({ take: 500 }),
      posApi.getBillingSummary()
    ])
      .then(([inv, pay, sum]) => {
        if (cancelled) return;
        setInvoices(inv);
        setPayments(pay);
        setSummary(sum);
        setError(null);
      })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load billing.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = () => { setLoading(true); setTick(t => t + 1); };

  const runNow = async () => {
    setRunning(true);
    setReport(null);
    try {
      setReport(await posApi.runBillingAutomation());
      reload();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not run the billing automation.'));
    } finally {
      setRunning(false);
    }
  };

  const term = search.trim().toLowerCase();
  const shownInvoices = useMemo(() => invoices.filter(i => {
    const statusOk = status === 'all' ? true
      : status === 'open' ? ['Pending', 'Overdue', 'PartiallyPaid'].includes(i.status)
      : i.status === status;
    const searchOk = !term || i.invoiceNumber.toLowerCase().includes(term) || (i.tenantName ?? '').toLowerCase().includes(term) || i.tier.toLowerCase().includes(term);
    return statusOk && searchOk;
  }), [invoices, status, term]);
  const shownPayments = useMemo(() => payments.filter(p =>
    !term || (p.tenantName ?? '').toLowerCase().includes(term) || (p.invoiceNumber ?? '').toLowerCase().includes(term) || (p.reference ?? '').toLowerCase().includes(term)
  ), [payments, term]);

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: 'open', label: 'Not paid' },
    { key: 'Overdue', label: 'Overdue' },
    { key: 'PartiallyPaid', label: 'Part paid' },
    { key: 'Paid', label: 'Paid' },
    { key: 'Cancelled', label: 'Cancelled' },
    { key: 'all', label: 'All' }
  ];
  const countFor = (s: StatusFilter) => invoices.filter(i =>
    s === 'all' ? true : s === 'open' ? ['Pending', 'Overdue', 'PartiallyPaid'].includes(i.status) : i.status === s).length;
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-[11px] font-bold transition ${active ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`;

  return (
    <div className="space-y-4">
      <BillingSummaryCards summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          <button onClick={() => setTab('invoices')} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${tab === 'invoices' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
            <Receipt className="w-3.5 h-3.5" /> Invoices
          </button>
          <button onClick={() => setTab('payments')} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${tab === 'payments' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
            <Wallet className="w-3.5 h-3.5" /> Payments
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'invoices' ? 'Invoice no., business, part…' : 'Business, invoice, reference…'}
            className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-56 focus:outline-none focus:border-teal-500" />
        </div>
        <button onClick={reload} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={runNow} disabled={running}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold disabled:opacity-40"
            title="Raise invoices that are due, mark overdue ones, send reminders and stop unpaid parts — as set in Settings. It also runs by itself every hour.">
            <Zap className={`w-3.5 h-3.5 text-amber-500 ${running ? 'animate-pulse' : ''}`} /> {running ? 'Running…' : 'Run renewals now'}
          </button>
          <button onClick={() => setIssuing(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-md shadow-teal-500/20">
            <Plus className="w-3.5 h-3.5" /> New invoice
          </button>
        </div>
      </div>

      {report && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <strong>Renewals run:</strong> {report.invoicesRaised} invoice(s) raised, {report.markedOverdue} marked overdue,
          {' '}{report.remindersSent} reminder(s) sent, {report.partsStopped} part(s) stopped.
          {report.notes.map(n => <div key={n} className="text-[11px] mt-0.5">{n}</div>)}
        </div>
      )}
      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      {tab === 'invoices' && (
        <>
          <div className="flex flex-wrap gap-2">
            {statusChips.map(c => (
              <button key={c.key} onClick={() => setStatus(c.key)} className={chip(status === c.key)}>
                {c.label}<span className="ml-1.5 opacity-70">{countFor(c.key)}</span>
              </button>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Invoice</th>
                    <th className="px-4 py-2.5">Business</th>
                    <th className="px-4 py-2.5">For</th>
                    <th className="px-4 py-2.5">Due</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                    <th className="px-4 py-2.5 text-right">Balance</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && invoices.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
                  ) : shownInvoices.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      {invoices.length === 0 ? 'No invoices yet. They are raised by themselves before each renewal, or press New invoice.' : 'No invoices match.'}
                    </td></tr>
                  ) : shownInvoices.map(i => (
                    <tr key={i.id} onClick={() => setOpenInvoiceId(i.id)} className="hover:bg-slate-50 cursor-pointer transition">
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900">{i.invoiceNumber}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={(e) => { e.stopPropagation(); onOpenTenant?.(i.tenantId); }} className="font-bold text-slate-800 hover:text-teal-700 text-left">
                          {i.tenantName ?? '—'}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-[16rem] truncate">{i.tier}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${i.status === 'Overdue' ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>{dateOf(i.dueAt)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold">{pkr(i.amountPKR)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{i.status === 'Cancelled' ? '—' : pkr(i.balancePKR ?? 0)}</td>
                      <td className="px-4 py-2.5"><InvoiceStatusBadge status={i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'payments' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Received</th>
                  <th className="px-4 py-2.5">Business</th>
                  <th className="px-4 py-2.5">Invoice</th>
                  <th className="px-4 py-2.5">How</th>
                  <th className="px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownPayments.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No payments recorded yet.</td></tr>
                ) : shownPayments.map(p => (
                  <tr key={p.id} className={`${p.voidedAt ? 'opacity-50 line-through' : ''} hover:bg-slate-50`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{dateOf(p.receivedAt)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">{p.tenantName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {p.invoiceId ? (
                        <button onClick={() => setOpenInvoiceId(p.invoiceId!)} className="font-mono text-teal-700 hover:underline">{p.invoiceNumber}</button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">{p.kind === 'Refund' ? <span className="text-amber-700 font-bold">Refund · </span> : null}{p.method}</td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono">{p.reference ?? '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${p.kind === 'Refund' ? 'text-amber-700' : 'text-teal-700'}`}>
                      {p.kind === 'Refund' ? '−' : ''}{pkr(p.amountPKR)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{p.recordedByName}{p.voidedAt ? ` · taken back: ${p.voidReason}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {issuing && (
        <IssueInvoiceModal
          onClose={() => setIssuing(false)}
          onIssued={(invoice) => { setIssuing(false); reload(); setOpenInvoiceId(invoice.id); }}
        />
      )}
      {openInvoiceId && (
        <InvoiceDrawer
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={reload}
          onOpenTenant={onOpenTenant ? (id) => { setOpenInvoiceId(null); onOpenTenant(id); } : undefined}
        />
      )}
    </div>
  );
};

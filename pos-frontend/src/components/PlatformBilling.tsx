import React, { useEffect, useMemo, useState } from 'react';
import { X, Receipt, Printer, Send, Ban, RefreshCw, CheckCircle2, Undo2, Wallet, AlertTriangle, MessageCircle, Search } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import {
  INVOICE_STATUS, KIND_LABEL, PAYMENT_METHODS, dateOf, invoiceLines, needsAttention, pkr, whatsAppNumber
} from '../utils/renewals';
import type {
  AdminTenantRow, BillingDetails, BillingSummary, SubscriptionInvoice, SubscriptionInvoiceDetail, SubscriptionPartRow
} from '../types';

// ============================================================
// Cashly's own billing, shared by the Billing page, a business's panel and the customer's own
// Plan page: money cards, raising an invoice from a business's parts, one invoice with its
// payments, and the printable invoice itself.
// ============================================================

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';

export const InvoiceStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const look = INVOICE_STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-flex px-2 py-0.5 rounded-lg border text-[10px] font-bold whitespace-nowrap ${look.cls}`}>{look.label}</span>;
};

/** Owed, overdue, and money in this month and last. */
export const BillingSummaryCards: React.FC<{ summary: BillingSummary | null }> = ({ summary }) => {
  const cards = [
    { label: 'Owed to you', value: summary ? pkr(summary.owedPKR) : '…', sub: summary ? `${summary.openCount} open invoice${summary.openCount === 1 ? '' : 's'}` : '', tone: 'text-slate-900' },
    { label: 'Overdue', value: summary ? pkr(summary.overduePKR) : '…', sub: summary ? `${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}` : '', tone: summary && summary.overduePKR > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Collected this month', value: summary ? pkr(summary.collectedThisMonthPKR) : '…', sub: 'after refunds', tone: 'text-teal-700' },
    { label: 'Collected last month', value: summary ? pkr(summary.collectedLastMonthPKR) : '…', sub: '', tone: 'text-slate-700' }
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
          <div className={`text-xl font-black mt-1 ${c.tone}`}>{c.value}</div>
          {c.sub && <div className="text-[10px] text-slate-400 mt-0.5">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
};

interface PickedPart { periods: number; annual: boolean }

/**
 * Raise an invoice: pick the business (unless it is given), tick the parts it is for — each from
 * the end of what it already covers — and, if a different price was agreed, type it.
 */
export const IssueInvoiceModal: React.FC<{
  tenantId?: string;
  tenantName?: string;
  onClose: () => void;
  onIssued: (invoice: SubscriptionInvoice) => void;
}> = ({ tenantId: fixedTenantId, tenantName: fixedTenantName, onClose, onIssued }) => {
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantId, setTenantId] = useState(fixedTenantId ?? '');
  const [parts, setParts] = useState<SubscriptionPartRow[] | null>(null);
  const [picked, setPicked] = useState<Record<string, PickedPart>>({});
  const [agreed, setAgreed] = useState('');
  const [notes, setNotes] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState('Sales tax');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fixedTenantId) return;
    let cancelled = false;
    posApi.getAdminTenants().then(rows => { if (!cancelled) setTenants(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fixedTenantId]);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformSettings()
      .then(res => { if (!cancelled) { setTaxRate(res.settings.taxRatePercent); setTaxLabel(res.settings.taxLabel); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    posApi.getTenantSubscriptionParts(tenantId)
      .then(rows => {
        if (cancelled) return;
        const billable = rows.filter(p => p.isActive && p.status !== 'NotInstalled' && p.pricePKR > 0);
        setParts(billable);
        // What is due or renewing soon and not already on an unpaid invoice starts ticked.
        const start: Record<string, PickedPart> = {};
        for (const p of billable) if (!p.openInvoiceId && needsAttention(p)) start[p.id] = { periods: 1, annual: p.annual };
        setPicked(start);
      })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load this business\'s parts.')); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const unitFor = (p: SubscriptionPartRow, annual: boolean) =>
    annual ? p.yearlyPricePKR ?? (p.annual ? p.pricePKR : p.pricePKR * 10) : p.monthlyPricePKR ?? (p.annual ? p.pricePKR / 12 : p.pricePKR);
  const listTotal = (parts ?? []).filter(p => picked[p.id]).reduce((sum, p) => sum + unitFor(p, picked[p.id].annual) * picked[p.id].periods, 0);
  const subtotal = agreed ? Number(agreed) || 0 : listTotal;
  const tax = taxRate > 0 ? Math.round(subtotal * taxRate / 100) : 0;
  const pickedCount = Object.keys(picked).length;

  const choose = (id: string) => {
    setTenantId(id);
    setParts(null);
    setPicked({});
    setError(null);
  };

  const issue = async () => {
    if (!tenantId || pickedCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await posApi.issueSubscriptionInvoice({
        tenantId,
        amountPKR: agreed ? Number(agreed) : undefined,
        notes: notes.trim() || undefined,
        parts: Object.entries(picked).map(([partId, p]) => ({ partId, periods: p.periods, annual: p.annual }))
      });
      onIssued(invoice);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not raise the invoice.'));
    } finally {
      setBusy(false);
    }
  };

  const term = tenantSearch.trim().toLowerCase();
  const tenantMatches = tenants.filter(t => !term || t.name.toLowerCase().includes(term) || t.slug.toLowerCase().includes(term)).slice(0, 8);
  const chosenName = fixedTenantName ?? tenants.find(t => t.id === tenantId)?.name;

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between z-10">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-teal-600" /> New invoice{chosenName ? ` — ${chosenName}` : ''}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!fixedTenantId && (
            <div>
              <label className={labelCls}>Business</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} placeholder="Type a business name…" className={`${inputCls} pl-8`} />
              </div>
              {(term || !tenantId) && (
                <div className="mt-1.5 space-y-1">
                  {tenantMatches.map(t => (
                    <button key={t.id} onClick={() => { choose(t.id); setTenantSearch(''); }}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition ${t.id === tenantId ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <span className="font-bold text-slate-800">{t.name}</span>
                      <span className="ml-2 text-slate-400">{t.city ?? ''}</span>
                    </button>
                  ))}
                  {tenantMatches.length === 0 && <p className="text-[11px] text-slate-400">No business matches.</p>}
                </div>
              )}
            </div>
          )}

          {tenantId && parts === null && !error && (
            <div className="flex items-center justify-center py-8"><RefreshCw className="w-5 h-5 text-slate-400 animate-spin" /></div>
          )}

          {parts && (
            <div className="space-y-1.5">
              <label className={labelCls}>What this invoice is for</label>
              {parts.length === 0 && <p className="text-xs text-slate-500">Nothing billable on this business yet (no till connected, or nothing priced).</p>}
              {parts.map(p => {
                const choice = picked[p.id];
                const blocked = !!p.openInvoiceId;
                return (
                  <div key={p.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border ${choice ? 'border-teal-300 bg-teal-50/50' : 'border-slate-200'} ${blocked ? 'opacity-60' : ''}`}>
                    <input
                      type="checkbox"
                      disabled={blocked}
                      checked={!!choice}
                      onChange={(e) => setPicked(prev => {
                        const next = { ...prev };
                        if (e.target.checked) next[p.id] = { periods: 1, annual: p.annual };
                        else delete next[p.id];
                        return next;
                      })}
                      className="w-4 h-4 accent-teal-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-800">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 mr-1.5">{KIND_LABEL[p.kind]}</span>{p.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {blocked ? `Already on ${p.openInvoiceNumber}` : `Next period from ${dateOf(p.renewsAt ?? p.installedAt)}`}
                      </div>
                    </div>
                    {choice && (
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={1} max={36} value={choice.periods}
                          onChange={(e) => setPicked(prev => ({ ...prev, [p.id]: { ...choice, periods: Math.max(1, Math.min(36, Number(e.target.value) || 1)) } }))}
                          className="w-14 px-2 py-1 border border-slate-200 rounded-lg text-xs text-center font-bold" />
                        <select value={choice.annual ? 'year' : 'month'}
                          onChange={(e) => setPicked(prev => ({ ...prev, [p.id]: { ...choice, annual: e.target.value === 'year' } }))}
                          className="px-2 py-1 border border-slate-200 rounded-lg text-xs">
                          <option value="month">month{choice.periods > 1 ? 's' : ''}</option>
                          <option value="year">year{choice.periods > 1 ? 's' : ''}</option>
                        </select>
                        <span className="text-xs font-mono font-bold text-slate-700 w-24 text-right">{pkr(unitFor(p, choice.annual) * choice.periods)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {parts && parts.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Agreed price before tax (optional)</label>
                  <input type="number" min={0} value={agreed} onChange={(e) => setAgreed(e.target.value)} placeholder={`List: ${pkr(listTotal)}`} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Note on the invoice (optional)</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 10% loyalty discount" className={inputCls} />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span className="font-mono">{pkr(subtotal)}</span></div>
                {tax > 0 && <div className="flex justify-between"><span className="text-slate-600">{taxLabel} {taxRate}%</span><span className="font-mono">{pkr(tax)}</span></div>}
                <div className="flex justify-between pt-1 border-t border-slate-200 font-black text-slate-900"><span>Total</span><span className="font-mono">{pkr(subtotal + tax)}</span></div>
              </div>
            </>
          )}

          {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

          <button
            onClick={issue}
            disabled={busy || !tenantId || pickedCount === 0}
            className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            {busy ? 'Raising…' : `Raise invoice${pickedCount > 0 ? ` for ${pickedCount} item${pickedCount === 1 ? '' : 's'}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

/** The invoice as the customer receives it: who bills, who is billed, what for, and how to pay. */
export const InvoicePrintView: React.FC<{ detail: SubscriptionInvoiceDetail; from: BillingDetails | null }> = ({ detail, from }) => {
  const { invoice, billedTo, payments } = detail;
  const lines = invoiceLines(invoice.linesJson);
  const received = payments.filter(p => !p.voidedAt).reduce((s, p) => s + (p.kind === 'Refund' ? -p.amountPKR : p.amountPKR), 0);
  const balance = Math.max(0, invoice.amountPKR - (invoice.paidPKR ?? received));
  const payLines = from ? [
    from.bankName || from.bankIban || from.bankAccountNumber
      ? `Bank: ${[from.bankName, from.bankAccountTitle].filter(Boolean).join(', ')}${from.bankIban ? ` — IBAN ${from.bankIban}` : from.bankAccountNumber ? ` — Account ${from.bankAccountNumber}` : ''}`
      : null,
    from.jazzCashNumber ? `JazzCash: ${from.jazzCashNumber}` : null,
    from.easypaisaNumber ? `Easypaisa: ${from.easypaisaNumber}` : null,
    from.raastId ? `Raast: ${from.raastId}` : null
  ].filter(Boolean) as string[] : [];

  return (
    <div className="print-area bg-white p-6 sm:p-8 space-y-6 text-slate-900">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{from?.companyName ?? 'Cashly'}</h1>
          {from?.legalName && <p className="text-xs text-slate-600">{from.legalName}</p>}
          {(from?.address || from?.city) && <p className="text-[11px] text-slate-500">{[from?.address, from?.city].filter(Boolean).join(', ')}</p>}
          {(from?.phone || from?.email) && <p className="text-[11px] text-slate-500">{[from?.phone, from?.email].filter(Boolean).join(' · ')}</p>}
          {(from?.ntn || from?.strn) && (
            <p className="text-[11px] text-slate-500">{[from?.ntn ? `NTN ${from.ntn}` : null, from?.strn ? `STRN ${from.strn}` : null].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase text-slate-400">{invoice.taxPKR ? 'Tax invoice' : 'Invoice'}</div>
          <div className="text-lg font-mono font-black">{invoice.invoiceNumber}</div>
          <div className="mt-1"><InvoiceStatusBadge status={invoice.status} /></div>
          <div className="text-[11px] text-slate-500 mt-1">Issued {dateOf(invoice.issuedAt)}</div>
          <div className="text-[11px] text-slate-500">Due {dateOf(invoice.dueAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-400">Billed to</div>
          <div className="font-bold text-sm mt-0.5">{billedTo?.name ?? invoice.tenantName ?? '—'}</div>
          {billedTo?.contactName && <div className="text-slate-600">{billedTo.contactName}</div>}
          {(billedTo?.address || billedTo?.city) && <div className="text-slate-500">{[billedTo?.address, billedTo?.city].filter(Boolean).join(', ')}</div>}
          {(billedTo?.phone || billedTo?.contactEmail) && <div className="text-slate-500">{[billedTo?.phone, billedTo?.contactEmail].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase text-slate-400">Period</div>
          <div className="font-mono mt-0.5">{dateOf(invoice.billingPeriodStart)} – {dateOf(invoice.billingPeriodEnd)}</div>
        </div>
      </div>

      <table className="w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-bold">
          <tr><th className="px-4 py-2 text-left">Description</th><th className="px-4 py-2 text-right">Amount (PKR)</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.filter(l => l.kind !== 'tax').map((l, i) => (
            <tr key={i}>
              <td className="px-4 py-2">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</td>
              <td className="px-4 py-2 text-right font-mono">{Math.round(l.amountPKR).toLocaleString()}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td className="px-4 py-2">Subscription ({invoice.tier})</td><td className="px-4 py-2 text-right font-mono">{Math.round(invoice.amountPKR).toLocaleString()}</td></tr>
          )}
        </tbody>
        <tfoot className="bg-slate-50/70 text-xs">
          {!!invoice.taxPKR && (
            <>
              <tr><td className="px-4 py-1.5 text-right text-slate-600">Subtotal</td><td className="px-4 py-1.5 text-right font-mono">{Math.round(invoice.subtotalPKR ?? 0).toLocaleString()}</td></tr>
              <tr><td className="px-4 py-1.5 text-right text-slate-600">{from?.taxLabel ?? 'Tax'} {invoice.taxRatePercent}%</td><td className="px-4 py-1.5 text-right font-mono">{Math.round(invoice.taxPKR).toLocaleString()}</td></tr>
            </>
          )}
          <tr className="font-black"><td className="px-4 py-2 text-right">Total</td><td className="px-4 py-2 text-right font-mono">{pkr(invoice.amountPKR)}</td></tr>
          {received > 0 && <tr><td className="px-4 py-1.5 text-right text-teal-700">Received</td><td className="px-4 py-1.5 text-right font-mono text-teal-700">{pkr(received)}</td></tr>}
          {invoice.status !== 'Cancelled' && <tr className="font-bold"><td className="px-4 py-2 text-right">Balance due</td><td className="px-4 py-2 text-right font-mono">{pkr(balance)}</td></tr>}
        </tfoot>
      </table>

      {invoice.notes && <p className="text-xs text-slate-600">{invoice.notes}</p>}

      {balance > 0 && invoice.status !== 'Cancelled' && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
          <div className="font-bold">How to pay</div>
          {payLines.length === 0 && !from?.paymentInstructions && <div className="text-slate-500">Contact us for payment details.</div>}
          {payLines.map(l => <div key={l} className="text-slate-700 font-mono">{l}</div>)}
          {from?.paymentInstructions && <div className="text-slate-600 whitespace-pre-line">{from.paymentInstructions}</div>}
          <div className="text-[11px] text-slate-500 pt-1">Please quote <strong>{invoice.invoiceNumber}</strong> with your payment.</div>
        </div>
      )}
      {from?.invoiceFooter && <p className="text-[10px] text-slate-400 text-center whitespace-pre-line">{from.invoiceFooter}</p>}
    </div>
  );
};

/**
 * One invoice with everything about it — record money in (part payments add up), give money back,
 * take back a payment entered by mistake, send it to the customer, print it, or cancel it.
 */
export const InvoiceDrawer: React.FC<{
  invoiceId: string;
  onClose: () => void;
  onChanged?: () => void;
  onOpenTenant?: (tenantId: string) => void;
}> = ({ invoiceId, onClose, onChanged, onOpenTenant }) => {
  const [detail, setDetail] = useState<SubscriptionInvoiceDetail | null>(null);
  const [from, setFrom] = useState<BillingDetails | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'pay' | 'refund' | 'cancel' | 'print' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Bank Transfer');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [notes, setNotes] = useState('');
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    posApi.getSubscriptionInvoice(invoiceId)
      .then(d => { if (!cancelled) { setDetail(d); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load this invoice.')); });
    return () => { cancelled = true; };
  }, [invoiceId, tick]);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformSettings().then(res => { if (!cancelled) setFrom(res.settings); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const reload = () => { setTick(t => t + 1); onChanged?.(); };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      setMode(null);
      setAmount('');
      setReference('');
      setNotes('');
      reload();
    } catch (err) {
      setError(getApiErrorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const invoice = detail?.invoice;
  const balance = invoice ? Math.max(0, invoice.amountPKR - (invoice.paidPKR ?? 0)) : 0;
  const open = invoice && ['Pending', 'Overdue', 'PartiallyPaid'].includes(invoice.status);
  const phone = whatsAppNumber(detail?.billedTo?.phone);
  const waText = invoice ? `Assalam o Alaikum, this is ${from?.companyName ?? 'Cashly'}. Invoice ${invoice.invoiceNumber} for ${pkr(invoice.amountPKR)}`
    + `${balance > 0 && balance < invoice.amountPKR ? ` (${pkr(balance)} still due)` : ''} is due by ${dateOf(invoice.dueAt)}. Thank you!` : '';

  const pickMode = (next: typeof mode) => {
    setMode(mode === next ? null : next);
    setAmount(next === 'pay' ? String(Math.round(balance)) : '');
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 no-print" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between z-10 no-print">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-teal-600" /> {invoice?.invoiceNumber ?? 'Invoice'}
              {invoice && <InvoiceStatusBadge status={invoice.status} />}
            </h2>
            {invoice && (
              <button onClick={() => onOpenTenant?.(invoice.tenantId)} disabled={!onOpenTenant}
                className="text-[11px] text-slate-500 hover:text-teal-700 disabled:hover:text-slate-500">
                {invoice.tenantName ?? detail?.billedTo?.name}
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        {!detail && !error && <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 text-slate-400 animate-spin" /></div>}
        {error && !detail && <p className="p-6 text-sm text-rose-600">{error}</p>}

        {detail && invoice && (
          <div className="p-5 space-y-5">
            {mode === 'print' ? (
              <>
                <div className="flex gap-2 no-print">
                  <button onClick={() => window.print()} className="flex-1 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5">
                    <Printer className="w-3.5 h-3.5" /> Print / save as PDF
                  </button>
                  <button onClick={() => setMode(null)} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold">Back</button>
                </div>
                {!from?.bankIban && !from?.bankAccountNumber && !from?.jazzCashNumber && !from?.easypaisaNumber && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 no-print">
                    Your bank and wallet details are not filled in yet (Platform → Settings), so the invoice cannot say how to pay.
                  </p>
                )}
                <div className="border border-slate-200 rounded-xl overflow-hidden"><InvoicePrintView detail={detail} from={from} /></div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><div className="text-[10px] uppercase font-bold text-slate-500">Total</div><div className="text-sm font-black">{pkr(invoice.amountPKR)}</div></div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><div className="text-[10px] uppercase font-bold text-slate-500">Received</div><div className="text-sm font-black text-teal-700">{pkr(invoice.paidPKR)}</div></div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200"><div className="text-[10px] uppercase font-bold text-slate-500">Balance</div><div className={`text-sm font-black ${balance > 0 && invoice.status === 'Overdue' ? 'text-rose-600' : ''}`}>{pkr(balance)}</div></div>
                </div>
                <div className="text-[11px] text-slate-500">
                  Issued {dateOf(invoice.issuedAt)} · due {dateOf(invoice.dueAt)} · for {dateOf(invoice.billingPeriodStart)} – {dateOf(invoice.billingPeriodEnd)}
                  {invoice.isPurchase && ' · bought by the owner in the app'}
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {invoiceLines(invoice.linesJson).map((l, i) => (
                        <tr key={i}><td className="px-3 py-2 text-slate-700">{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</td><td className="px-3 py-2 text-right font-mono">{Math.round(l.amountPKR).toLocaleString()}</td></tr>
                      ))}
                      {invoiceLines(invoice.linesJson).length === 0 && (
                        <tr><td className="px-3 py-2 text-slate-700">{invoice.tier}</td><td className="px-3 py-2 text-right font-mono">{Math.round(invoice.amountPKR).toLocaleString()}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {invoice.notes && <p className="text-[11px] text-slate-500 whitespace-pre-line">{invoice.notes}</p>}

                <div className="flex flex-wrap gap-2">
                  {open && (
                    <button onClick={() => pickMode('pay')} className="px-3 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" /> Record payment
                    </button>
                  )}
                  <button onClick={() => setMode('print')} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5">
                    <Printer className="w-3.5 h-3.5" /> View / print
                  </button>
                  {open && (
                    <button disabled={busy} onClick={() => act(async () => {
                      const r = await posApi.sendSubscriptionInvoice(invoice.id);
                      if (r.sent === 0) throw new Error('Nothing could be sent — see the message log for why (no WhatsApp line or email set up?).');
                    }, 'Sent to the customer.')}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Send to customer
                    </button>
                  )}
                  {open && phone && (
                    <a href={`https://wa.me/${phone}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-teal-700 text-xs font-bold flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp from my phone
                    </a>
                  )}
                  {(invoice.paidPKR ?? 0) > 0 && (
                    <button onClick={() => pickMode('refund')} className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5">
                      <Undo2 className="w-3.5 h-3.5" /> Refund
                    </button>
                  )}
                  {open && (invoice.paidPKR ?? 0) === 0 && (
                    <button onClick={() => pickMode('cancel')} className="px-3 py-2 rounded-xl hover:bg-rose-50 text-rose-600 text-xs font-bold flex items-center gap-1.5">
                      <Ban className="w-3.5 h-3.5" /> Cancel invoice
                    </button>
                  )}
                </div>

                {(mode === 'pay' || mode === 'refund') && (
                  <div className={`p-4 rounded-xl border space-y-3 ${mode === 'pay' ? 'bg-teal-50/40 border-teal-200' : 'bg-amber-50/40 border-amber-200'}`}>
                    <div className="text-xs font-black text-slate-900">{mode === 'pay' ? 'Money received' : 'Money given back'}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Amount (PKR)</label>
                        <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>How</label>
                        <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Transaction / receipt no.</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the bank or wallet message" className={inputCls} />
                      </div>
                      {mode === 'pay' && (
                        <div>
                          <label className={labelCls}>Received on</label>
                          <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={inputCls} />
                        </div>
                      )}
                      <div className="col-span-2">
                        <label className={labelCls}>Note (optional)</label>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    {mode === 'pay' && Number(amount) > 0 && Number(amount) < balance && (
                      <p className="text-[11px] text-sky-700">A part payment: {pkr(balance - Number(amount))} will still be due.</p>
                    )}
                    {mode === 'refund' && <p className="text-[11px] text-amber-700">A refund is recorded as money out. It does not take back what was paid for — use "Set date" on the part for that.</p>}
                    <button
                      disabled={busy || !(Number(amount) > 0)}
                      onClick={() => act(
                        () => mode === 'pay'
                          ? posApi.recordSubscriptionPayment(invoice.id, { amountPKR: Number(amount), method, reference: reference.trim() || undefined, receivedAt: `${receivedOn}T12:00:00Z`, notes: notes.trim() || undefined })
                          : posApi.recordSubscriptionRefund(invoice.id, { amountPKR: Number(amount), method, reference: reference.trim() || undefined, notes: notes.trim() || undefined }),
                        mode === 'pay' ? 'Payment recorded.' : 'Refund recorded.')}
                      className="w-full py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> {busy ? 'Saving…' : mode === 'pay' ? 'Record payment' : 'Record refund'}
                    </button>
                  </div>
                )}

                {mode === 'cancel' && (
                  <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 space-y-2">
                    <div className="text-xs font-black text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Cancel {invoice.invoiceNumber}?</div>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why (recorded)" className={inputCls} />
                    <button disabled={busy} onClick={() => act(() => posApi.cancelSubscriptionInvoice(invoice.id, notes.trim() || undefined), 'Invoice cancelled.')}
                      className="w-full py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold">
                      Yes, cancel it
                    </button>
                  </div>
                )}

                {message && <div className="px-3 py-2 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold">{message}</div>}
                {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Money on this invoice</div>
                  {detail.payments.length === 0 && <p className="text-[11px] text-slate-500">Nothing received yet.</p>}
                  {detail.payments.map(p => (
                    <div key={p.id} className={`px-3 py-2 rounded-lg border text-[11px] ${p.voidedAt ? 'bg-slate-50 border-slate-200 opacity-60' : p.kind === 'Refund' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold">{p.kind === 'Refund' ? '−' : ''}{pkr(p.amountPKR)}</span>
                          <span className="text-slate-500"> · {p.method}{p.reference ? ` · ref ${p.reference}` : ''} · {dateOf(p.receivedAt)} · by {p.recordedByName}</span>
                          {p.voidedAt && <span className="text-rose-600 font-semibold"> · taken back: {p.voidReason}</span>}
                        </div>
                        {!p.voidedAt && (
                          <button onClick={() => { setVoidingId(voidingId === p.id ? null : p.id); setVoidReason(''); }} className="text-[10px] font-bold text-slate-400 hover:text-rose-600 shrink-0">
                            Take back
                          </button>
                        )}
                      </div>
                      {voidingId === p.id && (
                        <div className="flex gap-2 mt-2">
                          <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why — e.g. entered twice" className={inputCls} />
                          <button disabled={busy || !voidReason.trim()}
                            onClick={() => act(() => posApi.voidSubscriptionPayment(p.id, voidReason.trim()), 'Payment taken back.').then(() => setVoidingId(null))}
                            className="px-3 rounded-xl bg-rose-600 text-white text-[11px] font-bold disabled:opacity-40">Take back</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {detail.messages && detail.messages.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Sent to the customer</div>
                    {detail.messages.map(m => (
                      <div key={m.id} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600">
                        <span className="font-bold capitalize">{m.channel}</span> · {m.kind} · {new Date(m.createdAt).toLocaleString()} ·{' '}
                        <span className={m.status === 'sent' ? 'text-teal-700 font-bold' : m.status === 'failed' ? 'text-rose-600 font-bold' : 'text-slate-400'}>{m.status}</span>
                        {m.error && <span className="text-slate-400"> — {m.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** A business's invoices as a short list that opens each one — for its panel and its own Plan page. */
export const InvoiceList: React.FC<{
  invoices: SubscriptionInvoice[];
  onOpen: (invoice: SubscriptionInvoice) => void;
  showTenant?: boolean;
  emptyText?: string;
}> = ({ invoices, onOpen, showTenant, emptyText }) => {
  const sorted = useMemo(() => [...invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)), [invoices]);
  if (sorted.length === 0) return <p className="text-[11px] text-slate-500">{emptyText ?? 'No invoices yet.'}</p>;
  return (
    <div className="space-y-1.5">
      {sorted.map(i => (
        <button key={i.id} onClick={() => onOpen(i)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-teal-300 text-left transition">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-800 flex items-center gap-2">
              <span className="font-mono">{i.invoiceNumber}</span>
              <InvoiceStatusBadge status={i.status} />
            </div>
            <div className="text-[10px] text-slate-500 truncate">{showTenant && i.tenantName ? `${i.tenantName} · ` : ''}{i.tier} · due {dateOf(i.dueAt)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-black font-mono">{pkr(i.amountPKR)}</div>
            {(i.balancePKR ?? 0) > 0 && i.status !== 'Cancelled' && <div className="text-[10px] text-rose-600 font-bold">{pkr(i.balancePKR)} due</div>}
          </div>
        </button>
      ))}
    </div>
  );
};

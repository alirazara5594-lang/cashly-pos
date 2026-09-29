import React, { useState, useEffect, useCallback } from 'react';
import { Receipt, Plus, RefreshCw, CheckCircle2, Ban, X, Save, ChevronDown, ChevronRight } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { BillingLine, SubscriptionInvoice } from '../types';

interface Quote {
  annual: boolean;
  lines: BillingLine[];
  totalPKR: number;
}

/** The billed lines stored on an invoice; older invoices have none. */
const invoiceLines = (inv: SubscriptionInvoice): Pick<BillingLine, 'description' | 'quantity' | 'amountPKR'>[] => {
  if (!inv.linesJson) return [];
  try {
    const parsed: unknown = JSON.parse(inv.linesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const LineTable: React.FC<{ lines: Pick<BillingLine, 'description' | 'quantity' | 'amountPKR'>[] }> = ({ lines }) => (
  <table className="w-full text-[11px]">
    <tbody>
      {lines.map((line, idx) => (
        <tr key={idx} className="border-b border-slate-100 last:border-0">
          <td className="py-1 pr-2 text-slate-700">
            {line.description}
            {line.quantity > 1 && <span className="text-slate-400"> × {line.quantity}</span>}
          </td>
          <td className="py-1 text-right font-mono text-slate-900">{Math.round(line.amountPKR).toLocaleString()}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

interface TenantOption {
  id: string;
  name: string;
  tier: string;
}

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Paid: 'bg-teal-50 text-teal-700 border-teal-200',
  Overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  Cancelled: 'bg-slate-100 text-slate-500 border-slate-200'
};

export const SubscriptionBilling: React.FC = () => {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [annual, setAnnual] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // What the invoice will charge, line by line, so the amount is never a surprise.
  const loadQuote = (isAnnual: boolean) => {
    if (!selectedTenantId) return;
    setQuoteError(null);
    posApi.getBillingQuote(selectedTenantId, isAnnual)
      .then(q => setQuote({ annual: q.annual, lines: q.lines, totalPKR: q.totalPKR }))
      .catch(err => setQuoteError(getApiErrorMessage(err, 'Could not work out the charges')));
  };
  const openIssue = () => {
    setQuote(null);
    setIsIssueOpen(true);
    loadQuote(annual);
  };
  // A quote for the other billing period is still in flight when the box is ticked quickly.
  const shownQuote = quote && quote.annual === annual ? quote : null;

  const loadTenants = useCallback(async () => {
    try {
      const data = await posApi.getAdminTenants();
      setTenants(Array.isArray(data) ? data : []);
    } catch {
      setTenants([]);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await posApi.getSubscriptionInvoices(selectedTenantId || undefined);
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load invoices') });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => { loadTenants(); }, [loadTenants]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const handleIssue = async () => {
    if (!selectedTenantId) return;
    setIssuing(true);
    try {
      await posApi.issueSubscriptionInvoice({
        tenantId: selectedTenantId,
        annual,
        amountPKR: customAmount ? Number(customAmount) : undefined
      });
      setIsIssueOpen(false);
      setCustomAmount('');
      setMessage({ type: 'success', text: 'Invoice issued' });
      await loadInvoices();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to issue invoice') });
    } finally {
      setIssuing(false);
    }
  };

  const handleMarkPaid = async (inv: SubscriptionInvoice) => {
    const method = window.prompt('Payment method (e.g. Bank Transfer, JazzCash)', 'Bank Transfer');
    if (method === null) return;
    try {
      await posApi.markSubscriptionInvoicePaid(inv.id, method || undefined);
      setMessage({ type: 'success', text: `${inv.invoiceNumber} marked paid` });
      await loadInvoices();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to mark invoice paid') });
    }
  };

  const handleCancel = async (inv: SubscriptionInvoice) => {
    if (!window.confirm(`Cancel invoice ${inv.invoiceNumber}?`)) return;
    try {
      await posApi.cancelSubscriptionInvoice(inv.id);
      await loadInvoices();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to cancel invoice') });
    }
  };

  const tenantName = (id: string) => tenants.find(t => t.id === id)?.name || id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
          >
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tier})</option>)}
          </select>
          <button
            onClick={loadInvoices}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
        <button
          onClick={openIssue}
          disabled={!selectedTenantId}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Issue Invoice</span>
        </button>
      </div>

      {!selectedTenantId && (
        <p className="text-[11px] text-slate-400">Select a tenant above to issue a new invoice for them.</p>
      )}

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success' ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <span>{message.text}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Invoice #</th>
                {!selectedTenantId && <th className="px-4 py-2.5">Tenant</th>}
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Billing Period</th>
                <th className="px-4 py-2.5 text-right">Amount (PKR)</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">Loading invoices…</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">No invoices yet.</td></tr>
              ) : invoices.map(inv => {
                const lines = invoiceLines(inv);
                const expanded = expandedId === inv.id;
                return (
                <React.Fragment key={inv.id}>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs font-mono font-bold text-slate-900">
                    {lines.length > 0 ? (
                      <button
                        onClick={() => setExpandedId(expanded ? null : inv.id)}
                        className="inline-flex items-center gap-1 hover:text-teal-700"
                        title="Show what this invoice charges"
                      >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {inv.invoiceNumber}
                      </button>
                    ) : inv.invoiceNumber}
                  </td>
                  {!selectedTenantId && <td className="px-4 py-2.5 text-xs text-slate-700">{tenantName(inv.tenantId)}</td>}
                  <td className="px-4 py-2.5 text-[11px] text-slate-500">{inv.tier}</td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-500">
                    {new Date(inv.billingPeriodStart).toLocaleDateString()} – {new Date(inv.billingPeriodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-mono font-bold text-slate-900">{inv.amountPKR.toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${STATUS_COLORS[inv.status] || ''}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {inv.status === 'Pending' && (
                      <>
                        <button onClick={() => handleMarkPaid(inv)} className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-600 hover:text-teal-700 mr-3">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark Paid
                        </button>
                        <button onClick={() => handleCancel(inv)} className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700">
                          <Ban className="w-3.5 h-3.5" /> Cancel
                        </button>
                      </>
                    )}
                    {inv.status === 'Paid' && (
                      <span className="text-[11px] text-slate-400">{inv.paymentMethod || 'Paid'} · {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : ''}</span>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={7} className="px-4 py-2">
                      <div className="max-w-lg"><LineTable lines={lines} /></div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isIssueOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><Receipt className="w-4 h-4 text-teal-600" /> Issue Invoice — {tenantName(selectedTenantId)}</h2>
              <button onClick={() => setIsIssueOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={annual}
                onChange={(e) => { setAnnual(e.target.checked); loadQuote(e.target.checked); }}
                className="w-4 h-4 accent-teal-500"
              />
              <span>Annual billing (default: monthly)</span>
            </label>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">This invoice charges</div>
              {quoteError ? (
                <p className="text-[11px] text-rose-600">{quoteError}</p>
              ) : !shownQuote ? (
                <p className="text-[11px] text-slate-400">Working out the charges…</p>
              ) : shownQuote.lines.length === 0 ? (
                <p className="text-[11px] text-slate-400">Nothing billable on this account.</p>
              ) : (
                <>
                  <LineTable lines={shownQuote.lines} />
                  <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-200">
                    <span className="text-xs font-bold text-slate-700">Total {annual ? 'per year' : 'per month'}</span>
                    <span className="text-sm font-black text-teal-700">PKR {Math.round(shownQuote.totalPKR).toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount override (optional)</label>
              <input type="number" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Leave blank to charge the total above"
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <button
              onClick={handleIssue}
              disabled={issuing}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{issuing ? 'Issuing…' : 'Issue Invoice'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

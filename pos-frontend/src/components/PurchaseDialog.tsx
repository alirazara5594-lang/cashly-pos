import React, { useEffect, useState } from 'react';
import { CreditCard, FileText, Loader2, ArrowRight } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from './ui/dialog';
import { posApi, getApiErrorMessage } from '../services/api';
import type {
  CheckoutRequest, CheckoutQuote, CheckoutResult, PaymentProvider, SubscriptionInvoice
} from '../types';

type Step = 'quote' | 'invoice' | 'pay';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

const asResult = (inv: SubscriptionInvoice): CheckoutResult => ({
  id: inv.id,
  invoiceNumber: inv.invoiceNumber,
  amountPKR: inv.amountPKR,
  status: inv.status,
  dueAt: inv.dueAt,
  billingPeriodEnd: inv.billingPeriodEnd,
  description: inv.notes ?? inv.tier,
  payRequired: true
});

/**
 * The one place a purchase is confirmed, from "what does it cost" through "here is the invoice"
 * to handing the owner to a payment gateway. It is deliberately a single flow rather than three
 * dialogs: the invoice is the point of no return, and the owner should see it before money moves.
 *
 * Pass <c>invoice</c> instead of <c>request</c> to pay one that is already raised — the quote
 * step has nothing to say about an invoice that exists.
 */
export const PurchaseDialog: React.FC<{
  open: boolean;
  request: CheckoutRequest | null;
  invoice?: SubscriptionInvoice | null;
  /** Which gateways this deployment will actually take money from. */
  providers: Array<{ provider: PaymentProvider; isConfigured: boolean }>;
  title: string;
  onClose: () => void;
  /** Raised when the world has changed, so the page behind can reload instead of polling. */
  onChanged: () => void;
}> = ({ open, request, invoice: existing, providers, title, onClose, onChanged }) => {
  const [step, setStep] = useState<Step>('quote');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [invoice, setInvoice] = useState<CheckoutResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);

  // Reset while rendering rather than in an effect: a dialog that opens onto stale state from
  // the last purchase is a bug the owner would see, and this keeps it impossible.
  const resetKey = open
    ? (existing?.id ?? (request ? `${request.kind}:${request.planCode ?? request.addOnKey}:${request.annual ?? false}` : 'empty'))
    : null;
  const [lastResetKey, setLastResetKey] = useState<string | null>(null);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setStep(existing && open ? 'pay' : 'quote');
    setQuote(null);
    setInvoice(open && existing ? asResult(existing) : null);
    setBusy(false);
    setError(null);
    setPayNote(null);
  }

  useEffect(() => {
    if (!open || existing || !request) return;
    let cancelled = false;
    posApi.getSubscriptionQuote(request)
      .then(q => { if (!cancelled) setQuote(q); })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not price that')); });
    return () => { cancelled = true; };
  }, [open, request, existing]);

  const confirm = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const result = await posApi.checkoutSubscription(request);
      setInvoice(result);
      setStep('invoice');
      onChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Purchase could not be raised'));
    } finally {
      setBusy(false);
    }
  };

  const chooseProvider = () => {
    setStep('pay');
    setError(null);
    setPayNote(null);
  };

  const pay = async (provider: PaymentProvider) => {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    setPayNote(null);
    try {
      const res = await posApi.paySubscriptionInvoice(invoice.id, provider);
      onChanged();
      if (res.success) {
        if (res.redirectUrl) {
          window.location.assign(res.redirectUrl);
          return;
        }
        setPayNote(res.instructions
          ?? `Payment started with ${res.provider}. It takes effect when the confirmation arrives.`);
      } else {
        setError(res.message ?? `${provider} could not take this payment.`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Payment could not be started'));
    } finally {
      setBusy(false);
    }
  };

  const ready = !!quote && !!request;
  const configurable = providers.filter(p => p.isConfigured);
  const noneConfigured = providers.length > 0 && configurable.length === 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-white border-slate-200">
        <DialogHeader>
          <DialogTitle className="text-base font-black text-slate-900">{title}</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            {step === 'quote' && 'Check the price before anything is charged.'}
            {step === 'invoice' && 'This invoice is raised but unpaid — nothing has changed yet.'}
            {step === 'pay' && 'Payment is taken by the gateway. Your plan changes once it confirms.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">
            {error}
          </div>
        )}

        {step === 'quote' && (
          <div className="space-y-3">
            {!quote && !error && (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Pricing…
              </div>
            )}
            {quote && (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">{quote.description}</p>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-slate-500">{quote.kind === 'plan' ? 'Plan' : 'Add-on'}{quote.quantity > 1 ? ` × ${quote.quantity}` : ''}</span>
                    <span className="font-mono text-slate-700">{pkr(quote.unitPricePKR)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-slate-50">
                    <span className="font-bold text-slate-700">{request?.annual ? 'Per year' : 'Per month'}</span>
                    <span className="font-black text-teal-700 text-sm">{pkr(quote.totalPKR)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Billed as an invoice. Your current plan stays exactly as it is until that invoice is paid.
                </p>
              </>
            )}
          </div>
        )}

        {step === 'invoice' && invoice && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-teal-50 border border-teal-200">
              <FileText className="w-4 h-4 text-teal-600 mt-0.5" />
              <div className="text-xs text-teal-800">
                <p className="font-black">{invoice.invoiceNumber} · {pkr(invoice.amountPKR)}</p>
                <p className="mt-1 text-teal-700">{invoice.description}</p>
                <p className="mt-1 text-teal-700">Due {new Date(invoice.dueAt).toLocaleDateString()}</p>
              </div>
            </div>
            {invoice.payRequired ? (
              <p className="text-[11px] text-slate-500">
                Nothing has been activated. Pay it now, or later from your invoices list.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">Already settled — no payment is due.</p>
            )}
          </div>
        )}

        {step === 'pay' && invoice && (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 px-3 py-2.5 flex items-center justify-between text-xs">
              <span className="text-slate-500">{invoice.invoiceNumber}</span>
              <span className="font-black text-slate-900">{pkr(invoice.amountPKR)}</span>
            </div>

            {noneConfigured ? (
              <p className="text-xs text-slate-500 leading-relaxed">
                No online payment method is connected to this deployment yet. Ask Cashly to switch one on,
                or leave this invoice and it will be settled when head office takes the payment.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Pay with</p>
                {(configurable.length > 0 ? configurable : providers).map(p => (
                  <button
                    key={p.provider}
                    onClick={() => pay(p.provider)}
                    disabled={busy}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white text-xs font-bold transition"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-3.5 h-3.5" /> {p.provider}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            )}

            {payNote && <p className="text-[11px] text-slate-500 leading-relaxed">{payNote}</p>}
          </div>
        )}

        <DialogFooter>
          {step === 'quote' && (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition">
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={!ready || busy}
                className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white text-xs font-bold transition"
              >
                {busy ? 'Raising invoice…' : 'Continue'}
              </button>
            </>
          )}

          {step === 'invoice' && (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition">
                Later
              </button>
              {invoice?.payRequired && (
                <button
                  onClick={chooseProvider}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white text-xs font-bold transition"
                >
                  Pay now
                </button>
              )}
            </>
          )}

          {step === 'pay' && (
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition">
              Close
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

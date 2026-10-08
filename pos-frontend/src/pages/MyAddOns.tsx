import React, { useState, useEffect, useCallback } from 'react';
import {
  Puzzle, RefreshCw, CheckCircle2, Receipt, MessageSquare, Layers, FileText,
  CalendarDays, AlertTriangle, CreditCard
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import { PurchaseDialog } from '../components/PurchaseDialog';
import { SubscriptionPartsTable } from '../components/SubscriptionParts';
import type {
  MyCharges, TenantAddOnCatalogRow, PlanRow, MySubscriptionSummary,
  SubscriptionInvoice, CheckoutRequest, PaymentProvider, SubscriptionPartRow
} from '../types';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

/**
 * Which gateways exist is server knowledge, not a build-time guess. The status route is optional
 * on some deployments, and when it is absent we still have to offer something — so offer the two
 * real gateways and let the server decline if it has no credentials for them.
 */
const FALLBACK_PROVIDERS: Array<{ provider: PaymentProvider; isConfigured: boolean }> = [
  { provider: 'JazzCash', isConfigured: true },
  { provider: 'EasyPaisa', isConfigured: true }
];

const INVOICE_STATUS: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Paid: 'bg-teal-50 text-teal-700 border-teal-200',
  Overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  Cancelled: 'bg-slate-100 text-slate-500 border-slate-200'
};

/** What the owner came here for: the plan on sale, the invoices owed, the add-ons on offer. */
export const MyAddOns: React.FC = () => {
  const { currentUser, loadMyPackageFeatures } = usePosStore();

  const [catalog, setCatalog] = useState<TenantAddOnCatalogRow[]>([]);
  const [charges, setCharges] = useState<MyCharges | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [subscription, setSubscription] = useState<MySubscriptionSummary | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  // What the business pays for, part by part, each renewing on its own date.
  const [parts, setParts] = useState<SubscriptionPartRow[]>([]);
  const [providers, setProviders] = useState<Array<{ provider: PaymentProvider; isConfigured: boolean }>>(FALLBACK_PROVIDERS);
  const [annual, setAnnual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The dialog owns the purchase; this is just "what did the owner click".
  const [pending, setPending] = useState<{
    request?: CheckoutRequest;
    invoice?: SubscriptionInvoice;
    title: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, bill, planRows, sub, myInvoices, gatewayRows, myParts] = await Promise.all([
        posApi.getAddOnCatalog(),
        // The bill is for the owner; anyone else simply does not see it.
        posApi.getMyCharges().catch(() => null),
        posApi.getPlans().catch(() => []),
        posApi.getSubscription().catch(() => null),
        posApi.getMySubscriptionInvoices().catch(() => []),
        posApi.getPaymentProviderStatus().catch(() => FALLBACK_PROVIDERS),
        posApi.getMySubscriptions().catch(() => [] as SubscriptionPartRow[])
      ]);
      setParts(Array.isArray(myParts) ? myParts : []);
      setCatalog(Array.isArray(data) ? data : []);
      setCharges(bill);
      setPlans(Array.isArray(planRows) ? planRows : []);
      setSubscription(sub);
      setInvoices(Array.isArray(myInvoices) ? myInvoices : []);
      if (Array.isArray(gatewayRows) && gatewayRows.length > 0) setProviders(gatewayRows);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load add-ons'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const closeDialog = useCallback(async () => {
    setPending(null);
    if (!dirty) return;
    setDirty(false);
    // An invoice may have been settled between the click and now; re-read everything rather
    // than guessing which half of the screen moved.
    await load();
    await loadMyPackageFeatures();
  }, [dirty, load, loadMyPackageFeatures]);

  const isOwner = currentUser?.role === 'OwnerAdmin';
  const currentCode = subscription?.plan.code;

  const active = catalog.filter(c => c.isActiveForTenant);
  const available = catalog.filter(c => !c.isActiveForTenant);
  const openInvoices = invoices.filter(i => i.status === 'Pending' || i.status === 'Overdue');

  const buyPlan = (plan: PlanRow) => setPending({
    request: { kind: 'plan', planCode: plan.code, annual },
    title: annual ? `${plan.name} plan, billed yearly` : `${plan.name} plan`
  });

  const buyAddOn = (item: TenantAddOnCatalogRow) => setPending({
    request: { kind: 'addon', addOnKey: item.key, annual },
    title: item.displayName
  });

  const payInvoice = (invoice: SubscriptionInvoice) => setPending({
    invoice,
    title: `Pay ${invoice.invoiceNumber}`
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Puzzle className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Plan &amp; Add-ons</h1>
            <p className="text-[11px] text-slate-500 mt-1">Your subscription, your invoices, and what else you can switch on.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 border border-slate-200 p-0.5 text-[11px] font-bold">
            <button
              onClick={() => setAnnual(false)}
              className={`px-3 py-1.5 rounded-lg transition ${!annual ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-3 py-1.5 rounded-lg transition ${annual ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Yearly
            </button>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition">
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && <div className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">{error}</div>}

      {!isOwner && (
        <div className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-600">
          Buying is an owner decision. You can see everything below, but only the owner can raise a purchase.
        </div>
      )}

      {/* Where the business stands */}
      {subscription && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-1.5">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-600" /> Your plan
            </h2>
            <p className="text-2xl font-black text-slate-900">{subscription.plan.name}</p>
            <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-lg border ${INVOICE_STATUS[subscription.status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
              {subscription.status}
            </span>
            <div className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-500">
              <CalendarDays className="w-3.5 h-3.5" />
              {subscription.endDate
                ? <>Paid until {new Date(subscription.endDate).toLocaleDateString()}</>
                : subscription.trialEndsAt
                  ? <>Trial ends {new Date(subscription.trialEndsAt).toLocaleDateString()}</>
                  : <>No billing period recorded</>}
            </div>
            {subscription.isOverPlanLimit && (
              <div className="flex items-start gap-1.5 pt-1 text-[11px] text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{subscription.overLimitReason ?? 'Over your plan limits — nothing has been removed, but you cannot add more.'}</span>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-sm font-bold text-slate-900">Plans on sale</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {plans.map(plan => {
                const mine = plan.code === currentCode;
                const price = annual ? plan.yearlyPricePKR : plan.monthlyPricePKR;
                return (
                  <div key={plan.code} className={`p-3 rounded-xl border space-y-1.5 ${mine ? 'border-teal-300 bg-teal-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">{plan.name}</span>
                      {mine && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 border border-teal-200">Yours</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug line-clamp-3">{plan.description}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-base font-black text-teal-700">{price.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400">PKR / {annual ? 'year' : 'month'}</span>
                    </div>
                    <button
                      onClick={() => buyPlan(plan)}
                      disabled={mine || !isOwner}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition disabled:opacity-50 disabled:cursor-not-allowed bg-teal-500 hover:bg-teal-600 text-white"
                    >
                      {mine ? 'Current plan' : 'Switch to this plan'}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400">
              Switching raises an invoice. Your current plan keeps running until that invoice is paid.
            </p>
          </div>
        </div>
      )}

      {/* Each part renews on its own date, counted from when it was installed. */}
      {parts.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-teal-600" /> What you pay for, and when each renews
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Your head office ERP, each outlet's POS and any extra tablets each renew from the day they were installed.
              Anything installed during your free trial is covered until the trial ends.
            </p>
          </div>
          <SubscriptionPartsTable parts={parts} />
        </div>
      )}

      {/* Money owed */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-600" /> Your invoices
          {openInvoices.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
              {openInvoices.length} unpaid
            </span>
          )}
        </h2>
        {invoices.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No invoices yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-400 text-left">
                <th className="py-1.5 font-bold">Invoice</th>
                <th className="py-1.5 font-bold">What for</th>
                <th className="py-1.5 font-bold">Issued</th>
                <th className="py-1.5 font-bold text-right">Amount</th>
                <th className="py-1.5 font-bold text-right">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-2 font-mono text-slate-700">{inv.invoiceNumber}</td>
                  <td className="py-2 pr-2 text-slate-600 max-w-[22rem] truncate">{inv.notes ?? inv.tier}</td>
                  <td className="py-2 pr-2 text-slate-500">{new Date(inv.issuedAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-2 text-right font-mono text-slate-900">{pkr(inv.amountPKR)}</td>
                  <td className="py-2 pr-2 text-right">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${INVOICE_STATUS[inv.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {(inv.status === 'Pending' || inv.status === 'Overdue') && isOwner && (
                      <button
                        onClick={() => payInvoice(inv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[11px] font-bold transition"
                      >
                        <CreditCard className="w-3 h-3" /> Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* What the business pays each month, line by line */}
      {charges && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-teal-600" /> Your monthly charges
            </h2>
            <table className="w-full text-xs">
              <tbody>
                {charges.lines.map((line, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-2 text-slate-700">
                      {line.description}
                      {line.quantity > 1 && <span className="text-slate-400"> × {line.quantity}</span>}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-900">{Math.round(line.amountPKR).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between items-baseline pt-2 border-t border-slate-200">
              <span className="text-xs font-bold text-slate-700">Total per month</span>
              <span className="text-lg font-black text-teal-700">PKR {Math.round(charges.monthlyTotalPKR).toLocaleString()}</span>
            </div>
            <p className="text-[11px] text-slate-400">Or PKR {Math.round(charges.yearlyTotalPKR).toLocaleString()} paid yearly.</p>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-600" /> WhatsApp this month
            </h2>
            {charges.whatsApp.allowance === null ? (
              <p className="text-xs text-slate-600">{charges.whatsApp.used.toLocaleString()} sent · unlimited</p>
            ) : (
              <>
                <div className="text-2xl font-black text-slate-900">
                  {charges.whatsApp.used.toLocaleString()} <span className="text-sm font-semibold text-slate-400">/ {charges.whatsApp.allowance.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full ${charges.whatsApp.remaining === 0 ? 'bg-rose-500' : 'bg-teal-500'}`}
                    style={{ width: `${Math.min(100, charges.whatsApp.allowance > 0 ? (charges.whatsApp.used / charges.whatsApp.allowance) * 100 : 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {charges.whatsApp.included.toLocaleString()} included
                  {charges.whatsApp.bundles > 0 && ` + ${(charges.whatsApp.bundles * 1000).toLocaleString()} from bundles`}.
                  {charges.whatsApp.remaining === 0 && ' Messages are paused until next month, or add a 1,000-message bundle.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

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
                {item.unlocksModule && <p className="text-[10px] text-teal-600 font-semibold">Unlocks: {item.unlocksModule}</p>}
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
                {item.unlocksModule && <p className="text-[10px] font-semibold text-slate-500">Unlocks: {item.unlocksModule}</p>}
                <div className="flex items-baseline gap-1 pt-1">
                  <span className="text-base font-black text-teal-600">
                    {(annual ? item.yearlyPricePKR : item.monthlyPricePKR).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-400">PKR / {annual ? 'year' : 'month'}</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  {annual ? `${item.monthlyPricePKR.toLocaleString()} PKR / month` : `or ${item.yearlyPricePKR.toLocaleString()} PKR / year`}
                </p>
                <button
                  onClick={() => buyAddOn(item)}
                  disabled={!isOwner}
                  className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-bold transition"
                >
                  Buy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <PurchaseDialog
        open={!!pending}
        request={pending?.request ?? null}
        invoice={pending?.invoice ?? null}
        providers={providers}
        title={pending?.title ?? ''}
        onClose={closeDialog}
        onChanged={() => setDirty(true)}
      />
    </div>
  );
};

export default MyAddOns;

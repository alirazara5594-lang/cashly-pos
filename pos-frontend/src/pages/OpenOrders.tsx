import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, RefreshCw, QrCode, Tablet, ShoppingBag, X } from 'lucide-react';
import { usePosStore } from '../store/posStore';
import { posApi, getApiErrorMessage } from '../services/api';
import type { Order, PaymentMethod } from '../types';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Card', label: 'Card' },
  { value: 'JazzCash', label: 'JazzCash' },
  { value: 'EasyPaisa', label: 'EasyPaisa' },
  { value: 'Raast', label: 'Raast' },
  { value: 'CustomerKhata', label: "Customer's account" }
];

const fetchOpen = (branchId: string) => posApi.getOrders(branchId, undefined, 200);

/** Where an unpaid order came from, from what the server recorded as its cashier. */
function sourceOf(order: Order): { label: string; icon: React.ElementType } {
  if (order.cashierName === 'QR order') return { label: 'QR code', icon: QrCode };
  if (order.cashierName === 'Online order') return { label: 'Pickup link', icon: ShoppingBag };
  return { label: order.cashierName || 'Waiter tablet', icon: Tablet };
}

/**
 * Orders placed without payment — a waiter's tablet, a guest's QR order, a pickup order — waiting
 * to be paid. Taking payment here is what puts the sale in the drawer, the books and (for shops
 * that report to the tax authority) gets its fiscal invoice number, and frees the table.
 */
export const OpenOrders: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const branchId = selectedBranch?.id;

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<Order | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [tendered, setTendered] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = useCallback((rows: Order[]) => {
    setOrders(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      apply(await fetchOpen(branchId));
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not load open orders.') });
      setLoading(false);
    }
  }, [branchId, apply]);

  // New QR and tablet orders keep arriving, so the list refreshes itself.
  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    const tick = () => fetchOpen(branchId).then(rows => { if (!cancelled) apply(rows); }).catch(() => {});
    tick();
    const timer = setInterval(tick, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [branchId, apply]);

  const open = useMemo(
    () => orders.filter(o => !o.isPaid && o.status !== 'Cancelled')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [orders]
  );

  const startPayment = (order: Order) => {
    setPaying(order);
    setMethod('Cash');
    setTendered(String(Math.round(order.totalPKR)));
    setMessage(null);
  };

  const takePayment = async () => {
    if (!paying) return;
    const amount = Number(tendered);
    if (method === 'Cash' && (Number.isNaN(amount) || amount < paying.totalPKR)) {
      setMessage({ type: 'error', text: `Enter at least ${Math.round(paying.totalPKR).toLocaleString()}.` });
      return;
    }
    setSaving(true);
    try {
      const res = await posApi.settleOrder(paying.id, {
        paymentMethod: method,
        amountPaidPKR: method === 'Cash' ? amount : undefined
      });
      setMessage({
        type: 'success',
        text: `${res.orderNumber} paid by ${res.paymentMethod}.`
          + (res.changeDuePKR > 0 ? ` Change due: ${Math.round(res.changeDuePKR).toLocaleString()}.` : '')
          + (res.fiscalInvoiceNumber ? ` Fiscal invoice ${res.fiscalInvoiceNumber}.` : '')
      });
      setPaying(null);
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not take payment.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 bg-slate-50 text-slate-900 overflow-y-auto min-h-screen">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center text-white">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight">Open Orders</h1>
              <p className="text-xs text-slate-500">
                Waiter-tablet, QR-code and pickup orders at {selectedBranch?.name ?? 'this branch'} waiting for payment.
              </p>
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); load(); }}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 border border-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading && branchId ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {message && (
          <div className={`px-4 py-3 rounded-xl border text-xs font-semibold flex justify-between gap-3 ${
            message.type === 'success' ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {!branchId ? (
          <p className="text-sm text-slate-500">Choose a branch first.</p>
        ) : open.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-400">
            {loading ? 'Loading…' : 'No unpaid orders right now.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {open.map(o => {
              const source = sourceOf(o);
              const Icon = source.icon;
              return (
                <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black font-mono">{o.orderNumber}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" /> {source.label}
                        {o.tableNumber && <span>· Table {o.tableNumber}</span>}
                        {o.customerName && <span>· {o.customerName}</span>}
                        {o.customerPhone && <span>· {o.customerPhone}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-black">{Math.round(o.totalPKR).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400">{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">
                    {o.items.map(i => `${i.quantity} × ${i.productName}`).join(', ')}
                  </div>
                  <button
                    onClick={() => startPayment(o)}
                    className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold"
                  >
                    Take payment
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {paying && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPaying(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-extrabold">Payment for {paying.orderNumber}</h3>
              <p className="text-sm text-slate-500">Total {Math.round(paying.totalPKR).toLocaleString()}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setMethod(m.value)}
                  className={`py-2 rounded-lg border text-xs font-semibold ${method === m.value ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {method === 'Cash' && (
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cash received</label>
                <input
                  type="number"
                  value={tendered}
                  onChange={e => setTendered(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-lg font-mono"
                />
                {Number(tendered) > paying.totalPKR && (
                  <p className="text-xs text-teal-700 mt-1">Change: {Math.round(Number(tendered) - paying.totalPKR).toLocaleString()}</p>
                )}
              </div>
            )}
            {method === 'CustomerKhata' && !paying.customerId && (
              <p className="text-xs text-amber-700">This order has no customer, so it cannot go on an account.</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setPaying(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold">Cancel</button>
              <button
                onClick={takePayment}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-bold"
              >
                {saving ? 'Saving…' : 'Paid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

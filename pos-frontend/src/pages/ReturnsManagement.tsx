import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Search, RefreshCw, Receipt, X, Check } from 'lucide-react';
import { usePosStore } from '../store/posStore';
import { posApi, getApiErrorMessage } from '../services/api';
import type { Order, PaymentMethod, ReturnableOrder } from '../types';

const REFUND_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'Cash', label: 'Cash from the drawer' },
  { value: 'Card', label: 'Back to the card' },
  { value: 'JazzCash', label: 'JazzCash' },
  { value: 'EasyPaisa', label: 'EasyPaisa' },
  { value: 'Raast', label: 'Raast' },
  { value: 'CustomerKhata', label: "Credit to the customer's tab" }
];

type ReturnLog = Awaited<ReturnType<typeof posApi.getReturns>>;

/** A branch's recent sales and its returns log, each loaded on its own. */
const fetchBranchData = (branchId: string) => Promise.allSettled([
  posApi.getOrders(branchId, undefined, 200),
  posApi.getReturns(branchId)
]);
type BranchData = Awaited<ReturnType<typeof fetchBranchData>>;

const money = (n: number) => Math.round(n).toLocaleString();

/**
 * Part of a paid sale coming back. The sale is never edited: each return is its own document
 * with its own number, refund, restock and journal entry (see the /orders/{id}/returns endpoint).
 */
export const ReturnsManagement: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const branchId = selectedBranch?.id;

  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState<ReturnLog | null>(null);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selected, setSelected] = useState<ReturnableOrder | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('Cash');
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = useCallback(([o, r]: BranchData) => {
    if (o.status === 'fulfilled') setOrders(Array.isArray(o.value) ? o.value : []);
    else setMessage({ type: 'error', text: getApiErrorMessage(o.reason, 'Could not load recent sales.') });
    if (r.status === 'fulfilled') setLog(r.value);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (branchId) apply(await fetchBranchData(branchId));
  }, [branchId, apply]);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    fetchBranchData(branchId).then(data => { if (!cancelled) apply(data); });
    return () => { cancelled = true; };
  }, [branchId, apply]);

  const refresh = async () => {
    setLoading(true);
    await load();
  };

  // Only paid sales that were not voided can come back.
  const returnable = useMemo(() => {
    const s = search.trim().toLowerCase();
    return orders
      .filter(o => o.isPaid && o.status !== 'Cancelled')
      .filter(o => !s
        || o.orderNumber.toLowerCase().includes(s)
        || (o.customerName ?? '').toLowerCase().includes(s)
        || (o.customerPhone ?? '').includes(s));
  }, [orders, search]);

  const openOrder = async (order: Order) => {
    setMessage(null);
    setSelectedOrder(order);
    setSelected(null);
    try {
      const info = await posApi.getOrderReturns(order.id);
      setSelected(info);
      setQuantities({});
      setRefundMethod(order.paymentMethod === 'Split' ? 'Cash' : order.paymentMethod);
      setRestock(true);
      setReason('');
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not open this sale.') });
      setSelectedOrder(null);
    }
  };

  const closeOrder = () => {
    setSelected(null);
    setSelectedOrder(null);
  };

  // A preview only: the server applies the sale's own discount and tax share exactly.
  const estimate = useMemo(() => {
    if (!selected || !selectedOrder) return 0;
    const gross = selected.lines.reduce((sum, l) => sum + (quantities[l.orderItemId] ?? 0) * l.unitPricePKR, 0);
    const discountShare = selectedOrder.subTotalPKR > 0 ? selectedOrder.discountPKR / selectedOrder.subTotalPKR : 0;
    const net = gross * (1 - discountShare);
    const taxable = selectedOrder.subTotalPKR - selectedOrder.discountPKR;
    const tax = taxable > 0 ? (net * selectedOrder.taxPKR) / taxable : 0;
    return Math.min(net + tax, Math.max(0, selected.totalPKR - selected.refundedPKR));
  }, [selected, selectedOrder, quantities]);

  const itemsChosen = Object.values(quantities).reduce((a, b) => a + b, 0);

  const setQuantity = (orderItemId: string, value: number, max: number) =>
    setQuantities(prev => ({ ...prev, [orderItemId]: Math.max(0, Math.min(max, Math.floor(value) || 0)) }));

  const submit = async () => {
    if (!selected || itemsChosen === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await posApi.createOrderReturn(selected.orderId, {
        lines: Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        refundMethod,
        restock,
        reason: reason.trim() || undefined
      });
      setMessage({
        type: 'success',
        text: `${res.returnNumber}: ${money(res.totalRefundedPKR)} refunded (${res.refundMethod})${res.restocked ? ' — goods are back in stock' : ''}.`
      });
      closeOrder();
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not record the return.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 bg-slate-50 text-slate-900 overflow-y-auto min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-teal-500/20">
              <RotateCcw className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Returns & Refunds</h1>
              <p className="text-xs text-slate-500">
                Take back part or all of a paid sale at {selectedBranch?.name ?? 'this branch'}. The original sale stays as it was.
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading && !!branchId}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 border border-slate-200 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-600 ${loading && branchId ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {message && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-start justify-between gap-3 ${
              message.type === 'success' ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 cursor-pointer" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Recent sales */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Order number, customer name or phone"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recent paid sales</div>
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {returnable.length === 0 && (
                <p className="text-xs text-slate-400 py-6 text-center">
                  {!branchId ? 'Choose a branch first.' : loading ? 'Loading…' : 'No paid sales match.'}
                </p>
              )}
              {returnable.map(o => {
                const refunded = o.refundedPKR ?? 0;
                return (
                  <button
                    key={o.id}
                    onClick={() => openOrder(o)}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                      selectedOrder?.id === o.id ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 font-mono">{o.orderNumber}</span>
                      <span className="font-bold text-slate-900">{money(o.totalPKR)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                      <span>{new Date(o.createdAt).toLocaleString()}{o.customerName ? ` · ${o.customerName}` : ''}</span>
                      {refunded > 0 && <span className="text-amber-600 font-semibold">{money(refunded)} refunded</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* The return itself, or the log */}
          <div className="lg:col-span-3 space-y-6">
            {selectedOrder && !selected && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 flex justify-center">
                <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
              </div>
            )}

            {selected && selectedOrder && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-teal-600" /> Return from {selected.orderNumber}
                    </h2>
                    <p className="text-xs text-slate-500">
                      Paid {money(selected.totalPKR)} by {selectedOrder.paymentMethod}
                      {selected.refundedPKR > 0 && ` · ${money(selected.refundedPKR)} already refunded`}
                    </p>
                  </div>
                  <button onClick={closeOrder} className="text-slate-400 hover:text-slate-800 cursor-pointer" title="Close">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="py-2">Item</th>
                      <th className="py-2 text-right">Price</th>
                      <th className="py-2 text-right">Bought</th>
                      <th className="py-2 text-right">Can return</th>
                      <th className="py-2 text-right">Returning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map(l => (
                      <tr key={l.orderItemId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 font-semibold text-slate-900">{l.productName}</td>
                        <td className="py-2 text-right font-mono">{money(l.unitPricePKR)}</td>
                        <td className="py-2 text-right">{l.quantity}</td>
                        <td className="py-2 text-right">{l.returnableQuantity}</td>
                        <td className="py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={l.returnableQuantity}
                            disabled={l.returnableQuantity <= 0}
                            value={quantities[l.orderItemId] ?? 0}
                            onChange={(e) => setQuantity(l.orderItemId, Number(e.target.value), l.returnableQuantity)}
                            className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-right font-mono disabled:opacity-40 focus:outline-none focus:border-teal-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Refund by</label>
                    <select
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                    >
                      {REFUND_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason</label>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. wrong size, damaged"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="w-4 h-4 accent-teal-500" />
                  Put the goods back in stock (untick for damaged or opened goods)
                </label>

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200">
                  <div className="text-xs text-slate-600">
                    {itemsChosen} item{itemsChosen === 1 ? '' : 's'} · about <span className="font-bold text-slate-900">{money(estimate)}</span> back
                    {refundMethod === 'Cash' && <span className="text-slate-400"> (paid out of the open shift's drawer)</span>}
                  </div>
                  <button
                    onClick={submit}
                    disabled={saving || itemsChosen === 0}
                    className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Recording…' : 'Record return'}
                  </button>
                </div>

                {selected.returns.length > 0 && (
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <div className="font-bold uppercase tracking-wider text-[10px]">Earlier returns on this sale</div>
                    {selected.returns.map(r => (
                      <div key={r.id}>
                        {r.returnNumber} · {money(r.totalRefundedPKR)} by {r.refundMethod} · {new Date(r.createdAt).toLocaleString()} · {r.createdBy}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* The branch's returns, last 30 days */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">Returns in the last 30 days</h2>
                {log && (
                  <span className="text-xs text-slate-500">
                    {log.count} return{log.count === 1 ? '' : 's'} · <span className="font-bold text-slate-900">{money(log.totalRefundedPKR)}</span> refunded
                  </span>
                )}
              </div>
              {!log || log.returns.length === 0 ? (
                <p className="text-xs text-slate-400">No returns yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-3">Return</th>
                        <th className="py-2 pr-3">Sale</th>
                        <th className="py-2 pr-3">When</th>
                        <th className="py-2 pr-3 text-right">Items</th>
                        <th className="py-2 pr-3 text-right">Refunded</th>
                        <th className="py-2">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.returns.map(r => (
                        <tr key={r.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-3 font-mono font-semibold text-slate-900">{r.returnNumber}</td>
                          <td className="py-2 pr-3 font-mono text-slate-600">{r.orderNumber}</td>
                          <td className="py-2 pr-3 text-slate-600">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="py-2 pr-3 text-right">{r.items}</td>
                          <td className="py-2 pr-3 text-right font-mono font-bold">{money(r.totalRefundedPKR)}</td>
                          <td className="py-2 text-slate-600">
                            {r.createdBy}
                            <span className="text-slate-400"> · {r.refundMethod}{r.restocked ? ', restocked' : ''}</span>
                            {r.reason && <div className="text-[10px] text-slate-400">{r.reason}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

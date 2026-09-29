import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, CheckCircle2, UtensilsCrossed } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { PublicMenu, PublicOrderResult } from '../types';

/**
 * What a guest sees after scanning a table's QR code, or opening a shop's pickup link. No sign-in:
 * the token in the address is the table (or shop) itself. Prices and tax come back from the server
 * after the order is placed, so the total shown at the end is exactly what the till will charge.
 */
export const PublicOrder: React.FC = () => {
  const { token = '' } = useParams();
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicOrderResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getPublicMenu(token)
      .then(data => { if (!cancelled) setMenu(data); })
      .catch(err => { if (!cancelled) setLoadError(getApiErrorMessage(err, 'This menu could not be opened.')); });
    return () => { cancelled = true; };
  }, [token]);

  const symbol = menu?.currencySymbol ?? 'Rs';
  const money = (n: number) => `${symbol} ${Math.round(n).toLocaleString()}`;
  const visible = useMemo(
    () => (menu?.products ?? []).filter(p => category === 'all' || p.categoryId === category),
    [menu, category]
  );
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const itemCount = lines.reduce((sum, [, q]) => sum + q, 0);
  const estimate = lines.reduce((sum, [id, q]) => sum + (menu?.products.find(p => p.id === id)?.pricePKR ?? 0) * q, 0);
  const isPickup = menu?.orderType === 'Takeaway';

  const change = (id: string, delta: number) =>
    setCart(prev => ({ ...prev, [id]: Math.max(0, Math.min(50, (prev[id] ?? 0) + delta)) }));

  const placeOrder = async () => {
    if (itemCount === 0) return;
    if (isPickup && (!name.trim() || !phone.trim())) {
      setError('Please enter your name and phone number.');
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      setResult(await posApi.placePublicOrder(token, {
        items: lines.map(([productId, quantity]) => ({ productId, quantity })),
        customerName: name.trim() || undefined,
        customerPhone: phone.trim() || undefined
      }));
      setCart({});
    } catch (err) {
      setError(getApiErrorMessage(err, 'Your order could not be sent. Please try again or ask the staff.'));
    } finally {
      setPlacing(false);
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <UtensilsCrossed className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-700">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-teal-500 mx-auto" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Order {result.orderNumber}</h1>
            <p className="text-sm text-slate-600 mt-1">{result.message}</p>
          </div>
          <div className="text-left text-sm space-y-1 border-t border-slate-100 pt-3">
            {result.items.map((i, idx) => (
              <div key={idx} className="flex justify-between">
                <span>{i.quantity} × {i.productName}</span>
                <span className="font-mono">{money(i.totalPricePKR)}</span>
              </div>
            ))}
            {result.taxPKR > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Tax</span><span className="font-mono">{money(result.taxPKR)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
              <span>Total</span><span className="font-mono">{money(result.totalPKR)}</span>
            </div>
          </div>
          <button
            onClick={() => setResult(null)}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
          >
            Order something else
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-40">
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          <div className="text-base font-black text-slate-900">{menu.businessName || menu.branchName}</div>
          <div className="text-xs text-slate-500">
            {menu.branchName}{menu.tableNumber ? ` · Table ${menu.tableNumber}` : ' · Order for pickup'}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pt-2 -mx-1 px-1">
            <button
              onClick={() => setCategory('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${category === 'all' ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Everything
            </button>
            {menu.categories.map(c => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${category === c.id ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-2">
        {visible.map(p => {
          const quantity = cart[p.id] ?? 0;
          return (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
              {p.imageUrl && <img src={p.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-900">{p.name}</div>
                {p.urduName && <div className="text-xs text-slate-500">{p.urduName}</div>}
                <div className="text-xs font-mono text-teal-700 mt-0.5">{money(p.pricePKR)}</div>
              </div>
              {quantity === 0 ? (
                <button
                  onClick={() => change(p.id, 1)}
                  className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold"
                >
                  Add
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => change(p.id, -1)} className="p-1.5 rounded-lg bg-slate-100" aria-label="One less"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-5 text-center text-sm font-bold">{quantity}</span>
                  <button onClick={() => change(p.id, 1)} className="p-1.5 rounded-lg bg-slate-100" aria-label="One more"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-sm text-slate-400 text-center py-10">Nothing here right now.</p>}
      </main>

      {itemCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-4 shadow-2xl">
          <div className="max-w-2xl mx-auto space-y-2">
            {/* A pickup order must say who is collecting it; at a table the name is optional. */}
            <div className="grid grid-cols-2 gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isPickup ? 'Your name' : 'Your name (optional)'}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                inputMode="tel"
                placeholder={isPickup ? 'Phone number' : 'Phone (optional)'}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>
            {error && <div className="text-xs font-semibold text-rose-600">{error}</div>}
            <button
              onClick={placeOrder}
              disabled={placing}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <ShoppingBag className="w-4 h-4" />
              {placing ? 'Sending…' : `Place order · ${itemCount} item${itemCount === 1 ? '' : 's'} · about ${money(estimate)}`}
            </button>
            <p className="text-[11px] text-slate-400 text-center">
              {isPickup ? 'Pay when you collect your order.' : 'Pay your waiter or at the counter when you are done.'} Tax, if any, is added to the final bill.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

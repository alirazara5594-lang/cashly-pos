import React, { useState, useEffect } from 'react';
import { Tablet, Send, Plus, Minus, Trash2, CheckCircle2, Utensils } from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import { ProductCard } from '../components/ProductCard';
import type { Product, Category, CartItem } from '../types';

export const OrderTab: React.FC = () => {
  const { selectedBranch, selectedTenant } = usePosStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [tables, setTables] = useState<any[]>([]);
  const [activeTable, setActiveTable] = useState<string>('T-1');
  const [selectedFloor, setSelectedFloor] = useState<string>('all');

  // Tab Cart - uses local state for waiter mode isolation
  const [tabCart, setTabCart] = useState<CartItem[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [specialNote, setSpecialNote] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Wait for a tenant before asking for its catalogue. Firing without one sends an unscoped
      // request, which the server answers with 401 for anybody whose token carries no tenant of
      // its own (the platform admin) — and a 401 is read as a dead session, so it would sign
      // them out rather than simply returning nothing.
      if (!selectedTenant?.id) return;
      try {
        const cats = await posApi.getCategories(selectedTenant.id);
        const prods = await posApi.getProducts({ tenantId: selectedTenant.id });
        if (cancelled) return;
        setCategories(cats);
        setProducts(prods);
        if (selectedBranch?.id) {
          const tbls = await posApi.getTables(selectedBranch.id);
          if (!cancelled) setTables(tbls);
        }
      } catch (err) {
        console.error(err);
      }
    };
    load();

    // A waiter tablet sits on the floor all shift without ever being reloaded, so refresh
    // the menu whenever it comes back to the foreground — otherwise a price changed at the
    // back office mid-service never reaches the captain taking the order.
    const revalidate = () => {
      if (!document.hidden) load();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [selectedTenant?.id, selectedBranch?.id]);

  const getCategoryName = (catId: string) => categories.find(c => c.id === catId)?.name;

  const addToTabCart = (product: Product) => {
    const idx = tabCart.findIndex(i => i.productId === product.id);
    if (idx > -1) {
      const updated = [...tabCart];
      updated[idx].quantity += 1;
      updated[idx].totalPricePKR = updated[idx].quantity * updated[idx].unitPricePKR;
      setTabCart(updated);
    } else {
      setTabCart([...tabCart, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPricePKR: product.sellingPricePKR,
        totalPricePKR: product.sellingPricePKR,
        station: product.station,
        specialNotes: ''
      }]);
    }
  };

  const updateTabQty = (productId: string, delta: number) => {
    setTabCart(tabCart.map(i => {
      if (i.productId === productId) {
        const qty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: qty, totalPricePKR: qty * i.unitPricePKR };
      }
      return i;
    }));
  };

  const removeFromTab = (productId: string) => {
    setTabCart(tabCart.filter(i => i.productId !== productId));
  };

  const totalTabPKR = tabCart.reduce((s, i) => s + i.totalPricePKR, 0);

  const handleSendOrderMode1 = async () => {
    if (tabCart.length === 0) return;
    setIsSending(true);

    try {
      await posApi.createOrder({
        branchId: selectedBranch?.id || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        orderType: 'DineIn',
        tableNumber: activeTable,
        subTotalPKR: totalTabPKR,
        discountPKR: 0,
        taxPKR: Math.round(totalTabPKR * 0.16),
        totalPKR: totalTabPKR + Math.round(totalTabPKR * 0.16),
        paymentMethod: 'Cash',
        amountPaidPKR: 0,
        changeDuePKR: 0,
        isPaid: false,
        cashierName: 'Floor Waiter (Tab)',
        createdByRole: 'WaiterTab',
        items: tabCart.map(i => ({
          productId: i.productId,
          productName: i.productName,
          quantity: i.quantity,
          unitPricePKR: i.unitPricePKR,
          modifiersSummary: i.modifiersSummary,
          specialNotes: specialNote || undefined,
          station: i.station
        }))
      });

      setShowSuccess(true);
      setTabCart([]);
      setSpecialNote('');
      setTimeout(() => setShowSuccess(false), 4000);
    } catch (err) {
      console.error(err);
      alert('Failed to send order to kitchen');
    } finally {
      setIsSending(false);
    }
  };

  const filteredProducts = products.filter(p => selectedCategoryId === 'all' || p.categoryId === selectedCategoryId);

  return (
    <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-53px)] overflow-hidden bg-slate-50 text-slate-900">
      {/* Left Menu Section */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-200">
        {/* Table & Floor Selector Strip */}
        <div className="p-3 bg-white border-b border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tablet className="w-5 h-5 text-purple-500" />
              <span className="font-bold text-xs uppercase tracking-wider text-slate-600">Select Dining Table:</span>
            </div>
            {tables.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[50vw]">
                <button
                  onClick={() => setSelectedFloor('all')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                    selectedFloor === 'all' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
                  }`}
                >
                  All Floors
                </button>
                {Array.from(new Set(tables.map(t => t.section || 'Main Hall'))).map(fl => (
                  <button
                    key={fl}
                    onClick={() => setSelectedFloor(fl)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition whitespace-nowrap ${
                      selectedFloor === fl ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
                    }`}
                  >
                    {fl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {(tables.length > 0 
              ? (selectedFloor === 'all' ? tables : tables.filter(t => (t.section || 'Main Hall') === selectedFloor))
              : [{ tableNumber: 'T-1' }, { tableNumber: 'T-2' }, { tableNumber: 'T-3' }, { tableNumber: 'T-4' }]
            ).map((t: any) => (
              <button
                key={t.tableNumber}
                onClick={() => setActiveTable(t.tableNumber)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                  activeTable === t.tableNumber
                    ? 'bg-purple-500 text-white shadow-md shadow-purple-500/25'
                    : t.isOccupied
                    ? 'bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{t.tableNumber}</span>
                {t.section && <span className="text-[9px] opacity-70">({t.section})</span>}
                {t.isOccupied && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              selectedCategoryId === 'all' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
            }`}
          >
            All Items
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategoryId(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                selectedCategoryId === c.id ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {/* content-start is load-bearing: this is a `flex-1` grid, so without it the default
            align-content:stretch spreads the leftover column height across the rows and a
            single row of items inflates to the full height of the screen. Mirrors PosTerminal. */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 content-start auto-rows-min">
          {filteredProducts.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              categoryName={getCategoryName(p.categoryId)}
              accent="purple"
              onSelect={addToTabCart}
            />
          ))}
        </div>
      </div>

      {/* Right Waiter Ticket Panel */}
      <div className="w-full md:w-80 flex flex-col bg-white border-l border-slate-200">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-purple-600 uppercase tracking-wider">Captain Order Mode</div>
            <div className="text-sm font-black text-slate-900">Table: {activeTable}</div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200 font-mono">
            MODE 1 DISPATCH
          </span>
        </div>

        {showSuccess && (
          <div className="m-3 p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-600 text-xs flex items-center gap-2 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
            <span>Ticket sent to Kitchen & Counter live!</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tabCart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-1">
              <Utensils className="w-10 h-10 opacity-30" />
              <p className="text-xs">Tap menu items to add to table order</p>
            </div>
          ) : (
            tabCart.map(item => (
              <div key={item.productId} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-slate-900 truncate">{item.productName}</div>
                  <div className="text-[10px] text-teal-600">{item.unitPricePKR}</div>
                </div>
                <div className="flex items-center gap-1.5 bg-white px-1.5 py-0.5 rounded-lg border border-slate-200">
                  <button onClick={() => updateTabQty(item.productId, -1)} className="text-slate-500 p-0.5">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-bold text-xs px-1">{item.quantity}</span>
                  <button onClick={() => updateTabQty(item.productId, 1)} className="text-slate-500 p-0.5">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-right min-w-[50px]">
                  <div className="font-bold text-xs text-slate-900">{item.totalPricePKR}</div>
                  <button onClick={() => removeFromTab(item.productId)} className="text-slate-400 hover:text-rose-500">
                    <Trash2 className="w-3 h-3 ml-auto" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 bg-white border-t border-slate-200 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kitchen Instructions</label>
            <input
              type="text"
              placeholder="e.g. Mild spice, less ice, serve starters first"
              value={specialNote}
              onChange={(e) => setSpecialNote(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500">Items Total:</span>
            <span className="text-base font-black text-teal-600">{totalTabPKR.toLocaleString()}</span>
          </div>
          <button
            onClick={handleSendOrderMode1}
            disabled={tabCart.length === 0 || isSending}
            className="w-full py-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-black text-xs shadow-lg shadow-purple-500/25 transition flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {isSending ? (
              <span>Firing to Kitchen...</span>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Fire to Kitchen & Counter (Mode 1)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

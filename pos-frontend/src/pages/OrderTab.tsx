import React, { useState, useEffect } from 'react';
import { Tablet, Send, Plus, Minus, Trash2, CheckCircle2, Utensils } from 'lucide-react';
import { posApi } from '../services/api';

import { usePosStore } from '../store/posStore';
import type { Product, Category, CartItem } from '../types';

export const OrderTab: React.FC = () => {
  const { selectedBranch, selectedTenant } = usePosStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [tables, setTables] = useState<any[]>([]);
  const [activeTable, setActiveTable] = useState<string>('T-1');

  // Tab Cart
  const [tabCart, setTabCart] = useState<CartItem[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [specialNote, setSpecialNote] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const cats = await posApi.getCategories(selectedTenant?.id);
        const prods = await posApi.getProducts({ tenantId: selectedTenant?.id });
        setCategories(cats);
        setProducts(prods);

        if (selectedBranch?.id) {
          const tbls = await posApi.getTables(selectedBranch.id);
          setTables(tbls);
        }
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [selectedTenant?.id, selectedBranch?.id]);

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
        isPaid: false, // Unpaid - settled later at counter!
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
    <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-53px)] overflow-hidden bg-slate-950 text-slate-100">
      {/* Left Menu Section */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800">
        {/* Table Selector Strip */}
        <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tablet className="w-5 h-5 text-purple-400" />
            <span className="font-bold text-xs uppercase tracking-wider text-slate-300">Select Dining Table:</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(tables.length > 0 ? tables : [{ tableNumber: 'T-1' }, { tableNumber: 'T-2' }, { tableNumber: 'T-3' }, { tableNumber: 'T-4' }]).map((t: any) => (
              <button
                key={t.tableNumber}
                onClick={() => setActiveTable(t.tableNumber)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                  activeTable === t.tableNumber
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>{t.tableNumber}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              selectedCategoryId === 'all'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All Items
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCategoryId(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                selectedCategoryId === c.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredProducts.map(p => (
            <button
              key={p.id}
              onClick={() => addToTabCart(p)}
              className="p-3 rounded-2xl bg-slate-900 border border-slate-800 hover:border-purple-500 text-left transition flex flex-col justify-between shadow-md group"
            >
              <div>
                <div className="font-bold text-xs text-white group-hover:text-purple-300 transition line-clamp-2">{p.name}</div>
                {p.urduName && <div className="text-[11px] text-slate-400 font-sans mt-0.5">{p.urduName}</div>}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between">
                <span className="text-emerald-400 font-black text-xs">₨{p.sellingPricePKR.toLocaleString()}</span>
                <span className="w-6 h-6 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold text-xs group-hover:bg-purple-600 group-hover:text-white transition">
                  +
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Waiter Ticket Panel */}
      <div className="w-full md:w-80 flex flex-col bg-slate-900 border-l border-slate-800">
        <div className="p-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-purple-400 uppercase tracking-wider">Captain Order Mode</div>
            <div className="text-sm font-black text-white">Table: {activeTable}</div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
            MODE 1 DISPATCH
          </span>
        </div>

        {/* Success Alert Banner */}
        {showSuccess && (
          <div className="m-3 p-3 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Ticket sent to Kitchen & Counter live!</span>
          </div>
        )}

        {/* Selected Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {tabCart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-1">
              <Utensils className="w-10 h-10 opacity-30" />
              <p className="text-xs">Tap menu items to add to table order</p>
            </div>
          ) : (
            tabCart.map(item => (
              <div key={item.productId} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-white truncate">{item.productName}</div>
                  <div className="text-[10px] text-emerald-400">₨{item.unitPricePKR}</div>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-900 px-1.5 py-0.5 rounded-lg border border-slate-800">
                  <button onClick={() => updateTabQty(item.productId, -1)} className="text-slate-400 p-0.5">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-bold text-xs px-1">{item.quantity}</span>
                  <button onClick={() => updateTabQty(item.productId, 1)} className="text-slate-400 p-0.5">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <div className="text-right min-w-[50px]">
                  <div className="font-bold text-xs text-white">₨{item.totalPricePKR}</div>
                  <button onClick={() => removeFromTab(item.productId)} className="text-slate-500 hover:text-rose-400">
                    <Trash2 className="w-3 h-3 ml-auto" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Special Instructions & Send Button */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Kitchen Instructions</label>
            <input
              type="text"
              placeholder="e.g. Mild spice, less ice, serve starters first"
              value={specialNote}
              onChange={(e) => setSpecialNote(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none"
            />
          </div>

          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Items Total:</span>
            <span className="text-base font-black text-emerald-400">₨{totalTabPKR.toLocaleString()}</span>
          </div>

          <button
            onClick={handleSendOrderMode1}
            disabled={tabCart.length === 0 || isSending}
            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2 disabled:opacity-40"
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

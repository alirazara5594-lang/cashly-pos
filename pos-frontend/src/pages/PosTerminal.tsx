import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Barcode, 
  Trash2, 
  Plus, 
  Minus, 
  PauseCircle, 
  PlayCircle, 
  CreditCard, 
  Banknote, 
  Smartphone, 
  QrCode, 
  BookOpen, 
  Check, 
  X,
  ShoppingBag,
  Utensils
} from 'lucide-react';

import { usePosStore } from '../store/posStore';
import { posApi } from '../services/api';
import { offlineDb, cacheCatalog, getCachedCatalog, cacheDiningTables, getCachedDiningTables } from '../services/offlineDb';
import type { Product, Category, PaymentMethod, OrderType, Order } from '../types';
import { ThermalReceiptModal } from '../components/ThermalReceiptModal';

export const PosTerminal: React.FC = () => {
  const {
    selectedBranch,
    selectedTenant,
    cart,
    addToCart,
    removeFromCart,
    updateQuantity,
    setOrderType,
    orderType,
    selectedTable,
    setSelectedTable,
    customerName,
    customerPhone,
    deliveryAddress,
    discountPKR,

    setDiscount,
    clearCart,
    getSubTotal,
    getTaxAmount,
    getTotal,
    parkCurrentBill,
    resumeParkedBill,
    deleteParkedBill,
    parkedBills,
    isOnline,

    setOfflinePendingCount,
    paymentMethod,
    setPaymentMethod,
    taxMode,
    getEffectiveTaxRate
  } = usePosStore();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [tables, setTables] = useState<any[]>([]);

  // Modals
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [cashTendered, setCashTendered] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);

  // Selected product for modifiers modal
  const [activeProductForModifier, setActiveProductForModifier] = useState<Product | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<any[]>([]);
  const [itemNote, setItemNote] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Load Catalog - Cache only (menu updates via Menu Management page)
  useEffect(() => {
    const loadCatalog = async () => {
      if (!selectedTenant?.id) return;

      try {
        const cached = await getCachedCatalog(selectedTenant.id);
        if (cached.categories.length > 0) {
          setCategories(cached.categories);
          setProducts(cached.products);
        } else if (isOnline) {
          // First visit: fetch once and cache
          const [cats, prods] = await Promise.all([
            posApi.getCategories(selectedTenant.id),
            posApi.getProducts({ tenantId: selectedTenant.id })
          ]);
          setCategories(cats);
          setProducts(prods);
          await cacheCatalog(selectedTenant.id, cats, prods);
        }

        // Load dining tables
        if (selectedBranch?.id) {
          if (isOnline) {
            const tbls = await posApi.getTables(selectedBranch.id);
            setTables(tbls);
            await cacheDiningTables(tbls);
          } else {
            const cachedTables = await getCachedDiningTables(selectedBranch.id);
            setTables(cachedTables);
          }
        }
      } catch (err) {
        console.error('Failed to load catalog:', err);
      }
    };

    loadCatalog();
  }, [selectedTenant?.id, selectedBranch?.id, isOnline]);

  // Barcode rapid scan handler
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    const matched = products.find(p => p.barcode === barcodeInput.trim() || p.sku.toLowerCase() === barcodeInput.trim().toLowerCase());
    if (matched) {
      addToCart(matched);
      setBarcodeInput('');
    } else {
      alert(`Barcode ${barcodeInput} not found in catalog.`);
    }
  };

  // Filtered Products
  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategoryId === 'all' || p.categoryId === selectedCategoryId;
    const matchesSearch = !searchTerm || 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (p.urduName && p.urduName.includes(searchTerm)) ||
      p.barcode.includes(searchTerm);
    return matchesCategory && matchesSearch;
  });

  const subtotal = getSubTotal();
  const tax = getTaxAmount();
  const grandTotal = getTotal();
  const changeDue = Math.max(0, cashTendered - grandTotal);

  // Quick cash tender buttons in PKR
  const setQuickCash = (amount: number) => {
    setCashTendered(amount);
  };

  // Complete Order
  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);

    const orderPayload = {
      branchId: selectedBranch?.id || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      orderType,
      tableNumber: orderType === 'DineIn' ? selectedTable : undefined,
      customerName: customerName || (orderType === 'Delivery' ? 'Delivery Customer' : undefined),
      customerPhone: customerPhone || undefined,
      deliveryAddress: deliveryAddress || undefined,
      subTotalPKR: subtotal,
      discountPKR,
      taxPKR: tax,
      totalPKR: grandTotal,
      paymentMethod,
      amountPaidPKR: paymentMethod === 'Cash' ? (cashTendered || grandTotal) : grandTotal,
      changeDuePKR: paymentMethod === 'Cash' ? changeDue : 0,
      isPaid: true,
      cashierName: 'Counter 1 Cashier',
      createdByRole: 'Cashier',
      items: cart.map(i => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPricePKR: i.unitPricePKR,
        modifiersSummary: i.selectedModifiers?.map(m => m.name).join(', '),
        specialNotes: i.specialNotes,
        station: i.station || 'MainKitchen'
      }))
    };

    try {
      if (isOnline) {
        const res = await posApi.createOrder(orderPayload);
        const newOrder: Order = {
          id: res.orderId,
          tenantId: selectedTenant?.id || '',
          branchId: selectedBranch?.id || '',
          orderNumber: res.orderNumber,
          orderType,
          status: 'InKitchen',
          tableNumber: selectedTable,
          customerName,
          customerPhone,
          deliveryAddress,
          subTotalPKR: subtotal,
          discountPKR,
          taxPKR: tax,
          totalPKR: grandTotal,
          paymentMethod,
          amountPaidPKR: paymentMethod === 'Cash' ? (cashTendered || grandTotal) : grandTotal,
          changeDuePKR: paymentMethod === 'Cash' ? changeDue : 0,
          isPaid: true,
          createdAt: new Date().toISOString(),
          items: [...cart]
        };

        setCompletedOrder(newOrder);
      } else {
        // Offline Order Storage with idempotency key
        const offlineId = `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        await offlineDb.offlineOrders.add({
          localId: offlineId,
          orderData: { ...orderPayload, idempotencyKey },
          createdAt: new Date().toISOString(),
          isSynced: 0 as any,
          syncRetries: 0
        });

        const pendingCount = await offlineDb.offlineOrders.where('isSynced').equals(0).count();
        setOfflinePendingCount(pendingCount);

        const newOrder: Order = {
          id: offlineId,
          tenantId: selectedTenant?.id || '',
          branchId: selectedBranch?.id || '',
          orderNumber: offlineId,
          orderType,
          status: 'Completed',
          tableNumber: selectedTable,
          customerName,
          customerPhone,
          deliveryAddress,
          subTotalPKR: subtotal,
          discountPKR,
          taxPKR: tax,
          totalPKR: grandTotal,
          paymentMethod,
          amountPaidPKR: paymentMethod === 'Cash' ? (cashTendered || grandTotal) : grandTotal,
          changeDuePKR: paymentMethod === 'Cash' ? changeDue : 0,
          isPaid: true,
          createdAt: new Date().toISOString(),
          items: [...cart]
        };

        setCompletedOrder(newOrder);
      }

      setIsCheckoutOpen(false);
      setIsReceiptOpen(true);
      clearCart();
      setCashTendered(0);
    } catch (err) {
      console.error('Order submission error:', err);
      alert('Failed to submit order. Please check network.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-53px)] overflow-hidden bg-slate-950 text-slate-100">
      {/* Left / Center Catalog & Barcode Grid */}
      <div className="flex-1 flex flex-col border-r border-slate-800 overflow-hidden">
        {/* Top Control Bar: Search & Barcode Scanning */}
        <div className="p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-3">
          {/* Quick Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search product name, Urdu name, or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Rapid Barcode Scanner Input */}
          <form onSubmit={handleBarcodeSubmit} className="relative flex-1 min-w-[200px]">
            <Barcode className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
            <input
              ref={barcodeInputRef}
              type="text"
              placeholder="Scan Barcode (or type & press Enter)..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-emerald-300 placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
            />
          </form>

          {/* Parked Bills Quick Trigger */}
          {parkedBills.length > 0 && (
            <button
              onClick={() => setShowParkedModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-900/40 border border-purple-700/60 text-purple-300 text-xs font-bold hover:bg-purple-900/60 transition"
            >
              <PauseCircle className="w-4 h-4 text-purple-400" />
              <span>Held Tabs ({parkedBills.length})</span>
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategoryId('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
              selectedCategoryId === 'all'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All Items ({products.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategoryId(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                selectedCategoryId === cat.id
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <span>{cat.name}</span>
            </button>
          ))}
        </div>

        {/* Product Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              onClick={() => {
                if (product.modifiers && product.modifiers.length > 0) {
                  setActiveProductForModifier(product);
                  setSelectedModifiers([]);
                  setItemNote('');
                } else {
                  addToCart(product);
                }
              }}
              className="group bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-2.5 flex flex-col justify-between cursor-pointer transition shadow-lg hover:shadow-emerald-500/5"
            >
              {/* Product Image */}
              <div className="relative w-full h-28 rounded-xl overflow-hidden bg-slate-950 mb-2 border border-slate-800">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600">
                    <Utensils className="w-8 h-8 opacity-40" />
                  </div>
                )}
                {product.modifiers && product.modifiers.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-black uppercase">
                    Custom
                  </span>
                )}
                <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-950/80 backdrop-blur text-slate-300 text-[10px] font-mono">
                  {product.unit}
                </span>
              </div>

              {/* Names */}
              <div>
                <div className="font-bold text-white text-xs line-clamp-1 group-hover:text-emerald-400 transition">
                  {product.name}
                </div>
                {product.urduName && (
                  <div className="text-[11px] text-slate-400 font-sans text-right line-clamp-1 mt-0.5">
                    {product.urduName}
                  </div>
                )}
              </div>

              {/* Price Tag in PKR */}
              <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-emerald-400 font-black text-sm">
                  ₨{product.sellingPricePKR.toLocaleString()}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-md font-mono">
                  {product.barcode.slice(-4)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Cart & Checkout Panel */}
      <div className="w-full lg:w-96 flex flex-col bg-slate-900 border-l border-slate-800">
        {/* Order Type & Table Selection */}
        <div className="p-3 bg-slate-850 border-b border-slate-800 space-y-2">
          {/* Order Type Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
            {(['DineIn', 'Takeaway', 'Delivery', 'CallOrder'] as OrderType[]).map((type) => (
              <button
                key={type}
                onClick={() => setOrderType(type)}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition text-center ${
                  orderType === type
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {type === 'DineIn' ? 'Dine-In' : type === 'Takeaway' ? 'Takeaway' : type === 'Delivery' ? 'Delivery' : 'Phone Call'}
              </button>
            ))}
          </div>

          {/* Dine-In Table Picker (Organized by Floors / Sections) */}
          {orderType === 'DineIn' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Dining Table & Floor:</span>
                <Link to="/floors" className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold">
                  + Manage Floors
                </Link>
              </div>

              <select
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-bold text-emerald-400 focus:outline-none"
              >
                {tables.length > 0 ? (
                  // Group tables by their section/floor
                  Array.from(new Set(tables.map(t => t.section || 'Main Hall'))).map(floorName => (
                    <optgroup key={floorName} label={`📍 ${floorName}`}>
                      {tables
                        .filter(t => (t.section || 'Main Hall') === floorName)
                        .map(t => (
                          <option key={t.id} value={t.tableNumber}>
                            {t.tableNumber} ({t.capacity} Seats) {t.isOccupied ? '🔴 Occupied' : '🟢 Vacant'}
                          </option>
                        ))}
                    </optgroup>
                  ))
                ) : (
                  <>
                    <optgroup label="Ground Floor">
                      <option value="T-1">T-1 (4 Seats) 🟢 Vacant</option>
                      <option value="T-2">T-2 (4 Seats) 🟢 Vacant</option>
                    </optgroup>
                    <optgroup label="1st Floor (Family)">
                      <option value="T-3">T-3 (6 Seats) 🟢 Vacant</option>
                      <option value="T-4">T-4 (8 Seats) 🟢 Vacant</option>
                    </optgroup>
                  </>
                )}
              </select>
            </div>
          )}

          {/* Customer info preview for Delivery / Call Order */}
          {(orderType === 'Delivery' || orderType === 'CallOrder') && (
            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Customer: <strong>{customerName || 'Walk-in / Phone'}</strong></span>
                <span>{customerPhone}</span>
              </div>
              {deliveryAddress && (
                <div className="text-[10px] text-slate-400 truncate">{deliveryAddress}</div>
              )}
            </div>
          )}
        </div>

        {/* Cart Line Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
              <ShoppingBag className="w-12 h-12 stroke-[1.5] opacity-40" />
              <p className="text-xs">Cart is empty. Scan barcodes or tap items.</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.productId + (item.specialNotes || '')}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-white truncate">{item.productName}</div>
                  <div className="text-[10px] text-slate-400">
                    ₨{item.unitPricePKR} each
                    {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                      <span className="text-amber-400 ml-1">
                        (+{item.selectedModifiers.map(m => m.name).join(', ')})
                      </span>
                    )}
                  </div>
                  {item.specialNotes && (
                    <div className="text-[10px] text-emerald-400 italic truncate">*{item.specialNotes}</div>
                  )}
                </div>

                {/* Quantity Stepper */}
                <div className="flex items-center gap-1.5 bg-slate-900 px-1.5 py-0.5 rounded-lg border border-slate-800">
                  <button
                    onClick={() => updateQuantity(item.productId, -1)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-bold text-xs px-1 text-white">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.productId, 1)}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {/* Line Total */}
                <div className="text-right min-w-[65px]">
                  <div className="font-bold text-xs text-emerald-400">₨{item.totalPricePKR.toLocaleString()}</div>
                  <button
                    onClick={() => removeFromCart(item.productId)}
                    className="text-slate-500 hover:text-rose-400 p-0.5"
                  >
                    <Trash2 className="w-3 h-3 ml-auto" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bill Summary & Payment Trigger */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2.5">
          {/* Quick Payment Mode Selector directly on Cart */}
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex justify-between items-center">
              <span>Customer Payment Choice:</span>
              <span className="text-[9px] text-emerald-400 font-semibold">Card = 8% Tax | Cash = 16% Tax</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setPaymentMethod('Cash')}
                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  paymentMethod === 'Cash'
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Banknote className="w-3.5 h-3.5 text-amber-400" />
                <span>Cash (16% Tax)</span>
              </button>
              <button
                onClick={() => setPaymentMethod('Card')}
                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  paymentMethod !== 'Cash'
                    ? 'bg-emerald-600 text-slate-950 font-black shadow-md shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 text-slate-950" />
                <span>Card / Digital (8% Tax)</span>
              </button>
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="text-white font-medium">₨{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Discount (PKR):</span>
              <input
                type="number"
                min="0"
                value={discountPKR || ''}
                onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                placeholder="0"
                className="w-20 px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-right text-xs text-white"
              />
            </div>
            <div className="flex justify-between items-center">
              <span>
                Sales Tax ({getEffectiveTaxRate()}% {paymentMethod === 'Cash' ? 'Cash' : 'Card/Digital'}):
              </span>
              <span className="text-white font-medium">₨{tax.toLocaleString()}</span>
            </div>
            {taxMode === 'Inclusive' && (
              <div className="text-[10px] text-blue-400 italic">
                * Prices include {getEffectiveTaxRate()}% sales tax
              </div>
            )}
            {paymentMethod !== 'Cash' && (
              <div className="p-1 rounded bg-emerald-950/60 border border-emerald-800 text-[10px] text-emerald-400 font-semibold flex items-center justify-between">
                <span>💡 Digital Card Incentive:</span>
                <span>Customer Saves 8% Tax</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-slate-800 text-base font-black text-white">
              <span>Total (PKR):</span>
              <span className="text-emerald-400">₨{grandTotal.toLocaleString()}</span>
            </div>
          </div>



          {/* Action Buttons: Hold Tab & Charge */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={() => parkCurrentBill()}
              disabled={cart.length === 0}
              className="col-span-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center gap-1 transition disabled:opacity-40"
              title="Park Bill / Hold Ticket"
            >
              <PauseCircle className="w-4 h-4 text-purple-400" />
              <span>Hold Tab</span>
            </button>
            <button
              onClick={() => {
                setCashTendered(grandTotal);
                setIsCheckoutOpen(true);
              }}
              disabled={cart.length === 0}
              className="col-span-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 font-black text-sm tracking-wide shadow-lg shadow-emerald-500/20 transition disabled:opacity-40"
            >
              Pay ₨{grandTotal.toLocaleString()}
            </button>
          </div>
        </div>
      </div>

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">Tender & Settle Payment</h3>
                <p className="text-xs text-slate-400">Order Total: <strong className="text-emerald-400">₨{grandTotal.toLocaleString()}</strong></p>
              </div>
              <button onClick={() => setIsCheckoutOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Select Payment Mode
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'Cash', label: 'Cash', icon: Banknote },
                  { id: 'Card', label: 'POS Card', icon: CreditCard },
                  { id: 'JazzCash', label: 'JazzCash', icon: Smartphone },
                  { id: 'EasyPaisa', label: 'EasyPaisa', icon: Smartphone },
                  { id: 'Raast', label: 'Raast QR', icon: QrCode },
                  { id: 'CustomerKhata', label: 'Udhaar / Khata', icon: BookOpen },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setPaymentMethod(id as PaymentMethod)}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      paymentMethod === id
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Cash Tendered & Quick Tender Buttons */}
            {paymentMethod === 'Cash' && (
              <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-400">Cash Received (PKR):</label>
                  <input
                    type="number"
                    value={cashTendered || ''}
                    onChange={(e) => setCashTendered(Number(e.target.value) || 0)}
                    className="w-32 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-right font-black text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Fast Cash Buttons */}
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[grandTotal, 500, 1000, 5000].map((amt, i) => (
                    <button
                      key={i}
                      onClick={() => setQuickCash(amt)}
                      className="py-1.5 px-2 bg-slate-850 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-slate-200 text-center"
                    >
                      {i === 0 ? 'Exact' : `₨${amt}`}
                    </button>
                  ))}
                </div>

                {/* Change Due */}
                <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold text-slate-300">Change Due to Customer:</span>
                  <span className="text-lg font-black text-emerald-400">₨{changeDue.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Complete Button */}
            <button
              onClick={handleCompleteSale}
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-sm shadow-xl shadow-emerald-600/30 transition flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <span>Dispatching Order (Mode 1)...</span>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  <span>Confirm Sale & Print Receipt</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Held / Parked Tabs Drawer Modal */}
      {showParkedModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <PauseCircle className="w-4 h-4 text-purple-400" />
                <span>Held Bills / Open Customer Tabs</span>
              </h3>
              <button onClick={() => setShowParkedModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {parkedBills.map((bill) => {
                const billTotal = bill.items.reduce((s, i) => s + i.totalPricePKR, 0);
                return (
                  <div
                    key={bill.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-xs text-white">{bill.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {bill.items.length} items • Held at {bill.parkedAt}
                      </div>
                      <div className="text-xs font-bold text-emerald-400 mt-0.5">₨{billTotal.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => deleteParkedBill(bill.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-900"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          resumeParkedBill(bill.id);
                          setShowParkedModal(false);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        <span>Resume</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Product Modifiers Modal */}
      {activeProductForModifier && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-bold text-white text-sm">{activeProductForModifier.name}</h3>
              <button onClick={() => setActiveProductForModifier(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase">Custom Modifiers & Add-ons</label>
              <div className="space-y-1.5">
                {activeProductForModifier.modifiers?.map((mod) => {
                  const isChecked = selectedModifiers.some(m => m.id === mod.id);
                  return (
                    <button
                      key={mod.id}
                      onClick={() => {
                        if (isChecked) {
                          setSelectedModifiers(selectedModifiers.filter(m => m.id !== mod.id));
                        } else {
                          setSelectedModifiers([...selectedModifiers, mod]);
                        }
                      }}
                      className={`w-full p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition ${
                        isChecked
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span>{mod.name}</span>
                      <span className="font-bold text-emerald-400">+₨{mod.pricePKR}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Special Chef Notes</label>
              <input
                type="text"
                placeholder="e.g. Extra spicy, no onions, well done"
                value={itemNote}
                onChange={(e) => setItemNote(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
              />
            </div>

            <button
              onClick={() => {
                addToCart(activeProductForModifier, selectedModifiers, itemNote);
                setActiveProductForModifier(null);
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs shadow-lg"
            >
              Add to Cart
            </button>
          </div>
        </div>
      )}

      {/* 80mm Thermal Receipt Modal */}
      <ThermalReceiptModal
        order={completedOrder}
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        branchName={selectedBranch?.name || selectedTenant?.name}
        branchAddress={selectedBranch?.address}
        branchPhone={selectedBranch?.phone}
      />
    </div>
  );
};

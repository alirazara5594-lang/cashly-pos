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
  Lock,
  UserRound,
  Gift,
  Percent,
  Star
} from 'lucide-react';

import { usePosStore } from '../store/posStore';
import { posApi } from '../services/api';
import { offlineDb, cacheCatalog, getCachedCatalog, cacheDiningTables, getCachedDiningTables } from '../services/offlineDb';
import { getStoredTerminal } from '../services/deviceLicense';
import type { Product, Category, PaymentMethod, OrderType, Order, Customer } from '../types';
import { ThermalReceiptModal } from '../components/ThermalReceiptModal';
import { ManagerOverrideModal, type ManagerOverrideResult } from '../components/ManagerOverrideModal';
import { ProductCard } from '../components/ProductCard';
import { getEmoji } from '../utils/productEmoji';

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
    getEffectiveTaxRate,
    tenantSettings,
    permissions,
    setCustomerInfo
  } = usePosStore();

  // Retail/Cash & Carry has no dine-in tables — a shop counter sale is always an
  // immediate "take it with you" transaction.
  const isRetailBiz = selectedTenant?.businessType === 'Retail' || selectedTenant?.businessType === 'CashAndCarry';
  const orderTypeOptions = (isRetailBiz ? ['Takeaway', 'Delivery'] : ['DineIn', 'Takeaway', 'Delivery']) as OrderType[];

  useEffect(() => {
    if (isRetailBiz && orderType === 'DineIn') setOrderType('Takeaway');
  }, [isRetailBiz, orderType, setOrderType]);

  // ── Loyalty / promo / gift card extras. Every one of these is optional: leaving
  // the whole section untouched produces exactly the same order payload as before.
  const [lookupPhone, setLookupPhone] = useState('');
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [customerLookupState, setCustomerLookupState] = useState<'idle' | 'searching' | 'notfound'>('idle');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardRedeemAmount, setGiftCardRedeemAmount] = useState<number>(0);

  const handleCustomerLookup = async () => {
    const phone = lookupPhone.trim();
    if (!phone) return;
    setCustomerLookupState('searching');
    setMatchedCustomer(null);
    try {
      const customer = await posApi.lookupCustomer(phone);
      if (customer) {
        setMatchedCustomer(customer);
        setCustomerLookupState('idle');
        setCustomerInfo({ name: customer.fullName, phone: customer.phone });
      } else {
        setCustomerLookupState('notfound');
        setCustomerInfo({ phone });
      }
    } catch {
      // No profile / no endpoint — the sale proceeds without a loyalty attachment.
      setCustomerLookupState('notfound');
      setCustomerInfo({ phone });
    }
  };

  const resetCheckoutExtras = () => {
    setLookupPhone('');
    setMatchedCustomer(null);
    setCustomerLookupState('idle');
    setPromoCodeInput('');
    setGiftCardCode('');
    setGiftCardRedeemAmount(0);
  };

  // Discounts are a gated action. If this cashier lacks the flag they can still
  // apply one, but only after a manager authorizes it with their own PIN. The
  // server re-verifies the authorization before honouring the discount.
  const [discountOverride, setDiscountOverride] = useState<ManagerOverrideResult | null>(null);
  const [isDiscountOverrideOpen, setIsDiscountOverrideOpen] = useState(false);
  const canGiveDiscounts = !!permissions?.canGiveDiscounts || !!discountOverride;

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [tables, setTables] = useState<any[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);

  const [activeProductForModifier, setActiveProductForModifier] = useState<Product | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<any[]>([]);
  const [itemNote, setItemNote] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tenantId = selectedTenant?.id;
    const branchId = selectedBranch?.id;
    if (!tenantId) return;

    let cancelled = false;

    /**
     * Stale-while-revalidate: paint from the offline cache so the till opens instantly and
     * keeps trading through a dropped connection, then refresh from the server whenever it
     * is reachable.
     *
     * This used to fetch ONLY when the cache was empty, which meant a price changed in the
     * back office never reached the register — it went on charging the cached figure until
     * somebody cleared browser storage. The cache is a fallback for being offline, not a
     * substitute for the catalogue.
     */
    const loadCatalog = async () => {
      try {
        const cached = await getCachedCatalog(tenantId);
        if (!cancelled && cached.categories.length > 0) {
          setCategories(cached.categories);
          setProducts(cached.products);
        }

        if (!isOnline) return;

        const [cats, prods] = await Promise.all([
          posApi.getCategories(tenantId),
          posApi.getProducts({ tenantId })
        ]);
        if (cancelled) return;

        setCategories(cats);
        setProducts(prods);
        await cacheCatalog(tenantId, cats, prods);
      } catch (err) {
        console.error('Failed to load catalog:', err);
      }
    };

    const loadTables = async () => {
      if (!branchId) return;
      try {
        if (isOnline) {
          const tbls = await posApi.getTables(branchId);
          if (cancelled) return;
          setTables(tbls);
          await cacheDiningTables(tbls);
        } else {
          const cachedTables = await getCachedDiningTables(branchId);
          if (!cancelled) setTables(cachedTables);
        }
      } catch (err) {
        console.error('Failed to load tables:', err);
      }
    };

    loadCatalog();
    loadTables();

    // A register is typically left open all day. Without this, a price changed in the back
    // office at lunchtime would not reach it until someone reloaded the page — and the till
    // would keep charging the morning's price in the meantime.
    const revalidate = () => {
      if (!document.hidden) loadCatalog();
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [selectedTenant?.id, selectedBranch?.id, isOnline]);

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
      amountPaidPKR: grandTotal,
      changeDuePKR: 0,
      isPaid: true,
      cashierName: 'Counter 1 Cashier',
      createdByRole: 'Cashier',
      // Set when a manager authorized a discount this cashier can't normally give.
      discountAuthorizedByUserId: discountOverride?.authorizedByUserId,
      // Optional CRM extras — omitted entirely when the cashier skips that section.
      customerId: matchedCustomer?.id,
      promoCode: promoCodeInput.trim() || undefined,
      giftCardCode: giftCardCode.trim() || undefined,
      giftCardRedeemAmount: giftCardCode.trim() && giftCardRedeemAmount > 0 ? giftCardRedeemAmount : undefined,
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

        // The server ignores client-sent money fields and recomputes tax/totals
        // from DB prices (and, with provincial tax on, from the branch's
        // jurisdiction). Always print what it returns — the local figures were
        // only ever a live estimate for the cart UI.
        const serverSubTotal = res.subTotalPKR ?? subtotal;
        const serverDiscount = res.discountPKR ?? discountPKR;
        const serverTax = res.taxPKR ?? tax;
        const serverTotal = res.totalPKR ?? grandTotal;

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
          subTotalPKR: serverSubTotal,
          discountPKR: serverDiscount,
          taxPKR: serverTax,
          totalPKR: serverTotal,
          paymentMethod,
          amountPaidPKR: paymentMethod === 'Cash' ? (cashTendered || serverTotal) : serverTotal,
          changeDuePKR: paymentMethod === 'Cash' ? Math.max(0, (cashTendered || serverTotal) - serverTotal) : 0,
          isPaid: true,
          createdAt: res.createdAt ?? new Date().toISOString(),
          inKitchenAt: res.inKitchenAt ?? null,
          fiscalInvoiceNumber: res.fiscalInvoiceNumber ?? null,
          fiscalQrPayload: res.fiscalQrPayload ?? null,
          items: [...cart]
        };

        setCompletedOrder(newOrder);
      } else {
        const offlineId = `OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const capturedAt = new Date().toISOString();

        // clientLocalId is the sale's identity for the rest of its life. The server has a
        // unique index on it, so re-sending this batch after a dropped response records the
        // sale once rather than twice. It has to be generated HERE, at the moment of sale, and
        // never regenerated on retry — a fresh id on each attempt would defeat the whole point.
        //
        // Prefixed with the terminal so two tills that ring up at the same millisecond while
        // both offline cannot collide.
        const terminalId = getStoredTerminal()?.id ?? 'unpaired';
        const clientLocalId = `${terminalId}:${offlineId}`;

        await offlineDb.offlineOrders.add({
          localId: offlineId,
          // capturedAt is when the customer actually paid. Without it, a Tuesday outage lands
          // in Wednesday's Z-report.
          orderData: { ...orderPayload, clientLocalId, capturedAt },
          createdAt: capturedAt,
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
          changeDuePKR: 0,
          isPaid: true,
          createdAt: new Date().toISOString(),
          items: [...cart]
        };

        setCompletedOrder(newOrder);
      }

      setIsReceiptOpen(true);
      clearCart();
      // A manager override authorizes one bill only.
      setDiscountOverride(null);
      resetCheckoutExtras();
    } catch (err) {
      console.error('Order submission error:', err);
      alert('Failed to submit order. Please check network.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCategoryName = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    return cat?.name;
  };

  const allPaymentMethods = [
    { key: 'Cash', label: 'Cash', icon: Banknote },
    { key: 'Card', label: 'Card', icon: CreditCard },
    { key: 'JazzCash', label: 'JazzCash', icon: Smartphone },
    { key: 'EasyPaisa', label: 'EasyPaisa', icon: Smartphone },
    { key: 'Raast', label: 'Raast QR', icon: QrCode },
    { key: 'CustomerKhata', label: 'Khata', icon: BookOpen },
  ];

  const allowedMethods = tenantSettings?.allowedPaymentMethods?.split(',').map(m => m.trim()) || allPaymentMethods.map(m => m.key);
  const visiblePaymentMethods = allPaymentMethods.filter(m => allowedMethods.includes(m.key));

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-hidden bg-slate-50">
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search product name, local name, or SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition"
              />
            </div>

            <form onSubmit={handleBarcodeSubmit} className="relative flex-1 min-w-[200px]">
              <Barcode className="w-4 h-4 text-teal-500 absolute left-3 top-3" />
              <input
                ref={barcodeInputRef}
                type="text"
                placeholder="Scan Barcode (or type & press Enter)..."
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 font-mono focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition"
              />
            </form>

            {parkedBills.length > 0 && (
              <button
                onClick={() => setShowParkedModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-50 border border-purple-200 text-purple-600 text-xs font-bold hover:bg-purple-100 transition"
              >
                <PauseCircle className="w-4 h-4" />
                <span>Held Tabs ({parkedBills.length})</span>
              </button>
            )}
          </div>

          <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setSelectedCategoryId('all')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                selectedCategoryId === 'all'
                  ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
              }`}
            >
              All Items ({products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                  selectedCategoryId === cat.id
                    ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
                }`}
              >
                <span>{cat.name}</span>
                {cat.localName && <span className="text-[9px] block opacity-60">{cat.localName}</span>}
              </button>
            ))}
          </div>

          {/* content-start is load-bearing: this is a `flex-1` grid, so without it the default
              align-content:stretch spreads the leftover column height across the rows and a
              single row of products inflates to the full height of the terminal. */}
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 content-start auto-rows-min">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                categoryName={getCategoryName(product.categoryId)}
                accent="teal"
                onSelect={(p) => {
                  if (p.modifiers && p.modifiers.length > 0) {
                    setActiveProductForModifier(p);
                    setSelectedModifiers([]);
                    setItemNote('');
                  } else {
                    addToCart(p);
                  }
                }}
              />
            ))}
          </div>
        </div>

        <div className="w-full lg:w-96 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-xl m-2 ml-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {orderType === 'DineIn' ? (selectedTable || 'Select Table') : orderType === 'Takeaway' ? (isRetailBiz ? 'Counter Sale' : 'Takeaway') : orderType === 'Delivery' ? 'Delivery' : 'Phone Order'}
                </h2>
                <p className="text-xs text-slate-400">
                  {customerName || 'Walk-in Customer'}
                  {customerPhone ? ` • ${customerPhone}` : ''}
                </p>
              </div>
              {parkedBills.length > 0 && (
                <button
                  onClick={() => setShowParkedModal(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-600 text-[10px] font-bold hover:bg-purple-100 transition"
                >
                  <PauseCircle className="w-3 h-3" />
                  <span>{parkedBills.length}</span>
                </button>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              {orderTypeOptions.map((type) => (
                <button
                  key={type}
                  onClick={() => setOrderType(type)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition ${
                    orderType === type
                      ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {type === 'DineIn' ? 'Dine In' : type === 'Takeaway' ? (isRetailBiz ? 'Counter Sale' : 'Take Away') : 'Delivery'}
                </button>
              ))}
            </div>

            {orderType === 'DineIn' && !isRetailBiz && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">Table:</span>
                  <Link to="/floors" className="text-[10px] text-teal-500 hover:text-teal-600 font-bold">
                    + Manage
                  </Link>
                </div>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
                >
                  {tables.length > 0 ? (
                    Array.from(new Set(tables.map(t => t.section || 'Main Hall'))).map(floorName => (
                      <optgroup key={floorName} label={floorName}>
                        {tables
                          .filter(t => (t.section || 'Main Hall') === floorName)
                          .map(t => (
                            <option key={t.id} value={t.tableNumber}>
                              {t.tableNumber} ({t.capacity} Seats) {t.isOccupied ? '🔴' : '🟢'}
                            </option>
                          ))}
                      </optgroup>
                    ))
                  ) : (
                    <>
                      <optgroup label="Ground Floor">
                        <option value="T-1">T-1 (4 Seats) 🟢</option>
                        <option value="T-2">T-2 (4 Seats) 🟢</option>
                      </optgroup>
                      <optgroup label="1st Floor (Family)">
                        <option value="T-3">T-3 (6 Seats) 🟢</option>
                        <option value="T-4">T-4 (8 Seats) 🟢</option>
                      </optgroup>
                    </>
                  )}
                </select>
              </div>
            )}

            {(orderType === 'Delivery' || orderType === 'CallOrder') && customerName && (
              <div className="mt-3 p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] space-y-0.5">
                <div className="flex justify-between text-slate-600">
                  <span>Customer: <strong>{customerName}</strong></span>
                  <span>{customerPhone}</span>
                </div>
                {deliveryAddress && (
                  <div className="text-[10px] text-slate-400 truncate">{deliveryAddress}</div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <ShoppingBag className="w-8 h-8 stroke-[1.5] text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-500">Cart is empty</p>
                  <p className="text-xs text-slate-400 mt-0.5">Scan barcodes or tap items to add</p>
                </div>
              </div>
            ) : (
              cart.map((item) => {
                const catName = categories.find(c => c.id === products.find(p => p.id === item.productId)?.categoryId)?.name;
                return (
                  <div
                    key={item.productId + (item.specialNotes || '')}
                    className="flex items-start gap-3"
                  >
                    <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-lg flex-shrink-0">
                      {getEmoji(item.productName, catName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.productName}</p>
                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <p className="text-xs text-slate-400 truncate">
                          {item.selectedModifiers.map(m => m.name).join(', ')}
                        </p>
                      )}
                      {item.specialNotes && (
                        <p className="text-[10px] text-teal-500 italic truncate">*{item.specialNotes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 font-semibold border border-teal-200">Order Received</span>
                        <span className="text-[9px] text-slate-400">Counter 1</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          onClick={() => updateQuantity(item.productId, -1)}
                          className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold w-4 text-center text-slate-900">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.productId, 1)}
                          className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center text-white hover:bg-teal-600 transition"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-slate-900">{item.totalPricePKR.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">{item.unitPricePKR} ea</p>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        className="mt-1 text-slate-400 hover:text-rose-500 p-0.5 transition"
                      >
                        <Trash2 className="w-3 h-3 ml-auto" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-4 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Sub Total</span>
              <span className="font-medium text-slate-700">{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Sales Tax ({getEffectiveTaxRate()}% {paymentMethod === 'Cash' ? 'Cash' : 'Card/Digital'}):
              </span>
              <span className="font-medium text-slate-700">{tax.toLocaleString()}</span>
            </div>
            {taxMode === 'Inclusive' && (
              <div className="text-[10px] text-teal-500 italic">
                * Prices include {getEffectiveTaxRate()}% sales tax
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1">
                Discount
                {discountOverride && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 font-bold"
                    title={`Authorized by ${discountOverride.authorizedByName || 'a manager'}`}
                  >
                    OVERRIDE
                  </span>
                )}
              </span>
              {canGiveDiscounts ? (
                <input
                  type="number"
                  min="0"
                  value={discountPKR || ''}
                  onChange={(e) => setDiscount(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="w-20 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              ) : (
                <button
                  onClick={() => setIsDiscountOverrideOpen(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-[10px] font-bold transition cursor-pointer"
                  title="You are not authorized to give discounts — a manager can approve this one"
                >
                  <Lock className="w-3 h-3" />
                  Manager
                </button>
              )}
            </div>
            {paymentMethod !== 'Cash' && (
              <div className="p-1.5 rounded-lg bg-teal-50 border border-teal-200 text-[10px] text-teal-600 font-semibold flex items-center justify-between">
                <span>Digital Card Incentive:</span>
                <span>Customer Saves 8% Tax</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-100 pt-2">
              <span>TOTAL</span>
              <span className="text-teal-600">{grandTotal.toLocaleString()}</span>
            </div>
          </div>

          {/* Optional customer / promo / gift-card attachments. Everything here can be
              skipped — the checkout below works exactly as it always has. */}
          <div className="p-4 border-t border-slate-100 space-y-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Customer & Offers (optional)</div>

            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <UserRound className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={lookupPhone}
                  onChange={(e) => { setLookupPhone(e.target.value); setCustomerLookupState('idle'); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCustomerLookup(); }}
                  placeholder="Customer phone"
                  className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>
              <button
                onClick={handleCustomerLookup}
                disabled={customerLookupState === 'searching' || !lookupPhone.trim()}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-[11px] font-bold transition disabled:opacity-40"
              >
                {customerLookupState === 'searching' ? '…' : 'Look Up'}
              </button>
            </div>

            {matchedCustomer && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 truncate">{matchedCustomer.fullName}</span>
                <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 shrink-0">
                  <Star className="w-3 h-3" />
                  {(matchedCustomer.loyaltyPoints ?? 0).toLocaleString()} pts
                </span>
              </div>
            )}
            {customerLookupState === 'notfound' && (
              <p className="text-[10px] text-slate-400">
                No loyalty profile for that number — the sale will still go through.
              </p>
            )}

            <div className="relative">
              <Percent className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                placeholder="Promo code"
                className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold tracking-wider text-slate-900 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Gift className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={giftCardCode}
                  onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
                  placeholder="Gift card code"
                  className="w-full pl-7 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold tracking-wider text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>
              <input
                type="number"
                min="0"
                value={giftCardRedeemAmount || ''}
                onChange={(e) => setGiftCardRedeemAmount(Number(e.target.value) || 0)}
                placeholder="PKR"
                className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-[11px] text-slate-900 focus:outline-none focus:border-teal-500"
              />
            </div>
            <p className="text-[10px] text-slate-400">
              Promo and gift-card amounts are validated and applied by the server on submit.
            </p>
          </div>

          <div className="p-4 border-t border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Payment Method</div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {visiblePaymentMethods.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setPaymentMethod(key as PaymentMethod)}
                  className={`py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${
                    paymentMethod === key
                      ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                      : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {paymentMethod === 'Cash' && (
              <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-500">Cash Received</label>
                  <input
                    type="number"
                    value={cashTendered || ''}
                    onChange={(e) => setCashTendered(Number(e.target.value) || 0)}
                    className="w-28 px-2 py-1 bg-white border border-slate-200 rounded-lg text-right font-black text-slate-900 text-xs focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[grandTotal, 500, 1000, 5000].map((amt, i) => (
                    <button
                      key={i}
                      onClick={() => setCashTendered(amt)}
                      className="py-1.5 px-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 text-center transition"
                    >
                      {i === 0 ? 'Exact' : `${amt}`}
                    </button>
                  ))}
                </div>
                {cashTendered > 0 && (
                  <div className="flex justify-between items-center pt-1.5 border-t border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-500">Change Due:</span>
                    <span className="text-sm font-black text-teal-600">{Math.max(0, cashTendered - grandTotal).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 mb-3">
              <button
                onClick={() => parkCurrentBill()}
                disabled={cart.length === 0}
                className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <PauseCircle className="w-4 h-4" />
                <span>Hold</span>
              </button>
              <button
                disabled={cart.length === 0}
                className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <span>Print</span>
              </button>
              <button
                onClick={() => {
                  setCashTendered(grandTotal);
                  handleCompleteSale();
                }}
                disabled={cart.length === 0 || isSubmitting}
                className="py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-lg shadow-teal-500/25 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? (
                  <span>Charging...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Charge {grandTotal.toLocaleString()}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!isRetailBiz && (
      <div className="bg-white border-t border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {tables.length > 0 ? (
          tables.slice(0, 15).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setOrderType('DineIn');
                setSelectedTable(t.tableNumber);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                orderType === 'DineIn' && selectedTable === t.tableNumber
                  ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                  : t.isOccupied
                    ? 'bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.tableNumber}
            </button>
          ))
        ) : (
          <>
            {['T1', 'T2', 'T3'].map((t) => (
              <button
                key={t}
                onClick={() => {
                  setOrderType('DineIn');
                  setSelectedTable(t);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  selectedTable === t
                    ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </>
        )}
        <Link
          to="/floors"
          className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold hover:bg-slate-200 transition whitespace-nowrap"
        >
          + Add Table
        </Link>
      </div>
      )}

      {showParkedModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <PauseCircle className="w-4 h-4 text-purple-500" />
                <span>Held Bills / Open Customer Tabs</span>
              </h3>
              <button onClick={() => setShowParkedModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {parkedBills.map((bill) => {
                const billTotal = bill.items.reduce((s, i) => s + i.totalPricePKR, 0);
                return (
                  <div
                    key={bill.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-xs text-slate-900">{bill.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {bill.items.length} items • Held at {bill.parkedAt}
                      </div>
                      <div className="text-xs font-bold text-teal-600 mt-0.5">{billTotal.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => deleteParkedBill(bill.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          resumeParkedBill(bill.id);
                          setShowParkedModal(false);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold shadow transition"
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

      {activeProductForModifier && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-bold text-slate-900 text-sm">{activeProductForModifier.name}</h3>
              <button onClick={() => setActiveProductForModifier(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase">Custom Modifiers & Add-ons</label>
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
                          ? 'bg-teal-50 border-teal-500 text-teal-600'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <span>{mod.name}</span>
                      <span className="font-bold text-teal-600">+{mod.pricePKR}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Special Chef Notes</label>
              <input
                type="text"
                placeholder="e.g. Extra spicy, no onions, well done"
                value={itemNote}
                onChange={(e) => setItemNote(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
              />
            </div>

            <button
              onClick={() => {
                addToCart(activeProductForModifier, selectedModifiers, itemNote);
                setActiveProductForModifier(null);
              }}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-lg shadow-teal-500/25 transition"
            >
              Add to Cart
            </button>
          </div>
        </div>
      )}

      <ThermalReceiptModal
        order={completedOrder}
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        branchName={selectedBranch?.name || selectedTenant?.name}
        branchAddress={selectedBranch?.address}
        branchPhone={selectedBranch?.phone}
      />

      <ManagerOverrideModal
        isOpen={isDiscountOverrideOpen}
        onClose={() => setIsDiscountOverrideOpen(false)}
        requiredPermission="canGiveDiscounts"
        actionLabel="Apply a discount to this bill"
        onAuthorized={(result) => setDiscountOverride(result)}
      />
    </div>
  );
};

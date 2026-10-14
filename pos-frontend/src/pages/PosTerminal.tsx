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
  Star,
  AlertTriangle,
  CalendarClock,
  FileText,
  ChevronDown,
  Printer
} from 'lucide-react';

import { usePosStore } from '../store/posStore';
import { useSector } from '../hooks/useSector';
import { posApi, getApiErrorMessage } from '../services/api';
import { offlineDb, cacheCatalog, getCachedCatalog, cacheDiningTables, getCachedDiningTables } from '../services/offlineDb';
import { getStoredTerminal } from '../services/deviceLicense';
import type { Product, Category, PaymentMethod, OrderType, Order, Customer, ExpirySummary, PrescriptionInput } from '../types';
import { daysUntil, formatDay } from '../utils/expiry';
import { isSubstitute, saleUnitOptions, formatPacked, looseUnitName } from '../utils/medicine';
import { ThermalReceiptModal } from '../components/ThermalReceiptModal';
import { ManagerOverrideModal, type ManagerOverrideResult } from '../components/ManagerOverrideModal';
import { ProductCard } from '../components/ProductCard';
import { SubstitutesPanel, type SubstitutesReason } from '../components/SubstitutesPanel';
import { PrescriptionModal } from '../components/PrescriptionModal';
import { emptyPrescription, prescriptionNeeds, prescriptionProblem } from '../utils/prescription';
import { cartTax } from '../utils/tax';
import { getEmoji } from '../utils/productEmoji';

export const PosTerminal: React.FC = () => {
  const {
    selectedBranch,
    selectedTenant,
    cart,
    addToCart,
    removeFromCart,
    updateQuantity,
    setLineSaleUnit,
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

  // Only a business with table service has dine-in tables (hooks/useSector.ts); everywhere else
  // — a shop, a pharmacy — a counter sale is always an immediate "take it with you" transaction.
  const { tableService, batchExpiry, medicines } = useSector();
  const noTables = !tableService;
  const orderTypeOptions = (noTables ? ['Takeaway', 'Delivery'] : ['DineIn', 'Takeaway', 'Delivery']) as OrderType[];

  useEffect(() => {
    if (noTables && orderType === 'DineIn') setOrderType('Takeaway');
  }, [noTables, orderType, setOrderType]);

  // The till takes cash or card only; a method left over from before falls back to cash.
  useEffect(() => {
    if (paymentMethod !== 'Cash' && paymentMethod !== 'Card') setPaymentMethod('Cash');
  }, [paymentMethod, setPaymentMethod]);

  // ── Loyalty / promo / gift card extras. Every one of these is optional: leaving
  // the whole section untouched produces exactly the same order payload as before.
  const [lookupPhone, setLookupPhone] = useState('');
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [customerLookupState, setCustomerLookupState] = useState<'idle' | 'searching' | 'notfound'>('idle');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardRedeemAmount, setGiftCardRedeemAmount] = useState<number>(0);
  // Folded away in the cart until the cashier opens it, so the checkout is always in view.
  const [showExtras, setShowExtras] = useState(false);
  const extrasInUse = !!(lookupPhone.trim() || matchedCustomer || promoCodeInput.trim() || giftCardCode.trim());

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

  // A pharmacy's prescription for this bill (utils/prescription.ts): one per sale, covering every
  // prescription-only and controlled medicine on it. It belongs to this customer, so it goes with
  // the sale, and is dropped when the bill is held or the next one starts.
  const [prescription, setPrescription] = useState<PrescriptionInput | null>(null);
  const [rxDialog, setRxDialog] = useState<{ charge: boolean; error?: string } | null>(null);

  const resetCheckoutExtras = () => {
    setLookupPhone('');
    setMatchedCustomer(null);
    setCustomerLookupState('idle');
    setPromoCodeInput('');
    setGiftCardCode('');
    setGiftCardRedeemAmount(0);
    setShowExtras(false);
    setPrescription(null);
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

  // A business whose stock has batches (a pharmacy, a grocery): per product counted here, what can
  // still be sold before expiry and what already has expired. Expired stock is never rung up; stock
  // within a month of expiry is flagged as it goes in the cart. Offline, the till keeps what it last knew.
  const branchId = selectedBranch?.id;

  // The tax this branch charges, as the server works it out (Tax Setup): its rates, whether prices
  // include tax, and the NTN / STRN for the receipt. Loaded again when the till comes back online.
  const loadBranchTax = usePosStore(s => s.loadBranchTax);
  const branchTax = usePosStore(s => s.branchTax);
  useEffect(() => {
    if (branchId) void loadBranchTax(branchId);
  }, [branchId, isOnline, loadBranchTax]);

  const [expiryByProduct, setExpiryByProduct] = useState<Map<string, ExpirySummary>>(() => new Map());
  const [expiryRefresh, setExpiryRefresh] = useState(0);
  const [expiryNotice, setExpiryNotice] = useState<{ tone: 'block' | 'warn'; text: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!batchExpiry || !branchId || !isOnline) return;
    let cancelled = false;
    const load = () => posApi.getExpirySummary(branchId)
      .then(rows => { if (!cancelled) setExpiryByProduct(new Map(rows.map(r => [r.productId, r]))); })
      .catch(() => { /* keeps what it last knew */ });
    load();
    const revalidate = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    // Batches expire at midnight. A till left open overnight reloads then (and schedules the next
    // midnight), so yesterday's last-day stock is stopped from the first sale of the new day.
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const midnightTimer = window.setTimeout(() => setExpiryRefresh(n => n + 1), nextMidnight.getTime() - now.getTime());
    return () => {
      cancelled = true;
      window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [batchExpiry, branchId, isOnline, expiryRefresh]);

  const showExpiryNotice = (tone: 'block' | 'warn', text: string) => {
    setExpiryNotice({ tone, text });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setExpiryNotice(null), tone === 'block' ? 7000 : 4500);
  };

  /** What the cart takes from this product's stock: tablets, for a medicine sold by the box or strip. */
  const cartQtyOf = (productId: string) =>
    cart.filter(i => i.productId === productId).reduce((n, i) => n + i.quantity * (i.unitsPerSaleUnit ?? 1), 0);

  /** A product's stock as it is counted: "5 boxes + 4 tablets" for a medicine sold loose. */
  const stockLabel = (productId: string, qty: number) => {
    const product = products.find(p => p.id === productId);
    return product ? formatPacked(qty, product.packUnits, looseUnitName(product.dosageForm)) : qty.toLocaleString();
  };

  /** False (with the reason shown) when the cart would hold more than can be sold before expiry. */
  const expiryAllows = (productId: string, productName: string, wanted: number, alreadyInCart: boolean) => {
    const info = expiryByProduct.get(productId);
    if (!info) return true;
    if (info.expiredQty > 0 && wanted > info.sellableQty) {
      showExpiryNotice('block', info.sellableQty <= 0
        ? `${productName}: all the stock here has expired (${stockLabel(productId, info.expiredQty)}). It cannot be sold — take it off the shelf.`
        : `${productName}: only ${stockLabel(productId, info.sellableQty)} can be sold. The other ${stockLabel(productId, info.expiredQty)} have expired.`);
      return false;
    }
    if (!alreadyInCart && info.nearestExpiry) {
      const days = daysUntil(info.nearestExpiry);
      if (days <= 30) {
        showExpiryNotice('warn', `${productName} expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} (${formatDay(info.nearestExpiry)}). Tell the customer.`);
      }
    }
    return true;
  };

  // A pharmacy offers another brand of the same medicine (utils/medicine.ts): asked for from a card,
  // or by itself when the one picked has expired or shows no stock here.
  type Modifiers = Parameters<typeof addToCart>[1];
  const [substitutesFor, setSubstitutesFor] = useState<{
    product: Product; reason: SubstitutesReason; modifiers?: Modifiers; notes?: string;
  } | null>(null);

  /** What can still be sold here beyond what the cart holds; null when this location does not count it. */
  const availableQty = (productId: string) => {
    const info = expiryByProduct.get(productId);
    return info ? info.sellableQty - cartQtyOf(productId) : null;
  };

  /** Same formula, strength and form, in stock here, cheapest first. */
  const substitutesOf = (product: Product) => products
    .filter(p => isSubstitute(product, p) && (availableQty(p.id) ?? 0) > 0)
    .sort((a, b) => a.sellingPricePKR - b.sellingPricePKR);

  const addProduct = (product: Product, modifiers?: Modifiers, notes?: string, anyway = false) => {
    const inCart = cartQtyOf(product.id);
    const left = availableQty(product.id);
    if (medicines && !anyway && left != null && left < 1 && substitutesOf(product).length > 0) {
      const expired = (expiryByProduct.get(product.id)?.expiredQty ?? 0) > 0;
      setSubstitutesFor({ product, reason: expired ? 'expired' : 'out', modifiers, notes });
      return;
    }
    // A medicine sold loose goes in as a box; the cart line switches it to a strip or a tablet.
    const box = saleUnitOptions(product)[0];
    if (!expiryAllows(product.id, product.name, inCart + (box?.units ?? 1), inCart > 0)) return;
    addToCart(product, modifiers, notes, box);
  };

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

        // With the branch, the list is what THIS branch sells at the prices it charges.
        const [cats, prods] = await Promise.all([
          posApi.getCategories(tenantId),
          posApi.getProducts({ tenantId, branchId })
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
      addProduct(matched);
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
      p.barcode.includes(searchTerm) ||
      // A medicine is asked for by its formula as often as by its brand.
      (p.genericName && p.genericName.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const subtotal = getSubTotal();
  const tax = getTaxAmount();
  const grandTotal = getTotal();

  const rxNeeds = medicines ? prescriptionNeeds(cart, products) : { any: false, names: [], controlledNames: [] };
  const rxMissing = rxNeeds.any ? prescriptionProblem(prescription, rxNeeds.controlledNames.length > 0) : null;

  /** `rxGiven`: the prescription just saved, when it is what opened the way to charging. */
  const handleCompleteSale = async (rxGiven?: PrescriptionInput) => {
    if (cart.length === 0) return;
    // A prescription-only or controlled medicine is sold against a prescription — asked for here,
    // so it is taken even when the till is offline.
    const rx = rxGiven ?? prescription;
    if (rxNeeds.any && prescriptionProblem(rx, rxNeeds.controlledNames.length > 0)) {
      setRxDialog({ charge: true });
      return;
    }
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
        station: i.station || 'MainKitchen',
        saleUnit: i.saleUnit
      })),
      // With its photo: an offline sale carries both until it syncs.
      prescription: rxNeeds.any && rx ? rx : undefined
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
          // The server's tax by rate; the till's own as a fallback (an older server sends none).
          taxLines: res.taxLines ?? cartTax(cart, discountPKR, getEffectiveTaxRate(), taxMode === 'Inclusive', branchTax?.decimals ?? 0).lines,
          items: [...cart]
        };

        setCompletedOrder(newOrder);
        setExpiryRefresh(n => n + 1);
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
          taxLines: cartTax(cart, discountPKR, getEffectiveTaxRate(), taxMode === 'Inclusive', branchTax?.decimals ?? 0).lines,
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
      // The server asks for the same prescription the till does; when it still refuses, say why there.
      const refusal = (err as { response?: { data?: { prescriptionRequired?: boolean } } }).response?.data;
      if (refusal?.prescriptionRequired) {
        setRxDialog({ charge: true, error: getApiErrorMessage(err, 'This sale needs a prescription.') });
      } else {
        alert(getApiErrorMessage(err, 'Failed to submit order. Please check network.'));
      }
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
  // The till takes cash or card, nothing else.
  const primaryMethods = visiblePaymentMethods.filter(m => m.key === 'Cash' || m.key === 'Card');
  const gridCols: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };
  // The notes a customer hands over, from the bill: exact, then the next 500, 1,000 and 5,000.
  const quickCash = Array.from(new Set([grandTotal, ...[500, 1000, 5000].map(n => Math.max(n, Math.ceil(grandTotal / n) * n))]));
  const cashShort = cashTendered > 0 && cashTendered < grandTotal;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-hidden bg-slate-50">
      {expiryNotice && (
        <div
          role={expiryNotice.tone === 'block' ? 'alert' : 'status'}
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,520px)] px-4 py-3 rounded-xl border shadow-xl flex items-start gap-2.5 text-sm ${
            expiryNotice.tone === 'block' ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}
        >
          {expiryNotice.tone === 'block'
            ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            : <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1 font-medium">{expiryNotice.text}</span>
          <button onClick={() => setExpiryNotice(null)} className="opacity-60 hover:opacity-100 transition" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Products and the cart side by side from tablet width up; stacked on a phone. */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder={medicines ? 'Search medicine, formula or barcode...' : 'Search product name, local name, or SKU...'}
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
                    addProduct(p);
                  }
                }}
                onSubstitutes={medicines && product.genericName ? (p) => setSubstitutesFor({ product: p, reason: 'asked' }) : undefined}
              />
            ))}
          </div>
        </div>

        {/* The cart: its header, the items (the only part that scrolls), and the checkout pinned at
            the bottom — so the total, the payment and Charge are always in view, however long the bill. */}
        <div className="h-[60%] shrink-0 md:h-auto md:shrink md:w-80 lg:w-96 flex flex-col min-h-0 bg-white border border-slate-200 rounded-2xl shadow-xl m-2 md:ml-0 overflow-hidden">
          <div className="px-4 pt-3 pb-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  {orderType === 'DineIn' ? (selectedTable || 'Select Table') : orderType === 'Takeaway' ? (noTables ? 'Counter Sale' : 'Takeaway') : orderType === 'Delivery' ? 'Delivery' : 'Phone Order'}
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
            <div className="flex gap-2 mt-2">
              {orderTypeOptions.map((type) => (
                <button
                  key={type}
                  onClick={() => setOrderType(type)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition ${
                    orderType === type
                      ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {type === 'DineIn' ? 'Dine In' : type === 'Takeaway' ? (noTables ? 'Counter Sale' : 'Take Away') : 'Delivery'}
                </button>
              ))}
            </div>

            {orderType === 'DineIn' && !noTables && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium shrink-0">Table</span>
                <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
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
                <Link to="/floors" className="text-[10px] text-teal-500 hover:text-teal-600 font-bold shrink-0">
                  + Manage
                </Link>
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

          <div className="flex-1 min-h-0 overflow-y-auto">
           <div className="p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="py-6 flex flex-col items-center justify-center text-slate-400 space-y-3">
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
                const product = products.find(p => p.id === item.productId);
                const catName = categories.find(c => c.id === product?.categoryId)?.name;
                // A medicine sold loose: box, strip or tablet, switched on the line itself.
                const unitOptions = product && item.saleUnit ? saleUnitOptions(product) : [];
                const lineUnits = item.quantity * (item.unitsPerSaleUnit ?? 1);
                return (
                  <div
                    key={item.productId + (item.specialNotes || '') + (item.saleUnit || '')}
                    className="flex items-start gap-3"
                  >
                    <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-lg flex-shrink-0">
                      {getEmoji(item.productName, catName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{item.productName}</p>
                      {unitOptions.length > 1 && (
                        <div className="flex items-center gap-1 mt-1" role="group" aria-label={`Sell ${item.productName} by`}>
                          {unitOptions.map(opt => (
                            <button
                              key={opt.unit}
                              aria-pressed={opt.unit === item.saleUnit}
                              onClick={() => {
                                if (opt.unit === item.saleUnit) return;
                                const wanted = cartQtyOf(item.productId) - lineUnits + item.quantity * opt.units;
                                if (expiryAllows(item.productId, item.productName, wanted, true)) {
                                  setLineSaleUnit(item.productId, item.saleUnit, item.specialNotes, opt);
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded-md border text-[10px] font-semibold transition ${
                                opt.unit === item.saleUnit
                                  ? 'bg-teal-500 border-teal-500 text-white'
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-teal-300'
                              }`}
                            >
                              {opt.label} <span className="font-normal opacity-80">{opt.price.toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      )}
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
                        {(() => {
                          const next = expiryByProduct.get(item.productId)?.nearestExpiry;
                          if (!next || daysUntil(next) > 30) return null;
                          return (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200 inline-flex items-center gap-1">
                              <CalendarClock className="w-2.5 h-2.5" />
                              Exp {formatDay(next)}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          onClick={() => updateQuantity(item.productId, -1, item.saleUnit)}
                          className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold w-4 text-center text-slate-900">{item.quantity}</span>
                        <button
                          onClick={() => {
                            // Every line of this product in this unit goes up by one.
                            const adding = cart.filter(i => i.productId === item.productId && i.saleUnit === item.saleUnit)
                              .reduce((n, i) => n + (i.unitsPerSaleUnit ?? 1), 0);
                            if (expiryAllows(item.productId, item.productName, cartQtyOf(item.productId) + adding, true)) {
                              updateQuantity(item.productId, 1, item.saleUnit);
                            }
                          }}
                          className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center text-white hover:bg-teal-600 transition"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-slate-900">{item.totalPricePKR.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">
                        {item.unitPricePKR} {item.saleUnitLabel ? `/ ${item.saleUnitLabel.toLowerCase()}` : 'ea'}
                      </p>
                      <button
                        onClick={() => removeFromCart(item.productId, item.saleUnit)}
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

            {/* Optional customer / promo / gift-card attachments, folded into one line so they never
                push the checkout out of view. Everything here can be skipped. */}
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => setShowExtras(v => !v)}
                aria-expanded={showExtras}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-200 text-[11px] font-semibold text-slate-500 hover:border-teal-300 hover:text-teal-700 transition"
              >
                <span className="flex items-center gap-1.5">
                  <UserRound className="w-3.5 h-3.5" /> Customer, promo or gift card
                  {extrasInUse && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 text-[9px] font-bold">Added</span>}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition ${showExtras ? 'rotate-180' : ''}`} />
              </button>
              {showExtras && (
                <div className="mt-2.5 space-y-2.5">
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
              )}
            </div>
          </div>

          {/* The checkout, always in view: totals, prescription, payment and Charge. */}
          <div className="shrink-0 border-t border-slate-100 px-4 py-3 space-y-2">
           <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Sub Total</span>
              <span className="font-medium text-slate-700">{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {/* Items taxed their own way (exempt, own rate) make one rate meaningless. */}
                {cart.some(i => i.taxTreatment && i.taxTreatment !== 'Standard')
                  ? 'Sales Tax (by item):'
                  : `Sales Tax (${getEffectiveTaxRate()}% ${paymentMethod === 'Cash' ? 'Cash' : 'Card/Digital'}):`}
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
           </div>
            <div className="flex justify-between text-base font-bold text-slate-900 border-t border-slate-100 pt-2">
              <span>TOTAL</span>
              <span className="text-teal-600">{grandTotal.toLocaleString()}</span>
            </div>

            {rxNeeds.any && (
              <div className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 ${
                rxMissing ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-teal-50 border-teal-200 text-teal-900'
              }`}>
                <FileText className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  {rxMissing || !prescription ? (
                    <>
                      <span className="font-semibold">Prescription needed</span>
                      <span className="block text-[11px] opacity-80 truncate">
                        {rxNeeds.controlledNames.length > 0 ? 'Controlled: with CNIC and doctor reg. no.' : rxNeeds.names.join(', ')}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold truncate block">{prescription.patientName}</span>
                      <span className="block text-[11px] opacity-80 truncate">
                        {prescription.doctorName}{prescription.photoDataUrl ? ' · photo taken' : ''}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setRxDialog({ charge: false })}
                  className="px-2 py-1 rounded-lg bg-white/70 border border-slate-200 font-bold hover:bg-white transition"
                >
                  {prescription ? 'Edit' : 'Add'}
                </button>
              </div>
            )}
            {/* How the customer pays: cash or card. */}
            {primaryMethods.length > 0 && (
              <div role="radiogroup" aria-label="Payment method" className={`grid gap-2 ${gridCols[primaryMethods.length]}`}>
                {primaryMethods.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={paymentMethod === key}
                    onClick={() => setPaymentMethod(key as PaymentMethod)}
                    className={`py-2.5 rounded-xl border text-sm font-bold transition flex items-center justify-center gap-2 ${
                      paymentMethod === key
                        ? 'bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-600/25'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:bg-teal-50/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Cash: what the customer handed over, the change (or what is still short), and the
                notes they are likely to give, worked out from the bill. */}
            {paymentMethod === 'Cash' ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex items-center rounded-lg border border-slate-200 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
                    <span className="pl-2.5 text-[11px] font-semibold text-slate-500 shrink-0">Received</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="Cash received"
                      value={cashTendered || ''}
                      onChange={(e) => setCashTendered(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="flex-1 min-w-0 px-2 py-1.5 bg-transparent text-right text-sm font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none"
                    />
                  </label>
                  <div className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 ${
                    cashShort ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : cashTendered > 0 ? 'bg-teal-50 border-teal-200 text-teal-700'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}>
                    <span className="text-[11px] font-semibold">{cashShort ? 'Short' : 'Change'}</span>
                    <span className="text-sm font-bold">{cashTendered > 0 ? Math.abs(cashTendered - grandTotal).toLocaleString() : '—'}</span>
                  </div>
                </div>
                <div className={`grid gap-1.5 ${gridCols[quickCash.length]}`}>
                  {quickCash.map((amt, i) => (
                    <button
                      key={amt}
                      onClick={() => setCashTendered(amt)}
                      className={`py-1.5 rounded-lg border text-[11px] font-bold transition ${
                        cashTendered === amt
                          ? 'bg-teal-50 border-teal-300 text-teal-700'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {i === 0 ? 'Exact' : amt.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            ) : paymentMethod === 'Card' ? (
              <p className="text-[11px] text-slate-500 px-0.5">Take the payment on the card machine, then press Charge.</p>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  parkCurrentBill();
                  setPrescription(null);
                }}
                disabled={cart.length === 0}
                title="Hold this bill"
                className="px-3 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <PauseCircle className="w-4 h-4" />
                <span>Hold</span>
              </button>
              <button
                disabled={cart.length === 0}
                title="Print the bill"
                className="px-3 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden lg:inline">Print</span>
              </button>
              <button
                onClick={() => {
                  setCashTendered(grandTotal);
                  handleCompleteSale();
                }}
                disabled={cart.length === 0 || isSubmitting}
                className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-lg shadow-teal-600/25 transition disabled:opacity-40 flex items-center justify-center gap-2"
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

      {!noTables && (
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
                          setPrescription(null);
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
                addProduct(activeProductForModifier, selectedModifiers, itemNote);
                setActiveProductForModifier(null);
              }}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-lg shadow-teal-500/25 transition"
            >
              Add to Cart
            </button>
          </div>
        </div>
      )}

      {rxDialog && (
        <PrescriptionModal
          initial={prescription ?? emptyPrescription()}
          names={rxNeeds.names}
          controlledNames={rxNeeds.controlledNames}
          saveLabel={rxDialog.charge ? `Save and charge ${grandTotal.toLocaleString()}` : 'Save'}
          initialError={rxDialog.error}
          onSave={(rx) => {
            setPrescription(rx);
            const charge = rxDialog.charge;
            setRxDialog(null);
            if (charge) void handleCompleteSale(rx);
          }}
          onClose={() => setRxDialog(null)}
        />
      )}

      {substitutesFor && (
        <SubstitutesPanel
          product={substitutesFor.product}
          reason={substitutesFor.reason}
          options={substitutesOf(substitutesFor.product)}
          stockOf={(id) => {
            const left = availableQty(id);
            return { available: left == null ? null : stockLabel(id, left), nearestExpiry: expiryByProduct.get(id)?.nearestExpiry ?? null };
          }}
          onAdd={(sub) => {
            setSubstitutesFor(null);
            addProduct(sub);
          }}
          onAddAnyway={() => {
            setSubstitutesFor(null);
            addProduct(substitutesFor.product, substitutesFor.modifiers, substitutesFor.notes, true);
          }}
          onClose={() => setSubstitutesFor(null)}
        />
      )}

      <ThermalReceiptModal
        order={completedOrder}
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        branchName={selectedBranch?.name || selectedTenant?.name}
        branchAddress={selectedBranch?.address}
        branchPhone={selectedBranch?.phone}
        legalName={branchTax?.legalName}
        ntn={branchTax?.ntn}
        strn={branchTax?.strn}
        pricesIncludeTax={branchTax?.pricesIncludeTax}
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

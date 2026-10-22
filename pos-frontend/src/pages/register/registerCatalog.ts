import { Pill, ShoppingBag, ShoppingCart, Store, UtensilsCrossed } from 'lucide-react';
import type { BusinessType, PublicPackage, SubscriptionTier } from '../../types';

// ============================================================
// What registration offers, in each trade's own words.
//
// The plans are the same three everywhere (Starter, Standard, Enterprise — FeatureCatalog.cs on
// the server); what they MEAN differs by business. A pharmacy owner choosing a plan needs to read
// "batches, expiry and the controlled register", not "kitchen screens".
// ============================================================

/** Which product the business is registering for. */
export type ProductKind = 'pos' | 'erp';

export type KindId = 'restaurant' | 'retail' | 'pharmacy' | 'grocery';

export interface BusinessKind {
  id: KindId;
  /** The legacy business type the server keeps. */
  type: BusinessType;
  /** The sector pack (Data/VerticalPacks.cs): decides the screens the business gets. */
  pack: string;
  label: string;
  hint: string;
  icon: typeof Store;
  /** Food businesses start with a few sample items to try a sale with. */
  food: boolean;
}

export const BUSINESS_KINDS: BusinessKind[] = [
  { id: 'restaurant', type: 'Restaurant', pack: 'restaurant', label: 'Restaurant or café', hint: 'Dine-in, takeaway, delivery', icon: UtensilsCrossed, food: true },
  { id: 'retail', type: 'Retail', pack: 'retail', label: 'Retail store', hint: 'Shops and boutiques', icon: ShoppingBag, food: false },
  { id: 'pharmacy', type: 'Retail', pack: 'pharmacy', label: 'Pharmacy', hint: 'Medicines, batches, expiry', icon: Pill, food: false },
  { id: 'grocery', type: 'CashAndCarry', pack: 'grocery', label: 'Mart or cash & carry', hint: 'Grocery and wholesale', icon: ShoppingCart, food: false }
  // "Café with a shop" is not offered: it got exactly the restaurant's screens. A café registers as
  // a restaurant until food-and-retail together is built (restaurant plus retail selling).
];

export const PLANS: SubscriptionTier[] = ['Starter', 'Standard', 'Professional'];
export const planName = (tier: SubscriptionTier) => (tier === 'Professional' ? 'Enterprise' : tier);

/** What one plan is for, for this kind of business. */
export interface PlanCopy {
  fits: string;
}

const FITS: Record<KindId, [string, string, string]> = {
  restaurant: ['Takeaway, kiosk or a small café', 'A dine-in restaurant or busy café', 'High-volume fast food or a big dining hall'],
  retail: ['A small shop selling at one counter', 'A shop that tracks stock and suppliers', 'A large store with its own accounts'],
  grocery: ['A small mart with one till', 'A mart that tracks stock, batches and expiry', 'A large cash & carry with its own accounts'],
  pharmacy: ['Counter sales only, without batch tracking', 'A full pharmacy', 'A large pharmacy with its own accounts']
};

export function planCopy(kind: KindId, tier: SubscriptionTier): PlanCopy {
  return { fits: FITS[kind][PLANS.indexOf(tier)] };
}

/**
 * One line of the plan comparison, and the first plan that has it: 0 Starter, 1 Standard,
 * 2 Enterprise. Every plan lists the same lines, ticked or not, so the differences read across.
 * Kept equal to FeatureCatalog.cs (inventory, purchasing, recipes, delivery, loyalty, staff rota and
 * advanced reports from Standard; accounting and payroll from Enterprise).
 *
 * Labels stay short enough for one line in a card, so the whole step fits on one screen; `detail`
 * is the fuller description, shown on hover.
 */
export interface PlanFeature {
  label: string;
  detail?: string;
  from: 0 | 1 | 2;
}

const BOOKS: PlanFeature = { label: 'Accounting and payroll', detail: 'Ledger, profit and loss, balance sheet; payroll, payslips and leave', from: 2 };
const GROWTH: PlanFeature[] = [
  { label: 'Delivery, cash on delivery', from: 1 },
  { label: 'Loyalty, gift cards, promos', detail: 'Loyalty points, gift cards and promo codes', from: 1 },
  { label: 'Staff rota, advanced reports', detail: 'Staff rota, the dashboard and advanced reports', from: 1 }
];

const shopFeatures = (stock: PlanFeature): PlanFeature[] => [
  { label: 'Sales, receipts, returns', from: 0 },
  { label: 'Customers and khata credit', from: 0 },
  { label: 'Z-report and tax reports', from: 0 },
  stock,
  { label: 'Suppliers, purchase orders', from: 1 },
  ...GROWTH,
  BOOKS
];

const FEATURES: Record<KindId, PlanFeature[]> = {
  restaurant: [
    { label: 'Sales, receipts, returns', from: 0 },
    { label: 'Tables and waiter tablets', from: 0 },
    { label: 'Customers and tax reports', detail: 'Customers, the Z-report and tax reports', from: 0 },
    { label: 'Recipes and food cost', detail: 'Recipes, ingredient stock and food cost', from: 1 },
    { label: 'Suppliers, purchase orders', from: 1 },
    ...GROWTH,
    BOOKS
  ],
  retail: shopFeatures({ label: 'Stock counts, adjustments', from: 1 }),
  grocery: shopFeatures({ label: 'Stock, batches and expiry', detail: 'Stock with batch numbers and expiry dates', from: 1 }),
  pharmacy: [
    { label: 'Sell by box, strip or tablet', from: 0 },
    { label: 'Prescriptions at the till', from: 0 },
    { label: 'Search by formula', from: 0 },
    { label: 'Batches and expiry dates', detail: 'Batches and expiry dates; the earliest expiry is sold first', from: 1 },
    { label: 'Expired stock blocked', detail: 'The till will not sell an expired batch', from: 1 },
    { label: 'Controlled-medicine register', from: 1 },
    { label: 'Suppliers and returns', detail: 'Suppliers, purchase orders, supplier returns and write-offs', from: 1 },
    { label: 'Loyalty, rota, reports', detail: 'Loyalty, staff rota, the dashboard and pharmacy reports', from: 1 },
    BOOKS
  ]
};

export const planFeatures = (kind: KindId): PlanFeature[] => FEATURES[kind];

/** The plan most businesses of every kind should start on: the first with stock tracking. */
export const RECOMMENDED_PLAN: SubscriptionTier = 'Standard';

/** Built-in figures, used only until the server's price list answers. Kept equal to FeatureCatalog.cs. */
const FALLBACK: Record<SubscriptionTier, { monthly: number; yearly: number; branchMonthly: number; branchYearly: number; tills: number; tablets: number; kds: number; users: number }> = {
  Starter: { monthly: 5000, yearly: 50000, branchMonthly: 3000, branchYearly: 30000, tills: 1, tablets: 2, kds: 0, users: 3 },
  Standard: { monthly: 12000, yearly: 120000, branchMonthly: 6000, branchYearly: 60000, tills: 3, tablets: 8, kds: 2, users: 10 },
  Professional: { monthly: 25000, yearly: 250000, branchMonthly: 10000, branchYearly: 100000, tills: 8, tablets: 20, kds: 999, users: 999 }
};

/** A plan's prices and device allowance, from the server when it has answered. */
export function planFigures(tier: SubscriptionTier, packages: PublicPackage[]) {
  const pkg = packages.find(p => p.packageKey.toLowerCase() === tier.toLowerCase());
  const f = FALLBACK[tier];
  return {
    monthly: pkg?.monthlyPricePKR || f.monthly,
    yearly: pkg?.yearlyPricePKR || f.yearly,
    branchMonthly: pkg?.branchMonthlyPricePKR || f.branchMonthly,
    branchYearly: pkg?.branchYearlyPricePKR || f.branchYearly,
    tills: pkg?.maxCounters ?? f.tills,
    tablets: pkg?.maxOrderTabs ?? f.tablets,
    kitchenScreens: pkg?.maxKitchenDisplays ?? f.kds,
    /** Back-office logins (owners, managers); cashiers, waiters and kitchen staff are not counted. */
    users: pkg && pkg.maxUsers > 0 ? pkg.maxUsers : f.users
  };
}

/** The plan comparison's countable lines: devices and back-office logins, in this trade's words. */
export function planLimits(f: ReturnType<typeof planFigures>, food: boolean): { label: string; value: string }[] {
  return [
    { label: 'Tills', value: countText(f.tills) },
    { label: food ? 'Waiter tablets' : 'Tablets', value: countText(f.tablets) },
    ...(food ? [{ label: 'Kitchen screens', value: f.kitchenScreens > 0 ? countText(f.kitchenScreens) : '—' }] : []),
    // Owners' and managers' logins; the note under the plans says cashiers and waiters are free.
    { label: 'Logins', value: countText(f.users) }
  ];
}

export const ERP_FALLBACK_MONTHLY = 15000;

export const countText = (n: number) => (n >= 999 ? 'Unlimited' : String(n));
export const money = (n: number) => `PKR ${Math.round(n).toLocaleString('en-US')}`;

/** A till, tablet and kitchen-screen line: "3 tills · 8 tablets · 2 kitchen screens". */
export function deviceLine(f: ReturnType<typeof planFigures>, food: boolean): string {
  const parts = [`${countText(f.tills)} till${f.tills === 1 ? '' : 's'}`, `${countText(f.tablets)} tablets`];
  if (food && f.kitchenScreens > 0) parts.push(`${countText(f.kitchenScreens)} kitchen screen${f.kitchenScreens === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** All one digit (0000) or a straight run up or down (1234, 654321). */
export const isEasyPin = (pin: string) => {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = pin.split('').map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every(s => s === 1) || steps.every(s => s === -1);
};

export const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
export const passwordProblem = (pw: string) =>
  pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Use at least 8 characters, with letters and numbers.' : null;

/** The edition of the Terms and Privacy Policy a registration agrees to. */
export const TERMS_VERSION = '2026-10';
/** Where the published documents live (set VITE_TERMS_URL and VITE_PRIVACY_URL for the deployment). */
export const TERMS_URL: string | undefined = import.meta.env.VITE_TERMS_URL || undefined;
export const PRIVACY_URL: string | undefined = import.meta.env.VITE_PRIVACY_URL || undefined;

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

/** What one plan is for, and what it adds over the one before, for this kind of business. */
export interface PlanCopy {
  fits: string;
  adds: string[];
}

const food = (tier: SubscriptionTier): PlanCopy =>
  tier === 'Starter' ? { fits: 'Takeaway, kiosk or a small café', adds: ['Sales, receipts and returns', 'Tables and waiter tablets', 'Customers, Z-report and tax reports'] }
    : tier === 'Standard' ? { fits: 'A dine-in restaurant or busy café', adds: ['Kitchen screens', 'Recipes, ingredient stock and food cost', 'Delivery and cash on delivery', 'Loyalty, gift cards and promo codes', 'Staff rota, advanced reports, dashboard'] }
    : { fits: 'High-volume fast food or a big dining hall', adds: ['Unlimited kitchen screens', 'Accounting: ledger, profit and loss, balance sheet', 'Payroll, payslips and leave'] };

const shop = (tier: SubscriptionTier): PlanCopy =>
  tier === 'Starter' ? { fits: 'A small shop selling at one counter', adds: ['Sales, receipts and returns', 'Customers and credit (khata)', 'Z-report and tax reports'] }
    : tier === 'Standard' ? { fits: 'A shop that tracks stock and suppliers', adds: ['Stock counts and adjustments', 'Suppliers and purchase orders', 'Loyalty, gift cards and promo codes', 'Delivery and cash on delivery', 'Staff rota, advanced reports, dashboard'] }
    : { fits: 'A large store with its own accounts', adds: ['Accounting: ledger, profit and loss, balance sheet', 'Payroll, payslips and leave'] };

const mart = (tier: SubscriptionTier): PlanCopy =>
  tier === 'Starter' ? { fits: 'A small mart with one till', adds: ['Sales, receipts and returns', 'Customers and credit (khata)', 'Z-report and tax reports'] }
    : tier === 'Standard' ? { fits: 'A mart that tracks stock, batches and expiry', adds: ['Stock with batches and expiry dates', 'Suppliers and purchase orders', 'Loyalty, gift cards and promo codes', 'Delivery and cash on delivery', 'Staff rota, advanced reports, dashboard'] }
    : { fits: 'A large cash & carry with its own accounts', adds: ['Accounting: ledger, profit and loss, balance sheet', 'Payroll, payslips and leave'] };

const pharmacy = (tier: SubscriptionTier): PlanCopy =>
  tier === 'Starter' ? { fits: 'Counter sales only, without batch tracking', adds: ['Sales by box, strip or tablet', 'Prescriptions at the till', 'Search by formula'] }
    : tier === 'Standard' ? { fits: 'A full pharmacy', adds: ['Batches and expiry, earliest expiry sold first', 'Expired stock blocked at the till', 'Controlled-medicine register', 'Supplier returns, write-offs, pharmacy reports', 'Suppliers, purchase orders, loyalty, staff rota'] }
    : { fits: 'A large pharmacy with its own accounts', adds: ['Accounting: ledger, profit and loss, balance sheet', 'Payroll, payslips and leave'] };

export function planCopy(kind: KindId, tier: SubscriptionTier): PlanCopy {
  if (kind === 'restaurant') return food(tier);
  if (kind === 'pharmacy') return pharmacy(tier);
  if (kind === 'grocery') return mart(tier);
  return shop(tier);
}

/** The plan most businesses of every kind should start on: the first with stock tracking. */
export const RECOMMENDED_PLAN: SubscriptionTier = 'Standard';

/** Built-in figures, used only until the server's price list answers. Kept equal to FeatureCatalog.cs. */
const FALLBACK: Record<SubscriptionTier, { monthly: number; yearly: number; branchMonthly: number; branchYearly: number; tills: number; tablets: number; kds: number }> = {
  Starter: { monthly: 5000, yearly: 50000, branchMonthly: 3000, branchYearly: 30000, tills: 1, tablets: 2, kds: 0 },
  Standard: { monthly: 12000, yearly: 120000, branchMonthly: 6000, branchYearly: 60000, tills: 3, tablets: 8, kds: 2 },
  Professional: { monthly: 25000, yearly: 250000, branchMonthly: 10000, branchYearly: 100000, tills: 8, tablets: 20, kds: 999 }
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
    kitchenScreens: pkg?.maxKitchenDisplays ?? f.kds
  };
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

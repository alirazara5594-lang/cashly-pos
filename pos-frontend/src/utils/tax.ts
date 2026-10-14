// The tax on a cart, item by item — the same rule as the server's (Pos.Api Program.cs TaxLines), so the
// total the till shows is the total charged. Each line is taxed at its own treatment: the sale's rate
// (standard), none (exempt, zero-rated) or the item's own rate, on its share of the bill after discount.
import type { CartItem, TaxLine } from '../types';

/** The rate one cart line is taxed at, given the sale's rate (cash or card, at this branch). */
export const lineTaxRate = (item: CartItem, saleRate: number) =>
  item.taxTreatment === 'Exempt' || item.taxTreatment === 'ZeroRated' ? 0
    : item.taxTreatment === 'OwnRate' ? item.taxRatePercent ?? 0
    : saleRate;

const roundTo = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/**
 * The bill's tax, and its breakdown by rate for the receipt (exempt last). With prices that include
 * tax, the tax is the part of each line it makes up; otherwise it is added on top.
 */
export const cartTax = (cart: CartItem[], discount: number, saleRate: number, pricesIncludeTax: boolean, decimals = 0) => {
  const subtotal = cart.reduce((sum, i) => sum + i.totalPricePKR, 0);
  const groups = new Map<string, TaxLine>();
  let tax = 0;
  for (const item of cart) {
    const rate = lineTaxRate(item, saleRate);
    const share = subtotal > 0 ? item.totalPricePKR / subtotal : 0;
    const taxable = Math.max(0, item.totalPricePKR - discount * share);
    const lineTax = rate <= 0 ? 0 : pricesIncludeTax ? taxable - taxable / (1 + rate / 100) : (taxable * rate) / 100;
    tax += lineTax;
    const exempt = item.taxTreatment === 'Exempt';
    const key = exempt ? 'exempt' : String(rate);
    const group = groups.get(key) ?? { ratePercent: exempt ? 0 : rate, exempt, amountPKR: 0, taxPKR: 0 };
    group.amountPKR += item.totalPricePKR;
    group.taxPKR += lineTax;
    groups.set(key, group);
  }
  const lines = [...groups.values()]
    .map(g => ({ ...g, amountPKR: roundTo(g.amountPKR, 2), taxPKR: roundTo(g.taxPKR, 2) }))
    .sort((a, b) => (a.exempt === b.exempt ? b.ratePercent - a.ratePercent : a.exempt ? 1 : -1));
  return { tax: roundTo(tax, decimals), lines };
};

/** "16%", "0% (zero-rated)", "Exempt" — a tax line's name on a receipt. */
export const taxLineLabel = (line: TaxLine) =>
  line.exempt ? 'Exempt' : line.ratePercent === 0 ? '0% (zero-rated)' : `${line.ratePercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

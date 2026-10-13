// A medicine's details, compared and shown the same way on the till and the catalogue screens.
import type { Product, SaleUnit } from '../types';

/**
 * A formula made comparable: case and spacing do not matter, nor the order a combination's parts
 * are written in ("Caffeine + Paracetamol" is "Paracetamol + Caffeine").
 */
const formulaKey = (generic: string) =>
  generic.toLowerCase().split(/\s*(?:\+|,|\/|&|\band\b)\s*/)
    .map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean).sort().join('+');

/** "500 mg" and "500mg" are one strength. */
const strengthKey = (strength?: string | null) => (strength ?? '').toLowerCase().replace(/\s+/g, '');

const formKey = (form?: string | null) => (form ?? '').trim().toLowerCase();

/**
 * Whether one medicine can be sold in place of another: the same formula, strength and form. All
 * three must match — a different strength or form is a different medicine, whatever the formula.
 */
export const isSubstitute = (medicine: Product, other: Product) =>
  other.id !== medicine.id && !!medicine.genericName?.trim() && !!other.genericName?.trim()
  && formulaKey(medicine.genericName) === formulaKey(other.genericName)
  && strengthKey(medicine.strength) === strengthKey(other.strength)
  && formKey(medicine.dosageForm) === formKey(other.dosageForm);

/** "500 mg · Tablet" — empty for anything that is not a medicine. */
export const strengthAndForm = (product: Product) =>
  [product.strength, product.dosageForm].filter(Boolean).join(' · ');

// --- Packing: a medicine sold by the box, the strip or the tablet ---------------------------
// The same rules as the server's (Pos.Api/Services/MedicinePacking.cs), so the till shows the price
// the sale is charged at. A packed medicine's stock is counted in tablets; its price stays per box.

export const isPacked = (p: Product) => (p.packUnits ?? 0) > 1;

/** Tablets in one box: the pack size, or 1 for a product that is not packed. */
export const unitsPerBox = (p: Product) => (isPacked(p) ? p.packUnits! : 1);

export const hasStrips = (p: Product) => {
  const pack = p.packUnits ?? 0;
  const strip = p.stripUnits ?? 0;
  return pack > 1 && strip > 1 && strip < pack && pack % strip === 0;
};

/** What one of the smallest unit is called, from the medicine's form. */
export const looseUnitName = (dosageForm?: string | null) => {
  switch ((dosageForm ?? '').trim().toLowerCase()) {
    case 'tablet': return 'Tablet';
    case 'capsule': return 'Capsule';
    case 'injection': return 'Ampoule';
    case 'sachet': return 'Sachet';
    default: return 'Unit';
  }
};

// Half away from zero to the paisa, as the server rounds. The nudge keeps 3.015 (stored as
// 3.01499...) rounding up, as the server's exact decimals do.
const share = (boxPrice: number, units: number, perBox: number) =>
  Math.round((boxPrice * units / perBox) * 100 + 1e-7) / 100;

export interface SaleUnitOption {
  unit: SaleUnit;
  /** "Box", "Strip", "Tablet". */
  label: string;
  /** Tablets one of it takes from stock. */
  units: number;
  price: number;
}

/**
 * The ways a packed medicine sells — box, strip (when it has strips), tablet — each with its price
 * from the box price unless the business set its own. Empty for a product that sells whole only.
 */
export const saleUnitOptions = (p: Product): SaleUnitOption[] => {
  if (!isPacked(p)) return [];
  const perBox = unitsPerBox(p);
  const options: SaleUnitOption[] = [{ unit: 'Pack', label: 'Box', units: perBox, price: p.sellingPricePKR }];
  if (hasStrips(p)) {
    options.push({
      unit: 'Strip', label: 'Strip', units: p.stripUnits!,
      price: (p.stripPricePKR ?? 0) > 0 ? p.stripPricePKR! : share(p.sellingPricePKR, p.stripUnits!, perBox)
    });
  }
  options.push({
    unit: 'Unit', label: looseUnitName(p.dosageForm), units: 1,
    price: (p.looseUnitPricePKR ?? 0) > 0 ? p.looseUnitPricePKR! : share(p.sellingPricePKR, 1, perBox)
  });
  return options;
};

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : word.endsWith('x') ? 'es' : 's'}`;

/**
 * A count in tablets as boxes and loose tablets: "5 boxes + 4 tablets". A product that is not
 * packed shows its plain number.
 */
export const formatPacked = (qty: number, packUnits?: number | null, looseName?: string | null) => {
  if (!packUnits || packUnits <= 1) return qty.toLocaleString();
  const abs = Math.abs(qty);
  const boxes = Math.floor(abs / packUnits);
  const loose = Math.round((abs - boxes * packUnits) * 100) / 100;
  const parts: string[] = [];
  if (boxes > 0) parts.push(plural(boxes, 'box'));
  if (loose > 0 || boxes === 0) parts.push(plural(loose, (looseName ?? 'Unit').toLowerCase()));
  return (qty < 0 ? '-' : '') + parts.join(' + ');
};

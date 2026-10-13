// A medicine's details, compared and shown the same way on the till and the catalogue screens.
import type { Product } from '../types';

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

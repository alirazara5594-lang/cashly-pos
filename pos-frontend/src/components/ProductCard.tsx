import React from 'react';
import { getEmoji } from '../utils/productEmoji';
import type { Product } from '../types';

/**
 * The product tile used by the POS terminal and the waiter tablet.
 *
 * Both screens used to carry their own hand-written copy of this markup, which is how the
 * tablet ended up with no thumbnail and a different card shape. One definition now; the only
 * thing a screen chooses is its accent colour.
 */

/** Accent classes are spelled out rather than interpolated — Tailwind only ships classes it can
 *  see as complete strings at build time, so `text-${accent}-600` would silently produce nothing. */
const ACCENTS = {
  teal: {
    border: 'hover:border-teal-200',
    price: 'text-teal-600',
    button: 'bg-teal-500 hover:bg-teal-600',
  },
  purple: {
    border: 'hover:border-purple-300',
    price: 'text-purple-600',
    button: 'bg-purple-500 hover:bg-purple-600',
  },
} as const;

export type ProductCardAccent = keyof typeof ACCENTS;

interface ProductCardProps {
  product: Product;
  /** Resolved category name, used only to sharpen the emoji fallback. */
  categoryName?: string;
  accent?: ProductCardAccent;
  /** Fired by both the tile body and the Add button. */
  onSelect: (product: Product) => void;
  /** Label for the action button. The tablet uses a bare "+" for a smaller touch target row. */
  actionLabel?: React.ReactNode;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  categoryName,
  accent = 'teal',
  onSelect,
  actionLabel = 'Add',
}) => {
  const theme = ACCENTS[accent];
  const hasModifiers = !!product.modifiers && product.modifiers.length > 0;

  return (
    <div
      onClick={() => onSelect(product)}
      className={`bg-white border border-slate-200 rounded-2xl p-3 hover:shadow-lg ${theme.border} transition-all cursor-pointer group flex flex-col`}
    >
      <div className="relative w-full h-28 rounded-xl overflow-hidden bg-slate-50 flex items-center justify-center mb-2">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          />
        ) : (
          <span className="text-4xl">{getEmoji(product.name, categoryName)}</span>
        )}
        {hasModifiers && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-[10px] font-bold uppercase">
            Custom
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold text-slate-900 truncate">{product.name}</h3>
      {product.urduName && (
        <p className="text-[11px] text-slate-400 text-right truncate mt-0.5">{product.urduName}</p>
      )}
      <p className="text-xs text-slate-400 mt-0.5">{product.sku || product.barcode.slice(-4)}</p>

      <div className="flex items-center justify-between mt-auto pt-2">
        <span className={`text-sm font-bold ${theme.price}`}>
          {product.sellingPricePKR.toLocaleString()}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(product);
          }}
          className={`px-3 py-1 rounded-lg ${theme.button} text-white text-xs font-bold transition shadow-sm`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { ArrowLeftRight, AlertTriangle, X } from 'lucide-react';
import { daysUntil, expiryChip } from '../utils/expiry';
import { strengthAndForm } from '../utils/medicine';
import type { Product } from '../types';

/** Why the panel is open: the cashier asked, or the medicine picked cannot be sold from stock here. */
export type SubstitutesReason = 'asked' | 'expired' | 'out';

interface SubstitutesPanelProps {
  product: Product;
  reason: SubstitutesReason;
  /** Same formula, strength and form, in stock here, cheapest first (utils/medicine.ts). */
  options: Product[];
  /** What is left to sell here beyond the cart ("2 boxes + 5 tablets"), and the nearest expiry still sellable. */
  stockOf: (productId: string) => { available: string | null; nearestExpiry: string | null };
  onAdd: (substitute: Product) => void;
  /** Offered only when the medicine shows no stock: the count may be wrong and it may be on the shelf. */
  onAddAnyway: () => void;
  onClose: () => void;
}

/** The till's list of other brands a pharmacy can sell in place of the medicine asked for. */
export const SubstitutesPanel: React.FC<SubstitutesPanelProps> = ({
  product, reason, options, stockOf, onAdd, onAddAnyway, onClose
}) => (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-label={`Substitutes for ${product.name}`} className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
            <ArrowLeftRight className="w-4 h-4 shrink-0" />
            <span className="truncate">Substitutes for {product.name}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {[product.genericName, strengthAndForm(product)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {reason !== 'asked' && (
        <div role="alert" className={`mx-5 mt-4 px-3 py-2 rounded-xl border text-xs font-medium flex items-start gap-2 ${
          reason === 'expired' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {reason === 'expired'
              ? `${product.name} cannot be sold: what is left here has expired. Take it off the shelf and offer one of these.`
              : `${product.name} shows no stock here. Offer one of these, or add it anyway if it is on the shelf.`}
          </span>
        </div>
      )}

      <div className="overflow-y-auto p-5 space-y-2">
        {options.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            No other medicine with the same formula, strength and form is in stock here.
          </p>
        ) : options.map(sub => {
          const { available, nearestExpiry } = stockOf(sub.id);
          const chip = nearestExpiry ? expiryChip(daysUntil(nearestExpiry)) : null;
          const diff = sub.sellingPricePKR - product.sellingPricePKR;
          return (
            <div key={sub.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-300 transition">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{sub.name}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {[sub.manufacturer, sub.rackLocation && `Rack ${sub.rackLocation}`, available != null && `${available} in stock`]
                    .filter(Boolean).join(' · ')}
                </p>
                {chip && (
                  <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded border font-semibold ${chip.cls}`}>{chip.label}</span>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-teal-600">{sub.sellingPricePKR.toLocaleString()}</p>
                {diff !== 0 && (
                  <p className={`text-[10px] font-semibold ${diff < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {diff < 0 ? `${Math.abs(diff).toLocaleString()} less` : `${diff.toLocaleString()} more`}
                  </p>
                )}
              </div>
              <button
                onClick={() => onAdd(sub)}
                className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition shadow-sm shrink-0"
              >
                Add
              </button>
            </div>
          );
        })}
      </div>

      {reason === 'out' && (
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={onAddAnyway}
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
          >
            Add {product.name} anyway
          </button>
        </div>
      )}
    </div>
  </div>
);

import { usePosStore } from '../store/posStore';

/** The restaurant-only parts of the app, each tied to a capability of the business's kind. */
export type SectorFeature = 'tableService' | 'kitchenRouting' | 'recipes';

export interface Sector {
  /** The server has said what kind of business this is (before that, the business type stands in). */
  known: boolean;
  /** "Restaurant & Cafe", "Pharmacy"... for messages. */
  name: string;
  /** Floors, tables, dine-in orders and waiter tablets. */
  tableService: boolean;
  /** Kitchen tickets and the kitchen display. */
  kitchenRouting: boolean;
  /** Ingredients, recipes and menu engineering. */
  recipes: boolean;
  /** Per-line add-ons chosen at sale time ("extra cheese"). */
  modifiers: boolean;
  /** Batch numbers and expiry dates on stock (pharmacy, grocery). */
  batchExpiry: boolean;
  /** What the product list is called: "Menu", "Medicines", "Catalog"... */
  catalogNoun: string;
  /** What one sale is called: "Order", "Sale", "Ticket"... */
  saleNoun: string;
  /** Sector screens the server says this business should have. */
  sectorModules: string[];
}

/**
 * What kind of business this is, as its sector packs declare (Pos.Api/Data/VerticalPacks.cs), so
 * each kind works with its own screens: a pharmacy never shows tables or a kitchen, a shop never
 * shows recipes. Screens ask this instead of guessing from the business type.
 *
 * Until the server answers (or on an older server), the business type stands in, read the way the
 * server reads it: a retail store or a mart is not a restaurant; everything else is.
 */
export function useSector(): Sector {
  const info = usePosStore(s => s.packageInfo);
  const businessType = usePosStore(s => s.selectedTenant?.businessType);
  const flows = info?.flowCapabilities;
  const items = info?.itemCapabilities;
  const restaurantLike = businessType !== 'Retail' && businessType !== 'CashAndCarry';

  return {
    known: !!flows && !!items,
    name: info?.packDisplayName ?? (restaurantLike ? 'restaurant' : 'shop'),
    tableService: flows ? flows.tableService : restaurantLike,
    kitchenRouting: flows ? flows.kitchenRouting : restaurantLike,
    recipes: items ? items.recipeBom : restaurantLike,
    modifiers: items ? items.modifiers : restaurantLike,
    batchExpiry: items ? items.batchExpiry : false,
    catalogNoun: info?.catalogNoun ?? (restaurantLike ? 'Menu' : 'Catalog'),
    saleNoun: info?.saleNoun ?? (restaurantLike ? 'Order' : 'Sale'),
    sectorModules: info?.sectorModules ?? []
  };
}

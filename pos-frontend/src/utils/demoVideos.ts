import type { DemoVideoStep } from '../types';
import type { KindId } from '../pages/register/registerCatalog';

// ============================================================
// "Watch demo": the steps each kind of business sees, and the videos the app ships with — recorded
// from Cashly itself, in public/demo-videos (each with a still of the same name, .jpg, for the
// list). The platform can change any kind's steps (Platform → Settings → Demo videos); a kind it
// has not changed plays these.
// ============================================================

const video = (name: string) => `/demo-videos/${name}.mp4`;

/** The heading over each kind's steps. */
export const DEMO_TITLES: Record<KindId, string> = {
  restaurant: 'Cashly for restaurants and cafés',
  retail: 'Cashly for retail stores',
  pharmacy: 'Cashly for pharmacies',
  grocery: 'Cashly for marts and cash & carry'
};

export const BUILT_IN_DEMO_STEPS: Record<KindId, DemoVideoStep[]> = {
  restaurant: [
    { title: 'Register your restaurant', description: 'Choose Restaurant or café, name your place and pick a plan.', videoUrl: video('restaurant-1-register') },
    { title: 'Set up your menu', description: 'Add your dishes with their prices, in the categories your menu already uses.', videoUrl: video('restaurant-2-menu') },
    { title: 'Take an order and print the bill', description: 'Pick the dishes, take the payment and print the receipt.', videoUrl: video('restaurant-3-sell') },
    { title: 'See your day', description: 'Sales, best sellers and the day-end report, as the day goes.', videoUrl: video('restaurant-4-reports') }
  ],
  retail: [
    { title: 'Register your shop', description: 'Choose Retail store, name your shop and pick a plan.', videoUrl: video('retail-1-register') },
    { title: 'Add your products', description: 'Products with barcodes, prices and stock.', videoUrl: video('retail-2-products') },
    { title: 'Sell at the counter', description: 'Scan or search, take the payment and print the receipt.', videoUrl: video('retail-3-sell') },
    { title: 'See your day', description: 'Sales, stock and the day-end report.', videoUrl: video('retail-4-reports') }
  ],
  pharmacy: [
    { title: 'Register your pharmacy', description: 'Choose Pharmacy, name it and pick a plan.', videoUrl: video('pharmacy-1-register') },
    { title: 'Add your medicines', description: 'Medicines with their formula, packing and price.', videoUrl: video('pharmacy-2-products') },
    { title: 'Sell at the counter', description: 'Find medicines by name or formula and sell by box or strip.', videoUrl: video('pharmacy-3-sell') },
    { title: 'See your day', description: 'Sales and the day-end report.', videoUrl: video('pharmacy-4-reports') }
  ],
  grocery: [
    { title: 'Register your mart', description: 'Choose Mart or cash & carry, name it and pick a plan.', videoUrl: video('grocery-1-register') },
    { title: 'Add your products', description: 'Products with barcodes, prices and stock.', videoUrl: video('grocery-2-products') },
    { title: 'Fast checkout', description: 'Scan the basket, take cash or card and print the receipt.', videoUrl: video('grocery-3-sell') },
    { title: 'See your day', description: 'Sales and the day-end report.', videoUrl: video('grocery-4-reports') }
  ]
};

/** The steps a kind of business sees: the platform's own, if it changed them, else the app's. */
export function demoStepsFor(kind: KindId, changed: Partial<Record<string, DemoVideoStep[]>> | null | undefined): DemoVideoStep[] {
  return changed?.[kind] ?? BUILT_IN_DEMO_STEPS[kind];
}

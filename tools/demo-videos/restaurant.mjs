// "Cashly for restaurants and cafés": register, set up the menu, sell, see the day.
import { signIn, hideChecklist, register } from './common.mjs';
export const name = 'restaurant';

const test = process.env.DEMO_TEST;
const biz = test
  ? { name: `Test Grill ${test}`, slug: `test-grill-${test}`, mobile: `0301 55500${String(test).padStart(2, '0')}` }
  : { name: process.env.DEMO_NAME || 'Lahore Grill House', slug: process.env.DEMO_SLUG || 'lahore-grill-house', mobile: process.env.DEMO_MOBILE || '0300 4512871' };
const owner = { owner: 'Ahmed Khan', username: 'ahmed', pin: '482915' };
const eyebrow = n => `Cashly for restaurants · Step ${n}`;

export default async function ({ r, video }) {
  // 1 — Register.
  await r.goto('/signup', { wait: 2500 });
  await video('restaurant-1-register', { eyebrow: eyebrow(1), title: 'Register your restaurant', subtitle: 'Name your place, pick a plan, and create your owner account.', posterAt: 9 }, async () => {
    await register(r, { kind: 'Restaurant or café', name: biz.name, city: 'Lahore', mobile: biz.mobile, ...owner }, { captions: true });
    await r.caption('Your POS is ready. Staff sign in with their username and PIN.', '✓');
    await r.sleep(3500);
  });

  // Signed in, checklist closed, on the menu's products.
  await signIn(r, biz.slug, owner.username, owner.pin, { quick: true });
  await hideChecklist(r);
  await r.goto('/menu', { wait: 2500 });
  await r.click({ text: 'Products', contains: true, tag: 'button' }, { after: 900, ms: 150 });

  // 2 — The menu.
  await video('restaurant-2-menu', { eyebrow: eyebrow(2), title: 'Set up your menu', subtitle: 'Add your dishes with their prices, in categories.', posterAt: 12 }, async () => {
    await r.caption('Menu & Recipes: every dish you sell', '1');
    await r.hover({ text: 'Classic Smash Burger', tag: 'div,span,p,td', contains: true });
    await r.sleep(900);
    await r.click({ text: 'Add Product', contains: true }, { after: 900 });
    await r.caption('Add a dish: its category, name and price', '2');
    await r.choose({ label: 'Category' }, 'Burgers & Sandwiches');
    await r.type({ placeholder: 'e.g. Classic Smash Burger' }, 'Chicken Shawarma Wrap');
    await r.sleep(900);
    await r.caption('Cashly suggests the Urdu name for you', '3');
    await r.hover({ label: 'Urdu name' });
    await r.sleep(1200);
    await r.type({ label: 'Cost price' }, '220', { clear: true });
    await r.type({ label: 'Selling price' }, '480', { clear: true });
    await r.sleep(600);
    await r.choose({ label: 'Kitchen station' }, 'Grill');
    await r.caption('The kitchen station decides which kitchen screen gets the order', '4');
    await r.sleep(1600);
    await r.click({ text: 'Create Product', contains: true }, { after: 1500 });
    await r.caption('Saved, and on the till straight away', '5');
    if (!(await r.has({ text: 'Register', tag: 'a', contains: true }))) await r.click({ text: 'POS & Orders', tag: 'button', contains: true }, { after: 600 });
    await r.click({ text: 'Register', tag: 'a', contains: true }, { after: 2000 });
    await r.hover({ text: 'Chicken Shawarma Wrap', tag: 'div,span,p,h3,h4', contains: true });
    await r.sleep(2200);
  });

  // 3 — Sell (the till is open).
  await video('restaurant-3-sell', { eyebrow: eyebrow(3), title: 'Take an order and print the bill', subtitle: 'Pick the table, tap the dishes, take the payment.', posterAt: 14 }, async () => {
    await r.caption('Dine in: pick the table', '1');
    console.log('tables:', await r.evaluate(`[...document.querySelectorAll('select')].filter(s => s.getBoundingClientRect().width > 0).map(s => [...s.options].map(o => o.textContent.trim()).join(' / ')).join(' || ')`));
    await r.choose({ css: 'select' }, 'T-3', { after: 900 });
    await r.caption('Tap the dishes', '2');
    await r.click({ text: 'Add', tag: 'button', near: 'Royal Chicken' }, { after: 600 });
    await r.click({ text: 'Add', tag: 'button', near: 'Loaded Gourme' }, { after: 600 });
    await r.click({ text: 'Add', tag: 'button', near: 'Fresh Mint' }, { after: 600 });
    await r.click({ text: 'Add', tag: 'button', near: 'Classic Smash' }, { after: 900 });
    await r.caption('Notes for the chef go to the kitchen with the order', '3');
    await r.type({ placeholder: 'e.g. Extra spicy' }, 'No onions, well done');
    await r.click({ text: 'Add to Cart', contains: true }, { after: 1200 });
    await r.caption('Cash: Cashly works out the change', '4');
    await r.click({ text: '5,000', tag: 'button' }, { after: 1200 });
    await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2200 });
    await r.caption('Paid. The receipt is ready to print.', '5');
    await r.sleep(3500);
    await r.click({ text: 'Close', tag: 'button' }, { after: 1000 });
  });

  // A takeaway, paid by card, so the day has more than one sale (not recorded).
  await r.click({ text: 'Take Away', tag: 'button' }, { after: 300, ms: 150 });
  await r.click({ text: 'Add', tag: 'button', near: 'Chicken Shawar' }, { after: 300, ms: 150 });
  await r.click({ text: 'Add', tag: 'button', near: 'Fresh Mint' }, { after: 300, ms: 150 });
  await r.click({ text: 'Card', tag: 'button' }, { after: 300, ms: 150 });
  await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2000, ms: 150 });
  if (await r.has({ text: 'Close', tag: 'button' })) await r.click({ text: 'Close', tag: 'button' }, { after: 800, ms: 150 });

  // 4 — The day.
  await video('restaurant-4-reports', { eyebrow: eyebrow(4), title: 'See your day', subtitle: 'Sales, best sellers and the day-end report.', posterAt: 7 }, async () => {
    await r.click({ text: 'Dashboard', tag: 'a', contains: true }, { after: 2500 });
    await r.caption("Today's sales, orders and best sellers, as they happen", '1');
    await r.hover({ text: 'Best Sellers Today', tag: 'h2,h3,h4,div,span', contains: true });
    await r.sleep(2500);
    if (!(await r.has({ text: 'Z-Report (End of Day)', tag: 'a', contains: true }))) await r.click({ text: 'Sales Reports', tag: 'button', contains: true }, { after: 600 });
    await r.click({ text: 'Z-Report (End of Day)', tag: 'a', contains: true }, { after: 2500 });
    await r.caption('At day end: the Z-report', '2');
    await r.sleep(1200);
    await r.scroll(380);
    await r.caption('Cash, card and tax, and the cash drawer counted', '3');
    await r.sleep(3000);
  });
}

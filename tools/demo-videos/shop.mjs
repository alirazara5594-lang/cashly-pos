// "Cashly for retail stores" / "for marts and cash & carry": register, add products and stock,
// sell by barcode, see the day. KIND=retail (default) or KIND=grocery.
import { signIn, hideChecklist, register, addCategory, addProduct, stockIn } from './common.mjs';

const kind = process.env.KIND || 'retail';
export const name = kind;
const test = process.env.DEMO_TEST;
/** Resume: the business and its catalog already exist (a previous run stopped halfway). */
const skipSetup = process.env.SKIP_SETUP === '1';

const K = kind === 'grocery'
  ? {
      label: 'Mart or cash & carry', eyebrow: 'Cashly for marts and cash & carry', bizName: 'Al-Madina Mart', slug: 'al-madina-mart', mobile: '0300 4512873',
      owner: { owner: 'Usman Tariq', username: 'usman', pin: '613847' }, city: 'Faisalabad', province: 'PK-PB',
      shopWord: 'mart', registerTitle: 'Register your mart',
      first: { category: 'Grocery', name: 'Shan Biryani Masala 50g', cost: 95, price: 120, barcode: '8964000123458' },
      firstStock: { qty: 48, supplier: 'Shan Foods distributor', batch: 'SB-2611', expiry: '2027-06-30' },
      more: [
        { category: 'Grocery', name: 'Dalda Cooking Oil 1L', cost: 520, price: 590, barcode: '8964000214569', stock: 30 },
        { category: 'Dairy', name: 'Olpers Milk 1L', cost: 250, price: 280, barcode: '8964000317871', stock: 40 },
        { category: 'Household', name: 'Surf Excel 1kg', cost: 640, price: 720, barcode: '8964000412347', stock: 4 }
      ],
      basket: [['8964000214569', 1], ['8964000317871', 2], ['8964000123458', 3]]
    }
  : {
      label: 'Retail store', eyebrow: 'Cashly for retail stores', bizName: 'City Style Store', slug: 'city-style-store', mobile: '0300 4512872',
      owner: { owner: 'Sara Ahmed', username: 'sara', pin: '583926' }, city: 'Karachi', province: 'PK-SD',
      shopWord: 'shop', registerTitle: 'Register your shop',
      first: { category: 'Beverages', name: 'Nestle Pure Life 1.5L', cost: 70, price: 90, barcode: '6291001003301' },
      firstStock: { qty: 24, supplier: 'Metro Cash & Carry' },
      more: [
        { category: 'Beverages', name: 'Coca-Cola 1.5L', cost: 150, price: 190, barcode: '5449000131805', stock: 30 },
        { category: 'Snacks', name: "Lay's Masala 70g", cost: 80, price: 100, barcode: '8964000561238', stock: 40 },
        { category: 'Personal Care', name: 'Lux Soap 100g', cost: 120, price: 150, barcode: '8964000612341', stock: 3 }
      ],
      basket: [['5449000131805', 1], ['8964000561238', 2], ['6291001003301', 1]]
    };

const biz = test
  ? { name: `Test ${K.shopWord} ${test}`, slug: `test-${K.shopWord}-${test}`, mobile: `0302 6660${kind === 'grocery' ? 1 : 0}${String(test).padStart(2, '0')}` }
  : { name: K.bizName, slug: K.slug, mobile: K.mobile };
const step = n => `${K.eyebrow} · Step ${n}`;
const goSidebar = async (r, link, group) => {
  if (!(await r.has({ text: link, tag: 'a', contains: true }))) await r.click({ text: group, tag: 'button', contains: true }, { after: 600 });
  await r.click({ text: link, tag: 'a', contains: true }, { after: 2200 });
};

export default async function ({ r, video }) {
  if (skipSetup) {
    // The business and its stock are already there; pick up at the till.
    await signIn(r, biz.slug, K.owner.username, K.owner.pin, { quick: true });
    await hideChecklist(r);
    await r.goto('/', { wait: 3000 });
  } else {
  // 1 — Register.
  await r.goto('/signup', { wait: 2500 });
  await video(`${kind}-1-register`, { eyebrow: step(1), title: K.registerTitle, subtitle: `Name your ${K.shopWord}, pick a plan, and create your owner account.`, posterAt: 9 }, async () => {
    await register(r, { kind: K.label, name: biz.name, province: K.province, city: K.city, mobile: biz.mobile, ...K.owner }, { captions: true });
    await r.caption('Your POS is ready. Staff sign in with their username and PIN.', '✓');
    await r.sleep(3500);
  });

  await signIn(r, biz.slug, K.owner.username, K.owner.pin, { quick: true });
  await hideChecklist(r);
  await r.goto('/menu', { wait: 2500 });

  // 2 — Products and stock.
  await video(`${kind}-2-products`, { eyebrow: step(2), title: 'Add your products', subtitle: 'Products with barcodes and prices, then the stock you receive.', posterAt: 16 }, async () => {
    await r.caption('Product Catalog: first, a category', '1');
    await addCategory(r, K.first.category);
    await r.caption('Then the product: name, price and barcode', '2');
    await addProduct(r, K.first, {
      say: { beforeBarcode: () => r.caption('Scan or type its barcode', '3') }
    });
    await r.caption('Now receive the stock', '4');
    await goSidebar(r, 'Stock', 'Inventory');
    await stockIn(r, K.first.name, K.firstStock.qty, {
      ...K.firstStock,
      say: () => r.caption(K.firstStock.batch ? 'With its batch and expiry date' : 'From the supplier, at its cost', '5')
    });
    await r.caption('In stock, and on the till', '✓');
    await r.hover({ text: K.first.name, tag: 'td,div,span,p', contains: true });
    await r.sleep(2500);
  });

  // More products, with stock (not recorded).
  await r.goto('/menu', { wait: 2500 });
  const cats = new Set([K.first.category]);
  for (const p of K.more) {
    if (!cats.has(p.category)) { await addCategory(r, p.category, { quick: true }); cats.add(p.category); }
    await addProduct(r, p, { quick: true });
  }
  await r.goto('/inventory', { wait: 2500 });
  for (const p of K.more) await stockIn(r, p.name, p.stock, { quick: true });
  }
  await r.goto('/', { wait: 3000 });

  // 3 — Sell by barcode.
  await video(`${kind}-3-sell`, { eyebrow: step(3), title: kind === 'grocery' ? 'Fast checkout' : 'Sell at the counter', subtitle: 'Scan the items, take the payment, print the receipt.', posterAt: 12 }, async () => {
    await r.caption('Scan each item with the barcode scanner', '1');
    for (const [code, times] of K.basket) {
      for (let i = 0; i < times; i++) {
        await r.type({ placeholder: 'Scan Barcode' }, code, { delay: [12, 22], after: 150 });
        await r.press('Enter');
        await r.sleep(900);
      }
    }
    await r.caption('Scan it again and the quantity goes up', '2');
    await r.sleep(1500);
    await r.caption('Cash: Cashly works out the change', '3');
    // The notes offered are the ones that cover the total; take the smallest.
    for (const note of ['1,000', '2,000', '5,000']) {
      if (await r.has({ text: note, tag: 'button' })) { await r.click({ text: note, tag: 'button' }, { after: 1200 }); break; }
    }
    await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2200 });
    await r.caption('Paid. The receipt is ready to print.', '4');
    await r.sleep(3500);
    await r.click({ text: 'Close', tag: 'button' }, { after: 1000 });
  });

  // A second sale, by card (not recorded).
  await r.type({ placeholder: 'Scan Barcode' }, K.more[0].barcode, { delay: [5, 10], after: 100 });
  await r.press('Enter');
  await r.sleep(600);
  await r.click({ text: 'Card', tag: 'button' }, { after: 300, ms: 150 });
  await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2000, ms: 150 });
  if (await r.has({ text: 'Close', tag: 'button' })) await r.click({ text: 'Close', tag: 'button' }, { after: 800, ms: 150 });

  // 4 — The day.
  await video(`${kind}-4-reports`, { eyebrow: step(4), title: 'See your day', subtitle: 'Sales, stock and the day-end report.', posterAt: 7 }, async () => {
    await r.click({ text: 'Dashboard', tag: 'a', contains: true }, { after: 2500 });
    await r.caption("Today's sales and best sellers, as they happen", '1');
    await r.sleep(3000);
    await goSidebar(r, 'Stock', 'Inventory');
    await r.caption('Stock counts itself down with every sale', '2');
    await r.sleep(1500);
    await r.hover({ text: 'Low Stock Alerts', tag: 'div,span,p,button', contains: true });
    await r.caption('and warns you before something runs out', '3');
    await r.sleep(2500);
    await goSidebar(r, 'Z-Report (End of Day)', 'Sales Reports');
    await r.caption('At day end: the Z-report, cash, card and tax', '4');
    await r.sleep(1200);
    await r.scroll(380);
    await r.sleep(2800);
  });
}

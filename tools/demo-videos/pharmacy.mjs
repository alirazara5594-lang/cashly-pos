// "Cashly for pharmacies": register, add medicines with formula and batches, sell by box or strip,
// see the day.
import { signIn, hideChecklist, register, addCategory, stockIn } from './common.mjs';
export const name = 'pharmacy';

const test = process.env.DEMO_TEST;
/** Resume: the pharmacy and its medicines already exist (a previous run stopped halfway). */
const skipSetup = process.env.SKIP_SETUP === '1';

const biz = test
  ? { name: `Test Pharmacy ${test}`, slug: `test-pharmacy-${test}`, mobile: `0302 66609${String(test).padStart(2, '0')}` }
  : { name: 'Noor Pharmacy', slug: 'noor-pharmacy', mobile: '0300 4512874' };
const owner = { owner: 'Dr Bilal Ahmed', username: 'bilal', pin: '739461' };
const eyebrow = n => `Cashly for pharmacies · Step ${n}`;
const fast = { delay: [5, 10] };

const K = {
  first: {
    category: 'Painkillers', name: 'Panadol 500mg', genericName: 'Paracetamol', strength: '500 mg',
    company: 'GSK', form: 'Tablet', packUnits: '20', stripUnits: '10',
    cost: 180, price: 240, barcode: '8964100010017'
  },
  firstStock: { qty: 40, supplier: 'GSK distributor', batch: 'PN-8842', expiry: '2027-09' },
  more: [
    {
      category: 'Antibiotics', name: 'Augmentin 625mg', genericName: 'Co-amoxiclav', strength: '625 mg',
      company: 'GSK', form: 'Tablet', cost: 520, price: 640, barcode: '8964100020018',
      stock: 15, batch: 'AG-1102', expiry: '2027-05'
    },
    {
      category: 'Painkillers', name: 'Brufen 400mg', genericName: 'Ibuprofen', strength: '400 mg',
      company: 'Abbott', form: 'Tablet', cost: 210, price: 260, barcode: '8964100040011',
      stock: 18, batch: 'BR-5521', expiry: '2027-03'
    },
    {
      category: 'Syrups', name: 'Panadol Syrup 120ml', genericName: 'Paracetamol', strength: '120mg/5ml',
      company: 'GSK', form: 'Syrup', cost: 140, price: 175, barcode: '8964100030019',
      stock: 24, batch: 'PS-3390', expiry: '2027-08'
    }
  ]
};

const goSidebar = async (r, link, group) => {
  if (!(await r.has({ text: link, tag: 'a', contains: true }))) await r.click({ text: group, tag: 'button', contains: true }, { after: 600 });
  await r.click({ text: link, tag: 'a', contains: true }, { after: 2200 });
};

/** Add a medicine: the product form, then its formula, form and packing. */
async function addMedicine(r, m, { quick = false, say } = {}) {
  const o = quick ? { ms: 150 } : {};
  await r.click({ text: 'Products', contains: true, tag: 'button' }, { after: quick ? 500 : 900, ...o });
  await r.click({ text: 'Add Product', contains: true, after: quick ? 600 : 1000, ...o });
  await r.choose({ label: 'Category' }, m.category, { after: quick ? 200 : 500 });
  await r.type({ label: 'Product name' }, m.name, quick ? fast : {});
  if (say) await say.afterName?.();
  await r.type({ label: 'Cost price' }, String(m.cost), { clear: true, ...(quick ? fast : {}) });
  await r.type({ label: 'Selling price' }, String(m.price), { clear: true, ...(quick ? fast : {}) });
  if (m.barcode) {
    if (say) await say.beforeBarcode?.();
    await r.type({ label: 'Barcode' }, m.barcode, quick ? fast : { delay: [25, 45] });
  }
  if (say) await say.medicine?.();
  if (m.genericName) await r.type({ label: 'Formula (generic name)' }, m.genericName, quick ? fast : {});
  if (m.strength) await r.type({ label: 'Strength' }, m.strength, quick ? fast : {});
  if (m.company) await r.type({ label: 'Company' }, m.company, quick ? fast : {});
  if (m.form) await r.choose({ label: 'Form' }, m.form, { after: quick ? 200 : 500 });
  if (m.packUnits) {
    await r.setValue({ css: '#pack-units' }, m.packUnits);
    await r.sleep(quick ? 150 : 500);
  }
  if (m.stripUnits) {
    await r.setValue({ css: '#strip-units' }, m.stripUnits);
    await r.sleep(quick ? 150 : 500);
  }
  await r.click({ text: 'Create Product', contains: true, after: 1500, ...o });
}

/** The smallest cash note that covers the total is the one offered. */
const payCash = async r => {
  for (const note of ['1,000', '2,000', '5,000']) {
    if (await r.has({ text: note, tag: 'button' })) { await r.click({ text: note, tag: 'button' }, { after: 1200 }); break; }
  }
};

export default async function ({ r, video }) {
  if (skipSetup) {
    // The pharmacy and its medicines are already there; pick up at the till.
    await signIn(r, biz.slug, owner.username, owner.pin, { quick: true });
    await hideChecklist(r);
    await r.goto('/', { wait: 3000 });
  } else {
    // 1 — Register.
    await r.goto('/signup', { wait: 2500 });
    await video('pharmacy-1-register', { eyebrow: eyebrow(1), title: 'Register your pharmacy', subtitle: 'Name your pharmacy, pick a plan, and create your owner account.', posterAt: 9 }, async () => {
      await register(r, { kind: 'Pharmacy', name: biz.name, province: 'PK-PB', city: 'Lahore', mobile: biz.mobile, ...owner, sampleItems: false }, { captions: true });
      await r.caption('Your POS is ready. Staff sign in with their username and PIN.', '✓');
      await r.sleep(3500);
    });

    await signIn(r, biz.slug, owner.username, owner.pin, { quick: true });
    await hideChecklist(r);
    await r.goto('/menu', { wait: 2500 });

    // 2 — Medicines.
    await video('pharmacy-2-products', { eyebrow: eyebrow(2), title: 'Add your medicines', subtitle: 'Medicines with their formula, packing and price, then the stock you receive.', posterAt: 18 }, async () => {
      await r.caption('Product Catalog: first, a category', '1');
      await addCategory(r, K.first.category);
      await r.caption('Then the medicine: name, price and barcode', '2');
      await addMedicine(r, K.first, {
        say: {
          beforeBarcode: () => r.caption('Scan or type its barcode', '3'),
          medicine: () => r.caption('Its formula, form and packing', '4')
        }
      });
      await r.caption('Now receive the stock, with its batch', '5');
      await goSidebar(r, 'Stock', 'Inventory');
      await stockIn(r, K.first.name, K.firstStock.qty, {
        ...K.firstStock,
        say: () => r.caption('With its batch and expiry month', '6')
      });
      await r.caption('In stock, and on the till', '✓');
      await r.hover({ text: K.first.name, tag: 'td,div,span,p', contains: true });
      await r.sleep(2500);
    });

    // More medicines, with stock (not recorded).
    await r.goto('/menu', { wait: 2500 });
    const cats = new Set([K.first.category]);
    for (const p of K.more) {
      if (!cats.has(p.category)) { await addCategory(r, p.category, { quick: true }); cats.add(p.category); }
      await addMedicine(r, p, { quick: true });
    }
    await r.goto('/inventory', { wait: 2500 });
    for (const p of K.more) await stockIn(r, p.name, p.stock, { quick: true });
  }
  await r.goto('/', { wait: 3000 });

  // 3 — Sell: find by formula, sell a strip and a box.
  await video('pharmacy-3-sell', { eyebrow: eyebrow(3), title: 'Sell at the counter', subtitle: 'Find a medicine by name or formula, sell by box or strip, take the payment.', posterAt: 12 }, async () => {
    await r.caption('Find the medicine by its formula', '1');
    await r.type({ placeholder: 'Search medicine' }, 'Paracetamol', { delay: [25, 45] });
    await r.sleep(1500);
    await r.caption('Tap it to add to the bill', '2');
    await r.click({ text: 'Add', tag: 'button', near: 'Panadol 500mg' }, { after: 1000 });
    await r.caption('Sell it by the strip, not the box', '3');
    await r.click({ text: 'Strip', tag: 'button', contains: true }, { after: 1400 });
    await r.caption('Another medicine, by its brand name', '4');
    await r.type({ placeholder: 'Search medicine' }, 'Augmentin', { clear: true, delay: [25, 45] });
    await r.sleep(1200);
    await r.click({ text: 'Add', tag: 'button', near: 'Augmentin' }, { after: 1000 });
    await r.caption('Cash: Cashly works out the change', '5');
    await payCash(r);
    await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2200 });
    await r.caption('Paid. The receipt is ready to print.', '6');
    await r.sleep(3500);
    await r.click({ text: 'Close', tag: 'button' }, { after: 1000 });
  });

  // A second sale, by card (not recorded).
  await r.type({ placeholder: 'Search medicine' }, K.more[1].name, { clear: true, delay: [5, 10], after: 100 });
  await r.sleep(600);
  await r.click({ text: 'Add', tag: 'button', near: K.more[1].name }, { after: 600, ms: 150 });
  await r.click({ text: 'Card', tag: 'button' }, { after: 300, ms: 150 });
  await r.click({ text: 'Charge', tag: 'button', contains: true, enabled: true }, { after: 2000, ms: 150 });
  if (await r.has({ text: 'Close', tag: 'button' })) await r.click({ text: 'Close', tag: 'button' }, { after: 800, ms: 150 });

  // 4 — The day.
  await video('pharmacy-4-reports', { eyebrow: eyebrow(4), title: 'See your day', subtitle: 'Sales, stock and the day-end report.', posterAt: 7 }, async () => {
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

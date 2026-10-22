// Shared steps for the demo scripts.

/** Sign in at a business's own address with username and PIN (typed on the keypad). */
export async function signIn(r, slug, username, pin, { quick = false } = {}) {
  await r.goto(`/r/${slug}`, { wait: 2500 });
  await r.waitFor({ label: 'Username' });
  await r.type({ label: 'Username' }, username, { delay: quick ? [5, 10] : undefined });
  for (const d of pin) await r.click({ text: d, tag: 'button' }, { after: quick ? 60 : 180, ms: quick ? 120 : undefined });
  await r.click({ text: 'Sign in', tag: 'button', enabled: true }, { after: 2500 });
}

const fast = { delay: [5, 10] };

/** Product Catalog → Categories → Add Category (the page must be open). */
export async function addCategory(r, name, { quick = false } = {}) {
  await r.click({ text: 'Categories', contains: true, tag: 'button' }, { after: quick ? 500 : 900, ms: quick ? 150 : undefined });
  await r.click({ text: 'Add Category', contains: true }, { after: quick ? 500 : 900, ms: quick ? 150 : undefined });
  await r.type({ placeholder: 'e.g. Burgers' }, name, quick ? fast : {});
  await r.click({ text: 'Create', tag: 'button', enabled: true }, { after: 1300, ms: quick ? 150 : undefined });
}

/** Product Catalog → Products → Add Product (the page must be open). */
export async function addProduct(r, { category, name, cost, price, barcode }, { quick = false, say } = {}) {
  const o = quick ? { ms: 150 } : {};
  await r.click({ text: 'Products', contains: true, tag: 'button' }, { after: quick ? 500 : 900, ...o });
  await r.click({ text: 'Add Product', contains: true }, { after: quick ? 600 : 1000, ...o });
  await r.choose({ label: 'Category' }, category, { after: quick ? 200 : 500 });
  await r.type({ label: 'Product name' }, name, quick ? fast : {});
  if (say) await say.afterName?.();
  await r.type({ label: 'Cost price' }, String(cost), { clear: true, ...(quick ? fast : {}) });
  await r.type({ label: 'Selling price' }, String(price), { clear: true, ...(quick ? fast : {}) });
  if (barcode) {
    if (say) await say.beforeBarcode?.();
    await r.type({ label: 'Barcode' }, barcode, quick ? fast : { delay: [25, 45] });
  }
  await r.click({ text: 'Create Product', contains: true }, { after: 1500, ...o });
}

/** Stock → the product's Stock In (the Stock page must be open). Batch-managed stock (a mart's)
 * opens a different dialog — "Quantity bought (Piece)" instead of "Quantity to Inward". */
export async function stockIn(r, product, qty, { supplier, batch, expiry, quick = false, say } = {}) {
  const o = quick ? { ms: 150 } : {};
  await r.click({ text: 'Stock In', tag: 'button', near: product }, { after: quick ? 600 : 1000 });
  const qtyLabel = await r.has({ label: 'Quantity to Inward' }) ? 'Quantity to Inward'
    : await r.has({ label: 'Quantity bought' }) ? 'Quantity bought'
    : 'Boxes bought';
  await r.type({ label: qtyLabel }, String(qty), { clear: true, ...(quick ? fast : {}) });
  if (supplier) await r.type({ label: 'Supplier Name' }, supplier, quick ? fast : {});
  if (batch) await r.type({ label: 'Batch Number' }, batch, quick ? fast : {});
  if (expiry) {
    // A medicine's expiry is the month on the pack; anything else, the full date.
    const expiryLabel = await r.has({ label: 'Expiry Date' }) ? 'Expiry Date' : 'Expiry (month on pack)';
    await r.setValue({ label: expiryLabel }, expiry);
  }
  if (say) await say();
  await r.click({ text: 'Confirm Stock-In', contains: true }, { after: 1500, ...o });
}

/** Close the "Getting started" checklist (it stays closed in this browser). */
export async function hideChecklist(r) {
  const spec = { css: 'button[title="Hide the checklist"], button[aria-label="Hide the checklist"]' };
  if (await r.has(spec)) { await r.click(spec, { after: 700, ms: 200 }); }
}

/** Register a Cashly POS business through the sign-up screens. */
export async function register(r, { kind, name, province = 'PK-PB', city, plan, owner, mobile, username, pin, sampleItems }, { captions = false, quick = false } = {}) {
  const say = async (text, key) => { if (captions) await r.caption(text, key); };
  const t = quick ? { delay: [5, 10] } : {};
  if (await r.evaluate('location.pathname') !== '/signup') await r.goto('/signup', { wait: 2500 });
  await say('One shop? Choose Cashly POS', '1');
  await r.click({ text: 'Choose Cashly POS', contains: true }, { after: 900 });
  await say('Pick your kind of business and name it', '2');
  await r.click({ text: kind, contains: true }, { after: 600 });
  await r.type({ label: 'Business name' }, name, t);
  await r.sleep(500);
  await r.select({ label: 'Province' }, province);
  if (city) await r.type({ label: 'City' }, city, t);
  await r.click({ text: 'Continue', contains: true }, { after: 1000 });
  await say('Choose a plan', '3');
  // The whole plan card is the choice (a radio); its name opens it.
  if (plan) await r.click({ text: plan, tag: 'span' }, { after: 800 });
  else await r.sleep(1500);
  await r.click({ text: 'Continue', contains: true }, { after: 1000 });
  await say('Your owner account: you sign in with a username and PIN', '4');
  await r.type({ label: 'Full name' }, owner, t);
  await r.type({ label: 'Mobile number' }, mobile, t);
  await r.type({ label: 'Username' }, username, t);
  await r.type({ label: '6-digit PIN' }, pin, t);
  if (sampleItems === false && await r.has({ text: 'Start with a few sample items', tag: 'label', contains: true })) {
    await r.click({ text: 'Start with a few sample items', tag: 'label', contains: true }, { after: 400 });
  }
  await r.click({ text: 'Continue', contains: true }, { after: 1200 });
  await say('Check everything, agree to the terms, and create', '5');
  await r.click({ css: 'label[for="reg-agree"]' }, { after: 600 });
  await r.click({ text: 'Create my business', contains: true }, { after: 600 });
  await r.waitText('is registered', 30000);
  await r.sleep(800);
}

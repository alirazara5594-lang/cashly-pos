// Explore: a pharmacy — sidebar, catalog, the medicine form, the till.
import { signIn, hideChecklist, register } from './common.mjs';
export const name = 'explore-pharmacy';

const listButtons = r => r.evaluate(`[...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.getAttribute('aria-label') || b.title || b.textContent).trim().slice(0, 40)).join(' | ')`);
const listLinks = r => r.evaluate(`[...document.querySelectorAll('aside a, nav a')].filter(a => a.getBoundingClientRect().width > 0).map(a => a.textContent.trim() + ' -> ' + a.getAttribute('href')).join('\\n')`);
const listFields = r => r.evaluate(`[...document.querySelectorAll('input,select,textarea')].filter(b => b.getBoundingClientRect().width > 0).map(e => { const l = e.labels && e.labels[0] ? e.labels[0] : e.parentElement && e.parentElement.querySelector('label'); return e.tagName + ' ph=' + (e.placeholder || '') + ' label=' + (l ? l.textContent.trim().slice(0, 40) : (e.getAttribute('aria-label') || '')); }).join('\\n')`);

export default async function ({ r, shot }) {
  await register(r, { kind: 'Pharmacy', name: 'Explore Pharmacy', city: 'Lahore', mobile: '0300 1110003', owner: 'Dr Bilal', username: 'bilal', pin: '739461' }, { quick: true });
  await signIn(r, 'explore-pharmacy', 'bilal', '739461', { quick: true });
  await hideChecklist(r);
  await shot('pos');
  console.log('links:\n' + await listLinks(r));
  console.log('pos buttons:', await listButtons(r));
  await r.goto('/menu', { wait: 3000 });
  await shot('catalog');
  console.log('catalog buttons:', await listButtons(r));
}

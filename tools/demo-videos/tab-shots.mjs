// Opens the sign-in page in headless Edge, clicks each top-bar tab and screenshots the open menu.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = 'http://localhost:5173/';
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const W = 1920, H = 1080;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const port = 9700 + Math.floor(Math.random() * 200);
const profile = join(import.meta.dirname, 'profiles', 'tabshots');
mkdirSync(profile, { recursive: true });

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch { /* starting */ }
  await sleep(250);
}
const own = targets.find(t => t.type === 'page');
const ws = new WebSocket(own.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}, timeoutMs = 45000) => new Promise((resolve, reject) => {
  const n = ++id;
  const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer`)); }, timeoutMs);
  pending.set(n, m => { clearTimeout(timer); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalPage = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async name => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
  console.log('wrote', name);
};

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP });
  for (let i = 0; i < 80; i++) {
    const ready = await evalPage(`!!document.querySelector('nav button[aria-haspopup="true"]') && document.body.innerText.includes('Smart POS')`);
    if (ready) break;
    await sleep(500);
  }
  await sleep(1200);

  for (const label of ['Features', 'Pricing', 'Support']) {
    const clicked = await evalPage(`(() => {
      const b = [...document.querySelectorAll('nav button[aria-haspopup="true"]')].find(x => x.textContent.trim().startsWith('${label}'));
      if (!b) return false; b.click(); return true;
    })()`);
    if (!clicked) { console.log('no button', label); continue; }
    await sleep(700);
    await shot(`tab-${label.toLowerCase()}.png`);
    await evalPage(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(300);
  }
} finally {
  try { ws.close(); } catch { /* gone */ }
  proc.kill();
}

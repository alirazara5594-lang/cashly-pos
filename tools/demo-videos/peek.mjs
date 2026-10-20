// Screenshot a running recorder browser: node peek.mjs <port> <out.png>
import { writeFileSync } from 'node:fs';
const [, , port, out] = process.argv;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const t = setTimeout(() => { console.log('page not answering'); process.exit(1); }, 15000);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
const ev = await send('Runtime.evaluate', { expression: 'location.href + " | " + document.title', returnByValue: true });
console.log(page.url, '|', ev.result?.result?.value);
clearTimeout(t); ws.close();

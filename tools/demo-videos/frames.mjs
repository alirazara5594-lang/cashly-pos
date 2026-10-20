// Grab frames from an MP4 at given seconds: node frames.mjs <video.mp4> <outPrefix> 5,15,30
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const [, , file, prefix, times] = process.argv;
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 200);
const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-extensions', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${prefix}-profile`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page' && t.url === 'about:blank')) break; } catch { /* starting */ } await sleep(250); }
const own = targets.find(t => t.type === 'page' && t.url === 'about:blank') ?? targets.find(t => t.type === 'page');
if (!own) { console.log('no page target; targets:', JSON.stringify(targets).slice(0, 400)); proc.kill(); process.exit(1); }
const ws = new WebSocket(own.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const b64 = readFileSync(file).toString('base64');
const res = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('cannot play')); });
  const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight, frames: [] };
  for (const t of [${times}]) {
    v.currentTime = Math.min(t, v.duration - 0.1); await new Promise(r => v.onseeked = r);
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    out.frames.push(c.toDataURL('image/png'));
  }
  return out;
})()` });
const v = res.result.result?.value;
if (!v) { console.log(JSON.stringify(res.result).slice(0, 500)); } else {
  console.log(JSON.stringify({ duration: v.duration, size: `${v.w}x${v.h}` }));
  v.frames.forEach((f, i) => writeFileSync(`${prefix}-${i}.png`, Buffer.from(f.split(',')[1], 'base64')));
}
ws.close(); proc.kill();

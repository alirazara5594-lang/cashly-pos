// Cashly demo recorder: drives the app in headless Edge (pointed at the demo backend), records it
// with a visible cursor, captions and a title card, and encodes MP4 in a second headless Edge.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// The app runs at a laptop's size; the video is 720p.
const W = 1440, H = 810;

/** Close any tab that is not ours (an extension's welcome page would push ours to the background,
 *  where Edge stops handling input and every click waits forever). */
async function guardTabs(port, ownId) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') {
      const t = m.params.targetInfo;
      if (t.type === 'page' && t.targetId !== ownId) {
        console.log('closing a tab that opened by itself:', t.url.slice(0, 80));
        send('Target.closeTarget', { targetId: t.targetId });
        send('Target.activateTarget', { targetId: ownId });
      }
    }
  });
  send('Target.setDiscoverTargets', { discover: true });
  return ws;
}

async function openBrowser(edge, profile, extraArgs = []) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--disable-extensions', '--disable-component-extensions-with-background-pages', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${W},${H + 120}`, ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page' && t.url === 'about:blank')) break; } catch { /* starting */ }
    await sleep(250);
  }
  const own = targets.find(t => t.type === 'page' && t.url === 'about:blank') ?? targets.find(t => t.type === 'page');
  const guard = await guardTabs(port, own.id);
  const ws = new WebSocket(own.webSocketDebuggerUrl);
  ws.binaryType = 'arraybuffer';
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const listeners = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    for (const l of listeners) l(m);
  });
  const send = (method, params = {}, timeoutMs = 45000) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer in ${timeoutMs / 1000}s`)); }, timeoutMs);
    pending.set(n, m => { clearTimeout(timer); if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression, timeoutMs = 45000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400));
    return r.result.value;
  };
  return { proc, send, evaluate, on: l => listeners.push(l), close: () => { try { ws.close(); guard.close(); } catch { /* gone */ } proc.kill(); } };
}

// Everything drawn over the app while recording: cursor, click ripple, caption, title card.
const OVERLAY = String.raw`(() => {
  if (window.__rec) return;
  const S = { x: 720, y: 430 };
  const css = '#__rec_cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform var(--d,600ms) cubic-bezier(.45,.05,.25,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}'
    + '.__rec_ripple{position:fixed;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;border:3px solid rgba(16,185,129,.95);background:rgba(16,185,129,.2);z-index:2147483646;pointer-events:none;animation:__rec_r 650ms ease-out forwards}'
    + '@keyframes __rec_r{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}'
    + '#__rec_caption{position:fixed;left:50%;bottom:26px;transform:translate(-50%,10px);max-width:84%;padding:12px 22px;border-radius:14px;background:rgba(6,25,31,.9);color:#fff;font:600 19px/1.35 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:2147483645;pointer-events:none;opacity:0;transition:opacity 350ms,transform 350ms;text-align:center}'
    + '#__rec_caption.top{bottom:auto;top:22px}'
    + '#__rec_caption.on{opacity:1;transform:translate(-50%,0)}'
    + '#__rec_caption .k{display:inline-block;margin-right:10px;padding:1px 9px;border-radius:999px;background:#10b981;color:#04302a;font-size:15px;vertical-align:1px}'
    + '#__rec_title{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:radial-gradient(ellipse at 72% 18%,rgba(52,211,153,.2),transparent 60%),linear-gradient(135deg,#06191f,#0a3138 55%,#0c443d);color:#fff;font-family:Inter,system-ui,sans-serif;opacity:0;transition:opacity 550ms;pointer-events:none}'
    + '#__rec_title.on{opacity:1}'
    + '#__rec_title .logo{width:62px;height:62px;border-radius:18px;background:linear-gradient(135deg,#34d399,#0d9488);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:28px;box-shadow:0 10px 30px rgba(0,0,0,.35);margin-bottom:6px}'
    + '#__rec_title .eyebrow{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7}'
    + '#__rec_title .t{font-size:46px;font-weight:600;letter-spacing:-.02em}'
    + '#__rec_title .s{font-size:20px;color:rgba(255,255,255,.72);max-width:780px;text-align:center;line-height:1.4}';
  function ensure() {
    if (!document.body || !document.head) return false;
    if (document.getElementById('__rec_cursor')) return true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__rec_cursor';
    c.innerHTML = '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M4 2.5l8 20 2.7-8 8.1-2.9z" fill="#0f172a" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    c.style.transform = 'translate(' + (S.x - 4) + 'px,' + (S.y - 2.5) + 'px)';
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__rec_caption'; document.body.appendChild(cap);
    const t = document.createElement('div'); t.id = '__rec_title'; document.body.appendChild(t);
    return true;
  }
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  window.__rec = {
    ensure,
    move(x, y, ms) { ensure(); const c = document.getElementById('__rec_cursor'); c.style.setProperty('--d', ms + 'ms'); c.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2.5) + 'px)'; S.x = x; S.y = y; },
    ripple(x, y) { ensure(); const r = document.createElement('div'); r.className = '__rec_ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 700); },
    caption(text, key, top) { ensure(); const el = document.getElementById('__rec_caption'); if (!text) { el.classList.remove('on'); return; } el.className = top ? 'top' : ''; el.innerHTML = (key ? '<span class="k">' + key + '</span>' : '') + text; requestAnimationFrame(() => el.classList.add('on')); },
    title(eyebrow, t, s) { ensure(); const el = document.getElementById('__rec_title'); document.getElementById('__rec_cursor').style.opacity = t ? '0' : '1'; if (!t) { el.classList.remove('on'); return; } el.innerHTML = '<div class="logo">C</div><div class="eyebrow">' + eyebrow + '</div><div class="t">' + t + '</div>' + (s ? '<div class="s">' + s + '</div>' : ''); el.classList.add('on'); },
    titleNow(eyebrow, t, s) { ensure(); const el = document.getElementById('__rec_title'); el.style.transition = 'none'; this.title(eyebrow, t, s); el.offsetHeight; el.style.transition = ''; },
    pos() { return { x: S.x, y: S.y }; },
    find(spec) {
      let els = [];
      const root = spec.within ? window.__rec.find(spec.within)?.el : document;
      if (!root) return null;
      if (spec.css) els = [...root.querySelectorAll(spec.css)];
      else if (spec.label) {
        const ctrl = 'input:not([type=hidden]),select,textarea';
        const wanted = spec.label.toLowerCase();
        const normLabel = l => norm(l.textContent).replace(/\*$/, '').trim().toLowerCase();
        // An exact label wins over one that merely starts with it ("Form" vs "Formula …").
        const all = [...root.querySelectorAll('label')].filter(l => normLabel(l).startsWith(wanted));
        const exact = all.filter(l => normLabel(l) === wanted);
        els = (exact.length ? exact : all)
          .map(l => (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector(ctrl)) || l.parentElement?.querySelector(ctrl) || l);
        els = els.concat([...root.querySelectorAll('[aria-label]')].filter(e => e.getAttribute('aria-label') === spec.label));
      } else if (spec.placeholder) els = [...root.querySelectorAll('input,textarea')].filter(e => (e.placeholder || '').includes(spec.placeholder));
      else if (spec.text) {
        const tags = spec.tag || 'button,a,[role=button],[role=tab],[role=radio],[role=option],[role=menuitem],summary';
        els = [...root.querySelectorAll(tags)].filter(e => spec.contains ? norm(e.textContent).includes(spec.text) : norm(e.textContent) === spec.text);
        els.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
      }
      els = els.filter(e => visible(e) && (!spec.enabled || !e.disabled));
      // "near": the one inside the same card as this text (a product's own Add button).
      if (spec.near) {
        const same = new Set(els);
        els = els.filter(e => {
          for (let p = e.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) {
            const mates = [...p.querySelectorAll(e.tagName)].filter(x => same.has(x)).length;
            if (mates > 1) return false; // reached a box shared with other cards
            if (norm(p.textContent).includes(spec.near)) return true;
          }
          return false;
        });
      }
      const el = els[spec.nth || 0];
      if (!el) return null;
      return { el, count: els.length };
    },
    rect(spec, center) {
      const f = window.__rec.find(spec); if (!f) return null;
      let r = f.el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 60) { f.el.scrollIntoView({ block: center === false ? 'nearest' : 'center' }); r = f.el.getBoundingClientRect(); }
      return { x: r.left, y: r.top, w: r.width, h: r.height, tag: f.el.tagName, disabled: !!f.el.disabled, count: f.count };
    },
    setValue(spec, value) {
      const f = window.__rec.find(spec); if (!f) return false;
      const proto = f.el.tagName === 'SELECT' ? HTMLSelectElement.prototype : f.el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(f.el, value);
      f.el.dispatchEvent(new Event(f.el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      return true;
    },
    optionValue(spec, text) {
      const f = window.__rec.find(spec); if (!f || f.el.tagName !== 'SELECT') return null;
      const o = [...f.el.options].find(o => norm(o.textContent) === text) || [...f.el.options].find(o => norm(o.textContent).includes(text));
      return o ? o.value : null;
    },
    text() { return document.body ? document.body.innerText : ''; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
})();`;

export async function launchApp({ edge, profile, appUrl, apiUrl }) {
  const b = await openBrowser(edge, profile);
  const { send, evaluate } = b;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { if (location.origin === ${JSON.stringify(new URL(appUrl).origin)}) localStorage.setItem('cashly_api_url', ${JSON.stringify(apiUrl)}); } catch {}\n` + OVERLAY
  });

  let frames = null;
  b.on(m => {
    // An alert/confirm would freeze the page (and every evaluate) until answered.
    if (m.method === 'Page.javascriptDialogOpening') {
      console.log(`dialog (${m.params.type}): ${m.params.message}`);
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      return;
    }
    if (m.method === 'Page.screencastFrame') {
      if (frames) frames.push({ data: m.params.data, t: m.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
    }
  });

  const cursor = { x: 720, y: 430 };
  const r = {
    sleep,
    evaluate,
    /** Any DevTools call (a script checking a layout at another window size, say). */
    send,
    async ensureOverlay() { await evaluate(OVERLAY + `; window.__rec.ensure(); window.__rec.move(${cursor.x}, ${cursor.y}, 0);`); },
    async goto(path, { wait = 1500 } = {}) {
      await send('Page.navigate', { url: new URL(path, appUrl).toString() });
      await sleep(wait);
      await evaluate(`window.__rec && (window.__rec.ensure(), window.__rec.move(${cursor.x}, ${cursor.y}, 0))`);
    },
    async waitFor(spec, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const found = await evaluate(`!!(window.__rec && window.__rec.find(${JSON.stringify(spec)}))`);
        if (found) return true;
        await sleep(150);
      }
      throw new Error('Not found: ' + JSON.stringify(spec));
    },
    async waitText(text, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await evaluate(`(window.__rec ? window.__rec.text() : document.body.innerText).includes(${JSON.stringify(text)})`)) return true;
        await sleep(150);
      }
      throw new Error('Text not found: ' + text);
    },
    async has(spec) { return evaluate(`!!(window.__rec && window.__rec.find(${JSON.stringify(spec)}))`); },
    async moveTo(x, y, ms) {
      const d = Math.hypot(x - cursor.x, y - cursor.y);
      const dur = ms ?? Math.round(Math.min(950, Math.max(380, d * 0.9)));
      await evaluate(`window.__rec.move(${x}, ${y}, ${dur})`);
      cursor.x = x; cursor.y = y;
      await sleep(dur + 60);
    },
    async point(spec, { at = [0.5, 0.5] } = {}) {
      await r.waitFor(spec);
      const rect = await evaluate(`window.__rec.rect(${JSON.stringify(spec)})`);
      await sleep(120);
      return { x: Math.round(rect.x + rect.w * at[0]), y: Math.round(rect.y + rect.h * at[1]), rect };
    },
    async hover(spec, opts = {}) { const p = await r.point(spec, opts); await r.moveTo(p.x, p.y); return p; },
    async click(spec, { after = 550, at, ms } = {}) {
      const p = await r.point(spec, { at });
      await r.moveTo(p.x, p.y, ms);
      await evaluate(`window.__rec.ripple(${p.x}, ${p.y})`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(70);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(after);
    },
    async keys(text, { delay = [45, 85] } = {}) {
      for (const ch of text) {
        await send('Input.insertText', { text: ch });
        await sleep(delay[0] + Math.random() * (delay[1] - delay[0]));
      }
    },
    async type(spec, text, { clear = false, after = 350, delay } = {}) {
      await r.click(spec, { after: 200 });
      if (clear) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await r.press('Backspace');
      }
      await r.keys(text, { delay });
      await sleep(after);
    },
    async press(key) {
      const codes = { Enter: [13, 'Enter'], Backspace: [8, 'Backspace'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'] };
      const [vk, code] = codes[key] ?? [key.toUpperCase().charCodeAt(0), 'Key' + key.toUpperCase()];
      const extra = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...extra });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
      await sleep(120);
    },
    /** A <select>: the pointer goes there and clicks, the value is set (native lists do not show in a recording). */
    async select(spec, value, { after = 500 } = {}) {
      const p = await r.point(spec);
      await r.moveTo(p.x, p.y);
      await evaluate(`window.__rec.ripple(${p.x}, ${p.y})`);
      await sleep(250);
      const ok = await evaluate(`window.__rec.setValue(${JSON.stringify(spec)}, ${JSON.stringify(value)})`);
      if (!ok) throw new Error('select failed: ' + JSON.stringify(spec));
      await sleep(after);
    },
    async setValue(spec, value) { return evaluate(`window.__rec.setValue(${JSON.stringify(spec)}, ${JSON.stringify(value)})`); },
    /** A <select>, by the text of the option. */
    async choose(spec, text, opts) {
      await r.waitFor(spec);
      const value = await evaluate(`window.__rec.optionValue(${JSON.stringify(spec)}, ${JSON.stringify(text)})`);
      if (value == null) throw new Error(`No option "${text}" in ${JSON.stringify(spec)}`);
      await r.select(spec, value, opts);
    },
    async scroll(dy, { x = 760, y = 450, steps = 6 } = {}) {
      for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy / steps }); await sleep(40); }
      await sleep(400);
    },
    async caption(text, key, { top = false } = {}) { await evaluate(`window.__rec.caption(${JSON.stringify(text)}, ${JSON.stringify(key ?? null)}, ${top})`); await sleep(text ? 450 : 350); },
    async title(eyebrow, t, s) { await evaluate(`window.__rec.title(${JSON.stringify(eyebrow)}, ${JSON.stringify(t)}, ${JSON.stringify(s ?? null)})`); },
    async titleNow(eyebrow, t, s) { await evaluate(`window.__rec.titleNow(${JSON.stringify(eyebrow)}, ${JSON.stringify(t)}, ${JSON.stringify(s ?? null)})`); },
    async shot(file) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(s.data, 'base64'));
    },
    async startRecording() {
      frames = [];
      await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    },
    async stopRecording() {
      await send('Page.stopScreencast');
      const out = frames; frames = null; return out;
    },
    close: b.close
  };
  return r;
}

/** MP4 from screencast frames, in real time, in its own headless browser. */
export async function makeEncoder({ edge, profile }) {
  const b = await openBrowser(edge, profile);
  await b.send('Runtime.enable');
  await b.evaluate(String.raw`(() => {
    window.__enc = {
      frames: [],
      add(list) { for (const f of list) this.frames.push(f); return this.frames.length; },
      reset() { this.frames = []; this.blob = null; },
      async run(mime, bps, holdMs, posterAt) {
        const W = 1280, H = 720;
        const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
        const decode = async f => createImageBitmap(await (await fetch('data:image/jpeg;base64,' + f.data)).blob());
        const fr = this.frames, t0 = fr[0].t;
        let cur = await decode(fr[0]); g.drawImage(cur, 0, 0, W, H);
        const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: bps });
        const parts = []; rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
        rec.start(1000);
        const start = performance.now();
        const waitUntil = async ms => { while (performance.now() - start < ms) { g.drawImage(cur, 0, 0, W, H); await new Promise(r => setTimeout(r, Math.min(90, Math.max(5, ms - (performance.now() - start))))); } };
        let next = fr.length > 1 ? decode(fr[1]) : null;
        let poster = null;
        for (let i = 1; i < fr.length; i++) {
          const bmp = await next;
          next = i + 1 < fr.length ? decode(fr[i + 1]) : null;
          await waitUntil((fr[i].t - t0) * 1000);
          cur.close(); cur = bmp; g.drawImage(cur, 0, 0, W, H);
          if (!poster && posterAt != null && fr[i].t - t0 >= posterAt) {
            const pc = document.createElement('canvas'); pc.width = 640; pc.height = 360;
            pc.getContext('2d').drawImage(cur, 0, 0, 640, 360); poster = pc.toDataURL('image/jpeg', 0.82);
          }
        }
        await waitUntil((fr[fr.length - 1].t - t0) * 1000 + holdMs);
        rec.stop(); await new Promise(r => rec.onstop = r);
        if (!poster) { const pc = document.createElement('canvas'); pc.width = 640; pc.height = 360; pc.getContext('2d').drawImage(cur, 0, 0, 640, 360); poster = pc.toDataURL('image/jpeg', 0.82); }
        cur.close();
        this.blob = new Blob(parts, { type: mime.split(';')[0] });
        this.poster = poster;
        const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(this.blob);
        await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 5000); });
        return { size: this.blob.size, duration: v.duration, seconds: (performance.now() - start) / 1000 };
      },
      async chunk(i, size) {
        const buf = new Uint8Array(await this.blob.slice(i * size, (i + 1) * size).arrayBuffer());
        let s = ''; for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
        return btoa(s);
      }
    };
  })()`);
  return {
    async encode(frames, outFile, { bps = 1100000, holdMs = 1500, posterAt = null } = {}) {
      await b.evaluate('window.__enc.reset()');
      for (let i = 0; i < frames.length; i += 40) await b.evaluate(`window.__enc.add(${JSON.stringify(frames.slice(i, i + 40))})`);
      const info = await b.evaluate(`window.__enc.run('video/mp4;codecs=avc1', ${bps}, ${holdMs}, ${posterAt == null ? 'null' : posterAt})`, 15 * 60 * 1000);
      const size = 2 * 1024 * 1024; const parts = [];
      for (let i = 0; i * size < info.size; i++) parts.push(Buffer.from(await b.evaluate(`window.__enc.chunk(${i}, ${size})`), 'base64'));
      writeFileSync(outFile, Buffer.concat(parts));
      const poster = await b.evaluate('window.__enc.poster');
      writeFileSync(outFile.replace(/\.mp4$/, '.jpg'), Buffer.from(poster.split(',')[1], 'base64'));
      return { ...info, frames: frames.length };
    },
    close: b.close
  };
}

export function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; }
export { join, sleep };

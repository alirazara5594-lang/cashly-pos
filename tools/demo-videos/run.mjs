// Runs one demo script: node run.mjs <script.mjs> [--record] [--only name,name]
import { launchApp, makeEncoder, ensureDir, join } from './rec.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , scriptPath, ...flags] = process.argv;
const record = flags.includes('--record');
const onlyIdx = flags.indexOf('--only');
const only = onlyIdx >= 0 ? flags[onlyIdx + 1].split(',') : null;
const here = dirname(fileURLToPath(import.meta.url));
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => existsSync(p));
const out = ensureDir(process.env.DEMO_OUT || join(here, 'out'));
const shots = ensureDir(join(here, 'shots'));

const script = await import(pathToFileURL(scriptPath).href);
const profile = join(here, 'profiles', `${script.name}-${Date.now()}`);
const r = await launchApp({ edge, profile, appUrl: 'http://localhost:5173/', apiUrl: 'http://localhost:5290' });
const enc = record ? await makeEncoder({ edge, profile: join(here, 'profiles', `enc-${Date.now()}`) }) : null;

let shotNo = 0;
const ctx = {
  r,
  shot: async label => { const f = join(shots, `${script.name}-${String(++shotNo).padStart(2, '0')}-${label}.png`); await r.shot(f); console.log('shot', f); },
  /** One video: title card, the steps, a short hold at the end. Without --record, the steps just run. */
  async video(name, { eyebrow, title, subtitle, posterAt = 6 }, body) {
    const wanted = !only || only.includes(name);
    if (!record || !wanted) { if (!record || script.runSkipped !== false) await body(); return; }
    await r.ensureOverlay();
    await r.titleNow(eyebrow, title, subtitle);
    await r.startRecording();
    await r.sleep(2600);
    await r.title(null);
    await r.sleep(700);
    await body();
    await r.caption(null);
    await r.sleep(800);
    const frames = await r.stopRecording();
    const file = join(out, `${name}.mp4`);
    const info = await enc.encode(frames, file, { posterAt });
    console.log('video', name, JSON.stringify(info));
  }
};

try {
  await script.default(ctx);
} catch (err) {
  console.error('FAILED:', err.message);
  await ctx.shot('failed').catch(() => {});
  process.exitCode = 1;
} finally {
  r.close();
  enc?.close();
}

import React, { useEffect, useState } from 'react';
import {
  Save, RefreshCw, Building2, Landmark, Percent, CalendarClock, MessageCircle, ShieldCheck, Send, AlertTriangle,
  Video, Play, ArrowUp, ArrowDown, Trash2, Plus, Check, RotateCcw, Sparkles
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { usePosStore } from '../../store/posStore';
import type { AiPhotoSettings, DemoVideoStep, PlatformMessageRow, PlatformSettingsData, TaxJurisdiction } from '../../types';
import { VIDEO_LINK_HELP, videoSource } from '../../utils/videoEmbed';
import { DemoVideoPlayer } from '../../components/DemoVideoPlayer';
import { demoStepsFor } from '../../utils/demoVideos';
import { BUSINESS_KINDS, type KindId } from '../register/registerCatalog';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:bg-slate-50';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1';

const Card: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
    <div>
      <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
    {children}
  </section>
);

type Form = PlatformSettingsData & { whatsAppApiKey?: string; whatsAppApiSecret?: string; whatsAppAccessToken?: string };

/**
 * Cashly's default province tax rates. Every business that has not set its own rates for a province
 * (Tax Setup) is taxed at these — so changing one changes it for all of them. Only the platform
 * changes them; each row saves on its own.
 */
const PlatformTaxDefaults: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [rows, setRows] = useState<TaxJurisdiction[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { cash: string; card: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTaxJurisdictions()
      .then(list => {
        if (cancelled) return;
        setRows(list);
        setDrafts(Object.fromEntries(list.map(j => [j.id, { cash: String(j.cashTaxRate), card: String(j.digitalTaxRate) }])));
      })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  const save = async (j: TaxJurisdiction) => {
    const d = drafts[j.id];
    const cash = parseFloat(d.cash);
    const card = parseFloat(d.card);
    if (![cash, card].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
      setNote({ ok: false, text: `${j.authorityName}: rates must be between 0 and 100%.` });
      return;
    }
    if (!window.confirm(`Change ${j.authorityName}'s default to ${cash}% cash / ${card}% card for every business that uses Cashly's rate?`)) return;
    setBusyId(j.id);
    setNote(null);
    try {
      const saved = await posApi.updateTaxJurisdiction(j.id, { cashTaxRate: cash, digitalTaxRate: card });
      setRows(prev => prev?.map(r => (r.id === j.id ? { ...r, ...saved } : r)) ?? prev);
      setNote({ ok: true, text: `${j.authorityName}: default rates saved.` });
    } catch (err) {
      setNote({ ok: false, text: getApiErrorMessage(err, 'Could not save the rates.') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card icon={<Landmark className="w-4 h-4 text-teal-600" />} title="Default province tax rates"
      hint="Used by every business that has not set its own rates for a province in Tax Setup. A change here reaches all of them.">
      {!rows ? <p className="text-[11px] text-slate-400">Loading…</p> : rows.length === 0 ? <p className="text-[11px] text-slate-400">No provinces set up.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2">Province</th>
                <th className="py-2 pr-2 text-right">Cash %</th>
                <th className="py-2 pr-2 text-right">Card %</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(j => {
                const d = drafts[j.id] ?? { cash: String(j.cashTaxRate), card: String(j.digitalTaxRate) };
                const changed = parseFloat(d.cash) !== j.cashTaxRate || parseFloat(d.card) !== j.digitalTaxRate;
                return (
                  <tr key={j.id}>
                    <td className="py-2 pr-2">
                      <div className="font-semibold text-slate-900">{j.authorityName}</div>
                      <div className="text-[10px] font-mono text-slate-400">{j.countryCode} · {j.regionCode}</div>
                    </td>
                    {(['cash', 'card'] as const).map(k => (
                      <td key={k} className="py-2 pr-2 text-right">
                        <input type="number" min="0" max="100" step="0.5" value={d[k]} disabled={!canEdit}
                          aria-label={`${j.authorityName} ${k} rate`}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [j.id]: { ...d, [k]: e.target.value } }))}
                          className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-right text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 disabled:bg-slate-50" />
                      </td>
                    ))}
                    <td className="py-2 text-right">
                      {canEdit && (
                        <button onClick={() => save(j)} disabled={!changed || busyId === j.id}
                          className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-[11px] font-bold">
                          {busyId === j.id ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className={`text-[11px] font-semibold ${note.ok ? 'text-teal-700' : 'text-rose-600'}`}>{note.text}</p>}
    </Card>
  );
};

const QUALITIES: { value: AiPhotoSettings['quality']; label: string }[] = [
  { value: 'low', label: 'Low — cheapest, quickest' },
  { value: 'medium', label: 'Medium — recommended' },
  { value: 'high', label: 'High — sharpest, about 4× the price of medium' }
];

const TEST_KINDS: { value: string; label: string; example: string }[] = [
  { value: 'restaurant', label: 'Restaurant', example: 'Chicken Karahi' },
  { value: 'retail', label: 'Retail store', example: 'Leather Wallet' },
  { value: 'grocery', label: 'Mart', example: 'Basmati Rice 5kg' },
  { value: 'pharmacy', label: 'Pharmacy', example: 'Paracetamol 500mg Tablets' }
];

/**
 * AI photos for every business's items: on or off, the OpenAI account they are made with, and how
 * the queue is doing. Businesses use it free; each photo is charged to this OpenAI account. Saves on
 * its own; the key is never shown again once saved (only its last four characters).
 */
const PlatformAiPhotos: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [data, setData] = useState<AiPhotoSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [quality, setQuality] = useState<AiPhotoSettings['quality']>('medium');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [testKind, setTestKind] = useState('restaurant');
  const [testName, setTestName] = useState('');
  const [testImage, setTestImage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const show = (d: AiPhotoSettings) => {
    setData(d);
    setEnabled(d.enabled);
    setModel(d.model);
    setQuality(d.quality);
    setApiKey('');
  };

  useEffect(() => {
    let cancelled = false;
    posApi.getAiPhotoSettings()
      .then(d => { if (!cancelled) show(d); })
      .catch(err => { if (!cancelled) setNote({ ok: false, text: getApiErrorMessage(err, 'Could not load the AI photo settings.') }); });
    return () => { cancelled = true; };
  }, []);

  const save = async (removeKey = false) => {
    if (removeKey && !window.confirm('Remove the OpenAI key? No more AI photos are made until a new one is saved.')) return;
    setSaving(true);
    setNote(null);
    try {
      show(await posApi.saveAiPhotoSettings({ enabled, model, quality, apiKey: removeKey ? '-' : apiKey.trim() || undefined }));
      setNote({ ok: true, text: removeKey ? 'Key removed.' : 'AI photo settings saved.' });
    } catch (err) {
      setNote({ ok: false, text: getApiErrorMessage(err, 'Could not save the AI photo settings.') });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestImage(null);
    setNote(null);
    try {
      const example = TEST_KINDS.find(k => k.value === testKind)?.example ?? 'Chicken Karahi';
      setTestImage(await posApi.testAiPhoto(testName.trim() || example, testKind));
    } catch (err) {
      setNote({ ok: false, text: getApiErrorMessage(err, 'No photo could be made.') });
    } finally {
      setTesting(false);
    }
  };

  const keyReady = !!data && (data.hasKey || data.serverKey);

  return (
    <Card icon={<Sparkles className="w-4 h-4 text-teal-600" />} title="AI photos for items"
      hint="Every item a business saves without a photo gets a realistic one, made by AI from its name. Free for businesses; each photo is charged to your OpenAI account (roughly Rs 3–12 at medium quality).">
      {!data ? (
        note ? <p className="text-[11px] font-semibold text-rose-600">{note.text}</p> : <p className="text-[11px] text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          {data.problem && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span><span className="font-bold">Photos have stopped:</span> {data.problem} They start again by themselves once this is fixed and saved.</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">Made so far <span className="font-bold text-slate-900">{data.made.toLocaleString()}</span></span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">Waiting <span className="font-bold text-slate-900">{data.waiting.toLocaleString()}</span></span>
            {data.failed > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">Could not be made <span className="font-bold">{data.failed.toLocaleString()}</span></span>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" disabled={!canEdit} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-teal-500" />
            <span><span className="font-bold">Make AI photos for every business</span>
              <span className="block text-[11px] text-slate-500">Off: no new photos are made. Photos already made stay.</span></span>
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>
                OpenAI key{' '}
                {data.hasKey && <span className="text-teal-600 normal-case">· saved (…{data.keyEnding})</span>}
                {data.serverKey && <span className="text-teal-600 normal-case">· set on the server (…{data.keyEnding})</span>}
              </label>
              <div className="flex gap-2">
                <input disabled={!canEdit} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={data.hasKey ? 'Leave blank to keep the saved key' : 'sk-…'} className={inputCls} />
                {canEdit && data.hasKey && (
                  <button onClick={() => save(true)} disabled={saving} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 text-xs font-semibold whitespace-nowrap disabled:opacity-40">
                    Remove key
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Model</label>
              <select disabled={!canEdit} value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                {data.models.map(m => <option key={m} value={m}>{m}{m === data.models[0] ? ' (newest)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Quality</label>
              <select disabled={!canEdit} value={quality} onChange={(e) => setQuality(e.target.value as AiPhotoSettings['quality'])} className={inputCls}>
                {QUALITIES.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
              </select>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button onClick={() => save()} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save AI photo settings'}
              </button>
            </div>
          )}

          {canEdit && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-[11px] font-bold text-slate-700">Make a test photo (save the key first)</div>
              <div className="flex flex-wrap gap-2">
                <select value={testKind} onChange={(e) => setTestKind(e.target.value)} className={`${inputCls} max-w-[10rem]`}>
                  {TEST_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <input value={testName} onChange={(e) => setTestName(e.target.value)}
                  placeholder={TEST_KINDS.find(k => k.value === testKind)?.example} className={`${inputCls} max-w-[16rem]`} />
                <button onClick={test} disabled={testing || !keyReady}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {testing ? 'Making… (up to a minute)' : 'Make a test photo'}
                </button>
              </div>
              {testImage && <img src={testImage} alt="Test photo" className="w-48 h-48 rounded-xl object-cover border border-slate-200" />}
            </div>
          )}

          {note && <p className={`text-[11px] font-semibold ${note.ok ? 'text-teal-700' : 'text-rose-600'}`}>{note.text}</p>}

          <details className="group rounded-xl border border-slate-200 bg-white">
            <summary className="px-3 py-2 text-[11px] font-bold text-slate-700 cursor-pointer select-none">How to get an OpenAI key</summary>
            <ol className="px-3 pb-3 pl-7 list-decimal space-y-1.5 text-[11px] text-slate-600">
              <li>Go to <span className="font-mono">platform.openai.com</span> and sign up, or sign in.</li>
              <li><span className="font-semibold">Settings → Billing:</span> add a payment card and some credit. $10 makes a few hundred photos at medium quality.</li>
              <li>If OpenAI asks you to <span className="font-semibold">verify your organization</span> (Settings → Organization → General), do it: some accounts need this before image models work.</li>
              <li><span className="font-semibold">API keys → Create new secret key.</span> Copy it (it starts with <span className="font-mono">sk-</span>); OpenAI shows it only once.</li>
              <li>Paste it in <span className="font-semibold">OpenAI key</span> above, press <span className="font-semibold">Save AI photo settings</span>, then <span className="font-semibold">Make a test photo</span>.</li>
            </ol>
            <p className="px-3 pb-3 text-[11px] text-slate-500">
              The key stays on this server, encrypted. It is never sent to a business's computer or a browser. Set a monthly spending limit under Billing → Limits so the cost cannot surprise you.
            </p>
          </details>
        </div>
      )}
    </Card>
  );
};

const editable = (list: DemoVideoStep[]): DemoVideoStep[] =>
  list.map(s => ({ title: s.title ?? '', description: s.description ?? '', videoUrl: s.videoUrl ?? '' }));

/**
 * The steps under "Watch demo" on the sign-in page, one list per kind of business, each step with
 * its own video. Every kind starts with the videos the app ships with (recorded from Cashly); the
 * platform can change a kind's steps or put in its own videos (YouTube Unlisted is fine), and put
 * it back to the app's own. Saves one kind at a time, on its own.
 */
const PlatformDemoVideos: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [changed, setChanged] = useState<Record<string, DemoVideoStep[]> | null>(null);
  const [kind, setKind] = useState<KindId>('restaurant');
  // Unsaved edits, per kind (kept when switching tabs).
  const [drafts, setDrafts] = useState<Partial<Record<KindId, DemoVideoStep[]>>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getPublicDemoVideos()
      .then(saved => { if (!cancelled) setChanged(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}); })
      .catch(() => { if (!cancelled) setChanged({}); });
    return () => { cancelled = true; };
  }, []);

  if (!changed) {
    return (
      <Card icon={<Video className="w-4 h-4 text-teal-600" />} title="Demo videos">
        <p className="text-[11px] text-slate-400">Loading…</p>
      </Card>
    );
  }

  const isChanged = !!changed[kind];
  const steps = drafts[kind] ?? editable(demoStepsFor(kind, changed));
  const setSteps = (update: (list: DemoVideoStep[]) => DemoVideoStep[]) => {
    setDrafts(prev => ({ ...prev, [kind]: update(prev[kind] ?? editable(demoStepsFor(kind, changed))) }));
    setNote(null);
  };
  const change = (i: number, patch: Partial<DemoVideoStep>) => setSteps(list => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    setSteps(list => {
      const next = [...list];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
    setPreview(null);
  };
  const remove = (i: number) => {
    if (!window.confirm(`Remove step ${i + 1}${steps[i].title ? ` (${steps[i].title})` : ''}?`)) return;
    setSteps(list => list.filter((_, j) => j !== i));
    setPreview(null);
  };
  const switchKind = (next: KindId) => { setKind(next); setPreview(null); setNote(null); };

  const badLink = steps.findIndex(s => !!s.videoUrl?.trim() && !videoSource(s.videoUrl));
  const noTitle = steps.findIndex(s => !s.title.trim() && !!(s.description?.trim() || s.videoUrl?.trim()));
  const withVideo = steps.filter(s => videoSource(s.videoUrl)).length;
  const kindName = BUSINESS_KINDS.find(k => k.id === kind)?.label ?? kind;

  const send = async (list: DemoVideoStep[] | null) => {
    setSaving(true);
    setNote(null);
    try {
      setChanged(await posApi.saveDemoVideos(kind, list));
      setDrafts(prev => ({ ...prev, [kind]: undefined }));
      setPreview(null);
      setNote({ ok: true, text: list ? `${kindName}: saved, on the sign-in page now.` : `${kindName}: back to Cashly's own videos.` });
    } catch (err) {
      setNote({ ok: false, text: getApiErrorMessage(err, 'Could not save the demo videos.') });
    } finally {
      setSaving(false);
    }
  };
  const save = () => send(steps);
  const useBuiltIn = () => {
    if (window.confirm(`Put ${kindName} back to the videos Cashly comes with? Your changes to its steps are removed.`)) void send(null);
  };

  return (
    <Card icon={<Video className="w-4 h-4 text-teal-600" />} title="Demo videos"
      hint="Watch demo on the sign-in page: the visitor picks their kind of business, then clicks a step to watch it. Each kind starts with Cashly's own videos; change any of them here.">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Kind of business">
        {BUSINESS_KINDS.map(k => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} onClick={() => switchKind(k.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${kind === k.id ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {k.label}{drafts[k.id] ? ' •' : ''}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        {isChanged ? 'Changed by you.' : "Cashly's own videos."} {withVideo} of {steps.length} steps have a video
        {steps.length - withVideo > 0 ? '; the others show as "Coming soon".' : '.'}
      </p>

      <details className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
        <summary className="font-bold text-slate-700 cursor-pointer">Using your own video</summary>
        <div className="mt-1.5 space-y-1">
          <p>1. Record your screen while you do the step in Cashly: on Windows press <span className="font-semibold">Win + Alt + R</span> (Xbox Game Bar), or use OBS Studio (free).</p>
          <p>2. Upload it to YouTube as <span className="font-semibold">Unlisted</span> (only people with the link can see it) and copy its link.</p>
          <p>3. Paste the link in the step below, press Play to check it, then Save.</p>
        </div>
      </details>

      <div className="space-y-2.5">
        {steps.map((s, i) => {
          const source = videoSource(s.videoUrl);
          const typed = !!s.videoUrl?.trim();
          return (
            <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 shrink-0 rounded-full bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                <input disabled={!canEdit} value={s.title} maxLength={80} placeholder="Step title, e.g. Add your products"
                  aria-label={`Step ${i + 1} title`} onChange={(e) => change(i, { title: e.target.value })} className={`${inputCls} font-semibold`} />
                {canEdit && (
                  <div className="flex items-center shrink-0">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up"
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down" aria-label="Move down"
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => remove(i)} title="Remove this step" aria-label="Remove this step"
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
              <textarea disabled={!canEdit} rows={2} maxLength={240} value={s.description ?? ''} placeholder="One line about what the video shows"
                aria-label={`Step ${i + 1} description`} onChange={(e) => change(i, { description: e.target.value })} className={`${inputCls} resize-none`} />
              <div className="flex gap-2">
                <input disabled={!canEdit} value={s.videoUrl ?? ''} maxLength={500} placeholder="Video link, e.g. https://youtu.be/…"
                  aria-label={`Step ${i + 1} video link`} onChange={(e) => change(i, { videoUrl: e.target.value })} className={inputCls} />
                <button type="button" onClick={() => setPreview(preview === i ? null : i)} disabled={!source}
                  className="shrink-0 flex items-center gap-1.5 px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  <Play className="w-3.5 h-3.5" /> {preview === i ? 'Hide' : 'Play'}
                </button>
              </div>
              <p className={`text-[10px] font-semibold ${source ? 'text-teal-700' : typed ? 'text-rose-600' : 'text-slate-400'}`}>
                {source ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" /> Plays from {source.provider}</span>
                  : typed ? `This link cannot be played here. ${VIDEO_LINK_HELP}`
                  : 'No video yet: shows as "Coming soon".'}
              </p>
              {preview === i && source && <DemoVideoPlayer source={source} title={s.title || `Step ${i + 1}`} />}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setSteps(list => [...list, { title: '', description: '', videoUrl: '' }])} disabled={steps.length >= 12}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Add a step
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {isChanged && (
              <button type="button" onClick={useBuiltIn} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <RotateCcw className="w-3.5 h-3.5" /> Use Cashly's own videos
              </button>
            )}
            <button type="button" onClick={save} disabled={saving || badLink >= 0 || noTitle >= 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : `Save ${kindName}`}
            </button>
          </div>
        </div>
      )}
      {badLink >= 0 && <p className="text-[11px] font-semibold text-rose-600">Step {badLink + 1}: fix or clear the video link before saving.</p>}
      {noTitle >= 0 && <p className="text-[11px] font-semibold text-rose-600">Step {noTitle + 1} needs a title.</p>}
      {note && <p className={`text-[11px] font-semibold ${note.ok ? 'text-teal-700' : 'text-rose-600'}`}>{note.text}</p>}
    </Card>
  );
};

/**
 * Cashly's own details and the rules billing runs by: what an invoice says about you and how
 * customers pay, tax on the subscription, when invoices and reminders go out, whether unpaid parts
 * stop on their own, the WhatsApp line reminders are sent from, and the team's 2-step rule.
 */
export const PlatformSettingsPage: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);
  const canEdit = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
  const [form, setForm] = useState<Form | null>(null);
  const [emailReady, setEmailReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResults, setTestResults] = useState<PlatformMessageRow[] | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformSettings()
      .then(res => { if (!cancelled) { setForm(res.settings); setEmailReady(res.emailReady); } })
      .catch(err => { if (!cancelled) setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not load the settings.') }); });
    return () => { cancelled = true; };
  }, []);

  if (!form) {
    return message
      ? <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{message.text}</div>
      : <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 text-slate-400 animate-spin" /></div>;
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => (f ? { ...f, [key]: value } : f));
  const text = (key: keyof Form, label: string, placeholder?: string, wide?: boolean) => (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className={labelCls}>{label}</label>
      <input disabled={!canEdit} value={(form[key] as string | null | undefined) ?? ''} placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as Form[typeof key])} className={inputCls} />
    </div>
  );
  const toggle = (key: keyof Form, label: string, hint?: string) => (
    <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" disabled={!canEdit} checked={!!form[key]} onChange={(e) => set(key, e.target.checked as Form[typeof key])} className="w-4 h-4 mt-0.5 accent-teal-500" />
      <span><span className="font-bold">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
    </label>
  );

  const paymentFilled = !!(form.bankIban || form.bankAccountNumber || form.jazzCashNumber || form.easypaisaNumber || form.raastId);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await posApi.savePlatformSettings(form);
      setForm({ ...res.settings, whatsAppApiKey: '', whatsAppApiSecret: '', whatsAppAccessToken: '' });
      setMessage({ ok: true, text: 'Settings saved.' });
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not save the settings.') });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      setTestResults(await posApi.sendPlatformTestMessage(testPhone.trim() || undefined, testEmail.trim() || undefined));
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not send the test.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {!canEdit && (
        <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold">View only — settings are changed by a platform owner.</div>
      )}
      {!paymentFilled && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Add at least one way to pay (bank account or wallet) below — your invoices and reminders show it to customers.</span>
        </div>
      )}

      <Card icon={<Building2 className="w-4 h-4 text-teal-600" />} title="Your company" hint="Printed at the top of every invoice.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('companyName', 'Name customers see', 'Cashly')}
          {text('legalName', 'Registered name', 'Cashly Technologies (Pvt) Ltd')}
          {text('ntn', 'NTN')}
          {text('strn', 'STRN (if registered for sales tax)')}
          {text('address', 'Address', undefined, true)}
          {text('city', 'City')}
          {text('phone', 'Phone')}
          {text('email', 'Billing email')}
          {text('website', 'Website')}
        </div>
      </Card>

      <Card icon={<Landmark className="w-4 h-4 text-teal-600" />} title="How customers pay you" hint="Shown on invoices, in reminders and on each business's Plan page.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('bankName', 'Bank', 'e.g. Meezan Bank')}
          {text('bankAccountTitle', 'Account title')}
          {text('bankAccountNumber', 'Account number')}
          {text('bankIban', 'IBAN', 'PK..')}
          {text('jazzCashNumber', 'JazzCash number')}
          {text('easypaisaNumber', 'Easypaisa number')}
          {text('raastId', 'Raast ID')}
          <div className="sm:col-span-2">
            <label className={labelCls}>Anything else about paying</label>
            <textarea disabled={!canEdit} rows={2} value={form.paymentInstructions ?? ''} onChange={(e) => set('paymentInstructions', e.target.value)}
              placeholder="e.g. Send the payment screenshot on WhatsApp 0300 1234567" className={`${inputCls} resize-none`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Invoice footer</label>
            <input disabled={!canEdit} value={form.invoiceFooter ?? ''} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder="e.g. Thank you for choosing Cashly." className={inputCls} />
          </div>
        </div>
      </Card>

      <Card icon={<Percent className="w-4 h-4 text-teal-600" />} title="Tax on the subscription" hint="Leave at 0 if you do not charge tax on Cashly's own invoices. Applies to invoices raised from now on.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('taxLabel', 'Tax name on the invoice', 'Sales tax')}
          <div>
            <label className={labelCls}>Rate (%)</label>
            <input disabled={!canEdit} type="number" min={0} max={50} step="0.5" value={form.taxRatePercent} onChange={(e) => set('taxRatePercent', Number(e.target.value) || 0)} className={inputCls} />
          </div>
        </div>
      </Card>

      <Card icon={<CalendarClock className="w-4 h-4 text-teal-600" />} title="Renewals" hint="Runs by itself every hour (or press Run renewals now on Billing).">
        <div className="space-y-3">
          {toggle('autoInvoice', 'Raise each renewal\'s invoice by itself', 'One invoice per renewal date — the ERP, each outlet\'s POS and each tablet on their own dates.')}
          <div className="grid sm:grid-cols-2 gap-3 pl-6">
            <div>
              <label className={labelCls}>Days before the renewal</label>
              <input disabled={!canEdit} type="number" min={0} max={60} value={form.invoiceDaysBefore} onChange={(e) => set('invoiceDaysBefore', Number(e.target.value) || 0)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Days to pay (when the renewal date has passed)</label>
              <input disabled={!canEdit} type="number" min={1} max={60} value={form.invoiceDueDays} onChange={(e) => set('invoiceDueDays', Number(e.target.value) || 1)} className={inputCls} />
            </div>
          </div>
          {toggle('autoReminders', 'Send reminders, invoices and receipts to customers', 'On WhatsApp (the line below) and email. Fill in your company and payment details first.')}
          <div className="pl-6">
            <label className={labelCls}>When reminders go out (days; minus = after the date)</label>
            <input disabled={!canEdit} value={form.reminderDays} onChange={(e) => set('reminderDays', e.target.value)} placeholder="7,1,-1,-3" className={`${inputCls} max-w-xs`} />
            <p className="text-[10px] text-slate-500 mt-1">7,1,-1,-3 means 7 days and 1 day before, then 1 and 3 days after.</p>
          </div>
          {toggle('emailReminders', 'Also send them by email', emailReady ? 'Email is set up on the server.' : 'Email is not set up on the server yet, so only WhatsApp is used.')}
          {toggle('autoStopUnpaid', 'Stop what stays unpaid', 'Only the unpaid part stops — that outlet\'s tills, that tablet, the head office\'s changes, or that add-on. Everything else keeps working. A promise to pay (customer notes) holds it.')}
          <div className="pl-6">
            <label className={labelCls}>Days after the renewal date</label>
            <input disabled={!canEdit} type="number" min={0} max={90} value={form.stopAfterDays} onChange={(e) => set('stopAfterDays', Number(e.target.value) || 0)} className={`${inputCls} max-w-xs`} />
          </div>
        </div>
      </Card>

      <Card icon={<MessageCircle className="w-4 h-4 text-teal-600" />} title="Your WhatsApp line" hint="The number reminders are sent from — your own business WhatsApp API account, not a customer's.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Provider</label>
            <select disabled={!canEdit} value={form.whatsAppProvider} onChange={(e) => set('whatsAppProvider', e.target.value)} className={inputCls}>
              <option value="Manual">Not connected (send by hand)</option>
              <option value="MetaAPI">Meta WhatsApp Cloud API</option>
              <option value="Twilio">Twilio</option>
              <option value="Whaticket">Whaticket</option>
            </select>
          </div>
          {text('whatsAppPhoneNumberId', form.whatsAppProvider === 'Twilio' ? 'From number' : 'Phone number ID')}
          {form.whatsAppProvider !== 'Manual' && (
            <>
              <div>
                <label className={labelCls}>{form.whatsAppProvider === 'Twilio' ? 'Account SID' : 'API key'} {form.hasWhatsAppApiKey && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppApiKey ?? ''} onChange={(e) => set('whatsAppApiKey', e.target.value)} placeholder={form.hasWhatsAppApiKey ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{form.whatsAppProvider === 'Twilio' ? 'Auth token' : 'API secret'} {form.hasWhatsAppApiSecret && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppApiSecret ?? ''} onChange={(e) => set('whatsAppApiSecret', e.target.value)} placeholder={form.hasWhatsAppApiSecret ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Access token {form.hasWhatsAppAccessToken && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppAccessToken ?? ''} onChange={(e) => set('whatsAppAccessToken', e.target.value)} placeholder={form.hasWhatsAppAccessToken ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
            </>
          )}
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="text-[11px] font-bold text-slate-700">Send a test (save first)</div>
          <div className="flex flex-wrap gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Mobile, e.g. 0300 1234567" className={`${inputCls} max-w-[14rem]`} />
            <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Email" className={`${inputCls} max-w-[14rem]`} />
            <button onClick={sendTest} disabled={testing || (!testPhone.trim() && !testEmail.trim())}
              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {testResults?.map(r => (
            <div key={r.id} className={`text-[11px] font-semibold ${r.status === 'sent' ? 'text-teal-700' : 'text-rose-600'}`}>
              {r.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}: {r.status}{r.error ? ` — ${r.error}` : ''}
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<ShieldCheck className="w-4 h-4 text-teal-600" />} title="Platform team">
        {toggle('requireTwoStepForTeam', 'Everyone on the team must use 2-step sign-in', 'Until they turn it on, they can only do that. Strongly recommended: this console can change every customer.')}
      </Card>

      <PlatformTaxDefaults canEdit={canEdit} />

      <PlatformAiPhotos canEdit={canEdit} />

      <PlatformDemoVideos canEdit={canEdit} />

      {message && (
        <div className={`px-3 py-2 rounded-xl text-xs font-semibold border ${message.ok ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{message.text}</div>
      )}
      {canEdit && (
        <div className="sticky bottom-4 flex justify-end">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
};

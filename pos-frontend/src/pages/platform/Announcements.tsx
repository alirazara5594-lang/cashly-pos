import React, { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2, Edit, X, Save, RefreshCw } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { usePosStore } from '../../store/posStore';
import { dateOf } from '../../utils/renewals';
import type { AdminTenantRow, Announcement } from '../../types';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const TONE: Record<Announcement['tone'], string> = {
  info: 'bg-sky-50 border-sky-200 text-sky-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  success: 'bg-teal-50 border-teal-200 text-teal-900'
};

interface Draft {
  id?: string;
  title: string;
  body: string;
  tone: Announcement['tone'];
  startsAt: string;
  endsAt: string;
  audience: Announcement['audience'];
  audienceValue: string;
  isActive: boolean;
}

const blank = (): Draft => ({
  title: '', body: '', tone: 'info', startsAt: new Date().toLocaleDateString('en-CA'), endsAt: '',
  audience: 'all', audienceValue: '', isActive: true
});

const audienceText = (a: Announcement, tenants: AdminTenantRow[]) =>
  a.audience === 'all' ? 'Every business'
    : a.audience === 'plan' ? `On ${a.audienceValue === 'Professional' ? 'Enterprise' : a.audienceValue}`
    : a.audience === 'shape' ? (a.audienceValue === 'HeadOffice' ? 'Businesses with a head office' : 'Single shops')
    : `${(a.audienceValue ?? '').split(',').filter(Boolean).map(id => tenants.find(t => t.id === id)?.name ?? 'a business').join(', ')}`;

/**
 * Messages shown inside customers' apps as a banner — maintenance tonight, a new feature, a price
 * change — to everyone, one version, one kind of business, or chosen businesses, between two dates.
 */
export const Announcements: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);
  const canEdit = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
  const [items, setItems] = useState<Announcement[]>([]);
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Showing now" is judged against when the page was opened, not re-read on every render.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    Promise.all([posApi.getAnnouncements(), posApi.getAdminTenants()])
      .then(([a, t]) => { if (!cancelled) { setItems(a); setTenants(t); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load announcements.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = () => { setLoading(true); setTick(t => t + 1); };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await posApi.saveAnnouncement({
        title: draft.title.trim(), body: draft.body.trim(), tone: draft.tone,
        startsAt: draft.startsAt ? `${draft.startsAt}T00:00:00` : undefined,
        endsAt: draft.endsAt ? `${draft.endsAt}T23:59:59` : undefined,
        audience: draft.audience, audienceValue: draft.audience === 'all' ? undefined : draft.audienceValue, isActive: draft.isActive
      }, draft.id);
      setDraft(null);
      reload();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Announcement) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    try { await posApi.deleteAnnouncement(a.id); reload(); }
    catch (err) { setError(getApiErrorMessage(err, 'Could not delete.')); }
  };

  const live =(a: Announcement) => a.isActive && new Date(a.startsAt).getTime() <= now && (!a.endsAt || new Date(a.endsAt).getTime() > now);
  const pickedIds = draft?.audience === 'businesses' ? draft.audienceValue.split(',').filter(Boolean) : [];

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        {canEdit && (
          <button onClick={() => setDraft(blank())} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> New announcement
          </button>
        )}
        <button onClick={reload} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      {draft && (
        <div className="p-5 rounded-2xl border border-teal-200 bg-white space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900">{draft.id ? 'Edit announcement' : 'New announcement'}</h3>
            <button onClick={() => setDraft(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div><label className={labelCls}>Title</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Maintenance tonight 2–3 AM" className={inputCls} /></div>
          <div><label className={labelCls}>Message</label><textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={`${inputCls} resize-none`} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Look</label>
              <select value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value as Announcement['tone'] })} className={inputCls}>
                <option value="info">Information (blue)</option>
                <option value="warning">Warning (amber)</option>
                <option value="success">Good news (green)</option>
              </select>
            </div>
            <div><label className={labelCls}>Show from</label><input type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>Until (optional)</label><input type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} className={inputCls} /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Who sees it</label>
              <select value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value as Announcement['audience'], audienceValue: '' })} className={inputCls}>
                <option value="all">Every business</option>
                <option value="plan">One version</option>
                <option value="shape">Single shops, or businesses with a head office</option>
                <option value="businesses">Chosen businesses</option>
              </select>
            </div>
            {draft.audience === 'plan' && (
              <div>
                <label className={labelCls}>Version</label>
                <select value={draft.audienceValue} onChange={(e) => setDraft({ ...draft, audienceValue: e.target.value })} className={inputCls}>
                  <option value="">Pick…</option><option value="Starter">Starter</option><option value="Standard">Standard</option><option value="Professional">Enterprise</option>
                </select>
              </div>
            )}
            {draft.audience === 'shape' && (
              <div>
                <label className={labelCls}>Kind of business</label>
                <select value={draft.audienceValue} onChange={(e) => setDraft({ ...draft, audienceValue: e.target.value })} className={inputCls}>
                  <option value="">Pick…</option><option value="Standalone">Single shops</option><option value="HeadOffice">With a head office</option>
                </select>
              </div>
            )}
          </div>
          {draft.audience === 'businesses' && (
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 grid sm:grid-cols-2 gap-1">
              {tenants.map(t => (
                <label key={t.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={pickedIds.includes(t.id)} className="accent-teal-500"
                    onChange={(e) => setDraft({ ...draft, audienceValue: (e.target.checked ? [...pickedIds, t.id] : pickedIds.filter(id => id !== t.id)).join(',') })} />
                  {t.name}
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="w-4 h-4 accent-teal-500" /> Published
          </label>
          {draft.title && draft.body && (
            <div className={`px-4 py-2.5 rounded-xl border text-xs ${TONE[draft.tone]}`}><strong>{draft.title}</strong> — {draft.body}</div>
          )}
          <button onClick={save} disabled={busy || !draft.title.trim() || !draft.body.trim() || (draft.audience !== 'all' && !draft.audienceValue)}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
            <Megaphone className="w-6 h-6 mx-auto mb-2 text-slate-300" /> No announcements yet.
          </div>
        )}
        {items.map(a => (
          <div key={a.id} className={`p-4 rounded-2xl border ${TONE[a.tone]} ${live(a) ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black">{a.title}</div>
                <div className="text-xs mt-0.5 whitespace-pre-line">{a.body}</div>
                <div className="text-[10px] mt-1.5 opacity-80">
                  {live(a) ? 'Showing now' : a.isActive ? (new Date(a.startsAt).getTime() > now ? 'Scheduled' : 'Ended') : 'Not published'}
                  {' · '}{audienceText(a, tenants)} · {dateOf(a.startsAt)}{a.endsAt ? ` – ${dateOf(a.endsAt)}` : ''} · by {a.createdByName ?? '—'}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setDraft({
                    id: a.id, title: a.title, body: a.body, tone: a.tone, startsAt: a.startsAt.slice(0, 10), endsAt: a.endsAt?.slice(0, 10) ?? '',
                    audience: a.audience, audienceValue: a.audienceValue ?? '', isActive: a.isActive
                  })} className="p-1.5 rounded-lg hover:bg-white/60" title="Edit"><Edit className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(a)} className="p-1.5 rounded-lg hover:bg-white/60 text-rose-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

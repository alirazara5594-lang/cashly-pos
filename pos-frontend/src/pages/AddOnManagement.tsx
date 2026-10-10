import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Edit, Save, X, Plus, Search, Puzzle, Users } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { pkr } from '../utils/renewals';
import type { AddOnCatalogItem, AddOnHolder, AddOnKeyOption } from '../types';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';

/**
 * The add-on catalogue — what can be sold, at what price — and who has each one now. Granting an
 * add-on to a business happens in that business's panel (Plan & features), so there is one place
 * with one set of rules for it.
 */
export const AddOnManagement: React.FC<{ onOpenTenant?: (tenantId: string) => void }> = ({ onOpenTenant }) => {
  const [tab, setTab] = useState<'catalogue' | 'holders'>('catalogue');
  const [catalog, setCatalog] = useState<AddOnCatalogItem[]>([]);
  const [holders, setHolders] = useState<AddOnHolder[]>([]);
  const [keys, setKeys] = useState<AddOnKeyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);

  const [editing, setEditing] = useState<AddOnCatalogItem | null>(null);
  const [editForm, setEditForm] = useState({ displayName: '', description: '', monthlyPricePKR: '', yearlyPricePKR: '', isActive: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', displayName: '', description: '', monthlyPricePKR: '', yearlyPricePKR: '' });
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([posApi.getAdminAddOnCatalog(), posApi.getAddOnHolders(), posApi.getAddOnKeys()])
      .then(([cat, held, k]) => {
        if (cancelled) return;
        setCatalog(cat);
        setHolders(held);
        setKeys(k);
      })
      .catch(err => { if (!cancelled) setMessage({ ok: false, text: getApiErrorMessage(err, 'Failed to load add-ons') }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = () => { setLoading(true); setTick(t => t + 1); };

  const openEdit = (item: AddOnCatalogItem) => {
    setEditing(item);
    setEditForm({
      displayName: item.displayName, description: item.description ?? '',
      monthlyPricePKR: String(item.monthlyPricePKR), yearlyPricePKR: String(item.yearlyPricePKR), isActive: item.isActive
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await posApi.updateAddOnCatalogItem(editing.id, {
        displayName: editForm.displayName.trim() || undefined,
        description: editForm.description,
        monthlyPricePKR: Number(editForm.monthlyPricePKR) || 0,
        yearlyPricePKR: Number(editForm.yearlyPricePKR) || 0,
        isActive: editForm.isActive
      });
      setEditing(null);
      setMessage({ ok: true, text: `${editForm.displayName} saved. New prices apply to new purchases; businesses that already have it keep their agreed price.` });
      reload();
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Failed to save') });
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!createForm.key || !createForm.displayName.trim()) {
      setCreateError('Pick what it switches on, and give it a name.');
      return;
    }
    setSaving(true);
    setCreateError('');
    try {
      await posApi.createAddOnCatalogItem({
        key: createForm.key,
        displayName: createForm.displayName.trim(),
        description: createForm.description.trim() || undefined,
        monthlyPricePKR: Number(createForm.monthlyPricePKR) || 0,
        yearlyPricePKR: Number(createForm.yearlyPricePKR) || 0
      });
      setCreateOpen(false);
      setCreateForm({ key: '', displayName: '', description: '', monthlyPricePKR: '', yearlyPricePKR: '' });
      setMessage({ ok: true, text: `${createForm.displayName} is now in the catalogue.` });
      reload();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Failed to create the add-on'));
    } finally {
      setSaving(false);
    }
  };

  const term = search.trim().toLowerCase();
  const shownHolders = useMemo(() => holders.filter(h =>
    !term || (h.tenantName ?? '').toLowerCase().includes(term) || h.addOnName.toLowerCase().includes(term) || (h.branchName ?? '').toLowerCase().includes(term)
  ), [holders, term]);
  const holdersByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holders) map.set(h.addOnKey, (map.get(h.addOnKey) ?? 0) + 1);
    return map;
  }, [holders]);
  const freeKeys = keys.filter(k => !k.inCatalogue);
  const chosenKey = keys.find(k => k.key === createForm.key);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          <button onClick={() => setTab('catalogue')} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${tab === 'catalogue' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
            <Puzzle className="w-3.5 h-3.5" /> Catalogue
          </button>
          <button onClick={() => setTab('holders')} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${tab === 'holders' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
            <Users className="w-3.5 h-3.5" /> Who has it <span className="opacity-70">{holders.length}</span>
          </button>
        </div>
        {tab === 'holders' && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Business, add-on, outlet…"
              className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-56 focus:outline-none focus:border-teal-500" />
          </div>
        )}
        <button onClick={reload} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {tab === 'catalogue' && (
          <button onClick={() => { setCreateOpen(true); setCreateError(''); }} disabled={freeKeys.length === 0}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold"
            title={freeKeys.length === 0 ? 'Everything that can be sold is already in the catalogue' : undefined}>
            <Plus className="w-3.5 h-3.5" /> New add-on
          </button>
        )}
      </div>

      {message && (
        <div className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${message.ok ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {message.text}
        </div>
      )}

      {tab === 'catalogue' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Add-on</th>
                  <th className="px-4 py-2.5">Switches on</th>
                  <th className="px-4 py-2.5 text-right">Monthly</th>
                  <th className="px-4 py-2.5 text-right">Yearly</th>
                  <th className="px-4 py-2.5 text-center">Businesses</th>
                  <th className="px-4 py-2.5">On sale</th>
                  <th className="px-4 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && catalog.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : catalog.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No add-ons in the catalogue yet.</td></tr>
                ) : catalog.map(item => (
                  <tr key={item.id} className={`hover:bg-slate-50 align-top ${item.isActive ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900">{item.displayName}</div>
                      {item.description && <div className="text-[11px] text-slate-500 max-w-sm">{item.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-600 max-w-[14rem]">
                      {item.unlocksModule}
                      <div className="text-[10px] text-slate-400 font-mono">{item.key}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{pkr(item.monthlyPricePKR)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{pkr(item.yearlyPricePKR)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => { setTab('holders'); setSearch(item.displayName); }} className="font-bold text-teal-700 hover:underline">
                        {holdersByKey.get(item.key) ?? 0}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${item.isActive ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {item.isActive ? 'On sale' : 'Not on sale'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600" title="Edit">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2.5 text-[11px] text-slate-500 border-t border-slate-100">
            To give a business an add-on, open the business (Businesses → Manage) and use <strong>Plan &amp; features</strong>.
          </p>
        </div>
      )}

      {tab === 'holders' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Business</th>
                  <th className="px-4 py-2.5">Add-on</th>
                  <th className="px-4 py-2.5">Where</th>
                  <th className="px-4 py-2.5 text-center">Qty</th>
                  <th className="px-4 py-2.5 text-right">Each / month</th>
                  <th className="px-4 py-2.5 text-right">Month total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownHolders.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">{holders.length === 0 ? 'No business has an add-on yet.' : 'Nothing matches.'}</td></tr>
                ) : shownHolders.map(h => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <button onClick={() => onOpenTenant?.(h.tenantId)} className="font-bold text-slate-800 hover:text-teal-700 text-left">{h.tenantName ?? '—'}</button>
                    </td>
                    <td className="px-4 py-2.5">
                      {h.addOnName}
                      {h.stopped && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white">Stopped — unpaid</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{h.branchName ?? 'Every outlet'}</td>
                    <td className="px-4 py-2.5 text-center font-bold">{h.quantity}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{pkr(h.unitPricePKR)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{pkr(h.monthlyPKR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Edit {editing.displayName}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div><label className={labelCls}>Name</label><input value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>What the customer gets</label>
              <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className={`${inputCls} resize-none`} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Monthly (PKR)</label><input type="number" min={0} value={editForm.monthlyPricePKR} onChange={(e) => setEditForm({ ...editForm, monthlyPricePKR: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Yearly (PKR)</label><input type="number" min={0} value={editForm.yearlyPricePKR} onChange={(e) => setEditForm({ ...editForm, yearlyPricePKR: e.target.value })} className={inputCls} /></div>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} className="w-4 h-4 accent-teal-500" />
              On sale (owners can buy it in the app)
            </label>
            <button onClick={saveEdit} disabled={saving}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">New add-on</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            {createError && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">{createError}</div>}
            <div>
              <label className={labelCls}>What it switches on</label>
              <select value={createForm.key} onChange={(e) => {
                const k = keys.find(x => x.key === e.target.value);
                setCreateForm({ ...createForm, key: e.target.value, displayName: createForm.displayName || (k?.unlocks.split(' (')[0] ?? '') });
              }} className={inputCls}>
                <option value="">Pick one…</option>
                {freeKeys.map(k => <option key={k.key} value={k.key}>{k.unlocks}</option>)}
              </select>
              {chosenKey && (
                <p className="mt-1 text-[10px] text-slate-500">
                  {chosenKey.sold === 'quantity' ? 'Sold by quantity (each one adds one more).' : chosenKey.sold === 'per shop' ? 'Sold per outlet, or for every outlet.' : 'A switch: on or off for the business.'}
                </p>
              )}
            </div>
            <div><label className={labelCls}>Name customers see</label><input value={createForm.displayName} onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })} className={inputCls} /></div>
            <div><label className={labelCls}>What the customer gets</label>
              <textarea rows={2} value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} className={`${inputCls} resize-none`} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Monthly (PKR)</label><input type="number" min={0} value={createForm.monthlyPricePKR} onChange={(e) => setCreateForm({ ...createForm, monthlyPricePKR: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Yearly (PKR)</label><input type="number" min={0} value={createForm.yearlyPricePKR} onChange={(e) => setCreateForm({ ...createForm, yearlyPricePKR: e.target.value })} className={inputCls} /></div>
            </div>
            <button onClick={create} disabled={saving}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold">
              <Plus className="w-3.5 h-3.5" /> {saving ? 'Creating…' : 'Add to catalogue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

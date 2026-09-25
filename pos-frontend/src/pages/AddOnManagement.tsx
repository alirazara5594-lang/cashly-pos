import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Ban, Edit, Save, X, ExternalLink, Plus } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { AddOnCatalogItem, AddOnSubscriptionRow, Branch } from '../types';

interface TenantOption {
  id: string;
  name: string;
  tier: string;
}

/** EXTRA_COUNTER/EXTRA_TABLET need a branch; EXTRA_USER and every boolean feature don't. */
const BRANCH_SCOPED_KEYS = ['EXTRA_COUNTER', 'EXTRA_TABLET'];
const QUANTITY_KEYS = ['EXTRA_COUNTER', 'EXTRA_TABLET', 'EXTRA_USER'];

export const AddOnManagement: React.FC = () => {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [catalog, setCatalog] = useState<AddOnCatalogItem[]>([]);
  const [tenantAddOns, setTenantAddOns] = useState<AddOnSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [quantityForm, setQuantityForm] = useState<Record<string, { branchId: string; quantity: string }>>({});

  const [editingItem, setEditingItem] = useState<AddOnCatalogItem | null>(null);
  const [editForm, setEditForm] = useState({ monthlyPricePKR: '', yearlyPricePKR: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', displayName: '', description: '', monthlyPricePKR: '', yearlyPricePKR: '' });
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadTenants = useCallback(async () => {
    try {
      const data = await posApi.getAdminTenants();
      setTenants(Array.isArray(data) ? data : []);
    } catch {
      setTenants([]);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, tenantAddOnsData] = await Promise.all([
        posApi.getAdminAddOnCatalog(),
        selectedTenantId ? posApi.getTenantAddOns(selectedTenantId) : Promise.resolve([])
      ]);
      setCatalog(Array.isArray(cat) ? cat : []);
      setTenantAddOns(Array.isArray(tenantAddOnsData) ? tenantAddOnsData : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load add-ons') });
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => { loadTenants(); }, [loadTenants]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (!selectedTenantId) { setBranches([]); return; }
    let cancelled = false;
    posApi.getBranches(selectedTenantId)
      .then(data => { if (!cancelled) setBranches(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, [selectedTenantId]);

  const activeForKey = (key: string) => tenantAddOns.find(a => a.addOnKey === key && a.isActive);
  const activeGrantsForKey = (key: string) => tenantAddOns.filter(a => a.addOnKey === key && a.isActive);
  const branchName = (branchId: string | null | undefined) => branches.find(b => b.id === branchId)?.name ?? 'Unknown branch';

  const handleToggle = async (item: AddOnCatalogItem) => {
    if (!selectedTenantId) return;
    setBusyKey(item.key);
    const existing = activeForKey(item.key);
    try {
      if (existing) {
        await posApi.revokeTenantAddOn(selectedTenantId, existing.id);
        setMessage({ type: 'success', text: `${item.displayName} revoked` });
      } else {
        await posApi.grantTenantAddOn(selectedTenantId, { addOnKey: item.key, pricePKR: item.monthlyPricePKR });
        setMessage({ type: 'success', text: `${item.displayName} granted` });
      }
      await loadCatalog();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to update add-on') });
    } finally {
      setBusyKey(null);
    }
  };

  const handleRevokeGrant = async (grant: AddOnSubscriptionRow) => {
    if (!selectedTenantId) return;
    setBusyKey(grant.addOnKey + (grant.branchId ?? ''));
    try {
      await posApi.revokeTenantAddOn(selectedTenantId, grant.id);
      setMessage({ type: 'success', text: 'Add-on revoked' });
      await loadCatalog();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to revoke add-on') });
    } finally {
      setBusyKey(null);
    }
  };

  const handleGrantQuantity = async (item: AddOnCatalogItem) => {
    if (!selectedTenantId) return;
    const form = quantityForm[item.key] || { branchId: '', quantity: '1' };
    const isBranchScoped = BRANCH_SCOPED_KEYS.includes(item.key);
    if (isBranchScoped && !form.branchId) {
      setMessage({ type: 'error', text: 'Pick which branch gets this add-on.' });
      return;
    }
    const quantity = Math.max(1, Number(form.quantity) || 1);
    setBusyKey(item.key);
    try {
      await posApi.grantTenantAddOn(selectedTenantId, {
        addOnKey: item.key,
        pricePKR: item.monthlyPricePKR * quantity,
        quantity,
        branchId: isBranchScoped ? form.branchId : undefined
      });
      setMessage({ type: 'success', text: `${item.displayName} granted (x${quantity}${isBranchScoped ? ` for ${branchName(form.branchId)}` : ''})` });
      setQuantityForm(prev => ({ ...prev, [item.key]: { branchId: '', quantity: '1' } }));
      await loadCatalog();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to grant add-on') });
    } finally {
      setBusyKey(null);
    }
  };

  const openEdit = (item: AddOnCatalogItem) => {
    setEditingItem(item);
    setEditForm({ monthlyPricePKR: String(item.monthlyPricePKR), yearlyPricePKR: String(item.yearlyPricePKR) });
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setEditSaving(true);
    try {
      await posApi.updateAddOnCatalogItem(editingItem.id, {
        monthlyPricePKR: Number(editForm.monthlyPricePKR) || 0,
        yearlyPricePKR: Number(editForm.yearlyPricePKR) || 0
      });
      setEditingItem(null);
      setMessage({ type: 'success', text: 'Pricing updated' });
      await loadCatalog();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to update pricing') });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreate = async () => {
    const key = createForm.key.trim();
    if (!key || !createForm.displayName.trim()) {
      setCreateError('Key and display name are required.');
      return;
    }
    setCreateSaving(true);
    setCreateError('');
    try {
      await posApi.createAddOnCatalogItem({
        key,
        displayName: createForm.displayName.trim(),
        description: createForm.description.trim() || undefined,
        monthlyPricePKR: Number(createForm.monthlyPricePKR) || 0,
        yearlyPricePKR: Number(createForm.yearlyPricePKR) || 0
      });
      setCreateOpen(false);
      setCreateForm({ key: '', displayName: '', description: '', monthlyPricePKR: '', yearlyPricePKR: '' });
      setMessage({ type: 'success', text: `${createForm.displayName} added to the catalog` });
      await loadCatalog();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Failed to create add-on'));
    } finally {
      setCreateSaving(false);
    }
  };

  const tenantName = tenants.find(t => t.id === selectedTenantId)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
          >
            <option value="">— Select a tenant to grant/revoke add-ons —</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.tier})</option>)}
          </select>
          <button
            onClick={loadCatalog}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New add-on
          </button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success' ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <span>{message.text}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {selectedTenantId ? `Add-ons for ${tenantName}` : 'Add-on Catalog (pricing — select a tenant above to grant/revoke)'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Feature</th>
                <th className="px-4 py-2.5">Unlocks</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5 text-right">Monthly</th>
                <th className="px-4 py-2.5 text-right">Yearly</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">Loading…</td></tr>
              ) : catalog.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No add-ons in the catalog yet.</td></tr>
              ) : catalog.map(item => {
                const isQuantity = QUANTITY_KEYS.includes(item.key);
                const isBranchScoped = BRANCH_SCOPED_KEYS.includes(item.key);
                const active = !!activeForKey(item.key);
                const grants = isQuantity ? activeGrantsForKey(item.key) : [];
                const form = quantityForm[item.key] || { branchId: '', quantity: '1' };
                return (
                  <tr key={item.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-900">{item.displayName}</td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-600 max-w-[14rem]">
                      {item.unlocksRoute ? (
                        <span className="inline-flex items-center gap-1">
                          {item.unlocksModule}
                          <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                        </span>
                      ) : (item.unlocksModule || '—')}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-500 max-w-xs">{item.description}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-700">{item.monthlyPricePKR.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-700">{item.yearlyPricePKR.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2 mb-1.5">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 transition" title="Edit pricing">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {selectedTenantId && !isQuantity && (
                          <button
                            onClick={() => handleToggle(item)}
                            disabled={busyKey === item.key}
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition disabled:opacity-50 ${
                              active ? 'bg-rose-50 hover:bg-rose-100 text-rose-600' : 'bg-teal-50 hover:bg-teal-100 text-teal-600'
                            }`}
                          >
                            {active ? <Ban className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                            {active ? 'Revoke' : 'Grant'}
                          </button>
                        )}
                      </div>

                      {selectedTenantId && isQuantity && (
                        <div className="text-left space-y-1.5">
                          {grants.map(g => (
                            <div key={g.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                              <span className="text-[10px] text-slate-600">
                                x{g.quantity}{isBranchScoped ? ` · ${branchName(g.branchId)}` : ' · tenant-wide'}
                              </span>
                              <button
                                onClick={() => handleRevokeGrant(g)}
                                disabled={busyKey === g.addOnKey + (g.branchId ?? '')}
                                className="p-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-50"
                                title="Revoke this grant"
                              >
                                <Ban className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-1.5">
                            {isBranchScoped && (
                              <select
                                value={form.branchId}
                                onChange={(e) => setQuantityForm(prev => ({ ...prev, [item.key]: { ...form, branchId: e.target.value } }))}
                                className="px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[10px] focus:outline-none focus:border-teal-500"
                              >
                                <option value="">Branch…</option>
                                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                              </select>
                            )}
                            <input
                              type="number"
                              min={1}
                              value={form.quantity}
                              onChange={(e) => setQuantityForm(prev => ({ ...prev, [item.key]: { ...form, quantity: e.target.value } }))}
                              className="w-12 px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[10px] focus:outline-none focus:border-teal-500"
                            />
                            <button
                              onClick={() => handleGrantQuantity(item)}
                              disabled={busyKey === item.key}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-teal-50 hover:bg-teal-100 text-teal-600 transition disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Grant
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Edit Pricing — {editingItem.displayName}</h2>
              <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Monthly (PKR)</label>
                <input type="number" value={editForm.monthlyPricePKR} onChange={(e) => setEditForm({ ...editForm, monthlyPricePKR: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Yearly (PKR)</label>
                <input type="number" value={editForm.yearlyPricePKR} onChange={(e) => setEditForm({ ...editForm, yearlyPricePKR: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
            </div>
            <button
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{editSaving ? 'Saving…' : 'Save Pricing'}</span>
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">New catalog add-on</h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            {createError && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                {createError}
              </div>
            )}
            <input
              value={createForm.key}
              onChange={(e) => setCreateForm({ ...createForm, key: e.target.value })}
              placeholder="Key (e.g. HasKitchenDisplay)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:border-teal-500"
            />
            <input
              value={createForm.displayName}
              onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
              placeholder="Display name *"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
            />
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="What the customer gets"
              rows={2}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs resize-none focus:outline-none focus:border-teal-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={createForm.monthlyPricePKR}
                onChange={(e) => setCreateForm({ ...createForm, monthlyPricePKR: e.target.value })}
                placeholder="Monthly PKR"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
              />
              <input
                type="number"
                value={createForm.yearlyPricePKR}
                onChange={(e) => setCreateForm({ ...createForm, yearlyPricePKR: e.target.value })}
                placeholder="Yearly PKR"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
              />
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              The key is what a grant switches on: use a feature flag name (Has…) to flip a
              feature, or a quota key (EXTRA_COUNTER, EXTRA_TABLET, EXTRA_USER) to sell units.
            </p>
            <button
              onClick={handleCreate}
              disabled={createSaving}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{createSaving ? 'Creating…' : 'Create add-on'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

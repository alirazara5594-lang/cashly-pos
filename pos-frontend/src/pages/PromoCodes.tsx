import React, { useState, useEffect, useCallback } from 'react';
import {
  Percent,
  Plus,
  RefreshCw,
  Save,
  X,
  Trash2,
  AlertCircle,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { PromoCode, PromoDiscountType } from '../types';

interface PromoForm {
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  minOrderAmountPKR: number;
  maxUsesTotal: string;
  maxUsesPerCustomer: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): PromoForm => ({
  code: '',
  discountType: 'Percent',
  discountValue: 10,
  minOrderAmountPKR: 0,
  maxUsesTotal: '',
  maxUsesPerCustomer: '',
  validFrom: todayISO(),
  validUntil: '',
  isActive: true
});

export const PromoCodes: React.FC = () => {
  const { currentUser, modulePermissions } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit');
  const canDelete = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'delete');

  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromoForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await posApi.getPromoCodes();
      setCodes(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load promo codes') });
      setCodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsFormOpen(true);
  };

  const openEdit = (promo: PromoCode) => {
    setEditingId(promo.id);
    setForm({
      code: promo.code,
      discountType: promo.discountType === 'Fixed' ? 'Fixed' : 'Percent',
      discountValue: promo.discountValue ?? 0,
      minOrderAmountPKR: promo.minOrderAmountPKR ?? 0,
      maxUsesTotal: promo.maxUsesTotal != null ? String(promo.maxUsesTotal) : '',
      maxUsesPerCustomer: promo.maxUsesPerCustomer != null ? String(promo.maxUsesPerCustomer) : '',
      validFrom: promo.validFrom ? promo.validFrom.slice(0, 10) : todayISO(),
      validUntil: promo.validUntil ? promo.validUntil.slice(0, 10) : '',
      isActive: !!promo.isActive
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) {
      setMessage({ type: 'error', text: 'A promo code is required' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue) || 0,
        minOrderAmountPKR: Number(form.minOrderAmountPKR) || 0,
        maxUsesTotal: form.maxUsesTotal.trim() === '' ? null : Number(form.maxUsesTotal),
        maxUsesPerCustomer: form.maxUsesPerCustomer.trim() === '' ? null : Number(form.maxUsesPerCustomer),
        validFrom: new Date(form.validFrom || todayISO()).toISOString(),
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        isActive: form.isActive
      };
      if (editingId) {
        await posApi.updatePromoCode(editingId, payload);
      } else {
        await posApi.createPromoCode(payload);
      }
      setIsFormOpen(false);
      setMessage({ type: 'success', text: editingId ? 'Promo code updated' : 'Promo code created' });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save promo code') });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (promo: PromoCode) => {
    try {
      await posApi.updatePromoCode(promo.id, { isActive: !promo.isActive });
      setCodes(prev => prev.map(c => (c.id === promo.id ? { ...c, isActive: !c.isActive } : c)));
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to update promo code') });
    }
  };

  const handleDelete = async (promo: PromoCode) => {
    if (!window.confirm(`Delete promo code ${promo.code}? This cannot be undone.`)) return;
    try {
      await posApi.deletePromoCode(promo.id);
      setCodes(prev => prev.filter(c => c.id !== promo.id));
      setMessage({ type: 'success', text: `${promo.code} deleted` });
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to delete promo code') });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
            <Percent className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Promo Codes</h1>
            <p className="text-[11px] text-slate-500 mt-1">Discount campaigns applied at checkout</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {canEdit && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Promo Code</span>
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success'
            ? 'bg-teal-50 border-teal-200 text-teal-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{message.text}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Discount</th>
                <th className="px-4 py-2.5 text-right">Min Order</th>
                <th className="px-4 py-2.5">Validity</th>
                <th className="px-4 py-2.5 text-right">Uses</th>
                <th className="px-4 py-2.5">Status</th>
                {canEdit && <th className="px-4 py-2.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">Loading promo codes…</td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">No promo codes yet.</td></tr>
              ) : codes.map(promo => (
                <tr key={promo.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs font-black text-slate-900 tracking-wider">{promo.code}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-700">
                    {promo.discountType === 'Percent'
                      ? `${promo.discountValue}%`
                      : `${(promo.discountValue ?? 0).toLocaleString()} PKR`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-600">
                    {(promo.minOrderAmountPKR ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-500">
                    {promo.validFrom ? new Date(promo.validFrom).toLocaleDateString() : '—'}
                    {' → '}
                    {promo.validUntil ? new Date(promo.validUntil).toLocaleDateString() : 'no end'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-600">
                    {promo.usesCount ?? 0}
                    {promo.maxUsesTotal != null ? ` / ${promo.maxUsesTotal}` : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => canEdit && handleToggleActive(promo)}
                      disabled={!canEdit}
                      className="flex items-center gap-1 text-[11px] font-bold disabled:opacity-60"
                    >
                      {promo.isActive ? (
                        <><ToggleRight className="w-5 h-5 text-teal-500" /><span className="text-teal-700">Active</span></>
                      ) : (
                        <><ToggleLeft className="w-5 h-5 text-slate-300" /><span className="text-slate-500">Paused</span></>
                      )}
                    </button>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(promo)}
                        className="text-[11px] font-bold text-teal-600 hover:text-teal-700 mr-3"
                      >
                        Edit
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(promo)}
                          className="text-slate-400 hover:text-rose-500 align-middle"
                          title="Delete promo code"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">
                {editingId ? 'Edit Promo Code' : 'New Promo Code'}
              </h2>
              <button onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Code</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="EID20"
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold tracking-wider text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Discount Type</label>
                <select
                  value={form.discountType}
                  onChange={(e) => setForm({ ...form, discountType: e.target.value as PromoDiscountType })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                >
                  <option value="Percent">Percent (%)</option>
                  <option value="Fixed">Fixed (PKR)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Discount Value</label>
                <input
                  type="number"
                  min="0"
                  value={form.discountValue || ''}
                  onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) || 0 })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Minimum Order (PKR)</label>
                <input
                  type="number"
                  min="0"
                  value={form.minOrderAmountPKR || ''}
                  onChange={(e) => setForm({ ...form, minOrderAmountPKR: Number(e.target.value) || 0 })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Max Uses (total)</label>
                <input
                  type="number"
                  min="0"
                  value={form.maxUsesTotal}
                  onChange={(e) => setForm({ ...form, maxUsesTotal: e.target.value })}
                  placeholder="Unlimited"
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Max Uses per Customer</label>
                <input
                  type="number"
                  min="0"
                  value={form.maxUsesPerCustomer}
                  onChange={(e) => setForm({ ...form, maxUsesPerCustomer: e.target.value })}
                  placeholder="Unlimited"
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valid From</label>
                <input
                  type="date"
                  value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valid Until (optional)</label>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="sm:col-span-2">
                <button
                  onClick={() => setForm({ ...form, isActive: !form.isActive })}
                  className="flex items-center gap-1.5 text-xs font-bold"
                >
                  {form.isActive ? (
                    <><ToggleRight className="w-6 h-6 text-teal-500" /><span className="text-teal-700">Active</span></>
                  ) : (
                    <><ToggleLeft className="w-6 h-6 text-slate-300" /><span className="text-slate-500">Paused</span></>
                  )}
                </button>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save Promo Code'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

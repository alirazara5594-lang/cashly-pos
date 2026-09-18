import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Plus,
  RefreshCw,
  Phone,
  Mail,
  Star,
  Save,
  X,
  Receipt,
  AlertCircle
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { Customer } from '../types';

interface VisitRow {
  orderNumber?: string;
  createdAt?: string;
  totalPKR?: number;
  orderType?: string;
}

const emptyForm = { fullName: '', phone: '', email: '' };

export const CustomerManagement: React.FC = () => {
  const { currentUser, modulePermissions } = usePosStore();
  // Viewing is open to any signed-in user (checkout needs lookups too);
  // creating/editing profiles is an `admin` edit action.
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [selected, setSelected] = useState<Customer | null>(null);
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  const [visitsUnavailable, setVisitsUnavailable] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async (term?: string) => {
    setLoading(true);
    try {
      const data = await posApi.getCustomers(term?.trim() || undefined);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load customers') });
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Visit history reuses the existing call-order lookup, which already returns a
  // customer's recent orders keyed by phone — no fragile client-side join needed.
  const openCustomer = async (customer: Customer) => {
    setSelected(customer);
    setVisits(null);
    setVisitsUnavailable(false);
    try {
      const res = await posApi.lookupCustomerPhone(customer.phone);
      const recent = Array.isArray(res?.recentOrders) ? res.recentOrders : [];
      setVisits(recent);
    } catch {
      setVisitsUnavailable(true);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsFormOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setForm({ fullName: customer.fullName, phone: customer.phone, email: customer.email || '' });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.fullName.trim() || !form.phone.trim()) {
      setMessage({ type: 'error', text: 'Name and phone are required' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined
      };
      if (editingId) {
        await posApi.updateCustomer(editingId, payload);
      } else {
        await posApi.createCustomer(payload);
      }
      setIsFormOpen(false);
      setMessage({ type: 'success', text: editingId ? 'Customer updated' : 'Customer created' });
      await loadCustomers(search);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save customer') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Users className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Customers</h1>
            <p className="text-[11px] text-slate-500 mt-1">Profiles, loyalty balances and visit history</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadCustomers(search); }}
              placeholder="Search name or phone…"
              className="pl-8 pr-3 py-2 w-56 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>
          <button
            onClick={() => loadCustomers(search)}
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
              <span>New Customer</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5 text-right">Points</th>
                  <th className="px-4 py-2.5 text-right">Visits</th>
                  <th className="px-4 py-2.5 text-right">Total Spent</th>
                  {canEdit && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">Loading customers…</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No customers found.</td></tr>
                ) : customers.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => openCustomer(c)}
                    className={`cursor-pointer transition ${selected?.id === c.id ? 'bg-teal-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-2.5">
                      <p className="text-xs font-bold text-slate-900">{c.fullName}</p>
                      {c.email && <p className="text-[10px] text-slate-400">{c.email}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{c.phone}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                        {(c.loyaltyPoints ?? 0).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-600">{c.totalVisits ?? 0}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">
                      {(c.totalSpentPKR ?? 0).toLocaleString()}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                          className="text-[11px] font-bold text-teal-600 hover:text-teal-700"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          {!selected ? (
            <div className="text-center py-10 space-y-2">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs text-slate-400">Select a customer to see their loyalty balance and visits.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-black text-slate-900">{selected.fullName}</h2>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                  <Phone className="w-3 h-3" />{selected.phone}
                </div>
                {selected.email && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                    <Mail className="w-3 h-3" />{selected.email}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-center">
                  <Star className="w-3.5 h-3.5 text-amber-600 mx-auto" />
                  <p className="text-sm font-black text-amber-700 mt-1">{(selected.loyaltyPoints ?? 0).toLocaleString()}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600">Points</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <p className="text-sm font-black text-slate-900 mt-4">{selected.totalVisits ?? 0}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Visits</p>
                </div>
                <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-center">
                  <p className="text-sm font-black text-teal-700 mt-4">{(selected.totalSpentPKR ?? 0).toLocaleString()}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-teal-600">Spent PKR</p>
                </div>
              </div>

              {selected.lastVisitAt && (
                <p className="text-[11px] text-slate-400">
                  Last visit: {new Date(selected.lastVisitAt).toLocaleString()}
                </p>
              )}

              <div className="pt-2 border-t border-slate-100">
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                  Recent Visits
                </div>
                {visitsUnavailable ? (
                  <p className="text-[11px] text-slate-400">
                    Visit history is not available from this server yet — the summary above is live.
                  </p>
                ) : visits === null ? (
                  <p className="text-[11px] text-slate-400">Loading…</p>
                ) : visits.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No past orders recorded.</p>
                ) : (
                  <div className="space-y-1.5">
                    {visits.slice(0, 12).map((v, i) => (
                      <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Receipt className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="text-[11px] font-semibold text-slate-700 truncate">
                            {v.orderNumber || 'Order'}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] font-bold text-slate-900">{(v.totalPKR ?? 0).toLocaleString()}</p>
                          {v.createdAt && (
                            <p className="text-[9px] text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">
                {editingId ? 'Edit Customer' : 'New Customer'}
              </h2>
              <button onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {([
                { key: 'fullName' as const, label: 'Full Name', placeholder: 'Customer name' },
                { key: 'phone' as const, label: 'Phone', placeholder: '03xx-xxxxxxx' },
                { key: 'email' as const, label: 'Email (optional)', placeholder: 'name@example.com' }
              ]).map(f => (
                <div key={f.key}>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{f.label}</label>
                  <input
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save Customer'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

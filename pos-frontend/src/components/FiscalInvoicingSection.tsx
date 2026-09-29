import React, { useEffect, useState } from 'react';
import { Receipt, Save, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { FiscalAuthority, FiscalConnections, FiscalEnvironment, FiscalShopRow } from '../types';

const AUTHORITIES: { value: FiscalAuthority; label: string }[] = [
  { value: 'Fbr', label: 'FBR (Islamabad / federal)' },
  { value: 'Pra', label: 'PRA (Punjab)' },
  { value: 'Srb', label: 'SRB (Sindh)' },
  { value: 'Kpra', label: 'KPRA (Khyber Pakhtunkhwa)' }
];

interface Draft {
  authority: FiscalAuthority;
  environment: FiscalEnvironment;
  posId: string;
  accessToken: string;
  apiUrl: string;
  defaultPctCode: string;
  isEnabled: boolean;
}

const draftFor = (row: FiscalShopRow): Draft => ({
  authority: row.connection?.authority ?? 'Fbr',
  environment: row.connection?.environment ?? 'Sandbox',
  posId: row.connection?.posId ?? '',
  accessToken: '',
  apiUrl: row.connection?.apiUrl ?? '',
  defaultPctCode: row.connection?.defaultPctCode ?? '',
  isEnabled: row.connection?.isEnabled ?? false
});

const inputClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';
const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

/**
 * Each shop's connection to its tax authority. Once switched on, every paid sale at the shop is
 * reported and gets the authority's invoice number and QR code on the receipt; returns go as
 * credit notes. Sold per shop as an add-on.
 */
export const FiscalInvoicingSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [data, setData] = useState<FiscalConnections | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const apply = (result: FiscalConnections) => {
    setData(result);
    setDrafts(Object.fromEntries(result.shops.map(s => [s.branchId, draftFor(s)])));
  };

  useEffect(() => {
    let cancelled = false;
    posApi.getFiscalConnections()
      .then(result => { if (!cancelled) apply(result); })
      .catch(err => { if (!cancelled) setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not load fiscal connections.') }); });
    return () => { cancelled = true; };
  }, []);

  const reload = async () => apply(await posApi.getFiscalConnections());
  const defaultUrl = (a: FiscalAuthority, e: FiscalEnvironment) =>
    data?.defaults.find(d => d.authority === a && d.environment === e)?.url ?? null;

  const save = async (row: FiscalShopRow) => {
    const draft = drafts[row.branchId];
    if (!draft) return;
    setBusy(row.branchId);
    setMessage(null);
    try {
      const res = await posApi.saveFiscalConnection(row.branchId, {
        authority: draft.authority,
        environment: draft.environment,
        posId: draft.posId.trim(),
        accessToken: draft.accessToken.trim() || undefined,
        apiUrl: draft.apiUrl.trim() || undefined,
        defaultPctCode: draft.defaultPctCode.trim(),
        isEnabled: draft.isEnabled
      });
      setMessage({ type: 'success', text: res.message });
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not save the connection.') });
    } finally {
      setBusy(null);
    }
  };

  const retry = async (row: FiscalShopRow) => {
    setBusy(row.branchId);
    setMessage(null);
    try {
      const res = await posApi.retryFiscalReports(row.branchId);
      setMessage({
        type: res.stillPending > 0 ? 'error' : 'success',
        text: `${res.reported} sale(s) reported.` + (res.stillPending > 0 ? ` ${res.stillPending} still waiting: ${res.lastError ?? 'the authority did not answer'}` : '')
      });
      await reload();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Could not report again.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-teal-600" /> Fiscal invoicing (FBR / PRA / SRB / KPRA)
        </h2>
        <p className="text-xs text-slate-500">
          Report every paid sale to the tax authority as it happens. The authority's invoice number and QR code
          go on the receipt, and returns are reported as credit notes. Test with the sandbox first; the authority
          confirms the endpoint address when it registers your POS ID.
        </p>
      </div>

      {message && (
        <div className={`px-3 py-2 rounded-xl border text-xs font-semibold ${
          message.type === 'success' ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-rose-50 text-rose-700 border-rose-200'
        }`}>{message.text}</div>
      )}

      {!data ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : data.shops.length === 0 ? (
        <p className="text-xs text-slate-400">No shops that sell.</p>
      ) : (
        data.shops.map(row => {
          const draft = drafts[row.branchId] ?? draftFor(row);
          const set = (patch: Partial<Draft>) => setDrafts(prev => ({ ...prev, [row.branchId]: { ...draft, ...patch } }));
          const fallbackUrl = defaultUrl(draft.authority, draft.environment);
          const c = row.connection;
          return (
            <div key={row.branchId} className="p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-900">{row.branchName}</div>
                <div className="flex items-center gap-2 text-[11px]">
                  {c?.isEnabled ? (
                    <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-bold">Reporting to {c.authority.toUpperCase()} ({c.environment})</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold">Off</span>
                  )}
                </div>
              </div>

              {!row.hasAddOn && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Fiscal invoicing is an add-on for each shop. You can fill this in now; it can be switched on once the add-on is on your account.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Authority</label>
                  <select className={inputClass} disabled={!canEdit} value={draft.authority} onChange={e => set({ authority: e.target.value as FiscalAuthority })}>
                    {AUTHORITIES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Environment</label>
                  <select className={inputClass} disabled={!canEdit} value={draft.environment} onChange={e => set({ environment: e.target.value as FiscalEnvironment })}>
                    <option value="Sandbox">Sandbox (testing)</option>
                    <option value="Production">Production (real invoices)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>POS ID</label>
                  <input className={inputClass} disabled={!canEdit} value={draft.posId} onChange={e => set({ posId: e.target.value })} placeholder="From the authority" />
                </div>
                <div>
                  <label className={labelClass}>Access token</label>
                  <input
                    type="password"
                    autoComplete="off"
                    className={inputClass}
                    disabled={!canEdit}
                    value={draft.accessToken}
                    onChange={e => set({ accessToken: e.target.value })}
                    placeholder={c?.hasToken ? 'Saved — leave blank to keep it' : 'From the authority'}
                  />
                </div>
                <div>
                  <label className={labelClass}>PCT code on each item</label>
                  <input className={inputClass} disabled={!canEdit} value={draft.defaultPctCode} onChange={e => set({ defaultPctCode: e.target.value })} placeholder="e.g. the code for restaurant services" />
                </div>
                <div>
                  <label className={labelClass}>Endpoint address</label>
                  <input className={inputClass} disabled={!canEdit} value={draft.apiUrl} onChange={e => set({ apiUrl: e.target.value })} placeholder={fallbackUrl ?? 'Required for this authority'} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className={`flex items-center gap-2 text-xs ${canEdit ? 'cursor-pointer text-slate-700' : 'text-slate-400'}`}>
                  <input type="checkbox" className="w-4 h-4 accent-teal-500" disabled={!canEdit} checked={draft.isEnabled} onChange={e => set({ isEnabled: e.target.checked })} />
                  Report every paid sale at {row.branchName}
                </label>
                <div className="flex items-center gap-2">
                  {row.pendingReports > 0 && canEdit && (
                    <button
                      onClick={() => retry(row)}
                      disabled={busy === row.branchId}
                      className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Report {row.pendingReports} waiting sale(s)
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => save(row)}
                      disabled={busy === row.branchId}
                      className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Save className="w-3.5 h-3.5" /> {busy === row.branchId ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </div>

              {(c?.lastSuccessAt || c?.lastError) && (
                <div className="text-[11px] space-y-0.5">
                  {c?.lastSuccessAt && (
                    <div className="text-teal-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Last reported {new Date(c.lastSuccessAt).toLocaleString()}</div>
                  )}
                  {c?.lastError && (
                    <div className="text-rose-600">Last problem{c.lastErrorAt ? ` (${new Date(c.lastErrorAt).toLocaleString()})` : ''}: {c.lastError}</div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

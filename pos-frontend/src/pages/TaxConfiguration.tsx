import React, { useState, useEffect } from 'react';
import { MapPin, Percent, AlertTriangle, Save, Landmark } from 'lucide-react';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import { posApi, getApiErrorMessage } from '../services/api';
import type { TaxJurisdiction, ModuleKey } from '../types';

const TAX_DISCLAIMER =
  'Tax rates are editable defaults — please verify current rates with your tax authority ' +
  '(PRA/SRB/KPRA/BRA/FBR) before relying on them.';

export const TaxConfiguration: React.FC = () => {
  const {
    selectedTenant,
    selectedBranch,
    deploymentMode,
    cashTaxRatePercent,
    cardTaxRatePercent,
    taxMode,
    setTaxSettings,
    currentUser,
    modulePermissions,
    selectBranch,
    tenantSettings
  } = usePosStore();

  const can = (moduleKey: ModuleKey, action: 'view' | 'edit' = 'view') =>
    hasModuleAccess(currentUser?.role, modulePermissions, moduleKey, action);

  // Only Owner / SuperAdmin may change the provincial tax rates themselves.
  const canEditTaxJurisdictions = can('admin', 'edit');

  const [jurisdictions, setJurisdictions] = useState<TaxJurisdiction[]>([]);
  const [jurisdictionDrafts, setJurisdictionDrafts] = useState<Record<string, { cashTaxRate: number; digitalTaxRate: number }>>({});
  const [savingJurisdictionId, setSavingJurisdictionId] = useState<string | null>(null);
  const [regionCode, setRegionCode] = useState<string>('');
  const [savingRegion, setSavingRegion] = useState(false);
  const [useProvincialTax, setUseProvincialTax] = useState(false);
  const [savingProvincialToggle, setSavingProvincialToggle] = useState(false);
  const [taxMessage, setTaxMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadJurisdictions = async () => {
    try {
      const data = await posApi.getTaxJurisdictions();
      const rows = Array.isArray(data) ? data : [];
      setJurisdictions(rows);
      setJurisdictionDrafts(
        Object.fromEntries(rows.map(j => [j.id, { cashTaxRate: j.cashTaxRate, digitalTaxRate: j.digitalTaxRate }]))
      );
    } catch (err) {
      console.warn('Failed to load tax jurisdictions:', err);
    }
  };

  useEffect(() => {
    loadJurisdictions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror persisted values into the local drafts when they change. Adjusting
  // during render (instead of in an effect) avoids a cascading re-render.
  const persistedRegionCode = selectedBranch?.regionCode || '';
  const [lastPersistedRegion, setLastPersistedRegion] = useState(persistedRegionCode);
  if (persistedRegionCode !== lastPersistedRegion) {
    setLastPersistedRegion(persistedRegionCode);
    setRegionCode(persistedRegionCode);
  }

  const persistedProvincialTax = !!tenantSettings?.useProvincialTax;
  const [lastPersistedProvincialTax, setLastPersistedProvincialTax] = useState(persistedProvincialTax);
  if (persistedProvincialTax !== lastPersistedProvincialTax) {
    setLastPersistedProvincialTax(persistedProvincialTax);
    setUseProvincialTax(persistedProvincialTax);
  }

  // The jurisdiction actually applied at checkout for this branch right now — matches the
  // server's ResolveTaxRatesAsync (branch's *saved* region, not an unsaved dropdown pick).
  const activeJurisdiction = selectedBranch?.regionCode
    ? jurisdictions.find(j => j.regionCode === selectedBranch.regionCode && j.isActive) || null
    : null;

  const handleSaveRegion = async () => {
    if (!selectedBranch?.id) return;
    setSavingRegion(true);
    setTaxMessage(null);
    try {
      const updated = await posApi.updateBranch(selectedBranch.id, { regionCode: regionCode || null });
      selectBranch({ ...selectedBranch, ...updated, regionCode: regionCode || null });
      setTaxMessage({ type: 'success', text: 'Branch tax region updated' });
    } catch (err) {
      setTaxMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to update branch tax region') });
    } finally {
      setSavingRegion(false);
      setTimeout(() => setTaxMessage(null), 4000);
    }
  };

  const handleToggleProvincialTax = async (next: boolean) => {
    if (!selectedTenant?.id) return;
    setUseProvincialTax(next);
    setSavingProvincialToggle(true);
    setTaxMessage(null);
    try {
      await posApi.updateTenantSettings(selectedTenant.id, { ...(tenantSettings || {}), useProvincialTax: next });
      await usePosStore.getState().loadTenantSettings();
      setTaxMessage({
        type: 'success',
        text: next
          ? 'Provincial tax enabled — checkout tax now comes from the branch jurisdiction'
          : 'Provincial tax disabled — using the flat per-tenant rate'
      });
    } catch (err) {
      setUseProvincialTax(!next);
      setTaxMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to update tax mode') });
    } finally {
      setSavingProvincialToggle(false);
      setTimeout(() => setTaxMessage(null), 4000);
    }
  };

  const handleSaveJurisdiction = async (j: TaxJurisdiction) => {
    const draft = jurisdictionDrafts[j.id];
    if (!draft) return;
    setSavingJurisdictionId(j.id);
    setTaxMessage(null);
    try {
      const updated = await posApi.updateTaxJurisdiction(j.id, {
        cashTaxRate: draft.cashTaxRate,
        digitalTaxRate: draft.digitalTaxRate
      });
      setJurisdictions(prev => prev.map(row => (row.id === j.id ? { ...row, ...updated } : row)));
      setTaxMessage({ type: 'success', text: `${j.authorityName} rates saved` });
    } catch (err) {
      setTaxMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save tax rates') });
    } finally {
      setSavingJurisdictionId(null);
      setTimeout(() => setTaxMessage(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-1">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Percent className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900">Tax Configuration</h1>
          <p className="text-xs text-slate-500">Tax rates, jurisdictions, and the branch tax region.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Restaurant / Brand Name</label>
            <input
              type="text"
              defaultValue={selectedTenant?.name || 'Cashly Restaurant'}
              disabled
              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Deployment Architecture</label>
            <input
              type="text"
              value={deploymentMode === 'MultiBranch' ? '🏢 Multi-Branch Enterprise Chain' : '🏪 Single Restaurant Location'}
              disabled
              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 font-semibold"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Current Outlet Name</label>
            <input
              type="text"
              defaultValue={selectedBranch?.name || 'Main Dining Branch'}
              disabled
              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700"
            />
          </div>
        </div>

        {/* Branch Tax Region (jurisdiction assignment) */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-amber-600" />
            Branch Tax Region
          </h3>
          <p className="text-xs text-slate-500">
            Which provincial tax authority this outlet falls under. Used to pick the correct
            cash / digital rate at checkout when provincial tax is enabled.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-slate-600">
                Tax Jurisdiction for {selectedBranch?.name || 'this branch'}
              </label>
              <select
                value={regionCode}
                onChange={(e) => setRegionCode(e.target.value)}
                disabled={!selectedBranch?.id}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60"
              >
                <option value="">— Not assigned —</option>
                {Object.entries(
                  jurisdictions.reduce<Record<string, TaxJurisdiction[]>>((groups, j) => {
                    (groups[j.authorityName] ||= []).push(j);
                    return groups;
                  }, {})
                ).map(([authority, rows]) => (
                  <optgroup key={authority} label={authority}>
                    {rows.map(j => (
                      <option key={j.id} value={j.regionCode}>
                        {j.regionCode} — {j.authorityName} ({j.cashTaxRate}% cash / {j.digitalTaxRate}% digital)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {jurisdictions.length === 0 && (
                <p className="text-[11px] text-slate-400">
                  No tax jurisdictions available yet.
                </p>
              )}
            </div>

            <button
              onClick={handleSaveRegion}
              disabled={savingRegion || !selectedBranch?.id || regionCode === (selectedBranch?.regionCode || '')}
              className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {savingRegion ? 'Saving…' : 'Save Region'}
            </button>
          </div>
        </div>

        {/* Tax Settings */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Percent className="w-4 h-4 text-amber-600" />
            Tax Rate Configuration
          </h3>

          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{TAX_DISCLAIMER}</span>
          </div>

          {taxMessage && (
            <div className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
              taxMessage.type === 'success'
                ? 'bg-teal-50 text-teal-700 border-teal-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}>
              {taxMessage.text}
            </div>
          )}

          {/* Provincial tax master switch */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Landmark className="w-4 h-4 text-teal-600" />
                <span className="text-sm font-bold text-slate-900">Use Provincial Tax Rates</span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                  useProvincialTax
                    ? 'bg-teal-50 text-teal-700 border border-teal-200'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {useProvincialTax ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-xs text-slate-500 max-w-xl">
                When on, checkout tax is computed server-side from this branch's tax region
                (cash vs digital payment picks the matching rate). When off, the flat rates
                below apply to every branch.
              </p>
            </div>
            <button
              onClick={() => handleToggleProvincialTax(!useProvincialTax)}
              disabled={savingProvincialToggle || !selectedTenant?.id}
              className={`px-4 py-2 rounded-xl font-bold text-xs transition disabled:opacity-40 cursor-pointer ${
                useProvincialTax
                  ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                  : 'bg-teal-500 hover:bg-teal-600 text-white'
              }`}
            >
              {savingProvincialToggle ? 'Saving…' : useProvincialTax ? 'Turn Off' : 'Turn On'}
            </button>
          </div>

          {useProvincialTax && (
            activeJurisdiction ? (
              <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-800 flex items-start gap-2.5">
                <Landmark className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Active rate for {selectedBranch?.name || 'this branch'}:</strong>{' '}
                  {activeJurisdiction.cashTaxRate}% cash / {activeJurisdiction.digitalTaxRate}% digital
                  (via {activeJurisdiction.authorityName}). This overrides the flat rates below —
                  edit it in the jurisdiction table further down.
                </span>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  No tax region is assigned to {selectedBranch?.name || 'this branch'} yet (or its
                  region has no active jurisdiction) — checkout is falling back to the flat rate below.
                  Assign a region above to use provincial rates.
                </span>
              </div>
            )
          )}

          <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${activeJurisdiction ? 'opacity-60' : ''}`}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Cash Payment Tax Rate (%)</label>
              <input
                type="number"
                value={cashTaxRatePercent}
                disabled={!!activeJurisdiction}
                onChange={(e) => setTaxSettings({ cashRate: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Card / Digital Tax Rate (%)</label>
              <input
                type="number"
                value={cardTaxRatePercent}
                disabled={!!activeJurisdiction}
                onChange={(e) => setTaxSettings({ cardRate: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Tax Mode</label>
              <select
                value={taxMode}
                onChange={(e) => setTaxSettings({ mode: e.target.value as any })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              >
                <option value="Exclusive">Tax Exclusive (Added on top)</option>
                <option value="Inclusive">Tax Inclusive (Inside item price)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Provincial tax jurisdiction rate editor — Owner / SuperAdmin only */}
        {canEditTaxJurisdictions && jurisdictions.length > 0 && (
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Landmark className="w-4 h-4 text-teal-600" />
                Provincial Tax Authority Rates
              </h3>
              <p className="text-xs text-slate-500">
                Rates applied per region when provincial tax is enabled. {TAX_DISCLAIMER}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="pb-2">Region</th>
                    <th className="pb-2">Authority</th>
                    <th className="pb-2 text-right">Cash Rate (%)</th>
                    <th className="pb-2 text-right">Digital Rate (%)</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {jurisdictions.map(j => {
                    const draft = jurisdictionDrafts[j.id] || { cashTaxRate: j.cashTaxRate, digitalTaxRate: j.digitalTaxRate };
                    const isDirty =
                      draft.cashTaxRate !== j.cashTaxRate || draft.digitalTaxRate !== j.digitalTaxRate;
                    return (
                      <tr key={j.id} className={selectedBranch?.regionCode === j.regionCode ? 'bg-teal-50/40' : ''}>
                        <td className="py-2.5">
                          <span className="font-mono font-bold text-slate-900">{j.regionCode}</span>
                          {selectedBranch?.regionCode === j.regionCode && (
                            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-bold">
                              THIS BRANCH
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-700">{j.authorityName}</td>
                        <td className="py-2.5 text-right">
                          <input
                            type="number"
                            step="0.5"
                            value={draft.cashTaxRate}
                            onChange={(e) => setJurisdictionDrafts(prev => ({
                              ...prev,
                              [j.id]: { ...draft, cashTaxRate: parseFloat(e.target.value) || 0 }
                            }))}
                            className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <input
                            type="number"
                            step="0.5"
                            value={draft.digitalTaxRate}
                            onChange={(e) => setJurisdictionDrafts(prev => ({
                              ...prev,
                              [j.id]: { ...draft, digitalTaxRate: parseFloat(e.target.value) || 0 }
                            }))}
                            className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-right text-xs font-bold text-teal-600 focus:outline-none focus:border-teal-500"
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleSaveJurisdiction(j)}
                            disabled={!isDirty || savingJurisdictionId === j.id}
                            className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-[11px] transition cursor-pointer"
                          >
                            {savingJurisdictionId === j.id ? 'Saving…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

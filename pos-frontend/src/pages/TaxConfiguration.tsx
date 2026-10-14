import React, { useEffect, useState } from 'react';
import { AlertTriangle, Building2, Check, Landmark, MapPin, Percent, Receipt, RotateCcw, Save, Tags } from 'lucide-react';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import { posApi, getApiErrorMessage } from '../services/api';
import { FiscalInvoicingSection } from '../components/FiscalInvoicingSection';
import type { TaxItems, TaxMode, TaxSetup, TaxTreatment } from '../types';

/** The page's own copy of the setup while it is being edited. Numbers are kept as typed. */
interface Draft {
  pricesIncludeTax: boolean;
  mode: TaxMode;
  standardRate: string;
  cardRate: string;
  /** Outlet id → province code ('' = none). */
  outletRegions: Record<string, string>;
  /** Province code → the business's rates for it. */
  regionRates: Record<string, { cash: string; card: string }>;
  /** Company id → its tax numbers. */
  companies: Record<string, { ntn: string; strn: string }>;
}

const toDraft = (s: TaxSetup): Draft => ({
  pricesIncludeTax: s.pricesIncludeTax,
  mode: s.mode,
  standardRate: String(s.standardRate),
  cardRate: String(s.cardRate),
  outletRegions: Object.fromEntries(s.outlets.map(o => [o.id, o.regionCode ?? ''])),
  regionRates: Object.fromEntries(s.regions.map(r => [r.regionCode, { cash: String(r.cashRate), card: String(r.cardRate) }])),
  companies: Object.fromEntries(s.companies.map(c => [c.id, { ntn: c.ntn ?? '', strn: c.strn ?? '' }]))
});

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};
const badRate = (v: string) => { const n = num(v); return Number.isNaN(n) || n < 0 || n > 100; };
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const inputCls = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-60';
const rateCls = 'w-24 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60';

/** A large choice card, one of a set. */
const Choice: React.FC<{ active: boolean; disabled?: boolean; onClick: () => void; title: string; hint: React.ReactNode }> = ({ active, disabled, onClick, title, hint }) => (
  <button
    type="button"
    role="radio"
    aria-checked={active}
    disabled={disabled}
    onClick={onClick}
    className={`text-left p-4 rounded-xl border transition disabled:opacity-50 disabled:cursor-not-allowed ${
      active ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/20' : 'border-slate-200 bg-white hover:border-teal-300'
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-bold text-slate-900">{title}</span>
      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-teal-600 bg-teal-600' : 'border-slate-300'}`}>
        {active && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
      </span>
    </div>
    <div className="text-xs text-slate-500 mt-1 leading-relaxed">{hint}</div>
  </button>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <section className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4">
    <div>
      <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
    {children}
  </section>
);

const TREATMENT_LABEL: Record<TaxTreatment, string> = {
  Standard: 'Standard rate', Exempt: 'Exempt', ZeroRated: 'Zero-rated', OwnRate: 'Own rate'
};

/**
 * Items taxed differently: each category's mix, a way to tax a whole category one way at once (a
 * pharmacy marking all its medicines exempt), and the items not at the standard rate. Applies at once,
 * apart from the page's Save; a single item is changed on its own form in Menu / Medicines.
 */
const ItemsTaxedDifferently: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [data, setData] = useState<TaxItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [choice, setChoice] = useState<Record<string, { treatment: TaxTreatment; rate: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTaxItems()
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load your items.')); });
    return () => { cancelled = true; };
  }, [version]);

  const apply = async (categoryId: string, name: string) => {
    const c = choice[categoryId] ?? { treatment: 'Exempt' as TaxTreatment, rate: '' };
    const rate = parseFloat(c.rate);
    if (c.treatment === 'OwnRate' && !(rate >= 0 && rate <= 100)) {
      setNote({ ok: false, text: `${name}: enter the rate, between 0 and 100%.` });
      return;
    }
    const label = c.treatment === 'OwnRate' ? `${rate}%` : TREATMENT_LABEL[c.treatment].toLowerCase();
    if (!window.confirm(`Tax every item in ${name} at ${label}? Each item can still be changed on its own afterwards.`)) return;
    setBusyId(categoryId);
    setNote(null);
    try {
      const res = await posApi.applyCategoryTax(categoryId, c.treatment, c.treatment === 'OwnRate' ? rate : undefined);
      setNote({ ok: true, text: res.message });
      setVersion(v => v + 1);
    } catch (err) {
      setNote({ ok: false, text: getApiErrorMessage(err, 'Could not change the category.') });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section icon={<Tags className="w-4 h-4 text-teal-600" />} title="Items taxed differently"
      hint="Most items are taxed at your rate. Mark a whole category exempt, zero-rated or at its own rate here — it applies at once. Change a single item on its own form in your menu / medicines.">
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {data && (
        <>
          {data.categories.length === 0 ? <p className="text-xs text-slate-500">No items yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Category</th>
                    <th className="py-2 pr-3">How its items are taxed</th>
                    {canEdit && <th className="py-2 text-right">Set every item to</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.categories.map(cat => {
                    const c = choice[cat.id] ?? { treatment: 'Exempt' as TaxTreatment, rate: '' };
                    const mix = [
                      cat.standard && `${cat.standard} standard`, cat.exempt && `${cat.exempt} exempt`,
                      cat.zeroRated && `${cat.zeroRated} zero-rated`, cat.ownRate && `${cat.ownRate} own rate`
                    ].filter(Boolean).join(' · ');
                    return (
                      <tr key={cat.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-900">{cat.name}</div>
                          <div className="text-[10px] text-slate-400">{cat.items} item{cat.items === 1 ? '' : 's'}</div>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-slate-600">{mix}</td>
                        {canEdit && (
                          <td className="py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <select value={c.treatment} aria-label={`Tax for every item in ${cat.name}`}
                                onChange={(e) => setChoice(prev => ({ ...prev, [cat.id]: { ...c, treatment: e.target.value as TaxTreatment } }))}
                                className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-teal-500">
                                {(Object.keys(TREATMENT_LABEL) as TaxTreatment[]).map(t => <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>)}
                              </select>
                              {c.treatment === 'OwnRate' && (
                                <input type="number" min="0" max="100" step="0.5" value={c.rate} placeholder="%" aria-label="Rate"
                                  onChange={(e) => setChoice(prev => ({ ...prev, [cat.id]: { ...c, rate: e.target.value } }))}
                                  className="w-16 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-xs focus:outline-none focus:border-teal-500" />
                              )}
                              <button type="button" onClick={() => apply(cat.id, cat.name)} disabled={busyId !== null}
                                className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">
                                {busyId === cat.id ? 'Applying…' : 'Apply'}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.items.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1.5">Not at the standard rate</div>
              <div className="flex flex-wrap gap-1.5">
                {data.items.map(i => (
                  <span key={i.id} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                    {i.name} <span className="text-slate-400">· {i.taxTreatment === 'OwnRate' ? `${i.taxRatePercent}%` : TREATMENT_LABEL[i.taxTreatment].toLowerCase()}</span>
                  </span>
                ))}
                {data.moreItems > 0 && <span className="px-2 py-1 text-[11px] text-slate-500">and {data.moreItems} more</span>}
              </div>
            </div>
          )}
          {note && <p className={`text-xs font-semibold ${note.ok ? 'text-teal-700' : 'text-rose-600'}`}>{note.text}</p>}
        </>
      )}
    </Section>
  );
};

/**
 * Tax Setup: how this business's sales are taxed — whether prices include tax, the rate (one rate,
 * cash and card, or each outlet by its province), its own province rates, and the NTN / STRN on its
 * receipts. Saved on the server in one go (PUT /api/tax/setup); the till and the server's pricing
 * both read it, so the total on the screen is the total charged.
 */
export const TaxConfiguration: React.FC = () => {
  const { selectedBranch, currentUser, modulePermissions, loadBranchTax, loadTenantSettings } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'accounts', 'edit');

  const [setup, setSetup] = useState<TaxSetup | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTaxSetup()
      .then(s => { if (!cancelled) { setSetup(s); setDraft(toDraft(s)); setLoadError(null); } })
      .catch(err => { if (!cancelled) setLoadError(getApiErrorMessage(err, 'Could not load the tax setup.')); });
    return () => { cancelled = true; };
  }, [version]);

  if (loadError) {
    return <div className="p-6"><div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{loadError}</div></div>;
  }
  if (!setup || !draft) {
    return <div className="p-6 text-sm text-slate-400">Loading the tax setup…</div>;
  }

  const update = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setMessage(null); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(setup));
  const standard = num(draft.standardRate);
  const card = num(draft.cardRate);
  const hasProvinces = setup.regions.length > 0;

  // The example on the first card, at the main rate.
  const exampleRate = Number.isNaN(standard) ? 0 : standard;
  const taxOnTop = Math.round(1000 * exampleRate / 100);
  const taxInside = Math.round(1000 - 1000 / (1 + exampleRate / 100));

  const problem =
    badRate(draft.standardRate) ? 'Enter a rate between 0 and 100%.'
      : draft.mode !== 'Single' && badRate(draft.cardRate) ? 'Enter a card rate between 0 and 100%.'
      : Object.entries(draft.regionRates).some(([, r]) => badRate(r.cash) || badRate(r.card)) ? 'Every province rate must be between 0 and 100%.'
      : null;

  const save = async () => {
    if (problem || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await posApi.saveTaxSetup({
        pricesIncludeTax: draft.pricesIncludeTax,
        mode: draft.mode,
        standardRate: standard,
        cardRate: draft.mode === 'Single' ? standard : card,
        outletRegions: Object.entries(draft.outletRegions).map(([branchId, code]) => ({ branchId, regionCode: code || null })),
        regionRates: Object.entries(draft.regionRates).map(([regionCode, r]) => ({ regionCode, cashRate: num(r.cash), cardRate: num(r.card) })),
        companies: Object.entries(draft.companies).map(([id, c]) => ({ id, ntn: c.ntn.trim() || null, strn: c.strn.trim() || null }))
      });
      setMessage({ ok: true, text: 'Tax setup saved. The till uses it from the next sale.' });
      setVersion(v => v + 1);
      // The till on this device picks the new rates up straight away.
      void loadTenantSettings();
      if (selectedBranch?.id) void loadBranchTax(selectedBranch.id);
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not save the tax setup.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4 lg:p-6 pb-28">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Percent className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Tax Setup</h1>
          <p className="text-xs text-slate-500">How your sales are taxed. The till, your receipts and your reports all use exactly these settings.</p>
        </div>
      </div>

      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Rates here are editable starting points, not tax advice. Confirm the current rates for your business with your tax authority ({setup.taxAuthorityName || 'FBR / provincial'}) or your accountant.</span>
      </div>

      {/* 1. Prices */}
      <Section icon={<Receipt className="w-4 h-4 text-teal-600" />} title="Your prices" hint="Are the prices on your menu and shelves before tax, or do they already include it?">
        <div role="radiogroup" aria-label="Your prices" className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Choice
            active={!draft.pricesIncludeTax}
            disabled={!canEdit}
            onClick={() => update({ pricesIncludeTax: false })}
            title="Tax is added at checkout"
            hint={<>Prices are before tax. An item of <b>1,000</b> + {fmt(exampleRate)}% tax: the customer pays <b>{(1000 + taxOnTop).toLocaleString()}</b>.</>}
          />
          <Choice
            active={draft.pricesIncludeTax}
            disabled={!canEdit}
            onClick={() => update({ pricesIncludeTax: true })}
            title="Prices include tax"
            hint={<>Prices already include tax. An item of <b>1,000</b>: the customer pays <b>1,000</b>, of which <b>{taxInside.toLocaleString()}</b> is tax.</>}
          />
        </div>
      </Section>

      {/* 2. Rate */}
      <Section icon={<Percent className="w-4 h-4 text-teal-600" />} title="Tax rate" hint="Choose how the rate is decided.">
        <div role="radiogroup" aria-label="Tax rate" className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Choice active={draft.mode === 'Single'} disabled={!canEdit} onClick={() => update({ mode: 'Single' })}
            title="One rate" hint="Every sale is taxed at the same rate, however it is paid." />
          <Choice active={draft.mode === 'CashCard'} disabled={!canEdit} onClick={() => update({ mode: 'CashCard' })}
            title="Cash and card rates" hint="Card and digital payments at their own rate — often lower, as the provinces allow." />
          <Choice active={draft.mode === 'Provincial'} disabled={!canEdit || !hasProvinces} onClick={() => update({ mode: 'Provincial' })}
            title="By province" hint={hasProvinces ? 'Each outlet uses its province\'s cash and card rates.' : 'No provinces are set up for your country.'} />
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-1">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 mb-1">
              {draft.mode === 'Single' ? 'Rate' : 'Cash rate'}{draft.mode === 'Provincial' ? ' (outlets with no province)' : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <input type="number" min="0" max="100" step="0.5" value={draft.standardRate} disabled={!canEdit}
                onChange={(e) => update({ standardRate: e.target.value })} className={rateCls} />
              <span className="text-sm text-slate-500">%</span>
            </span>
          </label>
          {draft.mode !== 'Single' && (
            <label className="block">
              <span className="block text-xs font-semibold text-slate-600 mb-1">
                Card & digital rate{draft.mode === 'Provincial' ? ' (outlets with no province)' : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <input type="number" min="0" max="100" step="0.5" value={draft.cardRate} disabled={!canEdit}
                  onChange={(e) => update({ cardRate: e.target.value })} className={rateCls} />
                <span className="text-sm text-slate-500">%</span>
              </span>
            </label>
          )}
        </div>
      </Section>

      {/* 3 + 4. Provinces */}
      {draft.mode === 'Provincial' && (
        <>
          <Section icon={<MapPin className="w-4 h-4 text-teal-600" />} title="Outlets" hint="The province each outlet sells in. Its sales are taxed at that province's rates below.">
            {setup.outlets.length === 0 ? (
              <p className="text-xs text-slate-500">No selling outlets yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="py-2 pr-3">Outlet</th>
                      <th className="py-2 pr-3">Province</th>
                      <th className="py-2 text-right">Cash / card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {setup.outlets.map(o => {
                      const code = draft.outletRegions[o.id] ?? '';
                      const rates = code ? draft.regionRates[code] : null;
                      return (
                        <tr key={o.id}>
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold text-slate-900">{o.name}</div>
                            {o.code && <div className="text-[10px] font-mono text-slate-400">{o.code}</div>}
                          </td>
                          <td className="py-2.5 pr-3">
                            <select value={code} disabled={!canEdit}
                              onChange={(e) => update({ outletRegions: { ...draft.outletRegions, [o.id]: e.target.value } })}
                              className={inputCls + ' max-w-xs'}>
                              <option value="">— No province —</option>
                              {setup.regions.map(r => <option key={r.regionCode} value={r.regionCode}>{r.authorityName} ({r.regionCode})</option>)}
                            </select>
                          </td>
                          <td className="py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">
                            {rates ? `${rates.cash}% / ${rates.card}%` : <span className="text-slate-400 font-sans text-xs">{draft.standardRate}% / {draft.cardRate}% (default)</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={<Landmark className="w-4 h-4 text-teal-600" />} title="Province rates"
            hint="Your own rates for each province. Changing them affects only your business; 'Default' puts a province back on Cashly's rate.">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Province</th>
                    <th className="py-2 pr-3 text-right">Cash %</th>
                    <th className="py-2 pr-3 text-right">Card %</th>
                    <th className="py-2 text-right">Cashly default</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {setup.regions.map(r => {
                    const rates = draft.regionRates[r.regionCode];
                    const own = num(rates.cash) !== r.defaultCashRate || num(rates.card) !== r.defaultCardRate;
                    const used = Object.values(draft.outletRegions).includes(r.regionCode);
                    return (
                      <tr key={r.regionCode} className={used ? 'bg-teal-50/40' : ''}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-slate-900">{r.authorityName}</div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {r.regionCode}{used && <span className="ml-1.5 font-sans font-bold text-teal-700">· your outlets</span>}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <input type="number" min="0" max="100" step="0.5" value={rates.cash} disabled={!canEdit}
                            onChange={(e) => update({ regionRates: { ...draft.regionRates, [r.regionCode]: { ...rates, cash: e.target.value } } })}
                            className={rateCls} aria-label={`${r.authorityName} cash rate`} />
                        </td>
                        <td className="py-2.5 pr-3 text-right">
                          <input type="number" min="0" max="100" step="0.5" value={rates.card} disabled={!canEdit}
                            onChange={(e) => update({ regionRates: { ...draft.regionRates, [r.regionCode]: { ...rates, card: e.target.value } } })}
                            className={rateCls} aria-label={`${r.authorityName} card rate`} />
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <span className="text-xs text-slate-500 font-mono">{fmt(r.defaultCashRate)} / {fmt(r.defaultCardRate)}</span>
                          {own && canEdit && (
                            <button type="button"
                              onClick={() => update({ regionRates: { ...draft.regionRates, [r.regionCode]: { cash: String(r.defaultCashRate), card: String(r.defaultCardRate) } } })}
                              className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:underline">
                              <RotateCcw className="w-3 h-3" /> Default
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      {/* 5. Items taxed differently (applies at once) */}
      <ItemsTaxedDifferently canEdit={canEdit} />

      {/* 6. Registration */}
      <Section icon={<Building2 className="w-4 h-4 text-teal-600" />} title="Registration on receipts"
        hint="Your tax numbers, printed at the top of every receipt.">
        <div className="space-y-3">
          {setup.companies.map(c => {
            const numbers = draft.companies[c.id];
            return (
              <div key={c.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Company</div>
                  <div className="px-3 py-2 rounded-xl bg-slate-100 text-sm font-semibold text-slate-800 truncate">
                    {c.legalName}{c.isDefault && setup.companies.length > 1 && <span className="ml-1.5 text-[10px] text-slate-500 font-normal">(main)</span>}
                  </div>
                </div>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-600 mb-1">NTN</span>
                  <input type="text" value={numbers.ntn} disabled={!canEdit} placeholder="e.g. 1234567-8"
                    onChange={(e) => update({ companies: { ...draft.companies, [c.id]: { ...numbers, ntn: e.target.value } } })}
                    className={inputCls} />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-600 mb-1">STRN</span>
                  <input type="text" value={numbers.strn} disabled={!canEdit} placeholder="Sales tax registration no."
                    onChange={(e) => update({ companies: { ...draft.companies, [c.id]: { ...numbers, strn: e.target.value } } })}
                    className={inputCls} />
                </label>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Reporting sales to the tax authority, per shop */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6">
        <FiscalInvoicingSection canEdit={canEdit} />
      </section>

      {/* Save bar: shown while there are unsaved changes, and after a save to say how it went. */}
      {canEdit && (dirty || message) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,640px)]">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl">
            <span className={`flex-1 text-xs ${message && !message.ok ? 'text-rose-300' : problem && dirty ? 'text-amber-300' : 'text-slate-200'}`}>
              {message ? message.text : problem ?? 'You have unsaved changes.'}
            </span>
            {dirty && (
              <>
                <button type="button" onClick={() => { setDraft(toDraft(setup)); setMessage(null); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white">
                  Discard
                </button>
                <button type="button" onClick={save} disabled={!!problem || saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition">
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save tax setup'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

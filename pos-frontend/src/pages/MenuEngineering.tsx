import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp,
  RefreshCw,
  ArrowUpDown,
  AlertTriangle,
  Download
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { MenuEngineeringRow, MenuClassification } from '../types';

type SortKey = 'unitsSold' | 'revenuePKR' | 'grossProfitPKR' | 'marginPercent' | 'name';

/**
 * Classic menu-engineering quadrants:
 *  Star      — high margin, high volume (protect and feature)
 *  PlowHorse — low margin, high volume (re-cost or re-price)
 *  Puzzle    — high margin, low volume (promote harder)
 *  Dog       — low margin, low volume (candidate for removal)
 */
const CLASSIFICATION_STYLES: Record<MenuClassification, { badge: string; label: string; blurb: string }> = {
  Star: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Star',
    blurb: 'High margin, high volume — feature these.'
  },
  PlowHorse: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    label: 'Plow Horse',
    blurb: 'Popular but thin margin — re-cost or re-price.'
  },
  Puzzle: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    label: 'Puzzle',
    blurb: 'Profitable but slow — promote harder.'
  },
  Dog: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    label: 'Dog',
    blurb: 'Low margin, low volume — consider removing.'
  }
};

function classificationStyle(value?: string) {
  return CLASSIFICATION_STYLES[(value as MenuClassification)] ?? {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    label: value || 'Unclassified',
    blurb: ''
  };
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** The API may return a bare array or `{ items, slowMovers }` — accept both. */
function normalizeReport(raw: any): { items: MenuEngineeringRow[]; slowMovers: MenuEngineeringRow[] } {
  if (Array.isArray(raw)) return { items: raw, slowMovers: [] };
  return {
    items: Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.products) ? raw.products : [],
    slowMovers: Array.isArray(raw?.slowMovers) ? raw.slowMovers : []
  };
}

export const MenuEngineering: React.FC = () => {
  const { selectedBranch } = usePosStore();

  const [items, setItems] = useState<MenuEngineeringRow[]>([]);
  const [slowMovers, setSlowMovers] = useState<MenuEngineeringRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(daysAgoISO(0));
  const [sortKey, setSortKey] = useState<SortKey>('grossProfitPKR');
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await posApi.getMenuEngineering({ branchId: selectedBranch?.id, from, to });
      const normalized = normalizeReport(raw);
      setItems(normalized.items);
      setSlowMovers(normalized.slowMovers);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load menu engineering data'));
      setItems([]);
      setSlowMovers([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch?.id, from, to]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sortKey === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      const av = Number(a[sortKey]) || 0;
      const bv = Number(b[sortKey]) || 0;
      return sortAsc ? av - bv : bv - av;
    });
    return copy;
  }, [items, sortKey, sortAsc]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { Star: 0, PlowHorse: 0, Puzzle: 0, Dog: 0 };
    items.forEach(i => { if (base[i.classification] != null) base[i.classification]++; });
    return base;
  }, [items]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Matches the existing client-side CSV convention used in Reports.
  const handleExportCsv = () => {
    if (sorted.length === 0) return;
    const headers = ['Product,UnitsSold,RevenuePKR,CostPKR,GrossProfitPKR,MarginPercent,Classification'];
    const rows = sorted.map(r =>
      `"${r.name}",${r.unitsSold ?? 0},${r.revenuePKR ?? 0},${r.costPKR ?? 0},${r.grossProfitPKR ?? 0},${r.marginPercent ?? 0},${r.classification}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `Menu_Engineering_${selectedBranch?.name || 'Store'}_${from}_to_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sortHeader = (key: SortKey, label: string, alignRight = false) => (
    <th className={`px-4 py-2.5 ${alignRight ? 'text-right' : ''}`}>
      <button
        onClick={() => toggleSort(key)}
        className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider transition ${
          sortKey === key ? 'text-teal-600' : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        <span>{label}</span>
        <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <TrendingUp className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Menu Engineering</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Profitability vs popularity for {selectedBranch?.name || 'this branch'}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
            />
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <Download className="w-3.5 h-3.5 text-teal-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(CLASSIFICATION_STYLES) as MenuClassification[]).map(key => {
          const style = CLASSIFICATION_STYLES[key];
          return (
            <div key={key} className="bg-white border border-slate-200 rounded-2xl p-4">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${style.badge}`}>
                {style.label}
              </span>
              <p className="text-xl font-black text-slate-900 mt-2">{counts[key]}</p>
              <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{style.blurb}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {sortHeader('name', 'Product')}
                {sortHeader('unitsSold', 'Units Sold', true)}
                {sortHeader('revenuePKR', 'Revenue', true)}
                <th className="px-4 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Cost</th>
                {sortHeader('grossProfitPKR', 'Gross Profit', true)}
                {sortHeader('marginPercent', 'Margin', true)}
                <th className="px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Class</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">Crunching menu numbers…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">No sales data for this period.</td></tr>
              ) : sorted.map(row => {
                const style = classificationStyle(row.classification);
                return (
                  <tr key={row.productId} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-900">{row.name}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-600">{(row.unitsSold ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-600">{(row.revenuePKR ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-500">{(row.costPKR ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">{(row.grossProfitPKR ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-teal-600">
                      {(row.marginPercent ?? 0).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${style.badge}`}>
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Slow Movers</span>
        </div>
        {slowMovers.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">
            {loading ? 'Loading…' : 'No slow movers flagged for this period.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">Units Sold</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                  <th className="px-4 py-2.5 text-right">Margin</th>
                  <th className="px-4 py-2.5">Class</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slowMovers.map(row => {
                  const style = classificationStyle(row.classification);
                  return (
                    <tr key={`slow-${row.productId}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">{row.name}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">{(row.unitsSold ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">{(row.revenuePKR ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">{(row.marginPercent ?? 0).toFixed(1)}%</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${style.badge}`}>
                          {style.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

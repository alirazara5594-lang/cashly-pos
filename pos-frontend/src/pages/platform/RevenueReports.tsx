import React, { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, Users, MapPin, Layers } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { pkr } from '../../utils/renewals';
import { tierLabel } from '../../utils/tierLabel';
import type { RevenueReport } from '../../types';

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString([], { month: 'short', year: '2-digit' });

/**
 * How the platform is doing over time: money collected each month, recurring revenue, businesses
 * won and lost, where the money comes from, and how many trials became paying customers.
 */
export const RevenueReports: React.FC = () => {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getRevenueReport(months)
      .then(res => { if (!cancelled) { setData(res); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load the report.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [months]);

  if (!data) {
    return error
      ? <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>
      : <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 text-slate-400 animate-spin" /></div>;
  }

  const maxBar = Math.max(1, ...data.months.map(m => Math.max(m.collectedPKR, m.recurringPKR)));
  const last = data.months[data.months.length - 1];
  const totalCollected = data.months.reduce((s, m) => s + m.collectedPKR, 0);
  const won = data.months.reduce((s, m) => s + m.newBusinesses, 0);
  const lost = data.months.reduce((s, m) => s + m.lostBusinesses, 0);
  const conversion = data.trialCohort > 0 ? Math.round((data.trialConverted / data.trialCohort) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {[6, 12, 24].map(n => (
          <button key={n} onClick={() => { setMonths(n); setLoading(true); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${months === n ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {n} months
          </button>
        ))}
        {loading && <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] font-bold uppercase text-slate-500">Recurring revenue now</div>
          <div className="text-xl font-black text-teal-700">{pkr(last?.recurringPKR)}</div>
          <div className="text-[10px] text-slate-400">a month, from everything installed</div>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] font-bold uppercase text-slate-500">Collected in {months} months</div>
          <div className="text-xl font-black">{pkr(totalCollected)}</div>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] font-bold uppercase text-slate-500">Businesses won / lost</div>
          <div className="text-xl font-black"><span className="text-teal-700">+{won}</span> <span className="text-rose-600">−{lost}</span></div>
          <div className="text-[10px] text-slate-400">{last?.businessesAtEnd ?? 0} open now · average {pkr(data.averageMonthlyPKR)} a month each</div>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] font-bold uppercase text-slate-500">Trials that became paying</div>
          <div className="text-xl font-black">{conversion == null ? '—' : `${conversion}%`}</div>
          <div className="text-[10px] text-slate-400">{data.trialConverted} of {data.trialCohort} that started 1–12 months ago</div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-teal-600" /> Month by month</h2>
        <div className="flex items-end gap-2 h-44 border-b border-slate-200 pb-1">
          {data.months.map(m => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${monthName(m.month)}: collected ${pkr(m.collectedPKR)}, recurring ${pkr(m.recurringPKR)}`}>
              <div className="w-full flex items-end gap-0.5 h-40">
                <div className="flex-1 bg-teal-500 rounded-t" style={{ height: `${(m.collectedPKR / maxBar) * 100}%` }} />
                <div className="flex-1 bg-sky-300 rounded-t" style={{ height: `${(m.recurringPKR / maxBar) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {data.months.map(m => <div key={m.month} className="flex-1 text-center text-[9px] text-slate-500 truncate">{monthName(m.month)}</div>)}
        </div>
        <div className="flex gap-4 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-teal-500" /> Collected</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-300" /> Recurring revenue (installed parts, today's prices)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500 font-bold">
              <tr className="border-b border-slate-200">
                <th className="py-2 text-left">Month</th>
                <th className="py-2 text-right">Collected</th>
                <th className="py-2 text-right">Invoiced</th>
                <th className="py-2 text-right">Recurring</th>
                <th className="py-2 text-right">New</th>
                <th className="py-2 text-right">Lost</th>
                <th className="py-2 text-right">Open at end</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...data.months].reverse().map(m => (
                <tr key={m.month}>
                  <td className="py-2 font-semibold">{monthName(m.month)}</td>
                  <td className="py-2 text-right font-mono text-teal-700">{pkr(m.collectedPKR)}</td>
                  <td className="py-2 text-right font-mono">{pkr(m.invoicedPKR)}</td>
                  <td className="py-2 text-right font-mono">{pkr(m.recurringPKR)}</td>
                  <td className="py-2 text-right">{m.newBusinesses}</td>
                  <td className={`py-2 text-right ${m.lostBusinesses > 0 ? 'text-rose-600 font-bold' : ''}`}>{m.lostBusinesses}</td>
                  <td className="py-2 text-right">{m.businessesAtEnd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-5">
        {([['By version', Layers, data.byPlan, true], ['By city', MapPin, data.byCity, false]] as const).map(([title, Icon, rows, isPlan]) => {
          const max = Math.max(1, ...rows.map(r => r.monthlyPKR));
          return (
            <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><Icon className="w-4 h-4 text-teal-600" /> {title}</h2>
              {rows.length === 0 && <p className="text-xs text-slate-500">No businesses yet.</p>}
              {rows.map(r => (
                <div key={r.label} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="font-bold text-slate-700">{isPlan ? tierLabel(r.label) : r.label}</span>
                    <span className="text-slate-500 flex items-center gap-2"><Users className="w-3 h-3" />{r.businesses} · <span className="font-mono">{pkr(r.monthlyPKR)}/mo</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${(r.monthlyPKR / max) * 100}%` }} /></div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
};

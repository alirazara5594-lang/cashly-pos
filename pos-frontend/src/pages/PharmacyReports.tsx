import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BookLock, Building2, CalendarClock, FileText, PackageX, Printer, TrendingDown, Undo2, Trash2, X
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import { expiryChip, today } from '../utils/expiry';
import { formatPacked } from '../utils/medicine';
import { formatCnic } from '../utils/prescription';
import type { ExpiryReportRow } from '../types';

type Tab = 'expiry' | 'removals' | 'prescriptions' | 'slow' | 'margin';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'expiry', label: 'Expiry', icon: CalendarClock },
  { key: 'removals', label: 'Returned & written off', icon: PackageX },
  { key: 'prescriptions', label: 'Prescription sales', icon: FileText },
  { key: 'slow', label: 'Slow movers', icon: TrendingDown },
  { key: 'margin', label: 'Margin by company', icon: Building2 }
];

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};

const day = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const medicineName = (r: { productName: string; strength: string | null }) => [r.productName, r.strength].filter(Boolean).join(' ');

/**
 * Loads a report for `key`, and again whenever the key changes. Nothing is set while the effect runs,
 * only when the server answers, so a slow answer for an old key never overwrites a newer one.
 */
function useReport<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    load()
      .then(data => { if (!cancelled) setState({ key, data }); })
      .catch(err => { if (!cancelled) setState({ key, error: getApiErrorMessage(err, 'Could not load this report.') }); });
    return () => { cancelled = true; };
    // `key` names everything `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state?.key === key ? state : undefined;
  return { data: current?.data, error: current?.error, loading: !current };
}

/** A report's box: its controls (not printed), and the part that prints. */
const ReportFrame: React.FC<{
  title: string;
  subtitle?: string;
  controls?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, controls, error, children }) => {
  const { selectedTenant, selectedBranch } = usePosStore();
  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-end justify-end gap-2">
        {controls}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
        >
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </div>
      {error && (
        <div role="alert" className="no-print px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">{error}</div>
      )}
      <div className="print-area bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {selectedTenant?.name}{selectedBranch?.name ? ` · ${selectedBranch.name}` : ''}
          </div>
          <div className="text-base font-bold text-slate-900 mt-0.5">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        <div className="overflow-x-auto">{children}</div>
      </div>
    </div>
  );
};

const DayRange: React.FC<{ from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }> = ({ from, to, onFrom, onTo }) => (
  <>
    <div>
      <label htmlFor="report-from" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
      <input id="report-from" type="date" value={from} max={to} onChange={(e) => e.target.value && onFrom(e.target.value)}
        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
    </div>
    <div>
      <label htmlFor="report-to" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
      <input id="report-to" type="date" value={to} min={from} max={today()} onChange={(e) => e.target.value && onTo(e.target.value)}
        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
    </div>
  </>
);

const Choice: React.FC<{ label: string; value: number; options: number[]; suffix: string; onChange: (v: number) => void }> = ({ label, value, options, suffix, onChange }) => (
  <div>
    <div className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-slate-200 bg-white overflow-hidden">
      {options.map(o => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={`px-3 py-2 text-xs font-bold transition ${o === value ? 'bg-teal-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          {o} {suffix}
        </button>
      ))}
    </div>
  </div>
);

const Empty: React.FC<{ cols: number; loading: boolean; text: string }> = ({ cols, loading, text }) => (
  <tr><td colSpan={cols} className="px-4 py-8 text-center text-xs text-slate-400">{loading ? 'Loading…' : text}</td></tr>
);

const th = 'px-3 py-2.5';
const thead = 'bg-slate-50 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-500';

// ── Expiry ────────────────────────────────────────────────────────────────

/** Sending a batch back to its distributor, or writing it off. */
const RemoveDialog: React.FC<{
  row: ExpiryReportRow;
  kind: 'Return' | 'WriteOff';
  onDone: (message: string) => void;
  onClose: () => void;
}> = ({ row, kind, onDone, onClose }) => {
  const toSupplier = kind === 'Return';
  const [quantity, setQuantity] = useState(row.quantity);
  const [supplier, setSupplier] = useState(row.supplierName ?? '');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState(row.daysToExpiry < 0 ? 'Expired' : toSupplier ? 'Near expiry' : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit = (row.looseUnitName ?? 'unit').toLowerCase();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await posApi.removeBatchStock(row.batchId, {
        kind, quantity,
        supplierName: supplier.trim() || undefined,
        reference: reference.trim() || undefined,
        reason: reason.trim() || undefined
      });
      onDone(res.message);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not record it.'));
      setSaving(false);
    }
  };

  const field = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none';
  return (
    <div className="no-print fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={toSupplier ? 'Return to distributor' : 'Write off'} className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <div className={`flex items-center gap-2 font-bold text-sm ${toSupplier ? 'text-teal-600' : 'text-rose-600'}`}>
              {toSupplier ? <Undo2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
              {toSupplier ? 'Return to distributor' : 'Write off'}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {medicineName(row)} · batch <span className="font-mono">{row.batchNumber}</span> · exp {day(row.expiryDate)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="remove-qty" className="block text-xs font-semibold text-slate-500 mb-1">
              {row.packUnits ? `How many ${unit}s` : 'How many'} <span className="font-normal text-slate-400">(this batch holds {formatPacked(row.quantity, row.packUnits, row.looseUnitName)})</span>
            </label>
            <input id="remove-qty" type="number" min="0" max={row.quantity} step="any" value={quantity || ''}
              onChange={(e) => setQuantity(Number(e.target.value))} className={field} />
            {row.packUnits && quantity > 0 && <p className="text-[11px] text-slate-500 mt-1">= {formatPacked(quantity, row.packUnits, row.looseUnitName)}</p>}
          </div>
          {toSupplier && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="remove-supplier" className="block text-xs font-semibold text-slate-500 mb-1">Distributor <span className="text-rose-500">*</span></label>
                <input id="remove-supplier" type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="remove-ref" className="block text-xs font-semibold text-slate-500 mb-1">Credit note / slip</label>
                <input id="remove-ref" type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className={field} />
              </div>
            </div>
          )}
          <div>
            <label htmlFor="remove-reason" className="block text-xs font-semibold text-slate-500 mb-1">
              Reason{!toSupplier && <span className="text-rose-500"> *</span>}
            </label>
            <input id="remove-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={toSupplier ? 'e.g. Near expiry' : 'e.g. Expired, damaged'} className={field} />
          </div>
          <p className="text-[11px] text-slate-500">
            It leaves the stock count from this batch, at its cost. The books and the distributor's balance are not changed.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 space-y-2">
          {error && (
            <div role="alert" className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition">Cancel</button>
            <button
              onClick={submit}
              disabled={saving || !(quantity > 0) || quantity > row.quantity}
              className={`px-5 py-2 rounded-xl text-white text-xs font-bold transition disabled:opacity-50 ${toSupplier ? 'bg-teal-500 hover:bg-teal-600' : 'bg-rose-500 hover:bg-rose-600'}`}
            >
              {saving ? 'Saving…' : toSupplier ? 'Return' : 'Write off'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExpiryReport: React.FC<{ branchId: string; canRemove: boolean }> = ({ branchId, canRemove }) => {
  const [days, setDays] = useState(90);
  const [version, setVersion] = useState(0);
  const [removing, setRemoving] = useState<{ row: ExpiryReportRow; kind: 'Return' | 'WriteOff' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { data, error, loading } = useReport(`${branchId}|${days}|${version}`, () => posApi.getExpiryReport(branchId, days));
  const rows = data ?? [];
  const value = (list: ExpiryReportRow[]) => list.reduce((n, r) => n + r.costValuePKR, 0);
  const expired = rows.filter(r => r.daysToExpiry < 0);
  const soon = rows.filter(r => r.daysToExpiry >= 0 && r.daysToExpiry <= 30);
  const later = rows.filter(r => r.daysToExpiry > 30);

  return (
    <ReportFrame
      title={`Expired and expiring within ${days} days`}
      subtitle={`Expired ${money(value(expired))} · within 30 days ${money(value(soon))} · later ${money(value(later))} — at cost`}
      error={error}
      controls={<Choice label="Expiring within" value={days} options={[30, 60, 90, 180]} suffix="days" onChange={setDays} />}
    >
      {notice && <div className="no-print px-4 py-2 text-xs font-semibold text-teal-700 bg-teal-50 border-b border-teal-100">{notice}</div>}
      <table className="w-full text-left text-xs">
        <thead className={thead}>
          <tr>
            <th className={th}>Medicine</th>
            <th className={th}>Batch</th>
            <th className={th}>Expiry</th>
            <th className={`${th} text-right`}>On hand</th>
            <th className={`${th} text-right`}>Cost value</th>
            <th className={`${th} text-right`}>Retail value</th>
            <th className={th}>Distributor</th>
            {canRemove && <th className={`${th} no-print`} />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <Empty cols={canRemove ? 8 : 7} loading={loading} text={`Nothing here expires within ${days} days.`} /> : rows.map(r => {
            const chip = expiryChip(r.daysToExpiry);
            return (
              <tr key={r.batchId} className={r.daysToExpiry < 0 ? 'bg-rose-50/50' : ''}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{medicineName(r)}</div>
                  {r.manufacturer && <div className="text-[10px] text-slate-500">{r.manufacturer}</div>}
                </td>
                <td className="px-3 py-2 font-mono font-semibold text-purple-700">{r.batchNumber || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="text-slate-700">{day(r.expiryDate)}</div>
                  {chip && <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatPacked(r.quantity, r.packUnits, r.looseUnitName)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.costValuePKR)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">{money(r.retailValuePKR)}</td>
                <td className="px-3 py-2 text-slate-600">{r.supplierName || '—'}</td>
                {canRemove && (
                  <td className="px-3 py-2 no-print whitespace-nowrap text-right">
                    <button onClick={() => { setNotice(null); setRemoving({ row: r, kind: 'Return' }); }}
                      className="px-2 py-1 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-[11px] font-bold hover:bg-teal-100 transition">
                      Return
                    </button>
                    <button onClick={() => { setNotice(null); setRemoving({ row: r, kind: 'WriteOff' }); }}
                      className="ml-1 px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[11px] font-bold hover:bg-rose-100 transition">
                      Write off
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {removing && (
        <RemoveDialog
          row={removing.row}
          kind={removing.kind}
          onClose={() => setRemoving(null)}
          onDone={(message) => {
            setRemoving(null);
            setNotice(`${medicineName(removing.row)}, batch ${removing.row.batchNumber}: ${message}`);
            setVersion(v => v + 1);
          }}
        />
      )}
    </ReportFrame>
  );
};

// ── Returned & written off ────────────────────────────────────────────────

const RemovalsReport: React.FC<{ branchId: string }> = ({ branchId }) => {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const { data, error, loading } = useReport(`${branchId}|${from}|${to}`, () => posApi.getStockRemovals(branchId, from, to));
  const rows = data?.rows ?? [];
  const total = (kind: string) => rows.filter(r => r.kind === kind).reduce((n, r) => n + r.valuePKR, 0);
  return (
    <ReportFrame
      title="Returned to distributors and written off"
      subtitle={`${day(from)} – ${day(to)} · returned ${money(total('Returned to distributor'))} · written off ${money(total('Written off'))} — at cost`}
      error={error}
      controls={<DayRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
    >
      <table className="w-full text-left text-xs">
        <thead className={thead}>
          <tr>
            <th className={th}>When</th>
            <th className={th}>What</th>
            <th className={th}>Medicine</th>
            <th className={th}>Batch</th>
            <th className={`${th} text-right`}>Quantity</th>
            <th className={`${th} text-right`}>Value</th>
            <th className={th}>Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <Empty cols={7} loading={loading} text="Nothing was returned or written off in these days." /> : rows.map(r => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{when(r.at)}</td>
              <td className="px-3 py-2">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${r.kind === 'Written off' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-teal-50 border-teal-200 text-teal-700'}`}>{r.kind}</span>
              </td>
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{medicineName(r)}</div>
                {r.manufacturer && <div className="text-[10px] text-slate-500">{r.manufacturer}</div>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-mono font-semibold text-purple-700">{r.batchNumber || '—'}</span>
                {r.expiryDate && <div className="text-[10px] text-slate-500">exp {day(r.expiryDate)}</div>}
              </td>
              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatPacked(r.quantity, r.packUnits, r.looseUnitName)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(r.valuePKR)}</td>
              <td className="px-3 py-2 text-slate-600">
                {r.notes}
                <div className="text-[10px] text-slate-400">by {r.by}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportFrame>
  );
};

// ── Prescription sales ────────────────────────────────────────────────────

const PrescriptionsReport: React.FC<{ branchId: string }> = ({ branchId }) => {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const { data, error, loading } = useReport(`${branchId}|${from}|${to}`, () => posApi.getPrescriptionSales(branchId, from, to));
  const rows = data?.rows ?? [];
  const live = rows.filter(r => !r.cancelled);
  return (
    <ReportFrame
      title="Sales on prescription"
      subtitle={`${day(from)} – ${day(to)} · ${live.length} prescription${live.length === 1 ? '' : 's'}, ${live.filter(r => r.controlled).length} with a controlled medicine · ${money(live.reduce((n, r) => n + r.totalPKR, 0))} sold`}
      error={error}
      controls={<DayRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
    >
      {(data?.doctors.length ?? 0) > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-1">Most prescriptions from</span>
          {data!.doctors.map(d => (
            <span key={d.doctorName} className="px-2 py-0.5 rounded-lg bg-slate-100 text-[11px] text-slate-700">
              {d.doctorName} <span className="font-bold">{d.prescriptions}</span>
            </span>
          ))}
        </div>
      )}
      <table className="w-full text-left text-xs">
        <thead className={thead}>
          <tr>
            <th className={th}>When</th>
            <th className={th}>Sale</th>
            <th className={th}>Patient</th>
            <th className={th}>Doctor</th>
            <th className={th}>Medicines</th>
            <th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <Empty cols={6} loading={loading} text="No sales on prescription in these days." /> : rows.map(r => (
            <tr key={r.prescriptionId} className={`align-top ${r.cancelled ? 'opacity-50 line-through' : ''}`}>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{when(r.at)}</td>
              <td className="px-3 py-2 font-mono text-slate-700">{r.orderNumber}{r.cancelled && <div className="text-[10px] font-sans no-underline">Voided</div>}</td>
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{r.patientName}</div>
                {r.patientCnic && <div className="text-[10px] font-mono text-slate-600">{formatCnic(r.patientCnic)}</div>}
                {r.patientPhone && <div className="text-[10px] text-slate-500">{r.patientPhone}</div>}
              </td>
              <td className="px-3 py-2">
                <div className="text-slate-900">{r.doctorName}</div>
                {r.doctorRegistrationNo && <div className="text-[10px] font-mono text-slate-600">Reg. {r.doctorRegistrationNo}</div>}
                <div className="text-[10px] text-slate-500">Rx {day(r.prescribedOn)}{r.hasPhoto ? ' · photo' : ''}</div>
              </td>
              <td className="px-3 py-2">
                {r.medicines.map((m, i) => (
                  <div key={i}>
                    {m.quantity} × {m.name}
                    {m.controlled && <span className="ml-1 text-[10px] font-bold text-rose-600">Controlled</span>}
                  </div>
                ))}
              </td>
              <td className="px-3 py-2 text-right font-mono">{money(r.totalPKR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportFrame>
  );
};

// ── Slow movers ───────────────────────────────────────────────────────────

const SlowMoversReport: React.FC<{ branchId: string }> = ({ branchId }) => {
  const [days, setDays] = useState(90);
  const { data, error, loading } = useReport(`${branchId}|${days}`, () => posApi.getSlowMovers(branchId, days));
  const rows = data?.rows ?? [];
  const never = rows.filter(r => r.unitsSold === 0);
  return (
    <ReportFrame
      title={`Slow movers — sales over the last ${days} days`}
      subtitle={`${never.length} item${never.length === 1 ? '' : 's'} in stock did not sell at all, holding ${money(never.reduce((n, r) => n + r.stockValuePKR, 0))} at cost`}
      error={error}
      controls={<Choice label="Over the last" value={days} options={[30, 90, 180, 365]} suffix="days" onChange={setDays} />}
    >
      <table className="w-full text-left text-xs">
        <thead className={thead}>
          <tr>
            <th className={th}>Medicine</th>
            <th className={`${th} text-right`}>On hand</th>
            <th className={`${th} text-right`}>Stock value</th>
            <th className={`${th} text-right`}>Sold</th>
            <th className={th}>Last sold</th>
            <th className={`${th} text-right`}>Lasts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <Empty cols={6} loading={loading} text="Nothing is in stock here." /> : rows.map(r => (
            <tr key={r.productId} className={r.unitsSold === 0 ? 'bg-amber-50/40' : ''}>
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{medicineName(r)}</div>
                {r.manufacturer && <div className="text-[10px] text-slate-500">{r.manufacturer}</div>}
              </td>
              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatPacked(r.quantityOnHand, r.packUnits, r.looseUnitName)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(r.stockValuePKR)}</td>
              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{r.unitsSold > 0 ? formatPacked(r.unitsSold, r.packUnits, r.looseUnitName) : '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                {r.lastSoldAt ? <>{day(r.lastSoldAt)} <span className="text-[10px] text-slate-400">({r.daysSinceLastSale} days ago)</span></> : 'Never'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-slate-600">
                {r.daysOfStock == null ? '—' : r.daysOfStock > 365 ? 'Over a year' : `${r.daysOfStock} days`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportFrame>
  );
};

// ── Margin by company ─────────────────────────────────────────────────────

const MarginReport: React.FC<{ branchId: string }> = ({ branchId }) => {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const { data, error, loading } = useReport(`${branchId}|${from}|${to}`, () => posApi.getMarginByCompany(branchId, from, to));
  const rows = data?.rows ?? [];
  const revenue = rows.reduce((n, r) => n + r.revenuePKR, 0);
  const cost = rows.reduce((n, r) => n + r.costPKR, 0);
  return (
    <ReportFrame
      title="Margin by company"
      subtitle={`${day(from)} – ${day(to)} · cost is what each sale took from stock at the time · before discounts and returns`}
      error={error}
      controls={<DayRange from={from} to={to} onFrom={setFrom} onTo={setTo} />}
    >
      <table className="w-full text-left text-xs">
        <thead className={thead}>
          <tr>
            <th className={th}>Company</th>
            <th className={`${th} text-right`}>Items sold</th>
            <th className={`${th} text-right`}>Sales</th>
            <th className={`${th} text-right`}>Cost</th>
            <th className={`${th} text-right`}>Profit</th>
            <th className={`${th} text-right`}>Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? <Empty cols={6} loading={loading} text="Nothing was sold in these days." /> : rows.map(r => (
            <tr key={r.company ?? '—'}>
              <td className="px-3 py-2 font-semibold text-slate-900">{r.company ?? <span className="font-normal italic text-slate-400">No company entered</span>}</td>
              <td className="px-3 py-2 text-right font-mono">{r.products}</td>
              <td className="px-3 py-2 text-right font-mono">{money(r.revenuePKR)}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-500">{money(r.costPKR)}</td>
              <td className={`px-3 py-2 text-right font-mono font-bold ${r.profitPKR < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(r.profitPKR)}</td>
              <td className="px-3 py-2 text-right font-mono">{r.marginPercent}%</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-slate-50 font-bold">
              <td className="px-3 py-2 text-slate-900">All companies</td>
              <td className="px-3 py-2 text-right font-mono">{rows.reduce((n, r) => n + r.products, 0)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(revenue)}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-500">{money(cost)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(revenue - cost)}</td>
              <td className="px-3 py-2 text-right font-mono">{revenue > 0 ? Math.round((revenue - cost) / revenue * 1000) / 10 : 0}%</td>
            </tr>
          )}
        </tbody>
      </table>
    </ReportFrame>
  );
};

// ── The page ──────────────────────────────────────────────────────────────

/**
 * A pharmacy's own reports, for the location it is on: what is expiring (and sending it back or writing
 * it off), what was returned and written off, sales on prescription, slow movers and margin by company.
 * The controlled-medicine register is its own page.
 */
export const PharmacyReports: React.FC = () => {
  const { selectedBranch, permissions } = usePosStore();
  const branchId = selectedBranch?.id;
  const [tab, setTab] = useState<Tab>('expiry');

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <CalendarClock className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Pharmacy Reports</h1>
            <p className="text-[11px] text-slate-500 mt-1">{selectedBranch?.name ?? 'Choose a location'}</p>
          </div>
        </div>
        <Link to="/controlled-register" className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition">
          <BookLock className="w-3.5 h-3.5" /> Controlled register
        </Link>
      </div>

      <div role="tablist" aria-label="Pharmacy reports" className="no-print flex gap-1 overflow-x-auto no-scrollbar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              tab === key ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' : 'bg-white border border-slate-200 text-slate-600 hover:bg-teal-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {!branchId ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">Choose a location to see its reports.</div>
      ) : tab === 'expiry' ? (
        <ExpiryReport key={branchId} branchId={branchId} canRemove={!!permissions?.canManageInventory} />
      ) : tab === 'removals' ? (
        <RemovalsReport key={branchId} branchId={branchId} />
      ) : tab === 'prescriptions' ? (
        <PrescriptionsReport key={branchId} branchId={branchId} />
      ) : tab === 'slow' ? (
        <SlowMoversReport key={branchId} branchId={branchId} />
      ) : (
        <MarginReport key={branchId} branchId={branchId} />
      )}
    </div>
  );
};

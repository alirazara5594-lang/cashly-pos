import React, { useEffect, useState } from 'react';
import { BookLock, Image as ImageIcon, Printer, X } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import { today } from '../utils/expiry';
import { formatPacked } from '../utils/medicine';
import { formatCnic } from '../utils/prescription';
import type { ControlledRegister as Register, Product } from '../types';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const day = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * The controlled-medicine register (Pos.Api /pharmacy/controlled-register): for one controlled
 * medicine at this location, every movement over the chosen days with its running balance — what
 * came in from which distributor and batch, and what went out to which patient on which doctor's
 * prescription. Built from the stock ledger, so it always agrees with the count. Printable.
 */
export const ControlledRegister: React.FC = () => {
  const { selectedTenant, selectedBranch } = usePosStore();
  const tenantId = selectedTenant?.id;
  const branchId = selectedBranch?.id;

  const [medicines, setMedicines] = useState<Product[] | null>(null);
  const [chosenId, setChosenId] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [result, setResult] = useState<{ key: string; data?: Register; error?: string } | null>(null);
  const [photo, setPhoto] = useState<{ url: string; patient: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Only controlled medicines have a register.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    posApi.getProducts({ tenantId, branchId })
      .then(list => { if (!cancelled) setMedicines(list.filter(p => p.schedule === 'Controlled').sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(() => { if (!cancelled) setMedicines([]); });
    return () => { cancelled = true; };
  }, [tenantId, branchId]);

  const productId = chosenId || medicines?.[0]?.id || '';
  const key = `${branchId}|${productId}|${from}|${to}`;
  const loading = !!branchId && !!productId && result?.key !== key;

  useEffect(() => {
    if (!branchId || !productId) return;
    let cancelled = false;
    const requestKey = `${branchId}|${productId}|${from}|${to}`;
    posApi.getControlledRegister({ branchId, productId, from, to })
      .then(data => { if (!cancelled) setResult({ key: requestKey, data }); })
      .catch(err => { if (!cancelled) setResult({ key: requestKey, error: getApiErrorMessage(err, 'Could not load the register.') }); });
    return () => { cancelled = true; };
  }, [branchId, productId, from, to]);

  const register = result?.key === key ? result.data : undefined;
  const error = result?.key === key ? result.error : undefined;
  const qty = (n: number) => (register ? formatPacked(n, register.packUnits, register.looseUnitName) : n.toLocaleString());

  const showPhoto = async (prescriptionId: string, patient: string) => {
    setPhotoError(null);
    try {
      const blob = await posApi.getPrescriptionPhoto(prescriptionId);
      setPhoto({ url: URL.createObjectURL(blob), patient });
    } catch (err) {
      setPhotoError(getApiErrorMessage(err, 'Could not open the photo.'));
    }
  };

  const closePhoto = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <BookLock className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Controlled Register</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Every receipt and sale of a controlled medicine at {selectedBranch?.name ?? 'this location'}, with the running balance.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="register-medicine" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Medicine</label>
            <select
              id="register-medicine"
              value={productId}
              onChange={(e) => setChosenId(e.target.value)}
              disabled={!medicines?.length}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 max-w-[16rem]"
            >
              {(medicines ?? []).map(m => (
                <option key={m.id} value={m.id}>{[m.name, m.strength].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="register-from" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
            <input id="register-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
          </div>
          <div>
            <label htmlFor="register-to" className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
            <input id="register-to" type="date" value={to} min={from} max={today()} onChange={(e) => e.target.value && setTo(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
          </div>
          <button
            onClick={() => window.print()}
            disabled={!register}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition disabled:opacity-40"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {medicines && medicines.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
          No medicine is marked controlled yet. Mark one <strong className="text-slate-700">Controlled</strong> in Medicines and its register appears here.
        </div>
      )}

      {(error || photoError) && (
        <div role="alert" className="no-print px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700">{error || photoError}</div>
      )}

      {productId && (
        <div className="print-area bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Controlled-medicine register · {selectedTenant?.name}{selectedBranch?.name ? ` · ${selectedBranch.name}` : ''}
              </div>
              <div className="text-base font-bold text-slate-900 mt-0.5">
                {register ? [register.productName, register.strength, register.dosageForm].filter(Boolean).join(' · ') : 'Loading…'}
              </div>
              {register && (
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {[register.genericName, register.manufacturer, register.drapRegistrationNo && `DRAP ${register.drapRegistrationNo}`].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            {register && (
              <div className="text-right text-[11px] text-slate-600">
                <div>{day(register.from)} – {day(register.to)}</div>
                <div className="mt-0.5">Opening <span className="font-bold text-slate-900">{qty(register.opening)}</span></div>
                <div>Closing <span className="font-bold text-slate-900">{qty(register.closing)}</span></div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2.5">When</th>
                  <th className="px-3 py-2.5">Entry</th>
                  <th className="px-3 py-2.5">Batch</th>
                  <th className="px-3 py-2.5">Patient / supplier</th>
                  <th className="px-3 py-2.5">Doctor</th>
                  <th className="px-3 py-2.5 text-right">In</th>
                  <th className="px-3 py-2.5 text-right">Out</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading the register…</td></tr>
                ) : !register ? null : register.rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Nothing moved in these days.</td></tr>
                ) : register.rows.map(row => {
                  const sale = row.kind === 'Sold' || row.kind === 'Returned by customer' || row.kind === 'Sale voided';
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{when(row.at)}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{row.kind}</div>
                        {row.reference && <div className="text-[10px] font-mono text-slate-500">{row.reference}</div>}
                        {!sale && row.notes && <div className="text-[10px] text-slate-500">{row.notes}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {row.batches.length === 0 ? <span className="text-slate-400">—</span> : row.batches.map(b => (
                          <div key={`${b.batchNumber}|${b.expiryDate}`} className="whitespace-nowrap">
                            <span className="font-mono font-semibold text-purple-700">{b.batchNumber || 'No number'}</span>
                            {b.expiryDate && <span className="text-[10px] text-slate-500"> exp {day(b.expiryDate)}</span>}
                            {row.batches.length > 1 && <span className="text-[10px] text-slate-500"> ({qty(b.quantity)})</span>}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        {row.patientName ? (
                          <>
                            <div className="font-semibold text-slate-900">{row.patientName}</div>
                            {row.patientCnic && <div className="text-[10px] font-mono text-slate-600">{formatCnic(row.patientCnic)}</div>}
                          </>
                        ) : row.supplierName ? (
                          <div className="text-slate-700">From {row.supplierName}</div>
                        ) : sale ? (
                          <span className="text-[10px] font-semibold text-rose-600">No prescription recorded</span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.doctorName ? (
                          <>
                            <div className="text-slate-900">{row.doctorName}</div>
                            {row.doctorRegistrationNo && <div className="text-[10px] font-mono text-slate-600">Reg. {row.doctorRegistrationNo}</div>}
                            {row.prescribedOn && <div className="text-[10px] text-slate-500">Rx {day(row.prescribedOn)}</div>}
                            {row.hasPhoto && row.prescriptionId && (
                              <button
                                onClick={() => showPhoto(row.prescriptionId!, row.patientName ?? '')}
                                className="no-print mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-teal-600 hover:underline"
                              >
                                <ImageIcon className="w-3 h-3" /> Photo
                              </button>
                            )}
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-teal-700">{row.quantityIn ? qty(row.quantityIn) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-rose-700">{row.quantityOut ? qty(row.quantityOut) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap font-bold text-slate-900">{qty(row.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {photo && (
        <div className="no-print fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={closePhoto}>
          <div role="dialog" aria-modal="true" aria-label={`Prescription for ${photo.patient}`} className="relative max-w-3xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img src={photo.url} alt={`Prescription for ${photo.patient}`} className="max-w-full max-h-[90vh] rounded-xl shadow-2xl bg-white" />
            <button onClick={closePhoto} aria-label="Close" className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-slate-700 hover:bg-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

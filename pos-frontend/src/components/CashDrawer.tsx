import { useEffect, useState } from 'react';
import { posApi, getApiErrorMessage } from '../services/api';
import { getStoredTerminal } from '../services/deviceLicense';
import { usePosStore } from '../store/posStore';

export function CashDrawer({ branchId }: { branchId: string }) {
  const user = usePosStore(s => s.currentUser);
  const terminal = getStoredTerminal();
  const terminalId = terminal?.branchId === branchId ? terminal.id : undefined;
  const [shown, setShown] = useState(false);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shown) return;
    let cancelled = false;
    void posApi.getCashShifts(branchId).then(shifts => {
      if (cancelled) return;
      setShiftId(shifts.find(s => !s.isClosed && (s.terminalId ?? undefined) === terminalId)?.id ?? null);
      setLoaded(true);
    }).catch(err => {
      if (!cancelled) setError(getApiErrorMessage(err, 'Could not read this drawer.'));
    });
    return () => { cancelled = true; };
  }, [shown, branchId, terminalId]);

  return (
    <>
      <button type="button" onClick={() => { setLoaded(false); setError(''); setAmount(''); setNotes(''); setShown(true); }}
        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
        Cash drawer
      </button>
      {shown && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <form aria-label="Cash drawer" className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5" onSubmit={async e => {
            e.preventDefault();
            if (!loaded || busy || !amount.trim()) return;
            setBusy(true); setError('');
            try {
              if (shiftId) await posApi.closeCashShift(shiftId, { actualCashCounted: Number(amount), notes: notes.trim() || undefined });
              else await posApi.openCashShift({ branchId, terminalId, terminalName: terminalId ? terminal!.name : 'Counter', cashierName: user?.fullName || 'Cashier', openingFloatPKR: Number(amount) });
              setShown(false);
            } catch (err) {
              setError(getApiErrorMessage(err, 'Could not save this drawer.'));
            } finally { setBusy(false); }
          }}>
            <h2 className="font-bold">{loaded ? (shiftId ? 'Close cash drawer' : 'Open cash drawer') : 'Cash drawer'}</h2>
            {loaded && (
              <>
                <label className="block text-sm">{shiftId ? 'Cash counted' : 'Opening float'}
                  <input type="number" min="0" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
                    className="mt-1 block w-full rounded-lg border px-3 py-2" />
                </label>
                {shiftId && <label className="block text-sm">Close note
                  <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 block w-full rounded-lg border px-3 py-2" />
                </label>}
              </>
            )}
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => setShown(false)}>Cancel</button>
              <button type="submit" disabled={!loaded || busy} className="rounded-lg bg-teal-700 px-3 py-2 text-white disabled:opacity-50">
                {shiftId ? 'Close drawer' : 'Open drawer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

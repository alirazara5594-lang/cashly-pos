import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, CheckCircle2, ArrowLeft, KeyRound } from 'lucide-react';
import { activate, type DeviceStatus } from '../services/deviceLicense';
import { getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { TerminalOperatingMode } from '../types';
import { tierLabel } from '../utils/tierLabel';

/** What the device opens as, from the kind of device the pairing code was made for. */
const modeFor = (terminalType?: string): TerminalOperatingMode =>
  terminalType === 'OrderTab' ? 'WaiterTab'
    : terminalType === 'KitchenDisplay' ? 'KitchenKDS'
    : terminalType === 'BackOffice' ? 'BackOfficeERP'
    : 'CounterPOS';

/**
 * Connecting a till, tablet, kitchen screen or office PC to its branch, from the sign-in screen.
 *
 * A manager makes a one-time pairing code (Settings → Branch Connections, or Locations → Connect a
 * till); it already says which branch and what kind of device. The device talks to the same
 * server as this website, so there is nothing else to enter.
 */
export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();
  const setTerminalMode = usePosStore(s => s.setTerminalMode);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<DeviceStatus | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await activate(code);
      setTerminalMode(modeFor(status.terminalType));
      setConnected(status);
    } catch (err) {
      setError(getApiErrorMessage(err, 'That pairing code did not work. Check it, or ask your manager for a new one — each code works once and expires after 15 minutes.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-purple-600 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-teal-500/25">
            C
          </div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            Cashly <span className="text-teal-600">POS</span>
          </h1>
        </div>

        {connected ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto" />
            <div>
              <h2 className="text-base font-black text-slate-900">This device is connected</h2>
              <p className="text-xs text-slate-600 mt-1">
                {connected.terminalName ? <><strong>{connected.terminalName}</strong> at </> : 'Connected to '}
                <strong>{connected.branchName ?? 'your branch'}</strong>
                {connected.posEdition && <> · POS version <strong>{tierLabel(connected.posEdition)}</strong></>}
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              Staff sign in here from now on, and every sale on this device goes to this branch.
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" /> Go to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold text-slate-900">Connect a till or tablet</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Ask your manager for a pairing code. They make it in <strong>Settings → Branch Connections</strong> or
              <strong> Locations → Connect a till</strong>; it already knows the branch and the kind of device.
            </p>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Pairing code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. RG-DT-8912"
                className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-lg tracking-widest font-mono font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{error}</div>
            )}

            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {busy ? 'Connecting…' : 'Connect this device'}
            </button>

            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

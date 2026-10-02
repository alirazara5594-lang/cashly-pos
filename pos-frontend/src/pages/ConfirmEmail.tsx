import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MailCheck, CheckCircle2, ArrowLeft } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';

/**
 * Where a "confirm your email" message lands (/confirm-email?token=…). Works signed in or not.
 *
 * Confirming takes a button press rather than happening as the page opens: mail scanners open
 * links before people do, and a link that confirms on opening would be used up by the scanner.
 */
export const ConfirmEmail: React.FC = () => {
  const navigate = useNavigate();
  const isSignedIn = usePosStore(s => !!s.currentUser && !!s.token);
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await posApi.confirmEmail(token);
      setConfirmedEmail(res.email ?? '');
    } catch (err) {
      setError(getApiErrorMessage(err, 'This link has expired or was already used. Sign in and ask for a new one from Getting started.'));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => navigate('/', { replace: true });

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

        {confirmedEmail !== null ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto" />
            <h2 className="text-base font-black text-slate-900">Your email is confirmed</h2>
            {confirmedEmail && <p className="text-xs text-slate-500">{confirmedEmail}</p>}
            <button
              type="button"
              onClick={leave}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition"
            >
              {isSignedIn ? 'Continue' : 'Go to Sign In'}
            </button>
          </div>
        ) : !token ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-3 text-center">
            <p className="text-sm text-slate-700">This link is not complete. Open the link from the email again, or ask for a new one.</p>
            <button type="button" onClick={leave} className="text-xs font-bold text-teal-700">
              {isSignedIn ? 'Back to Cashly' : 'Back to sign in'}
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4 text-center">
            <MailCheck className="w-10 h-10 text-teal-600 mx-auto" />
            <h2 className="text-base font-black text-slate-900">Confirm your email</h2>
            <p className="text-xs text-slate-500">One click and your Cashly account email is confirmed.</p>
            {error && <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold text-left">{error}</div>}
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {busy ? 'Confirming…' : 'Confirm my email'}
            </button>
            <button type="button" onClick={leave}
              className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> {isSignedIn ? 'Back to Cashly' : 'Back to sign in'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

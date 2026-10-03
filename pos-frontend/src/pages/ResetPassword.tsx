import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';

const inputClass = 'w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';

/**
 * Where a "forgot password" email lands (/reset-password?token=…). The link works once, for 30
 * minutes; setting the password signs the account out everywhere else.
 */
export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const problem =
    password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)
      ? 'At least 8 characters, with letters and numbers.'
      : password !== confirm ? 'The two passwords do not match.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await posApi.resetPassword(token, password);
      if (res.email) {
        try { localStorage.setItem('cashly_login_email', res.email); } catch { /* optional */ }
      }
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'This link has expired or was already used. Ask for a new one from the sign-in screen.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-700 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-teal-700/25">
            C
          </div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">
            Cashly <span className="text-teal-600">POS</span>
          </h1>
        </div>

        {done ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto" />
            <h2 className="text-base font-black text-slate-900">Your new password is set</h2>
            <p className="text-xs text-slate-500">You were signed out on your other devices. Sign in with the new password now.</p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm transition"
            >
              Go to Sign In
            </button>
          </div>
        ) : !token ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-3 text-center">
            <p className="text-sm text-slate-700">This link is not complete. Open the link from the email again, or ask for a new one.</p>
            <button type="button" onClick={() => navigate('/', { replace: true })} className="text-xs font-bold text-teal-700">
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold text-slate-900">Set a new password</span>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">New password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  autoFocus
                  autoComplete="new-password"
                  placeholder="8+ characters, letters and numbers"
                  className={`${inputClass} pr-10`}
                />
                <button type="button" onClick={() => setShow(v => !v)} title={show ? 'Hide' : 'Show'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Type it again</label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            {password && problem && <p className="text-[11px] text-slate-500">{problem}</p>}
            {error && <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{error}</div>}
            <button
              type="submit"
              disabled={busy || !!problem}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {busy ? 'Saving…' : 'Set new password'}
            </button>
            <button type="button" onClick={() => navigate('/', { replace: true })}
              className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

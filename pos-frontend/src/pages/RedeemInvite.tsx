import React, { useState } from 'react';
import { KeyRound, CheckCircle2, ArrowRight } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { restaurantSignInLink } from '../services/restaurantAddress';

const inputCls = 'w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';
const labelCls = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

/**
 * Where a business set up by Cashly gets its owner: the invite link Cashly sent opens here, and the
 * owner chooses the username and PIN only they will ever know. Reachable signed out.
 */
export const RedeemInvite: React.FC = () => {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ tenantSlug: string; username: string } | null>(null);

  const problem = !code.trim() ? 'Paste the invite code from your link.'
    : username.trim().length < 3 ? 'Choose a username of at least 3 letters.'
    : !/^\d{4,6}$/.test(pin) ? 'Your PIN is 4 to 6 numbers.'
    : pin !== pinAgain ? 'The two PINs do not match.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await posApi.redeemOwnerInvite({ inviteToken: code.trim(), username: username.trim(), pin, fullName: fullName.trim() || undefined });
      setDone({ tenantSlug: res.tenantSlug, username: res.username });
    } catch (err) {
      setError(getApiErrorMessage(err, 'This invite did not work. Ask Cashly for a new one.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-700 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-teal-700/25">C</div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">Welcome to Cashly <span className="text-teal-600">POS</span></h1>
          <p className="text-xs text-slate-500">Set up your owner account. Only you will know your PIN.</p>
        </div>

        {done ? (
          <div className="bg-white border border-teal-200 rounded-2xl shadow-xl p-6 space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-teal-600 mx-auto" />
            <p className="text-sm font-bold text-slate-900">Your account is ready.</p>
            <p className="text-xs text-slate-600">Sign in with username <strong>{done.username}</strong> and your PIN at your business's own address:</p>
            <a href={restaurantSignInLink(done.tenantSlug)} className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-sm flex items-center justify-center gap-2">
              Go to sign in <ArrowRight className="w-4 h-4" />
            </a>
            <p className="text-[11px] text-slate-400 break-all">{restaurantSignInLink(done.tenantSlug).replace(/^https?:\/\//, '')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-teal-600" /><span className="text-xs font-bold text-slate-900">Your owner account</span></div>
            {!new URLSearchParams(window.location.search).get('code') && (
              <div><label className={labelCls}>Invite code</label><input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-mono text-xs`} /></div>
            )}
            <div><label className={labelCls}>Your name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={inputCls} /></div>
            <div><label className={labelCls}>Username</label><input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))} autoComplete="username" placeholder="e.g. ali" className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>PIN</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-[0.4em] font-mono`} /></div>
              <div><label className={labelCls}>PIN again</label><input type="password" inputMode="numeric" maxLength={6} value={pinAgain} onChange={(e) => setPinAgain(e.target.value.replace(/\D/g, ''))} className={`${inputCls} text-center tracking-[0.4em] font-mono`} /></div>
            </div>
            {(error || (problem && (username || pin))) && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{error || problem}</div>
            )}
            <button type="submit" disabled={busy || !!problem}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-sm">
              {busy ? 'Setting up…' : 'Create my account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, X, KeyRound, Smartphone, Copy, Check } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { AccountSecurity } from '../types';

const inputClass = 'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';
const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

type TwoFactorStep =
  | { kind: 'idle' }
  | { kind: 'scan'; secret: string; qr: string | null }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'confirm'; action: 'disable' | 'renew' };

/**
 * The signed-in person's own sign-in settings: their back-office password, and 2-step sign-in
 * with an authenticator app. Staff at a till only ever use their PIN; this is for the back office.
 */
export const AccountSecurityModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [info, setInfo] = useState<AccountSecurity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [step, setStep] = useState<TwoFactorStep>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [tfBusy, setTfBusy] = useState(false);
  const [tfError, setTfError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    posApi.getMySecurity()
      .then(res => { if (!cancelled) setInfo(res); })
      .catch(err => { if (!cancelled) setLoadError(getApiErrorMessage(err, 'Could not load your sign-in settings.')); });
    return () => { cancelled = true; };
  }, []);

  const reload = async () => setInfo(await posApi.getMySecurity());

  const passwordProblem =
    next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next) ? 'At least 8 characters, with letters and numbers.'
      : next !== confirm ? 'The two new passwords do not match.' : null;

  const changePassword = async () => {
    if (passwordProblem || pwBusy) return;
    setPwBusy(true);
    setPwMessage(null);
    try {
      const res = await posApi.changeMyPassword(current, next);
      setPwMessage({
        ok: true,
        text: res.signedOutSessions > 0 ? `Password changed. ${res.signedOutSessions} other device(s) were signed out.` : 'Password changed.'
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      await reload();
    } catch (err) {
      setPwMessage({ ok: false, text: getApiErrorMessage(err, 'Could not change the password.') });
    } finally {
      setPwBusy(false);
    }
  };

  const startSetup = async () => {
    setTfBusy(true);
    setTfError(null);
    setCode('');
    try {
      const res = await posApi.setupTwoFactor();
      const qr = await QRCode.toDataURL(res.otpauthUri, { width: 200, margin: 1 }).catch(() => null);
      setStep({ kind: 'scan', secret: res.secret, qr });
    } catch (err) {
      setTfError(getApiErrorMessage(err, 'Could not start the setup.'));
    } finally {
      setTfBusy(false);
    }
  };

  const confirmSetup = async () => {
    if (code.trim().length < 6) return;
    setTfBusy(true);
    setTfError(null);
    try {
      const res = await posApi.enableTwoFactor(code.trim());
      setStep({ kind: 'codes', codes: res.recoveryCodes });
      setCode('');
      await reload();
    } catch (err) {
      setTfError(getApiErrorMessage(err, 'That code is not right.'));
    } finally {
      setTfBusy(false);
    }
  };

  const confirmAction = async (action: 'disable' | 'renew') => {
    if (code.trim().length < 6) return;
    setTfBusy(true);
    setTfError(null);
    try {
      if (action === 'disable') {
        await posApi.disableTwoFactor(code.trim());
        setStep({ kind: 'idle' });
      } else {
        const res = await posApi.renewRecoveryCodes(code.trim());
        setStep({ kind: 'codes', codes: res.recoveryCodes });
      }
      setCode('');
      await reload();
    } catch (err) {
      setTfError(getApiErrorMessage(err, 'That code is not right.'));
    } finally {
      setTfBusy(false);
    }
  };

  const copyCodes = (codes: string[]) => {
    navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true)).catch(() => {});
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-teal-500" />
            <h3 className="font-bold text-base">My sign-in &amp; security</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
        </div>

        {loadError && <p className="text-xs text-rose-600">{loadError}</p>}
        {!info && !loadError && <p className="text-xs text-slate-400">Loading…</p>}

        {info && (
          <>
            {/* Password */}
            <section className="space-y-3">
              <h4 className="text-xs font-bold flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 text-teal-600" /> Back office password</h4>
              {!info.email ? (
                <p className="text-[11px] text-slate-500">
                  Your account has no email, so you sign in with your username and PIN. Ask your owner to add an email for you in
                  <strong> Staff &amp; Pin Access</strong> to use a password.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500">You sign in to the back office as <strong>{info.email}</strong>.</p>
                  {info.hasPassword && (
                    <div>
                      <label className={labelClass}>Current password</label>
                      <input type="password" value={current} autoComplete="current-password"
                        onChange={(e) => { setCurrent(e.target.value); setPwMessage(null); }} className={inputClass} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClass}>New password</label>
                      <input type="password" value={next} autoComplete="new-password"
                        onChange={(e) => { setNext(e.target.value); setPwMessage(null); }} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Type it again</label>
                      <input type="password" value={confirm} autoComplete="new-password"
                        onChange={(e) => { setConfirm(e.target.value); setPwMessage(null); }} className={inputClass} />
                    </div>
                  </div>
                  {next && passwordProblem && <p className="text-[11px] text-slate-500">{passwordProblem}</p>}
                  {pwMessage && (
                    <p className={`text-[11px] font-semibold ${pwMessage.ok ? 'text-teal-700' : 'text-rose-600'}`}>{pwMessage.text}</p>
                  )}
                  <button
                    onClick={changePassword}
                    disabled={pwBusy || !!passwordProblem || (info.hasPassword && !current)}
                    className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition"
                  >
                    {pwBusy ? 'Saving…' : info.hasPassword ? 'Change password' : 'Set password'}
                  </button>
                </>
              )}
            </section>

            {/* 2-step sign-in */}
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 text-teal-600" /> 2-step sign-in</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${info.twoFactorEnabled ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                  {info.twoFactorEnabled ? 'On' : 'Off'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                After your password, you also type a 6-digit code from an app on your phone — so a stolen password alone
                is not enough. Tills still sign in with just a PIN.
              </p>

              {step.kind === 'idle' && !info.twoFactorEnabled && (
                <button onClick={startSetup} disabled={tfBusy}
                  className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition">
                  {tfBusy ? 'Starting…' : 'Turn on 2-step sign-in'}
                </button>
              )}

              {step.kind === 'scan' && (
                <div className="space-y-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <ol className="text-[11px] text-slate-600 list-decimal pl-4 space-y-1">
                    <li>Install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone.</li>
                    <li>In the app, add an account and scan this code.</li>
                    <li>Type the 6-digit code the app shows.</li>
                  </ol>
                  {step.qr && <img src={step.qr} alt="QR code for your authenticator app" className="w-44 h-44 mx-auto rounded-lg border border-slate-200 bg-white" />}
                  <div className="text-[10px] text-slate-500 text-center">
                    Can't scan? Enter this key: <code className="font-mono font-bold text-slate-800 break-all select-all">{step.secret}</code>
                  </div>
                  <input
                    type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setTfError(null); }}
                    placeholder="123456"
                    className="w-full px-3 py-3 bg-white border border-slate-200 rounded-xl text-center text-2xl tracking-[0.4em] font-mono focus:outline-none focus:border-teal-500"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setStep({ kind: 'idle' }); setCode(''); setTfError(null); }}
                      className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">Cancel</button>
                    <button onClick={confirmSetup} disabled={tfBusy || code.length < 6}
                      className="flex-1 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">
                      {tfBusy ? 'Checking…' : 'Turn on'}
                    </button>
                  </div>
                </div>
              )}

              {step.kind === 'codes' && (
                <div className="space-y-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="text-[11px] font-bold text-amber-900">Save your recovery codes</div>
                  <p className="text-[11px] text-amber-900">
                    If you lose your phone, each of these lets you in once. Write them down or keep them somewhere safe —
                    they are shown only now.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {step.codes.map(c => (
                      <code key={c} className="px-2 py-1 rounded bg-white border border-amber-200 text-center font-mono text-xs font-bold text-slate-800">{c}</code>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => copyCodes(step.codes)}
                      className="flex-1 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-bold flex items-center justify-center gap-1.5">
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy all'}
                    </button>
                    <button onClick={() => { setStep({ kind: 'idle' }); setCopied(false); }}
                      className="flex-1 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">I saved them</button>
                  </div>
                </div>
              )}

              {step.kind === 'idle' && info.twoFactorEnabled && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    {info.recoveryCodesLeft} recovery code{info.recoveryCodesLeft === 1 ? '' : 's'} left.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => { setStep({ kind: 'confirm', action: 'renew' }); setCode(''); setTfError(null); }}
                      className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">New recovery codes</button>
                    <button onClick={() => { setStep({ kind: 'confirm', action: 'disable' }); setCode(''); setTfError(null); }}
                      className="flex-1 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold">Turn off</button>
                  </div>
                </div>
              )}

              {step.kind === 'confirm' && (
                <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[11px] text-slate-600">
                    {step.action === 'disable' ? 'To turn 2-step sign-in off, type a code from your app (or a recovery code).'
                      : 'To make new recovery codes (the old ones stop working), type a code from your app.'}
                  </p>
                  <input
                    type="text" autoComplete="one-time-code" value={code}
                    onChange={(e) => { setCode(e.target.value.slice(0, 12)); setTfError(null); }}
                    placeholder="123456"
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-center text-xl tracking-[0.3em] font-mono focus:outline-none focus:border-teal-500"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setStep({ kind: 'idle' }); setCode(''); setTfError(null); }}
                      className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">Cancel</button>
                    <button onClick={() => confirmAction(step.action)} disabled={tfBusy || code.trim().length < 6}
                      className={`flex-1 py-2 rounded-xl disabled:opacity-40 text-white text-xs font-bold ${step.action === 'disable' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-500 hover:bg-teal-600'}`}>
                      {tfBusy ? 'Checking…' : step.action === 'disable' ? 'Turn off' : 'Make new codes'}
                    </button>
                  </div>
                </div>
              )}

              {tfError && <p className="text-[11px] font-semibold text-rose-600">{tfError}</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

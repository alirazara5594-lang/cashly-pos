import React, { useEffect, useState } from 'react';
import { UserPlus, RefreshCw, ShieldCheck, ShieldAlert, KeyRound, Copy, Check, Lock } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { usePosStore } from '../../store/posStore';
import type { PlatformRole, TeamMember } from '../../types';

const ROLE_INFO: Record<PlatformRole, string> = {
  Owner: 'Everything, including prices, settings and the team',
  Billing: 'Invoices, payments, renewals, plans, add-ons and account status',
  Support: 'Support sessions, owner passwords, devices, locations',
  Sales: 'New businesses, trials and notes'
};

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500';

/**
 * The people who run Cashly. Each signs in as themselves with 2-step sign-in, and their role
 * decides what they may change — so the activity log says who did what.
 */
export const PlatformTeam: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);
  const canEdit = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ fullName: string; email: string; platformRole: PlatformRole }>({ fullName: '', email: '', platformRole: 'Support' });
  const [secret, setSecret] = useState<{ who: string; email?: string | null; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    posApi.getTeam()
      .then(rows => { if (!cancelled) { setMembers(rows); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load the team.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const reload = () => { setLoading(true); setTick(t => t + 1); };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); reload(); }
    catch (err) { setError(getApiErrorMessage(err, 'That did not work.')); }
    finally { setBusy(false); }
  };

  const add = () => act(async () => {
    const res = await posApi.addTeamMember({ fullName: form.fullName.trim(), email: form.email.trim(), platformRole: form.platformRole });
    setSecret({ who: res.member.fullName, email: res.member.email, password: res.temporaryPassword });
    setAdding(false);
    setForm({ fullName: '', email: '', platformRole: 'Support' });
  });

  const reset = (m: TeamMember, turnOffTwoStep: boolean) => act(async () => {
    if (!window.confirm(`Give ${m.fullName} a new temporary password${turnOffTwoStep ? ' and switch off their 2-step sign-in' : ''}? They are signed out everywhere.`)) return;
    const res = await posApi.resetTeamMember(m.id, turnOffTwoStep);
    setSecret({ who: m.fullName, email: m.email, password: res.temporaryPassword });
  });

  const named = members.filter(m => !m.isSetupAccount);
  const noOwner = !named.some(m => m.platformRole === 'Owner' && m.isActive);

  return (
    <div className="space-y-4 max-w-4xl">
      {noOwner && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <strong>Start here:</strong> add yourself as an <strong>Owner</strong> with your own email. Sign in with it and turn on 2-step sign-in —
          after that the shared setup PIN stops working, and everyone signs in as themselves.
        </div>
      )}

      <div className="flex items-center gap-2">
        {canEdit ? (
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold">
            <UserPlus className="w-3.5 h-3.5" /> Add team member
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Lock className="w-3.5 h-3.5" /> Only a platform owner changes the team.</span>
        )}
        <button onClick={reload} className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {adding && (
        <div className="p-4 rounded-2xl border border-teal-200 bg-teal-50/40 space-y-3">
          <div className="grid sm:grid-cols-3 gap-2">
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Full name" className={inputCls} />
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Work email (their sign-in)" className={inputCls} />
            <select value={form.platformRole} onChange={(e) => setForm({ ...form, platformRole: e.target.value as PlatformRole })} className={inputCls}>
              {(Object.keys(ROLE_INFO) as PlatformRole[]).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-slate-600">{form.platformRole}: {ROLE_INFO[form.platformRole]}. Everyone can see the console.</p>
          <button onClick={add} disabled={busy || !form.fullName.trim() || !form.email.includes('@')}
            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold disabled:opacity-40">
            {busy ? 'Adding…' : 'Add and show their temporary password'}
          </button>
        </div>
      )}

      {secret && (
        <div className="p-4 rounded-2xl border border-teal-300 bg-teal-50 space-y-2">
          <div className="text-[10px] font-black uppercase text-teal-800">Temporary password for {secret.who} — shown once</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-white border border-teal-200 text-sm font-mono font-bold tracking-wider select-all">{secret.password}</code>
            <button onClick={() => { navigator.clipboard?.writeText(secret.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
              className="px-3 py-2 rounded-lg bg-white border border-teal-200 text-teal-700 text-xs font-bold flex items-center gap-1">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy
            </button>
          </div>
          <p className="text-[11px] text-teal-900">
            Give it to them in person or on a call. They sign in at the Platform Admin sign-in with <strong>{secret.email}</strong>,
            then set up 2-step sign-in and change the password from the shield button at the top.
          </p>
          <button onClick={() => setSecret(null)} className="text-[11px] font-bold text-teal-800 underline">Done</button>
        </div>
      )}

      {error && <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">2-step</th>
              <th className="px-4 py-2.5">Last sign-in</th>
              <th className="px-4 py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map(m => (
              <tr key={m.id} className={m.isActive ? '' : 'opacity-50'}>
                <td className="px-4 py-2.5">
                  <div className="font-bold text-slate-900">{m.fullName}{m.id === currentUser?.id && <span className="ml-1.5 text-[10px] text-teal-600">(you)</span>}</div>
                  <div className="text-[11px] text-slate-500">{m.isSetupAccount ? 'Shared setup PIN account' : m.email}</div>
                </td>
                <td className="px-4 py-2.5">
                  {m.isSetupAccount ? <span className="text-slate-400">Setup</span> : canEdit && m.id !== currentUser?.id ? (
                    <select value={m.platformRole} disabled={busy}
                      onChange={(e) => act(() => posApi.updateTeamMember(m.id, { platformRole: e.target.value as PlatformRole }))}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs font-semibold">
                      {(Object.keys(ROLE_INFO) as PlatformRole[]).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <span className="font-semibold">{m.platformRole}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {m.isSetupAccount ? <span className="text-slate-400">—</span> : m.twoFactorEnabled
                    ? <span className="inline-flex items-center gap-1 text-teal-700 font-bold"><ShieldCheck className="w-3.5 h-3.5" /> On</span>
                    : <span className="inline-flex items-center gap-1 text-amber-700 font-bold"><ShieldAlert className="w-3.5 h-3.5" /> Not yet</span>}
                  {m.locked && <span className="ml-1.5 text-[10px] font-bold text-rose-600">locked</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{m.lastSignInAt ? new Date(m.lastSignInAt).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {canEdit && !m.isSetupAccount && (
                    <div className="flex items-center justify-end gap-1.5">
                      <button disabled={busy} onClick={() => reset(m, false)} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold flex items-center gap-1">
                        <KeyRound className="w-3 h-3" /> New password
                      </button>
                      {m.twoFactorEnabled && (
                        <button disabled={busy} onClick={() => reset(m, true)} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold" title="They lost their phone">
                          Reset 2-step
                        </button>
                      )}
                      {m.id !== currentUser?.id && (
                        <button disabled={busy} onClick={() => act(() => posApi.updateTeamMember(m.id, { isActive: !m.isActive }))}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${m.isActive ? 'text-rose-600 hover:bg-rose-50' : 'text-teal-700 hover:bg-teal-50'}`}>
                          {m.isActive ? 'Switch off' : 'Switch on'}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {(Object.entries(ROLE_INFO) as [PlatformRole, string][]).map(([r, text]) => (
          <div key={r} className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px]"><strong>{r}:</strong> {text}</div>
        ))}
      </div>
    </div>
  );
};

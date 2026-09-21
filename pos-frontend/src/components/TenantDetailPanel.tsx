import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ShieldAlert, Clock, Gift, Eye, Activity, AlertTriangle,
  CreditCard, Server, RefreshCw, Trash2
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';

/**
 * The per-tenant view support actually works from.
 *
 * Previously the platform console offered three actions — list, toggle active, change tier — so
 * every other request ("give them two more counters until Friday", "why did their till stop?",
 * "they say the app is broken, let me look") ended as a hand-typed database query. This panel
 * is the set of levers that avoids that: real usage and health figures, the graduated
 * suspension ladder, time-limited grants, trial extension, and audited impersonation.
 */

interface TenantDetailPanelProps {
  tenantId: string;
  onClose: () => void;
  onChanged: () => void;
}

const STATUS_LADDER = [
  { value: 'Active', label: 'Active', hint: 'Everything works.' },
  { value: 'PastDue', label: 'Past due', hint: 'Banner only. Nothing is blocked.' },
  { value: 'Restricted', label: 'Restricted', hint: 'Changes paused. POS keeps selling; reports still readable.' },
  { value: 'ReadOnly', label: 'Read-only', hint: 'No new sales. Data still viewable and exportable.' },
  { value: 'Suspended', label: 'Suspended', hint: 'Hard lock. Use as a last resort.' }
];

const OVERRIDE_KEYS = [
  { value: 'MaxCounters', label: 'Extra counters', numeric: true },
  { value: 'MaxOrderTabs', label: 'Extra tablets', numeric: true },
  { value: 'MaxBranches', label: 'Extra branches', numeric: true },
  { value: 'MaxUsers', label: 'Extra staff logins', numeric: true },
  { value: 'HasKitchenDisplay', label: 'Kitchen Display', numeric: false },
  { value: 'HasInventoryManagement', label: 'Inventory', numeric: false },
  { value: 'HasStockTransfers', label: 'Stock Transfers', numeric: false },
  { value: 'HasDirectorDashboard', label: 'Executive Dashboard', numeric: false },
  { value: 'HasConsolidatedReports', label: 'Consolidated Reports', numeric: false },
  { value: 'HasAdvancedReports', label: 'Advanced Reports', numeric: false },
  { value: 'HasMultiBranch', label: 'Multi-Branch', numeric: false },
  { value: 'HasDeliveryCOD', label: 'Delivery & COD', numeric: false }
];

export const TenantDetailPanel: React.FC<TenantDetailPanelProps> = ({ tenantId, onClose, onChanged }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [statusChoice, setStatusChoice] = useState('Active');
  const [statusReason, setStatusReason] = useState('');

  const [overrideKey, setOverrideKey] = useState('MaxCounters');
  const [overrideValue, setOverrideValue] = useState('1');
  const [overrideExpiry, setOverrideExpiry] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await posApi.getTenantOverview(tenantId);
      setData(res);
      setStatusChoice(res.tenant.status);
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not load this tenant.') });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: okText });
      await load();
      onChanged();
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'That did not work.') });
    } finally {
      setBusy(false);
    }
  };

  const handleImpersonate = async () => {
    const reason = prompt('Why are you opening this customer\'s account? This is recorded in their audit log.');
    if (!reason?.trim()) return;
    try {
      const res = await posApi.impersonateTenant(tenantId, reason.trim(), false);
      // Read-only by default: support can look without being able to change anything.
      window.localStorage.setItem('cashly_pos_token', res.token);
      setMessage({ tone: 'ok', text: `Read-only session open for ${res.expiresInMinutes} minutes. Reload to use it.` });
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not start a support session.') });
    }
  };

  if (loading) {
    return (
      <Shell onClose={onClose} title="Loading…">
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell onClose={onClose} title="Tenant">
        <p className="text-sm text-slate-500 p-6">Could not load this tenant.</p>
      </Shell>
    );
  }

  const { tenant, entitlements, usage, health, billing, overrides, devices } = data;

  return (
    <Shell onClose={onClose} title={tenant.name}>
      <div className="space-y-5">
        {message && (
          <div className={`px-3 py-2 rounded-xl text-xs font-semibold ${
            message.tone === 'ok' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* Identity + current standing */}
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Plan" value={tenant.tier} />
          <Stat label="Status" value={tenant.status} tone={
            ['Suspended', 'Cancelled', 'ReadOnly'].includes(tenant.status) ? 'bad'
              : ['PastDue', 'Restricted'].includes(tenant.status) ? 'warn' : 'good'
          } />
          <Stat label="Sector" value={entitlements.primaryPack} />
          <Stat label="Est. MRR" value={`PKR ${Math.round(billing.estimatedMrrPKR).toLocaleString()}`} />
        </div>

        {/* Health — the bit that says whether this customer is actually using the product. */}
        <Section icon={<Activity className="w-3.5 h-3.5" />} title="Health (last 30 days)">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Orders" value={health.ordersLast30d} />
            <Stat label="Revenue" value={`PKR ${Math.round(health.revenueLast30d).toLocaleString()}`} />
            <Stat label="Trading days" value={`${health.activeDaysLast30d} / 30`} />
            <Stat
              label="Churn risk"
              value={health.churnRisk}
              tone={health.churnRisk === 'high' ? 'bad' : health.churnRisk === 'watch' ? 'warn' : 'good'}
            />
          </div>
          {health.staleDevices > 0 && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {health.staleDevices} device{health.staleDevices > 1 ? 's have' : ' has'} not checked in for over a day.
            </div>
          )}
          {health.unreconciledOfflineOrders > 0 && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
              {health.unreconciledOfflineOrders} offline sale(s) synced at a price that differs from the catalogue.
            </div>
          )}
        </Section>

        {/* Usage against entitlements */}
        <Section icon={<Server className="w-3.5 h-3.5" />} title="Usage vs entitlement">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Branches" value={`${usage.branches} / ${entitlements.maxBranches}`} />
            <Stat label="Staff logins" value={`${usage.activeUsers} / ${entitlements.maxUsers}`} />
            <Stat label="Counters" value={`${usage.counters} / ${entitlements.maxCounters} per branch`} />
            <Stat label="Tablets" value={`${usage.tablets} / ${entitlements.maxOrderTabs} per branch`} />
          </div>
        </Section>

        {/* Lifecycle ladder */}
        <Section icon={<CreditCard className="w-3.5 h-3.5" />} title="Account status">
          <select
            value={statusChoice}
            onChange={(e) => setStatusChoice(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          >
            {STATUS_LADDER.map(s => <option key={s.value} value={s.value}>{s.label} — {s.hint}</option>)}
          </select>
          <input
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder="Reason (recorded against the account)"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          />
          <button
            disabled={busy || !statusReason.trim() || statusChoice === tenant.status}
            onClick={() => run(() => posApi.setTenantStatus(tenantId, statusChoice, statusReason.trim()), 'Status updated.')}
            className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Apply status
          </button>
        </Section>

        {/* Time-limited grants */}
        <Section icon={<Gift className="w-3.5 h-3.5" />} title="Grants">
          {overrides.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {overrides.map((o: any) => (
                <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-800">
                      {o.key} = {o.value}
                      {!o.inForce && <span className="ml-1.5 text-slate-400 font-normal">(lapsed)</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {o.reason} · {o.expiresAt ? `until ${new Date(o.expiresAt).toLocaleDateString()}` : 'no expiry'}
                    </div>
                  </div>
                  <button
                    onClick={() => run(() => posApi.revokeOverride(o.id), 'Grant revoked.')}
                    className="shrink-0 p-1.5 rounded-md hover:bg-rose-50 text-rose-500 transition"
                    title="Revoke"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={overrideKey}
              onChange={(e) => {
                setOverrideKey(e.target.value);
                setOverrideValue(OVERRIDE_KEYS.find(k => k.value === e.target.value)?.numeric ? '1' : 'true');
              }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            >
              {OVERRIDE_KEYS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              placeholder="Amount"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
          </div>
          <input
            type="date"
            value={overrideExpiry}
            onChange={(e) => setOverrideExpiry(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          />
          <input
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Reason (required)"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          />
          <p className="text-[10px] text-slate-500 leading-snug">
            A quota grant is a delta on top of the plan, so a later upgrade still raises the floor
            underneath it. Set an expiry unless it is genuinely permanent.
          </p>
          <button
            disabled={busy || !overrideReason.trim()}
            onClick={() => run(
              () => posApi.grantOverride(tenantId, {
                key: overrideKey,
                value: overrideValue,
                expiresAt: overrideExpiry ? new Date(overrideExpiry).toISOString() : undefined,
                reason: overrideReason.trim()
              }),
              'Grant applied. Devices pick it up on their next check-in.'
            )}
            className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Grant
          </button>
        </Section>

        {/* Devices */}
        <Section icon={<Server className="w-3.5 h-3.5" />} title={`Devices (${devices.length})`}>
          <div className="space-y-1.5">
            {devices.length === 0 && <p className="text-[11px] text-slate-500">No devices activated yet.</p>}
            {devices.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 truncate">{d.terminalName}</div>
                  <div className="text-[10px] text-slate-500">
                    {d.terminalType} · last seen {new Date(d.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded font-bold border ${
                  d.state === 'Valid' ? 'bg-teal-50 text-teal-700 border-teal-200'
                    : d.state === 'Revoked' || d.state === 'Expired' ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {d.state}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => {
              const days = Number(prompt('Extend the trial by how many days?', '14'));
              if (!days || days < 1) return;
              run(() => posApi.extendTrial(tenantId, days, 'Extended from platform console'), `Trial extended by ${days} days.`);
            }}
            className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
          >
            <Clock className="w-3.5 h-3.5" /> Extend trial
          </button>
          <button
            onClick={handleImpersonate}
            className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
            title="Read-only, time-limited, and written to the customer's audit log"
          >
            <Eye className="w-3.5 h-3.5" /> View as customer
          </button>
        </div>

        {billing.unpaidInvoices.length > 0 && (
          <Section icon={<ShieldAlert className="w-3.5 h-3.5" />} title="Unpaid invoices">
            {billing.unpaidInvoices.map((i: any) => (
              <div key={i.id} className="flex items-center justify-between text-[11px] px-3 py-2 rounded-lg bg-rose-50 border border-rose-200">
                <span className="font-mono">{i.invoiceNumber}</span>
                <span className="font-bold">PKR {Math.round(i.amountPKR).toLocaleString()}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </Shell>
  );
};

const Shell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
    <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
      <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between z-10">
        <h2 className="text-sm font-black text-slate-900 truncate">{title}</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="space-y-2">
    <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider flex items-center gap-1.5">
      {icon} {title}
    </div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }> = ({ label, value, tone }) => (
  <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
    <div className="text-[10px] uppercase font-semibold text-slate-500">{label}</div>
    <div className={`text-sm font-black capitalize ${
      tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-teal-600' : 'text-slate-900'
    }`}>
      {value}
    </div>
  </div>
);

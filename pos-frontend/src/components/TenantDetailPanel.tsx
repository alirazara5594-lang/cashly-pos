import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ShieldAlert, Clock, Gift, Eye, Activity, AlertTriangle,
  CreditCard, Server, RefreshCw, Trash2, LayoutDashboard, Puzzle,
  KeyRound, CheckCircle2, Plus, Receipt, ArrowRight, Building2, Rocket
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type {
  TenantOverview, PlanChangePreview, PlanOption,
  AddOnCatalogItem, AddOnSubscriptionRow, SubscriptionInvoice
} from '../types';

/**
 * The per-tenant command center: plan, billing, add-ons, entitlements and devices in one
 * place, so every support question ("why did their till stop?", "move them up a tier",
 * "they bought WhatsApp") ends here instead of in a hand-typed database query.
 */

export type TenantPanelTab = 'overview' | 'plan' | 'addons' | 'entitlements' | 'deploy' | 'devices';

interface TenantDetailPanelProps {
  tenantId: string;
  initialTab?: TenantPanelTab;
  onClose: () => void;
  onChanged: () => void;
}

const TABS: { key: TenantPanelTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'plan', label: 'Plan & Billing', icon: CreditCard },
  { key: 'addons', label: 'Add-ons', icon: Puzzle },
  { key: 'entitlements', label: 'Entitlements', icon: KeyRound },
  { key: 'deploy', label: 'Deploy', icon: Building2 },
  { key: 'devices', label: 'Devices', icon: Server }
];

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

const featureLabel = (key: string) =>
  key.replace(/^Has/, '').replace(/([A-Z])/g, ' $1').trim() || key;

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

const todayPlusDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export const TenantDetailPanel: React.FC<TenantDetailPanelProps> = ({ tenantId, initialTab = 'overview', onClose, onChanged }) => {
  const [data, setData] = useState<TenantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<TenantPanelTab>(initialTab);

  // Overview — lifecycle ladder + support quick actions
  const [statusChoice, setStatusChoice] = useState('Active');
  const [statusReason, setStatusReason] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [showTrialForm, setShowTrialForm] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');

  // Plan & billing
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [targetTier, setTargetTier] = useState('');
  const [paidUntil, setPaidUntil] = useState(todayPlusDays(30));
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** Set after an over-limits downgrade was rejected — the next apply runs with force=true. */
  const [forceArmed, setForceArmed] = useState(false);

  // Deploy — head office + branches
  /** True after enable-HQ came back 402: the panel then offers the upgrade path inline. */
  const [hqUpgrade, setHqUpgrade] = useState(false);

  // Add-ons
  const [catalog, setCatalog] = useState<AddOnCatalogItem[]>([]);
  const [subs, setSubs] = useState<AddOnSubscriptionRow[]>([]);
  const [addOnsLoading, setAddOnsLoading] = useState(false);
  const [grantKey, setGrantKey] = useState('');
  const [grantQty, setGrantQty] = useState('1');
  const [grantBranchId, setGrantBranchId] = useState('');

  // Entitlements — time-limited grants
  const [overrideKey, setOverrideKey] = useState('MaxCounters');
  const [overrideValue, setOverrideValue] = useState('1');
  const [overrideExpiry, setOverrideExpiry] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, invoiceRows, planRows] = await Promise.all([
        posApi.getTenantOverview(tenantId),
        posApi.getSubscriptionInvoices(tenantId).catch(() => [] as SubscriptionInvoice[]),
        posApi.getPackages().catch(() => [] as PlanOption[])
      ]);
      setData(overview);
      setStatusChoice(overview.tenant.status);
      setInvoices(invoiceRows);
      setPlans(planRows);
      setTargetTier('');
      setPreview(null);
      setForceArmed(false);
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not load this tenant.') });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // Add-on catalogue and this tenant's subscriptions load when the tab is first opened.
  useEffect(() => {
    if (tab !== 'addons' || !data || catalog.length > 0) return;
    let cancelled = false;
    (async () => {
      setAddOnsLoading(true);
      try {
        const [cat, rows] = await Promise.all([
          posApi.getAdminAddOnCatalog(),
          posApi.getTenantAddOns(tenantId)
        ]);
        if (cancelled) return;
        setCatalog(cat.filter(c => c.isActive));
        setSubs(rows);
      } catch (err) {
        if (!cancelled) setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not load add-ons.') });
      } finally {
        if (!cancelled) setAddOnsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, data, catalog.length, tenantId]);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
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

  const loadAddOns = async () => {
    try {
      const rows = await posApi.getTenantAddOns(tenantId);
      setSubs(rows);
    } catch { /* the banner from the original load stays up */ }
  };

  const doPreview = async () => {
    if (!targetTier) return;
    setPreviewing(true);
    setMessage(null);
    try {
      setPreview(await posApi.previewPlanChange(tenantId, targetTier));
      setForceArmed(false);
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not preview that change.') });
    } finally {
      setPreviewing(false);
    }
  };

  const applyTier = async (force?: boolean) => {
    if (!targetTier) return;
    setBusy(true);
    setMessage(null);
    try {
      await posApi.changeTenantTier(tenantId, targetTier, new Date(paidUntil).toISOString(), force);
      setMessage({ tone: 'ok', text: `Plan changed to ${targetTier}. Devices pick it up on their next heartbeat.` });
      setPreview(null);
      setForceArmed(false);
      await load();
      onChanged();
    } catch (err) {
      const blockers = (err as { response?: { data?: { blockers?: string[] } } })?.response?.data?.blockers;
      if (Array.isArray(blockers) && blockers.length > 0) setForceArmed(true);
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not change the plan.') });
    } finally {
      setBusy(false);
    }
  };

  const enableHQ = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await posApi.enableTenantHQ(tenantId);
      setHqUpgrade(false);
      setMessage({ tone: 'ok', text: 'Head office enabled. Branches can now be added beneath it.' });
      await load();
      onChanged();
    } catch (err) {
      // A Starter tenant gets 402 + upgradeRequired — surface the plan's own upgrade message
      // and arm the one-click move to the next tier rather than a dead end.
      const body = (err as { response?: { data?: { message?: string; upgradeRequired?: boolean } } })?.response?.data;
      if (body?.upgradeRequired) setHqUpgrade(true);
      setMessage({ tone: 'err', text: body?.message || getApiErrorMessage(err, 'Could not enable head office.') });
    } finally {
      setBusy(false);
    }
  };

  const offerHQUpgrade = () => {
    const next = tenant.tier === 'Starter' ? 'Standard' : 'Professional';
    setHqUpgrade(false);
    setTargetTier(next);
    setPreview(null);
    setForceArmed(false);
    setMessage(null);
    setTab('plan');
  };

  const handleImpersonate = async () => {
    if (!impersonateReason.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await posApi.impersonateTenant(tenantId, impersonateReason.trim(), false);
      // Read-only by default: support can look without being able to change anything.
      window.localStorage.setItem('cashly_pos_token', res.token);
      setMessage({ tone: 'ok', text: `Read-only session open for ${res.expiresInMinutes} minutes. Reload to use it.` });
      setImpersonateOpen(false);
      setImpersonateReason('');
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not start a support session.') });
    } finally {
      setBusy(false);
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

  const { tenant, branches, devices, recentLicenceEvents } = data;
  const activeSubs = subs.filter(s => s.isActive);
  const statusTone = ['Suspended', 'Cancelled', 'ReadOnly'].includes(tenant.status) ? 'bad'
    : ['PastDue', 'Restricted'].includes(tenant.status) ? 'warn' : 'good';

  return (
    <>
      <Shell
        onClose={onClose}
        title={tenant.name}
        subtitle={`${tenant.tier} · ${tenant.status}`}
        nav={TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition ${
              tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      >
        <div className="space-y-5">
          {message && (
            <div className={`px-3 py-2 rounded-xl text-xs font-semibold ${
              message.tone === 'ok' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}>
              {message.text}
            </div>
          )}

          {tab === 'overview' && (
            <OverviewTab
              data={data}
              statusTone={statusTone}
              statusChoice={statusChoice}
              setStatusChoice={setStatusChoice}
              statusReason={statusReason}
              setStatusReason={setStatusReason}
              trialDays={trialDays}
              setTrialDays={setTrialDays}
              showTrialForm={showTrialForm}
              setShowTrialForm={setShowTrialForm}
              busy={busy}
              run={run}
              onImpersonate={() => setImpersonateOpen(true)}
            />
          )}

          {tab === 'plan' && (
            <PlanTab
              data={data}
              plans={plans}
              invoices={invoices}
              targetTier={targetTier}
              setTargetTier={(t) => { setTargetTier(t); setPreview(null); setForceArmed(false); setMessage(null); }}
              paidUntil={paidUntil}
              setPaidUntil={setPaidUntil}
              preview={preview}
              previewing={previewing}
              busy={busy}
              forceArmed={forceArmed}
              onPreview={doPreview}
              onCancelPreview={() => { setPreview(null); setForceArmed(false); }}
              onApply={() => applyTier(false)}
              onForceApply={() => applyTier(true)}
              onIssueInvoice={(annual) => run(
                () => posApi.issueSubscriptionInvoice({ tenantId, annual }),
                annual ? 'Annual invoice issued.' : 'Monthly invoice issued.'
              )}
              onMarkPaid={(id) => run(() => posApi.markSubscriptionInvoicePaid(id), 'Invoice marked paid.')}
              onChanged={onChanged}
            />
          )}

          {tab === 'addons' && (
            <AddOnsTab
              data={data}
              catalog={catalog}
              subs={subs}
              activeSubs={activeSubs}
              loading={addOnsLoading}
              busy={busy}
              grantKey={grantKey}
              setGrantKey={(k) => {
                setGrantKey(k);
                const item = catalog.find(c => c.key === k);
                setGrantQty('1');
                if (item && !['EXTRA_COUNTER', 'EXTRA_TABLET'].includes(k)) setGrantBranchId('');
              }}
              grantQty={grantQty}
              setGrantQty={setGrantQty}
              grantBranchId={grantBranchId}
              setGrantBranchId={setGrantBranchId}
              onGrant={() => run(async () => {
                await posApi.grantTenantAddOn(tenantId, {
                  addOnKey: grantKey,
                  quantity: Number(grantQty) || 1,
                  branchId: ['EXTRA_COUNTER', 'EXTRA_TABLET'].includes(grantKey) ? grantBranchId : undefined
                });
                await loadAddOns();
              }, 'Add-on granted. It is live from the next device heartbeat.')}
              onRevoke={(subId) => run(async () => {
                await posApi.revokeTenantAddOn(tenantId, subId);
                await loadAddOns();
              }, 'Add-on revoked.')}
            />
          )}

          {tab === 'entitlements' && (
            <EntitlementsTab
              data={data}
              overrideKey={overrideKey}
              setOverrideKey={(k) => {
                setOverrideKey(k);
                setOverrideValue(OVERRIDE_KEYS.find(o => o.value === k)?.numeric ? '1' : 'true');
              }}
              overrideValue={overrideValue}
              setOverrideValue={setOverrideValue}
              overrideExpiry={overrideExpiry}
              setOverrideExpiry={setOverrideExpiry}
              overrideReason={overrideReason}
              setOverrideReason={setOverrideReason}
              busy={busy}
              onGrant={() => run(
                () => posApi.grantOverride(tenantId, {
                  key: overrideKey,
                  value: overrideValue,
                  expiresAt: overrideExpiry ? new Date(overrideExpiry).toISOString() : undefined,
                  reason: overrideReason.trim()
                }),
                'Grant applied. Devices pick it up on their next check-in.'
              )}
              onRevoke={(id) => run(() => posApi.revokeOverride(id), 'Grant revoked.')}
            />
          )}

          {tab === 'deploy' && (
            <DeployTab
              data={data}
              busy={busy}
              hqUpgrade={hqUpgrade}
              onEnableHQ={enableHQ}
              onUpgrade={offerHQUpgrade}
              onAddBranch={(name, city, code) => run(
                () => posApi.createTenantBranch(tenantId, { name, city: city || undefined, code: code || undefined }),
                'Branch added. It shows up on every device at its next heartbeat.'
              )}
            />
          )}

          {tab === 'devices' && (
            <DevicesTab devices={devices} events={recentLicenceEvents} branches={branches} />
          )}
        </div>
      </Shell>

      {impersonateOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setImpersonateOpen(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-700" />
              <h3 className="text-sm font-black text-slate-900">Open a support session</h3>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              Read-only, time-limited, and written to this customer's audit log.
            </p>
            <textarea
              value={impersonateReason}
              onChange={(e) => setImpersonateReason(e.target.value)}
              placeholder="Why are you opening this customer's account?"
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setImpersonateOpen(false)}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                disabled={busy || !impersonateReason.trim()}
                onClick={handleImpersonate}
                className="flex-1 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition"
              >
                Open session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Tabs ──────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  data: TenantOverview;
  statusTone: 'good' | 'warn' | 'bad';
  statusChoice: string;
  setStatusChoice: (v: string) => void;
  statusReason: string;
  setStatusReason: (v: string) => void;
  trialDays: string;
  setTrialDays: (v: string) => void;
  showTrialForm: boolean;
  setShowTrialForm: (v: boolean) => void;
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onImpersonate: () => void;
}> = ({ data, statusTone, statusChoice, setStatusChoice, statusReason, setStatusReason,
  trialDays, setTrialDays, showTrialForm, setShowTrialForm, busy, run, onImpersonate }) => {
  const { tenant, entitlements, usage, health, billing } = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Plan" value={tenant.tier} />
        <Stat label="Status" value={tenant.status} tone={statusTone} />
        <Stat label="Sector" value={entitlements.primaryPack} />
        <Stat label="Est. MRR" value={pkr(billing.estimatedMrrPKR)} />
      </div>

      <Section icon={<Activity className="w-3.5 h-3.5" />} title="Health (last 30 days)">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Orders" value={health.ordersLast30d} />
          <Stat label="Revenue" value={pkr(health.revenueLast30d)} />
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

      <Section icon={<Server className="w-3.5 h-3.5" />} title="Usage vs entitlement">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Branches" value={`${usage.branches} / ${entitlements.maxBranches}`} />
          <Stat label="Staff logins" value={`${usage.activeUsers} / ${entitlements.maxUsers}`} />
          <Stat label="Counters" value={`${usage.counters} / ${entitlements.maxCounters} per branch`} />
          <Stat label="Tablets" value={`${usage.tablets} / ${entitlements.maxOrderTabs} per branch`} />
        </div>
      </Section>

      <Section icon={<ShieldAlert className="w-3.5 h-3.5" />} title="Account status">
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
          onClick={() => run(() => posApi.setTenantStatus(tenantIdFrom(data), statusChoice, statusReason.trim()), 'Status updated.')}
          className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition"
        >
          Apply status
        </button>
      </Section>

      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={busy}
          onClick={() => setShowTrialForm(!showTrialForm)}
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
        >
          <Clock className="w-3.5 h-3.5" /> Extend trial
        </button>
        <button
          onClick={onImpersonate}
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
          title="Read-only, time-limited, and written to the customer's audit log"
        >
          <Eye className="w-3.5 h-3.5" /> View as customer
        </button>
      </div>

      {showTrialForm && (
        <div className="flex gap-2 items-end p-3 rounded-xl bg-slate-50 border border-slate-200">
          <label className="flex-1">
            <span className="text-[10px] uppercase font-bold text-slate-500">Days</span>
            <input
              type="number"
              min={1}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              className="w-full mt-0.5 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
            />
          </label>
          <button
            disabled={busy || !(Number(trialDays) >= 1)}
            onClick={() => {
              const days = Number(trialDays);
              setShowTrialForm(false);
              run(() => posApi.extendTrial(tenantIdFrom(data), days, 'Extended from platform console'), `Trial extended by ${days} days.`);
            }}
            className="py-2 px-3 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Extend
          </button>
        </div>
      )}
    </div>
  );
};

const PlanTab: React.FC<{
  data: TenantOverview;
  plans: PlanOption[];
  invoices: SubscriptionInvoice[];
  targetTier: string;
  setTargetTier: (v: string) => void;
  paidUntil: string;
  setPaidUntil: (v: string) => void;
  preview: PlanChangePreview | null;
  previewing: boolean;
  busy: boolean;
  forceArmed: boolean;
  onPreview: () => void;
  onCancelPreview: () => void;
  onApply: () => void;
  onForceApply: () => void;
  onIssueInvoice: (annual: boolean) => void;
  onMarkPaid: (id: string) => void;
  onChanged: () => void;
}> = ({ data, plans, invoices, targetTier, setTargetTier, paidUntil, setPaidUntil, preview,
  previewing, busy, forceArmed, onPreview, onCancelPreview, onApply, onForceApply,
  onIssueInvoice, onMarkPaid }) => {
  const { tenant, billing } = data;
  const currentPlan = plans.find(p => p.packageKey === tenant.tier);
  const targets = plans.filter(p => p.packageKey !== tenant.tier);
  const unpaid = billing.unpaidInvoices;
  const recent = invoices.slice(0, 8);

  return (
    <div className="space-y-5">
      {/* What they are on today */}
      <Section icon={<CreditCard className="w-3.5 h-3.5" />} title="Current plan">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-900">{currentPlan?.displayName ?? tenant.tier}</span>
            <span className="text-xs font-bold text-slate-700">{pkr(currentPlan?.monthlyPricePKR ?? billing.planPricePKR)}/mo</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <span>Paid until: <b>{tenant.subscriptionPaidUntil ? new Date(tenant.subscriptionPaidUntil).toLocaleDateString() : '—'}</b></span>
            <span>Trial ends: <b>{tenant.trialEndsAt ? new Date(tenant.trialEndsAt).toLocaleDateString() : '—'}</b></span>
            <span>Est. MRR: <b>{pkr(billing.estimatedMrrPKR)}</b></span>
            <span>Add-ons: <b>{billing.addOns.length}</b></span>
          </div>
        </div>
      </Section>

      {/* Move them to another plan — preview first, always */}
      <Section icon={<ArrowRight className="w-3.5 h-3.5" />} title="Change plan">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={targetTier}
            onChange={(e) => setTargetTier(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          >
            <option value="">Pick a plan…</option>
            {targets.map(p => (
              <option key={p.packageKey} value={p.packageKey}>
                {p.displayName} — {pkr(p.monthlyPricePKR)}/mo
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs">
            <span className="text-[10px] uppercase font-bold text-slate-500 shrink-0">Paid until</span>
            <input
              type="date"
              value={paidUntil}
              onChange={(e) => setPaidUntil(e.target.value)}
              className="bg-transparent text-xs w-full focus:outline-none"
            />
          </label>
        </div>
        <button
          disabled={!targetTier || previewing}
          onClick={onPreview}
          className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
        >
          {previewing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          Preview change
        </button>

        {preview && (
          <div className="p-3 rounded-xl border space-y-2.5 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900">
                {preview.currentTier} <ArrowRight className="w-3 h-3 inline" /> {preview.targetTier}
              </span>
              {preview.isDowngrade && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-bold">
                  Downgrade
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="px-2 py-1.5 rounded bg-slate-50 border border-slate-200">
                <div className="text-[9px] uppercase font-bold text-slate-400">Now</div>
                <div className="font-mono text-slate-700">
                  {preview.currentUsage.branches} branches · {preview.currentUsage.activeUsers} users
                </div>
              </div>
              <div className="px-2 py-1.5 rounded bg-slate-50 border border-slate-200">
                <div className="text-[9px] uppercase font-bold text-slate-400">New limits</div>
                <div className="font-mono text-slate-700">
                  {preview.targetLimits.maxBranches} br · {preview.targetLimits.maxUsers} users · {preview.targetLimits.maxCounters} ct
                </div>
              </div>
            </div>

            {preview.blockers.length > 0 && (
              <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
                <div className="text-[10px] font-black text-rose-700 uppercase">Over the new limits</div>
                {preview.blockers.map((b, i) => (
                  <div key={i} className="text-[11px] text-rose-700">{b}</div>
                ))}
              </div>
            )}

            {preview.featuresLost.length > 0 && (
              <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-[10px] font-black text-amber-700 uppercase">Features they would lose</div>
                <div className="flex flex-wrap gap-1">
                  {preview.featuresLost.map(f => (
                    <span key={f} className="px-1.5 py-0.5 rounded bg-white border border-amber-200 text-[10px] font-bold text-amber-800">
                      {featureLabel(f)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={onCancelPreview}
                className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={onApply}
                className={`flex-1 py-2 rounded-xl text-white text-xs font-bold transition ${
                  forceArmed && preview.blockers.length > 0
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-teal-500 hover:bg-teal-600'
                }`}
              >
                {forceArmed && preview.blockers.length > 0 ? 'Apply anyway (forced)' : `Move to ${preview.targetTier}`}
              </button>
            </div>
            {forceArmed && preview.blockers.length > 0 && (
              <p className="text-[10px] text-slate-500 leading-snug">
                Forced moves are recorded. Devices beyond the new allowance stop selling at their next heartbeat.
              </p>
            )}
          </div>
        )}
        {!preview && forceArmed && (
          <button
            disabled={busy}
            onClick={onForceApply}
            className="w-full py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Apply anyway (forced)
          </button>
        )}
      </Section>

      {/* Invoices */}
      <Section icon={<Receipt className="w-3.5 h-3.5" />} title="Billing">
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={() => onIssueInvoice(false)}
            className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
          >
            Issue monthly invoice
          </button>
          <button
            disabled={busy}
            onClick={() => onIssueInvoice(true)}
            className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
          >
            Issue annual invoice
          </button>
        </div>

        {unpaid.length > 0 && (
          <div className="space-y-1.5">
            {unpaid.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px]">
                <div className="min-w-0">
                  <span className="font-mono font-bold">{i.invoiceNumber}</span>
                  <span className="ml-2 text-rose-700">due {new Date(i.dueAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold">{pkr(i.amountPKR)}</span>
                  <button
                    disabled={busy}
                    onClick={() => onMarkPaid(i.id)}
                    className="px-2 py-1 rounded-md bg-white border border-rose-200 text-rose-700 text-[10px] font-bold hover:bg-rose-100 transition"
                  >
                    Mark paid
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {recent.length > 0 && (
          <div className="space-y-1">
            {recent.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-800">{i.invoiceNumber}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                    i.status === 'Paid' ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : i.status === 'Cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {i.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold text-slate-700">{pkr(i.amountPKR)}</span>
                  {(i.status === 'Pending' || i.status === 'Overdue') && (
                    <button
                      disabled={busy}
                      onClick={() => onMarkPaid(i.id)}
                      className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 text-[10px] font-bold hover:bg-slate-100 transition"
                    >
                      Mark paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {recent.length === 0 && unpaid.length === 0 && (
          <p className="text-[11px] text-slate-500">No invoices yet.</p>
        )}
      </Section>
    </div>
  );
};

const AddOnsTab: React.FC<{
  data: TenantOverview;
  catalog: AddOnCatalogItem[];
  subs: AddOnSubscriptionRow[];
  activeSubs: AddOnSubscriptionRow[];
  loading: boolean;
  busy: boolean;
  grantKey: string;
  setGrantKey: (v: string) => void;
  grantQty: string;
  setGrantQty: (v: string) => void;
  grantBranchId: string;
  setGrantBranchId: (v: string) => void;
  onGrant: () => void;
  onRevoke: (subId: string) => void;
}> = ({ data, catalog, activeSubs, loading, busy, grantKey, setGrantKey, grantQty, setGrantQty,
  grantBranchId, setGrantBranchId, onGrant, onRevoke }) => {
  const catalogName = (key: string) => catalog.find(c => c.key === key)?.displayName ?? key;
  const branchName = (id?: string | null) => data.branches.find(b => b.id === id)?.name ?? '—';
  const branchScoped = grantKey === 'EXTRA_COUNTER' || grantKey === 'EXTRA_TABLET';
  // Device add-ons are per-branch rows, so an active one at one branch still leaves the
  // others grantable; tenant-wide add-ons can only be on the account once.
  const grantable = catalog.filter(c => {
    if (['EXTRA_COUNTER', 'EXTRA_TABLET'].includes(c.key)) return true;
    return !activeSubs.some(s => s.addOnKey === c.key);
  });
  const selected = catalog.find(c => c.key === grantKey);
  const needsBranch = branchScoped && !grantBranchId;
  const grantReady = !!grantKey && !needsBranch;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Section icon={<Puzzle className="w-3.5 h-3.5" />} title={`Active add-ons (${activeSubs.length})`}>
        {activeSubs.length === 0 && (
          <p className="text-[11px] text-slate-500">No paid add-ons on this account.</p>
        )}
        <div className="space-y-1.5">
          {activeSubs.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800">{catalogName(s.addOnKey)}</div>
                <div className="text-[10px] text-slate-500">
                  {pkr(s.pricePKR)}/mo × {s.quantity}
                  {s.branchId && <> · {branchName(s.branchId)}</>}
                </div>
              </div>
              <button
                disabled={busy}
                onClick={() => onRevoke(s.id)}
                className="shrink-0 p-1.5 rounded-md hover:bg-rose-50 text-rose-500 transition"
                title="Revoke"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<Plus className="w-3.5 h-3.5" />} title="Grant an add-on">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={grantKey}
            onChange={(e) => setGrantKey(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          >
            <option value="">Pick an add-on…</option>
            {grantable.map(c => (
              <option key={c.key} value={c.key}>{c.displayName} — {pkr(c.monthlyPricePKR)}/mo</option>
            ))}
          </select>
          {branchScoped ? (
            <select
              value={grantBranchId}
              onChange={(e) => setGrantBranchId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            >
              <option value="">Pick a branch…</option>
              {data.branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              value={grantQty}
              onChange={(e) => setGrantQty(e.target.value)}
              placeholder="Qty"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
          )}
        </div>
        {selected && (
          <p className="text-[10px] text-slate-500 leading-snug">{selected.description}</p>
        )}
        <button
          disabled={busy || !grantReady}
          onClick={onGrant}
          className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
        >
          Grant add-on
        </button>
        <p className="text-[10px] text-slate-500 leading-snug">
          Granting flips the feature on immediately — the customer's tills pick it up on their
          next heartbeat, and it shows up on their next invoice at the catalogue price.
        </p>
      </Section>

      {catalog.length === 0 && (
        <p className="text-[11px] text-slate-500">
          The add-on catalogue is empty — create items in Add-ons → Catalog first.
        </p>
      )}
    </div>
  );
};

const EntitlementsTab: React.FC<{
  data: TenantOverview;
  overrideKey: string;
  setOverrideKey: (v: string) => void;
  overrideValue: string;
  setOverrideValue: (v: string) => void;
  overrideExpiry: string;
  setOverrideExpiry: (v: string) => void;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  busy: boolean;
  onGrant: () => void;
  onRevoke: (id: string) => void;
}> = ({ data, overrideKey, setOverrideKey, overrideValue, setOverrideValue, overrideExpiry,
  setOverrideExpiry, overrideReason, setOverrideReason, busy, onGrant, onRevoke }) => {
  const { entitlements, overrides } = data;
  const features = Object.entries(entitlements.features).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-5">
      <Section icon={<KeyRound className="w-3.5 h-3.5" />} title="Effective plan">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Branches" value={`max ${entitlements.maxBranches}`} />
          <Stat label="Staff logins" value={`max ${entitlements.maxUsers}`} />
          <Stat label="Counters" value={`max ${entitlements.maxCounters} / branch`} />
          <Stat label="Tablets" value={`max ${entitlements.maxOrderTabs} / branch`} />
        </div>
        <div className="text-[10px] text-slate-500">
          Vertical pack: <b className="text-slate-700">{entitlements.primaryPack}</b>
          {entitlements.packs.length > 1 && <> · also {entitlements.packs.filter(p => p !== entitlements.primaryPack).join(', ')}</>}
          {' · '}snapshot v{entitlements.version}
        </div>
      </Section>

      <Section icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="Features on this account">
        <div className="flex flex-wrap gap-1.5">
          {features.map(([flag, on]) => (
            <span
              key={flag}
              title={flag}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                on ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-50 text-slate-400 border-slate-200'
              }`}
            >
              {featureLabel(flag)}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          Features come from the plan plus any add-ons. To switch one on, change the plan
          (Plan &amp; Billing) or grant the matching add-on (Add-ons).
        </p>
      </Section>

      <Section icon={<Gift className="w-3.5 h-3.5" />} title="Grants">
        {overrides.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {overrides.map((o) => (
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
                  onClick={() => onRevoke(o.id)}
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
            onChange={(e) => setOverrideKey(e.target.value)}
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
          onClick={onGrant}
          className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
        >
          Grant
        </button>
      </Section>
    </div>
  );
};

const DeployTab: React.FC<{
  data: TenantOverview;
  busy: boolean;
  hqUpgrade: boolean;
  onEnableHQ: () => void;
  onUpgrade: () => void;
  onAddBranch: (name: string, city: string, code: string) => void;
}> = ({ data, busy, hqUpgrade, onEnableHQ, onUpgrade, onAddBranch }) => {
  const { tenant, entitlements, branches } = data;
  const isHQ = tenant.deploymentMode === 'HeadOffice';
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [code, setCode] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onAddBranch(name.trim(), city.trim(), code.trim());
    setName(''); setCity(''); setCode('');
  };

  return (
    <div className="space-y-5">
      <Section icon={<Rocket className="w-3.5 h-3.5" />} title="Deployment">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black text-slate-900">
              {isHQ ? 'Head Office' : 'Single shop'}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
              isHQ ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}>
              {tenant.deploymentMode}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            {isHQ
              ? 'Central catalogue lives here; branches beneath it pair to this server.'
              : 'One hybrid shop: POS and ERP on the same installation. Head Office unlocks branches that report into it.'}
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <span>Locations: <b>{branches.length} / {entitlements.maxBranches}</b></span>
            <span>Provider-provisioned: <b>{tenant.isProviderProvisioned ? 'Yes' : 'No'}</b></span>
          </div>
        </div>

        {!isHQ && (
          <button
            disabled={busy}
            onClick={onEnableHQ}
            className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-xs font-bold transition flex items-center justify-center gap-1.5"
          >
            <Building2 className="w-3.5 h-3.5" /> Enable Head Office
          </button>
        )}

        {hqUpgrade && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
            <div className="text-[11px] text-amber-800 font-semibold leading-snug">
              Head Office and extra locations are a Standard-and-up capability. Moving the plan
              unlocks them immediately — nothing is reinstalled.
            </div>
            <button
              disabled={busy}
              onClick={onUpgrade}
              className="w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold transition"
            >
              Review upgrade to the next tier
            </button>
          </div>
        )}
      </Section>

      <Section icon={<Building2 className="w-3.5 h-3.5" />} title={`Locations (${branches.length})`}>
        <div className="space-y-1.5">
          {branches.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">
                  {b.name}
                  {b.isHeadOffice && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[9px] font-bold align-middle">
                      HQ
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500">
                  {b.code}{b.city ? ` · ${b.city}` : ''} · {b.counters} counters · {b.tablets} tablets
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 rounded-xl border border-dashed border-slate-300 space-y-2">
          <div className="text-[10px] uppercase font-black text-slate-500">Add a location</div>
          {!isHQ && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              Enable Head Office first — branches only exist beneath it.
            </p>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Branch name (required)"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code (auto)"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
            />
          </div>
          <button
            disabled={busy || !name.trim()}
            onClick={submit}
            className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Add location
          </button>
        </div>
      </Section>
    </div>
  );
};

const DevicesTab: React.FC<{
  devices: TenantOverview['devices'];
  events: TenantOverview['recentLicenceEvents'];
  branches: TenantOverview['branches'];
}> = ({ devices, events, branches }) => {
  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? '—';
  return (
    <div className="space-y-5">
      <Section icon={<Server className="w-3.5 h-3.5" />} title={`Devices (${devices.length})`}>
        <div className="space-y-1.5">
          {devices.length === 0 && <p className="text-[11px] text-slate-500">No devices activated yet.</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800 truncate">{d.terminalName}</div>
                <div className="text-[10px] text-slate-500">
                  {d.terminalType} · {branchName(d.branchId)} · last seen {new Date(d.lastSeenAt).toLocaleString()}
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

      <Section icon={<Activity className="w-3.5 h-3.5" />} title="Recent licence events">
        <div className="space-y-1">
          {events.length === 0 && <p className="text-[11px] text-slate-500">No licence events recorded.</p>}
          {events.map((e, i) => (
            <div key={i} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-bold text-slate-800">{e.eventType}</span>
                {e.detail && <span className="ml-1.5 text-slate-500 truncate">{e.detail}</span>}
              </div>
              <span className="shrink-0 text-slate-400 font-mono">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ── Shared shell ──────────────────────────────────────────────

const Shell: React.FC<{ title: string; subtitle?: string; nav?: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ title, subtitle, nav, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
    <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
      <div className="sticky top-0 bg-white border-b border-slate-200 z-10">
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900 truncate">{title}</h2>
            {subtitle && <p className="text-[10px] text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        {nav && <div className="px-5 pb-3 flex gap-1 overflow-x-auto">{nav}</div>}
      </div>
      <div className="p-5 flex-1">{children}</div>
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

// OverviewTab needs the tenant id for status/trial calls without threading it through every
// prop — it is stable for the lifetime of the panel.
const tenantIdFrom = (data: TenantOverview) => data.tenant.id;

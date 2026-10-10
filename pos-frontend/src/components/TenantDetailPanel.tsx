import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ShieldAlert, Clock, Gift, Eye, Activity, AlertTriangle,
  CreditCard, Server, RefreshCw, Trash2, LayoutDashboard, Puzzle,
  KeyRound, CheckCircle2, Plus, Receipt, ArrowRight, Building2, Rocket, History, Globe,
  Send, Download, MessageCircle, Copy, Check, Ban, StickyNote, PhoneCall, HandCoins, MapPin, Warehouse
} from 'lucide-react';
import { SubscriptionPartsTable } from './SubscriptionParts';
import { IssueInvoiceModal, InvoiceDrawer, InvoiceList } from './PlatformBilling';
import { posApi, getApiErrorMessage } from '../services/api';
import { tierLabel } from '../utils/tierLabel';
import { dateOf, pkr, whatsAppNumber, type TenantPanelTab } from '../utils/renewals';
import { restaurantSignInLink, webNameProblem } from '../services/restaurantAddress';
import { beginSupportSession } from '../services/supportSession';
import type {
  TenantOverview, PlanChangePreview, PlanOption,
  AddOnCatalogItem, AddOnSubscriptionRow, SubscriptionInvoice, AuditLogPage, TenantOwnerAccount,
  SubscriptionPartRow, PlatformMessageRow, TenantNote, TenantNoteKind
} from '../types';

/**
 * The per-business command center, in five places: how it is doing (Overview), what it pays and
 * owes (Billing), what it may use (Plan & features), where it runs (Locations & devices), and what
 * happened (Activity) — so every support question ends here instead of in a database query.
 */

export type { TenantPanelTab };

interface TenantDetailPanelProps {
  tenantId: string;
  initialTab?: TenantPanelTab;
  onClose: () => void;
  onChanged: () => void;
}

const TABS: { key: TenantPanelTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'billing', label: 'Billing', icon: Receipt },
  { key: 'plan', label: 'Plan & features', icon: CreditCard },
  { key: 'locations', label: 'Locations & devices', icon: Building2 },
  { key: 'activity', label: 'Activity', icon: History }
];

const STATUS_LADDER = [
  { value: 'Active', label: 'Active', hint: 'Everything works.' },
  { value: 'PastDue', label: 'Past due', hint: 'Banner only. Nothing is blocked.' },
  { value: 'Restricted', label: 'Restricted', hint: 'Changes paused. POS keeps selling; reports still readable.' },
  { value: 'ReadOnly', label: 'Read-only', hint: 'No new sales. Data still viewable and exportable.' },
  { value: 'Suspended', label: 'Suspended', hint: 'Hard lock. Use as a last resort.' },
  { value: 'Cancelled', label: 'Closed', hint: 'The customer left. Export their data first.' }
];

const OVERRIDE_KEYS = [
  { value: 'MaxCounters', label: 'Extra counters (per branch)', numeric: true },
  { value: 'MaxOrderTabs', label: 'Extra tablets (per branch)', numeric: true },
  { value: 'MaxBranches', label: 'Extra branches', numeric: true },
  { value: 'MaxUsers', label: 'Extra back-office logins', numeric: true },
  { value: 'HasKitchenDisplay', label: 'Kitchen Display', numeric: false },
  { value: 'HasInventoryManagement', label: 'Inventory', numeric: false },
  { value: 'HasStockTransfers', label: 'Stock Transfers', numeric: false },
  { value: 'HasDirectorDashboard', label: 'Executive Dashboard', numeric: false },
  { value: 'HasConsolidatedReports', label: 'Consolidated Reports', numeric: false },
  { value: 'HasAdvancedReports', label: 'Advanced Reports', numeric: false },
  { value: 'HasMultiBranch', label: 'Multi-Branch', numeric: false },
  { value: 'HasDeliveryCOD', label: 'Delivery & COD', numeric: false }
];

// Mirrors the grant endpoint: a device add-on raises one shop's allowance so it must name the shop;
// a per-shop service may name one shop or none (every shop).
const MUST_NAME_SHOP = new Set(['EXTRA_COUNTER', 'EXTRA_TABLET', 'EXTRA_KDS']);
const MAY_NAME_SHOP = new Set([
  ...MUST_NAME_SHOP,
  'fiscal_invoicing', 'online_payments', 'online_ordering', 'integrations', 'api', 'HasKitchenDisplay'
]);
// Add-ons whose quantity means something — extra devices, extra logins, message bundles.
const HAS_QUANTITY = new Set([...MUST_NAME_SHOP, 'EXTRA_USER', 'EXTRA_BRANCH', 'WHATSAPP_1000']);

const featureLabel = (key: string) =>
  key.replace(/^Has/, '').replace(/([A-Z])/g, ' $1').trim() || key;

const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs';

export const TenantDetailPanel: React.FC<TenantDetailPanelProps> = ({ tenantId, initialTab = 'overview', onClose, onChanged }) => {
  const [data, setData] = useState<TenantOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<TenantPanelTab>(initialTab);
  const [shownFor, setShownFor] = useState({ tenantId, initialTab });

  // The panel stays mounted when the console swaps business or asks for another tab.
  if (shownFor.tenantId !== tenantId || shownFor.initialTab !== initialTab) {
    setShownFor({ tenantId, initialTab });
    setTab(initialTab);
  }

  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, invoiceRows, planRows] = await Promise.all([
        posApi.getTenantOverview(tenantId),
        posApi.getSubscriptionInvoices(tenantId).catch(() => [] as SubscriptionInvoice[]),
        posApi.getPackages().catch(() => [] as PlanOption[])
      ]);
      setData(overview);
      setInvoices(invoiceRows);
      setPlans(planRows);
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not load this business.') });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

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

  if (loading && !data) {
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
      <Shell onClose={onClose} title="Business">
        <p className="text-sm text-slate-500 p-6">{message?.text ?? 'Could not load this business.'}</p>
      </Shell>
    );
  }

  const { tenant } = data;

  return (
    <Shell
      onClose={onClose}
      title={tenant.name}
      subtitle={`${tenant.deploymentMode === 'HeadOffice' ? 'Head office' : 'Single shop'} · ${tierLabel(tenant.tier)} · ${STATUS_LADDER.find(s => s.value === tenant.status)?.label ?? tenant.status}`}
      nav={TABS.map(t => (
        <button
          key={t.key}
          onClick={() => { setTab(t.key); setMessage(null); }}
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

        {tab === 'overview' && <OverviewTab data={data} busy={busy} run={run} />}
        {tab === 'billing' && <BillingTab tenantId={tenantId} tenantName={tenant.name} invoices={invoices} onChanged={() => { load(); onChanged(); }} />}
        {tab === 'plan' && <PlanAndFeaturesTab data={data} plans={plans} busy={busy} run={run} setMessage={setMessage} />}
        {tab === 'locations' && <LocationsTab data={data} busy={busy} run={run} setMessage={setMessage} onUpgrade={() => setTab('plan')} />}
        {tab === 'activity' && <ActivityTab tenantId={tenantId} />}
      </div>
    </Shell>
  );
};

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;
type SetMessage = (m: { tone: 'ok' | 'err'; text: string } | null) => void;

// ── Overview ───────────────────────────────────────────────────

const OverviewTab: React.FC<{ data: TenantOverview; busy: boolean; run: Run }> = ({ data, busy, run }) => {
  const { tenant, entitlements, usage, health, billing, branches } = data;
  const [statusChoice, setStatusChoice] = useState(tenant.status);
  const [statusReason, setStatusReason] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [trialReason, setTrialReason] = useState('');
  const [showTrialForm, setShowTrialForm] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [messageOpen, setMessageOpen] = useState(false);
  const [msgSubject, setMsgSubject] = useState('');
  const [msgText, setMsgText] = useState('');
  const [exporting, setExporting] = useState(false);
  const statusTone = ['Suspended', 'Cancelled', 'ReadOnly'].includes(tenant.status) ? 'bad'
    : ['PastDue', 'Restricted'].includes(tenant.status) ? 'warn' : 'good';
  const outlets = branches.filter(b => b.canSell !== false && b.locationType !== 'Warehouse' && b.locationType !== 'HeadOffice');

  const impersonate = async () => {
    if (!impersonateReason.trim()) return;
    try {
      const res = await posApi.impersonateTenant(tenant.id, impersonateReason.trim(), false);
      setImpersonateOpen(false);
      beginSupportSession(res);
    } catch (err) {
      alert(getApiErrorMessage(err, 'Could not start a support session.'));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Plan" value={tierLabel(tenant.tier)} />
        <Stat label="Status" value={STATUS_LADDER.find(s => s.value === tenant.status)?.label ?? tenant.status} tone={statusTone} />
        <Stat label="Sector" value={entitlements.primaryPack} />
        <Stat label="Pays a month" value={pkr(billing.estimatedMrrPKR)} />
      </div>

      <Section icon={<Activity className="w-3.5 h-3.5" />} title="Health (last 30 days)">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Orders" value={health.ordersLast30d} />
          <Stat label="Sales" value={pkr(health.revenueLast30d)} />
          <Stat label="Trading days" value={`${health.activeDaysLast30d} / 30`} />
          <Stat label="Churn risk" value={health.churnRisk} tone={health.churnRisk === 'high' ? 'bad' : health.churnRisk === 'watch' ? 'warn' : 'good'} />
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

      <Section icon={<Server className="w-3.5 h-3.5" />} title="Usage — each outlet against its own POS version">
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 font-bold">
              <tr><th className="px-3 py-2 text-left">Outlet</th><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-center">Tills</th><th className="px-3 py-2 text-center">Tablets</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outlets.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-slate-500">No selling outlet yet.</td></tr>}
              {outlets.map(b => {
                const overTills = b.maxCounters != null && b.maxCounters < 9999 && b.counters > b.maxCounters;
                const overTabs = b.maxTablets != null && b.maxTablets < 9999 && b.tablets > b.maxTablets;
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{b.name}</td>
                    <td className="px-3 py-2 text-slate-600">{tierLabel(b.posEdition)}</td>
                    <td className={`px-3 py-2 text-center font-mono ${overTills ? 'text-rose-600 font-bold' : ''}`}>{b.counters} / {(b.maxCounters ?? 0) >= 9999 ? '∞' : b.maxCounters ?? '—'}</td>
                    <td className={`px-3 py-2 text-center font-mono ${overTabs ? 'text-rose-600 font-bold' : ''}`}>{b.tablets} / {(b.maxTablets ?? 0) >= 9999 ? '∞' : b.maxTablets ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-slate-500">
          Back-office logins: <strong>{usage.activeUsers}</strong> / {entitlements.maxUsers >= 999 ? 'no limit' : entitlements.maxUsers}
          {' · '}Products: <strong>{usage.products}</strong>
        </div>
      </Section>

      <Section icon={<ShieldAlert className="w-3.5 h-3.5" />} title="Account status">
        <select value={statusChoice} onChange={(e) => setStatusChoice(e.target.value)} className={inputCls}>
          {STATUS_LADDER.map(s => <option key={s.value} value={s.value}>{s.label} — {s.hint}</option>)}
        </select>
        <input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="Reason (recorded against the account)" className={inputCls} />
        <button
          disabled={busy || !statusReason.trim() || statusChoice === tenant.status}
          onClick={() => run(() => posApi.setTenantStatus(tenant.id, statusChoice, statusReason.trim()), 'Status updated.')}
          className={`w-full py-2 rounded-xl disabled:opacity-40 text-white text-xs font-bold transition ${statusChoice === 'Cancelled' || statusChoice === 'Suspended' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-800'}`}
        >
          {statusChoice === 'Cancelled' ? 'Close the account' : 'Apply status'}
        </button>
        <p className="text-[10px] text-slate-500">Unpaid parts can also stop on their own, one at a time — see Billing.</p>
      </Section>

      <WebAddressSection webName={tenant.slug} busy={busy}
        onChange={(name) => run(() => posApi.changeTenantWebName(tenant.id, name), `Web address changed to ${name}.`)} />

      <OwnerSignIn tenantId={tenant.id} invitePending={tenant.ownerInvitePending} webName={tenant.slug}
        phone={tenant.contactPhone} contactName={tenant.contactName} businessName={tenant.name} />

      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => setShowTrialForm(v => !v)}
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <Clock className="w-3.5 h-3.5" /> Extend trial
        </button>
        <button onClick={() => setImpersonateOpen(true)} title="Read-only, time-limited, and written to the customer's audit log"
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <Eye className="w-3.5 h-3.5" /> View as customer
        </button>
        <button onClick={() => setMessageOpen(v => !v)}
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <Send className="w-3.5 h-3.5" /> Message the owner
        </button>
        <button disabled={exporting} onClick={async () => {
          setExporting(true);
          try { await posApi.exportTenantData(tenant.id); } catch (err) { alert(getApiErrorMessage(err, 'Could not export.')); } finally { setExporting(false); }
        }}
          className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> {exporting ? 'Preparing…' : 'Export their data'}
        </button>
      </div>

      {showTrialForm && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex gap-2">
            <input type="number" min={1} max={180} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className={`${inputCls} w-24 bg-white`} />
            <input value={trialReason} onChange={(e) => setTrialReason(e.target.value)} placeholder="Why (recorded)" className={`${inputCls} bg-white`} />
          </div>
          <button
            disabled={busy || !(Number(trialDays) >= 1) || !trialReason.trim()}
            onClick={() => { setShowTrialForm(false); run(() => posApi.extendTrial(tenant.id, Number(trialDays), trialReason.trim()), `Trial extended by ${trialDays} days.`); }}
            className="w-full py-2 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold transition"
          >
            Extend by {trialDays} days
          </button>
        </div>
      )}

      {messageOpen && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Subject (for email)" className={`${inputCls} bg-white`} />
          <textarea rows={3} value={msgText} onChange={(e) => setMsgText(e.target.value)} placeholder="Your message" className={`${inputCls} bg-white resize-none`} />
          <p className="text-[10px] text-slate-500">Sent on WhatsApp (from the platform's line) and email to {tenant.contactName}. Logged in Messages.</p>
          <button disabled={busy || !msgText.trim()}
            onClick={() => run(async () => {
              const r = await posApi.sendTenantMessage(tenant.id, msgSubject.trim(), msgText.trim());
              if (r.sent === 0) throw new Error('Nothing could be sent — set up the WhatsApp line or email in Platform → Settings.');
              setMessageOpen(false); setMsgText(''); setMsgSubject('');
            }, 'Message sent.')}
            className="w-full py-2 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">
            Send
          </button>
        </div>
      )}

      {impersonateOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setImpersonateOpen(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-3">
            <div className="flex items-center gap-2"><Eye className="w-4 h-4 text-slate-700" /><h3 className="text-sm font-black text-slate-900">Open a support session</h3></div>
            <p className="text-[11px] text-slate-500 leading-snug">Read-only, time-limited, and written to this customer's audit log.</p>
            <textarea value={impersonateReason} onChange={(e) => setImpersonateReason(e.target.value)} placeholder="Why are you opening this customer's account?" rows={3} className={`${inputCls} resize-none`} />
            <div className="flex gap-2">
              <button onClick={() => setImpersonateOpen(false)} className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">Cancel</button>
              <button disabled={!impersonateReason.trim()} onClick={impersonate} className="flex-1 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold">Open session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** The restaurant's own sign-in address, and changing it — staff bookmarks of the old one stop working. */
const WebAddressSection: React.FC<{ webName: string; busy: boolean; onChange: (name: string) => void }> = ({ webName, busy, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(webName);
  const [copied, setCopied] = useState(false);
  const link = restaurantSignInLink(webName);
  const problem = webNameProblem(draft);

  return (
    <Section icon={<Globe className="w-3.5 h-3.5" />} title="Sign-in address">
      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
        <span className="flex-1 min-w-0 text-xs font-mono font-bold text-slate-800 truncate">{link.replace(/^https?:\/\//, '')}</span>
        <button onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}
          className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-600">{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={() => { setDraft(webName); setEditing(v => !v); }} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-600">Change</button>
      </div>
      {editing && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
          <p className="text-[11px] text-amber-900">Staff bookmarks and links to the old address stop working. Tell the business the new one.</p>
          <input value={draft} onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30))}
            className="w-full bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-xs font-mono" />
          {draft !== webName && problem && <p className="text-[11px] text-rose-600">{problem}</p>}
          <button disabled={busy || !!problem || draft === webName}
            onClick={() => {
              if (!window.confirm(`Change the address to ${restaurantSignInLink(draft).replace(/^https?:\/\//, '')}? The old one stops working.`)) return;
              setEditing(false);
              onChange(draft);
            }}
            className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-[11px] font-bold">Save new address</button>
        </div>
      )}
    </Section>
  );
};

/**
 * The owner's sign-in: reset a forgotten password (shown once), or — while the business has no owner
 * yet — a fresh invite to send them.
 */
const OwnerSignIn: React.FC<{ tenantId: string; invitePending: boolean; webName: string; phone?: string; contactName: string; businessName: string }> = ({
  tenantId, invitePending, webName, phone, contactName, businessName
}) => {
  const [owners, setOwners] = useState<TenantOwnerAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ userId: string; email: string; password: string; signedOut: number; twoFactorOff: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [lostPhone, setLostPhone] = useState<Record<string, boolean>>({});
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTenantOwners(tenantId)
      .then(rows => { if (!cancelled) setOwners(rows); })
      .catch(err => { if (!cancelled) setLoadError(getApiErrorMessage(err, 'Could not load the owner accounts.')); });
    return () => { cancelled = true; };
  }, [tenantId]);

  const reset = async (owner: TenantOwnerAccount) => {
    const email = (emailDrafts[owner.id] ?? '').trim();
    if (!owner.email && !email) { setError('Enter the owner\'s email first — it becomes their back-office sign-in.'); return; }
    if (!window.confirm(`Set a new temporary password for ${owner.fullName}? They will be signed out on every device.`)) return;
    setBusyId(owner.id);
    setError(null);
    setIssued(null);
    setCopied(false);
    try {
      const res = await posApi.resetOwnerPassword(tenantId, owner.id, owner.email ? undefined : email, !!lostPhone[owner.id]);
      setIssued({ userId: owner.id, email: res.email, password: res.temporaryPassword, signedOut: res.signedOutSessions, twoFactorOff: res.twoFactorTurnedOff });
      setOwners(await posApi.getTenantOwners(tenantId));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not reset the password.'));
    } finally {
      setBusyId(null);
    }
  };

  const newInvite = async () => {
    setError(null);
    try {
      const res = await posApi.issueOwnerInvite(tenantId);
      setInvite({ token: res.ownerInviteToken, expiresAt: res.ownerInviteExpiresAt });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not make an invite.'));
    }
  };

  const inviteLink = invite ? `${window.location.origin}/invite?code=${invite.token}` : '';
  const wa = whatsAppNumber(phone);

  return (
    <Section icon={<KeyRound className="w-3.5 h-3.5" />} title="Owner sign-in">
      {loadError && <p className="text-[11px] text-rose-600">{loadError}</p>}
      {!owners && !loadError && <p className="text-[11px] text-slate-400">Loading…</p>}
      {owners?.length === 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
          <p className="text-[11px] text-amber-900">
            No owner account yet{invitePending ? ' — an invite was made but not used.' : '.'} Make an invite and send it to {contactName}: they open the link,
            choose a username and PIN, and sign in at {restaurantSignInLink(webName).replace(/^https?:\/\//, '')}.
          </p>
          {!invite && <button onClick={newInvite} className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold">Make a new invite</button>}
          {invite && (
            <div className="space-y-1.5">
              <code className="block px-2 py-1.5 rounded bg-white border border-amber-200 text-[10px] font-mono break-all select-all">{inviteLink}</code>
              <div className="flex gap-1.5">
                <button onClick={() => { navigator.clipboard?.writeText(inviteLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
                  className="flex-1 py-1.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold flex items-center justify-center gap-1">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy link
                </button>
                {wa && (
                  <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`Assalam o Alaikum ${contactName}, your Cashly account for ${businessName} is ready. Open this link to set your username and PIN: ${inviteLink}`)}`}
                    target="_blank" rel="noopener noreferrer" className="flex-1 py-1.5 rounded-lg bg-white border border-amber-200 text-[11px] font-bold text-teal-700 flex items-center justify-center gap-1">
                    <MessageCircle className="w-3 h-3" /> Send on WhatsApp
                  </a>
                )}
              </div>
              <p className="text-[10px] text-amber-800">Works once, until {dateOf(invite.expiresAt)}. Shown only now.</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {owners?.map(o => (
          <div key={o.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">{o.fullName}</div>
                <div className="text-[10px] text-slate-500 font-mono">@{o.username}</div>
                <div className="text-[11px] text-slate-600 truncate">{o.email ?? <span className="text-amber-700">No email — signs in with username + PIN only</span>}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {!o.isActive && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">Disabled</span>}
                {o.lockedUntil && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">Locked</span>}
                {o.email && !o.hasPassword && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">No password</span>}
                {o.twoFactorEnabled && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">2-step on</span>}
              </div>
            </div>
            {o.twoFactorEnabled && (
              <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!!lostPhone[o.id]} onChange={(e) => setLostPhone(p => ({ ...p, [o.id]: e.target.checked }))} className="w-3.5 h-3.5 accent-teal-500" />
                Also turn off 2-step sign-in (they lost their phone)
              </label>
            )}
            {!o.email && (
              <input type="email" value={emailDrafts[o.id] ?? ''} onChange={(e) => setEmailDrafts(d => ({ ...d, [o.id]: e.target.value }))}
                placeholder="Owner's email for back-office sign-in" className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs" />
            )}
            <button disabled={busyId !== null} onClick={() => reset(o)}
              className="w-full py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-[11px] font-bold transition">
              {busyId === o.id ? 'Resetting…' : o.lockedUntil ? 'Unlock & reset password' : 'Reset password'}
            </button>
            {issued?.userId === o.id && (
              <div className="p-2.5 rounded-lg bg-teal-50 border border-teal-200 space-y-1.5">
                <div className="text-[10px] font-bold text-teal-800 uppercase">Temporary password — shown once</div>
                <code className="block px-2 py-1 rounded bg-white border border-teal-200 text-sm font-mono font-bold text-slate-900 tracking-wider select-all">{issued.password}</code>
                <p className="text-[10px] text-teal-800 leading-snug">
                  Read it to the owner. They sign in with <strong>{issued.email}</strong> and this password, then set their own from the shield button at the top.
                  {issued.signedOut > 0 && ` ${issued.signedOut} old session(s) were signed out.`}
                  {issued.twoFactorOff && ' 2-step sign-in is off — they can turn it on again with their new phone.'}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </Section>
  );
};

// ── Billing ────────────────────────────────────────────────────

const BillingTab: React.FC<{ tenantId: string; tenantName: string; invoices: SubscriptionInvoice[]; onChanged: () => void }> = ({ tenantId, tenantName, invoices, onChanged }) => {
  const [parts, setParts] = useState<SubscriptionPartRow[] | null>(null);
  const [messages, setMessages] = useState<PlatformMessageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    posApi.getTenantSubscriptionParts(tenantId)
      .then(rows => { if (!cancelled) { setParts(rows); setError(null); } })
      .catch(err => { if (!cancelled) setError(getApiErrorMessage(err, 'Could not load this business\'s renewals.')); });
    posApi.getPlatformMessages({ tenantId, pageSize: 8 })
      .then(res => { if (!cancelled) setMessages(res.entries); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  const changed = () => { setTick(t => t + 1); onChanged(); };

  if (error) return <p className="text-xs text-rose-600 font-semibold">{error}</p>;
  if (!parts) return <div className="flex items-center justify-center py-10"><RefreshCw className="w-5 h-5 text-slate-400 animate-spin" /></div>;

  const monthly = parts.filter(p => p.isActive && p.status !== 'NotInstalled')
    .reduce((sum, p) => sum + (p.annual ? (p.yearlyPricePKR ?? p.pricePKR) / 12 : (p.monthlyPricePKR ?? p.pricePKR)), 0);
  const owed = invoices.filter(i => ['Pending', 'Overdue', 'PartiallyPaid'].includes(i.status)).reduce((s, i) => s + (i.balancePKR ?? i.amountPKR), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Pays a month" value={pkr(monthly)} />
        <Stat label="Owes now" value={pkr(owed)} tone={owed > 0 ? 'warn' : 'good'} />
      </div>

      <Section icon={<CreditCard className="w-3.5 h-3.5" />} title="What it pays for — each renews on its own date">
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <SubscriptionPartsTable parts={parts} canManage onChanged={changed} emptyText="Nothing to renew yet." />
        </div>
      </Section>

      <Section icon={<Receipt className="w-3.5 h-3.5" />} title={`Invoices (${invoices.length})`}>
        <button onClick={() => setIssuing(true)} className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New invoice
        </button>
        <InvoiceList invoices={invoices} onOpen={(i) => setOpenInvoiceId(i.id)} emptyText="No invoices yet." />
      </Section>

      <Section icon={<Send className="w-3.5 h-3.5" />} title="Messages sent to this business">
        {messages.length === 0 && <p className="text-[11px] text-slate-500">None yet.</p>}
        {messages.map(m => (
          <div key={m.id} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600">
            <span className="font-bold capitalize">{m.channel}</span> · {m.kind} · {new Date(m.createdAt).toLocaleString()} ·{' '}
            <span className={m.status === 'sent' ? 'text-teal-700 font-bold' : m.status === 'failed' ? 'text-rose-600 font-bold' : 'text-slate-400'}>{m.status === 'skipped' ? 'not sent' : m.status}</span>
            {m.error && <span className="text-slate-400"> — {m.error}</span>}
          </div>
        ))}
      </Section>

      {issuing && (
        <IssueInvoiceModal tenantId={tenantId} tenantName={tenantName} onClose={() => setIssuing(false)}
          onIssued={(invoice) => { setIssuing(false); changed(); setOpenInvoiceId(invoice.id); }} />
      )}
      {openInvoiceId && <InvoiceDrawer invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} onChanged={changed} />}
    </div>
  );
};

// ── Plan & features ────────────────────────────────────────────

const PlanAndFeaturesTab: React.FC<{ data: TenantOverview; plans: PlanOption[]; busy: boolean; run: Run; setMessage: SetMessage }> = ({ data, plans, busy, run, setMessage }) => {
  const { tenant, entitlements, overrides, branches } = data;
  const [targetTier, setTargetTier] = useState('');
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);

  const [catalog, setCatalog] = useState<AddOnCatalogItem[]>([]);
  const [subs, setSubs] = useState<AddOnSubscriptionRow[]>([]);
  const [addOnTick, setAddOnTick] = useState(0);
  const [grantKey, setGrantKey] = useState('');
  const [grantQty, setGrantQty] = useState('1');
  const [grantBranchId, setGrantBranchId] = useState('');
  const [grantPrice, setGrantPrice] = useState('');

  const [overrideKey, setOverrideKey] = useState('MaxCounters');
  const [overrideValue, setOverrideValue] = useState('1');
  const [overrideExpiry, setOverrideExpiry] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([posApi.getAdminAddOnCatalog(), posApi.getTenantAddOns(tenant.id)])
      .then(([cat, rows]) => { if (!cancelled) { setCatalog(cat.filter(c => c.isActive)); setSubs(rows); } })
      .catch(err => { if (!cancelled) setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not load add-ons.') }); });
    return () => { cancelled = true; };
  }, [tenant.id, addOnTick, setMessage]);

  const currentPlan = plans.find(p => p.packageKey === tenant.tier);
  const targets = plans.filter(p => p.packageKey !== tenant.tier);
  const activeSubs = subs.filter(s => s.isActive);
  const catalogName = (key: string) => catalog.find(c => c.key === key)?.displayName ?? key;
  const branchName = (id?: string | null) => branches.find(b => b.id === id)?.name ?? '—';
  const grantable = catalog.filter(c => MAY_NAME_SHOP.has(c.key) || HAS_QUANTITY.has(c.key) || !activeSubs.some(s => s.addOnKey === c.key));
  const selected = catalog.find(c => c.key === grantKey);
  const grantReady = !!grantKey && !(MUST_NAME_SHOP.has(grantKey) && !grantBranchId);
  const features = Object.entries(entitlements.features).sort(([a], [b]) => a.localeCompare(b));

  const doPreview = async () => {
    if (!targetTier) return;
    setPreviewing(true);
    setMessage(null);
    try {
      setPreview(await posApi.previewPlanChange(tenant.id, targetTier));
      setForceArmed(false);
    } catch (err) {
      setMessage({ tone: 'err', text: getApiErrorMessage(err, 'Could not preview that change.') });
    } finally {
      setPreviewing(false);
    }
  };

  const applyTier = (force: boolean) => run(async () => {
    try {
      await posApi.changeTenantTier(tenant.id, targetTier, undefined, force);
      setPreview(null);
      setForceArmed(false);
      setTargetTier('');
    } catch (err) {
      const blockers = (err as { response?: { data?: { blockers?: string[] } } })?.response?.data?.blockers;
      if (Array.isArray(blockers) && blockers.length > 0) setForceArmed(true);
      throw err;
    }
  }, `Plan changed to ${tierLabel(targetTier)}. Devices pick it up on their next check-in; billing follows from the next renewal.`);

  return (
    <div className="space-y-5">
      <Section icon={<CreditCard className="w-3.5 h-3.5" />} title="Plan">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <span className="text-sm font-black text-slate-900">{currentPlan?.displayName ?? tierLabel(tenant.tier)}</span>
          <span className="text-xs font-bold text-slate-700">{pkr(currentPlan?.monthlyPricePKR)}/mo list</span>
        </div>
        <div className="flex gap-2">
          <select value={targetTier} onChange={(e) => { setTargetTier(e.target.value); setPreview(null); setForceArmed(false); }} className={inputCls}>
            <option value="">Move to another plan…</option>
            {targets.map(p => <option key={p.packageKey} value={p.packageKey}>{p.displayName} — {pkr(p.monthlyPricePKR)}/mo</option>)}
          </select>
          <button disabled={!targetTier || previewing} onClick={doPreview}
            className="px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold whitespace-nowrap flex items-center gap-1.5">
            {previewing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />} Preview
          </button>
        </div>
        {preview && (
          <div className="p-3 rounded-xl border space-y-2.5 bg-white border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900">{tierLabel(preview.currentTier)} <ArrowRight className="w-3 h-3 inline" /> {tierLabel(preview.targetTier)}</span>
              {preview.isDowngrade && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-bold">Downgrade</span>}
            </div>
            <div className="text-[11px] font-mono text-slate-600">
              New limits: {preview.targetLimits.maxBranches} locations · {preview.targetLimits.maxUsers} users · {preview.targetLimits.maxCounters} tills per outlet
            </div>
            {preview.blockers.length > 0 && (
              <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 space-y-1">
                <div className="text-[10px] font-black text-rose-700 uppercase">Over the new limits</div>
                {preview.blockers.map((b, i) => <div key={i} className="text-[11px] text-rose-700">{b}</div>)}
              </div>
            )}
            {preview.featuresLost.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {preview.featuresLost.map(f => <span key={f} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800">loses {featureLabel(f)}</span>)}
              </div>
            )}
            <button disabled={busy} onClick={() => applyTier(forceArmed && preview.blockers.length > 0)}
              className={`w-full py-2 rounded-xl text-white text-xs font-bold ${forceArmed && preview.blockers.length > 0 ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-500 hover:bg-teal-600'}`}>
              {forceArmed && preview.blockers.length > 0 ? 'Apply anyway (forced)' : `Move to ${tierLabel(preview.targetTier)}`}
            </button>
          </div>
        )}
        <p className="text-[10px] text-slate-500">Payment dates live on each part in Billing; changing the plan does not change them.</p>
      </Section>

      <Section icon={<Puzzle className="w-3.5 h-3.5" />} title={`Add-ons (${activeSubs.length})`}>
        {activeSubs.length === 0 && <p className="text-[11px] text-slate-500">No add-ons on this account.</p>}
        <div className="space-y-1.5">
          {activeSubs.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-800">{catalogName(s.addOnKey)}</div>
                <div className="text-[10px] text-slate-500">{pkr(s.pricePKR)}/mo each × {s.quantity}{s.branchId && <> · {branchName(s.branchId)}</>}</div>
              </div>
              <button disabled={busy} onClick={() => run(async () => { await posApi.revokeTenantAddOn(tenant.id, s.id); setAddOnTick(t => t + 1); }, 'Add-on removed.')}
                className="shrink-0 p-1.5 rounded-md hover:bg-rose-50 text-rose-500 transition" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="p-3 rounded-xl border border-dashed border-slate-300 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={grantKey} onChange={(e) => { setGrantKey(e.target.value); setGrantQty('1'); setGrantPrice(''); if (!MAY_NAME_SHOP.has(e.target.value)) setGrantBranchId(''); }} className={inputCls}>
              <option value="">Give an add-on…</option>
              {grantable.map(c => <option key={c.key} value={c.key}>{c.displayName} — {pkr(c.monthlyPricePKR)}/mo</option>)}
            </select>
            {MAY_NAME_SHOP.has(grantKey) && (
              <select value={grantBranchId} onChange={(e) => setGrantBranchId(e.target.value)} className={inputCls}>
                <option value="">{MUST_NAME_SHOP.has(grantKey) ? 'Pick an outlet…' : 'Every outlet'}</option>
                {branches.filter(b => b.canSell !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {HAS_QUANTITY.has(grantKey) && (
              <input type="number" min={1} value={grantQty} onChange={(e) => setGrantQty(e.target.value)} placeholder="How many" className={inputCls} />
            )}
            {grantKey && (
              <input type="number" min={0} value={grantPrice} onChange={(e) => setGrantPrice(e.target.value)} placeholder={`Price each/mo (list ${pkr(selected?.monthlyPricePKR)})`} className={inputCls} />
            )}
          </div>
          {selected?.description && <p className="text-[10px] text-slate-500">{selected.description}</p>}
          <button disabled={busy || !grantReady}
            onClick={() => run(async () => {
              await posApi.grantTenantAddOn(tenant.id, {
                addOnKey: grantKey,
                quantity: HAS_QUANTITY.has(grantKey) ? Number(grantQty) || 1 : 1,
                branchId: MAY_NAME_SHOP.has(grantKey) && grantBranchId ? grantBranchId : undefined,
                pricePKR: grantPrice ? Number(grantPrice) : undefined
              });
              setGrantKey(''); setGrantQty('1'); setGrantPrice(''); setGrantBranchId('');
              setAddOnTick(t => t + 1);
            }, 'Add-on given. It is live from the next device check-in and renews on its own date (Billing).')}
            className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">
            Give add-on
          </button>
        </div>
      </Section>

      <Section icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="Features on this account">
        <div className="flex flex-wrap gap-1.5">
          {features.map(([flag, on]) => (
            <span key={flag} title={flag} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${on ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
              {featureLabel(flag)}
            </span>
          ))}
        </div>
      </Section>

      <Section icon={<Gift className="w-3.5 h-3.5" />} title="Grants (free extras for a while)">
        {overrides.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-800">{o.key} = {o.value}{!o.inForce && <span className="ml-1.5 text-slate-400 font-normal">(lapsed)</span>}</div>
              <div className="text-[10px] text-slate-500 truncate">{o.reason} · {o.expiresAt ? `until ${dateOf(o.expiresAt)}` : 'no end date'}</div>
            </div>
            <button onClick={() => run(() => posApi.revokeOverride(o.id), 'Grant removed.')} className="shrink-0 p-1.5 rounded-md hover:bg-rose-50 text-rose-500" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <select value={overrideKey} onChange={(e) => { setOverrideKey(e.target.value); setOverrideValue(OVERRIDE_KEYS.find(o => o.value === e.target.value)?.numeric ? '1' : 'true'); }} className={inputCls}>
            {OVERRIDE_KEYS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} placeholder="Amount" className={inputCls} />
          <input type="date" value={overrideExpiry} onChange={(e) => setOverrideExpiry(e.target.value)} className={inputCls} title="Ends on" />
          <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason (required)" className={inputCls} />
        </div>
        <button disabled={busy || !overrideReason.trim()}
          onClick={() => run(() => posApi.grantOverride(tenant.id, {
            key: overrideKey, value: overrideValue,
            expiresAt: overrideExpiry ? new Date(overrideExpiry).toISOString() : undefined,
            reason: overrideReason.trim()
          }), 'Grant applied. Devices pick it up on their next check-in.')}
          className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">Grant</button>
      </Section>
    </div>
  );
};

// ── Locations & devices ────────────────────────────────────────

const LocationsTab: React.FC<{ data: TenantOverview; busy: boolean; run: Run; setMessage: SetMessage; onUpgrade: () => void }> = ({ data, busy, run, setMessage, onUpgrade }) => {
  const { tenant, branches, devices, recentLicenceEvents } = data;
  const isHQ = tenant.deploymentMode === 'HeadOffice';
  const [hqUpgrade, setHqUpgrade] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [kind, setKind] = useState<'Branch' | 'Warehouse'>('Branch');
  const [edition, setEdition] = useState(tenant.tier);
  const [blocking, setBlocking] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? '—';

  const enableHQ = async () => {
    setMessage(null);
    try {
      await posApi.enableTenantHQ(tenant.id);
      await run(async () => {}, 'Head office enabled. Outlets can now be added beneath it.');
    } catch (err) {
      const body = (err as { response?: { data?: { message?: string; upgradeRequired?: boolean } } })?.response?.data;
      if (body?.upgradeRequired) setHqUpgrade(true);
      setMessage({ tone: 'err', text: body?.message || getApiErrorMessage(err, 'Could not enable head office.') });
    }
  };

  return (
    <div className="space-y-5">
      <Section icon={<Rocket className="w-3.5 h-3.5" />} title="Shape">
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
          <span className="text-sm font-black text-slate-900">{isHQ ? 'Head office with outlets' : 'Single shop'}</span>
          <p className="mt-1">{isHQ
            ? 'The head office runs the ERP; each outlet pays for its own POS version.'
            : 'One shop: POS and back office together. A head office adds outlets that report into it.'}</p>
          <p className="mt-1">Locations: <b>{branches.length}</b> · set up by {tenant.isProviderProvisioned ? 'Cashly' : 'the owner'}</p>
        </div>
        {!isHQ && (
          <button disabled={busy} onClick={enableHQ} className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> Add a head office
          </button>
        )}
        {hqUpgrade && (
          <button onClick={onUpgrade} className="w-full py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
            Needs a bigger plan — review a plan change
          </button>
        )}
      </Section>

      <Section icon={<MapPin className="w-3.5 h-3.5" />} title={`Locations (${branches.length})`}>
        <div className="space-y-1.5">
          {branches.map(b => {
            const sells = b.canSell !== false && b.locationType !== 'Warehouse' && b.locationType !== 'HeadOffice';
            return (
              <div key={b.id} className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-800 truncate flex items-center gap-1.5">
                      {b.locationType === 'Warehouse' ? <Warehouse className="w-3 h-3 text-slate-400" /> : <Building2 className="w-3 h-3 text-slate-400" />}
                      {b.name}
                      {(b.isHeadOffice || b.locationType === 'HeadOffice') && <span className="px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 text-[9px] font-bold">HQ</span>}
                      {b.locationType === 'Warehouse' && <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[9px] font-bold">Warehouse</span>}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {b.code}{b.city ? ` · ${b.city}` : ''}{sells ? ` · tills ${b.counters}/${(b.maxCounters ?? 0) >= 9999 ? '∞' : b.maxCounters ?? '—'} · tablets ${b.tablets}/${(b.maxTablets ?? 0) >= 9999 ? '∞' : b.maxTablets ?? '—'}` : ''}
                    </div>
                  </div>
                  {sells && (
                    <select value={b.posEdition ?? tenant.tier} disabled={busy}
                      onChange={(e) => {
                        if (!window.confirm(`Change ${b.name} to ${tierLabel(e.target.value)} POS? It changes what this outlet pays and may run.`)) return;
                        run(() => posApi.setOutletPosEdition(tenant.id, b.id, e.target.value), `${b.name} now runs ${tierLabel(e.target.value)} POS.`);
                      }}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-[11px] font-semibold bg-white" title="This outlet's POS version">
                      {['Starter', 'Standard', 'Professional'].map(t => <option key={t} value={t}>{tierLabel(t)}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 rounded-xl border border-dashed border-slate-300 space-y-2">
          <div className="text-[10px] uppercase font-black text-slate-500">Add a location</div>
          {!isHQ && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">Add a head office first — outlets and warehouses sit beneath it.</p>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (required)" className={inputCls} />
          <div className="grid grid-cols-3 gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'Branch' | 'Warehouse')} className={inputCls}>
              <option value="Branch">Outlet (sells)</option>
              <option value="Warehouse">Warehouse</option>
            </select>
            {kind === 'Branch' && (
              <select value={edition} onChange={(e) => setEdition(e.target.value)} className={inputCls} title="Its POS version">
                {['Starter', 'Standard', 'Professional'].map(t => <option key={t} value={t}>{tierLabel(t)} POS</option>)}
              </select>
            )}
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputCls} />
          </div>
          <button disabled={busy || !name.trim()}
            onClick={() => run(async () => {
              await posApi.createTenantBranch(tenant.id, { name: name.trim(), city: city.trim() || undefined, locationType: kind, posEdition: kind === 'Branch' ? edition : undefined });
              setName(''); setCity('');
            }, `${kind === 'Warehouse' ? 'Warehouse' : 'Outlet'} added. It shows up on every device at its next check-in.`)}
            className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">
            Add {kind === 'Warehouse' ? 'warehouse' : 'outlet'}
          </button>
        </div>
      </Section>

      <Section icon={<Server className="w-3.5 h-3.5" />} title={`Devices (${devices.length})`}>
        {devices.length === 0 && <p className="text-[11px] text-slate-500">No devices connected yet.</p>}
        <div className="space-y-1.5">
          {devices.map(d => (
            <div key={d.id} className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 truncate">{d.terminalName}</div>
                  <div className="text-[10px] text-slate-500">{d.terminalType} · {branchName(d.branchId)} · last seen {new Date(d.lastSeenAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                    d.state === 'Valid' ? 'bg-teal-50 text-teal-700 border-teal-200' : d.state === 'Revoked' || d.state === 'Expired' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>{d.state === 'Revoked' ? 'Blocked' : d.state}</span>
                  {d.state !== 'Revoked' && d.state !== 'Retired' && (
                    <button onClick={() => { setBlocking(blocking === d.id ? null : d.id); setBlockReason(''); }} className="p-1 rounded hover:bg-rose-50 text-rose-500" title="Block this device (lost or stolen)">
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {blocking === d.id && (
                <div className="flex gap-2">
                  <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Why — e.g. tablet stolen" className={`${inputCls} bg-white`} />
                  <button disabled={busy || !blockReason.trim()}
                    onClick={() => run(async () => { await posApi.blockTenantDevice(tenant.id, d.id, blockReason.trim()); setBlocking(null); }, `${d.terminalName} is blocked.`)}
                    className="px-3 rounded-xl bg-rose-600 text-white text-[11px] font-bold disabled:opacity-40">Block</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section icon={<Activity className="w-3.5 h-3.5" />} title="Recent licence events">
        {recentLicenceEvents.length === 0 && <p className="text-[11px] text-slate-500">No licence events recorded.</p>}
        {recentLicenceEvents.map((e, i) => (
          <div key={i} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] flex items-start justify-between gap-2">
            <div className="min-w-0"><span className="font-bold text-slate-800">{e.eventType}</span>{e.detail && <span className="ml-1.5 text-slate-500">{e.detail}</span>}</div>
            <span className="shrink-0 text-slate-400 font-mono">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </Section>
    </div>
  );
};

// ── Activity: notes, follow-ups and the audit log ─────────────────

const NOTE_ICON: Record<TenantNoteKind, React.FC<{ className?: string }>> = { Note: StickyNote, Call: PhoneCall, Visit: MapPin, Promise: HandCoins };

const ActivityTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [notes, setNotes] = useState<TenantNote[]>([]);
  const [audit, setAudit] = useState<AuditLogPage | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [kind, setKind] = useState<TenantNoteKind>('Note');
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [promised, setPromised] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A follow-up is "due" against when the tab was opened, not re-read on every render.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    posApi.getTenantNotes(tenantId).then(rows => { if (!cancelled) setNotes(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  useEffect(() => {
    let cancelled = false;
    posApi.getAuditLog({ tenantId, page: auditPage, pageSize: 25 })
      .then(res => { if (!cancelled) setAudit(res); })
      .catch(() => { if (!cancelled) setAudit(null); });
    return () => { cancelled = true; };
  }, [tenantId, auditPage]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); setTick(t => t + 1); }
    catch (err) { setError(getApiErrorMessage(err, 'That did not work.')); }
    finally { setBusy(false); }
  };

  const add = () => act(async () => {
    await posApi.addTenantNote(tenantId, {
      kind, body: body.trim(),
      followUpAt: followUp ? `${followUp}T09:00:00` : undefined,
      promisedAmountPKR: kind === 'Promise' && promised ? Number(promised) : undefined
    });
    setBody(''); setFollowUp(''); setPromised('');
  });

  return (
    <div className="space-y-5">
      <Section icon={<StickyNote className="w-3.5 h-3.5" />} title="Notes and follow-ups">
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
          <div className="flex gap-1.5">
            {(['Note', 'Call', 'Visit', 'Promise'] as TenantNoteKind[]).map(k => {
              const Icon = NOTE_ICON[k];
              return (
                <button key={k} onClick={() => setKind(k)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 ${kind === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                  <Icon className="w-3 h-3" /> {k === 'Promise' ? 'Promise to pay' : k}
                </button>
              );
            })}
          </div>
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'Promise' ? 'e.g. Owner will transfer on Friday' : 'What happened?'} className={`${inputCls} bg-white resize-none`} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">{kind === 'Promise' ? 'Promised by' : 'Follow up on (optional)'}</label>
              <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={`${inputCls} bg-white`} />
            </div>
            {kind === 'Promise' && (
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">Amount (PKR)</label>
                <input type="number" min={0} value={promised} onChange={(e) => setPromised(e.target.value)} className={`${inputCls} bg-white`} />
              </div>
            )}
          </div>
          {kind === 'Promise' && <p className="text-[10px] text-slate-500">While the date is ahead, unpaid parts of this business are not stopped automatically.</p>}
          <button disabled={busy || !body.trim() || (kind === 'Promise' && !followUp)} onClick={add}
            className="w-full py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white text-xs font-bold">Save note</button>
        </div>
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
        <div className="space-y-1.5">
          {notes.length === 0 && <p className="text-[11px] text-slate-500">No notes yet.</p>}
          {notes.map(n => {
            const Icon = NOTE_ICON[n.kind] ?? StickyNote;
            const due = n.followUpAt && !n.doneAt && new Date(n.followUpAt).getTime() < openedAt;
            return (
              <div key={n.id} className={`px-3 py-2 rounded-lg border text-[11px] ${n.doneAt ? 'bg-slate-50 border-slate-200 opacity-60' : due ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 flex items-center gap-1.5"><Icon className="w-3 h-3" />{n.kind === 'Promise' ? `Promise to pay${n.promisedAmountPKR ? ` ${pkr(n.promisedAmountPKR)}` : ''}` : n.kind}</div>
                    <div className="text-slate-700 whitespace-pre-line">{n.body}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {n.authorName} · {dateOf(n.createdAt)}{n.followUpAt && ` · ${n.kind === 'Promise' ? 'by' : 'follow up'} ${dateOf(n.followUpAt)}`}{n.doneAt && ' · done'}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {n.followUpAt && (
                      <button disabled={busy} onClick={() => act(() => posApi.updateTenantNote(n.id, { done: !n.doneAt }))}
                        className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold">{n.doneAt ? 'Reopen' : 'Done'}</button>
                    )}
                    <button disabled={busy} onClick={() => { if (window.confirm('Delete this note?')) act(() => posApi.deleteTenantNote(n.id)); }}
                      className="p-1 rounded hover:bg-rose-50 text-rose-400" title="Delete"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon={<History className="w-3.5 h-3.5" />} title={`Audit log${audit ? ` (${audit.total})` : ''}`}>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {(audit?.entries ?? []).map(e => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 text-[10px] font-mono text-slate-400 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{e.userName || '—'}</td>
                  <td className="px-3 py-2"><span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-700">{e.action}</span></td>
                  <td className="px-3 py-2 text-[11px] text-slate-600">
                    {e.oldValue && <span className="text-rose-500 line-through">{e.oldValue.slice(0, 80)}</span>}
                    {e.oldValue && e.newValue && ' → '}
                    {e.newValue && <span className="text-teal-700">{e.newValue.slice(0, 120)}</span>}
                  </td>
                </tr>
              ))}
              {audit && audit.entries.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-slate-500">No audit entries yet</td></tr>}
            </tbody>
          </table>
        </div>
        {audit && audit.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <button onClick={() => setAuditPage(Math.max(1, audit.page - 1))} disabled={audit.page <= 1} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-bold disabled:opacity-40">Previous</button>
            <span className="text-[10px] font-mono text-slate-500">{audit.page} / {audit.totalPages}</span>
            <button onClick={() => setAuditPage(Math.min(audit.totalPages, audit.page + 1))} disabled={audit.page >= audit.totalPages} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-bold disabled:opacity-40">Next</button>
          </div>
        )}
      </Section>
    </div>
  );
};

// ── Shared shell ──────────────────────────────────────────────

const Shell: React.FC<{ title: string; subtitle?: string; nav?: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ title, subtitle, nav, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
    <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
      <div className="sticky top-0 bg-white border-b border-slate-200 z-10">
        <div className="px-5 py-3.5 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900 truncate">{title}</h2>
            {subtitle && <p className="text-[10px] text-slate-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition"><X className="w-4 h-4" /></button>
        </div>
        {nav && <div className="px-5 pb-3 flex gap-1 overflow-x-auto">{nav}</div>}
      </div>
      <div className="p-5 flex-1">{children}</div>
    </div>
  </div>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="space-y-2">
    <div className="text-[10px] uppercase font-black text-slate-500 tracking-wider flex items-center gap-1.5">{icon} {title}</div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }> = ({ label, value, tone }) => (
  <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
    <div className="text-[10px] uppercase font-semibold text-slate-500">{label}</div>
    <div className={`text-sm font-black capitalize ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-teal-600' : 'text-slate-900'}`}>{value}</div>
  </div>
);

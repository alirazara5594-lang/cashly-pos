import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Rocket } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { useToast } from './Toast';
import type { OnboardingStatus } from '../types';

/**
 * The owner's first-days checklist: confirm the email, add the menu, add staff, connect a till,
 * ring up a test sale. Shown above every screen until it is all done or the owner hides it.
 *
 * Hiding and collapsing are remembered per business on this browser only — a convenience, not a
 * setting: a cleared browser simply shows the checklist again.
 */

const hiddenKey = (tenantId: string) => `cashly_getting_started_hidden_${tenantId}`;
const collapsedKey = (tenantId: string) => `cashly_getting_started_collapsed_${tenantId}`;

const readFlag = (key: string) => {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch { /* optional */ }
};

interface Step {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  /** Where to go to do it, when it is done somewhere else. */
  to?: string;
  state?: unknown;
  /** Or a button that does it here. */
  action?: React.ReactNode;
}

export const GettingStarted: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const location = useLocation();
  const { addToast } = useToast();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [hidden, setHidden] = useState(() => readFlag(hiddenKey(tenantId)));
  const [collapsed, setCollapsed] = useState(() => readFlag(collapsedKey(tenantId)));
  const [sending, setSending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Bumped to re-read the status after something here changed it.
  const [refreshTick, setRefreshTick] = useState(0);

  // Re-read on every screen change, so adding a menu item or a staff member ticks its step off.
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    posApi.getOnboardingStatus()
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { /* the checklist is optional; leave it as it was */ });
    return () => { cancelled = true; };
  }, [hidden, location.pathname, refreshTick]);

  if (hidden || !status) return null;

  const sendLink = async () => {
    setSending(true);
    try {
      const res = await posApi.sendEmailConfirmation();
      if (!res.emailEnabled) addToast('Email sending is not set up on this server yet.', 'info');
      else addToast(res.message ?? 'Check your inbox for the link.', 'success', 7000);
      setRefreshTick(t => t + 1);
    } catch (err) {
      addToast(getApiErrorMessage(err, 'Could not send the link. Try again in a moment.'), 'error');
    } finally {
      setSending(false);
    }
  };

  const removeSample = async () => {
    setRemoving(true);
    try {
      const res = await posApi.removeSampleMenu();
      addToast(res.message, 'success', 7000);
      setConfirmRemove(false);
      setRefreshTick(t => t + 1);
    } catch (err) {
      addToast(getApiErrorMessage(err, 'Could not remove the sample menu.'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  const linkButton = 'px-2.5 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[11px] font-bold transition';
  const quietButton = 'px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[11px] font-semibold transition disabled:opacity-50';

  const steps: Step[] = [
    {
      key: 'email',
      label: 'Confirm your email',
      hint: status.emailConfirmed
        ? `${status.email ?? 'Your email'} is confirmed.`
        : status.emailEnabled
          ? `We send a link to ${status.email ?? 'your email'}. It also lets you reset a forgotten password.`
          : 'Email sending is not set up on this server yet.',
      done: status.emailConfirmed,
      action: status.emailEnabled && !status.emailConfirmed ? (
        <button type="button" onClick={sendLink} disabled={sending} className={quietButton}>
          {sending ? 'Sending…' : 'Send link'}
        </button>
      ) : undefined
    },
    // A head office sells nothing itself: tills, staff and sales all need an outlet first.
    ...(status.hasHeadOffice ? [{
      key: 'outlet',
      label: 'Add your first outlet',
      hint: (status.outlets ?? 0) > 0
        ? `${status.outlets} outlet${status.outlets === 1 ? '' : 's'} set up.`
        : 'The restaurant, café or shop that sells. Each one gets its own tills and stock.',
      done: (status.outlets ?? 0) > 0,
      to: '/locations'
    }] : []),
    {
      key: 'menu',
      label: 'Add your menu items',
      hint: status.ownMenuItems > 0
        ? `${status.ownMenuItems} item${status.ownMenuItems === 1 ? '' : 's'} on your menu.`
        : status.sampleMenuItems > 0
          ? 'You are trying Cashly with the sample menu. Add your own items, then remove it.'
          : 'Items, prices and categories. Your tills show them straight away.',
      done: status.ownMenuItems > 0,
      to: '/menu',
      action: status.sampleMenuItems > 0 ? (
        confirmRemove ? (
          <span className="flex items-center gap-1.5">
            <button type="button" onClick={removeSample} disabled={removing} className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-bold transition disabled:opacity-50">
              {removing ? 'Removing…' : 'Yes, remove it'}
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className={quietButton}>Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)} className={quietButton}>
            Remove sample menu
          </button>
        )
      ) : undefined
    },
    {
      key: 'staff',
      label: 'Add your staff and their PINs',
      hint: status.staff > 0
        ? `${status.staff} staff member${status.staff === 1 ? '' : 's'} added.`
        : 'Cashiers and waiters sign in on a till with just their PIN.',
      done: status.staff > 0,
      to: '/users'
    },
    {
      key: 'device',
      label: status.hasHeadOffice ? 'Connect your first outlet\'s till' : 'Connect your first till or tablet',
      hint: status.devices > 0
        ? `${status.devices} device${status.devices === 1 ? '' : 's'} connected.`
        : status.hasHeadOffice
          ? 'Pick the outlet, make a pairing code, then open Connect a till or tablet on that device.'
          : 'Make a pairing code here, then open Connect a till or tablet on that device.',
      done: status.devices > 0,
      to: '/settings',
      state: { tab: 'provisioning' }
    },
    {
      key: 'sale',
      label: 'Make a test sale',
      hint: status.hasSale
        ? 'Your first sale is in. You are ready to trade.'
        : status.hasHeadOffice
          ? 'Ring one up on a branch till to see it reach your reports.'
          : 'Ring one up on the till to see it reach your reports.',
      done: status.hasSale,
      to: status.hasHeadOffice ? undefined : '/'
    }
  ];

  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  const hide = () => {
    writeFlag(hiddenKey(tenantId), true);
    setHidden(true);
  };
  const toggle = () => {
    writeFlag(collapsedKey(tenantId), !collapsed);
    setCollapsed(c => !c);
  };

  return (
    <section className="px-4 py-2.5 bg-white border-b border-slate-200" aria-label="Getting started">
      <div className="flex items-center gap-3">
        <Rocket className="w-4 h-4 text-teal-600 shrink-0" />
        <button type="button" onClick={toggle} className="flex-1 min-w-0 flex items-center gap-3 text-left">
          <span className="text-xs font-bold text-slate-900 shrink-0">Getting started</span>
          <span className="text-[11px] text-slate-500 shrink-0">{doneCount} of {steps.length} done</span>
          <span className="hidden sm:block flex-1 max-w-48 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <span className="block h-full bg-teal-500 rounded-full transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />}
        </button>
        <button type="button" onClick={hide} title="Hide the checklist" className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed && (
        <ol className="mt-2 grid gap-1.5">
          {steps.map(step => (
            <li key={step.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-100">
              {step.done
                ? <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                : <Circle className="w-4 h-4 text-slate-300 shrink-0" />}
              <div className="flex-1 min-w-48">
                <div className={`text-xs font-semibold ${step.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{step.label}</div>
                <div className="text-[11px] text-slate-500">{step.hint}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {step.action}
                {!step.done && step.to && (
                  <Link to={step.to} state={step.state} className={linkButton}>Open</Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

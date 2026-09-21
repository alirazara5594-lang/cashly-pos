import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CreditCard, WifiOff, ShieldAlert } from 'lucide-react';
import type { DeviceStatus } from '../services/deviceLicense';
import type { MyPackageInfo } from '../types';

interface AccountStatusBannerProps {
  packageInfo: MyPackageInfo | null;
  deviceStatus: DeviceStatus | null;
}

/**
 * The one place the app tells a shop that something is wrong with its account or its device.
 *
 * Both of the things it reports are graduated on purpose: an overdue invoice does not stop the
 * till, and an unreachable server does not stop the till either. A banner that says "you have
 * eleven days to sort this out" is worth far more than a hard block, because the shop keeps
 * trading and the operator keeps a customer.
 *
 * Only the most severe condition is shown — stacking three warnings trains people to ignore all
 * three.
 */
export const AccountStatusBanner: React.FC<AccountStatusBannerProps> = ({ packageInfo, deviceStatus }) => {
  // 1. Device licence problems come first: they stop this machine working, which is more
  //    immediate to the person standing at it than a billing state affecting the whole business.
  if (deviceStatus && deviceStatus.state !== 'Valid' && deviceStatus.state !== 'Unactivated') {
    if (deviceStatus.state === 'Grace') {
      return (
        <Banner tone="amber" icon={<WifiOff className="w-4 h-4" />}>
          <strong>This till has not reached the server recently.</strong>{' '}
          {deviceStatus.reason ?? 'It will keep selling, but reconnect it soon.'}
        </Banner>
      );
    }
    return (
      <Banner tone="rose" icon={<ShieldAlert className="w-4 h-4" />}>
        <strong>This device cannot take sales.</strong>{' '}
        {deviceStatus.reason ?? 'Its licence is no longer valid.'}
        {deviceStatus.mustReactivate && (
          <>
            {' '}
            <Link to="/setup" className="underline font-semibold">Activate this device</Link>
          </>
        )}
      </Banner>
    );
  }

  if (!packageInfo) return null;

  // 2. Billing state, worst first.
  if (packageInfo.status === 'Suspended' || packageInfo.status === 'Cancelled') {
    return (
      <Banner tone="rose" icon={<AlertTriangle className="w-4 h-4" />}>
        <strong>This account is {packageInfo.status === 'Cancelled' ? 'closed' : 'suspended'}.</strong>{' '}
        Please contact support to restore access.
      </Banner>
    );
  }

  if (packageInfo.status === 'ReadOnly') {
    return (
      <Banner tone="rose" icon={<CreditCard className="w-4 h-4" />}>
        <strong>New sales are paused.</strong> Your account is read-only until payment is received.
        Your data is still available to view and export.
      </Banner>
    );
  }

  if (packageInfo.status === 'Restricted') {
    return (
      <Banner tone="amber" icon={<CreditCard className="w-4 h-4" />}>
        <strong>Changes are paused on your account.</strong> The POS is still selling and your
        reports are still available — settings and catalogue edits resume once payment is received.
      </Banner>
    );
  }

  if (packageInfo.status === 'PastDue') {
    return (
      <Banner tone="amber" icon={<CreditCard className="w-4 h-4" />}>
        <strong>Payment overdue.</strong> Everything is still working. Please settle your invoice
        to avoid interruption.
      </Banner>
    );
  }

  // 3. Trial running out. Only worth saying in the last week — earlier than that it is noise.
  if (packageInfo.status === 'Trial' && packageInfo.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(packageInfo.trialEndsAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= 7) {
      return (
        <Banner tone="teal" icon={<CreditCard className="w-4 h-4" />}>
          <strong>
            {daysLeft <= 0 ? 'Your trial has ended.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your trial.`}
          </strong>{' '}
          Choose a plan to keep everything running.
        </Banner>
      );
    }
  }

  return null;
};

const TONES = {
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  rose: 'bg-rose-50 border-rose-200 text-rose-800',
  teal: 'bg-teal-50 border-teal-200 text-teal-800'
} as const;

const Banner: React.FC<{ tone: keyof typeof TONES; icon: React.ReactNode; children: React.ReactNode }> = ({
  tone, icon, children
}) => (
  <div className={`px-4 py-2.5 border-b text-xs flex items-center gap-2.5 ${TONES[tone]}`} role="status">
    <span className="shrink-0">{icon}</span>
    <span className="leading-relaxed">{children}</span>
  </div>
);

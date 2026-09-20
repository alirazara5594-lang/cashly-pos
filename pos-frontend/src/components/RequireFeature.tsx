import React from 'react';
import { Link } from 'react-router-dom';
import { Lock, Puzzle } from 'lucide-react';
import { usePosStore } from '../store/posStore';
import type { EffectivePackageFeatures } from '../types';

interface RequireFeatureProps {
  /** Which flag on the tenant's effective (tier + add-on merged) feature set must be true. */
  flag: keyof EffectivePackageFeatures;
  /** Shown in the upsell message, e.g. "Kitchen Display". */
  label: string;
  children: React.ReactNode;
}

/**
 * Route guard for screens gated by subscription tier or a standalone add-on (mirrors
 * RequireModule.tsx, but checks plan/add-on entitlement instead of a staff permission).
 *
 * This is UI feedback, not security: the backend's RequireFeatureFilter enforces the same
 * tier-OR-add-on rule on every request, so a bypassed guard still gets a 403 from the API.
 * While `packageFeatures` hasn't loaded yet (still null on first render), this renders the
 * screen rather than blocking it — the API call underneath will 403 if it's truly not entitled,
 * which is safer than flashing an "Access Denied" a moment before the real answer arrives.
 */
export const RequireFeature: React.FC<RequireFeatureProps> = ({ flag, label, children }) => {
  const packageFeatures = usePosStore(s => s.packageFeatures);

  if (packageFeatures && !packageFeatures[flag]) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 min-h-[60vh]">
        <div className="max-w-md w-full text-center space-y-4 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
            <Lock className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-black text-slate-900">Not on your plan</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              <strong className="text-slate-700">{label}</strong> isn't included in your current subscription.
              An owner can upgrade the plan, or buy it standalone as an add-on.
            </p>
          </div>
          <Link
            to="/my-addons"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition"
          >
            <Puzzle className="w-3.5 h-3.5" />
            View Add-ons
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

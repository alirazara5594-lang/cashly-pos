import React from 'react';
import { Link } from 'react-router-dom';
import { Store, Ban } from 'lucide-react';
import { useSector, type SectorFeature } from '../hooks/useSector';

interface RequireSectorProps {
  /** The capability the screen belongs to. */
  feature: SectorFeature;
  /** Shown in the message, e.g. "Floors & Tables". */
  label: string;
  children: React.ReactNode;
}

/**
 * Route guard for screens that belong to one kind of business — tables and the kitchen to a
 * restaurant, never to a pharmacy or a shop. Unlike a plan feature, this is not something to buy:
 * the screen simply is not part of this business, so the way out is back to its own work.
 *
 * UI feedback, not security: the server's SectorGuard refuses the same changes (Program.cs).
 */
export const RequireSector: React.FC<RequireSectorProps> = ({ feature, label, children }) => {
  const sector = useSector();

  if (!sector[feature]) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 min-h-[60vh]">
        <div className="max-w-md w-full text-center space-y-4 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mx-auto">
            <Ban className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold text-slate-900">Not part of this business</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              <strong className="text-slate-700">{label}</strong> belongs to restaurants, so it isn't part of
              a {sector.name.toLowerCase()} business.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition"
          >
            <Store className="w-4 h-4" />
            Back to the register
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

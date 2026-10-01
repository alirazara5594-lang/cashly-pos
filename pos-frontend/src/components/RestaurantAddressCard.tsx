import React, { useState } from 'react';
import { Globe, Copy, Check, ExternalLink } from 'lucide-react';
import { restaurantSignInLink } from '../services/restaurantAddress';

/**
 * A restaurant's own sign-in address, to hand to its staff: they open it and sign in with just
 * username + PIN, and connect tills from it with a pairing code.
 */
export const RestaurantAddressCard: React.FC<{ webName: string }> = ({ webName }) => {
  const [copied, setCopied] = useState(false);
  const link = restaurantSignInLink(webName);

  return (
    <div className="p-4 rounded-2xl bg-teal-50 border border-teal-200 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <Globe className="w-5 h-5 text-teal-600 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-teal-800">Your restaurant's sign-in address</div>
          <div className="text-sm font-mono font-bold text-slate-900 truncate">{link.replace(/^https?:\/\//, '')}</div>
          <div className="text-[11px] text-teal-800">
            Send it to your staff — they sign in there with just their username and PIN.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }).catch(() => {});
          }}
          className="px-3 py-2 rounded-xl bg-white border border-teal-200 text-teal-700 text-xs font-bold flex items-center gap-1.5 hover:bg-teal-100 transition"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded-xl bg-white border border-teal-200 text-teal-700 text-xs font-bold flex items-center gap-1.5 hover:bg-teal-100 transition"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open
        </a>
      </div>
    </div>
  );
};

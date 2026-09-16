import React, { useState } from 'react';
import { KeyRound, X, ShieldCheck } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import type { OverridePermissionKey } from '../types';

export interface ManagerOverrideResult {
  authorizedByUserId?: string;
  authorizedByName?: string;
}

interface ManagerOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Permission the authorizing user must hold, e.g. 'canManageMenuAndTax'. */
  requiredPermission: OverridePermissionKey | null;
  /** Short human description of what is being authorized, shown in the modal. */
  actionLabel: string;
  onAuthorized: (result: ManagerOverrideResult) => void;
}

/**
 * Manager Override prompt.
 *
 * When the signed-in user lacks a permission, another user (typically a manager)
 * can authorize a single action by entering their own username + PIN — without
 * the current user being logged out. The server verifies both the PIN and that
 * the authorizing account actually holds `requiredPermission`; unlocking the UI
 * here does not bypass that check.
 */
export const ManagerOverrideModal: React.FC<ManagerOverrideModalProps> = ({
  isOpen,
  onClose,
  requiredPermission,
  actionLabel,
  onAuthorized
}) => {
  const [username, setUsername] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset the form the moment the modal opens. Adjusting state during render
  // (rather than in an effect) avoids a cascading second render.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setUsername('');
      setPinCode('');
      setError('');
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !pinCode.trim() || loading) return;

    setLoading(true);
    setError('');
    try {
      const result = await posApi.verifyManagerPin(username.trim(), pinCode.trim(), requiredPermission);
      if (result?.authorized) {
        onAuthorized({
          authorizedByUserId: result.authorizedByUserId,
          authorizedByName: result.authorizedByName
        });
        onClose();
      } else {
        setError('That account is not authorized for this action.');
        setPinCode('');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Verification failed — check the username and PIN.'));
      setPinCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Manager Override Required</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{actionLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
            <span>
              An authorized colleague enters their credentials below. You stay signed in —
              the override applies to this one action and is recorded against their account.
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Authorizing Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              autoFocus
              placeholder="Manager username"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinCode}
              onChange={(e) => { setPinCode(e.target.value); setError(''); }}
              placeholder="••••"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center text-lg tracking-[0.4em] font-mono text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !username.trim() || !pinCode.trim()}
              className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold text-xs transition cursor-pointer"
            >
              {loading ? 'Verifying…' : 'Authorize'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

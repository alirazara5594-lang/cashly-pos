import React, { useState } from 'react';
import { Key, ShieldCheck, Store, Delete } from 'lucide-react';
import { posApi, getApiErrorMessage, getApiErrorStatus } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { AuthPermissions, CurrentUser } from '../types';

const EMPTY_PERMISSIONS: AuthPermissions = {
  canViewFinancialReports: false,
  canManageInventory: false,
  canManageMenuAndTax: false,
  canGiveDiscounts: false,
  canVoidOrders: false
};

/**
 * Mandatory full-screen PIN login.
 *
 * Rendered by App.tsx after the `/setup` installation check but BEFORE the route
 * tree, so no screen is reachable by URL without an authenticated session. The
 * backend independently rejects unauthenticated calls — this is the UI half.
 */
export const LoginGate: React.FC = () => {
  const login = usePosStore(s => s.login);
  const loadMyModulePermissions = usePosStore(s => s.loadMyModulePermissions);
  const selectedTenant = usePosStore(s => s.selectedTenant);
  const selectedBranch = usePosStore(s => s.selectedBranch);

  const [username, setUsername] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPlatformLogin, setIsPlatformLogin] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username.trim() || !pinCode.trim() || loading) return;

    setLoading(true);
    setError('');
    try {
      const result = isPlatformLogin
        ? await posApi.superAdminLogin(username.trim(), pinCode.trim())
        : await posApi.login(username.trim(), pinCode.trim());

      const user = result?.user as (CurrentUser & { permissions?: AuthPermissions }) | undefined;
      const token = result?.token as string | undefined;

      if (!user || !token) {
        setError('Invalid username or PIN');
        setPinCode('');
        return;
      }

      const { permissions, ...identity } = user;
      login(identity as CurrentUser, token, permissions ?? EMPTY_PERMISSIONS);

      // Pull the caller's real ModulePermission rows so the sidebar and route
      // guards reflect what this specific user was granted.
      await loadMyModulePermissions();
    } catch (err) {
      setError(getApiErrorMessage(
        err,
        getApiErrorStatus(err) === 401
          ? 'Invalid username or PIN'
          : 'Login failed — check your connection'
      ));
      setPinCode('');
    } finally {
      setLoading(false);
    }
  };

  const pressKey = (val: string | number) => {
    setError('');
    if (val === 'clear') {
      setPinCode('');
    } else if (val === 'back') {
      setPinCode(prev => prev.slice(0, -1));
    } else {
      setPinCode(prev => (prev.length >= 6 ? prev : prev + String(val)));
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-purple-600 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-teal-500/25">
            C
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Cashly <span className="text-teal-600">POS</span>
            </h1>
            <p className="text-[11px] text-slate-500 font-semibold flex items-center justify-center gap-1.5 mt-1">
              <Store className="w-3.5 h-3.5 text-teal-600" />
              {selectedTenant?.name || 'Restaurant'}
              {selectedBranch?.name ? ` • ${selectedBranch.name}` : ''}
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold text-slate-900">
                {isPlatformLogin ? 'Platform Admin Sign In' : 'Staff Sign In'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setIsPlatformLogin(!isPlatformLogin); setError(''); }}
              className="text-[10px] text-blue-600 hover:text-blue-500 font-bold transition cursor-pointer"
            >
              {isPlatformLogin ? '← Staff' : 'Platform Admin →'}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Sign in is required. Every screen and report is tied to your account and
            the permissions assigned to you.
          </p>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              autoFocus
              autoComplete="username"
              placeholder="e.g. ali.cashier"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              PIN Code
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinCode}
              onChange={(e) => { setPinCode(e.target.value); setError(''); }}
              autoComplete="current-password"
              placeholder="••••"
              className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-2xl tracking-[0.5em] font-mono text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          {/* Touch keypad for counter terminals */}
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => pressKey(n)}
                className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm transition cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => pressKey('clear')}
              className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-rose-600 font-bold text-[11px] transition cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => pressKey(0)}
              className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm transition cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => pressKey('back')}
              className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition flex items-center justify-center cursor-pointer"
              title="Backspace"
            >
              <Delete className="w-4 h-4" />
            </button>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !pinCode.trim()}
            className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <Key className="w-4 h-4" />
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div className="text-center pt-1">
            <a href="/signup" className="text-[10px] text-slate-400 hover:text-blue-600 transition font-semibold">
              New restaurant? Register here →
            </a>
          </div>
        </form>
      </div>
    </div>
  );
};

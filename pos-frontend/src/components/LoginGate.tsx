import React, { useEffect, useState } from 'react';
import { Key, ShieldCheck, Store, Delete, MapPin, ArrowLeft, Mail, Eye, EyeOff, Monitor, Building2, Warehouse } from 'lucide-react';
import { posApi, getApiErrorMessage, getApiErrorStatus } from '../services/api';
import { getCachedStatus, getDeviceFingerprint, getStoredLicense, getStoredTerminal, isActivated } from '../services/deviceLicense';
import { useNavigate } from 'react-router-dom';
import { currentRestaurantAddress, isPlatformAdminAddress, restaurantSignInLink } from '../services/restaurantAddress';
import { usePosStore, LOGIN_BRANCH_KEY } from '../store/posStore';
import type { AuthPermissions, CurrentUser, LoginResponse, MyBranch } from '../types';

/** The restaurant last signed in to on this device (username sign-in), typed once per device. */
const RESTAURANT_KEY = 'cashly_restaurant';
/** The email last used for the back office on this device. */
const EMAIL_KEY = 'cashly_login_email';

const readSaved = (key: string) => {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
};
const save = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* optional */ }
};

const EMPTY_PERMISSIONS: AuthPermissions = {
  canViewFinancialReports: false,
  canManageInventory: false,
  canManageMenuAndTax: false,
  canGiveDiscounts: false,
  canVoidOrders: false
};

type SignedInUser = CurrentUser & { permissions?: AuthPermissions };

/**
 * How someone signs in here — the way Toast does it:
 *  - till:     a till, tablet or kitchen screen paired to a branch. The PIN alone; the device
 *              already knows the restaurant and branch.
 *  - email:    the back office on any browser or office PC. Email + password; no restaurant name.
 *  - username: username + PIN. At a restaurant's own address (its subdomain, or its /r/ link) the
 *              restaurant is known; elsewhere it is asked for only when that username exists at
 *              more than one restaurant.
 *  - platform: Cashly's own platform admin.
 */
type Mode = 'till' | 'email' | 'username' | 'platform';

/** Signed in, but works at more than one location and has not said which one yet. */
interface PendingBranchChoice {
  user: SignedInUser;
  token: string;
  branches: MyBranch[];
}

const inputClass = 'w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';
const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

/**
 * Mandatory full-screen sign-in. The first screen for anyone signed out — including a visitor
 * from the website's Demo button, who registers from the button at the bottom. Rendered by
 * App.tsx BEFORE the route tree, so no screen is reachable by URL without a session; the backend
 * independently rejects unauthenticated calls — this is the UI half.
 *
 * After an email or username sign-in, someone who works at more than one location chooses the
 * branch, from the locations they are allowed at. A till always signs in at its own branch.
 */
/** Head office first, then the outlets, then any warehouse. */
const locationRank = (b: MyBranch) =>
  b.isHeadOffice || b.locationType === 'HeadOffice' ? 0 : b.locationType === 'Warehouse' ? 2 : 1;

/** What choosing a location opens, in the words used at registration (Cashly POS + ERP). */
const locationKind = (b: MyBranch) => {
  if (b.isHeadOffice || b.locationType === 'HeadOffice')
    return { icon: Building2, label: 'Head Office', opens: b.canSell ? 'ERP + POS' : 'ERP', hint: 'menu, buying, stock, accounts, reports' };
  if (b.locationType === 'Warehouse')
    return { icon: Warehouse, label: 'Warehouse', opens: 'Stock', hint: 'receive, count and transfer stock' };
  return { icon: Store, label: 'Outlet', opens: 'POS', hint: 'till, orders and the outlet back office' };
};

export const LoginGate: React.FC = () => {
  const navigate = useNavigate();
  const login = usePosStore(s => s.login);
  const loadMyModulePermissions = usePosStore(s => s.loadMyModulePermissions);
  const selectedTenant = usePosStore(s => s.selectedTenant);

  // A till is paired to one branch and signs its staff in there, so every sale lands at that
  // branch. An office PC is not a till: it signs in like any browser.
  const terminal = isActivated() ? getStoredTerminal() : null;
  const tillBranchId = terminal && terminal.type !== 'BackOffice' ? terminal.branchId : null;
  const tillBranchName = tillBranchId ? getCachedStatus().branchName ?? null : null;

  // A restaurant's own sign-in address: its subdomain, or the /r/<name> link this device opened.
  // The restaurant is known there, so its staff give just username + PIN.
  const [address, setAddress] = useState(() => currentRestaurantAddress());
  const [addressInfo, setAddressInfo] = useState<{ webName: string; name: string | null; product?: string; missing?: boolean } | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    posApi.getRestaurantByWebName(address.webName)
      .then(r => { if (!cancelled) setAddressInfo({ webName: address.webName, name: r.name, product: r.product }); })
      .catch(err => { if (!cancelled) setAddressInfo({ webName: address.webName, name: null, missing: getApiErrorStatus(err) === 404 }); });
    return () => { cancelled = true; };
  }, [address]);
  const restaurantHere = address && addressInfo?.webName === address.webName ? addressInfo : null;
  const showPlatformAdmin = !address && isPlatformAdminAddress();

  const [mode, setMode] = useState<Mode>(tillBranchId ? 'till' : currentRestaurantAddress() ? 'username' : 'email');
  const [email, setEmail] = useState(() => readSaved(EMAIL_KEY));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Username sign-in asks only for username + PIN. The restaurant is asked for only when the server
  // says that username exists at more than one restaurant (every business may have an "admin").
  const [restaurant, setRestaurant] = useState(() => readSaved(RESTAURANT_KEY));
  const [restaurantNeeded, setRestaurantNeeded] = useState(false);
  const [username, setUsername] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [error, setError] = useState('');
  const [deviceNotConnected, setDeviceNotConnected] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingBranchChoice | null>(null);
  // Password (or PIN) right, 2-step sign-in on: the code from the authenticator app comes next.
  const [twoFactor, setTwoFactor] = useState<{ challenge: string; via: 'email' | 'username' } | null>(null);
  const [code, setCode] = useState('');
  const [forgotState, setForgotState] = useState<{ sending: boolean; message?: string; noEmail?: boolean }>({ sending: false });

  const typedRestaurant = restaurant.trim();
  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPinCode('');
    setDeviceNotConnected(false);
    setShowForgot(false);
  };

  // "Not Royal Grill?" — off that restaurant's /r/ link, back to the main sign-in (a subdomain
  // always means its own restaurant, so it has no such link).
  const leaveRestaurantAddress = () => {
    navigate('/', { replace: true });
    setAddress(null);
    setAddressInfo(null);
    switchMode(tillBranchId ? 'till' : 'email');
  };

  // Where "the other restaurant's address" links go when someone signs in at the wrong one.
  const [otherAddress, setOtherAddress] = useState<string | null>(null);

  /** Hand the session to the app, remembering the branch for next time. */
  const finish = async (user: SignedInUser, token: string, permissions: AuthPermissions | undefined, branchId?: string | null) => {
    if (branchId) save(LOGIN_BRANCH_KEY, branchId);
    const identity: CurrentUser = {
      id: user.id, fullName: user.fullName, username: user.username, role: user.role,
      tenantId: user.tenantId, branchId: user.branchId, homeBranchId: user.homeBranchId
    };
    login(identity, token, permissions ?? EMPTY_PERMISSIONS);
    // Pull the caller's real ModulePermission rows so the sidebar and route
    // guards reflect what this specific user was granted.
    await loadMyModulePermissions();
  };

  /** Email and username sign-ins: straight in, or choose a branch first if they work at several. */
  const continueAfterSignIn = async (result: LoginResponse) => {
    const user = result.user as SignedInUser;
    const branches = (await posApi.getMyBranches().catch(() => [] as MyBranch[]))
      // Head office first, then the outlets, then any warehouse (the server sorts too; an older one did not).
      .sort((a, b) => locationRank(a) - locationRank(b));
    if (branches.length > 1) {
      setPending({ user, token: result.token, branches });
      return;
    }
    await finish(user, result.token, user.permissions, branches[0]?.id ?? null);
  };

  const ready =
    mode === 'till' ? /^\d{4,6}$/.test(pinCode)
      : mode === 'email' ? !!email.trim() && !!password
      : mode === 'username' ? !!username.trim() && !!pinCode.trim() && (!!address || !restaurantNeeded || !!typedRestaurant)
      : !!username.trim() && !!pinCode.trim();

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ready || loading) return;
    setLoading(true);
    setError('');
    setDeviceNotConnected(false);
    setOtherAddress(null);
    try {
      if (mode === 'till') {
        const license = getStoredLicense();
        if (!license) {
          setDeviceNotConnected(true);
          setError('This device is not connected to a branch any more.');
          return;
        }
        const result = await posApi.pinLogin(pinCode.trim(), license, getDeviceFingerprint());
        await finish(result.user as SignedInUser, result.token, (result.user as SignedInUser).permissions, tillBranchId);
        return;
      }
      if (mode === 'email') {
        // At a restaurant's own address only that restaurant's people sign in.
        const result = await posApi.emailLogin(email.trim(), password, address?.webName);
        save(EMAIL_KEY, email.trim());
        if (result.twoFactorRequired && result.challenge) {
          setTwoFactor({ challenge: result.challenge, via: 'email' });
          setCode('');
          return;
        }
        await continueAfterSignIn(result);
        return;
      }
      if (mode === 'username') {
        // On a till this still signs in at the till's branch, so its sales land there. The restaurant
        // comes from the address when there is one; otherwise only when the server asked for it.
        const restaurantForLogin = address?.webName ?? (restaurantNeeded ? typedRestaurant : null);
        const result = await posApi.login(username.trim(), pinCode.trim(), tillBranchId, restaurantForLogin);
        if (!address && restaurantNeeded) save(RESTAURANT_KEY, typedRestaurant);
        if (result.twoFactorRequired && result.challenge) {
          setTwoFactor({ challenge: result.challenge, via: 'username' });
          setCode('');
          return;
        }
        if (tillBranchId) await finish(result.user as SignedInUser, result.token, (result.user as SignedInUser).permissions, tillBranchId);
        else await continueAfterSignIn(result);
        return;
      }
      const result = await posApi.superAdminLogin(username.trim(), pinCode.trim());
      const user = result?.user as SignedInUser | undefined;
      if (!user || !result?.token) {
        setError('Invalid username or PIN');
        return;
      }
      await finish(user, result.token, user.permissions);
    } catch (err) {
      const status = getApiErrorStatus(err);
      const data = (err as { response?: { data?: { deviceNotConnected?: boolean; requiresTenantSlug?: boolean; webName?: string } } }).response?.data;
      if (mode === 'till' && data?.deviceNotConnected) setDeviceNotConnected(true);
      if (mode === 'username' && data?.requiresTenantSlug) {
        // That username exists at more than one restaurant: ask which one, and keep the PIN typed.
        setRestaurantNeeded(true);
        setError('This username is used at more than one restaurant. Add your restaurant name and press Sign In again.');
        return;
      }
      // Right password, wrong restaurant's address: point them at their own.
      if (mode === 'email' && status === 403 && data?.webName) setOtherAddress(restaurantSignInLink(data.webName));
      setError(getApiErrorMessage(
        err,
        status === 401
          ? mode === 'till' ? 'Wrong PIN.'
            : mode === 'email' ? 'Wrong email or password.'
            : mode === 'username' ? (restaurantNeeded && !address ? 'Wrong restaurant, username or PIN' : 'Wrong username or PIN')
            : 'Invalid username or PIN'
          : 'Sign-in failed — check your connection'
      ));
      setPinCode('');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!twoFactor || !code.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await posApi.verifyTwoFactor(twoFactor.challenge, code.trim());
      setTwoFactor(null);
      if (twoFactor.via === 'username' && tillBranchId) {
        await finish(result.user as SignedInUser, result.token, (result.user as SignedInUser).permissions, tillBranchId);
      } else {
        await continueAfterSignIn(result);
      }
    } catch (err) {
      const expired = (err as { response?: { data?: { expired?: boolean } } }).response?.data?.expired;
      if (expired) {
        // Took too long: back to the password, which has to be typed again.
        setTwoFactor(null);
        setPassword('');
        setPinCode('');
      }
      setError(getApiErrorMessage(err, 'That code is not right.'));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const sendResetLink = async () => {
    if (!email.trim() || forgotState.sending) return;
    setForgotState({ sending: true });
    try {
      const res = await posApi.forgotPassword(email.trim());
      setForgotState(res.emailEnabled
        ? { sending: false, message: res.message ?? 'If an account uses that email, a reset link is on its way.' }
        : { sending: false, noEmail: true });
    } catch (err) {
      setForgotState({ sending: false, message: getApiErrorMessage(err, 'Could not send the link. Try again in a minute.') });
    }
  };

  const chooseBranch = async (branch: MyBranch) => {
    if (!pending || loading) return;
    setLoading(true);
    setError('');
    try {
      // Someone based at a branch gets a session pinned to the one they chose (the server checks
      // they may work there). An owner's session already covers every location, so for them the
      // choice is simply where the app opens.
      if (pending.user.homeBranchId && branch.id !== pending.user.branchId) {
        const switched = await posApi.switchBranch(branch.id);
        await finish({ ...pending.user, ...switched.user }, switched.token, pending.user.permissions, branch.id);
      } else {
        await finish(pending.user, pending.token, pending.user.permissions, branch.id);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not open that branch.'));
      setLoading(false);
    }
  };

  const cancelBranchChoice = () => {
    // Signed in but never let in: end that session rather than leave it lying around.
    posApi.logout();
    setPending(null);
    setPinCode('');
    setPassword('');
    setError('');
  };

  const pressKey = (val: string | number) => {
    setError('');
    if (val === 'clear') setPinCode('');
    else if (val === 'back') setPinCode(prev => prev.slice(0, -1));
    else setPinCode(prev => (prev.length >= 6 ? prev : prev + String(val)));
  };

  const keypad = (
    <div className="grid grid-cols-3 gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
        <button key={n} type="button" onClick={() => pressKey(n)}
          className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm transition cursor-pointer">
          {n}
        </button>
      ))}
      <button type="button" onClick={() => pressKey('clear')}
        className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-rose-600 font-bold text-[11px] transition cursor-pointer">
        Clear
      </button>
      <button type="button" onClick={() => pressKey(0)}
        className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm transition cursor-pointer">
        0
      </button>
      <button type="button" onClick={() => pressKey('back')} title="Backspace"
        className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition flex items-center justify-center cursor-pointer">
        <Delete className="w-4 h-4" />
      </button>
    </div>
  );

  const pinInput = (large: boolean) => (
    <div>
      <label className={labelClass}>PIN</label>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pinCode}
        onChange={(e) => { setPinCode(e.target.value.replace(/\D/g, '')); setError(''); }}
        autoFocus={large}
        autoComplete="current-password"
        placeholder="••••"
        className={`w-full px-3 ${large ? 'py-4 text-3xl' : 'py-3 text-2xl'} bg-slate-50 border border-slate-200 rounded-xl text-center tracking-[0.5em] font-mono text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20`}
      />
    </div>
  );

  const rememberedBranchId = readSaved(LOGIN_BRANCH_KEY);

  const title =
    mode === 'till' ? 'Staff Sign In'
      : mode === 'email' ? 'Back Office Sign In'
      : mode === 'username' ? 'Sign in with username'
      : 'Platform Admin Sign In';

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-700 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-teal-700/25">
            C
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              Cashly <span className="text-teal-600">POS</span>
            </h1>
            {address ? (
              // This restaurant's own sign-in address.
              <div className="mt-2 space-y-0.5">
                <p className="text-base font-black text-slate-800 flex items-center justify-center gap-1.5">
                  <Store className="w-4 h-4 text-teal-600" />
                  {restaurantHere?.name ?? (restaurantHere?.missing ? 'Unknown address' : '…')}
                </p>
                {restaurantHere?.product && (
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                    {restaurantHere.product}
                  </span>
                )}
                {restaurantHere?.missing && (
                  <p className="text-[11px] text-rose-600">No restaurant uses this address. Check the link you were given.</p>
                )}
                {!address.fromSubdomain && (
                  <button type="button" onClick={leaveRestaurantAddress}
                    className="text-[11px] text-slate-400 hover:text-teal-700 font-semibold">
                    {restaurantHere?.name ? `Not ${restaurantHere.name}?` : 'Use the main sign-in'}
                  </button>
                )}
              </div>
            ) : (mode === 'till' || selectedTenant?.name) && (
              <p className="text-[11px] text-slate-500 font-semibold flex items-center justify-center gap-1.5 mt-1">
                <Store className="w-3.5 h-3.5 text-teal-600" />
                {[selectedTenant?.name, mode === 'till' ? tillBranchName : null].filter(Boolean).join(' • ') || 'This till'}
                {mode === 'till' && terminal?.name ? ` • ${terminal.name}` : ''}
              </p>
            )}
          </div>
        </div>

        {twoFactor ? (
          // 2-step sign-in: the password was right; now the code from their phone.
          <form onSubmit={submitCode} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold text-slate-900">2-step sign-in</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Open your authenticator app (Google Authenticator, Microsoft Authenticator…) and type the 6-digit code for Cashly POS.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value.slice(0, 12)); setError(''); }}
              placeholder="123 456"
              className="w-full px-3 py-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-3xl tracking-[0.4em] font-mono text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
            <p className="text-[10px] text-slate-400">Lost your phone? Type one of your recovery codes instead (like abcd-2345).</p>
            {error && <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{error}</div>}
            <button
              type="submit"
              disabled={loading || code.trim().length < 6}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Key className="w-4 h-4" /> {loading ? 'Checking…' : 'Verify'}
            </button>
            <button type="button" onClick={() => { setTwoFactor(null); setPassword(''); setPinCode(''); setError(''); }}
              className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to sign in
            </button>
          </form>
        ) : pending ? (
          // Only for someone who works at more than one location.
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-teal-600" />
              <span className="text-xs font-bold text-slate-900">Where are you working today?</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Signed in as <strong className="text-slate-700">{pending.user.fullName}</strong>. The head office opens the ERP;
              an outlet opens its POS.
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {pending.branches.map(b => {
                const suggested = b.id === rememberedBranchId || (!rememberedBranchId && b.isHome);
                const kind = locationKind(b);
                const KindIcon = kind.icon;
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={loading}
                    onClick={() => chooseBranch(b)}
                    className={`w-full text-left px-3.5 py-3 rounded-xl border transition flex items-center gap-3 disabled:opacity-50 cursor-pointer ${
                      suggested ? 'border-teal-400 bg-teal-50 hover:bg-teal-100' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <KindIcon className="w-4.5 h-4.5 text-teal-600" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900 truncate">{b.name}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">{kind.opens}</span>
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {kind.label}{b.city ? ` · ${b.city}` : ''} · {kind.hint}
                      </span>
                    </span>
                    {b.isHome && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">Your branch</span>
                    )}
                  </button>
                );
              })}
            </div>
            {error && <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{error}</div>}
            <button type="button" onClick={cancelBranchChoice} disabled={loading}
              className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Not you? Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-bold text-slate-900">{title}</span>
              </div>
              {/* Cashly's own sign-in: never on a restaurant's address, and with a domain only at admin.<domain>. */}
              {mode !== 'till' && (showPlatformAdmin || mode === 'platform') && (
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'platform' ? (tillBranchId ? 'till' : 'email') : 'platform')}
                  className="text-[10px] text-teal-600 hover:text-teal-800 font-bold transition cursor-pointer"
                >
                  {mode === 'platform' ? '← Back' : 'Platform Admin →'}
                </button>
              )}
            </div>

            {mode === 'till' && (
              <>
                <p className="text-[11px] text-slate-500 text-center">Enter your PIN to start.</p>
                {pinInput(true)}
                {keypad}
              </>
            )}

            {mode === 'email' && (
              <>
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(''); }}
                    autoFocus={!email}
                    autoComplete="email"
                    placeholder="you@yourrestaurant.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(''); }}
                      autoFocus={!!email}
                      autoComplete="current-password"
                      className={`${inputClass} pr-10`}
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                      title={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={() => { setShowForgot(v => !v); setForgotState({ sending: false }); }}
                    className="mt-1 text-[11px] text-slate-500 hover:text-teal-700 font-semibold">
                    Forgot password?
                  </button>
                  {showForgot && (
                    <div className="mt-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2">
                      {forgotState.noEmail ? (
                        <p>
                          This server cannot send email yet. Staff: ask your restaurant owner to set a new password in
                          <strong> Staff &amp; Pin Access</strong>. Owners: contact Cashly support.
                        </p>
                      ) : forgotState.message ? (
                        <p className="text-teal-800">{forgotState.message}</p>
                      ) : (
                        <>
                          <p>We will email a link to <strong>{email.trim() || 'the email above'}</strong> to set a new password.</p>
                          <button
                            type="button"
                            onClick={sendResetLink}
                            disabled={!email.trim() || forgotState.sending}
                            className="w-full py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold transition"
                          >
                            {forgotState.sending ? 'Sending…' : 'Email me a reset link'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {mode === 'username' && (
              <>
                {/* Only when the server could not tell which restaurant this username belongs to
                    (never at a restaurant's own address, which already says). */}
                {restaurantNeeded && !address && (
                  <div>
                    <label className={labelClass}>Restaurant</label>
                    <input type="text" value={restaurant} autoFocus spellCheck={false} autoComplete="organization"
                      onChange={(e) => { setRestaurant(e.target.value); setError(''); }}
                      placeholder="Your restaurant's name or web address" className={inputClass} />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Username</label>
                  <input type="text" value={username} autoFocus={!(restaurantNeeded && !address)} autoComplete="username"
                    onChange={(e) => { setUsername(e.target.value); setError(''); }}
                    placeholder="e.g. ali.cashier" className={inputClass} />
                </div>
                {pinInput(false)}
                {keypad}
              </>
            )}

            {mode === 'platform' && (
              <>
                <div>
                  <label className={labelClass}>Username</label>
                  <input type="text" value={username} autoFocus autoComplete="username"
                    onChange={(e) => { setUsername(e.target.value); setError(''); }} className={inputClass} />
                </div>
                {pinInput(false)}
                {keypad}
              </>
            )}

            {error && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold space-y-1">
                <div>{error}</div>
                {deviceNotConnected && (
                  <a href="/connect" className="block underline">Connect this device again</a>
                )}
                {otherAddress && (
                  <a href={otherAddress} className="block underline break-all">Go to {otherAddress.replace(/^https?:\/\//, '')}</a>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full px-4 py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Key className="w-4 h-4" />
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            {/* Other ways in */}
            {mode === 'till' && (
              <button type="button" onClick={() => switchMode('username')}
                className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold">
                Sign in with username instead
              </button>
            )}
            {mode === 'email' && (
              <button type="button" onClick={() => switchMode('username')}
                className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
                <Key className="w-3 h-3" /> No email? Sign in with username &amp; PIN
              </button>
            )}
            {mode === 'username' && (
              <button type="button" onClick={() => switchMode(tillBranchId ? 'till' : 'email')}
                className="w-full text-[11px] text-slate-500 hover:text-teal-700 font-semibold flex items-center justify-center gap-1">
                {tillBranchId ? <><Monitor className="w-3 h-3" /> Back to PIN sign-in</>
                  : <><Mail className="w-3 h-3" /> {address ? 'Owner or manager? Sign in with email' : 'Sign in with email instead'}</>}
              </button>
            )}

            {/* The way in for a new business — visitors arriving from the website's Demo button.
                Only on Cashly's main address, not on a restaurant's own. */}
            {mode === 'email' && !address && (
              <div className="pt-3 border-t border-slate-100 text-center space-y-2">
                <p className="text-[11px] text-slate-500">New to Cashly?</p>
                <a href="/signup"
                  className="block w-full px-4 py-2.5 rounded-xl border-2 border-teal-500 text-teal-700 hover:bg-teal-50 font-bold text-sm transition">
                  New Registration — 30-day free trial
                </a>
              </div>
            )}
            {/* A new till, tablet or kitchen screen at an existing restaurant. */}
            {(mode === 'email' || mode === 'username') && !tillBranchId && (
              <a href="/connect" className="block text-center text-[11px] text-slate-500 hover:text-teal-700 font-semibold transition">
                Connect a till or tablet →
              </a>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Key, ShieldCheck, Store, Delete, MapPin, ArrowLeft, Mail, Eye, EyeOff, Monitor, Building2, Warehouse } from 'lucide-react';
import { posApi, getApiErrorMessage, getApiErrorStatus } from '../services/api';
import { getCachedStatus, getDeviceFingerprint, getStoredLicense, getStoredTerminal, isActivated } from '../services/deviceLicense';
import { useNavigate } from 'react-router-dom';
import { OFFLINE_SESSION_TOKEN, forgetOfflineStaff, rememberForOffline, signInOffline } from '../services/offlineStaff';
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

const inputClass = 'w-full h-11 px-4 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 transition';
const labelClass = 'block text-sm font-semibold text-slate-700 mb-1.5';

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
  const isOnline = usePosStore(s => s.isOnline);

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

  // Elsewhere: a device that knows a business but no email — Cashly POS alone, whose owner has no
  // email and signs in by username and PIN — starts there; everyone else on email.
  const [mode, setMode] = useState<Mode>(tillBranchId ? 'till' : currentRestaurantAddress() ? 'username'
    : !readSaved(EMAIL_KEY) && readSaved(RESTAURANT_KEY) ? 'username' : 'email');
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
  const [twoFactor, setTwoFactor] = useState<{ challenge: string; via: 'email' | 'username' | 'platform' } | null>(null);
  // Platform Admin: each team member signs in as themselves (email + password + 2-step). The shared
  // setup PIN is offered only while the server still allows it (before a named owner exists).
  const [setupPinAllowed, setSetupPinAllowed] = useState(false);
  const [usePin, setUsePin] = useState(false);
  useEffect(() => {
    if (mode !== 'platform') return;
    let cancelled = false;
    posApi.getPlatformLoginMode()
      .then(r => { if (!cancelled) { setSetupPinAllowed(r.setupPinAllowed); if (!r.setupPinAllowed) setUsePin(false); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);
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
      tenantId: user.tenantId, branchId: user.branchId, homeBranchId: user.homeBranchId,
      // A member of the platform team: their role decides what the console lets them change.
      platformRole: user.platformRole, email: user.email, isSetupAccount: user.isSetupAccount, mustSetUpTwoStep: user.mustSetUpTwoStep
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
      : usePin ? !!username.trim() && !!pinCode.trim()
      : !!email.trim() && !!password;

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
        let result: LoginResponse;
        try {
          result = await posApi.pinLogin(pinCode.trim(), license, getDeviceFingerprint());
        } catch (err) {
          // The server answered (wrong PIN, device revoked…): handled below as usual.
          if ((err as { response?: unknown }).response) throw err;
          // No answer at all — the internet is down. Staff who signed in on this till in the last
          // 7 days can still get in; their sales sync once it is back.
          const offline = tillBranchId ? await signInOffline(pinCode.trim(), tillBranchId) : null;
          if (!offline?.ok) {
            setError(offline && !offline.ok ? offline.message : 'Sign-in failed — check your connection');
            setPinCode('');
            return;
          }
          await finish({ ...offline.user, branchId: tillBranchId }, OFFLINE_SESSION_TOKEN, offline.permissions ?? undefined, tillBranchId);
          return;
        }
        const tillUser = result.user as SignedInUser;
        if (tillBranchId) void rememberForOffline(tillUser, pinCode.trim(), tillBranchId);
        await finish(tillUser, result.token, tillUser.permissions, tillBranchId);
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
      if (!usePin) {
        // A platform team member: email + password, then the code from their authenticator app.
        const result = await posApi.platformLogin(email.trim(), password);
        save(EMAIL_KEY, email.trim());
        if (result.twoFactorRequired && result.challenge) {
          setTwoFactor({ challenge: result.challenge, via: 'platform' });
          setCode('');
          return;
        }
        await finish(result.user as SignedInUser, result.token, (result.user as SignedInUser).permissions);
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
      if (mode === 'till' && data?.deviceNotConnected) {
        setDeviceNotConnected(true);
        // A disconnected or revoked till must not let anyone in offline either.
        forgetOfflineStaff();
      }
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
      if (twoFactor.via === 'platform') {
        await finish(result.user as SignedInUser, result.token, (result.user as SignedInUser).permissions);
      } else if (twoFactor.via === 'username' && tillBranchId) {
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

  // While a PIN is being asked for, a keyboard works like the keypad: digits, Backspace, Esc to
  // clear and Enter to sign in. Not while the cursor is in a text box (the username is typed there).
  const pinActive = !twoFactor && !pending && (mode === 'till' || mode === 'username' || (mode === 'platform' && usePin));
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!pinActive) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        setError('');
        setPinCode(prev => (prev.length >= 6 ? prev : prev + e.key));
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPinCode(prev => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setPinCode('');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinActive]);

  // The clock on the brand panel, as on a till's lock screen.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  // Keys grow on a tall screen; on a laptop they stay compact so the whole sign-in fits without scrolling.
  const keyBase = 'h-12 [@media(min-height:860px)]:h-14 [@media(max-height:720px)]:h-11 rounded-2xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 active:bg-slate-100 active:scale-[0.97] transition select-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
  const keypad = (
    <div className="grid grid-cols-3 gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
        <button key={n} type="button" onClick={() => pressKey(n)} className={`${keyBase} text-xl font-semibold text-slate-900`}>
          {n}
        </button>
      ))}
      <button type="button" onClick={() => pressKey('clear')} className={`${keyBase} text-sm font-semibold text-slate-500`}>
        Clear
      </button>
      <button type="button" onClick={() => pressKey(0)} className={`${keyBase} text-xl font-semibold text-slate-900`}>
        0
      </button>
      <button type="button" onClick={() => pressKey('back')} aria-label="Delete the last digit" title="Delete the last digit"
        className={`${keyBase} flex items-center justify-center text-slate-600`}>
        <Delete className="w-5 h-5" />
      </button>
    </div>
  );

  // The PIN as dots: four to start with, growing to six as a longer PIN is typed.
  const pinSlots = Math.max(4, Math.min(6, pinCode.length));
  const pinDots = (
    <div>
      <div className="flex items-center justify-center gap-3.5 h-8" role="status" aria-label={`PIN: ${pinCode.length} digit${pinCode.length === 1 ? '' : 's'} entered`}>
        {Array.from({ length: pinSlots }, (_, i) => (
          <span key={i} className={`w-3.5 h-3.5 rounded-full transition ${
            i < pinCode.length ? 'bg-teal-600 scale-110' : 'border-2 border-slate-300'
          }`} />
        ))}
      </div>
      <p className="hidden [@media(min-height:860px)]:block text-center text-[11px] text-slate-400">Tap the keys or type on the keyboard</p>
    </div>
  );

  const rememberedBranchId = readSaved(LOGIN_BRANCH_KEY);

  const heading =
    mode === 'till' ? { title: 'Enter your PIN', sub: 'Your 4 to 6 digit staff PIN.' }
      : mode === 'email' ? { title: 'Back office sign in', sub: 'Owners and managers sign in with email and password.' }
      : mode === 'username' ? { title: 'Staff sign in', sub: 'Your username and PIN.' }
      : { title: 'Cashly platform', sub: 'For the Cashly team only.' };

  // What the brand panel says this screen is for: this restaurant's address, this till, or the
  // business last used on this device.
  const businessName = address
    ? restaurantHere?.name ?? (restaurantHere?.missing ? 'Unknown address' : '…')
    : selectedTenant?.name ?? null;
  const placeLine = !address && mode === 'till'
    ? [tillBranchName, terminal?.name].filter(Boolean).join(' · ') || 'This till'
    : null;
  const showConnect = (mode === 'email' || mode === 'username') && !tillBranchId;
  const canRegister = !address && !tillBranchId && mode !== 'platform';
  const staffTab = mode === 'till' || mode === 'username';
  const linkClass = 'text-xs font-semibold text-slate-500 hover:text-teal-700 transition cursor-pointer';

  const statusLine = (light: boolean) => (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${light ? 'text-teal-50/90' : 'text-slate-500'}`}>
      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {isOnline ? 'Online' : 'Offline: staff who signed in here this week can still sign in'}
    </span>
  );

  return (
    <div className="min-h-screen w-full flex bg-white text-slate-900">
      {/* Brand panel — the business, the till and the time, like a till's lock screen. */}
      <aside className="hidden md:flex md:w-[44%] xl:w-1/2 relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 text-white flex-col justify-between p-10 lg:p-14">
        <div aria-hidden className="absolute -right-32 -top-32 w-96 h-96 rounded-full bg-white/5" />
        <div aria-hidden className="absolute -left-24 bottom-10 w-72 h-72 rounded-full bg-white/5" />

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white text-teal-800 flex items-center justify-center font-bold text-xl shadow-lg shadow-black/20">C</div>
          <span className="text-lg font-bold tracking-tight">Cashly <span className="text-teal-200">POS</span></span>
        </div>

        <div className="relative space-y-8">
          <div className="space-y-2">
            {businessName ? (
              <>
                <p className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight">{businessName}</p>
                {placeLine && <p className="text-teal-100 font-semibold flex items-center gap-2"><Store className="w-4 h-4" /> {placeLine}</p>}
                {address && restaurantHere?.product && (
                  <span className="inline-block text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/15 text-white">{restaurantHere.product}</span>
                )}
                {address && restaurantHere?.missing && (
                  <p className="text-sm text-amber-200">No business uses this address. Check the link you were given.</p>
                )}
                {address && !address.fromSubdomain && (
                  <button type="button" onClick={leaveRestaurantAddress} className="block text-sm font-semibold text-teal-100 hover:text-white underline-offset-4 hover:underline">
                    {restaurantHere?.name ? `Not ${restaurantHere.name}?` : 'Use the main sign-in'}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight">Sign in to Cashly</p>
                <p className="text-teal-100 max-w-sm">Point of sale and back office for restaurants, shops and pharmacies.</p>
              </>
            )}
            {/* On a computer the way to register lives here, always in view; on a phone it is under the sign-in. */}
            {canRegister && (
              <a href="/signup"
                className="inline-flex items-center mt-3 px-4 h-10 rounded-xl bg-white text-teal-800 hover:bg-teal-50 text-sm font-bold transition shadow-lg shadow-black/10">
                New business? Register free — 30-day trial →
              </a>
            )}
          </div>
          <div>
            <p className="text-5xl lg:text-6xl font-bold tabular-nums tracking-tight">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="mt-1 text-teal-100 font-semibold">
              {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center justify-between gap-3">
          {statusLine(true)}
          <div className="flex items-center gap-4 text-xs font-semibold">
            {showConnect && <a href="/connect" className="text-teal-100 hover:text-white">Connect a till or tablet →</a>}
            {mode !== 'till' && mode !== 'platform' && showPlatformAdmin && (
              <button type="button" onClick={() => switchMode('platform')} className="text-teal-100 hover:text-white">Platform admin</button>
            )}
          </div>
        </div>
      </aside>

      {/* Sign-in */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* On a phone the brand panel folds into this strip. */}
        <div className="md:hidden px-6 pt-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold text-lg">C</div>
          <div className="min-w-0">
            <p className="font-bold leading-tight truncate">{businessName ?? <>Cashly <span className="text-teal-600">POS</span></>}</p>
            {placeLine && <p className="text-xs text-slate-500 truncate">{placeLine}</p>}
            {address && !address.fromSubdomain && restaurantHere?.name && (
              <button type="button" onClick={leaveRestaurantAddress} className="text-xs font-semibold text-slate-500 hover:text-teal-700">Not {restaurantHere.name}?</button>
            )}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-6 [@media(max-height:720px)]:py-3">
          <div className="w-full max-w-sm space-y-6">
            {twoFactor ? (
              // 2-step sign-in: the password was right; now the code from their phone.
              <form onSubmit={submitCode} className="space-y-5">
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-teal-600" /> 2-step sign-in</h1>
                  <p className="text-sm text-slate-500">
                    Open your authenticator app (Google Authenticator, Microsoft Authenticator…) and type the 6-digit code for Cashly POS.
                  </p>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => { setCode(e.target.value.slice(0, 12)); setError(''); }}
                  placeholder="123 456"
                  className="w-full px-3 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-center text-3xl tracking-[0.4em] font-mono text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
                <p className="text-xs text-slate-400">Lost your phone? Type one of your recovery codes instead (like abcd-2345).</p>
                {error && <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-semibold">{error}</div>}
                <button
                  type="submit"
                  disabled={loading || code.trim().length < 6}
                  className="w-full h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Key className="w-4 h-4" /> {loading ? 'Checking…' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setTwoFactor(null); setPassword(''); setPinCode(''); setError(''); }}
                  className={`${linkClass} w-full flex items-center justify-center gap-1`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>
              </form>
            ) : pending ? (
              // Only for someone who works at more than one location.
              <div className="space-y-5">
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><MapPin className="w-6 h-6 text-teal-600" /> Where are you working today?</h1>
                  <p className="text-sm text-slate-500">
                    Signed in as <strong className="text-slate-700">{pending.user.fullName}</strong>. The head office opens the ERP;
                    an outlet opens its POS.
                  </p>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
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
                        className={`w-full text-left px-4 py-3.5 rounded-2xl border transition flex items-center gap-3 disabled:opacity-50 cursor-pointer ${
                          suggested ? 'border-teal-400 bg-teal-50 hover:bg-teal-100' : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                          <KindIcon className="w-5 h-5 text-teal-600" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-slate-900 truncate">{b.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">{kind.opens}</span>
                          </span>
                          <span className="block text-xs text-slate-500 truncate">
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
                {error && <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-semibold">{error}</div>}
                <button type="button" onClick={cancelBranchChoice} disabled={loading}
                  className={`${linkClass} w-full flex items-center justify-center gap-1`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Not you? Back to sign in
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                {mode === 'platform' && (
                  <button type="button" onClick={() => switchMode(tillBranchId ? 'till' : 'email')}
                    className={`${linkClass} flex items-center gap-1`}>
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to business sign-in
                  </button>
                )}

                <div className="space-y-1">
                  <h1 className="text-2xl font-bold tracking-tight">{heading.title}</h1>
                  <p className="text-sm text-slate-500 [@media(max-height:720px)]:hidden">{heading.sub}</p>
                </div>

                {/* Staff sign in with a PIN; owners and managers with email. */}
                {mode !== 'platform' && (
                  <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100" role="tablist" aria-label="How to sign in">
                    <button type="button" role="tab" aria-selected={staffTab}
                      onClick={() => { if (!staffTab) switchMode(tillBranchId ? 'till' : 'username'); }}
                      className={`py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        staffTab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      <Key className="w-3.5 h-3.5" /> Staff PIN
                    </button>
                    <button type="button" role="tab" aria-selected={mode === 'email'}
                      onClick={() => { if (mode !== 'email') switchMode('email'); }}
                      className={`py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        mode === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}>
                      <Mail className="w-3.5 h-3.5" /> Email
                    </button>
                  </div>
                )}

                {mode === 'till' && (
                  <>
                    {pinDots}
                    {keypad}
                  </>
                )}

                {mode === 'email' && (
                  <>
                    <div>
                      <label htmlFor="login-email" className={labelClass}>Email</label>
                      <input
                        id="login-email"
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setError(''); }}
                        autoFocus={!email}
                        autoComplete="email"
                        placeholder="you@yourbusiness.com"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-password" className={labelClass}>Password</label>
                        <button type="button" onClick={() => { setShowForgot(v => !v); setForgotState({ sending: false }); }}
                          className="mb-1 text-xs font-semibold text-teal-700 hover:text-teal-800">
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          id="login-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setError(''); }}
                          autoFocus={!!email}
                          autoComplete="current-password"
                          className={`${inputClass} pr-11`}
                        />
                        <button type="button" onClick={() => setShowPassword(v => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}>
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {showForgot && (
                        <div className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                          {forgotState.noEmail ? (
                            <p>
                              This server cannot send email yet. Staff: ask your owner to set a new password in
                              <strong> Staff &amp; PINs</strong>. Owners: contact Cashly support.
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
                    {/* Only when the server could not tell which business this username belongs to
                        (never at a business's own address, which already says). */}
                    {restaurantNeeded && !address && (
                      <div>
                        <label htmlFor="login-business" className={labelClass}>Business</label>
                        <input id="login-business" type="text" value={restaurant} autoFocus spellCheck={false} autoComplete="organization"
                          onChange={(e) => { setRestaurant(e.target.value); setError(''); }}
                          placeholder="Your business's name or web address" className={inputClass} />
                      </div>
                    )}
                    <div>
                      <label htmlFor="login-username" className={labelClass}>Username</label>
                      <input id="login-username" type="text" value={username} autoFocus={!(restaurantNeeded && !address)} autoComplete="username"
                        onChange={(e) => { setUsername(e.target.value); setError(''); }}
                        placeholder="e.g. ali.cashier" className={inputClass} />
                    </div>
                    {pinDots}
                    {keypad}
                  </>
                )}

                {mode === 'platform' && !usePin && (
                  <>
                    <div>
                      <label htmlFor="login-work-email" className={labelClass}>Work email</label>
                      <input id="login-work-email" type="email" value={email} autoFocus autoComplete="email"
                        onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="you@cashly.com" className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="login-platform-password" className={labelClass}>Password</label>
                      <div className="relative">
                        <input id="login-platform-password" type={showPassword ? 'text' : 'password'} value={password} autoComplete="current-password"
                          onChange={(e) => { setPassword(e.target.value); setError(''); }} className={`${inputClass} pr-11`} />
                        <button type="button" onClick={() => setShowPassword(v => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}>
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {setupPinAllowed && (
                      <button type="button" onClick={() => { setUsePin(true); setError(''); }} className={`${linkClass} w-full`}>
                        First time? Use the setup PIN to create the team
                      </button>
                    )}
                  </>
                )}

                {mode === 'platform' && usePin && (
                  <>
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      The shared setup PIN only works until you add yourself as a named owner (Platform → Team).
                    </p>
                    <div>
                      <label htmlFor="login-setup-username" className={labelClass}>Username</label>
                      <input id="login-setup-username" type="text" value={username} autoFocus autoComplete="username"
                        onChange={(e) => { setUsername(e.target.value); setError(''); }} className={inputClass} />
                    </div>
                    {pinDots}
                    {keypad}
                    <button type="button" onClick={() => { setUsePin(false); setError(''); setPinCode(''); }} className={`${linkClass} w-full`}>
                      Sign in with my email instead
                    </button>
                  </>
                )}

                {error && (
                  <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-semibold space-y-1" role="alert">
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
                  className="w-full h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-teal-600/20"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>

                {/* Other ways in */}
                <div className="flex flex-col items-center gap-2.5">
                  {mode === 'till' && (
                    <button type="button" onClick={() => switchMode('username')} className={linkClass}>
                      Use username and PIN instead
                    </button>
                  )}
                  {mode === 'username' && tillBranchId && (
                    <button type="button" onClick={() => switchMode('till')} className={`${linkClass} flex items-center gap-1`}>
                      <Monitor className="w-3.5 h-3.5" /> Back to PIN only
                    </button>
                  )}
                  {(mode === 'till' || mode === 'username') && (
                    <p className="text-xs text-slate-400 text-center">Forgot your PIN? Ask your manager to reset it.</p>
                  )}
                </div>

                {/* The way in for a new business, on either tab. Only on Cashly's main address — not on
                    a business's own address, and not on a till that already belongs to one. */}
                {canRegister && (
                  <div className="md:hidden pt-4 border-t border-slate-100">
                    <a href="/signup"
                      className="flex items-center justify-center w-full h-11 rounded-2xl border-2 border-teal-600 text-teal-700 hover:bg-teal-50 text-sm font-bold transition">
                      New business? Register — 30-day free trial
                    </a>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>

        {/* On a phone: what the brand panel's footer holds. */}
        <div className="md:hidden px-6 pb-8 flex flex-col items-center gap-2.5">
          {statusLine(false)}
          {showConnect && <a href="/connect" className={linkClass}>Connect a till or tablet →</a>}
          {mode !== 'till' && mode !== 'platform' && showPlatformAdmin && (
            <button type="button" onClick={() => switchMode('platform')} className={linkClass}>Platform admin</button>
          )}
        </div>
      </main>
    </div>
  );
};

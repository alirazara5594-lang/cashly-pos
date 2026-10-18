import React, { useEffect, useRef, useState } from 'react';
import {
  Key, ShieldCheck, Store, Delete, MapPin, ArrowLeft, ArrowRight, Eye, EyeOff, MonitorSmartphone, Building2, Warehouse,
  Receipt, Boxes, BarChart3, WifiOff, Cloud, Play
} from 'lucide-react';
import { DemoPanel, FeaturesMenu, PricingMenu, PricingPanel, SupportPanel, type LoginPanel } from './login/LoginPanels';
import { ScaledPosScene } from './login/PosScene';
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
 * How someone signs in here. Nobody is asked to choose "POS or ERP": they say who they are, and
 * that decides the next step (the way Google, Microsoft and Square sign in):
 *  - identify: one box, "Username or work email". A username goes on to the PIN; an email to the
 *              password. A Cashly POS owner never meets the word ERP.
 *  - till:     a till, tablet or kitchen screen paired to a branch. The PIN alone; the device
 *              already knows the business and branch.
 *  - email:    the password for a work email (head office, department staff, any owner with one).
 *  - username: the PIN for a username. At a Cashly POS business's own address (its subdomain or
 *              /r/ link) this is where sign-in starts. Elsewhere the business is asked for only
 *              when that username exists at more than one business.
 *  - platform: Cashly's own platform admin.
 */
type Mode = 'till' | 'identify' | 'email' | 'username' | 'platform';

/** Signed in, but works at more than one location and has not said which one yet. */
interface PendingBranchChoice {
  user: SignedInUser;
  token: string;
  branches: MyBranch[];
}

const inputClass = 'w-full h-11 px-4 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 transition';
const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';

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
  // A till starts on its PIN; a business's own address on username and PIN; everywhere else on
  // "who are you" — one box for a username or a work email.
  const [mode, setMode] = useState<Mode>(tillBranchId ? 'till' : currentRestaurantAddress() ? 'username' : 'identify');
  const [addressInfo, setAddressInfo] = useState<{ webName: string; name: string | null; product?: string; missing?: boolean } | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    posApi.getRestaurantByWebName(address.webName)
      .then(r => {
        if (cancelled) return;
        setAddressInfo({ webName: address.webName, name: r.name, product: r.product });
        // A business with a head office has office staff signing in by email at its address too,
        // so it asks who they are first. A Cashly POS business stays on username and PIN.
        if (r.product && r.product !== 'Cashly POS') setMode(m => (m === 'username' ? 'identify' : m));
      })
      .catch(err => { if (!cancelled) setAddressInfo({ webName: address.webName, name: null, missing: getApiErrorStatus(err) === 404 }); });
    return () => { cancelled = true; };
  }, [address]);
  const restaurantHere = address && addressInfo?.webName === address.webName ? addressInfo : null;
  const showPlatformAdmin = !address && isPlatformAdminAddress();

  // What was typed in the "who are you" box (the work email last used here, to start with), and
  // whether the username or email below came from it (then it shows as "Signing in as …").
  const [identifier, setIdentifier] = useState(() => readSaved(EMAIL_KEY));
  const [identified, setIdentified] = useState(false);
  // Pricing, Support or the demo, open over the page.
  const [panel, setPanel] = useState<LoginPanel | null>(null);
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
    switchMode(tillBranchId ? 'till' : 'identify');
  };

  /** "Who are you" answered: a work email goes on to its password, a username to its PIN. */
  const continueWithIdentifier = () => {
    const id = identifier.trim();
    if (!id) return;
    setIdentified(true);
    if (id.includes('@')) { setEmail(id); switchMode('email'); }
    else { setUsername(id); switchMode('username'); }
  };

  /** "Not you?": back to the one box, with what was typed still in it. */
  const changeIdentifier = () => {
    setIdentified(false);
    setPassword('');
    setRestaurantNeeded(false);
    switchMode('identify');
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
      : mode === 'identify' ? !!identifier.trim()
      : mode === 'email' ? !!email.trim() && !!password
      : mode === 'username' ? !!username.trim() && !!pinCode.trim() && (!!address || !restaurantNeeded || !!typedRestaurant)
      : usePin ? !!username.trim() && !!pinCode.trim()
      : !!email.trim() && !!password;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ready || loading) return;
    if (mode === 'identify') { continueWithIdentifier(); return; }
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
  const keyBase = 'h-12 [@media(min-height:860px)]:h-14 [@media(max-height:720px)]:h-11 rounded-xl bg-white border border-slate-200 shadow-sm hover:bg-slate-50 active:bg-slate-100 active:scale-[0.97] transition select-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
  const keypad = (
    <div className="grid grid-cols-3 gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
        <button key={n} type="button" onClick={() => pressKey(n)} className={`${keyBase} text-xl font-medium text-slate-900`}>
          {n}
        </button>
      ))}
      <button type="button" onClick={() => pressKey('clear')} className={`${keyBase} text-sm font-medium text-slate-500`}>
        Clear
      </button>
      <button type="button" onClick={() => pressKey(0)} className={`${keyBase} text-xl font-medium text-slate-900`}>
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
      : mode === 'identify' ? { title: 'Welcome back', sub: 'Sign in to continue to your Cashly account.' }
      : mode === 'email' ? { title: 'Enter your password', sub: 'The password for your work email.' }
      : mode === 'username' ? (identified ? { title: 'Enter your PIN', sub: 'Your 4 to 6 digit PIN.' } : { title: 'Sign in', sub: 'Your username and PIN.' })
      : { title: 'Cashly platform', sub: 'For the Cashly team only.' };

  // The step before this one, for the Back button at the top of the card (a first step has none).
  const goBack: (() => void) | null =
    twoFactor ? () => { setTwoFactor(null); setPassword(''); setPinCode(''); setError(''); }
      : pending ? cancelBranchChoice
      : mode === 'platform' ? () => (tillBranchId ? switchMode('till') : changeIdentifier())
      : (mode === 'email' || mode === 'username') && identified ? changeIdentifier
      : mode === 'username' && tillBranchId ? () => switchMode('till')
      : null;

  /** "Signing in as ali · Not you?" — who was given in the first box. */
  const signingInAs = (who: string) => (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200">
      <span className="min-w-0 text-sm text-slate-600 truncate">Signing in as <strong className="text-slate-900">{who}</strong></span>
      <button type="button" onClick={changeIdentifier} className="shrink-0 text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer">Not you?</button>
    </div>
  );

  // What the brand panel says this screen is for: this restaurant's address, this till, or the
  // business last used on this device.
  const businessName = address
    ? restaurantHere?.name ?? (restaurantHere?.missing ? 'Unknown address' : '…')
    : selectedTenant?.name ?? null;
  const placeLine = !address && mode === 'till'
    ? [tillBranchName, terminal?.name].filter(Boolean).join(' · ') || 'This till'
    : null;
  const showConnect = (mode === 'identify' || mode === 'email' || mode === 'username') && !tillBranchId;
  const canRegister = !address && !tillBranchId && mode !== 'platform';
  const linkClass = 'text-xs font-medium text-slate-500 hover:text-teal-700 transition cursor-pointer';

  const statusLine = (light: boolean) => (
    <span className={`inline-flex items-center gap-2 text-xs font-medium ${light ? 'text-teal-50/90' : 'text-slate-500'}`}>
      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {isOnline ? 'Online' : 'Offline: staff who signed in here this week can still sign in'}
    </span>
  );

  // The business this screen is for, with "Not …?" off its own /r/ link.
  const businessBlock = businessName && (
    <div className="space-y-2">
      <p className="text-3xl xl:text-4xl font-semibold tracking-tight leading-tight">{businessName}</p>
      {placeLine && <p className="text-teal-100 font-medium flex items-center gap-2"><Store className="w-4 h-4" /> {placeLine}</p>}
      {address && restaurantHere?.product && (
        <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/15 text-white">{restaurantHere.product}</span>
      )}
      {address && restaurantHere?.missing && (
        <p className="text-sm text-amber-200">No business uses this address. Check the link you were given.</p>
      )}
      {address && !address.fromSubdomain && (
        <button type="button" onClick={leaveRestaurantAddress} className="block text-sm font-medium text-teal-100 hover:text-white underline-offset-4 hover:underline">
          {restaurantHere?.name ? `Not ${restaurantHere.name}?` : 'Use the main sign-in'}
        </button>
      )}
    </div>
  );

  // What Cashly does — each one something the product really has.
  const features = [
    { icon: Receipt, title: 'Fast billing', text: 'Quick checkout with FBR invoices' },
    { icon: Boxes, title: 'Smart inventory', text: 'Live stock and purchase orders' },
    { icon: BarChart3, title: 'Clear reports', text: 'Daily sales, profit and tax' },
    { icon: Building2, title: 'Multi-branch', text: 'All outlets from one head office' }
  ];
  const assurances = [
    { icon: ShieldCheck, label: 'Secure 2-step sign-in' },
    { icon: WifiOff, label: 'Keeps selling offline' },
    { icon: Cloud, label: 'Cloud-based, any device' }
  ];

  return (
    <div className="h-screen w-full flex bg-[#071f26] text-slate-900 overflow-hidden">
      {/* ── Left: the product (the main address), or the till's lock screen (a connected till) ── */}
      <aside className="hidden lg:flex flex-1 min-w-0 relative overflow-hidden text-white flex-col px-10 2xl:px-14 py-8 [@media(max-height:720px)]:py-5 bg-gradient-to-br from-[#06191f] via-[#0a3138] to-[#0c443d]">
        <div aria-hidden className="absolute -top-48 -right-24 w-[640px] h-[640px] rounded-full bg-emerald-400/[0.12] blur-3xl" />
        <div aria-hidden className="absolute -bottom-56 -left-32 w-[560px] h-[560px] rounded-full bg-teal-300/[0.08] blur-3xl" />

        <header className="relative z-20 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-emerald-950/40">C</div>
          <span className="text-lg font-semibold tracking-tight">Cashly <span className="text-emerald-300">POS</span></span>
          {/* Cashly's own menu — not on a connected till, which belongs to one business. */}
          {!tillBranchId && (
            <nav className="ml-auto flex items-center gap-1" aria-label="Cashly">
              <FeaturesMenu onPricing={() => setPanel('pricing')} />
              <PricingMenu onDetails={() => setPanel('pricing')} />
              <button type="button" onClick={() => setPanel('support')}
                className="px-3 h-9 rounded-lg text-sm font-medium text-white/75 hover:text-white hover:bg-white/[0.08] transition cursor-pointer">Support</button>
            </nav>
          )}
        </header>

        {tillBranchId ? (
          // A connected till: whose till it is, and the time — like a till's lock screen.
          <div className="relative flex-1 flex flex-col justify-center gap-10">
            {businessBlock}
            <div>
              <p className="text-6xl xl:text-7xl font-light tabular-nums tracking-tight">
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="mt-2 text-teal-100/80 font-medium">
                {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
          </div>
        ) : (
          // Two columns — the words, and the picture — when the panel is wide and tall enough for both;
          // otherwise just the words. Sized off the panel itself (a container query), not the window.
          <div className="@container relative flex-1 min-h-0 flex items-center py-8 [@media(max-height:720px)]:py-4">
            <div className="w-full grid items-center gap-10 @min-[720px]:[@media(min-height:640px)]:grid-cols-[minmax(380px,5fr)_minmax(0,4fr)]">
              <div className="max-w-[520px] 2xl:max-w-[560px]">
                {businessName && (
                  <div className="mb-6 inline-flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 rounded-lg bg-white/[0.08] ring-1 ring-inset ring-white/10 text-[13px]">
                    <span className="text-white/70">Signing in to <span className="font-medium text-white">{businessName}</span></span>
                    {address && !address.fromSubdomain && (
                      <button type="button" onClick={leaveRestaurantAddress} className="font-medium text-emerald-300 hover:text-emerald-200">
                        {restaurantHere?.name ? `Not ${restaurantHere.name}?` : 'Use the main sign-in'}
                      </button>
                    )}
                  </div>
                )}
                <h1 className="text-[34px] xl:text-[40px] 2xl:text-[46px] [@media(max-height:720px)]:text-[32px] font-semibold tracking-[-0.02em] leading-[1.12]">
                  Smart POS for<br />
                  <span className="relative inline-block">
                    <span className="bg-gradient-to-r from-emerald-300 to-teal-200 bg-clip-text text-transparent">growing</span>
                    <svg aria-hidden viewBox="0 0 200 12" className="absolute left-0 -bottom-1.5 w-full h-2.5 text-emerald-400/80" preserveAspectRatio="none">
                      <path d="M2 9 C 50 2, 120 2, 198 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </span>{' '}
                  businesses
                </h1>
                <p className="mt-4 text-[15px] 2xl:text-base leading-relaxed text-white/65 max-w-[460px] 2xl:max-w-[520px] text-pretty">
                  Sell, manage stock, keep your books and run every branch from one system.
                </p>

                <ul className="mt-8 [@media(max-height:720px)]:mt-6 grid grid-cols-2 gap-x-6 gap-y-5 [@media(max-height:720px)]:gap-y-4 max-w-[480px] 2xl:max-w-[540px]">
                  {features.map(({ icon: Icon, title, text }) => (
                    <li key={title} className="flex items-start gap-3">
                      <span className="w-9 h-9 shrink-0 rounded-lg bg-white/[0.07] ring-1 ring-inset ring-white/10 flex items-center justify-center">
                        <Icon className="w-[18px] h-[18px] text-emerald-300" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 pt-px">
                        <span className="block text-sm font-medium text-white">{title}</span>
                        <span className="block mt-0.5 text-[13px] leading-snug text-white/55 text-balance">{text}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-9 [@media(max-height:720px)]:mt-7 flex flex-wrap items-center gap-3">
                  {canRegister && (
                    <a href="/signup"
                      className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-[#04302a] text-sm font-semibold shadow-lg shadow-emerald-950/30 transition">
                      Register free <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                  <button type="button" onClick={() => setPanel('demo')}
                    className="inline-flex items-center gap-2 h-11 pl-3 pr-4 rounded-xl text-sm font-medium text-white/90 ring-1 ring-inset ring-white/20 hover:bg-white/[0.08] transition cursor-pointer">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center"><Play className="w-3 h-3 ml-px fill-current" /></span>
                    Watch demo
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/55">
                  {canRegister && <span>30-day free trial for new businesses</span>}
                  {showConnect && (
                    <a href="/connect" className="inline-flex items-center gap-1.5 font-medium text-emerald-300 hover:text-emerald-200 transition">
                      <MonitorSmartphone className="w-4 h-4" strokeWidth={1.75} /> Connect a till or tablet <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* The till on a shop counter. */}
              <div className="hidden @min-[720px]:[@media(min-height:640px)]:block min-w-0 w-full max-w-[560px] [@media(max-height:800px)]:max-w-[420px] justify-self-center">
                <ScaledPosScene />
              </div>
            </div>
          </div>
        )}

        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 pt-5 [@media(max-height:720px)]:pt-4 border-t border-white/10 text-[13px] text-white/60">
          {assurances.map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-2"><Icon className="w-4 h-4 text-emerald-300/90" strokeWidth={1.75} /> {label}</span>
          ))}
        </div>
      </aside>

      {/* ── Right: the sign-in card ── */}
      <main className="w-full lg:w-[440px] 2xl:w-[500px] shrink-0 flex lg:p-3 xl:p-4 min-h-0">
        <div className="flex-1 flex flex-col min-h-0 bg-white lg:rounded-3xl lg:shadow-2xl lg:shadow-black/40 overflow-y-auto">
        <div className="flex-1 flex items-center justify-center px-6 sm:px-10 py-6 [@media(max-height:720px)]:py-3">
          <div className="w-full max-w-[360px] space-y-6 [@media(max-height:720px)]:space-y-4">
            {/* The mark, and on a phone (no left side) whose sign-in this is. */}
            <div className="relative flex flex-col items-center gap-2 text-center">
              {goBack && (
                <button type="button" onClick={goBack} disabled={loading}
                  className="absolute left-0 top-1.5 [@media(max-height:720px)]:top-0.5 -ml-2 inline-flex items-center gap-1.5 h-9 pl-2 pr-3 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              )}
              <div className="w-12 h-12 [@media(max-height:720px)]:w-10 [@media(max-height:720px)]:h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white flex items-center justify-center font-bold text-xl [@media(max-height:720px)]:text-lg shadow-lg shadow-emerald-600/25">C</div>
              {(businessName || placeLine) && (
                <div className="lg:hidden">
                  <p className="font-semibold text-slate-900">{businessName}</p>
                  {placeLine && <p className="text-xs text-slate-500">{placeLine}</p>}
                  {address && !address.fromSubdomain && restaurantHere?.name && (
                    <button type="button" onClick={leaveRestaurantAddress} className="text-xs font-semibold text-slate-500 hover:text-teal-700">Not {restaurantHere.name}?</button>
                  )}
                </div>
              )}
            </div>
            {twoFactor ? (
              // 2-step sign-in: the password was right; now the code from their phone.
              <form onSubmit={submitCode} className="space-y-5">
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-teal-600" /> 2-step sign-in</h1>
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
                {error && <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-medium">{error}</div>}
                <button
                  type="submit"
                  disabled={loading || code.trim().length < 6}
                  className="w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[15px] font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Key className="w-4 h-4" /> {loading ? 'Checking…' : 'Verify'}
                </button>
              </form>
            ) : pending ? (
              // Only for someone who works at more than one location.
              <div className="space-y-5">
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><MapPin className="w-6 h-6 text-teal-600" /> Where are you working today?</h1>
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
                            <span className="text-sm font-semibold text-slate-900 truncate">{b.name}</span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-600 text-white shrink-0">{kind.opens}</span>
                          </span>
                          <span className="block text-xs text-slate-500 truncate">
                            {kind.label}{b.city ? ` · ${b.city}` : ''} · {kind.hint}
                          </span>
                        </span>
                        {b.isHome && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">Your branch</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {error && <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-medium">{error}</div>}
                <button type="button" onClick={cancelBranchChoice} disabled={loading}
                  className={`${linkClass} w-full flex items-center justify-center gap-1`}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Not you? Back to sign in
                </button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1 text-center">
                  <h1 className="text-2xl [@media(max-height:720px)]:text-xl font-semibold tracking-tight text-slate-900">{heading.title}</h1>
                  <p className="text-sm text-slate-500 [@media(max-height:720px)]:hidden">{heading.sub}</p>
                </div>

                {/* Who is signing in: a username (then the PIN) or a work email (then the password). */}
                {mode === 'identify' && (
                  <div>
                    <label htmlFor="login-identifier" className={labelClass}>Username or work email</label>
                    <input
                      id="login-identifier"
                      type="text"
                      inputMode="email"
                      value={identifier}
                      onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
                      autoFocus
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="e.g. ali or you@business.com"
                      className={inputClass}
                    />
                    <p className="mt-1.5 text-xs text-slate-500">Till staff: your username · Head office: your work email</p>
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
                    {identified ? signingInAs(email.trim()) : (
                      <div>
                        <label htmlFor="login-email" className={labelClass}>Work email</label>
                        <input
                          id="login-email"
                          type="email"
                          value={email}
                          onChange={(e) => { setEmail(e.target.value); setError(''); }}
                          autoFocus={!email}
                          autoComplete="email"
                          placeholder="e.g. accounts@yourbusiness.com"
                          className={inputClass}
                        />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-password" className={labelClass}>Password</label>
                        <button type="button" onClick={() => { setShowForgot(v => !v); setForgotState({ sending: false }); }}
                          className="mb-1 text-xs font-medium text-teal-700 hover:text-teal-800">
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
                                className="w-full py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold transition"
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
                    {identified ? signingInAs(username.trim()) : (
                      <div>
                        <label htmlFor="login-username" className={labelClass}>Username</label>
                        <input id="login-username" type="text" value={username} autoFocus={!(restaurantNeeded && !address)} autoComplete="username"
                          onChange={(e) => { setUsername(e.target.value); setError(''); }}
                          placeholder="e.g. ali.cashier" className={inputClass} />
                      </div>
                    )}
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
                  <div className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-sm font-medium space-y-1" role="alert">
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
                  className="w-full h-11 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[15px] font-semibold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm shadow-teal-700/20"
                >
                  {loading ? 'Signing in…' : mode === 'identify' ? 'Continue' : 'Sign in'}
                </button>

                {/* Other ways in */}
                <div className="flex flex-col items-center gap-2.5">
                  {mode === 'till' && (
                    <button type="button" onClick={() => switchMode('username')} className={linkClass}>
                      Use username and PIN instead
                    </button>
                  )}
                  {/* At a Cashly POS business's address: an owner or manager who has added a work email. */}
                  {mode === 'username' && !identified && !tillBranchId && (
                    <button type="button" onClick={changeIdentifier} className={linkClass}>
                      Have a work email? Sign in with it instead
                    </button>
                  )}
                  {(mode === 'till' || mode === 'username') && (
                    <p className="text-xs text-slate-400 text-center">Forgot your PIN? Ask your manager to reset it.</p>
                  )}
                </div>

                {/* On a phone (no left side): connecting a new till, under "or". */}
                {mode === 'identify' && showConnect && (
                  <div className="lg:hidden space-y-4">
                    <div className="flex items-center gap-3 text-xs text-slate-400"><span className="flex-1 h-px bg-slate-200" /> or <span className="flex-1 h-px bg-slate-200" /></div>
                    <a href="/connect"
                      className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition">
                      <MonitorSmartphone className="w-4 h-4 text-teal-600" /> Connect a till or tablet
                    </a>
                  </div>
                )}

                {/* The way in for a new business. Only on Cashly's main address — not on a business's
                    own address, and not on a till that already belongs to one. */}
                {canRegister && (mode === 'identify' || mode === 'email' || mode === 'username') && (
                  <p className="text-center text-sm text-slate-500">
                    Don&apos;t have an account?{' '}
                    <a href="/signup" className="font-semibold text-teal-700 hover:text-teal-800">Register free →</a>
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        {/* The card's foot: the connection, and the platform team's own way in. */}
        <div className="px-6 sm:px-10 py-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          {statusLine(false)}
          <div className="flex items-center gap-4">
            {/* On a phone the menu at the top of the left side is not there, so its two panels are here. */}
            {!tillBranchId && (
              <>
                <button type="button" onClick={() => setPanel('pricing')} className={`${linkClass} lg:hidden`}>Pricing</button>
                <button type="button" onClick={() => setPanel('support')} className={`${linkClass} lg:hidden`}>Support</button>
              </>
            )}
            {mode !== 'till' && mode !== 'platform' && showPlatformAdmin && (
              <button type="button" onClick={() => switchMode('platform')} className={linkClass}>Platform admin</button>
            )}
          </div>
        </div>
        </div>
      </main>

      {panel === 'pricing' && <PricingPanel onClose={() => setPanel(null)} />}
      {panel === 'support' && <SupportPanel onClose={() => setPanel(null)} />}
      {panel === 'demo' && <DemoPanel onClose={() => setPanel(null)} />}
    </div>
  );
};

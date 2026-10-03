import { usePosStore } from '../store/posStore';
import { authStorage } from './authStorage';
import type { AuthPermissions, CurrentUser, SupportSessionStart } from '../types';

/**
 * "View as customer": the platform admin opens a restaurant as a time-limited support session.
 *
 * The platform admin owns no restaurant, so the console signs in as the support session itself
 * (the restaurant's screens then work as they do for its own staff) and keeps the platform admin's
 * session aside to return to — when they press End, or when the 30 minutes run out.
 */

/** The platform admin's own session, kept while a support session is open. */
const PLATFORM_SESSION_KEY = 'cashly_platform_session';
/** Which restaurant the open support session is for, for the banner. */
const SUPPORT_SESSION_KEY = 'cashly_support_session';
const REFRESH_TOKEN_KEY = 'cashly_pos_refresh_token';

export interface SupportSessionInfo {
  tenantName: string;
  readOnly: boolean;
  expiresAt: string;
}

interface PlatformSession {
  user: CurrentUser | null;
  token: string | null;
  permissions: AuthPermissions | null;
  refreshToken: string | null;
}

export function getSupportSession(): SupportSessionInfo | null {
  try {
    const raw = authStorage.getItem(SUPPORT_SESSION_KEY);
    return raw ? JSON.parse(raw) as SupportSessionInfo : null;
  } catch {
    return null;
  }
}

/** Open the restaurant as the support session, keeping the platform admin's session to return to. */
export function beginSupportSession(session: SupportSessionStart) {
  const state = usePosStore.getState();
  const platform: PlatformSession = {
    user: state.currentUser,
    token: state.token,
    permissions: state.permissions,
    refreshToken: authStorage.getItem(REFRESH_TOKEN_KEY)
  };
  authStorage.setItem(PLATFORM_SESSION_KEY, JSON.stringify(platform));
  // A support session has no refresh token: when its time is up it ends, rather than quietly
  // turning back into the platform admin's session behind the screen.
  authStorage.removeItem(REFRESH_TOKEN_KEY);
  authStorage.setItem(SUPPORT_SESSION_KEY, JSON.stringify({
    tenantName: session.tenantName,
    readOnly: session.readOnly,
    expiresAt: new Date(Date.now() + session.expiresInMinutes * 60_000).toISOString()
  } satisfies SupportSessionInfo));

  const canChange = !session.readOnly;
  state.login(
    {
      id: session.userId,
      fullName: `Cashly Support — ${session.tenantName}`,
      username: 'cashly.support',
      role: session.role,
      tenantId: session.tenantId,
      branchId: null
    },
    session.token,
    {
      canViewFinancialReports: true,
      canManageInventory: canChange,
      canManageMenuAndTax: canChange,
      canGiveDiscounts: canChange,
      canVoidOrders: canChange
    }
  );
  // A clean start inside the restaurant: its tenant, branches, plan and screens load fresh.
  window.location.assign('/');
}

/** Close the support session and return to the platform admin's own session. */
function readPlatformSession(): PlatformSession | null {
  try {
    const raw = authStorage.getItem(PLATFORM_SESSION_KEY);
    return raw ? JSON.parse(raw) as PlatformSession : null;
  } catch {
    return null;
  }
}

export function endSupportSession() {
  const platform = readPlatformSession();
  authStorage.removeItem(SUPPORT_SESSION_KEY);
  authStorage.removeItem(PLATFORM_SESSION_KEY);

  const state = usePosStore.getState();
  if (!platform?.user || !platform.token) {
    state.logout();
    window.location.assign('/');
    return;
  }
  if (platform.refreshToken) authStorage.setItem(REFRESH_TOKEN_KEY, platform.refreshToken);
  state.login(platform.user, platform.token, platform.permissions);
  window.location.assign('/super-admin');
}

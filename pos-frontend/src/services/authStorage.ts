/**
 * Where the signed-in session is kept: in ONE tab (sessionStorage).
 *
 * A refresh keeps you signed in. A new tab, a new window, the installed app, or the browser or till
 * switched on again the next day starts at the sign-in page — email and password in the back office,
 * the PIN pad on a connected till. A till opened while the internet is down still lets in the staff
 * who signed in on it recently (see offlineStaff.ts).
 *
 * This module imports nothing, so the store and the API client can both use it while they load.
 */

/** Every key that makes up a signed-in session. Read and written only through authStorage. */
const SESSION_KEYS = [
  'cashly_pos_token',
  'cashly_pos_refresh_token',
  'cashly_pos_user',
  'cashly_pos_permissions',
  'cashly_pos_module_permissions',
  'cashly_support_session',
  'cashly_platform_session'
];

export const authStorage = {
  getItem(key: string): string | null {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { sessionStorage.setItem(key, value); } catch { /* full or blocked: the in-memory session still works */ }
  },
  removeItem(key: string): void {
    try { sessionStorage.removeItem(key); } catch { /* blocked */ }
  }
};

// Older versions kept the session in localStorage, shared by every tab and kept overnight, which
// is why Cashly used to open already signed in. Cleared so it cannot come back.
for (const key of SESSION_KEYS) {
  try { localStorage.removeItem(key); } catch { /* blocked */ }
}

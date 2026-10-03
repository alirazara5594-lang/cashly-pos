import type { AuthPermissions, CurrentUser } from '../types';

/**
 * Signing in at a till when the internet is down.
 *
 * A till asks for a PIN every time it is opened. Each time someone signs in on it by PIN while it
 * is online, the till keeps a note of them for 7 days: who they are, what they may do, and a
 * one-way scrambled copy of their PIN (PBKDF2 with a salt of its own — never the PIN itself). If
 * the till is opened while the internet is down, those people can still sign in and keep selling;
 * their sales sync when it is back. Nobody else can: a PIN this till has not seen online in the
 * last 7 days needs the internet.
 *
 * A session made this way carries no server token, so the first request once the internet is back
 * is refused and the till asks for the PIN again — this time checked by the server, after which the
 * sales made in the meantime are sent.
 */

const STAFF_KEY = 'cashly_offline_staff';
const LOCK_KEY = 'cashly_offline_lock';
const KEEP_DAYS = 7;
const ITERATIONS = 60_000;
const MAX_WRONG = 10;
const LOCK_MINUTES = 5;

/** Stands in for a server token in a session signed in offline; the server never accepts it. */
export const OFFLINE_SESSION_TOKEN = 'offline-session';

type StaffIdentity = CurrentUser & { permissions?: AuthPermissions };

interface OfflineStaff {
  user: CurrentUser;
  permissions: AuthPermissions | null;
  /** The till's branch when they signed in; a till moved to another branch forgets them. */
  branchId: string;
  salt: string;
  verifier: string;
  expiresAt: number;
}

const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;

const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function scramble(pin: string, salt: Uint8Array): Promise<string> {
  const key = await subtle!.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle!.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return toBase64(bits);
}

function readStaff(): OfflineStaff[] {
  try {
    const rows = JSON.parse(localStorage.getItem(STAFF_KEY) || '[]') as OfflineStaff[];
    const now = Date.now();
    return Array.isArray(rows) ? rows.filter(r => r && r.expiresAt > now) : [];
  } catch {
    return [];
  }
}

function writeStaff(rows: OfflineStaff[]) {
  try { localStorage.setItem(STAFF_KEY, JSON.stringify(rows)); } catch { /* full or blocked: offline sign-in just is not available */ }
}

/** After a PIN sign-in the server accepted: remember this person on this till for 7 days. */
export async function rememberForOffline(user: StaffIdentity, pin: string, branchId: string): Promise<void> {
  if (!subtle) return;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { permissions, ...identity } = user;
    const entry: OfflineStaff = {
      user: identity,
      permissions: permissions ?? null,
      branchId,
      salt: toBase64(salt),
      verifier: await scramble(pin, salt),
      expiresAt: Date.now() + KEEP_DAYS * 24 * 60 * 60 * 1000
    };
    writeStaff([...readStaff().filter(r => r.user.id !== user.id), entry]);
  } catch { /* offline sign-in just is not available for them */ }
}

/** The till was disconnected or revoked: nobody may sign in on it offline any more. */
export function forgetOfflineStaff() {
  try {
    localStorage.removeItem(STAFF_KEY);
    localStorage.removeItem(LOCK_KEY);
  } catch { /* blocked */ }
}

export type OfflineSignIn =
  | { ok: true; user: CurrentUser; permissions: AuthPermissions | null }
  | { ok: false; message: string };

/** Checks a PIN on the till itself, for when the server cannot be reached. */
export async function signInOffline(pin: string, branchId: string): Promise<OfflineSignIn> {
  const noInternet = 'No internet connection, and that PIN has not been used on this till in the last 7 days. Try again when the internet is back.';
  if (!subtle) return { ok: false, message: noInternet };

  // The same lock as the server's: 10 wrong PINs, then 5 minutes.
  let lock = { wrong: 0, until: 0 };
  try { lock = { ...lock, ...JSON.parse(localStorage.getItem(LOCK_KEY) || '{}') }; } catch { /* fresh */ }
  if (lock.until > Date.now()) {
    return { ok: false, message: `Too many wrong PINs. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minute(s).` };
  }

  const candidates = readStaff().filter(r => r.branchId === branchId);
  for (const entry of candidates) {
    try {
      if (await scramble(pin, fromBase64(entry.salt)) === entry.verifier) {
        localStorage.removeItem(LOCK_KEY);
        return { ok: true, user: entry.user, permissions: entry.permissions };
      }
    } catch { /* a damaged entry: skip it */ }
  }

  const wrong = lock.wrong + 1;
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(wrong >= MAX_WRONG
      ? { wrong: 0, until: Date.now() + LOCK_MINUTES * 60000 }
      : { wrong, until: 0 }));
  } catch { /* blocked */ }
  return { ok: false, message: candidates.length === 0 ? noInternet : 'Wrong PIN. (No internet: checked on this till.)' };
}

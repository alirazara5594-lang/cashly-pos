import { posApi } from './api';

/**
 * Device-side half of the licensing scheme.
 *
 * A till used to hold a plain GUID that never expired and was bound to nothing. It now holds a
 * signed, expiring licence tied to a fingerprint of this machine, renewed by heartbeat. This
 * module owns that licence: generating the fingerprint, storing it, renewing it, and deciding
 * what the terminal may still do when the server cannot be reached.
 */

const LICENSE_KEY = 'cashly_device_license';
const FINGERPRINT_KEY = 'cashly_device_fingerprint';
const TERMINAL_KEY = 'cashly_device_terminal';
const LAST_STATE_KEY = 'cashly_device_state';

export type DeviceState = 'Unactivated' | 'Valid' | 'Grace' | 'ReadOnly' | 'Revoked' | 'OverLimit' | 'Suspended';

export interface DeviceStatus {
  state: DeviceState;
  canSell: boolean;
  reason?: string;
  /** True when the only way forward is to enter a fresh pairing code. */
  mustReactivate: boolean;
  expiresAt?: string;
  graceEndsAt?: string;
  terminalName?: string;
  terminalType?: string;
  /**
   * Which application this machine is. Stored alongside the licence so an office PC boots
   * straight into the ERP even with no network — the answer came from the pairing code that
   * installed it, not from anything it has to look up.
   */
  appSurface?: 'Erp' | 'Pos' | 'Hybrid';
}

/** What this installed machine is, for screens that need it before a heartbeat completes. */
export function getDeviceSurface(): 'Erp' | 'Pos' | 'Hybrid' | null {
  return getCachedStatus().appSurface ?? null;
}

/**
 * A stable-enough identifier for this browser/machine.
 *
 * This is anti-copying, not anti-forensics: the goal is that a licence lifted from one till does
 * not silently work on another, and for that a stable device signature is enough. It is generated
 * once and persisted, so a browser upgrade that shifts the UA does not lock a shop out of its own
 * register — the random component is what actually distinguishes two machines.
 */
export function getDeviceFingerprint(): string {
  let fp = safeGet(FINGERPRINT_KEY);
  if (fp) return fp;

  const entropy =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const signature = [
    entropy,
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  ].join('|');

  fp = signature;
  safeSet(FINGERPRINT_KEY, fp);
  return fp;
}

export function getStoredLicense(): string | null {
  return safeGet(LICENSE_KEY);
}

export function isActivated(): boolean {
  return !!getStoredLicense();
}

export function getStoredTerminal(): { id: string; name: string; type: string; branchId: string } | null {
  const raw = safeGet(TERMINAL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Last known licence verdict, so a terminal that boots offline still knows where it stands. */
export function getCachedStatus(): DeviceStatus {
  const raw = safeGet(LAST_STATE_KEY);
  if (!raw) {
    return { state: isActivated() ? 'Valid' : 'Unactivated', canSell: isActivated(), mustReactivate: !isActivated() };
  }
  try {
    const cached = JSON.parse(raw) as DeviceStatus;
    // Re-evaluate the clock locally. The server is the authority, but between heartbeats the
    // device still has to know when its own grace window runs out.
    if (cached.graceEndsAt && new Date(cached.graceEndsAt) < new Date()) {
      return { ...cached, state: 'ReadOnly', canSell: false, reason: 'Licence grace period has run out. Reconnect to resume selling.' };
    }
    return cached;
  } catch {
    return { state: 'Unactivated', canSell: false, mustReactivate: true };
  }
}

/** Redeem a pairing code and store the licence this device will run on. */
export async function activate(pairingCode: string): Promise<DeviceStatus> {
  const fingerprint = getDeviceFingerprint();
  const info = `${navigator.platform || 'unknown'} · ${navigator.userAgent.slice(0, 120)}`;

  const res = await posApi.activateDevice(pairingCode.trim().toUpperCase(), fingerprint, info);

  safeSet(LICENSE_KEY, res.license);
  safeSet(TERMINAL_KEY, JSON.stringify({
    id: res.terminalId, name: res.terminalName, type: res.terminalType, branchId: res.branchId
  }));

  const status: DeviceStatus = {
    state: 'Valid',
    // A back-office workstation never sells, and saying otherwise here would let the ERP shell
    // offer a checkout it has no business offering.
    canSell: res.appSurface !== 'Erp',
    mustReactivate: false,
    expiresAt: res.expiresAt,
    graceEndsAt: res.graceEndsAt,
    terminalName: res.terminalName,
    terminalType: res.terminalType,
    appSurface: res.appSurface
  };
  safeSet(LAST_STATE_KEY, JSON.stringify(status));
  return status;
}

/**
 * Renew the licence. Called on boot and on a timer.
 *
 * A network failure is NOT a licence failure — the device falls back to its cached verdict and
 * keeps trading until the grace window genuinely expires. Anything else would turn every patchy
 * connection into a closed shop, which is the failure mode this design exists to avoid.
 */
export async function heartbeat(): Promise<DeviceStatus> {
  const license = getStoredLicense();
  if (!license) {
    const status: DeviceStatus = { state: 'Unactivated', canSell: false, mustReactivate: true };
    safeSet(LAST_STATE_KEY, JSON.stringify(status));
    return status;
  }

  try {
    const res = await posApi.terminalHeartbeat(license, getDeviceFingerprint());
    if (res.license) safeSet(LICENSE_KEY, res.license);

    const status: DeviceStatus = {
      state: 'Valid',
      canSell: res.appSurface !== 'Erp' && res.canSell !== false,
      mustReactivate: false,
      expiresAt: res.expiresAt,
      graceEndsAt: res.graceEndsAt,
      terminalName: res.terminalName,
      terminalType: res.terminalType,
      appSurface: res.appSurface
    };
    safeSet(LAST_STATE_KEY, JSON.stringify(status));
    return status;
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response;

    // No response at all: we are offline. Keep the cached verdict and keep selling.
    if (!response) return getCachedStatus();

    const data = response.data ?? {};
    const state = (data.state as DeviceState) ?? 'Revoked';
    const status: DeviceStatus = {
      state,
      canSell: false,
      mustReactivate: data.mustReactivate === true,
      reason: (data.reason as string) ?? 'This device is no longer licensed.'
    };

    // A definitive refusal ends the licence — keeping it would let a revoked till carry on
    // through its grace window, which is precisely what revocation is meant to stop.
    if (status.mustReactivate) safeRemove(LICENSE_KEY);

    safeSet(LAST_STATE_KEY, JSON.stringify(status));
    return status;
  }
}

/** Forget this device's licence (retiring it, or moving it to another branch). */
export function clearLicense() {
  safeRemove(LICENSE_KEY);
  safeRemove(TERMINAL_KEY);
  safeRemove(LAST_STATE_KEY);
}

// localStorage throws in private mode and with site data blocked, and a till must not fail to
// boot over a storage quirk — every access is guarded.
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* non-fatal */ }
}
function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* non-fatal */ }
}

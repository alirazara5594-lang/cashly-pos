/**
 * Each restaurant's own sign-in address, where staff type only username + PIN.
 *
 * Before Cashly has its own domain the address is <this site>/r/<webName>. Once VITE_BASE_DOMAIN is
 * set (e.g. "cashlypos.com", matching the server's App:BaseDomain) it is <webName>.cashlypos.com,
 * and old /r/ links still work. On a developer's machine, <webName>.localhost:5173 behaves exactly
 * like the real subdomain.
 */

const BASE_DOMAIN = (import.meta.env.VITE_BASE_DOMAIN as string | undefined)?.trim().replace(/^\./, '').toLowerCase() || null;

/** The restaurant an /r/<name> link pointed at, kept for when the address itself no longer says. */
const SAVED_ADDRESS_KEY = 'cashly_restaurant_address';

/** Cashly's own subdomains — never a restaurant. */
const CASHLY_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api']);

const WEB_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The restaurant named by this address's subdomain, if any. */
export function webNameFromSubdomain(): string | null {
  const host = window.location.hostname.toLowerCase();
  let label: string | null = null;
  if (BASE_DOMAIN && host.endsWith(`.${BASE_DOMAIN}`)) label = host.slice(0, -(BASE_DOMAIN.length + 1));
  else if (host.endsWith('.localhost')) label = host.slice(0, -'.localhost'.length);
  if (!label || label.includes('.') || CASHLY_SUBDOMAINS.has(label) || !WEB_NAME.test(label)) return null;
  return label;
}

/** The web name in an /r/<name> link, if this is one. */
export function webNameFromPath(pathname = window.location.pathname): string | null {
  const match = /^\/r\/([^/?#]+)/i.exec(pathname);
  const name = match ? decodeURIComponent(match[1]).toLowerCase() : null;
  return name && WEB_NAME.test(name) ? name : null;
}

/** Remember the restaurant an /r/ link named, so this device keeps opening its sign-in. */
export function rememberRestaurantAddress(webName: string) {
  try { localStorage.setItem(SAVED_ADDRESS_KEY, webName); } catch { /* optional */ }
}

export function forgetRestaurantAddress() {
  try { localStorage.removeItem(SAVED_ADDRESS_KEY); } catch { /* optional */ }
}

/**
 * Which restaurant's sign-in this is: the subdomain first (it cannot be changed from the page), else
 * the restaurant this device last opened through its /r/ link.
 */
export function currentRestaurantAddress(): { webName: string; fromSubdomain: boolean } | null {
  const sub = webNameFromSubdomain();
  if (sub) return { webName: sub, fromSubdomain: true };
  try {
    const saved = localStorage.getItem(SAVED_ADDRESS_KEY);
    if (saved && WEB_NAME.test(saved)) return { webName: saved, fromSubdomain: false };
  } catch { /* optional */ }
  return null;
}

/** The address to share with a restaurant's staff. */
export function restaurantSignInLink(webName: string): string {
  if (BASE_DOMAIN) return `https://${webName}.${BASE_DOMAIN}`;
  return `${window.location.origin}/r/${webName}`;
}

/** How the address reads around the web name, for the registration field: prefix + name + suffix. */
export function restaurantLinkParts(): { prefix: string; suffix: string } {
  if (BASE_DOMAIN) return { prefix: 'https://', suffix: `.${BASE_DOMAIN}` };
  return { prefix: `${window.location.host}/r/`, suffix: '' };
}

/**
 * Whether the platform admin's sign-in belongs on this address. With a domain: only admin.<domain>
 * (the server enforces the same). Without one: anywhere except a restaurant's own address.
 */
export function isPlatformAdminAddress(): boolean {
  if (BASE_DOMAIN) return window.location.hostname.toLowerCase() === `admin.${BASE_DOMAIN}`;
  return !webNameFromSubdomain();
}

/** The same rules the server applies (3–30 characters, a–z 0–9 and dashes, not first or last). */
export function webNameProblem(name: string): string | null {
  if (!name) return 'Choose a web address.';
  if (name.length < 3 || name.length > 30) return 'Use 3 to 30 characters.';
  if (!WEB_NAME.test(name)) return 'Use only small letters, numbers and dashes (a dash cannot be first or last).';
  if (name.includes('--')) return 'Do not put two dashes in a row.';
  return null;
}

/** A web name made from a restaurant's name: "Royal Grill & Kitchen" → "royal-grill-kitchen". */
export function suggestWebName(restaurantName: string): string {
  let name = restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (name.length > 30) name = name.slice(0, 30).replace(/-+$/, '');
  return name;
}

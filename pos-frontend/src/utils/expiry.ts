// Batch expiry dates: read, shown and entered the same way on the stock screen, at the till and when
// a purchase order is received. Dates arrive as YYYY-MM-DD and are calendar days, not instants.

/** Days from today to the date; negative once it has passed. */
export const daysUntil = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};

/** 31 Mar 2027 */
export const formatDay = (isoDate: string | null | undefined) => {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * How close to expiry, as a chip — or nothing while it is further off. Expired stock is stopped at
 * the till; three months out is when a pharmacy usually sends stock back to the distributor.
 */
export const expiryChip = (days: number | null | undefined) => {
  if (days == null || days > 90) return null;
  if (days < 0) return { label: 'Expired', cls: 'bg-rose-100 border-rose-300 text-rose-700' };
  if (days === 0) return { label: 'Expires today', cls: 'bg-rose-50 border-rose-200 text-rose-700' };
  if (days <= 30) return { label: `${days} day${days === 1 ? '' : 's'} left`, cls: 'bg-rose-50 border-rose-200 text-rose-600' };
  return { label: `${days} days left`, cls: 'bg-amber-50 border-amber-200 text-amber-700' };
};

/** Today and this month in local time, for an input's min and for spotting an expired entry. */
export const today = () => new Date().toLocaleDateString('en-CA');
export const thisMonth = () => today().slice(0, 7);

/**
 * An entered expiry as the API takes it. A medicine pack prints a month (EXP 03/2027) and is good
 * to that month's last day; anything else is the day given.
 */
export const expiryToIso = (value: string) => {
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString();
  }
  return new Date(value).toISOString();
};

/** Whether an entered expiry (a day, or a medicine's month) has already passed. */
export const expiryPassed = (value: string) =>
  /^\d{4}-\d{2}$/.test(value) ? value < thisMonth() : value < today();

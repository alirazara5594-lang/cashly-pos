import type { SubscriptionPartKind, SubscriptionPartRow } from '../types';

/** What each kind of part is called on screen. */
export const KIND_LABEL: Record<SubscriptionPartKind, string> = {
  Erp: 'ERP',
  Pos: 'POS',
  Tablet: 'Tablet',
  AddOn: 'Add-on'
};

/** "5 days left", "today", "3 days overdue". */
export const daysText = (days?: number | null) => {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;
  return `${-days} day${days === -1 ? '' : 's'} overdue`;
};

/** Needs someone to act: renewing within the window, lapsed, or never paid. */
export const needsAttention = (p: SubscriptionPartRow) =>
  p.status === 'Expiring' || p.status === 'Expired' || p.status === 'PaymentDue';

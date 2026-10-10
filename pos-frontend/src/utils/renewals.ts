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

/** Lapsed, never paid, or stopped for not being paid. */
export const isOverdue = (p: SubscriptionPartRow) =>
  p.status === 'Expired' || p.status === 'PaymentDue' || p.status === 'Stopped';

/** Needs someone to act: renewing within the window, lapsed, never paid, or stopped. */
export const needsAttention = (p: SubscriptionPartRow) => p.status === 'Expiring' || isOverdue(p);

export const pkr = (n?: number | null) => `PKR ${Math.round(n ?? 0).toLocaleString()}`;

export const dateOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Digits with the country code, as wa.me wants them (0300… becomes 92300…). */
export const whatsAppNumber = (raw?: string | null) => {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits;
};

/** How customers pay, offered when a payment is recorded. */
export const PAYMENT_METHODS = ['Bank Transfer', 'JazzCash', 'EasyPaisa', 'Raast', 'Cash', 'Cheque', 'Other'];

export interface InvoiceLineView {
  description: string;
  quantity: number;
  amountPKR: number;
  kind?: string;
}

/** The billed lines stored on an invoice; older invoices have none. */
export const invoiceLines = (linesJson?: string | null): InvoiceLineView[] => {
  if (!linesJson) return [];
  try {
    const parsed: unknown = JSON.parse(linesJson);
    return Array.isArray(parsed) ? (parsed as InvoiceLineView[]) : [];
  } catch {
    return [];
  }
};

/** How each invoice status reads and looks. */
export const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'Waiting', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PartiallyPaid: { label: 'Part paid', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  Paid: { label: 'Paid', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  Overdue: { label: 'Overdue', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  Cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
};

/** The five places of a business's panel in the platform console. */
export type TenantPanelTab = 'overview' | 'billing' | 'plan' | 'locations' | 'activity';

/** Older links named the panel's tabs differently; they land on the tab that now holds the same thing. */
export const panelTabFrom = (value?: string | null): TenantPanelTab => {
  switch (value) {
    case 'billing': case 'subscriptions': return 'billing';
    case 'plan': case 'addons': case 'entitlements': return 'plan';
    case 'locations': case 'deploy': case 'devices': return 'locations';
    case 'activity': case 'audit': return 'activity';
    default: return 'overview';
  }
};

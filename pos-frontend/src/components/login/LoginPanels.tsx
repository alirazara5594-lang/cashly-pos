import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Building2, Check, ChevronDown, Copy, Globe, KeyRound, LifeBuoy, Mail, MonitorSmartphone, Phone,
  Pill, PlayCircle, ShoppingBag, ShoppingCart, Store, UtensilsCrossed, X
} from 'lucide-react';
import { posApi } from '../../services/api';
import type { PublicPackage, SubscriptionTier } from '../../types';
import { ERP_FALLBACK_MONTHLY, PLANS, RECOMMENDED_PLAN, deviceLine, money, planFigures, planName } from '../../pages/register/registerCatalog';
import { useClickOutside } from '../../hooks/useClickOutside';

// ============================================================
// The sign-in page's own menu — Features, Pricing, Support — and its "Watch demo".
// Each shows something real: the plans as the server prices them, Cashly's contact details from
// Platform Settings, and the demo video when one is set (VITE_DEMO_VIDEO_URL), else a short
// walkthrough of how a business starts.
// ============================================================

export type LoginPanel = 'pricing' | 'support' | 'demo';

const DEMO_VIDEO_URL: string | undefined = import.meta.env.VITE_DEMO_VIDEO_URL || undefined;

/** A centred panel over the page; Esc or the backdrop closes it. */
const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm cursor-default" />
      <div className={`relative w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-3xl bg-white text-slate-900 shadow-2xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 bg-white/95 backdrop-blur border-b border-slate-100">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-xl inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

/** The kinds of business Cashly serves, and the screens each gets. */
const KINDS = [
  { icon: UtensilsCrossed, name: 'Restaurants and cafés', text: 'Tables, waiter tablets, kitchen screens, recipes and delivery' },
  { icon: ShoppingBag, name: 'Retail stores', text: 'Barcode selling, stock, suppliers and purchase orders' },
  { icon: Pill, name: 'Pharmacies', text: 'Batches and expiry, prescriptions and the controlled register' },
  { icon: ShoppingCart, name: 'Marts and cash & carry', text: 'Fast checkout, batch stock and credit customers' }
];

/** What every business gets, whatever its kind. */
const EVERY_BUSINESS = ['Sales and receipts', 'Customers and credit', 'Reports', 'Tax and FBR invoicing', 'Staff and permissions', 'Keeps selling offline'];

/**
 * A menu under a button in the sign-in page's top bar. It is placed against the window (not the
 * dark panel, which clips), right-aligned under its button and kept on screen; Esc, a click
 * outside or resizing the window closes it.
 */
const NavMenu: React.FC<{ label: string; width: number; children: (close: () => void) => React.ReactNode }> = ({ label, width, children }) => {
  const [place, setPlace] = useState<{ top: number; left: number; caret: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = place !== null;
  const close = useCallback(() => setPlace(null), []);
  useClickOutside(wrap, close, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); };
  }, [open, close]);

  const toggle = () => {
    if (open) { close(); return; }
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16));
    setPlace({ top: r.bottom + 12, left, caret: r.left + r.width / 2 - 6 });
  };

  return (
    <div ref={wrap}>
      <button ref={button} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true"
        className={`inline-flex items-center gap-1 px-3 h-9 rounded-lg text-sm font-medium transition cursor-pointer ${
          open ? 'text-white bg-white/[0.08]' : 'text-white/75 hover:text-white hover:bg-white/[0.08]'
        }`}>
        {label} <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {place && (
        <>
          <span aria-hidden style={{ top: place.top - 6, left: place.caret }}
            className="fixed z-50 w-3 h-3 rotate-45 rounded-[2px] bg-white transition duration-150 starting:opacity-0" />
          <div style={{ top: place.top, left: place.left, width }}
            className="fixed z-40 rounded-2xl bg-white text-slate-900 shadow-2xl shadow-black/30 ring-1 ring-slate-900/5 transition duration-150 ease-out starting:opacity-0 starting:translate-y-1">
            {children(close)}
          </div>
        </>
      )}
    </div>
  );
};

/** "Features ▾": what each kind of business gets, in a menu under the button. */
export const FeaturesMenu: React.FC<{ onPricing: () => void }> = ({ onPricing }) => (
  <NavMenu label="Features" width={600}>
    {close => (
      <>
        <div className="p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Built for your kind of business</p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
            {KINDS.map(({ icon: Icon, name, text }) => (
              <div key={name} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100 flex items-center justify-center shrink-0">
                  <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{name}</span>
                  <span className="block mt-0.5 text-[13px] leading-snug text-slate-500">{text}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl bg-gradient-to-r from-teal-50 to-emerald-50/50 ring-1 ring-inset ring-teal-100 px-3.5 py-3">
            <span className="w-9 h-9 rounded-lg bg-white text-teal-700 ring-1 ring-inset ring-teal-100 flex items-center justify-center shrink-0">
              <Building2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">A head office with outlets</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-600 text-white">POS + ERP</span>
              </span>
              <span className="block mt-0.5 text-[13px] leading-snug text-slate-500">Stock, buying, accounts and payroll for every outlet, from one place</span>
            </span>
          </div>
        </div>

        <div className="px-5 py-4 rounded-b-2xl bg-slate-50 border-t border-slate-100">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Every business gets</p>
            <button type="button" onClick={() => { close(); onPricing(); }}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-700 hover:text-teal-800 cursor-pointer">
              Compare plans <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="mt-2.5 grid grid-cols-3 gap-x-4 gap-y-2">
            {EVERY_BUSINESS.map(item => (
              <li key={item} className="flex items-center gap-1.5 text-[13px] text-slate-600">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" strokeWidth={2.5} /> {item}
              </li>
            ))}
          </ul>
        </div>
      </>
    )}
  </NavMenu>
);

/** The price list as the server has it; the built-in figures until it answers (or if it cannot). */
interface PublicPricing { packages: PublicPackage[]; erpMonthly: number }
let pricingRequest: Promise<PublicPricing> | null = null;
function loadPricing(): Promise<PublicPricing> {
  pricingRequest ??= Promise.all([
    posApi.getPublicPackages().catch(() => [] as PublicPackage[]),
    posApi.getPublicPlatformPrices().catch(() => [])
  ]).then(([rows, prices]) => {
    const packages = Array.isArray(rows) ? rows : [];
    if (packages.length === 0) pricingRequest = null; // ask again next time
    const erp = Array.isArray(prices) ? prices.find(r => r.key === 'HEAD_OFFICE_ERP') : undefined;
    return { packages, erpMonthly: erp?.monthlyPricePKR || ERP_FALLBACK_MONTHLY };
  });
  return pricingRequest;
}
function usePublicPricing(): PublicPricing {
  const [pricing, setPricing] = useState<PublicPricing>({ packages: [], erpMonthly: ERP_FALLBACK_MONTHLY });
  useEffect(() => {
    let cancelled = false;
    loadPricing().then(p => { if (!cancelled) setPricing(p); });
    return () => { cancelled = true; };
  }, []);
  return pricing;
}

/** What each plan is for, in one line (the full list is in the Pricing panel and at registration). */
const PLAN_SUMMARY: Record<SubscriptionTier, string> = {
  Starter: 'Sales, receipts, customers and tax reports',
  Standard: 'Adds stock, suppliers, loyalty and delivery',
  Professional: 'Adds accounting and payroll'
};

const PricingMenuBody: React.FC<{ onDetails: () => void }> = ({ onDetails }) => {
  const { packages, erpMonthly } = usePublicPricing();
  const outletFrom = Math.min(...PLANS.map(tier => planFigures(tier, packages).branchMonthly));
  return (
    <>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cashly POS · one shop</p>
          <p className="text-xs text-slate-400">Per month, excluding tax</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {PLANS.map(tier => {
            const f = planFigures(tier, packages);
            const recommended = tier === RECOMMENDED_PLAN;
            return (
              <div key={tier} className={`rounded-xl p-3.5 ring-inset ${recommended ? 'ring-2 ring-teal-500 bg-teal-50/40' : 'ring-1 ring-slate-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{planName(tier)}</p>
                  {recommended && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-600 text-white">Recommended</span>}
                </div>
                <p className="mt-2 leading-none">
                  <span className="text-xl font-semibold tracking-tight text-slate-900">{money(f.monthly)}</span>
                  <span className="text-xs text-slate-500"> /mo</span>
                </p>
                <p className="mt-1 text-[11px] text-slate-400">or {money(f.yearly)} a year</p>
                <p className="mt-3 text-[13px] leading-snug text-slate-600">{PLAN_SUMMARY[tier]}</p>
                <p className="mt-1.5 text-[11px] text-slate-400">{deviceLine(f, false)}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-gradient-to-r from-teal-50 to-emerald-50/50 ring-1 ring-inset ring-teal-100 px-3.5 py-3">
          <span className="w-9 h-9 rounded-lg bg-white text-teal-700 ring-1 ring-inset ring-teal-100 flex items-center justify-center shrink-0">
            <Building2 className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">A head office with outlets</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-600 text-white">POS + ERP</span>
            </span>
            <span className="block mt-0.5 text-[13px] leading-snug text-slate-500">The head office ERP, and each outlet on its own plan</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold text-slate-900">{money(erpMonthly)}<span className="text-xs font-normal text-slate-500"> /mo</span></span>
            <span className="block text-[11px] text-slate-500">+ outlets from {money(outletFrom)}</span>
          </span>
        </div>
      </div>

      <div className="px-5 py-3.5 rounded-b-2xl bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
        <p className="flex items-center gap-1.5 text-[13px] text-slate-600">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" strokeWidth={2.5} /> Free for 30 days, no card needed
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={onDetails}
            className="h-9 px-3 rounded-lg text-[13px] font-semibold text-slate-700 hover:bg-slate-200/70 transition cursor-pointer">
            Full details
          </button>
          <a href="/signup"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold transition">
            Start free trial <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </>
  );
};

/** "Pricing ▾": the plans at a glance, with the full list one click away. */
export const PricingMenu: React.FC<{ onDetails: () => void }> = ({ onDetails }) => (
  <NavMenu label="Pricing" width={640}>
    {close => <PricingMenuBody onDetails={() => { close(); onDetails(); }} />}
  </NavMenu>
);

/** Pricing: the plans as the server prices them, for one shop and for a head office with outlets. */
export const PricingPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { packages, erpMonthly } = usePublicPricing();

  return (
    <Modal title="Pricing" onClose={onClose} wide>
      <div className="space-y-6">
        <p className="text-sm text-slate-600">Every plan is free for 30 days, with no card needed. Prices are per month and exclude tax.</p>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold"><Store className="w-5 h-5 text-teal-600" /> Cashly POS — one shop</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {PLANS.map(tier => {
              const f = planFigures(tier, packages);
              return (
                <div key={tier} className={`rounded-2xl border p-4 ${tier === 'Standard' ? 'border-teal-500 ring-1 ring-teal-500 bg-teal-50/40' : 'border-slate-200'}`}>
                  <p className="font-semibold">{planName(tier)}</p>
                  <p className="mt-1"><span className="text-2xl font-semibold tracking-tight">{money(f.monthly)}</span><span className="text-sm text-slate-500"> / month</span></p>
                  <p className="text-xs text-slate-500">or {money(f.yearly)} a year</p>
                  <ul className="mt-3 space-y-1 text-sm text-slate-700">
                    <li className="flex gap-1.5"><Check className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" /> {f.tills} till{f.tills === 1 ? '' : 's'}, {f.tablets} tablets</li>
                    {tier === 'Starter' && <li className="flex gap-1.5"><Check className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" /> Sales, receipts, customers</li>}
                    {tier === 'Standard' && <li className="flex gap-1.5"><Check className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" /> Stock, purchasing, loyalty, delivery</li>}
                    {tier === 'Professional' && <li className="flex gap-1.5"><Check className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" /> Accounting and payroll</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold"><Building2 className="w-5 h-5 text-teal-600" /> Cashly POS + ERP — head office and outlets</h3>
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            <div className="flex items-center justify-between gap-3 p-4">
              <span><span className="block font-semibold">Head office ERP</span><span className="block text-xs text-slate-500">Stock, buying, accounts, payroll and reports for every outlet</span></span>
              <span className="font-semibold whitespace-nowrap">{money(erpMonthly)} <span className="text-sm font-normal text-slate-500">/ month</span></span>
            </div>
            {PLANS.map(tier => (
              <div key={tier} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>Each outlet on <span className="font-medium">{planName(tier)}</span></span>
                <span className="font-semibold whitespace-nowrap">{money(planFigures(tier, packages).branchMonthly)} <span className="font-normal text-slate-500">/ month</span></span>
              </div>
            ))}
          </div>
        </section>

        <a href="/signup" className="flex items-center justify-center gap-2 h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[15px] font-semibold transition">
          Register free — 30-day trial <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </Modal>
  );
};

/** Support: help with signing in, and how to reach Cashly. */
export const SupportPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [contact, setContact] = useState<{ companyName: string; phone?: string | null; email?: string | null; website?: string | null } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    posApi.getPublicSupport().then(c => { if (!cancelled) setContact(c); }).catch(() => { /* help topics still show */ });
    return () => { cancelled = true; };
  }, []);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1500); }).catch(() => { /* the text is on screen */ });
  };
  const contactRow = (Icon: typeof Phone, label: string, value: string, href: string) => (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
      <Icon className="w-5 h-5 text-teal-600 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-slate-500">{label}</span>
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="block text-sm font-medium text-slate-900 truncate hover:text-teal-700">{value}</a>
      </span>
      <button type="button" onClick={() => copy(value)} className="text-xs font-semibold text-teal-700 inline-flex items-center gap-1 cursor-pointer">
        {copied === value ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
      </button>
    </div>
  );
  const hasContact = !!(contact?.phone || contact?.email || contact?.website);

  return (
    <Modal title="Support" onClose={onClose}>
      <div className="space-y-5">
        <div className="space-y-2">
          {[
            { icon: KeyRound, t: 'Forgot your PIN?', d: 'Ask your manager or the owner to set a new one in Staff & PINs. Owners: contact us below.' },
            { icon: Mail, t: 'Forgot your password?', d: 'Type your work email, press Continue, then "Forgot password?" to get a reset link.' },
            { icon: MonitorSmartphone, t: 'Connecting a new till or tablet?', d: 'Your manager makes a pairing code in Settings → Devices. On the new device press "Connect a till" and type it.' }
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex gap-3 p-3 rounded-xl border border-slate-200">
              <Icon className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
              <span><span className="block text-sm font-semibold">{t}</span><span className="block text-sm text-slate-600">{d}</span></span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><LifeBuoy className="w-4 h-4 text-teal-600" /> Contact {contact?.companyName || 'Cashly'}</h3>
          {hasContact ? (
            <>
              {contact?.phone && contactRow(Phone, 'Phone / WhatsApp', contact.phone, `tel:${contact.phone.replace(/[^\d+]/g, '')}`)}
              {contact?.email && contactRow(Mail, 'Email', contact.email, `mailto:${contact.email}`)}
              {contact?.website && contactRow(Globe, 'Website', contact.website, contact.website.startsWith('http') ? contact.website : `https://${contact.website}`)}
            </>
          ) : (
            <p className="text-sm text-slate-500">Ask the person who set up Cashly for your business.</p>
          )}
        </div>
      </div>
    </Modal>
  );
};

/** Watch demo: the demo video when one is set, else how a business starts, in four steps. */
export const DemoPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Modal title="How Cashly works" onClose={onClose} wide={!!DEMO_VIDEO_URL}>
    {DEMO_VIDEO_URL ? (
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black">
        <iframe src={DEMO_VIDEO_URL} title="Cashly demo" className="w-full h-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
      </div>
    ) : (
      <div className="space-y-5">
        <ol className="space-y-3">
          {[
            { t: 'Register your business', d: 'Choose Cashly POS for one shop, or POS + ERP for a head office with outlets. Free for 30 days.' },
            { t: 'Add your products and prices', d: 'Your menu, catalogue or medicines, with tax set the way your province charges it.' },
            { t: 'Connect your tills', d: 'Open Cashly on the counter PC or tablet and connect it with a pairing code. Staff sign in with their PIN.' },
            { t: 'Sell, and watch it add up', d: 'Receipts, stock, the Z-report at day end, and reports for every outlet.' }
          ].map((s, i) => (
            <li key={s.t} className="flex gap-3">
              <span className="w-8 h-8 rounded-full bg-teal-600 text-white text-sm font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
              <span><span className="block font-semibold">{s.t}</span><span className="block text-sm text-slate-600">{s.d}</span></span>
            </li>
          ))}
        </ol>
        <a href="/signup" className="flex items-center justify-center gap-2 h-11 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-[15px] font-semibold transition">
          <PlayCircle className="w-5 h-5" /> Start your free trial
        </a>
      </div>
    )}
  </Modal>
);

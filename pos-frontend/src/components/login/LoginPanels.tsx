import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Building2, Check, ChevronDown, Copy, Globe, KeyRound, LifeBuoy, Mail, MonitorSmartphone, Phone,
  Pill, PlayCircle, ShoppingBag, ShoppingCart, Store, UtensilsCrossed, X
} from 'lucide-react';
import { posApi } from '../../services/api';
import type { PublicPackage } from '../../types';
import { ERP_FALLBACK_MONTHLY, PLANS, money, planFigures, planName } from '../../pages/register/registerCatalog';
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
          <h2 className="text-lg font-bold">{title}</h2>
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
  { icon: UtensilsCrossed, name: 'Restaurants and cafés', text: 'Tables, waiter tablets, kitchen screens, recipes and delivery.' },
  { icon: ShoppingBag, name: 'Retail stores', text: 'Barcode selling, stock, suppliers and purchase orders.' },
  { icon: Pill, name: 'Pharmacies', text: 'Batches and expiry, prescriptions, the controlled register.' },
  { icon: ShoppingCart, name: 'Marts and cash & carry', text: 'Fast checkout, stock with batches and expiry, credit customers.' }
];

/** "Features ▾": what each kind of business gets, in a menu under the button. */
export const FeaturesMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="inline-flex items-center gap-1 px-3 h-10 rounded-xl text-sm font-semibold text-white/90 hover:text-white hover:bg-white/10 transition cursor-pointer">
        Features <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] rounded-2xl bg-white text-slate-900 shadow-2xl p-2 z-40">
          {KINDS.map(({ icon: Icon, name, text }) => (
            <div key={name} className="flex gap-3 p-3 rounded-xl hover:bg-slate-50">
              <span className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
              <span>
                <span className="block text-sm font-bold">{name}</span>
                <span className="block text-xs text-slate-500">{text}</span>
              </span>
            </div>
          ))}
          <div className="m-1 mt-2 p-3 rounded-xl bg-slate-50 text-xs text-slate-600">
            Every business: sales and receipts, customers and credit, reports, tax and FBR invoicing, staff and permissions,
            and the ERP for a head office with several outlets.
          </div>
        </div>
      )}
    </div>
  );
};

/** Pricing: the plans as the server prices them, for one shop and for a head office with outlets. */
export const PricingPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [erpMonthly, setErpMonthly] = useState(ERP_FALLBACK_MONTHLY);
  useEffect(() => {
    let cancelled = false;
    posApi.getPublicPackages().then(rows => { if (!cancelled && Array.isArray(rows)) setPackages(rows); }).catch(() => { /* built-in figures */ });
    posApi.getPublicPlatformPrices()
      .then(rows => { const erp = rows.find(r => r.key === 'HEAD_OFFICE_ERP'); if (!cancelled && erp?.monthlyPricePKR) setErpMonthly(erp.monthlyPricePKR); })
      .catch(() => { /* built-in figure */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <Modal title="Pricing" onClose={onClose} wide>
      <div className="space-y-6">
        <p className="text-sm text-slate-600">Every plan is free for 30 days, with no card needed. Prices are per month and exclude tax.</p>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 font-bold"><Store className="w-5 h-5 text-teal-600" /> Cashly POS — one shop</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            {PLANS.map(tier => {
              const f = planFigures(tier, packages);
              return (
                <div key={tier} className={`rounded-2xl border-2 p-4 ${tier === 'Standard' ? 'border-teal-500 bg-teal-50/40' : 'border-slate-200'}`}>
                  <p className="font-bold">{planName(tier)}</p>
                  <p className="mt-1"><span className="text-2xl font-extrabold">{money(f.monthly)}</span><span className="text-sm text-slate-500"> / month</span></p>
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
          <h3 className="flex items-center gap-2 font-bold"><Building2 className="w-5 h-5 text-teal-600" /> Cashly POS + ERP — head office and outlets</h3>
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            <div className="flex items-center justify-between gap-3 p-4">
              <span><span className="block font-bold">Head office ERP</span><span className="block text-xs text-slate-500">Stock, buying, accounts, payroll and reports for every outlet</span></span>
              <span className="font-extrabold whitespace-nowrap">{money(erpMonthly)} <span className="text-sm font-normal text-slate-500">/ month</span></span>
            </div>
            {PLANS.map(tier => (
              <div key={tier} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>Each outlet on <strong>{planName(tier)}</strong></span>
                <span className="font-bold whitespace-nowrap">{money(planFigures(tier, packages).branchMonthly)} <span className="font-normal text-slate-500">/ month</span></span>
              </div>
            ))}
          </div>
        </section>

        <a href="/signup" className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition">
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
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="block text-sm font-bold text-slate-900 truncate hover:text-teal-700">{value}</a>
      </span>
      <button type="button" onClick={() => copy(value)} className="text-xs font-bold text-teal-700 inline-flex items-center gap-1 cursor-pointer">
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
              <span><span className="block text-sm font-bold">{t}</span><span className="block text-sm text-slate-600">{d}</span></span>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold"><LifeBuoy className="w-4 h-4 text-teal-600" /> Contact {contact?.companyName || 'Cashly'}</h3>
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
              <span className="w-8 h-8 rounded-full bg-teal-600 text-white text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span><span className="block font-bold">{s.t}</span><span className="block text-sm text-slate-600">{s.d}</span></span>
            </li>
          ))}
        </ol>
        <a href="/signup" className="flex items-center justify-center gap-2 h-12 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition">
          <PlayCircle className="w-5 h-5" /> Start your free trial
        </a>
      </div>
    )}
  </Modal>
);

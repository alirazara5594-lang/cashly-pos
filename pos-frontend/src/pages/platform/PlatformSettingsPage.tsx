import React, { useEffect, useState } from 'react';
import { Save, RefreshCw, Building2, Landmark, Percent, CalendarClock, MessageCircle, ShieldCheck, Send, AlertTriangle } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../../services/api';
import { usePosStore } from '../../store/posStore';
import type { PlatformMessageRow, PlatformSettingsData } from '../../types';

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:bg-slate-50';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';

const Card: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
    <div>
      <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">{icon}{title}</h2>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
    {children}
  </section>
);

type Form = PlatformSettingsData & { whatsAppApiKey?: string; whatsAppApiSecret?: string; whatsAppAccessToken?: string };

/**
 * Cashly's own details and the rules billing runs by: what an invoice says about you and how
 * customers pay, tax on the subscription, when invoices and reminders go out, whether unpaid parts
 * stop on their own, the WhatsApp line reminders are sent from, and the team's 2-step rule.
 */
export const PlatformSettingsPage: React.FC = () => {
  const currentUser = usePosStore(s => s.currentUser);
  const canEdit = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
  const [form, setForm] = useState<Form | null>(null);
  const [emailReady, setEmailReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResults, setTestResults] = useState<PlatformMessageRow[] | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    posApi.getPlatformSettings()
      .then(res => { if (!cancelled) { setForm(res.settings); setEmailReady(res.emailReady); } })
      .catch(err => { if (!cancelled) setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not load the settings.') }); });
    return () => { cancelled = true; };
  }, []);

  if (!form) {
    return message
      ? <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{message.text}</div>
      : <div className="flex items-center justify-center py-20"><RefreshCw className="w-6 h-6 text-slate-400 animate-spin" /></div>;
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => (f ? { ...f, [key]: value } : f));
  const text = (key: keyof Form, label: string, placeholder?: string, wide?: boolean) => (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className={labelCls}>{label}</label>
      <input disabled={!canEdit} value={(form[key] as string | null | undefined) ?? ''} placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as Form[typeof key])} className={inputCls} />
    </div>
  );
  const toggle = (key: keyof Form, label: string, hint?: string) => (
    <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
      <input type="checkbox" disabled={!canEdit} checked={!!form[key]} onChange={(e) => set(key, e.target.checked as Form[typeof key])} className="w-4 h-4 mt-0.5 accent-teal-500" />
      <span><span className="font-bold">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
    </label>
  );

  const paymentFilled = !!(form.bankIban || form.bankAccountNumber || form.jazzCashNumber || form.easypaisaNumber || form.raastId);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await posApi.savePlatformSettings(form);
      setForm({ ...res.settings, whatsAppApiKey: '', whatsAppApiSecret: '', whatsAppAccessToken: '' });
      setMessage({ ok: true, text: 'Settings saved.' });
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not save the settings.') });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResults(null);
    try {
      setTestResults(await posApi.sendPlatformTestMessage(testPhone.trim() || undefined, testEmail.trim() || undefined));
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err, 'Could not send the test.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {!canEdit && (
        <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold">View only — settings are changed by a platform owner.</div>
      )}
      {!paymentFilled && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Add at least one way to pay (bank account or wallet) below — your invoices and reminders show it to customers.</span>
        </div>
      )}

      <Card icon={<Building2 className="w-4 h-4 text-teal-600" />} title="Your company" hint="Printed at the top of every invoice.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('companyName', 'Name customers see', 'Cashly')}
          {text('legalName', 'Registered name', 'Cashly Technologies (Pvt) Ltd')}
          {text('ntn', 'NTN')}
          {text('strn', 'STRN (if registered for sales tax)')}
          {text('address', 'Address', undefined, true)}
          {text('city', 'City')}
          {text('phone', 'Phone')}
          {text('email', 'Billing email')}
          {text('website', 'Website')}
        </div>
      </Card>

      <Card icon={<Landmark className="w-4 h-4 text-teal-600" />} title="How customers pay you" hint="Shown on invoices, in reminders and on each business's Plan page.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('bankName', 'Bank', 'e.g. Meezan Bank')}
          {text('bankAccountTitle', 'Account title')}
          {text('bankAccountNumber', 'Account number')}
          {text('bankIban', 'IBAN', 'PK..')}
          {text('jazzCashNumber', 'JazzCash number')}
          {text('easypaisaNumber', 'Easypaisa number')}
          {text('raastId', 'Raast ID')}
          <div className="sm:col-span-2">
            <label className={labelCls}>Anything else about paying</label>
            <textarea disabled={!canEdit} rows={2} value={form.paymentInstructions ?? ''} onChange={(e) => set('paymentInstructions', e.target.value)}
              placeholder="e.g. Send the payment screenshot on WhatsApp 0300 1234567" className={`${inputCls} resize-none`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Invoice footer</label>
            <input disabled={!canEdit} value={form.invoiceFooter ?? ''} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder="e.g. Thank you for choosing Cashly." className={inputCls} />
          </div>
        </div>
      </Card>

      <Card icon={<Percent className="w-4 h-4 text-teal-600" />} title="Tax on the subscription" hint="Leave at 0 if you do not charge tax on Cashly's own invoices. Applies to invoices raised from now on.">
        <div className="grid sm:grid-cols-2 gap-3">
          {text('taxLabel', 'Tax name on the invoice', 'Sales tax')}
          <div>
            <label className={labelCls}>Rate (%)</label>
            <input disabled={!canEdit} type="number" min={0} max={50} step="0.5" value={form.taxRatePercent} onChange={(e) => set('taxRatePercent', Number(e.target.value) || 0)} className={inputCls} />
          </div>
        </div>
      </Card>

      <Card icon={<CalendarClock className="w-4 h-4 text-teal-600" />} title="Renewals" hint="Runs by itself every hour (or press Run renewals now on Billing).">
        <div className="space-y-3">
          {toggle('autoInvoice', 'Raise each renewal\'s invoice by itself', 'One invoice per renewal date — the ERP, each outlet\'s POS and each tablet on their own dates.')}
          <div className="grid sm:grid-cols-2 gap-3 pl-6">
            <div>
              <label className={labelCls}>Days before the renewal</label>
              <input disabled={!canEdit} type="number" min={0} max={60} value={form.invoiceDaysBefore} onChange={(e) => set('invoiceDaysBefore', Number(e.target.value) || 0)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Days to pay (when the renewal date has passed)</label>
              <input disabled={!canEdit} type="number" min={1} max={60} value={form.invoiceDueDays} onChange={(e) => set('invoiceDueDays', Number(e.target.value) || 1)} className={inputCls} />
            </div>
          </div>
          {toggle('autoReminders', 'Send reminders, invoices and receipts to customers', 'On WhatsApp (the line below) and email. Fill in your company and payment details first.')}
          <div className="pl-6">
            <label className={labelCls}>When reminders go out (days; minus = after the date)</label>
            <input disabled={!canEdit} value={form.reminderDays} onChange={(e) => set('reminderDays', e.target.value)} placeholder="7,1,-1,-3" className={`${inputCls} max-w-xs`} />
            <p className="text-[10px] text-slate-500 mt-1">7,1,-1,-3 means 7 days and 1 day before, then 1 and 3 days after.</p>
          </div>
          {toggle('emailReminders', 'Also send them by email', emailReady ? 'Email is set up on the server.' : 'Email is not set up on the server yet, so only WhatsApp is used.')}
          {toggle('autoStopUnpaid', 'Stop what stays unpaid', 'Only the unpaid part stops — that outlet\'s tills, that tablet, the head office\'s changes, or that add-on. Everything else keeps working. A promise to pay (customer notes) holds it.')}
          <div className="pl-6">
            <label className={labelCls}>Days after the renewal date</label>
            <input disabled={!canEdit} type="number" min={0} max={90} value={form.stopAfterDays} onChange={(e) => set('stopAfterDays', Number(e.target.value) || 0)} className={`${inputCls} max-w-xs`} />
          </div>
        </div>
      </Card>

      <Card icon={<MessageCircle className="w-4 h-4 text-teal-600" />} title="Your WhatsApp line" hint="The number reminders are sent from — your own business WhatsApp API account, not a customer's.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Provider</label>
            <select disabled={!canEdit} value={form.whatsAppProvider} onChange={(e) => set('whatsAppProvider', e.target.value)} className={inputCls}>
              <option value="Manual">Not connected (send by hand)</option>
              <option value="MetaAPI">Meta WhatsApp Cloud API</option>
              <option value="Twilio">Twilio</option>
              <option value="Whaticket">Whaticket</option>
            </select>
          </div>
          {text('whatsAppPhoneNumberId', form.whatsAppProvider === 'Twilio' ? 'From number' : 'Phone number ID')}
          {form.whatsAppProvider !== 'Manual' && (
            <>
              <div>
                <label className={labelCls}>{form.whatsAppProvider === 'Twilio' ? 'Account SID' : 'API key'} {form.hasWhatsAppApiKey && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppApiKey ?? ''} onChange={(e) => set('whatsAppApiKey', e.target.value)} placeholder={form.hasWhatsAppApiKey ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{form.whatsAppProvider === 'Twilio' ? 'Auth token' : 'API secret'} {form.hasWhatsAppApiSecret && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppApiSecret ?? ''} onChange={(e) => set('whatsAppApiSecret', e.target.value)} placeholder={form.hasWhatsAppApiSecret ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Access token {form.hasWhatsAppAccessToken && <span className="text-teal-600 normal-case">· saved</span>}</label>
                <input disabled={!canEdit} type="password" value={form.whatsAppAccessToken ?? ''} onChange={(e) => set('whatsAppAccessToken', e.target.value)} placeholder={form.hasWhatsAppAccessToken ? 'Leave blank to keep' : ''} className={inputCls} />
              </div>
            </>
          )}
        </div>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="text-[11px] font-bold text-slate-700">Send a test (save first)</div>
          <div className="flex flex-wrap gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Mobile, e.g. 0300 1234567" className={`${inputCls} max-w-[14rem]`} />
            <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Email" className={`${inputCls} max-w-[14rem]`} />
            <button onClick={sendTest} disabled={testing || (!testPhone.trim() && !testEmail.trim())}
              className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> {testing ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {testResults?.map(r => (
            <div key={r.id} className={`text-[11px] font-semibold ${r.status === 'sent' ? 'text-teal-700' : 'text-rose-600'}`}>
              {r.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}: {r.status}{r.error ? ` — ${r.error}` : ''}
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<ShieldCheck className="w-4 h-4 text-teal-600" />} title="Platform team">
        {toggle('requireTwoStepForTeam', 'Everyone on the team must use 2-step sign-in', 'Until they turn it on, they can only do that. Strongly recommended: this console can change every customer.')}
      </Card>

      {message && (
        <div className={`px-3 py-2 rounded-xl text-xs font-semibold border ${message.ok ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{message.text}</div>
      )}
      {canEdit && (
        <div className="sticky bottom-4 flex justify-end">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
};

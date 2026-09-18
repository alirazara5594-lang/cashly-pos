import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  Smartphone,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
  ServerCog
} from 'lucide-react';
import { posApi } from '../services/api';
import type { PaymentProvider } from '../types';

interface ProviderCard {
  provider: PaymentProvider;
  label: string;
  description: string;
  icon: React.ElementType;
  envHint: string;
}

/** Cash never needs a gateway — it is deliberately absent from this screen. */
const PROVIDERS: ProviderCard[] = [
  {
    provider: 'JazzCash',
    label: 'JazzCash',
    description: 'Mobile wallet payments and JazzCash merchant checkout.',
    icon: Smartphone,
    envHint: 'Payments__JazzCash__MerchantId / Password / IntegritySalt'
  },
  {
    provider: 'EasyPaisa',
    label: 'EasyPaisa',
    description: 'Telenor EasyPaisa wallet and over-the-counter payments.',
    icon: Smartphone,
    envHint: 'Payments__EasyPaisa__StoreId / HashKey'
  },
  {
    provider: 'Card',
    label: 'Card Gateway',
    description: 'Debit and credit card acquiring through the card processor.',
    icon: CreditCard,
    envHint: 'Payments__Card__MerchantId / ApiKey'
  }
];

export const PaymentSettings: React.FC = () => {
  // The backend exposes no config-editing endpoint for gateway credentials — they
  // are server configuration. Some builds expose a read-only status route; when it
  // is missing we simply say so rather than guessing at connectivity.
  const [statusByProvider, setStatusByProvider] = useState<Record<string, boolean> | null>(null);
  const [statusAvailable, setStatusAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await posApi.getPaymentProviderStatus();
      if (Array.isArray(rows)) {
        const map: Record<string, boolean> = {};
        rows.forEach(r => { map[r.provider] = !!r.isConfigured; });
        setStatusByProvider(map);
        setStatusAvailable(true);
      } else {
        setStatusAvailable(false);
      }
    } catch {
      // No status route on this server build — fall back to the informational view.
      setStatusByProvider(null);
      setStatusAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <CreditCard className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Payment Gateways</h1>
            <p className="text-[11px] text-slate-500 mt-1">Connection status for digital payment providers</p>
          </div>
        </div>

        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Recheck</span>
        </button>
      </div>

      <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl bg-blue-50 border border-blue-200">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-[11px] text-blue-800 leading-relaxed">
          <p className="font-bold">Credentials are set on the server, not here.</p>
          <p className="mt-0.5">
            Gateway merchant IDs and secrets live in the server's configuration (environment
            variables or <span className="font-mono">appsettings</span>), so they are never stored
            or edited from the POS. Until a provider's credentials are added, card and wallet sales
            keep working exactly as they do today: the cashier records the payment manually and the
            order is completed normally.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PROVIDERS.map(({ provider, label, description, icon: Icon, envHint }) => {
          const isConfigured = statusAvailable ? !!statusByProvider?.[provider] : false;
          return (
            <div key={provider} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
                  <Icon className="w-4 h-4" />
                </div>
                {statusAvailable ? (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${
                    isConfigured
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    {isConfigured ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {isConfigured ? 'Connected' : 'Not connected'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border bg-amber-50 text-amber-700 border-amber-200">
                    <ServerCog className="w-3 h-3" />
                    Server configured
                  </span>
                )}
              </div>

              <div>
                <h2 className="text-sm font-black text-slate-900">{label}</h2>
                <p className="text-[11px] text-slate-500 leading-snug mt-1">{description}</p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Server setting</p>
                <p className="text-[10px] font-mono text-slate-600 break-all mt-0.5">{envHint}</p>
              </div>

              <p className="text-[11px] text-slate-400 leading-snug">
                {statusAvailable && isConfigured
                  ? 'Live transactions can be initiated for this provider.'
                  : 'Not connected — add credentials to the server configuration to enable live transactions. Staff can still take this tender manually at the till.'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h2 className="text-sm font-black text-slate-900">Cash</h2>
        <p className="text-[11px] text-slate-500 leading-snug mt-1">
          Cash needs no gateway. It is always available at the till and settles through the
          cash shift and Z-report, not through a payment provider.
        </p>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bike,
  RefreshCw,
  Save,
  Info,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  AlertCircle
} from 'lucide-react';
import { posApi, getApiErrorMessage, getApiErrorStatus } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { DeliveryIntegrationConfig } from '../types';

const PLATFORMS = [
  {
    key: 'Foodpanda',
    label: 'Foodpanda',
    blurb: 'Pull Foodpanda orders straight onto the delivery board and push status updates back.'
  },
  {
    key: 'Other',
    label: 'Other Platform',
    blurb: 'A generic slot for any additional aggregator the server has been taught to talk to.'
  }
];

export const DeliveryIntegrationSettings: React.FC = () => {
  const { currentUser, modulePermissions } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit');

  const [platform, setPlatform] = useState<string>(PLATFORMS[0].key);
  const [config, setConfig] = useState<DeliveryIntegrationConfig>({ isEnabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** True when the server has no config row / no route for this platform yet. */
  const [unavailable, setUnavailable] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setUnavailable(false);
    try {
      const data = await posApi.getDeliveryIntegrationConfig(platform);
      // Shape is read defensively — only `isEnabled` is relied upon, everything
      // else is preserved and round-tripped on save.
      setConfig(data && typeof data === 'object' ? data : { isEnabled: false });
    } catch (err) {
      const status = getApiErrorStatus(err);
      if (status === 404) {
        setConfig({ isEnabled: false });
        setUnavailable(true);
      } else {
        setConfig({ isEnabled: false });
        setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load integration config') });
      }
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await posApi.updateDeliveryIntegrationConfig(platform, { ...config, platform });
      if (saved && typeof saved === 'object') setConfig(saved);
      setMessage({ type: 'success', text: `${platform} settings saved` });
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save integration config') });
    } finally {
      setSaving(false);
    }
  };

  const hasCredentials = !!(config.apiKey || config.apiSecret || config.storeId);
  const isConnected = config.isConfigured ?? (!!config.isEnabled && hasCredentials);
  const active = PLATFORMS.find(p => p.key === platform) || PLATFORMS[0];

  const textField = (
    key: 'apiKey' | 'apiSecret' | 'storeId' | 'webhookUrl',
    label: string,
    placeholder: string,
    isSecret = false
  ) => (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
      <input
        type={isSecret ? 'password' : 'text'}
        value={(config[key] as string) || ''}
        disabled={!canEdit}
        onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60"
      />
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <Bike className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Delivery Integrations</h1>
            <p className="text-[11px] text-slate-500 mt-1">Connect aggregator platforms to the delivery board</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
            {PLATFORMS.map(p => (
              <button
                key={p.key}
                onClick={() => setPlatform(p.key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  platform === p.key ? 'bg-teal-500 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success'
            ? 'bg-teal-50 border-teal-200 text-teal-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{message.text}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900">{active.label}</h2>
            <p className="text-[11px] text-slate-500 leading-snug mt-1 max-w-lg">{active.blurb}</p>
          </div>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${
            isConnected
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}>
            {isConnected ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {isConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {!isConnected && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-blue-50 border border-blue-200">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-800 leading-relaxed">
              Not connected — add the partner credentials below and enable the integration. Until a
              live merchant account exists, {active.label} orders keep arriving the way they do
              today (entered at the till or over the phone); nothing in the current workflow changes.
            </p>
          </div>
        )}

        {unavailable && (
          <div className="px-3.5 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            This server build does not expose a saved configuration for {active.label} yet. You can
            still fill the fields in — saving will create the configuration once the endpoint is live.
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-400">Loading configuration…</p>
        ) : (
          <>
            <button
              onClick={() => canEdit && setConfig({ ...config, isEnabled: !config.isEnabled })}
              disabled={!canEdit}
              className="flex items-center gap-1.5 text-xs font-bold disabled:opacity-60"
            >
              {config.isEnabled ? (
                <><ToggleRight className="w-6 h-6 text-teal-500" /><span className="text-teal-700">Integration enabled</span></>
              ) : (
                <><ToggleLeft className="w-6 h-6 text-slate-300" /><span className="text-slate-500">Integration disabled</span></>
              )}
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {textField('apiKey', 'API Key', 'Partner API key')}
              {textField('apiSecret', 'API Secret', '••••••••', true)}
              {textField('storeId', 'Store / Vendor ID', 'Platform store identifier')}
              {textField('webhookUrl', 'Webhook URL', 'https://…')}
            </div>

            {config.lastSyncAt && (
              <p className="text-[11px] text-slate-400">
                Last sync: {new Date(String(config.lastSyncAt)).toLocaleString()}
              </p>
            )}

            {canEdit ? (
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving…' : 'Save Integration Settings'}</span>
              </button>
            ) : (
              <p className="text-[11px] text-slate-400">
                You have view-only access — an owner or administrator can change these settings.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

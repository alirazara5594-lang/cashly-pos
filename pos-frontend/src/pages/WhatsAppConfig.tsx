import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  RefreshCw,
  Send,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Phone,
  ToggleLeft,
  ToggleRight,
  Clock,
  Save,
  TestTube2,
  ChevronDown
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';

interface WhatsAppConfigData {
  provider: string;
  apiKey: string;
  apiSecret: string;
  phoneNumberId: string;
  accessToken: string;
  webhookUrl: string;
  isEnabled: boolean;
  autoSendOrderUpdates: boolean;
  autoSendReceipt: boolean;
}

/** The server never echoes back saved secrets — only whether one is already on file. */
interface SecretStatus {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasAccessToken: boolean;
}

interface WhatsAppLog {
  id: string;
  phoneNumber: string;
  messageType: string;
  status: string;
  sentAt: string;
  tenantName?: string;
}

export const WhatsAppConfig: React.FC = () => {
  const [config, setConfig] = useState<WhatsAppConfigData>({
    provider: 'Manual',
    apiKey: '',
    apiSecret: '',
    phoneNumberId: '',
    accessToken: '',
    webhookUrl: '',
    isEnabled: false,
    autoSendOrderUpdates: false,
    autoSendReceipt: false,
  });
  const [secretStatus, setSecretStatus] = useState<SecretStatus>({ hasApiKey: false, hasApiSecret: false, hasAccessToken: false });
  const [logs, setLogs] = useState<WhatsAppLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [configData, logsData] = await Promise.all([
        posApi.getWhatsAppConfig().catch(() => null),
        posApi.getWhatsAppLogs(50).catch(() => [])
      ]);
      if (configData) {
        // Secrets are never returned by the server — only whether one is already saved.
        // Leaving these blank on save keeps whatever is already on file.
        setConfig({
          provider: configData.provider || 'Manual',
          apiKey: '',
          apiSecret: '',
          phoneNumberId: configData.phoneNumberId || '',
          accessToken: '',
          webhookUrl: configData.webhookUrl || '',
          isEnabled: configData.isEnabled || false,
          autoSendOrderUpdates: configData.autoSendOrderUpdates || false,
          autoSendReceipt: configData.autoSendReceipt || false,
        });
        setSecretStatus({
          hasApiKey: !!configData.hasApiKey,
          hasApiSecret: !!configData.hasApiSecret,
          hasAccessToken: !!configData.hasAccessToken,
        });
      }
      setLogs(Array.isArray(logsData) ? logsData : []);
    } catch (err) {
      console.error('Failed to load WhatsApp config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await posApi.saveWhatsAppConfig(config);
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      await loadData(); // refresh secret-saved indicators
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save configuration') });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testPhone.trim()) return;
    setTestSending(true);
    setMessage(null);
    try {
      const result = await posApi.sendWhatsAppTest(testPhone, 'CashlyPOS Test');
      // The server never fakes success — a rejected/unconfigured send comes back as sent:false.
      if (result?.sent) {
        setMessage({ type: 'success', text: `Test message sent to ${testPhone}` });
        setTestPhone('');
      } else {
        setMessage({ type: 'error', text: result?.message || 'The message was not actually sent.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to send test message') });
    } finally {
      setTestSending(false);
    }
  };

  const statusCounts = logs.reduce(
    (acc, log) => {
      if (log.status === 'sent' || log.status === 'delivered') acc.sent++;
      else if (log.status === 'failed') acc.failed++;
      else acc.pending++;
      return acc;
    },
    { sent: 0, failed: 0, pending: 0 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-teal-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading WhatsApp configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-teal-500" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900">WhatsApp Configuration</h1>
            <p className="text-xs text-slate-500">Configure WhatsApp notifications for order updates</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Status Indicators */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Sent / Delivered</span>
          </div>
          <div className="text-2xl font-black text-teal-600">{statusCounts.sent}</div>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Pending</span>
          </div>
          <div className="text-2xl font-black text-amber-600">{statusCounts.pending}</div>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-rose-500" />
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Failed</span>
          </div>
          <div className="text-2xl font-black text-rose-600">{statusCounts.failed}</div>
        </div>
      </div>

      {/* Config Form */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-5">
        <h2 className="text-sm font-bold text-slate-900">Provider Settings</h2>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Provider</label>
          <div className="relative">
            <select
              value={config.provider}
              onChange={(e) => setConfig({ ...config, provider: e.target.value })}
              className="w-full appearance-none pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
            >
              <option value="Manual">Manual (No API)</option>
              <option value="Twilio">Twilio</option>
              <option value="MetaAPI">Meta API (Cloud API)</option>
              <option value="Whaticket">Whaticket</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
              API Key {secretStatus.hasApiKey && <span className="text-teal-600 normal-case font-semibold">(saved — leave blank to keep it)</span>}
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={secretStatus.hasApiKey ? '•••••••• (unchanged)' : 'Enter API key'}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
              API Secret {secretStatus.hasApiSecret && <span className="text-teal-600 normal-case font-semibold">(saved — leave blank to keep it)</span>}
            </label>
            <input
              type="password"
              value={config.apiSecret}
              onChange={(e) => setConfig({ ...config, apiSecret: e.target.value })}
              placeholder={secretStatus.hasApiSecret ? '•••••••• (unchanged)' : 'Enter API secret'}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Phone Number ID</label>
            <input
              value={config.phoneNumberId}
              onChange={(e) => setConfig({ ...config, phoneNumberId: e.target.value })}
              placeholder="WhatsApp phone number ID"
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
              Access Token {secretStatus.hasAccessToken && <span className="text-teal-600 normal-case font-semibold">(saved — leave blank to keep it)</span>}
            </label>
            <input
              type="password"
              value={config.accessToken}
              onChange={(e) => setConfig({ ...config, accessToken: e.target.value })}
              placeholder={secretStatus.hasAccessToken ? '•••••••• (unchanged)' : 'Long-lived access token'}
              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Webhook URL</label>
          <input
            value={config.webhookUrl}
            onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
            placeholder="https://your-domain.com/api/whatsapp/webhook"
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
        </div>

        {/* Toggle Switches */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <div className="text-xs font-bold text-slate-900">Enable WhatsApp Notifications</div>
              <div className="text-[10px] text-slate-500">Master toggle for all WhatsApp messages</div>
            </div>
            <button
              onClick={() => setConfig({ ...config, isEnabled: !config.isEnabled })}
              className="transition"
            >
              {config.isEnabled ? (
                <ToggleRight className="w-7 h-7 text-teal-500" />
              ) : (
                <ToggleLeft className="w-7 h-7 text-slate-400" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <div className="text-xs font-bold text-slate-900">Auto Send Order Updates</div>
              <div className="text-[10px] text-slate-500">Automatically notify customers on order status changes</div>
            </div>
            <button
              onClick={() => setConfig({ ...config, autoSendOrderUpdates: !config.autoSendOrderUpdates })}
              className="transition"
            >
              {config.autoSendOrderUpdates ? (
                <ToggleRight className="w-7 h-7 text-teal-500" />
              ) : (
                <ToggleLeft className="w-7 h-7 text-slate-400" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <div className="text-xs font-bold text-slate-900">Auto Send Receipt</div>
              <div className="text-[10px] text-slate-500">Send digital receipt after successful payment</div>
            </div>
            <button
              onClick={() => setConfig({ ...config, autoSendReceipt: !config.autoSendReceipt })}
              className="transition"
            >
              {config.autoSendReceipt ? (
                <ToggleRight className="w-7 h-7 text-teal-500" />
              ) : (
                <ToggleLeft className="w-7 h-7 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Test Message */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <TestTube2 className="w-4 h-4 text-teal-500" />
          Send Test Message
        </h2>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+92 300 1234567"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          <button
            onClick={handleSendTest}
            disabled={testSending || !testPhone.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {testSending ? 'Sending...' : 'Send Test'}
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200">
        <h2 className="text-sm font-bold text-slate-900 mb-4">Recent Notification Logs</h2>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Phone</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Type</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Status</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 uppercase text-[10px] tracking-wider">Sent At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="bg-white hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono text-slate-700">{log.phoneNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{log.messageType}</td>
                    <td className="text-center px-4 py-3">
                      {log.status === 'sent' || log.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3" /> {log.status}
                        </span>
                      ) : log.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                          <Clock className="w-3 h-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-400 text-[10px]">
                      {new Date(log.sentAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-slate-500">
                      No notification logs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

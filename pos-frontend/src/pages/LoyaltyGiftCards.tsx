import React, { useState, useEffect } from 'react';
import {
  Star,
  Gift,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  CreditCard,
  Plus
} from 'lucide-react';
import { posApi, getApiErrorMessage, getApiErrorStatus } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { LoyaltyProgramConfig, GiftCard } from '../types';

const DEFAULT_CONFIG = {
  isEnabled: false,
  pointsPerPKRSpent: 1,
  pkrValuePerPoint: 1,
  minRedeemPoints: 100
};

export const LoyaltyGiftCards: React.FC = () => {
  const { currentUser, modulePermissions } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit');

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Gift cards
  const [issueAmount, setIssueAmount] = useState<number>(0);
  const [issueCustomerId, setIssueCustomerId] = useState('');
  const [issueExpiry, setIssueExpiry] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [lastIssued, setLastIssued] = useState<GiftCard | null>(null);

  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState<GiftCard | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [recentCards, setRecentCards] = useState<GiftCard[] | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoadingConfig(true);
      try {
        const data = await posApi.getLoyaltyConfig();
        if (data) {
          setConfig({
            isEnabled: !!data.isEnabled,
            pointsPerPKRSpent: Number(data.pointsPerPKRSpent) || 0,
            pkrValuePerPoint: Number(data.pkrValuePerPoint) || 0,
            minRedeemPoints: Number(data.minRedeemPoints) || 0
          });
        }
      } catch (err) {
        // A 404 simply means no program has been configured yet — show defaults.
        if (getApiErrorStatus(err) !== 404) {
          setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load loyalty config') });
        }
      } finally {
        setLoadingConfig(false);
      }

      // Optional listing — not part of the guaranteed contract.
      try {
        const cards = await posApi.getGiftCards();
        setRecentCards(Array.isArray(cards) ? cards : []);
      } catch {
        setRecentCards(null);
      }
    };
    load();
  }, []);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setMessage(null);
    try {
      const saved: LoyaltyProgramConfig = await posApi.updateLoyaltyConfig(config);
      if (saved) {
        setConfig({
          isEnabled: !!saved.isEnabled,
          pointsPerPKRSpent: Number(saved.pointsPerPKRSpent) || config.pointsPerPKRSpent,
          pkrValuePerPoint: Number(saved.pkrValuePerPoint) || config.pkrValuePerPoint,
          minRedeemPoints: Number(saved.minRedeemPoints) || config.minRedeemPoints
        });
      }
      setMessage({ type: 'success', text: 'Loyalty program saved' });
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save loyalty config') });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleIssue = async () => {
    if (!issueAmount || issueAmount <= 0) {
      setMessage({ type: 'error', text: 'Enter a starting balance greater than zero' });
      return;
    }
    setIssuing(true);
    setMessage(null);
    try {
      const card = await posApi.issueGiftCard({
        initialBalancePKR: issueAmount,
        issuedToCustomerId: issueCustomerId.trim() || undefined,
        expiresAt: issueExpiry || undefined
      });
      setLastIssued(card);
      setIssueAmount(0);
      setIssueCustomerId('');
      setIssueExpiry('');
      setRecentCards(prev => (prev ? [card, ...prev] : prev));
      setMessage({ type: 'success', text: `Gift card ${card?.cardCode || ''} issued` });
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to issue gift card') });
    } finally {
      setIssuing(false);
    }
  };

  const handleLookup = async () => {
    if (!lookupCode.trim()) return;
    setLookingUp(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const card = await posApi.getGiftCardBalance(lookupCode.trim());
      setLookupResult(card);
    } catch (err) {
      setLookupError(getApiErrorMessage(err, 'Gift card not found'));
    } finally {
      setLookingUp(false);
    }
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    hint?: string
  ) => (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value || ''}
        disabled={!canEdit}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60"
      />
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
          <Star className="w-4.5 h-4.5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-slate-900 leading-none">Loyalty & Gift Cards</h1>
          <p className="text-[11px] text-slate-500 mt-1">Points program rules and stored-value cards</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Loyalty program configuration */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">Loyalty Program</h2>
            <button
              onClick={() => canEdit && setConfig({ ...config, isEnabled: !config.isEnabled })}
              disabled={!canEdit}
              className="flex items-center gap-1.5 text-xs font-bold disabled:opacity-60"
            >
              {config.isEnabled ? (
                <><ToggleRight className="w-6 h-6 text-teal-500" /><span className="text-teal-700">Enabled</span></>
              ) : (
                <><ToggleLeft className="w-6 h-6 text-slate-300" /><span className="text-slate-500">Disabled</span></>
              )}
            </button>
          </div>

          {loadingConfig ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {numberField('Points per PKR spent', config.pointsPerPKRSpent,
                  n => setConfig({ ...config, pointsPerPKRSpent: n }), 'e.g. 1 = one point per rupee')}
                {numberField('PKR value per point', config.pkrValuePerPoint,
                  n => setConfig({ ...config, pkrValuePerPoint: n }), 'What one point is worth at redemption')}
                {numberField('Minimum points to redeem', config.minRedeemPoints,
                  n => setConfig({ ...config, minRedeemPoints: n }))}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
                A customer spending <strong className="text-slate-700">1,000 PKR</strong> earns{' '}
                <strong className="text-slate-700">{(config.pointsPerPKRSpent * 1000).toLocaleString()}</strong> points,
                worth <strong className="text-slate-700">
                  {(config.pointsPerPKRSpent * 1000 * config.pkrValuePerPoint).toLocaleString()} PKR
                </strong> off a future bill.
              </div>

              {canEdit ? (
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingConfig ? 'Saving…' : 'Save Program Settings'}</span>
                </button>
              ) : (
                <p className="text-[11px] text-slate-400">
                  You have view-only access — an owner or administrator can change these rules.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Gift cards */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-teal-600" />
              <h2 className="text-sm font-black text-slate-900">Issue Gift Card</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Starting Balance (PKR)</label>
                <input
                  type="number"
                  min="0"
                  value={issueAmount || ''}
                  disabled={!canEdit}
                  onChange={(e) => setIssueAmount(Number(e.target.value) || 0)}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Expires On (optional)</label>
                <input
                  type="date"
                  value={issueExpiry}
                  disabled={!canEdit}
                  onChange={(e) => setIssueExpiry(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Assign to Customer ID (optional)</label>
                <input
                  value={issueCustomerId}
                  disabled={!canEdit}
                  onChange={(e) => setIssueCustomerId(e.target.value)}
                  placeholder="Leave blank for a bearer card"
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500 disabled:opacity-60"
                />
              </div>
            </div>

            {canEdit && (
              <button
                onClick={handleIssue}
                disabled={issuing}
                className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{issuing ? 'Issuing…' : 'Issue Card'}</span>
              </button>
            )}

            {lastIssued && (
              <div className="p-3 rounded-xl bg-teal-50 border border-teal-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-teal-600">New card code</p>
                <p className="text-base font-black text-teal-800 tracking-widest">{lastIssued.cardCode}</p>
                <p className="text-[11px] text-teal-700">
                  Balance {(lastIssued.currentBalancePKR ?? lastIssued.initialBalancePKR ?? 0).toLocaleString()} PKR
                </p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-teal-600" />
              <h2 className="text-sm font-black text-slate-900">Check Balance</h2>
            </div>
            <div className="flex gap-2">
              <input
                value={lookupCode}
                onChange={(e) => setLookupCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
                placeholder="Gift card code"
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
              />
              <button
                onClick={handleLookup}
                disabled={lookingUp}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition disabled:opacity-40"
              >
                {lookingUp ? 'Checking…' : 'Check'}
              </button>
            </div>

            {lookupError && <p className="text-[11px] font-semibold text-rose-600">{lookupError}</p>}

            {lookupResult && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 tracking-widest">{lookupResult.cardCode}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                    lookupResult.isActive
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {lookupResult.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-lg font-black text-slate-900">
                  {(lookupResult.currentBalancePKR ?? 0).toLocaleString()} <span className="text-xs text-slate-400">PKR</span>
                </p>
                <p className="text-[10px] text-slate-400">
                  Issued {lookupResult.issuedAt ? new Date(lookupResult.issuedAt).toLocaleDateString() : '—'}
                  {lookupResult.expiresAt ? ` • Expires ${new Date(lookupResult.expiresAt).toLocaleDateString()}` : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {recentCards && recentCards.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 text-teal-600" />
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Recent Gift Cards</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Code</th>
                  <th className="px-4 py-2.5 text-right">Initial</th>
                  <th className="px-4 py-2.5 text-right">Balance</th>
                  <th className="px-4 py-2.5">Issued</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentCards.slice(0, 25).map(card => (
                  <tr key={card.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs font-bold text-slate-900 tracking-wider">{card.cardCode}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-600">{(card.initialBalancePKR ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">{(card.currentBalancePKR ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-[11px] text-slate-500">
                      {card.issuedAt ? new Date(card.issuedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                        card.isActive
                          ? 'bg-teal-50 text-teal-700 border-teal-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {card.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

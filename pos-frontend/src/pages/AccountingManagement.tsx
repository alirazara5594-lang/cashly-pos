import React, { useState, useEffect, useCallback } from 'react';
import {
  Landmark,
  BookOpen,
  Scale,
  TrendingUp,
  FileBarChart,
  Plus,
  X,
  Save,
  Undo2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { Account, AccountType, JournalEntry, TrialBalanceReport, ProfitLossReport, BalanceSheetReport } from '../types';

type TabKey = 'coa' | 'journal' | 'trial-balance' | 'profit-loss' | 'balance-sheet';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

export const AccountingManagement: React.FC = () => {
  const { selectedTenant, currentUser } = usePosStore();
  const isOwner = currentUser?.role === 'OwnerAdmin' || currentUser?.role === 'SuperAdmin';

  const [activeTab, setActiveTab] = useState<TabKey>('coa');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(true);

  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport | null>(null);
  const [profitLoss, setProfitLoss] = useState<ProfitLossReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const [plFrom, setPlFrom] = useState(daysAgoISO(30));
  const [plTo, setPlTo] = useState(daysAgoISO(0));

  // New account modal
  const [isNewAccountOpen, setIsNewAccountOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({ code: '', name: '', type: 'Asset' as AccountType, subType: '' });
  const [savingAccount, setSavingAccount] = useState(false);

  // New journal entry modal
  const [isNewEntryOpen, setIsNewEntryOpen] = useState(false);
  const [entryDesc, setEntryDesc] = useState('');
  const [entryLines, setEntryLines] = useState<Array<{ accountCode: string; debitPKR: string; creditPKR: string }>>([
    { accountCode: '', debitPKR: '', creditPKR: '' },
    { accountCode: '', debitPKR: '', creditPKR: '' }
  ]);
  const [savingEntry, setSavingEntry] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoadingAccounts(true);
    try {
      const data = await posApi.getChartOfAccounts(selectedTenant.id);
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load chart of accounts') });
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedTenant?.id]);

  const loadJournal = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoadingJournal(true);
    try {
      const data = await posApi.getJournalEntries({ tenantId: selectedTenant.id });
      setJournal(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load journal entries') });
    } finally {
      setLoadingJournal(false);
    }
  }, [selectedTenant?.id]);

  const loadReports = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoadingReport(true);
    try {
      const [tb, pl, bs] = await Promise.all([
        posApi.getTrialBalance(selectedTenant.id),
        posApi.getProfitLoss({ tenantId: selectedTenant.id, from: plFrom, to: plTo }),
        posApi.getBalanceSheet(selectedTenant.id)
      ]);
      setTrialBalance(tb);
      setProfitLoss(pl);
      setBalanceSheet(bs);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load financial reports') });
    } finally {
      setLoadingReport(false);
    }
  }, [selectedTenant?.id, plFrom, plTo]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (activeTab === 'journal') loadJournal(); }, [activeTab, loadJournal]);
  useEffect(() => { if (activeTab === 'trial-balance' || activeTab === 'profit-loss' || activeTab === 'balance-sheet') loadReports(); }, [activeTab, loadReports]);

  const handleCreateAccount = async () => {
    if (!newAccount.code.trim() || !newAccount.name.trim()) return;
    setSavingAccount(true);
    try {
      await posApi.createAccount({ tenantId: selectedTenant?.id, ...newAccount });
      setIsNewAccountOpen(false);
      setNewAccount({ code: '', name: '', type: 'Asset', subType: '' });
      setMessage({ type: 'success', text: 'Account added' });
      await loadAccounts();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to add account') });
    } finally {
      setSavingAccount(false);
    }
  };

  const addEntryLine = () => setEntryLines([...entryLines, { accountCode: '', debitPKR: '', creditPKR: '' }]);
  const removeEntryLine = (idx: number) => setEntryLines(entryLines.filter((_, i) => i !== idx));

  const entryTotals = entryLines.reduce(
    (acc, l) => ({ debit: acc.debit + (Number(l.debitPKR) || 0), credit: acc.credit + (Number(l.creditPKR) || 0) }),
    { debit: 0, credit: 0 }
  );
  const entryBalanced = entryTotals.debit === entryTotals.credit && entryTotals.debit > 0;

  const handleCreateEntry = async () => {
    if (!entryDesc.trim() || !entryBalanced) return;
    setSavingEntry(true);
    try {
      await posApi.createJournalEntry({
        tenantId: selectedTenant?.id,
        description: entryDesc.trim(),
        lines: entryLines
          .filter(l => l.accountCode && (Number(l.debitPKR) || Number(l.creditPKR)))
          .map(l => ({ accountCode: l.accountCode, debitPKR: Number(l.debitPKR) || 0, creditPKR: Number(l.creditPKR) || 0 }))
      });
      setIsNewEntryOpen(false);
      setEntryDesc('');
      setEntryLines([{ accountCode: '', debitPKR: '', creditPKR: '' }, { accountCode: '', debitPKR: '', creditPKR: '' }]);
      setMessage({ type: 'success', text: 'Journal entry posted' });
      await loadJournal();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to post journal entry') });
    } finally {
      setSavingEntry(false);
    }
  };

  const handleReverse = async (entry: JournalEntry) => {
    const reason = window.prompt(`Reverse ${entry.entryNumber}? Enter a reason:`, 'Correction');
    if (reason === null) return;
    try {
      await posApi.reverseJournalEntry(entry.id, reason || undefined);
      setMessage({ type: 'success', text: `${entry.entryNumber} reversed` });
      await loadJournal();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to reverse entry') });
    }
  };

  const activeAccounts = accounts.filter(a => a.isActive);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Landmark className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Accounting</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Double-entry bookkeeping — sales, purchases, and payroll post here automatically.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 flex-wrap">
          {([
            { key: 'coa' as const, label: 'Chart of Accounts', icon: BookOpen },
            { key: 'journal' as const, label: 'Journal', icon: FileBarChart },
            { key: 'trial-balance' as const, label: 'Trial Balance', icon: Scale },
            { key: 'profit-loss' as const, label: 'P&L', icon: TrendingUp },
            { key: 'balance-sheet' as const, label: 'Balance Sheet', icon: Landmark }
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === key ? 'bg-teal-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success' ? 'bg-teal-50 border-teal-200 text-teal-700' : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* CHART OF ACCOUNTS */}
      {activeTab === 'coa' && (
        <div className="space-y-3">
          {isOwner && (
            <div className="flex justify-end">
              <button
                onClick={() => setIsNewAccountOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Account</span>
              </button>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Sub-Type</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingAccounts ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">Loading chart of accounts…</td></tr>
                  ) : accounts.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">No accounts yet.</td></tr>
                  ) : accounts.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-mono font-bold text-slate-900">{a.code}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">
                        {a.name}
                        {a.isSystemAccount && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">SYSTEM</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                          a.type === 'Asset' ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : a.type === 'Liability' ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : a.type === 'Equity' ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : a.type === 'Revenue' ? 'bg-teal-50 text-teal-700 border-teal-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {a.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-500">{a.subType || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                          a.isActive ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {a.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* JOURNAL */}
      {activeTab === 'journal' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={loadJournal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingJournal ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {isOwner && (
              <button
                onClick={() => setIsNewEntryOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Journal Entry</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {loadingJournal ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">Loading journal…</div>
            ) : journal.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">
                No journal entries yet. They'll appear here automatically as sales, purchases, and payroll are recorded.
              </div>
            ) : journal.map(j => (
              <div key={j.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-teal-600">{j.entryNumber}</span>
                    <span className="text-xs text-slate-700">{j.description}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">{j.referenceType}</span>
                    {j.status === 'Reversed' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 font-bold">REVERSED</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span>{new Date(j.entryDate).toLocaleString()}</span>
                    <span>by {j.createdBy}</span>
                    {isOwner && j.status === 'Posted' && (
                      <button onClick={() => handleReverse(j)} className="flex items-center gap-1 text-rose-600 hover:text-rose-700 font-bold">
                        <Undo2 className="w-3 h-3" /> Reverse
                      </button>
                    )}
                  </div>
                </div>
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-50">
                    {j.lines.map(l => (
                      <tr key={l.id}>
                        <td className="px-4 py-1.5 font-mono text-slate-500 w-20">{l.accountCode}</td>
                        <td className="px-4 py-1.5 text-slate-700">{l.accountName}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-slate-900 w-28">{l.debitPKR > 0 ? l.debitPKR.toLocaleString() : ''}</td>
                        <td className="px-4 py-1.5 text-right font-mono text-slate-900 w-28">{l.creditPKR > 0 ? l.creditPKR.toLocaleString() : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TRIAL BALANCE */}
      {activeTab === 'trial-balance' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Trial Balance {trialBalance ? `as of ${new Date(trialBalance.asOf).toLocaleDateString()}` : ''}</span>
            <button onClick={loadReports} className="text-teal-600 hover:text-teal-700"><RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? 'animate-spin' : ''}`} /></button>
          </div>
          {loadingReport || !trialBalance ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Debit</th>
                    <th className="px-4 py-2.5 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trialBalance.accounts.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No posted activity yet.</td></tr>
                  ) : trialBalance.accounts.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-500">{a.code}</td>
                      <td className="px-4 py-2 font-bold text-slate-900">{a.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-900">{a.debitBalance > 0 ? a.debitBalance.toLocaleString() : ''}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-900">{a.creditBalance > 0 ? a.creditBalance.toLocaleString() : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300">
                  <tr className="font-black text-slate-900">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-4 py-2.5 text-right font-mono">{trialBalance.totalDebits.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{trialBalance.totalCredits.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PROFIT & LOSS */}
      {activeTab === 'profit-loss' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
              <input type="date" value={plFrom} onChange={(e) => setPlFrom(e.target.value)}
                className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
              <input type="date" value={plTo} onChange={(e) => setPlTo(e.target.value)}
                className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <button onClick={loadReports} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition">
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingReport ? 'animate-spin' : ''}`} />
              <span>Run</span>
            </button>
          </div>

          {loadingReport || !profitLoss ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">Loading…</div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {new Date(profitLoss.periodStart).toLocaleDateString()} – {new Date(profitLoss.periodEnd).toLocaleDateString()}
                </span>
              </div>
              <div className="p-4 space-y-4 text-xs">
                <div>
                  <div className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">Revenue</div>
                  {profitLoss.revenue.length === 0 ? <p className="text-slate-400">No revenue posted.</p> : profitLoss.revenue.map(r => (
                    <div key={r.code} className="flex justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-700">{r.name}</span>
                      <span className="font-mono font-bold text-teal-600">{r.amountPKR.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1.5 font-black text-slate-900">
                    <span>Total Revenue</span><span className="font-mono">{profitLoss.totalRevenuePKR.toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">Expenses</div>
                  {profitLoss.expenses.length === 0 ? <p className="text-slate-400">No expenses posted.</p> : profitLoss.expenses.map(r => (
                    <div key={r.code} className="flex justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-700">{r.name}</span>
                      <span className="font-mono font-bold text-rose-600">{r.amountPKR.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1.5 font-black text-slate-900">
                    <span>Total Expenses</span><span className="font-mono">{profitLoss.totalExpensesPKR.toLocaleString()}</span>
                  </div>
                </div>
                <div className={`flex justify-between pt-3 border-t-2 border-slate-300 text-sm font-black ${profitLoss.netProfitPKR >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                  <span>Net Profit</span><span className="font-mono">{profitLoss.netProfitPKR.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BALANCE SHEET */}
      {activeTab === 'balance-sheet' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Balance Sheet {balanceSheet ? `as of ${new Date(balanceSheet.asOf).toLocaleDateString()}` : ''}</span>
            <button onClick={loadReports} className="text-teal-600 hover:text-teal-700"><RefreshCw className={`w-3.5 h-3.5 ${loadingReport ? 'animate-spin' : ''}`} /></button>
          </div>
          {loadingReport || !balanceSheet ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading…</div>
          ) : (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              <div>
                <div className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">Assets</div>
                {balanceSheet.assets.map(r => (
                  <div key={r.code} className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-700">{r.name}</span>
                    <span className="font-mono font-bold text-slate-900">{r.amountPKR.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1.5 font-black text-slate-900">
                  <span>Total Assets</span><span className="font-mono">{balanceSheet.totalAssetsPKR.toLocaleString()}</span>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">Liabilities</div>
                  {balanceSheet.liabilities.map(r => (
                    <div key={r.code} className="flex justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-700">{r.name}</span>
                      <span className="font-mono font-bold text-slate-900">{r.amountPKR.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1.5 font-black text-slate-900">
                    <span>Total Liabilities</span><span className="font-mono">{balanceSheet.totalLiabilitiesPKR.toLocaleString()}</span>
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-500 uppercase text-[10px] mb-1.5">Equity</div>
                  {balanceSheet.equity.map(r => (
                    <div key={r.code} className="flex justify-between py-1 border-b border-slate-50">
                      <span className="text-slate-700">{r.name}</span>
                      <span className="font-mono font-bold text-slate-900">{r.amountPKR.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-700">Retained Earnings</span>
                    <span className="font-mono font-bold text-slate-900">{balanceSheet.retainedEarningsPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 font-black text-slate-900">
                    <span>Total Equity</span><span className="font-mono">{balanceSheet.totalEquityPKR.toLocaleString()}</span>
                  </div>
                </div>
                <div className={`flex justify-between pt-2 border-t-2 border-slate-300 font-black ${balanceSheet.balances ? 'text-teal-600' : 'text-rose-600'}`}>
                  <span>Liabilities + Equity {balanceSheet.balances ? '(Balanced)' : '(OUT OF BALANCE)'}</span>
                  <span className="font-mono">{balanceSheet.totalLiabilitiesAndEquityPKR.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: NEW ACCOUNT */}
      {isNewAccountOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Add Account</h2>
              <button onClick={() => setIsNewAccountOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Code</label>
                <input type="text" value={newAccount.code} onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                  placeholder="e.g. 5400"
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Type</label>
                <select value={newAccount.type} onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value as AccountType })}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
                  {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Name</label>
              <input type="text" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="e.g. Utilities Expense"
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sub-Type (optional)</label>
              <input type="text" value={newAccount.subType} onChange={(e) => setNewAccount({ ...newAccount, subType: e.target.value })}
                placeholder="e.g. Operating Expense"
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <button
              onClick={handleCreateAccount}
              disabled={savingAccount || !newAccount.code.trim() || !newAccount.name.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingAccount ? 'Saving…' : 'Add Account'}</span>
            </button>
          </div>
        </div>
      )}

      {/* MODAL: NEW JOURNAL ENTRY */}
      {isNewEntryOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">New Journal Entry</h2>
              <button onClick={() => setIsNewEntryOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Description</label>
              <input type="text" value={entryDesc} onChange={(e) => setEntryDesc(e.target.value)}
                placeholder="e.g. Office rent for the month"
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Lines (must balance)</label>
                <button onClick={addEntryLine} className="text-[11px] font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Line
                </button>
              </div>
              {entryLines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <select value={line.accountCode} onChange={(e) => {
                    const updated = [...entryLines]; updated[idx] = { ...updated[idx], accountCode: e.target.value }; setEntryLines(updated);
                  }} className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
                    <option value="">— Account —</option>
                    {activeAccounts.map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <input type="number" value={line.debitPKR} onChange={(e) => {
                    const updated = [...entryLines]; updated[idx] = { ...updated[idx], debitPKR: e.target.value, creditPKR: '' }; setEntryLines(updated);
                  }} placeholder="Debit" className="w-24 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-right font-mono text-slate-900 focus:outline-none focus:border-teal-500" />
                  <input type="number" value={line.creditPKR} onChange={(e) => {
                    const updated = [...entryLines]; updated[idx] = { ...updated[idx], creditPKR: e.target.value, debitPKR: '' }; setEntryLines(updated);
                  }} placeholder="Credit" className="w-24 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-right font-mono text-slate-900 focus:outline-none focus:border-teal-500" />
                  {entryLines.length > 2 && (
                    <button onClick={() => removeEntryLine(idx)} className="text-slate-400 hover:text-rose-500 p-1"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
              <div className={`flex justify-between text-xs font-bold pt-1.5 border-t border-slate-200 ${entryBalanced ? 'text-teal-600' : 'text-rose-600'}`}>
                <span>Debit {entryTotals.debit.toLocaleString()} · Credit {entryTotals.credit.toLocaleString()}</span>
                <span>{entryBalanced ? 'Balanced' : 'Not balanced'}</span>
              </div>
            </div>

            <button
              onClick={handleCreateEntry}
              disabled={savingEntry || !entryDesc.trim() || !entryBalanced}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingEntry ? 'Posting…' : 'Post Journal Entry'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

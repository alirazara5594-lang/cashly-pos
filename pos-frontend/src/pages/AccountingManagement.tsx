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
  AlertTriangle,
  Lock,
  Building
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { Account, AccountType, JournalEntry, TrialBalanceReport, ProfitLossReport, BalanceSheetReport, AccountingPeriod, UnreconciledReport, BankReconciliation } from '../types';

type TabKey = 'coa' | 'journal' | 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'periods' | 'reconciliation';

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

  // Accounting periods
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [isNewPeriodOpen, setIsNewPeriodOpen] = useState(false);
  const [newPeriodStart, setNewPeriodStart] = useState(daysAgoISO(30));
  const [newPeriodEnd, setNewPeriodEnd] = useState(daysAgoISO(0));
  const [periodSaving, setPeriodSaving] = useState(false);

  // Bank reconciliation
  const [reconAccountCode, setReconAccountCode] = useState('1000');
  const [unreconciled, setUnreconciled] = useState<UnreconciledReport | null>(null);
  const [reconHistory, setReconHistory] = useState<BankReconciliation[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [statementDate, setStatementDate] = useState(daysAgoISO(0));
  const [statementBalance, setStatementBalance] = useState('');
  const [loadingRecon, setLoadingRecon] = useState(false);
  const [reconSaving, setReconSaving] = useState(false);

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

  const loadPeriods = useCallback(async () => {
    if (!selectedTenant?.id) return;
    setLoadingPeriods(true);
    try {
      const data = await posApi.getAccountingPeriods(selectedTenant.id);
      setPeriods(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load accounting periods') });
    } finally {
      setLoadingPeriods(false);
    }
  }, [selectedTenant?.id]);

  useEffect(() => { if (activeTab === 'periods') loadPeriods(); }, [activeTab, loadPeriods]);

  const handleCreatePeriod = async () => {
    setPeriodSaving(true);
    try {
      await posApi.createAccountingPeriod({ tenantId: selectedTenant?.id, periodStart: new Date(newPeriodStart).toISOString(), periodEnd: new Date(newPeriodEnd).toISOString() });
      setIsNewPeriodOpen(false);
      setMessage({ type: 'success', text: 'Accounting period created' });
      await loadPeriods();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to create period') });
    } finally {
      setPeriodSaving(false);
    }
  };

  const handleClosePeriod = async (period: AccountingPeriod) => {
    if (!window.confirm(`Close the period ${new Date(period.periodStart).toLocaleDateString()} – ${new Date(period.periodEnd).toLocaleDateString()}? No further entries can be posted into it.`)) return;
    try {
      await posApi.closeAccountingPeriod(period.id);
      setMessage({ type: 'success', text: 'Period closed' });
      await loadPeriods();
    } catch (err: any) {
      if (err?.response?.data?.stillActive) {
        if (window.confirm(`${err.response.data.message}\n\nClose it anyway?`)) {
          try {
            await posApi.closeAccountingPeriod(period.id, true);
            setMessage({ type: 'success', text: 'Period closed' });
            await loadPeriods();
          } catch (err2) {
            setMessage({ type: 'error', text: getApiErrorMessage(err2, 'Failed to close period') });
          }
        }
        return;
      }
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to close period') });
    }
  };

  const loadReconciliation = useCallback(async () => {
    if (!selectedTenant?.id || !reconAccountCode) return;
    setLoadingRecon(true);
    setSelectedLineIds(new Set());
    try {
      const [unrec, history] = await Promise.all([
        posApi.getUnreconciledLines(reconAccountCode, selectedTenant.id),
        posApi.getReconciliationHistory(reconAccountCode, selectedTenant.id)
      ]);
      setUnreconciled(unrec);
      setReconHistory(Array.isArray(history) ? history : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load bank reconciliation') });
      setUnreconciled(null);
    } finally {
      setLoadingRecon(false);
    }
  }, [selectedTenant?.id, reconAccountCode]);

  useEffect(() => { if (activeTab === 'reconciliation') loadReconciliation(); }, [activeTab, loadReconciliation]);

  const toggleLine = (id: string) => {
    setSelectedLineIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedLinesTotal = unreconciled?.unreconciledLines
    .filter(l => selectedLineIds.has(l.id))
    .reduce((sum, l) => sum + (l.debitPKR - l.creditPKR), 0) ?? 0;

  const handleReconcile = async () => {
    if (!statementBalance || selectedLineIds.size === 0) return;
    setReconSaving(true);
    try {
      const result: any = await posApi.createBankReconciliation({
        tenantId: selectedTenant?.id, accountCode: reconAccountCode, statementDate: new Date(statementDate).toISOString(),
        statementBalancePKR: Number(statementBalance), lineIds: Array.from(selectedLineIds)
      });
      setMessage({
        type: result.matches ? 'success' : 'error',
        text: result.matches ? 'Reconciled — book and statement balances match.' : `Reconciled with a difference of ${result.differencePKR} PKR — check for missing entries.`
      });
      setStatementBalance('');
      await loadReconciliation();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to reconcile') });
    } finally {
      setReconSaving(false);
    }
  };

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
            { key: 'balance-sheet' as const, label: 'Balance Sheet', icon: Landmark },
            { key: 'periods' as const, label: 'Periods', icon: Lock },
            { key: 'reconciliation' as const, label: 'Bank Reconciliation', icon: Building }
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

      {/* ACCOUNTING PERIODS */}
      {activeTab === 'periods' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button onClick={loadPeriods} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition">
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingPeriods ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {isOwner && (
              <button onClick={() => setIsNewPeriodOpen(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition">
                <Plus className="w-3.5 h-3.5" />
                <span>New Period</span>
              </button>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Period</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Closed</th>
                    {isOwner && <th className="px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingPeriods ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">Loading periods…</td></tr>
                  ) : periods.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">No accounting periods yet. Books stay open indefinitely until you create and close one.</td></tr>
                  ) : periods.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">
                        {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${p.status === 'Closed' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-500">{p.closedAt ? `${new Date(p.closedAt).toLocaleDateString()} by ${p.closedBy}` : '—'}</td>
                      {isOwner && (
                        <td className="px-4 py-2.5 text-right">
                          {p.status === 'Open' && (
                            <button onClick={() => handleClosePeriod(p)} className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700">
                              <Lock className="w-3 h-3" /> Close Period
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BANK RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={reconAccountCode} onChange={(e) => setReconAccountCode(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
              {accounts.filter(a => a.type === 'Asset').map(a => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
            </select>
            <button onClick={loadReconciliation} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition">
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingRecon ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {unreconciled && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {unreconciled.accountName} — book balance {unreconciled.bookBalancePKR.toLocaleString()} PKR
                </span>
                <span className="text-[11px] text-slate-500">Selected: {selectedLinesTotal.toLocaleString()} PKR</span>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2">Entry</th>
                      <th className="p-2">Description</th>
                      <th className="p-2 text-right">Debit</th>
                      <th className="p-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {unreconciled.unreconciledLines.length === 0 ? (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">Everything is reconciled for this account.</td></tr>
                    ) : unreconciled.unreconciledLines.map(l => (
                      <tr key={l.id} className={`hover:bg-slate-50 ${selectedLineIds.has(l.id) ? 'bg-teal-50/50' : ''}`}>
                        <td className="p-2"><input type="checkbox" checked={selectedLineIds.has(l.id)} onChange={() => toggleLine(l.id)} className="w-3.5 h-3.5 accent-teal-500" /></td>
                        <td className="p-2 font-mono text-slate-500">{l.entryNumber}<div className="text-[10px] text-slate-400">{new Date(l.entryDate).toLocaleDateString()}</div></td>
                        <td className="p-2 text-slate-700">{l.description}</td>
                        <td className="p-2 text-right font-mono">{l.debitPKR > 0 ? l.debitPKR.toLocaleString() : ''}</td>
                        <td className="p-2 text-right font-mono">{l.creditPKR > 0 ? l.creditPKR.toLocaleString() : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isOwner && unreconciled.unreconciledLines.length > 0 && (
                <div className="p-4 border-t border-slate-200 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Statement Date</label>
                    <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)}
                      className="mt-1 block px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Statement Balance (PKR)</label>
                    <input type="number" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)}
                      className="mt-1 block px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
                  </div>
                  <button
                    onClick={handleReconcile}
                    disabled={reconSaving || !statementBalance || selectedLineIds.size === 0}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{reconSaving ? 'Reconciling…' : `Reconcile ${selectedLineIds.size} Line(s)`}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {reconHistory.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Reconciliation History</span>
              </div>
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-slate-100">
                  {reconHistory.map(r => (
                    <tr key={r.id}>
                      <td className="p-3 text-slate-500">{new Date(r.statementDate).toLocaleDateString()}</td>
                      <td className="p-3 text-slate-700">Statement: {r.statementBalancePKR.toLocaleString()}</td>
                      <td className="p-3 text-slate-700">Book: {r.reconciledBookBalancePKR.toLocaleString()}</td>
                      <td className="p-3">{r.completedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isNewPeriodOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">New Accounting Period</h2>
              <button onClick={() => setIsNewPeriodOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Start</label>
                <input type="date" value={newPeriodStart} onChange={(e) => setNewPeriodStart(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">End</label>
                <input type="date" value={newPeriodEnd} onChange={(e) => setNewPeriodEnd(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
            </div>
            <button
              onClick={handleCreatePeriod}
              disabled={periodSaving}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{periodSaving ? 'Creating…' : 'Create Period'}</span>
            </button>
          </div>
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

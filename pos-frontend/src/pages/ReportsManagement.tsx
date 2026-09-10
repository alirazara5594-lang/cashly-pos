import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Printer, 
  Banknote, 
  CreditCard, 
  PieChart, 
  Award, 
  RefreshCw,
  Building2,
  Percent,
  Wallet,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Layers,
  Search
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { 
  ZReportSummary, 
  CategorySalesReport, 
  ItemPerformanceReport,
  TaxAuditReport,
  PaymentMethodsReport,
  ConsolidatedFinancialReport
} from '../types';

export const ReportsManagement: React.FC = () => {
  const { selectedBranch, selectedTenant } = usePosStore();
  const location = useLocation();

  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;

  // Active submodule tab
  const [activeTab, setActiveTab] = useState<'zreport' | 'tax' | 'categories' | 'products' | 'payments' | 'multibranch' | 'cashSales' | 'cardSales' | 'cashTally'>(
    location.state?.tab || 'zreport'
  );

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  // Filtering Controls
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedDaysRange, setSelectedDaysRange] = useState<number>(7);
  const [taxSearchQuery, setTaxSearchQuery] = useState('');
  const [taxFilterRate, setTaxFilterRate] = useState<'all' | '16' | '8'>('all');
  const [loading, setLoading] = useState(false);

  // Interactive Cash Count in Z-Report
  const [actualCashCounted, setActualCashCounted] = useState<number | ''>('');
  const [isZReportPrintOpen, setIsZReportPrintOpen] = useState(false);

  // Cash Tally modal
  const [isCashTallyOpen, setIsCashTallyOpen] = useState(false);
  const [cashTally, setCashTally] = useState<any>(null);
  const [cashTallyLoading, setCashTallyLoading] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [entryType, setEntryType] = useState<'PaidOut' | 'Received'>('PaidOut');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDesc, setEntryDesc] = useState('');
  const [entryRecipient, setEntryRecipient] = useState('');

  // Report Datasets
  const [zReport, setZReport] = useState<ZReportSummary | null>(null);
  const [taxAudit, setTaxAudit] = useState<TaxAuditReport | null>(null);
  const [categorySales, setCategorySales] = useState<CategorySalesReport[]>([]);
  const [productPerformance, setProductPerformance] = useState<ItemPerformanceReport[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsReport | null>(null);
  const [consolidated, setConsolidated] = useState<ConsolidatedFinancialReport | null>(null);
  const [cashSalesReport, setCashSalesReport] = useState<any>(null);
  const [cardSalesReport, setCardSalesReport] = useState<any>(null);

  const loadReportData = async () => {
    if (!selectedBranch?.id) return;
    setLoading(true);
    try {
      if (activeTab === 'zreport') {
        const data = await posApi.getZReport(selectedBranch.id, selectedDate);
        setZReport(data);
        if (data) {
          setActualCashCounted(data.actualCashInDrawerPKR || data.expectedCashInDrawerPKR);
        }
      } else if (activeTab === 'tax') {
        const data = await posApi.getTaxAuditReport(selectedBranch.id, selectedDaysRange);
        setTaxAudit(data);
      } else if (activeTab === 'categories') {
        const data = await posApi.getCategorySalesReport(selectedBranch.id, selectedDaysRange);
        setCategorySales(data);
      } else if (activeTab === 'products') {
        const data = await posApi.getItemPerformanceReport(selectedBranch.id, selectedDaysRange);
        setProductPerformance(data);
      } else if (activeTab === 'payments') {
        const data = await posApi.getPaymentMethodsReport(selectedBranch.id, selectedDaysRange);
        setPaymentMethods(data);
      } else if (activeTab === 'multibranch' && selectedTenant?.id) {
        const data = await posApi.getConsolidatedFinancials(selectedTenant.id, selectedDaysRange);
        setConsolidated(data);
      } else if (activeTab === 'cashSales') {
        const data = await posApi.getCashSalesReport(selectedBranch.id, selectedDate);
        setCashSalesReport(data);
      } else if (activeTab === 'cardSales') {
        const data = await posApi.getCardSalesReport(selectedBranch.id, selectedDate);
        setCardSalesReport(data);
      }
    } catch (err) {
      console.error('Failed to load reports', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [selectedBranch?.id, selectedTenant?.id, activeTab, selectedDate, selectedDaysRange]);

  // Cash Tally functions
  const loadCashTally = async (shiftId: string) => {
    setCashTallyLoading(true);
    try {
      const data = await posApi.getCashTally(shiftId);
      setCashTally(data);
    } catch (err) {
      console.error('Failed to load cash tally:', err);
    } finally {
      setCashTallyLoading(false);
    }
  };

  const handleAddCashEntry = async () => {
    if (!cashTally || !entryAmount || !entryDesc) return;
    const user = JSON.parse(localStorage.getItem('cashly_pos_user') || '{}');
    try {
      await posApi.addCashEntry(cashTally.shiftId, {
        entryType,
        amountPKR: parseFloat(entryAmount),
        description: entryDesc,
        recipientOrSource: entryRecipient || undefined,
        createdBy: user.fullName || user.username || 'Cashier'
      });
      setEntryAmount('');
      setEntryDesc('');
      setEntryRecipient('');
      setShowAddEntry(false);
      loadCashTally(cashTally.shiftId);
    } catch (err) {
      console.error('Failed to add entry:', err);
    }
  };

  const handleDeleteCashEntry = async (entryId: string) => {
    if (!cashTally || !confirm('Delete this entry?')) return;
    try {
      await posApi.deleteCashEntry(cashTally.shiftId, entryId);
      loadCashTally(cashTally.shiftId);
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  // Export Tax Audit to CSV
  const handleExportTaxCSV = () => {
    if (!taxAudit || taxAudit.invoices.length === 0) return;
    const headers = ['OrderNumber,Date,OrderType,PaymentMethod,Cashier,NetAmountPKR,TaxRatePercent,TaxAmountPKR,TotalAmountPKR'];
    const rows = taxAudit.invoices.map(inv => 
      `"${inv.orderNumber}","${new Date(inv.createdAt).toLocaleString()}","${inv.orderType}","${inv.paymentMethod}","${inv.cashierName}",${inv.netAmountPKR},${inv.taxRatePercent}%,${inv.taxAmountPKR},${inv.totalAmountPKR}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Tax_Audit_Report_${selectedBranch?.name || 'Store'}_${taxAudit.startDate}_to_${taxAudit.endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Tax Invoices
  const filteredTaxInvoices = (taxAudit?.invoices || []).filter(inv => {
    const matchesSearch = !taxSearchQuery || 
      inv.orderNumber.toLowerCase().includes(taxSearchQuery.toLowerCase()) ||
      inv.cashierName.toLowerCase().includes(taxSearchQuery.toLowerCase());
    const matchesRate = taxFilterRate === 'all' || 
      (taxFilterRate === '16' && inv.taxRatePercent === 16) ||
      (taxFilterRate === '8' && inv.taxRatePercent === 8);
    return matchesSearch && matchesRate;
  });

  // Calculate live variance for Z-Report
  const expectedCash = zReport?.expectedCashInDrawerPKR || 0;
  const countedCash = actualCashCounted === '' ? expectedCash : Number(actualCashCounted);
  const liveVariance = countedCash - expectedCash;

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Strip */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-black text-white tracking-tight">Financial &amp; Revenue Reports</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-500" />
              Auditing Branch: <span className="text-emerald-400 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
              <span className="text-slate-400 mx-1">•</span>
              <span className="text-slate-400">FBR &amp; PRA Restaurant Compliance Mode</span>
            </p>
          </div>

          {/* Submodule Tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('zreport')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'zreport'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              <span>Z-Report (Day Close)</span>
            </button>

            <button
              onClick={() => setActiveTab('tax')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'tax'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              <span>Tax Audit (16% / 8%)</span>
            </button>

            <button
              onClick={() => setActiveTab('categories')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'categories'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <PieChart className="w-3.5 h-3.5" />
              <span>Category Turnover</span>
            </button>

            <button
              onClick={() => setActiveTab('products')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'products'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Item Profitability &amp; COGS</span>
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'payments'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Payment Tender Mix</span>
            </button>

            <button
              onClick={() => setActiveTab('cashSales')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'cashSales'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              <span>Cash Sales Report</span>
            </button>

            <button
              onClick={() => setActiveTab('cardSales')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'cardSales'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Card Sales Report</span>
            </button>

            {isMultiBranchChain && (
              <button
                onClick={() => setActiveTab('multibranch')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'multibranch'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Multi-Branch Consolidation</span>
              </button>
            )}
          </div>
        </div>

        {/* Date / Time Window Filter Strip */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            {activeTab === 'zreport' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Shift Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-emerald-400 focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Time Window:</span>
                {[
                  { label: 'Last 7 Days', value: 7 },
                  { label: 'Last 14 Days', value: 14 },
                  { label: 'Last 30 Days', value: 30 }
                ].map(item => (
                  <button
                    key={item.value}
                    onClick={() => setSelectedDaysRange(item.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      selectedDaysRange === item.value
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'zreport' && (
              <button
                onClick={() => setIsZReportPrintOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black shadow-md transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print 80mm Z-Report</span>
              </button>
            )}

            {activeTab === 'tax' && (
              <button
                onClick={handleExportTaxCSV}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export Tax CSV</span>
              </button>
            )}

            <button
              onClick={loadReportData}
              disabled={loading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              title="Refresh Report Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SUBMODULE 1: DAILY Z-REPORT (DAY CLOSE & CASH DRAWER RECONCILIATION)      */}
        {/* ========================================================================= */}
        {activeTab === 'zreport' && (
          <div className="space-y-6">
            {zReport ? (
              <>
                {/* 4 Summary Cards - Clean Normal Height */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Gross Sales Turnover</div>
                    <div>
                      <div className="text-xl font-black text-emerald-400 leading-tight">₨{zReport.totalSalesPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{zReport.totalOrders} paid orders settled</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
                      <span>Cash In Drawer</span>
                      <Banknote className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-xl font-black text-white leading-tight">₨{zReport.expectedCashInDrawerPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={`Float: ₨${zReport.openingFloatPKR.toLocaleString()} + Cash: ₨${zReport.cashSalesPKR.toLocaleString()}`}>
                        Float: ₨{zReport.openingFloatPKR.toLocaleString()} + Cash: ₨{zReport.cashSalesPKR.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
                      <span>Card / Digital</span>
                      <CreditCard className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <div className="text-xl font-black text-sky-400 leading-tight">₨{(zReport.cardSalesPKR + zReport.digitalSalesPKR).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">Card: ₨{zReport.cardSalesPKR.toLocaleString()} | Wallet: ₨{zReport.digitalSalesPKR.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Tax Collected</div>
                    <div>
                      <div className="text-xl font-black text-amber-400 leading-tight">₨{zReport.totalTaxPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-amber-400 mt-0.5">Cash (16%) &amp; Card (8%) Split</div>
                    </div>
                  </div>
                </div>

                {/* Cash Drawer Reconciliation: Opening Float vs Actual Count vs Variance */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800">
                    <div>
                      <h3 className="font-bold text-white text-sm flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-emerald-400" />
                        <span>Shift Cash Drawer Reconciliation (Blind Close Audit)</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Compare physical cash counted in register against expected cash sales + opening float
                      </p>
                    </div>

                    {/* Live Variance Indicator */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-bold">Variance:</span>
                      <span className={`px-3 py-1 rounded-xl font-mono text-xs font-black flex items-center gap-1 ${
                        liveVariance === 0 
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                          : liveVariance > 0 
                          ? 'bg-blue-950 text-blue-300 border border-blue-800' 
                          : 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
                      }`}>
                        {liveVariance === 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        <span>₨{liveVariance > 0 ? `+${liveVariance.toLocaleString()} Surplus` : liveVariance < 0 ? `${liveVariance.toLocaleString()} Shortage` : '0.00 Balanced'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">1. Opening Float</span>
                      <div className="text-base font-mono font-black text-white mt-1">₨{zReport.openingFloatPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-400">Initial drawer change</span>
                    </div>

                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">2. Cash Sales Inward</span>
                      <div className="text-base font-mono font-black text-emerald-400 mt-1">+₨{zReport.cashSalesPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-400">Net cash receipts</span>
                    </div>

                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">3. Expected in Drawer</span>
                      <div className="text-base font-mono font-black text-cyan-400 mt-1">₨{zReport.expectedCashInDrawerPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-400">System calculated total</span>
                    </div>

                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">4. Physical Cash Counted</span>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-400">₨</span>
                        <input
                          type="number"
                          value={actualCashCounted}
                          onChange={(e) => setActualCashCounted(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="Counted cash..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-sm font-mono font-black text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <span className="text-[10px] text-slate-400">Input by cashier/manager</span>
                    </div>
                  </div>
                </div>

                {/* Sales Channels Split */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="font-bold text-white text-sm mb-4">Turnover by Dining Channel</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400 font-semibold">Dine-In Restaurant Hall</div>
                        <div className="text-lg font-black text-white mt-1">₨{zReport.dineInSalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-slate-900 text-emerald-400 font-mono text-xs font-bold border border-slate-800">
                        {zReport.totalSalesPKR > 0 ? Math.round((zReport.dineInSalesPKR / zReport.totalSalesPKR) * 100) : 0}%
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400 font-semibold">Takeaway / Counter Pickup</div>
                        <div className="text-lg font-black text-white mt-1">₨{zReport.takeawaySalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-slate-900 text-cyan-400 font-mono text-xs font-bold border border-slate-800">
                        {zReport.totalSalesPKR > 0 ? Math.round((zReport.takeawaySalesPKR / zReport.totalSalesPKR) * 100) : 0}%
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-400 font-semibold">Rider Delivery &amp; Call Orders</div>
                        <div className="text-lg font-black text-white mt-1">₨{zReport.deliverySalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-slate-900 text-amber-400 font-mono text-xs font-bold border border-slate-800">
                        {zReport.totalSalesPKR > 0 ? Math.round((zReport.deliverySalesPKR / zReport.totalSalesPKR) * 100) : 0}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cash Tally Button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setIsCashTallyOpen(true);
                      // Load tally for today's shift
                      if (zReport.shiftId) loadCashTally(zReport.shiftId);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs transition"
                  >
                    <Wallet className="w-4 h-4" />
                    Cash Tally & Closing
                  </button>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                No closed register shifts or orders found for {selectedDate}.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 2: TAX AUDIT & FBR COMPLIANCE (16% CASH VS 8% CARD)              */}
        {/* ========================================================================= */}
        {activeTab === 'tax' && (
          <div className="space-y-6">
            {taxAudit ? (
              <>
                {/* 2 Big Segments: 16% Cash vs 8% Card */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Cash 16% Rate */}
                  <div className="p-5 rounded-2xl bg-slate-900 border border-emerald-900/60 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Banknote className="w-5 h-5 text-emerald-400" />
                        <div>
                          <h4 className="font-black text-white text-sm">Cash Orders (Standard Tax)</h4>
                          <span className="text-[10px] text-slate-400">PRA / SRB / FBR Default Restaurant Sales Tax</span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-300 font-mono text-xs font-black border border-emerald-800">
                        16% Rate
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800/80">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">Invoices</span>
                        <div className="text-lg font-black text-white">{taxAudit.cashSegment.invoiceCount}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">Taxable Sales</span>
                        <div className="text-lg font-mono font-bold text-slate-200">₨{taxAudit.cashSegment.netTaxableSalesPKR.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-emerald-400 font-bold uppercase">Tax Liability</span>
                        <div className="text-lg font-mono font-black text-emerald-400">₨{taxAudit.cashSegment.taxCollectedPKR.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>

                  {/* Card 8% Rate */}
                  <div className="p-5 rounded-2xl bg-slate-900 border border-sky-900/60 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-sky-400" />
                        <div>
                          <h4 className="font-black text-white text-sm">POS Card / Digital (Reduced Incentive Tax)</h4>
                          <span className="text-[10px] text-slate-400">Debit / Credit / Digital Payments Incentive</span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-sky-950 text-sky-300 font-mono text-xs font-black border border-sky-800">
                        8% Rate
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800/80">
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">Invoices</span>
                        <div className="text-lg font-black text-white">{taxAudit.cardSegment.invoiceCount}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">Taxable Sales</span>
                        <div className="text-lg font-mono font-bold text-slate-200">₨{taxAudit.cardSegment.netTaxableSalesPKR.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-sky-400 font-bold uppercase">Tax Liability</span>
                        <div className="text-lg font-mono font-black text-sky-400">₨{taxAudit.cardSegment.taxCollectedPKR.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Invoices Audit Trail Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-white text-sm">Tax Invoice Register &amp; Sequential Audit</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Showing {filteredTaxInvoices.length} of {taxAudit.totalInvoices} settled transactions</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Search Bar */}
                      <div className="relative w-48">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          value={taxSearchQuery}
                          onChange={(e) => setTaxSearchQuery(e.target.value)}
                          placeholder="Search order #..."
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      {/* Tax Filter */}
                      <select
                        value={taxFilterRate}
                        onChange={(e) => setTaxFilterRate(e.target.value as any)}
                        className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-300 focus:outline-none"
                      >
                        <option value="all">All Tax Rates</option>
                        <option value="16">16% Standard (Cash)</option>
                        <option value="8">8% Reduced (Card)</option>
                      </select>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-4">Invoice #</th>
                          <th className="py-3 px-4">Date &amp; Time</th>
                          <th className="py-3 px-4">Order Type</th>
                          <th className="py-3 px-4">Payment Method</th>
                          <th className="py-3 px-4 text-right">Net Bill (₨)</th>
                          <th className="py-3 px-4 text-center">Tax Rate</th>
                          <th className="py-3 px-4 text-right">Tax Collected (₨)</th>
                          <th className="py-3 px-4 text-right">Total (₨)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {filteredTaxInvoices.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-10 text-center text-slate-400">No invoices match the selected tax filters.</td>
                          </tr>
                        ) : (
                          filteredTaxInvoices.map(inv => (
                            <tr key={inv.orderId} className="hover:bg-slate-850/50 transition">
                              <td className="py-3 px-4 font-mono font-bold text-white">{inv.orderNumber}</td>
                              <td className="py-3 px-4 text-slate-400">{new Date(inv.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                              <td className="py-3 px-4 text-slate-300">{inv.orderType}</td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  inv.paymentMethod === 'Cash' 
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                                    : 'bg-sky-950 text-sky-300 border border-sky-800'
                                }`}>
                                  {inv.paymentMethod}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-slate-300">₨{inv.netAmountPKR.toLocaleString()}</td>
                              <td className="py-3 px-4 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                  inv.taxRatePercent === 16 ? 'text-emerald-400 bg-emerald-950/60' : 'text-sky-400 bg-sky-950/60'
                                }`}>
                                  {inv.taxRatePercent}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">₨{inv.taxAmountPKR.toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-white">₨{inv.totalAmountPKR.toLocaleString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                No tax audit records found for the past {selectedDaysRange} days.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 3: CATEGORY TURNOVER & SALES MIX                                */}
        {/* ========================================================================= */}
        {activeTab === 'categories' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm">Category Turnover (Past {selectedDaysRange} Days)</h3>
                <p className="text-xs text-slate-400 mt-0.5">Performance breakdown sorted by gross sales volume</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">{categorySales.length} categories active</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-center">Items Sold</th>
                    <th className="py-3 px-4 text-right">Net Sales (₨)</th>
                    <th className="py-3 px-4 text-right">Tax (₨)</th>
                    <th className="py-3 px-4 text-right">Gross Sales (₨)</th>
                    <th className="py-3 px-4 text-right">% Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {categorySales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">No category sales records found.</td>
                    </tr>
                  ) : (
                    categorySales.map(c => (
                      <tr key={c.categoryId} className="hover:bg-slate-850/50 transition">
                        <td className="py-3.5 px-4 font-bold text-white">{c.categoryName}</td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-300 font-semibold">{c.quantitySold}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-400">₨{c.netSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-amber-400">₨{c.taxPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-bold">₨{c.grossSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-purple-400">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                              <div className="bg-purple-500 h-full rounded-full" style={{ width: `${c.percentageOfTotal}%` }}></div>
                            </div>
                            <span>{c.percentageOfTotal}%</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 4: ITEM PERFORMANCE & MENU ENGINEERING (COGS / PROFITABILITY)  */}
        {/* ========================================================================= */}
        {activeTab === 'products' && (
          <div className="space-y-4">
            {/* Menu Engineering Matrix Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-2">
                <span className="text-base">⭐</span>
                <div>
                  <div className="text-xs font-bold text-white">Stars</div>
                  <div className="text-[10px] text-slate-400">High Margin &bull; High Sales</div>
                </div>
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-2">
                <span className="text-base">🐴</span>
                <div>
                  <div className="text-xs font-bold text-white">Plowhorses</div>
                  <div className="text-[10px] text-slate-400">Lower Margin &bull; High Volume</div>
                </div>
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-2">
                <span className="text-base">🧩</span>
                <div>
                  <div className="text-xs font-bold text-white">Puzzles</div>
                  <div className="text-[10px] text-slate-400">High Margin &bull; Low Volume</div>
                </div>
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center gap-2">
                <span className="text-base">🐕</span>
                <div>
                  <div className="text-xs font-bold text-white">Dogs</div>
                  <div className="text-[10px] text-slate-400">Low Margin &bull; Low Volume</div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white text-sm">Product Profitability &amp; Food Cost (BOM COGS)</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Calculates gross margin per dish based on recipe ingredients</p>
                </div>
                <span className="text-xs text-slate-400 font-mono">{productPerformance.length} items ranked</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Rank &amp; Product</th>
                      <th className="py-3 px-4 text-center">Class</th>
                      <th className="py-3 px-4 text-center">Units Sold</th>
                      <th className="py-3 px-4 text-right">Revenue (₨)</th>
                      <th className="py-3 px-4 text-right">Estimated Food Cost (₨)</th>
                      <th className="py-3 px-4 text-right">Gross Profit (₨)</th>
                      <th className="py-3 px-4 text-center">Gross Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {productPerformance.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-400">No product sales records found.</td>
                      </tr>
                    ) : (
                      productPerformance.map((p, idx) => {
                        const isHighVolume = p.quantitySold >= 2;
                        const isHighMargin = p.marginPercent >= 50;
                        const matrixBadge = isHighVolume && isHighMargin 
                          ? { icon: '⭐', label: 'Star', color: 'text-amber-400 bg-amber-950/60 border-amber-800/60' }
                          : isHighVolume && !isHighMargin
                          ? { icon: '🐴', label: 'Plowhorse', color: 'text-blue-400 bg-blue-950/60 border-blue-800/60' }
                          : !isHighVolume && isHighMargin
                          ? { icon: '🧩', label: 'Puzzle', color: 'text-purple-400 bg-purple-950/60 border-purple-800/60' }
                          : { icon: '🐕', label: 'Dog', color: 'text-rose-400 bg-rose-950/60 border-rose-800/60' };

                        return (
                          <tr key={p.productId} className="hover:bg-slate-850/50 transition">
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <span className="text-[10px] font-mono font-bold text-slate-400 w-4">#{idx + 1}</span>
                                <div>
                                  <div className="font-bold text-white">{p.productName}</div>
                                  <div className="text-[11px] text-slate-400">{p.categoryName}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${matrixBadge.color}`}>
                                <span>{matrixBadge.icon}</span>
                                <span>{matrixBadge.label}</span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono text-slate-200 font-bold">{p.quantitySold}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400">₨{p.revenuePKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono text-slate-400">₨{p.costPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-sky-400">₨{p.grossProfitPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                p.marginPercent >= 50 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                                p.marginPercent >= 30 ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                                'bg-rose-950 text-rose-300 border border-rose-800'
                              }`}>
                                {p.marginPercent}%
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 5: PAYMENT METHODS BREAKDOWN & TENDER MIX                       */}
        {/* ========================================================================= */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            {paymentMethods ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paymentMethods.tenders.map((t, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          {t.method === 'Cash' ? <Banknote className="w-4 h-4 text-emerald-400" /> : <CreditCard className="w-4 h-4 text-sky-400" />}
                          {t.method}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-950 text-emerald-400 font-mono text-[10px] font-black border border-slate-800">
                          {t.percentageOfTotal}%
                        </span>
                      </div>

                      <div className="my-3">
                        <div className="text-xl font-black text-white font-mono">₨{t.totalAmountPKR.toLocaleString()}</div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                          <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${t.percentageOfTotal}%` }}></div>
                        </div>
                      </div>

                      <div className="flex justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                        <span>{t.transactionCount} transactions</span>
                        <span>Avg: <strong>₨{t.avgTicketPKR.toLocaleString()}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between shadow-xl">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase">Total Financial Settlements</span>
                    <div className="text-2xl font-black text-emerald-400 mt-0.5">₨{paymentMethods.totalRevenuePKR.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 font-semibold uppercase">Total Volume Count</span>
                    <div className="text-2xl font-black text-white mt-0.5">{paymentMethods.totalTransactions} Invoices</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                No payment tender records found.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE: CASH SALES REPORT                                              */}
        {/* ========================================================================= */}
        {activeTab === 'cashSales' && (
          <div className="space-y-6">
            {cashSalesReport ? (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Cash Sales</div>
                    <div className="text-2xl font-black text-emerald-400 mt-1">₨{cashSalesReport.totalCashSalesPKR.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Cash Invoices</div>
                    <div className="text-2xl font-black text-white mt-1">{cashSalesReport.orderCount}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Average Cash Invoice</div>
                    <div className="text-2xl font-black text-amber-400 mt-1">
                      ₨{cashSalesReport.orderCount > 0 ? Math.round(cashSalesReport.totalCashSalesPKR / cashSalesReport.orderCount).toLocaleString() : 0}
                    </div>
                  </div>
                </div>

                {/* Cash Orders Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-slate-800">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-emerald-400" />
                      Cash Payment Invoices — {cashSalesReport.date}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                          <th className="p-3">Invoice #</th>
                          <th className="p-3">Table</th>
                          <th className="p-3">Cashier</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3 text-right">Paid</th>
                          <th className="p-3 text-right">Change</th>
                          <th className="p-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {cashSalesReport.orders.map((o: any) => (
                          <tr key={o.id} className="hover:bg-slate-850/50 transition">
                            <td className="p-3 font-mono font-bold text-white">{o.orderNumber}</td>
                            <td className="p-3 text-slate-300">{o.tableNumber || '—'}</td>
                            <td className="p-3 text-slate-300">{o.cashierName}</td>
                            <td className="p-3 text-right font-mono font-bold text-emerald-400">₨{o.totalPKR.toLocaleString()}</td>
                            <td className="p-3 text-right font-mono text-slate-300">₨{o.amountPaidPKR.toLocaleString()}</td>
                            <td className="p-3 text-right font-mono text-amber-400">₨{o.changeDuePKR.toLocaleString()}</td>
                            <td className="p-3 text-slate-400">{new Date(o.createdAt).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                <Banknote className="w-12 h-12 mx-auto mb-3 text-slate-700" />
                <p className="text-xs">Select a date and branch to view cash sales</p>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE: CARD / DIGITAL SALES REPORT                                    */}
        {/* ========================================================================= */}
        {activeTab === 'cardSales' && (
          <div className="space-y-6">
            {cardSalesReport ? (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Card / Digital Sales</div>
                    <div className="text-2xl font-black text-cyan-400 mt-1">₨{cardSalesReport.totalCardSalesPKR.toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Digital Invoices</div>
                    <div className="text-2xl font-black text-white mt-1">{cardSalesReport.orderCount}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Average Digital Invoice</div>
                    <div className="text-2xl font-black text-amber-400 mt-1">
                      ₨{cardSalesReport.orderCount > 0 ? Math.round(cardSalesReport.totalCardSalesPKR / cardSalesReport.orderCount).toLocaleString() : 0}
                    </div>
                  </div>
                </div>

                {/* Breakdown by Payment Method */}
                {cardSalesReport.byMethod.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cardSalesReport.byMethod.map((m: any) => (
                      <div key={m.method} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">{m.method}</div>
                        <div className="text-sm font-black text-cyan-400 mt-0.5">₨{m.total.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">{m.count} invoices</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Card Orders Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-slate-800">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-cyan-400" />
                      Card / Digital Invoices — {cardSalesReport.date}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                          <th className="p-3">Invoice #</th>
                          <th className="p-3">Method</th>
                          <th className="p-3">Table</th>
                          <th className="p-3">Cashier</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {cardSalesReport.orders.map((o: any) => (
                          <tr key={o.id} className="hover:bg-slate-850/50 transition">
                            <td className="p-3 font-mono font-bold text-white">{o.orderNumber}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-400 text-[10px] font-bold border border-cyan-800">
                                {o.paymentMethod}
                              </span>
                            </td>
                            <td className="p-3 text-slate-300">{o.tableNumber || '—'}</td>
                            <td className="p-3 text-slate-300">{o.cashierName}</td>
                            <td className="p-3 text-right font-mono font-bold text-cyan-400">₨{o.totalPKR.toLocaleString()}</td>
                            <td className="p-3 text-slate-400">{new Date(o.createdAt).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                <CreditCard className="w-12 h-12 mx-auto mb-3 text-slate-700" />
                <p className="text-xs">Select a date and branch to view card/digital sales</p>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 6: MULTI-BRANCH CONSOLIDATED FINANCIALS (CHAIN VIEW)            */}
        {/* ========================================================================= */}
        {activeTab === 'multibranch' && (
          <div className="space-y-6">
            {consolidated ? (
              <>
                {/* 4 Consolidated Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Chain Total Revenue</div>
                    <div>
                      <div className="text-xl font-black text-emerald-400 leading-tight">₨{consolidated.chainGrossSalesPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Across {consolidated.branches.length} branches</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Consolidated Tax Liability</div>
                    <div>
                      <div className="text-xl font-black text-amber-400 leading-tight">₨{consolidated.chainTaxCollectedPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">FBR / PRA Remittance</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Estimated Food Cost</div>
                    <div>
                      <div className="text-xl font-black text-rose-400 leading-tight">₨{consolidated.chainCostPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Recipe ingredient cost</div>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Chain Operating Margin</div>
                    <div>
                      <div className="text-xl font-black text-cyan-400 leading-tight">{consolidated.chainProfitMargin}%</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Net: ₨{consolidated.chainNetProfitPKR.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                {/* Multi-Branch Comparison Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-white text-sm">Cross-City Outlet Revenue Benchmarking</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Financial comparison of all outlets connected to Head Office</p>
                    </div>
                    <span className="text-xs font-mono text-emerald-400 font-bold">Currency: PKR ₨</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-4">Branch Outlet</th>
                          <th className="py-3 px-4">City</th>
                          <th className="py-3 px-4 text-center">Orders</th>
                          <th className="py-3 px-4 text-right">Gross Sales (₨)</th>
                          <th className="py-3 px-4 text-right">Cash / Card Split</th>
                          <th className="py-3 px-4 text-right">Tax (₨)</th>
                          <th className="py-3 px-4 text-right">Estimated Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {consolidated.branches.map(b => (
                          <tr key={b.branchId} className="hover:bg-slate-850/50 transition">
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-purple-400" />
                                <span>{b.branchName}</span>
                                {b.isHeadOffice && (
                                  <span className="px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 text-[9px] font-bold border border-purple-800">HQ</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-300">{b.city}</td>
                            <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-200">{b.orderCount}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-black text-emerald-400">₨{b.grossSalesPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-400">
                              <span className="text-emerald-400">₨{b.cashSalesPKR.toLocaleString()}</span> / <span className="text-sky-400">₨{b.cardSalesPKR.toLocaleString()}</span>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-amber-400">₨{b.taxCollectedPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-black text-cyan-400">{b.profitMarginPercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
                No consolidated records available.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* THERMAL 80MM Z-REPORT PREVIEW MODAL                                       */}
        {/* ========================================================================= */}
        {isZReportPrintOpen && zReport && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Printer className="w-4 h-4 text-emerald-400" />
                  <span>80mm Thermal Z-Report Preview</span>
                </div>
                <button onClick={() => setIsZReportPrintOpen(false)} className="p-1 text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 bg-white text-black font-mono text-[11px] leading-tight select-all">
                <div className="text-center pb-2 border-b border-dashed border-gray-400">
                  <div className="font-bold text-sm uppercase tracking-wider">{selectedTenant?.name || 'Restaurant HQ'}</div>
                  <div className="text-[10px] text-gray-700">{selectedBranch?.name}</div>
                  <div className="text-[10px] text-gray-700">{selectedBranch?.address}, {selectedBranch?.city}</div>
                  <div className="text-[9px] font-sans text-gray-500 uppercase mt-1 font-bold">** DAILY Z-REPORT (SHIFT CLOSE) **</div>
                </div>

                <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Audit Date:</span>
                    <strong>{zReport.period}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Print Time:</span>
                    <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cashier:</span>
                    <span>Closing Supervisor</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Settled Orders:</span>
                    <strong>{zReport.totalOrders}</strong>
                  </div>
                </div>

                {/* Sales Section */}
                <div className="py-2 border-b border-dashed border-gray-400 space-y-1">
                  <div className="font-bold uppercase text-[10px]">Financial Summary</div>
                  <div className="flex justify-between">
                    <span>Gross Sales:</span>
                    <strong className="text-xs">Rs. {zReport.totalSalesPKR.toLocaleString()}</strong>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Cash Sales:</span>
                    <span>Rs. {zReport.cashSalesPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Card / POS:</span>
                    <span>Rs. {zReport.cardSalesPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Digital Wallets:</span>
                    <span>Rs. {zReport.digitalSalesPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>Total Tax (FBR):</span>
                    <span>Rs. {zReport.totalTaxPKR.toLocaleString()}</span>
                  </div>
                </div>

                {/* Cash Reconciliation */}
                <div className="py-2 border-b border-dashed border-gray-400 space-y-1">
                  <div className="font-bold uppercase text-[10px]">Drawer Reconciliation</div>
                  <div className="flex justify-between">
                    <span>Opening Float:</span>
                    <span>Rs. {zReport.openingFloatPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Net Cash Collected:</span>
                    <span>Rs. {zReport.cashSalesPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-gray-200 pt-1">
                    <span>Expected in Drawer:</span>
                    <span>Rs. {zReport.expectedCashInDrawerPKR.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Actual Cash Counted:</span>
                    <span>Rs. {countedCash.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs border-t border-gray-300 pt-1">
                    <span>Variance:</span>
                    <span>{liveVariance === 0 ? 'Rs. 0 (Balanced)' : liveVariance > 0 ? `+Rs. ${liveVariance.toLocaleString()} (Surplus)` : `-Rs. ${Math.abs(liveVariance).toLocaleString()} (Shortage)`}</span>
                  </div>
                </div>

                {/* Signatures */}
                <div className="pt-6 pb-2 text-[10px] space-y-5">
                  <div className="flex justify-between">
                    <span className="border-t border-black pt-1 w-24 text-center">Cashier Sign</span>
                    <span className="border-t border-black pt-1 w-24 text-center">Manager Sign</span>
                  </div>
                  <div className="text-center text-[9px] text-gray-500 uppercase">
                    Official End-of-Day Audit Record
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-800 border-t border-slate-700 flex justify-end gap-2">
                <button
                  onClick={() => setIsZReportPrintOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Receipt Now</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* CASH TALLY MODAL (End-of-Day Cash Reconciliation)                         */}
        {/* ========================================================================= */}
        {isCashTallyOpen && (
          <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-400" />
                  Cash Tally — End of Day
                </h3>
                <button onClick={() => setIsCashTallyOpen(false)} className="text-slate-400 hover:text-white text-sm cursor-pointer">✕</button>
              </div>

              {cashTallyLoading ? (
                <div className="text-center py-8 text-slate-400 text-xs">Loading cash tally...</div>
              ) : cashTally ? (
                <>
                  {/* Cash Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Opening Float</div>
                      <div className="text-sm font-black text-white font-mono">₨{cashTally.openingFloat.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Cash Sales</div>
                      <div className="text-sm font-black text-emerald-400 font-mono">₨{cashTally.cashSales.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Cash Received</div>
                      <div className="text-sm font-black text-cyan-400 font-mono">₨{cashTally.cashReceived.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Cash Paid Out</div>
                      <div className="text-sm font-black text-red-400 font-mono">₨{cashTally.cashPaidOut.toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Expected Cash */}
                  <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800 flex items-center justify-between">
                    <span className="text-xs text-emerald-300 font-bold">Expected Cash in Drawer:</span>
                    <span className="text-lg font-black text-emerald-400 font-mono">₨{cashTally.expectedCash.toLocaleString()}</span>
                  </div>

                  {/* Formula Explanation */}
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 space-y-1">
                    <div className="font-bold text-slate-300">Formula:</div>
                    <div className="font-mono">
                      Opening Float (₨{cashTally.openingFloat.toLocaleString()}) + Cash Sales (₨{cashTally.cashSales.toLocaleString()}) + Cash Received (₨{cashTally.cashReceived.toLocaleString()}) - Cash Paid Out (₨{cashTally.cashPaidOut.toLocaleString()}) = <span className="text-emerald-400 font-bold">₨{cashTally.expectedCash.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Cash Entries List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white">Cash Entries Today</h4>
                      <button
                        onClick={() => setShowAddEntry(!showAddEntry)}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-[10px] font-bold transition"
                      >
                        + Add Entry
                      </button>
                    </div>

                    {/* Add Entry Form */}
                    {showAddEntry && (
                      <div className="p-3 rounded-xl bg-slate-950 border border-amber-800 space-y-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEntryType('PaidOut')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${
                              entryType === 'PaidOut' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            Cash Paid Out
                          </button>
                          <button
                            onClick={() => setEntryType('Received')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${
                              entryType === 'Received' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            Cash Received
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="Amount (₨)"
                            value={entryAmount}
                            onChange={(e) => setEntryAmount(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                          <input
                            type="text"
                            placeholder="Description"
                            value={entryDesc}
                            onChange={(e) => setEntryDesc(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Vendor / Person name (optional)"
                            value={entryRecipient}
                            onChange={(e) => setEntryRecipient(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={handleAddCashEntry}
                            disabled={!entryAmount || !entryDesc}
                            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 text-xs font-bold transition"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Entries List */}
                    {cashTally.entries.length === 0 ? (
                      <div className="p-4 text-center text-slate-400 bg-slate-950 rounded-xl border border-slate-800 text-[10px]">
                        No cash entries today. Use "Add Entry" to record cash paid out or received.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {cashTally.entries.map((e: any) => (
                          <div key={e.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                e.entryType === 'PaidOut' ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                              }`}>
                                {e.entryType === 'PaidOut' ? 'PAID OUT' : 'RECEIVED'}
                              </span>
                              <div>
                                <div className="text-[10px] font-bold text-white">{e.description}</div>
                                <div className="text-[9px] text-slate-400">
                                  {e.recipientOrSource && `${e.recipientOrSource} • `}{new Date(e.createdAt).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono font-bold ${e.entryType === 'PaidOut' ? 'text-red-400' : 'text-cyan-400'}`}>
                                {e.entryType === 'PaidOut' ? '-' : '+'}₨{e.amountPKR.toLocaleString()}
                              </span>
                              <button
                                onClick={() => handleDeleteCashEntry(e.id)}
                                className="text-slate-400 hover:text-red-400 transition"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No active cash shift found. Open a shift first.
                </div>
              )}

              <div className="pt-3 border-t border-slate-800">
                <button
                  onClick={() => setIsCashTallyOpen(false)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

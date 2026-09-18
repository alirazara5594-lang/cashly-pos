import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Printer, 
  Banknote, 
  CreditCard, 
  RefreshCw,
  Building2,
  Wallet,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
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
      if (activeTab === 'zreport' || activeTab === 'cashTally') {
        const data = await posApi.getZReport(selectedBranch.id, selectedDate);
        setZReport(data);
        if (data) {
          setActualCashCounted(data.actualCashInDrawerPKR || data.expectedCashInDrawerPKR);
        }
        // Auto-open Cash Tally modal when cashTally tab is selected
        if (activeTab === 'cashTally' && data?.shiftId) {
          setTimeout(() => {
            setIsCashTallyOpen(true);
            loadCashTally(data.shiftId!);
          }, 300);
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
    if (!taxAudit?.invoices?.length) return;
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
    <div className="flex-1 bg-slate-50 text-slate-900 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Strip */}
        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-teal-500" />
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              {activeTab === 'zreport' && 'Z-Report (End of Day)'}
              {activeTab === 'tax' && 'Tax Audit & Compliance'}
              {activeTab === 'categories' && 'Category Turnover & Channels'}
              {activeTab === 'products' && 'Menu Profitability & COGS'}
              {activeTab === 'payments' && 'Payment Tender Mix'}
              {activeTab === 'cashSales' && 'Cash Sales Report'}
              {activeTab === 'cardSales' && 'Card / Digital Sales Report'}
              {activeTab === 'cashTally' && 'Cash Tally & Closing'}
              {activeTab === 'multibranch' && 'Multi-Branch Consolidation'}
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-teal-500" />
            Auditing Branch: <span className="text-teal-600 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
            <span className="text-slate-400 mx-1">•</span>
            <span className="text-slate-500">Tax Authority Compliance Mode</span>
          </p>
        </div>

        {/* Date / Time Window Filter Strip */}
        <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            {activeTab === 'zreport' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-semibold">Shift Date:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-semibold">Time Window:</span>
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
                        ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                        : 'bg-slate-100 text-slate-600 hover:bg-teal-50 border border-slate-200'
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-black shadow-md transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print 80mm Z-Report</span>
              </button>
            )}

            {activeTab === 'tax' && (
              <button
                onClick={handleExportTaxCSV}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5 text-teal-500" />
                <span>Export Tax CSV</span>
              </button>
            )}

            <button
              onClick={loadReportData}
              disabled={loading}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl border border-slate-200 transition"
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
                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Gross Sales Turnover</div>
                    <div>
                      <div className="text-xl font-black text-teal-600 leading-tight">{zReport.totalSalesPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{zReport.totalOrders} paid orders settled</div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-between">
                      <span>Cash In Drawer</span>
                      <Banknote className="w-4 h-4 text-teal-500" />
                    </div>
                    <div>
                      <div className="text-xl font-black text-slate-900 leading-tight">{zReport.expectedCashInDrawerPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={`Float: ${zReport.openingFloatPKR.toLocaleString()} + Cash: ${zReport.cashSalesPKR.toLocaleString()}`}>
                        Float: {zReport.openingFloatPKR.toLocaleString()} + Cash: {zReport.cashSalesPKR.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-between">
                      <span>Card / Digital</span>
                      <CreditCard className="w-4 h-4 text-sky-500" />
                    </div>
                    <div>
                      <div className="text-xl font-black text-sky-600 leading-tight">{(zReport.cardSalesPKR + zReport.digitalSalesPKR).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">Card: {zReport.cardSalesPKR.toLocaleString()} | Wallet: {zReport.digitalSalesPKR.toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Tax Collected</div>
                    <div>
                      <div className="text-xl font-black text-amber-600 leading-tight">{zReport.totalTaxPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-amber-600 mt-0.5">Cash (16%) &amp; Card (8%) Split</div>
                    </div>
                  </div>
                </div>

                {/* Cash Drawer Reconciliation: Opening Float vs Actual Count vs Variance */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-teal-500" />
                        <span>Shift Cash Drawer Reconciliation (Blind Close Audit)</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Compare physical cash counted in register against expected cash sales + opening float
                      </p>
                    </div>

                    {/* Live Variance Indicator */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-bold">Variance:</span>
                      <span className={`px-3 py-1 rounded-xl font-mono text-xs font-black flex items-center gap-1 ${
                        liveVariance === 0 
                          ? 'bg-teal-50 text-teal-600 border border-teal-200' 
                          : liveVariance > 0 
                          ? 'bg-blue-50 text-blue-600 border border-blue-200' 
                          : 'bg-rose-50 text-rose-600 border border-rose-200 animate-pulse'
                      }`}>
                        {liveVariance === 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        <span>{liveVariance > 0 ? `+${liveVariance.toLocaleString()} Surplus` : liveVariance < 0 ? `${liveVariance.toLocaleString()} Shortage` : '0.00 Balanced'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">1. Opening Float</span>
                      <div className="text-base font-mono font-black text-slate-900 mt-1">{zReport.openingFloatPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-500">Initial drawer change</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">2. Cash Sales Inward</span>
                      <div className="text-base font-mono font-black text-teal-600 mt-1">+{zReport.cashSalesPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-500">Net cash receipts</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">3. Expected in Drawer</span>
                      <div className="text-base font-mono font-black text-blue-600 mt-1">{zReport.expectedCashInDrawerPKR.toLocaleString()}</div>
                      <span className="text-[10px] text-slate-500">System calculated total</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">4. Physical Cash Counted</span>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-500">PKR</span>
                        <input
                          type="number"
                          value={actualCashCounted}
                          onChange={(e) => setActualCashCounted(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="Counted cash..."
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-sm font-mono font-black text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                        />
                      </div>
                      <span className="text-[10px] text-slate-500">Input by cashier/manager</span>
                    </div>
                  </div>
                </div>

                {/* Sales Channels Split */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xl">
                  <h3 className="font-bold text-slate-900 text-sm mb-4">Turnover by Dining Channel</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500 font-semibold">Dine-In Restaurant Hall</div>
                        <div className="text-lg font-black text-slate-900 mt-1">{zReport.dineInSalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-white text-teal-600 font-mono text-xs font-bold border border-slate-200">
                        {zReport.totalSalesPKR > 0 ? Math.round((zReport.dineInSalesPKR / zReport.totalSalesPKR) * 100) : 0}%
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500 font-semibold">Takeaway / Counter Pickup</div>
                        <div className="text-lg font-black text-slate-900 mt-1">{zReport.takeawaySalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-white text-blue-600 font-mono text-xs font-bold border border-slate-200">
                        {zReport.totalSalesPKR > 0 ? Math.round((zReport.takeawaySalesPKR / zReport.totalSalesPKR) * 100) : 0}%
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500 font-semibold">Rider Delivery &amp; Call Orders</div>
                        <div className="text-lg font-black text-slate-900 mt-1">{zReport.deliverySalesPKR.toLocaleString()}</div>
                      </div>
                      <div className="px-2.5 py-1 rounded-lg bg-white text-amber-600 font-mono text-xs font-bold border border-slate-200">
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
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition"
                  >
                    <Wallet className="w-4 h-4" />
                    Cash Tally & Closing
                  </button>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                No closed register shifts or orders found for {selectedDate}.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 2: TAX AUDIT & COMPLIANCE (16% CASH VS 8% CARD)              */}
        {/* ========================================================================= */}
        {activeTab === 'tax' && (
          <div className="space-y-6">
            {taxAudit ? (
              <>
                {/* 2 Big Segments: 16% Cash vs 8% Card */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Cash 16% Rate */}
                  <div className="p-5 rounded-2xl bg-white border border-teal-200 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Banknote className="w-5 h-5 text-teal-500" />
                        <div>
                          <h4 className="font-black text-slate-900 text-sm">Cash Orders (Standard Tax)</h4>
                          <span className="text-[10px] text-slate-500">Default Restaurant Sales Tax</span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-600 font-mono text-xs font-black border border-teal-200">
                        16% Rate
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Invoices</span>
                        <div className="text-lg font-black text-slate-900">{taxAudit.cashSegment.invoiceCount}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Taxable Sales</span>
                        <div className="text-lg font-mono font-bold text-slate-700">{taxAudit.cashSegment.netTaxableSalesPKR.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-teal-600 font-bold uppercase">Tax Liability</span>
                        <div className="text-lg font-mono font-black text-teal-600">{taxAudit.cashSegment.taxCollectedPKR.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>

                  {/* Card 8% Rate */}
                  <div className="p-5 rounded-2xl bg-white border border-sky-200 shadow-xl relative overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-sky-500" />
                        <div>
                          <h4 className="font-black text-slate-900 text-sm">POS Card / Digital (Reduced Incentive Tax)</h4>
                          <span className="text-[10px] text-slate-500">Debit / Credit / Digital Payments Incentive</span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-600 font-mono text-xs font-black border border-sky-200">
                        8% Rate
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Invoices</span>
                        <div className="text-lg font-black text-slate-900">{taxAudit.cardSegment.invoiceCount}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 font-semibold uppercase">Taxable Sales</span>
                        <div className="text-lg font-mono font-bold text-slate-700">{taxAudit.cardSegment.netTaxableSalesPKR.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-sky-600 font-bold uppercase">Tax Liability</span>
                        <div className="text-lg font-mono font-black text-sky-600">{taxAudit.cardSegment.taxCollectedPKR.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Invoices Audit Trail Table */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Tax Invoice Register &amp; Sequential Audit</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Showing {filteredTaxInvoices.length} of {taxAudit.totalInvoices} settled transactions</p>
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
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                        />
                      </div>

                      {/* Tax Filter */}
                      <select
                        value={taxFilterRate}
                        onChange={(e) => setTaxFilterRate(e.target.value as any)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
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
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-4">Invoice #</th>
                          <th className="py-3 px-4">Date &amp; Time</th>
                          <th className="py-3 px-4">Order Type</th>
                          <th className="py-3 px-4">Payment Method</th>
                          <th className="py-3 px-4 text-right">Net Bill (PKR)</th>
                          <th className="py-3 px-4 text-center">Tax Rate</th>
                          <th className="py-3 px-4 text-right">Tax Collected (PKR)</th>
                          <th className="py-3 px-4 text-right">Total (PKR)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTaxInvoices.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-10 text-center text-slate-500">No invoices match the selected tax filters.</td>
                          </tr>
                        ) : (
                          filteredTaxInvoices.map(inv => (
                            <tr key={inv.orderId} className="hover:bg-slate-50 transition">
                              <td className="py-3 px-4 font-mono font-bold text-slate-900">{inv.orderNumber}</td>
                              <td className="py-3 px-4 text-slate-500">{new Date(inv.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                              <td className="py-3 px-4 text-slate-700">{inv.orderType}</td>
                              <td className="py-3 px-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  inv.paymentMethod === 'Cash' 
                                    ? 'bg-teal-50 text-teal-600 border border-teal-200' 
                                    : 'bg-sky-50 text-sky-600 border border-sky-200'
                                }`}>
                                  {inv.paymentMethod}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-slate-700">{inv.netAmountPKR.toLocaleString()}</td>
                              <td className="py-3 px-4 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                  inv.taxRatePercent === 16 ? 'text-teal-600 bg-teal-50' : 'text-sky-600 bg-sky-50'
                                }`}>
                                  {inv.taxRatePercent}%
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-amber-600">{inv.taxAmountPKR.toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{inv.totalAmountPKR.toLocaleString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                No tax audit records found for the past {selectedDaysRange} days.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* SUBMODULE 3: CATEGORY TURNOVER & SALES MIX                                */}
        {/* ========================================================================= */}
        {activeTab === 'categories' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Category Turnover (Past {selectedDaysRange} Days)</h3>
                <p className="text-xs text-slate-500 mt-0.5">Performance breakdown sorted by gross sales volume</p>
              </div>
              <span className="text-xs text-slate-500 font-mono">{categorySales.length} categories active</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-center">Items Sold</th>
                    <th className="py-3 px-4 text-right">Net Sales (PKR)</th>
                    <th className="py-3 px-4 text-right">Tax (PKR)</th>
                    <th className="py-3 px-4 text-right">Gross Sales (PKR)</th>
                    <th className="py-3 px-4 text-right">% Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categorySales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">No category sales records found.</td>
                    </tr>
                  ) : (
                    categorySales.map(c => (
                      <tr key={c.categoryId} className="hover:bg-slate-50 transition">
                        <td className="py-3.5 px-4 font-bold text-slate-900">{c.categoryName}</td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-700 font-semibold">{c.quantitySold}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-500">{c.netSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-amber-600">{c.taxPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-teal-600 font-bold">{c.grossSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-purple-600">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden hidden sm:block">
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
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2">
                <span className="text-base">⭐</span>
                <div>
                  <div className="text-xs font-bold text-slate-900">Stars</div>
                  <div className="text-[10px] text-slate-500">High Margin &bull; High Sales</div>
                </div>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2">
                <span className="text-base">🐴</span>
                <div>
                  <div className="text-xs font-bold text-slate-900">Plowhorses</div>
                  <div className="text-[10px] text-slate-500">Lower Margin &bull; High Volume</div>
                </div>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2">
                <span className="text-base">🧩</span>
                <div>
                  <div className="text-xs font-bold text-slate-900">Puzzles</div>
                  <div className="text-[10px] text-slate-500">High Margin &bull; Low Volume</div>
                </div>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2">
                <span className="text-base">🐕</span>
                <div>
                  <div className="text-xs font-bold text-slate-900">Dogs</div>
                  <div className="text-[10px] text-slate-500">Low Margin &bull; Low Volume</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Product Profitability &amp; Food Cost (BOM COGS)</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Calculates gross margin per dish based on recipe ingredients</p>
                </div>
                <span className="text-xs text-slate-500 font-mono">{productPerformance.length} items ranked</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Rank &amp; Product</th>
                      <th className="py-3 px-4 text-center">Class</th>
                      <th className="py-3 px-4 text-center">Units Sold</th>
                      <th className="py-3 px-4 text-right">Revenue (PKR)</th>
                      <th className="py-3 px-4 text-right">Estimated Food Cost (PKR)</th>
                      <th className="py-3 px-4 text-right">Gross Profit (PKR)</th>
                      <th className="py-3 px-4 text-center">Gross Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {productPerformance.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500">No product sales records found.</td>
                      </tr>
                    ) : (
                      productPerformance.map((p, idx) => {
                        const isHighVolume = p.quantitySold >= 2;
                        const isHighMargin = p.marginPercent >= 50;
                        const matrixBadge = isHighVolume && isHighMargin 
                          ? { icon: '⭐', label: 'Star', color: 'text-amber-600 bg-amber-50 border-amber-200' }
                          : isHighVolume && !isHighMargin
                          ? { icon: '🐴', label: 'Plowhorse', color: 'text-blue-600 bg-blue-50 border-blue-200' }
                          : !isHighVolume && isHighMargin
                          ? { icon: '🧩', label: 'Puzzle', color: 'text-purple-600 bg-purple-50 border-purple-200' }
                          : { icon: '🐕', label: 'Dog', color: 'text-rose-600 bg-rose-50 border-rose-200' };

                        return (
                          <tr key={p.productId} className="hover:bg-slate-50 transition">
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <span className="text-[10px] font-mono font-bold text-slate-500 w-4">#{idx + 1}</span>
                                <div>
                                  <div className="font-bold text-slate-900">{p.productName}</div>
                                  <div className="text-[11px] text-slate-500">{p.categoryName}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${matrixBadge.color}`}>
                                <span>{matrixBadge.icon}</span>
                                <span>{matrixBadge.label}</span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center font-mono text-slate-700 font-bold">{p.quantitySold}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-teal-600">{p.revenuePKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono text-slate-500">{p.costPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-bold text-sky-600">{p.grossProfitPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                p.marginPercent >= 50 ? 'bg-teal-50 text-teal-600 border border-teal-200' :
                                p.marginPercent >= 30 ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                'bg-rose-50 text-rose-600 border border-rose-200'
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
                    <div key={idx} className="p-4 rounded-xl bg-white border border-slate-200 shadow-xl flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          {t.method === 'Cash' ? <Banknote className="w-4 h-4 text-teal-500" /> : <CreditCard className="w-4 h-4 text-sky-500" />}
                          {t.method}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-teal-600 font-mono text-[10px] font-black border border-slate-200">
                          {t.percentageOfTotal}%
                        </span>
                      </div>

                      <div className="my-3">
                        <div className="text-xl font-black text-slate-900 font-mono">{t.totalAmountPKR.toLocaleString()}</div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                          <div className="bg-teal-500 h-full rounded-full" style={{ width: `${t.percentageOfTotal}%` }}></div>
                        </div>
                      </div>

                      <div className="flex justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                        <span>{t.transactionCount} transactions</span>
                        <span>Avg: <strong>{t.avgTicketPKR.toLocaleString()}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-5 bg-white border border-slate-200 rounded-2xl flex items-center justify-between shadow-xl">
                  <div>
                    <span className="text-xs text-slate-500 font-semibold uppercase">Total Financial Settlements</span>
                    <div className="text-2xl font-black text-teal-600 mt-0.5">{paymentMethods.totalRevenuePKR.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 font-semibold uppercase">Total Volume Count</span>
                    <div className="text-2xl font-black text-slate-900 mt-0.5">{paymentMethods.totalTransactions} Invoices</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
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
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Cash Sales</div>
                    <div className="text-2xl font-black text-teal-600 mt-1">{cashSalesReport.totalCashSalesPKR.toLocaleString()}</div>
                  </div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Cash Invoices</div>
                    <div className="text-2xl font-black text-slate-900 mt-1">{cashSalesReport.orderCount}</div>
                  </div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Average Cash Invoice</div>
                    <div className="text-2xl font-black text-amber-600 mt-1">
                      {cashSalesReport.orderCount > 0 ? Math.round(cashSalesReport.totalCashSalesPKR / cashSalesReport.orderCount).toLocaleString() : 0}
                    </div>
                  </div>
                </div>

                {/* Cash Orders Table */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-teal-500" />
                      Cash Payment Invoices — {cashSalesReport.date}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                          <th className="p-3">Invoice #</th>
                          <th className="p-3">Table</th>
                          <th className="p-3">Cashier</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3 text-right">Paid</th>
                          <th className="p-3 text-right">Change</th>
                          <th className="p-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cashSalesReport.orders.map((o: any) => (
                          <tr key={o.id} className="hover:bg-slate-50 transition">
                            <td className="p-3 font-mono font-bold text-slate-900">{o.orderNumber}</td>
                            <td className="p-3 text-slate-700">{o.tableNumber || '—'}</td>
                            <td className="p-3 text-slate-700">{o.cashierName}</td>
                            <td className="p-3 text-right font-mono font-bold text-teal-600">{o.totalPKR.toLocaleString()}</td>
                            <td className="p-3 text-right font-mono text-slate-700">{o.amountPaidPKR.toLocaleString()}</td>
                            <td className="p-3 text-right font-mono text-amber-600">{o.changeDuePKR.toLocaleString()}</td>
                            <td className="p-3 text-slate-500">{new Date(o.createdAt).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                <Banknote className="w-12 h-12 mx-auto mb-3 text-slate-300" />
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
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Card / Digital Sales</div>
                    <div className="text-2xl font-black text-blue-600 mt-1">{cardSalesReport.totalCardSalesPKR.toLocaleString()}</div>
                  </div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Digital Invoices</div>
                    <div className="text-2xl font-black text-slate-900 mt-1">{cardSalesReport.orderCount}</div>
                  </div>
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Average Digital Invoice</div>
                    <div className="text-2xl font-black text-amber-600 mt-1">
                      {cardSalesReport.orderCount > 0 ? Math.round(cardSalesReport.totalCardSalesPKR / cardSalesReport.orderCount).toLocaleString() : 0}
                    </div>
                  </div>
                </div>

                {/* Breakdown by Payment Method */}
                {cardSalesReport.byMethod.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cardSalesReport.byMethod.map((m: any) => (
                      <div key={m.method} className="p-4 rounded-xl bg-white border border-slate-200">
                        <div className="text-[10px] text-slate-500 uppercase font-semibold">{m.method}</div>
                        <div className="text-sm font-black text-blue-600 mt-0.5">{m.total.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-500">{m.count} invoices</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Card Orders Table */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-500" />
                      Card / Digital Invoices — {cardSalesReport.date}
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                          <th className="p-3">Invoice #</th>
                          <th className="p-3">Method</th>
                          <th className="p-3">Table</th>
                          <th className="p-3">Cashier</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cardSalesReport.orders.map((o: any) => (
                          <tr key={o.id} className="hover:bg-slate-50 transition">
                            <td className="p-3 font-mono font-bold text-slate-900">{o.orderNumber}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold border border-blue-200">
                                {o.paymentMethod}
                              </span>
                            </td>
                            <td className="p-3 text-slate-700">{o.tableNumber || '—'}</td>
                            <td className="p-3 text-slate-700">{o.cashierName}</td>
                            <td className="p-3 text-right font-mono font-bold text-blue-600">{o.totalPKR.toLocaleString()}</td>
                            <td className="p-3 text-slate-500">{new Date(o.createdAt).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                <CreditCard className="w-12 h-12 mx-auto mb-3 text-slate-300" />
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
                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Chain Total Revenue</div>
                    <div>
                      <div className="text-xl font-black text-teal-600 leading-tight">{consolidated.chainGrossSalesPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Across {consolidated.branches.length} branches</div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Consolidated Tax Liability</div>
                    <div>
                      <div className="text-xl font-black text-amber-600 leading-tight">{consolidated.chainTaxCollectedPKR.toLocaleString()}</div>
                       <div className="text-[10px] text-slate-500 mt-0.5">Tax Remittance</div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Estimated Food Cost</div>
                    <div>
                      <div className="text-xl font-black text-rose-600 leading-tight">{consolidated.chainCostPKR.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Recipe ingredient cost</div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 p-4 rounded-xl h-[115px] flex flex-col justify-between">
                    <div className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Chain Operating Margin</div>
                    <div>
                      <div className="text-xl font-black text-blue-600 leading-tight">{consolidated.chainProfitMargin}%</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Net: {consolidated.chainNetProfitPKR.toLocaleString()}</div>
                    </div>
                  </div>
                </div>

                {/* Multi-Branch Comparison Table */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
                  <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">Cross-City Outlet Revenue Benchmarking</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Financial comparison of all outlets connected to Head Office</p>
                    </div>
                    <span className="text-xs font-mono text-teal-600 font-bold">Currency: PKR</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                          <th className="py-3 px-4">Branch Outlet</th>
                          <th className="py-3 px-4">City</th>
                          <th className="py-3 px-4 text-center">Orders</th>
                          <th className="py-3 px-4 text-right">Gross Sales (PKR)</th>
                          <th className="py-3 px-4 text-right">Cash / Card Split</th>
                          <th className="py-3 px-4 text-right">Tax (PKR)</th>
                          <th className="py-3 px-4 text-right">Estimated Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {consolidated.branches.map(b => (
                          <tr key={b.branchId} className="hover:bg-slate-50 transition">
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-purple-500" />
                                <span>{b.branchName}</span>
                                {b.isHeadOffice && (
                                  <span className="px-1.5 py-0.2 rounded bg-purple-50 text-purple-600 text-[9px] font-bold border border-purple-200">HQ</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-700">{b.city}</td>
                            <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">{b.orderCount}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-black text-teal-600">{b.grossSalesPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-500">
                              <span className="text-teal-600">{b.cashSalesPKR.toLocaleString()}</span> / <span className="text-sky-600">{b.cardSalesPKR.toLocaleString()}</span>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono text-amber-600">{b.taxCollectedPKR.toLocaleString()}</td>
                            <td className="py-3.5 px-4 text-right font-mono font-black text-blue-600">{b.profitMarginPercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                No consolidated records available.
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* THERMAL 80MM Z-REPORT PREVIEW MODAL                                       */}
        {/* ========================================================================= */}
        {isZReportPrintOpen && zReport && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Printer className="w-4 h-4 text-teal-500" />
                  <span>80mm Thermal Z-Report Preview</span>
                </div>
                <button onClick={() => setIsZReportPrintOpen(false)} className="p-1 text-slate-400 hover:text-slate-900">
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
                    <span>Total Tax:</span>
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

              <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                <button
                  onClick={() => setIsZReportPrintOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-black flex items-center gap-1.5 shadow-md"
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
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-500" />
                  Cash Tally — End of Day
                </h3>
                <button onClick={() => setIsCashTallyOpen(false)} className="text-slate-400 hover:text-slate-900 text-sm cursor-pointer">✕</button>
              </div>

              {cashTallyLoading ? (
                <div className="text-center py-8 text-slate-500 text-xs">Loading cash tally...</div>
              ) : cashTally ? (
                <>
                  {/* Cash Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] text-slate-500 uppercase">Opening Float</div>
                      <div className="text-sm font-black text-slate-900 font-mono">{cashTally.openingFloat.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] text-slate-500 uppercase">Cash Sales</div>
                      <div className="text-sm font-black text-teal-600 font-mono">{cashTally.cashSales.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] text-slate-500 uppercase">Cash Received</div>
                      <div className="text-sm font-black text-blue-600 font-mono">{cashTally.cashReceived.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-[10px] text-slate-500 uppercase">Cash Paid Out</div>
                      <div className="text-sm font-black text-rose-600 font-mono">{cashTally.cashPaidOut.toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Expected Cash */}
                  <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between">
                    <span className="text-xs text-teal-700 font-bold">Expected Cash in Drawer:</span>
                    <span className="text-lg font-black text-teal-600 font-mono">{cashTally.expectedCash.toLocaleString()}</span>
                  </div>

                  {/* Formula Explanation */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-500 space-y-1">
                    <div className="font-bold text-slate-700">Formula:</div>
                    <div className="font-mono">
                      Opening Float ({cashTally.openingFloat.toLocaleString()}) + Cash Sales ({cashTally.cashSales.toLocaleString()}) + Cash Received ({cashTally.cashReceived.toLocaleString()}) - Cash Paid Out ({cashTally.cashPaidOut.toLocaleString()}) = <span className="text-teal-600 font-bold">{cashTally.expectedCash.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Cash Entries List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900">Cash Entries Today</h4>
                      <button
                        onClick={() => setShowAddEntry(!showAddEntry)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold transition"
                      >
                        + Add Entry
                      </button>
                    </div>

                    {/* Add Entry Form */}
                    {showAddEntry && (
                      <div className="p-3 rounded-xl bg-slate-50 border border-amber-200 space-y-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEntryType('PaidOut')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${
                              entryType === 'PaidOut' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            Cash Paid Out
                          </button>
                          <button
                            onClick={() => setEntryType('Received')}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${
                              entryType === 'Received' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            Cash Received
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="Amount (PKR)"
                            value={entryAmount}
                            onChange={(e) => setEntryAmount(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="Description"
                            value={entryDesc}
                            onChange={(e) => setEntryDesc(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Vendor / Person name (optional)"
                            value={entryRecipient}
                            onChange={(e) => setEntryRecipient(e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                          />
                          <button
                            onClick={handleAddCashEntry}
                            disabled={!entryAmount || !entryDesc}
                            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold transition"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Entries List */}
                    {cashTally.entries.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 text-[10px]">
                        No cash entries today. Use "Add Entry" to record cash paid out or received.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {cashTally.entries.map((e: any) => (
                          <div key={e.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                e.entryType === 'PaidOut' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-blue-50 text-blue-600 border border-blue-200'
                              }`}>
                                {e.entryType === 'PaidOut' ? 'PAID OUT' : 'RECEIVED'}
                              </span>
                              <div>
                                <div className="text-[10px] font-bold text-slate-900">{e.description}</div>
                                <div className="text-[9px] text-slate-500">
                                  {e.recipientOrSource && `${e.recipientOrSource} • `}{new Date(e.createdAt).toLocaleTimeString()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono font-bold ${e.entryType === 'PaidOut' ? 'text-rose-600' : 'text-blue-600'}`}>
                                {e.entryType === 'PaidOut' ? '-' : '+'}{e.amountPKR.toLocaleString()}
                              </span>
                              <button
                                onClick={() => handleDeleteCashEntry(e.id)}
                                className="text-slate-400 hover:text-rose-500 transition"
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
                <div className="text-center py-8 text-slate-500 text-xs">
                  No active cash shift found. Open a shift first.
                </div>
              )}

              <div className="pt-3 border-t border-slate-200">
                <button
                  onClick={() => setIsCashTallyOpen(false)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
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

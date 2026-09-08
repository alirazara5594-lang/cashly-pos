import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Printer, 
  Banknote, 
  CreditCard, 
  PieChart, 
  Award, 
  RefreshCw,
  Building2
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { ZReportSummary, CategorySalesReport, ItemPerformanceReport } from '../types';

export const ReportsManagement: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<'zreport' | 'categories' | 'products'>(
    location.state?.tab || 'zreport'
  );

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedDaysRange, setSelectedDaysRange] = useState<number>(7);
  const [loading, setLoading] = useState(false);

  const [zReport, setZReport] = useState<ZReportSummary | null>(null);
  const [categorySales, setCategorySales] = useState<CategorySalesReport[]>([]);
  const [productPerformance, setProductPerformance] = useState<ItemPerformanceReport[]>([]);

  const loadReportData = async () => {
    if (!selectedBranch?.id) return;
    setLoading(true);
    try {
      if (activeTab === 'zreport') {
        const data = await posApi.getZReport(selectedBranch.id, selectedDate);
        setZReport(data);
      } else if (activeTab === 'categories') {
        const data = await posApi.getCategorySalesReport(selectedBranch.id, selectedDaysRange);
        setCategorySales(data);
      } else if (activeTab === 'products') {
        const data = await posApi.getItemPerformanceReport(selectedBranch.id, selectedDaysRange);
        setProductPerformance(data);
      }
    } catch (err) {
      console.error('Failed to load reports', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReportData();
  }, [selectedBranch?.id, activeTab, selectedDate, selectedDaysRange]);

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Strip */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-black text-white tracking-tight">Financial & Sales Audit Reports</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-500" />
              Auditing Branch: <span className="text-emerald-400 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
            </p>
          </div>

          {/* Report Sub-tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('zreport')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'zreport'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              <span>Z-Report (Day Close)</span>
            </button>

            <button
              onClick={() => setActiveTab('categories')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'products'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Item Profitability</span>
            </button>
          </div>
        </div>

        {/* Date / Period Controls */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            {activeTab === 'zreport' ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">Select Closing Date:</span>
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
                        ? 'bg-purple-600 text-white shadow-md'
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
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Audit</span>
            </button>
            <button
              onClick={loadReportData}
              disabled={loading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* TAB 1: Z-Report (Daily Register Close) */}
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
                      <div className="text-[10px] text-slate-500 mt-0.5">{zReport.totalOrders} paid orders settled</div>
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
                      <div className="text-[10px] text-amber-500/80 mt-0.5">Cash (16%) &amp; Card (8%) Split</div>
                    </div>
                  </div>
                </div>

                {/* Tax Audit Breakdown: 16% Cash vs 8% Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="font-bold text-white text-sm mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Differentiated Tax Audit Breakdown (Pakistani Revenue Authority Compliance)
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Cash Tax 16% */}
                    <div className="p-4 rounded-xl bg-slate-950 border border-emerald-900/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                          <Banknote className="w-4 h-4" />
                          Cash Sales (Standard 16% Tax)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 text-[10px] font-bold">16% Rate</span>
                      </div>
                      <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                        <span className="text-slate-400">Total Cash Volume:</span>
                        <span className="font-mono font-bold text-white">₨{zReport.cashSalesPKR.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs py-1 pt-2">
                        <span className="text-emerald-400 font-semibold">16% Tax Revenue:</span>
                        <span className="font-mono font-bold text-emerald-400">₨{zReport.cashTaxPKR.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Card Tax 8% */}
                    <div className="p-4 rounded-xl bg-slate-950 border border-sky-900/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5">
                          <CreditCard className="w-4 h-4" />
                          Card / POS Machine (Reduced 8% Tax)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-sky-900/60 text-sky-300 text-[10px] font-bold">8% Incentive</span>
                      </div>
                      <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                        <span className="text-slate-400">Total Card Volume:</span>
                        <span className="font-mono font-bold text-white">₨{zReport.cardSalesPKR.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs py-1 pt-2">
                        <span className="text-sky-400 font-semibold">8% Tax Revenue:</span>
                        <span className="font-mono font-bold text-sky-400">₨{zReport.cardTaxPKR.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sales Channels Split */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="font-bold text-white text-sm mb-4">Sales By Order Type</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-400 font-semibold">Dine-In Hall</div>
                      <div className="text-lg font-bold text-white mt-1">₨{zReport.dineInSalesPKR.toLocaleString()}</div>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-400 font-semibold">Takeaway / Counter</div>
                      <div className="text-lg font-bold text-white mt-1">₨{zReport.takeawaySalesPKR.toLocaleString()}</div>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs text-slate-400 font-semibold">Home Delivery & Phone Orders</div>
                      <div className="text-lg font-bold text-white mt-1">₨{zReport.deliverySalesPKR.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-slate-900 rounded-2xl border border-slate-800">
                No closed register shifts or orders found for {selectedDate}.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Categories Sales */}
        {activeTab === 'categories' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">Category Turnover (Past {selectedDaysRange} Days)</h3>
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
                      <td colSpan={6} className="py-10 text-center text-slate-500">No category sales records found.</td>
                    </tr>
                  ) : (
                    categorySales.map(c => (
                      <tr key={c.categoryId} className="hover:bg-slate-850/50 transition">
                        <td className="py-3.5 px-4 font-bold text-white">{c.categoryName}</td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-300 font-semibold">{c.quantitySold}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-slate-400">₨{c.netSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-amber-400">₨{c.taxPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-bold">₨{c.grossSalesPKR.toLocaleString()}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-purple-400">{c.percentageOfTotal}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Item Performance & Profit Margins */}
        {activeTab === 'products' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">Product Profitability Ranking (Past {selectedDaysRange} Days)</h3>
              <span className="text-xs text-slate-400 font-mono">Sorted by total revenue</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Product Name & Category</th>
                    <th className="py-3 px-4 text-center">Units Sold</th>
                    <th className="py-3 px-4 text-right">Revenue (₨)</th>
                    <th className="py-3 px-4 text-right">Estimated Cost (₨)</th>
                    <th className="py-3 px-4 text-right">Gross Profit (₨)</th>
                    <th className="py-3 px-4 text-center">Gross Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {productPerformance.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">No product sales records found.</td>
                    </tr>
                  ) : (
                    productPerformance.map((p, idx) => (
                      <tr key={p.productId} className="hover:bg-slate-850/50 transition">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-500 w-4">#{idx + 1}</span>
                            <div>
                              <div className="font-bold text-white">{p.productName}</div>
                              <div className="text-[11px] text-slate-400">{p.categoryName}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono text-slate-300 font-bold">{p.quantitySold}</td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

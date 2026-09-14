import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingBag,
  DollarSign,
  Clock,
  BarChart3,
  Trophy,
  Medal,
  Award,
  RefreshCw,
  Zap,
  Target
} from 'lucide-react';
import { posApi } from '../services/api';

interface SmartAnalyticsData {
  summary: {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    busiestHour: string;
  };
  revenueTrend: { date: string; revenue: number; orders: number }[];
  bestSellers: { name: string; quantity: number; revenue: number }[];
  peakHours: { hour: number; count: number }[];
  predictions: {
    avgDailySales: number;
    predictedNext3Days: number[];
    trend: 'growing' | 'stable' | 'declining';
  };
}

export const SmartAnalytics: React.FC = () => {
  const [data, setData] = useState<SmartAnalyticsData | null>(null);
  const [days, setDays] = useState(7);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await posApi.getSmartAnalytics(days);
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxRevenue = data
    ? Math.max(...data.revenueTrend.map((d) => d.revenue), 1)
    : 1;
  const maxPeakHour = data
    ? Math.max(...data.peakHours.map((h) => h.count), 1)
    : 1;

  const trendIcon =
    data?.predictions?.trend === 'growing'
      ? TrendingUp
      : data?.predictions?.trend === 'declining'
      ? TrendingDown
      : Minus;
  const trendColor =
    data?.predictions?.trend === 'growing'
      ? 'text-teal-600'
      : data?.predictions?.trend === 'declining'
      ? 'text-rose-600'
      : 'text-slate-500';
  const trendLabel =
    data?.predictions?.trend === 'growing'
      ? 'Growing'
      : data?.predictions?.trend === 'declining'
      ? 'Declining'
      : 'Stable';

  const medalIcons = [Trophy, Medal, Award];
  const medalColors = [
    'text-amber-600 bg-amber-50 border-amber-200',
    'text-slate-600 bg-slate-100 border-slate-300',
    'text-amber-700 bg-amber-50 border-amber-200',
  ];

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-teal-500" />
            <h1 className="text-xl md:text-2xl font-black text-gradient tracking-tight">
              Smart Analytics
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 font-bold uppercase">
              AI Powered
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Predictive analytics, peak hours heatmap, and smart business insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-white border border-slate-200 rounded-xl">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  days === d
                    ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                    : 'text-slate-600 hover:bg-teal-50'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card-hover rounded-2xl p-4 border border-slate-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-200">
                  <DollarSign className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Total Revenue
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    Rs {data.summary.totalRevenue.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            <div className="card-hover rounded-2xl p-4 border border-slate-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-200">
                  <ShoppingBag className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Total Orders
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    {data.summary.totalOrders.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            <div className="card-hover rounded-2xl p-4 border border-slate-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-200">
                  <Target className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Avg Order Value
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    Rs {data.summary.avgOrderValue.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
            <div className="card-hover rounded-2xl p-4 border border-slate-200 bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-200">
                  <Clock className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Busiest Hour
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    {data.summary.busiestHour || 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl p-5 border border-slate-200 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-teal-500" />
                <h2 className="text-sm font-bold text-slate-900">Revenue Trend</h2>
                <span className="text-[10px] text-slate-500 ml-auto">Last {days} days</span>
              </div>
              <div className="flex items-end gap-2 h-48">
                {data.revenueTrend.map((d, i) => {
                  const height = maxRevenue > 0 ? (d.revenue / maxRevenue) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] font-semibold text-slate-500">
                        {d.revenue > 0 ? `Rs ${(d.revenue / 1000).toFixed(1)}k` : '-'}
                      </span>
                      <div className="w-full flex justify-center">
                        <div
                          className="w-full max-w-[32px] rounded-t-lg bg-gradient-to-t from-teal-600 to-teal-400 transition-all duration-500"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400">
                        {new Date(d.date).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  );
                })}
                {data.revenueTrend.length === 0 && (
                  <div className="flex-1 flex items-center justify-center h-full text-slate-500 text-xs">
                    No revenue data
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl p-5 border border-slate-200 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-teal-500" />
                <h2 className="text-sm font-bold text-slate-900">Predictions</h2>
              </div>
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Avg Daily Sales
                  </div>
                  <div className="text-xl font-black text-slate-900 mt-1">
                    Rs {data.predictions.avgDailySales.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Predicted Next 3 Days
                  </div>
                  <div className="flex gap-2 mt-2">
                    {data.predictions.predictedNext3Days.map((val, i) => (
                      <div
                        key={i}
                        className="flex-1 text-center p-2 rounded-lg bg-teal-50 border border-teal-200"
                      >
                        <div className="text-[9px] text-teal-600 font-bold">Day {i + 1}</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          Rs {(val / 1000).toFixed(1)}k
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  {React.createElement(trendIcon, { className: `w-4 h-4 ${trendColor}` })}
                  <span className={`text-sm font-bold ${trendColor}`}>{trendLabel}</span>
                  <span className="text-[10px] text-slate-500 ml-auto">Trend</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl p-5 border border-slate-200 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-teal-500" />
                <h2 className="text-sm font-bold text-slate-900">Best Sellers</h2>
                <span className="text-[10px] text-slate-500 ml-auto">Top 10</span>
              </div>
              <div className="overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-slate-500">
                        #
                      </th>
                      <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-slate-500">
                        Product
                      </th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold uppercase text-slate-500">
                        Qty
                      </th>
                      <th className="text-right py-2 px-2 text-[10px] font-bold uppercase text-slate-500">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bestSellers.slice(0, 10).map((item, i) => {
                      const MedalIcon = medalIcons[i] || null;
                      const mColor = medalColors[i] || '';
                      return (
                        <tr
                          key={i}
                          className="table-row-hover border-b border-slate-100"
                        >
                          <td className="py-2 px-2">
                            {MedalIcon ? (
                              <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${mColor}`}>
                                <MedalIcon className="w-3 h-3" />
                              </div>
                            ) : (
                              <span className="text-slate-400 font-bold">{i + 1}</span>
                            )}
                          </td>
                          <td className="py-2 px-2 font-semibold text-slate-900 truncate max-w-[160px]">
                            {item.name}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-700 font-medium">
                            {item.quantity}
                          </td>
                          <td className="py-2 px-2 text-right text-teal-600 font-bold">
                            Rs {item.revenue.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                    {data.bestSellers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500 text-xs">
                          No sales data yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl p-5 border border-slate-200 bg-white">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-teal-500" />
                <h2 className="text-sm font-bold text-slate-900">Peak Hours Heatmap</h2>
                <span className="text-[10px] text-slate-500 ml-auto">24h Order Volume</span>
              </div>
              <div className="grid grid-cols-12 gap-1.5">
                {Array.from({ length: 24 }, (_, i) => {
                  const entry = data.peakHours.find((h) => h.hour === i);
                  const count = entry?.count || 0;
                  const intensity = maxPeakHour > 0 ? count / maxPeakHour : 0;
                  return (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-1"
                      title={`${i}:00 — ${count} orders`}
                    >
                      <div
                        className="w-full aspect-square rounded-lg transition-all duration-300 flex items-center justify-center text-[8px] font-bold"
                        style={{
                          backgroundColor:
                            intensity > 0.7
                              ? 'rgb(20 184 166 / 0.9)'
                              : intensity > 0.4
                              ? 'rgb(20 184 166 / 0.5)'
                              : intensity > 0.1
                              ? 'rgb(20 184 166 / 0.25)'
                              : 'rgb(226 232 240 / 0.5)',
                          color: intensity > 0.4 ? 'white' : intensity > 0 ? 'rgb(100 116 139)' : 'rgb(148 163 184)',
                        }}
                      >
                        {count > 0 ? count : ''}
                      </div>
                      <span className="text-[7px] text-slate-400 font-medium">
                        {i % 3 === 0 ? `${i}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-center gap-3 mt-4">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-slate-200" />
                  <span className="text-[9px] text-slate-500">None</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-teal-200" />
                  <span className="text-[9px] text-slate-500">Low</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-teal-400" />
                  <span className="text-[9px] text-slate-500">Med</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-teal-600" />
                  <span className="text-[9px] text-slate-500">High</span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Brain className="w-12 h-12 mb-3 opacity-30" />
          <span className="text-sm font-medium">No analytics data available</span>
          <span className="text-xs mt-1">Generate some sales first</span>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { 
  Boxes, 
  Search, 
  AlertTriangle, 
  SlidersHorizontal, 
  ArrowDownToLine, 
  RefreshCw, 
  Calendar, 
  CheckCircle2, 
  Building2
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { BranchStockItem } from '../types';

export const InventoryManagement: React.FC = () => {
  const { selectedBranch } = usePosStore();

  const [stocks, setStocks] = useState<BranchStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Modals
  const [stockInItem, setStockInItem] = useState<BranchStockItem | null>(null);
  const [stockInQty, setStockInQty] = useState<number>(10);
  const [supplierName, setSupplierName] = useState('');
  const [newCostPrice, setNewCostPrice] = useState<number>(0);
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [adjustItem, setAdjustItem] = useState<BranchStockItem | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(-1);
  const [adjustReason, setAdjustReason] = useState('Wastage / Kitchen Prep Loss');

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchInventory = async () => {
    if (!selectedBranch?.id) return;
    try {
      setLoading(true);
      const data = await posApi.getInventory(selectedBranch.id);
      setStocks(data);
    } catch (err) {
      console.error('Failed to load inventory', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [selectedBranch?.id]);

  const handleStockInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockInItem || !selectedBranch?.id || stockInQty <= 0) return;
    setIsSubmitting(true);
    try {
      await posApi.addStockIn({
        branchId: selectedBranch.id,
        productId: stockInItem.productId,
        quantity: stockInQty,
        supplierName: supplierName || undefined,
        costPricePKR: newCostPrice > 0 ? newCostPrice : undefined,
        batchNumber: batchNo || undefined,
        expiryDate: expiryDate ? new Date(expiryDate).toISOString() : undefined
      });
      setActionSuccess(`Added +${stockInQty} ${stockInItem.unit} to ${stockInItem.productName}`);
      setStockInItem(null);
      await fetchInventory();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      console.error(err);
      alert('Failed to update stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem || !selectedBranch?.id) return;
    setIsSubmitting(true);
    try {
      await posApi.adjustStock({
        branchId: selectedBranch.id,
        productId: adjustItem.productId,
        adjustmentQty: adjustQty,
        reason: adjustReason
      });
      setActionSuccess(`Adjusted ${adjustItem.productName} by ${adjustQty > 0 ? '+' + adjustQty : adjustQty}`);
      setAdjustItem(null);
      await fetchInventory();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      console.error(err);
      alert('Failed to adjust stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = Array.from(new Set(stocks.map(s => s.categoryName)));

  const filteredStocks = stocks.filter(s => {
    const matchesSearch = s.productName.toLowerCase().includes(search.toLowerCase()) ||
                          s.barcode.toLowerCase().includes(search.toLowerCase()) ||
                          s.sku.toLowerCase().includes(search.toLowerCase());
    const matchesLowStock = !filterLowStockOnly || s.isLowStock;
    const matchesCategory = selectedCategory === 'all' || s.categoryName === selectedCategory;
    return matchesSearch && matchesLowStock && matchesCategory;
  });

  const lowStockCount = stocks.filter(s => s.isLowStock).length;
  const totalItemsCount = stocks.length;
  const totalStockValuationPKR = stocks.reduce((sum, s) => sum + (s.quantityOnHand * s.costPricePKR), 0);

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <Boxes className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-black text-white tracking-tight">Branch Stock & Inventory</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-500" />
              Active Branch: <span className="text-emerald-400 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
            </p>
          </div>

          {/* Quick Stats Pills */}
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-right">
              <div className="text-[10px] text-slate-400 font-medium">SKUs Tracked</div>
              <div className="text-sm font-bold text-white">{totalItemsCount} Products</div>
            </div>
            <div className="px-3.5 py-2 bg-rose-950/40 border border-rose-800/60 rounded-xl text-right">
              <div className="text-[10px] text-rose-300 font-medium">Low Stock Alerts</div>
              <div className="text-sm font-black text-rose-400">{lowStockCount} Items</div>
            </div>
            <div className="px-3.5 py-2 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-right">
              <div className="text-[10px] text-emerald-300 font-medium">Inventory Value</div>
              <div className="text-sm font-black text-emerald-400">₨{Math.round(totalStockValuationPKR).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Success Alert Banner */}
        {actionSuccess && (
          <div className="bg-emerald-950/80 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-xl flex items-center gap-2 text-xs font-semibold animate-pulse shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 shadow-md">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search product, barcode, SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-slate-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Categories ({categories.length})</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {/* Low Stock Toggle */}
            <button
              onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
                filterLowStockOnly 
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30' 
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Low Stock Only ({lowStockCount})</span>
            </button>

            {/* Refresh Button */}
            <button
              onClick={fetchInventory}
              disabled={loading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              title="Refresh inventory data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Stock Inventory Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Item & Category</th>
                  <th className="py-3 px-3">Barcode / SKU</th>
                  <th className="py-3 px-3 text-right">Cost Price (₨)</th>
                  <th className="py-3 px-3 text-right">Selling Price (₨)</th>
                  <th className="py-3 px-3 text-center">Stock on Hand</th>
                  <th className="py-3 px-3">Batch & Expiry</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredStocks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 font-medium">
                      No stock records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredStocks.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-850/50 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-white text-sm">{item.productName}</div>
                        <div className="text-[11px] text-slate-400">{item.categoryName}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-300">
                        <div>{item.barcode || '—'}</div>
                        <div className="text-[10px] text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">
                        ₨{item.costPricePKR.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400 font-bold">
                        ₨{item.sellingPricePKR.toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-center font-bold">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-black font-mono ${
                          item.isLowStock
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-700'
                            : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800'
                        }`}>
                          {item.quantityOnHand} {item.unit}
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5">Min: {item.minAlertLevel}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {item.batchNumber ? (
                          <div className="font-mono text-[11px] text-purple-300 font-semibold">{item.batchNumber}</div>
                        ) : (
                          <span className="text-[10px] text-slate-600">No Batch</span>
                        )}
                        {item.expiryDate && (
                          <div className="text-[10px] text-amber-400 flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5" />
                            <span>Exp: {item.expiryDate}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.isLowStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-900/60 border border-rose-700 text-rose-300 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>LOW STOCK</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 text-[10px] font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>In Stock</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Stock-In button */}
                          <button
                            onClick={() => {
                              setStockInItem(item);
                              setStockInQty(10);
                              setSupplierName('');
                              setNewCostPrice(item.costPricePKR);
                              setBatchNo(item.batchNumber || '');
                              setExpiryDate(item.expiryDate || '');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 text-[11px] font-bold transition"
                            title="Add stock inward (GRN / Supplier purchase)"
                          >
                            <ArrowDownToLine className="w-3 h-3" />
                            <span>Stock In</span>
                          </button>

                          {/* Adjust / Spoilage button */}
                          <button
                            onClick={() => {
                              setAdjustItem(item);
                              setAdjustQty(-1);
                              setAdjustReason('Wastage / Kitchen Prep Loss');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium transition"
                            title="Adjust quantity or record wastage"
                          >
                            <SlidersHorizontal className="w-3 h-3 text-slate-400" />
                            <span>Adjust</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stock-In / Supplier GRN Modal */}
      {stockInItem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">Receive Stock (Stock-In)</h3>
              </div>
              <button onClick={() => setStockInItem(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="font-bold text-emerald-400 text-sm">{stockInItem.productName}</div>
              <div className="text-xs text-slate-400 mt-0.5">Current Stock: <span className="font-bold text-white">{stockInItem.quantityOnHand} {stockInItem.unit}</span></div>
            </div>

            <form onSubmit={handleStockInSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Quantity to Inward ({stockInItem.unit}) *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={stockInQty}
                  onChange={(e) => setStockInQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Supplier Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Metro / Local Vendor"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Unit Cost Price (₨)</label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={newCostPrice}
                    onChange={(e) => setNewCostPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Batch Number</label>
                  <input
                    type="text"
                    placeholder="e.g. B-9901"
                    value={batchNo}
                    onChange={(e) => setBatchNo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStockInItem(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'Receiving...' : 'Confirm Stock-In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment / Spoilage Modal */}
      {adjustItem && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Adjust Stock Level</h3>
              </div>
              <button onClick={() => setAdjustItem(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="font-bold text-amber-400 text-sm">{adjustItem.productName}</div>
              <div className="text-xs text-slate-400 mt-0.5">Current Stock: <span className="font-bold text-white">{adjustItem.quantityOnHand} {adjustItem.unit}</span></div>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Adjustment Quantity (use - for loss/waste) *</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                />
                <div className="text-[11px] text-slate-400 mt-1">
                  Resulting Stock: <span className="font-bold text-white">{Math.max(0, adjustItem.quantityOnHand + adjustQty)} {adjustItem.unit}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Reason for Adjustment</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="Wastage / Kitchen Prep Loss">Wastage / Kitchen Prep Loss</option>
                  <option value="Damage / Spoilage">Damage / Spoilage</option>
                  <option value="Expired Product">Expired Product</option>
                  <option value="Audit Count Correction">Physical Audit Count Correction</option>
                  <option value="Supplier Return">Supplier Return</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustItem(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-500 transition shadow-lg shadow-amber-600/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Save Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

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
  Building2,
  Wheat,
  Plus,
  Truck
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { BranchStockItem, RawIngredient } from '../types';

export const InventoryManagement: React.FC = () => {
  const { selectedBranch, selectedTenant } = usePosStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;

  const [activeTab, setActiveTab] = useState<'ingredients' | 'finished'>(
    location.state?.tab || 'ingredients'
  );

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  // Finished Product Stocks
  const [stocks, setStocks] = useState<BranchStockItem[]>([]);
  // Raw Ingredients (Buns, Patties, Sauces, Cheese, Fries, etc.)
  const [ingredients, setIngredients] = useState<RawIngredient[]>([]);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Stock In Modals
  const [stockInItem, setStockInItem] = useState<BranchStockItem | null>(null);
  const [stockInQty, setStockInQty] = useState<number>(10);
  const [supplierName, setSupplierName] = useState('');
  const [newCostPrice, setNewCostPrice] = useState<number>(0);
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  // Raw Ingredient Inward Modal
  const [restockIng, setRestockIng] = useState<RawIngredient | null>(null);
  const [restockQty, setRestockQty] = useState<number>(50);
  const [restockUnitCost, setRestockUnitCost] = useState<number>(0);
  const [restockSupplier, setRestockSupplier] = useState('');

  // Add New Ingredient Modal
  const [isNewIngOpen, setIsNewIngOpen] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngCategory, setNewIngCategory] = useState('Meat & Patties');
  const [newIngUnit, setNewIngUnit] = useState('Piece');
  const [newIngCost, setNewIngCost] = useState<number>(100);
  const [newIngStock, setNewIngStock] = useState<number>(200);
  const [newIngMinAlert, setNewIngMinAlert] = useState<number>(30);
  const [newIngSupplier, setNewIngSupplier] = useState('');

  // Adjustment Modal
  const [adjustItem, setAdjustItem] = useState<BranchStockItem | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(-1);
  const [adjustReason, setAdjustReason] = useState('Wastage / Kitchen Prep Loss');

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchInventory = async () => {
    if (!selectedBranch?.id) return;
    try {
      setLoading(true);
      const [stockData, ingsData] = await Promise.all([
        posApi.getInventory(selectedBranch.id),
        posApi.getRawIngredients(selectedBranch.id)
      ]);
      setStocks(stockData);
      setIngredients(ingsData);
    } catch (err) {
      console.error('Failed to load inventory', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [selectedBranch?.id]);

  // Handle Finished Product Stock-In
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

  // Handle Raw Ingredient Restock (Buns, Patties, Cheese, etc.)
  const handleRestockIngSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockIng || !selectedBranch?.id || restockQty <= 0) return;
    setIsSubmitting(true);
    try {
      await posApi.restockIngredient({
        branchId: selectedBranch.id,
        ingredientId: restockIng.id,
        quantityReceived: restockQty,
        newCostPerUnitPKR: restockUnitCost > 0 ? restockUnitCost : undefined,
        supplierName: restockSupplier || undefined
      });
      setActionSuccess(`Received +${restockQty} ${restockIng.unit} of ${restockIng.name} into kitchen inventory`);
      setRestockIng(null);
      await fetchInventory();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      console.error(err);
      alert('Failed to restock ingredient');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Create New Ingredient
  const handleCreateIngredientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranch?.id || !selectedTenant?.id || !newIngName.trim()) return;
    setIsSubmitting(true);
    try {
      await posApi.createIngredient({
        branchId: selectedBranch.id,
        tenantId: selectedTenant.id,
        name: newIngName.trim(),
        category: newIngCategory,
        unit: newIngUnit,
        costPerUnitPKR: newIngCost,
        initialStock: newIngStock,
        minAlertLevel: newIngMinAlert,
        supplierName: newIngSupplier || undefined
      });
      setActionSuccess(`Created new ingredient: ${newIngName.trim()}`);
      setIsNewIngOpen(false);
      setNewIngName('');
      await fetchInventory();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      console.error(err);
      alert('Failed to create ingredient');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Adjustment
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

  // Filtering for Raw Ingredients
  const ingCategories = Array.from(new Set(ingredients.map(i => i.category)));
  const filteredIngredients = ingredients.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(search.toLowerCase()) ||
                          i.category.toLowerCase().includes(search.toLowerCase()) ||
                          (i.supplierName && i.supplierName.toLowerCase().includes(search.toLowerCase()));
    const matchesLow = !filterLowStockOnly || i.isLowStock;
    const matchesCat = selectedCategory === 'all' || i.category === selectedCategory;
    return matchesSearch && matchesLow && matchesCat;
  });

  // Filtering for Finished Products
  const finishedCategories = Array.from(new Set(stocks.map(s => s.categoryName)));
  const filteredStocks = stocks.filter(s => {
    const matchesSearch = s.productName.toLowerCase().includes(search.toLowerCase()) ||
                          s.barcode.toLowerCase().includes(search.toLowerCase()) ||
                          s.sku.toLowerCase().includes(search.toLowerCase());
    const matchesLowStock = !filterLowStockOnly || s.isLowStock;
    const matchesCategory = selectedCategory === 'all' || s.categoryName === selectedCategory;
    return matchesSearch && matchesLowStock && matchesCategory;
  });

  const rawLowStockCount = ingredients.filter(i => i.isLowStock).length;
  const rawTotalValuationPKR = ingredients.reduce((sum, i) => sum + i.totalValuationPKR, 0);

  const finishedLowStockCount = stocks.filter(s => s.isLowStock).length;
  const finishedTotalValuationPKR = stocks.reduce((sum, s) => sum + (s.quantityOnHand * s.costPricePKR), 0);

  return (
    <div className="flex-1 bg-slate-950 text-slate-100 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <Boxes className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-black text-white tracking-tight">Kitchen & Store Inventory</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-500" />
              Active Branch: <span className="text-emerald-400 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
            </p>
          </div>

          {/* Quick Tabs: Raw Ingredients (BOM) vs Finished Products */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => { setActiveTab('ingredients'); setSelectedCategory('all'); }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'ingredients'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Wheat className="w-3.5 h-3.5" />
              <span>Raw Ingredients & BOM ({ingredients.length})</span>
            </button>

            <button
              onClick={() => { setActiveTab('finished'); setSelectedCategory('all'); }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'finished'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Finished Products ({stocks.length})</span>
            </button>
          </div>

          {/* Quick Stats Pills */}
          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 bg-rose-950/40 border border-rose-800/60 rounded-xl text-right">
              <div className="text-[10px] text-rose-300 font-medium">Low Stock Alerts</div>
              <div className="text-sm font-black text-rose-400">
                {activeTab === 'ingredients' ? rawLowStockCount : finishedLowStockCount} Items
              </div>
            </div>
            <div className="px-3.5 py-2 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-right">
              <div className="text-[10px] text-emerald-300 font-medium">Stock Value</div>
              <div className="text-sm font-black text-emerald-400">
                ₨{Math.round(activeTab === 'ingredients' ? rawTotalValuationPKR : finishedTotalValuationPKR).toLocaleString()}
              </div>
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
              placeholder={activeTab === 'ingredients' ? 'Search bun, patty, sauce, cheese...' : 'Search product, barcode, SKU...'}
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
              <option value="all">All Categories</option>
              {(activeTab === 'ingredients' ? ingCategories : finishedCategories).map(c => (
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
              <span>Low Stock ({activeTab === 'ingredients' ? rawLowStockCount : finishedLowStockCount})</span>
            </button>

            {/* Add New Raw Ingredient Button (when in ingredients tab) */}
            {activeTab === 'ingredients' && (
              <button
                onClick={() => setIsNewIngOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-amber-600/30"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Ingredient</span>
              </button>
            )}

            {/* Request Stock from HQ Button (for multi-branch chain branch managers) */}
            {isMultiBranchChain && (
              <button
                onClick={() => navigate('/transfers', { state: { tab: 'transfers', openRequisition: true } })}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs transition flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-emerald-600/30"
                title="Send Stock Requisition to Central Commissary"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Request Stock from HQ</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={fetchInventory}
              disabled={loading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
              title="Refresh inventory"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* TAB 1: RAW INGREDIENTS TABLE (BOM) */}
        {activeTab === 'ingredients' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Wheat className="w-4 h-4 text-amber-400" />
                  <span>Kitchen Raw Materials & Ingredient Consumption (Recipe BOM)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Every time a burger, deal, or pizza is sold at the counter, ingredients (buns, patties, sauces, cheese) deduct automatically.
                </p>
              </div>
              <span className="text-xs text-amber-400 font-mono font-bold">{filteredIngredients.length} Items</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-850 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Raw Ingredient</th>
                    <th className="py-3 px-3">Classification</th>
                    <th className="py-3 px-3 text-right">Cost Per Unit (₨)</th>
                    <th className="py-3 px-3 text-center">Stock on Hand</th>
                    <th className="py-3 px-3 text-right">Valuation (₨)</th>
                    <th className="py-3 px-3">Supplier / Vendor</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredIngredients.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500 font-medium">
                        No raw ingredients match your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredIngredients.map((ing) => (
                      <tr key={ing.id} className="hover:bg-slate-850/50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-white text-sm">{ing.name}</div>
                          <div className="text-[10px] text-slate-500">Unit: {ing.unit}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 text-[10px] font-semibold">
                            {ing.category}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          ₨{ing.costPerUnitPKR.toLocaleString()} / {ing.unit}
                        </td>
                        <td className="py-3 px-3 text-center font-bold">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-black font-mono ${
                            ing.isLowStock
                              ? 'bg-rose-950/80 text-rose-300 border border-rose-700'
                              : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800'
                          }`}>
                            {ing.currentStock} {ing.unit}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5">Min Alert: {ing.minAlertLevel}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-emerald-400 font-bold">
                          ₨{ing.totalValuationPKR.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-slate-400 font-medium">
                          {ing.supplierName || 'Local Supplier'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {ing.isLowStock ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-900/60 border border-rose-700 text-rose-300 text-[10px] font-bold">
                              <AlertTriangle className="w-3 h-3" />
                              <span>REORDER NEEDED</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 text-[10px] font-semibold">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Sufficient</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => {
                              setRestockIng(ing);
                              setRestockQty(50);
                              setRestockUnitCost(ing.costPerUnitPKR);
                              setRestockSupplier(ing.supplierName || '');
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 text-[11px] font-bold transition mx-auto"
                            title="Inward / Purchase more of this ingredient"
                          >
                            <ArrowDownToLine className="w-3 h-3" />
                            <span>Inward Stock</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: FINISHED PRODUCTS TABLE */}
        {activeTab === 'finished' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-emerald-400" />
                  <span>Finished Product Stock on Hand</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Stock levels for ready items, mart grocery items, and packaging cartons.
                </p>
              </div>
              <span className="text-xs text-emerald-400 font-mono font-bold">{filteredStocks.length} Items</span>
            </div>

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
                        No product records found matching your filters.
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
                            >
                              <ArrowDownToLine className="w-3 h-3" />
                              <span>Stock In</span>
                            </button>

                            <button
                              onClick={() => {
                                setAdjustItem(item);
                                setAdjustQty(-1);
                                setAdjustReason('Wastage / Kitchen Prep Loss');
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium transition"
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
        )}
      </div>

      {/* Raw Ingredient Inward Modal */}
      {restockIng && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Inward Raw Material Stock</h3>
              </div>
              <button onClick={() => setRestockIng(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="font-bold text-amber-400 text-sm">{restockIng.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Current Kitchen Stock: <span className="font-bold text-white">{restockIng.currentStock} {restockIng.unit}</span>
              </div>
            </div>

            <form onSubmit={handleRestockIngSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">
                  Quantity Received ({restockIng.unit}) *
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={restockQty}
                  onChange={(e) => setRestockQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Supplier Name</label>
                  <input
                    type="text"
                    value={restockSupplier}
                    onChange={(e) => setRestockSupplier(e.target.value)}
                    placeholder="e.g. Dawn Bread / K&Ns"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Cost Per {restockIng.unit} (₨)</label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={restockUnitCost}
                    onChange={(e) => setRestockUnitCost(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-emerald-400 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRestockIng(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-slate-950 text-xs font-black hover:bg-amber-500 transition shadow-lg shadow-amber-600/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'Inwarding...' : 'Confirm Inward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Ingredient Modal */}
      {isNewIngOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Add New Raw Ingredient</h3>
              </div>
              <button onClick={() => setIsNewIngOpen(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateIngredientSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Ingredient Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sesame Burger Buns / Jalapeno Slices"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Classification</label>
                  <select
                    value={newIngCategory}
                    onChange={(e) => setNewIngCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none"
                  >
                    <option value="Buns & Bakery">Buns & Bakery</option>
                    <option value="Meat & Patties">Meat & Patties</option>
                    <option value="Dairy & Cheese">Dairy & Cheese</option>
                    <option value="Sauces & Condiments">Sauces & Condiments</option>
                    <option value="Produce & Veggies">Produce & Veggies</option>
                    <option value="Sides & Appetizers">Sides & Appetizers</option>
                    <option value="Packaging">Packaging</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 font-medium mb-1">Measurement Unit</label>
                  <select
                    value={newIngUnit}
                    onChange={(e) => setNewIngUnit(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none"
                  >
                    <option value="Piece">Piece / Bun / Patty</option>
                    <option value="Slice">Slice</option>
                    <option value="Gram">Gram (g)</option>
                    <option value="Kg">Kilogram (kg)</option>
                    <option value="Litre">Litre (L)</option>
                    <option value="Can">Can / Bottle</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">Cost / Unit (₨)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newIngCost}
                    onChange={(e) => setNewIngCost(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-emerald-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">Initial Stock</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newIngStock}
                    onChange={(e) => setNewIngStock(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-medium mb-1">Alert Below</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newIngMinAlert}
                    onChange={(e) => setNewIngMinAlert(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-rose-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 font-medium mb-1">Supplier / Vendor</label>
                <input
                  type="text"
                  placeholder="e.g. Dawn Bread / K&Ns / Local Mandi"
                  value={newIngSupplier}
                  onChange={(e) => setNewIngSupplier(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewIngOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-slate-950 text-xs font-black hover:bg-amber-500 transition shadow-lg shadow-amber-600/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Ingredient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finished Product Stock-In Modal */}
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

      {/* Finished Product Stock Adjustment Modal */}
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

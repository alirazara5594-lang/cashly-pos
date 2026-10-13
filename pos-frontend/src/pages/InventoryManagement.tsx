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
  Truck,
  X,
  Layers,
  CalendarClock
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import { useSector } from '../hooks/useSector';
import { useBusinessShape } from '../hooks/useBusinessShape';
import { daysUntil, formatDay, expiryChip, today, thisMonth, expiryToIso, expiryPassed } from '../utils/expiry';
import type { BranchStockItem, RawIngredient, IngredientMasterRow, StockBatch } from '../types';

export const InventoryManagement: React.FC = () => {
  const { selectedBranch, selectedTenant } = usePosStore();
  const location = useLocation();
  const navigate = useNavigate();
  // Several locations share one ingredient list; an outlet under a head office asks it for stock.
  const { severalLocations: isMultiBranchChain, hasHeadOffice, atHeadOffice } = useBusinessShape();

  // Ingredients are what recipes consume, so only a business with recipes has them; a shop or a
  // pharmacy opens straight on the stock it sells (hooks/useSector.ts).
  // A business whose stock carries batches (a pharmacy, a grocery) receives every delivery into a
  // batch with its own expiry, and sees what it holds batch by batch.
  const { recipes, batchExpiry, medicines, catalogNoun } = useSector();
  const [activeTab, setActiveTab] = useState<'ingredients' | 'finished'>(
    location.state?.tab || (recipes ? 'ingredients' : 'finished')
  );
  if (!recipes && activeTab === 'ingredients') setActiveTab('finished');

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
  const [bonusQty, setBonusQty] = useState<number>(0);
  const [retailPrice, setRetailPrice] = useState('');
  const [stockInError, setStockInError] = useState<string | null>(null);

  // Batches: one product's, or (no product) everything at this location.
  const [batchView, setBatchView] = useState<{ title: string; productId?: string } | null>(null);
  const [batchRows, setBatchRows] = useState<StockBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

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

  // The company-wide ingredient list: one entry per ingredient, with what every location holds.
  // Renaming here renames it everywhere, so no branch is left with the old name.
  const [masterOpen, setMasterOpen] = useState(false);
  const [masterRows, setMasterRows] = useState<IngredientMasterRow[]>([]);
  const [masterLoading, setMasterLoading] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [masterEdit, setMasterEdit] = useState<{ id: string; name: string; category: string; minAlertLevel: number } | null>(null);
  const [masterSaving, setMasterSaving] = useState(false);

  const loadMaster = async () => {
    setMasterLoading(true);
    setMasterError(null);
    try {
      setMasterRows(await posApi.getIngredientMaster());
    } catch (err) {
      setMasterError(getApiErrorMessage(err, 'Could not load the company ingredient list.'));
    } finally {
      setMasterLoading(false);
    }
  };

  const openMaster = () => {
    setMasterOpen(true);
    setMasterEdit(null);
    loadMaster();
  };

  const saveMasterEdit = async () => {
    if (!masterEdit || !masterEdit.name.trim()) return;
    setMasterSaving(true);
    setMasterError(null);
    try {
      await posApi.updateIngredientMaster(masterEdit.id, {
        name: masterEdit.name.trim(),
        category: masterEdit.category.trim() || undefined,
        minAlertLevel: masterEdit.minAlertLevel
      });
      setMasterEdit(null);
      await Promise.all([loadMaster(), fetchInventory()]);
    } catch (err) {
      setMasterError(getApiErrorMessage(err, 'Could not save the ingredient.'));
    } finally {
      setMasterSaving(false);
    }
  };

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

  const openBatches = async (title: string, productId?: string) => {
    if (!selectedBranch?.id) return;
    setBatchView({ title, productId });
    setBatchRows([]);
    setBatchError(null);
    setBatchLoading(true);
    try {
      setBatchRows(await posApi.getStockBatches(selectedBranch.id, productId));
    } catch (err) {
      setBatchError(getApiErrorMessage(err, 'Could not load the batches.'));
    } finally {
      setBatchLoading(false);
    }
  };

  // Handle Finished Product Stock-In
  const handleStockInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockInItem || !selectedBranch?.id || stockInQty <= 0) return;
    if (batchExpiry && (!batchNo.trim() || !expiryDate)) {
      setStockInError('Enter the batch number and expiry printed on the pack.');
      return;
    }
    if (expiryDate && expiryPassed(expiryDate)) {
      setStockInError('That batch has already expired. Return it to the supplier instead of receiving it.');
      return;
    }
    if (bonusQty < 0) {
      setStockInError('Bonus units cannot be negative.');
      return;
    }
    const bonus = batchExpiry ? bonusQty : 0;
    const printedPrice = Number(retailPrice);
    setIsSubmitting(true);
    setStockInError(null);
    try {
      await posApi.addStockIn({
        branchId: selectedBranch.id,
        productId: stockInItem.productId,
        quantity: stockInQty,
        supplierName: supplierName || undefined,
        costPricePKR: newCostPrice > 0 ? newCostPrice : undefined,
        batchNumber: batchNo.trim() || undefined,
        expiryDate: expiryDate ? expiryToIso(expiryDate) : undefined,
        bonusQuantity: bonus > 0 ? bonus : undefined,
        retailPricePKR: batchExpiry && printedPrice > 0 ? printedPrice : undefined
      });
      setActionSuccess(bonus > 0
        ? `Added +${stockInQty + bonus} ${stockInItem.unit} (${stockInQty} + ${bonus} bonus) to ${stockInItem.productName}`
        : `Added +${stockInQty} ${stockInItem.unit} to ${stockInItem.productName}`);
      setStockInItem(null);
      await fetchInventory();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      setStockInError(getApiErrorMessage(err, 'Could not receive the stock.'));
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
  // Products holding expired stock, or whose next batch expires within three months.
  const expiryAlertCount = stocks.filter(s =>
    (s.expiredQty ?? 0) > 0 || (s.nearestExpiry != null && daysUntil(s.nearestExpiry) <= 90)).length;
  const finishedTotalValuationPKR = stocks.reduce((sum, s) => sum + (s.quantityOnHand * s.costPricePKR), 0);

  return (
    <div className="flex-1 bg-slate-50 text-slate-900 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-2xl shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <Boxes className="w-6 h-6 text-teal-500" />
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                {recipes ? 'Kitchen & Store Inventory' : medicines ? 'Medicine Stock' : 'Stock & Inventory'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-teal-500" />
              Active Branch: <span className="text-teal-600 font-semibold">{selectedBranch?.name || 'Default Branch'}</span>
            </p>
          </div>

          {/* Quick Tabs: Raw Ingredients (BOM) vs Finished Products — a business with recipes only */}
          {recipes && (
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => { setActiveTab('ingredients'); setSelectedCategory('all'); }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'ingredients'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
              }`}
            >
              <Wheat className="w-3.5 h-3.5" />
              <span>Raw Ingredients & BOM ({ingredients.length})</span>
            </button>

            <button
              onClick={() => { setActiveTab('finished'); setSelectedCategory('all'); }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'finished'
                  ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Finished Products ({stocks.length})</span>
            </button>
          </div>
          )}

          {/* Quick Stats Pills */}
          <div className="flex items-center gap-3">
            {batchExpiry && activeTab === 'finished' && (
              <button
                type="button"
                onClick={() => openBatches(`All batches at ${selectedBranch?.name || 'this location'}`)}
                className={`px-3.5 py-2 rounded-xl text-right border transition ${
                  expiryAlertCount > 0 ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
                title="Every batch here, earliest expiry first"
              >
                <div className={`text-[10px] font-medium ${expiryAlertCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Expiry Alerts</div>
                <div className={`text-sm font-bold ${expiryAlertCount > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{expiryAlertCount} Items</div>
              </button>
            )}
            <div className="px-3.5 py-2 bg-rose-50 border border-rose-200 rounded-xl text-right">
              <div className="text-[10px] text-rose-500 font-medium">Low Stock Alerts</div>
              <div className="text-sm font-bold text-rose-600">
                {activeTab === 'ingredients' ? rawLowStockCount : finishedLowStockCount} Items
              </div>
            </div>
            <div className="px-3.5 py-2 bg-teal-50 border border-teal-200 rounded-xl text-right">
              <div className="text-[10px] text-teal-500 font-medium">Stock Value</div>
              <div className="text-sm font-bold text-teal-600">
                {Math.round(activeTab === 'ingredients' ? rawTotalValuationPKR : finishedTotalValuationPKR).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Success Alert Banner */}
        {actionSuccess && (
          <div className="bg-teal-50 border border-teal-300 text-teal-700 px-4 py-3 rounded-xl flex items-center gap-2 text-xs font-semibold animate-pulse shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="bg-white border border-slate-200 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 shadow-md">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'ingredients' ? 'Search bun, patty, sauce, cheese...' : 'Search product, barcode, SKU...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
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
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25' 
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50 border border-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Low Stock ({activeTab === 'ingredients' ? rawLowStockCount : finishedLowStockCount})</span>
            </button>

            {/* Every batch at this location, earliest expiry first */}
            {batchExpiry && activeTab === 'finished' && (
              <button
                onClick={() => openBatches(`All batches at ${selectedBranch?.name || 'this location'}`)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center gap-1.5 whitespace-nowrap border border-slate-200"
              >
                <Layers className="w-3.5 h-3.5 text-teal-600" />
                <span>Batches & Expiry</span>
              </button>
            )}

            {/* Add New Raw Ingredient Button (when in ingredients tab) */}
            {activeTab === 'ingredients' && (
              <button
                onClick={() => setIsNewIngOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-amber-500/25"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Ingredient</span>
              </button>
            )}

            {/* The same ingredients across every location */}
            {isMultiBranchChain && activeTab === 'ingredients' && (
              <button
                onClick={openMaster}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center gap-1.5 whitespace-nowrap border border-slate-200"
                title="Every ingredient across all locations"
              >
                <Building2 className="w-3.5 h-3.5 text-teal-600" />
                <span>All Locations</span>
              </button>
            )}

            {/* An outlet asks its head office for stock; head office answers those requests. */}
            {hasHeadOffice && !atHeadOffice && (
              <button
                onClick={() => navigate('/stock-requests', { state: { newRequest: 'ToHQ' } })}
                className="px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs transition flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-teal-500/25"
                title="Ask head office to send stock"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Request from Head Office</span>
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={fetchInventory}
              disabled={loading}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl border border-slate-200 transition"
              title="Refresh inventory"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* TAB 1: RAW INGREDIENTS TABLE (BOM) */}
        {activeTab === 'ingredients' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Wheat className="w-4 h-4 text-amber-500" />
                  <span>Kitchen Raw Materials & Ingredient Consumption (Recipe BOM)</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Every time a burger, deal, or pizza is sold at the counter, ingredients (buns, patties, sauces, cheese) deduct automatically.
                </p>
              </div>
              <span className="text-xs text-amber-600 font-mono font-bold">{filteredIngredients.length} Items</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Raw Ingredient</th>
                    <th className="py-3 px-3">Classification</th>
                    <th className="py-3 px-3 text-right">Cost Per Unit (PKR)</th>
                    <th className="py-3 px-3 text-center">Stock on Hand</th>
                    <th className="py-3 px-3 text-right">Valuation (PKR)</th>
                    <th className="py-3 px-3">Supplier / Vendor</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredIngredients.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500 font-medium">
                        No raw ingredients match your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredIngredients.map((ing) => (
                      <tr key={ing.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 text-sm">{ing.name}</div>
                          <div className="text-[10px] text-slate-500">Unit: {ing.unit}</div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold border border-amber-200">
                            {ing.category}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-700">
                          {ing.costPerUnitPKR.toLocaleString()} / {ing.unit}
                        </td>
                        <td className="py-3 px-3 text-center font-bold">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                            ing.isLowStock
                              ? 'bg-rose-50 text-rose-600 border border-rose-200'
                              : 'bg-teal-50 text-teal-600 border border-teal-200'
                          }`}>
                            {ing.currentStock} {ing.unit}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5">Min Alert: {ing.minAlertLevel}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-teal-600 font-bold">
                          {ing.totalValuationPKR.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-slate-600 font-medium">
                          {ing.supplierName || 'Local Supplier'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {ing.isLowStock ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-600 text-[10px] font-bold">
                              <AlertTriangle className="w-3 h-3" />
                              <span>REORDER NEEDED</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-600 text-[10px] font-semibold">
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
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[11px] font-bold transition mx-auto"
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
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-teal-500" />
                  <span>{recipes ? 'Finished Product Stock on Hand' : `${catalogNoun === 'Catalog' ? 'Product' : catalogNoun} Stock on Hand`}</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {batchExpiry
                    ? 'Each delivery is kept as its own batch with its own expiry. Sales take the earliest expiry first; expired stock cannot be sold.'
                    : recipes
                      ? 'Stock levels for ready items, mart grocery items, and packaging cartons.'
                      : 'What each product has on hand at this location.'}
                </p>
              </div>
              <span className="text-xs text-teal-600 font-mono font-bold">{filteredStocks.length} Items</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Item & Category</th>
                    <th className="py-3 px-3">Barcode / SKU</th>
                    <th className="py-3 px-3 text-right">Cost Price (PKR)</th>
                    <th className="py-3 px-3 text-right">Selling Price (PKR)</th>
                    <th className="py-3 px-3 text-center">Stock on Hand</th>
                    <th className="py-3 px-3">Batch & Expiry</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStocks.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500 font-medium">
                        No product records found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredStocks.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 text-sm">{item.productName}</div>
                          <div className="text-[11px] text-slate-500">{item.categoryName}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                          <div>{item.barcode || '—'}</div>
                          <div className="text-[10px] text-slate-500">{item.sku}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-700">
                          {item.costPricePKR.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-teal-600 font-bold">
                          {item.sellingPricePKR.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-center font-bold">
                          {item.isTracked === false ? (
                            // Never received or counted at this branch; Stock In or Adjust starts its count.
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-50 text-slate-500 border border-slate-200">
                              Not counted
                            </span>
                          ) : (
                            <>
                              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                                item.isLowStock
                                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                  : 'bg-teal-50 text-teal-600 border border-teal-200'
                              }`}>
                                {item.quantityOnHand} {item.unit}
                              </span>
                              <div className="text-[10px] text-slate-500 mt-0.5">Min: {item.minAlertLevel}</div>
                            </>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {(item.batchCount ?? 0) > 0 ? (() => {
                            const chip = expiryChip(item.nearestExpiry ? daysUntil(item.nearestExpiry) : null);
                            return (
                              <button
                                type="button"
                                onClick={() => openBatches(item.productName, item.productId)}
                                className="text-left group"
                                title="See this product's batches"
                              >
                                <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 group-hover:underline">
                                  <Layers className="w-3 h-3" />
                                  <span>{item.batchCount} {item.batchCount === 1 ? 'batch' : 'batches'}</span>
                                </div>
                                {item.nearestExpiry && (
                                  <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                    <Calendar className="w-2.5 h-2.5" />
                                    <span>Next exp: {formatDay(item.nearestExpiry)}</span>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-1 mt-1 empty:hidden">
                                  {chip && (
                                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>
                                  )}
                                  {(item.expiredQty ?? 0) > 0 && (
                                    <span className="px-1.5 py-0.5 rounded border bg-rose-100 border-rose-300 text-rose-700 text-[10px] font-bold">
                                      {item.expiredQty} expired
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })() : batchExpiry || !item.batchNumber ? (
                            <span className="text-[10px] text-slate-400">No Batch</span>
                          ) : (
                            <>
                              <div className="font-mono text-[11px] text-purple-600 font-semibold">{item.batchNumber}</div>
                              {item.expiryDate && (
                                <div className="text-[10px] text-amber-600 flex items-center gap-1">
                                  <Calendar className="w-2.5 h-2.5" />
                                  <span>Exp: {item.expiryDate}</span>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {item.isTracked === false ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500 text-[10px] font-semibold">
                              <span>Not tracked</span>
                            </span>
                          ) : item.isLowStock ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-600 text-[10px] font-bold">
                              <AlertTriangle className="w-3 h-3" />
                              <span>LOW STOCK</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-600 text-[10px] font-semibold">
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
                                // Each delivery is a new batch for a business with batches; others keep the last one.
                                setBatchNo(batchExpiry ? '' : item.batchNumber || '');
                                setExpiryDate(batchExpiry ? '' : item.expiryDate || '');
                                setBonusQty(0);
                                setRetailPrice('');
                                setStockInError(null);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 border border-teal-200 text-[11px] font-bold transition"
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
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 text-[11px] font-medium transition"
                            >
                              <SlidersHorizontal className="w-3 h-3 text-slate-500" />
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 text-base">Inward Raw Material Stock</h3>
              </div>
              <button onClick={() => setRestockIng(null)} className="text-slate-400 hover:text-slate-900 text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="font-bold text-amber-600 text-sm">{restockIng.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Current Kitchen Stock: <span className="font-bold text-slate-900">{restockIng.currentStock} {restockIng.unit}</span>
              </div>
            </div>

            <form onSubmit={handleRestockIngSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">
                  Quantity Received ({restockIng.unit}) *
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={restockQty}
                  onChange={(e) => setRestockQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Supplier Name</label>
                  <input
                    type="text"
                    value={restockSupplier}
                    onChange={(e) => setRestockSupplier(e.target.value)}
                    placeholder="e.g. Dawn Bread / K&Ns"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Cost Per {restockIng.unit} (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={restockUnitCost}
                    onChange={(e) => setRestockUnitCost(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRestockIng(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition shadow-lg shadow-amber-500/25 disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 text-base">Add New Raw Ingredient</h3>
              </div>
              <button onClick={() => setIsNewIngOpen(false)} className="text-slate-400 hover:text-slate-900 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateIngredientSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">Ingredient Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sesame Burger Buns / Jalapeno Slices"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Classification</label>
                  <select
                    value={newIngCategory}
                    onChange={(e) => setNewIngCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
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
                  <label className="block text-xs text-slate-500 font-medium mb-1">Measurement Unit</label>
                  <select
                    value={newIngUnit}
                    onChange={(e) => setNewIngUnit(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
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
                  <label className="block text-[11px] text-slate-500 font-medium mb-1">Cost / Unit (PKR)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newIngCost}
                    onChange={(e) => setNewIngCost(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 font-medium mb-1">Initial Stock</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newIngStock}
                    onChange={(e) => setNewIngStock(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 font-medium mb-1">Alert Below</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newIngMinAlert}
                    onChange={(e) => setNewIngMinAlert(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-rose-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">Supplier / Vendor</label>
                <input
                  type="text"
                  placeholder="e.g. Dawn Bread / K&Ns / Local Mandi"
                  value={newIngSupplier}
                  onChange={(e) => setNewIngSupplier(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewIngOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition shadow-lg shadow-amber-500/25 disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-5 h-5 text-teal-500" />
                <h3 className="font-bold text-slate-900 text-base">Receive Stock (Stock-In)</h3>
              </div>
              <button onClick={() => setStockInItem(null)} className="text-slate-400 hover:text-slate-900 text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="font-bold text-teal-600 text-sm">{stockInItem.productName}</div>
              <div className="text-xs text-slate-500 mt-0.5">Current Stock: <span className="font-bold text-slate-900">{stockInItem.quantityOnHand} {stockInItem.unit}</span></div>
            </div>

            <form onSubmit={handleStockInSubmit} onInput={() => setStockInError(null)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className={batchExpiry ? '' : 'col-span-2'}>
                  <label className="block text-xs text-slate-500 font-medium mb-1">
                    {batchExpiry ? `Quantity bought (${stockInItem.unit}) *` : `Quantity to Inward (${stockInItem.unit}) *`}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={stockInQty}
                    onChange={(e) => setStockInQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                {batchExpiry && (
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">Bonus units (free)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={bonusQty || ''}
                      placeholder="e.g. 1 on 10"
                      onChange={(e) => setBonusQty(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 placeholder-slate-400 placeholder:font-normal focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {batchExpiry && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">Batch number *</label>
                    <input
                      type="text"
                      placeholder="As printed, e.g. B-9901"
                      value={batchNo}
                      onChange={(e) => setBatchNo(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">{medicines ? 'Expiry (month on pack) *' : 'Expiry date *'}</label>
                    <input
                      type={medicines ? 'month' : 'date'}
                      min={medicines ? thisMonth() : today()}
                      placeholder={medicines ? 'YYYY-MM' : undefined}
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Supplier Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Metro / Local Vendor"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">{batchExpiry ? 'Price paid per unit (PKR)' : 'Unit Cost Price (PKR)'}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newCostPrice}
                    onChange={(e) => setNewCostPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

              {batchExpiry && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">Retail price on pack (PKR)</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder={`Now selling at ${stockInItem.sellingPricePKR.toLocaleString()}`}
                      value={retailPrice}
                      onChange={(e) => setRetailPrice(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none font-mono"
                    />
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-teal-50/60 border border-teal-100 text-[11px] text-slate-600 flex flex-col justify-center">
                    <div>
                      Receiving <span className="font-bold text-slate-900">{(stockInQty || 0) + (bonusQty > 0 ? bonusQty : 0)} {stockInItem.unit}</span>
                    </div>
                    {bonusQty > 0 && stockInQty > 0 && newCostPrice > 0 && (
                      <div>
                        Each costs <span className="font-bold text-teal-700 font-mono">
                          Rs {(stockInQty * newCostPrice / (stockInQty + bonusQty)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span> after the bonus
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!batchExpiry && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Batch Number</label>
                  <input
                    type="text"
                    placeholder="e.g. B-9901"
                    value={batchNo}
                    onChange={(e) => setBatchNo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>
              )}

              {stockInError && (
                <div role="alert" className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{stockInError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStockInItem(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-bold hover:bg-teal-600 transition shadow-lg shadow-teal-500/25 disabled:opacity-50"
                >
                  {isSubmitting ? 'Receiving...' : 'Confirm Stock-In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batches: one product's, or everything at this location — earliest expiry first */}
      {batchView && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setBatchView(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={batchView.title}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Layers className="w-5 h-5 text-teal-500 shrink-0" />
                  <span className="truncate">{batchView.title}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Earliest expiry first — the order the till sells them in. Expired batches cannot be sold.
                </p>
              </div>
              <button onClick={() => setBatchView(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-auto flex-1">
              {batchLoading ? (
                <div className="py-14 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading batches…
                </div>
              ) : batchError ? (
                <div className="m-5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">{batchError}</div>
              ) : batchRows.length === 0 ? (
                <div className="py-14 text-center">
                  <CalendarClock className="w-8 h-8 text-slate-300 mx-auto" />
                  <div className="text-sm font-semibold text-slate-700 mt-2">No batches with stock here</div>
                  <div className="text-xs text-slate-500 mt-0.5">Stock received with a batch number and expiry shows up here.</div>
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      {!batchView.productId && <th className="py-2.5 px-4">Product</th>}
                      <th className={`py-2.5 ${batchView.productId ? 'px-4' : 'px-3'}`}>Batch</th>
                      <th className="py-2.5 px-3">Expiry</th>
                      <th className="py-2.5 px-3 text-right">On hand</th>
                      <th className="py-2.5 px-3 text-right">Cost / unit</th>
                      <th className="py-2.5 px-3 text-right">Pack price</th>
                      <th className="py-2.5 px-3">Supplier</th>
                      <th className="py-2.5 px-4">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchRows.map((b) => {
                      const chip = expiryChip(b.daysToExpiry);
                      const expired = b.daysToExpiry != null && b.daysToExpiry < 0;
                      return (
                        <tr key={b.id} className={expired ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                          {!batchView.productId && <td className="py-2.5 px-4 font-semibold text-slate-900">{b.productName}</td>}
                          <td className={`py-2.5 ${batchView.productId ? 'px-4' : 'px-3'} font-mono font-semibold text-purple-600`}>
                            {b.batchNumber || <span className="font-sans font-normal text-slate-400">No number</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className={expired ? 'text-rose-700 font-semibold' : 'text-slate-700'}>{formatDay(b.expiryDate)}</div>
                            {chip && (
                              <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            <span className="font-bold text-slate-900">{b.quantityOnHand.toLocaleString()}</span>
                            <span className="text-slate-400"> / {b.quantityReceived.toLocaleString()}</span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {b.unitCostPKR.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {b.retailPricePKR != null ? b.retailPricePKR.toLocaleString() : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{b.supplierName || '—'}</td>
                          <td className="py-2.5 px-4 text-slate-500">{formatDay(b.receivedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {!batchLoading && !batchError && batchRows.length > 0 && (() => {
              const expiredUnits = batchRows.filter(b => b.daysToExpiry != null && b.daysToExpiry < 0).reduce((n, b) => n + b.quantityOnHand, 0);
              const soonUnits = batchRows.filter(b => b.daysToExpiry != null && b.daysToExpiry >= 0 && b.daysToExpiry <= 90).reduce((n, b) => n + b.quantityOnHand, 0);
              return (
                <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span><span className="font-bold text-slate-900">{batchRows.length}</span> {batchRows.length === 1 ? 'batch' : 'batches'}</span>
                  <span><span className="font-bold text-slate-900">{batchRows.reduce((n, b) => n + b.quantityOnHand, 0).toLocaleString()}</span> units on hand</span>
                  {soonUnits > 0 && <span className="text-amber-700"><span className="font-bold">{soonUnits.toLocaleString()}</span> expiring within 3 months</span>}
                  {expiredUnits > 0 && <span className="text-rose-700"><span className="font-bold">{expiredUnits.toLocaleString()}</span> expired — return or write off</span>}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Finished Product Stock Adjustment Modal */}
      {adjustItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 text-base">Adjust Stock Level</h3>
              </div>
              <button onClick={() => setAdjustItem(null)} className="text-slate-400 hover:text-slate-900 text-sm">✕</button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="font-bold text-amber-600 text-sm">{adjustItem.productName}</div>
              <div className="text-xs text-slate-500 mt-0.5">Current Stock: <span className="font-bold text-slate-900">{adjustItem.quantityOnHand} {adjustItem.unit}</span></div>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">Adjustment Quantity (use - for loss/waste) *</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
                <div className="text-[11px] text-slate-500 mt-1">
                  Resulting Stock: <span className="font-bold text-slate-900">{Math.max(0, adjustItem.quantityOnHand + adjustQty)} {adjustItem.unit}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">Reason for Adjustment</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  <option value="Wastage / Kitchen Prep Loss">Wastage / Kitchen Prep Loss</option>
                  <option value="Damage / Spoilage">Damage / Spoilage</option>
                  <option value="Expired Product">Expired Product</option>
                  <option value="Audit Count Correction">Physical Audit Count Correction</option>
                  <option value="Supplier Return">Supplier Return</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustItem(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition shadow-lg shadow-amber-500/25 disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Save Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Company-wide ingredient list */}
      {masterOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-teal-500" /> Ingredients at every location
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  One list for the whole business. A rename here changes the name at every branch.
                </p>
              </div>
              <button onClick={() => setMasterOpen(false)} className="text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
            </div>

            {masterError && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{masterError}</div>
            )}

            {masterLoading && masterRows.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3">Ingredient</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">Value</th>
                      <th className="py-2 pr-3">By location</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {masterRows.map(m => (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0 align-top">
                        <td className="py-2 pr-3">
                          {masterEdit?.id === m.id ? (
                            <div className="space-y-1">
                              <input
                                value={masterEdit.name}
                                onChange={(e) => setMasterEdit({ ...masterEdit, name: e.target.value })}
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-teal-500"
                              />
                              <input
                                value={masterEdit.category}
                                onChange={(e) => setMasterEdit({ ...masterEdit, category: e.target.value })}
                                placeholder="Category"
                                className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-teal-500"
                              />
                              <label className="flex items-center gap-1 text-[10px] text-slate-500">
                                Alert below
                                <input
                                  type="number"
                                  value={masterEdit.minAlertLevel}
                                  onChange={(e) => setMasterEdit({ ...masterEdit, minAlertLevel: Number(e.target.value) || 0 })}
                                  className="w-16 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-teal-500"
                                />
                                {m.unit}
                              </label>
                            </div>
                          ) : (
                            <>
                              <div className="font-semibold text-slate-900">{m.name}</div>
                              <div className="text-[10px] text-slate-400">{m.category} · {m.unit}</div>
                            </>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{Math.round(m.totalStock * 100) / 100}</td>
                        <td className="py-2 pr-3 text-right font-mono">{Math.round(m.totalValuePKR).toLocaleString()}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {m.locations.length === 0 && <span className="text-slate-300">Not stocked anywhere</span>}
                            {m.locations.map(l => (
                              <span key={l.branchId} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                                {l.branchName}: <span className="font-bold">{Math.round(l.currentStock * 100) / 100}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {masterEdit?.id === m.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={saveMasterEdit}
                                disabled={masterSaving || !masterEdit.name.trim()}
                                className="px-2 py-1 rounded-lg bg-teal-500 text-white text-[11px] font-bold disabled:opacity-50"
                              >
                                {masterSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={() => setMasterEdit(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setMasterEdit({ id: m.id, name: m.name, category: m.category, minAlertLevel: m.minAlertLevel })}
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 text-[11px] font-semibold"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!masterLoading && masterRows.length === 0 && !masterError && (
                  <p className="text-xs text-slate-400 text-center py-6">No ingredients yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

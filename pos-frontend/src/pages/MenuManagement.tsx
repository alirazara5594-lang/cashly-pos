import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Lock, 
  Save, 
  Check, 
  Percent,
  Wheat,
  Eye,
  Plus,
  Trash2,
  Edit,
  X,
  FolderOpen,
  Hash
} from 'lucide-react';

import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { Product, Category, ProductRecipeItem } from '../types';


export const MenuManagement: React.FC = () => {
  const { 
    selectedTenant, 
    cashTaxRatePercent, 
    cardTaxRatePercent, 
    taxMode, 
    setTaxSettings
  } = usePosStore();

  const [activeTab, setActiveTab] = useState<'overview' | 'categories'>('overview');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Tax form state
  const [localCashTax, setLocalCashTax] = useState(cashTaxRatePercent);
  const [localCardTax, setLocalCardTax] = useState(cardTaxRatePercent);
  const [localTaxMode, setLocalTaxMode] = useState<'Exclusive' | 'Inclusive'>(taxMode);
  const [taxSaved, setTaxSaved] = useState(false);

  // Recipe (BOM) Modal states
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeItems, setRecipeItems] = useState<ProductRecipeItem[]>([]);

  // Category CRUD states
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catFormName, setCatFormName] = useState('');
  const [catFormSort, setCatFormSort] = useState(0);
  const [catSaving, setCatSaving] = useState(false);
  const [catDeleteId, setCatDeleteId] = useState<string | null>(null);

  const fetchCatalog = async () => {
    try {
      const cats = await posApi.getCategories(selectedTenant?.id);
      const prods = await posApi.getProducts({ tenantId: selectedTenant?.id });
      setCategories(cats);
      setProducts(prods);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [selectedTenant?.id]);

  const handleSaveTaxSettings = () => {
    setTaxSettings({
      cashRate: localCashTax,
      cardRate: localCardTax,
      mode: localTaxMode
    });
    setTaxSaved(true);
    setTimeout(() => setTaxSaved(false), 2500);
  };

  const handleViewRecipe = async (product: Product) => {
    setRecipeProduct(product);
    try {
      const rec = await posApi.getProductRecipe(product.id);
      setRecipeItems(rec);
    } catch (err) {
      console.error('Failed to load recipe', err);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const matchesSearch = !searchTerm || 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (p.urduName && p.urduName.includes(searchTerm)) ||
      p.barcode.includes(searchTerm);
    return matchesCat && matchesSearch;
  });

  const openAddCategory = () => {
    setEditingCategory(null);
    setCatFormName('');
    setCatFormSort(categories.length);
    setShowCategoryModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatFormName(cat.name);
    setCatFormSort(cat.sortOrder);
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    if (!catFormName.trim() || !selectedTenant?.id) return;
    setCatSaving(true);
    try {
      if (editingCategory) {
        await posApi.updateCategory(editingCategory.id, {
          tenantId: selectedTenant.id,
          name: catFormName.trim(),
          icon: 'utensils',
          sortOrder: catFormSort
        });
      } else {
        await posApi.createCategory({
          tenantId: selectedTenant.id,
          name: catFormName.trim(),
          icon: 'utensils',
          sortOrder: catFormSort
        });
      }
      await fetchCatalog();
      setShowCategoryModal(false);
      setEditingCategory(null);
      setCatFormName('');
    } catch (err) {
      console.error('Failed to save category:', err);
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!catDeleteId) return;
    try {
      await posApi.deleteCategory(catDeleteId);
      await fetchCatalog();
      setCatDeleteId(null);
    } catch (err) {
      console.error('Failed to delete category:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>Menu, Catalog & Tax Setup Portal</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            View menu items, prices in PKR, and tax configuration.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-0">
        {[
          { id: 'overview' as const, label: 'Overview' },
          { id: 'categories' as const, label: `Categories (${categories.length})` },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition -mb-px ${
              activeTab === tab.id
                ? 'border-teal-500 text-teal-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {activeTab === 'overview' && (
        <>
          {/* Managed Menu Banner */}
          <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-3">
            <Lock className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              <strong>Managed Menu Service Active:</strong> Menu items, prices, and recipes are managed and updated by the platform. Contact support for any menu changes.
            </span>
          </div>

          {/* Tax & Business Type Engine Configuration Card */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Percent className="w-4 h-4 text-teal-500" />
                  <span>Tax Configuration Engine (Cash vs Card Differentiated Rates)</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Tax rates automatically adjust based on customer payment mode and business type
                </p>
              </div>

              <button
                onClick={handleSaveTaxSettings}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow transition"
              >
                {taxSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                <span>{taxSaved ? 'Tax Rates Saved!' : 'Save Tax Rules'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Cash Sales Tax Rate (%):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={localCashTax}
                    onChange={(e) => setLocalCashTax(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                  <span className="text-slate-400 font-mono font-bold">%</span>
                </div>
                <p className="text-[10px] text-slate-500">Standard rate for cash tender (Default 16%)</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Card / Digital Sales Tax Rate (%):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={localCardTax}
                    onChange={(e) => setLocalCardTax(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-teal-600 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                  <span className="text-slate-400 font-mono font-bold">%</span>
                </div>
                <p className="text-[10px] text-teal-600">Reduced digital payment rate (Default 8%)</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Pricing Tax Mode:</label>
                <select
                  value={localTaxMode}
                  onChange={(e) => setLocalTaxMode(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  <option value="Exclusive">Tax Exclusive (Added on top at checkout)</option>
                  <option value="Inclusive">Tax Inclusive (Included inside shelf price)</option>
                </select>
                <p className="text-[10px] text-slate-500">Exclusive is standard for Restaurants, Inclusive for Retail</p>
              </div>
            </div>
          </div>

          {/* Categories & Kitchen Stations Display */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="border-b border-slate-200 pb-2.5">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span>Active Product Categories ({categories.length})</span>
                </h3>
                <p className="text-[11px] text-slate-500">Menu categories organized by the platform</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map(c => {
                  const count = products.filter(p => p.categoryId === c.id).length;
                  return (
                    <div key={c.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 min-w-[140px]">
                      <div className="font-bold text-xs text-slate-900">{c.name}</div>
                      <div className="text-[10px] text-slate-500">{count} items</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-3 shadow-sm">
              <div className="border-b border-slate-200 pb-2.5">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span>Kitchen Stations (Mode 1 Dispatch Routing)</span>
                </h3>
                <p className="text-[11px] text-slate-500">Orders are automatically split and routed to these stations</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { name: 'Main Kitchen', id: 'MainKitchen', desc: 'Pizzas, Combos, Entrees', color: 'text-amber-600' },
                  { name: 'Grill Station', id: 'Grill', desc: 'Burgers, Shawarma, Fries', color: 'text-rose-600' },
                  { name: 'Beverage Bar', id: 'BeverageBar', desc: 'Drinks, Juices, Shakes', color: 'text-blue-600' },
                ].map(station => (
                  <div key={station.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className={`font-black text-xs ${station.color}`}>{station.name}</div>
                    <div className="text-[10px] text-slate-500">{station.desc}</div>
                    <div className="text-[9px] text-teal-600 font-mono">Routing: Active</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Products Table */}
          <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Search products by name, Urdu name, or barcode..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none"
                >
                  <option value="all">All Categories ({products.length})</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="pb-3">Product Name</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Barcode / SKU</th>
                    <th className="pb-3">Kitchen Station</th>
                    <th className="pb-3 text-right">Cost (PKR)</th>
                    <th className="pb-3 text-right">Selling Price (PKR)</th>
                    <th className="pb-3 text-right">Recipe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 transition">
                      <td className="py-3">
                        <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                        {p.urduName && <div className="text-[11px] text-slate-500 font-sans">{p.urduName}</div>}
                      </td>
                      <td className="py-3 text-slate-700">{p.category?.name || 'Category'}</td>
                      <td className="py-3 font-mono text-slate-500">{p.barcode}</td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                          {p.station}
                        </span>
                      </td>
                      <td className="py-3 text-right text-slate-500">{p.costPricePKR.toLocaleString()}</td>
                      <td className="py-3 text-right font-black text-teal-600 text-sm">{p.sellingPricePKR.toLocaleString()}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleViewRecipe(p)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-[10px] font-bold transition"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══════ CATEGORIES TAB ═══════ */}
      {activeTab === 'categories' && (
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-teal-500" />
                <span>Product Categories</span>
              </h2>
              <p className="text-xs text-slate-500">{categories.length} categories • Manage your menu organization</p>
            </div>
            <button
              onClick={openAddCategory}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-md shadow-teal-500/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Category</span>
            </button>
          </div>

          {categories.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No categories yet</p>
              <p className="text-xs text-slate-400 mt-1">Create your first category to organize menu items</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                    <th className="pb-3 w-8">#</th>
                    <th className="pb-3">Category Name</th>
                    <th className="pb-3 text-center">Products</th>
                    <th className="pb-3 text-right">Sort Order</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.sort((a, b) => a.sortOrder - b.sortOrder).map((cat, idx) => {
                    const productCount = products.filter(p => p.categoryId === cat.id).length;
                    return (
                      <tr key={cat.id} className="hover:bg-slate-50 transition">
                        <td className="py-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-3">
                          <div className="font-bold text-slate-900 text-sm">{cat.name}</div>
                        </td>
                        <td className="py-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {productCount} items
                          </span>
                        </td>
                        <td className="py-3 text-right text-slate-500 font-mono">{cat.sortOrder}</td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditCategory(cat)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 transition"
                              title="Edit category"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setCatDeleteId(cat.id)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition"
                              title="Delete category"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════ CATEGORY ADD/EDIT MODAL ═══════ */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingCategory ? 'Edit Category' : 'Add New Category'}
              </h3>
              <button onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Category Name</label>
                <input
                  type="text"
                  value={catFormName}
                  onChange={(e) => setCatFormName(e.target.value)}
                  placeholder="e.g. Burgers & Sandwiches"
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Sort Order</label>
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-slate-400" />
                  <input
                    type="number"
                    min="0"
                    value={catFormSort}
                    onChange={(e) => setCatFormSort(Number(e.target.value))}
                    className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400">Lower = shown first</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => { setShowCategoryModal(false); setEditingCategory(null); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={!catFormName.trim() || catSaving}
                className="flex-1 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-md shadow-teal-500/25 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {catSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{editingCategory ? 'Update' : 'Create'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ CATEGORY DELETE CONFIRM ═══════ */}
      {catDeleteId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Delete Category?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Products in this category won't be deleted — they'll become uncategorized.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCatDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCategory}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-md transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ RECIPE (BOM) MODAL ═══════ */}
      {recipeProduct && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Wheat className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Recipe & Raw Materials (BOM)</h3>
                  <div className="text-xs text-slate-500">Ingredients for: <span className="text-amber-600 font-bold">{recipeProduct.name}</span></div>
                </div>
              </div>
              <button onClick={() => setRecipeProduct(null)} className="text-slate-400 hover:text-slate-900 text-sm cursor-pointer">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Required Ingredients per Sale:</div>
              {recipeItems.length === 0 ? (
                <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  No ingredients configured for this item yet.
                </div>
              ) : (
                recipeItems.map(item => (
                  <div key={item.ingredientId} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900 text-xs">{item.ingredientName}</div>
                      <div className="text-[10px] text-slate-500">{item.ingredientCategory} — {item.costPerUnitPKR} / {item.unit}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 text-xs font-mono font-bold">
                        {item.quantityRequired} {item.unit}
                      </span>
                      <span className="text-xs font-mono text-teal-600 font-semibold min-w-[60px] text-right">
                        {item.estimatedCostPKR}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Calculated Ingredient Cost per Portion:</span>
              <span className="text-base font-black text-teal-600 font-mono">
                {recipeItems.reduce((s, i) => s + (i.estimatedCostPKR || 0), 0).toLocaleString()}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setRecipeProduct(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

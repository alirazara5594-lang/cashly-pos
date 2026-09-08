import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  Lock, 
  Unlock, 
  Save, 
  Check, 
  X,
  Percent,
  RefreshCw,
  Wheat
} from 'lucide-react';

import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { Product, Category, KitchenStation, RawIngredient, ProductRecipeItem } from '../types';


export const MenuManagement: React.FC = () => {
  const { 
    selectedTenant, 
    cashTaxRatePercent, 
    cardTaxRatePercent, 
    taxMode, 
    setTaxSettings,
    isMenuEditLocked,
    setIsMenuEditLocked 
  } = usePosStore();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Tax form state
  const [localCashTax, setLocalCashTax] = useState(cashTaxRatePercent);
  const [localCardTax, setLocalCardTax] = useState(cardTaxRatePercent);
  const [localTaxMode, setLocalTaxMode] = useState<'Exclusive' | 'Inclusive'>(taxMode);
  const [taxSaved, setTaxSaved] = useState(false);

  // Modals
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Recipe (BOM) Modal states
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeItems, setRecipeItems] = useState<ProductRecipeItem[]>([]);
  const [availableIngredients, setAvailableIngredients] = useState<RawIngredient[]>([]);
  const [selectedIngId, setSelectedIngId] = useState('');
  const [selectedIngQty, setSelectedIngQty] = useState<number>(1);
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);


  // New Product Form
  const [newProdName, setNewProdName] = useState('');
  const [newProdUrduName, setNewProdUrduName] = useState('');
  const [newProdCategoryId, setNewProdCategoryId] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdCost, setNewProdCost] = useState<number>(0);
  const [newProdPrice, setNewProdPrice] = useState<number>(0);
  const [newProdUnit, setNewProdUnit] = useState('Piece');
  const [newProdStation, setNewProdStation] = useState<KitchenStation>('MainKitchen');
  const [newModifiers, setNewModifiers] = useState<{ name: string; pricePKR: number }[]>([]);
  const [modNameInput, setModNameInput] = useState('');
  const [modPriceInput, setModPriceInput] = useState<number>(0);

  const fetchCatalog = async () => {
    try {
      const cats = await posApi.getCategories(selectedTenant?.id);
      const prods = await posApi.getProducts({ tenantId: selectedTenant?.id });
      setCategories(cats);
      setProducts(prods);
      if (cats.length > 0 && !newProdCategoryId) {
        setNewProdCategoryId(cats[0].id);
      }
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

  const handleCreateProduct = async () => {
    if (!newProdName.trim() || !newProdPrice || !selectedTenant?.id) return;
    try {
      await posApi.createProduct({
        tenantId: selectedTenant.id,
        categoryId: newProdCategoryId || (categories[0]?.id),
        name: newProdName.trim(),
        urduName: newProdUrduName.trim() || undefined,
        barcode: newProdBarcode.trim() || undefined,
        costPricePKR: newProdCost,
        sellingPricePKR: newProdPrice,
        unit: newProdUnit,
        station: newProdStation,
        modifiers: newModifiers.length > 0 ? newModifiers : undefined
      });

      setIsAddProductOpen(false);
      // Reset form
      setNewProdName('');
      setNewProdUrduName('');
      setNewProdBarcode('');
      setNewProdCost(0);
      setNewProdPrice(0);
      setNewModifiers([]);
      fetchCatalog();
    } catch (err) {
      console.error(err);
      alert('Failed to save product');
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    try {
      await posApi.updateProduct(editingProduct.id, {
        categoryId: editingProduct.categoryId,
        name: editingProduct.name,
        urduName: editingProduct.urduName,
        barcode: editingProduct.barcode,
        costPricePKR: editingProduct.costPricePKR,
        sellingPricePKR: editingProduct.sellingPricePKR,
        station: editingProduct.station
      });
      setIsEditProductOpen(false);
      setEditingProduct(null);
      fetchCatalog();
    } catch (err) {
      console.error(err);
      alert('Failed to update product');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    try {
      await posApi.deleteProduct(id);
      fetchCatalog();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenRecipe = async (product: Product) => {
    setRecipeProduct(product);
    try {
      const branchId = selectedTenant?.branches?.[0]?.id || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const [rec, ings] = await Promise.all([
        posApi.getProductRecipe(product.id),
        posApi.getRawIngredients(branchId)
      ]);
      setRecipeItems(rec);
      setAvailableIngredients(ings);
      if (ings.length > 0) {
        setSelectedIngId(ings[0].id);
      }
    } catch (err) {
      console.error('Failed to load recipe', err);
    }
  };

  const handleAddRecipeItem = () => {
    if (!selectedIngId || selectedIngQty <= 0) return;
    const ing = availableIngredients.find(i => i.id === selectedIngId);
    if (!ing) return;

    const existingIdx = recipeItems.findIndex(r => r.ingredientId === selectedIngId);
    if (existingIdx > -1) {
      const updated = [...recipeItems];
      updated[existingIdx].quantityRequired += selectedIngQty;
      updated[existingIdx].estimatedCostPKR = Math.round(updated[existingIdx].quantityRequired * ing.costPerUnitPKR);
      setRecipeItems(updated);
    } else {
      setRecipeItems([...recipeItems, {
        id: `temp-${Date.now()}`,
        productId: recipeProduct?.id || '',
        ingredientId: ing.id,
        ingredientName: ing.name,
        ingredientCategory: ing.category,
        quantityRequired: selectedIngQty,
        unit: ing.unit,
        costPerUnitPKR: ing.costPerUnitPKR,
        estimatedCostPKR: Math.round(selectedIngQty * ing.costPerUnitPKR)
      }]);
    }
    setSelectedIngQty(1);
  };

  const handleRemoveRecipeItem = (ingredientId: string) => {
    setRecipeItems(recipeItems.filter(r => r.ingredientId !== ingredientId));
  };

  const handleSaveRecipe = async () => {
    if (!recipeProduct) return;
    setIsSavingRecipe(true);
    try {
      await posApi.saveProductRecipe(
        recipeProduct.id,
        recipeItems.map(r => ({
          ingredientId: r.ingredientId,
          quantityRequired: r.quantityRequired,
          unit: r.unit
        }))
      );
      setRecipeProduct(null);
      await fetchCatalog();
    } catch (err) {
      console.error(err);
      alert('Failed to save recipe');
    } finally {
      setIsSavingRecipe(false);
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

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <span>Menu, Catalog & Tax Setup Portal</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure menu items, prices in PKR, differentiated tax rates (16% Cash vs 8% Card), and catalog locking
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Menu Lock Status Toggle */}
          <button
            onClick={() => setIsMenuEditLocked(!isMenuEditLocked)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${
              isMenuEditLocked
                ? 'bg-amber-950/40 border-amber-800 text-amber-400'
                : 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
            }`}
            title="Toggle Managed Menu Service Lock"
          >
            {isMenuEditLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{isMenuEditLocked ? 'Menu Locked (Managed)' : 'Self-Edit Unlocked'}</span>
          </button>

          <button
            onClick={() => setIsAddProductOpen(true)}
            disabled={isMenuEditLocked}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Item</span>
          </button>
        </div>
      </div>

      {/* Managed Menu Banner (If Locked) */}
      {isMenuEditLocked && (
        <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Managed Menu Service Active:</strong> Menu edits and price revisions are controlled and updated by the SaaS Platform. Click "Self-Edit Unlocked" above to enable store-level modifications.
            </span>
          </div>
        </div>
      )}

      {/* Tax & Business Type Engine Configuration Card */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Percent className="w-4 h-4 text-emerald-400" />
              <span>Tax Configuration Engine (Cash vs Card Differentiated Rates)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Tax rates automatically adjust based on customer payment mode and business type
            </p>
          </div>

          <button
            onClick={handleSaveTaxSettings}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs shadow transition"
          >
            {taxSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{taxSaved ? 'Tax Rates Saved!' : 'Save Tax Rules'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Cash Tax Rate */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              💵 Cash Sales Tax Rate (%):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={localCashTax}
                onChange={(e) => setLocalCashTax(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-black text-white focus:outline-none focus:border-emerald-500"
              />
              <span className="text-slate-400 font-mono font-bold">%</span>
            </div>
            <p className="text-[10px] text-slate-500">Standard rate for cash tender (Default 16%)</p>
          </div>

          {/* Card / Digital Tax Rate */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              💳 Card / Digital Sales Tax Rate (%):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={localCardTax}
                onChange={(e) => setLocalCardTax(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-black text-emerald-400 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-slate-400 font-mono font-bold">%</span>
            </div>
            <p className="text-[10px] text-emerald-400">Reduced digital payment rate (Default 8%)</p>
          </div>

          {/* Tax Mode: Exclusive vs Inclusive */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <label className="block text-xs font-bold text-slate-300">
              Pricing Tax Mode:
            </label>
            <select
              value={localTaxMode}
              onChange={(e) => setLocalTaxMode(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="Exclusive">Tax Exclusive (Added on top at checkout)</option>
              <option value="Inclusive">Tax Inclusive (Included inside shelf price)</option>
            </select>
            <p className="text-[10px] text-slate-500">Exclusive is standard for Restaurants, Inclusive for Retail</p>
          </div>
        </div>
      </div>

      {/* Categories & Kitchen Stations Management Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Categories Manager */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>Active Product Categories ({categories.length})</span>
              </h3>
              <p className="text-[11px] text-slate-400">Organize your menu and catalog into categories</p>
            </div>
            <button
              onClick={() => {
                const catName = prompt('Enter new category name:');
                if (catName && catName.trim() && selectedTenant?.id) {
                  posApi.createCategory({
                    tenantId: selectedTenant.id,
                    name: catName.trim(),
                    icon: 'utensils',
                    sortOrder: categories.length + 1
                  }).then(() => fetchCatalog());
                }
              }}
              disabled={isMenuEditLocked}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow transition disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Category</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map(c => {
              const count = products.filter(p => p.categoryId === c.id).length;
              return (
                <div key={c.id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2.5 min-w-[140px]">
                  <div>
                    <div className="font-bold text-xs text-white">{c.name}</div>
                    <div className="text-[10px] text-slate-400">{count} items</div>
                  </div>
                  {!isMenuEditLocked && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete category "${c.name}"?`)) {
                          posApi.deleteCategory(c.id).then(() => fetchCatalog());
                        }
                      }}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded"
                      title="Delete Category"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Kitchen Stations Manager */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-xl">
          <div className="border-b border-slate-800 pb-2.5">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <span>Kitchen Stations (Mode 1 Dispatch Routing)</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Orders placed from POS or Order Tabs are automatically split and routed to these stations
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { name: 'Main Kitchen', id: 'MainKitchen', desc: 'Pizzas, Combos, Entrees', color: 'text-amber-400' },
              { name: 'Grill Station', id: 'Grill', desc: 'Burgers, Shawarma, Fries', color: 'text-rose-400' },
              { name: 'Beverage Bar', id: 'BeverageBar', desc: 'Drinks, Juices, Shakes', color: 'text-cyan-400' },
            ].map(station => (
              <div key={station.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className={`font-black text-xs ${station.color}`}>{station.name}</div>
                <div className="text-[10px] text-slate-400">{station.desc}</div>
                <div className="text-[9px] text-emerald-400 font-mono">Routing: Active</div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Catalog Table Section */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search products by name, Urdu name, or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none"
            >
              <option value="all">All Categories ({products.length})</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCatalog}
              className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
              title="Refresh Catalog"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Products Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="pb-3">Product Name</th>
                <th className="pb-3">Category</th>
                <th className="pb-3">Barcode / SKU</th>
                <th className="pb-3">Kitchen Station</th>
                <th className="pb-3 text-right">Cost (PKR)</th>
                <th className="pb-3 text-right">Selling Price (PKR)</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredProducts.map(p => (
                <tr key={p.id} className="hover:bg-slate-850/50 transition">
                  <td className="py-3">
                    <div className="font-bold text-white text-sm">{p.name}</div>
                    {p.urduName && <div className="text-[11px] text-slate-400 font-sans">{p.urduName}</div>}
                  </td>
                  <td className="py-3 text-slate-300">{p.category?.name || 'Category'}</td>
                  <td className="py-3 font-mono text-slate-400">{p.barcode}</td>
                  <td className="py-3">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold">
                      {p.station}
                    </span>
                  </td>
                  <td className="py-3 text-right text-slate-400">₨{p.costPricePKR.toLocaleString()}</td>
                  <td className="py-3 text-right font-black text-emerald-400 text-sm">
                    ₨{p.sellingPricePKR.toLocaleString()}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenRecipe(p)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 text-[10px] font-bold transition"
                        title="Configure Recipe / Raw Ingredients (BOM)"
                      >
                        <Wheat className="w-3 h-3" />
                        <span>Recipe</span>
                      </button>

                      <button
                        onClick={() => {
                          setEditingProduct(p);
                          setIsEditProductOpen(true);
                        }}
                        disabled={isMenuEditLocked}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-40"
                        title="Edit Price & Details"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteProduct(p.id)}
                        disabled={isMenuEditLocked}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-400 transition disabled:opacity-40"
                        title="Delete Product"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal */}
      {isAddProductOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                <span>Add New Catalog Item</span>
              </h3>
              <button onClick={() => setIsAddProductOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Item Name (English)*</label>
                  <input
                    type="text"
                    placeholder="e.g. Chicken Fajita Pizza (L)"
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Urdu Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. چکن فجیتا پیزا"
                    value={newProdUrduName}
                    onChange={(e) => setNewProdUrduName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Category*</label>
                  <select
                    value={newProdCategoryId}
                    onChange={(e) => setNewProdCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Barcode / SKU</label>
                  <input
                    type="text"
                    placeholder="Scan or auto-generate"
                    value={newProdBarcode}
                    onChange={(e) => setNewProdBarcode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Selling Price (PKR)*</label>
                  <input
                    type="number"
                    value={newProdPrice || ''}
                    onChange={(e) => setNewProdPrice(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Cost Price (PKR)</label>
                  <input
                    type="number"
                    value={newProdCost || ''}
                    onChange={(e) => setNewProdCost(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Kitchen Station</label>
                  <select
                    value={newProdStation}
                    onChange={(e) => setNewProdStation(e.target.value as KitchenStation)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="MainKitchen">Main Kitchen</option>
                    <option value="Grill">Grill Station</option>
                    <option value="BeverageBar">Beverage Bar</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Unit</label>
                  <input
                    type="text"
                    value={newProdUnit}
                    onChange={(e) => setNewProdUnit(e.target.value)}
                    placeholder="Piece, Plate, Can, Kg"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
              </div>

              {/* Modifiers Builder */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <label className="block text-slate-400 font-semibold">Custom Modifiers (e.g. Extra Cheese)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Modifier Name"
                    value={modNameInput}
                    onChange={(e) => setModNameInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                  <input
                    type="number"
                    placeholder="Price PKR"
                    value={modPriceInput || ''}
                    onChange={(e) => setModPriceInput(Number(e.target.value) || 0)}
                    className="w-24 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!modNameInput.trim()) return;
                      setNewModifiers([...newModifiers, { name: modNameInput.trim(), pricePKR: modPriceInput }]);
                      setModNameInput('');
                      setModPriceInput(0);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-emerald-400 font-bold"
                  >
                    + Add
                  </button>
                </div>

                {newModifiers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {newModifiers.map((m, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] flex items-center gap-1">
                        <span>{m.name} (+₨{m.pricePKR})</span>
                        <button
                          type="button"
                          onClick={() => setNewModifiers(newModifiers.filter((_, i) => i !== idx))}
                          className="text-slate-500 hover:text-rose-400"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleCreateProduct}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Save Product
            </button>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {isEditProductOpen && editingProduct && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="font-bold text-sm text-white">Edit Product Pricing & Details</h3>
              <button onClick={() => setIsEditProductOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Product Name</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Selling Price (PKR)</label>
                <input
                  type="number"
                  value={editingProduct.sellingPricePKR}
                  onChange={(e) => setEditingProduct({ ...editingProduct, sellingPricePKR: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-black text-emerald-400"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Cost Price (PKR)</label>
                <input
                  type="number"
                  value={editingProduct.costPricePKR}
                  onChange={(e) => setEditingProduct({ ...editingProduct, costPricePKR: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Barcode</label>
                <input
                  type="text"
                  value={editingProduct.barcode}
                  onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>
            </div>

            <button
              onClick={handleUpdateProduct}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Update Product
            </button>
          </div>
        </div>
      )}

      {/* Recipe (Bill of Materials) Configuration Modal */}
      {recipeProduct && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wheat className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-bold text-white text-base">Recipe & Raw Materials (BOM)</h3>
                  <div className="text-xs text-slate-400">Configure ingredient deduction for: <span className="text-amber-400 font-bold">{recipeProduct.name}</span></div>
                </div>
              </div>
              <button onClick={() => setRecipeProduct(null)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            {/* Current Recipe Ingredients List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Required Ingredients per Sale:</div>
              {recipeItems.length === 0 ? (
                <div className="p-6 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  No ingredients configured for this item yet. Add buns, meat, sauces, cheese, fries, etc. below.
                </div>
              ) : (
                recipeItems.map(item => (
                  <div key={item.ingredientId} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white text-xs">{item.ingredientName}</div>
                      <div className="text-[10px] text-slate-400">{item.ingredientCategory} • ₨{item.costPerUnitPKR} / {item.unit}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-800 text-xs font-mono font-bold">
                        {item.quantityRequired} {item.unit}
                      </span>
                      <span className="text-xs font-mono text-emerald-400 font-semibold min-w-[60px] text-right">
                        ₨{item.estimatedCostPKR}
                      </span>
                      <button
                        onClick={() => handleRemoveRecipeItem(item.ingredientId)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition"
                        title="Remove from recipe"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Calculated Raw Cost Summary */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Calculated Ingredient Cost per Portion:</span>
              <span className="text-base font-black text-emerald-400 font-mono">
                ₨{recipeItems.reduce((s, i) => s + (i.estimatedCostPKR || 0), 0).toLocaleString()}
              </span>
            </div>

            {/* Add Ingredient to Recipe Row */}
            <div className="p-3 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
              <div className="text-xs font-bold text-slate-300">Add Ingredient to Recipe:</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <select
                    value={selectedIngId}
                    onChange={(e) => setSelectedIngId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-semibold text-white focus:outline-none"
                  >
                    {availableIngredients.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit} - ₨{i.costPerUnitPKR})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    placeholder="Qty"
                    value={selectedIngQty}
                    onChange={(e) => setSelectedIngQty(Number(e.target.value))}
                    className="w-20 px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-bold text-white text-center focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddRecipeItem}
                    className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition"
                  >
                    + Add
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Action Buttons */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecipeProduct(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingRecipe}
                onClick={handleSaveRecipe}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-slate-950 font-black text-xs hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/30 disabled:opacity-50"
              >
                {isSavingRecipe ? 'Saving Recipe...' : 'Save Recipe & Recalculate Cost'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

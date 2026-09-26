import React, { useState, useEffect } from 'react';
import {
  Search,
  Lock,
  Check,
  Wheat,
  Eye,
  Plus,
  Trash2,
  Edit,
  X,
  FolderOpen,
  Hash,
  ShieldCheck,
  Package,
  Wand2
} from 'lucide-react';

import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import { ManagerOverrideModal, type ManagerOverrideResult } from '../components/ManagerOverrideModal';
import { toUrdu } from '../utils/urduTransliterate';
import type { Product, Category, ProductRecipeItem, KitchenStation } from '../types';

/** Mirrors CreateProductDto on the server. */
interface ProductForm {
  categoryId: string;
  name: string;
  urduName: string;
  sku: string;
  barcode: string;
  description: string;
  costPricePKR: number;
  sellingPricePKR: number;
  unit: string;
  station: KitchenStation;
  imageUrl: string;
  modifiers: { name: string; pricePKR: number }[];
}

const EMPTY_PRODUCT_FORM: ProductForm = {
  categoryId: '', name: '', urduName: '', sku: '', barcode: '', description: '',
  costPricePKR: 0, sellingPricePKR: 0, unit: 'Piece', station: 'MainKitchen',
  imageUrl: '', modifiers: []
};

const STATIONS: { value: KitchenStation; label: string }[] = [
  { value: 'MainKitchen', label: 'Main Kitchen' },
  { value: 'Grill', label: 'Grill' },
  { value: 'BeverageBar', label: 'Beverage Bar' }
];

const UNITS = ['Piece', 'Plate', 'Portion', 'Glass', 'Bottle', 'Kg', 'Gram', 'Litre'];

/**
 * Fields the server's UpdateProductDto does not carry, so they can only be set at creation.
 * The PUT leaves them untouched rather than nulling them, so showing them disabled on an
 * edit is honest: the value survives, it just cannot be changed here.
 */
const CREATE_ONLY_FIELDS = 'SKU, description, unit, image and modifiers';

export const MenuManagement: React.FC = () => {
  const {
    selectedTenant,
    currentUser,
    permissions,
    modulePermissions
  } = usePosStore();

  // Own permission to change prices / tax. The backend independently re-checks
  // this on every write — unlocking here only reveals the inputs.
  const canEditPricing =
    !!permissions?.canManageMenuAndTax ||
    hasModuleAccess(currentUser?.role, modulePermissions, 'menu', 'edit');

  // Manager Override: another user authorized a single price edit.
  const [override, setOverride] = useState<ManagerOverrideResult | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<Product | null>(null);
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);

  // Inline price editing
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<number>(0);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceMessage, setPriceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'categories' | 'products'>('overview');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Recipe (BOM) Modal states
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeItems, setRecipeItems] = useState<ProductRecipeItem[]>([]);

  // Category CRUD states
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catFormName, setCatFormName] = useState('');
  const [catFormLocalName, setCatFormLocalName] = useState('');
  const [catFormSort, setCatFormSort] = useState(0);
  const [catSaving, setCatSaving] = useState(false);
  const [catDeleteId, setCatDeleteId] = useState<string | null>(null);

  // Product CRUD states
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodForm, setProdForm] = useState<ProductForm>({ ...EMPTY_PRODUCT_FORM });
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodDeleteTarget, setProdDeleteTarget] = useState<Product | null>(null);
  const [prodDeleteError, setProdDeleteError] = useState<string | null>(null);
  /** Once the Urdu name is edited by hand it stops following the English one — a suggestion
   *  should never overwrite something a person deliberately typed. */
  const [urduTouched, setUrduTouched] = useState(false);

  const fetchCatalog = async () => {
    // See OrderTab: an unscoped catalogue request 401s for a token that carries no tenant, and
    // the response interceptor treats that as an expired session and signs the user out.
    if (!selectedTenant?.id) return;
    try {
      const cats = await posApi.getCategories(selectedTenant.id);
      const prods = await posApi.getProducts({ tenantId: selectedTenant.id });
      setCategories(cats);
      setProducts(prods);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, [selectedTenant?.id]);

  /** Open the inline price editor, prompting for a manager override if needed. */
  const startPriceEdit = (product: Product) => {
    if (!canEditPricing && !override) {
      setOverrideTarget(product);
      setIsOverrideOpen(true);
      return;
    }
    setEditingPriceId(product.id);
    setPriceDraft(product.sellingPricePKR);
    setPriceMessage(null);
  };

  const handleOverrideAuthorized = (result: ManagerOverrideResult) => {
    setOverride(result);
    if (overrideTarget) {
      setEditingPriceId(overrideTarget.id);
      setPriceDraft(overrideTarget.sellingPricePKR);
      setOverrideTarget(null);
    }
  };

  const handleSavePrice = async (product: Product) => {
    if (priceDraft < 0 || Number.isNaN(priceDraft)) {
      setPriceMessage({ type: 'error', text: 'Enter a valid price' });
      return;
    }
    setPriceSaving(true);
    setPriceMessage(null);
    try {
      await posApi.updateProduct(product.id, {
        tenantId: product.tenantId,
        categoryId: product.categoryId,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        urduName: product.urduName,
        description: product.description,
        costPricePKR: product.costPricePKR,
        sellingPricePKR: priceDraft,
        unit: product.unit,
        station: product.station,
        isActive: product.isActive,
        // Attached so the server can record who authorized an override edit. It
        // re-verifies independently; a forged value here changes nothing.
        authorizedByUserId: override?.authorizedByUserId
      });
      await fetchCatalog();
      setEditingPriceId(null);
      setPriceMessage({
        type: 'success',
        text: override?.authorizedByName
          ? `Price updated — authorized by ${override.authorizedByName}`
          : 'Price updated'
      });
      // An override unlocks exactly one edit.
      setOverride(null);
      setTimeout(() => setPriceMessage(null), 3500);
    } catch (err) {
      setPriceMessage({
        type: 'error',
        text: getApiErrorMessage(err, 'Not authorized to change this price')
      });
    } finally {
      setPriceSaving(false);
    }
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
    setCatFormLocalName('');
    setCatFormSort(categories.length);
    setShowCategoryModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatFormName(cat.name);
    setCatFormLocalName(cat.localName || '');
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
          localName: catFormLocalName.trim() || undefined,
          icon: 'utensils',
          sortOrder: catFormSort
        });
      } else {
        await posApi.createCategory({
          tenantId: selectedTenant.id,
          name: catFormName.trim(),
          localName: catFormLocalName.trim() || undefined,
          icon: 'utensils',
          sortOrder: catFormSort
        });
      }
      await fetchCatalog();
      setShowCategoryModal(false);
      setEditingCategory(null);
      setCatFormName('');
      setCatFormLocalName('');
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

  // ── Products ───────────────────────────────────────────────────────────
  const setProdField = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setProdForm(prev => ({ ...prev, [key]: value }));

  /** Typing the English name drafts the Urdu one alongside it, until the user takes over. */
  const handleNameChange = (value: string) =>
    setProdForm(prev => ({
      ...prev,
      name: value,
      urduName: urduTouched ? prev.urduName : toUrdu(value)
    }));

  const regenerateUrdu = () => {
    setUrduTouched(false);
    setProdField('urduName', toUrdu(prodForm.name));
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setProdError(null);
    setUrduTouched(false);
    setProdForm({
      ...EMPTY_PRODUCT_FORM,
      // Pre-select whichever category the user is already filtered to, else the first one.
      categoryId: selectedCategory !== 'all' ? selectedCategory : (categories[0]?.id ?? '')
    });
    setShowProductModal(true);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProdError(null);
    // An existing product's Urdu name was written by somebody; renaming the item in English
    // must not silently rewrite it. The regenerate button is there if they do want that.
    setUrduTouched(true);
    setProdForm({
      categoryId: product.categoryId,
      name: product.name,
      urduName: product.urduName || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      description: product.description || '',
      costPricePKR: product.costPricePKR,
      sellingPricePKR: product.sellingPricePKR,
      unit: product.unit || 'Piece',
      station: product.station,
      imageUrl: product.imageUrl || '',
      modifiers: (product.modifiers || []).map(m => ({ name: m.name, pricePKR: m.pricePKR }))
    });
    setShowProductModal(true);
  };

  const handleSaveProduct = async () => {
    if (!prodForm.name.trim() || !prodForm.categoryId || !selectedTenant?.id) return;
    setProdSaving(true);
    setProdError(null);
    try {
      if (editingProduct) {
        // UpdateProductDto is narrower than CreateProductDto — it carries only these seven
        // fields, and the server leaves everything else on the row as it was.
        await posApi.updateProduct(editingProduct.id, {
          categoryId: prodForm.categoryId,
          name: prodForm.name.trim(),
          urduName: prodForm.urduName.trim() || undefined,
          barcode: prodForm.barcode.trim() || undefined,
          costPricePKR: prodForm.costPricePKR,
          sellingPricePKR: prodForm.sellingPricePKR,
          station: prodForm.station
        });
      } else {
        await posApi.createProduct({
          tenantId: selectedTenant.id,
          categoryId: prodForm.categoryId,
          name: prodForm.name.trim(),
          urduName: prodForm.urduName.trim() || undefined,
          // Left blank, the server generates both.
          sku: prodForm.sku.trim() || undefined,
          barcode: prodForm.barcode.trim() || undefined,
          description: prodForm.description.trim() || undefined,
          costPricePKR: prodForm.costPricePKR,
          sellingPricePKR: prodForm.sellingPricePKR,
          unit: prodForm.unit,
          station: prodForm.station,
          imageUrl: prodForm.imageUrl.trim() || undefined,
          modifiers: prodForm.modifiers
            .filter(m => m.name.trim())
            .map(m => ({ name: m.name.trim(), pricePKR: m.pricePKR }))
        });
      }
      await fetchCatalog();
      setShowProductModal(false);
      setEditingProduct(null);
    } catch (err) {
      setProdError(getApiErrorMessage(err, 'Could not save this product'));
    } finally {
      setProdSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!prodDeleteTarget) return;
    setProdDeleteError(null);
    try {
      await posApi.deleteProduct(prodDeleteTarget.id);
      await fetchCatalog();
      setProdDeleteTarget(null);
    } catch (err) {
      // A product that already appears on an order cannot be removed — the order line still
      // references it. Say so rather than failing silently.
      setProdDeleteError(getApiErrorMessage(err, 'Could not delete this product. It may already appear on past orders.'));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>Menu & Catalog Setup Portal</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage menu items, categories, kitchen routing, and prices in PKR.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-0">
        {[
          { id: 'overview' as const, label: 'Overview' },
          { id: 'categories' as const, label: `Categories (${categories.length})` },
          { id: 'products' as const, label: `Products (${products.length})` },
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

      {/* Pricing permission banner */}
      {!canEditPricing && (
        <div className={`p-3.5 rounded-2xl border text-xs flex items-center gap-3 ${
          override
            ? 'bg-teal-50 border-teal-200 text-teal-800'
            : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          {override ? <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" /> : <Lock className="w-4 h-4 text-slate-400 shrink-0" />}
          <span>
            {override ? (
              <>
                <strong>Override active:</strong> {override.authorizedByName || 'A manager'} authorized one
                price or tax change. It expires after you save.
              </>
            ) : (
              <>
                <strong>View only:</strong> your account cannot change prices or tax rules. Click a price
                to request a manager override.
              </>
            )}
          </span>
        </div>
      )}

      {priceMessage && (
        <div className={`px-4 py-2.5 rounded-2xl text-xs font-semibold border ${
          priceMessage.type === 'success'
            ? 'bg-teal-50 text-teal-700 border-teal-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
        }`}>
          {priceMessage.text}
        </div>
      )}

      <ManagerOverrideModal
        isOpen={isOverrideOpen}
        onClose={() => { setIsOverrideOpen(false); setOverrideTarget(null); }}
        requiredPermission="canManageMenuAndTax"
        actionLabel={
          overrideTarget
            ? `Change the price of "${overrideTarget.name}"`
            : 'Change menu prices or tax configuration'
        }
        onAuthorized={handleOverrideAuthorized}
      />

      {/* ═══════ OVERVIEW TAB ═══════ */}
      {activeTab === 'overview' && (
        <>
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
                      {c.localName && <div className="text-[10px] text-slate-500 font-medium">{c.localName}</div>}
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
                      <td className="py-3 text-right">
                        {editingPriceId === p.id ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              autoFocus
                              value={priceDraft}
                              onChange={(e) => setPriceDraft(Number(e.target.value))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSavePrice(p);
                                if (e.key === 'Escape') setEditingPriceId(null);
                              }}
                              className="w-24 px-2 py-1 bg-white border border-teal-400 rounded-lg text-right text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                            />
                            <button
                              onClick={() => handleSavePrice(p)}
                              disabled={priceSaving}
                              className="p-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white transition cursor-pointer"
                              title="Save price"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingPriceId(null)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 transition cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startPriceEdit(p)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-black text-teal-600 text-sm hover:bg-teal-50 transition cursor-pointer"
                            title={canEditPricing || override ? 'Click to edit price' : 'Requires manager authorization'}
                          >
                            {!canEditPricing && !override && <Lock className="w-3 h-3 text-amber-500" />}
                            {p.sellingPricePKR.toLocaleString()}
                          </button>
                        )}
                      </td>
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
                    <th className="pb-3">Local Name</th>
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
                        <td className="py-3">
                          {cat.localName ? (
                            <div className="text-sm text-slate-600 font-medium">{cat.localName}</div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
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

      {/* ═══════ PRODUCTS TAB ═══════ */}
      {activeTab === 'products' && (
        <div className="p-5 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Package className="w-4 h-4 text-teal-500" />
                <span>Products</span>
              </h2>
              <p className="text-xs text-slate-500">
                {products.length} items • Every product belongs to a category
              </p>
            </div>
            {/* The server requires CanManageMenuAndTax for create/update/delete alike, so a
                view-only account gets a disabled button rather than a guaranteed 403. */}
            <button
              onClick={openAddProduct}
              disabled={categories.length === 0 || !canEditPricing}
              title={
                !canEditPricing
                  ? 'Your account cannot add menu items'
                  : categories.length === 0
                    ? 'Create a category first'
                    : undefined
              }
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-md shadow-teal-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          </div>

          {/* A product cannot exist without a category, so send them there first. */}
          {categories.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FolderOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No categories yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Products are organized by category — create one before adding items.
              </p>
              <button
                onClick={() => setActiveTab('categories')}
                className="mt-4 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
              >
                Go to Categories
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Search by name, Urdu name, or barcode..."
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

              {filteredProducts.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Package className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">
                    {products.length === 0 ? 'No products yet' : 'Nothing matches that search'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {products.length === 0
                      ? 'Add your first menu item to start selling'
                      : 'Try a different name, barcode or category'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                        <th className="pb-3">Product</th>
                        <th className="pb-3">Category</th>
                        <th className="pb-3">SKU</th>
                        <th className="pb-3">Station</th>
                        <th className="pb-3 text-right">Cost</th>
                        <th className="pb-3 text-right">Price</th>
                        <th className="pb-3 text-right">Margin</th>
                        <th className="pb-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.map(p => {
                        const margin = p.sellingPricePKR - p.costPricePKR;
                        const marginPct = p.sellingPricePKR > 0
                          ? Math.round((margin / p.sellingPricePKR) * 100)
                          : 0;
                        return (
                          <tr key={p.id} className="hover:bg-slate-50 transition">
                            <td className="py-3">
                              <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                              {p.urduName && <div className="text-[11px] text-slate-500">{p.urduName}</div>}
                            </td>
                            <td className="py-3 text-slate-600">
                              {categories.find(c => c.id === p.categoryId)?.name || (
                                <span className="text-slate-300">Uncategorized</span>
                              )}
                            </td>
                            <td className="py-3 font-mono text-slate-500">{p.sku || '—'}</td>
                            <td className="py-3">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                                {STATIONS.find(s => s.value === p.station)?.label || p.station}
                              </span>
                            </td>
                            <td className="py-3 text-right font-mono text-slate-500">
                              {p.costPricePKR.toLocaleString()}
                            </td>
                            <td className="py-3 text-right font-mono font-bold text-teal-600">
                              {p.sellingPricePKR.toLocaleString()}
                            </td>
                            <td className="py-3 text-right font-mono">
                              <span className={margin >= 0 ? 'text-slate-600' : 'text-rose-600 font-bold'}>
                                {margin.toLocaleString()}
                                <span className="text-[10px] text-slate-400 ml-1">({marginPct}%)</span>
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => openEditProduct(p)}
                                  disabled={!canEditPricing}
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={canEditPricing ? 'Edit product' : 'Your account cannot edit menu items'}
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => { setProdDeleteTarget(p); setProdDeleteError(null); }}
                                  disabled={!canEditPricing}
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={canEditPricing ? 'Delete product' : 'Your account cannot remove menu items'}
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
            </>
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
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Local Name <span className="text-slate-400 normal-case">(optional)</span></label>
                <input
                  type="text"
                  value={catFormLocalName}
                  onChange={(e) => setCatFormLocalName(e.target.value)}
                  placeholder="e.g. برگرز"
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

      {/* ═══════ PRODUCT ADD/EDIT MODAL ═══════ */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 p-5 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {editingProduct
                    ? `${CREATE_ONLY_FIELDS} can't be changed after creation`
                    : 'Leave SKU or barcode blank and one will be generated for you'}
                </p>
              </div>
              <button
                onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {prodError && (
                <div className="px-4 py-2.5 rounded-xl text-xs font-semibold border bg-rose-50 text-rose-700 border-rose-200">
                  {prodError}
                </div>
              )}

              {/* Category is the link the whole catalog hangs off, so it leads. */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={prodForm.categoryId}
                  onChange={(e) => setProdField('categoryId', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  <option value="">Select a category...</option>
                  {categories.sort((a, b) => a.sortOrder - b.sortOrder).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Product Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={prodForm.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Classic Smash Burger"
                    autoFocus
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Urdu Name{' '}
                      <span className="text-slate-400 normal-case">
                        {urduTouched ? '(edited)' : '(auto)'}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={regenerateUrdu}
                      disabled={!prodForm.name.trim()}
                      title="Regenerate from the English name"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 text-[10px] font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Wand2 className="w-3 h-3" />
                      <span>Regenerate</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    dir="rtl"
                    value={prodForm.urduName}
                    onChange={(e) => { setUrduTouched(true); setProdField('urduName', e.target.value); }}
                    placeholder="کلاسک سمیش برگر"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Suggested by sound from the English name — check it before saving.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Cost Price <span className="text-slate-400 normal-case">(PKR)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prodForm.costPricePKR}
                    onChange={(e) => setProdField('costPricePKR', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Selling Price <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prodForm.sellingPricePKR}
                    onChange={(e) => setProdField('sellingPricePKR', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Margin</label>
                  <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-600">
                    {(prodForm.sellingPricePKR - prodForm.costPricePKR).toLocaleString()}
                    <span className="text-[10px] text-slate-400 ml-1">
                      ({prodForm.sellingPricePKR > 0
                        ? Math.round(((prodForm.sellingPricePKR - prodForm.costPricePKR) / prodForm.sellingPricePKR) * 100)
                        : 0}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Kitchen Station</label>
                  <select
                    value={prodForm.station}
                    onChange={(e) => setProdField('station', e.target.value as KitchenStation)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  >
                    {STATIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Unit</label>
                  <select
                    value={prodForm.unit}
                    onChange={(e) => setProdField('unit', e.target.value)}
                    disabled={!!editingProduct}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Barcode</label>
                  <input
                    type="text"
                    value={prodForm.barcode}
                    onChange={(e) => setProdField('barcode', e.target.value)}
                    placeholder="Auto"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 font-mono focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">SKU</label>
                  <input
                    type="text"
                    value={prodForm.sku}
                    onChange={(e) => setProdField('sku', e.target.value)}
                    placeholder="Auto"
                    disabled={!!editingProduct}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 font-mono focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Image URL <span className="text-slate-400 normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={prodForm.imageUrl}
                    onChange={(e) => setProdField('imageUrl', e.target.value)}
                    placeholder="https://... — blank uses an emoji"
                    disabled={!!editingProduct}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Description <span className="text-slate-400 normal-case">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={prodForm.description}
                  onChange={(e) => setProdField('description', e.target.value)}
                  disabled={!!editingProduct}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed resize-none"
                />
              </div>

              {/* Modifiers — these are what put the CUSTOM badge on the POS tile. */}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Modifiers <span className="text-slate-400 normal-case">(add-ons priced separately)</span>
                  </label>
                  {!editingProduct && (
                    <button
                      onClick={() => setProdField('modifiers', [...prodForm.modifiers, { name: '', pricePKR: 0 }])}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add</span>
                    </button>
                  )}
                </div>

                {prodForm.modifiers.length === 0 ? (
                  <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-400">
                    {editingProduct
                      ? 'None. Modifiers can only be set when the product is created.'
                      : 'None yet — e.g. "Extra Cheese" at 120'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {prodForm.modifiers.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={m.name}
                          onChange={(e) => {
                            const next = [...prodForm.modifiers];
                            next[i] = { ...next[i], name: e.target.value };
                            setProdField('modifiers', next);
                          }}
                          placeholder="e.g. Extra Cheese"
                          disabled={!!editingProduct}
                          className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none disabled:opacity-50"
                        />
                        <input
                          type="number"
                          min="0"
                          value={m.pricePKR}
                          onChange={(e) => {
                            const next = [...prodForm.modifiers];
                            next[i] = { ...next[i], pricePKR: Number(e.target.value) };
                            setProdField('modifiers', next);
                          }}
                          disabled={!!editingProduct}
                          className="w-24 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 font-mono focus:border-teal-500 focus:outline-none disabled:opacity-50"
                        />
                        {!editingProduct && (
                          <button
                            onClick={() => setProdField('modifiers', prodForm.modifiers.filter((_, j) => j !== i))}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-200 p-5 pt-3">
              <button
                onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProduct}
                disabled={!prodForm.name.trim() || !prodForm.categoryId || prodSaving}
                className="flex-1 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-md shadow-teal-500/25 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {prodSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{editingProduct ? 'Update Product' : 'Create Product'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ PRODUCT DELETE CONFIRM ═══════ */}
      {prodDeleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto mb-3">
                <Trash2 className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Delete "{prodDeleteTarget.name}"?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This removes the item from the menu permanently. Items that already appear on past
                orders cannot be deleted.
              </p>
            </div>

            {prodDeleteError && (
              <div className="px-3 py-2 rounded-xl text-[11px] font-semibold border bg-rose-50 text-rose-700 border-rose-200">
                {prodDeleteError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => { setProdDeleteTarget(null); setProdDeleteError(null); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProduct}
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

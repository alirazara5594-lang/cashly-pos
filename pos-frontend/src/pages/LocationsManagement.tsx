import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Store,
  Warehouse,
  Plus,
  Pencil,
  Save,
  X,
  MapPin,
  Landmark,
  Scale,
  Trash2,
  Check,
  Monitor
} from 'lucide-react';
import { usePosStore, hasModuleAccess, normalizeRole } from '../store/posStore';
import { posApi, getApiErrorMessage } from '../services/api';
import { tierLabel } from '../utils/tierLabel';
import type {
  Branch,
  BusinessPolicies,
  Company,
  LocationType,
  PublicPackage,
  Region,
  SubscriptionTier,
  TaxJurisdiction
} from '../types';

const POS_EDITIONS: SubscriptionTier[] = ['Starter', 'Standard', 'Professional'];

/** "3 tills, 10 tablets, kitchen screens" for a POS version, from the server's own price list. */
function editionSummary(edition: SubscriptionTier, packages: PublicPackage[]): string {
  const pkg = packages.find(p => p.packageKey.toLowerCase() === edition.toLowerCase());
  if (!pkg) return '';
  const count = (n: number) => (n >= 999 ? 'unlimited' : String(n));
  return `${count(pkg.maxCounters)} till${pkg.maxCounters === 1 ? '' : 's'}, ${count(pkg.maxOrderTabs)} tablets`
    + (pkg.hasKitchenDisplay ? ', kitchen screens' : '');
}

/** Sent as a region id to take a location out of its region. */
const NO_REGION = '00000000-0000-0000-0000-000000000000';

type Tab = 'locations' | 'companies' | 'regions' | 'policies';

interface LocationForm {
  id?: string;
  type: LocationType;
  name: string;
  code: string;
  city: string;
  address: string;
  phone: string;
  taxRegion: string;
  canSell: boolean;
  holdsStock: boolean;
  companyId: string;
  regionId: string;
  /** The branch's POS version, and what it was when the form opened (only a change is sent). */
  posEdition: SubscriptionTier;
  originalPosEdition?: SubscriptionTier;
}

interface CompanyForm {
  id?: string;
  legalName: string;
  tradeName: string;
  taxRegistrationNumber: string;
  salesTaxRegistrationNumber: string;
  address: string;
}

interface RegionForm {
  id?: string;
  name: string;
  code: string;
}

/** Older rows carry only isHeadOffice; newer ones say what they are. */
function typeOf(b: Branch): LocationType {
  return b.locationType ?? (b.isHeadOffice ? 'HeadOffice' : 'Branch');
}

const TYPE_LABEL: Record<LocationType, string> = {
  Branch: 'Branch',
  HeadOffice: 'Head office',
  Warehouse: 'Warehouse'
};

const inputClass =
  'w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';
const labelClass = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';
/** Every list the page shows. Each stands alone: one failing (a missing permission, say) must not blank the rest. */
const fetchPageData = () => Promise.allSettled([
  posApi.getBranches(),
  posApi.getCompanies(),
  posApi.getRegions(),
  posApi.getPolicies(),
  posApi.getTaxJurisdictions(),
  posApi.getPublicPackages()
]);
type PageData = Awaited<ReturnType<typeof fetchPageData>>;

const primaryButton =
  'px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer';
const secondaryButton =
  'px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-2 border border-slate-200 transition cursor-pointer';

/**
 * Where the business sells, where it keeps stock, which legal entity each location trades under,
 * and who decides what once there is more than one location.
 */
export const LocationsManagement: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, modulePermissions, setTenants, selectBranch, loadMyPackageFeatures, selectedTenant } = usePosStore();
  /** A branch without a version of its own runs on the business's plan. */
  const planEdition: SubscriptionTier = selectedTenant?.tier ?? 'Standard';
  const editionOf = (b: Branch): SubscriptionTier => b.posEdition ?? planEdition;

  /** A branch's till is connected by pairing: open the device screen with this branch picked. */
  const connectTill = (branchId: string) =>
    navigate('/settings', { state: { tab: 'provisioning', branchId } });
  // The owner alone adds selling locations and sets POS versions (what the business pays for);
  // an HQ admin runs everything else.
  const isOwner = ['OwnerAdmin', 'SuperAdmin'].includes(normalizeRole(currentUser?.role) ?? '');
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'admin', 'edit');
  // Policies govern every branch, so staff signed in at one branch may read them but not change them.
  const canSetPolicies = canEdit && !currentUser?.branchId;
  // A branch's POS version is what the business pays for: the owner sets it, never the branch
  // (nor an HQ admin, who runs the business but not its bill).
  const canSetEdition = canEdit && !currentUser?.branchId && isOwner;

  const [tab, setTab] = useState<Tab>('locations');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [policies, setPolicies] = useState<BusinessPolicies | null>(null);
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdiction[]>([]);
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [hqForm, setHqForm] = useState({ name: 'Head Office', city: '', address: '', phone: '', holdsStock: false });
  const [locationForm, setLocationForm] = useState<LocationForm | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyForm | null>(null);
  const [regionForm, setRegionForm] = useState<RegionForm | null>(null);

  // The page starts in the loading state; later reloads (after a save) refresh in place.
  const apply = useCallback(([b, c, r, p, j, k]: PageData) => {
    if (k.status === 'fulfilled') setPackages(Array.isArray(k.value) ? k.value : []);
    if (b.status === 'fulfilled') setBranches(Array.isArray(b.value) ? b.value : []);
    else setMessage({ type: 'error', text: getApiErrorMessage(b.reason, 'Could not load your locations.') });
    if (c.status === 'fulfilled') setCompanies(Array.isArray(c.value) ? c.value : []);
    if (r.status === 'fulfilled') setRegions(Array.isArray(r.value) ? r.value : []);
    if (p.status === 'fulfilled') setPolicies(p.value);
    if (j.status === 'fulfilled') setJurisdictions(Array.isArray(j.value) ? j.value.filter(x => x.isActive) : []);
    setLoading(false);
  }, []);

  const load = useCallback(async () => apply(await fetchPageData()), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchPageData().then(data => { if (!cancelled) apply(data); });
    return () => { cancelled = true; };
  }, [apply]);

  /** The header's branch picker and the app's surface read the store; bring it up to date. */
  const refreshStore = async () => {
    try {
      const keep = usePosStore.getState().selectedBranch?.id;
      const tenants = await posApi.getTenants();
      setTenants(tenants);
      const again = tenants[0]?.branches?.find(x => x.id === keep);
      if (again) selectBranch(again);
      await loadMyPackageFeatures();
    } catch {
      // The page's own lists are already fresh; the header catches up on the next load.
    }
  };

  const flash = (type: 'success' | 'error', text: string) => setMessage({ type, text });

  const headOffice = useMemo(() => branches.find(b => typeOf(b) === 'HeadOffice') ?? null, [branches]);
  const sellingCount = branches.filter(b => b.canSell !== false).length;
  const warehouseCount = branches.filter(b => typeOf(b) === 'Warehouse').length;
  const companyName = (id?: string | null) => companies.find(c => c.id === id)?.legalName ?? '—';
  const regionName = (id?: string | null) => regions.find(r => r.id === id)?.name ?? '—';
  const defaultCompanyId = companies.find(c => c.isDefault)?.id ?? companies[0]?.id ?? '';

  // ---------------------------------------------------------------- head office

  const handleEnableHeadOffice = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await posApi.enableHeadOffice({
        name: hqForm.name.trim() || undefined,
        city: hqForm.city.trim() || undefined,
        address: hqForm.address.trim() || undefined,
        phone: hqForm.phone.trim() || undefined,
        holdsStock: hqForm.holdsStock
      });
      flash('success', res.message || 'Head office created.');
      await load();
      await refreshStore();
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not set up the head office.'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- locations

  const openNewLocation = (type: 'Branch' | 'Warehouse') => {
    setLocationForm({
      type,
      name: '',
      code: '',
      city: '',
      address: '',
      phone: '',
      taxRegion: '',
      canSell: type === 'Branch',
      holdsStock: true,
      companyId: defaultCompanyId,
      regionId: '',
      posEdition: 'Standard'
    });
  };

  const openEditLocation = (b: Branch) => {
    setLocationForm({
      id: b.id,
      type: typeOf(b),
      name: b.name,
      code: b.code,
      city: b.city ?? '',
      address: b.address ?? '',
      phone: b.phone ?? '',
      taxRegion: b.regionCode ?? '',
      canSell: b.canSell !== false,
      holdsStock: b.holdsStock !== false,
      companyId: b.companyId ?? defaultCompanyId,
      regionId: b.regionId ?? '',
      posEdition: editionOf(b),
      originalPosEdition: editionOf(b)
    });
  };

  const saveLocation = async () => {
    if (!locationForm) return;
    const f = locationForm;
    if (!f.name.trim()) {
      flash('error', 'Give the location a name.');
      return;
    }
    const sells = f.type === 'Warehouse' ? false : f.canSell;
    const keepsStock = f.type === 'Warehouse' ? true : f.holdsStock;
    setSaving(true);
    setMessage(null);
    try {
      if (f.id) {
        await posApi.updateBranch(f.id, {
          name: f.name.trim(),
          city: f.city.trim() || undefined,
          address: f.address,
          phone: f.phone,
          regionCode: f.taxRegion || '',
          locationType: f.type,
          canSell: sells,
          holdsStock: keepsStock,
          companyId: f.companyId || undefined,
          regionId: f.regionId || NO_REGION,
          // Only a real change is sent: the version is billing, and only head office may change it.
          posEdition: sells && f.posEdition !== f.originalPosEdition ? f.posEdition : undefined
        });
        flash('success', sells && f.posEdition !== f.originalPosEdition
          ? `${f.name.trim()} saved. Its POS version is now ${tierLabel(f.posEdition)}.`
          : `${f.name.trim()} saved.`);
      } else {
        await posApi.createBranch({
          name: f.name.trim(),
          code: f.code.trim() || undefined,
          city: f.city.trim() || undefined,
          address: f.address.trim() || undefined,
          phone: f.phone.trim() || undefined,
          stateCode: f.taxRegion || undefined,
          locationType: f.type === 'Warehouse' ? 'Warehouse' : 'Branch',
          canSell: sells,
          holdsStock: keepsStock,
          companyId: f.companyId || undefined,
          regionId: f.regionId || undefined,
          posEdition: sells ? f.posEdition : undefined
        });
        flash('success', f.type === 'Warehouse'
          ? `${f.name.trim()} added.`
          : `${f.name.trim()} added. Next, connect its till: press "Connect a till" on its row.`);
      }
      setLocationForm(null);
      await load();
      await refreshStore();
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not save the location.'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- companies

  const saveCompany = async () => {
    if (!companyForm) return;
    const f = companyForm;
    if (!f.id && !f.legalName.trim()) {
      flash('error', 'A legal name is required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const data = {
        legalName: f.legalName.trim(),
        tradeName: f.tradeName.trim(),
        taxRegistrationNumber: f.taxRegistrationNumber.trim(),
        salesTaxRegistrationNumber: f.salesTaxRegistrationNumber.trim(),
        address: f.address.trim()
      };
      if (f.id) await posApi.updateCompany(f.id, data);
      else await posApi.createCompany(data);
      flash('success', `${data.legalName || 'Company'} saved.`);
      setCompanyForm(null);
      await load();
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not save the company.'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- regions

  const saveRegion = async () => {
    if (!regionForm) return;
    const f = regionForm;
    if (!f.name.trim()) {
      flash('error', 'A region name is required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (f.id) await posApi.updateRegion(f.id, { name: f.name.trim(), code: f.code.trim() });
      else await posApi.createRegion({ name: f.name.trim(), code: f.code.trim() || undefined });
      flash('success', `${f.name.trim()} saved.`);
      setRegionForm(null);
      await load();
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not save the region.'));
    } finally {
      setSaving(false);
    }
  };

  const removeRegion = async (region: Region) => {
    if (!window.confirm(`Remove ${region.name}? Its locations stay; they are just no longer grouped.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await posApi.deleteRegion(region.id);
      flash('success', res.message || `${region.name} removed.`);
      await load();
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not remove the region.'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- policies

  const savePolicies = async () => {
    if (!policies) return;
    setSaving(true);
    setMessage(null);
    try {
      setPolicies(await posApi.updatePolicies(policies));
      flash('success', 'Policies saved. They apply at every location from now on.');
    } catch (err) {
      flash('error', getApiErrorMessage(err, 'Could not save the policies.'));
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------- render

  const tabButton = (id: Tab, label: string, Icon: React.ElementType) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer ${
        tab === id ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  return (
    <div className="flex-1 p-6 md:p-8 bg-slate-50 text-slate-900 overflow-y-auto min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-teal-500/20">
              <Building2 className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Locations & Head Office</h1>
              <p className="text-xs text-slate-500">
                Where you sell, where you keep stock, which company each location trades under, and who decides what.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200">{sellingCount} selling</span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200">{headOffice ? '1 head office' : 'No head office'}</span>
            <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200">{warehouseCount} warehouse{warehouseCount === 1 ? '' : 's'}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-xs font-semibold">
          {tabButton('locations', 'Locations', MapPin)}
          {tabButton('companies', 'Companies & Tax Numbers', Landmark)}
          {tabButton('regions', 'Regions', Store)}
          {tabButton('policies', 'Policies', Scale)}
        </div>

        {message && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-start justify-between gap-3 ${
              message.type === 'success' ? 'bg-teal-50 text-teal-800 border-teal-200' : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100 cursor-pointer" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ------------------------------------------------ LOCATIONS */}
            {tab === 'locations' && (
              <div className="space-y-6">
                {/* Head office */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-teal-600" />
                      Head office
                    </h2>
                    <p className="text-xs text-slate-500">
                      A separate office that runs the back office for every location: the item list, buying, stock
                      transfers, accounts and reports. It has no till of its own.
                    </p>
                  </div>

                  {headOffice ? (
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="text-xs space-y-0.5">
                        <div className="text-sm font-bold text-slate-900">
                          {headOffice.name} <span className="text-[10px] font-semibold text-slate-400">({headOffice.code})</span>
                        </div>
                        <div className="text-slate-500">{[headOffice.address, headOffice.city].filter(Boolean).join(', ') || 'No address yet'}</div>
                        <div className="text-slate-600">
                          {headOffice.holdsStock ? 'Keeps stock (central store)' : 'Office only — keeps no stock'}
                          {headOffice.canSell ? ' · also has a till' : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <button onClick={() => openEditLocation(headOffice)} className={secondaryButton}>
                          <Pencil className="w-3.5 h-3.5 text-teal-600" />
                          Edit
                        </button>
                      )}
                    </div>
                  ) : isOwner ? (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-600 bg-teal-50 border border-teal-200 rounded-xl p-3">
                        Your shop keeps selling exactly as it does now. The head office is added as a new location, and
                        you can open more branches under it later.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Office name</label>
                          <input className={inputClass} value={hqForm.name} onChange={e => setHqForm({ ...hqForm, name: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelClass}>City</label>
                          <input className={inputClass} value={hqForm.city} onChange={e => setHqForm({ ...hqForm, city: e.target.value })} placeholder="Same as the shop if left blank" />
                        </div>
                        <div>
                          <label className={labelClass}>Address</label>
                          <input className={inputClass} value={hqForm.address} onChange={e => setHqForm({ ...hqForm, address: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelClass}>Phone</label>
                          <input className={inputClass} value={hqForm.phone} onChange={e => setHqForm({ ...hqForm, phone: e.target.value })} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hqForm.holdsStock}
                          onChange={e => setHqForm({ ...hqForm, holdsStock: e.target.checked })}
                          className="w-4 h-4 accent-teal-500"
                        />
                        The office also keeps stock (a central store or kitchen that supplies the branches)
                      </label>
                      <button onClick={handleEnableHeadOffice} disabled={saving} className={primaryButton}>
                        <Plus className="w-3.5 h-3.5" />
                        {saving ? 'Setting up…' : 'Set up head office'}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No head office yet. Only the owner can set one up.</p>
                  )}
                </div>

                {/* Every location */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-teal-600" />
                        All locations
                      </h2>
                      <p className="text-xs text-slate-500">
                        Each branch has its own POS version (its tills, tablets and kitchen screens). Warehouses keep stock and never sell, so they need none.
                      </p>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => openNewLocation('Branch')} className={primaryButton}>
                          <Store className="w-3.5 h-3.5" />
                          Add branch
                        </button>
                        <button onClick={() => openNewLocation('Warehouse')} className={secondaryButton}>
                          <Warehouse className="w-3.5 h-3.5 text-teal-600" />
                          Add warehouse
                        </button>
                      </div>
                    )}
                  </div>

                  {locationForm && (
                    <div className="p-4 rounded-xl border-2 border-teal-200 bg-teal-50/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900">
                          {locationForm.id ? `Edit ${locationForm.name || 'location'}` : `New ${TYPE_LABEL[locationForm.type].toLowerCase()}`}
                        </h3>
                        <button onClick={() => setLocationForm(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer" title="Close">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>Type</label>
                          {locationForm.type === 'HeadOffice' ? (
                            <div className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-sm text-slate-600">Head office</div>
                          ) : (
                            <select
                              className={inputClass}
                              value={locationForm.type}
                              onChange={e => {
                                const type = e.target.value as LocationType;
                                setLocationForm({
                                  ...locationForm,
                                  type,
                                  canSell: type === 'Branch',
                                  holdsStock: type === 'Warehouse' ? true : locationForm.holdsStock
                                });
                              }}
                            >
                              <option value="Branch">Branch (sells)</option>
                              <option value="Warehouse">Warehouse (stock only)</option>
                            </select>
                          )}
                        </div>
                        <div>
                          <label className={labelClass}>Name</label>
                          <input className={inputClass} value={locationForm.name} onChange={e => setLocationForm({ ...locationForm, name: e.target.value })} placeholder="e.g. Gulberg Branch" />
                        </div>
                        <div>
                          <label className={labelClass}>Code</label>
                          <input
                            className={inputClass}
                            value={locationForm.code}
                            disabled={!!locationForm.id}
                            onChange={e => setLocationForm({ ...locationForm, code: e.target.value })}
                            placeholder={locationForm.id ? '' : 'Made for you if blank'}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>City</label>
                          <input className={inputClass} value={locationForm.city} onChange={e => setLocationForm({ ...locationForm, city: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelClass}>Address</label>
                          <input className={inputClass} value={locationForm.address} onChange={e => setLocationForm({ ...locationForm, address: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelClass}>Phone</label>
                          <input className={inputClass} value={locationForm.phone} onChange={e => setLocationForm({ ...locationForm, phone: e.target.value })} />
                        </div>
                        {jurisdictions.length > 0 && (
                          <div>
                            <label className={labelClass}>Tax region (province)</label>
                            <select className={inputClass} value={locationForm.taxRegion} onChange={e => setLocationForm({ ...locationForm, taxRegion: e.target.value })}>
                              <option value="">Not set</option>
                              {jurisdictions.map(j => (
                                <option key={j.id} value={j.regionCode}>{j.authorityName} ({j.regionCode})</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className={labelClass}>Trades under (company)</label>
                          <select className={inputClass} value={locationForm.companyId} onChange={e => setLocationForm({ ...locationForm, companyId: e.target.value })}>
                            {companies.map(c => (
                              <option key={c.id} value={c.id}>{c.legalName}{c.isDefault ? ' (main)' : ''}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Region</label>
                          <select className={inputClass} value={locationForm.regionId} onChange={e => setLocationForm({ ...locationForm, regionId: e.target.value })}>
                            <option value="">No region</option>
                            {regions.map(r => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {/* The branch's POS version: its tills, tablets and kitchen screens. Only
                          locations with a till have one; head office sets it. */}
                      {locationForm.type !== 'Warehouse' && locationForm.canSell && (
                        <div className="space-y-1.5">
                          <label className={labelClass}>POS version</label>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            {POS_EDITIONS.map(edition => {
                              const active = locationForm.posEdition === edition;
                              return (
                                <button
                                  key={edition}
                                  type="button"
                                  disabled={!canSetEdition}
                                  onClick={() => setLocationForm({ ...locationForm, posEdition: edition })}
                                  className={`text-left p-2.5 rounded-xl border-2 transition ${
                                    active ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:border-slate-300'
                                  } ${canSetEdition ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                                >
                                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                    {active && <Check className="w-3.5 h-3.5 text-teal-600" />}
                                    {tierLabel(edition)}
                                  </div>
                                  <div className="text-[11px] text-slate-500">{editionSummary(edition, packages)}</div>
                                </button>
                              );
                            })}
                          </div>
                          {!canSetEdition && (
                            <p className="text-[11px] text-slate-400">The owner sets each branch's POS version, because it changes what the business pays.</p>
                          )}
                          {locationForm.id && locationForm.originalPosEdition && locationForm.posEdition !== locationForm.originalPosEdition && (
                            <p className="text-[11px] text-amber-700">
                              Moving from {tierLabel(locationForm.originalPosEdition)} to {tierLabel(locationForm.posEdition)}. If the branch has more tills or
                              tablets than the new version allows, the newest ones stop selling until some are retired.
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4">
                        <label className={`flex items-center gap-2 text-xs ${locationForm.type === 'Warehouse' ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-teal-500"
                            disabled={locationForm.type === 'Warehouse'}
                            checked={locationForm.type !== 'Warehouse' && locationForm.canSell}
                            onChange={e => setLocationForm({ ...locationForm, canSell: e.target.checked })}
                          />
                          Has a till and sells
                        </label>
                        <label className={`flex items-center gap-2 text-xs ${locationForm.type === 'Warehouse' ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-teal-500"
                            disabled={locationForm.type === 'Warehouse'}
                            checked={locationForm.type === 'Warehouse' || locationForm.holdsStock}
                            onChange={e => setLocationForm({ ...locationForm, holdsStock: e.target.checked })}
                          />
                          Keeps stock
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={saveLocation} disabled={saving} className={primaryButton}>
                          <Save className="w-3.5 h-3.5" />
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setLocationForm(null)} className={secondaryButton}>Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                          <th className="py-2 pr-3">Location</th>
                          <th className="py-2 pr-3">Type</th>
                          <th className="py-2 pr-3">City</th>
                          <th className="py-2 pr-3">Sells</th>
                          <th className="py-2 pr-3">POS version</th>
                          <th className="py-2 pr-3">Stock</th>
                          <th className="py-2 pr-3">Company</th>
                          <th className="py-2 pr-3">Region</th>
                          <th className="py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map(b => {
                          const type = typeOf(b);
                          return (
                            <tr key={b.id} className="border-b border-slate-100 last:border-0">
                              <td className="py-2.5 pr-3">
                                <div className="font-semibold text-slate-900">{b.name}</div>
                                <div className="text-[10px] text-slate-400">{b.code}</div>
                              </td>
                              <td className="py-2.5 pr-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  type === 'HeadOffice' ? 'bg-purple-100 text-purple-700'
                                    : type === 'Warehouse' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-teal-100 text-teal-700'
                                }`}>
                                  {TYPE_LABEL[type]}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3 text-slate-600">{b.city || '—'}</td>
                              <td className="py-2.5 pr-3">{b.canSell !== false ? <Check className="w-4 h-4 text-teal-600" /> : <span className="text-slate-300">—</span>}</td>
                              <td className="py-2.5 pr-3">
                                {b.canSell !== false ? (
                                  <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold" title={editionSummary(editionOf(b), packages)}>
                                    {tierLabel(editionOf(b))}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="py-2.5 pr-3">{b.holdsStock !== false ? <Check className="w-4 h-4 text-teal-600" /> : <span className="text-slate-300">—</span>}</td>
                              <td className="py-2.5 pr-3 text-slate-600">{companyName(b.companyId)}</td>
                              <td className="py-2.5 pr-3 text-slate-600">{regionName(b.regionId)}</td>
                              <td className="py-2.5 text-right whitespace-nowrap">
                                {b.canSell !== false && (
                                  <button
                                    onClick={() => connectTill(b.id)}
                                    className="px-2 py-1 mr-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                                    title="Make a pairing code for a till or tablet at this branch"
                                  >
                                    <Monitor className="w-3.5 h-3.5" /> Connect a till
                                  </button>
                                )}
                                {canEdit && (
                                  <button onClick={() => openEditLocation(b)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-teal-600 cursor-pointer" title="Edit">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ------------------------------------------------ COMPANIES */}
            {tab === 'companies' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-teal-600" />
                      Companies (legal entities)
                    </h2>
                    <p className="text-xs text-slate-500">
                      The registered name and tax numbers printed on receipts and invoices. Most businesses have one; a group
                      with a separate company per branch adds each here and picks it on the location.
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setCompanyForm({ legalName: '', tradeName: '', taxRegistrationNumber: '', salesTaxRegistrationNumber: '', address: '' })}
                      className={primaryButton}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add company
                    </button>
                  )}
                </div>

                {companyForm && (
                  <div className="p-4 rounded-xl border-2 border-teal-200 bg-teal-50/40 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Legal name</label>
                        <input className={inputClass} value={companyForm.legalName} onChange={e => setCompanyForm({ ...companyForm, legalName: e.target.value })} placeholder="e.g. Karachi Foods (Pvt) Ltd" />
                      </div>
                      <div>
                        <label className={labelClass}>Trade name</label>
                        <input className={inputClass} value={companyForm.tradeName} onChange={e => setCompanyForm({ ...companyForm, tradeName: e.target.value })} placeholder="The name on the sign" />
                      </div>
                      <div>
                        <label className={labelClass}>NTN</label>
                        <input className={inputClass} value={companyForm.taxRegistrationNumber} onChange={e => setCompanyForm({ ...companyForm, taxRegistrationNumber: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelClass}>Sales tax registration (STRN)</label>
                        <input className={inputClass} value={companyForm.salesTaxRegistrationNumber} onChange={e => setCompanyForm({ ...companyForm, salesTaxRegistrationNumber: e.target.value })} />
                      </div>
                      <div className="md:col-span-2">
                        <label className={labelClass}>Registered address</label>
                        <input className={inputClass} value={companyForm.address} onChange={e => setCompanyForm({ ...companyForm, address: e.target.value })} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={saveCompany} disabled={saving} className={primaryButton}>
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setCompanyForm(null)} className={secondaryButton}>Cancel</button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {companies.map(c => (
                    <div key={c.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-bold text-slate-900">
                          {c.legalName}
                          {c.isDefault && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-bold uppercase">Main</span>}
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => setCompanyForm({
                              id: c.id,
                              legalName: c.legalName,
                              tradeName: c.tradeName ?? '',
                              taxRegistrationNumber: c.taxRegistrationNumber ?? '',
                              salesTaxRegistrationNumber: c.salesTaxRegistrationNumber ?? '',
                              address: c.address ?? ''
                            })}
                            className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-teal-600 cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {c.tradeName && <div className="text-slate-600">Trading as {c.tradeName}</div>}
                      <div className="text-slate-600">NTN: {c.taxRegistrationNumber || '—'} · STRN: {c.salesTaxRegistrationNumber || '—'}</div>
                      {c.address && <div className="text-slate-500">{c.address}</div>}
                      <div className="text-[10px] text-slate-400 pt-1">
                        {branches.filter(b => b.companyId === c.id).map(b => b.name).join(', ') || 'No locations yet'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ------------------------------------------------ REGIONS */}
            {tab === 'regions' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Store className="w-4 h-4 text-teal-600" />
                      Regions
                    </h2>
                    <p className="text-xs text-slate-500">
                      Group branches for reports and area managers — "North", "Lahore", "Franchise". This is separate from the
                      tax region, which is set on each location.
                    </p>
                  </div>
                  {canEdit && (
                    <button onClick={() => setRegionForm({ name: '', code: '' })} className={primaryButton}>
                      <Plus className="w-3.5 h-3.5" />
                      Add region
                    </button>
                  )}
                </div>

                {regionForm && (
                  <div className="p-4 rounded-xl border-2 border-teal-200 bg-teal-50/40 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Name</label>
                        <input className={inputClass} value={regionForm.name} onChange={e => setRegionForm({ ...regionForm, name: e.target.value })} placeholder="e.g. North" />
                      </div>
                      <div>
                        <label className={labelClass}>Code (optional)</label>
                        <input className={inputClass} value={regionForm.code} onChange={e => setRegionForm({ ...regionForm, code: e.target.value })} placeholder="e.g. NTH" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={saveRegion} disabled={saving} className={primaryButton}>
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setRegionForm(null)} className={secondaryButton}>Cancel</button>
                    </div>
                  </div>
                )}

                {regions.length === 0 ? (
                  <p className="text-xs text-slate-500">No regions yet. You only need them once you have several branches.</p>
                ) : (
                  <div className="space-y-2">
                    {regions.map(r => (
                      <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs">
                        <div>
                          <div className="font-bold text-slate-900">
                            {r.name} {r.code && <span className="text-[10px] font-semibold text-slate-400">({r.code})</span>}
                          </div>
                          <div className="text-slate-500">
                            {branches.filter(b => b.regionId === r.id).map(b => b.name).join(', ') || 'No locations in this region'}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => setRegionForm({ id: r.id, name: r.name, code: r.code ?? '' })} className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-teal-600 cursor-pointer" title="Rename">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => removeRegion(r)} disabled={saving} className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-rose-600 cursor-pointer" title="Remove">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ------------------------------------------------ POLICIES */}
            {tab === 'policies' && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Scale className="w-4 h-4 text-teal-600" />
                    Who decides what
                  </h2>
                  <p className="text-xs text-slate-500">
                    These matter once you have more than one location. They apply to every branch at once.
                    {!canSetPolicies && ' Only the owner or head office can change them.'}
                  </p>
                </div>

                {!policies ? (
                  <p className="text-xs text-slate-500">Policies could not be loaded.</p>
                ) : (
                  <>
                    <PolicyChoice
                      title="Item list and recipes"
                      disabled={!canSetPolicies}
                      value={policies.catalogControl}
                      onChange={v => setPolicies({ ...policies, catalogControl: v })}
                      options={[
                        { value: 'HeadOfficeOnly', label: 'Head office manages the item list', hint: 'Branches sell what head office sets up. Branch staff cannot add, change or delete items, recipes or ingredients.' },
                        { value: 'BranchesMayEdit', label: 'Branch managers may edit it', hint: 'Anyone with menu permission can change the item list, for every branch.' }
                      ]}
                    />
                    <PolicyToggle
                      title="Branches may charge their own prices"
                      hint="Set a price per branch on an item (Menu → the item → Branch prices). When off, every branch charges the company price; a branch can still stop selling an item."
                      disabled={!canSetPolicies}
                      checked={policies.branchPricing}
                      onChange={v => setPolicies({ ...policies, branchPricing: v })}
                    />
                    <PolicyChoice
                      title="Buying from suppliers"
                      disabled={!canSetPolicies}
                      value={policies.purchasingControl}
                      onChange={v => setPolicies({ ...policies, purchasingControl: v })}
                      options={[
                        { value: 'HeadOfficeBuys', label: 'Head office buys for everyone', hint: 'Branches ask for stock (stock requests and transfers). Only head office and warehouses raise purchase orders.' },
                        { value: 'BranchesMayBuy', label: 'Branches buy for themselves', hint: 'Each branch can raise its own purchase orders with suppliers.' }
                      ]}
                    />
                    <PolicyToggle
                      title="Keep selling when the system shows no stock"
                      hint="On: the sale goes through and an alert asks for a recount. Off: a counted item with no stock left cannot be sold."
                      disabled={!canSetPolicies}
                      checked={policies.allowNegativeStock}
                      onChange={v => setPolicies({ ...policies, allowNegativeStock: v })}
                    />
                    {canSetPolicies && (
                      <button onClick={savePolicies} disabled={saving} className={primaryButton}>
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving…' : 'Save policies'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function PolicyChoice<T extends string>({
  title,
  value,
  options,
  onChange,
  disabled
}: {
  title: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-slate-900">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`text-left p-3 rounded-xl border-2 transition ${
              value === o.value ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
            } ${disabled ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
          >
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              {value === o.value && <Check className="w-3.5 h-3.5 text-teal-600" />}
              {o.label}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{o.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PolicyToggle({
  title,
  hint,
  checked,
  onChange,
  disabled
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 ${disabled ? '' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="w-4 h-4 mt-0.5 accent-teal-500"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-xs font-bold text-slate-900">{title}</span>
        <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>
      </span>
    </label>
  );
}

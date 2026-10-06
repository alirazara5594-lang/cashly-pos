import React, { useState, useEffect } from 'react';
import {
  Truck,
  ArrowRightLeft,
  ShoppingBag,
  Plus,
  CheckCircle,
  ChevronRight,
  PackageCheck,
  X,
  Building2,
  History,
  Phone,
  Mail,
  Edit,
  Ban,
  Warehouse as WarehouseIcon
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore } from '../store/posStore';
import { useBusinessShape } from '../hooks/useBusinessShape';
import type { StockTransferOrder, PurchaseOrder, RawIngredient, Supplier, StockLedgerEntry, Warehouse, Product, Branch } from '../types';

/**
 * A purchase or transfer line moves either an ingredient or a product bought to be sold as it is
 * (a retail item). One picker lists both; the key says which: "i:<id>" or "p:<id>".
 */
interface StockLineItem {
  ingredientId?: string;
  productId?: string;
  ingredientName: string;
  unit: string;
  unitCostPKR: number;
}

const lineKey = (line: { ingredientId?: string; productId?: string }) =>
  line.productId ? `p:${line.productId}` : `i:${line.ingredientId ?? ''}`;

/** Where stock can sit: every location except an office that keeps none. */
const keepsStock = (b: Branch) => b.holdsStock !== false;

const locationTag = (b: Branch) => {
  const type = b.locationType ?? (b.isHeadOffice ? 'HeadOffice' : 'Branch');
  return type === 'HeadOffice' ? '(Head office)' : type === 'Warehouse' ? '(Warehouse)' : '';
};

export const SupplyChainManagement: React.FC = () => {
  const { selectedTenant, selectedBranch, currentUser } = usePosStore();
  const location = useLocation();
  // Who is doing it, for "dispatched by" and "received by" — the real person, never a made-up title.
  const me = currentUser?.fullName || currentUser?.username || '';

  // Somewhere to transfer to: a head office (even before its first outlet) or several locations.
  const { severalLocations: isMultiBranchChain } = useBusinessShape();
  const [activeTab, setActiveTab] = useState<'transfers' | 'procurement' | 'suppliers' | 'ledger' | 'warehouses'>(
    location.state?.tab || (isMultiBranchChain ? 'transfers' : 'procurement')
  );

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  const [transfers, setTransfers] = useState<StockTransferOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [ingredients, setIngredients] = useState<RawIngredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockLedger, setStockLedger] = useState<StockLedgerEntry[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isNewWarehouseOpen, setIsNewWarehouseOpen] = useState(false);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [newWarehouseCode, setNewWarehouseCode] = useState('');
  const [warehouseSaving, setWarehouseSaving] = useState(false);

  // New / Edit Supplier Modal
  const [supplierModal, setSupplierModal] = useState<Supplier | null | 'new'>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '', contactName: '', phone: '', email: '', address: '', taxNumber: '', paymentTerms: '', openingBalancePKR: 0
  });
  const [supplierSaving, setSupplierSaving] = useState(false);

  // New Transfer Modal
  const [isNewTransferOpen, setIsNewTransferOpen] = useState(false);
  const [transferDestBranchId, setTransferDestBranchId] = useState('');
  const [transferSourceBranchId, setTransferSourceBranchId] = useState('');
  const [transferVehicle, setTransferVehicle] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferLines, setTransferLines] = useState<Array<{
    ingredientId?: string;
    productId?: string;
    ingredientName: string;
    quantityRequested: number;
    unit: string;
  }>>([]);

  // Dispatch & Receive Modals for Transfer
  const [dispatchOrder, setDispatchOrder] = useState<StockTransferOrder | null>(null);
  const [dispatchDriver, setDispatchDriver] = useState('');
  const [receiveOrder, setReceiveOrder] = useState<StockTransferOrder | null>(null);
  const [receiverName, setReceiverName] = useState(me);

  // New PO Modal
  const [isNewPOOpen, setIsNewPOOpen] = useState(false);
  const [poSupplier, setPoSupplier] = useState('National Poultry Farms');
  const [poSupplierId, setPoSupplierId] = useState<string>('');
  const [poNotes, setPoNotes] = useState('');
  const [poLines, setPoLines] = useState<Array<{
    ingredientId?: string;
    productId?: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    unitCostPKR: number;
  }>>([]);

  // Status message
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Goods bought to be sold as they are (retail items), alongside the ingredients.
  const [products, setProducts] = useState<Product[]>([]);

  const itemFromKey = (key: string): StockLineItem | null => {
    if (key.startsWith('p:')) {
      const p = products.find(x => x.id === key.slice(2));
      return p ? { productId: p.id, ingredientName: p.name, unit: p.unit || 'Piece', unitCostPKR: p.costPricePKR || 0 } : null;
    }
    const i = ingredients.find(x => x.id === key.slice(2));
    return i ? { ingredientId: i.id, ingredientName: i.name, unit: i.unit, unitCostPKR: i.costPerUnitPKR || 0 } : null;
  };

  /** The first thing in the picker, for a new line: an ingredient if there are any, else a product. */
  const firstItem = (): StockLineItem | null =>
    ingredients.length > 0 ? itemFromKey(`i:${ingredients[0].id}`)
      : products.length > 0 ? itemFromKey(`p:${products[0].id}`)
      : null;

  const itemOptions = (
    <>
      {ingredients.length > 0 && (
        <optgroup label="Ingredients">
          {ingredients.map(i => (
            <option key={i.id} value={`i:${i.id}`}>{i.name} ({i.unit})</option>
          ))}
        </optgroup>
      )}
      {products.length > 0 && (
        <optgroup label="Products (sold as bought)">
          {products.map(p => (
            <option key={p.id} value={`p:${p.id}`}>{p.name} ({p.unit || 'Piece'})</option>
          ))}
        </optgroup>
      )}
    </>
  );

  const fetchData = async () => {
    if (!selectedTenant?.id) return;
    try {
      const [transfersData, poData, ingsData, suppliersData, ledgerData, warehousesData, productsData] = await Promise.all([
        posApi.getTransferOrders(selectedTenant.id),
        posApi.getPurchaseOrders(selectedTenant.id),
        selectedBranch?.id ? posApi.getRawIngredients(selectedBranch.id) : Promise.resolve([]),
        posApi.getSuppliers(selectedTenant.id).catch(() => []),
        selectedBranch?.id ? posApi.getStockLedger(selectedBranch.id).catch(() => []) : Promise.resolve([]),
        selectedBranch?.id ? posApi.getWarehouses(selectedBranch.id).catch(() => []) : Promise.resolve([]),
        posApi.getProducts({ tenantId: selectedTenant.id }).catch(() => [] as Product[])
      ]);
      setTransfers(transfersData);
      setPurchaseOrders(poData);
      setIngredients(ingsData);
      setSuppliers(suppliersData);
      setStockLedger(ledgerData);
      setWarehouses(warehousesData);
      setProducts(Array.isArray(productsData) ? productsData : []);
    } catch (err) {
      console.error('Failed to load supply chain data', err);
    }
  };

  const handleCreateWarehouse = async () => {
    if (!newWarehouseName.trim() || !selectedBranch?.id) return;
    setWarehouseSaving(true);
    try {
      await posApi.createWarehouse({ tenantId: selectedTenant?.id, branchId: selectedBranch.id, name: newWarehouseName.trim(), code: newWarehouseCode.trim() || undefined });
      setIsNewWarehouseOpen(false);
      setNewWarehouseName('');
      setNewWarehouseCode('');
      setStatusMsg('Warehouse added');
      setTimeout(() => setStatusMsg(null), 3000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to add warehouse');
    } finally {
      setWarehouseSaving(false);
    }
  };

  const handleToggleWarehouseActive = async (w: Warehouse) => {
    try {
      await posApi.updateWarehouse(w.id, { isActive: !w.isActive });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to update warehouse');
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedTenant?.id, selectedBranch?.id]);

  useEffect(() => {
    if (!isMultiBranchChain) {
      setActiveTab('procurement');
    }
  }, [isMultiBranchChain]);

  const handleOpenNewTransfer = () => {
    // Stock comes from a warehouse first, then a head office that keeps stock, then any other
    // location that does. An office that keeps no stock can neither send nor receive.
    const locations = (selectedTenant?.branches || []).filter(keepsStock);
    const comm = locations.find(b => b.locationType === 'Warehouse')
      || locations.find(b => b.locationType === 'HeadOffice' || b.isHeadOffice)
      || locations.find(b => b.id !== selectedBranch?.id)
      || locations[0];
    const dest = (selectedBranch && selectedBranch.id !== comm?.id && keepsStock(selectedBranch))
      ? selectedBranch
      : (locations.find(b => b.id !== comm?.id && b.canSell !== false) || locations.find(b => b.id !== comm?.id));

    setTransferSourceBranchId(comm?.id || '');
    setTransferDestBranchId(dest?.id || '');
    // A blank form: the quantity, vehicle and note are the person's to fill in.
    setTransferVehicle('');
    setTransferNotes('');
    const first = firstItem();
    setTransferLines(first ? [{ ...first, quantityRequested: 0 }] : []);
    setIsNewTransferOpen(true);
  };

  useEffect(() => {
    if (location.state?.openRequisition) {
      handleOpenNewTransfer();
    }
  }, [location.state?.openRequisition, ingredients.length]);

  const handleAddTransferLine = () => {
    const first = firstItem();
    if (!first) return;
    setTransferLines([...transferLines, { ...first, quantityRequested: 0 }]);
  };

  const handleCreateTransfer = async () => {
    if (!selectedTenant?.id || !transferSourceBranchId || !transferDestBranchId || transferLines.length === 0) {
      alert('Please select branches and at least one item');
      return;
    }
    if (transferSourceBranchId === transferDestBranchId) {
      alert('Stock has to move between two different locations.');
      return;
    }
    if (transferLines.some(l => !(l.quantityRequested > 0))) {
      alert('Enter a quantity for every line.');
      return;
    }
    try {
      await posApi.createTransferOrder({
        tenantId: selectedTenant.id,
        sourceBranchId: transferSourceBranchId,
        destinationBranchId: transferDestBranchId,
        vehicleOrDriver: transferVehicle,
        notes: transferNotes,
        items: transferLines.map(l => ({
          ingredientId: l.productId ? undefined : l.ingredientId,
          productId: l.productId,
          ingredientName: l.ingredientName,
          quantityRequested: l.quantityRequested,
          unit: l.unit
        }))
      });
      setIsNewTransferOpen(false);
      setStatusMsg('Stock Transfer Requisition successfully submitted!');
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert(getApiErrorMessage(err, 'Failed to submit transfer order'));
    }
  };

  const handleDispatch = async () => {
    if (!dispatchOrder) return;
    try {
      await posApi.dispatchTransferOrder(dispatchOrder.id, {
        dispatchedBy: me || undefined,
        vehicleOrDriver: dispatchDriver || dispatchOrder.vehicleOrDriver,
        notes: 'Dispatched in refrigerated logistics van'
      });
      setDispatchOrder(null);
      setStatusMsg(`Transfer #${dispatchOrder.transferNumber} marked IN-TRANSIT! Stock deducted from Commissary.`);
      setTimeout(() => setStatusMsg(null), 4500);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to dispatch transfer');
    }
  };

  const handleReceive = async () => {
    if (!receiveOrder) return;
    try {
      await posApi.receiveTransferOrder(receiveOrder.id, {
        receivedBy: receiverName.trim() || me || undefined
      });
      setReceiveOrder(null);
      setStatusMsg(`Transfer #${receiveOrder.transferNumber} RECEIVED! Raw ingredients updated at branch kitchen inventory.`);
      setTimeout(() => setStatusMsg(null), 4500);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to receive transfer');
    }
  };

  const handleOpenNewPO = () => {
    const firstSupplier = suppliers.find(s => s.isActive);
    setPoSupplierId(firstSupplier?.id || '');
    setPoSupplier(firstSupplier?.name || '');
    setPoNotes('');
    const first = firstItem();
    setPoLines(first ? [{ ...first, quantity: 0 }] : []);
    setIsNewPOOpen(true);
  };

  const handleAddPOLine = () => {
    const first = firstItem();
    if (!first) return;
    setPoLines([...poLines, { ...first, quantity: 0 }]);
  };

  const handleCreatePO = async () => {
    if (!selectedTenant?.id || !selectedBranch?.id || poLines.length === 0) {
      alert('Please fill out PO items');
      return;
    }
    if (!poSupplier.trim()) {
      alert('Enter the supplier.');
      return;
    }
    if (poLines.some(l => !(l.quantity > 0))) {
      alert('Enter a quantity for every line.');
      return;
    }
    try {
      await posApi.createPurchaseOrder({
        tenantId: selectedTenant.id,
        branchId: selectedBranch.id,
        supplierName: poSupplier,
        supplierId: poSupplierId || undefined,
        notes: poNotes,
        items: poLines.map(l => ({
          ingredientId: l.productId ? undefined : l.ingredientId,
          productId: l.productId,
          ingredientName: l.ingredientName,
          quantity: l.quantity,
          unit: l.unit,
          unitCostPKR: l.unitCostPKR
        }))
      });
      setIsNewPOOpen(false);
      setStatusMsg('Vendor Purchase Order issued successfully!');
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert(getApiErrorMessage(err, 'Failed to create purchase order'));
    }
  };

  const handleReceivePO = async (po: PurchaseOrder) => {
    if (!window.confirm(`Inward GRN for PO #${po.poNumber}? This will increment physical stock for all ordered raw ingredients.`)) {
      return;
    }
    try {
      await posApi.receivePurchaseOrder(po.id, {
        receivedBy: me || undefined
      });
      setStatusMsg(`PO #${po.poNumber} marked as RECEIVED! Raw ingredients updated.`);
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to receive PO');
    }
  };

  const openNewSupplier = () => {
    setSupplierForm({ name: '', contactName: '', phone: '', email: '', address: '', taxNumber: '', paymentTerms: '', openingBalancePKR: 0 });
    setSupplierModal('new');
  };

  const openEditSupplier = (s: Supplier) => {
    setSupplierForm({
      name: s.name, contactName: s.contactName || '', phone: s.phone || '', email: s.email || '',
      address: s.address || '', taxNumber: s.taxNumber || '', paymentTerms: s.paymentTerms || '', openingBalancePKR: s.openingBalancePKR
    });
    setSupplierModal(s);
  };

  const handleSaveSupplier = async () => {
    if (!supplierForm.name.trim() || !selectedTenant?.id) {
      alert('Supplier name is required');
      return;
    }
    setSupplierSaving(true);
    try {
      if (supplierModal === 'new') {
        await posApi.createSupplier({ tenantId: selectedTenant.id, ...supplierForm });
      } else if (supplierModal) {
        await posApi.updateSupplier(supplierModal.id, {
          name: supplierForm.name, contactName: supplierForm.contactName, phone: supplierForm.phone,
          email: supplierForm.email, address: supplierForm.address, taxNumber: supplierForm.taxNumber,
          paymentTerms: supplierForm.paymentTerms
        });
      }
      setSupplierModal(null);
      setStatusMsg('Supplier saved successfully!');
      setTimeout(() => setStatusMsg(null), 3000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to save supplier');
    } finally {
      setSupplierSaving(false);
    }
  };

  const handleToggleSupplierActive = async (s: Supplier) => {
    try {
      await posApi.updateSupplier(s.id, { isActive: !s.isActive });
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to update supplier');
    }
  };

  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);

  const handleRecordPayment = async () => {
    if (!paymentSupplier || !paymentAmount) return;
    setPaymentSaving(true);
    try {
      await posApi.recordSupplierPayment(paymentSupplier.id, {
        amountPKR: Number(paymentAmount), paymentMethod, referenceNumber: paymentRef.trim() || undefined
      });
      setPaymentSupplier(null);
      setPaymentAmount('');
      setPaymentRef('');
      setStatusMsg('Payment recorded');
      setTimeout(() => setStatusMsg(null), 3000);
      fetchData();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 text-slate-900 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-teal-500" />
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Transfers & Purchasing</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {isMultiBranchChain
              ? 'Move stock between your locations, and buy from your suppliers.'
              : 'Purchase orders to your suppliers, and goods received into stock.'}
          </p>
        </div>

        {/* Global Notifications */}
        {statusMsg && (
          <div className="px-4 py-2 bg-teal-50 border border-teal-300 rounded-xl text-teal-700 text-xs font-bold flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-teal-500" />
            {statusMsg}
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex bg-slate-100 border border-slate-200 p-1 rounded-xl">
          {isMultiBranchChain && (
            <button
              onClick={() => setActiveTab('transfers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeTab === 'transfers'
                  ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                  : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
              }`}
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Inter-Branch Transfers</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('procurement')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'procurement'
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Vendor Procurement (PO)</span>
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'suppliers'
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Suppliers</span>
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'ledger'
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Stock Ledger</span>
          </button>
          <button
            onClick={() => setActiveTab('warehouses')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
              activeTab === 'warehouses'
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/25'
                : 'bg-slate-100 text-slate-600 hover:bg-teal-50'
            }`}
          >
            <WarehouseIcon className="w-4 h-4" />
            <span>Warehouses</span>
          </button>
        </div>
      </div>

      {/* TAB 1: INTER-BRANCH TRANSFERS (DYNAMICS STYLE COMMISSARY LOGISTICS) */}
      {activeTab === 'transfers' && isMultiBranchChain && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-xs text-slate-500 block">Total Transfers</span>
                <span className="text-lg font-black text-slate-900">{transfers.length}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <span className="text-xs text-amber-600 block">In-Transit On Road</span>
                <span className="text-lg font-black text-amber-600">
                  {transfers.filter(t => t.status === 'InTransit').length}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200">
                <span className="text-xs text-teal-600 block">Received at Outlets</span>
                <span className="text-lg font-black text-teal-600">
                  {transfers.filter(t => t.status === 'Received').length}
                </span>
              </div>
            </div>

            <button
              onClick={handleOpenNewTransfer}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Transfer</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Transfer Requisitions & Dispatch Logistics</span>
              <span className="text-xs text-slate-400">{transfers.length} records</span>
            </div>

            {transfers.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No transfers yet. Approving an outlet's stock request creates one, or press "New Transfer" to send stock yourself.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3">Transfer #</th>
                      <th className="p-3">Route (From &rarr; To)</th>
                      <th className="p-3">Items & Quantities</th>
                      <th className="p-3">Vehicle / Logistics</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {transfers.map(tr => {
                      const sourceName = selectedTenant?.branches?.find(b => b.id === tr.sourceBranchId)?.name || 'Commissary';
                      const destName = selectedTenant?.branches?.find(b => b.id === tr.destinationBranchId)?.name || 'Branch';

                      return (
                        <tr key={tr.id} className="hover:bg-slate-50 transition">
                          <td className="p-3 font-mono font-bold text-teal-600">
                            {tr.transferNumber}
                            <span className="block text-[10px] text-slate-500 font-sans">
                              {new Date(tr.requestedAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 font-bold text-slate-900">
                              <span className="text-slate-600">{sourceName}</span>
                              <ChevronRight className="w-3.5 h-3.5 text-teal-500" />
                              <span className="text-teal-600">{destName}</span>
                            </div>
                            {tr.notes && <div className="text-[10px] text-slate-500 italic mt-0.5">{tr.notes}</div>}
                          </td>
                          <td className="p-3">
                            <div className="space-y-1">
                              {tr.items?.map(it => (
                                <div key={it.id} className="text-slate-700">
                                  <strong className="text-slate-900">{it.quantityRequested} {it.unit}</strong> &bull; {it.ingredientName}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-slate-700">
                            {tr.vehicleOrDriver ? (
                              <div className="flex items-center gap-1.5">
                                <Truck className="w-3.5 h-3.5 text-blue-500" />
                                <span>{tr.vehicleOrDriver}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400">Unassigned</span>
                            )}
                          </td>
                          <td className="p-3">
                            {tr.status === 'Requested' && (
                              <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-bold">
                                Requisition Pending
                              </span>
                            )}
                            {tr.status === 'InTransit' && (
                              <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-bold">
                                In-Transit On Road
                              </span>
                            )}
                            {tr.status === 'Received' && (
                              <span className="px-2 py-1 rounded-md bg-teal-50 text-teal-600 border border-teal-200 text-[10px] font-bold flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" /> Received & Stocked
                              </span>
                            )}
                            {tr.status === 'Cancelled' && (
                              <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-bold">
                                Cancelled
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {tr.status === 'Requested' && (
                              <button
                                onClick={() => {
                                  setDispatchOrder(tr);
                                  setDispatchDriver(tr.vehicleOrDriver || '');
                                }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-md transition"
                              >
                                Dispatch Order
                              </button>
                            )}

                            {tr.status === 'InTransit' && (
                              <button
                                onClick={() => setReceiveOrder(tr)}
                                className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-md transition flex items-center gap-1.5 ml-auto"
                              >
                                <PackageCheck className="w-3.5 h-3.5" />
                                <span>Receive & Stock-In</span>
                              </button>
                            )}

                            {tr.status === 'Received' && (
                              <span className="text-[11px] text-slate-500">
                                Received by {tr.receivedBy || 'Staff'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: VENDOR PROCUREMENT (PURCHASE ORDERS & GRN) */}
      {activeTab === 'procurement' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-xs text-slate-500 block">Total Purchase Orders</span>
                <span className="text-lg font-black text-slate-900">{purchaseOrders.length}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200">
                <span className="text-xs text-blue-600 block">Pending Delivery</span>
                <span className="text-lg font-black text-blue-600">
                  {purchaseOrders.filter(p => p.status === 'Ordered').length}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200">
                <span className="text-xs text-teal-600 block">Received GRNs</span>
                <span className="text-lg font-black text-teal-600">
                  {purchaseOrders.filter(p => p.status === 'Received').length}
                </span>
              </div>
            </div>

            <button
              onClick={handleOpenNewPO}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Issue New Vendor PO</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Vendor Purchase Orders & Goods Receipt Notes</span>
              <span className="text-xs text-slate-400">{purchaseOrders.length} records</span>
            </div>

            {purchaseOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No purchase orders created yet. Issue a new PO to order fresh stock directly from bakery, poultry, or dairy vendors.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3">PO #</th>
                      <th className="p-3">Vendor / Supplier</th>
                      <th className="p-3">Purchased Ingredients</th>
                      <th className="p-3">Total Value</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Inward Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {purchaseOrders.map(po => {
                      return (
                        <tr key={po.id} className="hover:bg-slate-50 transition">
                          <td className="p-3 font-mono font-bold text-blue-600">
                            {po.poNumber}
                            <span className="block text-[10px] text-slate-500 font-sans">
                              {new Date(po.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="p-3">
                            <strong className="text-slate-900 text-sm">{po.supplierName}</strong>
                            {po.notes && <div className="text-[10px] text-slate-500 italic">{po.notes}</div>}
                          </td>
                          <td className="p-3">
                            <div className="space-y-1">
                              {po.items?.map(it => (
                                <div key={it.id} className="text-slate-700">
                                  <strong className="text-slate-900">{it.quantity} {it.unit}</strong> &bull; {it.ingredientName} @ {it.unitCostPKR}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 font-mono font-black text-teal-600 text-sm">
                            {po.totalCostPKR.toLocaleString()}
                          </td>
                          <td className="p-3">
                            {po.status === 'Ordered' && (
                              <span className="px-2 py-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-bold">
                                Ordered (Awaiting Delivery)
                              </span>
                            )}
                            {po.status === 'Received' && (
                              <span className="px-2 py-1 rounded-md bg-teal-50 text-teal-600 border border-teal-200 text-[10px] font-bold flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" /> Received GRN
                              </span>
                            )}
                            {po.status === 'Cancelled' && (
                              <span className="px-2 py-1 rounded-md bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-bold">
                                Cancelled
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {po.status === 'Ordered' && (
                              <button
                                onClick={() => handleReceivePO(po)}
                                className="px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-md transition flex items-center gap-1.5 ml-auto"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                <span>Inward GRN (Stock-In)</span>
                              </button>
                            )}
                            {po.status === 'Received' && (
                              <span className="text-[11px] text-slate-500">
                                Inward verified by {po.receivedBy || 'Staff'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIERS (PURCHASING MASTER DATA) */}
      {activeTab === 'suppliers' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-xs text-slate-500 block">Total Suppliers</span>
                <span className="text-lg font-black text-slate-900">{suppliers.length}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200">
                <span className="text-xs text-rose-600 block">Total Payable</span>
                <span className="text-lg font-black text-rose-600">
                  {suppliers.reduce((s, x) => s + x.currentBalancePKR, 0).toLocaleString()}
                </span>
              </div>
            </div>
            <button
              onClick={openNewSupplier}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier Directory</span>
              <span className="text-xs text-slate-400">{suppliers.length} records</span>
            </div>

            {suppliers.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No suppliers added yet. Add one to link it on future purchase orders and track what you owe them.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3">Supplier</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Payment Terms</th>
                      <th className="p-3 text-right">Balance Owed (PKR)</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {suppliers.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50 transition">
                        <td className="p-3">
                          <strong className="text-slate-900 text-sm">{s.name}</strong>
                          {s.taxNumber && <div className="text-[10px] text-slate-500">NTN/Tax#: {s.taxNumber}</div>}
                        </td>
                        <td className="p-3 text-slate-700">
                          {s.contactName && <div>{s.contactName}</div>}
                          {s.phone && <div className="flex items-center gap-1 text-[11px] text-slate-500"><Phone className="w-3 h-3" />{s.phone}</div>}
                          {s.email && <div className="flex items-center gap-1 text-[11px] text-slate-500"><Mail className="w-3 h-3" />{s.email}</div>}
                        </td>
                        <td className="p-3 text-slate-700">{s.paymentTerms || <span className="text-slate-400">—</span>}</td>
                        <td className="p-3 text-right font-mono font-black text-rose-600">{s.currentBalancePKR.toLocaleString()}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-md text-[10px] font-bold border ${
                            s.isActive ? 'bg-teal-50 text-teal-600 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {s.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {s.currentBalancePKR > 0 && (
                              <button
                                onClick={() => { setPaymentSupplier(s); setPaymentAmount(String(s.currentBalancePKR)); }}
                                className="px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 text-[11px] font-bold transition"
                                title="Record a payment to this supplier"
                              >
                                Pay
                              </button>
                            )}
                            <button onClick={() => openEditSupplier(s)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 transition" title="Edit supplier">
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleToggleSupplierActive(s)} className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-600 transition" title={s.isActive ? 'Deactivate' : 'Reactivate'}>
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: STOCK LEDGER (EVERY MOVEMENT BEHIND CURRENT STOCK) */}
      {activeTab === 'ledger' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Stock Movement History — {selectedBranch?.name || 'This Branch'} (last 30 days)
              </span>
              <span className="text-xs text-slate-400">{stockLedger.length} records</span>
            </div>

            {stockLedger.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No stock movements recorded yet for this branch in the last 30 days. Every PO receipt, transfer, and
                manual adjustment will show up here as it happens.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Ingredient</th>
                      <th className="p-3">Movement</th>
                      <th className="p-3 text-right">Qty Change</th>
                      <th className="p-3 text-right">Balance After</th>
                      <th className="p-3">Reference</th>
                      <th className="p-3">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {stockLedger.map(e => (
                      <tr key={e.id} className="hover:bg-slate-50 transition">
                        <td className="p-3 text-slate-500">{new Date(e.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="p-3 font-bold text-slate-900">{e.ingredientName}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            e.quantityChange >= 0 ? 'bg-teal-50 text-teal-600 border border-teal-200' : 'bg-rose-50 text-rose-600 border border-rose-200'
                          }`}>
                            {e.movementType}
                          </span>
                        </td>
                        <td className={`p-3 text-right font-mono font-black ${e.quantityChange >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>
                          {e.quantityChange > 0 ? '+' : ''}{e.quantityChange}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-700">{e.balanceAfter}</td>
                        <td className="p-3 text-slate-500">{e.referenceType || '—'}{e.notes ? ` · ${e.notes}` : ''}</td>
                        <td className="p-3 text-slate-500">{e.createdBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: WAREHOUSES (STORAGE LOCATIONS WITHIN A BRANCH) */}
      {activeTab === 'warehouses' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-xs text-slate-500 block">Storage Locations — {selectedBranch?.name || 'This Branch'}</span>
                <span className="text-lg font-black text-slate-900">{warehouses.length}</span>
              </div>
            </div>
            <button
              onClick={() => setIsNewWarehouseOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Warehouse</span>
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Most restaurants only need one — add more if you split storage (e.g. a walk-in freezer separate from dry store).
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Code</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {warehouses.map(w => (
                    <tr key={w.id} className="hover:bg-slate-50 transition">
                      <td className="p-3 font-bold text-slate-900">{w.name}</td>
                      <td className="p-3 font-mono text-slate-500">{w.code || '—'}</td>
                      <td className="p-3">
                        {w.isPrimary && <span className="px-2 py-1 rounded-md bg-teal-50 text-teal-600 border border-teal-200 text-[10px] font-bold">Primary</span>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold border ${
                          w.isActive ? 'bg-teal-50 text-teal-600 border-teal-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {w.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {!w.isPrimary && (
                          <button
                            onClick={() => handleToggleWarehouseActive(w)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 font-bold text-[11px] transition"
                          >
                            {w.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD WAREHOUSE */}
      {isNewWarehouseOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <WarehouseIcon className="w-5 h-5" />
                <span>Add Warehouse</span>
              </div>
              <button onClick={() => setIsNewWarehouseOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Name</label>
              <input type="text" value={newWarehouseName} onChange={(e) => setNewWarehouseName(e.target.value)}
                placeholder="e.g. Walk-in Freezer" autoFocus
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Code (optional)</label>
              <input type="text" value={newWarehouseCode} onChange={(e) => setNewWarehouseCode(e.target.value)}
                placeholder="e.g. FRZ-1"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
            </div>
            <button
              onClick={handleCreateWarehouse}
              disabled={warehouseSaving || !newWarehouseName.trim()}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-black text-xs shadow-lg transition"
            >
              {warehouseSaving ? 'Saving…' : 'Add Warehouse'}
            </button>
          </div>
        </div>
      )}

      {/* MODAL: RECORD SUPPLIER PAYMENT */}
      {paymentSupplier && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <span>Pay {paymentSupplier.name}</span>
              </div>
              <button onClick={() => setPaymentSupplier(null)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-slate-500">Owed: <span className="font-mono font-bold text-rose-600">{paymentSupplier.currentBalancePKR.toLocaleString()} PKR</span></p>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Amount (PKR)</label>
              <input type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                max={paymentSupplier.currentBalancePKR}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Payment Method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none">
                <option>Bank Transfer</option>
                <option>Cash</option>
                <option>Cheque</option>
                <option>JazzCash</option>
                <option>EasyPaisa</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Reference # (optional)</label>
              <input type="text" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Cheque #, transaction ID..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
            </div>
            <button
              onClick={handleRecordPayment}
              disabled={paymentSaving || !paymentAmount || Number(paymentAmount) <= 0}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-black text-xs shadow-lg transition"
            >
              {paymentSaving ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT SUPPLIER */}
      {supplierModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <Building2 className="w-5 h-5" />
                <span>{supplierModal === 'new' ? 'Add Supplier' : 'Edit Supplier'}</span>
              </div>
              <button onClick={() => setSupplierModal(null)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Supplier / Vendor Name</label>
                <input type="text" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  placeholder="e.g. Dawn Bread Bakeries" autoFocus
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Contact Person</label>
                <input type="text" value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Phone</label>
                <input type="text" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Email</label>
                <input type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Tax / NTN Number</label>
                <input type="text" value={supplierForm.taxNumber} onChange={(e) => setSupplierForm({ ...supplierForm, taxNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Address</label>
                <input type="text" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                <input type="text" value={supplierForm.paymentTerms} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })}
                  placeholder="e.g. Net 30, Cash on Delivery"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              {supplierModal === 'new' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Opening Balance Owed (PKR)</label>
                  <input type="number" value={supplierForm.openingBalancePKR}
                    onChange={(e) => setSupplierForm({ ...supplierForm, openingBalancePKR: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
                </div>
              )}
            </div>

            <button
              onClick={handleSaveSupplier}
              disabled={supplierSaving}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-black text-xs shadow-lg transition"
            >
              {supplierSaving ? 'Saving…' : supplierModal === 'new' ? 'Add Supplier' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* MODAL: CREATE INTER-BRANCH TRANSFER */}
      {isNewTransferOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <ArrowRightLeft className="w-5 h-5" />
                <span>New Stock Transfer</span>
              </div>
              <button onClick={() => setIsNewTransferOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Source (Dispatch Commissary)</label>
                <select
                  value={transferSourceBranchId}
                  onChange={(e) => setTransferSourceBranchId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  {selectedTenant?.branches?.filter(keepsStock).map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} {locationTag(b)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Destination (Receiving Branch)</label>
                <select
                  value={transferDestBranchId}
                  onChange={(e) => setTransferDestBranchId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  {selectedTenant?.branches?.filter(keepsStock).map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} {locationTag(b)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Logistics / Assigned Vehicle</label>
              <input
                type="text"
                value={transferVehicle}
                onChange={(e) => setTransferVehicle(e.target.value)}
                placeholder="e.g. Van #04 - KHI-9482"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Items to Move (ingredients or products)</label>
                <button
                  type="button"
                  onClick={handleAddTransferLine}
                  className="text-xs text-teal-600 hover:text-teal-700 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {transferLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <select
                      value={lineKey(line)}
                      onChange={(e) => {
                        const item = itemFromKey(e.target.value);
                        if (!item) return;
                        const updated = [...transferLines];
                        updated[idx] = {
                          ...updated[idx],
                          ingredientId: item.ingredientId,
                          productId: item.productId,
                          ingredientName: item.ingredientName,
                          unit: item.unit
                        };
                        setTransferLines(updated);
                      }}
                      className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                    >
                      {itemOptions}
                    </select>

                    <input
                      type="number"
                      min={0}
                      value={line.quantityRequested || ''}
                      onChange={(e) => {
                        const updated = [...transferLines];
                        updated[idx].quantityRequested = Number(e.target.value) || 0;
                        setTransferLines(updated);
                      }}
                      className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-center font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                      placeholder="Qty"
                    />

                    <span className="text-xs text-slate-500 w-12 font-bold">{line.unit}</span>

                    <button
                      type="button"
                      onClick={() => setTransferLines(transferLines.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-500 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Requisition Notes</label>
              <input
                type="text"
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreateTransfer}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              Create Transfer
            </button>
          </div>
        </div>
      )}

      {/* MODAL: DISPATCH ORDER */}
      {dispatchOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-amber-600 font-bold text-sm">
                <Truck className="w-5 h-5" />
                <span>Commissary Dispatch Verification</span>
              </div>
              <button onClick={() => setDispatchOrder(null)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs">
              <div className="text-slate-500">Requisition: <strong className="text-slate-900 font-mono">{dispatchOrder.transferNumber}</strong></div>
              <div className="text-slate-500">Total Lines: <strong className="text-slate-900">{dispatchOrder.items?.length || 0} items</strong></div>
              <div className="text-amber-600 font-bold text-[11px] pt-1">
                Notice: Approving dispatch will deduct inventory from Commissary stock immediately.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Assigned Driver / Logistics Vehicle</label>
              <input
                type="text"
                value={dispatchDriver}
                onChange={(e) => setDispatchDriver(e.target.value)}
                placeholder="Driver Name or Vehicle Number"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <button
              onClick={handleDispatch}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-lg transition"
            >
              Confirm Dispatch & Set In-Transit
            </button>
          </div>
        </div>
      )}

      {/* MODAL: RECEIVE ORDER */}
      {receiveOrder && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <PackageCheck className="w-5 h-5" />
                <span>Store Gate Receiving Inspection</span>
              </div>
              <button onClick={() => setReceiveOrder(null)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs">
              <div className="text-slate-500">Requisition: <strong className="text-slate-900 font-mono">{receiveOrder.transferNumber}</strong></div>
              <div className="text-teal-600 font-bold text-[11px] pt-1">
                Notice: Confirming receipt will increment raw materials directly at this branch's kitchen.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Received & Inspected By</label>
              <input
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <button
              onClick={handleReceive}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              Verify Goods & Stock-In to Branch
            </button>
          </div>
        </div>
      )}

      {/* MODAL: CREATE VENDOR PURCHASE ORDER */}
      {isNewPOOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <ShoppingBag className="w-5 h-5" />
                <span>Issue Vendor Purchase Order (Procurement)</span>
              </div>
              <button onClick={() => setIsNewPOOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Vendor / Supplier</label>
              {suppliers.length > 0 ? (
                <select
                  value={poSupplierId}
                  onChange={(e) => {
                    const sup = suppliers.find(s => s.id === e.target.value);
                    setPoSupplierId(e.target.value);
                    setPoSupplier(sup?.name || '');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                >
                  <option value="">— Manual entry (no linked supplier) —</option>
                  {suppliers.filter(s => s.isActive).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : null}
              {!poSupplierId && (
                <input
                  type="text"
                  value={poSupplier}
                  onChange={(e) => setPoSupplier(e.target.value)}
                  placeholder="e.g. Dawn Bread Bakeries, K&N's Poultry"
                  className={`w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none ${suppliers.length > 0 ? 'mt-2' : ''}`}
                />
              )}
              {suppliers.length === 0 && (
                <p className="text-[10px] text-slate-400 mt-1">No suppliers added yet — add one from the Suppliers tab to link future POs to their balance.</p>
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase">Items Ordered (ingredients or products)</label>
                <button
                  type="button"
                  onClick={handleAddPOLine}
                  className="text-xs text-teal-600 hover:text-teal-700 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {poLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <select
                      value={lineKey(line)}
                      onChange={(e) => {
                        const item = itemFromKey(e.target.value);
                        if (!item) return;
                        const updated = [...poLines];
                        updated[idx] = {
                          ...updated[idx],
                          ingredientId: item.ingredientId,
                          productId: item.productId,
                          ingredientName: item.ingredientName,
                          unit: item.unit,
                          unitCostPKR: item.unitCostPKR || updated[idx].unitCostPKR
                        };
                        setPoLines(updated);
                      }}
                      className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                    >
                      {itemOptions}
                    </select>

                    <input
                      type="number"
                      min={0}
                      value={line.quantity || ''}
                      onChange={(e) => {
                        const updated = [...poLines];
                        updated[idx].quantity = Number(e.target.value) || 0;
                        setPoLines(updated);
                      }}
                      className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-center font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                      placeholder="Qty"
                    />

                    <span className="text-xs text-slate-500 font-bold">{line.unit}</span>

                    <input
                      type="number"
                      value={line.unitCostPKR}
                      onChange={(e) => {
                        const updated = [...poLines];
                        updated[idx].unitCostPKR = Number(e.target.value) || 0;
                        setPoLines(updated);
                      }}
                      className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-right font-bold text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                      placeholder="PKR Unit"
                    />

                    <button
                      type="button"
                      onClick={() => setPoLines(poLines.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-500 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Purchase Order Notes</label>
              <input
                type="text"
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="e.g. Inward required by 8:00 AM"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreatePO}
              className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg transition"
            >
              Issue Purchase Order
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

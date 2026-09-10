import React, { useState, useEffect } from 'react';
import { 
  Truck, 
  ArrowRightLeft, 
  ShoppingBag, 
  Plus, 
  CheckCircle, 
  ChevronRight, 
  PackageCheck, 
  X
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { StockTransferOrder, PurchaseOrder, RawIngredient } from '../types';

export const SupplyChainManagement: React.FC = () => {
  const { selectedTenant, selectedBranch } = usePosStore();
  const location = useLocation();
  
  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;
  const [activeTab, setActiveTab] = useState<'transfers' | 'procurement'>(
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

  // New Transfer Modal
  const [isNewTransferOpen, setIsNewTransferOpen] = useState(false);
  const [transferDestBranchId, setTransferDestBranchId] = useState('');
  const [transferSourceBranchId, setTransferSourceBranchId] = useState('');
  const [transferVehicle, setTransferVehicle] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferLines, setTransferLines] = useState<Array<{
    ingredientId: string;
    ingredientName: string;
    quantityRequested: number;
    unit: string;
  }>>([]);

  // Dispatch & Receive Modals for Transfer
  const [dispatchOrder, setDispatchOrder] = useState<StockTransferOrder | null>(null);
  const [dispatchDriver, setDispatchDriver] = useState('');
  const [receiveOrder, setReceiveOrder] = useState<StockTransferOrder | null>(null);
  const [receiverName, setReceiverName] = useState('Store Receiving Officer');

  // New PO Modal
  const [isNewPOOpen, setIsNewPOOpen] = useState(false);
  const [poSupplier, setPoSupplier] = useState('National Poultry Farms');
  const [poNotes, setPoNotes] = useState('');
  const [poLines, setPoLines] = useState<Array<{
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    unitCostPKR: number;
  }>>([]);

  // Status message
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchData = async () => {
    if (!selectedTenant?.id) return;
    try {
      const [transfersData, poData, ingsData] = await Promise.all([
        posApi.getTransferOrders(selectedTenant.id),
        posApi.getPurchaseOrders(selectedTenant.id),
        selectedBranch?.id ? posApi.getRawIngredients(selectedBranch.id) : Promise.resolve([])
      ]);
      setTransfers(transfersData);
      setPurchaseOrders(poData);
      setIngredients(ingsData);
    } catch (err) {
      console.error('Failed to load supply chain data', err);
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
    const comm = selectedTenant?.branches?.find(b => b.isHeadOffice) || selectedTenant?.branches?.[0];
    const dest = (!selectedBranch?.isHeadOffice && selectedBranch) 
      ? selectedBranch 
      : (selectedTenant?.branches?.find(b => !b.isHeadOffice) || selectedTenant?.branches?.[1] || selectedTenant?.branches?.[0]);

    setTransferSourceBranchId(comm?.id || '');
    setTransferDestBranchId(dest?.id || '');
    setTransferVehicle('Cold-Chain Refrigerated Van #04');
    setTransferNotes('Emergency/Daily stock replenishment requisition to HQ Commissary');
    if (ingredients.length > 0) {
      setTransferLines([
        {
          ingredientId: ingredients[0].id,
          ingredientName: ingredients[0].name,
          quantityRequested: 50,
          unit: ingredients[0].unit
        }
      ]);
    } else {
      setTransferLines([]);
    }
    setIsNewTransferOpen(true);
  };

  useEffect(() => {
    if (location.state?.openRequisition) {
      handleOpenNewTransfer();
    }
  }, [location.state?.openRequisition, ingredients.length]);

  const handleAddTransferLine = () => {
    if (ingredients.length === 0) return;
    setTransferLines([
      ...transferLines,
      {
        ingredientId: ingredients[0].id,
        ingredientName: ingredients[0].name,
        quantityRequested: 20,
        unit: ingredients[0].unit
      }
    ]);
  };

  const handleCreateTransfer = async () => {
    if (!selectedTenant?.id || !transferSourceBranchId || !transferDestBranchId || transferLines.length === 0) {
      alert('Please select branches and at least one item');
      return;
    }
    try {
      await posApi.createTransferOrder({
        tenantId: selectedTenant.id,
        sourceBranchId: transferSourceBranchId,
        destinationBranchId: transferDestBranchId,
        vehicleOrDriver: transferVehicle,
        notes: transferNotes,
        items: transferLines
      });
      setIsNewTransferOpen(false);
      setStatusMsg('Stock Transfer Requisition successfully submitted!');
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to submit transfer order');
    }
  };

  const handleDispatch = async () => {
    if (!dispatchOrder) return;
    try {
      await posApi.dispatchTransferOrder(dispatchOrder.id, {
        dispatchedBy: 'Commissary Warehouse Supervisor',
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
        receivedBy: receiverName,
        notes: 'Quality and temperature inspection verified. Stock-in credited.'
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
    setPoSupplier('National Poultry Farms Ltd');
    setPoNotes('Fresh morning delivery batch');
    if (ingredients.length > 0) {
      setPoLines([
        {
          ingredientId: ingredients[0].id,
          ingredientName: ingredients[0].name,
          quantity: 100,
          unit: ingredients[0].unit,
          unitCostPKR: ingredients[0].costPerUnitPKR || 120
        }
      ]);
    } else {
      setPoLines([]);
    }
    setIsNewPOOpen(true);
  };

  const handleAddPOLine = () => {
    if (ingredients.length === 0) return;
    setPoLines([
      ...poLines,
      {
        ingredientId: ingredients[0].id,
        ingredientName: ingredients[0].name,
        quantity: 50,
        unit: ingredients[0].unit,
        unitCostPKR: ingredients[0].costPerUnitPKR || 100
      }
    ]);
  };

  const handleCreatePO = async () => {
    if (!selectedTenant?.id || !selectedBranch?.id || poLines.length === 0) {
      alert('Please fill out PO items');
      return;
    }
    try {
      await posApi.createPurchaseOrder({
        tenantId: selectedTenant.id,
        branchId: selectedBranch.id,
        supplierName: poSupplier,
        notes: poNotes,
        items: poLines
      });
      setIsNewPOOpen(false);
      setStatusMsg('Vendor Purchase Order issued successfully!');
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to create purchase order');
    }
  };

  const handleReceivePO = async (po: PurchaseOrder) => {
    if (!window.confirm(`Inward GRN for PO #${po.poNumber}? This will increment physical stock for all ordered raw ingredients.`)) {
      return;
    }
    try {
      await posApi.receivePurchaseOrder(po.id, {
        receivedBy: 'Branch Kitchen Receiving Manager',
        notes: 'Vendor Goods Received Note (GRN) verified.'
      });
      setStatusMsg(`PO #${po.poNumber} marked as RECEIVED! Raw ingredients updated.`);
      setTimeout(() => setStatusMsg(null), 4000);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to receive PO');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-2xl font-black text-white tracking-tight">Supply Chain & Procurement</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold border border-slate-700">
              Enterprise Logistics
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {isMultiBranchChain 
              ? 'Multi-Branch Hub: Central Commissary Stock Transfers, Dispatch Van Logistics & Vendor Procurement'
              : 'Single Restaurant: Direct Vendor Purchase Orders (PO), Inward Stock GRN & Food Supplies'}
          </p>
        </div>

        {/* Global Notifications */}
        {statusMsg && (
          <div className="px-4 py-2 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-300 text-xs font-bold flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            {statusMsg}
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl">
          {isMultiBranchChain && (
            <button
              onClick={() => setActiveTab('transfers')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeTab === 'transfers'
                  ? 'bg-emerald-600 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
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
                ? 'bg-emerald-600 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Vendor Procurement (PO)</span>
          </button>
        </div>
      </div>

      {/* TAB 1: INTER-BRANCH TRANSFERS (DYNAMICS STYLE COMMISSARY LOGISTICS) */}
      {activeTab === 'transfers' && isMultiBranchChain && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-xs text-slate-400 block">Total Transfers</span>
                <span className="text-lg font-black text-white">{transfers.length}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60">
                <span className="text-xs text-amber-300 block">🚚 In-Transit On Road</span>
                <span className="text-lg font-black text-amber-400">
                  {transfers.filter(t => t.status === 'InTransit').length}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60">
                <span className="text-xs text-emerald-300 block">Received at Outlets</span>
                <span className="text-lg font-black text-emerald-400">
                  {transfers.filter(t => t.status === 'Received').length}
                </span>
              </div>
            </div>

            <button
              onClick={handleOpenNewTransfer}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Create Store Requisition</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Transfer Requisitions & Dispatch Logistics</span>
              <span className="text-xs text-slate-500">{transfers.length} records</span>
            </div>

            {transfers.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No transfer orders found. Click "Create Store Requisition" to initiate commissary stock movement.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="p-3">Transfer #</th>
                      <th className="p-3">Route (From &rarr; To)</th>
                      <th className="p-3">Items & Quantities</th>
                      <th className="p-3">Vehicle / Logistics</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Workflow Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {transfers.map(tr => {
                      const sourceName = selectedTenant?.branches?.find(b => b.id === tr.sourceBranchId)?.name || 'Commissary';
                      const destName = selectedTenant?.branches?.find(b => b.id === tr.destinationBranchId)?.name || 'Branch';

                      return (
                        <tr key={tr.id} className="hover:bg-slate-800/30 transition">
                          <td className="p-3 font-mono font-bold text-emerald-400">
                            {tr.transferNumber}
                            <span className="block text-[10px] text-slate-500 font-sans">
                              {new Date(tr.requestedAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 font-bold text-white">
                              <span className="text-slate-300">{sourceName}</span>
                              <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">{destName}</span>
                            </div>
                            {tr.notes && <div className="text-[10px] text-slate-400 italic mt-0.5">{tr.notes}</div>}
                          </td>
                          <td className="p-3">
                            <div className="space-y-1">
                              {tr.items?.map(it => (
                                <div key={it.id} className="text-slate-300">
                                  <strong className="text-white">{it.quantityRequested} {it.unit}</strong> &bull; {it.ingredientName}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-slate-300">
                            {tr.vehicleOrDriver ? (
                              <div className="flex items-center gap-1.5">
                                <Truck className="w-3.5 h-3.5 text-blue-400" />
                                <span>{tr.vehicleOrDriver}</span>
                              </div>
                            ) : (
                              <span className="text-slate-500">Unassigned</span>
                            )}
                          </td>
                          <td className="p-3">
                            {tr.status === 'Requested' && (
                              <span className="px-2 py-1 rounded-md bg-blue-950 text-blue-400 border border-blue-800 text-[10px] font-bold">
                                Requisition Pending
                              </span>
                            )}
                            {tr.status === 'InTransit' && (
                              <span className="px-2 py-1 rounded-md bg-amber-950 text-amber-400 border border-amber-800 text-[10px] font-bold">
                                🚚 In-Transit On Road
                              </span>
                            )}
                            {tr.status === 'Received' && (
                              <span className="px-2 py-1 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" /> Received & Stocked
                              </span>
                            )}
                            {tr.status === 'Cancelled' && (
                              <span className="px-2 py-1 rounded-md bg-rose-950 text-rose-400 border border-rose-800 text-[10px] font-bold">
                                Cancelled
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {tr.status === 'Requested' && (
                              <button
                                onClick={() => {
                                  setDispatchOrder(tr);
                                  setDispatchDriver(tr.vehicleOrDriver || 'Van #04 - Driver Ali');
                                }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition"
                              >
                                Dispatch Order 🚚
                              </button>
                            )}

                            {tr.status === 'InTransit' && (
                              <button
                                onClick={() => setReceiveOrder(tr)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-md transition flex items-center gap-1.5 ml-auto"
                              >
                                <PackageCheck className="w-3.5 h-3.5" />
                                <span>Receive & Stock-In</span>
                              </button>
                            )}

                            {tr.status === 'Received' && (
                              <span className="text-[11px] text-slate-400">
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
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-xs text-slate-400 block">Total Purchase Orders</span>
                <span className="text-lg font-black text-white">{purchaseOrders.length}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60">
                <span className="text-xs text-blue-300 block">Pending Delivery</span>
                <span className="text-lg font-black text-blue-400">
                  {purchaseOrders.filter(p => p.status === 'Ordered').length}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60">
                <span className="text-xs text-emerald-300 block">Received GRNs</span>
                <span className="text-lg font-black text-emerald-400">
                  {purchaseOrders.filter(p => p.status === 'Received').length}
                </span>
              </div>
            </div>

            <button
              onClick={handleOpenNewPO}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Issue New Vendor PO</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Vendor Purchase Orders & Goods Receipt Notes</span>
              <span className="text-xs text-slate-500">{purchaseOrders.length} records</span>
            </div>

            {purchaseOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No purchase orders created yet. Issue a new PO to order fresh stock directly from bakery, poultry, or dairy vendors.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="p-3">PO #</th>
                      <th className="p-3">Vendor / Supplier</th>
                      <th className="p-3">Purchased Ingredients</th>
                      <th className="p-3">Total Value</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Inward Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {purchaseOrders.map(po => {
                      return (
                        <tr key={po.id} className="hover:bg-slate-800/30 transition">
                          <td className="p-3 font-mono font-bold text-blue-400">
                            {po.poNumber}
                            <span className="block text-[10px] text-slate-500 font-sans">
                              {new Date(po.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="p-3">
                            <strong className="text-white text-sm">{po.supplierName}</strong>
                            {po.notes && <div className="text-[10px] text-slate-400 italic">{po.notes}</div>}
                          </td>
                          <td className="p-3">
                            <div className="space-y-1">
                              {po.items?.map(it => (
                                <div key={it.id} className="text-slate-300">
                                  <strong className="text-white">{it.quantity} {it.unit}</strong> &bull; {it.ingredientName} @ ₨{it.unitCostPKR}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 font-mono font-black text-emerald-400 text-sm">
                            ₨{po.totalCostPKR.toLocaleString()}
                          </td>
                          <td className="p-3">
                            {po.status === 'Ordered' && (
                              <span className="px-2 py-1 rounded-md bg-blue-950 text-blue-400 border border-blue-800 text-[10px] font-bold">
                                Ordered (Awaiting Delivery)
                              </span>
                            )}
                            {po.status === 'Received' && (
                              <span className="px-2 py-1 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold flex items-center gap-1 w-fit">
                                <CheckCircle className="w-3 h-3" /> Received GRN
                              </span>
                            )}
                            {po.status === 'Cancelled' && (
                              <span className="px-2 py-1 rounded-md bg-rose-950 text-rose-400 border border-rose-800 text-[10px] font-bold">
                                Cancelled
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {po.status === 'Ordered' && (
                              <button
                                onClick={() => handleReceivePO(po)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-md transition flex items-center gap-1.5 ml-auto"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                <span>Inward GRN (Stock-In)</span>
                              </button>
                            )}
                            {po.status === 'Received' && (
                              <span className="text-[11px] text-slate-400">
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

      {/* MODAL: CREATE INTER-BRANCH TRANSFER */}
      {isNewTransferOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <ArrowRightLeft className="w-5 h-5" />
                <span>Create Store Stock Requisition</span>
              </div>
              <button onClick={() => setIsNewTransferOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Source (Dispatch Commissary)</label>
                <select
                  value={transferSourceBranchId}
                  onChange={(e) => setTransferSourceBranchId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none"
                >
                  {selectedTenant?.branches?.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.isHeadOffice ? '(Central Commissary)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Destination (Receiving Branch)</label>
                <select
                  value={transferDestBranchId}
                  onChange={(e) => setTransferDestBranchId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none"
                >
                  {selectedTenant?.branches?.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Logistics / Assigned Vehicle</label>
              <input
                type="text"
                value={transferVehicle}
                onChange={(e) => setTransferVehicle(e.target.value)}
                placeholder="e.g. Van #04 - KHI-9482"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Requisitioned Ingredients</label>
                <button
                  type="button"
                  onClick={handleAddTransferLine}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {transferLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <select
                      value={line.ingredientId}
                      onChange={(e) => {
                        const ing = ingredients.find(i => i.id === e.target.value);
                        if (!ing) return;
                        const updated = [...transferLines];
                        updated[idx] = {
                          ...updated[idx],
                          ingredientId: ing.id,
                          ingredientName: ing.name,
                          unit: ing.unit
                        };
                        setTransferLines(updated);
                      }}
                      className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none"
                    >
                      {ingredients.map(i => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={line.quantityRequested}
                      onChange={(e) => {
                        const updated = [...transferLines];
                        updated[idx].quantityRequested = Number(e.target.value) || 0;
                        setTransferLines(updated);
                      }}
                      className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-center font-bold text-white focus:outline-none"
                      placeholder="Qty"
                    />

                    <span className="text-xs text-slate-400 w-12 font-bold">{line.unit}</span>

                    <button
                      type="button"
                      onClick={() => setTransferLines(transferLines.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Requisition Notes</label>
              <input
                type="text"
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreateTransfer}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Submit Transfer Requisition
            </button>
          </div>
        </div>
      )}

      {/* MODAL: DISPATCH ORDER */}
      {dispatchOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Truck className="w-5 h-5" />
                <span>Commissary Dispatch Verification</span>
              </div>
              <button onClick={() => setDispatchOrder(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div className="text-slate-400">Requisition: <strong className="text-white font-mono">{dispatchOrder.transferNumber}</strong></div>
              <div className="text-slate-400">Total Lines: <strong className="text-white">{dispatchOrder.items?.length || 0} items</strong></div>
              <div className="text-amber-400 font-bold text-[11px] pt-1">
                Notice: Approving dispatch will deduct inventory from Commissary stock immediately.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Assigned Driver / Logistics Vehicle</label>
              <input
                type="text"
                value={dispatchDriver}
                onChange={(e) => setDispatchDriver(e.target.value)}
                placeholder="Driver Name or Vehicle Number"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-bold focus:outline-none"
              />
            </div>

            <button
              onClick={handleDispatch}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Confirm Dispatch & Set In-Transit 🚚
            </button>
          </div>
        </div>
      )}

      {/* MODAL: RECEIVE ORDER */}
      {receiveOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <PackageCheck className="w-5 h-5" />
                <span>Store Gate Receiving Inspection</span>
              </div>
              <button onClick={() => setReceiveOrder(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div className="text-slate-400">Requisition: <strong className="text-white font-mono">{receiveOrder.transferNumber}</strong></div>
              <div className="text-emerald-400 font-bold text-[11px] pt-1">
                Notice: Confirming receipt will increment raw materials directly at this branch's kitchen.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Received & Inspected By</label>
              <input
                type="text"
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-bold focus:outline-none"
              />
            </div>

            <button
              onClick={handleReceive}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Verify Goods & Stock-In to Branch
            </button>
          </div>
        </div>
      )}

      {/* MODAL: CREATE VENDOR PURCHASE ORDER */}
      {isNewPOOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <ShoppingBag className="w-5 h-5" />
                <span>Issue Vendor Purchase Order (Procurement)</span>
              </div>
              <button onClick={() => setIsNewPOOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Vendor / Wholesaler Name</label>
              <input
                type="text"
                value={poSupplier}
                onChange={(e) => setPoSupplier(e.target.value)}
                placeholder="e.g. Dawn Bread Bakeries, K&N's Poultry"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-bold focus:outline-none"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Ordered Raw Ingredients</label>
                <button
                  type="button"
                  onClick={handleAddPOLine}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Ingredient
                </button>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {poLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <select
                      value={line.ingredientId}
                      onChange={(e) => {
                        const ing = ingredients.find(i => i.id === e.target.value);
                        if (!ing) return;
                        const updated = [...poLines];
                        updated[idx] = {
                          ...updated[idx],
                          ingredientId: ing.id,
                          ingredientName: ing.name,
                          unit: ing.unit,
                          unitCostPKR: ing.costPerUnitPKR || 100
                        };
                        setPoLines(updated);
                      }}
                      className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white focus:outline-none"
                    >
                      {ingredients.map(i => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) => {
                        const updated = [...poLines];
                        updated[idx].quantity = Number(e.target.value) || 0;
                        setPoLines(updated);
                      }}
                      className="w-16 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-center font-bold text-white focus:outline-none"
                      placeholder="Qty"
                    />

                    <span className="text-xs text-slate-400 font-bold">{line.unit}</span>

                    <input
                      type="number"
                      value={line.unitCostPKR}
                      onChange={(e) => {
                        const updated = [...poLines];
                        updated[idx].unitCostPKR = Number(e.target.value) || 0;
                        setPoLines(updated);
                      }}
                      className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-right font-bold text-emerald-400 focus:outline-none"
                      placeholder="₨ Unit"
                    />

                    <button
                      type="button"
                      onClick={() => setPoLines(poLines.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">Purchase Order Notes</label>
              <input
                type="text"
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="e.g. Inward required by 8:00 AM"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreatePO}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg transition"
            >
              Issue Purchase Order
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


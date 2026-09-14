import React, { useState, useEffect } from 'react';
import { 
  Bike, 
  MapPin, 
  Phone, 
  CheckCircle, 
  DollarSign, 
  RefreshCw,
  X,
  Check,
  FileText
} from 'lucide-react';
import { posApi } from '../services/api';

import { usePosStore } from '../store/posStore';
import type { Order, Rider, RiderSettlementRecord } from '../types';

export const DeliveryBoard: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const [board, setBoard] = useState<{
    inKitchen: Order[];
    readyForDispatch: Order[];
    outForDelivery: Order[];
    completed: Order[];
  }>({
    inKitchen: [],
    readyForDispatch: [],
    outForDelivery: [],
    completed: []
  });

  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedOrderForAssign, setSelectedOrderForAssign] = useState<Order | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');

  // Rider COD Settlement Modal State
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [selectedRiderForSettle, setSelectedRiderForSettle] = useState<string>('');
  const [pendingCODData, setPendingCODData] = useState<any>(null);
  const [cashCollectedInput, setCashCollectedInput] = useState<number>(0);
  const [isSettling, setIsSettling] = useState(false);
  const [settlementSuccessMsg, setSettlementSuccessMsg] = useState<string | null>(null);

  // Settlement Log Modal
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [settlements, setSettlements] = useState<RiderSettlementRecord[]>([]);

  const fetchBoard = async () => {
    if (!selectedBranch?.id) return;
    try {
      const data = await posApi.getDeliveryBoard(selectedBranch.id);
      setBoard(data);
      const riderList = await posApi.getRiders(selectedBranch.id);
      setRiders(riderList);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSettlements = async () => {
    if (!selectedBranch?.id) return;
    try {
      const data = await posApi.getDeliverySettlements(selectedBranch.id);
      setSettlements(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchBoard();
    const interval = setInterval(fetchBoard, 6000);
    return () => clearInterval(interval);
  }, [selectedBranch?.id]);

  const handleAssignRider = async () => {
    if (!selectedOrderForAssign || !selectedRiderId) return;
    try {
      await posApi.assignRider(selectedOrderForAssign.id, selectedRiderId);
      setSelectedOrderForAssign(null);
      setSelectedRiderId('');
      fetchBoard();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkDelivered = async (orderId: string) => {
    try {
      await posApi.markDelivered(orderId);
      fetchBoard();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenSettlement = async (riderId?: string) => {
    setIsSettlementOpen(true);
    setSettlementSuccessMsg(null);
    const targetRiderId = riderId || (riders.length > 0 ? riders[0].id : '');
    setSelectedRiderForSettle(targetRiderId);

    if (targetRiderId) {
      try {
        const data = await posApi.getRiderPendingCOD(targetRiderId);
        setPendingCODData(data);
        setCashCollectedInput(data.expectedCODPKR);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleRiderChangeForSettle = async (riderId: string) => {
    setSelectedRiderForSettle(riderId);
    try {
      const data = await posApi.getRiderPendingCOD(riderId);
      setPendingCODData(data);
      setCashCollectedInput(data.expectedCODPKR);
    } catch (err) {
      console.error(err);
    }
  };

  const handleConfirmSettlement = async () => {
    if (!pendingCODData) return;
    setIsSettling(true);
    try {
      const res = await posApi.settleRiderCOD({
        riderId: selectedRiderForSettle,
        totalOrdersDelivered: pendingCODData.completedOrders,
        expectedCODPKR: pendingCODData.expectedCODPKR,
        cashCollectedPKR: cashCollectedInput,
        settledBy: 'Manager'
      });
      setSettlementSuccessMsg(res.message);
      setTimeout(() => {
        setIsSettlementOpen(false);
        fetchBoard();
      }, 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSettling(false);
    }
  };

  const expectedCOD = pendingCODData?.expectedCODPKR || 0;
  const variance = cashCollectedInput - expectedCOD;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-hidden bg-slate-50 text-slate-900 p-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Bike className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <span>Delivery Dispatch & COD Control Board</span>
            </h1>
            <p className="text-xs text-slate-500">
              Real-time multi-stage delivery tracking with Cash on Delivery (COD) driver reconciliation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Settlement Logs */}
          <button
            onClick={() => {
              fetchSettlements();
              setIsHistoryOpen(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs transition"
          >
            <FileText className="w-4 h-4 text-blue-500" />
            <span>Settlement History</span>
          </button>

          {/* Settle Rider COD Action Button */}
          <button
            onClick={() => handleOpenSettlement()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25 transition"
          >
            <DollarSign className="w-4 h-4" />
            <span>Rider COD Settlement</span>
          </button>

          <button
            onClick={fetchBoard}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
            title="Refresh Board"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4-Stage Kanban Columns */}
      <div className="flex-1 overflow-x-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-2">
        {/* Column 1: In Kitchen */}
        <div className="flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="font-bold text-xs text-slate-900">1. In Kitchen</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-mono font-bold">
              {board.inKitchen.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {board.inKitchen.map(order => (
              <div key={order.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-black text-xs text-slate-900">{order.orderNumber}</span>
                    <div className="text-[10px] text-amber-600 font-semibold">{order.orderType}</div>
                  </div>
                  <span className="text-xs font-black text-teal-600">₨{order.totalPKR.toLocaleString()}</span>
                </div>

                <div className="text-xs text-slate-700">
                  <div className="font-semibold">{order.customerName || 'Customer'}</div>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" /> {order.customerPhone || 'N/A'}
                  </div>
                  {order.deliveryAddress && (
                    <div className="text-[10px] text-slate-500 flex items-start gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{order.deliveryAddress}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between">
                  <span>{order.items.length} items</span>
                  <span className="text-amber-600">Cooking...</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Ready for Dispatch */}
        <div className="flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
              <span className="font-bold text-xs text-slate-900">2. Ready for Dispatch</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-mono font-bold">
              {board.readyForDispatch.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {board.readyForDispatch.map(order => (
              <div key={order.id} className="p-3 rounded-xl bg-slate-50 border border-blue-200 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-black text-xs text-slate-900">{order.orderNumber}</span>
                    <div className="text-[10px] text-blue-600 font-semibold">Packed & Ready</div>
                  </div>
                  <span className="text-xs font-black text-teal-600">₨{order.totalPKR.toLocaleString()}</span>
                </div>

                <div className="text-xs text-slate-700">
                  <div className="font-semibold">{order.customerName}</div>
                  <div className="text-[10px] text-slate-500">{order.customerPhone}</div>
                  {order.deliveryAddress && (
                    <div className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">
                      {order.deliveryAddress}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    setSelectedOrderForAssign(order);
                    setSelectedRiderId(riders.length > 0 ? riders[0].id : '');
                  }}
                  className="w-full py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                >
                  <Bike className="w-3.5 h-3.5" />
                  <span>Assign Rider</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Out for Delivery */}
        <div className="flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse"></span>
              <span className="font-bold text-xs text-slate-900">3. Out for Delivery</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-mono font-bold">
              {board.outForDelivery.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {board.outForDelivery.map(order => (
              <div key={order.id} className="p-3 rounded-xl bg-slate-50 border border-purple-200 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-black text-xs text-slate-900">{order.orderNumber}</span>
                    <div className="text-[10px] text-purple-600 font-semibold flex items-center gap-1">
                      <Bike className="w-3 h-3 text-purple-500" />
                      <span>{order.assignedRider?.name || 'Rider En Route'}</span>
                    </div>
                  </div>
                  <span className="text-xs font-black text-teal-600">₨{order.totalPKR.toLocaleString()} (COD)</span>
                </div>

                <div className="text-xs text-slate-700">
                  <div className="font-semibold">{order.customerName}</div>
                  <div className="text-[10px] text-slate-500">{order.customerPhone}</div>
                  <div className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">{order.deliveryAddress}</div>
                </div>

                <button
                  onClick={() => handleMarkDelivered(order.id)}
                  className="w-full py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Mark Delivered & Paid</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Column 4: Completed Deliveries */}
        <div className="flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
              <span className="font-bold text-xs text-slate-900">4. Delivered</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 font-mono font-bold">
              {board.completed.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {board.completed.map(order => (
              <div key={order.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 opacity-80">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-xs text-slate-700">{order.orderNumber}</span>
                  <span className="text-xs font-bold text-teal-600">₨{order.totalPKR.toLocaleString()}</span>
                </div>
                <div className="text-[11px] text-slate-500">{order.customerName} • {order.assignedRider?.name || 'Rider'}</div>
                <div className="text-[10px] text-teal-600 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" /> Successfully Delivered & Paid
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Assign Rider Modal */}
      {selectedOrderForAssign && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <h3 className="font-bold text-sm text-slate-900">Assign Delivery Rider</h3>
              <button onClick={() => setSelectedOrderForAssign(null)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-700 space-y-1">
              <div>Order: <strong>{selectedOrderForAssign.orderNumber}</strong></div>
              <div>Customer: {selectedOrderForAssign.customerName}</div>
              <div>COD Amount: <strong className="text-teal-600">₨{selectedOrderForAssign.totalPKR.toLocaleString()}</strong></div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Select Active Rider</label>
              <div className="space-y-1.5">
                {riders.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRiderId(r.id)}
                    className={`w-full p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition ${
                      selectedRiderId === r.id
                        ? 'bg-blue-50 border-blue-200 text-blue-600'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900">{r.name}</div>
                      <div className="text-[10px] text-slate-500">{r.phone} • {r.vehicleNumber}</div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.isAvailable ? 'bg-teal-50 text-teal-600' : 'bg-slate-100 text-slate-500'}`}>
                      {r.isAvailable ? 'Available' : 'Busy'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleAssignRider}
              disabled={!selectedRiderId}
              className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-black text-xs shadow-lg shadow-blue-500/25 transition disabled:opacity-40"
            >
              Confirm Dispatch
            </button>
          </div>
        </div>
      )}

      {/* Rider COD Reconciliation & Cash Settlement Modal */}
      {isSettlementOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
                <DollarSign className="w-5 h-5" />
                <span>Rider COD Cash Reconciliation</span>
              </div>
              <button onClick={() => setIsSettlementOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            {settlementSuccessMsg ? (
              <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-center text-teal-600 space-y-1">
                <CheckCircle className="w-8 h-8 text-teal-500 mx-auto" />
                <div className="font-bold text-sm">{settlementSuccessMsg}</div>
                <div className="text-xs text-slate-500">Shift cash successfully balanced and recorded.</div>
              </div>
            ) : (
              <>
                {/* Rider Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Select Rider for End-of-Shift Settle</label>
                  <select
                    value={selectedRiderForSettle}
                    onChange={(e) => handleRiderChangeForSettle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  >
                    {riders.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>
                    ))}
                  </select>
                </div>

                {/* COD Figures */}
                {pendingCODData && (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Total Orders Delivered:</span>
                      <strong className="text-slate-900">{pendingCODData.completedOrders} orders</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Expected Cash Collection:</span>
                      <strong className="text-teal-600 font-black text-sm">₨{expectedCOD.toLocaleString()}</strong>
                    </div>

                    <div className="pt-2 border-t border-slate-200 space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Physical Cash Handed Over by Rider (PKR):
                      </label>
                      <input
                        type="number"
                        value={cashCollectedInput || ''}
                        onChange={(e) => setCashCollectedInput(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-right font-black text-slate-900 text-sm focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                    </div>

                    {/* Variance / Discrepancy indicator */}
                    <div className={`p-2.5 rounded-lg flex items-center justify-between font-bold ${
                      variance === 0
                        ? 'bg-teal-50 text-teal-600 border border-teal-200'
                        : variance > 0
                        ? 'bg-blue-50 text-blue-600 border border-blue-200'
                        : 'bg-rose-50 text-rose-600 border border-rose-200'
                    }`}>
                      <span>Reconciliation Variance:</span>
                      <span>
                        {variance === 0 ? '₨0 (Balanced 100%)' : variance > 0 ? `+₨${variance} (Surplus)` : `-₨${Math.abs(variance)} (Shortage)`}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleConfirmSettlement}
                  disabled={isSettling}
                  className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25 transition"
                >
                  {isSettling ? 'Reconciling...' : 'Confirm Reconciliation & Close Rider Shift'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Rider COD Settlement History Modal */}
      {isHistoryOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2 text-blue-600 font-bold text-sm">
                <FileText className="w-5 h-5" />
                <span>Rider End-of-Shift COD Settlement Audit Trail</span>
              </div>
              <button onClick={() => setIsHistoryOpen(false)} className="text-slate-400 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>

            {settlements.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No past rider settlement records found for this branch.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto pr-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Date / Time</th>
                      <th className="p-2.5">Rider</th>
                      <th className="p-2.5 text-center">Delivered</th>
                      <th className="p-2.5 text-right">Expected (₨)</th>
                      <th className="p-2.5 text-right">Collected (₨)</th>
                      <th className="p-2.5 text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {settlements.map(st => (
                      <tr key={st.id} className="hover:bg-slate-50">
                        <td className="p-2.5 text-slate-500 font-sans">
                          {new Date(st.settledAt).toLocaleDateString()} {new Date(st.settledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-2.5 text-slate-900 font-bold">{st.rider?.name || 'Rider'}</td>
                        <td className="p-2.5 text-center text-slate-700">{st.totalOrdersDelivered}</td>
                        <td className="p-2.5 text-right font-mono text-slate-700">₨{st.totalCODExpectedPKR.toLocaleString()}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-900">₨{st.totalCashCollectedPKR.toLocaleString()}</td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {st.shortageSurplusPKR === 0 ? (
                            <span className="text-teal-600">₨0</span>
                          ) : st.shortageSurplusPKR > 0 ? (
                            <span className="text-blue-600">+₨{st.shortageSurplusPKR}</span>
                          ) : (
                            <span className="text-rose-600">-₨{Math.abs(st.shortageSurplusPKR)}</span>
                          )}
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
    </div>
  );
};

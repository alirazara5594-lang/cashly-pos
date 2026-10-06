import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Package,
  Plus,
  Search,
  X,
  Send,
  Eye,
  Trash2,
  Truck,
  Inbox
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess, runsBusiness } from '../store/posStore';
import { useBusinessShape, locationKindOf } from '../hooks/useBusinessShape';
import type { StockRequest, StockRequestItem, RawIngredient, Branch } from '../types';

type RequestType = 'ToOwner' | 'ToVendor' | 'ToHQ';

/** Where a request goes, as the person asking reads it. */
const requestTarget = (r: Pick<StockRequest, 'requestType' | 'vendorName'>) =>
  r.requestType === 'ToVendor' ? `From supplier${r.vendorName ? `: ${r.vendorName}` : ''}`
    : r.requestType === 'ToHQ' ? 'To head office'
    : 'To the owner';

/** A status in plain words. "Ordered" on a head-office request means its transfer is on the way. */
const statusLabel = (r: Pick<StockRequest, 'status' | 'requestType'>) => {
  switch (r.status) {
    case 'Pending': return 'Waiting';
    case 'Approved': return 'Approved';
    case 'Rejected': return 'Turned down';
    case 'Ordered': return r.requestType === 'ToHQ' ? 'Stock on its way' : 'Ordered';
    case 'Fulfilled': return 'Received';
    default: return r.status;
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case 'Pending': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Approved': return 'bg-teal-100 text-teal-700 border-teal-200';
    case 'Rejected': return 'bg-red-100 text-red-700 border-red-200';
    case 'Ordered': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Fulfilled': return 'bg-purple-100 text-purple-700 border-purple-200';
    default: return 'bg-slate-100 text-slate-500 border-slate-200';
  }
};

/** Where stock is sent from: a warehouse first, then a head office that keeps stock, then any other location. */
const sendingLocations = (locations: Branch[], requestingBranchId: string) => {
  const rank = (b: Branch) => (locationKindOf(b) === 'Warehouse' ? 0 : locationKindOf(b) === 'HeadOffice' ? 1 : 2);
  return locations
    .filter(b => b.holdsStock !== false && b.id !== requestingBranchId)
    .sort((a, b) => rank(a) - rank(b));
};

/**
 * Stock requests. An outlet asks its head office (or, in a single shop, the owner) for stock, or asks
 * to buy it from a supplier. At head office this is the inbox of every outlet's requests: sending
 * the stock creates the transfer, which the outlet then receives — one flow from asking to receiving.
 */
export const StockRequests: React.FC = () => {
  const { selectedBranch, currentUser, modulePermissions, packageFeatures } = usePosStore();
  const { atHeadOffice, hasHeadOffice, locations } = useBusinessShape();
  const location = useLocation();
  const navigate = useNavigate();

  const isInbox = atHeadOffice;
  // Who answers a request: head office for its outlets (or the owner, wherever they are); in a
  // single shop, whoever may manage purchasing. An outlet never approves what it asked head office for.
  const canReview = hasModuleAccess(currentUser?.role, modulePermissions, 'supplychain', 'edit')
    && (isInbox || !hasHeadOffice || runsBusiness(currentUser?.role));
  const canTransfer = packageFeatures?.hasStockTransfers !== false;
  const me = currentUser?.fullName || currentUser?.username || '';

  // The choices depend on the business: an outlet under a head office asks head office; a single
  // shop asks its owner. Either can ask to buy from a supplier.
  const requestTypes: { value: RequestType; label: string; desc: string }[] = hasHeadOffice
    ? [
        { value: 'ToHQ', label: 'To head office', desc: 'Head office sends it from its stock' },
        { value: 'ToVendor', label: 'From a supplier', desc: 'Buy it yourself once approved' }
      ]
    : [
        { value: 'ToOwner', label: 'To the owner', desc: 'The owner approves buying it' },
        { value: 'ToVendor', label: 'From a supplier', desc: 'Buy it from a supplier' }
      ];

  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [ingredients, setIngredients] = useState<RawIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);

  // New Request Modal
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>(requestTypes[0].value);
  const [vendorName, setVendorName] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestItems, setRequestItems] = useState<StockRequestItem[]>([]);
  const [selectedIngredient, setSelectedIngredient] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addCost, setAddCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // View Detail Modal
  const [viewRequest, setViewRequest] = useState<StockRequest | null>(null);
  const [sendFrom, setSendFrom] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      // Head office reads every outlet's requests; an outlet its own, plus its ingredients to ask for.
      const [reqs, ings] = await Promise.all([
        posApi.getStockRequests(isInbox ? undefined : selectedBranch?.id),
        isInbox || !selectedBranch?.id ? Promise.resolve([] as RawIngredient[]) : posApi.getRawIngredients(selectedBranch.id)
      ]);
      setRequests(Array.isArray(reqs) ? reqs : []);
      setIngredients(Array.isArray(ings) ? ings : []);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, 'Could not load stock requests.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch?.id, isInbox]);

  // Arriving from Stock → "Request from head office" opens a request straight away — once per
  // arrival, adjusted while rendering rather than in an effect.
  const wantedType = (location.state as { newRequest?: RequestType } | null)?.newRequest;
  const [handledArrival, setHandledArrival] = useState<string | null>(null);
  if (wantedType && !isInbox && handledArrival !== location.key) {
    setHandledArrival(location.key);
    setRequestType(requestTypes.some(t => t.value === wantedType) ? wantedType : requestTypes[0].value);
    setShowNewRequest(true);
  }

  const openNewRequest = () => {
    setRequestType(requestTypes[0].value);
    setFormError(null);
    setShowNewRequest(true);
  };

  const openRequest = (r: StockRequest) => {
    setViewRequest(r);
    setActionError(null);
    setSendFrom(sendingLocations(locations, r.branchId)[0]?.id ?? '');
  };

  const handleAddItem = () => {
    const ing = ingredients.find(i => i.id === selectedIngredient);
    const qty = parseFloat(addQty);
    if (!ing || !(qty > 0)) return;
    const cost = parseFloat(addCost || '0');

    if (requestItems.some(i => i.ingredientId === ing.id)) {
      setRequestItems(prev => prev.map(i =>
        i.ingredientId === ing.id
          ? { ...i, quantityRequested: i.quantityRequested + qty }
          : i
      ));
    } else {
      setRequestItems(prev => [...prev, {
        ingredientId: ing.id,
        ingredientName: ing.name,
        unit: ing.unit || 'Piece',
        quantityRequested: qty,
        currentStock: ing.currentStock || 0,
        unitCostPKR: cost || ing.costPerUnitPKR || 0
      }]);
    }

    setSelectedIngredient('');
    setAddQty('');
    setAddCost('');
  };

  const handleRemoveItem = (ingredientId: string) => {
    setRequestItems(prev => prev.filter(i => i.ingredientId !== ingredientId));
  };

  const handleSubmitRequest = async () => {
    if (requestItems.length === 0 || !selectedBranch?.id) return;
    if (requestType === 'ToVendor' && !vendorName.trim()) {
      setFormError('Enter the supplier.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await posApi.createStockRequest({
        branchId: selectedBranch.id,
        requestType,
        vendorName: requestType === 'ToVendor' ? vendorName.trim() : undefined,
        notes: requestNotes,
        createdBy: me,
        createdByUserId: currentUser?.id,
        items: requestItems
      });
      setShowNewRequest(false);
      setRequestItems([]);
      setRequestNotes('');
      setVendorName('');
      setNotice(requestType === 'ToHQ' ? 'Request sent to head office.' : 'Request sent.');
      loadData();
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not send the request.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewRequest = async (id: string, status: 'Approved' | 'Rejected') => {
    setActing(true);
    setActionError(null);
    try {
      await posApi.reviewStockRequest(id, {
        status,
        reviewedBy: me,
        reviewNotes: status === 'Approved' ? 'Approved' : 'Turned down'
      });
      setViewRequest(null);
      loadData();
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not update the request.'));
    } finally {
      setActing(false);
    }
  };

  /** Head office sends the stock: a transfer from sendFrom to the outlet, ready to dispatch. */
  const handleSendStock = async (r: StockRequest) => {
    if (!sendFrom) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await posApi.sendStockRequest(r.id, sendFrom);
      setViewRequest(null);
      setNotice(`Transfer ${res.transferNumber} created for ${r.branchName ?? 'the outlet'}. Dispatch it from Transfers when it leaves.`);
      loadData();
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not create the transfer.'));
    } finally {
      setActing(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!confirm('Delete this stock request?')) return;
    try {
      await posApi.deleteStockRequest(id);
      loadData();
    } catch (err) {
      setLoadError(getApiErrorMessage(err, 'Could not delete the request.'));
    }
  };

  const filteredRequests = requests.filter(r => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term ||
      r.requestNumber.toLowerCase().includes(term) ||
      r.createdBy?.toLowerCase().includes(term) ||
      r.branchName?.toLowerCase().includes(term) ||
      r.vendorName?.toLowerCase().includes(term);
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });
  const waitingCount = requests.filter(r => r.status === 'Pending').length;

  const totalEstimated = requestItems.reduce((sum, i) => sum + (i.quantityRequested * i.unitCostPKR), 0);
  const viewSources = viewRequest ? sendingLocations(locations, viewRequest.branchId) : [];
  const viewIsOpen = !!viewRequest && (viewRequest.status === 'Pending' || viewRequest.status === 'Approved');

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-50 text-slate-900 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            {isInbox ? <Inbox className="w-6 h-6 text-teal-600" /> : <Package className="w-6 h-6 text-teal-600" />}
            {isInbox ? 'Outlet Requests' : 'Stock Requests'}
            {isInbox && waitingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[11px] font-bold">
                {waitingCount} waiting
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isInbox
              ? 'Stock your outlets have asked for. Send it from the location that holds it, or turn it down.'
              : hasHeadOffice
                ? 'Ask head office for stock, or ask to buy it from a supplier.'
                : 'Ask the owner to approve stock, or order it from a supplier.'}
          </p>
        </div>
        {!isInbox && (
          <button
            onClick={openNewRequest}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs transition shadow-lg shadow-teal-500/25"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        )}
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold flex items-center justify-between gap-3">
          <span>{notice}</span>
          <div className="flex items-center gap-2 shrink-0">
            {notice.startsWith('Transfer') && (
              <button
                onClick={() => navigate('/transfers', { state: { tab: 'transfers' } })}
                className="px-3 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-bold transition"
              >
                Open Transfers
              </button>
            )}
            <button onClick={() => setNotice(null)} className="text-teal-600 hover:text-teal-900" title="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{loadError}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder={isInbox ? 'Search by request #, outlet, person or supplier…' : 'Search by request #, person or supplier…'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none"
        >
          <option value="all">All requests</option>
          <option value="Pending">Waiting</option>
          <option value="Approved">Approved</option>
          <option value="Ordered">On its way / ordered</option>
          <option value="Fulfilled">Received</option>
          <option value="Rejected">Turned down</option>
        </select>
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-xs">Loading…</div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 text-slate-500 bg-white rounded-2xl border border-slate-200">
          <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-xs">
            {requests.length > 0
              ? 'No requests match.'
              : isInbox
                ? 'No requests from your outlets yet. When an outlet asks for stock, it appears here.'
                : 'No stock requests yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map(r => (
            <div key={r.id} className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="px-2.5 py-1 rounded-lg bg-slate-100 text-xs font-mono font-bold text-slate-900 shrink-0">
                    {r.requestNumber}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {isInbox ? `${r.branchName ?? 'Outlet'} · ${requestTarget(r)}` : requestTarget(r)}
                    </div>
                    <div className="text-[10px] text-slate-500">By {r.createdBy} • {new Date(r.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${statusColor(r.status)}`}>
                    {statusLabel(r)}
                  </span>
                  <button
                    onClick={() => openRequest(r)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
                    title={isInbox && r.status === 'Pending' ? 'Answer this request' : 'Open'}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {!isInbox && r.status === 'Pending' && (
                    <button
                      onClick={() => handleDeleteRequest(r.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600 transition"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Items Preview */}
              <div className="flex flex-wrap gap-2">
                {r.items.slice(0, 4).map((item, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700">
                    {item.ingredientName} × {item.quantityRequested} {item.unit}
                  </span>
                ))}
                {r.items.length > 4 && (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] text-slate-500">
                    +{r.items.length - 4} more
                  </span>
                )}
              </div>

              {/* Cost + Notes */}
              <div className="flex items-center justify-between text-[10px]">
                <div className="text-slate-500">
                  {r.notes && <span>📝 {r.notes}</span>}
                </div>
                <div className="font-mono font-bold text-teal-600">
                  {r.estimatedCostPKR.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Request Modal */}
      {showNewRequest && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Send className="w-5 h-5 text-teal-600" />
                New Stock Request
              </h3>
              <button onClick={() => setShowNewRequest(false)} className="text-slate-400 hover:text-slate-900 text-sm cursor-pointer">✕</button>
            </div>

            {/* Request Type */}
            <div className="grid grid-cols-2 gap-2">
              {requestTypes.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRequestType(opt.value)}
                  className={`p-3 rounded-xl border text-left transition ${
                    requestType === opt.value
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div className="text-[10px] opacity-80">{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Supplier (if ToVendor) */}
            {requestType === 'ToVendor' && (
              <input
                type="text"
                placeholder="Supplier name"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            )}

            {/* Notes */}
            <input
              type="text"
              placeholder="Notes (optional)"
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
            />

            {/* Add Item Row */}
            <div className="flex items-center gap-2">
              <select
                value={selectedIngredient}
                onChange={(e) => setSelectedIngredient(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none"
              >
                <option value="">Select ingredient…</option>
                {ingredients.map(i => (
                  <option key={i.id} value={i.id}>{i.name} (in stock: {i.currentStock || 0} {i.unit || 'pc'})</option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                placeholder="Qty"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none"
              />
              <input
                type="number"
                min={0}
                placeholder="Cost/unit"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
                className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none"
              />
              <button
                onClick={handleAddItem}
                disabled={!selectedIngredient || !(parseFloat(addQty) > 0)}
                className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-xs transition"
              >
                Add
              </button>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {requestItems.length === 0 ? (
                <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  {ingredients.length === 0
                    ? 'This location has no ingredients yet. Add them under Stock first.'
                    : 'Add the items you need above.'}
                </div>
              ) : (
                requestItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex-1">
                      <div className="text-xs font-bold text-slate-900">{item.ingredientName}</div>
                      <div className="text-[10px] text-slate-500">
                        In stock: {item.currentStock} {item.unit} • {item.unitCostPKR}/{item.unit}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 text-xs font-mono font-bold">
                        {item.quantityRequested} {item.unit}
                      </span>
                      <span className="text-xs font-mono text-teal-600 font-semibold min-w-[70px] text-right">
                        {(item.quantityRequested * item.unitCostPKR).toLocaleString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(item.ingredientId)}
                      className="text-slate-400 hover:text-red-600 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {formError && (
              <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{formError}</div>
            )}

            {/* Total + Submit */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <div className="text-xs text-slate-500">
                Estimated total: <span className="font-bold text-teal-600 font-mono">{totalEstimated.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewRequest(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRequest}
                  disabled={requestItems.length === 0 || submitting}
                  className="px-5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-xs transition"
                >
                  {submitting ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Detail Modal */}
      {viewRequest && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <span className="font-mono text-teal-700">{viewRequest.requestNumber}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor(viewRequest.status)}`}>
                    {statusLabel(viewRequest)}
                  </span>
                </h3>
                <div className="text-xs text-slate-500 mt-0.5">
                  {viewRequest.branchName ? `${viewRequest.branchName} · ` : ''}{requestTarget(viewRequest)} • By {viewRequest.createdBy}
                </div>
              </div>
              <button onClick={() => setViewRequest(null)} className="text-slate-400 hover:text-slate-900 text-sm cursor-pointer">✕</button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {viewRequest.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div>
                    <div className="text-xs font-bold text-slate-900">{item.ingredientName}</div>
                    <div className="text-[10px] text-slate-500">Had in stock: {item.currentStock} {item.unit} • {item.unitCostPKR}/{item.unit}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-amber-600">{item.quantityRequested} {item.unit}</div>
                    <div className="text-[10px] font-mono text-teal-600">{(item.quantityRequested * item.unitCostPKR).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary + Actions */}
            <div className="pt-3 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Estimated total:</span>
                <span className="font-bold text-teal-600 font-mono">{viewRequest.estimatedCostPKR.toLocaleString()}</span>
              </div>
              {viewRequest.notes && (
                <div className="text-xs text-slate-500">📝 {viewRequest.notes}</div>
              )}
              {viewRequest.reviewedBy && (
                <div className="text-[10px] text-slate-500">
                  {viewRequest.reviewedBy}{viewRequest.reviewedAt ? `, ${new Date(viewRequest.reviewedAt).toLocaleString()}` : ''}
                  {viewRequest.reviewNotes && ` — ${viewRequest.reviewNotes}`}
                </div>
              )}

              {actionError && (
                <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{actionError}</div>
              )}

              {/* Head office sends what an outlet asked it for: that creates the transfer. */}
              {canReview && viewIsOpen && viewRequest.requestType === 'ToHQ' && canTransfer && (
                viewSources.length > 0 ? (
                  <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 space-y-2">
                    <label className="text-[11px] font-bold text-teal-800 flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5" /> Send from
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={sendFrom}
                        onChange={(e) => setSendFrom(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white border border-teal-200 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none"
                      >
                        {viewSources.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.name}{locationKindOf(b) === 'HeadOffice' ? ' (head office)' : locationKindOf(b) === 'Warehouse' ? ' (warehouse)' : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleSendStock(viewRequest)}
                        disabled={acting || !sendFrom}
                        className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-xs transition"
                      >
                        {acting ? 'Creating…' : 'Send Stock'}
                      </button>
                    </div>
                    <p className="text-[10px] text-teal-700">
                      Creates a transfer to {viewRequest.branchName ?? 'the outlet'} with these items. Dispatch it from Transfers when it leaves; the request closes when the outlet receives it.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                    None of your other locations keeps stock, so there is nowhere to send it from. Approve it so the outlet buys it
                    itself, or set the head office to keep stock in Locations.
                  </div>
                )
              )}

              {canReview && viewRequest.status === 'Pending' && (
                <div className="flex gap-2">
                  {(viewRequest.requestType !== 'ToHQ' || !canTransfer || viewSources.length === 0) && (
                    <button
                      onClick={() => handleReviewRequest(viewRequest.id, 'Approved')}
                      disabled={acting}
                      className="flex-1 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-40 text-white font-bold text-xs transition"
                    >
                      ✓ Approve
                    </button>
                  )}
                  <button
                    onClick={() => handleReviewRequest(viewRequest.id, 'Rejected')}
                    disabled={acting}
                    className="flex-1 px-4 py-2 rounded-xl bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40 font-bold text-xs transition"
                  >
                    ✕ Turn down
                  </button>
                </div>
              )}

              <button
                onClick={() => setViewRequest(null)}
                className="w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition cursor-pointer"
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

import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  X, 
  Send,
  Eye,
  Trash2
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { StockRequest, StockRequestItem, RawIngredient } from '../types';

export const StockRequests: React.FC = () => {
  const { selectedBranch } = usePosStore();
  
  // Get current user from localStorage
  const currentUser = JSON.parse(localStorage.getItem('cashly_pos_user') || '{}');
  
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [ingredients, setIngredients] = useState<RawIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  
  // New Request Modal
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [requestType, setRequestType] = useState<'ToOwner' | 'ToVendor' | 'ToHQ'>('ToOwner');
  const [vendorName, setVendorName] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestItems, setRequestItems] = useState<StockRequestItem[]>([]);
  const [selectedIngredient, setSelectedIngredient] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addCost, setAddCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // View Detail Modal
  const [viewRequest, setViewRequest] = useState<StockRequest | null>(null);

  useEffect(() => {
    loadData();
  }, [selectedBranch?.id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [reqs, ings] = await Promise.all([
        posApi.getStockRequests(selectedBranch?.id),
        posApi.getRawIngredients(selectedBranch?.id || '')
      ]);
      setRequests(reqs);
      setIngredients(ings);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    const ing = ingredients.find(i => i.id === selectedIngredient);
    if (!ing || !addQty) return;
    
    const qty = parseFloat(addQty);
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
    setSubmitting(true);
    
    try {
      await posApi.createStockRequest({
        branchId: selectedBranch.id,
        requestType,
        vendorName: requestType === 'ToVendor' ? vendorName : undefined,
        notes: requestNotes,
        createdBy: currentUser?.fullName || currentUser?.username || 'Branch Manager',
        createdByUserId: currentUser?.id,
        items: requestItems
      });
      
      setShowNewRequest(false);
      setRequestItems([]);
      setRequestNotes('');
      setVendorName('');
      loadData();
    } catch (err) {
      console.error('Failed to create stock request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewRequest = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      await posApi.reviewStockRequest(id, {
        status,
        reviewedBy: currentUser?.fullName || currentUser?.username || 'Owner',
        reviewNotes: `Request ${status.toLowerCase()} by owner`
      });
      loadData();
      setViewRequest(null);
    } catch (err) {
      console.error('Failed to review request:', err);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!confirm('Delete this stock request?')) return;
    try {
      await posApi.deleteStockRequest(id);
      loadData();
    } catch (err) {
      console.error('Failed to delete request:', err);
    }
  };

  const filteredRequests = requests.filter(r => {
    const matchesSearch = !searchTerm || 
      r.requestNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.createdBy?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.vendorName?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-amber-950/60 text-amber-400 border-amber-800';
      case 'Approved': return 'bg-emerald-950/60 text-emerald-400 border-emerald-800';
      case 'Rejected': return 'bg-red-950/60 text-red-400 border-red-800';
      case 'Ordered': return 'bg-blue-950/60 text-blue-400 border-blue-800';
      case 'Fulfilled': return 'bg-purple-950/60 text-purple-400 border-purple-800';
      default: return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  const totalEstimated = requestItems.reduce((sum, i) => sum + (i.quantityRequested * i.unitCostPKR), 0);

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-400" />
            Stock Requests
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Request stock from Owner, Vendor, or HQ based on your deployment type
          </p>
        </div>
        <button
          onClick={() => setShowNewRequest(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-slate-950 font-bold text-xs transition"
        >
          <Plus className="w-4 h-4" />
          New Stock Request
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by request #, creator, vendor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="Ordered">Ordered</option>
          <option value="Fulfilled">Fulfilled</option>
        </select>
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-xs">Loading...</div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-slate-900 rounded-2xl border border-slate-800">
          <Package className="w-12 h-12 mx-auto mb-3 text-slate-700" />
          <p className="text-xs">No stock requests found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map(r => (
            <div key={r.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="px-2.5 py-1 rounded-lg bg-slate-800 text-xs font-mono font-bold text-white">
                    {r.requestNumber}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">{r.requestType === 'ToVendor' ? `Vendor: ${r.vendorName}` : r.requestType === 'ToHQ' ? 'Request to HQ' : 'Request to Owner'}</div>
                    <div className="text-[10px] text-slate-400">By {r.createdBy} • {new Date(r.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${getStatusColor(r.status)}`}>
                    {r.status}
                  </span>
                  <button
                    onClick={() => setViewRequest(r)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {r.status === 'Pending' && (
                    <button
                      onClick={() => handleDeleteRequest(r.id)}
                      className="p-1.5 rounded-lg hover:bg-red-950 text-slate-400 hover:text-red-400 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Items Preview */}
              <div className="flex flex-wrap gap-2">
                {r.items.slice(0, 4).map((item, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                    {item.ingredientName} × {item.quantityRequested} {item.unit}
                  </span>
                ))}
                {r.items.length > 4 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                    +{r.items.length - 4} more
                  </span>
                )}
              </div>

              {/* Cost + Notes */}
              <div className="flex items-center justify-between text-[10px]">
                <div className="text-slate-400">
                  {r.notes && <span>📝 {r.notes}</span>}
                </div>
                <div className="font-mono font-bold text-emerald-400">
                  ₨{r.estimatedCostPKR.toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Request Modal */}
      {showNewRequest && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Send className="w-5 h-5 text-blue-400" />
                New Stock Request
              </h3>
              <button onClick={() => setShowNewRequest(false)} className="text-slate-400 hover:text-white text-sm cursor-pointer">✕</button>
            </div>

            {/* Request Type */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'ToOwner', label: 'To Owner', desc: 'Request approval from owner' },
                { value: 'ToVendor', label: 'To Vendor', desc: 'Contact vendor directly' },
                { value: 'ToHQ', label: 'To HQ', desc: 'Send to head office (multi-branch)' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRequestType(opt.value as any)}
                  className={`p-3 rounded-xl border text-left transition ${
                    requestType === opt.value
                      ? 'border-blue-500 bg-blue-950/30 text-blue-400'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div className="text-[10px] opacity-80">{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Vendor Name (if ToVendor) */}
            {requestType === 'ToVendor' && (
              <input
                type="text"
                placeholder="Vendor name (e.g., Fresh Supplies Co.)"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            )}

            {/* Notes */}
            <input
              type="text"
              placeholder="Notes (optional)"
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />

            {/* Add Item Row */}
            <div className="flex items-center gap-2">
              <select
                value={selectedIngredient}
                onChange={(e) => setSelectedIngredient(e.target.value)}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              >
                <option value="">Select ingredient...</option>
                {ingredients.map(i => (
                  <option key={i.id} value={i.id}>{i.name} (Stock: {i.currentStock || 0} {i.unit || 'pc'})</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Qty"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="w-20 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              />
              <input
                type="number"
                placeholder="Cost/Unit"
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
                className="w-24 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
              />
              <button
                onClick={handleAddItem}
                disabled={!selectedIngredient || !addQty}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-slate-950 font-bold text-xs transition"
              >
                Add
              </button>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {requestItems.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  Add items to your request above
                </div>
              ) : (
                requestItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="flex-1">
                      <div className="text-xs font-bold text-white">{item.ingredientName}</div>
                      <div className="text-[10px] text-slate-400">
                        Current: {item.currentStock} {item.unit} • ₨{item.unitCostPKR}/{item.unit}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-800 text-xs font-mono font-bold">
                        {item.quantityRequested} {item.unit}
                      </span>
                      <span className="text-xs font-mono text-emerald-400 font-semibold min-w-[70px] text-right">
                        ₨{(item.quantityRequested * item.unitCostPKR).toLocaleString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(item.ingredientId)}
                      className="text-slate-400 hover:text-red-400 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Total + Submit */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                Total Estimated: <span className="font-bold text-emerald-400 font-mono">₨{totalEstimated.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewRequest(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitRequest}
                  disabled={requestItems.length === 0 || submitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-slate-950 font-bold text-xs transition"
                >
                  {submitting ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Detail Modal */}
      {viewRequest && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span className="font-mono text-blue-400">{viewRequest.requestNumber}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(viewRequest.status)}`}>
                    {viewRequest.status}
                  </span>
                </h3>
                <div className="text-xs text-slate-400 mt-0.5">
                  {viewRequest.requestType === 'ToVendor' ? `Vendor: ${viewRequest.vendorName}` : viewRequest.requestType === 'ToHQ' ? 'Request to HQ' : 'Request to Owner'} • By {viewRequest.createdBy}
                </div>
              </div>
              <button onClick={() => setViewRequest(null)} className="text-slate-400 hover:text-white text-sm cursor-pointer">✕</button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {viewRequest.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <div>
                    <div className="text-xs font-bold text-white">{item.ingredientName}</div>
                    <div className="text-[10px] text-slate-400">Current: {item.currentStock} {item.unit} • ₨{item.unitCostPKR}/{item.unit}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono font-bold text-amber-400">{item.quantityRequested} {item.unit}</div>
                    <div className="text-[10px] font-mono text-emerald-400">₨{(item.quantityRequested * item.unitCostPKR).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary + Actions */}
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Estimated Total:</span>
                <span className="font-bold text-emerald-400 font-mono">₨{viewRequest.estimatedCostPKR.toLocaleString()}</span>
              </div>
              {viewRequest.notes && (
                <div className="text-xs text-slate-400">📝 {viewRequest.notes}</div>
              )}
              {viewRequest.reviewedBy && (
                <div className="text-[10px] text-slate-400">
                  Reviewed by {viewRequest.reviewedBy} on {viewRequest.reviewedAt ? new Date(viewRequest.reviewedAt).toLocaleString() : 'N/A'}
                  {viewRequest.reviewNotes && ` — ${viewRequest.reviewNotes}`}
                </div>
              )}

              {/* Owner Actions (Pending requests only) */}
              {viewRequest.status === 'Pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReviewRequest(viewRequest.id, 'Approved')}
                    className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleReviewRequest(viewRequest.id, 'Rejected')}
                    className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition"
                  >
                    ✕ Reject
                  </button>
                </div>
              )}

              <button
                onClick={() => setViewRequest(null)}
                className="w-full px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition cursor-pointer"
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

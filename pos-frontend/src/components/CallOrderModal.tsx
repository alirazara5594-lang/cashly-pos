import React, { useState } from 'react';
import { PhoneCall, Search, MapPin, User, Check, X, ArrowRight } from 'lucide-react';
import { posApi } from '../services/api';

import { usePosStore } from '../store/posStore';

interface CallOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CallOrderModal: React.FC<CallOrderModalProps> = ({ isOpen, onClose }) => {
  const { setOrderType, setCustomerInfo, selectedBranch } = usePosStore();
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const handleLookup = async () => {
    if (!phone.trim()) return;
    setIsSearching(true);
    try {
      const res = await posApi.lookupCustomerPhone(phone.trim());
      setLookupResult(res);
      if (res.found) {
        if (res.name) setCustomerName(res.name);
        if (res.lastAddress) setAddress(res.lastAddress);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartOrder = () => {
    setOrderType('CallOrder');
    setCustomerInfo({
      name: customerName || 'Phone Customer',
      phone: phone || '0300-0000000',
      address: address || 'Islamabad'
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="px-5 py-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
            <PhoneCall className="w-5 h-5 animate-pulse" />
            <span>Phone Call Order Intake (UAN / Inbound)</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Phone Lookup Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Customer Phone Number
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="e.g. 0321-9876543 or 03001234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                  className="w-full pl-3 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500 transition"
                />
              </div>
              <button
                onClick={handleLookup}
                disabled={isSearching}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <Search className="w-4 h-4" />
                <span>Lookup</span>
              </button>
            </div>
          </div>

          {/* Past Customer History Found Badge */}
          {lookupResult?.found && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs space-y-2">
              <div className="flex items-center justify-between font-bold">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Check className="w-4 h-4" />
                  <span>Existing Customer Found</span>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700">
                  {lookupResult.totalPastOrders} Past Orders
                </span>
              </div>
              {lookupResult.favoriteItems?.length > 0 && (
                <div className="text-[11px] text-slate-300">
                  <span className="text-slate-400">Favorites: </span>
                  {lookupResult.favoriteItems.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Customer Details Form */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-slate-400" /> Customer Name
              </label>
              <input
                type="text"
                placeholder="Customer Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Delivery Address & Landmark
              </label>
              <textarea
                rows={2}
                placeholder="House / Flat #, Street, Sector / Area, City"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-xs text-slate-400 flex items-center justify-between">
              <span>Fulfillment Branch:</span>
              <span className="font-bold text-emerald-400">{selectedBranch?.name || 'Main Branch'}</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-800 border-t border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleStartOrder}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20"
          >
            <span>Proceed to Menu Cart</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Printer, X, CheckCircle } from 'lucide-react';
import type { Order } from '../types';

interface ThermalReceiptModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  order,
  isOpen,
  onClose,
  branchName = 'Your Business POS',
  branchAddress = 'Main Commercial Area, Sector F-7, Islamabad',
  branchPhone = '051-111-222-333'

}) => {
  if (!isOpen || !order) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header Actions */}
        <div className="px-4 py-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle className="w-4 h-4" />
            <span>Order Completed Successfully</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 80mm Thermal Receipt Preview (White Paper with Black Monospace) */}
        <div className="p-4 overflow-y-auto flex-1 bg-white text-black font-mono text-[11px] leading-tight select-all">
          <div className="text-center pb-2 border-b border-dashed border-gray-400">
            <div className="font-bold text-base tracking-wider uppercase">{branchName}</div>
            <div className="text-[10px] text-gray-700 mt-0.5">{branchAddress}</div>
            <div className="text-[10px] text-gray-700">Tel: {branchPhone}</div>
            <div className="text-[9px] text-gray-500 mt-1 uppercase font-sans">** TAX INVOICE **</div>
          </div>

          <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span>Order #: <strong className="text-black">{order.orderNumber}</strong></span>
              <span>Type: <strong>{order.orderType}</strong></span>
            </div>
            <div className="flex justify-between">
              <span>Date: {new Date(order.createdAt).toLocaleDateString()}</span>
              <span>Time: {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {order.tableNumber && (
              <div className="flex justify-between font-bold">
                <span>Table: {order.tableNumber}</span>
              </div>
            )}
            {order.customerName && (
              <div>Customer: {order.customerName} ({order.customerPhone || 'N/A'})</div>
            )}
            {order.deliveryAddress && (
              <div className="text-[9px] text-gray-700">Address: {order.deliveryAddress}</div>
            )}
            <div>Cashier: {order.cashierName || 'Cashier 1'}</div>
          </div>

          {/* Line Items */}
          <div className="py-2 border-b border-dashed border-gray-400">
            <div className="grid grid-cols-12 font-bold pb-1 text-[10px] border-b border-gray-200">
              <div className="col-span-6">ITEM</div>
              <div className="col-span-2 text-center">QTY</div>
              <div className="col-span-2 text-right">PRICE</div>
              <div className="col-span-2 text-right">TOTAL</div>
            </div>
            <div className="mt-1 space-y-1">
              {order.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 text-[10px]">
                  <div className="col-span-6 font-semibold">
                    {item.productName}
                    {item.specialNotes && <div className="text-[9px] text-gray-600 italic">*{item.specialNotes}</div>}
                  </div>
                  <div className="col-span-2 text-center">{item.quantity}</div>
                  <div className="col-span-2 text-right">₨{item.unitPricePKR}</div>
                  <div className="col-span-2 text-right font-bold">₨{item.totalPricePKR}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals in PKR */}
          <div className="py-2 border-b border-dashed border-gray-400 space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>₨{order.subTotalPKR.toLocaleString()}</span>
            </div>
            {order.discountPKR > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Discount:</span>
                <span>-₨{order.discountPKR.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>
                Sales Tax ({order.paymentMethod === 'Cash' ? '16% Cash Rate' : '8% Digital Card Rate'}):
              </span>
              <span>₨{order.taxPKR.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs font-black pt-1 border-t border-gray-300">
              <span>TOTAL (PKR):</span>
              <span>₨{order.totalPKR.toLocaleString()}</span>
            </div>
          </div>

          {/* Payment Details */}
          <div className="py-2 border-b border-dashed border-gray-400 text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span>Payment Mode:</span>
              <span className="font-bold uppercase">{order.paymentMethod}</span>
            </div>
            {order.paymentMethod !== 'Cash' && (
              <div className="p-1 rounded bg-gray-100 text-[9px] text-emerald-800 font-semibold text-center mt-1">
                * DIGITAL INCENTIVE: Saved 8% tax by paying digitally! *
              </div>
            )}
            {order.paymentMethod === 'Cash' && (
              <>
                <div className="flex justify-between">
                  <span>Cash Tendered:</span>
                  <span>₨{order.amountPaidPKR.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Change Due:</span>
                  <span>₨{order.changeDuePKR.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>


          {/* Fiscal Barcode & Footer */}
          <div className="pt-3 text-center space-y-1">
            <div className="inline-block px-3 py-1 bg-gray-100 border border-gray-300 rounded text-[9px] tracking-widest font-mono">
              FBR-POS-PKR-{order.orderNumber.replace(/[^0-9]/g, '')}
            </div>
            <div className="text-[9px] text-gray-600 mt-1">Thank you for your visit!</div>
            <div className="text-[8px] text-gray-400">Powered by Cashly POS • www.cashlypos.com</div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="p-3 bg-slate-800 border-t border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg shadow-emerald-600/30"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};

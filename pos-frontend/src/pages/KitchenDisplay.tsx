import React, { useState, useEffect } from 'react';
import { ChefHat, Clock, CheckCircle2, RefreshCw, Flame, Coffee, Utensils } from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { KitchenTicket } from '../types';

export const KitchenDisplay: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('all');


  const fetchTickets = async () => {
    if (!selectedBranch?.id) return;
    try {
      const data = await posApi.getKitchenTickets(
        selectedBranch.id, 
        selectedStation === 'all' ? undefined : selectedStation
      );
      setTickets(data);
    } catch (err) {
      console.error('Failed to load kitchen tickets:', err);
    }
  };

  useEffect(() => {
    fetchTickets();
    const interval = setInterval(fetchTickets, 5000); // Polling every 5s for live KDS
    return () => clearInterval(interval);
  }, [selectedBranch?.id, selectedStation]);

  const handleUpdateStatus = async (ticketId: string, status: string) => {
    try {
      await posApi.updateTicketStatus(ticketId, status);
      fetchTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const getElapsedTimeMinutes = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    return Math.floor(diff / (1000 * 60));
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-hidden bg-slate-950 text-slate-100 p-4">
      {/* Top Bar: Station Tabs & Auto-refresh indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white flex items-center gap-2">
              <span>Kitchen Display System (KDS)</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                MODE 1 ACTIVE
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Direct live dispatch from Waiter Tabs and POS Counters • Branch: {selectedBranch?.name || 'Cheezious F-7'}
            </p>
          </div>
        </div>

        {/* Stations Filter */}
        <div className="flex items-center gap-2">
          {[
            { id: 'all', label: 'All Stations', icon: Utensils },
            { id: 'MainKitchen', label: 'Main Kitchen', icon: Flame },
            { id: 'Grill', label: 'Grill Station', icon: Flame },
            { id: 'BeverageBar', label: 'Beverage Bar', icon: Coffee }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSelectedStation(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                selectedStation === id
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}

          <button
            onClick={fetchTickets}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            title="Refresh KDS"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tickets Grid */}
      <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tickets.length === 0 ? (
          <div className="col-span-full h-96 flex flex-col items-center justify-center text-slate-600 space-y-2">
            <CheckCircle2 className="w-12 h-12 stroke-[1.5] text-emerald-500/40" />
            <p className="text-sm font-semibold text-slate-400">All caught up! No active cooking tickets.</p>
            <p className="text-xs text-slate-500">Orders sent from Tab or Counter will immediately appear here via Mode 1.</p>
          </div>
        ) : (
          tickets.map((ticket) => {
            const elapsed = getElapsedTimeMinutes(ticket.createdAt);
            const isLate = elapsed > 15;
            const isWarning = elapsed > 10 && elapsed <= 15;

            return (
              <div
                key={ticket.id}
                className={`rounded-2xl border flex flex-col justify-between overflow-hidden shadow-xl transition ${
                  ticket.status === 'Ready'
                    ? 'bg-emerald-950/20 border-emerald-800/80 shadow-emerald-500/5'
                    : isLate
                    ? 'bg-rose-950/20 border-rose-800 shadow-rose-500/10'
                    : isWarning
                    ? 'bg-amber-950/20 border-amber-800'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                {/* Ticket Header */}
                <div className="p-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="font-black text-sm text-white tracking-wider flex items-center gap-1.5">
                      <span>{ticket.ticketNumber}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                        {ticket.order?.orderNumber || 'ORD'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {ticket.order?.tableNumber ? (
                        <strong className="text-amber-400">Table: {ticket.order.tableNumber}</strong>
                      ) : (
                        <span>Type: <strong>{ticket.order?.orderType}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Timer Badge */}
                  <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black font-mono ${
                    isLate
                      ? 'bg-rose-600 text-white animate-pulse'
                      : isWarning
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-emerald-400 border border-slate-700'
                  }`}>
                    <Clock className="w-3.5 h-3.5" />
                    <span>{elapsed}m</span>
                  </div>
                </div>

                {/* Items List */}
                <div className="p-3.5 space-y-2 flex-1">
                  {ticket.order?.items.map((item, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-2 border-b border-slate-800/60 pb-2">
                      <div className="flex items-start gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-black text-xs">
                          {item.quantity}x
                        </span>
                        <div>
                          <div className="font-bold text-xs text-white leading-tight">{item.productName}</div>
                          {item.modifiersSummary && (
                            <div className="text-[10px] text-amber-300 italic mt-0.5">
                              +{item.modifiersSummary}
                            </div>
                          )}
                          {item.specialNotes && (
                            <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                              Note: "{item.specialNotes}"
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer Action */}
                <div className="p-3 bg-slate-850/80 border-t border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">
                    Station: <span className="text-slate-200">{ticket.station}</span>
                  </span>

                  {ticket.status !== 'Ready' ? (
                    <button
                      onClick={() => handleUpdateStatus(ticket.id, 'Ready')}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg shadow-emerald-600/20 transition flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Mark Ready</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(ticket.id, 'Completed')}
                      className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs transition"
                    >
                      Archive Ticket
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

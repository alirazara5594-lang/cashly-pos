import React, { useState, useEffect } from 'react';
import { ChefHat, Clock, CheckCircle2, RefreshCw, Flame, Coffee, Utensils, Wheat } from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { KitchenTicket } from '../types';

export const KitchenDisplay: React.FC = () => {
  const { selectedBranch } = usePosStore();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [selectedStation, setSelectedStation] = useState<string>('all');
  // Ticking clock so the elapsed badges keep counting up between polls, without
  // reading Date.now() during render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);


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

  const minutesBetween = (from: string, to: number | string) => {
    const start = new Date(from).getTime();
    const end = typeof to === 'number' ? to : new Date(to).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    return Math.max(0, Math.floor((end - start) / (1000 * 60)));
  };

  /**
   * Kitchen clock for a ticket.
   *
   * Prefers the order's server-stamped `inKitchenAt` (when it actually hit the
   * line) over the ticket's own createdAt, and freezes the counter at `readyAt`
   * so a plated ticket stops ageing on screen.
   */
  const getTicketTiming = (ticket: KitchenTicket) => {
    const startedAt = ticket.order?.inKitchenAt || ticket.createdAt;
    const readyAt = ticket.order?.readyAt;

    if (readyAt) {
      return {
        minutes: minutesBetween(startedAt, readyAt),
        isDone: true,
        sinceReady: minutesBetween(readyAt, now)
      };
    }
    return {
      minutes: minutesBetween(startedAt, now),
      isDone: false,
      sinceReady: 0
    };
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-hidden bg-slate-50 text-slate-900 p-4">
      {/* Top Bar: Station Tabs & Auto-refresh indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <span>Kitchen Display System (KDS)</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-600 border border-teal-200 font-mono">
                MODE 1 ACTIVE
              </span>
            </h1>
            <p className="text-xs text-slate-500">
              Direct live dispatch from Waiter Tabs and POS Counters • Branch: {selectedBranch?.name || 'Main Kitchen Branch'}
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
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}

          <button
            onClick={fetchTickets}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900"
            title="Refresh KDS"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tickets Grid - items-start & content-start ensures cards hug their own natural height without stretching */}
      <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start content-start">
        {tickets.length === 0 ? (
          <div className="col-span-full h-96 flex flex-col items-center justify-center text-slate-400 space-y-2">
            <CheckCircle2 className="w-12 h-12 stroke-[1.5] text-teal-500/40" />
            <p className="text-sm font-semibold text-slate-500">All caught up! No active cooking tickets.</p>
            <p className="text-xs text-slate-400">Orders sent from Tab or Counter will immediately appear here via Mode 1.</p>
          </div>
        ) : (
          tickets.map((ticket) => {
            const timing = getTicketTiming(ticket);
            const elapsed = timing.minutes;
            const isLate = !timing.isDone && elapsed > 15;
            const isWarning = !timing.isDone && elapsed > 10 && elapsed <= 15;

            return (
              <div
                key={ticket.id}
                className={`rounded-2xl border flex flex-col overflow-hidden shadow-lg transition min-h-[140px] ${
                  ticket.status === 'Ready'
                    ? 'bg-teal-50 border-teal-200'
                    : isLate
                    ? 'bg-rose-50 border-rose-200'
                    : isWarning
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-white border-slate-200'
                }`}
              >
                {/* Ticket Header */}
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-black text-sm text-slate-900 tracking-wider flex items-center gap-1.5">
                      <span>{ticket.ticketNumber}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-500 font-mono">
                        {ticket.order?.orderNumber || 'ORD'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {ticket.order?.tableNumber ? (
                        <strong className="text-amber-600">Table: {ticket.order.tableNumber}</strong>
                      ) : (
                        <span>Type: <strong>{ticket.order?.orderType}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Timer Badge — minutes on the line, frozen once plated */}
                  <div className="flex flex-col items-end gap-0.5">
                    <div
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black font-mono ${
                        timing.isDone
                          ? 'bg-teal-100 text-teal-700 border border-teal-200'
                          : isLate
                          ? 'bg-rose-500 text-white animate-pulse'
                          : isWarning
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 text-teal-600 border border-slate-200'
                      }`}
                      title={
                        timing.isDone
                          ? `Cooked in ${elapsed} min`
                          : `${elapsed} min in kitchen${isLate ? ' — over the 15 min target' : ''}`
                      }
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>{elapsed}m</span>
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${
                      timing.isDone
                        ? 'text-teal-600'
                        : isLate
                        ? 'text-rose-600'
                        : isWarning
                        ? 'text-amber-600'
                        : 'text-slate-400'
                    }`}>
                      {timing.isDone
                        ? (timing.sinceReady > 0 ? `ready ${timing.sinceReady}m ago` : 'ready now')
                        : isLate
                        ? 'overdue'
                        : 'in kitchen'}
                    </span>
                  </div>
                </div>

                {/* Items List - Card height remains normal by default, and increases when ingredients are present */}
                <div className="p-3 space-y-2.5">
                  {ticket.order?.items.map((item, idx) => {
                    const recipeItems = item.product?.recipeItems || [];
                    const hasIngredients = recipeItems.length > 0;

                    return (
                      <div key={idx} className="border-b border-slate-200 pb-2.5 last:border-b-0 last:pb-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-black text-xs shrink-0 mt-0.5">
                              {item.quantity}x
                            </span>
                            <div>
                              <div className="font-bold text-xs text-slate-900 leading-tight">{item.productName}</div>
                              {item.modifiersSummary && (
                                <div className="text-[10px] text-amber-600 italic mt-0.5">
                                  +{item.modifiersSummary}
                                </div>
                              )}
                              {item.specialNotes && (
                                <div className="text-[10px] text-teal-600 font-semibold mt-0.5">
                                  Note: "{item.specialNotes}"
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Ingredients / Recipe BOM List - Increases KOT card height with ingredients */}
                        {hasIngredients && (
                          <div className="mt-2 pl-2.5 ml-2 border-l-2 border-amber-300 space-y-1">
                            <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                              <Wheat className="w-3 h-3 text-amber-500" />
                              <span>Ingredients ({recipeItems.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {recipeItems.map((r, rIdx) => {
                                const ingName = r.ingredient?.name || r.ingredientName || 'Ingredient';
                                const totalQty = Math.round((r.quantityRequired * item.quantity) * 100) / 100;
                                return (
                                  <span
                                    key={rIdx}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] border border-slate-200 font-medium"
                                  >
                                    <span className="text-amber-600 font-bold font-mono">{totalQty} {r.unit}</span>
                                    <span className="truncate max-w-[120px]">{ingName}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer Action */}
                <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 mt-auto">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                    Station: <span className="text-slate-700 font-semibold">{ticket.station}</span>
                  </span>

                  {ticket.status !== 'Ready' ? (
                    <button
                      onClick={() => handleUpdateStatus(ticket.id, 'Ready')}
                      className="px-3.5 py-1.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-black text-xs shadow-lg shadow-teal-500/25 transition flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Mark Ready</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(ticket.id, 'Completed')}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition"
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

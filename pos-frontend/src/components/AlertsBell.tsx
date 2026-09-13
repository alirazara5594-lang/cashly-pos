import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell,
  AlertTriangle,
  Clock,
  BarChart3,
  TrendingUp,
  CheckCheck,
  Trash2,
  X
} from 'lucide-react';
import { posApi } from '../services/api';

interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  isRead: boolean;
  isDismissed: boolean;
  createdAt: string;
}

const alertIconMap: Record<string, React.ElementType> = {
  low_stock: AlertTriangle,
  shift_reminder: Clock,
  daily_summary: BarChart3,
  unusual_sales: TrendingUp,
};

const severityClasses: Record<string, string> = {
  critical: 'text-red-400 bg-red-950 border-red-800',
  warning: 'text-amber-400 bg-amber-950 border-amber-800',
  info: 'text-indigo-400 bg-indigo-950 border-indigo-800',
};

const severityDot: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-indigo-400',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const AlertsBell: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await posApi.getAlerts();
      setAlerts(Array.isArray(data) ? data : []);
    } catch {
      // silently ignore
    }
  }, []);

  const generateAndFetch = useCallback(async () => {
    setLoading(true);
    try {
      await posApi.generateAlerts();
      await fetchAlerts();
    } catch {
      await fetchAlerts();
    } finally {
      setLoading(false);
    }
  }, [fetchAlerts]);

  useEffect(() => {
    generateAndFetch();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [generateAndFetch, fetchAlerts]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = alerts.filter((a) => !a.isRead && !a.isDismissed).length;
  const visibleAlerts = alerts.filter((a) => !a.isDismissed).slice(0, 20);

  const handleMarkRead = async (id: string) => {
    try {
      await posApi.markAlertRead(id);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isRead: true } : a))
      );
    } catch {}
  };

  const handleDismiss = async (id: string) => {
    try {
      await posApi.dismissAlert(id);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isDismissed: true } : a))
      );
    } catch {}
  };

  const handleMarkAllRead = async () => {
    try {
      const unread = alerts.filter((a) => !a.isRead && !a.isDismissed);
      await Promise.all(unread.map((a) => posApi.markAlertRead(a.id)));
      setAlerts((prev) =>
        prev.map((a) => (!a.isDismissed ? { ...a, isRead: true } : a))
      );
    } catch {}
  };

  const handleDismissAll = async () => {
    try {
      await posApi.dismissAllAlerts();
      setAlerts((prev) =>
        prev.map((a) => (!a.isDismissed ? { ...a, isDismissed: true } : a))
      );
    } catch {}
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer"
        title="Smart Alerts"
      >
        <Bell className={`w-4 h-4 ${unreadCount > 0 ? 'text-indigo-400 animate-pulse' : 'text-slate-400'}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-indigo-500 text-white text-[9px] font-bold px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-white">Smart Alerts</span>
              {unreadCount > 0 && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {visibleAlerts.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-indigo-400 hover:bg-indigo-500/10 transition cursor-pointer"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
              <button
                onClick={handleDismissAll}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-400 hover:bg-white/5 transition cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Dismiss all
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && visibleAlerts.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-slate-500 text-xs">
                <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2" />
                Loading alerts...
              </div>
            ) : visibleAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <Bell className="w-8 h-8 mb-2 opacity-30" />
                <span className="text-xs font-medium">No alerts</span>
                <span className="text-[10px] mt-0.5">All caught up!</span>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {visibleAlerts.map((alert) => {
                  const Icon = alertIconMap[alert.type] || Bell;
                  const sevClass = severityClasses[alert.severity] || severityClasses.info;
                  const dotClass = severityDot[alert.severity] || severityDot.info;
                  return (
                    <div
                      key={alert.id}
                      className={`px-4 py-3 hover:bg-white/5 transition cursor-pointer ${
                        !alert.isRead ? 'bg-indigo-500/5' : ''
                      }`}
                      onClick={() => !alert.isRead && handleMarkRead(alert.id)}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 p-1.5 rounded-lg border ${sevClass}`}>
                          <Icon className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${!alert.isRead ? 'text-white' : 'text-slate-300'}`}>
                              {alert.title}
                            </span>
                            {!alert.isRead && (
                              <span className={`w-1.5 h-1.5 rounded-full ${dotClass} shrink-0`} />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                            {alert.message}
                          </p>
                          <span className="text-[9px] text-slate-600 mt-1 block">
                            {timeAgo(alert.createdAt)}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDismiss(alert.id);
                          }}
                          className="p-1 rounded text-slate-600 hover:text-slate-300 transition cursor-pointer shrink-0"
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

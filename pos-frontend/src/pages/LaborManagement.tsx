import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CalendarClock,
  Clock,
  Plus,
  RefreshCw,
  Save,
  X,
  Trash2,
  Download,
  AlertCircle,
  LogIn,
  LogOut,
  Users
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { AppUser, StaffShiftSchedule, TimeClockEntry } from '../types';

type TabKey = 'schedule' | 'timeclock';

const POSITIONS = ['Cashier', 'Waiter', 'Chef', 'Kitchen Helper', 'Rider', 'Manager', 'Cleaner'];

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" with no timezone suffix. */
function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const emptyShift = () => ({
  userId: '',
  scheduledStart: toLocalInput(new Date().toISOString()),
  scheduledEnd: '',
  position: POSITIONS[0],
  notes: ''
});

export const LaborManagement: React.FC = () => {
  const { selectedTenant, selectedBranch, currentUser, modulePermissions } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'edit');
  const canDelete = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'delete');
  const canExport = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'export') || canEdit;

  // The sidebar deep-links to a tab via router state, matching the convention
  // used by Reports / Inventory. Both sub-items point at the same "/labor" path,
  // so switching between them while already on this page doesn't remount it —
  // the tab has to react to location.state changing, not just read it once.
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>(
    (location.state as { tab?: TabKey } | null)?.tab === 'timeclock' ? 'timeclock' : 'schedule'
  );

  useEffect(() => {
    const tab = (location.state as { tab?: TabKey } | null)?.tab;
    // "Shift Schedule" links with no state at all — absence means 'schedule', not "leave as-is".
    setActiveTab(tab === 'timeclock' ? 'timeclock' : 'schedule');
  }, [location.state]);
  const [staff, setStaff] = useState<AppUser[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Schedule
  const [schedules, setSchedules] = useState<StaffShiftSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyShift());
  const [saving, setSaving] = useState(false);

  // Time clock
  const [timesheet, setTimesheet] = useState<TimeClockEntry[]>([]);
  const [loadingTimesheet, setLoadingTimesheet] = useState(true);
  const [from, setFrom] = useState(daysAgoISO(7));
  const [to, setTo] = useState(daysAgoISO(0));
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const branchId = selectedBranch?.id;

  const staffName = useCallback(
    (userId: string) => staff.find(s => s.id === userId)?.fullName || userId,
    [staff]
  );

  useEffect(() => {
    const loadStaff = async () => {
      if (!selectedTenant?.id) return;
      try {
        const users = await posApi.getUsers(selectedTenant.id, branchId);
        setStaff(Array.isArray(users) ? users.filter(u => u.isActive !== false) : []);
      } catch {
        setStaff([]);
      }
    };
    loadStaff();
  }, [selectedTenant?.id, branchId]);

  const loadSchedules = useCallback(async () => {
    setLoadingSchedules(true);
    try {
      const data = await posApi.getShiftSchedules({ branchId });
      setSchedules(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load schedules') });
      setSchedules([]);
    } finally {
      setLoadingSchedules(false);
    }
  }, [branchId]);

  const loadTimesheet = useCallback(async () => {
    setLoadingTimesheet(true);
    try {
      const data = await posApi.getTimesheet({ branchId, from, to });
      setTimesheet(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load timesheet') });
      setTimesheet([]);
    } finally {
      setLoadingTimesheet(false);
    }
  }, [branchId, from, to]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);
  useEffect(() => { loadTimesheet(); }, [loadTimesheet]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyShift(), userId: staff[0]?.id || '' });
    setIsFormOpen(true);
  };

  const openEdit = (shift: StaffShiftSchedule) => {
    setEditingId(shift.id);
    setForm({
      userId: shift.userId,
      scheduledStart: toLocalInput(shift.scheduledStart),
      scheduledEnd: toLocalInput(shift.scheduledEnd),
      position: shift.position || POSITIONS[0],
      notes: shift.notes || ''
    });
    setIsFormOpen(true);
  };

  const handleSaveShift = async () => {
    if (!form.userId || !form.scheduledStart || !form.scheduledEnd) {
      setMessage({ type: 'error', text: 'Staff member, start and end times are required' });
      return;
    }
    if (!branchId) {
      setMessage({ type: 'error', text: 'Select a branch before scheduling shifts' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        branchId,
        userId: form.userId,
        scheduledStart: new Date(form.scheduledStart).toISOString(),
        scheduledEnd: new Date(form.scheduledEnd).toISOString(),
        position: form.position,
        notes: form.notes.trim() || undefined
      };
      if (editingId) {
        await posApi.updateShiftSchedule(editingId, payload);
      } else {
        await posApi.createShiftSchedule(payload);
      }
      setIsFormOpen(false);
      setMessage({ type: 'success', text: editingId ? 'Shift updated' : 'Shift scheduled' });
      await loadSchedules();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to save shift') });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (shift: StaffShiftSchedule) => {
    if (!window.confirm(`Delete ${staffName(shift.userId)}'s shift?`)) return;
    try {
      await posApi.deleteShiftSchedule(shift.id);
      setSchedules(prev => prev.filter(s => s.id !== shift.id));
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to delete shift') });
    }
  };

  const openEntryFor = (userId: string) =>
    timesheet.find(e => e.userId === userId && !e.clockOutAt) || null;

  const handleClockIn = async (userId: string) => {
    setBusyUserId(userId);
    setMessage(null);
    try {
      await posApi.clockIn(userId);
      setMessage({ type: 'success', text: `${staffName(userId)} clocked in` });
      await loadTimesheet();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Clock-in failed') });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleClockOut = async (entry: TimeClockEntry) => {
    setBusyUserId(entry.userId);
    setMessage(null);
    try {
      await posApi.clockOut(entry.id);
      setMessage({ type: 'success', text: `${staffName(entry.userId)} clocked out` });
      await loadTimesheet();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Clock-out failed') });
    } finally {
      setBusyUserId(null);
    }
  };

  // Matches the app's existing CSV convention (anchor + download attribute), but
  // the bytes come from the authenticated API rather than being built locally.
  const handleExportCsv = async () => {
    try {
      const blob = await posApi.exportTimesheetCsv({ branchId, from, to });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Timesheet_${selectedBranch?.name || 'Branch'}_${from}_to_${to}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Timesheet export failed') });
    }
  };

  const totalHours = timesheet.reduce((sum, e) => sum + (e.hoursWorked || 0), 0);
  const clockedInNow = timesheet.filter(e => !e.clockOutAt);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <CalendarClock className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 leading-none">Labor & Scheduling</h1>
            <p className="text-[11px] text-slate-500 mt-1">
              Shift rota and time clock for {selectedBranch?.name || 'this branch'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
          {([
            { key: 'schedule' as const, label: 'Schedule', icon: CalendarClock },
            { key: 'timeclock' as const, label: 'Time Clock', icon: Clock }
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === key ? 'bg-teal-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
          message.type === 'success'
            ? 'bg-teal-50 border-teal-200 text-teal-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{message.text}</span>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={loadSchedules}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingSchedules ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {canEdit && (
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Schedule Shift</span>
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Staff</th>
                    <th className="px-4 py-2.5">Position</th>
                    <th className="px-4 py-2.5">Start</th>
                    <th className="px-4 py-2.5">End</th>
                    <th className="px-4 py-2.5">Notes</th>
                    {canEdit && <th className="px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSchedules ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">Loading schedule…</td></tr>
                  ) : schedules.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No shifts scheduled.</td></tr>
                  ) : schedules.map(shift => (
                    <tr key={shift.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">
                        {shift.userFullName || staffName(shift.userId)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
                          {shift.position}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {shift.scheduledStart ? new Date(shift.scheduledStart).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {shift.scheduledEnd ? new Date(shift.scheduledEnd).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-400 max-w-48 truncate">{shift.notes || '—'}</td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => openEdit(shift)}
                            className="text-[11px] font-bold text-teal-600 hover:text-teal-700 mr-3"
                          >
                            Edit
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteShift(shift)}
                              className="text-slate-400 hover:text-rose-500 align-middle"
                              title="Delete shift"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeclock' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 block px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadTimesheet}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingTimesheet ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              {canExport && (
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
                >
                  <Download className="w-3.5 h-3.5 text-teal-500" />
                  <span>Export CSV</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">On the Clock</p>
              <p className="text-xl font-black text-teal-600 mt-1">{clockedInNow.length}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Hours in Range</p>
              <p className="text-xl font-black text-slate-900 mt-1">{totalHours.toFixed(1)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Entries</p>
              <p className="text-xl font-black text-slate-900 mt-1">{timesheet.length}</p>
            </div>
          </div>

          {canEdit && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-teal-600" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Clock In / Out</span>
              </div>
              {staff.length === 0 ? (
                <p className="text-xs text-slate-400">No staff members found for this branch.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {staff.map(user => {
                    const open = openEntryFor(user.id);
                    return (
                      <div
                        key={user.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{user.fullName}</p>
                          <p className="text-[10px] text-slate-400">
                            {open ? `In since ${new Date(open.clockInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Off the clock'}
                          </p>
                        </div>
                        {open ? (
                          <button
                            onClick={() => handleClockOut(open)}
                            disabled={busyUserId === user.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold transition disabled:opacity-40"
                          >
                            <LogOut className="w-3 h-3" />Out
                          </button>
                        ) : (
                          <button
                            onClick={() => handleClockIn(user.id)}
                            disabled={busyUserId === user.id}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 text-[11px] font-bold transition disabled:opacity-40"
                          >
                            <LogIn className="w-3 h-3" />In
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Staff</th>
                    <th className="px-4 py-2.5">Clock In</th>
                    <th className="px-4 py-2.5">Clock Out</th>
                    <th className="px-4 py-2.5 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingTimesheet ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">Loading timesheet…</td></tr>
                  ) : timesheet.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">No time clock entries in this range.</td></tr>
                  ) : timesheet.map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">
                        {entry.userFullName || staffName(entry.userId)}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {entry.clockInAt ? new Date(entry.clockInAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {entry.clockOutAt
                          ? new Date(entry.clockOutAt).toLocaleString()
                          : <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">On the clock</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">
                        {entry.hoursWorked != null ? entry.hoursWorked.toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">
                {editingId ? 'Edit Shift' : 'Schedule Shift'}
              </h2>
              <button onClick={() => setIsFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Staff Member</label>
                <select
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                >
                  <option value="">Select a staff member…</option>
                  {staff.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Position</label>
                <select
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                >
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Start</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledStart}
                    onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">End</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledEnd}
                    onChange={(e) => setForm({ ...form, scheduledEnd: e.target.value })}
                    className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Notes (optional)</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            <button
              onClick={handleSaveShift}
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving…' : 'Save Shift'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

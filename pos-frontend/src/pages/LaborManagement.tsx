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
  Users,
  Wallet,
  CheckCircle2,
  Banknote
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { AppUser, StaffShiftSchedule, TimeClockEntry, PayrollPeriod, Payslip, PayslipLineType, LeaveRequest, LeaveType } from '../types';

type TabKey = 'schedule' | 'timeclock' | 'payroll' | 'leave';

const LEAVE_TYPES: LeaveType[] = ['Annual', 'Sick', 'Casual', 'Unpaid'];

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
  const { selectedTenant, selectedBranch, currentUser, modulePermissions, permissions } = usePosStore();
  const canEdit = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'edit');
  const canDelete = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'delete');
  const canExport = hasModuleAccess(currentUser?.role, modulePermissions, 'labor', 'export') || canEdit;

  // Payroll exposes wages, so it's gated separately from the rest of "labor" (scheduling):
  // viewing needs CanViewFinancialReports (or Owner/SuperAdmin); generating/adjusting/paying
  // is Owner/SuperAdmin only, matching the backend's RequirePermissionFilter(u => false, ...).
  const isOwner = currentUser?.role === 'OwnerAdmin' || currentUser?.role === 'SuperAdmin';
  const canViewPayroll = isOwner || !!permissions?.canViewFinancialReports;

  // The sidebar deep-links to a tab via router state, matching the convention
  // used by Reports / Inventory. Both sub-items point at the same "/labor" path,
  // so switching between them while already on this page doesn't remount it —
  // the tab has to react to location.state changing, not just read it once.
  const location = useLocation();
  const tabFromState = (t: unknown): TabKey => (t === 'timeclock' || t === 'payroll' || t === 'leave') ? t : 'schedule';
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabFromState((location.state as { tab?: TabKey } | null)?.tab)
  );

  useEffect(() => {
    // "Shift Schedule" links with no state at all — absence means 'schedule', not "leave as-is".
    setActiveTab(tabFromState((location.state as { tab?: TabKey } | null)?.tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Leave requests
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loadingLeave, setLoadingLeave] = useState(true);
  const [isNewLeaveOpen, setIsNewLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ userId: '', leaveType: 'Annual' as LeaveType, startDate: daysAgoISO(0), endDate: daysAgoISO(0), reason: '' });
  const [leaveSaving, setLeaveSaving] = useState(false);

  // Payroll
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loadingPayslips, setLoadingPayslips] = useState(false);
  const [isNewPeriodOpen, setIsNewPeriodOpen] = useState(false);
  const [newPeriodStart, setNewPeriodStart] = useState(daysAgoISO(30));
  const [newPeriodEnd, setNewPeriodEnd] = useState(daysAgoISO(0));
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [lineModalPayslip, setLineModalPayslip] = useState<Payslip | null>(null);
  const [lineType, setLineType] = useState<PayslipLineType>('Allowance');
  const [lineDesc, setLineDesc] = useState('');
  const [lineAmount, setLineAmount] = useState('');

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

  const loadLeaveRequests = useCallback(async () => {
    setLoadingLeave(true);
    try {
      const data = await posApi.getLeaveRequests({ branchId });
      setLeaveRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load leave requests') });
      setLeaveRequests([]);
    } finally {
      setLoadingLeave(false);
    }
  }, [branchId]);

  useEffect(() => { if (activeTab === 'leave') loadLeaveRequests(); }, [activeTab, loadLeaveRequests]);

  const handleCreateLeave = async () => {
    if (!leaveForm.userId || !leaveForm.startDate || !leaveForm.endDate || !branchId) return;
    setLeaveSaving(true);
    try {
      await posApi.createLeaveRequest({
        branchId, userId: leaveForm.userId, leaveType: leaveForm.leaveType,
        startDate: new Date(leaveForm.startDate).toISOString(), endDate: new Date(leaveForm.endDate).toISOString(),
        reason: leaveForm.reason.trim() || undefined
      });
      setIsNewLeaveOpen(false);
      setLeaveForm({ userId: '', leaveType: 'Annual', startDate: daysAgoISO(0), endDate: daysAgoISO(0), reason: '' });
      setMessage({ type: 'success', text: 'Leave request submitted' });
      await loadLeaveRequests();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to submit leave request') });
    } finally {
      setLeaveSaving(false);
    }
  };

  const handleReviewLeave = async (leave: LeaveRequest, approve: boolean) => {
    try {
      if (approve) await posApi.approveLeaveRequest(leave.id);
      else await posApi.rejectLeaveRequest(leave.id);
      await loadLeaveRequests();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to review leave request') });
    }
  };

  const loadPeriods = useCallback(async () => {
    if (!selectedTenant?.id || !canViewPayroll) return;
    setLoadingPeriods(true);
    try {
      const data = await posApi.getPayrollPeriods(selectedTenant.id);
      const rows = Array.isArray(data) ? data : [];
      setPeriods(rows);
      setSelectedPeriodId(prev => prev && rows.some(p => p.id === prev) ? prev : (rows[0]?.id || null));
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load payroll periods') });
    } finally {
      setLoadingPeriods(false);
    }
  }, [selectedTenant?.id, canViewPayroll]);

  const loadPayslips = useCallback(async () => {
    if (!selectedPeriodId) { setPayslips([]); return; }
    setLoadingPayslips(true);
    try {
      const data = await posApi.getPayslips({ periodId: selectedPeriodId, branchId });
      setPayslips(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to load payslips') });
      setPayslips([]);
    } finally {
      setLoadingPayslips(false);
    }
  }, [selectedPeriodId, branchId]);

  useEffect(() => { if (activeTab === 'payroll') loadPeriods(); }, [activeTab, loadPeriods]);
  useEffect(() => { loadPayslips(); }, [loadPayslips]);

  const handleCreatePeriod = async () => {
    if (!selectedTenant?.id || !newPeriodStart || !newPeriodEnd) return;
    setPayrollBusy(true);
    try {
      const period = await posApi.createPayrollPeriod({
        tenantId: selectedTenant.id,
        periodStart: new Date(newPeriodStart).toISOString(),
        periodEnd: new Date(newPeriodEnd).toISOString()
      });
      setIsNewPeriodOpen(false);
      setMessage({ type: 'success', text: 'Payroll period created' });
      await loadPeriods();
      setSelectedPeriodId(period.id);
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to create payroll period') });
    } finally {
      setPayrollBusy(false);
    }
  };

  const handleGeneratePayroll = async (periodId: string) => {
    if (!window.confirm('Generate draft payslips for every payroll-eligible staff member? This uses each person\'s configured wage rate and logged hours for the period.')) return;
    setPayrollBusy(true);
    try {
      await posApi.generatePayroll(periodId);
      setMessage({ type: 'success', text: 'Payslips generated' });
      await loadPeriods();
      await loadPayslips();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to generate payroll') });
    } finally {
      setPayrollBusy(false);
    }
  };

  const handleAddLine = async () => {
    if (!lineModalPayslip || !lineDesc.trim() || !lineAmount) return;
    setPayrollBusy(true);
    try {
      await posApi.addPayslipLine(lineModalPayslip.id, { type: lineType, description: lineDesc.trim(), amountPKR: Number(lineAmount) || 0 });
      setLineModalPayslip(null);
      setLineDesc('');
      setLineAmount('');
      await loadPayslips();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to add payslip line') });
    } finally {
      setPayrollBusy(false);
    }
  };

  const handleFinalizePayslip = async (p: Payslip) => {
    if (!window.confirm(`Finalize ${p.userName}'s payslip? Net pay PKR ${p.netPayPKR.toLocaleString()} will be locked from further edits.`)) return;
    try {
      await posApi.finalizePayslip(p.id);
      await loadPayslips();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to finalize payslip') });
    }
  };

  const handleMarkPaid = async (p: Payslip) => {
    const method = window.prompt('Payment method (e.g. Bank Transfer, Cash)', 'Bank Transfer');
    if (method === null) return;
    try {
      await posApi.markPayslipPaid(p.id, method || undefined);
      setMessage({ type: 'success', text: `${p.userName} marked as paid` });
      await loadPeriods();
      await loadPayslips();
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, 'Failed to mark payslip paid') });
    }
  };

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId) || null;

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
            { key: 'timeclock' as const, label: 'Time Clock', icon: Clock },
            { key: 'leave' as const, label: 'Leave', icon: AlertCircle },
            ...(canViewPayroll ? [{ key: 'payroll' as const, label: 'Payroll', icon: Wallet }] : [])
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

      {activeTab === 'leave' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={loadLeaveRequests}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingLeave ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {canEdit && (
              <button
                onClick={() => { setLeaveForm({ ...leaveForm, userId: staff[0]?.id || '' }); setIsNewLeaveOpen(true); }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Request Leave</span>
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Staff</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Dates</th>
                    <th className="px-4 py-2.5 text-right">Days</th>
                    <th className="px-4 py-2.5">Status</th>
                    {canEdit && <th className="px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingLeave ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">Loading leave requests…</td></tr>
                  ) : leaveRequests.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">No leave requests yet.</td></tr>
                  ) : leaveRequests.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs font-bold text-slate-900">{l.userFullName || staffName(l.userId)}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">{l.leaveType}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-900">{l.daysRequested}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                          l.status === 'Approved' ? 'bg-teal-50 text-teal-700 border-teal-200'
                          : l.status === 'Rejected' ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : l.status === 'Cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {l.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {l.status === 'Pending' && (
                            <>
                              <button onClick={() => handleReviewLeave(l, true)} className="text-[11px] font-bold text-teal-600 hover:text-teal-700 mr-3">Approve</button>
                              <button onClick={() => handleReviewLeave(l, false)} className="text-[11px] font-bold text-rose-600 hover:text-rose-700">Reject</button>
                            </>
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

      {isNewLeaveOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Request Leave</h2>
              <button onClick={() => setIsNewLeaveOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Staff Member</label>
              <select value={leaveForm.userId} onChange={(e) => setLeaveForm({ ...leaveForm, userId: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
                {staff.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Leave Type</label>
              <select value={leaveForm.leaveType} onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value as LeaveType })}
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
                {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Start</label>
                <input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">End</label>
                <input type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reason (optional)</label>
              <input type="text" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <button
              onClick={handleCreateLeave}
              disabled={leaveSaving || !leaveForm.userId}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{leaveSaving ? 'Submitting…' : 'Submit Request'}</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'payroll' && canViewPayroll && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedPeriodId || ''}
                onChange={(e) => setSelectedPeriodId(e.target.value || null)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500"
              >
                {periods.length === 0 && <option value="">No payroll periods yet</option>}
                {periods.map(p => (
                  <option key={p.id} value={p.id}>
                    {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()} ({p.status})
                  </option>
                ))}
              </select>
              <button
                onClick={loadPeriods}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-teal-500 ${loadingPeriods ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
            {isOwner && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsNewPeriodOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Period</span>
                </button>
                {selectedPeriod && selectedPeriod.status === 'Open' && (
                  <button
                    onClick={() => handleGeneratePayroll(selectedPeriod.id)}
                    disabled={payrollBusy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    <span>Generate Payslips</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {!selectedPeriod ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-slate-400">
              No payroll period selected. {isOwner ? 'Create one to get started.' : 'Ask an owner to create one.'}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2.5">Staff</th>
                      <th className="px-4 py-2.5 text-right">Hours</th>
                      <th className="px-4 py-2.5 text-right">Basic Pay</th>
                      <th className="px-4 py-2.5 text-right">Allowances</th>
                      <th className="px-4 py-2.5 text-right">Deductions</th>
                      <th className="px-4 py-2.5 text-right">Net Pay</th>
                      <th className="px-4 py-2.5">Status</th>
                      {isOwner && <th className="px-4 py-2.5 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingPayslips ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">Loading payslips…</td></tr>
                    ) : payslips.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">
                        No payslips yet for this period. {isOwner && selectedPeriod.status === 'Open' ? 'Click "Generate Payslips" above.' : ''}
                      </td></tr>
                    ) : payslips.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-xs font-bold text-slate-900">{p.userName}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-600">{p.hoursWorked.toFixed(1)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono text-slate-700">{p.basicPayPKR.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono text-teal-600">{p.totalAllowancesPKR.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono text-rose-600">{p.totalDeductionsPKR.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono font-black text-slate-900">{p.netPayPKR.toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                            p.status === 'Paid' ? 'bg-teal-50 text-teal-700 border-teal-200'
                            : p.status === 'Finalized' ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        {isOwner && (
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {p.status === 'Draft' && (
                              <>
                                <button onClick={() => setLineModalPayslip(p)} className="text-[11px] font-bold text-teal-600 hover:text-teal-700 mr-3">
                                  Add Line
                                </button>
                                <button onClick={() => handleFinalizePayslip(p)} className="text-[11px] font-bold text-amber-600 hover:text-amber-700">
                                  Finalize
                                </button>
                              </>
                            )}
                            {p.status === 'Finalized' && (
                              <button onClick={() => handleMarkPaid(p)} className="flex items-center gap-1 text-[11px] font-bold text-teal-600 hover:text-teal-700 ml-auto">
                                <Banknote className="w-3.5 h-3.5" />
                                <span>Mark Paid</span>
                              </button>
                            )}
                            {p.status === 'Paid' && (
                              <span className="flex items-center gap-1 text-[11px] text-slate-400 justify-end">
                                <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />
                                {p.paymentMethod || 'Paid'}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {isNewPeriodOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">New Payroll Period</h2>
              <button onClick={() => setIsNewPeriodOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Start</label>
                <input type="date" value={newPeriodStart} onChange={(e) => setNewPeriodStart(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">End</label>
                <input type="date" value={newPeriodEnd} onChange={(e) => setNewPeriodEnd(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
              </div>
            </div>
            <button
              onClick={handleCreatePeriod}
              disabled={payrollBusy}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{payrollBusy ? 'Creating…' : 'Create Period'}</span>
            </button>
          </div>
        </div>
      )}

      {lineModalPayslip && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Add Line — {lineModalPayslip.userName}</h2>
              <button onClick={() => setLineModalPayslip(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Type</label>
              <select value={lineType} onChange={(e) => setLineType(e.target.value as PayslipLineType)}
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500">
                <option value="Allowance">Allowance</option>
                <option value="Overtime">Overtime</option>
                <option value="Deduction">Deduction</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Description</label>
              <input type="text" value={lineDesc} onChange={(e) => setLineDesc(e.target.value)}
                placeholder="e.g. Transport allowance, Late deduction"
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount (PKR)</label>
              <input type="number" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-teal-500" />
            </div>
            <button
              onClick={handleAddLine}
              disabled={payrollBusy || !lineDesc.trim() || !lineAmount}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-teal-500/25 transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{payrollBusy ? 'Saving…' : 'Add Line'}</span>
            </button>
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

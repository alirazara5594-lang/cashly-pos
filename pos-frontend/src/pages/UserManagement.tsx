import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Building2,
  RefreshCw,
  CheckCircle2,
  Wallet,
  X,
  Save,
  MapPin,
  KeyRound,
  Mail
} from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { usePosStore, normalizeRole } from '../store/posStore';
import type { AppUser, UserRole, Department, Designation, Region } from '../types';

/** The server's sentinel for "clear this Guid? field" — a real empty Guid, since JSON `null`/omitted
 * both mean "don't touch it" and can't express "remove the existing value" for a nullable value type. */
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/** Roles that work in the back office, so they may also sign in there with email + password. */
const BACK_OFFICE_ROLES: UserRole[] = ['OwnerAdmin', 'HqAdmin', 'BranchManager', 'Accountant', 'InventoryUser'];

/** Roles that cover every location, and that only the owner may hand out. */
const OWNER_LEVEL_ROLES: UserRole[] = ['OwnerAdmin', 'HqAdmin'];

/** A random 4-digit PIN that is not an easy one (0000, 1234, 4321). The server still checks it is
 * not already somebody else's at this restaurant. */
const suggestPin = () => {
  for (;;) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const d = pin.split('').map(Number);
    const steps = d.slice(1).map((x, i) => x - d[i]);
    if (!steps.every(s => s === 0) && !steps.every(s => s === 1) && !steps.every(s => s === -1)) return pin;
  }
};

export const UserManagement: React.FC = () => {
  const { selectedTenant, selectedBranch, branches, currentUser } = usePosStore();
  // Owner-level roles are the owner's to hand out.
  const canGrantOwnerLevel = ['OwnerAdmin', 'SuperAdmin'].includes(normalizeRole(currentUser?.role) ?? '');
  // Staff signed in at one branch add people to that branch; the owner and head office to any.
  const assignableBranches = currentUser?.branchId ? branches.filter(b => b.id === currentUser.branchId) : branches;

  // Other branches a branch-based user may sign in at — an area manager, or a cashier who covers
  // a second shop. They keep the same role everywhere; their home branch stays their own.
  const [accessUser, setAccessUser] = useState<AppUser | null>(null);
  const [accessBranchIds, setAccessBranchIds] = useState<string[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);

  const branchName = (id?: string | null) => branches.find(b => b.id === id)?.name;

  const openAccessEdit = async (user: AppUser) => {
    setAccessUser(user);
    setAccessBranchIds([]);
    setAccessError('');
    setAccessLoading(true);
    try {
      const [access, regionRows] = await Promise.all([
        posApi.getUserBranchAccess(user.id),
        regions.length > 0 ? Promise.resolve(regions) : posApi.getRegions().catch(() => [] as Region[])
      ]);
      setAccessBranchIds(access.branchIds ?? []);
      setRegions(Array.isArray(regionRows) ? regionRows : []);
    } catch (err) {
      setAccessError(getApiErrorMessage(err, 'Could not load this person\'s branches.'));
    } finally {
      setAccessLoading(false);
    }
  };

  const toggleAccessBranch = (id: string) =>
    setAccessBranchIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleSaveAccess = async () => {
    if (!accessUser) return;
    setAccessSaving(true);
    setAccessError('');
    try {
      await posApi.setUserBranchAccess(accessUser.id, accessBranchIds);
      setActionSuccess(accessBranchIds.length > 0
        ? `${accessUser.fullName} can now also work at ${accessBranchIds.length} other branch${accessBranchIds.length === 1 ? '' : 'es'}`
        : `${accessUser.fullName} works at their own branch only`);
      setAccessUser(null);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setAccessError(getApiErrorMessage(err, 'Could not save.'));
    } finally {
      setAccessSaving(false);
    }
  };

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);

  // New User Form State
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  // No default PIN: at a till the PIN alone says who is signing in, so every person needs their own.
  const [pinCode, setPinCode] = useState('');
  const [role, setRole] = useState<UserRole>('Cashier');
  const [branchScope, setBranchScope] = useState<string>('current');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addError, setAddError] = useState('');

  // Sign-in details of an existing account: back-office email/password, and a new till PIN.
  const [signInUser, setSignInUser] = useState<AppUser | null>(null);
  const [signInForm, setSignInForm] = useState({ email: '', password: '', pin: '' });
  const [signInSaving, setSignInSaving] = useState(false);
  const [signInError, setSignInError] = useState('');

  // Permission flags
  const [canViewReports, setCanViewReports] = useState(false);
  const [canManageInventory, setCanManageInventory] = useState(false);
  const [canManageMenuAndTax, setCanManageMenuAndTax] = useState(false);
  const [canGiveDiscounts, setCanGiveDiscounts] = useState(false);
  const [canVoidOrders, setCanVoidOrders] = useState(false);

  // Payroll quick-edit (set after the account exists — the create endpoint doesn't take these yet)
  const [payrollUser, setPayrollUser] = useState<AppUser | null>(null);
  const [payrollForm, setPayrollForm] = useState({
    departmentId: '', designationId: '', employmentType: 'FullTime' as 'FullTime' | 'PartTime' | 'Contract',
    monthlyRatePKR: '0', hourlyRatePKR: '0', bankAccountNumber: '', isPayrollEligible: false
  });
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);

  const loadHrLists = async () => {
    try {
      const [depts, desigs] = await Promise.all([
        posApi.getDepartments(selectedTenant?.id),
        posApi.getDesignations(selectedTenant?.id)
      ]);
      setDepartments(Array.isArray(depts) ? depts : []);
      setDesignations(Array.isArray(desigs) ? desigs : []);
    } catch {
      setDepartments([]);
      setDesignations([]);
    }
  };

  const handleQuickAddDepartment = async () => {
    const name = window.prompt('New department name:');
    if (!name?.trim()) return;
    try {
      const dept = await posApi.createDepartment({ tenantId: selectedTenant?.id, name: name.trim() });
      setDepartments(prev => [...prev, dept]);
      setPayrollForm(prev => ({ ...prev, departmentId: dept.id }));
    } catch (err) {
      console.error(err);
      alert('Failed to add department');
    }
  };

  const handleQuickAddDesignation = async () => {
    const name = window.prompt('New designation name:');
    if (!name?.trim()) return;
    try {
      const desig = await posApi.createDesignation({ tenantId: selectedTenant?.id, name: name.trim(), departmentId: payrollForm.departmentId || undefined });
      setDesignations(prev => [...prev, desig]);
      setPayrollForm(prev => ({ ...prev, designationId: desig.id }));
    } catch (err) {
      console.error(err);
      alert('Failed to add designation');
    }
  };

  const fetchUsers = async () => {
    if (!selectedTenant?.id) return;
    try {
      setLoading(true);
      const data = await posApi.getUsers(selectedTenant.id, selectedBranch?.id);
      setUsers(data);
    } catch (err) {
      console.error('Failed to load staff accounts', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    loadHrLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id, selectedBranch?.id]);

  // Quick preset helper when selecting a role
  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === 'OwnerAdmin' || newRole === 'HqAdmin') {
      setCanViewReports(true);
      setCanManageInventory(true);
      setCanManageMenuAndTax(true);
      setCanGiveDiscounts(true);
      setCanVoidOrders(true);
    } else if (newRole === 'Accountant') {
      setCanViewReports(true);
      setCanManageInventory(false);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(false);
      setCanVoidOrders(false);
    } else if (newRole === 'InventoryUser') {
      setCanViewReports(false);
      setCanManageInventory(true);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(false);
      setCanVoidOrders(false);
    } else if (newRole === 'BranchManager') {
      setCanViewReports(true);
      setCanManageInventory(true);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(true);
      setCanVoidOrders(true);
    } else if (newRole === 'KitchenChef') {
      setCanViewReports(false);
      setCanManageInventory(true);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(false);
      setCanVoidOrders(false);
    } else if (newRole === 'Cashier') {
      setCanViewReports(false);
      setCanManageInventory(false);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(false);
      setCanVoidOrders(false);
    } else if (newRole === 'Waiter') {
      setCanViewReports(false);
      setCanManageInventory(false);
      setCanManageMenuAndTax(false);
      setCanGiveDiscounts(false);
      setCanVoidOrders(false);
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant?.id || !fullName.trim() || !username.trim()) return;

    const roleNumberMap: Record<UserRole, number> = {
      SuperAdmin: 0,
      OwnerAdmin: 1,
      BranchManager: 2,
      Cashier: 3,
      KitchenChef: 4,
      Waiter: 5,
      Accountant: 6,
      InventoryUser: 7,
      HqAdmin: 8
    };

    if (!/^\d{4,6}$/.test(pinCode.trim())) {
      setAddError('Give them a PIN of 4 to 6 digits.');
      return;
    }
    const backOffice = BACK_OFFICE_ROLES.includes(role);
    setAddError('');
    try {
      await posApi.createUser({
        tenantId: selectedTenant.id,
        // An owner or HQ admin covers every location.
        branchId: OWNER_LEVEL_ROLES.includes(role) || branchScope === 'all' ? undefined : branchScope === 'current' ? selectedBranch?.id : branchScope,
        fullName: fullName.trim(),
        username: username.trim(),
        pinCode: pinCode.trim(),
        role: roleNumberMap[role],
        canViewFinancialReports: canViewReports,
        canManageInventory,
        canManageMenuAndTax,
        canGiveDiscounts,
        canVoidOrders,
        email: backOffice && newEmail.trim() ? newEmail.trim() : undefined,
        password: backOffice && newEmail.trim() && newPassword ? newPassword : undefined
      });

      setActionSuccess(`Staff account created for ${fullName.trim()} (${role})`);
      setIsAddUserOpen(false);
      setFullName('');
      setUsername('');
      setPinCode('');
      setNewEmail('');
      setNewPassword('');
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      // The server says why: a PIN someone else uses, an email already taken, a weak password.
      setAddError(getApiErrorMessage(err, 'Failed to create staff account'));
    }
  };

  const openSignInEdit = (user: AppUser) => {
    setSignInForm({ email: user.email ?? '', password: '', pin: '' });
    setSignInError('');
    setSignInUser(user);
  };

  // Someone lost the phone with their authenticator app: turn 2-step off so they can sign in and
  // set it up again on the new phone.
  const handleTurnOffTwoFactor = async () => {
    if (!signInUser) return;
    if (!window.confirm(`Turn off 2-step sign-in for ${signInUser.fullName}? Do this only if they lost their phone — they can set it up again after signing in.`)) return;
    setSignInSaving(true);
    setSignInError('');
    try {
      await posApi.updateUser(signInUser.id, { disableTwoFactor: true });
      setActionSuccess(`2-step sign-in turned off for ${signInUser.fullName}`);
      setSignInUser(null);
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setSignInError(getApiErrorMessage(err, 'Could not turn it off.'));
    } finally {
      setSignInSaving(false);
    }
  };

  const handleSaveSignIn = async () => {
    if (!signInUser) return;
    const { email, password, pin } = signInForm;
    if (pin && !/^\d{4,6}$/.test(pin)) { setSignInError('Use a PIN of 4 to 6 digits.'); return; }
    if (password && !email.trim()) { setSignInError('Add an email address to go with the password.'); return; }
    setSignInSaving(true);
    setSignInError('');
    try {
      await posApi.updateUser(signInUser.id, {
        // "" removes the back-office sign-in; unchanged fields are left alone.
        email: email.trim() === (signInUser.email ?? '') ? undefined : email.trim(),
        password: password || undefined,
        pinCode: pin || undefined
      });
      setActionSuccess(`Sign-in details updated for ${signInUser.fullName}`);
      setSignInUser(null);
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setSignInError(getApiErrorMessage(err, 'Could not save the sign-in details.'));
    } finally {
      setSignInSaving(false);
    }
  };

  const handleToggleActive = async (user: AppUser) => {
    try {
      await posApi.updateUser(user.id, { isActive: !user.isActive });
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const openPayrollEdit = (user: AppUser) => {
    setPayrollForm({
      departmentId: user.departmentId || '',
      designationId: user.designationId || '',
      employmentType: user.employmentType || 'FullTime',
      monthlyRatePKR: String(user.monthlyRatePKR ?? 0),
      hourlyRatePKR: String(user.hourlyRatePKR ?? 0),
      bankAccountNumber: user.bankAccountNumber || '',
      isPayrollEligible: !!user.isPayrollEligible
    });
    setPayrollUser(user);
  };

  const handleSavePayroll = async () => {
    if (!payrollUser) return;
    setPayrollSaving(true);
    try {
      // This form always represents the account's full current payroll state (it's pre-filled by
      // openPayrollEdit, not a partial patch), so every save resolves department/designation to
      // either a real id or the server's "clear it" sentinel — never omits them, or picking
      // "— None —" to remove an assignment would silently do nothing.
      await posApi.updateUser(payrollUser.id, {
        departmentId: payrollForm.departmentId || EMPTY_GUID,
        designationId: payrollForm.designationId || EMPTY_GUID,
        employmentType: payrollForm.employmentType,
        monthlyRatePKR: Number(payrollForm.monthlyRatePKR) || 0,
        hourlyRatePKR: Number(payrollForm.hourlyRatePKR) || 0,
        bankAccountNumber: payrollForm.bankAccountNumber || null,
        isPayrollEligible: payrollForm.isPayrollEligible
      });
      setActionSuccess(`Payroll details updated for ${payrollUser.fullName}`);
      setPayrollUser(null);
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to save payroll details');
    } finally {
      setPayrollSaving(false);
    }
  };

  const handleDeleteUser = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete staff account: ${name}?`)) return;
    try {
      await posApi.deleteUser(id);
      setActionSuccess(`Staff account deleted`);
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const getRoleBadge = (r: string) => {
    switch (r) {
      case 'OwnerAdmin':
        return <span className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 border border-purple-200 text-[11px] font-bold">Owner / Executive</span>;
      case 'HqAdmin':
        return <span className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-bold">HQ Admin</span>;
      case 'Accountant':
        return <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 text-[11px] font-bold">Accountant</span>;
      case 'InventoryUser':
        return <span className="px-2.5 py-1 rounded-lg bg-orange-100 text-orange-700 border border-orange-200 text-[11px] font-bold">Storekeeper</span>;
      case 'BranchManager':
        return <span className="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold">Branch Manager</span>;
      case 'KitchenChef':
        return <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 text-[11px] font-bold">Kitchen Chef</span>;
      case 'Waiter':
        return <span className="px-2.5 py-1 rounded-lg bg-teal-100 text-teal-700 border border-teal-200 text-[11px] font-bold">Waiter / Tab Captain</span>;
      default:
        return <span className="px-2.5 py-1 rounded-lg bg-teal-100 text-teal-700 border border-teal-200 text-[11px] font-bold">Counter Cashier</span>;
    }
  };

  return (
    <div className="flex-1 bg-slate-50 text-slate-900 overflow-y-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-6 h-6 text-teal-500" />
              <h1 className="text-xl font-black text-slate-900 tracking-tight">Staff Accounts & Role Permissions</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-teal-500" />
              Restaurant: <span className="text-teal-600 font-semibold">{selectedTenant?.name || 'Restaurant'}</span>
              {selectedBranch && <span> • Branch: {selectedBranch.name}</span>}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                // Start on the branch being viewed; the list offers every other location too.
                setBranchScope(selectedBranch?.id ?? (assignableBranches[0]?.id || 'current'));
                setAddError('');
                setIsAddUserOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-black transition shadow-lg shadow-teal-500/25"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Staff Account</span>
            </button>

            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl border border-slate-200 transition"
              title="Refresh staff list"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {actionSuccess && (
          <div className="bg-teal-50 border border-teal-500 text-teal-700 px-4 py-3 rounded-xl flex items-center gap-2 text-xs font-semibold animate-pulse shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Staff Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Active Staff Members ({users.length})</h3>
              <p className="text-[11px] text-slate-500">Controls who can log in to registers, waiter tabs, KDS, inventory, and reports.</p>
            </div>
            <span className="text-xs text-teal-600 font-mono font-bold">Role-Based Access (RBAC)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Staff Name & Username</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3 text-center">Quick PIN</th>
                  <th className="py-3 px-3">Branch Access</th>
                  <th className="py-3 px-4 text-center">Permissions Matrix</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-sm">{u.fullName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">@{u.username}</div>
                      {u.email && (
                        <div className="text-[11px] text-slate-500 flex items-center gap-1" title={u.hasPassword ? 'Signs in to the back office with this email' : 'No password set yet'}>
                          <Mail className="w-3 h-3" /> {u.email}{!u.hasPassword && <span className="text-amber-600"> · no password</span>}
                          {u.twoFactorEnabled && <span className="text-teal-700 font-semibold"> · 2-step on</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-3">
                      {getRoleBadge(u.role)}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      {/* PINs are never shown to anyone; the server only keeps a hash of them. */}
                      <span className="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-slate-400 font-bold text-xs tracking-widest">
                        ••••
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">
                      {u.branchId ? (
                        <span className="text-xs text-slate-700">{branchName(u.branchId) ?? 'Specific Branch'}</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold">
                          All Branches / HQ
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-xs mx-auto">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          u.permissions.canViewFinancialReports ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-100 text-slate-500'
                        }`}>
                          Reports
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          u.permissions.canManageInventory ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-100 text-slate-500'
                        }`}>
                          Inventory
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          u.permissions.canManageMenuAndTax ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-100 text-slate-500'
                        }`}>
                          Menu/Tax
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          u.permissions.canGiveDiscounts ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-100 text-slate-500'
                        }`}>
                          Discounts
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          u.permissions.canVoidOrders ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-slate-100 text-slate-500'
                        }`}>
                          Void
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                          u.isActive ? 'bg-teal-100 text-teal-700 border border-teal-200' : 'bg-rose-100 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.branchId && branches.length > 1 && (
                          <button
                            onClick={() => openAccessEdit(u)}
                            className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-100 hover:text-teal-600 transition"
                            title="Other branches this person may work at"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => openSignInEdit(u)}
                          className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-100 hover:text-teal-600 transition"
                          title="Sign-in: till PIN, back-office email and password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openPayrollEdit(u)}
                          className={`p-1.5 rounded-lg transition ${
                            u.isPayrollEligible ? 'bg-teal-50 text-teal-600 hover:bg-teal-100' : 'bg-slate-100 text-slate-500 hover:bg-teal-100 hover:text-teal-600'
                          }`}
                          title={u.isPayrollEligible ? 'Edit payroll details' : 'Not payroll-eligible — click to set up'}
                        >
                          <Wallet className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.fullName)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 transition"
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Staff Account Modal */}
      {isAddUserOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-teal-500" />
                <h3 className="font-bold text-slate-900 text-base">Register Staff Member</h3>
              </div>
              <button onClick={() => setIsAddUserOpen(false)} className="text-slate-400 hover:text-slate-900 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateUserSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Asim Khan"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Login Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. cashier_asim"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Restaurant Role *</label>
                  <select
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  >
                    <option value="Cashier">Counter Cashier (POS Only)</option>
                    <option value="Waiter">Waiter / Tab Captain (Table Orders)</option>
                    <option value="KitchenChef">Kitchen Chef (KDS Only)</option>
                    <option value="BranchManager">Branch Manager</option>
                    <option value="Accountant">Accountant (Books & Financial Reports)</option>
                    <option value="InventoryUser">Storekeeper (Stock & Purchasing)</option>
                    {/* Only the owner hands out owner-level roles (the server checks this too). */}
                    {canGrantOwnerLevel && (
                      <>
                        <option value="HqAdmin">HQ Admin (Runs the business, no billing)</option>
                        <option value="OwnerAdmin">Owner / Executive (All Permissions)</option>
                      </>
                    )}
                  </select>
                  {role === 'HqAdmin' && (
                    <p className="mt-1 text-[10px] text-slate-500">
                      Every location and module, like you. Cannot change the plan or a branch's POS version, add a
                      selling location, or change an owner's or HQ admin's account.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Branch Assignment</label>
                  <select
                    value={OWNER_LEVEL_ROLES.includes(role) ? 'all' : branchScope}
                    onChange={(e) => setBranchScope(e.target.value)}
                    disabled={OWNER_LEVEL_ROLES.includes(role)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none disabled:opacity-60"
                  >
                    {assignableBranches.length === 0 && (
                      <option value="current">Current Location ({selectedBranch?.name || 'Selected Branch'})</option>
                    )}
                    {assignableBranches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.locationType === 'HeadOffice' || b.isHeadOffice ? ' (Head office)' : b.locationType === 'Warehouse' ? ' (Warehouse)' : ''}
                      </option>
                    ))}
                    {!currentUser?.branchId && (
                      <option value="all">Enterprise-wide (All Branches / Head Office)</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Till PIN * (4–6 digits, their own)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pinCode}
                      onChange={(e) => { setPinCode(e.target.value.replace(/\D/g, '')); setAddError(''); }}
                      placeholder="e.g. 4829"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => { setPinCode(suggestPin()); setAddError(''); }}
                      className="px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold border border-slate-200 shrink-0"
                      title="Suggest a random PIN"
                    >
                      Suggest
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">At a till, the PIN alone signs them in.</p>
                </div>
              </div>

              {/* Owners and managers can also use the back office with email + password. */}
              {BACK_OFFICE_ROLES.includes(role) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="sm:col-span-2 text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-teal-600" /> Back office sign-in (optional)
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">Email</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => { setNewEmail(e.target.value); setAddError(''); }}
                      autoComplete="off"
                      placeholder="manager@yourrestaurant.com"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 font-medium mb-1">Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setAddError(''); }}
                      autoComplete="new-password"
                      placeholder="8+ characters, letters and numbers"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {addError && (
                <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{addError}</div>
              )}

              {/* Permission Checkboxes */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-700">Custom Permission Overrides:</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canViewReports}
                      onChange={(e) => setCanViewReports(e.target.checked)}
                      className="rounded bg-white border-slate-300 text-teal-500"
                    />
                    <span>View Financial Reports</span>
                  </label>

                  <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageInventory}
                      onChange={(e) => setCanManageInventory(e.target.checked)}
                      className="rounded bg-white border-slate-300 text-teal-500"
                    />
                    <span>Manage Kitchen Inventory</span>
                  </label>

                  <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageMenuAndTax}
                      onChange={(e) => setCanManageMenuAndTax(e.target.checked)}
                      className="rounded bg-white border-slate-300 text-teal-500"
                    />
                    <span>Edit Menu & Tax Rates</span>
                  </label>

                  <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canGiveDiscounts}
                      onChange={(e) => setCanGiveDiscounts(e.target.checked)}
                      className="rounded bg-white border-slate-300 text-teal-500"
                    />
                    <span>Authorize PKR Discounts</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-black hover:bg-teal-600 transition shadow-lg shadow-teal-500/25"
                >
                  Save Staff Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sign-in details: a new till PIN, and the back-office email + password */}
      {signInUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-teal-500" />
                <h3 className="font-bold text-slate-900 text-base">Sign-in — {signInUser.fullName}</h3>
              </div>
              <button onClick={() => setSignInUser(null)} className="text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
            </div>

            <div>
              <label className="block text-xs text-slate-500 font-medium mb-1">New till PIN (leave blank to keep it)</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={signInForm.pin}
                  onChange={(e) => setSignInForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
                  placeholder="4–6 digits"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-teal-600 focus:border-teal-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSignInForm(f => ({ ...f, pin: suggestPin() }))}
                  className="px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold border border-slate-200 shrink-0"
                >
                  Suggest
                </button>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-teal-600" /> Back office sign-in
              </div>
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">Email (clear it to remove back-office sign-in)</label>
                <input
                  type="email"
                  value={signInForm.email}
                  onChange={(e) => setSignInForm(f => ({ ...f, email: e.target.value }))}
                  autoComplete="off"
                  placeholder="name@yourrestaurant.com"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 font-medium mb-1">
                  {signInUser.hasPassword ? 'New password (leave blank to keep it)' : 'Password'}
                </label>
                <input
                  type="password"
                  value={signInForm.password}
                  onChange={(e) => setSignInForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  placeholder="8+ characters, letters and numbers"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            {signInUser.twoFactorEnabled && (
              <div className="flex items-center justify-between gap-2 p-3 bg-teal-50 rounded-xl border border-teal-200">
                <span className="text-xs text-teal-800"><strong>2-step sign-in is on.</strong> Lost their phone?</span>
                <button
                  type="button"
                  onClick={handleTurnOffTwoFactor}
                  disabled={signInSaving}
                  className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-50 shrink-0"
                >
                  Turn it off
                </button>
              </div>
            )}

            {signInError && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{signInError}</div>
            )}

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignInUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSignIn}
                disabled={signInSaving}
                className="px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-black hover:bg-teal-600 disabled:opacity-50 transition flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" /> {signInSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Quick-Edit Modal */}
      {payrollUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-teal-500" />
                <h3 className="font-bold text-slate-900 text-base">Payroll — {payrollUser.fullName}</h3>
              </div>
              <button onClick={() => setPayrollUser(null)} className="text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={payrollForm.isPayrollEligible}
                onChange={(e) => setPayrollForm({ ...payrollForm, isPayrollEligible: e.target.checked })}
                className="w-4 h-4 accent-teal-500"
              />
              <span>Payroll-eligible (included when payslips are generated)</span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Department</label>
                <div className="flex gap-1">
                  <select value={payrollForm.departmentId} onChange={(e) => setPayrollForm({ ...payrollForm, departmentId: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none">
                    <option value="">— None —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button type="button" onClick={handleQuickAddDepartment}
                    className="px-2.5 rounded-xl bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 text-xs font-bold transition" title="Add new department">+</button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Designation</label>
                <div className="flex gap-1">
                  <select value={payrollForm.designationId} onChange={(e) => setPayrollForm({ ...payrollForm, designationId: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none">
                    <option value="">— None —</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button type="button" onClick={handleQuickAddDesignation}
                    className="px-2.5 rounded-xl bg-slate-100 hover:bg-teal-50 text-slate-500 hover:text-teal-600 text-xs font-bold transition" title="Add new designation">+</button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Employment Type</label>
                <select value={payrollForm.employmentType} onChange={(e) => setPayrollForm({ ...payrollForm, employmentType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none">
                  <option value="FullTime">Full-Time</option>
                  <option value="PartTime">Part-Time</option>
                  <option value="Contract">Contract</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bank Account</label>
                <input type="text" value={payrollForm.bankAccountNumber} onChange={(e) => setPayrollForm({ ...payrollForm, bankAccountNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Monthly Rate (PKR)</label>
                <input type="number" value={payrollForm.monthlyRatePKR} onChange={(e) => setPayrollForm({ ...payrollForm, monthlyRatePKR: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
                <p className="text-[10px] text-slate-400 mt-0.5">Used when hourly rate is 0.</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Hourly Rate (PKR)</label>
                <input type="number" value={payrollForm.hourlyRatePKR} onChange={(e) => setPayrollForm({ ...payrollForm, hourlyRatePKR: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none" />
                <p className="text-[10px] text-slate-400 mt-0.5">Takes precedence — pays actual clocked hours.</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPayrollUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition">
                Cancel
              </button>
              <button
                onClick={handleSavePayroll}
                disabled={payrollSaving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-black hover:bg-teal-600 disabled:opacity-50 transition shadow-lg shadow-teal-500/25"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{payrollSaving ? 'Saving…' : 'Save Payroll Details'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other branches this person may work at */}
      {accessUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-teal-500" />
                <h3 className="font-bold text-slate-900 text-base">Also works at — {accessUser.fullName}</h3>
              </div>
              <button onClick={() => setAccessUser(null)} className="text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-xs text-slate-500">
              Home branch: <span className="font-semibold text-slate-800">{branchName(accessUser.branchId) ?? 'their own branch'}</span>.
              Tick the other branches they cover. They sign in there with the same PIN and the same role, and can switch
              branch from the top bar.
            </p>

            {accessLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-teal-200 border-t-teal-500 rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {regions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {regions
                      .filter(r => branches.some(b => b.regionId === r.id && b.id !== accessUser.branchId))
                      .map(r => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setAccessBranchIds(prev => Array.from(new Set([
                            ...prev,
                            ...branches.filter(b => b.regionId === r.id && b.id !== accessUser.branchId).map(b => b.id)
                          ])))}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-teal-50 text-slate-600 hover:text-teal-700 border border-slate-200 text-[11px] font-semibold transition"
                        >
                          + All in {r.name}
                        </button>
                      ))}
                  </div>
                )}
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {branches.filter(b => b.id !== accessUser.branchId).map(b => (
                    <label key={b.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer text-xs">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={accessBranchIds.includes(b.id)}
                          onChange={() => toggleAccessBranch(b.id)}
                          className="w-4 h-4 accent-teal-500"
                        />
                        <span className="font-semibold text-slate-800">{b.name}</span>
                        {(b.locationType === 'HeadOffice' || b.isHeadOffice) && <span className="text-[10px] text-slate-400">(Head office)</span>}
                        {b.locationType === 'Warehouse' && <span className="text-[10px] text-slate-400">(Warehouse)</span>}
                      </span>
                      <span className="text-[10px] text-slate-400">{b.city}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {accessError && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">{accessError}</div>
            )}

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAccessUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition">
                Cancel
              </button>
              <button
                onClick={handleSaveAccess}
                disabled={accessSaving || accessLoading}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-black hover:bg-teal-600 disabled:opacity-50 transition shadow-lg shadow-teal-500/25"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{accessSaving ? 'Saving…' : 'Save'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

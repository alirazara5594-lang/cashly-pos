import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Trash2, 
  Building2, 
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { AppUser, UserRole } from '../types';

export const UserManagement: React.FC = () => {
  const { selectedTenant, selectedBranch } = usePosStore();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);

  // New User Form State
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [pinCode, setPinCode] = useState('1234');
  const [role, setRole] = useState<UserRole>('Cashier');
  const [branchScope, setBranchScope] = useState<string>('current');

  // Permission flags
  const [canViewReports, setCanViewReports] = useState(false);
  const [canManageInventory, setCanManageInventory] = useState(false);
  const [canManageMenuAndTax, setCanManageMenuAndTax] = useState(false);
  const [canGiveDiscounts, setCanGiveDiscounts] = useState(false);
  const [canVoidOrders, setCanVoidOrders] = useState(false);

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
  }, [selectedTenant?.id, selectedBranch?.id]);

  // Quick preset helper when selecting a role
  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === 'OwnerAdmin') {
      setCanViewReports(true);
      setCanManageInventory(true);
      setCanManageMenuAndTax(true);
      setCanGiveDiscounts(true);
      setCanVoidOrders(true);
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
      Waiter: 5
    };

    try {
      await posApi.createUser({
        tenantId: selectedTenant.id,
        branchId: branchScope === 'current' ? selectedBranch?.id : undefined,
        fullName: fullName.trim(),
        username: username.trim(),
        pinCode: pinCode.trim() || '1234',
        role: roleNumberMap[role],
        canViewFinancialReports: canViewReports,
        canManageInventory,
        canManageMenuAndTax,
        canGiveDiscounts,
        canVoidOrders
      });

      setActionSuccess(`Staff account created for ${fullName.trim()} (${role})`);
      setIsAddUserOpen(false);
      setFullName('');
      setUsername('');
      setPinCode('1234');
      await fetchUsers();
      setTimeout(() => setActionSuccess(null), 3500);
    } catch (err) {
      console.error(err);
      alert('Failed to create staff account');
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
              onClick={() => setIsAddUserOpen(true)}
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
                    </td>
                    <td className="py-3.5 px-3">
                      {getRoleBadge(u.role)}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 font-mono text-teal-600 font-bold text-xs">
                        {u.pinCode}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700">
                      {u.branchId ? (
                        <span className="text-xs text-slate-700">Specific Branch</span>
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
                      <button
                        onClick={() => handleDeleteUser(u.id, u.fullName)}
                        className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 transition"
                        title="Delete User"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
                    <option value="OwnerAdmin">Owner / Executive (All Permissions)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Branch Assignment</label>
                  <select
                    value={branchScope}
                    onChange={(e) => setBranchScope(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  >
                    <option value="current">Current Location ({selectedBranch?.name || 'Selected Branch'})</option>
                    <option value="all">Enterprise-wide (All Branches / Head Office)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 font-medium mb-1">Quick Terminal PIN Code (4 Digits)</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-teal-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
                  />
                </div>
              </div>

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
    </div>
  );
};

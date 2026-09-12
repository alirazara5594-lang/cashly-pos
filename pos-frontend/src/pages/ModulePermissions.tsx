import React, { useState, useEffect } from 'react';
import {
  Shield,
  Users,
  RefreshCw,
  Save,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Eye,
  Edit3,
  Trash2,
  Download
} from 'lucide-react';
import { posApi } from '../services/api';

interface ModuleDef {
  key: string;
  label: string;
  subModules: { key: string; label: string }[];
}

interface PermissionEntry {
  moduleKey: string;
  subModuleKey: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

interface UserOption {
  id: string;
  fullName: string;
  username: string;
  role: number;
}

export const ModulePermissions: React.FC = () => {
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [modulesData, usersData] = await Promise.all([
        posApi.getModuleCatalog().catch(() => []),
        posApi.getAdminTenants().catch(() => [])
      ]);
      setModules(Array.isArray(modulesData) ? modulesData : [
        { key: 'pos', label: 'POS Terminal', subModules: [{ key: 'billing', label: 'Billing & Checkout' }, { key: 'order_management', label: 'Order Management' }] },
        { key: 'kitchen', label: 'Kitchen Display', subModules: [{ key: 'kds', label: 'Kitchen Display System' }] },
        { key: 'delivery', label: 'Delivery Board', subModules: [{ key: 'dispatch', label: 'Dispatch & Riders' }, { key: 'cod', label: 'COD Settlement' }] },
        { key: 'inventory', label: 'Inventory', subModules: [{ key: 'ingredients', label: 'Raw Ingredients' }, { key: 'finished', label: 'Finished Stock' }, { key: 'recipes', label: 'Recipes & BOM' }] },
        { key: 'supply_chain', label: 'Supply Chain', subModules: [{ key: 'transfers', label: 'Inter-Branch Transfers' }, { key: 'procurement', label: 'Vendor Procurement' }] },
        { key: 'reports', label: 'Reports', subModules: [{ key: 'financial', label: 'Financial Reports' }, { key: 'sales', label: 'Sales Analytics' }, { key: 'tax', label: 'Tax Audit' }] },
        { key: 'management', label: 'Management', subModules: [{ key: 'menu', label: 'Menu & Catalog' }, { key: 'staff', label: 'Staff Management' }, { key: 'floors', label: 'Floor & Tables' }, { key: 'settings', label: 'Settings' }] },
        { key: 'admin', label: 'Platform Admin', subModules: [{ key: 'tenants', label: 'Tenant Management' }, { key: 'packages', label: 'Packages & Pricing' }, { key: 'whatsapp', label: 'WhatsApp Config' }, { key: 'permissions', label: 'Module Permissions' }] },
      ]);

      const tenants = Array.isArray(usersData) ? usersData : [];
      const flatUsers: UserOption[] = [];
      for (const t of tenants) {
        try {
          const tenantUsers = await posApi.getUsers(t.id);
          if (Array.isArray(tenantUsers)) {
            flatUsers.push(...tenantUsers.map((u: any) => ({ id: u.id, fullName: u.fullName, username: u.username, role: u.role })));
          }
        } catch { /* skip */ }
      }
      setUsers(flatUsers);
    } catch (err) {
      console.error('Failed to load permissions data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const loadUserPermissions = async (userId: string) => {
    setSelectedUserId(userId);
    setMessage(null);
    try {
      const data = await posApi.getUserPermissions(userId);
      if (Array.isArray(data)) {
        setPermissions(data);
      } else {
        setPermissions([]);
      }
    } catch {
      setPermissions([]);
    }
  };

  const getPermission = (moduleKey: string, subModuleKey: string, field: keyof PermissionEntry): boolean => {
    const entry = permissions.find(p => p.moduleKey === moduleKey && p.subModuleKey === subModuleKey);
    return entry ? (entry[field] as boolean) : false;
  };

  const setPermission = (moduleKey: string, subModuleKey: string, field: keyof PermissionEntry, value: boolean) => {
    setPermissions(prev => {
      const existing = prev.find(p => p.moduleKey === moduleKey && p.subModuleKey === subModuleKey);
      if (existing) {
        return prev.map(p =>
          p.moduleKey === moduleKey && p.subModuleKey === subModuleKey
            ? { ...p, [field]: value }
            : p
        );
      }
      return [...prev, {
        moduleKey, subModuleKey,
        canView: field === 'canView' ? value : false,
        canEdit: field === 'canEdit' ? value : false,
        canDelete: field === 'canDelete' ? value : false,
        canExport: field === 'canExport' ? value : false,
      }];
    });
  };

  const handleSave = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setMessage(null);
    try {
      await posApi.updateUserPermissions(selectedUserId, permissions);
      setMessage({ type: 'success', text: 'Permissions saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save permissions' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading permissions data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">Module Permissions</h1>
            <p className="text-xs text-slate-400">Control what each staff member can access</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={!selectedUserId || saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Permissions'}
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold ${
          message.type === 'success' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* User Selector */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase mb-2">
          <Users className="w-3.5 h-3.5" /> Select Staff Member
        </label>
        <div className="relative">
          <select
            value={selectedUserId}
            onChange={(e) => loadUserPermissions(e.target.value)}
            className="w-full appearance-none pl-3 pr-8 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="">-- Choose a user --</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Permissions Tree */}
      {selectedUserId && (
        <div className="space-y-4">
          {modules.map((mod) => (
            <div key={mod.key} className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
              <div className="px-5 py-3 bg-slate-950 border-b border-slate-800">
                <h3 className="text-xs font-bold text-white">{mod.label}</h3>
              </div>
              <div className="divide-y divide-slate-800/50">
                {mod.subModules.map((sub) => (
                  <div key={sub.key} className="px-5 py-3 flex items-center gap-4">
                    <span className="text-[11px] text-slate-300 font-medium min-w-[140px]">{sub.label}</span>
                    <div className="flex items-center gap-3 flex-1">
                      {[
                        { field: 'canView' as const, icon: Eye, label: 'View' },
                        { field: 'canEdit' as const, icon: Edit3, label: 'Edit' },
                        { field: 'canDelete' as const, icon: Trash2, label: 'Delete' },
                        { field: 'canExport' as const, icon: Download, label: 'Export' },
                      ].map(({ field, icon: Icon, label }) => {
                        const hasAccess = getPermission(mod.key, sub.key, field);
                        return (
                          <button
                            key={field}
                            onClick={() => setPermission(mod.key, sub.key, field, !hasAccess)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition border ${
                              hasAccess
                                ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                : 'bg-slate-950 text-red-400 border-red-900'
                            }`}
                          >
                            <Icon className="w-3 h-3" />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="shrink-0">
                      {(() => {
                        const allTrue = ['canView', 'canEdit', 'canDelete', 'canExport'].every(
                          f => getPermission(mod.key, sub.key, f as keyof PermissionEntry)
                        );
                        return allTrue ? (
                          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800">Full Access</span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

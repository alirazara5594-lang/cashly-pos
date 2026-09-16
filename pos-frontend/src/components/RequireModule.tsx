import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { usePosStore, hasModuleAccess } from '../store/posStore';
import type { ModuleKey, PermissionAction } from '../types';

interface RequireModuleProps {
  module: ModuleKey;
  action?: PermissionAction;
  children: React.ReactNode;
}

/**
 * Route guard. Renders `children` only when the signed-in user has the given
 * module permission, otherwise an Access Denied state.
 *
 * This is UI feedback, not security: the backend enforces the same rules on
 * every request, so a bypassed guard still gets a 401/403 from the API.
 */
export const RequireModule: React.FC<RequireModuleProps> = ({ module, action = 'view', children }) => {
  const navigate = useNavigate();
  const currentUser = usePosStore(s => s.currentUser);
  const modulePermissions = usePosStore(s => s.modulePermissions);

  const allowed = hasModuleAccess(currentUser?.role, modulePermissions, module, action);

  if (allowed) return <>{children}</>;

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 min-h-[60vh]">
      <div className="max-w-md w-full text-center space-y-4 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mx-auto">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-black text-slate-900">Access Denied</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your account{currentUser?.fullName ? ` (${currentUser.fullName})` : ''} does not have
            <strong className="text-slate-700"> {action} </strong>
            access to the <strong className="text-slate-700">{module}</strong> module.
          </p>
          <p className="text-[11px] text-slate-400">
            Ask an owner or administrator to grant this in Module Permissions.
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to POS Terminal
        </button>
      </div>
    </div>
  );
};

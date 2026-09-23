import React, { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Store, 
  ChefHat, 
  Tablet, 
  Bike, 
  Boxes, 
  Truck, 
  FileText, 
  Users, 
  BookOpen, 
  BarChart3, 
  ShieldCheck, 
  ChevronDown, 
  ChevronRight,
  ChevronLeft,
  PieChart,
  Percent,
  Wheat,
  Building2,
  Armchair,
  ShoppingBag,
  ArrowRightLeft,
  Receipt,
  CreditCard,
  TrendingUp,
  Send,
  Banknote,
  Wallet,
  MessageSquare,
  Shield,
  Brain,
  Gift,
  CalendarClock,
  Clock,
  Plug,
  Landmark,
  History,
  Puzzle
} from 'lucide-react';
import { usePosStore, hasModuleAccess, normalizeRole } from '../store/posStore';
import { getDeviceSurface } from '../services/deviceLicense';
import type { ModuleKey, PermissionAction } from '../types';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface SubMenuItem {
  label: string;
  path: string;
  state?: any;
  icon?: React.ElementType;
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
  subItems?: SubMenuItem[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile
}) => {
  const location = useLocation();
  const {
    selectedTenant,
    selectedBranch,
    terminalMode,
    currentUser,
    modulePermissions,
    packageInfo
  } = usePosStore();

  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;
  const isHeadOffice = selectedBranch?.isHeadOffice ?? false;
  // Head office of a chain runs the ERP only. The server resolves this (deployment mode plus
  // which branch you sit at) so the sidebar, the router and the API cannot disagree about it.
  const isErpOnly = getDeviceSurface() === 'Erp' || packageInfo?.appSurface === 'Erp';
  // Retail/Cash & Carry tenants have no kitchen and no dine-in tables — those screens
  // would just be dead weight in their sidebar.
  const isRetailBiz = selectedTenant?.businessType === 'Retail' || selectedTenant?.businessType === 'CashAndCarry';
  // Platform-vendor screens (Tenant Management, Package Pricing) manage every
  // tenant on the platform, not just this one — they must never show for a
  // restaurant Owner, even though Owner otherwise bypasses module checks.
  const isPlatformSuperAdmin = normalizeRole(currentUser?.role) === 'SuperAdmin';

  // Menu visibility is driven by the signed-in user's real ModulePermission rows
  // (plus the role baseline), not by which terminal profile this PC is set to.
  const can = React.useCallback(
    (moduleKey: ModuleKey, action: PermissionAction = 'view') =>
      hasModuleAccess(currentUser?.role, modulePermissions, moduleKey, action),
    [currentUser?.role, modulePermissions]
  );

  const isOwnerOrUnlocked = can('admin') || can('accounts', 'edit');

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    pos: true,
    inventory: false,
    supplyChain: false,
    reports: false,
    management: false
  });

  const toggleMenu = (id: string) => {
    setOpenMenus(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const navSections = useMemo<NavSection[]>(() => {
    const sections: NavSection[] = [];

    // ── Operational screens: visible to ANY signed-in user. These are not module
    // gated (per the role baseline); the terminal profile only decides which of
    // them this particular device is set up to show.
    //
    // Except at the head office of a chain, which runs the ERP and never sells: no till, no
    // kitchen screen, no waiter tablet. Selling happens at the branches. Showing a register to
    // someone who administers a warehouse is clutter at best and a mis-click at worst.
    if (isErpOnly) {
      // Nothing operational to add — the sections below are the whole application here.
    } else if (terminalMode === 'KitchenKDS') {
      sections.push({
        title: 'Kitchen Operations',
        items: [{
          id: 'pos',
          label: 'Kitchen Display',
          path: '/kitchen',
          icon: ChefHat,
          subItems: [
            { label: 'Kitchen Display (KDS)', path: '/kitchen', icon: ChefHat }
          ]
        }]
      });
    } else if (terminalMode === 'WaiterTab') {
      sections.push({
        title: 'Waiter Operations',
        items: [{
          id: 'pos',
          label: 'Dining & Orders',
          path: '/order-tab',
          icon: Tablet,
          subItems: [
            { label: 'Tablet Waiter App', path: '/order-tab', icon: Tablet },
            { label: 'Delivery & COD Board', path: '/delivery', icon: Bike }
          ]
        }]
      });
    } else {
      sections.push({
        title: isRetailBiz ? 'Sales & Orders' : 'Operations & Dining',
        items: [{
          id: 'pos',
          label: isRetailBiz ? 'POS & Sales' : 'POS & Orders',
          path: '/',
          icon: Store,
          subItems: [
            { label: 'POS Terminal (Register)', path: '/', icon: Store },
            ...(isRetailBiz ? [] : [{ label: 'Kitchen Display (KDS)', path: '/kitchen', icon: ChefHat }]),
            ...(isRetailBiz ? [] : [{ label: 'Tablet Waiter App', path: '/order-tab', icon: Tablet }]),
            { label: 'Delivery & COD Board', path: '/delivery', icon: Bike }
          ]
        }]
      });
    }

    // ── Inventory & stock → `inventory` module
    const inventoryItems: NavItem[] = [];
    if (can('inventory')) {
      inventoryItems.push({
        id: 'inventory',
        label: 'Stock Management',
        path: '/inventory',
        icon: Boxes,
        subItems: isHeadOffice
          ? [
              { label: 'Raw Ingredients & BOM', path: '/inventory', state: { tab: 'ingredients' }, icon: Wheat },
              { label: 'Finished Food Stock', path: '/inventory', state: { tab: 'finished' }, icon: Boxes }
            ]
          : [
              { label: 'View Ingredients & Stock', path: '/inventory', state: { tab: 'ingredients' }, icon: Wheat },
              { label: 'View Finished Food Stock', path: '/inventory', state: { tab: 'finished' }, icon: Boxes }
            ]
      });
      inventoryItems.push({
        id: 'stockRequests',
        label: 'Stock Requests',
        path: '/stock-requests',
        icon: Send,
        subItems: [
          { label: 'Request Stock (Owner/Vendor/HQ)', path: '/stock-requests', icon: Send }
        ]
      });
    }

    // ── Commissary transfers & vendor procurement → `supplychain` module
    if (can('supplychain')) {
      inventoryItems.push({
        id: 'supplyChain',
        label: 'Supply Chain',
        path: '/transfers',
        icon: Truck,
        badge: isHeadOffice ? 'Commissary' : undefined,
        subItems: [
          { label: 'Commissary Transfers', path: '/transfers', state: { tab: 'transfers' }, icon: ArrowRightLeft },
          { label: 'Vendor Procurement (PO)', path: '/transfers', state: { tab: 'procurement' }, icon: ShoppingBag }
        ]
      });
    }

    if (inventoryItems.length > 0) {
      sections.push({
        title: isHeadOffice ? 'Commissary & Logistics' : 'Inventory & Stock',
        items: inventoryItems
      });
    }

    // ── Reporting & analytics → `reports` module (Accounting is `accounts`, shown here too
    // since the same people who read financial reports run the books).
    if (can('reports') || can('accounts')) {
      const reportingItems: NavItem[] = [];
      if (can('accounts')) {
        reportingItems.push({
          id: 'accounting',
          label: 'Accounting',
          path: '/accounting',
          icon: Landmark
        });
      }
      if (can('reports')) {
        reportingItems.push(
          {
            id: 'reports',
            label: 'Financial Reports',
            path: '/reports',
            icon: FileText,
            subItems: [
              { label: 'Daily End-of-Day Z-Report', path: '/reports', state: { tab: 'zreport' }, icon: Receipt },
              { label: 'Cash Sales Report', path: '/reports', state: { tab: 'cashSales' }, icon: Banknote },
              { label: 'Card / Digital Sales Report', path: '/reports', state: { tab: 'cardSales' }, icon: CreditCard },
              { label: 'Cash Tally & Closing', path: '/reports', state: { tab: 'cashTally' }, icon: Wallet },
              { label: 'Tax Audit & Compliance', path: '/reports', state: { tab: 'tax' }, icon: Percent },
              { label: 'Category Turnover & Channels', path: '/reports', state: { tab: 'categories' }, icon: PieChart },
              { label: 'Menu Profitability & COGS', path: '/reports', state: { tab: 'products' }, icon: TrendingUp },
              { label: 'Payment Tender Mix', path: '/reports', state: { tab: 'payments' }, icon: Wallet },
              ...(isMultiBranchChain ? [{ label: 'Multi-Branch Consolidation', path: '/reports', state: { tab: 'multibranch' }, icon: Building2 }] : [])
            ]
          },
          {
            id: 'director',
            label: 'Executive Dashboard',
            path: '/director',
            icon: BarChart3
          },
          {
            id: 'analytics',
            label: 'Smart Analytics',
            path: '/analytics',
            icon: Brain
          },
          {
            id: 'menuEngineering',
            label: 'Menu Engineering',
            path: '/menu-engineering',
            icon: TrendingUp
          }
        );
      }
      sections.push({ title: 'Reporting & Analytics', items: reportingItems });
    }

    // ── CRM, loyalty & promotions. Customer lookup is part of taking an order, so
    // it stays visible to everyone; the money-rules screens are `admin` only.
    const crmItems: NavItem[] = [
      {
        id: 'customers',
        label: 'Customers',
        path: '/customers',
        icon: Users
      }
    ];
    if (can('admin')) {
      crmItems.push({
        id: 'loyalty',
        label: 'Loyalty & Gift Cards',
        path: '/loyalty',
        icon: Gift
      });
      crmItems.push({
        id: 'promoCodes',
        label: 'Promo Codes',
        path: '/promo-codes',
        icon: Percent
      });
    }
    sections.push({ title: 'Customers & Loyalty', items: crmItems });

    // ── Staff scheduling & time clock → `labor` module
    if (can('labor')) {
      sections.push({
        title: 'Staff & Labor',
        items: [{
          id: 'labor',
          label: 'Labor & Scheduling',
          path: '/labor',
          icon: CalendarClock,
          subItems: [
            { label: 'Shift Schedule', path: '/labor', icon: CalendarClock },
            { label: 'Time Clock & Timesheet', path: '/labor', state: { tab: 'timeclock' }, icon: Clock }
          ]
        }]
      });
    }

    // ── System & administration. Each entry maps to the module it represents:
    // menu → `menu`, staff → `users`, platform screens → `admin`, settings → `accounts`.
    const adminItems: NavItem[] = [];

    const menuSubItems: SubMenuItem[] = [];
    if (can('menu')) {
      menuSubItems.push({ label: isRetailBiz ? 'Product Catalog' : 'Menu Catalog & Recipes', path: '/menu', icon: BookOpen });
      if (!isRetailBiz) menuSubItems.push({ label: 'Floor & Table Setup', path: '/floors', icon: Armchair });
    }
    if (can('accounts')) {
      menuSubItems.push({ label: 'Tax Configuration', path: '/tax-configuration', icon: Percent });
    }
    if (can('users')) {
      menuSubItems.push({ label: 'Staff & Pin Access', path: '/users', icon: Users });
    }
    if (menuSubItems.length > 0) {
      adminItems.push({
        id: 'management',
        label: can('menu') ? 'Menu & Setup' : 'Staff Setup',
        path: menuSubItems[0].path,
        icon: BookOpen,
        subItems: menuSubItems
      });
    }

    if (can('admin')) {
      const platformSubItems: SubMenuItem[] = [];
      // Cross-tenant vendor screens — only the platform SuperAdmin (you, the
      // company) manages every restaurant's tier/status. A restaurant Owner
      // never sees these, even though Owner otherwise passes module checks.
      if (isPlatformSuperAdmin) {
        platformSubItems.push({ label: 'Tenant Management', path: '/super-admin', icon: Building2 });
        platformSubItems.push({ label: 'Package Pricing', path: '/pricing-admin', icon: CreditCard });
      } else {
        // The inverse of the block above: these configure ONE restaurant's own
        // integrations. A platform SuperAdmin has no tenant of its own to scope
        // them to (ResolveTenantScope has nothing to resolve without a tenant
        // picker here), so the API 401s them — keep these Owner/staff-only.
        platformSubItems.push({ label: 'WhatsApp Config', path: '/whatsapp-config', icon: MessageSquare });
        platformSubItems.push({ label: 'Payment Gateways', path: '/payment-settings', icon: CreditCard });
        platformSubItems.push({ label: 'Delivery Integrations', path: '/delivery-integrations', icon: Plug });
        platformSubItems.push({ label: 'Add-ons', path: '/my-addons', icon: Puzzle });
      }
      if (can('users', 'edit')) {
        platformSubItems.push({ label: 'Permissions', path: '/permissions', icon: Shield });
      }
      platformSubItems.push({ label: 'Audit Log', path: '/audit-log', icon: History });
      adminItems.push({
        id: 'platformAdmin',
        label: isPlatformSuperAdmin ? 'Platform Admin' : 'Integrations & Access',
        path: platformSubItems[0].path,
        icon: ShieldCheck,
        subItems: platformSubItems
      });
    } else if (can('users', 'edit')) {
      adminItems.push({
        id: 'permissions',
        label: 'Module Permissions',
        path: '/permissions',
        icon: Shield
      });
    }

    if (can('accounts')) {
      adminItems.push({
        id: 'settings',
        label: 'System Settings & HQ Hub',
        path: '/settings',
        icon: Building2
      });
    }

    if (adminItems.length > 0) {
      sections.push({
        title: 'System & Administration',
        items: adminItems
      });
    }

    return sections;
  }, [isHeadOffice, isMultiBranchChain, terminalMode, can, isPlatformSuperAdmin, isRetailBiz, isErpOnly]);

  return (
    <>
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      <aside
        className={`app-sidebar fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ${
          isCollapsed ? 'w-18' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 bg-slate-50">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-500 to-purple-600 flex items-center justify-center text-white font-black shadow-lg shadow-teal-500/20 shrink-0">
              C
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="font-black text-base text-slate-900 tracking-tight leading-none">
                  Cashly <span className="text-teal-600 font-semibold text-xs px-1.5 py-0.5 rounded bg-teal-50 border border-teal-200">POS</span>
                </span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                  {isOwnerOrUnlocked ? (isMultiBranchChain ? 'Head Office' : 'Owner') : 'Branch'}
                </span>
              </div>
            )}
          </Link>

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-200">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-teal-600 mb-1.5">
                  {section.title}
                </div>
              )}

              {section.items.map(item => {
                const Icon = item.icon;
                const isCurrentPath = location.pathname === item.path;
                const hasSub = !!item.subItems && item.subItems.length > 0;
                const isOpen = openMenus[item.id];

                return (
                  <div key={item.id} className="space-y-1">
                    {hasSub ? (
                      <button
                        onClick={() => toggleMenu(item.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition group ${
                          isCurrentPath
                            ? 'bg-teal-50 text-teal-700 border border-teal-200'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-teal-600' : 'text-slate-400 group-hover:text-slate-700'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>

                        {!isCollapsed && (
                          <div className="flex items-center gap-1.5">
                            {item.badge && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-200">
                                {item.badge}
                              </span>
                            )}
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-slate-700' : ''}`} />
                          </div>
                        )}
                      </button>
                    ) : (
                      <Link
                        to={item.path}
                        onClick={onCloseMobile}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-smooth group ${
                          isCurrentPath
                            ? 'bg-teal-50 text-teal-700 font-bold'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-teal-600' : 'text-slate-400 group-hover:text-slate-700'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>
                      </Link>
                    )}

                    {hasSub && isOpen && !isCollapsed && (
                      <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-slate-200 ml-3.5 mt-1">
                        {item.subItems!.map((sub, subIdx) => {
                          const SubIcon = sub.icon || ChevronRight;
                          const isSubActive = location.pathname === sub.path && (
                            (!sub.state?.tab && !location.state?.tab) ||
                            (sub.state?.tab && location.state?.tab === sub.state.tab) ||
                            (sub.state?.tab && location.search.includes(sub.state.tab))
                          );

                          return (
                            <Link
                              key={subIdx}
                              to={sub.path}
                              state={sub.state}
                              onClick={onCloseMobile}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition ${
                                isSubActive
                                  ? 'bg-teal-50 text-teal-700 font-bold'
                                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <SubIcon className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {!isCollapsed && (
          <div className="p-3 border-t border-slate-200 bg-slate-50 text-[11px]">
            <div className="flex items-center gap-2 text-slate-500">
              {isOwnerOrUnlocked && isMultiBranchChain ? (
                <Building2 className="w-3.5 h-3.5 text-teal-600" />
              ) : (
                <Store className="w-3.5 h-3.5 text-teal-600" />
              )}
              <span className="truncate font-semibold text-slate-700">
                {selectedBranch?.name || selectedTenant?.name || 'Restaurant'}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {isOwnerOrUnlocked ? (isMultiBranchChain ? 'Head Office & Commissary' : 'Owner Access') : `Branch • ${selectedBranch?.city || ''}`}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

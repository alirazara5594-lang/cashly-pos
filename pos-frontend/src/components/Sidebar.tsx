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
  Puzzle,
  RotateCcw,
  ClipboardList
} from 'lucide-react';
import { usePosStore, hasModuleAccess, normalizeRole } from '../store/posStore';
import { getDeviceSurface } from '../services/deviceLicense';
import type { EffectivePackageFeatures, ModuleKey, PermissionAction } from '../types';

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
    packageInfo,
    packageFeatures
  } = usePosStore();

  // What the business's POS version and add-ons include. A module it has not bought is hidden
  // rather than shown and refused (the Add-ons page lists what can be added). Unknown = included,
  // so nothing disappears while the package is still loading or on an older server.
  const has = React.useCallback(
    (flag: keyof EffectivePackageFeatures) => packageFeatures?.[flag] !== false,
    [packageFeatures]
  );

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

  // Accordion, not independent toggles: one group open at a time. The sidebar is taller than
  // most screens once two or three groups are expanded, which pushed System & Administration
  // below the fold and made the menu feel like it had lost items.
  const [openMenu, setOpenMenu] = useState<string | null>('pos');

  const toggleMenu = (id: string) => {
    setOpenMenu(prev => (prev === id ? null : id));
  };

  const navSections = useMemo<NavSection[]>(() => {
    // The platform admin has no restaurant of its own, so every restaurant screen would ask the
    // server for "this restaurant", be refused, and sign them out. They get the platform screens
    // only; to look inside a restaurant: Tenant Management → Manage → View as customer (and each
    // restaurant's audit log is a tab there).
    if (isPlatformSuperAdmin) {
      return [{
        title: 'Platform Administration',
        items: [
          { id: 'tenants', label: 'Tenant Management', path: '/super-admin', icon: Building2 },
          { id: 'pricing', label: 'Package Pricing', path: '/pricing-admin', icon: CreditCard }
        ]
      }];
    }

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
            ...(has('hasDeliveryCOD') ? [{ label: 'Delivery & COD Board', path: '/delivery', icon: Bike }] : [])
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
            // Tabs and QR orders are taken now and paid later; the cashier collects them here.
            { label: 'Open Orders (Unpaid)', path: '/open-orders', icon: ClipboardList },
            { label: 'Returns & Refunds', path: '/returns', icon: RotateCcw },
            ...(isRetailBiz || !has('hasKitchenDisplay') ? [] : [{ label: 'Kitchen Display (KDS)', path: '/kitchen', icon: ChefHat }]),
            ...(isRetailBiz ? [] : [{ label: 'Tablet Waiter App', path: '/order-tab', icon: Tablet }]),
            ...(has('hasDeliveryCOD') ? [{ label: 'Delivery & COD Board', path: '/delivery', icon: Bike }] : [])
          ]
        }]
      });
    }

    // ── Inventory & stock → `inventory` module
    const inventoryItems: NavItem[] = [];
    if (can('inventory') && has('hasInventoryManagement')) {
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
    const supplySubItems: SubMenuItem[] = [
      ...(has('hasStockTransfers') ? [{ label: 'Commissary Transfers', path: '/transfers', state: { tab: 'transfers' }, icon: ArrowRightLeft }] : []),
      ...(has('purchasing') ? [{ label: 'Vendor Procurement (PO)', path: '/transfers', state: { tab: 'procurement' }, icon: ShoppingBag }] : [])
    ];
    if (can('supplychain') && supplySubItems.length > 0) {
      inventoryItems.push({
        id: 'supplyChain',
        label: 'Supply Chain',
        path: '/transfers',
        icon: Truck,
        badge: isHeadOffice ? 'Commissary' : undefined,
        subItems: supplySubItems
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
      if (can('accounts') && has('accounting')) {
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
          ...(has('hasDirectorDashboard') ? [{
            id: 'director',
            label: 'Executive Dashboard',
            path: '/director',
            icon: BarChart3
          }] : []),
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
      if (reportingItems.length > 0) sections.push({ title: 'Reporting & Analytics', items: reportingItems });
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
    if (can('admin') && has('loyalty')) {
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
    sections.push({ title: has('loyalty') ? 'Customers & Loyalty' : 'Customers', items: crmItems });

    // ── Staff scheduling & time clock → `labor` module
    if (can('labor') && has('labor')) {
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

    // Locations belong to one business; the platform admin has none of its own.
    if (can('admin') && !isPlatformSuperAdmin) {
      adminItems.push({
        id: 'locations',
        label: 'Locations & Head Office',
        path: '/locations',
        icon: Landmark
      });
    }

    if (can('accounts')) {
      adminItems.push({
        id: 'settings',
        label: 'System Settings & HQ Hub',
        path: '/settings',
        icon: Building2,
        subItems: [
          // Connecting a new branch's till, tablet or office PC to this ERP.
          { label: 'Branch Connections', path: '/settings', state: { tab: 'provisioning' }, icon: Plug },
          { label: 'System Settings', path: '/settings', state: { tab: 'terminal' }, icon: Building2 }
        ]
      });
    }

    if (adminItems.length > 0) {
      sections.push({
        title: 'System & Administration',
        items: adminItems
      });
    }

    return sections;
  }, [isHeadOffice, isMultiBranchChain, terminalMode, can, has, isPlatformSuperAdmin, isRetailBiz, isErpOnly]);

  return (
    <>
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      <aside
        className={`app-sidebar fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-gradient-to-b from-teal-700 to-teal-600 border-r border-teal-800 transition-all duration-300 ${
          isCollapsed ? 'w-18' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-white/10">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-teal-700 font-black shadow-lg shadow-black/10 shrink-0">
              C
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="font-black text-base text-white tracking-tight leading-none">
                  Cashly <span className="text-white font-semibold text-xs px-1.5 py-0.5 rounded bg-white/15 border border-white/20">POS</span>
                </span>
                <span className="text-[10px] text-teal-200 font-bold uppercase tracking-wider mt-0.5">
                  {isOwnerOrUnlocked ? (isMultiBranchChain ? 'Head Office' : 'Owner') : 'Branch'}
                </span>
              </div>
            )}
          </Link>

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-white/10 transition"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-200">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-teal-200 mb-1.5">
                  {section.title}
                </div>
              )}

              {section.items.map(item => {
                const Icon = item.icon;
                const isCurrentPath = location.pathname === item.path;
                const hasSub = !!item.subItems && item.subItems.length > 0;
                const isOpen = openMenu === item.id;

                return (
                  <div key={item.id} className="space-y-1">
                    {hasSub ? (
                      <button
                        onClick={() => toggleMenu(item.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition group ${
                          isCurrentPath
                            ? 'bg-teal-50 text-teal-700 font-bold shadow-sm'
                            : 'text-white/85 hover:bg-white/10 hover:text-white'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-teal-600' : 'text-teal-200 group-hover:text-white'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>

                        {!isCollapsed && (
                          <div className="flex items-center gap-1.5">
                            {item.badge && (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                isCurrentPath ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-white/15 text-white border-white/20'
                              }`}>
                                {item.badge}
                              </span>
                            )}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCurrentPath ? 'text-teal-600' : 'text-teal-200'} ${isOpen ? 'rotate-180' : ''}`} />
                          </div>
                        )}
                      </button>
                    ) : (
                      <Link
                        to={item.path}
                        onClick={onCloseMobile}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-smooth group ${
                          isCurrentPath
                            ? 'bg-teal-50 text-teal-700 font-bold shadow-sm'
                            : 'text-white/85 hover:bg-white/10 hover:text-white'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-teal-600' : 'text-teal-200 group-hover:text-white'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>
                      </Link>
                    )}

                    {hasSub && isOpen && !isCollapsed && (
                      <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-white/15 ml-3.5 mt-1">
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
                                  : 'text-teal-100 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              <SubIcon className={`w-3 h-3 shrink-0 ${isSubActive ? 'text-teal-600' : 'text-teal-300'}`} />
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
          <div className="p-3 border-t border-white/10 bg-black/10 text-[11px]">
            <div className="flex items-center gap-2 text-teal-100">
              {isOwnerOrUnlocked && isMultiBranchChain ? (
                <Building2 className="w-3.5 h-3.5 text-teal-200" />
              ) : (
                <Store className="w-3.5 h-3.5 text-teal-200" />
              )}
              <span className="truncate font-semibold text-white">
                {selectedBranch?.name || selectedTenant?.name || 'Restaurant'}
              </span>
            </div>
            <div className="text-[10px] text-teal-200 mt-0.5">
              {isOwnerOrUnlocked ? (isMultiBranchChain ? 'Head Office & Commissary' : 'Owner Access') : `Branch • ${selectedBranch?.city || ''}`}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

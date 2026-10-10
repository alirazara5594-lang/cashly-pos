import React, { useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Store,
  ChefHat,
  Tablet,
  Bike,
  Boxes,
  FileText,
  Users,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  PieChart,
  Percent,
  Wheat,
  Building2,
  Armchair,
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
  ClipboardList,
  LayoutDashboard,
  ShoppingCart,
  MonitorSmartphone,
  Settings,
  MapPin,
  UserCog,
  Package,
  Megaphone,
  MessageCircle,
  Settings2
} from 'lucide-react';
import { usePosStore, hasModuleAccess, normalizeRole } from '../store/posStore';
import { getDeviceSurface } from '../services/deviceLicense';
import { useBusinessShape } from '../hooks/useBusinessShape';
import { posApi } from '../services/api';
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
  /** Opens one tab of the page (the pages read location.state.tab). */
  state?: { tab: string };
  /** The tab the page opens on when reached with none named. */
  isDefault?: boolean;
  icon?: React.ElementType;
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  /** A page whose section lives in the address ("?tab=billing"); "" is its opening section. */
  search?: string;
  state?: { tab: string };
  isDefault?: boolean;
  icon: React.ElementType;
  badge?: string;
  subItems?: SubMenuItem[];
}

interface NavSection {
  /** Empty for the untitled top entry (Dashboard). */
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

  // The business's shape as the server knows it — a head office registered before its first outlet
  // is still a head office, not a single shop.
  const { severalLocations, atHeadOffice, outlets } = useBusinessShape();
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
  // most screens once two or three groups are expanded, which pushed Settings below the fold
  // and made the menu feel like it had lost items.
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const toggleMenu = (id: string) => {
    setOpenMenu(prev => (prev === id ? null : id));
  };

  // The platform admin's count of parts renewing within 14 days or overdue, on the Renewals link.
  // Re-read as they move around, so recording a payment brings it down.
  const [renewalsDue, setRenewalsDue] = useState(0);
  useEffect(() => {
    if (!isPlatformSuperAdmin) return;
    let cancelled = false;
    posApi.getRenewalsSummary()
      .then(s => { if (!cancelled) setRenewalsDue(s.all.expiring + s.all.overdue); })
      .catch(() => { /* the badge is a convenience; the page has the real list */ });
    return () => { cancelled = true; };
  }, [isPlatformSuperAdmin, location.pathname, location.search]);

  // Ordered the way the business uses it: the overview, selling, what it sells, stock, money,
  // insight, customers, people, and settings last. Who sees what is unchanged — every entry keeps
  // its module permission and plan check; only the grouping and names are new.
  const navSections = useMemo<NavSection[]>(() => {
    // The platform admin has no restaurant of its own, so every restaurant screen would ask the
    // server for "this restaurant", be refused, and sign them out. They get the platform screens
    // only; to look inside a restaurant: Tenant Management → Manage → View as customer (and each
    // restaurant's audit log is a tab there).
    // Each is a section of the one console page, opened through the address.
    if (isPlatformSuperAdmin) {
      // Prices, settings and the team are a platform owner's; everyone else still reads the rest.
      const platformOwner = !currentUser?.platformRole || currentUser.platformRole === 'Owner';
      return [
        {
          title: '',
          items: [{ id: 'platformDashboard', label: 'Dashboard', path: '/super-admin', search: '', icon: LayoutDashboard }]
        },
        {
          title: 'Customers',
          items: [
            { id: 'tenants', label: 'Businesses', path: '/super-admin', search: '?tab=tenants', icon: Building2 },
            // ERP, each outlet's POS and each extra tablet, each renewing on its own date.
            {
              id: 'renewals', label: 'Renewals', path: '/super-admin', search: '?tab=renewals', icon: CalendarClock,
              badge: renewalsDue > 0 ? String(renewalsDue) : undefined
            }
          ]
        },
        {
          title: 'Money',
          items: [
            { id: 'billing', label: 'Billing', path: '/super-admin', search: '?tab=billing', icon: Receipt },
            { id: 'revenue', label: 'Revenue', path: '/super-admin', search: '?tab=revenue', icon: TrendingUp }
          ]
        },
        {
          title: 'Plans',
          items: [
            { id: 'packages', label: 'Packages & Pricing', path: '/super-admin', search: '?tab=packages', icon: CreditCard },
            { id: 'addons', label: 'Add-ons', path: '/super-admin', search: '?tab=addons', icon: Puzzle }
          ]
        },
        {
          title: 'Messages',
          items: [
            { id: 'messageLog', label: 'Message Log', path: '/super-admin', search: '?tab=messages', icon: MessageSquare },
            { id: 'announcements', label: 'Announcements', path: '/super-admin', search: '?tab=announcements', icon: Megaphone },
            { id: 'whatsappLogs', label: 'Customer WhatsApp', path: '/super-admin', search: '?tab=whatsapp', icon: MessageCircle }
          ]
        },
        {
          title: 'Platform',
          items: [
            ...(platformOwner ? [{ id: 'team', label: 'Team', path: '/super-admin', search: '?tab=team', icon: UserCog }] : []),
            { id: 'activity', label: 'Activity Log', path: '/super-admin', search: '?tab=activity', icon: History },
            ...(platformOwner ? [{ id: 'platformSettings', label: 'Settings', path: '/super-admin', search: '?tab=settings', icon: Settings2 }] : [])
          ]
        }
      ];
    }

    const sections: NavSection[] = [];

    // ── The owner's overview comes first, the page professional back offices open on.
    if (can('reports') && has('hasDirectorDashboard')) {
      sections.push({
        title: '',
        items: [{ id: 'director', label: 'Dashboard', path: '/director', icon: LayoutDashboard }]
      });
    }

    // ── SELL. Operational screens: visible to ANY signed-in user. These are not module
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
        title: 'Kitchen',
        items: [{ id: 'pos', label: 'Kitchen Display', path: '/kitchen', icon: ChefHat }]
      });
    } else if (terminalMode === 'WaiterTab') {
      sections.push({
        title: 'Service',
        items: [
          { id: 'pos', label: 'Waiter Tablet', path: '/order-tab', icon: Tablet },
          ...(has('hasDeliveryCOD') ? [{ id: 'delivery', label: 'Delivery & COD', path: '/delivery', icon: Bike }] : [])
        ]
      });
    } else {
      sections.push({
        title: 'Sell',
        items: [{
          id: 'pos',
          label: isRetailBiz ? 'POS & Sales' : 'POS & Orders',
          path: '/',
          icon: Store,
          subItems: [
            { label: 'Register', path: '/', icon: Store },
            // Tabs and QR orders are taken now and paid later; the cashier collects them here.
            { label: 'Open Orders', path: '/open-orders', icon: ClipboardList },
            { label: 'Returns & Refunds', path: '/returns', icon: RotateCcw },
            ...(isRetailBiz || !has('hasKitchenDisplay') ? [] : [{ label: 'Kitchen Display', path: '/kitchen', icon: ChefHat }]),
            ...(isRetailBiz ? [] : [{ label: 'Waiter Tablet', path: '/order-tab', icon: Tablet }]),
            ...(has('hasDeliveryCOD') ? [{ label: 'Delivery & COD', path: '/delivery', icon: Bike }] : [])
          ]
        }]
      });
    }

    // ── MENU (Products for retail) → `menu` module
    if (can('menu')) {
      sections.push({
        title: isRetailBiz ? 'Products' : 'Menu',
        items: [
          { id: 'menu', label: isRetailBiz ? 'Product Catalog' : 'Menu & Recipes', path: '/menu', icon: BookOpen },
          ...(isRetailBiz ? [] : [{ id: 'floors', label: 'Floors & Tables', path: '/floors', icon: Armchair }])
        ]
      });
    }

    // ── INVENTORY & PURCHASING. Stock → `inventory`; transfers and purchase orders → `supplychain`.
    const stockItems: NavItem[] = [];
    if (can('inventory') && has('hasInventoryManagement')) {
      stockItems.push({
        id: 'inventory',
        label: 'Stock',
        path: '/inventory',
        icon: Boxes,
        subItems: [
          { label: 'Ingredients & Recipes', path: '/inventory', state: { tab: 'ingredients' }, isDefault: true, icon: Wheat },
          { label: 'Finished Stock', path: '/inventory', state: { tab: 'finished' }, icon: Package }
        ]
      });
      // Outlets ask for stock here; head office is where those requests arrive and are answered.
      stockItems.push({ id: 'stockRequests', label: isErpOnly ? 'Outlet Requests' : 'Stock Requests', path: '/stock-requests', icon: Send });
    }
    if (can('supplychain')) {
      // One page with two tabs; it opens on transfers when there is somewhere to transfer to, and
      // on purchasing for a single shop.
      if (has('hasStockTransfers') && severalLocations) {
        stockItems.push({ id: 'transfers', label: 'Transfers', path: '/transfers', state: { tab: 'transfers' }, isDefault: true, icon: ArrowRightLeft });
      }
      if (has('purchasing')) {
        stockItems.push({ id: 'purchasing', label: 'Purchase Orders', path: '/transfers', state: { tab: 'procurement' }, isDefault: !severalLocations, icon: ShoppingCart });
      }
    }
    if (stockItems.length > 0) {
      sections.push({
        title: stockItems.some(i => i.id === 'purchasing') ? 'Inventory & Purchasing' : 'Inventory',
        items: stockItems
      });
    }

    // ── FINANCE. The books → `accounts`; the sales reports → `reports`.
    const financeItems: NavItem[] = [];
    if (can('accounts') && has('accounting')) {
      financeItems.push({ id: 'accounting', label: 'Accounting', path: '/accounting', icon: Landmark });
    }
    if (can('reports')) {
      financeItems.push({
        id: 'reports',
        label: 'Sales Reports',
        path: '/reports',
        icon: FileText,
        subItems: [
          { label: 'Z-Report (End of Day)', path: '/reports', state: { tab: 'zreport' }, isDefault: true, icon: Receipt },
          { label: 'Cash Sales', path: '/reports', state: { tab: 'cashSales' }, icon: Banknote },
          { label: 'Card & Digital Sales', path: '/reports', state: { tab: 'cardSales' }, icon: CreditCard },
          // The drawer is counted at an outlet's till; head office reads the closings in the Z-Report.
          ...(isErpOnly ? [] : [{ label: 'Cash Tally & Closing', path: '/reports', state: { tab: 'cashTally' }, icon: Wallet }]),
          { label: 'Tax & Compliance', path: '/reports', state: { tab: 'tax' }, icon: Percent },
          { label: 'Categories & Channels', path: '/reports', state: { tab: 'categories' }, icon: PieChart },
          { label: 'Product Profit & COGS', path: '/reports', state: { tab: 'products' }, icon: TrendingUp },
          { label: 'Payment Mix', path: '/reports', state: { tab: 'payments' }, icon: Wallet },
          ...(severalLocations ? [{ label: 'Branch Comparison', path: '/reports', state: { tab: 'multibranch' }, icon: Building2 }] : [])
        ]
      });
    }
    if (can('accounts')) {
      financeItems.push({ id: 'tax', label: 'Tax Setup', path: '/tax-configuration', icon: Percent });
    }
    if (financeItems.length > 0) sections.push({ title: 'Finance', items: financeItems });

    // ── INSIGHTS → `reports`
    if (can('reports')) {
      sections.push({
        title: 'Insights',
        items: [
          { id: 'analytics', label: 'Smart Analytics', path: '/analytics', icon: Brain },
          { id: 'menuEngineering', label: 'Menu Engineering', path: '/menu-engineering', icon: TrendingUp }
        ]
      });
    }

    // ── CUSTOMERS & MARKETING. Customer lookup is part of taking an order, so it stays visible
    // to everyone; the money-rules screens are `admin` only.
    const customerItems: NavItem[] = [{ id: 'customers', label: 'Customers', path: '/customers', icon: Users }];
    if (can('admin') && has('loyalty')) {
      customerItems.push({ id: 'loyalty', label: 'Loyalty & Gift Cards', path: '/loyalty', icon: Gift });
      customerItems.push({ id: 'promoCodes', label: 'Promo Codes', path: '/promo-codes', icon: Percent });
    }
    sections.push({ title: customerItems.length > 1 ? 'Customers & Marketing' : 'Customers', items: customerItems });

    // ── PEOPLE. Staff accounts → `users`; shifts and the time clock → `labor`.
    const peopleItems: NavItem[] = [];
    if (can('users')) {
      peopleItems.push({ id: 'staff', label: 'Staff & PINs', path: '/users', icon: UserCog });
    }
    if (can('labor') && has('labor')) {
      peopleItems.push({
        id: 'labor',
        label: 'Shifts & Time Clock',
        path: '/labor',
        icon: CalendarClock,
        subItems: [
          { label: 'Shift Schedule', path: '/labor', state: { tab: 'schedule' }, isDefault: true, icon: CalendarClock },
          { label: 'Time Clock & Timesheet', path: '/labor', state: { tab: 'timeclock' }, icon: Clock }
        ]
      });
    }
    if (can('users', 'edit')) {
      peopleItems.push({ id: 'permissions', label: 'Permissions', path: '/permissions', icon: Shield });
    }
    if (peopleItems.length > 0) sections.push({ title: 'People', items: peopleItems });

    // ── SETTINGS. The business's own set-up → `admin`; this system and its devices → `accounts`.
    const settingsItems: NavItem[] = [];
    if (can('admin')) {
      settingsItems.push({ id: 'locations', label: 'Locations', path: '/locations', icon: MapPin });
    }
    if (can('accounts')) {
      // Connecting a new branch's till, tablet or office PC to this ERP.
      settingsItems.push({ id: 'devices', label: 'Devices & Connections', path: '/settings', state: { tab: 'provisioning' }, icon: MonitorSmartphone });
    }
    if (can('admin')) {
      settingsItems.push({
        id: 'integrations',
        label: 'Integrations',
        path: '/whatsapp-config',
        icon: Plug,
        subItems: [
          { label: 'WhatsApp', path: '/whatsapp-config', icon: MessageSquare },
          { label: 'Payment Gateways', path: '/payment-settings', icon: CreditCard },
          { label: 'Delivery Apps', path: '/delivery-integrations', icon: Bike }
        ]
      });
      settingsItems.push({ id: 'addons', label: 'Plan & Add-ons', path: '/my-addons', icon: Puzzle });
      settingsItems.push({ id: 'auditLog', label: 'Audit Log', path: '/audit-log', icon: History });
    }
    // This PC's till role. Head office has no till; its other settings sit with Devices & Connections.
    if (can('accounts') && !isErpOnly) {
      settingsItems.push({ id: 'settings', label: 'System Settings', path: '/settings', state: { tab: 'terminal' }, isDefault: true, icon: Settings });
    }
    if (settingsItems.length > 0) sections.push({ title: 'Settings', items: settingsItems });

    return sections;
  }, [severalLocations, terminalMode, can, has, isPlatformSuperAdmin, isRetailBiz, isErpOnly, renewalsDue, currentUser?.platformRole]);

  // Several entries open different tabs of one page (Transfers / Purchase Orders, the reports),
  // so "you are here" is the page AND its tab — or the page's opening tab when none was named.
  const currentTab = (location.state as { tab?: string } | null)?.tab;
  const isHere = (link: { path: string; search?: string; state?: { tab: string }; isDefault?: boolean }) => {
    if (location.pathname !== link.path) return false;
    // A section named in the address: the same ?tab (none for the opening section).
    if (link.search !== undefined)
      return new URLSearchParams(location.search).get('tab') === new URLSearchParams(link.search).get('tab');
    const tab = link.state?.tab;
    if (!tab) return true;
    if (currentTab) return currentTab === tab;
    return location.search.includes(tab) || !!link.isDefault;
  };
  const groupOf = (pathname: string) =>
    navSections.flatMap(s => s.items).find(i => i.subItems?.some(sub => sub.path === pathname))?.id ?? null;

  // Arriving on a page that lives in a group opens that group, so the current page is always in
  // view. Adjusted while rendering (React's pattern for state that follows a prop), once per page.
  const [openedForPath, setOpenedForPath] = useState<string | null>(null);
  if (openedForPath !== location.pathname) {
    setOpenedForPath(location.pathname);
    const group = groupOf(location.pathname);
    if (group) setOpenMenu(group);
  }

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
                  {/* The head office runs the ERP; every outlet runs the POS. */}
                  Cashly <span className="text-white font-semibold text-xs px-1.5 py-0.5 rounded bg-white/15 border border-white/20">{isPlatformSuperAdmin ? 'Admin' : isErpOnly ? 'ERP' : 'POS'}</span>
                </span>
                <span className="text-[10px] text-teal-200 font-bold uppercase tracking-wider mt-0.5">
                  {isPlatformSuperAdmin ? 'Platform' : atHeadOffice ? 'Head Office' : isOwnerOrUnlocked ? 'Owner' : 'Branch'}
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

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin scrollbar-thumb-slate-200">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {!isCollapsed && section.title && (
                <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-teal-200 mb-1.5">
                  {section.title}
                </div>
              )}

              {section.items.map(item => {
                const Icon = item.icon;
                const hasSub = !!item.subItems && item.subItems.length > 0;
                const isOpen = openMenu === item.id;
                // A group is "current" when one of its pages is open: lit softly, so the white
                // pill stays on the exact page.
                const groupActive = hasSub && item.subItems!.some(sub => sub.path === location.pathname);
                const leafActive = !hasSub && isHere(item);

                return (
                  <div key={item.id} className="space-y-1">
                    {hasSub && !isCollapsed ? (
                      <button
                        onClick={() => toggleMenu(item.id)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition group ${
                          groupActive
                            ? 'bg-white/10 text-white font-bold'
                            : 'text-white/85 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${groupActive ? 'text-white' : 'text-teal-200 group-hover:text-white'}`} />
                          <span className="truncate">{item.label}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {item.badge && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-white/15 text-white border-white/20">
                              {item.badge}
                            </span>
                          )}
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform text-teal-200 ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>
                    ) : (
                      // A plain page, or a group while the sidebar is collapsed (its pages cannot
                      // unfold there, so the icon opens the group's first page).
                      <Link
                        to={hasSub ? item.subItems![0].path : item.search !== undefined ? { pathname: item.path, search: item.search } : item.path}
                        state={hasSub ? item.subItems![0].state : item.state}
                        onClick={onCloseMobile}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-smooth group ${
                          leafActive
                            ? 'bg-teal-50 text-teal-700 font-bold shadow-sm'
                            : groupActive
                            ? 'bg-white/10 text-white'
                            : 'text-white/85 hover:bg-white/10 hover:text-white'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${leafActive ? 'text-teal-600' : groupActive ? 'text-white' : 'text-teal-200 group-hover:text-white'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>
                        {/* A count that needs attention, e.g. renewals due. */}
                        {!isCollapsed && item.badge && (
                          <span className="min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black text-center shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    )}

                    {hasSub && isOpen && !isCollapsed && (
                      <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-white/15 ml-3.5 mt-1">
                        {item.subItems!.map((sub, subIdx) => {
                          const SubIcon = sub.icon || ChevronRight;
                          const isSubActive = isHere(sub);

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

        {/* The platform admin works across every business, not inside one. */}
        {!isCollapsed && isPlatformSuperAdmin && (
          <div className="p-3 border-t border-white/10 bg-black/10 text-[11px]">
            <div className="flex items-center gap-2 text-teal-100">
              <Building2 className="w-3.5 h-3.5 text-teal-200" />
              <span className="truncate font-semibold text-white">Cashly platform</span>
            </div>
            <div className="text-[10px] text-teal-200 mt-0.5">Every business on Cashly</div>
          </div>
        )}
        {!isCollapsed && !isPlatformSuperAdmin && (
          <div className="p-3 border-t border-white/10 bg-black/10 text-[11px]">
            <div className="flex items-center gap-2 text-teal-100">
              {atHeadOffice ? (
                <Building2 className="w-3.5 h-3.5 text-teal-200" />
              ) : (
                <Store className="w-3.5 h-3.5 text-teal-200" />
              )}
              <span className="truncate font-semibold text-white">
                {selectedBranch?.name || selectedTenant?.name || 'Restaurant'}
              </span>
            </div>
            <div className="text-[10px] text-teal-200 mt-0.5">
              {atHeadOffice
                ? `Head office · ${outlets.length === 0 ? 'no outlets yet' : `${outlets.length} outlet${outlets.length === 1 ? '' : 's'}`}`
                : isOwnerOrUnlocked ? 'Owner access' : `Branch${selectedBranch?.city ? ` · ${selectedBranch.city}` : ''}`}
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

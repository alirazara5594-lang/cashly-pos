import React, { useState } from 'react';
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
  TrendingUp
} from 'lucide-react';
import { usePosStore } from '../store/posStore';

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

interface NavSection {
  title: string;
  items: {
    id: string;
    label: string;
    path: string;
    icon: React.ElementType;
    badge?: string;
    subItems?: SubMenuItem[];
  }[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile
}) => {
  const location = useLocation();
  const { selectedTenant } = usePosStore();
  const isMultiBranchChain = (selectedTenant?.branches?.length || 0) > 1;

  // Manage open state of expandable menus
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    pos: true,
    inventory: true,
    supplyChain: true,
    reports: false,
    management: false
  });

  const toggleMenu = (id: string) => {
    setOpenMenus(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const navSections: NavSection[] = [
    {
      title: 'Operations & Dining',
      items: [
        {
          id: 'pos',
          label: 'POS & Orders',
          path: '/',
          icon: Store,
          subItems: [
            { label: 'POS Terminal (Register)', path: '/', icon: Store },
            { label: 'Floor & Table Setup', path: '/floors', icon: Armchair },
            { label: 'Kitchen Display (KDS)', path: '/kitchen', icon: ChefHat },
            { label: 'Tablet Waiter App', path: '/order-tab', icon: Tablet },
            { label: 'Delivery & COD Board', path: '/delivery', icon: Bike }
          ]
        }
      ]
    },
    {
      title: 'Inventory & Logistics',
      items: [
        {
          id: 'inventory',
          label: 'Stock Management',
          path: '/inventory',
          icon: Boxes,
          subItems: [
            { label: 'Raw Ingredients & BOM', path: '/inventory', state: { tab: 'ingredients' }, icon: Wheat },
            { label: 'Finished Food Stock', path: '/inventory', state: { tab: 'finished' }, icon: Boxes }
          ]
        },
        {
          id: 'supplyChain',
          label: isMultiBranchChain ? 'Supply Chain' : 'Procurement',
          path: '/transfers',
          icon: Truck,
          badge: isMultiBranchChain ? 'Commissary' : 'PO',
          subItems: isMultiBranchChain
            ? [
                { label: 'Commissary Transfers', path: '/transfers', state: { tab: 'transfers' }, icon: ArrowRightLeft },
                { label: 'Vendor Procurement (PO)', path: '/transfers', state: { tab: 'procurement' }, icon: ShoppingBag }
              ]
            : [
                { label: 'Vendor Procurement (PO)', path: '/transfers', state: { tab: 'procurement' }, icon: ShoppingBag }
              ]
        }
      ]
    },
    {
      title: 'Reporting & Analytics',
      items: [
        {
          id: 'reports',
          label: 'Financial Reports',
          path: '/reports',
          icon: FileText,
          subItems: [
            { label: 'Daily End-of-Day Z-Report', path: '/reports', state: { tab: 'zreport' }, icon: Receipt },
            { label: 'Tax Audit & FBR Register', path: '/reports', state: { tab: 'tax' }, icon: Percent },
            { label: 'Category Turnover & Channels', path: '/reports', state: { tab: 'categories' }, icon: PieChart },
            { label: 'Menu Profitability & COGS', path: '/reports', state: { tab: 'products' }, icon: TrendingUp },
            { label: 'Payment Tender Mix', path: '/reports', state: { tab: 'payments' }, icon: CreditCard },
            ...(isMultiBranchChain ? [
              { label: 'Multi-Branch Consolidation', path: '/reports', state: { tab: 'multibranch' }, icon: Building2 }
            ] : [])
          ]
        },
        {
          id: 'director',
          label: 'Executive Dashboard',
          path: '/director',
          icon: BarChart3
        }
      ]
    },
    {
      title: 'Store Administration',
      items: [
        {
          id: 'management',
          label: 'Menu & Settings',
          path: '/menu',
          icon: BookOpen,
          subItems: [
            { label: 'Menu Catalog & Recipes', path: '/menu', icon: BookOpen },
            { label: 'Floor & Table Setup', path: '/floors', icon: Armchair },
            { label: 'Tax Settings (16% / 8%)', path: '/menu', icon: Percent },
            { label: 'Staff & Pin Access', path: '/users', icon: Users },
            { label: 'Super Admin Quotas', path: '/super-admin', icon: ShieldCheck }
          ]
        }
      ]
    }
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-40 lg:hidden"
        />
      )}

      {/* Sidebar Container - Stays dark slate in both light and dark modes */}
      <aside
        className={`app-sidebar fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-300 ${
          isCollapsed ? 'w-18' : 'w-64'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-800 bg-slate-950/40">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-emerald-500/20 shrink-0">
              C
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="font-black text-base text-white tracking-tight leading-none">
                  Cashly <span className="text-emerald-400 font-semibold text-xs px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60">POS</span>
                </span>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">Enterprise Restaurant</span>
              </div>
            )}
          </Link>

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
          {navSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
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
                            ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/30'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-emerald-400' : 'text-slate-400 group-hover:text-white'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>

                        {!isCollapsed && (
                          <div className="flex items-center gap-1.5">
                            {item.badge && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                                {item.badge}
                              </span>
                            )}
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-white' : ''}`} />
                          </div>
                        )}
                      </button>
                    ) : (
                      <Link
                        to={item.path}
                        onClick={onCloseMobile}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition group ${
                          isCurrentPath
                            ? 'bg-emerald-600 text-slate-950 font-black shadow-md shadow-emerald-600/30'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                        title={isCollapsed ? item.label : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${isCurrentPath ? 'text-slate-950' : 'text-slate-400 group-hover:text-white'}`} />
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </div>
                      </Link>
                    )}

                    {/* Submenu Dropdown Items */}
                    {hasSub && isOpen && !isCollapsed && (
                      <div className="pl-6 pr-1 py-1 space-y-1 border-l-2 border-slate-800 ml-3.5 mt-1">
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
                                  ? 'bg-slate-800 text-emerald-400 font-bold'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                              }`}
                            >
                              <SubIcon className="w-3 h-3 text-slate-500 shrink-0" />
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

        {/* Sidebar Footer info */}
        {!isCollapsed && (
          <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px]">
            <div className="flex items-center gap-2 text-slate-400">
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="truncate font-semibold text-slate-300">
                {selectedTenant?.name || 'Restaurant HQ'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Dynamics &amp; Simphony POS Architecture
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

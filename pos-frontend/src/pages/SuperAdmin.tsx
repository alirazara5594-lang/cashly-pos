import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Plus, 
  Minus, 
  Save, 
  Check, 
  Store, 
  Monitor, 
  Tablet
} from 'lucide-react';
import { posApi } from '../services/api';
import { usePosStore } from '../store/posStore';
import type { SubscriptionTier } from '../types';

export const SuperAdmin: React.FC = () => {
  const { selectedTenant, selectedBranch, setTenants } = usePosStore();
  const [activeTier, setActiveTier] = useState<SubscriptionTier>('Professional');

  const [counters, setCounters] = useState<number>(5);
  const [orderTabs, setOrderTabs] = useState<number>(15);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Add-on toggles
  const [addOns, setAddOns] = useState({
    kdsMode1: true,
    codDelivery: true,
    callCenterOrders: true,
    directorApp: true,
    centralWarehouse: true,
    fbrTax: false,
    whatsAppReceipts: true
  });

  useEffect(() => {
    if (selectedTenant) {
      setActiveTier(selectedTenant.tier);
    }
    if (selectedBranch) {
      setCounters(selectedBranch.allowedCounters);
      setOrderTabs(selectedBranch.allowedOrderTabs);
    }
  }, [selectedTenant, selectedBranch]);

  const handleTierChange = (tier: SubscriptionTier) => {
    setActiveTier(tier);
    if (tier === 'Starter') {
      setCounters(1);
      setOrderTabs(2);
    } else if (tier === 'Standard') {
      setCounters(3);
      setOrderTabs(6);
    } else {
      setCounters(5);
      setOrderTabs(15);
    }
  };

  const handleSaveLimits = async () => {
    if (!selectedBranch?.id) return;
    setIsSaving(true);
    try {
      await posApi.updateBranchLimits({
        branchId: selectedBranch.id,
        allowedCounters: counters,
        allowedOrderTabs: orderTabs,
        tier: activeTier
      });
      // Refresh tenants
      const updatedTenants = await posApi.getTenants();
      setTenants(updatedTenants);

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to save limits');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-53px)] overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6 space-y-6">
      {/* Super Admin Master Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <span>SaaS Super Admin Control Panel</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                MASTER LICENSE
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Control packages, add-on counter quotas, order tablets, and bill clients in PKR
            </p>
          </div>
        </div>

        <button
          onClick={handleSaveLimits}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
        >
          {isSaving ? (
            <span>Saving Quotas...</span>
          ) : isSaved ? (
            <>
              <Check className="w-4 h-4" />
              <span>Quotas & Limits Updated!</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save & Update Client License</span>
            </>
          )}
        </button>
      </div>

      {/* Target Tenant & Branch Card */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 font-bold">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-semibold uppercase">Active Client Being Managed:</div>
            <div className="font-black text-base text-white">
              {selectedTenant?.name} — {selectedBranch?.name}
            </div>
            <div className="text-[11px] text-slate-400">
              City: {selectedBranch?.city} • Code: {selectedBranch?.code}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-400">Current Assigned Tier:</div>
          <div className="text-sm font-black text-purple-400 uppercase">{activeTier}</div>
        </div>
      </div>

      {/* Tier Switcher (Starter / Standard / Professional) */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider">
            1. Assign Subscription Package
          </h2>
          <p className="text-xs text-slate-400">
            Selecting a package sets the default base counters and tablets for each branch
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              id: 'Starter' as SubscriptionTier,
              name: 'Starter Plan',
              desc: 'Single branch, 1 Counter included, 2 Order Tabs included.',
              baseCounters: 1,
              baseTabs: 2,
              price: '₨15,000 / mo'
            },
            {
              id: 'Standard' as SubscriptionTier,
              name: 'Standard Plan',
              desc: 'Up to 3 Branches, 3 Counters/branch included, 6 Tabs included.',
              baseCounters: 3,
              baseTabs: 6,
              price: '₨35,000 / mo'
            },
            {
              id: 'Professional' as SubscriptionTier,
              name: 'Professional Plan',
              desc: 'Unlimited Branches + Head Office, 5 Counters/branch, 15 Tabs included.',
              baseCounters: 5,
              baseTabs: 15,
              price: '₨75,000 / mo'
            },
          ].map((tier) => (
            <div
              key={tier.id}
              onClick={() => handleTierChange(tier.id)}
              className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between space-y-3 ${
                activeTier === tier.id
                  ? 'bg-purple-950/40 border-purple-500 shadow-lg shadow-purple-500/10'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="font-bold text-sm text-white">{tier.name}</span>
                {activeTier === tier.id && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[10px] font-bold">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{tier.desc}</p>
              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-400 font-mono">{tier.baseCounters} Counters • {tier.baseTabs} Tabs</span>
                <span className="font-black text-emerald-400">{tier.price}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add-on Counters & Tabs Quota Modifier */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider">
            2. Sell Extra Counters & Order Tabs (Add-On Monetization)
          </h2>
          <p className="text-xs text-slate-400">
            Increase active device limits for this client. Every extra counter or tab can be billed individually!
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Counters Stepper */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <Monitor className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-white">Billing Counters (Terminals)</div>
                <div className="text-xs text-slate-400">Add-on price: ₨1,500 / month each</div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setCounters(Math.max(1, counters - 1))}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="font-black text-lg text-cyan-400 min-w-[24px] text-center font-mono">
                {counters}
              </span>
              <button
                onClick={() => setCounters(counters + 1)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Order Tabs Stepper */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <Tablet className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-white">Order Tabs (Waiter Tablets)</div>
                <div className="text-xs text-slate-400">Add-on price: ₨500 / month each</div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setOrderTabs(Math.max(1, orderTabs - 1))}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="font-black text-lg text-purple-400 min-w-[24px] text-center font-mono">
                {orderTabs}
              </span>
              <button
                onClick={() => setOrderTabs(orderTabs + 1)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Add-On Toggles */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
        <h2 className="text-sm font-black text-white uppercase tracking-wider">
          3. Modular Feature Toggles (Sell & Activate)
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { key: 'kdsMode1', label: 'Mode 1 Kitchen Dispatch (KDS)', desc: 'Parallel live kitchen & counter sync' },
            { key: 'codDelivery', label: 'Delivery & COD Settlement', desc: 'Rider cash reconciliation & 4-stage board' },
            { key: 'callCenterOrders', label: 'Phone Call Order Intake', desc: 'Customer phone lookup & address history' },
            { key: 'directorApp', label: 'Director Mobile App License', desc: 'Live sales & cash drawer audit on phone' },
            { key: 'centralWarehouse', label: 'Central Warehouse Transfers', desc: 'Inter-branch stock dispatch & requests' },
            { key: 'fbrTax', label: 'FBR Digital Tax Integration', desc: 'Tier-1 POS fiscal invoice integration' },
            { key: 'whatsAppReceipts', label: 'WhatsApp Digital Invoices', desc: 'Paperless digital receipts via WhatsApp' },
          ].map(({ key, label, desc }) => {
            const isEnabled = (addOns as any)[key];
            return (
              <div
                key={key}
                onClick={() => setAddOns({ ...addOns, [key]: !isEnabled })}
                className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between gap-3 ${
                  isEnabled
                    ? 'bg-emerald-950/30 border-emerald-800/80 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-500'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-white">{label}</div>
                  <div className="text-[10px] text-slate-400">{desc}</div>
                </div>
                <div>
                  {isEnabled ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-slate-950 font-bold text-[10px] uppercase">
                      ON
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-bold text-[10px] uppercase">
                      OFF
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

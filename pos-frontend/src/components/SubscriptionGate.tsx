import React, { createContext, useContext, useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Lock } from 'lucide-react';
import { posApi } from '../services/api';

interface SubscriptionData {
  tier: string;
  features: string[];
  isActive: boolean;
  isTrial: boolean;
  paidUntil: string | null;
  trialEndsAt: string | null;
  maxBranches: number;
  maxCounters: number;
  maxTabs: number;
  maxUsers: number;
  whatsappMessagesPerMonth: number;
}

interface SubscriptionContextValue {
  features: string[];
  tier: string;
  isActive: boolean;
  isTrial: boolean;
  paidUntil: string | null;
  trialEndsAt: string | null;
  maxBranches: number;
  maxCounters: number;
  maxTabs: number;
  maxUsers: number;
  whatsappMessagesPerMonth: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  features: [],
  tier: '',
  isActive: false,
  isTrial: false,
  paidUntil: null,
  trialEndsAt: null,
  maxBranches: 1,
  maxCounters: 1,
  maxTabs: 1,
  maxUsers: 1,
  whatsappMessagesPerMonth: 0,
  loading: true,
  refresh: async () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

export const SubscriptionGate: React.FC<{
  feature?: string;
  children: React.ReactNode;
}> = ({ feature, children }) => {
  const { features, tier, isActive, isTrial, paidUntil, loading, refresh } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-400">Checking subscription...</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const isExpired = !isActive && !isTrial && (!paidUntil || new Date(paidUntil) < now);

  if (isExpired) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md p-8 rounded-2xl bg-slate-900 border border-red-800">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-black text-white mb-2">Subscription Expired</h2>
          <p className="text-xs text-slate-400 mb-4">
            Your <span className="text-blue-400 font-bold">{tier}</span> subscription has expired.
            Please renew to continue using the platform.
          </p>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 mb-4">
            <p>Contact your platform administrator to renew your subscription.</p>
            {paidUntil && (
              <p className="text-slate-500 mt-1">Expired on: {new Date(paidUntil).toLocaleDateString()}</p>
            )}
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition mx-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Check Again
          </button>
        </div>
      </div>
    );
  }

  if (feature && !features.includes(feature)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md p-8 rounded-2xl bg-slate-900 border border-amber-800">
          <Lock className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-lg font-black text-white mb-2">Upgrade Required</h2>
          <p className="text-xs text-slate-400 mb-2">
            The <span className="text-amber-400 font-bold">{feature.replace(/_/g, ' ')}</span> feature is not available in your current plan.
          </p>
          <p className="text-xs text-slate-500 mb-4">
            You are on the <span className="text-blue-400 font-bold">{tier}</span> tier.
            Upgrade to access this feature.
          </p>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition mx-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Check Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [data, setData] = useState<SubscriptionData>({
    tier: '',
    features: [],
    isActive: false,
    isTrial: false,
    paidUntil: null,
    trialEndsAt: null,
    maxBranches: 1,
    maxCounters: 1,
    maxTabs: 1,
    maxUsers: 1,
    whatsappMessagesPerMonth: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchSubscription = async () => {
    setLoading(true);
    try {
      const pkg = await posApi.getMyPackage();
      if (pkg) {
        const now = new Date();
        const isActive = pkg.isActive !== false;
        const isTrial = pkg.isTrialActive === true && pkg.trialEndsAt && new Date(pkg.trialEndsAt) > now;
        setData({
          tier: pkg.tier || pkg.name || '',
          features: pkg.features || [],
          isActive,
          isTrial,
          paidUntil: pkg.paidUntil || pkg.subscriptionPaidUntil || null,
          trialEndsAt: pkg.trialEndsAt || null,
          maxBranches: pkg.maxBranches ?? 1,
          maxCounters: pkg.maxCounters ?? 1,
          maxTabs: pkg.maxTabs ?? 1,
          maxUsers: pkg.maxUsers ?? 1,
          whatsappMessagesPerMonth: pkg.whatsappMessagesPerMonth ?? 0,
        });
      }
    } catch {
      setData(prev => ({
        ...prev,
        tier: 'Starter',
        isActive: true,
        features: ['pos', 'kitchen_display', 'delivery_board', 'inventory', 'supply_chain', 'reports', 'multi_branch', 'staff_management', 'dining_tables'],
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubscription(); }, []);

  return (
    <SubscriptionContext.Provider value={{ ...data, loading, refresh: fetchSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
};

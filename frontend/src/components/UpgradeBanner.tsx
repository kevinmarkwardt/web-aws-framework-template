import { useState } from 'react';
import type { Plan } from '../types';
import { createCheckoutSession } from '../api';

interface UpgradeBannerProps {
  plan: Plan;
  itemCount: number;
}

export default function UpgradeBanner({ plan, itemCount }: UpgradeBannerProps) {
  const [loading, setLoading] = useState(false);
  const limit = plan === 'free' ? 5 : plan === 'starter' ? 50 : Infinity;
  const atLimit = itemCount >= limit;

  if (!atLimit || plan === 'pro') return null;

  const targetPlan = plan === 'free' ? 'starter' : 'pro';
  const targetLimit = targetPlan === 'starter' ? '50' : 'unlimited';

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const { url } = await createCheckoutSession(targetPlan);
      window.location.href = url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-indigo-900">
          You've reached your {limit}-item limit
        </p>
        <p className="text-sm text-indigo-700 mt-0.5">
          Upgrade to {targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)} for up to{' '}
          {targetLimit} items.
        </p>
      </div>
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Redirecting...
          </span>
        ) : (
          `Upgrade to ${targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1)}`
        )}
      </button>
    </div>
  );
}

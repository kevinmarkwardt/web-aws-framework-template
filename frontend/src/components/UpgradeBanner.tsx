import { useState } from 'react';
import type { User } from '../types';
import { createCheckoutSession } from '../api';
import { atLimit, itemsLabel } from '../plans';

interface UpgradeBannerProps {
  user: User;
  /** The live count on the page (the account's itemCount is only as fresh as the last account load). */
  itemCount?: number;
}

/** Shown once a free or starter user reaches their plan's item limit (limits come from GET /api/account). */
export default function UpgradeBanner({ user, itemCount = user.itemCount }: UpgradeBannerProps) {
  const [loading, setLoading] = useState(false);
  if (user.plan === 'pro' || !atLimit(itemCount, user.itemLimit)) return null;

  const targetPlan = user.plan === 'free' ? 'starter' : 'pro';
  const targetName = targetPlan.charAt(0).toUpperCase() + targetPlan.slice(1);
  const targetLimit = user.planLimits?.[targetPlan] ?? null;

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
          You've reached your plan's limit of {itemsLabel(user.itemLimit).toLowerCase()}
        </p>
        <p className="text-sm text-indigo-700 mt-0.5">
          Upgrade to {targetName} for {targetLimit === null ? 'unlimited items' : `up to ${itemsLabel(targetLimit)}`}.
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
          `Upgrade to ${targetName}`
        )}
      </button>
    </div>
  );
}

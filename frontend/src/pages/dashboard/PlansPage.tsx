import { useContext, useState } from 'react';
import { AuthContext } from '../../auth-context';
import { cancelPlan, changePlan, createCheckoutSession, createPortalSession } from '../../api';
import { shortDate, usePublicConfig } from '../../billing';
import { itemsLabel } from '../../plans';
import type { Plan } from '../../types';

// Plans, prices and limits come from the API (GET /api/public-config, api/lib/config.py PAID_PLANS + planLimits).

export default function PlansPage() {
  const { user, refresh } = useContext(AuthContext);
  const config = usePublicConfig();
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');

  const plans = config?.plans ?? [];
  const currentPlan = user?.plan || 'free';
  const rank = (id: Plan) => Math.max(0, plans.findIndex((p) => p.id === id));
  const itemCount = user?.itemCount || 0;
  const sub = user?.subscription;
  const restricted = user?.status !== 'active';

  const go = async (target: Plan) => {
    setError('');
    if (target === 'free') {
      setConfirmCancel(true);
      return;
    }
    setLoadingPlan(target);
    try {
      const result = await changePlan(target);
      if (result.action === 'checkout') {
        window.location.href = (await createCheckoutSession(target)).url;
        return;
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message || 'Failed to change plan');
    } finally {
      setLoadingPlan(null);
    }
  };

  const cancel = async () => {
    setConfirmCancel(false);
    setLoadingPlan('free');
    setError('');
    try {
      await cancelPlan();
      await refresh();
    } catch (e) {
      setError((e as Error).message || 'Failed to cancel');
    } finally {
      setLoadingPlan(null);
    }
  };

  const portal = async () => {
    try {
      window.location.href = (await createPortalSession()).url;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Plans</h1>

      {sub?.paymentFailedAt && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Your last subscription payment failed.{' '}
          {sub.effectivePlan === 'free'
            ? 'Your account is on the free plan until a payment goes through.'
            : `Your plan stays active until ${shortDate(sub.graceUntil)}.`}{' '}
          <button className="underline font-medium" onClick={portal}>Update your card</button>
        </div>
      )}
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {confirmCancel && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm font-medium text-amber-900 mb-3">
            Cancel your subscription now? You'll move to the free plan ({itemsLabel(user?.planLimits?.free ?? null)}).
          </p>
          <div className="flex gap-2">
            <button onClick={cancel} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg">Cancel subscription</button>
            <button onClick={() => setConfirmCancel(false)} className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg border border-gray-300">Keep plan</button>
          </div>
        </div>
      )}

      {!config ? (
        <div className="animate-pulse h-40 bg-gray-100 rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const higher = rank(plan.id) > rank(currentPlan);
            const limit = user?.planLimits?.[plan.id] ?? plan.limits.items ?? null;
            const overLimit = limit !== null && itemCount > limit;
            const busy = loadingPlan !== null;
            return (
              <div key={plan.id} className={`relative rounded-xl border-2 p-5 ${isCurrent ? 'border-indigo-500 bg-indigo-50/50' : 'border-gray-200 bg-white'}`}>
                {isCurrent && (
                  <span className="absolute -top-3 left-4 bg-indigo-600 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">Current plan</span>
                )}
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-2xl font-bold text-gray-900 mt-1">${plan.monthlyUsd}<span className="text-sm font-normal text-gray-500">/month</span></p>
                <ul className="mt-4 space-y-1 text-sm text-gray-600">
                  {[itemsLabel(limit), ...(plan.features ?? [])].map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
                <div className="mt-5">
                  {isCurrent ? null : higher ? (
                    <button onClick={() => go(plan.id)} disabled={busy || restricted}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
                      {loadingPlan === plan.id ? 'Working...' : 'Upgrade'}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => go(plan.id)} disabled={busy || overLimit || restricted}
                        className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                        {loadingPlan === plan.id ? 'Working...' : plan.id === 'free' ? 'Cancel subscription' : 'Downgrade'}
                      </button>
                      {overLimit && limit !== null && (
                        <p className="mt-2 text-xs text-amber-700">You have {itemCount} items (limit {limit}). Remove {itemCount - limit} to switch.</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sub?.hasSubscription && (
        <button onClick={portal} className="mt-6 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
          Cards and invoices (Stripe billing portal) &rarr;
        </button>
      )}
    </div>
  );
}

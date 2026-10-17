import { useContext, useState } from 'react';
import { useTranslation } from '@yourapp/shared';
import { AuthContext } from '../../auth-context';
import { cancelPlan, changePlan, createCheckoutSession, createPortalSession } from '../../api';
import { shortDate, usePublicConfig } from '../../billing';
import RestrictedNote from '../../components/RestrictedNote';
import { itemsLabel } from '../../plans';
import { canPay } from '../../standing';
import type { Plan } from '../../types';

// Plans, prices and limits come from the API (GET /api/public-config, api/lib/config.py PAID_PLANS + planLimits).

export default function PlansPage() {
  const { user, refresh } = useContext(AuthContext);
  const { t } = useTranslation();
  const config = usePublicConfig();
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');

  const plans = config?.plans ?? [];
  const currentPlan = user?.plan || 'free';
  const rank = (id: Plan) => Math.max(0, plans.findIndex((p) => p.id === id));
  const itemCount = user?.itemCount || 0;
  const sub = user?.subscription;
  const restricted = !canPay(user); // payments paused or read-only (RestrictedNote says why)

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
      setError((e as Error).message || t('plans.errors.changeFailed'));
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
      setError((e as Error).message || t('plans.errors.cancelFailed'));
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
      <h1 className="text-2xl font-bold text-ink mb-6">{t('plans.title')}</h1>
      <RestrictedNote need="pay" className="mb-4" />

      {sub?.paymentFailedAt && (
        <div className="mb-4 p-3 bg-warn-soft border border-warn/30 rounded-lg text-sm text-warn">
          {t('plans.paymentFailed.lead')}{' '}
          {sub.effectivePlan === 'free'
            ? t('plans.paymentFailed.onFree')
            : t('plans.paymentFailed.graceUntil', { date: shortDate(sub.graceUntil) })}{' '}
          <button className="underline font-medium disabled:opacity-50" onClick={portal} disabled={restricted}>{t('plans.paymentFailed.updateCard')}</button>
        </div>
      )}
      {error && <div className="mb-4 p-3 bg-danger-soft border border-danger/30 rounded-lg text-sm text-danger">{error}</div>}
      {confirmCancel && (
        <div className="mb-4 p-4 bg-warn-soft border border-warn/30 rounded-lg">
          <p className="text-sm font-medium text-warn mb-3">
            {t('plans.confirmCancel', { limit: itemsLabel(user?.planLimits?.free ?? null) })}
          </p>
          <div className="flex gap-2">
            <button onClick={cancel} disabled={restricted}
              className="px-4 py-2 text-sm font-semibold text-white bg-danger hover:opacity-90 rounded-lg disabled:opacity-50">
              {t('plans.cancelSubscription')}
            </button>
            <button onClick={() => setConfirmCancel(false)} className="px-4 py-2 text-sm font-medium text-ink rounded-lg border border-line-strong">{t('plans.keepPlan')}</button>
          </div>
        </div>
      )}

      {!config ? (
        <div className="animate-pulse h-40 bg-raised rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const higher = rank(plan.id) > rank(currentPlan);
            const limit = user?.planLimits?.[plan.id] ?? plan.limits.items ?? null;
            const overLimit = limit !== null && itemCount > limit;
            const busy = loadingPlan !== null;
            return (
              <div key={plan.id} className={`relative rounded-xl border-2 p-5 ${isCurrent ? 'border-brand-500 bg-brand-50/50' : 'border-line bg-panel'}`}>
                {isCurrent && (
                  <span className="absolute -top-3 left-4 bg-brand-600 text-brand-ink text-xs font-semibold px-2.5 py-0.5 rounded-full">{t('plans.current')}</span>
                )}
                <h3 className="text-lg font-bold text-ink">{plan.name}</h3>
                <p className="text-2xl font-bold text-ink mt-1">${plan.monthlyUsd}<span className="text-sm font-normal text-muted">{t('plans.perMonth')}</span></p>
                <ul className="mt-4 space-y-1 text-sm text-muted">
                  {[itemsLabel(limit), ...(plan.features ?? [])].map((f) => <li key={f}>✓ {f}</li>)}
                </ul>
                <div className="mt-5">
                  {isCurrent ? null : higher ? (
                    <button onClick={() => go(plan.id)} disabled={busy || restricted}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-brand-ink bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50">
                      {loadingPlan === plan.id ? t('plans.working') : t('plans.upgrade')}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => go(plan.id)} disabled={busy || overLimit || restricted}
                        className="w-full px-4 py-2.5 text-sm font-medium text-ink rounded-lg border border-line-strong hover:bg-raised disabled:opacity-50">
                        {loadingPlan === plan.id ? t('plans.working') : plan.id === 'free' ? t('plans.cancelSubscription') : t('plans.downgrade')}
                      </button>
                      {overLimit && limit !== null && (
                        <p className="mt-2 text-xs text-warn">{t('plans.overLimit', { count: itemCount, limit, remove: itemCount - limit })}</p>
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
        <button onClick={portal} disabled={restricted} className="mt-6 text-sm text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50">
          {t('plans.portal')}
        </button>
      )}
    </div>
  );
}

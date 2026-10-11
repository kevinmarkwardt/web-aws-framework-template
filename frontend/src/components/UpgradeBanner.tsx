import { Link } from 'react-router-dom';
import { useTranslation } from '@yourapp/shared';
import type { User } from '../types';
import { subscriptionsOn } from '../billing';
import { atLimit, itemsLabel } from '../plans';

interface UpgradeBannerProps {
  user: User;
  /** The live count on the page (the account's itemCount is only as fresh as the last account load). */
  itemCount?: number;
}

/** Shown once a user reaches their plan's item limit (limits come from GET /api/account), when subscriptions are on
 *  and a bigger plan exists. */
export default function UpgradeBanner({ user, itemCount = user.itemCount }: UpgradeBannerProps) {
  const { t } = useTranslation();
  if (!subscriptionsOn(user.billingMode) || !atLimit(itemCount, user.itemLimit)) return null;
  const order = Object.keys(user.planLimits ?? {});
  const next = order[order.indexOf(user.plan) + 1];
  if (!next) return null;
  const nextLimit = user.planLimits[next] ?? null;

  return (
    <div className="bg-brand-50 border border-brand-200 rounded-lg p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-brand-900">
          {t('items.upgrade.reached', { limit: itemsLabel(user.itemLimit) })}
        </p>
        <p className="text-sm text-brand-700 mt-0.5">
          {nextLimit === null ? t('items.upgrade.nextUnlimited', { plan: next }) : t('items.upgrade.next', { plan: next, limit: itemsLabel(nextLimit) })}
        </p>
      </div>
      <Link to="/dashboard/plans" className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg">
        {t('items.upgrade.seePlans')}
      </Link>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { Trans, useTranslation } from '@yourapp/shared';
import type { User } from '../types';
import { shortDate, subscriptionsOn } from '../billing';

const box = 'mb-6 p-4 rounded-lg border text-sm';
const red = `${box} border-red-200 bg-red-50 text-red-800`;
const amber = `${box} border-amber-200 bg-amber-50 text-amber-900`;

/** Account standing above every signed-in page (GET /api/account; api/lib/accounts.py): banned (read-only), suspended
 *  (payments paused), active warnings, or a failed subscription renewal in its grace period. Nothing when all is
 *  well. The pages turn the matching actions off (standing.ts, RestrictedNote). */
export default function AccountBanner({ user }: { user: User }) {
  const { t } = useTranslation();
  const support = <Link to="/dashboard/support" className="font-medium underline" />;
  if (user.status === 'banned') {
    return (
      <div role="alert" className={red}>
        <p className="font-medium">{t('app.banner.bannedTitle', { date: shortDate(user.bannedUntil) })}</p>
        {user.statusReason && <p className="mt-1">{t('app.banner.reason', { reason: user.statusReason })}</p>}
        <p className="mt-1">
          <Trans i18nKey="app.banner.bannedBody" components={{ a: support }} />
        </p>
      </div>
    );
  }
  if (user.status === 'suspended') {
    return (
      <div role="alert" className={amber}>
        <Trans i18nKey="app.banner.suspended" components={{ a: support }} />
      </div>
    );
  }
  const sub = user.subscription;
  const warnings = user.activeWarnings ?? 0;
  return (
    <>
      {warnings > 0 && (
        <div role="status" className={amber}>
          <Trans i18nKey="app.banner.warnings" count={warnings} values={{ left: Math.max(1, (user.warningsToBan ?? 3) - warnings) }}
            components={{ a: support }} />
        </div>
      )}
      {subscriptionsOn(user.billingMode) && sub?.paymentFailedAt && (
        <div role="alert" className={amber}>
          {t('app.banner.paymentFailed')}{' '}
          {sub.effectivePlan === 'free' ? t('app.banner.onFreePlan') : t('app.banner.graceUntil', { date: shortDate(sub.graceUntil) })}{' '}
          <Link to="/dashboard/plans" className="font-medium underline">{t('app.banner.fixIt')}</Link>
        </div>
      )}
    </>
  );
}

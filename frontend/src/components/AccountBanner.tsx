import { Link } from 'react-router-dom';
import type { User } from '../types';
import { shortDate, subscriptionsOn } from '../billing';

/** Account standing above every signed-in page: banned (read-only), suspended (payments paused), or a failed
 *  subscription renewal in its grace period. Nothing when all is well. */
export default function AccountBanner({ user }: { user: User }) {
  if (user.status === 'banned') {
    return (
      <div className="mb-6 p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
        This account is read-only until {shortDate(user.bannedUntil)}{user.statusReason ? ` (${user.statusReason})` : ''}. You can
        still sign in and view your data; payments and changes are turned off.
      </div>
    );
  }
  if (user.status === 'suspended') {
    return (
      <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
        Payments are paused on this account while we look into an issue. Contact support if you think this is a mistake.
      </div>
    );
  }
  const sub = user.subscription;
  if (subscriptionsOn(user.billingMode) && sub?.paymentFailedAt) {
    return (
      <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
        Your subscription payment failed.{' '}
        {sub.effectivePlan === 'free' ? 'Your account is on the free plan until it goes through.' : `Your plan stays active until ${shortDate(sub.graceUntil)}.`}{' '}
        <Link to="/dashboard/plans" className="font-medium underline">Fix it</Link>
      </div>
    );
  }
  return null;
}

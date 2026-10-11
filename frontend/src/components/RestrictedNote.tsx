import { useContext } from 'react';
import { useTranslation } from '@yourapp/shared';
import { AuthContext } from '../auth-context';
import { canPay, canWrite } from '../standing';
import { shortDate } from '../billing';

/** Why the actions next to it are turned off, when the account's standing turns them off (standing.ts): put it beside
 *  any buy, top-up, card, plan or create button and disable the button with canPay / canWrite. Nothing otherwise. */
export default function RestrictedNote({ need, className = '' }: { need: 'pay' | 'write'; className?: string }) {
  const { user } = useContext(AuthContext);
  const { t } = useTranslation();
  if (!user || (need === 'pay' ? canPay(user) : canWrite(user))) return null;
  const text = user.status === 'banned'
    ? t('app.restricted.readOnly', { date: shortDate(user.bannedUntil) })
    : t('app.restricted.paymentsPaused');
  return (
    <p role="note" className={`text-sm text-warn bg-warn-soft border border-warn/30 rounded-lg px-3 py-2 ${className}`}>
      {text}
    </p>
  );
}

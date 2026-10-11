import { i18n } from '@yourapp/shared';

/** Plan item limits come from the API (admin-editable, api/lib/config.py); null means unlimited. */
export type PlanLimit = number | null;

/** "Unlimited items" / "1 item" / "10 items", in the site's language. */
export function itemsLabel(limit: PlanLimit): string {
  if (limit === null) return i18n.t('items.limit.unlimited');
  return i18n.t('items.limit.count', { count: limit });
}

export const atLimit = (count: number, limit: PlanLimit) => limit !== null && count >= limit;

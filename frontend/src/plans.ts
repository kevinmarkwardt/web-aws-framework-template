/** Plan item limits come from the API (admin-editable, api/lib/config.py); null means unlimited. */
export type PlanLimit = number | null;

export function itemsLabel(limit: PlanLimit): string {
  if (limit === null) return 'Unlimited items';
  return `${limit} item${limit === 1 ? '' : 's'}`;
}

export const atLimit = (count: number, limit: PlanLimit) => limit !== null && count >= limit;

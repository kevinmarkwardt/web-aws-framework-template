import type { User } from './types';

/** What the account's standing allows (api/lib/accounts.py, which enforces the same on every route):
 *  - banned: read-only (sign in and view; no payments, no creating or changing things)
 *  - suspended: payments paused (no top-ups, cards, plan changes or refunds); everything else works */
export const canPay = (user: User | null | undefined) => !!user && user.status === 'active';
export const canWrite = (user: User | null | undefined) => !!user && user.status !== 'banned';

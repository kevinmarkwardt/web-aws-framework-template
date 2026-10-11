import { getToken, MOCK_AUTH, mockUsername } from './auth';
import type {
  AccountNote, AutoReload, ChargeResult, CreateItemRequest, Item, Plan, PublicConfig, RefundRow, SavedCard,
  UpdateItemRequest, User, UserSettings, Wallet,
} from './types';

/** An API refusal with the server's machine-readable code (MAINTENANCE, SIGNUPS_CLOSED, PLAN_LIMIT, REGION, ...) and,
 *  for a card charge, its outcome ("unknown": resend with the same requestId; "declined": nothing was charged). */
export class ApiError extends Error {
  status: number;
  code?: string;
  outcome?: 'unknown' | 'declined';
  constructor(message: string, status: number, code?: string, outcome?: 'unknown' | 'declined') {
    super(message);
    this.status = status;
    this.code = code;
    this.outcome = outcome;
  }
}

/** Public, no sign-in: switches, plan limits and the billing modules that are on (GET /api/public-config). */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/public-config');
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return res.json();
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error || body.message;
    if (message) {
      throw new ApiError(message, res.status, body.code, body.outcome);
    }
    if (res.status >= 500) {
      throw new ApiError('Something went wrong on our end. Please try again in a few minutes.', res.status);
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }

  return res.json();
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

// Items
export const fetchItems = () => apiFetch<Item[]>('/items');

export const createItem = (data: CreateItemRequest) =>
  apiFetch<Item>('/items', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateItem = (itemId: string, data: UpdateItemRequest) =>
  apiFetch<Item>(`/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteItem = (itemId: string) =>
  apiFetch<void>(`/items/${itemId}`, { method: 'DELETE' });

// Account
/** MOCK_AUTH (local dev, no backend): a made-up free account so the signed-in pages render. Data calls (items, billing)
 *  still go to /api and fail unless a local API is running (scripts/local-test.sh). */
function mockAccount(): User {
  const email = mockUsername() || 'dev@localhost';
  return {
    userId: 'mock-user',
    email,
    name: email.split('@')[0],
    plan: 'free',
    itemCount: 0,
    itemLimit: 10,
    planLimits: { free: 10, starter: 100, pro: null },  // mock data only; real limits come from the API
    settings: { alertsEnabled: true, digestEnabled: true, remindersEnabled: true },
    status: 'active',
    billingMode: 'both',
    credits: 0,
    paidCredits: 0,
    bonusCredits: 0,
    creditName: 'credits',
  };
}

export const fetchAccount = () => (MOCK_AUTH ? Promise.resolve(mockAccount()) : apiFetch<User>('/account'));

export const updateSettings = (settings: Partial<UserSettings>) =>
  apiFetch<User>('/account/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

export const updateName = (name: string) =>
  apiFetch<{ name: string }>('/account/name', {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });

// Account alerts (user menu)
export const fetchNotes = () =>
  MOCK_AUTH ? Promise.resolve({ notes: [] as AccountNote[] }) : apiFetch<{ notes: AccountNote[] }>('/account/notes');
export const dismissNote = (id: string) => apiFetch<{ dismissed: boolean }>('/account/notes/dismiss', post({ id }));

// Subscriptions (billing mode subscriptions | both)
export const createCheckoutSession = (plan: Plan) => apiFetch<{ url: string }>('/billing/checkout', post({ plan }));

export const createPortalSession = () => apiFetch<{ url: string }>('/billing/portal', post());

export const changePlan = (plan: Plan) =>
  apiFetch<{ action: 'done' | 'checkout'; plan?: string }>('/billing/change-plan', post({ plan }));

export const cancelPlan = () => apiFetch<{ action: 'done'; plan: string }>('/billing/cancel', post());

// Credits wallet (billing mode credits | both)
export const fetchWallet = () => apiFetch<Wallet>('/wallet');

/** Buy a pack (or a custom whole-dollar amount) with a saved card. `requestId` is the idempotency key: resend the same
 *  one when the answer was lost or `outcome` is "unknown", a new one for a new purchase. */
export const chargeWallet = (args: { packId?: string; customUsd?: number; paymentMethodId?: string; requestId: string }) =>
  apiFetch<ChargeResult>('/wallet/charge', post(args));

/** Back from a bank's 3-D Secure page (Stripe adds ?payment_intent=pi_... to the return URL). */
export const finishCharge = (paymentIntent: string) => apiFetch<ChargeResult>(`/wallet/charge/${encodeURIComponent(paymentIntent)}`);

export const saveAutoReload = (settings: Partial<AutoReload>) => apiFetch<AutoReload>('/wallet/auto-reload', post(settings));

export const fetchRefundOptions = () =>
  apiFetch<{ purchases: RefundRow[]; refundDays: number; refundHoldMinutes: number }>('/wallet/refunds');

export const requestRefund = (paymentIntents: string[], reason: string) =>
  apiFetch<{ refunded: number }>('/wallet/refund', post({ paymentIntents, reason }));

// Saved cards (any billing mode but none)
export const fetchCards = () => apiFetch<{ cards: SavedCard[] }>('/account/cards');
export const setupCard = (returnTo: 'wallet' | 'plans') => apiFetch<{ url: string }>('/account/cards/setup', post({ returnTo }));
export const makeDefaultCard = (id: string) => apiFetch<{ cards: SavedCard[] }>(`/account/cards/${id}/default`, post());
export const cardRemovalCheck = (id: string) =>
  apiFetch<{ refundable: RefundRow[]; totalCents: number }>(`/account/cards/${id}/removal-check`);
export const removeCard = (id: string) => apiFetch<{ cards: SavedCard[] }>(`/account/cards/${id}`, { method: 'DELETE' });

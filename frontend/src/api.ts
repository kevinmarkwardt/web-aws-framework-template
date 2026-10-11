import { ApiError, createApiClient, post } from '@yourapp/shared';
import { getToken, MOCK_AUTH, mockUsername } from './auth';
import type {
  AccountNote, AutoReload, ChargeResult, CreateItemRequest, Item, Plan, PublicConfig, RefundRow, SavedCard,
  SupportRequest, UpdateItemRequest, User, UserSettings, Wallet,
} from './types';

export { ApiError };

/** Public, no sign-in: switches, plan limits and the billing modules that are on (GET /api/public-config). */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  if (MOCK_AUTH) throw new ApiError('No API in MOCK_AUTH', 503);  // pages fall back to their defaults
  const res = await fetch('/api/public-config');
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
  return res.json();
}

/** The shared fetch core (packages/shared/src/api.ts): Bearer token, JSON, ApiError; signed out -> the login page. */
const apiFetch = createApiClient({
  getToken,
  onUnauthorized: () => {
    if (window.location.pathname !== '/login') window.location.href = '/login';
  },
  mock: (path, init) => mockApi(path, init),
});

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
/** MOCK_AUTH (local dev, no backend): a made-up free account so the signed-in pages render. Other calls (billing)
 *  still go to /api and fail; use scripts/local-test.sh to run against a deployed stage. */
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
    isAdmin: true,  // shows the Admin link (the local admin site: cd admin && npm run dev)
    status: 'active',
    billingMode: 'both',
    credits: 0,
    paidCredits: 0,
    bonusCredits: 0,
    creditName: 'credits',
  };
}

/** MOCK_AUTH answers for the GETs the signed-in pages make on load (undefined: use the network). */
function mockApi(path: string, init: RequestInit): Promise<unknown> | undefined {
  if (!MOCK_AUTH || (init.method && init.method !== 'GET')) return undefined;
  const answers: Record<string, () => unknown> = {
    '/account': mockAccount,
    '/account/notes': () => ({ notes: [] as AccountNote[] }),
    '/items': () => [] as Item[],
    '/support': () => ({ requests: [] as SupportRequest[], topics: [{ id: 'other', label: 'Something else' }], maxOpen: 3 }),
  };
  return answers[path] ? Promise.resolve(answers[path]()) : undefined;
}

export const fetchAccount = () => apiFetch<User>('/account');

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
export const fetchNotes = () => apiFetch<{ notes: AccountNote[] }>('/account/notes');
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

// Support requests (answered on the admin site's Support tab)
export const fetchSupport = () =>
  apiFetch<{ requests: SupportRequest[]; topics: { id: string; label: string }[]; maxOpen: number }>('/support');
export const createSupportRequest = (topic: string, message: string) => apiFetch<SupportRequest>('/support', post({ topic, message }));
export const addToSupportRequest = (id: string, message: string) => apiFetch<SupportRequest>(`/support/${id}`, post({ message }));

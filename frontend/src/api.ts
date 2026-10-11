import { getToken, MOCK_AUTH, mockUsername } from './auth';
import type { Item, CreateItemRequest, UpdateItemRequest, PublicConfig, User, UserSettings } from './types';

/** An API refusal with the server's machine-readable code (MAINTENANCE, SIGNUPS_CLOSED, PLAN_LIMIT, ...). */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Public, no sign-in: maintenance/sign-up switches and plan limits (GET /api/public-config). */
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
      throw new ApiError(message, res.status, body.code);
    }
    if (res.status >= 500) {
      throw new ApiError('Something went wrong on our end. Please try again in a few minutes.', res.status);
    }
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }

  return res.json();
}

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

export const createCheckoutSession = (plan: 'starter' | 'pro') =>
  apiFetch<{ url: string }>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });

export const createPortalSession = () =>
  apiFetch<{ url: string }>('/billing/portal', { method: 'POST' });

export const changePlan = (plan: 'free' | 'starter' | 'pro') =>
  apiFetch<{ action: 'done' | 'checkout'; plan?: string }>('/billing/change-plan', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });

export const cancelPlan = () =>
  apiFetch<{ action: 'done'; plan: string }>('/billing/cancel', { method: 'POST' });

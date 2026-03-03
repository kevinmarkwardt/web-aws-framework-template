import { getToken } from './auth';
import type { Item, CreateItemRequest, UpdateItemRequest, User, UserSettings } from './types';

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
      throw new Error(message);
    }
    if (res.status >= 500) {
      throw new Error('Something went wrong on our end. Please try again in a few minutes.');
    }
    throw new Error(`Request failed (${res.status})`);
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

import type { Item, User } from './types';
import type { AdminOverview, UserDetail, HealthData, SiteConfig, StripeConfig } from './admin-types';

let adminToken: string | null = null;

export function setAdminToken(token: string) {
  adminToken = token;
}

export function clearAdminToken() {
  adminToken = null;
}

export function hasAdminToken(): boolean {
  return adminToken !== null;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!adminToken) {
    throw new Error('Not authenticated as admin');
  }

  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearAdminToken();
    window.location.href = '/';
    throw new Error('Admin session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// Auth
export async function adminLogin(email: string, password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Login failed');
  }
  const data = await res.json();
  adminToken = data.token;
  return data.token;
}

// Overview
export const fetchOverview = () => adminFetch<AdminOverview>('/overview');

// Users
export const fetchUsers = () => adminFetch<User[]>('/users');
export const fetchUserDetail = (userId: string) => adminFetch<UserDetail>(`/users/${userId}`);
export const updateUser = (userId: string, data: { plan?: string }) =>
  adminFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteUser = (userId: string) =>
  adminFetch(`/users/${userId}`, { method: 'DELETE' });

// Items
export const fetchAllItems = (params?: { status?: string; q?: string }) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.q) qs.set('q', params.q);
  const query = qs.toString();
  return adminFetch<Item[]>(`/items${query ? `?${query}` : ''}`);
};
export const updateAdminItem = (userId: string, itemId: string, data: Partial<Item>) =>
  adminFetch(`/items/${userId}/${itemId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAdminItem = (userId: string, itemId: string) =>
  adminFetch(`/items/${userId}/${itemId}`, { method: 'DELETE' });

// Health
export const fetchHealth = () => adminFetch<HealthData>('/health');

// Actions
export const triggerDailyJob = () =>
  adminFetch('/actions/trigger-daily-job', { method: 'POST' });
export const triggerDigest = () =>
  adminFetch('/actions/send-digest', { method: 'POST' });

// Site Config
export const fetchConfig = () => adminFetch<SiteConfig>('/config');
export const updateConfig = (config: Partial<SiteConfig>) =>
  adminFetch('/config', { method: 'PUT', body: JSON.stringify(config) });

// Stripe Config
export const fetchStripeConfig = () => adminFetch<StripeConfig>('/config/stripe');
export const updateStripeConfig = (config: Partial<StripeConfig>) =>
  adminFetch('/config/stripe', { method: 'PUT', body: JSON.stringify(config) });

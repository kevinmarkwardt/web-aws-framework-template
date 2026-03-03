import { getToken } from './auth';
import type { Link, Pitch, User, UserSettings } from './types';

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

// Links
export const fetchLinks = () => apiFetch<Link[]>('/links');

export const addLink = (data: {
  pageUrl: string;
  destinationUrl: string;
  anchorText?: string;
}) => apiFetch<Link>('/links', { method: 'POST', body: JSON.stringify(data) });

export const addLinksBulk = (
  links: { pageUrl: string; destinationUrl: string; anchorText?: string }[]
) => apiFetch<Link[]>('/links', { method: 'POST', body: JSON.stringify(links) });

export const uploadCSV = async (file: File) => {
  const token = await getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  // Read file as text and send as plain text body (not FormData)
  // Lambda Function URL doesn't handle multipart natively
  const text = await file.text();
  const res = await fetch('/api/links/csv', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/csv',
    },
    body: text,
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
  return res.json() as Promise<Link[]>;
};

export const deleteLink = (linkId: string) =>
  apiFetch<void>(`/links/${linkId}`, { method: 'DELETE' });

export const recrawlLink = (linkId: string) =>
  apiFetch<Link>(`/links/${linkId}/crawl`, { method: 'POST' });

export const fetchLinkHistory = (linkId: string) =>
  apiFetch<Link['statusHistory']>(`/links/${linkId}/history`);

// Pitches
export const fetchPitches = () => apiFetch<Pitch[]>('/pitches');

export const addPitch = (data: Omit<Pitch, 'pitchId' | 'linkedLinkId'>) =>
  apiFetch<Pitch>('/pitches', { method: 'POST', body: JSON.stringify(data) });

export const updatePitch = (pitchId: string, data: Partial<Pitch>) =>
  apiFetch<Pitch>(`/pitches/${pitchId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deletePitch = (pitchId: string) =>
  apiFetch<void>(`/pitches/${pitchId}`, { method: 'DELETE' });

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

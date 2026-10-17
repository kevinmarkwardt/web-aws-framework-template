// The admin API client (api/admin_handler.py, /api/admin/*). Every call carries the signed-in admin's ID token; the
// admin Lambda re-checks the Cognito group and the profile flag on every request. A 401 tells the app to show the
// sign-in page (SIGNED_OUT_EVENT). With MOCK_AUTH (local dev, no backend) mock.ts answers instead.
import { createApiClient, del, post, put, qs } from '@yourapp/shared';
import { getToken, MOCK_AUTH } from './auth';
import { mockAdminApi } from './mock';
import type {
  AdminItem, AdminMe, AdminUser, AuditRow, Health, Overview, Payment, PaymentDetail, SiteConfig, StripeCall, StripeConfig,
  Ticket, UserAction, UserDetail, WebhookRow,
} from './types';

export const SIGNED_OUT_EVENT = 'admin:signed-out';

const apiFetch = createApiClient({
  getToken,
  onUnauthorized: () => window.dispatchEvent(new Event(SIGNED_OUT_EVENT)),
  mock: MOCK_AUTH ? mockAdminApi : undefined,
});

const enc = encodeURIComponent;

export const api = {
  me: () => apiFetch<AdminMe>('/admin/me'),
  overview: (days: number) => apiFetch<Overview>(`/admin/overview${qs({ days })}`),

  users: (p: { q?: string; status?: string; cursor?: string | null }) =>
    apiFetch<{ users: AdminUser[]; cursor: string | null }>(`/admin/users${qs(p)}`),
  user: (id: string) => apiFetch<UserDetail>(`/admin/users/${enc(id)}`),
  userAction: (id: string, action: UserAction, body: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/admin/users/${enc(id)}/${action}`, post(body)),

  payments: (day: string) =>
    apiFetch<{ day: string; payments: Payment[]; totals: { count: number; paidCents: number; feeCents: number; netCents: number; refundedCents: number } }>(
      `/admin/payments${qs({ day })}`),
  payment: (pi: string) => apiFetch<PaymentDetail>(`/admin/payments/${enc(pi)}`),

  stripeLog: (p: { day: string; failed?: boolean; user?: string }) =>
    apiFetch<{ day: string; entries: StripeCall[] }>(`/admin/stripe-log${qs({ day: p.day, failed: p.failed ? '1' : '', user: p.user })}`),
  webhooks: (p: { day: string; failed?: boolean }) =>
    apiFetch<{ day: string; entries: WebhookRow[] }>(`/admin/webhooks${qs({ day: p.day, failed: p.failed ? '1' : '' })}`),
  webhook: (evt: string) => apiFetch<Record<string, unknown>>(`/admin/webhooks/${enc(evt)}`),
  audit: (p: { day: string; actor?: string; target?: string }) =>
    apiFetch<{ day: string; entries: AuditRow[] }>(`/admin/audit${qs(p)}`),

  support: (status: 'open' | 'closed' | 'all') =>
    apiFetch<{ requests: Ticket[]; counts: { open: number; closed: number } }>(`/admin/support${qs({ status })}`),
  supportUpdate: (id: string, body: { reply?: string; status?: 'open' | 'closed' }) => apiFetch<Ticket>(`/admin/support/${id}`, post(body)),

  health: () => apiFetch<Health>('/admin/health'),
  runTask: (task: 'daily-job' | 'payments-sweep') => apiFetch<Record<string, unknown>>(`/admin/actions/${task}`, post({})),

  config: () => apiFetch<SiteConfig>('/admin/config'),
  saveConfig: (body: Partial<SiteConfig>) => apiFetch<SiteConfig>('/admin/config', put(body)),
  stripeConfig: () => apiFetch<StripeConfig>('/admin/config/stripe'),
  saveStripeConfig: (priceOverrides: Record<string, string>) => apiFetch<StripeConfig>('/admin/config/stripe', put({ priceOverrides })),

  items: (p: { q?: string; cursor?: string | null }) => apiFetch<{ items: AdminItem[]; cursor: string | null }>(`/admin/items${qs(p)}`),
  deleteItem: (userId: string, itemId: string, reason: string) =>
    apiFetch<{ deleted: boolean }>(`/admin/items/${enc(userId)}/${enc(itemId)}`, del({ reason })),
};

/** Your app's own admin routes: call them with this (same token, same errors). */
export { apiFetch };

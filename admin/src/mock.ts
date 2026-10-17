// MOCK_AUTH (local dev with no Cognito pool and no API): canned answers for the admin API so every tab renders.
// Writes answer { ok: true } and change nothing. Never part of a production build (api.ts only uses it when MOCK_AUTH).
import { CONTRACTS } from '@yourapp/shared/contracts';
import { mockUsername } from './auth';
import type {
  AdminItem, AdminMe, AdminUser, AuditRow, Health, Overview, Payment, PaymentDetail, SiteConfig, StripeCall, Ticket, UserDetail,
  WebhookRow,
} from './types';

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const NAMES = ['Ada Park', 'Ben Ortiz', 'Chloe Nguyen', 'Dev Shah', 'Elena Rossi', 'Farah Haddad', 'Gus Lindqvist', 'Hana Sato',
  'Ivan Petrov', 'June Okafor', 'Kai Müller', 'Lena Novak', 'Marco Silva', 'Nia Brooks', 'Omar Aziz', 'Priya Iyer'];

const users: AdminUser[] = NAMES.map((name, i) => {
  const paid = [0, 1500, 0, 4200, 800, 0, 12000, 0, 300, 0, 2500, 0, 0, 900, 0, 6000][i];
  const status = i === 4 ? 'suspended' : i === 9 ? 'banned' : 'active';
  return {
    userId: `mock-${(i + 1).toString().padStart(2, '0')}-3f9c`, email: `${name.split(' ')[0].toLowerCase()}@example.com`, name,
    createdAt: iso(60 * 24 * (i * 3 + 1)), isAdmin: i === 0, status, bannedUntil: status === 'banned' ? iso(-60 * 24 * 300) : null,
    statusReason: status === 'suspended' ? 'dispute dp_1Q2w' : status === 'banned' ? '3 warnings in 90 days' : null,
    itemCount: (i * 7) % 23, plan: ['free', 'starter', 'pro'][i % 3], credits: paid + (i % 4) * 100, paidCredits: paid, bonusCredits: (i % 4) * 100,
  };
});

const payments: Payment[] = [0, 1, 3, 6, 10, 13, 15].map((u, i) => ({
  paymentIntent: `pi_mock${i}Xa81`, userId: users[u].userId, kind: i === 2 ? 'subscription' : 'topup', packId: 'p20',
  paidCents: [2000, 1000, 1900, 5000, 2000, 500, 5000][i], credits: [2200, 1000, 0, 6000, 2200, 500, 6000][i],
  bonusCredits: [200, 0, 0, 1000, 200, 0, 1000][i], feeCents: [88, 59, 85, 175, 88, 45, 175][i], netCents: [1912, 941, 1815, 4825, 1912, 455, 4825][i],
  refundedCents: i === 4 ? 500 : 0, disputed: i === 5, status: 'succeeded', createdAt: iso(37 * (i + 1)),
  receiptUrl: 'https://pay.stripe.com/receipts/mock',
  card: { brand: ['visa', 'mastercard', 'amex'][i % 3], last4: ['4242', '4444', '0005'][i % 3], country: 'US', expMonth: 9, expYear: 2029 },
  risk: { level: i === 5 ? 'elevated' : 'normal', score: [12, 8, 21, 5, 33, 67, 9][i] },
}));

function me(): AdminMe {
  const email = mockUsername() || 'admin@localhost';
  return {
    userId: 'mock-admin', email, name: email.split('@')[0], stage: 'test', siteUrl: 'http://localhost:5173', billingMode: 'both',
    creditName: 'credits',
    plans: [
      { id: 'free', name: 'Free', monthlyUsd: 0, limits: { items: 10 } },
      { id: 'starter', name: 'Starter', monthlyUsd: 9, limits: { items: 100 } },
      { id: 'pro', name: 'Pro', monthlyUsd: 19, limits: { items: null } },
    ],
    packs: [5, 10, 20, 50].map((usd, i) => ({ id: `p${usd}`, usd, payCents: usd * 100, bonusPct: [0, 0, 10, 20][i],
      bonus: (usd * 100 * [0, 0, 10, 20][i]) / 100, credits: usd * 100 + (usd * 100 * [0, 0, 10, 20][i]) / 100 })),
    accountRules: { warningDays: 90, warningsToBan: 3, banDays: 365 },
    supportTopics: { billing: 'Billing or payments', account: 'My account', bug: "Something isn't working", other: 'Something else' },
  };
}

function overview(): Overview {
  const sum = (k: keyof Payment) => payments.reduce((a, p) => a + Number(p[k] || 0), 0);
  return {
    billingMode: 'both', days: 30,
    users: { total: users.length, active: 14, suspended: 1, banned: 1, admins: 1, new7: 3, new30: 9 },
    payments: {
      count: payments.length, paidCents: sum('paidCents'), feeCents: sum('feeCents'), netCents: sum('netCents'), refundedCents: sum('refundedCents'),
      byKind: {
        topup: { count: 6, paidCents: 15500, feeCents: 630, netCents: 14870, refundedCents: 500 },
        subscription: { count: 1, paidCents: 1900, feeCents: 85, netCents: 1815, refundedCents: 0 },
      },
      disputed: 1, pendingRefunds: 0,
    },
    outstanding: { paidCredits: users.reduce((a, u) => a + (u.paidCredits ?? 0), 0), bonusCredits: users.reduce((a, u) => a + (u.bonusCredits ?? 0), 0), creditName: 'credits' },
    subscriptions: { active: 5, failing: 1, mrrUsd: 75, byPlan: { free: 11, starter: 3, pro: 2 } },
  };
}

function detail(id: string): UserDetail {
  const u = users.find((x) => x.userId === id) ?? users[0];
  const pays = payments.filter((p) => p.userId === u.userId);
  return {
    user: { ...u, stripeCustomerId: pays.length ? 'cus_mock123' : '', cards: pays.length ? 1 : 0 },
    warnings: u.status === 'banned'
      ? [0, 1, 2].map((i) => ({ sk: `WARN#${iso(60 * 24 * (i + 2))}`, reason: ['spam', 'spam again', 'abusive messages'][i], actor: 'admin:mock-admin',
        at: iso(60 * 24 * (i + 2)), expiresAt: iso(-60 * 24 * 80), active: true }))
      : [],
    notes: [],
    accountRules: { warningDays: 90, warningsToBan: 3, banDays: 365 },
    payments: pays,
    subscription: { plan: u.plan ?? 'free', effectivePlan: u.plan ?? 'free', subscriptionStatus: u.plan === 'free' ? null : 'active', hasSubscription: u.plan !== 'free' },
    history: pays.map((p) => ({ kind: 'topup', amount: p.credits ?? 0, paid: p.paidCents, bonus: p.bonusCredits ?? 0, note: 'Top-up', at: p.createdAt,
      balanceAfter: p.credits ?? 0, paymentIntent: p.paymentIntent })),
    refundable: {
      window: { refundable: u.paidCredits ?? 0, credits: u.credits ?? 0, paidCredits: u.paidCredits ?? 0, bonusCredits: u.bonusCredits ?? 0, policy: 'window' },
      all: { refundable: u.paidCredits ?? 0, credits: u.credits ?? 0, paidCredits: u.paidCredits ?? 0, bonusCredits: u.bonusCredits ?? 0, policy: 'all' },
    },
    pending: [],
    creditName: 'credits',
  };
}

function paymentDetail(pi: string): PaymentDetail {
  const p = payments.find((x) => x.paymentIntent === pi) ?? payments[0];
  return {
    ...p,
    refunds: p.refundedCents ? [{ sk: 'REFUND#re_mock1', amountCents: p.refundedCents, reason: 'Requested by the customer', actor: `user:${p.userId}`, status: 'succeeded', at: iso(20) }] : [],
    disputes: p.disputed ? [{ sk: 'DISPUTE#dp_mock1', amountCents: p.paidCents, reason: 'fraudulent', status: 'needs_response', evidenceDueBy: Math.floor(NOW / 1000) + 7 * 86400, at: iso(30) }] : [],
  };
}

const calls: StripeCall[] = [
  { sk: 's1', at: iso(5), op: 'payment_intents.create', ok: true, ms: 412, httpStatus: 200, userId: users[3].userId, actor: `user:${users[3].userId}`,
    idempotencyKey: 'yourapp-charge-mock-req-1', request: '{"amount": 5000, "currency": "usd"}', response: '{"id": "pi_mock3Xa81", "status": "succeeded"}', objectId: 'pi_mock3Xa81' },
  { sk: 's2', at: iso(12), op: 'refunds.create', ok: false, ms: 233, httpStatus: 400, userId: users[10].userId, actor: 'admin:mock-admin',
    error: 'InvalidRequestError: Charge has been disputed', errorCode: 'charge_disputed', request: '{"payment_intent": "pi_mock5Xa81", "amount": 500}' },
  { sk: 's3', at: iso(40), op: 'customers.create', ok: true, ms: 188, httpStatus: 200, userId: users[13].userId, actor: `user:${users[13].userId}`, objectId: 'cus_mock123' },
];

const hooks: WebhookRow[] = [
  { sk: 'w1', eventId: 'evt_mock1', type: 'payment_intent.succeeded', objectId: 'pi_mock3Xa81', status: 'ok', result: 'credited' },
  { sk: 'w2', eventId: 'evt_mock2', type: 'charge.dispute.created', objectId: 'dp_mock1', status: 'ok', result: 'suspended user' },
  { sk: 'w3', eventId: 'evt_mock3', type: 'invoice.payment_failed', objectId: 'in_mock1', status: 'failed', result: 'KeyError: customer' },
];

const audit: AuditRow[] = [
  { sk: 'a1', at: iso(3), actor: 'admin:mock-admin', action: 'user.suspended', target: `user:${users[4].userId}`, reason: 'looking into a chargeback',
    before: '{"status": "active"}', after: '{"status": "suspended"}' },
  { sk: 'a2', at: iso(50), actor: 'system', action: 'user.ban', target: `user:${users[9].userId}`, reason: '3 warnings in 90 days (latest: abusive messages)',
    before: '{"status": "active"}', after: '{"status": "banned", "refundedCents": 0}' },
  { sk: 'a3', at: iso(95), actor: 'stripe', action: 'dispute.created', target: `user:${users[13].userId}`, reason: 'fraudulent' },
];

const tickets: Ticket[] = [
  { id: 'a1b2c3d4e5f6', userId: users[2].userId, email: users[2].email, topic: 'billing', topicLabel: 'Billing or payments',
    message: 'I bought the $20 pack but my balance still shows the old amount.', status: 'open', createdAt: iso(25), updatedAt: iso(10),
    replies: [{ at: iso(10), by: 'customer', text: 'It has been about 20 minutes now.' }] },
  { id: 'f6e5d4c3b2a1', userId: users[7].userId, email: users[7].email, topic: 'bug', topicLabel: "Something isn't working",
    message: 'The items page shows an error when I sort by status.', status: 'open', createdAt: iso(300), updatedAt: iso(300), replies: [] },
  { id: '0a1b2c3d4e5f', userId: users[5].userId, email: users[5].email, topic: 'account', topicLabel: 'My account',
    message: 'How do I change the email on my account?', status: 'closed', createdAt: iso(2000), updatedAt: iso(1900),
    replies: [{ at: iso(1900), by: 'admin:mock-admin', text: 'You can change it on the Settings page. Let us know if it gives you trouble.' }] },
];

const health: Health = {
  stage: 'test', region: 'us-east-1', at: iso(0),
  lambda: {
    api: { function: 'yourapp-test-api', invocations: 1842, errors: 2, throttles: 0, avgMs: 84.2, p95Ms: 310.5 },
    admin: { function: 'yourapp-test-admin', invocations: 96, errors: 0, throttles: 0, avgMs: 140.1, p95Ms: 420 },
    'daily-job': { function: 'yourapp-test-daily-job', invocations: 1, errors: 0, throttles: 0, avgMs: 2210, p95Ms: 2210 },
  },
  dynamodb: { table: 'yourapp-test', status: 'ACTIVE', itemCount: 1204, sizeBytes: 482113, billing: 'PAY_PER_REQUEST',
    indexes: [{ name: 'stripe-customer-index', status: 'ACTIVE' }, { name: 'list-index', status: 'ACTIVE' }], throttled24h: 0 },
  ses: { sender: 'noreply@yourapp.com', max24h: 200, sent24h: 14, maxPerSecond: 1, productionAccess: false,
    last14d: { deliveryattempts: 61, bounces: 1, complaints: 0, rejects: 0 } },
  app: { failedWebhooksToday: 1, pendingRefunds: 0, openSupport: 2 },
};

const config: SiteConfig = {
  maintenanceMode: false, signupsEnabled: true, jobsEnabled: true, alertsEnabled: true,
  planLimits: { free: 10, starter: 100, pro: null },
  jobSettings: { dailyJobHourUtc: 8, hourlyJobEnabled: false, rateLimitDelayMs: 1000 },
  emailTemplates: { welcomeSubject: 'Welcome to YourApp', digestSubject: 'Your YourApp weekly digest', alertSubject: 'YourApp: an item changed status' },
};

const items: AdminItem[] = users.slice(0, 8).map((u, i) => ({
  itemId: `01JMOCK${i}ABCDEF`, userId: u.userId, email: u.email, name: ['Quarterly report', 'Landing page copy', 'Onboarding checklist',
    'Price list', 'Team roster', 'Launch plan', 'Bug triage', 'Release notes'][i], status: i % 3 ? 'ACTIVE' : 'INACTIVE', createdAt: iso(400 * (i + 1)),
}));

/** The admin paths of the app's entities (/admin/<plural>...): never answered here. They go to the network, where the
 *  browser mocks (MSW, packages/shared/src/mocks) answer while the entity is mocked. */
const entityPath = (p: string) =>
  CONTRACTS.some((c) => {
    const base = c.adminPath.replace(/^\/api/, '');
    return p === base || p.startsWith(`${base}/`);
  });

export function mockAdminApi(path: string, init: RequestInit): Promise<unknown> | undefined {
  const url = new URL(path, 'http://mock');
  const p = url.pathname;
  const q = url.searchParams;
  if (entityPath(p)) return undefined;
  const method = init.method ?? 'GET';
  let out: unknown = { ok: true };
  if (method === 'GET') {
    if (p === '/admin/me') out = me();
    else if (p === '/admin/overview') out = { ...overview(), days: Number(q.get('days') || 30) };
    else if (p === '/admin/users') {
      const term = (q.get('q') || '').toLowerCase();
      const st = q.get('status');
      out = { users: users.filter((u) => (!term || `${u.email} ${u.name} ${u.userId}`.toLowerCase().includes(term)) && (!st || u.status === st)), cursor: null };
    } else if (p.startsWith('/admin/users/')) out = detail(decodeURIComponent(p.split('/')[3]));
    else if (p === '/admin/payments') {
      const sum = (k: keyof Payment) => payments.reduce((a, x) => a + Number(x[k] || 0), 0);
      out = { day: q.get('day'), payments, totals: { count: payments.length, paidCents: sum('paidCents'), feeCents: sum('feeCents'), netCents: sum('netCents'), refundedCents: sum('refundedCents') } };
    } else if (p.startsWith('/admin/payments/')) out = paymentDetail(decodeURIComponent(p.split('/')[3]));
    else if (p === '/admin/stripe-log') out = { day: q.get('day'), entries: calls.filter((c) => (q.get('failed') !== '1' || !c.ok) && (!q.get('user') || c.userId === q.get('user'))) };
    else if (p === '/admin/webhooks') out = { day: q.get('day'), entries: hooks.filter((h) => q.get('failed') !== '1' || h.status !== 'ok') };
    else if (p.startsWith('/admin/webhooks/')) out = { eventId: p.split('/')[3], type: 'payment_intent.succeeded', status: 'ok', at: iso(5), result: 'credited' };
    else if (p === '/admin/audit') out = { day: q.get('day'), entries: audit.filter((a) => (!q.get('actor') || a.actor === q.get('actor')) && (!q.get('target') || a.target === q.get('target'))) };
    else if (p === '/admin/support') {
      const st = q.get('status') || 'open';
      out = { requests: tickets.filter((t) => st === 'all' || t.status === st), counts: { open: 2, closed: 1 } };
    } else if (p === '/admin/health') out = health;
    else if (p === '/admin/config') out = config;
    else if (p === '/admin/config/stripe') out = { mode: 'test', webhookSecret: true, secretName: 'yourapp/test/stripe', priceOverrides: { starter: '', pro: '' } };
    else if (p === '/admin/items') out = { items, cursor: null };
  } else if (p === '/admin/config' && method === 'PUT') {
    out = { ...config, ...JSON.parse(String(init.body || '{}')) };
  } else if (p.startsWith('/admin/support/')) {
    out = tickets.find((t) => t.id === p.split('/')[3]) ?? tickets[0];
  }
  return new Promise((resolve) => setTimeout(() => resolve(out), 150));
}

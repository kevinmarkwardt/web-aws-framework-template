// Shapes of the admin API's answers (api/routes/admin.py, api/routes/support.py).
import type { AccountStatus, BillingMode } from '@yourapp/shared';

export type { AccountStatus, BillingMode };

export interface PlanInfo {
  id: string;
  name: string;
  monthlyUsd: number;
  limits: Record<string, number | null>;
  features?: string[];
}

export interface CreditPack {
  id: string;
  usd: number;
  payCents: number;
  bonus: number;
  credits: number;
  bonusPct: number;
}

/** GET /api/admin/me */
export interface AdminMe {
  userId: string;
  email: string;
  name: string;
  stage: 'prod' | 'test' | string;
  siteUrl: string;
  billingMode: BillingMode;
  creditName: string | null;
  plans: PlanInfo[];
  packs: CreditPack[];
  accountRules: { warningDays: number; warningsToBan: number; banDays: number };
  supportTopics: Record<string, string>;
}

export interface MoneyTotals {
  count: number;
  paidCents: number;
  feeCents: number;
  netCents: number;
  refundedCents: number;
}

export interface Overview {
  billingMode: BillingMode;
  days: number;
  users: { total: number; active: number; suspended: number; banned: number; admins: number; new7: number; new30: number };
  payments?: MoneyTotals & { byKind: Record<string, MoneyTotals>; disputed: number; pendingRefunds: number };
  outstanding?: { paidCredits: number; bonusCredits: number; creditName: string };
  subscriptions?: { active: number; failing: number; mrrUsd: number; byPlan: Record<string, number> };
}

export interface AdminUser {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  isAdmin: boolean;
  status: AccountStatus;
  bannedUntil: string | null;
  statusReason: string | null;
  itemCount: number;
  plan?: string;
  credits?: number;
  paidCredits?: number;
  bonusCredits?: number;
}

export interface Warning {
  sk: string;
  reason: string;
  actor: string;
  ref?: string;
  at: string;
  expiresAt: string;
  active: boolean;
  removed?: boolean;
  removedBy?: string;
}

export interface LedgerRow {
  kind: string;
  amount: number;
  paid: number;
  bonus: number;
  note: string;
  at: string;
  balanceAfter: number;
  paymentIntent?: string | null;
}

export interface Payment {
  paymentIntent: string;
  userId: string;
  kind: string;
  packId?: string;
  plan?: string;
  paidCents: number;
  credits?: number;
  bonusCredits?: number;
  feeCents: number;
  netCents: number;
  refundedCents: number;
  disputed: boolean;
  status: string;
  createdAt: string;
  receiptUrl?: string;
  card?: { brand?: string; last4?: string; expMonth?: number; expYear?: number; country?: string; funding?: string };
  risk?: { level?: string; score?: number; networkStatus?: string };
}

export interface PaymentDetail extends Payment {
  refunds: { sk: string; amountCents: number; bonusRemoved?: number; reason?: string; actor?: string; status?: string; at?: string }[];
  /** evidenceDueBy: unix seconds */
  disputes: { sk: string; amountCents: number; reason?: string; status?: string; evidenceDueBy?: number; at?: string; closedAt?: string }[];
}

export interface Refundable {
  refundable: number;
  credits: number;
  paidCredits: number;
  bonusCredits: number;
  policy: 'window' | 'all';
}

export interface UserDetail {
  user: AdminUser & { bannedAt?: string | null; bannedBy?: string | null; stripeCustomerId: string; cards: number };
  warnings: Warning[];
  notes: { id: string; kind: string; title: string; message: string; createdAt: string }[];
  accountRules: { warningDays: number; warningsToBan: number; banDays: number };
  payments?: Payment[];
  subscription?: { plan: string; effectivePlan: string; subscriptionStatus?: string | null; paymentFailedAt?: string | null; graceUntil?: string | null; hasSubscription: boolean };
  history?: LedgerRow[];
  refundable?: { window: Refundable; all: Refundable };
  pending?: { sk: string; amount: number; kind: string; note?: string; releaseAt: string }[];
  creditName?: string;
}

export type UserAction = 'ban' | 'unban' | 'suspend' | 'warn' | 'remove-warning' | 'adjust-balance' | 'refund-card' | 'admin';

export interface StripeCall {
  sk: string;
  at: string;
  op: string;
  ok: boolean;
  ms: number;
  httpStatus?: number;
  request?: string;
  response?: string;
  error?: string;
  errorCode?: string;
  stripeRequestId?: string;
  idempotencyKey?: string;
  userId?: string;
  actor?: string;
  objectId?: string;
}

export interface WebhookRow {
  sk: string;
  eventId: string;
  type: string;
  objectId?: string;
  status: string;
  result?: string;
}

export interface AuditRow {
  sk: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
  before?: string;
  after?: string;
}

export interface Ticket {
  id: string;
  userId: string;
  email: string;
  topic: string;
  topicLabel: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  replies: { at: string; by: string; text: string }[];
}

export interface LambdaHealth {
  function: string;
  invocations: number;
  errors: number;
  throttles: number;
  avgMs: number;
  p95Ms: number;
}

export interface Health {
  stage: string;
  region: string;
  at: string;
  lambda: Record<string, LambdaHealth> | { error: string };
  dynamodb:
    | { table: string; status: string; itemCount: number; sizeBytes: number; billing: string; indexes: { name: string; status: string }[]; throttled24h: number }
    | { error: string };
  ses:
    | { sender: string; max24h: number; sent24h: number; maxPerSecond: number; productionAccess: boolean | null;
        last14d: { deliveryattempts: number; bounces: number; complaints: number; rejects: number } }
    | { error: string };
  app: { failedWebhooksToday: number; pendingRefunds: number; openSupport: number };
}

export interface SiteConfig {
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  jobsEnabled: boolean;
  alertsEnabled: boolean;
  planLimits: Record<string, number | null>;
  jobSettings: { dailyJobHourUtc: number; hourlyJobEnabled: boolean; rateLimitDelayMs: number };
  emailTemplates: Record<string, string>;
}

export interface StripeConfig {
  mode: 'live' | 'test' | 'missing';
  webhookSecret: boolean;
  secretName: string;
  priceOverrides: Record<string, string>;
}

export interface AdminItem {
  itemId: string;
  userId: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

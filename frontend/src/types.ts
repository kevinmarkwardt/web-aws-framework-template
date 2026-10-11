/** A plan id: "free" or one of api/lib/config.PAID_PLANS (the API's public-config lists them). */
export type Plan = string;

export type BillingMode = 'none' | 'subscriptions' | 'credits' | 'both';
export type AccountStatus = 'active' | 'suspended' | 'banned';

export interface UserSettings {
  alertsEnabled: boolean;
  digestEnabled: boolean;
  remindersEnabled: boolean;
}

export interface AutoReload {
  on: boolean;
  below: number;
  packId: string;
  maxPerDay: number;
}

export interface SubscriptionState {
  plan: Plan;
  /** free once a failed renewal's grace period has run out */
  effectivePlan: Plan;
  subscriptionStatus?: string | null;
  paymentFailedAt?: string | null;
  graceUntil?: string | null;
  hasSubscription: boolean;
}

export interface User {
  userId: string;
  email: string;
  name: string;
  /** The plan in effect (api/lib/subscriptions.effective_plan). */
  plan: Plan;
  itemCount: number;
  /** This user's plan limit; null = unlimited. From the admin config (api/lib/config.py), never hardcoded here. */
  itemLimit: number | null;
  /** Every plan's item limit (null = unlimited), for the plan picker. */
  planLimits: Record<Plan, number | null>;
  createdAt?: string;
  settings: UserSettings;
  isAdmin?: boolean;
  status: AccountStatus;
  bannedUntil?: string | null;
  statusReason?: string | null;
  activeWarnings?: number;
  billingMode: BillingMode;
  subscription?: SubscriptionState;
  // credits mode only
  credits?: number;
  paidCredits?: number;
  bonusCredits?: number;
  creditName?: string;
  autoReload?: AutoReload;
  hasToppedUp?: boolean;
}

export interface PlanInfo {
  id: Plan;
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

export interface PublicConfig {
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  planLimits: Record<Plan, number | null>;
  billingMode: BillingMode;
  plans?: PlanInfo[];
  credits?: {
    creditName: string;
    perDollar: number;
    packs: CreditPack[];
    custom: { minUsd: number; maxUsd: number } | null;
    creditCosts: Record<string, number>;
    signupGift: number;
    refundDays: number;
  };
}

export interface LedgerRow {
  kind: string;
  amount: number;
  paid: number;
  bonus: number;
  note: string;
  at: string;
  balanceAfter: number;
  payCents?: number | null;
}

export interface Wallet {
  credits: number;
  paidCredits: number;
  bonusCredits: number;
  creditName: string;
  perDollar: number;
  refundable: number;
  refundDays: number;
  pendingCredits: number;
  pending: { amount: number; kind: string; note: string; releaseAt: string }[];
  status: AccountStatus;
  bannedUntil?: string | null;
  transactions: LedgerRow[];
  packs: CreditPack[];
  custom: { minUsd: number; maxUsd: number } | null;
  creditCosts: Record<string, number>;
  autoReload: AutoReload;
  referralCode: string | null;
  testMode: boolean;
  canPay: boolean;
  localCurrency: { currency: string; perUsd: string } | null;
}

export interface ChargeResult {
  status: 'succeeded' | 'requires_action' | 'processing';
  paymentIntent: string;
  redirectUrl?: string;
  credits?: number;
}

export interface RefundRow {
  paymentIntent: string;
  createdAt: string;
  refundUntil?: string;
  card: { brand?: string; last4?: string };
  paidCents: number;
  credits: number;
  bonusCredits: number;
  bonusNow: number;
  refundedCents: number;
  usedCredits: number;
  refundable: number;
  partial: boolean;
  /** why nothing can be refunded now ("" when it can) */
  reason: string;
  refundableFrom?: string | null;
  clearingCents: number;
  deductions: { at: string | null; kind: string; note: string; amount: number }[];
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  country: string | null;
  accepted: boolean;
  isDefault: boolean;
}

export interface AccountNote {
  id: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string;
}

export interface Item {
  itemId: string;
  userId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemRequest {
  name: string;
  status?: string;
}

export interface UpdateItemRequest {
  name?: string;
  status?: string;
}

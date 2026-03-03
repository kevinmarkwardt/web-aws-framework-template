import type { Link, Pitch, User } from './types';

export interface AdminOverview {
  totalUsers: number;
  planCounts: { free: number; starter: number; pro: number };
  totalLinks: number;
  statusCounts: Record<string, number>;
  mrr: number;
}

export interface UserDetail {
  user: User;
  links: Link[];
  pitches: Pitch[];
}

export interface LambdaStats {
  invocations: number;
  errors: number;
  avgDurationMs: number;
}

export interface HealthData {
  lambda: Record<string, LambdaStats>;
  dynamodb: {
    itemCount: number;
    tableSizeBytes: number;
    provisionedRCU: number;
    provisionedWCU: number;
  };
  ses: {
    deliveryAttempts: number;
    bounces: number;
    complaints: number;
    rejects: number;
  };
}

export interface SiteConfig {
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  crawlingEnabled: boolean;
  alertsEnabled: boolean;
  planLimits: { free: number; starter: number; pro: number };
  crawlSettings: {
    dailyCrawlHourUtc: number;
    hourlyCrawlEnabled: boolean;
    rateLimitDelayMs: number;
  };
  emailTemplates: Record<string, string>;
  pricingDisplay: Record<string, { name: string; price: number; features: string[] }>;
}

export interface StripeConfig {
  starterPriceId: string;
  proPriceId: string;
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  hasPublishableKey: boolean;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
}

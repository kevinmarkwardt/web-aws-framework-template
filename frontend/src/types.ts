export type Plan = 'free' | 'starter' | 'pro';

export interface UserSettings {
  alertsEnabled: boolean;
  digestEnabled: boolean;
  remindersEnabled: boolean;
}

export interface User {
  userId: string;
  email: string;
  name: string;
  plan: Plan;
  itemCount: number;
  /** This user's plan limit; null = unlimited. From the admin config (api/lib/config.py), never hardcoded here. */
  itemLimit: number | null;
  /** Every plan's item limit (null = unlimited), for the plan picker. */
  planLimits: Record<Plan, number | null>;
  createdAt?: string;
  settings: UserSettings;
}

export interface PublicConfig {
  maintenanceMode: boolean;
  signupsEnabled: boolean;
  planLimits: Record<Plan, number | null>;
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

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
  createdAt?: string;
  settings: UserSettings;
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

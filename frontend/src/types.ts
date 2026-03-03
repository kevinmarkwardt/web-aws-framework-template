export type LinkStatus = 'LIVE' | 'MISSING' | '404' | 'REDIRECT' | 'ERROR' | 'PENDING';

export type PipelineStatus =
  | 'PITCHED'
  | 'FOLLOW_UP_DUE'
  | 'ACCEPTED'
  | 'DRAFT_SUBMITTED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'UNRESPONSIVE';

export type Plan = 'free' | 'starter' | 'pro';

export interface StatusHistoryEntry {
  date: string;
  status: LinkStatus;
  httpCode?: number;
}

export interface Link {
  linkId: string;
  userId?: string;
  pageUrl: string;
  destinationUrl: string;
  anchorText?: string;
  status: LinkStatus;
  lastChecked: string;
  firstAdded: string;
  statusHistory: StatusHistoryEntry[];
  jsWarning?: boolean;
}

export interface Pitch {
  pitchId: string;
  userId?: string;
  domain: string;
  contactName: string;
  contactEmail: string;
  pitchSentDate: string;
  status: PipelineStatus;
  publishedUrl?: string;
  publishedDate?: string;
  notes: string;
  linkedLinkId?: string;
}

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
  linkCount: number;
  createdAt?: string;
  settings: UserSettings;
}

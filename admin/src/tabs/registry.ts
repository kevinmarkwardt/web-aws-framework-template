// The admin site's tab registry: every sidebar entry is a registered tab, so an app adds its own tabs without editing
// the layout. Built-in tabs are registered in tabs/builtin.ts; register yours in tabs/app.ts:
//
//   registerTab({ id: 'orders', label: 'Orders', icon: 'items', section: 'Data',
//                 component: lazy(() => import('./OrdersTab')) });
//
// A tab is a React component (lazy-loaded is best) shown at /<id>. Call your app's admin routes with apiFetch from
// api.ts; add them to ROUTES in api/admin_handler.py, where the admin check has already run.
import type { ComponentType, LazyExoticComponent } from 'react';
import { creditsOn, subscriptionsOn } from '@yourapp/shared';
import type { IconName } from '../icons';
import type { AdminMe } from '../types';

/** Sidebar groups, in order. A tab may name another section; it is listed after these. */
export const SECTIONS = ['Overview', 'People', 'Money', 'Data', 'System'] as const;

export interface AdminTab {
  /** URL segment and key (/users, /payments, ...); unique */
  id: string;
  label: string;
  icon: IconName;
  section: (typeof SECTIONS)[number] | string;
  component: ComponentType | LazyExoticComponent<ComponentType>;
  /** Billing modules the tab needs: 'any' (billing not none), 'credits', 'subscriptions'. Hidden otherwise. */
  billing?: 'any' | 'credits' | 'subscriptions';
  /** Any other condition (the signed-in admin and what the site sells). */
  visible?: (me: AdminMe) => boolean;
  /** Order inside its section (lower first; default 100). */
  order?: number;
}

const tabs = new Map<string, AdminTab>();

/** Add a tab, or replace the one with the same id. */
export function registerTab(tab: AdminTab): void {
  tabs.set(tab.id, tab);
}

export function unregisterTab(id: string): void {
  tabs.delete(id);
}

function billingAllows(tab: AdminTab, me: AdminMe): boolean {
  if (!tab.billing) return true;
  if (tab.billing === 'any') return me.billingMode !== 'none';
  return tab.billing === 'credits' ? creditsOn(me.billingMode) : subscriptionsOn(me.billingMode);
}

/** The tabs this admin sees, in sidebar order. */
export function visibleTabs(me: AdminMe): AdminTab[] {
  const sectionRank = (s: string) => {
    const i = (SECTIONS as readonly string[]).indexOf(s);
    return i === -1 ? SECTIONS.length : i;
  };
  return [...tabs.values()]
    .filter((t) => billingAllows(t, me) && (t.visible ? t.visible(me) : true))
    .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.section.localeCompare(b.section) || (a.order ?? 100) - (b.order ?? 100));
}

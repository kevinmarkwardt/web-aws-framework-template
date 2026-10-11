// The admin site's tab registry: every sidebar entry is a registered tab, so an app adds its own tabs without editing
// the layout. Built-in tabs are registered in tabs/builtin.ts; register yours in tabs/app.ts:
//
//   registerTab({ id: 'orders', label: 'admin.tabs.orders', icon: 'items', section: 'admin.sections.data',
//                 component: lazy(() => import('./OrdersTab')) });
//
// `label` and `section` are i18n keys: add their English text to packages/shared/src/locales/en/admin*.json (the
// built-ins are in admin.json); the layout shows them with t(). A key with no text shows as written.
//
// A tab is a React component (lazy-loaded is best) shown at /<id>. Call your app's admin routes with apiFetch from
// api.ts; add them to ROUTES in api/admin_handler.py, where the admin check has already run.
import type { ComponentType, LazyExoticComponent } from 'react';
import { creditsOn, subscriptionsOn } from '@yourapp/shared';
import type { IconName } from '../icons';
import type { AdminMe } from '../types';

/** Sidebar groups (i18n keys), in order. A tab may name another section; it is listed after these. */
export const SECTIONS = ['admin.sections.overview', 'admin.sections.people', 'admin.sections.money', 'admin.sections.data', 'admin.sections.system'] as const;

export interface AdminTab {
  /** URL segment and key (/users, /payments, ...); unique */
  id: string;
  /** i18n key of the sidebar text (packages/shared/src/locales/en/admin*.json) */
  label: string;
  icon: IconName;
  /** i18n key of the sidebar group: one of SECTIONS, or your own key */
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

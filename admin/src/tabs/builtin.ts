// The platform tabs every site gets. Your app's own tabs go in tabs/app.ts. Labels and sections are i18n keys
// (packages/shared/src/locales/en/admin.json).
import { lazy } from 'react';
import { registerTab } from './registry';

registerTab({ id: 'overview', label: 'admin.tabs.overview', icon: 'overview', section: 'admin.sections.overview', order: 0, component: lazy(() => import('./OverviewTab')) });
registerTab({ id: 'users', label: 'admin.tabs.users', icon: 'users', section: 'admin.sections.people', order: 10, component: lazy(() => import('./UsersTab')) });
registerTab({ id: 'support', label: 'admin.tabs.support', icon: 'support', section: 'admin.sections.people', order: 20, component: lazy(() => import('./SupportTab')) });
registerTab({ id: 'payments', label: 'admin.tabs.payments', icon: 'payments', section: 'admin.sections.money', order: 10, billing: 'any', component: lazy(() => import('./PaymentsTab')) });
registerTab({ id: 'stripe-log', label: 'admin.tabs.stripeLog', icon: 'log', section: 'admin.sections.money', order: 20, billing: 'any', component: lazy(() => import('./StripeLogTab')) });
registerTab({ id: 'audit', label: 'admin.tabs.audit', icon: 'audit', section: 'admin.sections.system', order: 10, component: lazy(() => import('./AuditTab')) });
registerTab({ id: 'health', label: 'admin.tabs.health', icon: 'health', section: 'admin.sections.system', order: 20, component: lazy(() => import('./HealthTab')) });
registerTab({ id: 'config', label: 'admin.tabs.config', icon: 'config', section: 'admin.sections.system', order: 30, component: lazy(() => import('./ConfigTab')) });

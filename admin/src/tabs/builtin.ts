// The platform tabs every site gets. Your app's own tabs go in tabs/app.ts.
import { lazy } from 'react';
import { registerTab } from './registry';

registerTab({ id: 'overview', label: 'Overview', icon: 'overview', section: 'Overview', order: 0, component: lazy(() => import('./OverviewTab')) });
registerTab({ id: 'users', label: 'Users', icon: 'users', section: 'People', order: 10, component: lazy(() => import('./UsersTab')) });
registerTab({ id: 'support', label: 'Support', icon: 'support', section: 'People', order: 20, component: lazy(() => import('./SupportTab')) });
registerTab({ id: 'payments', label: 'Payments', icon: 'payments', section: 'Money', order: 10, billing: 'any', component: lazy(() => import('./PaymentsTab')) });
registerTab({ id: 'stripe-log', label: 'Stripe log', icon: 'log', section: 'Money', order: 20, billing: 'any', component: lazy(() => import('./StripeLogTab')) });
registerTab({ id: 'audit', label: 'Audit log', icon: 'audit', section: 'System', order: 10, component: lazy(() => import('./AuditTab')) });
registerTab({ id: 'health', label: 'Health', icon: 'health', section: 'System', order: 20, component: lazy(() => import('./HealthTab')) });
registerTab({ id: 'config', label: 'Config', icon: 'config', section: 'System', order: 30, component: lazy(() => import('./ConfigTab')) });

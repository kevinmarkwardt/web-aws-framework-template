// Your app's admin tabs. Register them here (see tabs/registry.ts); they appear in the sidebar under their section.
// The template's example entity ("items") is one: replace it with your own entity's tab.
import { lazy } from 'react';
import { registerTab } from './registry';

registerTab({ id: 'items', label: 'Items', icon: 'items', section: 'Data', component: lazy(() => import('./ItemsTab')) });

// Your app's admin tabs. Register them here (see tabs/registry.ts); they appear in the sidebar under their section.
// `label` and `section` are i18n keys: put their English text in packages/shared/src/locales/en/admin*.json.
// The template's example entity ("items") is one: replace it with your own entity's tab.
import { lazy } from 'react';
import { registerTab } from './registry';

registerTab({ id: 'items', label: 'admin.tabs.items', icon: 'items', section: 'admin.sections.data', component: lazy(() => import('./ItemsTab')) });

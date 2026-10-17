// Your app's admin tabs. Register them here (see tabs/registry.ts); they appear in the sidebar under their section:
//   import { lazy } from 'react';
//   import { registerTab } from './registry';
//   registerTab({ id: 'orders', label: 'admin.tabs.orders', icon: 'items', section: 'admin.sections.data',
//                 component: lazy(() => import('./OrdersTab')) });
// `label` and `section` are i18n keys: put their English text in packages/shared/src/locales/en/admin*.json.
// The spec's entities register their tabs in entities.gen.ts (scripts/new-entity.py). The template's example entity
// ("items") is the lines marked example:items: scripts/init.py removes them once the spec has entities.
import { lazy } from 'react'; // example:items
import { registerTab } from './registry'; // example:items
import './entities.gen';

registerTab({ id: 'items', label: 'admin.tabs.items', icon: 'items', section: 'admin.sections.data', component: lazy(() => import('./ItemsTab')) }); // example:items

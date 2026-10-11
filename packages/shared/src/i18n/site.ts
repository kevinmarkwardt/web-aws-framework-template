/** The user site's texts: every area except the admin site's (`admin*.json`). Imported once, first, by
 *  frontend/src/main.tsx. */
import { setupI18n, type Tree } from './setup';

setupI18n({
  english: import.meta.glob<Tree>(['../locales/en/*.json', '!../locales/en/admin*.json'], { eager: true, import: 'default' }),
  others: import.meta.glob<Tree>(['../locales/*/*.json', '!../locales/en/*.json', '!../locales/*/admin*.json'], { import: 'default' }),
});

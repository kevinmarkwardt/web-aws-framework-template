/** The admin site's texts: the shared areas both sites use (`common.json`) and the admin site's own (`admin*.json`).
 *  Imported once, first, by admin/src/main.tsx. The admin site ships in English; its texts go through t() so it can be
 *  translated like the user site. */
import { setupI18n, type Tree } from './setup';

setupI18n({
  english: import.meta.glob<Tree>(['../locales/en/common.json', '../locales/en/admin*.json'], { eager: true, import: 'default' }),
  others: import.meta.glob<Tree>(['../locales/*/common.json', '../locales/*/admin*.json', '!../locales/en/*.json'], { import: 'default' }),
});

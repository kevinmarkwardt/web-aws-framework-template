// Written by scripts/init.py from site.spec.yaml (site, modules). Don't edit: change the spec and re-run init.py.
// What both sites may know before the API answers. The API's own copy is api/site.json; what is sold (plans, packs,
// prices) always comes from the API (GET /api/public-config), never from here. Languages: i18n/languages.ts.

export const SITE_CONFIG = {
  name: 'yourapp',
  displayName: 'YourApp',
  domain: 'yourapp.com',
  tagline: '',
  description: '',
  /** modules.billing.mode: what the mock account (MOCK_AUTH) and design previews assume */
  billingMode: 'both' as 'none' | 'subscriptions' | 'credits' | 'both',
  creditName: 'credits',
  /** modules.support: the Support pages (the API answers 404 when off) */
  support: true,
};

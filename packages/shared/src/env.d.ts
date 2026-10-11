/// <reference types="vite/client" />

// Build-time settings both apps read (each app's .env.example). scripts/deploy.sh writes .env.production.local per
// stage; scripts/local-test.sh writes .env.local-{stage}.local.
interface ImportMetaEnv {
  readonly VITE_STAGE?: 'prod' | 'test';
  readonly VITE_USER_POOL_ID?: string;
  readonly VITE_CLIENT_ID?: string;
  /** '1' on the test stage only: username login via POST /api/test-login (the user site only) */
  readonly VITE_TEST_LOGIN?: string;
  /** The user site: the admin site's URL, for the Admin link admins see */
  readonly VITE_ADMIN_URL?: string;
  /** The user site's URL (the admin site's "Open the site" link; the user site's sitemap.xml and robots.txt) */
  readonly VITE_SITE_URL?: string;
  /** The user site's Google tags (frontend/site-plugins.ts): GA4 measurement id, AdSense client, consent regions */
  readonly VITE_GA4_ID?: string;
  readonly VITE_ADSENSE_CLIENT?: string;
  readonly VITE_CONSENT_REGIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

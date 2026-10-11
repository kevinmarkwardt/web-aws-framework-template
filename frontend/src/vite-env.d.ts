/// <reference types="vite/client" />

// Build-time settings (frontend/.env.example). scripts/deploy.sh writes .env.production.local per stage;
// scripts/local-test.sh writes .env.local-{stage}.local.
interface ImportMetaEnv {
  readonly VITE_STAGE?: 'prod' | 'test';
  readonly VITE_USER_POOL_ID?: string;
  readonly VITE_CLIENT_ID?: string;
  /** '1' on the test stage only: username login via POST /api/test-login */
  readonly VITE_TEST_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

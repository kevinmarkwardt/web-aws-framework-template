/// <reference types="vite/client" />

// Build-time settings (frontend/.env.example) are declared once for both sites in packages/shared/src/env.d.ts
// (tsconfig.app.json includes it). scripts/deploy.sh writes .env.production.local per stage; scripts/local-test.sh
// writes .env.local-{stage}.local.

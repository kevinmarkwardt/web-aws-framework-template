# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

| Item | Value |
|------|-------|
| Domain | linkkeeper.co |
| Admin | manager.linkkeeper.co |
| AWS Account | 177913614409 |
| Region | us-east-1 |
| CDK Stack | LinkKeeperStack |
| Spec | SPEC.md |

## Commands

### Frontend

```bash
cd frontend
npm run dev         # Vite dev server (proxies /api/* to localhost:3000)
npm run build       # TypeScript check + Vite build
npm run lint        # ESLint
npm run preview     # Serve dist/ locally
```

### Backend Tests

```bash
python -m pytest tests/                     # All tests
python -m pytest tests/test_api_links.py    # Single file
python -m pytest tests/test_crawler.py -k "test_missing_link"  # Single test
```

Uses pytest + moto (`@mock_aws`) for AWS mocking. No frontend tests exist yet.

### Deploy

```bash
./scripts/deploy.sh                         # Full: deps + CDK + frontend + S3 sync + CF invalidation
./scripts/deploy-frontend.sh                # Frontend only (requires cdk-outputs.json)
./scripts/deploy-lambdas.sh                 # All Lambdas
./scripts/deploy-lambdas.sh linkkeeper-api  # Single Lambda by function name
```

### CDK

```bash
cd cdk
npx cdk synth     # Generate CloudFormation template
npx cdk diff      # Preview changes
npx cdk deploy    # Deploy stack
```

### Admin Setup

```bash
./scripts/setup-admin.sh   # Create/update admin credentials in Secrets Manager
```

## Architecture

### Two Apps, One Bundle

The frontend serves both the user app (`linkkeeper.co`) and admin app (`manager.linkkeeper.co`) from the same S3 bucket and CloudFront distribution. `App.tsx` checks `window.location.hostname.startsWith('manager.')` to decide which app to render. Admin pages are lazy-loaded to avoid bloating the user bundle.

### API Routing (No Framework)

`api/handler.py` uses manual `if` statements and `re.match()` — no Flask/FastAPI. Three routing tiers:

1. **OPTIONS** — CORS preflight, immediate 200
2. **`/api/webhooks/stripe`** — bypasses JWT auth, verified by Stripe signature
3. **`/api/admin/*`** — separate admin JWT auth (Secrets Manager-based)
4. **Everything else** — Cognito JWT auth, `user_id` extracted from token `sub` claim

The Lambda supports both Function URL format and API Gateway v1 format (for local testing).

### Auth Systems

**User auth:** Cognito via AWS Amplify v6 on frontend. The frontend sends the **ID token** (not access token) as `Bearer` — the backend reads `sub`, `email`, and `name` claims from it. JWT verification uses JWKS downloaded from Cognito (cached 1 hour in module-level global).

**Admin auth:** Completely separate. Credentials (email + bcrypt hash + JWT secret) stored in Secrets Manager at `linkkeeper/admin-credentials`. Login returns a 24-hour HS256 JWT stored in memory (not localStorage — lost on page refresh).

### DynamoDB (Single Table)

Table name: `linkkeeper`. All items use `pk`/`sk` string keys.

| Entity | pk | sk |
|--------|----|----|
| User profile | `USER#{userId}` | `PROFILE` |
| Link | `USER#{userId}` | `LINK#{linkId}` |
| Pitch | `USER#{userId}` | `PITCH#{pitchId}` |
| Site config | `CONFIG` | `GLOBAL` |
| Stripe config | `CONFIG` | `STRIPE` |

**GSIs:** `email-index` (pk=email), `stripe-customer-index` (pk=stripeCustomerId)

**Plan limits:** `{"free": 5, "starter": 50, "pro": float("inf")}` — enforced via denormalized `linkCount` on user profile, atomically incremented/decremented on link create/delete.

### Stripe Config Split

- **Keys** (secret, publishable, webhook) → Secrets Manager at `linkkeeper/stripe`, cached 5 min
- **Price IDs** (starter, pro) → DynamoDB at `CONFIG/STRIPE`, cached 5 min
- `invalidate_caches()` in billing.py clears both caches (called by admin after config updates)

### Lambda Packaging

Source directories (`api/`, `lambdas/*/`) contain only `.py` files in git. Dependencies are installed into those dirs at deploy time (Linux ARM64 wheels via `--platform manylinux2014_aarch64`). Installed packages are gitignored.

## Key Patterns

### Python Import Duality

All API modules use try/except imports to support both contexts:
- **Deployed:** `handler.py` at root, `from lib.auth import ...`
- **Tests:** run from project root, `from api.lib.auth import ...`

### Test Fixtures

`conftest.py` sets `TABLE_NAME=linkkeeper-test` before imports. Resets `api.lib.db._table = None` before/after each test to prevent the module-level DynamoDB singleton from holding stale moto references.

Factory fixtures (`create_test_user`, `create_test_link`, `create_test_pitch`) are callables — call with kwargs to customize.

### Response Format

All API responses use `lib/response.py`: `ok(body, status)` and `error(message, status)`. Both return `{"statusCode": N, "headers": {CORS}, "body": JSON string}`. `DecimalEncoder` handles DynamoDB Decimal types.

### User Auto-Provisioning

No explicit user creation endpoint. `GET /api/account` auto-creates the DynamoDB user profile on first call by reading `email` and `name` from the JWT ID token claims.

### Status History

Link `statusHistory` is a DynamoDB list attribute appended with `list_append(if_not_exists(..., :empty), :hist)`. Grows unbounded — no pruning.

### CSV Upload

Sent as `Content-Type: text/csv` with raw text body (not multipart/form-data), because Lambda Function URLs don't handle multipart natively.

### Admin Request Body Parsing

CloudFront may base64-encode request bodies without setting `isBase64Encoded=True`. The admin route parser falls back to trying base64 decode if JSON parse fails.

## Stack

**Frontend:** React 19, TypeScript 5.9, Vite, Tailwind CSS v4 (plugin-based, no config file), React Router v7, AWS Amplify v6 (auth only)

**Backend:** Python 3.12, Lambda ARM64 (Graviton2), 128MB default (crawler 256MB, report-gen 512MB)

**Infra:** CDK (TypeScript), DynamoDB provisioned 25 RCU/WCU (free tier), CloudFront + S3, Lambda Function URLs (no API Gateway), SES, Cognito, EventBridge, Bedrock (Claude Haiku for Pro features), Stripe

## Environment Variables

`frontend/.env` is auto-generated by deploy scripts from `cdk-outputs.json`:
```
VITE_USER_POOL_ID=...
VITE_CLIENT_ID=...
```

Root `.env.example` has Stripe keys for local dev context. Lambda env vars (TABLE_NAME, USER_POOL_ID, etc.) are set by CDK.

# CLAUDE.md — web-aws-framework-template

## What This Is

A reusable AWS SaaS starter built from a working production app. Clone via GitHub template, run `./scripts/init.sh`, and you have a deployable SaaS with auth, billing, admin, email and AI, in two stages (test and prod).

Roadmap: [docs/plans/2026-10-11-template-v2-plan.md](docs/plans/2026-10-11-template-v2-plan.md) (phase 0 "clean foundation" is done).

## Placeholder Values

All project-specific values use these placeholders (replaced by `init.sh`):

| Placeholder | Replaced with |
|-------------|--------------|
| `yourapp` | Project name (lowercase) |
| `YourApp` | Display name (title case) |
| `yourapp.com` | Your domain |
| `manager.yourapp.com` | Admin subdomain |
| `YOUR_AWS_ACCOUNT_ID` | AWS account ID |

To find all placeholder occurrences:
```bash
grep -r "yourapp" --include="*.ts" --include="*.py" --include="*.json" --include="*.sh" .
```

## Stages

| | prod | test |
|---|---|---|
| CDK | `-c stage=prod` (default) → `YourAppStack` | `-c stage=test` → `YourAppTestStack` |
| Site / admin | `yourapp.com` (+ `www.`) / `manager.yourapp.com` | `test.yourapp.com` / `manager.test.yourapp.com` |
| Resource names | original (`yourapp`, `yourapp-api`, ...) | `-test` suffix (`yourapp-test`, `yourapp-test-api`, ...) |
| DynamoDB / removal | provisioned 25/25, RETAIN, PITR | on demand, DESTROY |
| Secrets | `yourapp/prod/*` | `yourapp/test/*` (+ `yourapp/test/test-login`, generated) |
| Sign-in | Cognito | Cognito, or username-only test login |
| Search engines | indexed | `X-Robots-Tag: noindex` |
| Outputs file | `cdk-outputs-prod.json` | `cdk-outputs-test.json` |

Each stage's API role can read only its own `yourapp/{stage}/*` secrets.

## Commands

### Frontend

```bash
cd frontend
npm run dev         # Vite dev server (proxies /api/* to localhost:3000); MOCK_AUTH when no Cognito pool is configured
npm run build       # TypeScript check + Vite build
npm run lint        # ESLint (must stay clean)
```

### Backend Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt && .venv/bin/pip install -r tests/requirements-test.txt
.venv/bin/python -m pytest tests/                         # all tests
.venv/bin/python -m pytest tests/test_api_items.py -k create
```

Two separate `pip install` calls: `api/requirements.txt` is hash-locked and pip refuses to mix it with unhashed files. Uses pytest + moto (`mock_aws`); no real AWS calls. No frontend tests.

### Deploy (STAGE is required)

```bash
STAGE=test ./scripts/deploy.sh                 # Lambdas + CDK + site + CloudFront invalidation
STAGE=test ./scripts/deploy.sh --infra-only    # Lambdas + CDK only
STAGE=test ./scripts/deploy-frontend.sh        # site only (same as --site-only)
STAGE=test ./scripts/deploy-lambdas.sh [api]   # Lambda code only (no CDK)
STAGE=prod ./scripts/deploy.sh                 # asks you to type "prod" (YES=1 skips, for CI)
STAGE=test ./scripts/setup-admin.sh you@example.com   # admin login for manager.test.yourapp.com
```

### Local loop against a deployed stage

```bash
scripts/local-test.sh api     # API from the working tree on 127.0.0.1:3000 (restarts on save), test stage's AWS resources
scripts/local-test.sh web     # Vite on localhost:5173 with the test stage's Cognito ids + test login
```

`STAGE=prod` works for both but reads and writes prod data.

### CDK

```bash
scripts/bundle-lambdas.sh               # build/api and build/<worker> (synth needs them)
cd cdk
npx cdk synth -c stage=test             # needs AWS credentials: the hosted-zone lookup
npx cdk diff -c stage=prod
```

### Python dependencies

Edit `api/requirements.in`, then `scripts/lock-api-deps.sh` rewrites `api/requirements.txt` (exact versions + hashes). Never edit `requirements.txt` by hand.

## Architecture Decisions (Don't Change These Lightly)

**Lambda Function URLs instead of API Gateway:** Avoids $3.50/million request overhead. CORS is handled manually in `api/lib/response.py` (origin = the stage's `FRONTEND_URL`). Both Lambda Function URL and API Gateway v1 event formats are supported.

**X-Origin-Verify:** The Function URL is public. CloudFront adds `X-Origin-Verify` (the stack id, never in the repo) to every `/api/*` request, and `api/lib/params.from_cloudfront` refuses requests without it (403). Unset locally and in tests, so everything passes there.

**CloudFront:** `/api/*` uses a cache policy keyed on `Authorization` with TTL 0 (nothing is cached unless the API sends `Cache-Control`). No distribution-wide error pages: the viewer-request function rewrites extensionless paths to `/index.html`, so API 403/404 JSON reaches the client unchanged.

**DynamoDB single-table design:** Everything in one table with `pk`/`sk` composite keys. Prefixes: `USER#`, `ITEM#`, `CONFIG`. One GSI (`stripe-customer-index`). Add GSIs when you need to query by non-key attributes.

**Cognito ID token (not Access token):** The frontend sends the ID token as `Bearer`. `verify_token` accepts only tokens for this app client (`aud` for ID tokens, `client_id` for access tokens).

**Dual-app single bundle:** User app + admin app in one React build, split by hostname (`manager.*` → admin). Admin pages are lazy-loaded. (Phase 3 of the plan moves admin to its own site and Lambda.)

**Admin auth is separate from Cognito:** Admin JWT (HS256) secret lives in Secrets Manager `yourapp/{stage}/admin-credentials`, read through a 5-minute cache. (Phase 3 retires this.)

**ARM64 Lambda:** All Lambdas run on Graviton (ARM64). `scripts/bundle-lambdas.sh` installs `manylinux2014_aarch64` wheels into `build/`, which is what CDK deploys; a pip error stops the deploy.

## Site Config (admin-editable)

`CONFIG | GLOBAL` holds feature toggles, plan limits, job settings and email templates. `api/lib/config.py` merges it over `DEFAULT_CONFIG`, validates admin saves (merging one section at a time) and caches it 30 s per Lambda container.

- **Plan limits** (`planLimits`, `null` = unlimited) are the only source: item create and billing downgrade/cancel enforce them; the frontend reads them from `GET /api/account` (`itemLimit`, `planLimits`) or `GET /api/public-config`. Never hardcode limits in the frontend.
- **`maintenanceMode`**: every user route answers 503 `{"code": "MAINTENANCE"}`. Admin routes, `/api/public-config`, `/api/test-login` and Stripe webhooks keep working.
- **`signupsEnabled: false`**: `GET /api/account` refuses to create profiles for new accounts (403 `SIGNUPS_CLOSED`); existing users are unaffected.
- **`jobsEnabled: false`**: `lambdas/daily-job` skips its run.

## Where to Add New Entities

When replacing "items" with your domain entity (e.g., "orders"):

1. **`api/lib/db.py`** — Add `get_orders()`, `create_order()`, `update_order()`, `delete_order()` using an `ORDER#` prefix, and a counter like `increment_item_count()`.
2. **`api/lib/config.py`** — Rename/add the limit in `DEFAULT_PLAN_LIMITS` if the entity is plan-limited.
3. **`api/routes/orders.py`** — Copy `api/routes/items.py`; parse bodies with `lib/params.py` (bad input → 400).
4. **`api/handler.py`** — Add `from routes import orders` and route `/api/orders` in `_route()`.
5. **`frontend/src/types.ts`**, **`frontend/src/api.ts`** — Add the type and client functions.
6. **`frontend/src/pages/dashboard/OrdersPage.tsx`**, **`frontend/src/components/OrdersTable.tsx`** — Page and table.
7. **`frontend/src/App.tsx`** and **`DashboardLayout.tsx`** — Route and nav item.
8. **`tests/test_api_orders.py`** — Write tests first. Add a `create_test_order` fixture to `conftest.py`.

## How to Add New Lambda Workers

1. Create `lambdas/my-worker/handler.py` (copy from `lambdas/daily-job/`); add `requirements.txt` only for packages beyond boto3.
2. In `cdk/lib/yourapp-stack.ts`, add a `lambda.Function` named `${prefix}-my-worker` with `code: lambdaAsset('my-worker')`, and an `events.Rule`.
3. `scripts/bundle-lambdas.sh` picks up every `lambdas/*/` folder; `deploy-lambdas.sh my-worker` updates `${prefix}-my-worker`.

## Stripe

- Keys: Secrets Manager `yourapp/{stage}/stripe` (`secretKey`, `webhookSecret`, `publishableKey`), set on the admin Billing page. Never in `.env`.
- Price IDs: `CONFIG | STRIPE` in DynamoDB, also on the admin Billing page.
- Webhook endpoint: `https://<site>/api/webhooks/stripe` (through CloudFront: direct Function URL calls are refused).

## Key Patterns

### Python Import Duality

All API modules use try/except imports to support both contexts:
- **Deployed / local API:** `handler.py` at root, `from lib.auth import ...`
- **Tests:** run from project root, `from api.lib.auth import ...`

Importing `api.handler` puts `api/` on `sys.path`, so the handler's modules are `lib.*` / `routes.*` while tests import `api.lib.*`: two module objects with separate state. `tests/conftest.py` resets the caches of both copies before every test; patch both when a test monkeypatches module state (see `tests/test_test_login.py`).

### Request parsing

`api/lib/params.py`: `body(event)` and `text(data, name)` raise `BadRequest`, which `handler.py` turns into a 400. Use them instead of `json.loads`.

### Response Format

`lib/response.py`: `ok(body, status)`, `error(message, status, code=None)`, `not_found`, `unauthorized`, `forbidden`, `unavailable`. Returns `{"statusCode": N, "headers": {CORS}, "body": JSON string}`; `code` is a machine-readable reason the frontend branches on.

### User Auto-Provisioning

No explicit user creation endpoint. `GET /api/account` auto-creates the profile on first call from the token's `email`/`name` claims (unless `signupsEnabled` is off).

### Auth modes in the frontend (`frontend/src/auth.ts`)

- **Cognito** — deployed sites.
- **TEST_LOGIN** — `VITE_TEST_LOGIN=1` (test stage only, written by the deploy/local scripts): username → `POST /api/test-login`. The API serves it only when `STAGE=test` and `TEST_LOGIN=1`.
- **MOCK_AUTH** — `npm run dev` with no `VITE_USER_POOL_ID`: any email/password, mock account, no backend.

TEST_LOGIN and MOCK_AUTH are constant `false` in prod builds, so that code is compiled out.

## Key File Map

| File | Purpose |
|------|---------|
| `cdk/bin/yourapp.ts` | Picks the stage (`-c stage=`) and stack |
| `cdk/lib/yourapp-stack.ts` | All AWS infrastructure, per stage |
| `api/handler.py` | Lambda entry point: origin check, maintenance gate, routing |
| `api/lib/config.py` | Site config defaults, validation, plan limits |
| `api/lib/params.py` | Body parsing, `from_cloudfront` |
| `api/lib/auth.py` | Cognito JWT + test-login tokens |
| `api/lib/admin_auth.py` | Admin HS256 login (Secrets Manager) |
| `api/lib/db.py` | DynamoDB helpers + entity functions |
| `api/routes/items.py` | CRUD for your main entity |
| `api/routes/billing.py` | Stripe checkout + webhooks |
| `api/routes/admin.py` | Admin endpoints |
| `lambdas/daily-job/handler.py` | Example scheduled worker |
| `frontend/src/App.tsx` | React router (user + admin apps) |
| `frontend/src/auth.ts` | Cognito / test login / mock auth |
| `frontend/src/api.ts` | API client functions |
| `frontend/src/types.ts` | TypeScript interfaces |
| `tests/conftest.py` | pytest fixtures + moto setup |
| `scripts/deploy.sh` | Per-stage deployment |
| `scripts/bundle-lambdas.sh` | Builds `build/<lambda>` |
| `scripts/local-test.sh` | Local API + site against a deployed stage |
| `scripts/lib/stage.sh`, `scripts/lib/outputs.sh` | Stage → stack/prefix; reading stack outputs |

## Environment Variables

Lambda environment variables are set by CDK (`cdk/lib/yourapp-stack.ts`) — do not set them manually. The frontend's `VITE_*` values are written by `scripts/deploy.sh` (`frontend/.env.production.local`) and `scripts/local-test.sh`; see `frontend/.env.example`. The root `.env.example` lists the shell settings the scripts use (`STAGE`, `AWS_REGION`, `YES`). No secrets go in any `.env` file.

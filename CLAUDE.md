# CLAUDE.md — web-aws-framework-template

## What This Is

A reusable AWS SaaS starter built from a working production app. Clone via GitHub template, run `./scripts/init.sh`, and you have a fully deployable SaaS with auth, billing, admin, email, and AI.

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
grep -r "yourapp" --include="*.ts" --include="*.py" --include="*.json" .
```

## Commands

### Frontend

```bash
cd frontend
npm run dev         # Vite dev server (proxies /api/* to localhost:3000)
npm run build       # TypeScript check + Vite build
npm run lint        # ESLint
```

### Backend Tests

```bash
python -m pytest tests/                          # All tests
python -m pytest tests/test_api_items.py         # Items CRUD tests
python -m pytest tests/test_api_items.py -k "test_create"  # Single test
```

Uses pytest + moto (`@mock_aws`) for AWS mocking. No frontend tests.

### Deploy

```bash
./scripts/deploy.sh                   # Full: deps + CDK + frontend + S3 sync + CF invalidation
./scripts/deploy-frontend.sh          # Frontend only (requires cdk-outputs.json)
./scripts/deploy-lambdas.sh           # All Lambdas
```

### CDK

```bash
cd cdk
npx cdk synth     # Generate CloudFormation template
npx cdk diff      # Preview changes
npx cdk deploy    # Deploy stack
```

## Architecture Decisions (Don't Change These Lightly)

**Lambda Function URLs instead of API Gateway:** Avoids $3.50/million request overhead. CORS is handled manually in `api/handler.py`. Both Lambda Function URL and API Gateway v1 formats are supported for local testing.

**DynamoDB single-table design:** Everything in one table with `pk`/`sk` composite keys. Prefixes: `USER#`, `ITEM#`, `CONFIG`. Add GSIs when you need to query by non-key attributes.

**Cognito ID token (not Access token):** The frontend sends the ID token as `Bearer`. It contains `sub` (user ID), `email`, `name` — useful for user context without extra DB calls.

**Dual-app single bundle:** User app + admin app in one React build, split by hostname (`manager.*` → admin). Admin pages are lazy-loaded.

**Admin auth is separate from Cognito:** Admin JWT lives in Secrets Manager (HS256), not in Cognito. Keeps admin access independent of user accounts.

**ARM64 Lambda:** All Lambdas run on Graviton2 (ARM64). Python dependencies must be installed with `--platform manylinux2014_aarch64` for compatibility. The deploy scripts handle this automatically.

## Where to Add New Entities

When replacing "items" with your domain entity (e.g., "links"):

1. **`api/lib/db.py`** — Add `get_links()`, `create_link()`, `update_link()`, `delete_link()` using `LINK#` prefix. Add `LINK_LIMITS` dict. Add `increment_link_count()`.
2. **`api/routes/links.py`** — Copy `api/routes/items.py`, rename functions, add domain logic.
3. **`api/handler.py`** — Add `from routes import links` and route `/api/links` in `_route()`.
4. **`frontend/src/types.ts`** — Add `Link` interface.
5. **`frontend/src/api.ts`** — Add `fetchLinks()`, `createLink()`, etc.
6. **`frontend/src/pages/dashboard/LinksPage.tsx`** — Create page component.
7. **`frontend/src/components/LinksTable.tsx`** — Create table component.
8. **`frontend/src/App.tsx`** — Add route: `<Route path="links" element={<LinksPage />} />`.
9. **`frontend/src/pages/dashboard/DashboardLayout.tsx`** — Add nav item.
10. **`tests/test_api_links.py`** — Write tests first (TDD). Add `create_test_link` fixture to conftest.py.

## How to Add New Lambda Workers

1. Create `lambdas/my-worker/handler.py` (copy from `lambdas/daily-job/`).
2. Add `lambdas/my-worker/requirements.txt`.
3. In `cdk/lib/yourapp-stack.ts`, add a `lambda.Function` and an `events.Rule`.
4. Deploy: `./scripts/deploy-lambdas.sh`.

## Stripe Plan Tiers

Plans live in two places:
- **`api/lib/db.py`** — `ITEM_LIMITS` dict controls per-plan entity limits (enforced on create).
- **`CONFIG | STRIPE`** DynamoDB record — holds Stripe price IDs (set via admin panel or DynamoDB console after first deploy).

The admin panel (`/config/plans`) lets you update plan limits without redeploying.

## Key Patterns

### Python Import Duality

All API modules use try/except imports to support both contexts:
- **Deployed:** `handler.py` at root, `from lib.auth import ...`
- **Tests:** run from project root, `from api.lib.auth import ...`

### Test Fixtures

`conftest.py` sets env vars before imports and resets `api.lib.db._table = None` before/after each test to prevent the module-level DynamoDB singleton from holding stale moto references.

Factory fixtures (`create_test_user`, `create_test_item`) are callables — call with kwargs to customize.

### Response Format

All API responses use `lib/response.py`: `ok(body, status)`, `error(message, status)`, `not_found(message)`. Returns `{"statusCode": N, "headers": {CORS}, "body": JSON string}`.

### User Auto-Provisioning

No explicit user creation endpoint. `GET /api/account` auto-creates the DynamoDB user profile on first call by reading `email` and `name` from the JWT ID token claims.

## Key File Map

| File | Purpose |
|------|---------|
| `cdk/lib/yourapp-stack.ts` | All AWS infrastructure |
| `api/handler.py` | Lambda entry point + routing |
| `api/lib/db.py` | DynamoDB helpers + entity functions |
| `api/lib/auth.py` | Cognito JWT verification |
| `api/routes/items.py` | CRUD for your main entity |
| `api/routes/billing.py` | Stripe checkout + webhooks |
| `api/routes/admin.py` | Admin endpoints |
| `lambdas/daily-job/handler.py` | Example scheduled worker |
| `frontend/src/App.tsx` | React router (user + admin apps) |
| `frontend/src/auth.ts` | Cognito Amplify integration |
| `frontend/src/api.ts` | API client functions |
| `frontend/src/types.ts` | TypeScript interfaces |
| `tests/conftest.py` | pytest fixtures + moto setup |
| `scripts/init.sh` | Project initialization script |
| `scripts/deploy.sh` | Full deployment |

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# Stripe (required for billing)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
```

Lambda environment variables are set by CDK (`cdk/lib/yourapp-stack.ts`) — do not set them manually.

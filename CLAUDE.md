# CLAUDE.md — web-aws-framework-template

## What This Is

A reusable AWS SaaS starter built from a working production app. Clone via GitHub template, run `./scripts/init.sh`, and you have a deployable SaaS with auth, billing, admin, email and AI, in two stages (test and prod).

Roadmap: [docs/plans/2026-10-11-template-v2-plan.md](docs/plans/2026-10-11-template-v2-plan.md) (phases 0-3 are done: clean
foundation, payments core, billing modules, the separate admin site).

Layout: npm workspaces at the root: `packages/shared` (code both sites use), `frontend/` (the user site), `admin/` (the
admin site). `api/` is one Python bundle deployed as two Lambdas (`handler.py`: the user API, `admin_handler.py`: the
admin API). `cdk/` has its own npm package.

## Placeholder Values

All project-specific values use these placeholders (replaced by `init.sh`):

| Placeholder | Replaced with |
|-------------|--------------|
| `yourapp` | Project name (lowercase) |
| `YourApp` | Display name (title case) |
| `yourapp.com` | Your domain (the admin site is `admin.` in front of the site's host) |
| `YOUR_AWS_ACCOUNT_ID` | AWS account ID |

To find all placeholder occurrences:
```bash
grep -r "yourapp" --include="*.ts" --include="*.py" --include="*.json" --include="*.sh" .
```

## Stages

| | prod | test |
|---|---|---|
| CDK | `-c stage=prod` (default) → `YourAppStack` | `-c stage=test` → `YourAppTestStack` |
| Site / admin site | `yourapp.com` (+ `www.`) / `admin.yourapp.com` | `test.yourapp.com` / `admin.test.yourapp.com` |
| Resource names | original (`yourapp`, `yourapp-api`, ...) | `-test` suffix (`yourapp-test`, `yourapp-test-api`, ...) |
| DynamoDB / removal | provisioned 25/25, RETAIN, PITR | on demand, DESTROY |
| Secrets | `yourapp/prod/*` | `yourapp/test/*` (+ `yourapp/test/test-login`, generated) |
| Sign-in | Cognito | Cognito, or username-only test login |
| Search engines | indexed | `X-Robots-Tag: noindex` |
| Outputs file | `cdk-outputs-prod.json` | `cdk-outputs-test.json` |

Each stage's API role can read only its own `yourapp/{stage}/*` secrets; the admin role only `yourapp/{stage}/stripe`.

## Commands

### Frontend (npm workspaces, run from the repo root)

```bash
npm install            # once: one lockfile and node_modules for packages/shared, frontend/ and admin/
npm run dev            # user site on :5173 (proxies /api/* to localhost:3000); MOCK_AUTH when no Cognito pool is set
npm run dev:admin      # admin site on :5174; MOCK_AUTH = a mock admin, the admin API answered by admin/src/mock.ts
npm run build          # every workspace: shared typecheck, then TypeScript check + Vite build of both sites
npm run lint           # ESLint in every workspace (must stay clean)
npm run build -w admin # one workspace
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
STAGE=test ./scripts/deploy.sh                 # Lambdas + CDK + both sites + both CloudFront invalidations
STAGE=test ./scripts/deploy.sh --infra-only    # Lambdas + CDK only
STAGE=test ./scripts/deploy-frontend.sh        # both sites only (same as --site-only)
STAGE=test ./scripts/deploy-lambdas.sh [api]   # Lambda code only (no CDK); "api" (or "admin") updates both API Lambdas
STAGE=prod ./scripts/deploy.sh                 # asks you to type "prod" (YES=1 skips, for CI)
.venv/bin/python scripts/make-admin.py test you@example.com [--revoke]   # Cognito group "admins" + isAdmin
```

### Local loop against a deployed stage

```bash
scripts/local-test.sh api     # both APIs from the working tree on 127.0.0.1:3000 (/api/admin/* -> admin_handler.py;
                              # restarts on save), test stage's AWS resources
scripts/local-test.sh web     # user site on localhost:5173 with the test stage's Cognito ids + test login
scripts/local-test.sh admin   # admin site on localhost:5174 (sign in with a Cognito account made admin by make-admin.py)
```

`STAGE=prod` works for both but reads and writes prod data.

### CDK

```bash
scripts/bundle-lambdas.sh               # build/api and build/<worker> (synth needs them)
cd cdk
npx tsc --noEmit                        # typecheck the stack
npx cdk synth -c stage=test             # needs AWS credentials: the hosted-zone lookup
npx cdk diff -c stage=prod
```

### Python dependencies

Edit `api/requirements.in`, then `scripts/lock-api-deps.sh` rewrites `api/requirements.txt` (exact versions + hashes). Never edit `requirements.txt` by hand.

## Architecture Decisions (Don't Change These Lightly)

**Lambda Function URLs instead of API Gateway:** Avoids $3.50/million request overhead. CORS is handled manually in `api/lib/response.py` (origin = the stage's `FRONTEND_URL`). Both Lambda Function URL and API Gateway v1 event formats are supported.

**X-Origin-Verify:** The Function URLs are public. The site's CloudFront adds `X-Origin-Verify` (the stack id, never in the repo) to every `/api/*` request, and `api/lib/params.from_cloudfront` refuses requests without it (403). The admin distribution sends its own, different value to the admin Lambda. Unset locally and in tests, so everything passes there.

**CloudFront:** two distributions per stage: the site (`/api/*` → API Lambda) and the admin site (`/api/admin/*` → admin Lambda; nothing else of the API). `/api/*` uses a cache policy keyed on `Authorization` with TTL 0 (nothing is cached unless the API sends `Cache-Control`). No distribution-wide error pages: the viewer-request function rewrites extensionless paths to `/index.html`, so API 403/404 JSON reaches the client unchanged.

**DynamoDB single-table design:** Everything in one table with `pk`/`sk` composite keys. Prefixes: `USER#`, `ITEM#`, `CONFIG`, `SUPPORT#` / `SUPPORTQ#` (support requests), and the payments records (`PAY#`, `PAYDAY#`, `CARDFP#`, `BANNED#CARD`, `REFUNDPENDING`, `REFCODE#`, `STRIPELOG#`, `STRIPEEVT#`, `AUDIT#`; [docs/payments.md](docs/payments.md)). GSIs: `stripe-customer-index`, and `list-index` (KEYS_ONLY, `listPk` + `createdAt`): records that set `listPk` (`USER`, `ITEM`, yours) can be listed newest first across users with `db.list_page` / `db.list_all` / `db.count`, so the admin site never scans the table. Add GSIs when you need to query by other non-key attributes. Money writes are conditional DynamoDB transactions (`db.tx_put` / `tx_update` / `tx_delete`, `db.transact`).

**Cognito ID token (not Access token):** The frontend sends the ID token as `Bearer`. `verify_token` accepts only tokens for this app client (`aud` for ID tokens, `client_id` for access tokens).

**Separate admin site:** `admin/` is its own Vite app, S3 bucket and CloudFront distribution on `admin.<site host>`; no admin code ships to users. The admin API is its own Lambda (`api/admin_handler.py`, same code bundle) with its own IAM role (table, the stage's Stripe secret, the pool's group calls, Health reads, invoking the daily job) and its own X-Origin-Verify. The user API answers 404 for every `/api/admin/*` path. Both sites share `packages/shared` (fetch core, auth, UI kit, `theme.css` tokens).

**Admin access = Cognito group AND profile flag:** an admin is in the user pool's `admins` group and has `isAdmin: true` on `USER#uid / PROFILE`. `api/lib/admins.check` re-checks both on every admin request (the group in the ID token and live via `AdminListGroupsForUser`, the flag in DynamoDB) and fails closed. Same user pool, separate sign-in on the admin site; test-login accounts are never admins. `scripts/make-admin.py <stage> <email> [--revoke]` and the Users tab's admin action set or clear both. Every admin action takes a reason and writes an audit row with actor `admin:{uid}` (never an email: audit rows hold no personal data).

**ARM64 Lambda:** All Lambdas run on Graviton (ARM64). `scripts/bundle-lambdas.sh` installs `manylinux2014_aarch64` wheels into `build/`, which is what CDK deploys; a pip error stops the deploy.

## Site Config (admin-editable)

`CONFIG | GLOBAL` holds feature toggles, plan limits, job settings and email templates. `api/lib/config.py` merges it over `DEFAULT_CONFIG`, validates admin saves (merging one section at a time) and caches it 30 s per Lambda container.

- **Plan limits** (`planLimits`, `null` = unlimited) are the only source: item create and billing downgrade/cancel enforce them; the frontend reads them from `GET /api/account` (`itemLimit`, `planLimits`) or `GET /api/public-config`. Never hardcode limits in the frontend.
- **`maintenanceMode`**: every user route answers 503 `{"code": "MAINTENANCE"}`. The admin API, `/api/public-config`, `/api/test-login` and Stripe webhooks keep working.
- **`signupsEnabled: false`**: `GET /api/account` refuses to create profiles for new accounts (403 `SIGNUPS_CLOSED`); existing users are unaffected.
- **`jobsEnabled: false`**: `lambdas/daily-job` skips its run.

## Where to Add New Entities

When replacing "items" with your domain entity (e.g., "orders"):

1. **`api/lib/db.py`** — Add `get_orders()`, `create_order()`, `update_order()`, `delete_order()` using an `ORDER#` prefix, and a counter like `increment_item_count()`. Give new records `listPk: "ORDER"` (and `createdAt`) to list them on the admin site.
2. **`api/lib/config.py`** — Rename/add the limit in `DEFAULT_PLAN_LIMITS` if the entity is plan-limited.
3. **`api/routes/orders.py`** — Copy `api/routes/items.py`; parse bodies with `lib/params.py` (bad input → 400).
4. **`api/handler.py`** — Add `from routes import orders` and route `/api/orders` in `_route()`.
5. **`frontend/src/types.ts`**, **`frontend/src/api.ts`** — Add the type and client functions.
6. **`frontend/src/pages/dashboard/OrdersPage.tsx`**, **`frontend/src/components/OrdersTable.tsx`** — Page and table.
7. **`frontend/src/App.tsx`** and **`DashboardLayout.tsx`** — Route and nav item.
8. **Admin tab** — routes in `api/routes/admin.py` + `ROUTES` in `api/admin_handler.py` (copy the items ones); a tab component in `admin/src/tabs/`, registered in `admin/src/tabs/app.ts` (`registerTab({id, label, icon, section, component})`).
9. **`tests/test_api_orders.py`** — Write tests first. Add a `create_test_order` fixture to `conftest.py`; admin routes go through `admin_call` with the `admin_who` fixture.

## How to Add New Lambda Workers

1. Create `lambdas/my-worker/handler.py` (copy from `lambdas/daily-job/`); add `requirements.txt` only for packages beyond boto3.
2. In `cdk/lib/yourapp-stack.ts`, add a `lambda.Function` named `${prefix}-my-worker` with `code: lambdaAsset('my-worker')`, and an `events.Rule`.
3. `scripts/bundle-lambdas.sh` picks up every `lambdas/*/` folder; `deploy-lambdas.sh my-worker` updates `${prefix}-my-worker`.

## Billing and Stripe

Full design and decisions: [docs/payments.md](docs/payments.md).

- **Billing mode:** `cdk/cdk.json` context `billingMode` = `none` | `subscriptions` | `credits` | `both` (default
  `both`) becomes the API's `BILLING_MODE`. Routes of a module that is off answer 404; `GET /api/public-config`
  (`billingMode`, `plans`, `credits`) tells the frontend what to show. `adminEmail` (context) receives dispute,
  failed-refund and banned-card mail.
- **What is sold** is code config in `api/lib/config.py` (`FREE_PLAN`, `PAID_PLANS`, `BILLING`, `ACCOUNT_RULES`),
  shaped like `ai/site.spec.schema.json` `modules.billing`. Never hardcode plans, prices, packs or limits in the
  frontend.
- **Keys:** Secrets Manager `yourapp/{stage}/stripe`, written by `scripts/stripe-secret.sh <stage>` (hidden prompt,
  prefix checked against the stage); read through `api/lib/stripe_config.py` (5-minute cache, short timeouts, the
  test stage refuses live keys). Never in `.env`, never in `stripe.api_key`.
- **Prices and webhook:** `.venv/bin/python scripts/stripe-setup.py <stage> [--apply]` (dry run by default): plan
  prices `yourapp_plan_{id}` and pack prices `yourapp_credits_{packId}` by lookup key, and the webhook
  `https://<site>/api/webhooks/stripe` for exactly the mode's events (`api/routes/webhooks.events_for`). Optional plan
  price overrides: `CONFIG | STRIPE` `{plan}PriceId` (admin site, Config tab).
- **Rules that keep money safe** (don't undo them):
  - every Stripe create sends a deterministic idempotency key (`stripe_config.idem`)
  - every webhook event is claimed once (`logs.claim_event`; a stuck `processing` claim is taken over after 3 min)
  - credits are spent paid-first through `credits.spend` / `credits.debit` (conditional transactions)
  - card refunds reserve the units before Stripe is asked (`payments._reserve`), and `sweep_pending` settles any left
    pending (EventBridge `PaymentsSweep`, every 15 minutes, credits modes)
- **Apps charge credits** with `credits.spend(user_id, action, units=None, ref=None, extra=None)` (costs:
  `BILLING["creditCosts"]`) and give them back with `credits.refund_spend(user_id, action, ref)`.
- **Account standing** (`api/lib/accounts.py`): suspended or banned accounts can't pay or spend; banned is read-only
  (`accounts.can_write`: use it in your entity's write routes, as `items.py` does).
- **Admin operations** live in `api/lib` (`payments.adjust_balance`, `payments.refund_to_card`, `accounts.ban` /
  `set_status` / `add_warning`, `admins.set_admin`, `payments.by_day` / `detail`, `logs.stripe_calls` / `webhooks` /
  `audits`); `api/routes/admin.py` is a thin layer over them (the table in docs/payments.md).

## Admin site (`admin/`, `admin.<site host>`)

- **Tabs:** Overview (money by kind, fees, refunds, disputes, balances held, users, subscriptions — by billing mode),
  Users (search + detail drawer: ban / unban / suspend / warn / remove warning / adjust balance / refund to card /
  admin, each with a required reason), Payments, Stripe log (calls + webhooks), Audit, Support, Health (Lambda, DynamoDB,
  SES from the stack's resource names; run the daily job or the refund sweep), Config, Items (the example entity).
- **Tab registry:** `admin/src/tabs/registry.ts`. Built-ins in `tabs/builtin.ts`; your app's tabs in `tabs/app.ts`:
  `registerTab({ id, label, icon, section, component: lazy(() => import('./MyTab')), billing?, visible?, order? })`.
  `billing: 'any' | 'credits' | 'subscriptions'` hides a tab per billing mode. Call your admin routes with `apiFetch`
  from `admin/src/api.ts`.
- **Access:** `GET /api/admin/me` decides: 401 → sign-in page, 403 `NOT_ADMIN` → not-authorized page.
- **Support requests:** `api/routes/support.py`; the user site's Support page writes in, the Support tab answers (the
  customer gets an account alert and an email). Topics and limits: `config.SUPPORT`.
- **Design:** Tailwind with the tokens in `packages/shared/src/theme.css` (`brand-*`, `ink`, `muted`, `line`, `panel`,
  `chrome`, ...), shared by both sites; UI primitives in `packages/shared/src/ui.tsx`.

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

### Auth modes in the frontends (`packages/shared/src/auth.ts` `createAuth`)

- **Cognito** — deployed sites. The admin site has its own session (another origin) on the same pool.
- **TEST_LOGIN** — user site only, `VITE_TEST_LOGIN=1` (test stage only, written by the deploy/local scripts): username → `POST /api/test-login`. The API serves it only when `STAGE=test` and `TEST_LOGIN=1`. The admin site never offers it, and the admin Lambda refuses test tokens.
- **MOCK_AUTH** — `npm run dev` / `npm run dev:admin` with no `VITE_USER_POOL_ID`: any email/password, no backend. The user site gets a mock account (an admin, so the Admin link shows); the admin site a mock admin with data from `admin/src/mock.ts`.

MOCK_AUTH is constant `false` in production builds (`import.meta.env.DEV`), so it never ships.

## Key File Map

| File | Purpose |
|------|---------|
| `cdk/bin/yourapp.ts` | Picks the stage (`-c stage=`) and stack |
| `cdk/lib/yourapp-stack.ts` | All AWS infrastructure, per stage |
| `api/handler.py` | User API Lambda entry point: origin check, maintenance gate, routing (404 for `/api/admin/*`) |
| `api/admin_handler.py` | Admin API Lambda entry point: its own origin check, the admin check, `ROUTES` |
| `api/lib/admins.py` | Who is an admin (Cognito group + profile flag, every request); grant/revoke |
| `api/routes/admin.py` | Admin endpoints: overview, users + actions, payments, logs, health, config, items |
| `api/routes/support.py` | Support requests (user and admin sides) |
| `api/lib/config.py` | Site config defaults, validation, plan limits |
| `api/lib/params.py` | Body parsing, `from_cloudfront` |
| `api/lib/auth.py` | Cognito JWT + test-login tokens |
| `api/lib/db.py` | DynamoDB helpers + entity functions; `list_page` / `list_all` / `count` on list-index |
| `api/routes/items.py` | CRUD for your main entity |
| `api/routes/billing.py` | Subscription routes: Checkout, portal, change plan, cancel |
| `api/routes/wallet.py` | Credits wallet: balance, on-site charge + 3-D Secure, auto reload, refunds |
| `api/routes/cards.py` | Saved cards (Stripe setup page, default, remove) |
| `api/routes/webhooks.py` | The Stripe webhook: signature, exactly-once claim, dispatch to the modules |
| `api/lib/stripe_config.py` | Per-stage Stripe key, client with timeouts, idempotency keys |
| `api/lib/payments.py` | `PAY#` records, card refunds (reserve, send, reconcile, sweep), disputes, admin balance/refund ops |
| `api/lib/credits.py` | Credits ledger, `spend` / `refund_spend`, earning hooks, referrals |
| `api/lib/subscriptions.py` | Plan prices, webhook events, grace period, `effective_plan` |
| `api/lib/autoreload.py` | Auto reload after a spend |
| `api/lib/accounts.py` | Status, warnings, bans, admin flag |
| `api/lib/logs.py` | Stripe call log, webhook log, audit log (18-month TTL) and their readers |
| `api/lib/notes.py`, `api/lib/mail.py` | Account alerts; SES mail to users and the admin |
| `api/lib/regions.py`, `api/lib/fx.py` | Optional country gating; optional local price hints |
| `scripts/stripe-secret.sh`, `scripts/stripe-setup.py` | Stripe key into Secrets Manager; prices + webhook per stage |
| `docs/payments.md` | Payments design and decisions |
| `lambdas/daily-job/handler.py` | Example scheduled worker |
| `packages/shared/src/` | `api.ts` (fetch core, `ApiError`), `auth.ts` (`createAuth`), `ui.tsx`, `format.ts`, `hooks.ts` (`useLoad`), `theme.css` |
| `frontend/src/App.tsx` | React router (the user site) |
| `frontend/src/auth.ts` | The user site's `createAuth` (Cognito / test login / mock auth) |
| `frontend/src/api.ts` | User API client functions (+ MOCK_AUTH answers) |
| `frontend/src/pages/dashboard/SupportPage.tsx` | Support requests (user side) |
| `admin/src/App.tsx`, `Layout.tsx` | Admin access gate (sign-in / not authorized) and the sidebar layout |
| `admin/src/tabs/registry.ts`, `builtin.ts`, `app.ts` | The tab registry, the platform tabs, your app's tabs |
| `admin/src/api.ts`, `mock.ts`, `types.ts` | Admin API client, MOCK_AUTH data, response types |
| `frontend/src/types.ts` | TypeScript interfaces |
| `frontend/src/billing.ts` | Billing mode helpers, `usePublicConfig`, money formatting |
| `frontend/src/pages/dashboard/WalletPage.tsx`, `PlansPage.tsx` | Credits wallet; subscription plans |
| `tests/conftest.py` | pytest fixtures + moto setup (`stripe_fake`, `who`, `admin_who` + `admin_call`, `billing_cfg`, `billing_mode`) |
| `tests/stripe_fake.py` | Offline Stripe stand-in + signed webhook events |
| `scripts/deploy.sh` | Per-stage deployment (both sites) |
| `scripts/make-admin.py` | Grant / revoke admin (Cognito group + isAdmin) |
| `scripts/bundle-lambdas.sh` | Builds `build/<lambda>` |
| `scripts/local-test.sh`, `scripts/local-api.py` | Local APIs + both sites against a deployed stage |
| `scripts/lib/stage.sh`, `scripts/lib/outputs.sh` | Stage → stack/prefix; reading stack outputs |

## Environment Variables

Lambda environment variables are set by CDK (`cdk/lib/yourapp-stack.ts`) — do not set them manually. The sites' `VITE_*` values are written by `scripts/deploy.sh` (`frontend/.env.production.local`, `admin/.env.production.local`) and `scripts/local-test.sh`; see `frontend/.env.example` and `admin/.env.example` (declared once in `packages/shared/src/env.d.ts`). The root `.env.example` lists the shell settings the scripts use (`STAGE`, `AWS_REGION`, `YES`). No secrets go in any `.env` file.

## Ops and security (cdk.json flags, alarms, WAF, budget, MFA)

Everything here is in `cdk/lib/yourapp-stack.ts`; the console steps (SES production access, alarm email
confirmation, CloudTrail, GuardDuty, Stripe live, ...) and the prod deploy order are in
[docs/launch-checklist.md](docs/launch-checklist.md).

**`cdk/cdk.json` context** (or `-c name=value`; booleans accept `true`/`false`/`1`/`0`):

| Key | Default | Effect |
|---|---|---|
| `alarmEmail` | `""` | SNS alarm + budget subscription (prod); empty = `adminEmail`; neither = a synth warning |
| `budgetUsd` | `50` | monthly AWS Budget (account-wide): 80% / 100% actual and 100% forecast to the alert topic (prod) |
| `waf` | `false` | prod only: a web ACL on both distributions |
| `wafRateLimit` | `1000` | per-IP requests per 5 minutes (the Stripe webhook is exempt) |
| `adminAllowIps` | `[]` | CIDRs (bare IPs get /32 or /128): a second web ACL on the admin distribution blocks everyone else; needs `waf` |
| `cognitoSes` | `false` | Cognito mail from `noreply@<domain>` through SES (only after SES production access) |
| `adminMfa` | prod on, test off | the admin API requires an authenticator app (`ADMIN_MFA` on the admin Lambda) |
| `googleTags` | `false` | the user site's CSP also allows GA4 / AdSense hosts and inline scripts |
| `csp` | `enforce` | `report-only` (sent as Content-Security-Policy-Report-Only) or `off` |

**Alarms** (prod, `addProdMonitoring`): one SNS topic `<prefix>-alerts` gets ALARM and OK for: user and admin API
`Url5xxCount`, p95 duration, throttles and errors; daily-job errors; Stripe webhook failures (`WEBHOOK_FAILED` /
`STRIPE_WEBHOOK_SECRET_MISSING` metric filter on the API log; not with `billingMode: none`); payments sweep failures
(`PAYMENTS_SWEEP_FAILED`; credits modes); DynamoDB read/write throttles on the table and both GSIs; SES bounce (5%)
and complaint (0.1%) rates; CloudFront 5xx rate (5% for 10 minutes) on both distributions. Each bounce and complaint
is also posted to the topic (SES configuration set `<prefix>-transactional`, the domain identity's default, which
also suppresses those addresses). Add alarms with the `alarm(id, description, metric, threshold)` helper there; a log
line to alarm on goes through `logCount` (log failures with a fixed UPPER_CASE marker, as the API does).

**WAF** (CLOUDFRONT scope, so the stack must be in us-east-1; synth refuses `waf` elsewhere): per-IP rate limit, AWS
common rule set (webhook exempt; `SizeRestrictions_BODY` only counted), known bad inputs, Amazon IP reputation. The
test stage never gets WAF (cost).

**Security headers:** both sites get HSTS, nosniff, frame options, a referrer policy and a CSP. The user site's CSP
allows `'self'`, Cognito (`cognito-idp.<region>.amazonaws.com`), Stripe.js (`js.stripe.com`, `hooks.stripe.com`,
`api.stripe.com`) and, with `googleTags`, Google's tag and ad hosts; `img-src` allows any https image. The admin
site's CSP allows only `'self'` and Cognito, with `frame-ancestors 'none'`. A new third-party origin on the user site
goes into `siteCsp` (try `csp: report-only` first). CloudFront limits the CSP to 1783 characters.

**`/api/*` cache key:** `Authorization` + only the query parameters the API reads (`API_CACHE_QUERY_KEYS`). Reading a
new query parameter (`params.query` / `query_int` / `day`) means adding it there; `tests/test_edge_sync.py` fails
until you do.

**Cognito:** branded code and invitation emails (`displayName`), MFA `OPTIONAL` with TOTP only (no SMS), the SES
sender behind `cognitoSes`.

**Admin MFA:** with `ADMIN_MFA=1`, `api/lib/admins.check` also requires `SOFTWARE_TOKEN_MFA` in the admin's
`AdminGetUser` `UserMFASettingList` (live, on every request, failing closed); otherwise the admin API answers 403
`MFA_REQUIRED` (after the admin check, so non-admins still get `NOT_ADMIN`). The admin site then shows
`MfaSetupPage` (QR code + key, one code, TOTP preferred). Once it's on, both sites' sign-in asks for the code (`login`
returns `nextStep: TOTP_SIGN_IN_STEP`, and `TotpCodeForm` finishes the sign-in). Shared pieces:
`packages/shared/src/mfa.ts` (Amplify calls) and `totp.tsx` (`QrCode` via `uqr`, `TotpCodeForm`, `TotpSetup`, which
a user settings page can reuse for an opt-in). MOCK_AUTH never asks for MFA. To reset a lost authenticator:
`aws cognito-idp admin-set-user-mfa-preference ... --software-token-mfa-settings Enabled=false,PreferredMfa=false`.
Tests: `tests/test_admin_mfa.py`.

**Optional email forwarding:** `infra/email-forwarding.yaml` (CloudFormation, outside the CDK app) +
`scripts/deploy-email-forwarding.sh`: MX, SES receipt rule, S3, a forwarder Lambda, and optional root SPF and
`_dmarc` records.

**Checking the stack without AWS:** `npx cdk synth` needs credentials for the hosted-zone lookup. To synthesize
in-process, build `YourAppStack` in a scratch `.ts` under `cdk/`. Give its `cdk.App` the context key
`hosted-zone:account=<acct>:domainName=yourapp.com:region=us-east-1` =
`{ "Id": "/hostedzone/Z0FAKE", "Name": "yourapp.com." }`, a fake account in `env`, and the flags you're testing. Then
inspect it with `Template.fromStack` from `aws-cdk-lib/assertions`. `build/api` and `build/daily-job` must exist
(empty folders are enough).

# web-aws-framework-template

An opinionated, production-ready AWS SaaS starter. Everything you need to ship a subscription web app in a weekend.

> **AI agents: start at [ai/PLAYBOOK.md](ai/PLAYBOOK.md).** It turns "build a website for X" into a site spec, a
> design, generated pages on realistic mock data, a test-stage deploy and a handoff.

**AI site builder:** one `site.spec.yaml` (schema: [ai/site.spec.schema.json](ai/site.spec.schema.json)) drives
`scripts/init.py` (name, domain, billing, languages, design tokens), `scripts/new-entity.py` (per entity: contract, list
and detail pages, admin tab, texts) and `scripts/gen-fixtures.py` (realistic, deterministic mock data). Entities start
**mocked in the browser** (MSW) behind the same `/api/<entity>` contract the real backend implements later
(`new-entity.py --backend`); auth, account, billing and admin stay real. `scripts/verify.sh` is the one gate.

**What's included out of the box:**
- User auth (sign up, log in, email verification, forgot password) via Cognito
- Protected dashboard with generic CRUD (replace "items" with your entity)
- A separate admin site (`admin.yourdomain.com`, its own Lambda): overview, users with audited actions (ban, suspend,
  warn, balance, refunds, admin), payments, Stripe log, audit log, support tickets, health, config; apps add tabs
- Support requests: a Support page for users, answered from the admin site
- Account standing everywhere it matters: warnings, suspension and read-only bans in a banner and the alerts menu, and
  the actions they turn off are disabled with an explanation
- A Settings page (Profile, Payment, Notifications) stored on the server, with per-kind email switches
- Built-in i18n: i18next on both sites and translated API messages and emails (ships in English; adding a language
  is a folder and a file, checked by `npm run i18n:check` and the tests)
- Terms of Service and Privacy Policy skeleton pages (`/terms`, `/privacy`)
- Optional Google Analytics 4 and AdSense with EEA/UK/CH consent-mode defaults, and generated `robots.txt`,
  `sitemap.xml` and `ads.txt`
- Two stages: `test.yourdomain.com` (disposable, noindex, username test login) and `yourdomain.com`, each with its
  admin site (`admin.test.yourdomain.com`, `admin.yourdomain.com`)
- Billing modules, chosen per app (`billingMode`: none, subscriptions, credits or both):
  - Stripe subscriptions (Checkout + Customer Portal, plan changes, grace period on failed renewals)
  - a credits wallet (packs, saved cards, 3-D Secure, auto reload, 14-day refunds, `credits.spend` for your features)
  - refunds, disputes, bans and logs that can't lose or create money ([docs/payments.md](docs/payments.md))
- Scheduled background job (EventBridge + Lambda)
- Transactional email via SES
- AI integration via Bedrock (model id set in `cdk/cdk.json`)
- Full test suite (pytest + moto) with all AWS services mocked
- One-command deploy via CDK

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4; npm workspaces (`packages/shared`, `frontend/`, `admin/`) |
| Backend | Python 3.12 + AWS Lambda (ARM64) |
| Infrastructure | AWS CDK v2 (TypeScript) |
| Auth | AWS Cognito (user pool + JWT) |
| Database | DynamoDB (single-table design) |
| CDN + Hosting | CloudFront + S3 |
| Email | AWS SES |
| AI | AWS Bedrock (optional example in the daily job) |
| Payments | Stripe (subscriptions and/or a credits wallet) |
| Scheduling | EventBridge |
| DNS | Route53 |

## Prerequisites

- Node.js 20+ and npm
- Python 3.12 and pip
- AWS CLI v2 configured (`aws configure`)
- CDK CLI: `npm install -g aws-cdk`
- AWS account with a domain registered in Route53
- Stripe account (for billing)

## Quick Start

### 1. Use this template

Click **"Use this template"** on GitHub, create your repo, then clone it:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME
cd YOUR_REPO_NAME
```

### 2. Initialize the project

```bash
./scripts/init.sh                                    # asks the basics, writes site.spec.yaml, runs init.py
python3 scripts/init.py --spec site.spec.yaml        # or: write the spec yourself (ai/site.spec.example.yaml)
npm install && scripts/verify.sh
```

`init.py` replaces the placeholders (`yourapp`, `YourApp`, `yourapp.com`, `YOUR_AWS_ACCOUNT_ID`), renames the CDK files,
and writes the site's config from the spec: `api/site.json` (plans, packs, credit costs, sign-up gift, regions,
support), `packages/shared/src/site.generated.ts`, the language list, `cdk/cdk.json` context and the Google tag ids. It
is idempotent: change the spec and run it again. `--apply-design` writes the spec's design tokens into the theme.

### 3. Deploy the test stage, then prod

```bash
STAGE=test ./scripts/deploy.sh     # https://test.yourdomain.com + https://admin.test.yourdomain.com
STAGE=prod ./scripts/deploy.sh     # https://yourdomain.com + https://admin.yourdomain.com (asks you to type "prod")
```

Each run:
1. Bundles the Lambdas into `build/` (Linux ARM64 wheels, hash-checked API dependencies)
2. Deploys the stage's CDK stack (DynamoDB, Cognito, Lambda, CloudFront, Route53, ...) → `cdk-outputs-{stage}.json`
3. Writes both sites' settings (`frontend/.env.production.local`, `admin/.env.production.local`) and builds them
4. Uploads each to its bucket (hashed assets cached for a year, `index.html` revalidated every visit) and invalidates both
   distributions

`--infra-only` and `--site-only` run half of it.

### 4. Make yourself an admin

Sign up on the site, sign in once, then:

```bash
.venv/bin/python scripts/make-admin.py test you@example.com     # --revoke takes it away
```

That adds you to the user pool's `admins` group and sets `isAdmin` on your profile; the admin API checks both on every
request. Sign in at `https://admin.test.yourdomain.com` (prod: `admin.yourdomain.com`) with the same account.
Accounts that aren't admins get a "not authorized" page; the site's user menu shows an Admin link to admins.

### 5. Add your Stripe keys

Stripe keys live in Secrets Manager (`yourapp/{stage}/stripe`), never in `.env`. Sandbox keys on test, live keys on prod:

```bash
scripts/stripe-secret.sh test                          # paste the sk_test_ key at a hidden prompt
.venv/bin/python scripts/stripe-setup.py test          # dry run: what it would create
.venv/bin/python scripts/stripe-setup.py test --apply  # plan/pack prices by lookup key + the webhook and its secret
```

Pick the billing modules in `cdk/cdk.json` (`billingMode`: `none`, `subscriptions`, `credits` or `both`) and the plans,
packs and costs in `api/lib/config.py` before deploying. Set `adminEmail` there too for dispute and refund alerts.

## Stages

| | test | prod |
|---|---|---|
| Stack | `YourAppTestStack` (`-c stage=test`) | `YourAppStack` (default) |
| Site | `test.yourdomain.com` | `yourdomain.com` |
| Admin site | `admin.test.yourdomain.com` | `admin.yourdomain.com` |
| Data | on-demand table, destroyed with the stack | provisioned table, retained, point-in-time recovery |
| Sign-in | Cognito, or any username (no password) | Cognito |
| Search engines | `noindex` | indexed |

## Local Development

```bash
npm install                         # once, at the repo root (npm workspaces)
npm run dev                         # user site, no AWS needed: MOCK_AUTH signs you in with any email/password, and the
                                    # spec's entities are answered by the browser mocks (MSW) from their fixtures
npm run dev:admin                   # admin site on :5174, no AWS needed: a mock admin with sample data
scripts/local-test.sh api           # both APIs from your working tree on :3000, against the test stage's AWS resources
scripts/local-test.sh web           # user site on :5173 with hot reload, test login, proxying /api to :3000
scripts/local-test.sh admin         # admin site on :5174 against the test stage (sign in as a Cognito admin)
npm run lint && npm run build       # every workspace
scripts/verify.sh [--prod]          # everything: spec, pytest, contract tests, lint, i18n, typecheck, builds, cdk tsc
```

`.claude/launch.json` has the same servers for an agent's browser pane: `web-mock` (:5175) and `admin-mock` (:5176)
need no AWS; `api`, `web` and `admin` run `scripts/local-test.sh` against the test stage.

## Architecture

```
yourdomain.com (CloudFront + S3)
├── / — Landing page
├── /login, /signup, /verify — Auth flows (Cognito)
├── /dashboard — Protected user app
│   ├── /dashboard — Items page (generic CRUD — replace with your entity)
│   ├── /dashboard/plans — Subscription plans (subscriptions mode)
│   ├── /dashboard/wallet — Credits wallet, saved cards, refunds (credits mode)
│   ├── /dashboard/settings — User settings
│   ├── /dashboard/reports — Reports (Pro)
│   └── /dashboard/support — Support requests

admin.yourdomain.com (its own CloudFront + S3 + Lambda; same Cognito pool, separate sign-in)
├── /overview, /users, /support — money and users at a glance; user detail and audited actions; tickets
├── /payments, /stripe-log — by UTC day (billing modes only)
├── /audit, /health, /config — audit log; Lambda/DynamoDB/SES; switches, plan limits, Stripe price overrides
└── /items — the example entity (your app's tabs register in admin/src/tabs/app.ts)

API (Lambda Function URL behind CloudFront — no API Gateway; direct calls are refused)
├── GET/POST /api/items — CRUD for your entity
├── GET/PUT /api/account — User profile (+ plan limits)
├── GET /api/public-config — Maintenance/sign-up switches, plan limits (no auth)
├── POST /api/test-login — Username login (test stage only)
├── GET /api/account/notes — Account alerts (user menu)
├── POST /api/billing/{checkout,portal,change-plan,cancel} — Subscriptions
├── /api/wallet, /api/wallet/{charge,auto-reload,refunds,refund} — Credits wallet
├── /api/account/cards — Saved cards
├── /api/support — Support requests
└── POST /api/webhooks/stripe — Stripe webhook (exactly once per event)

Admin API (its own Lambda, only behind the admin distribution; admin = Cognito group "admins" + isAdmin, every request)
└── /api/admin/* — me, overview, users (+ actions), payments, stripe-log, webhooks, audit, support, health, config, items

DynamoDB (single-table design)
├── USER#{userId} | PROFILE — User, plan, balance, standing, Stripe IDs
├── USER#{userId} | ITEM#{itemId} — Your entity
├── USER#{userId} | TX#… — Credits ledger; PAY#… — payments (docs/payments.md)
└── CONFIG | GLOBAL — Feature flags, plan limits, job settings, email templates

Scheduled (EventBridge)
├── lambdas/daily-job/handler.py — daily 8 AM UTC: add your scheduled logic here
└── PaymentsSweep — every 15 min, the API settles card refunds Stripe hasn't confirmed (credits modes)
```

## Customization Guide

### Add your entities (generated, mocked first)

Describe them in `site.spec.yaml` (`entities`: fields, refs, owner, public; `pages`; `mocks`), then:

```bash
python3 scripts/spec.py validate
python3 scripts/new-entity.py --all        # contract, pages, admin tab, texts, mock flag (per entity)
python3 scripts/gen-fixtures.py --sample 3 # deterministic mock data + placeholder images
npm run dev                                # the pages work now, on mock data (MSW in the browser)
python3 scripts/new-entity.py --backend Recipe   # later: the real API route + contract test; the mock turns off
```

The first `init.py` run with entities removes the template's Items example pages and admin tab (its backend,
`api/routes/items.py`, stays as the plan-limit reference). Generated pages are yours to edit: the generator never
overwrites a file you changed (`--force` does). The page templates are `scripts/templates/entity/`.
Production builds (`VITE_STAGE=prod`) fail while an entity is still mocked.

### Replace "items" by hand (without the generator)

The template uses a generic "Item" entity (name + status). To replace it with your domain entity (e.g., "Link", "Post", "Order"):

1. **Backend:** Rename `api/routes/items.py` → `api/routes/links.py`, update DynamoDB key prefix from `ITEM#` to `LINK#`, rename functions
2. **Frontend:** Replace `ItemsPage`, `ItemsTable`, `AddItemForm` with your components
3. **Types:** Update `frontend/src/types.ts` (Item → Link)
4. **API client:** Update `frontend/src/api.ts` (fetchItems → fetchLinks, etc.)
5. **DB helpers:** Update `api/lib/db.py` (get_items → get_links, increment_item_count → increment_link_count, etc.) and the limit wording in `api/lib/config.py`
6. **Handler routing:** Update `api/handler.py` to route `/api/links` instead of `/api/items`
7. **Tests:** Update `tests/test_api_items.py` → `tests/test_api_links.py`

### Add new Lambda workers

Copy the `daily-job` pattern:
```bash
mkdir lambdas/my-worker
cp lambdas/daily-job/handler.py lambdas/my-worker/handler.py
```

Then add to `cdk/lib/yourapp-stack.ts`:
```typescript
const myWorkerFn = new lambda.Function(this, 'MyWorkerFunction', {
  ...lambdaDefaults,
  functionName: `${prefix}-my-worker`,          // yourapp-my-worker / yourapp-test-my-worker
  handler: 'handler.handler',
  code: lambdaAsset('my-worker'),               // build/my-worker, from scripts/bundle-lambdas.sh
  timeout: cdk.Duration.minutes(5),
  memorySize: 256,
  logGroup: makeLogGroup('my-worker'),
  environment: {
    TABLE_NAME: mainTable.tableName,
    FROM_EMAIL: `noreply@${domainName}`,
    STAGE: stage,
  },
});
mainTable.grantReadWriteData(myWorkerFn);

new events.Rule(this, 'MyWorkerRule', {
  ruleName: `${prefix}-my-worker`,
  schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
  targets: [new eventsTargets.LambdaFunction(myWorkerFn)],
});
```

Put packages beyond boto3 in `lambdas/my-worker/requirements.txt`; the bundle script installs them. `STAGE=test scripts/deploy-lambdas.sh my-worker` updates just its code.

### Modify plan tiers, packs and costs

Plans (`FREE_PLAN`, `PAID_PLANS`: name, monthly price, limits, features), credit packs, custom amounts, `creditCosts`
and the earning hooks are in `api/lib/config.py`; the frontend reads them from `GET /api/public-config`. After
changing prices, run `.venv/bin/python scripts/stripe-setup.py <stage> --apply`. Item limits per plan are also
admin-editable (admin site → Config) and enforced by the API.

### Add an admin tab

Write the tab component in `admin/src/tabs/` and register it in `admin/src/tabs/app.ts`:

```ts
registerTab({ id: 'orders', label: 'Orders', icon: 'items', section: 'Data', component: lazy(() => import('./OrdersTab')) });
```

Add its API routes to `api/routes/admin.py` and `ROUTES` in `api/admin_handler.py` (the admin check has already run).

## Running Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt
.venv/bin/pip install -r tests/requirements-test.txt
.venv/bin/python -m pytest tests/ -v
```

All AWS services are mocked via [moto](https://github.com/getmoto/moto). No real AWS calls during tests.
`scripts/verify.sh` runs these plus every other check (it installs what is missing first);
`scripts/template-selftest.sh` (and the `template-ci` GitHub workflow) also builds the example spec in a temporary copy
and verifies that.

Run specific tests:
```bash
.venv/bin/python -m pytest tests/test_api_items.py -v
.venv/bin/python -m pytest tests/test_api_items.py::TestCreateItem::test_create_item -v
```

## Going live: alarms, WAF, budget, MFA

Prod comes with ops and security built in. You switch the optional parts on in `cdk/cdk.json`. Work through
[docs/launch-checklist.md](docs/launch-checklist.md) before opening the site: SES production access, Cognito via
SES, DMARC, CloudTrail and GuardDuty, Stripe live, consent, and the deploy order.

- **Alarms (prod):** about 15 CloudWatch alarms send email through SNS to `alarmEmail` (or `adminEmail`) when
  something breaks: API 5xx, latency and throttles, Lambda errors, failed Stripe webhooks, the refund sweep, DynamoDB
  throttles, SES bounce and complaint rates, and CloudFront 5xx on both sites. Confirm the subscription email once.
- **Budget (prod):** a monthly AWS Budget of `budgetUsd` (default $50), with alerts at 80% and 100%.
- **WAF (prod, opt-in):** `"waf": true` adds per-IP rate limits and the AWS managed rule groups (common,
  known-bad-inputs, IP reputation) to both sites, for about $9 a month. `adminAllowIps` limits the admin site to your
  addresses.
- **Headers:** HSTS, nosniff, frame and referrer policies, and a Content-Security-Policy on both sites. Stripe.js is
  always allowed; set `"googleTags": true` to also allow GA4 and AdSense.
- **Admin MFA:** admins must use an authenticator app (`adminMfa`, on in prod). The admin site walks them through the
  setup with a QR code, and both sites ask for the code at sign-in. Users can opt in, since the pool's MFA is
  optional.
- **Cognito email:** codes are sent under your site's name, and from `noreply@<domain>` through SES once
  `"cognitoSes": true` (after SES production access).
- **Optional inbound mail:** `scripts/deploy-email-forwarding.sh` forwards `hello@<domain>` to your inbox
  (`infra/email-forwarding.yaml`).

## Cost Estimate

At low traffic (~0-100 users):
- DynamoDB: ~$0 (25 RCU/WCU free tier)
- Lambda: ~$0 (1M free requests/month)
- CloudFront: ~$0 (1TB free transfer/month)
- SES: ~$0 (62,000 emails/month free)
- Cognito: ~$0 (50,000 MAU free)
- Route53: ~$0.50/month (hosted zone)
- ACM: $0 (certificates are free)
- **Total: ~$0.50/month at low traffic**
- Prod alarms: ~$1.50/month (about $0.10 per alarm); WAF when enabled: ~$9/month + $0.60 per million requests

At scale (1,000 users):
- Estimated: $15-30/month

## License

MIT

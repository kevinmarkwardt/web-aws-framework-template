# web-aws-framework-template

An opinionated, production-ready AWS SaaS starter. Everything you need to ship a subscription web app in a weekend.

**What's included out of the box:**
- User auth (sign up, log in, email verification, forgot password) via Cognito
- Protected dashboard with generic CRUD (replace "items" with your entity)
- Admin panel with user management, billing overview, feature toggles, plan limits (enforced by the API)
- Two stages: `test.yourdomain.com` (disposable, noindex, username test login) and `yourdomain.com`
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
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 |
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
./scripts/init.sh
```

This prompts for your project name, display name, domain, and AWS account ID — then does a global find-replace across all files and renames the CDK stack.

### 3. Deploy the test stage, then prod

```bash
STAGE=test ./scripts/deploy.sh     # https://test.yourdomain.com
STAGE=prod ./scripts/deploy.sh     # https://yourdomain.com (asks you to type "prod")
```

Each run:
1. Bundles the Lambdas into `build/` (Linux ARM64 wheels, hash-checked API dependencies)
2. Deploys the stage's CDK stack (DynamoDB, Cognito, Lambda, CloudFront, Route53, ...) → `cdk-outputs-{stage}.json`
3. Writes the site's Cognito ids to `frontend/.env.production.local` and builds the React app
4. Uploads it to S3 (hashed assets cached for a year, `index.html` revalidated every visit) and invalidates CloudFront

`--infra-only` and `--site-only` run half of it.

### 4. Set up admin access

```bash
STAGE=test ./scripts/setup-admin.sh you@example.com
```

Stores the admin login in Secrets Manager (`yourapp/test/admin-credentials`). The admin panel is at `manager.test.yourdomain.com` (prod: `manager.yourdomain.com`).

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
| Data | on-demand table, destroyed with the stack | provisioned table, retained, point-in-time recovery |
| Sign-in | Cognito, or any username (no password) | Cognito |
| Search engines | `noindex` | indexed |

## Local Development

```bash
cd frontend && npm run dev          # no AWS needed: MOCK_AUTH signs you in with any email/password
scripts/local-test.sh api           # API from your working tree on :3000, against the test stage's AWS resources
scripts/local-test.sh web           # site on :5173 with hot reload, test login, proxying /api to :3000
```

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
│   └── /dashboard/reports — Reports (Pro)
└── manager.yourdomain.com — Admin panel
    ├── /users — All users
    ├── /billing — Revenue overview
    ├── /health — Lambda/DB status
    └── /config — Feature flags, plan limits

API (Lambda Function URL behind CloudFront — no API Gateway; direct calls are refused)
├── GET/POST /api/items — CRUD for your entity
├── GET/PUT /api/account — User profile (+ plan limits)
├── GET /api/public-config — Maintenance/sign-up switches, plan limits (no auth)
├── POST /api/test-login — Username login (test stage only)
├── GET /api/account/notes — Account alerts (user menu)
├── POST /api/billing/{checkout,portal,change-plan,cancel} — Subscriptions
├── /api/wallet, /api/wallet/{charge,auto-reload,refunds,refund} — Credits wallet
├── /api/account/cards — Saved cards
├── POST /api/webhooks/stripe — Stripe webhook (exactly once per event)
└── /api/admin/* — Admin endpoints

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

### Replace "items" with your entity

The template uses a generic "Item" entity (name + status). To replace it with your domain entity (e.g., "Link", "Post", "Order"):

1. **Backend:** Rename `api/routes/items.py` → `api/routes/links.py`, update DynamoDB key prefix from `ITEM#` to `LINK#`, rename functions
2. **Frontend:** Replace `ItemsPage`, `ItemsTable`, `AddItemForm` with your components
3. **Types:** Update `frontend/src/types.ts` (Item → Link)
4. **API client:** Update `frontend/src/api.ts` (fetchItems → fetchLinks, etc.)
5. **DB helpers:** Update `api/lib/db.py` (get_items → get_links, increment_item_count → increment_link_count, etc.) and the limit wording in `api/lib/config.py`
6. **Handler routing:** Update `api/handler.py` to route `/api/links` instead of `/api/items`
7. **Tests:** Update `tests/test_api_items.py` → `tests/test_api_links.py`

### Add a second entity

To add a second entity (e.g., "Pipeline" alongside "Links"):

1. Create `api/routes/pipeline.py` (copy items.py, rename functions and key prefix)
2. Add pipeline DB functions to `api/lib/db.py`
3. Add pipeline routing to `api/handler.py`
4. Create `frontend/src/pages/dashboard/PipelinePage.tsx`
5. Add route in `frontend/src/App.tsx`
6. Add nav item in `frontend/src/pages/dashboard/DashboardLayout.tsx`

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
admin-editable (admin panel → Plan Limits) and enforced by the API.

## Running Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r api/requirements.txt
.venv/bin/pip install -r tests/requirements-test.txt
.venv/bin/python -m pytest tests/ -v
```

All AWS services are mocked via [moto](https://github.com/getmoto/moto). No real AWS calls during tests.

Run specific tests:
```bash
.venv/bin/python -m pytest tests/test_api_items.py -v
.venv/bin/python -m pytest tests/test_api_items.py::TestCreateItem::test_create_item -v
```

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

At scale (1,000 users):
- Estimated: $15-30/month

## License

MIT

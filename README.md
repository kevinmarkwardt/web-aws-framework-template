# web-aws-framework-template

An opinionated, production-ready AWS SaaS starter. Everything you need to ship a subscription web app in a weekend.

**What's included out of the box:**
- User auth (sign up, log in, email verification, forgot password) via Cognito
- Protected dashboard with generic CRUD (replace "items" with your entity)
- Admin panel with user management, billing overview, feature toggles
- Stripe subscription billing (Checkout + Customer Portal)
- Scheduled background job (EventBridge + Lambda)
- Transactional email via SES
- AI integration via Bedrock (Claude Haiku)
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
| AI | AWS Bedrock (Claude Haiku) |
| Payments | Stripe (subscriptions) |
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

### 3. Configure secrets

```bash
cp .env.example .env
# Edit .env and fill in:
#   STRIPE_SECRET_KEY
#   STRIPE_WEBHOOK_SECRET
#   STRIPE_PRICE_STARTER
#   STRIPE_PRICE_PRO
```

### 4. Deploy to AWS

```bash
./scripts/deploy.sh
```

This runs in steps:
1. Install frontend and Lambda dependencies
2. Deploy CDK infrastructure (DynamoDB, Cognito, Lambda, CloudFront, SES, Route53)
3. Extract Cognito IDs → `frontend/.env`
4. Build the React app
5. Sync to S3 and invalidate CloudFront
6. Done — your app is live at your domain

### 5. Set up admin access

```bash
./scripts/setup-admin.sh
```

Creates an admin JWT secret in Secrets Manager. Admin panel is at `manager.yourdomain.com`.

## Architecture

```
yourdomain.com (CloudFront + S3)
├── / — Landing page
├── /login, /signup, /verify — Auth flows (Cognito)
├── /dashboard — Protected user app
│   ├── /dashboard — Items page (generic CRUD — replace with your entity)
│   ├── /dashboard/settings — User settings
│   └── /dashboard/reports — Reports (Pro)
└── manager.yourdomain.com — Admin panel
    ├── /users — All users
    ├── /billing — Revenue overview
    ├── /health — Lambda/DB status
    └── /config — Feature flags, plan limits

API (Lambda Function URL — no API Gateway)
├── GET/POST /api/items — CRUD for your entity
├── GET/PUT /api/account — User profile
├── POST /api/billing/checkout — Stripe checkout
├── POST /api/billing/portal — Stripe customer portal
├── POST /api/webhooks/stripe — Stripe webhook
└── /api/admin/* — Admin endpoints

DynamoDB (single-table design)
├── USER#{userId} | PROFILE — User + plan + Stripe IDs
├── USER#{userId} | ITEM#{itemId} — Your entity
└── CONFIG | GLOBAL — Feature flags, plan limits

Scheduled Lambda (EventBridge, daily 8 AM UTC)
└── lambdas/daily-job/handler.py — Add your scheduled logic here
```

## Customization Guide

### Replace "items" with your entity

The template uses a generic "Item" entity (name + status). To replace it with your domain entity (e.g., "Link", "Post", "Order"):

1. **Backend:** Rename `api/routes/items.py` → `api/routes/links.py`, update DynamoDB key prefix from `ITEM#` to `LINK#`, rename functions
2. **Frontend:** Replace `ItemsPage`, `ItemsTable`, `AddItemForm` with your components
3. **Types:** Update `frontend/src/types.ts` (Item → Link)
4. **API client:** Update `frontend/src/api.ts` (fetchItems → fetchLinks, etc.)
5. **DB helpers:** Update `api/lib/db.py` (get_items → get_links, ITEM_LIMITS → LINK_LIMITS, etc.)
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
  functionName: 'yourapp-my-worker',
  runtime: lambda.Runtime.PYTHON_3_12,
  architecture: lambda.Architecture.ARM_64,
  handler: 'handler.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/my-worker')),
  timeout: cdk.Duration.minutes(5),
  memorySize: 256,
  logGroup: makeLogGroup('my-worker'),
  environment: {
    TABLE_NAME: mainTable.tableName,
    FROM_EMAIL: `noreply@${domainName}`,
  },
});
mainTable.grantReadWriteData(myWorkerFn);

new events.Rule(this, 'MyWorkerRule', {
  schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
  targets: [new eventsTargets.LambdaFunction(myWorkerFn)],
});
```

### Modify plan tiers

Edit `api/lib/db.py`:
```python
ITEM_LIMITS = {
  "free": 10,      # Free plan
  "starter": 100,  # Starter plan
  "pro": float("inf"),  # Pro plan (unlimited)
}
```

Update pricing display in `frontend/src/pages/LandingPage.tsx` and the Stripe price IDs in `.env`.

## Running Tests

```bash
python -m pytest tests/ -v
```

All AWS services are mocked via [moto](https://github.com/getmoto/moto). No real AWS calls during tests.

Run specific tests:
```bash
python -m pytest tests/test_api_items.py -v
python -m pytest tests/test_api_items.py::TestCreateItem::test_create_item -v
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

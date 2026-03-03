# Design: web-aws-framework-template

**Date:** 2026-03-03
**Status:** Approved

## Overview

Extract YourApp into a reusable GitHub Template Repository (`web-aws-framework-template`) — a fully working, deployable opinionated SaaS starter on AWS. New projects are initialized via a `scripts/init.sh` setup script that does automated find-replace on placeholder values.

## Approach

Option A — Systematic placeholder replacement. Copy the entire YourApp repo, do a thorough find-replace throughout all files, genericize the domain-specific frontend/backend, strip domain lambdas (replace with one example worker), and write `init.sh` for new project setup.

## Placeholder Naming Convention

| Placeholder | Usage |
|-------------|-------|
| `yourapp` | Lowercase — resource names (DynamoDB, S3, Lambda prefix, Cognito) |
| `YourApp` | Title case — UI copy and docs |
| `yourapp.com` | Placeholder domain |
| `manager.yourapp.com` | Admin subdomain placeholder |
| `YOUR_AWS_ACCOUNT_ID` | AWS account ID placeholder |

## What Changes vs. YourApp

### CDK Stack
- Files renamed: `cdk/bin/yourapp.ts` → `cdk/bin/yourapp.ts`, `cdk/lib/yourapp-stack.ts` → `cdk/lib/yourapp-stack.ts`
- Stack renamed to `YourAppStack`
- All resource names use `yourapp-` prefix
- Account ID replaced with `YOUR_AWS_ACCOUNT_ID` placeholder (not hardcoded)
- EventBridge schedule added for `daily-job` lambda
- `domainName` defaults to `yourapp.com`

### Frontend
- **Kept as-is (just renamed):** All auth pages, admin dashboard, Stripe billing, plan limits, UpgradeBanner, StatusBadge
- **Genericized:**
  - `LinksPage` → `ItemsPage` (generic CRUD table: id/name/status/createdAt)
  - `LandingPage` → generic SaaS hero with placeholder copy
  - `AddLinkForm` → `AddItemForm`
  - `LinksTable` → `ItemsTable`
- **Removed:** `PipelinePage`, `BulkPasteModal`, `CSVUploadModal`, `LinkDetailDrawer`, `PipelineTable` (YourApp-specific)
- App router updated to remove `/dashboard/pipeline` route

### Backend
- `routes/links.py` → `routes/items.py` — generic CRUD (create/list/update/delete) with `name` + `status` fields
- `routes/pitches.py` — removed
- `routes/account.py`, `routes/billing.py`, `routes/admin.py` — kept as-is
- DynamoDB entities: `USER#`, `ITEM#` (was `LINK#`), `CONFIG`
- Handler routing updated to match `/api/items` instead of `/api/links`

### Lambda Workers
- All 6 domain workers removed (crawler, alerts, digest, reminders, impact-scorer, report-generator)
- New `lambdas/daily-job/handler.py` — well-commented example showing: DynamoDB scan, SES email, Bedrock Claude call
- CDK stack wires daily-job to an EventBridge daily schedule

### Tests
- `test_api_links.py` → `test_api_items.py` (genericized)
- `test_crawler.py`, `test_alerts.py` — removed
- `test_auth.py`, `test_api_billing.py`, `conftest.py` — kept as-is

### Scripts
- All existing deploy scripts kept and updated with `yourapp` placeholders
- New `scripts/init.sh` — interactive project setup (see below)

### New Files
- `README.md` — full setup guide, stack overview, how to use the template
- `CLAUDE.md` — updated for template context (not YourApp-specific)

## `init.sh` Design

Interactive prompts → find-replace across all project files:

```
$ ./scripts/init.sh

Welcome to web-aws-framework-template setup!

Project name (lowercase, no spaces) [myapp]: yourapp
Display name [Linkkeeper]: YourApp
Domain name [yourapp.comm]: yourapp.com
AWS Account ID [123456789012]: YOUR_AWS_ACCOUNT_ID

Replacing 'yourapp' → 'yourapp' in 47 files...
Replacing 'YourApp' → 'YourApp' in 23 files...
Replacing 'yourapp.com' → 'yourapp.com' in 12 files...
Replacing 'YOUR_AWS_ACCOUNT_ID' → 'YOUR_AWS_ACCOUNT_ID' in 3 files...

Done! Next steps:
  1. Copy .env.example → .env and fill in Stripe/SES/Bedrock keys
  2. Run: ./scripts/deploy.sh
```

Uses `sed -i` on all `.ts`, `.tsx`, `.py`, `.sh`, `.json`, `.md` files.

## README Contents

- What this template is and what it includes
- Tech stack overview (React 19, Python Lambda, AWS CDK, Cognito, DynamoDB, SES, Bedrock, Stripe, CloudFront)
- Prerequisites (Node 20+, Python 3.12, AWS CLI, CDK CLI, Stripe account, domain in Route53)
- Quick start: Use this template → clone → `./scripts/init.sh` → fill `.env` → `./scripts/deploy.sh`
- Architecture diagram (text)
- Included features: auth flows, admin dashboard, Stripe billing, plan tiers, SES email, Bedrock AI, scheduled worker, test suite
- Customization guide: where to add entities, how to add lambda workers, how to modify plan tiers
- Cost estimate (~$5-10/mo at low traffic)

## CLAUDE.md Contents

- Template purpose and philosophy
- How `init.sh` works and what placeholders to search for
- Where to add new entities (routes, frontend pages, DynamoDB keys, tests)
- How to add new lambda workers (copy daily-job pattern, add CDK EventBridge rule)
- How to modify Stripe plan tiers
- Deployment instructions
- Key architectural decisions (no API Gateway, single-table DynamoDB, ID token auth, dual-app bundle)

## Final File Structure

```
web-aws-framework-template/
├── frontend/src/
│   ├── pages/
│   │   ├── LandingPage.tsx
│   │   ├── auth/ (unchanged)
│   │   ├── dashboard/
│   │   │   ├── DashboardLayout.tsx
│   │   │   ├── ItemsPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   └── ReportsPage.tsx
│   │   └── admin/ (unchanged)
│   └── components/
│       ├── AddItemForm.tsx
│       ├── ItemsTable.tsx
│       └── StatusBadge.tsx
├── api/routes/
│   ├── items.py
│   ├── account.py
│   ├── billing.py
│   └── admin.py
├── lambdas/daily-job/
│   ├── handler.py
│   └── requirements.txt
├── cdk/
│   ├── bin/yourapp.ts
│   └── lib/yourapp-stack.ts
├── tests/
│   ├── conftest.py
│   ├── test_auth.py
│   ├── test_api_items.py
│   └── test_api_billing.py
├── scripts/
│   ├── init.sh (NEW)
│   ├── deploy.sh
│   ├── deploy-frontend.sh
│   ├── deploy-lambdas.sh
│   └── setup-admin.sh
├── .env.example
├── .gitignore
├── CLAUDE.md (updated for template)
└── README.md (new)
```

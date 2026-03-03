# LinkKeeper Admin Dashboard — Design Document

**Date:** 2026-03-02
**URL:** manager.linkkeeper.co
**Approach:** Same SPA, subdomain routing (Option A)

---

## 1. Authentication

Admin login is independent of Cognito. Credentials stored in AWS Secrets Manager.

**Secret:** `linkkeeper/admin-credentials`
```json
{
  "email": "kevinmarkwert@gmail.com",
  "passwordHash": "<bcrypt hash>",
  "jwtSecret": "<random 64-char string>"
}
```

**Flow:**
1. Visit `manager.linkkeeper.co` → admin login page (email + password)
2. POST `/api/admin/login` → compare against Secrets Manager credential
3. On success → short-lived JWT (24h, signed with `jwtSecret`)
4. JWT stored in memory (not localStorage), sent as `Authorization: Bearer <token>`
5. All `/api/admin/*` routes validate admin JWT (separate from Cognito)

**CLI setup:**
A helper script prompts for password, bcrypt-hashes it, generates JWT secret, and creates/updates the Secrets Manager secret.

---

## 2. Routing & Layout

**Hostname detection:** `App.tsx` checks `window.location.hostname`. If `manager.linkkeeper.co`, render admin route tree. Otherwise, normal user app.

**Routes:**
```
manager.linkkeeper.co
├── /                → AdminLogin (if not authenticated)
├── /                → AdminDashboard (if authenticated)
│   ├── / (default)  → Overview (stats summary cards)
│   ├── /users       → Users & Subscriptions
│   ├── /health      → System Health & Metrics
│   ├── /data        → Content & Data Management
│   └── /config      → Site Configuration
```

**Layout:**
- Dark sidebar nav (`gray-900`) — visually distinct from user dashboard
- Header: "LinkKeeper Manager" branding, admin email, logout
- Same Tailwind design language (indigo primary, gray neutrals, rounded-xl cards)

**Code splitting:**
- Admin pages in `src/pages/admin/`, lazy-loaded via `React.lazy()`
- Admin API functions in `src/admin-api.ts`
- Admin code never loads on user-facing site

---

## 3. Dashboard Pages

### Overview (default `/`)

Summary cards:
- Total Users (count by plan: free/starter/pro)
- Total Links Monitored (status breakdown: live/missing/404/error)
- Total Pitches (by status)
- Last Crawl Run (timestamp + links processed + errors)
- Alerts Sent Today
- MRR (starter count × $9 + pro count × $19)

### Users & Subscriptions (`/users`)

- Searchable/sortable table: email, plan, link count, created date, last active
- Click row to expand: user's links and pitches inline
- Actions: change plan (dropdown), delete account
- Bulk: export CSV

### System Health (`/health`)

Live CloudWatch queries:
- Lambda dashboard: per-function invocation count (24h), error count (24h), avg duration, last invocation
- DynamoDB: consumed vs provisioned RCU/WCU, item count, table size
- SES: emails sent (24h), bounces, complaints, delivery rate
- Crawler: last run, links processed, success/fail, next scheduled

### Content & Data Management (`/data`)

- Links browser: search across ALL users, filter by status/user/domain, view/edit/delete, trigger crawl
- Pitches browser: same pattern — all users, filter/search/edit/delete
- Quick actions: "Crawl all now", "Send digest now" (invoke Lambdas manually)

### Site Configuration (`/config`)

Stored in DynamoDB (`pk=CONFIG, sk=GLOBAL`), read by Lambdas at runtime:
- Feature toggles: maintenance mode, signups enabled, crawling enabled, alerts enabled
- Plan limits: links per tier (free/starter/pro) — editable
- Crawl settings: daily crawl hour, hourly crawl enabled, rate limit delay (ms)
- Email templates: subject/body for alerts, recovery, digest, reminders (template strings with `{placeholders}`)
- Pricing display: plan names, prices, feature lists for landing page

---

## 4. Infrastructure Changes

**CDK updates:**
1. ACM Certificate — add `manager.linkkeeper.co` as SAN
2. CloudFront Distribution — add `manager.linkkeeper.co` to `domainNames`
3. Route53 — A record for `manager.linkkeeper.co` → CloudFront
4. CloudFront Function — handle `manager` subdomain (no www redirect)
5. API Lambda IAM — add: `secretsmanager:GetSecretValue`, `cloudwatch:GetMetricData`, `lambda:ListFunctions`, `lambda:GetFunction`, `ses:GetSendStatistics`, `events:ListRules`, `events:DescribeRule`
6. DynamoDB — no schema changes. Config uses existing table (`pk=CONFIG, sk=GLOBAL`)

No new Lambda functions. All admin endpoints handled by `linkkeeper-api`.

---

## 5. Admin API Endpoints

All under `/api/admin/*`, gated by admin JWT (except login).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Authenticate against Secrets Manager |
| GET | `/api/admin/overview` | Aggregate stats (users, links, MRR) |
| GET | `/api/admin/users` | List all users (paginated) |
| GET | `/api/admin/users/{userId}` | User detail + links + pitches |
| PUT | `/api/admin/users/{userId}` | Update user (change plan) |
| DELETE | `/api/admin/users/{userId}` | Delete user + all data |
| GET | `/api/admin/links` | Search all links (`?status=&q=`) |
| PUT | `/api/admin/links/{userId}/{linkId}` | Edit any link |
| DELETE | `/api/admin/links/{userId}/{linkId}` | Delete any link |
| POST | `/api/admin/links/{userId}/{linkId}/crawl` | Trigger crawl |
| GET | `/api/admin/pitches` | Search all pitches |
| PUT | `/api/admin/pitches/{userId}/{pitchId}` | Edit any pitch |
| DELETE | `/api/admin/pitches/{userId}/{pitchId}` | Delete any pitch |
| GET | `/api/admin/health` | CloudWatch metrics |
| POST | `/api/admin/actions/crawl-all` | Invoke crawler manually |
| POST | `/api/admin/actions/send-digest` | Invoke digest manually |
| GET | `/api/admin/config` | Read site config |
| PUT | `/api/admin/config` | Update site config |

**Auth middleware:** Extracts admin JWT from `Authorization` header, verifies against Secrets Manager JWT secret (cached 5-min TTL), rejects with 401 if invalid/expired.

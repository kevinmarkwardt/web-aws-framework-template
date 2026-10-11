# Template v2: port Never Ending Gallery upgrades + separate admin site

Date: 2026-10-11. Status: draft for Kevin's review. The AI build process layered on top is in [2026-10-11-ai-site-builder-plan.md](2026-10-11-ai-site-builder-plan.md).

## Where things stand

- **Template** (last touched 2026-03-03): React 19 / Vite 7 / Tailwind 4, one Python Lambda, one CDK stack.
  - Stripe is **subscriptions only**: checkout, portal, change plan and cancel.
  - Webhooks have no event dedupe, no idempotency keys and no `invoice.*` handling.
  - There's one Stripe secret, so no test/live split.
  - Admin is a hostname split (`manager.*`) inside the same bundle, with a separate HS256 admin JWT. It logs out on reload and the email is hardcoded in `setup-admin.sh`.
  - No multi-stage deploys, no alarms, no i18n.
  - Leftovers from LinkKeeper and some outright bugs. Details are in the appendix.
- **Never Ending Gallery** has grown a full money and operations layer. Most of it is generic.
  - **Port it from the `review/full-review` branch, not `main`.** The `main` branch has 7 known money bugs (A1–A10 in `review-notes/A-money.md`), including double refunds and webhooks that get stuck in `processing`. The review branch fixes them.

## Target architecture

```
yourapp.com            user site   (frontend/)   → /api/*        → api Lambda
admin.yourapp.com      admin site  (admin/)      → /api/admin/*  → admin Lambda
                       both import packages/shared (api client, auth, UI kit, i18n)
Cognito: one user pool. Admin = Cognito group "admins" + profile isAdmin, re-checked server-side.
```

- **Separate build and deploy.** The admin site gets its own Vite app, S3 bucket and CloudFront distribution. No admin code is ever shipped to users.
- **Separate admin Lambda.** It has its own IAM role and is reachable only through the admin distribution (X-Origin-Verify). Users' API keys can't touch admin routes, and a WAF IP allowlist can be added to the admin site alone.
- **Retire the HS256 admin JWT and `manager.*`.** Admins log in normally on `admin.` with the same pool. Non-admins get a "not authorized" page.
- **Admin link in the user site's menu.** Admins see an "Admin" link that goes to `admin.yourapp.com`.

## Phases

### 0. Clean foundation (template-only fixes)
- Remove the LinkKeeper leftovers, `items`/`SecondEntity` placeholders where unused, the stale `.env` Stripe docs, and the old Bedrock model.
- Fix the bugs:
  - `linkCount` → `itemCount`
  - frontend vs backend plan limits
  - `DEFAULT_CONFIG` missing keys
  - admin `planLimits`, `maintenanceMode` and `signupsEnabled` actually enforced
- **Multi-stage CDK** (`stage: prod|test`). Copy NEG's pattern: prod keeps its names, test gets a suffix, on-demand billing and DESTROY policies, `noindex`, and secrets scoped per stage.
- **Deploy tooling:**
  - `scripts/lib/outputs.sh`
  - deploy with immutable assets and a `no-cache` index
  - `lock-api-deps.sh`
  - `local-test.sh` + `local-api.py`
  - test-site username login
  - `MOCK_AUTH` for local dev
- Replace `setup-admin.sh` with `make-admin.py <email>`.

### 1. Payments core (shared by every billing mode)
- `stripe_config.py`: `{app}/{stage}/stripe` secret, 5-minute cache, `is_live` guard, timeouts and retry.
- `logs.py`: redacted Stripe call log, webhook log, exactly-once `STRIPEEVT#` claim (with the A4 fix), audit log, 18-month TTL.
- `payments.py` `PAY#` records: card fingerprint, Radar risk, fee/net, receipt; per-user and per-day indexes.
- Webhook router with idempotency keys on every Stripe create.
- Disputes: suspend the account, email the admin, block the card.
- `scripts/stripe-setup.py` (idempotent by `lookup_key`, refuses to mix live and test) and `stripe-secret.sh`.
- `cards.py`: saved cards (setup mode).
- `mail.py`: SES sender.

### 2. Billing modules (chosen in `init.sh`: `subscriptions`, `credits` or both)
- **Subscriptions** (hardened existing code):
  - add `invoice.paid` / `invoice.payment_failed`, a grace period, dedupe and idempotency
  - read plan limits from config
- **Credits wallet** (from NEG):
  - paid and bonus ledger with conditional transactions
  - packs and custom amount via config
  - on-site PaymentIntent with 3-D Secure
  - auto-reload
  - refunds: 14-day window, 1-hour hold, newest first, bonus clawback, `REFUNDPENDING#` + `sweep_pending` from the review branch
  - signup gift, daily bonus and referrals as **optional** earning hooks
  - unit name configurable (`CREDIT_NAME`, 100 = $1)
- **Optional modules:**
  - `regions.py` country gating, with the country list in config
  - `fx.py` approximate local prices

### 3. Admin site (`admin.yourapp.com`)
- **CDK:** second bucket and distribution, cert SAN `admin.`, A record, admin Lambda, `PaymentsSweep` EventBridge rule.
- **Generic tabs** (from NEG):
  - Overview (revenue, fees, refunds, disputes, outstanding balances, users)
  - Users (search, detail, ban/unban/suspend/warn, adjust balance, refund card, grant admin; reason required, audited)
  - Payments
  - Stripe log
  - Audit log
  - Support
  - Health
  - Config (feature toggles, plan limits, packs, email templates)
  - Billing config
- **Extension point:** a tab registry so each app adds its own tabs (NEG's Queue, Review, Images and Generation).
- **Scaling:** add a GSI for listing users instead of NEG's full table scan.

### 4. Accounts, trust and safety
- Statuses: active / suspended / banned. Warnings expire after 90 days; 3 warnings = 1-year read-only ban (thresholds in config).
- A ban refunds the paid balance, forfeits the bonus and adds the cards to `BANNED#CARD`.
- Account alerts (`NOTE#` with TTL) in the user-menu dropdown.
- Support tickets (user page + admin tab), topics from config.
- Settings page: Profile, Payment and Notifications tabs, server-backed (not localStorage).

### 5. Frontend platform
- **i18n:** frontend (i18next, lazy languages, `i18n-check.mjs`, language picker) and API (`X-Language`, `api/locales`). Ships English-only, adding a language = drop in a folder.
- **Legal:** `LegalPage` + `legal.json` with Terms/Privacy skeletons.
- **Google tags:** `googleTags()` Vite plugin with IDs from env (GA4, AdSense, EEA/UK/CH consent defaults).
- **SEO:** generated `robots.txt`, `sitemap.xml`, `ads.txt`.
- **Design tokens:** `@theme` tokens in `index.css` so a reskin is one file. Move shared UI into `packages/shared`.

### 6. Ops and security
- **Alarms → SNS email** (prod): API 5xx/p95, throttles, failed webhooks, DynamoDB throttles, SES bounce/complaint, background errors.
- **Edge:** WAF flag (rate limits + managed rules), security-headers policy, cache policy allowlist, origin verify.
- **Cognito email:** branded Cognito emails, Cognito-via-SES behind a flag, optional TOTP (required for admins).
- **Spend:** budget alert pattern.
- **Mail:** optional email forwarding stack (zone and rule set as parameters).
- **Launch:** `docs/launch-checklist.md` (SES production access, DMARC, CloudTrail/GuardDuty, Stripe live, consent).

### 7. Tests, docs and init
- **Port tests:**
  - wallet, admin, support/cards, test login, bad input, messages/language sync
  - review branch: refund safety, spend safety, origin verify, Stripe log privacy, stripe-setup
  - shared `stripe_fake.py`
- **Add tests:** admin Lambda authorization (non-admin gets 403, missing origin header gets 403).
- **`init.sh` prompts:** billing mode, admin email, stage domains, optional modules (i18n languages, regions, Google tags).
- **Docs:** rewrite README/CLAUDE.md; port the generic decisions from `payments-and-admin.md` and `currency-credits.md`.

### 8. (Later) Dogfood on Never Ending Gallery
- Move NEG's admin from `/admin` to `admin.neverendinggallery.com` using the template's admin package.
- Requires the review branch merged first.

## Order and size
Do phases in order 0 → 1 → 2 → 3, then 4–7 in parallel. The first deployable checkpoint is after phase 3: a fresh `init.sh` app with a test stage, credits wallet and admin site. Rough size: 0 = S, 1 = M, 2 = L, 3 = L, 4–6 = M each, 7 = M.

## Open questions for Kevin
1. **Billing default:** offer both modes at init (recommended), or credits only?
2. **Admin login:** separate sign-in on `admin.` (recommended, simplest), or single sign-on via the Cognito Hosted UI?
3. **Admin API:** separate Lambda (recommended) or the same Lambda with `/api/admin/*`?
4. **NEG:** move NEG to `admin.` too? This reverses the 2026-09-25 "admin inside the main site" decision.
5. **i18n:** include it in the template by default (English only), or make it an opt-in module?

## Appendix: template bugs and stale items found
- `account.get_account` returns `linkCount`; the UI reads `itemCount`.
- Frontend limits 5/50 vs backend 10/100/unlimited.
- `DEFAULT_CONFIG` lacks `emailTemplates`/`jobSettings` (those admin pages likely crash on a fresh install).
- Admin settings that do nothing: plan limits, `maintenanceMode` and `signupsEnabled` are never read; MRR is hardcoded at $9/$19; Health hardcodes resource names.
- Admin secrets are read from Secrets Manager on every request, and the admin login has no rate limiting.
- Function URL CORS leaves out `manager.`.
- LinkKeeper leftovers: `index.html` title, `.env.example`, CDK comment, `JobSettingsPage`, `requirements-test.txt`.
- `deploy-lambdas.sh` hides pip errors (`|| true`).
- Unused: the reports bucket, the `email-index` GSI and `VITE_STRIPE_PUBLISHABLE_KEY`.

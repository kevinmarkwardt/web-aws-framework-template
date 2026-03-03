# Admin Panel Restructuring Design

**Date:** 2026-03-02
**Goal:** Restructure the admin panel sidebar and pages to separate generic website template concerns from site-specific (YourApp) concerns, making the admin panel reusable across future projects.

## Sidebar Structure

Three always-expanded groups with section headers, replacing the current flat 5-link sidebar:

```
--- Platform ---
  Overview          /
  Users             /users
  Billing           /billing        (NEW page)
  Health            /health

--- App Data ---
  Links             /data/links     (split from Data page)
  Pitches           /data/pitches   (split from Data page)

--- App Config ---
  Feature Toggles   /config/features    (split from Config page)
  Plan Limits       /config/plans       (split from Config page)
  Crawl Settings    /config/crawl       (split from Config page)
  Email Templates   /config/email       (split from Config page)

[Sign Out]
```

**Platform** = generic, reusable across any SaaS project.
**App Data** = site-specific data management (YourApp: links + pitches).
**App Config** = site-specific configuration (YourApp: crawl settings, plan limits, etc.).

## Page Changes

### Overview (modified)
- Keeps: total users count, total links count
- Loses: MRR and plan distribution (moves to Billing page)

### Billing (new page)
- Top section: Stripe API configuration (publishable key, secret key, webhook secret, starter/pro price IDs) with Save button
- Bottom section: MRR display, plan distribution counts (free/starter/pro)
- Data sources: existing `fetchStripeConfig()` + relevant parts of `fetchOverview()`

### Links (extracted from Data page)
- The current Data page Links tab becomes standalone page
- Same: search bar, status filter dropdown, table, crawl/delete actions, "Crawl All" and "Send Digest" bulk actions

### Pitches (extracted from Data page)
- The current Data page Pitches tab becomes standalone page
- Same: table with domain, status, contact, date, user ID, delete action

### Feature Toggles (extracted from Config page)
- Maintenance mode, signups enabled, crawling enabled, alerts enabled
- Single save button

### Plan Limits (extracted from Config page)
- Free/Starter/Pro max links inputs
- Single save button

### Crawl Settings (extracted from Config page)
- Daily crawl hour (UTC), rate limit delay (ms), hourly pro crawls toggle
- Single save button

### Email Templates (extracted from Config page)
- Dynamic template editor fields
- Single save button

### Unchanged Pages
- Users — no changes
- Health — no changes
- Admin Login — no changes

## File Organization

```
frontend/src/pages/admin/
  AdminLayout.tsx          (updated sidebar with grouped nav)
  AdminLogin.tsx           (unchanged)
  OverviewPage.tsx         (slimmed down — remove billing metrics)
  UsersPage.tsx            (unchanged)
  BillingPage.tsx          (NEW — Stripe config + MRR/plan metrics)
  HealthPage.tsx           (unchanged)
  data/
    LinksPage.tsx          (extracted from DataPage.tsx)
    PitchesPage.tsx        (extracted from DataPage.tsx)
  config/
    FeatureTogglesPage.tsx (extracted from ConfigPage.tsx)
    PlanLimitsPage.tsx     (extracted from ConfigPage.tsx)
    CrawlSettingsPage.tsx  (extracted from ConfigPage.tsx)
    EmailTemplatesPage.tsx (extracted from ConfigPage.tsx)
```

Old files to delete after extraction: `DataPage.tsx`, `ConfigPage.tsx`

## What Doesn't Change

- Backend API endpoints — no modifications needed
- Admin auth flow — same memory-based JWT
- User-facing app — completely untouched
- API client functions in admin-api.ts — reused, called from new page locations
- Admin types — unchanged

## Design Rationale

- **Template reusability:** Platform group (Overview, Users, Billing, Health) is generic SaaS admin scaffolding. App Data and App Config groups are the customization points per-project.
- **Smaller pages:** Breaking the monolithic Config and Data pages into focused sub-pages makes each file easier to maintain and test.
- **Always-expanded sidebar:** With ~10 total links, collapsing adds interaction cost without saving meaningful space.

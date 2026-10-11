# AI site builder: turn the template into an AI-driven website factory

Date: 2026-10-11. Status: draft for Kevin's review. Builds on [template v2 plan](2026-10-11-template-v2-plan.md). Phases 0–3 of that plan land first.

## Goal

Kevin says "create a website for X using the template." The AI then:

1. reads the template's playbook
2. interviews him
3. designs the site with him
4. builds it on realistic mock data
5. deploys a test site
6. hands over a repo that is ready for real feature work

The first site gets everything real except the domain data:

- **Real:** layout, design system, pages, auth, admin, billing plumbing, deploys.
- **Mocked:** the domain data, served behind the same API contract the real backend will use.

## Two layers

| Layer | Lives in | Job |
|---|---|---|
| Entry skill `new-website` | kmark plugin repo (`~/workspace/claude-plugins`) | Triggers on "build/create a website…" from any session. Creates the repo from the template (`gh repo create --template`, private). Then hands off to the playbook. |
| Playbook + tooling | template repo `ai/` | Versioned with the code it drives, so the instructions never drift from the template. |

## Template additions

- `ai/PLAYBOOK.md`: the step-by-step process below, with gates where the AI must stop and get Kevin's OK.
- `ai/interview.md`: question bank grouped into rounds, with a default answer for each question so Kevin can say "your call".
- `ai/site.spec.schema.json` + `site.spec.example.yaml`: **the single source of truth** for a site. It holds:
  - name, domain, audience and purpose
  - modules: billing mode, admin, i18n languages, regions, ads/GA
  - entities, with their fields, relations and volumes
  - pages and the user journeys through them
  - design tokens and brand
  - the mock data plan
- `scripts/init.py`: non-interactive init driven by the spec. It replaces the `sed`-based `init.sh` and turns modules on or off.
- `scripts/new-entity.py <spec entity>`: generates everything for one entity:
  - the contract, MSW handler and fixture file
  - TS types and API client functions
  - list/detail pages and an admin tab
- `scripts/new-entity.py --backend <entity>`: used later, when making an entity real. It generates the Lambda route, DynamoDB helpers and a contract test against the same contract, then flips the mock flag.
- **Page archetypes** in `packages/shared`: landing, browse grid/list, detail, dashboard, pricing, checkout/wallet, account/settings, legal, empty/error states. Design work changes the structure from these starting points, not just the colors.
- **Mock data layer, in the browser (Kevin's decision):**
  - **MSW** (Mock Service Worker) intercepts `fetch` in the browser. Pages call the real `/api/<entity>` URLs, and handlers in `packages/shared/mocks/<entity>.ts` answer from `fixtures/<entity>.json`.
  - **Platform routes are real:** auth, account, wallet and admin platform calls pass through to the real API. Only domain entities are mocked.
  - **Writes** persist to `localStorage`, so create, edit and delete feel real. A "Reset demo data" item in the account menu clears them (test and dev builds only).
  - **Per-entity switch:** `mocks.config.ts` (`{ products: true, ... }`). Going live means writing the backend route and flipping the entity's flag to `false`; pages don't change.
  - **The contract lives in one place:** `packages/shared/contracts/<entity>.ts` holds the types and endpoint list. Both the MSW handlers and the future backend implement it.
  - **Shared with the admin site:** it uses the same handlers and fixtures, so admin entity tabs work on mocks too.
  - **MSW ships in test and dev builds only.** Prod builds fail if any entity is still mocked.
  - **Known limit:** mock data is per browser. Two users, or the user site and the admin site, don't see each other's writes. This goes in `HANDOFF.md`.
- `scripts/gen-fixtures.py`: deterministic (seeded) generator from the spec's mock plan. It covers:
  - realistic volume
  - variety
  - edge cases: empty lists, long names, missing images, many pages
- **Single verify gate:** `scripts/verify.sh` runs pytest, lint, typecheck, build, i18n-check and the contract tests.
- `.claude/launch.json` entries for the local api and web servers, so the browser pane can show the site during design.
- **Template CI:** runs `init.py` on the example spec, then `verify.sh`. This keeps the template from going stale again.
- **AI instructions in CLAUDE.md:** the template's CLAUDE.md gets an "AI: start at `ai/PLAYBOOK.md`" header. The generated site gets its own CLAUDE.md written at handoff.

## The process (what the playbook makes the AI do)

### 1. Kickoff
- Read the template's CLAUDE.md, the playbook and the spec schema.
- Create the repo from the template and start a local branch.

### 2. Discovery interview (2–3 rounds, multiple-choice with recommended defaults)
- **Round A, what and who:** purpose, audience, how it makes money (subscriptions / credits / ads / none), sites Kevin likes.
- **Round B, what's in it:** core entities, main user journeys, what admins need to see and do.
- **Round C, where:** domain, languages, regions, launch timeline.

**Gate:** the AI writes `site.spec.yaml` + `docs/brief.md`, and Kevin confirms them.

### 3. Structure
- Sitemap, page list, the flow of each journey and the data model, shown as a diagram/page.
- Structure comes first; colors come later.

**Gate:** Kevin approves.

### 4. Design (Claude writes UI directly, never delegated to coder agents)
- Build **3 distinct directions** as live pages on the local server, using mock content. They should differ in layout and IA, not only in palette.
- Kevin picks one or mixes them.
- Lock the design tokens (`@theme`), type scale and component styles.
- Generate brand assets (logo, favicon, OG card, hero) via `ai-cli-control` image gen.
- Iterate on screenshots at desktop, mobile and dark mode until Kevin says done.

### 5. Mock data
- Run `gen-fixtures.py` from the spec, and show Kevin a sample.
- Data must look real for the domain: plausible names, prices and dates, and believable distributions.

### 6. Build
- Run `init.py` with the spec, run `new-entity.py` per entity, then build the pages on the approved design.
- Add admin tabs per entity.
- Add translations if they're enabled.

### 7. Verify
- `verify.sh` must pass.
- Walk through every page in the browser pane: each journey end to end, empty and error states, mobile, dark mode, and console errors.
- Fix what turns up, then repeat the walkthrough.

### 8. Deploy test stage
- Run the prerequisites checklist:
  - AWS account, Route 53 hosted zone
  - **domain purchase: Kevin confirms the cost**
  - Stripe sandbox keys, **pasted by Kevin** via `stripe-secret.sh`
  - SES identity
- Deploy `test.<domain>` + `test.admin.<domain>`, then run a smoke test against the deployed site.
- **Prod is deployed only when Kevin asks.**

### 9. Handoff
- `HANDOFF.md`: URLs, how to run locally, how to deploy, what's real vs mocked.
- `docs/ROADMAP.md`: one item per mocked entity (mock → real), plus open product decisions and launch-checklist items.
- The new site's CLAUDE.md, with its architecture, commands and spec pointer.
- A screenshot gallery page.

## Rollout

1. Finish template v2 phases 0–3.
2. Build `site.spec` schema, `init.py`, `new-entity.py`, the fixtures layer and `verify.sh`.
3. Build the page archetypes in `packages/shared`.
4. Write the playbook, the interview bank and the `new-website` plugin skill.
5. **Dogfood:** build one small real site end to end, then fix the playbook wherever the AI stalled or guessed.
6. Template CI goes green; tag `v2.0`.

## Decisions (Kevin, 2026-10-11)

1. **Mocks:** in the browser (MSW).
2. **Design:** three directions per site.
3. **Handoff:** after the test-stage deploy; prod only on request.
4. **Dogfood:** the first run builds a real site Kevin has in mind.

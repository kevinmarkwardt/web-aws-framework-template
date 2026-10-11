# AI Site-Builder Playbook

You are an AI agent building a new website from this template for a user. Follow these steps in order. A **GATE** means stop, show the user the result, and wait for an explicit OK before continuing. Never skip a gate.

Ground rules:
- Read `CLAUDE.md`, this file, `ai/interview.md` and `ai/site.spec.schema.json` before doing anything.
- `site.spec.yaml` (repo root) is the single source of truth. Every decision the user makes goes into it. Regenerate from it; don't hand-edit generated output that the spec controls.
- Ask questions as multiple choice with a recommended default first. The user can always say "your call".
- Design is structure first (layout, information architecture, page flow), color second.
- The first build mocks **domain data in the browser** (MSW). Platform features are real: auth, account, billing, admin.
- Never buy a domain, enter payment keys, or deploy prod. The user does or approves those (see step 8).
- Keep the user posted with one-line status updates between steps.

---

## 1. Kickoff
1. If the repo is still the template, create the site repo: `gh repo create <owner>/<name> --private --template kevinmarkwardt/web-aws-framework-template --clone`, then work inside it.
2. Create a branch `build/initial-site`.
3. Run `scripts/verify.sh` once to confirm the template is green before you change anything.

## 2. Discovery interview
Run the rounds in `ai/interview.md` (A: what and who, B: what's in it, C: where and how).
- Use the question tool, 1–4 questions per call, with a recommended option first.
- Skip questions the user's first message already answered. Restate those answers in your summary instead.
- Propose entities and journeys yourself from the description; let the user correct them.

Write `site.spec.yaml` (validate with `python3 scripts/spec.py validate`) and `docs/brief.md` (one page: purpose, audience, money, journeys, out of scope).

**GATE 1:** show the brief and the spec summary (`python3 scripts/spec.py summary`).

## 3. Structure
Produce:
- the sitemap (every page, public or signed-in or admin)
- each user journey as a step list
- the entity model (fields, relations, rough volumes)

Show it as a diagram page (an Artifact or `docs/structure.md` with Mermaid). Pick page archetypes from `packages/shared/src/archetypes/` for every page, and record them in the spec under `pages[].archetype`.

**GATE 2:** the user approves the structure.

## 4. Design: three directions
1. Run `python3 scripts/init.py --spec site.spec.yaml --design-only`, then `npm install` (the package names changed).
   This applies the name, domain, modules, languages and site config, and keeps the template's Items example for now.
2. Run `python3 scripts/new-entity.py --all` and generate mock fixtures (step 5) first, so the directions show
   realistic content: every entity is then served by the browser mocks (`/api/<plural>`, MSW) with its fixture data.
3. Build **three distinct directions** under `frontend/src/design/directions/{a,b,c}/`. They must differ in layout and information architecture (navigation model, home page composition, density, card vs list), not only palette and font. Write the UI yourself; don't delegate it to another agent.
4. Start the mock-only server (`.claude/launch.json` `web-mock`, http://localhost:5175: MOCK_AUTH + MSW, no AWS; or
   `npm run dev`) and open `/__directions` in the browser pane. Screenshot each direction at desktop and mobile.
5. Present all three side by side, with one sentence each on the idea behind it.

**GATE 3:** the user picks one or a mix. Then:
- write the chosen tokens into `design` in the spec
- run `python3 scripts/init.py --spec site.spec.yaml --apply-design`, which writes the tokens into the
  `/* tokens:begin */` and `/* dark:begin */` blocks of `packages/shared/src/theme.css` (colors with an OKLCH brand
  ramp from `accent`, dark mode from `colors.dark`, fonts, radius, density; never the `@theme inline` mapping) and
  adds self-hosted `@fontsource-variable/*` fonts (run `npm install` when it says so) or a Google Fonts link (which
  the stack's CSP must then allow)
- delete the unused directions
- generate brand assets (logo mark, favicon set, OG card 1200×630, hero if the design uses one) with the image tool (`ai-cli-control` skill: `gen-image.mjs`), saved under `frontend/public/brand/`

Iterate on screenshots (desktop, mobile, dark) until the user says the design is done.

**GATE 4:** design sign-off.

## 5. Mock data
1. Fill `mocks` in the spec: count per entity, distributions, edge cases.
2. Run `python3 scripts/gen-fixtures.py --sample 5`. It writes `packages/shared/src/mocks/fixtures/<plural>.json`
   deterministically from `mocks.seed` (values follow each field's type, name and `hint`, e.g. "15-240, skewed toward
   30-60" or "dish name, 2-6 words"), SVG placeholder images under `{frontend,admin}/public/mock-images/`, and lists
   which `edgeCases` it applied ("one chef with 20 recipes", "recipe with very long title", "recipe with no image",
   "empty search result", "many pages" are understood; others it reports for you to handle).
3. The data must read as real for the domain: plausible names, prices, dates and text lengths, with skewed distributions, not uniform ones. Include the edge cases: empty collections, very long titles, missing images, one item with many children, and pagination.
4. Where the generator's defaults are too generic, write `scripts/fixtures/<entity>.py` (camelCase entity name, e.g.
   `recipe.py`) with any of `value(field, ctx)` (return `...` to keep the generated value), `record(rec, ctx)`,
   `records(rows, ctx)`; use `ctx.rng` / `ctx.fake` so it stays deterministic. Use an LLM for realistic text if needed,
   but freeze it into the override as fixed lists.
5. A changed fixture reseeds every browser's mock store on its next load; "Reset demo data" (user menu, admin header)
   forgets local edits.

Show the user 5 sample records per entity.

## 6. Build
1. Run `python3 scripts/init.py --spec site.spec.yaml`. It is idempotent: it applies names, domain, modules, languages
   and site config, and (now that the spec has entities) removes the template's Items example pages and admin tab.
2. Run `python3 scripts/new-entity.py --all` (or `<Entity>` one at a time). Per entity it writes the contract
   (`packages/shared/src/contracts/<entity>.ts`: type, field metadata, endpoints; the MSW handlers are built from it),
   the fixture file and mock flag, the API client and list/detail pages (+ create/edit form for user-owned entities)
   in `frontend/src/entities/<plural>/`, routes and nav (`routes.gen.ts`, `paths.gen.ts`), an admin tab
   (`admin/src/tabs/entities/<Plural>Tab.tsx`, registered in `admin/src/tabs/entities.gen.ts`) and the texts. Re-run
   it after changing the spec: it never overwrites a page you edited (it says which; `--force` does).
3. Build every page from the spec on the approved design, using the archetypes as a starting point. Adjust them freely
   to fit the design. To change all entities' pages at once, edit `scripts/templates/entity/` and re-run with
   `--force` for the pages you haven't customized.
4. Wire the user journeys end to end, including the empty, loading and error states.
5. Languages come from the spec: `init.py` adds `locales/<lang>/` and `api/locales/<lang>.json` as English copies;
   translate them and run `npm run i18n:check`.
6. Commit as you go (small commits).

## 7. Verify
1. `scripts/verify.sh` must pass (spec, pytest, lint, typecheck, build, i18n check, contract tests). `scripts/verify.sh --prod`
   (the production build, which fails while any entity is mocked) is allowed to fail at this point.
2. Walk through every page in the browser pane:
   - every journey end to end
   - empty, error and long-content states
   - mobile at 375 px
   - dark mode
   - console errors
   - the admin site
3. Fix what you find and walk through again. Keep a short log in `docs/verification.md`.

## 8. Deploy the test stage
Go through `ai/checklists/deploy-prereqs.md` with the user:
- AWS account and profile
- Route 53 hosted zone. **A domain purchase costs money, so the user confirms it first.**
- Stripe sandbox keys. **The user pastes them** with `scripts/stripe-secret.sh test`; never type keys yourself.
- `scripts/stripe-setup.py test`
- SES identity
- an admin email, so you can run `.venv/bin/python scripts/make-admin.py test <email>` after the user signs up on the site (it adds the Cognito group `admins` and sets `isAdmin`; test-login usernames can't be admins)

Then:
- deploy with `STAGE=test scripts/deploy.sh`
- smoke-test `https://test.<domain>` and `https://admin.test.<domain>`: load, sign up, sign in, one journey, and an admin page

**Never deploy prod in this playbook.**

## 9. Handoff
Write:
- `HANDOFF.md` from `ai/templates/HANDOFF.md`:
  - URLs
  - local run
  - deploy commands
  - what's real vs mocked, as a table per entity
  - the per-browser mock-data limitation
  - where the secrets live
- `docs/ROADMAP.md`:
  - one item per mocked entity ("make real": `python3 scripts/new-entity.py --backend <Entity>` writes the API route,
    the contract test and the cache keys and turns the mock off; then add the business rules and deploy)
  - open product decisions
  - the launch checklist (`docs/launch-checklist.md`)
- the site's `CLAUDE.md`: replace the template header with a short description of the site, the spec pointer and its commands. Remove the "AI: start at ai/PLAYBOOK.md" banner.
- a screenshot gallery: one page with every screen, published as an Artifact (private).

Open a PR from `build/initial-site`, summarize it for the user, and stop.

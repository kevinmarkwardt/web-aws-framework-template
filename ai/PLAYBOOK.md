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
1. Run `python3 scripts/init.py --spec site.spec.yaml --design-only`. This applies the name, modules and pages with placeholder styling.
2. Generate mock fixtures (step 5) first so the directions show realistic content.
3. Build **three distinct directions** under `frontend/src/design/directions/{a,b,c}/`. They must differ in layout and information architecture (navigation model, home page composition, density, card vs list), not only palette and font. Write the UI yourself; don't delegate it to another agent.
4. Start the local servers (`scripts/local-test.sh web`, or the `.claude/launch.json` entries) and open `/__directions` in the browser pane. Screenshot each direction at desktop and mobile.
5. Present all three side by side, with one sentence each on the idea behind it.

**GATE 3:** the user picks one or a mix. Then:
- write the chosen tokens into `design` in the spec
- run `python3 scripts/init.py --spec site.spec.yaml --apply-design`, which writes `@theme` tokens into `packages/shared/src/theme.css`
- delete the unused directions
- generate brand assets (logo mark, favicon set, OG card 1200×630, hero if the design uses one) with the image tool (`ai-cli-control` skill: `gen-image.mjs`), saved under `frontend/public/brand/`

Iterate on screenshots (desktop, mobile, dark) until the user says the design is done.

**GATE 4:** design sign-off.

## 5. Mock data
1. Fill `mocks` in the spec: count per entity, distributions, edge cases.
2. Run `python3 scripts/gen-fixtures.py`. It writes `packages/shared/src/mocks/fixtures/<entity>.json` deterministically from `mocks.seed`.
3. The data must read as real for the domain: plausible names, prices, dates and text lengths, with skewed distributions, not uniform ones. Include the edge cases: empty collections, very long titles, missing images, one item with many children, and pagination.
4. Where the generator's defaults are too generic, write `scripts/fixtures/<entity>.py` overrides. Use an LLM for realistic text if needed, but freeze the output into the JSON.

Show the user 5 sample records per entity.

## 6. Build
1. Run `python3 scripts/init.py --spec site.spec.yaml`. It is idempotent: it applies names, domain, modules and stages.
2. Run `python3 scripts/new-entity.py <entity>` for each spec entity. This writes the contract, MSW handler, API client, list/detail pages and an admin tab.
3. Build every page from the spec on the approved design, using the archetypes as a starting point. Adjust them freely to fit the design.
4. Wire the user journeys end to end, including the empty, loading and error states.
5. If more languages are enabled, add `locales/<lang>/` and run `node scripts/i18n-check.mjs`.
6. Commit as you go (small commits).

## 7. Verify
1. `scripts/verify.sh` must pass (pytest, lint, typecheck, build, i18n check, contract tests, the prod-mock guard in `--prod` mode is allowed to fail at this point).
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
- an admin email, so you can run `scripts/make-admin.py test <email>` after the user signs up

Then:
- deploy with `STAGE=test scripts/deploy.sh`
- smoke-test `https://test.<domain>` and `https://test.admin.<domain>`: load, sign up, sign in, one journey, and an admin page

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
  - one item per mocked entity ("make real": run `python3 scripts/new-entity.py --backend <entity>`, implement, flip `mocks.config.ts`)
  - open product decisions
  - the launch checklist (`docs/launch-checklist.md`)
- the site's `CLAUDE.md`: replace the template header with a short description of the site, the spec pointer and its commands. Remove the "AI: start at ai/PLAYBOOK.md" banner.
- a screenshot gallery: one page with every screen, published as an Artifact (private).

Open a PR from `build/initial-site`, summarize it for the user, and stop.

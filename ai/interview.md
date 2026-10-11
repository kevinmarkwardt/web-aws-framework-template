# Discovery interview question bank

Ask in rounds and use multiple choice. Put the **recommended** option first and say why in a few words. Skip anything the user already answered. After each round, write the answers into `site.spec.yaml` straight away. The spec field is shown in `code`.

## Round A: what and who

| # | Question | Typical options | Spec field |
|---|---|---|---|
| A1 | In one sentence, what does the site do? | free text (offer your own one-line summary of their request as option 1) | `site.tagline`, `site.description` |
| A2 | Who is it for? | consumers / professionals / businesses / internal team | `site.audience` |
| A3 | How does it make money? | credits (prepaid wallet) / subscriptions / both / ads only / none yet | `modules.billing.mode`, `modules.ads` |
| A4 | Sites you like the look or feel of? | free text; offer 3 well-known references that match the domain | `design.references` |
| A5 | Tone? | calm and premium / playful / technical and dense / editorial | `design.tone` |

## Round B: what's in it

Before asking, propose the entities and journeys yourself from the Round A answers.

| # | Question | Typical options | Spec field |
|---|---|---|---|
| B1 | These are the main things the site holds. Right? | proposed list / add / remove | `entities[]` |
| B2 | Who creates the content? | the site (admin-curated) / users / both | `entities[].owner` |
| B3 | Key journeys: confirm the top 3 | proposed list | `journeys[]` |
| B4 | Can visitors browse without an account? | yes, sign up to act / no, everything behind login | `site.publicBrowse` |
| B5 | What do admins need beyond users, payments and audit? | per-entity moderation / featured or curation / reports / none | `admin.extraTabs[]` |
| B6 | If billing: what do subscription tiers or credit costs buy? | proposed list | `modules.billing.plans[]` / `modules.billing.creditCosts` |

## Round C: where and how

| # | Question | Typical options | Spec field |
|---|---|---|---|
| C1 | Domain? | already own one (which) / buy one (suggest 3 available-sounding names; purchase needs explicit OK) / decide later (use test.* on an existing domain) | `site.domain` |
| C2 | Languages? | English only / English + others (which) | `modules.i18n.languages` |
| C3 | Where can people pay? | US only / US + listed countries / anywhere Stripe supports | `modules.billing.regions` |
| C4 | Google Analytics and AdSense? | GA only / GA + AdSense / neither for now | `modules.googleTags` |
| C5 | Launch timeline? | just exploring / weeks / ASAP | `site.timeline` (affects nothing technical; it sets the roadmap priority) |

## Defaults when the user says "your call"
- **Billing:** credits if the site sells individual things; subscriptions if it sells ongoing access; none if unsure.
- **Browsing:** public browse on, with sign-up needed to act.
- **Languages:** English only.
- **Regions:** US only.
- **Google tags:** GA only.
- **Admin:** the platform tabs plus one moderation tab per user-created entity.

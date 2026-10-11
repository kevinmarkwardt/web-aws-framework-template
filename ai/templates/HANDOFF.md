# {{displayName}}: handoff

Built from web-aws-framework-template on {{date}}. The spec is in `site.spec.yaml`, the brief in `docs/brief.md`.

## URLs
| | URL |
|---|---|
| Test site | https://test.{{domain}} |
| Test admin | https://admin.test.{{domain}} |
| Prod | not deployed yet. Run `STAGE=prod scripts/deploy.sh` when ready, after `docs/launch-checklist.md` |

## Run locally
```bash
scripts/local-test.sh api   # local API on :3000 against the test stage
scripts/local-test.sh web   # user site on :5173
scripts/local-test.sh admin # admin site on :5174
```

## Deploy
```bash
STAGE=test scripts/deploy.sh
```

## What's real and what's mocked
| Area | Status | Notes |
|---|---|---|
| Sign up, sign in, account | Real | Cognito |
| Billing ({{billingMode}}) | Real (Stripe sandbox) | |
| Admin platform tabs | Real | Users, Payments, Stripe log, Audit, Support |
{{entityRows}}

Mocked entities are served in the browser by MSW from `packages/shared/src/mocks/fixtures/`. Changes are saved in that browser only: other users, and the admin site, don't see them. Use "Reset demo data" in the account menu to clear them.

To make an entity real, see `docs/ROADMAP.md`. Prod builds refuse to build while any entity is still mocked.

## Secrets
Everything is in AWS Secrets Manager under `{{name}}/{stage}/…`. Nothing secret is in the repo.

## Next steps
See `docs/ROADMAP.md`.

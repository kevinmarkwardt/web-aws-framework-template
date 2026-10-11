# Test-stage deploy prerequisites

Go through these with the user before `STAGE=test scripts/deploy.sh`. Items marked **USER** are done by the user, or need their explicit OK.

| # | Item | How | Who |
|---|---|---|---|
| 1 | AWS account and CLI profile | `aws sts get-caller-identity`, and confirm it matches `site.awsAccountId` | AI checks |
| 2 | CDK bootstrapped in the account/region | `npx cdk bootstrap aws://<acct>/<region>`. It is safe to re-run; ask before the first run | AI, with OK |
| 3 | Domain and Route 53 hosted zone | `aws route53 list-hosted-zones-by-name --dns-name <domain>`. If there's no zone and the domain isn't owned: **buying a domain costs money, so the USER approves the exact name and price first** | **USER** |
| 4 | Stripe sandbox account | Dashboard → Developers → API keys (test mode) | **USER** |
| 5 | Stripe keys into Secrets Manager | `scripts/stripe-secret.sh test`. The user pastes the keys at the hidden prompt. **Never type or echo keys yourself** | **USER** |
| 6 | Stripe products, prices and webhook | `python3 scripts/stripe-setup.py test`, after the first deploy has produced the API URL | AI |
| 7 | SES domain identity | Created by CDK. The DNS records are added automatically when the zone is in Route 53. SES stays in sandbox until the user requests production access (see `docs/launch-checklist.md`) | AI |
| 8 | Test-login key (username login on test) | `scripts/test-login-secret.sh` generates and stores a random key | AI |
| 9 | Admin user | After the user signs up on test.<domain>: `python3 scripts/make-admin.py test <email>` | AI, after the user signs up |
| 10 | Alarm email | Confirm the SNS subscription email (prod only; skip for test) | **USER** |

Smoke test after the deploy:
- `https://test.<domain>` loads with no console errors
- sign up, sign in
- one main journey on mock data
- open the wallet or pricing page (Stripe sandbox)
- `https://test.admin.<domain>`: sign in as the admin, then open Overview and one entity tab

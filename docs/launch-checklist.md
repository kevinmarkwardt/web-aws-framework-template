# Launch checklist (prod)

What a person does before and right after opening the prod site: the console and one-off steps no deploy can do, in
order. The test stage needs only [ai/checklists/deploy-prereqs.md](../ai/checklists/deploy-prereqs.md). Region is
us-east-1 throughout (CloudFront certificates, CLOUDFRONT-scope WAF and CloudFront metrics live there).

Items marked **(USER)** need the account owner: they cost money, accept terms, or handle live keys.

## Deploy order

1. **Day 1, start the slow items:** SES production access (§1.1; about a day) and the domain's hosted zone.
2. **Set `cdk/cdk.json`** (§2): `adminEmail`, `alarmEmail`, `budgetUsd`, `billingMode`; leave `cognitoSes` false and
   `waf` false for now.
3. **First prod deploy:** `STAGE=prod scripts/deploy.sh` (type `prod`; read the `cdk diff` it prints).
4. **Confirm the alarm email** (§3.1). Alarms and budget notices go nowhere until you do.
5. **Stripe live** (§5): `scripts/stripe-secret.sh prod`, then `scripts/stripe-setup.py prod`, then `--apply`.
6. **First admin + MFA** (§4): sign up on the site, `make-admin.py prod`, then set up the authenticator app on the
   admin site right away.
7. **Once SES production access is granted:** `cognitoSes: true`, deploy again (§1.2).
8. **Edge:** `waf: true` (+ `adminAllowIps` if you have fixed IPs), deploy again (§3.3).
9. **Legal pages, Google tags and consent** (§6), then the smoke test (§8).

## 1. Email

1. **SES production access (USER).** SES console > Account dashboard > Request production access. Mail type
   Transactional; website `https://<domain>`; use case: sign-up and password-reset codes, receipts and account notices
   to people who created an account; bounces and complaints go to an SNS topic and the suppression list. Until it is
   granted SES only delivers to verified addresses (and at most 200 a day).
   Check: `aws sesv2 get-account --query ProductionAccessEnabled` prints `true`.
2. **Cognito through SES.** After step 1: `"cognitoSes": true` in `cdk/cdk.json`, deploy prod. Cognito's built-in
   sender allows about 50 emails a day from `no-reply@verificationemail.com`; through SES the codes come from
   `noreply@<domain>` with the site's name. Don't turn it on in the SES sandbox: unverified addresses would never get
   their codes. (The flag applies to whichever stage you deploy with it; the domain identity is shared.)
3. **SPF, DKIM, MAIL FROM.** The prod stack creates the SES domain identity with Easy DKIM (CNAMEs in Route 53) and
   the custom MAIL FROM `bounce.<domain>` (its MX and SPF TXT). Check: SES console > Identities > `<domain>`: DKIM
   Successful, Custom MAIL FROM Successful.
4. **DMARC.** Publish `_dmarc.<domain>` TXT `v=DMARC1; p=none; rua=mailto:<a mailbox at the domain>` (the optional
   email forwarding stack does it: §7). After 2-4 weeks of reports in which only SES and your known senders pass, move
   to `p=quarantine`.
5. **Optional, account-wide:** `aws sesv2 put-account-suppression-attributes --suppressed-reasons BOUNCE COMPLAINT`
   (the stack's configuration set already suppresses for this domain's mail).

## 2. `cdk/cdk.json` context

| Key | Default | What |
|---|---|---|
| `adminEmail` | `""` | dispute / failed-refund mail; also the alarm address when `alarmEmail` is empty |
| `alarmEmail` | `""` | SNS alarm + budget subscription (prod) |
| `budgetUsd` | `50` | monthly cost budget, notices at 80% and 100% actual, 100% forecast |
| `waf` | `false` | prod web ACL on both distributions (about $9/month + $0.60 per million requests) |
| `wafRateLimit` | `1000` | requests per IP per 5 minutes before WAF blocks (the Stripe webhook is exempt) |
| `adminAllowIps` | `[]` | CIDRs allowed on the admin site; needs `waf` (a second web ACL, about $6/month more) |
| `cognitoSes` | `false` | Cognito mail through SES (needs SES production access) |
| `adminMfa` | prod on, test off | admins need an authenticator app (`-c adminMfa=0` to turn off) |
| `googleTags` | `false` | add GA4 / AdSense origins (and inline scripts) to the user site's CSP |
| `csp` | `enforce` | `report-only` sends the CSP as Report-Only (violations in the browser console); `off` drops it |

## 3. Alerts, edge and spend

1. **Confirm the alarm email (USER).** The `<prefix>-alerts` SNS subscription stays PendingConfirmation until the
   address clicks the link in "AWS Notification - Subscription Confirmation". Alarms (ALARM and OK), budget notices
   and each SES bounce / complaint arrive there. Check: SNS console > Topics > `<prefix>-alerts` > Subscriptions:
   Confirmed.
2. **Budget.** `budgetUsd` is account-wide (other projects in the account count too). Optional and free: Billing >
   Cost Anomaly Detection > Create monitor (AWS services) with an email alert.
3. **WAF.** `"waf": true`, deploy prod. Check the WAF console's sampled requests after a day: if the common rule set
   blocks something legitimate, add a `ruleActionOverrides` entry (count) for that rule in the stack. With fixed office
   or VPN addresses, set `adminAllowIps` (e.g. `["203.0.113.7/32", "2001:db8::/48"]`): the admin site then answers 403
   to every other address.
4. **CSP.** If a third-party script you add is blocked, deploy with `"csp": "report-only"`, read the console
   violations, add the origin in the stack's `siteCsp`, and go back to `enforce`.

## 4. Admin access and account security

1. **First admin.** Sign up on `https://<domain>` with Cognito, then
   `.venv/bin/python scripts/make-admin.py prod <email>`.
2. **Admin MFA.** `adminMfa` is on in prod: the admin site shows the authenticator setup (QR code) on the first visit
   and asks for a code on every sign-in after that (on both sites: it is one Cognito account). Do it right after
   make-admin: until then anyone with that password could enroll their own app. A lost phone: an AWS admin runs
   `aws cognito-idp admin-set-user-mfa-preference --user-pool-id <pool> --username <username>
   --software-token-mfa-settings Enabled=false,PreferredMfa=false` and the admin sets up a new app.
3. **Root and IAM (USER).** Delete root access keys (`aws iam get-account-summary --query
   SummaryMap.AccountAccessKeysPresent` prints `0`); MFA on root and on your IAM user.
4. **CloudTrail (USER).** CloudTrail > Trails > Create trail: all regions, management events read + write, log file
   validation on, a new S3 bucket. The first trail's management events are free (S3 storage only).
5. **GuardDuty (USER).** GuardDuty > Get started > Enable (paid after a 30-day trial). Route its findings to the alert
   topic with an EventBridge rule if you want them by email.
6. **Backups.** The prod table has point-in-time recovery (35 days) and RETAIN; the user pool is RETAIN. Optional:
   AWS Backup plan for the table if you need longer retention.

## 5. Stripe live (USER for keys)

1. Live key: `scripts/stripe-secret.sh prod` (hidden prompt; never paste keys anywhere else).
2. `.venv/bin/python scripts/stripe-setup.py prod` is a dry run; read it, then add `--apply`: prices and the webhook
   `https://<domain>/api/webhooks/stripe` for the billing mode's events, and its signing secret.
3. Dashboard (live) > Developers > Webhooks: the endpoint is enabled. After the first real payment the admin site's
   Stripe log shows the event. Dashboard > Settings > Communication preferences: webhook-failure emails on.

## 6. Legal, Google tags and consent

1. Fill in the Terms and Privacy pages (company name, contact, data processors: AWS, Stripe, Google if tags are on).
2. Google tags: set the GA4 / AdSense IDs for the build, `"googleTags": true` in `cdk/cdk.json`, deploy.
3. AdSense > Privacy & messaging: publish the European regulations consent message (a Google-certified CMP; it also
   drives consent mode) and the US state regulations message.

## 7. Optional: inbound email forwarding

`MAILBOX=hello@<domain> FORWARD_TO=you@example.com scripts/deploy-email-forwarding.sh` deploys
`infra/email-forwarding.yaml`: an MX for the domain, SES receiving into S3, and a Lambda that forwards to your inbox
(verify `FORWARD_TO` in SES while in the sandbox). It also publishes the root SPF and `_dmarc` records
(`MANAGE_SPF=false` / `MANAGE_DMARC=false` when they already exist; `DMARC_REPORT_TO=hello@<domain>`,
`DMARC_POLICY=quarantine` later).

## 8. Smoke test (prod)

- `https://<domain>` and `https://www.<domain>` load (www redirects) with no console errors (CSP included)
- sign up (the code arrives from `noreply@<domain>` once `cognitoSes` is on), sign in, reset a password
- one main journey; the wallet or plans page; a real small payment and its refund (credits) or a subscription and
  its cancel, then the admin Payments and Stripe log tabs show them
- `https://admin.<domain>`: sign in with the authenticator code; Overview, Health and one entity tab
- from an address outside `adminAllowIps` (if set): the admin site answers 403
- CloudWatch > Alarms: every `<prefix>-*` alarm is OK or Insufficient data, none in ALARM

# Payments: design and decisions

How money moves in the template: Stripe keys and setup, the two billing modules (subscriptions and a credits
wallet), refunds, disputes, account standing, and the logs the admin site reads. Ported from Never Ending Gallery's
`review/full-review` branch, keeping every money fix from its review (A1-A10 in that repo's `review-notes/A-money.md`),
with the gallery specifics (royalties, milestones, the Studio) left out.

## Billing modes

`cdk/cdk.json` context `billingMode` (or `-c billingMode=...`) picks the modules; the stack passes it to the API
Lambda as `BILLING_MODE`. Default in the template: `both`.

| Mode | Subscriptions (`/api/billing/*`) | Credits wallet (`/api/wallet*`, referral) | Saved cards (`/api/account/cards*`) | PaymentsSweep rule |
|---|---|---|---|---|
| `none` | 404 | 404 | 404 | no |
| `subscriptions` | on | 404 | on | no |
| `credits` | 404 | on | on | yes |
| `both` | on | on | on | yes |

- A module that is off answers 404 on every route and ignores its webhook events (`api/handler.py` `_MODULE_ROUTES`,
  `api/routes/webhooks.py`). An unknown `BILLING_MODE` value turns billing off.
- `GET /api/public-config` returns `billingMode`, `plans` (subscriptions) and `credits` (packs, unit name, costs). The
  frontend shows or hides the Plans and Wallet pages, the header balance and the landing pricing from it.
- What each mode sells is code config in `api/lib/config.py`, the knobs of `ai/site.spec.schema.json`
  `modules.billing`:
  - `FREE_PLAN` and `PAID_PLANS`: id, name, monthlyUsd, limits, features (spec `plans[]`; free is implicit).
  - `BILLING`: `creditName`, `packs` (usd + bonusPct), `custom`, `creditCosts`, `signupGift`, `regions`.
  - Template knobs in `BILLING`: `dailyBonus`, `referral`, `localPrices`, `refundDays`, `refundHoldMinutes`,
    `autoReload`, `graceDays`.
  - `ACCOUNT_RULES`: warningDays, warningsToBan, banDays.
- Item limits per plan remain admin-editable (`planLimits`); the plans' `limits.items` are their defaults.

## Stripe setup per stage

| | test | prod |
|---|---|---|
| Secret | `yourapp/test/stripe` | `yourapp/prod/stripe` |
| Key | `sk_test_` / `rk_test_` | `sk_live_` / `rk_live_` |
| Webhook | `https://test.yourapp.com/api/webhooks/stripe` | `https://yourapp.com/api/webhooks/stripe` |

1. `scripts/stripe-secret.sh <stage>`
   - Reads the secret key at a hidden prompt and never echoes it.
   - Refuses a key whose prefix doesn't match the stage.
   - Keeps the secret's other fields.
2. `.venv/bin/python scripts/stripe-setup.py <stage>` does a dry run; add `--apply` to make the changes.
   - Prices are idempotent by `lookup_key`:
     - `yourapp_plan_{id}`: monthly, one per paid plan
     - `yourapp_credits_{packId}`: one per pack
   - A price change creates a new price that takes over the lookup key, and the old price is archived.
   - It creates or updates the webhook endpoint for exactly `webhooks.events_for(mode)`, in the API version of the
     pinned SDK (A17). It stores the signing secret in the stage's secret.
   - It refuses a live/test mismatch.
3. Optional admin overrides of plan price ids: `CONFIG | STRIPE` `{plan}PriceId` (the admin site's Config tab).

At runtime (`api/lib/stripe_config.py`):
- The secret is cached for 5 minutes, so a rotated key needs no deploy.
- A `StripeClient` per call with 3 s connect / 10 s read timeouts and one network retry. A hung call ends inside the
  Lambda's 30 s. "No answer" is never treated as a refusal.
- The test stage refuses a live key.
- Every Stripe create sends a deterministic idempotency key (`stripe_config.idem(...)`):

| Create | Key |
|---|---|
| Customer | `yourapp-customer-{uid}` |
| On-site charge | `yourapp-charge-{uid}-{requestId}` |
| Auto reload | `yourapp-autoreload-{uid}-{day}-{n}` |
| Card refund | `yourapp-refund-{pi}-{attempt}` |
| Subscription Checkout | `yourapp-subcheckout-{uid}-{plan}-{minute}` |
| Plan change | `yourapp-planchange-{sub}-{plan}-{minute}` |
| Billing portal | `yourapp-portal-{uid}-{minute}` |
| Card setup page | `yourapp-cardsetup-{uid}-{page}-{minute}` |

## The webhook (`POST /api/webhooks/stripe`, `api/routes/webhooks.py`)

1. **No secret stored:** answers 503 and refuses everything (A16). Stripe retries for 3 days.
2. **Signature:** checked with a 300 s tolerance. A bad signature is a 400 logged to CloudWatch only, never the audit
   log (A15).
3. **Exactly-once claim:** `STRIPEEVT#{id}` is claimed with `attribute_not_exists OR status = failed OR (processing AND
   older than 3 minutes)`. A Lambda that died after claiming doesn't lose the event (A4). Every handler is safe to run
   again.
4. **Dispatch:** the payments core first (refunds, disputes), then each module that is on:

| Module | Events |
|---|---|
| Core | `charge.refunded`, `refund.failed` / `refund.updated` / `charge.refund.updated`, `charge.dispute.created` / `.closed` |
| Credits | `payment_intent.succeeded` (metadata `kind=topup`) |
| Subscriptions | `checkout.session.completed` (mode subscription), `customer.subscription.updated` / `.deleted`, `invoice.paid`, `invoice.payment_failed` |

5. **A handler error:** marks the event failed and answers 500, so Stripe's retry runs it again.

## Records (DynamoDB, one table)

| Record | Holds |
|---|---|
| `USER#uid / PROFILE` | the account fields below |
| `USER#uid / TX#{key}` | the credits ledger: kind, amount, paid/bonus parts, note, refs. Once-only keys: `TOPUP#{pi}`, `SPEND#{action}#{ref}`, `REFUND#SPEND#...`, `REFUNDCARD#{pi}#{n}`, `REFUNDBACK#...`, `REFUNDEXT#{charge}#{total}`, `SIGNUP`, `DAILY#{day}`, `ADJ#...` |
| `PAY#{pi} / PAY` | one payment (kind `topup`, `subscription` or `external`): user, paid, credits/bonus, fee/net, card brand/last4/exp/country/fingerprint, Radar risk, receipt, `refundedCents`, `refundAttempts`, `disputed` |
| `PAY#{pi} / REFUND#{re}`, `DISPUTE#{dp}` | each refund and dispute |
| `USER#uid / PAYREF#{ts}#{pi}`, `PAYDAY#{day} / {ts}#{pi}` | payments per user and per day |
| `USER#uid / REFUNDPENDING#{pi}#{n}` (+ `REFUNDPENDING / {uid}#{pi}#{n}`) | a card refund whose units are reserved and that Stripe hasn't confirmed yet |
| `CARDFP#{fp} / USER#{uid}`, `BANNED#CARD / {fp}` | accounts per card (same-card checks), cards of banned accounts |
| `USER#uid / PENDING#{release}#{id}` | rewards on hold (referrals) |
| `USER#uid / NOTE#{ts}#{id}` | account alerts (30-day TTL) |
| `USER#uid / WARN#...` | warnings |
| `STRIPELOG#{day}`, `STRIPEEVT#{evt}` (+ `STRIPEEVTDAY#{day}`), `AUDIT#{day}` | Stripe calls, webhooks, admin and automatic actions. 18-month TTL. No personal data: email, name, phone, address, billing/shipping and card details are redacted from requests and audit rows, and responses keep only ids, amounts and states (A14) |

`USER#uid / PROFILE` fields:
- Identity and payments: `stripeCustomerId`, `cardFingerprints`, `removedCards`.
- Credits: `paidCredits`, `bonusCredits`, `hasToppedUp`, `firstTopUpAt`, `referredBy`, and the auto reload settings.
- Subscriptions: `plan`, `stripeSubscriptionId`, `subscriptionStatus`, `paymentFailedAt`.
- Standing: `status`, `statusReason`, `bannedUntil`, `isAdmin`.

## Subscriptions (`api/lib/subscriptions.py`, `api/routes/billing.py`)

- **Routes:** Checkout (`mode=subscription`, an existing Stripe customer, plan in metadata), the billing portal,
  change plan in place (prorated) and cancel (immediate, back to free).
  - Every route needs a signed-in user. That is the lesson of A10: the gallery left the template's subscription routes
    reachable.
  - Suspended or banned accounts are refused (403 `ACCOUNT_RESTRICTED`), and so is Checkout from a gated country.
  - Downgrade and cancel are refused (409 `PLAN_LIMIT`) while the account has more items than the target plan allows.
- **Plan from Stripe:** a subscription's plan comes from its price's lookup key, then an admin override price id,
  then the plan our Checkout put in its metadata.
- **Stale events:** events about a subscription that isn't the account's current one are ignored. A second Checkout
  cancels the previous subscription.
- **Grace period:**
  - `invoice.payment_failed` sets `paymentFailedAt` (the first failure only). It alerts and emails the user once per
    invoice.
  - The plan stays for `graceDays`; after that `effective_plan` is `free` (limits included) until `invoice.paid`
    clears it.
  - Stripe's own retries continue meanwhile; when Stripe gives up (`unpaid` / `canceled`) the plan goes to free.
- **Paid invoices:** recorded as `PAY#` (kind `subscription`), so the admin Payments tab and disputes see them. A
  dashboard refund of a subscription payment takes no wallet units.

## Credits wallet (`api/lib/credits.py`, `payments.py`, `autoreload.py`, `api/routes/wallet.py`)

**Units.** 100 units = $1, and 1 paid unit = 1 cent paid. The display name is `creditName`.
- `paidCredits` were bought and can go back to the card. `bonusCredits` (gifts, pack bonus, rewards) are never cash.
- Spending takes paid units first. That way a bonus can't be spent while its money is refunded.

**For apps.** `credits.spend(user_id, action, units=None, ref=None, note="", extra=None)`.
- It charges `creditCosts[action]`, or `units`, once per `ref`.
- `extra` takes transaction items, or a function `(paid, bonus) -> items`. The app's own record is written in the
  charge's transaction, carrying the split.
- It raises `Blocked` (suspended or banned), `InsufficientCredits`, `AlreadyDone` or `ValueError`.
- `credits.refund_spend(user_id, action, ref)` gives the charge back once, each part to where it came from.
- Under races the balance can never go below zero: both parts are guarded at write time, and a stale read retries.

**Buying.**
- The site charges a saved card with a server-confirmed PaymentIntent (`POST /api/wallet/charge`). The default card
  is used unless one is picked, and it must belong to the caller.
- 3-D Secure returns a redirect, and `GET /api/wallet/charge/{pi}` finishes it on the way back (only the caller's own
  payment).
- Whichever sees the payment first credits it, exactly once (`TX#TOPUP#{pi}`): the charge's answer, the return or the
  `payment_intent.succeeded` webhook.
- The `PAY#` record is written in the credit's own transaction, so a dispute or a dashboard refund always finds it
  (A5). The card details are filled in afterwards, and the webhook fails until they are, so Stripe's retry adds them.
- No answer from Stripe in time is a 504 with `outcome: "unknown"`. The site resends the same `requestId` and Stripe
  answers with the first attempt.
- A double submit that is still running is waited for, not shown as declined (A23).
- Cards are added on a Stripe-hosted setup page (Checkout, setup mode), so no card data touches the site.

**Packs and custom amounts.**
- Packs come from config: `usd` with `bonusPct` gives `payCents` paid units plus the bonus.
- A custom amount is any whole-dollar amount in `custom` (min to max), with no bonus.

**Auto reload.** When a spend leaves the balance under the customer's trigger, the default card is charged
off-session for their pack.
- One at a time (a 120 s lock), and at most `maxPerDay`.
- A decline, a bank check or a restricted account turns it off and leaves an alert. No answer from Stripe keeps it on;
  the webhook credits it if the charge went through.

**Refunds to the card** (A1-A3):
- **What can go back:** unused paid units of top-ups made within `refundDays` (14), from `refundHoldMinutes` (60)
  after the top-up, not disputed, and not after the card was removed.
- **Which top-up a spend used:** spends count against the oldest top-up first. The customer refunds newest first,
  without gaps.
- **The pack bonus:**
  - It goes with its top-up.
  - A bonus that is no longer in the balance was spent, so it comes off the refund (A2). The bonus balance is handed
    to top-ups newest first.
- **Reserve first** (A1):
  - One transaction takes the units off the balance (never below 0), raises the payment's `refundedCents` and writes
    the `REFUNDPENDING#` row.
  - Only then is Stripe asked, with `yourapp-refund-{pi}-{attempt}`. Parallel refund requests or a spend meanwhile
    find the units gone.
- **Stripe's answer:**
  - Refused: the units come back at once.
  - No answer: the refund stays pending (A3). `reconcile` asks again with the same key on the next wallet load or
    refund, and after a day it looks the refund up by that key.
  - `sweep_pending` does this for everyone every 15 minutes (EventBridge `PaymentsSweep` invokes the API Lambda with
    `{"source": "aws.events", "detail-type": "Scheduled Event", "app_task": "payments-sweep"}`). A Function URL request
    can't produce that event.
- **Failed later:** a refund that fails at Stripe later gives the units back once.
- **Dashboard refunds:** a refund made in the Stripe dashboard takes the matching paid units once, in one transaction
  with `refundedCents` (A12).
- **Side effects:** a refunded top-up cancels the referral rewards on hold from it and recomputes `hasToppedUp`
  (`payments.refresh_topped_up` is its only writer).

**Earning hooks.** All are optional and off by default, except `signupGift` (spec, default 0):
- `signupGift`: bonus units for a new account.
- `dailyBonus`: once a day, only while the account has a top-up still paid for.
- `referral`: rewards for the referrer and the friend.
  - They are held 14 days after the friend's first top-up, and cancelled if it is refunded or disputed (A6).
  - They are skipped when the friend's card was used by the inviter or an account the inviter invited.
  - Invite codes work only on new accounts that never topped up.

## Disputes

`charge.dispute.created`:
1. Marks the payment disputed, so there are no card refunds of it.
2. Suspends the account; a banned account stays banned (A22).
3. Cancels rewards on hold from the payment.
4. Emails the admin with the evidence deadline.

A dispute on a charge without a `PAY#` record (one made in the dashboard, say) finds the user by the charge's Stripe
customer.

`charge.dispute.closed` with status won lifts the suspension it caused.

## Account standing (`api/lib/accounts.py`)

- `active`, `suspended` or `banned`.
- **Warnings:** a warning expires after `warningDays` (90). One per `ref`, so a retry adds nothing. The
  `warningsToBan`-th (3rd) active warning bans automatically.
- **A ban** lasts `banDays` (365) and is lifted lazily.
  - The account is read-only: reading works; spending, top-ups, cards, refunds, subscriptions and item writes don't.
  - The paid balance goes back to the card (policy `all`) and all bonus is forfeited.
  - An active subscription is cancelled, and the account's cards go on `BANNED#CARD`.
  - A top-up with a banned card on another account emails the admin.
- **Suspended** (a dispute, or an admin's call) pauses payments the same way but refunds nothing.
- **Alerts:** the user sees `NOTE#` alerts in the user menu and a banner for banned, suspended or a failed renewal.

## Optional modules

- **`regions.py`** (`BILLING.regions`; empty = no gating). Only visitors from the listed countries can pay, add a
  card, turn on auto reload or start a subscription, and saved-card charges also check the card's issuing country.
  - The visitor's country comes from `CloudFront-Viewer-Country`, trusted only with `X-Origin-Verify` (the Function
    URL is public).
  - An unknown country is refused, except locally and in tests (`ALLOW_NO_VIEWER_COUNTRY=1`).
  - Subscription Checkout takes any card, so for subscriptions only the visitor's country is checked.
- **`fx.py`** (`BILLING.localPrices`, off by default): an approximate local price next to the dollar price, from a
  free daily feed cached in `CONFIG / FX`. Any failure shows nothing extra.

## For the admin site

The operations live in `api/lib`; the admin API (`api/admin_handler.py` → `api/routes/admin.py`, its own Lambda on
`admin.<site host>`) only adds routes. Every request re-checks the caller (Cognito group `admins` and `isAdmin`), every
user action takes a reason and is audited with actor `admin:{uid}`:

| Operation | Function |
|---|---|
| Adjust balance | `payments.adjust_balance(uid, amount, reason, actor)` |
| Refund to card | `payments.refund_to_card(uid, amount or None, reason, actor, policy="all" or "window", forfeit_bonus=False)` and `payments.refundable(uid, policy)` |
| Ban / unban / suspend | `accounts.ban(uid, reason, actor, days=None)`, `accounts.set_status(uid, "active" or "suspended", reason, actor)` |
| Warnings | `accounts.add_warning(uid, reason, actor, ref="")`, `accounts.remove_warning(uid, warn_sk, actor, reason)`, `accounts.warnings(uid)` |
| Admin flag | `admins.set_admin(uid, flag, actor, reason)`: the Cognito group and `accounts.set_admin` together |
| Payments | `payments.by_day(day)`, `payments.for_user(uid)`, `payments.detail(pi)`, `payments.breakdown(uid)` |
| Logs | `logs.stripe_calls(day, user_id=, failures_only=)`, `logs.webhooks(day, failures_only=)`, `logs.webhook(evt)`, `logs.audits(day, actor=, target=)` |
| Subscriptions | `subscriptions.state(profile)`, `subscriptions.cancel_now(uid, actor, reason)` |
| Ledger | `credits.history(uid)`, `credits.balance(profile)` |
| Sweep now | `payments.sweep_pending()` |

## Decisions

1. **Saved cards only:** credits are bought on the site with saved cards (server-confirmed PaymentIntents), never
   through Checkout. The card's country is checked before a charge, and the customer never leaves the site except for
   3-D Secure.
2. **Paid first:** paid units are spent first. Card refunds cover unused paid units only, within 14 days, from an hour
   after buying, newest first, with the pack bonus deducted when it was spent.
3. **Reserve first:** card refunds take the units before Stripe is asked, under deterministic idempotency keys, and a
   scheduled sweep reconciles any that were left pending.
4. **Log retention:** the Stripe call, webhook and audit logs are kept 18 months and hold no personal data.
5. **Billing config:** it lives in code (`api/lib/config.py`), filled from the site spec, not in the admin-editable
   `CONFIG | GLOBAL` record (except item `planLimits` and the plan price overrides). The admin Config tab shows it
   read-only; making it editable would mean merging stored overrides into what `config.BILLING`, `config.packs()` and
   `config.plans()` return.
6. **Subscription cancel:** a cancel is immediate. Switch to `cancel_at_period_end` in `subscriptions.cancel_now` if
   the app prefers.

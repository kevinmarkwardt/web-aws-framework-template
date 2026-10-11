"""Admin API (/api/admin/*), served only by the admin Lambda (api/admin_handler.py), which has checked the caller
(lib/admins.py: the Cognito group and the profile flag) before any of these run. The user API Lambda answers 404 for
every /api/admin/* path.

Every function takes (event, actor, ...path parts); actor is "admin:{uid}" (audit rows hold ids, never emails).

  GET  /api/admin/me                         who is signed in, the stage, the billing mode and what it sells (tabs)
  GET  /api/admin/overview?days=30           money (by kind), outstanding balances, users, subscriptions
  GET  /api/admin/users?q=&status=&cursor=   newest first from list-index (never a table scan)
  GET  /api/admin/users/{uid}                profile, balance, history, payments, subscription, warnings, notes
  POST /api/admin/users/{uid}/{action}       ban | unban | suspend | warn | remove-warning | adjust-balance |
                                             refund-card | admin; {reason (required), ...}; audited
  GET  /api/admin/payments?day=              one UTC day's payments
  GET  /api/admin/payments/{pi}              a payment with its refunds and disputes
  GET  /api/admin/stripe-log?day=&failed=1&user=   our calls to Stripe
  GET  /api/admin/webhooks?day=&failed=1     webhook deliveries;  GET /api/admin/webhooks/{evt}
  GET  /api/admin/audit?day=&actor=&target=  admin and automatic actions
  GET  /api/admin/health                     Lambda, DynamoDB and SES (this stage's resource names, from the env)
  GET  /api/admin/config, PUT                site config (lib/config.py; a PUT merges the sections sent); audited
  GET  /api/admin/config/stripe, PUT         Stripe mode and plan price overrides (CONFIG | STRIPE {plan}PriceId)
  GET  /api/admin/items?cursor=              the example entity across users (list-index)
  DELETE /api/admin/items/{uid}/{itemId}     {reason}; audited
  POST /api/admin/actions/{daily-job|payments-sweep}   run a scheduled task now; audited
Support tickets (/api/admin/support) live in routes/support.py.
"""

from __future__ import annotations

import datetime as dt
import json
import os

import boto3
from boto3.dynamodb.conditions import Key

try:
    from lib import accounts, admins, config, credits, db, logs, notes, params, payments, response, stripe_config, subscriptions
except ImportError:
    from api.lib import accounts, admins, config, credits, db, logs, notes, params, payments, response, stripe_config, subscriptions

REGION = os.environ.get("AWS_REGION", "us-east-1")
MAX_DAYS = 366       # the overview looks back at most a year (one query per day)
PAGE = 50
SEARCH_READS = 5000  # a search reads at most this many profiles per request, then hands back a cursor


def _actor_uid(actor: str) -> str:
    return actor.split(":", 1)[1] if ":" in actor else actor


def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "ttl", "listPk") and not k.startswith("_")}


def _pay_row(pay: dict) -> dict:
    """A PAY# record for the admin site, with its payment intent id (the record keeps it only in its key)."""
    return {**_clean(pay), "paymentIntent": pay["pk"].split("#", 1)[1]}


def _days(n: int) -> list[str]:
    today = dt.datetime.now(dt.timezone.utc).date()  # UTC: payments and logs are filed by UTC day
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(n)]


def _since(days: int) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()


def _billing_off() -> dict:
    return response.not_found("Billing is off on this site (BILLING_MODE=none)")


def _credits_off() -> dict:
    return response.not_found("The credits wallet is off on this site")


# ---- me

def me(event: dict, actor: str) -> dict:
    """The signed-in admin and what the admin site shows: tabs are hidden per billing mode."""
    uid = _actor_uid(actor)
    p = db.get_user(uid) or {}
    mode = config.billing_mode()
    out = {"userId": uid, "email": p.get("email", ""), "name": p.get("name", ""), "stage": os.environ.get("STAGE", "prod"),
           "siteUrl": os.environ.get("SITE_URL", ""), "billingMode": mode,
           "creditName": credits.unit_name() if config.credits_on() else None,
           "plans": config.plans() if config.subscriptions_on() else [],
           "packs": config.packs() if config.credits_on() else [],
           "accountRules": dict(config.ACCOUNT_RULES), "supportTopics": dict(config.SUPPORT["topics"])}
    return response.ok(out)


# ---- overview

def overview(event: dict, actor: str) -> dict:
    """Totals for the Overview tab. Users come from list-index (every profile is read: fine for small and mid-size
    sites; keep running counters instead once there are tens of thousands)."""
    days = params.query_int(event, "days", 30, 1, MAX_DAYS)
    mode = config.billing_mode()
    since7, since30 = _since(7), _since(30)
    users = {"total": 0, "active": 0, "suspended": 0, "banned": 0, "admins": 0, "new7": 0, "new30": 0}
    paid_units = bonus_units = 0
    plans: dict[str, int] = {}
    subs = {"active": 0, "failing": 0, "mrrUsd": 0}
    list_price = {p["id"]: p["monthlyUsd"] for p in config.PAID_PLANS}
    for p in db.list_all("USER"):
        users["total"] += 1
        users[accounts.status(p)] += 1
        users["admins"] += p.get("isAdmin") is True
        created = str(p.get("createdAt", ""))
        users["new7"] += created >= since7
        users["new30"] += created >= since30
        paid_units += int(p.get("paidCredits", 0))
        bonus_units += int(p.get("bonusCredits", 0))
        if config.subscriptions_on():
            plan = subscriptions.effective_plan(p)
            plans[plan] = plans.get(plan, 0) + 1
            if p.get("stripeSubscriptionId") and plan != "free":
                subs["active"] += 1
                subs["mrrUsd"] += list_price.get(plan, 0)
            if p.get("paymentFailedAt"):
                subs["failing"] += 1
    out: dict = {"billingMode": mode, "days": days, "users": users}
    if mode != "none":
        totals = {"count": 0, "paidCents": 0, "feeCents": 0, "netCents": 0, "refundedCents": 0}
        by_kind: dict[str, dict] = {}
        disputed = 0
        for day in _days(days):
            for pay in payments.by_day(day, limit=1000):
                k = by_kind.setdefault(pay.get("kind", "topup"), {key: 0 for key in totals})
                for row in (totals, k):
                    row["count"] += 1
                    for f in ("paidCents", "feeCents", "netCents", "refundedCents"):
                        row[f] += int(pay.get(f, 0))
                disputed += bool(pay.get("disputed"))
        pending = db._get_table().query(KeyConditionExpression=Key("pk").eq(payments.PENDING_INDEX), Select="COUNT")["Count"]
        out["payments"] = {**totals, "byKind": by_kind, "disputed": disputed, "pendingRefunds": pending}
    if config.credits_on():
        # what users hold: paid units are money that could go back to the card (1 unit = 1 cent); bonus is never cash
        out["outstanding"] = {"paidCredits": paid_units, "bonusCredits": bonus_units, "creditName": credits.unit_name()}
    if config.subscriptions_on():
        out["subscriptions"] = {**subs, "byPlan": plans}
    return response.ok(out)


# ---- users

def _user_row(p: dict) -> dict:
    uid = p.get("userId") or p["pk"].split("#", 1)[1]
    row = {"userId": uid, "email": p.get("email", ""), "name": p.get("name", ""), "createdAt": p.get("createdAt", ""),
           "isAdmin": p.get("isAdmin") is True, **accounts.standing(p), "itemCount": int(p.get("itemCount", 0))}
    if config.subscriptions_on():
        row["plan"] = subscriptions.effective_plan(p)
    if config.credits_on():
        row.update(credits.balance(p))
    return row


def users(event: dict, actor: str) -> dict:
    """Newest first, PAGE at a time. `q` matches email, name or id (case-insensitive substring); an exact user id is
    looked up directly. `status` keeps one standing. A filtered page reads up to SEARCH_READS profiles and returns the
    cursor where it stopped."""
    q = params.query(event, "q").strip().lower()
    status = params.query(event, "status")
    cursor = params.query(event, "cursor") or None
    if status and status not in accounts.STATUSES:
        raise params.BadRequest(f"status must be one of {', '.join(accounts.STATUSES)}")
    if q and not cursor:
        exact = db.get_user(q) if len(q) <= 128 and "#" not in q else None
        if exact:
            return response.ok({"users": [_user_row(exact)], "cursor": None})
    try:
        if not q and not status:
            rows, cursor = db.list_page("USER", PAGE, cursor)
            return response.ok({"users": [_user_row(p) for p in rows], "cursor": cursor})
        found, read = [], 0
        while len(found) < PAGE and read < SEARCH_READS:
            rows, cursor = db.list_page("USER", 100, cursor)
            read += len(rows)
            for p in rows:
                hay = f"{p.get('email', '')} {p.get('name', '')} {p.get('userId', '')}".lower()
                if (not q or q in hay) and (not status or accounts.status(p) == status):
                    found.append(_user_row(p))
            if not cursor:
                break
    except db.BadCursor:
        raise params.BadRequest("bad cursor") from None
    return response.ok({"users": found, "cursor": cursor})


def user_detail(event: dict, actor: str, uid: str) -> dict:
    p = db.get_user(uid)
    if not p:
        return response.not_found("User not found")
    user = {**_user_row(p), "statusReason": p.get("statusReason"), "bannedAt": p.get("bannedAt"), "bannedBy": p.get("bannedBy"),
            "stripeCustomerId": p.get("stripeCustomerId", ""), "cards": len(p.get("cardFingerprints") or [])}
    out: dict = {
        "user": user,
        "warnings": [{k: w.get(k) for k in ("sk", "reason", "actor", "ref", "at", "expiresAt", "active", "removed", "removedBy")}
                     for w in accounts.warnings(uid)],
        "notes": notes.visible(uid),
        "accountRules": dict(config.ACCOUNT_RULES),
    }
    if config.billing_mode() != "none":
        out["payments"] = [_pay_row(x) for x in payments.for_user(uid)]
    if config.subscriptions_on():
        out["subscription"] = subscriptions.state(p)
    if config.credits_on():
        out["history"] = credits.history(uid, 200)
        out["refundable"] = {"window": payments.refundable(uid, "window"), "all": payments.refundable(uid, "all")}
        out["pending"] = [_clean(h) for h in credits.pending(uid)]
        out["creditName"] = credits.unit_name()
    return response.ok(out)


ACTIONS = ("ban", "unban", "suspend", "warn", "remove-warning", "adjust-balance", "refund-card", "admin")
SELF_BLOCKED = ("ban", "suspend", "admin")  # an admin can't lock themselves out (another admin can)


def user_action(event: dict, actor: str, uid: str, action: str) -> dict:
    """Every action needs a reason (it goes in the audit log, with the actor). The lib functions write the audit rows."""
    if not db.get_user(uid):
        return response.not_found("User not found")
    b = params.body(event)
    reason = params.text(b, "reason").strip()[:500]
    if not reason:
        return response.error("A reason is required (it goes in the audit log)", 400, "REASON_REQUIRED")
    if uid == _actor_uid(actor) and action in SELF_BLOCKED:
        return response.error("You can't do that to your own account; ask another admin", 400)
    try:
        if action == "ban":
            days = b.get("days")
            if days is not None and (isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 3650):
                raise params.BadRequest("days must be a whole number from 1 to 3650")
            return response.ok(accounts.ban(uid, reason, actor, days=days))
        if action == "unban":
            accounts.set_status(uid, "active", reason, actor)
            return response.ok({"status": "active"})
        if action == "suspend":
            accounts.set_status(uid, "suspended", reason, actor)
            return response.ok({"status": "suspended"})
        if action == "warn":
            accounts.add_warning(uid, reason, actor)
            return response.ok({"activeWarnings": accounts.active_warnings(uid), "status": accounts.status(accounts.profile(uid))})
        if action == "remove-warning":
            if not accounts.remove_warning(uid, params.text(b, "warningSk"), actor, reason):
                return response.not_found("Warning not found")
            return response.ok({"activeWarnings": accounts.active_warnings(uid)})
        if action == "adjust-balance":  # + goodwill (bonus units), - a correction (bonus first); never the card
            if not config.credits_on():
                return _credits_off()
            amount = b.get("amount")
            if isinstance(amount, bool) or not isinstance(amount, int) or amount == 0:
                raise params.BadRequest("amount must be a whole number of units, not 0")
            return response.ok(payments.adjust_balance(uid, amount, reason, actor))
        if action == "refund-card":  # unused paid units back to the card; admins may refund outside the window ("all")
            if not config.credits_on():
                return _credits_off()
            amount = b.get("amount")
            if amount in (None, "max"):
                amount = None
            elif isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
                raise params.BadRequest('amount must be a whole number of units above 0, or "max"')
            policy = "window" if b.get("policy") == "window" else "all"
            return response.ok(payments.refund_to_card(uid, amount, reason, actor, policy=policy))
        if action == "admin":
            flag = b.get("isAdmin")
            if not isinstance(flag, bool):
                raise params.BadRequest("isAdmin must be true or false")
            admins.set_admin(uid, flag, actor, reason)
            return response.ok({"isAdmin": flag})
    except payments.RefundError as e:
        return response.error(str(e), 400)
    except admins.NotCognitoUser:
        return response.error("Only accounts that sign in with Cognito can be admins (not test-login accounts)", 400)
    return response.not_found("Unknown action")


# ---- payments, Stripe log, webhooks, audit

def payments_list(event: dict, actor: str) -> dict:
    if config.billing_mode() == "none":
        return _billing_off()
    day = params.day(event)
    rows = [_pay_row(x) for x in payments.by_day(day, limit=1000)]
    total = {f: sum(int(r.get(f, 0)) for r in rows) for f in ("paidCents", "feeCents", "netCents", "refundedCents")}
    return response.ok({"day": day, "payments": rows, "totals": {"count": len(rows), **total}})


def payment_detail(event: dict, actor: str, pi: str) -> dict:
    if config.billing_mode() == "none":
        return _billing_off()
    pay = payments.detail(pi)
    if not pay:
        return response.not_found("Payment not found")
    return response.ok({**_pay_row(pay), "refunds": [_clean(r) for r in pay["refunds"]], "disputes": [_clean(d) for d in pay["disputes"]]})


def stripe_log(event: dict, actor: str) -> dict:
    if config.billing_mode() == "none":
        return _billing_off()
    day = params.day(event)
    rows = logs.stripe_calls(day, 500, user_id=params.query(event, "user"), failures_only=params.query(event, "failed") == "1")
    return response.ok({"day": day, "entries": rows})


def webhooks(event: dict, actor: str) -> dict:
    if config.billing_mode() == "none":
        return _billing_off()
    day = params.day(event)
    return response.ok({"day": day, "entries": logs.webhooks(day, 500, failures_only=params.query(event, "failed") == "1")})


def webhook(event: dict, actor: str, evt: str) -> dict:
    if config.billing_mode() == "none":
        return _billing_off()
    row = logs.webhook(evt)
    return response.ok(_clean(row)) if row else response.not_found("Event not found")


def audit_log(event: dict, actor: str) -> dict:
    day = params.day(event)
    rows = logs.audits(day, 500, actor=params.query(event, "actor"), target=params.query(event, "target"))
    return response.ok({"day": day, "entries": rows})


# ---- health (this stage's resource names come from the environment the stack sets, never hardcoded)

def _functions() -> dict[str, str]:
    names = {"api": os.environ.get("API_FUNCTION_NAME", ""), "admin": os.environ.get("AWS_LAMBDA_FUNCTION_NAME", ""),
             "daily-job": os.environ.get("DAILY_JOB_FUNCTION", "")}
    return {k: v for k, v in names.items() if v}


def _lambda_health(cw, start, end) -> dict:
    fns = _functions()
    queries = []
    for i, (label, fn) in enumerate(fns.items()):
        dims = [{"Name": "FunctionName", "Value": fn}]
        for metric, stat in (("Invocations", "Sum"), ("Errors", "Sum"), ("Throttles", "Sum"), ("Duration", "Average"), ("Duration", "p95")):
            queries.append({"Id": f"f{i}_{metric.lower()}_{stat.lower()}", "Label": f"{label}|{metric}|{stat}",
                            "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": metric, "Dimensions": dims},
                                           "Period": 86400, "Stat": stat}})
    if not queries:
        return {}
    got = {r["Label"]: (r["Values"][0] if r["Values"] else 0) for r in cw.get_metric_data(
        MetricDataQueries=queries, StartTime=start, EndTime=end)["MetricDataResults"]}
    return {label: {"function": fn, "invocations": int(got.get(f"{label}|Invocations|Sum", 0)),
                    "errors": int(got.get(f"{label}|Errors|Sum", 0)), "throttles": int(got.get(f"{label}|Throttles|Sum", 0)),
                    "avgMs": round(got.get(f"{label}|Duration|Average", 0), 1), "p95Ms": round(got.get(f"{label}|Duration|p95", 0), 1)}
            for label, fn in fns.items()}


def _dynamodb_health(cw, start, end) -> dict:
    name = db.TABLE_NAME
    t = boto3.client("dynamodb", region_name=REGION).describe_table(TableName=name)["Table"]
    throttled = cw.get_metric_data(MetricDataQueries=[{
        "Id": "throttled", "MetricStat": {"Metric": {"Namespace": "AWS/DynamoDB", "MetricName": "ThrottledRequests",
                                                      "Dimensions": [{"Name": "TableName", "Value": name}]},
                                           "Period": 86400, "Stat": "Sum"}}], StartTime=start, EndTime=end)["MetricDataResults"]
    return {"table": name, "status": t.get("TableStatus"), "itemCount": t.get("ItemCount", 0), "sizeBytes": t.get("TableSizeBytes", 0),
            "billing": (t.get("BillingModeSummary") or {}).get("BillingMode", "PROVISIONED"),
            "indexes": [{"name": g["IndexName"], "status": g.get("IndexStatus")} for g in t.get("GlobalSecondaryIndexes", [])],
            "throttled24h": int((throttled[0]["Values"] or [0])[0]) if throttled else 0}


def _ses_health() -> dict:
    ses = boto3.client("ses", region_name=REGION)
    quota = ses.get_send_quota()
    points = ses.get_send_statistics().get("SendDataPoints", [])
    out = {"sender": os.environ.get("SES_FROM_EMAIL", ""), "max24h": quota.get("Max24HourSend", 0),
           "sent24h": quota.get("SentLast24Hours", 0), "maxPerSecond": quota.get("MaxSendRate", 0),
           "last14d": {k.lower(): sum(int(p.get(k, 0)) for p in points) for k in ("DeliveryAttempts", "Bounces", "Complaints", "Rejects")}}
    try:
        out["productionAccess"] = bool(boto3.client("sesv2", region_name=REGION).get_account().get("ProductionAccessEnabled"))
    except Exception:  # noqa: BLE001 - optional detail
        out["productionAccess"] = None
    return out


def health(event: dict, actor: str) -> dict:
    """Each section is fetched on its own; one that fails says why instead of failing the page."""
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(hours=24)
    cw = boto3.client("cloudwatch", region_name=REGION)
    out: dict = {"stage": os.environ.get("STAGE", "prod"), "region": REGION, "at": end.isoformat()}
    for key, fn in (("lambda", lambda: _lambda_health(cw, start, end)), ("dynamodb", lambda: _dynamodb_health(cw, start, end)),
                    ("ses", _ses_health)):
        try:
            out[key] = fn()
        except Exception as e:  # noqa: BLE001
            out[key] = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    today = end.date().isoformat()
    out["app"] = {"failedWebhooksToday": len(logs.webhooks(today, 200, failures_only=True)) if config.billing_mode() != "none" else 0,
                  "pendingRefunds": db._get_table().query(KeyConditionExpression=Key("pk").eq(payments.PENDING_INDEX),
                                                          Select="COUNT")["Count"] if config.credits_on() else 0,
                  "openSupport": db._get_table().query(KeyConditionExpression=Key("pk").eq("SUPPORTQ#open"), Select="COUNT")["Count"]}
    return response.ok(out)


# ---- config

def get_config(event: dict, actor: str) -> dict:
    """The effective site config: defaults merged with the stored CONFIG | GLOBAL record (lib/config.py)."""
    return response.ok(config.get_site_config(fresh=True))


def put_config(event: dict, actor: str) -> dict:
    """Merges the sections sent into the stored config (a page that saves one section keeps the others). Other warm
    Lambdas pick it up within config.CACHE_TTL seconds."""
    updates = params.body(event)
    before = config.get_site_config(fresh=True)
    saved = config.save_site_config(updates)
    logs.audit(actor, "config.update", "config:GLOBAL", "admin site", before={k: before.get(k) for k in updates},
               after=updates)
    return response.ok(saved)


def _stripe_mode() -> str:
    try:
        return "live" if stripe_config.is_live() else ("test" if stripe_config._secret().get("secretKey") else "missing")
    except Exception:  # noqa: BLE001 - no secret yet
        return "missing"


def get_stripe_config(event: dict, actor: str) -> dict:
    """Which kind of key the stage holds (never the key) and the optional plan price overrides."""
    if config.billing_mode() == "none":
        return _billing_off()
    stored = db.get_config("STRIPE") or {}
    try:
        has_webhook = bool(stripe_config.webhook_secret())
    except Exception:  # noqa: BLE001
        has_webhook = False
    return response.ok({"mode": _stripe_mode(), "webhookSecret": has_webhook, "secretName": stripe_config.secret_name(),
                        "priceOverrides": {p["id"]: stored.get(f"{p['id']}PriceId", "") for p in config.PAID_PLANS}})


def put_stripe_config(event: dict, actor: str) -> dict:
    """{priceOverrides: {plan: "price_..." | ""}}: "" removes an override (the price with the plan's lookup key is used)."""
    if not config.subscriptions_on():
        return response.not_found("Subscriptions are off on this site")
    wanted = params.body(event).get("priceOverrides")
    plan_ids = {p["id"] for p in config.PAID_PLANS}
    if not isinstance(wanted, dict) or set(wanted) - plan_ids:
        raise params.BadRequest(f"priceOverrides takes {', '.join(sorted(plan_ids))}")
    stored = db.get_config("STRIPE") or {}
    before = dict(stored)
    for plan, price in wanted.items():
        if not isinstance(price, str) or (price and not price.startswith("price_")):
            raise params.BadRequest(f"{plan}: a Stripe price id starts with price_ (or leave it empty)")
        if price:
            stored[f"{plan}PriceId"] = price
        else:
            stored.pop(f"{plan}PriceId", None)
    db.put_config("STRIPE", stored)
    subscriptions.reset_cache()  # this Lambda; the API Lambda's cache picks it up within subscriptions.PRICE_CACHE_S
    logs.audit(actor, "config.stripe", "config:STRIPE", "plan price overrides", before=before, after=stored)
    return get_stripe_config(event, actor)


# ---- items (the template's example entity; replace or extend with your own entity's tab)

def items(event: dict, actor: str) -> dict:
    q = params.query(event, "q").strip().lower()
    try:
        rows, cursor = db.list_page("ITEM", PAGE, params.query(event, "cursor") or None)
    except db.BadCursor:
        raise params.BadRequest("bad cursor") from None
    rows = [r for r in rows if not q or q in str(r.get("name", "")).lower()]
    owners = {p["userId"]: p.get("email", "") for p in db.batch_get([{"pk": f"USER#{u}", "sk": "PROFILE"} for u in {r["userId"] for r in rows}])}
    return response.ok({"items": [{**_clean(r), "email": owners.get(r["userId"], "")} for r in rows], "cursor": cursor})


def delete_item(event: dict, actor: str, uid: str, item_id: str) -> dict:
    reason = params.text(params.body(event), "reason").strip()[:500]
    if not reason:
        return response.error("A reason is required (it goes in the audit log)", 400, "REASON_REQUIRED")
    item = db.get_item(uid, item_id)
    if not item:
        return response.not_found("Item not found")
    db.delete_item(uid, item_id)
    db.increment_item_count(uid, -1)
    logs.audit(actor, "item.delete", f"user:{uid}", reason, before={"itemId": item_id, "status": item.get("status")})
    return response.ok({"deleted": True})


# ---- scheduled tasks on demand

def run_task(event: dict, actor: str, task: str) -> dict:
    if task == "daily-job":
        fn = os.environ.get("DAILY_JOB_FUNCTION", "")
        if not fn:
            return response.error("DAILY_JOB_FUNCTION isn't set on this Lambda", 503)
        boto3.client("lambda", region_name=REGION).invoke(FunctionName=fn, InvocationType="Event", Payload=json.dumps({"source": "admin"}))
        logs.audit(actor, "task.run", "task:daily-job", "run now from the admin site")
        return response.ok({"started": "daily-job"})
    if task == "payments-sweep":
        if not config.credits_on():
            return _credits_off()
        out = payments.sweep_pending(budget_s=20)
        logs.audit(actor, "task.run", "task:payments-sweep", "run now from the admin site", after=out)
        return response.ok(out)
    return response.not_found("Unknown task")

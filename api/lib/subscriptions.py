"""Subscriptions (billing mode subscriptions | both; docs/payments.md): plans, Stripe prices, webhook events, grace.

  USER#uid / PROFILE   plan (free | a config.PAID_PLANS id), stripeCustomerId, stripeSubscriptionId,
                       subscriptionStatus (Stripe's: active, past_due, ...), paymentFailedAt (first failed renewal
                       of the current problem), lastFailedInvoice
  CONFIG / STRIPE      optional {planId}PriceId overrides (admin site, Config tab); otherwise prices are found by lookup_key
                       yourapp_plan_{id}, which scripts/stripe-setup.py creates

Grace: a failed renewal (invoice.payment_failed) keeps the plan for config.BILLING["graceDays"]; effective_plan() is
"free" after that until a paid invoice (invoice.paid) clears it. Stripe's own retries keep trying meanwhile; once Stripe
gives up the subscription becomes unpaid or canceled and the plan goes back to free.

Admin-callable (phase 3 routes): effective_plan, state, cancel_now.
"""

from __future__ import annotations

import datetime as dt
import logging
import time

try:
    from lib import config, db, i18n, logs, mail, notes, payments, stripe_config
except ImportError:
    from api.lib import config, db, i18n, logs, mail, notes, payments, stripe_config

log = logging.getLogger("yourapp.subscriptions")

PRICE_CACHE_S = 300
_prices: dict = {}  # plan -> (price id, cached at)


def lookup_key(plan: str) -> str:
    return f"{stripe_config.KEY_PREFIX}_plan_{plan}"


def paid_plan_ids() -> list[str]:
    return [p["id"] for p in config.PAID_PLANS]


def price_id(sc, plan: str) -> str:
    """The Stripe price for a paid plan: the admin override (CONFIG / STRIPE {plan}PriceId) or the price with lookup_key
    yourapp_plan_{plan}. Raises LookupError when there is none (run scripts/stripe-setup.py)."""
    hit = _prices.get(plan)
    if hit and time.time() - hit[1] < PRICE_CACHE_S:
        return hit[0]
    override = (db.get_config("STRIPE") or {}).get(f"{plan}PriceId")
    if override:
        _prices[plan] = (override, time.time())
        return override
    params = {"lookup_keys": [lookup_key(plan)], "active": True, "limit": 1}
    found = logs.stripe_call("prices.list", lambda: sc.v1.prices.list(params=params), params).data
    if not found:
        raise LookupError(f"no Stripe price with lookup_key {lookup_key(plan)} (run scripts/stripe-setup.py)")
    _prices[plan] = (found[0].id, time.time())
    return found[0].id


def reset_cache() -> None:
    _prices.clear()


def plan_of(sub: dict) -> str | None:
    """Which plan a subscription (webhook object) is on: its price's lookup_key, an admin override price id, or the
    plan our checkout put in its metadata."""
    items = ((sub.get("items") or {}).get("data")) or []
    price = (items[0].get("price") or {}) if items else {}
    key = price.get("lookup_key") or ""
    prefix = f"{stripe_config.KEY_PREFIX}_plan_"
    if key.startswith(prefix) and key[len(prefix):] in paid_plan_ids():
        return key[len(prefix):]
    overrides = db.get_config("STRIPE") or {}
    for plan in paid_plan_ids():
        if price.get("id") and overrides.get(f"{plan}PriceId") == price.get("id"):
            return plan
    meta = (sub.get("metadata") or {}).get("plan")
    return meta if meta in paid_plan_ids() else None


def _grace_days() -> int:
    return int(config.BILLING.get("graceDays") or 0)


def grace_until(p: dict) -> str | None:
    failed = p.get("paymentFailedAt")
    if not failed:
        return None
    return (dt.datetime.fromisoformat(failed) + dt.timedelta(days=_grace_days())).isoformat()


def effective_plan(p: dict) -> str:
    """The plan the account gets right now: "free" when subscriptions are off, the plan is unknown, or a failed renewal's
    grace has run out."""
    plan = p.get("plan") or "free"
    if not config.subscriptions_on() or plan not in config.PLANS:
        return "free"
    until = grace_until(p)
    if plan != "free" and until and until <= dt.datetime.now(dt.timezone.utc).isoformat():
        return "free"
    return plan


def state(p: dict) -> dict:
    """What the site shows: the plan, the effective plan, Stripe's status and the grace end while a renewal failed."""
    return {"plan": p.get("plan") or "free", "effectivePlan": effective_plan(p), "subscriptionStatus": p.get("subscriptionStatus"),
            "paymentFailedAt": p.get("paymentFailedAt"), "graceUntil": grace_until(p),
            "hasSubscription": bool(p.get("stripeSubscriptionId"))}


def _key(user_id: str) -> dict:
    return {"pk": f"USER#{user_id}", "sk": "PROFILE"}


def set_plan(user_id: str, plan: str, customer: str | None = None, subscription: str | None = None,
             status: str | None = None) -> None:
    """Set the plan (and the Stripe ids when given); a paid plan clears any failed-renewal state."""
    sets, values, removes = ["#plan = :plan"], {":plan": plan}, []
    if customer:
        sets.append("stripeCustomerId = :c")
        values[":c"] = customer
    if subscription:
        sets.append("stripeSubscriptionId = :s")
        values[":s"] = subscription
    if status:
        sets.append("subscriptionStatus = :st")
        values[":st"] = status
    if plan == "free":
        removes += ["stripeSubscriptionId", "paymentFailedAt"] if not subscription else ["paymentFailedAt"]
    elif status in (None, "active", "trialing"):
        removes.append("paymentFailedAt")
    expr = "SET " + ", ".join(sets) + (" REMOVE " + ", ".join(removes) if removes else "")
    db._get_table().update_item(Key=_key(user_id), UpdateExpression=expr, ExpressionAttributeNames={"#plan": "plan"},
                                ExpressionAttributeValues=values)


def cancel_now(user_id: str, actor: str, reason: str) -> bool:
    """Cancel the user's subscription at Stripe now and put them on free (a ban, an admin, the user's own cancel).
    True when a subscription was cancelled."""
    p = db.get_user(user_id) or {}
    sub_id = p.get("stripeSubscriptionId")
    cancelled = False
    if sub_id:
        import stripe

        sc = stripe_config.client()
        try:
            logs.stripe_call("subscriptions.cancel", lambda: sc.v1.subscriptions.cancel(sub_id), {"id": sub_id}, user_id=user_id, actor=actor)
            cancelled = True
        except stripe.InvalidRequestError as e:
            if getattr(e, "code", "") != "resource_missing":
                raise
    set_plan(user_id, "free", status="canceled")
    logs.audit(actor, "subscription.cancel", f"user:{user_id}", reason, before={"plan": p.get("plan"), "subscription": sub_id},
               after={"plan": "free"})
    return cancelled


# ---- webhook events (routes/webhooks.py)

def _user_for_customer(customer) -> dict | None:
    cid = customer if isinstance(customer, str) or customer is None else customer.get("id")
    return db.get_user_by_stripe_customer(cid) if cid else None


def _invoice_subscription(inv: dict) -> str | None:
    """The subscription an invoice belongs to (older API versions: `subscription`; newer: parent.subscription_details)."""
    sub = inv.get("subscription") or (((inv.get("parent") or {}).get("subscription_details") or {}).get("subscription"))
    return sub if isinstance(sub, str) or sub is None else sub.get("id")


def _invoice_payment_intent(inv: dict) -> str | None:
    """The PaymentIntent that paid an invoice (older versions: payment_intent; newer: the invoice's payments list,
    looked up when the event doesn't carry it). None when Stripe can't say: the record is then keyed by the invoice."""
    pi = inv.get("payment_intent")
    if pi:
        return pi if isinstance(pi, str) else pi.get("id")
    for row in ((inv.get("payments") or {}).get("data")) or []:
        got = ((row.get("payment") or {}).get("payment_intent"))
        if got:
            return got if isinstance(got, str) else got.get("id")
    try:
        sc = stripe_config.client()
        params = {"invoice": inv["id"], "limit": 1}
        rows = logs.stripe_call("invoice_payments.list", lambda: sc.v1.invoice_payments.list(params=params), params).data
        got = rows[0].payment.payment_intent if rows else None
        return got if isinstance(got, str) or got is None else got.id
    except Exception:  # noqa: BLE001 - the record is still written, keyed by the invoice
        log.warning("no PaymentIntent found for invoice %s", inv.get("id"))
        return None


def _checkout_completed(session: dict) -> str:
    if session.get("mode") != "subscription":
        return "not a subscription checkout"
    meta = session.get("metadata") or {}
    user_id = session.get("client_reference_id") or meta.get("userId")
    plan = meta.get("plan")
    if not user_id or plan not in paid_plan_ids():
        return "no user or plan in the session"
    user = db.get_user(user_id)
    if not user:
        return f"unknown user {user_id}"
    sub_id = session.get("subscription")
    sub_id = sub_id if isinstance(sub_id, str) or sub_id is None else sub_id.get("id")
    old = user.get("stripeSubscriptionId")
    if old and old != sub_id:  # safety net: never two live subscriptions for one account
        sc = stripe_config.client()
        try:
            logs.stripe_call("subscriptions.cancel", lambda: sc.v1.subscriptions.cancel(old), {"id": old}, user_id=user_id)
        except Exception:  # noqa: BLE001 - already gone; the new subscription is what matters
            log.warning("could not cancel the previous subscription %s of %s", old, user_id)
    set_plan(user_id, plan, session.get("customer"), sub_id, "active")
    logs.audit("stripe", "subscription.start", f"user:{user_id}", f"checkout {session.get('id')}", after={"plan": plan})
    return f"{user_id} on {plan}"


def _subscription_updated(sub: dict) -> str:
    user = _user_for_customer(sub.get("customer"))
    if not user:
        return "no user for the customer"
    uid, current = user["userId"], user.get("stripeSubscriptionId")
    if current and current != sub.get("id"):
        return "not the account's current subscription"
    status = sub.get("status", "")
    if status in ("active", "trialing"):
        plan = plan_of(sub) or user.get("plan") or "free"
        set_plan(uid, plan, subscription=sub.get("id"), status=status)
        return f"{uid} {status} on {plan}"
    if status == "past_due":  # renewal failed: the plan stays through the grace period (invoice.payment_failed set it)
        db._get_table().update_item(Key=_key(uid), UpdateExpression="SET subscriptionStatus = :s, paymentFailedAt = if_not_exists(paymentFailedAt, :now)",
                                    ExpressionAttributeValues={":s": status, ":now": dt.datetime.now(dt.timezone.utc).isoformat()})
        return f"{uid} past_due (grace)"
    if status in ("canceled", "unpaid", "incomplete_expired"):
        set_plan(uid, "free", status=status)
        return f"{uid} {status}: back to free"
    db._get_table().update_item(Key=_key(uid), UpdateExpression="SET subscriptionStatus = :s", ExpressionAttributeValues={":s": status})
    return f"{uid} {status}"


def _subscription_deleted(sub: dict) -> str:
    user = _user_for_customer(sub.get("customer"))
    if not user:
        return "no user for the customer"
    if user.get("stripeSubscriptionId") not in (None, sub.get("id")):
        return "not the account's current subscription"
    set_plan(user["userId"], "free", status="canceled")
    return f"{user['userId']} subscription ended: back to free"


def _invoice_paid(inv: dict) -> str:
    sub_id = _invoice_subscription(inv)
    if not sub_id:
        return "not a subscription invoice"
    user = _user_for_customer(inv.get("customer"))
    if not user:
        return "no user for the customer"
    uid = user["userId"]
    if int(inv.get("amount_paid") or 0) > 0:
        payments.record_invoice(inv, uid, _invoice_payment_intent(inv), user.get("plan") or "")
    was_failing = bool(user.get("paymentFailedAt"))
    if user.get("stripeSubscriptionId") in (None, sub_id):
        db._get_table().update_item(Key=_key(uid), UpdateExpression="SET subscriptionStatus = :s REMOVE paymentFailedAt",
                                    ExpressionAttributeValues={":s": "active"})
    if was_failing:
        lang = i18n.user_language(uid)
        notes.add(uid, "billing", i18n.t("Payment received", lang),
                  i18n.t("Your subscription payment went through; your plan is fully active again.", lang))
    return f"{uid} invoice {inv.get('id')} paid"


def _invoice_failed(inv: dict) -> str:
    sub_id = _invoice_subscription(inv)
    if not sub_id:
        return "not a subscription invoice"
    user = _user_for_customer(inv.get("customer"))
    if not user:
        return "no user for the customer"
    uid = user["userId"]
    if user.get("stripeSubscriptionId") not in (None, sub_id):
        return "not the account's current subscription"
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    first = db.conditional(db._get_table().update_item, Key=_key(uid),
                           UpdateExpression="SET paymentFailedAt = if_not_exists(paymentFailedAt, :now), lastFailedInvoice = :i, subscriptionStatus = :s",
                           ConditionExpression="attribute_not_exists(lastFailedInvoice) OR lastFailedInvoice <> :i",
                           ExpressionAttributeValues={":now": now, ":i": inv.get("id"), ":s": "past_due"})
    if first:  # once per invoice, however many retries fail
        p = db.get_user(uid) or {}
        until = (grace_until(p) or now)[:10]
        lang = i18n.user_language(uid)
        msg = i18n.t("We couldn't take your subscription payment. Your plan stays active until {date}; update your card in "
                     "the billing portal (Plans page) to keep it.", lang, date=until)
        notes.add(uid, "billing", i18n.t("Subscription payment failed", lang), msg)
        mail.to_user(uid, i18n.t("{app}: your subscription payment failed", lang, app=mail.APP_NAME), msg, pref="emailBilling")
    return f"{uid} invoice {inv.get('id')} failed (grace)"


def handle_event(evt_type: str, obj: dict) -> str | None:
    """The webhook events this module owns; None for any other (routes/webhooks.py tries the next module)."""
    if evt_type == "checkout.session.completed" and obj.get("mode") == "subscription":
        return _checkout_completed(obj)
    if evt_type == "customer.subscription.updated":
        return _subscription_updated(obj)
    if evt_type == "customer.subscription.deleted":
        return _subscription_deleted(obj)
    if evt_type == "invoice.paid":
        return _invoice_paid(obj)
    if evt_type == "invoice.payment_failed":
        return _invoice_failed(obj)
    return None

"""Subscription routes (billing mode subscriptions | both): Stripe Checkout, the billing portal, plan changes, cancel.

  POST /api/billing/checkout {plan}      -> {url}: Stripe Checkout for a paid plan
  POST /api/billing/portal               -> {url}: Stripe's billing portal (cards, invoices)
  POST /api/billing/change-plan {plan}   -> {action: "done"} (switched in place, prorated) | {action: "checkout"}
  POST /api/billing/cancel               cancel now and go back to free

Every route runs only for a signed-in user (api/handler.py) and refuses suspended or banned accounts. Every Stripe
create sends an idempotency key. Webhook events are handled in api/lib/subscriptions.py, reached through
routes/webhooks.py. Plans and limits come from api/lib/config.py.
"""

from __future__ import annotations

import logging
import os
import time

import stripe

try:
    from lib import accounts, config, db, logs, params, payments, regions, response, stripe_config, subscriptions
except ImportError:
    from api.lib import accounts, config, db, logs, params, payments, regions, response, stripe_config, subscriptions

logger = logging.getLogger("yourapp.billing")

BILLING_ERROR_MSG = "We're having trouble connecting to our payment processor. Please try again in a few minutes."


def _frontend() -> str:
    return os.environ.get("FRONTEND_URL", "https://yourapp.com")


def _bucket() -> int:
    """Idempotency window: a double click within a minute gets the same Checkout or portal page."""
    return int(time.time() // 60)


def _guard(user_id: str, event: dict | None = None) -> tuple[dict | None, dict | None]:
    """(user, None) or (None, the error answer): unknown user, a restricted account, or (paying) a gated country."""
    user = db.get_user(user_id)
    if not user:
        return None, response.error("User not found", 404)
    ok, why = accounts.can_spend(user_id, user)
    if not ok:
        return None, response.error(why, 403, "ACCOUNT_RESTRICTED")
    if event is not None and (no := regions.refusal(event)):
        return None, no
    return user, None


def _status_of(sub) -> str | None:
    return sub.get("status") if isinstance(sub, dict) else getattr(sub, "status", None)


def _live_subscription(sc, user: dict):
    """The account's subscription if Stripe still has it active (or trialing); a stale id is cleared. Raises StripeError."""
    sub_id = user.get("stripeSubscriptionId")
    if not sub_id:
        return None
    try:
        sub = logs.stripe_call("subscriptions.retrieve", lambda: sc.v1.subscriptions.retrieve(sub_id), {"id": sub_id},
                               user_id=user["userId"])
    except stripe.InvalidRequestError as e:
        if getattr(e, "code", "") != "resource_missing":
            raise
        sub = None
    if sub is not None and _status_of(sub) in ("active", "trialing", "past_due"):
        return sub
    logger.info("clearing stale subscription %s of %s", sub_id, user["userId"])
    db._get_table().update_item(Key={"pk": f"USER#{user['userId']}", "sk": "PROFILE"}, UpdateExpression="REMOVE stripeSubscriptionId")
    return None


def _plan_arg(event: dict, allow_free: bool) -> str | dict:
    plan = params.text(params.body(event), "plan").strip().lower()
    allowed = (["free"] if allow_free else []) + subscriptions.paid_plan_ids()
    if plan not in allowed:
        return response.error(f"Invalid plan. Choose one of: {', '.join(allowed)}.", 400)
    return plan


def create_checkout(user_id: str, event: dict) -> dict:
    plan = _plan_arg(event, allow_free=False)
    if isinstance(plan, dict):
        return plan
    user, err = _guard(user_id, event)
    if err:
        return err
    try:
        sc = stripe_config.client()
        if _live_subscription(sc, user) is not None:
            return response.error("You already have a subscription. Change plans instead.", 409, "HAS_SUBSCRIPTION")
        price = subscriptions.price_id(sc, plan)
        customer = payments.ensure_customer(sc, user_id, user.get("email", ""))
        checkout = {
            "mode": "subscription",
            "line_items": [{"price": price, "quantity": 1}],
            "customer": customer,
            "client_reference_id": user_id,
            "metadata": {"userId": user_id, "plan": plan},
            "subscription_data": {"metadata": {"userId": user_id, "plan": plan}},
            "success_url": f"{_frontend()}/dashboard/plans?checkout=success",
            "cancel_url": f"{_frontend()}/dashboard/plans?checkout=cancel",
        }
        key = stripe_config.idem("subcheckout", user_id, plan, _bucket())
        session = logs.stripe_call("checkout.sessions.create", lambda: sc.v1.checkout.sessions.create(params=checkout, options={"idempotency_key": key}),
                                   checkout, user_id=user_id, idempotency_key=key)
    except LookupError as e:
        logger.error("%s", e)
        return response.error("Subscriptions are not set up yet", 503)
    except stripe.StripeError as e:
        logger.error("Stripe checkout failed for user=%s plan=%s: %s", user_id, plan, e)
        return response.error(BILLING_ERROR_MSG, 502)
    return response.ok({"url": session.url})


def create_portal(user_id: str, event: dict) -> dict:
    user, err = _guard(user_id)
    if err:
        return err
    customer_id = user.get("stripeCustomerId")
    if not customer_id:
        return response.error("No billing account yet. Subscribe first.", 400)
    sc = stripe_config.client()
    body = {"customer": customer_id, "return_url": f"{_frontend()}/dashboard/plans"}
    key = stripe_config.idem("portal", user_id, _bucket())
    try:
        session = logs.stripe_call("billing_portal.sessions.create",
                                   lambda: sc.v1.billing_portal.sessions.create(params=body, options={"idempotency_key": key}),
                                   body, user_id=user_id, idempotency_key=key)
    except stripe.StripeError as e:
        logger.error("Stripe portal failed for user=%s: %s", user_id, e)
        return response.error(BILLING_ERROR_MSG, 502)
    return response.ok({"url": session.url})


def _over_limit(user: dict, plan: str) -> dict | None:
    """The 409 when the account has more items than `plan` allows (limits: config planLimits)."""
    limit = config.plan_limit(plan)
    count = int(user.get("itemCount", 0))
    if limit is not None and count > limit:
        return response.error(f"You have {count} items but {plan} allows {limit}. Remove {count - limit} to switch.", 409, "PLAN_LIMIT")
    return None


def change_plan(user_id: str, event: dict) -> dict:
    """Switch between paid plans in place (prorated); free = cancel; no live subscription = go through Checkout."""
    plan = _plan_arg(event, allow_free=True)
    if isinstance(plan, dict):
        return plan
    user, err = _guard(user_id, event)
    if err:
        return err
    current = user.get("plan", "free")
    if current == plan:
        return response.error("You're already on this plan.", 400)
    if plan == "free":
        return cancel_plan(user_id, event)
    if config.plan_rank(plan) < config.plan_rank(current) and (over := _over_limit(user, plan)):
        return over
    try:
        sc = stripe_config.client()
        sub = _live_subscription(sc, user)
        if sub is None:
            return response.ok({"action": "checkout"})
        price = subscriptions.price_id(sc, plan)
        item_id = sub["items"]["data"][0]["id"]
        body = {"items": [{"id": item_id, "price": price}], "proration_behavior": "create_prorations",
                "metadata": {"userId": user_id, "plan": plan}}
        key = stripe_config.idem("planchange", sub["id"], plan, _bucket())
        logs.stripe_call("subscriptions.update", lambda: sc.v1.subscriptions.update(sub["id"], params=body, options={"idempotency_key": key}),
                         body, user_id=user_id, idempotency_key=key)
    except LookupError as e:
        logger.error("%s", e)
        return response.error("Subscriptions are not set up yet", 503)
    except stripe.StripeError as e:
        logger.error("Stripe plan change failed for user=%s plan=%s: %s", user_id, plan, e)
        return response.error(BILLING_ERROR_MSG, 502)
    except (KeyError, IndexError, TypeError) as e:
        logger.error("Malformed subscription for user=%s: %s", user_id, e)
        return response.error(BILLING_ERROR_MSG, 502)
    subscriptions.set_plan(user_id, plan, subscription=sub["id"], status="active")
    logs.audit(f"user:{user_id}", "subscription.change", f"user:{user_id}", "", before={"plan": current}, after={"plan": plan})
    return response.ok({"action": "done", "plan": plan})


def cancel_plan(user_id: str, event: dict) -> dict:
    """Cancel now and go back to free (blocked while the account has more items than free allows)."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)
    ok, why = accounts.can_spend(user_id, user)
    if not ok:
        return response.error(why, 403, "ACCOUNT_RESTRICTED")
    if user.get("plan", "free") == "free":
        return response.error("You're already on the free plan.", 400)
    if over := _over_limit(user, "free"):
        return over
    try:
        subscriptions.cancel_now(user_id, f"user:{user_id}", "cancelled by the customer")
    except stripe.StripeError as e:
        logger.error("Stripe cancel failed for user=%s: %s", user_id, e)
        return response.error(BILLING_ERROR_MSG, 502)
    return response.ok({"action": "done", "plan": "free"})


def invalidate_caches() -> None:
    """Forget cached keys and prices (the admin Billing page after saving)."""
    stripe_config.reset_cache()
    subscriptions.reset_cache()

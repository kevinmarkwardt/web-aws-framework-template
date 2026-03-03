"""Billing routes — Stripe Checkout + Customer Portal."""

from __future__ import annotations

import json
import logging
import os
import time

import boto3
import stripe

try:
    from lib import db, response
except ImportError:
    from api.lib import db, response

logger = logging.getLogger(__name__)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://yourapp.com")
REGION = os.environ.get("AWS_REGION", "us-east-1")
STRIPE_SECRET_NAME = "yourapp/stripe"

_PLAN_RANK = {"free": 0, "starter": 1, "pro": 2}

BILLING_ERROR_MSG = (
    "We're having trouble connecting to our payment processor. "
    "Please try again in a few minutes."
)

# --- Cached config loaders (5-minute TTL) ---

_secrets_cache = None
_secrets_ts = 0
_prices_cache = None
_prices_ts = 0
_CACHE_TTL = 300  # 5 minutes


def _get_stripe_secrets() -> dict:
    """Load Stripe secrets from Secrets Manager, cached 5 min."""
    global _secrets_cache, _secrets_ts
    now = time.time()
    if _secrets_cache and (now - _secrets_ts) < _CACHE_TTL:
        return _secrets_cache
    client = boto3.client("secretsmanager", region_name=REGION)
    resp = client.get_secret_value(SecretId=STRIPE_SECRET_NAME)
    _secrets_cache = json.loads(resp["SecretString"])
    _secrets_ts = now
    return _secrets_cache


def _get_price_ids() -> dict:
    """Load price IDs from DynamoDB CONFIG/STRIPE, cached 5 min."""
    global _prices_cache, _prices_ts
    now = time.time()
    if _prices_cache and (now - _prices_ts) < _CACHE_TTL:
        return _prices_cache
    config = db.get_config("STRIPE") or {}
    _prices_cache = {
        "starter": config.get("starterPriceId", ""),
        "pro": config.get("proPriceId", ""),
    }
    _prices_ts = now
    return _prices_cache


def _ensure_stripe_key():
    """Set stripe.api_key lazily from Secrets Manager."""
    if not stripe.api_key:
        secrets = _get_stripe_secrets()
        stripe.api_key = secrets.get("secretKey", "")


def invalidate_caches():
    """Clear cached secrets and prices. Called by admin after config update."""
    global _secrets_cache, _secrets_ts, _prices_cache, _prices_ts
    _secrets_cache = None
    _secrets_ts = 0
    _prices_cache = None
    _prices_ts = 0


# --- Routes ---

def create_checkout(user_id: str, event: dict) -> dict:
    _ensure_stripe_key()
    price_ids = _get_price_ids()

    body = json.loads(event.get("body", "{}"))
    plan = body.get("plan", "").lower()
    if plan not in price_ids:
        return response.error("Invalid plan. Must be 'starter' or 'pro'.")

    price_id = price_ids[plan]
    if not price_id:
        return response.error("Price not configured", 500)

    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    # Only block checkout if user has a genuinely active subscription
    existing_sub_id = user.get("stripeSubscriptionId")
    if existing_sub_id:
        try:
            existing_sub = stripe.Subscription.retrieve(existing_sub_id)
            sub_status = existing_sub.get("status") if isinstance(existing_sub, dict) else getattr(existing_sub, "status", None)
            if sub_status in ("active", "trialing"):
                return response.error("Active subscription exists. Use plan change instead.", 409)
            # Stale/canceled — clear it and allow checkout
            logger.info("Clearing stale subscription %s (status=%s) for user=%s", existing_sub_id, sub_status, user_id)
            db.clear_user_subscription(user_id)
        except stripe.error.InvalidRequestError:
            logger.warning("Subscription %s not found in Stripe for user=%s, clearing", existing_sub_id, user_id)
            db.clear_user_subscription(user_id)
        except stripe.error.StripeError as e:
            logger.error("Failed to verify subscription %s for user=%s: %s", existing_sub_id, user_id, e)
            return response.error(BILLING_ERROR_MSG, 502)

    checkout_params = {
        "mode": "subscription",
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": f"{FRONTEND_URL}/dashboard?checkout=success",
        "cancel_url": f"{FRONTEND_URL}/dashboard?checkout=cancel",
        "client_reference_id": user_id,
        "metadata": {"userId": user_id, "plan": plan},
    }

    # Reuse existing Stripe customer if available
    if user.get("stripeCustomerId"):
        checkout_params["customer"] = user["stripeCustomerId"]
    else:
        checkout_params["customer_email"] = user.get("email", "")

    try:
        session = stripe.checkout.Session.create(**checkout_params)
    except stripe.error.StripeError as e:
        logger.error("Stripe checkout session failed for user=%s plan=%s: %s", user_id, plan, e)
        return response.error(BILLING_ERROR_MSG, 502)
    except Exception as e:
        logger.error("Unexpected error creating checkout for user=%s: %s", user_id, e, exc_info=True)
        return response.error(BILLING_ERROR_MSG, 502)

    return response.ok({"url": session.url})


def create_portal(user_id: str, event: dict) -> dict:
    _ensure_stripe_key()

    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    customer_id = user.get("stripeCustomerId")
    if not customer_id:
        return response.error("No billing account found. Please subscribe first.")

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/dashboard/settings",
        )
    except stripe.error.StripeError as e:
        logger.error("Stripe portal session failed for user=%s customer=%s: %s", user_id, customer_id, e)
        return response.error(BILLING_ERROR_MSG, 502)
    except Exception as e:
        logger.error("Unexpected error creating portal for user=%s: %s", user_id, e, exc_info=True)
        return response.error(BILLING_ERROR_MSG, 502)

    return response.ok({"url": session.url})


def change_plan(user_id: str, event: dict) -> dict:
    """Change subscription plan (upgrade or downgrade between paid tiers)."""
    _ensure_stripe_key()

    body = json.loads(event.get("body", "{}"))
    plan = body.get("plan", "").lower()
    if plan not in ("free", "starter", "pro"):
        return response.error("Invalid plan. Must be 'free', 'starter', or 'pro'.")

    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    current = user.get("plan", "free")
    if current == plan:
        return response.error("Already on this plan.")

    # Downgrade to free = cancel subscription
    if plan == "free":
        return cancel_plan(user_id, event, user=user)

    # Check if user has an active Stripe subscription we can modify
    sub_id = user.get("stripeSubscriptionId")
    if sub_id:
        try:
            sub = stripe.Subscription.retrieve(sub_id)
            sub_status = sub.get("status") if isinstance(sub, dict) else getattr(sub, "status", None)
        except stripe.error.InvalidRequestError:
            # Subscription doesn't exist in Stripe anymore
            logger.warning("Stale subscription %s for user=%s, clearing", sub_id, user_id)
            sub_status = None
        except stripe.error.StripeError as e:
            logger.error("Failed to retrieve subscription %s for user=%s: %s", sub_id, user_id, e)
            return response.error(BILLING_ERROR_MSG, 502)

        if sub_status not in ("active", "trialing"):
            # Subscription is canceled/expired — clear stale ID, user needs new checkout
            logger.info("Subscription %s status=%s for user=%s, clearing stale ref", sub_id, sub_status, user_id)
            db.clear_user_subscription(user_id)
            return response.ok({"action": "checkout"})
    else:
        # No subscription at all → needs Checkout Session for payment info
        return response.ok({"action": "checkout"})

    # Downgrade check: block if item count exceeds target plan limit
    target_rank = _PLAN_RANK[plan]
    current_rank = _PLAN_RANK.get(current, 0)
    if target_rank < current_rank:
        limit = db.ITEM_LIMITS[plan]
        item_count = user.get("itemCount", 0)
        if item_count > limit:
            return response.error(
                f"You have {item_count} items but {plan} allows {int(limit)}. "
                f"Remove {item_count - int(limit)} items to downgrade.",
                409,
            )

    # Modify existing subscription (handles proration)
    price_ids = _get_price_ids()
    price_id = price_ids.get(plan)
    if not price_id:
        return response.error("Price not configured", 500)

    try:
        item_id = sub["items"]["data"][0]["id"]
        stripe.Subscription.modify(
            sub["id"],
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="create_prorations",
        )
    except stripe.error.StripeError as e:
        logger.error(
            "Stripe subscription modify failed for user=%s sub=%s plan=%s: %s",
            user_id, sub_id, plan, e,
        )
        return response.error(BILLING_ERROR_MSG, 502)
    except (KeyError, IndexError) as e:
        logger.error(
            "Malformed subscription data for user=%s sub=%s: %s",
            user_id, sub_id, e, exc_info=True,
        )
        return response.error(BILLING_ERROR_MSG, 502)
    except Exception as e:
        logger.error("Unexpected error changing plan for user=%s: %s", user_id, e, exc_info=True)
        return response.error(BILLING_ERROR_MSG, 502)

    db.update_user_plan(user_id, plan, stripe_subscription_id=sub["id"])
    return response.ok({"action": "done", "plan": plan})


def cancel_plan(user_id: str, event: dict, user: dict = None) -> dict:
    """Cancel subscription and revert to free plan."""
    _ensure_stripe_key()

    if user is None:
        user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    current = user.get("plan", "free")
    if current == "free":
        return response.error("Already on free plan.")

    # Block if item count exceeds free limit
    limit = db.ITEM_LIMITS["free"]
    item_count = user.get("itemCount", 0)
    if item_count > limit:
        return response.error(
            f"You have {item_count} items but free allows {int(limit)}. "
            f"Delete {item_count - int(limit)} items to cancel.",
            409,
        )

    # Cancel the Stripe subscription
    sub_id = user.get("stripeSubscriptionId", "")
    if sub_id:
        try:
            stripe.Subscription.cancel(sub_id)
        except stripe.error.InvalidRequestError:
            pass  # Already canceled
        except stripe.error.StripeError as e:
            logger.error("Stripe cancel failed for user=%s sub=%s: %s", user_id, sub_id, e)
            return response.error(BILLING_ERROR_MSG, 502)
        except Exception as e:
            logger.error("Unexpected error canceling sub for user=%s: %s", user_id, e, exc_info=True)
            return response.error(BILLING_ERROR_MSG, 502)

    db.update_user_plan(user_id, "free")
    return response.ok({"action": "done", "plan": "free"})


def handle_webhook(event: dict) -> dict:
    _ensure_stripe_key()
    secrets = _get_stripe_secrets()
    webhook_secret = secrets.get("webhookSecret", "")

    body = event.get("body", "")
    sig = event.get("headers", {}).get("stripe-signature", "")

    try:
        evt = stripe.Webhook.construct_event(body, sig, webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        return response.error("Invalid webhook signature", 400)

    event_type = evt["type"]
    data = evt["data"]["object"]

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data)

    return response.ok({"received": True})


def _handle_checkout_completed(session: dict):
    user_id = session.get("client_reference_id") or session.get("metadata", {}).get("userId")
    plan = session.get("metadata", {}).get("plan", "starter")
    customer_id = session.get("customer", "")
    subscription_id = session.get("subscription", "")

    if user_id:
        # Safety net: cancel any old subscription before setting the new one
        user = db.get_user(user_id)
        if user:
            old_sub_id = user.get("stripeSubscriptionId", "")
            if old_sub_id and old_sub_id != subscription_id:
                try:
                    stripe.Subscription.cancel(old_sub_id)
                except Exception:
                    pass
        db.update_user_plan(user_id, plan, customer_id, subscription_id)


def _handle_subscription_updated(subscription: dict):
    customer_id = subscription.get("customer", "")
    status = subscription.get("status", "")

    user = db.get_user_by_stripe_customer(customer_id)
    if not user:
        return

    if status == "active":
        # Determine plan from price
        price_ids = _get_price_ids()
        items = subscription.get("items", {}).get("data", [])
        if items:
            price_id = items[0].get("price", {}).get("id", "")
            plan = "starter"
            for plan_name, pid in price_ids.items():
                if pid == price_id:
                    plan = plan_name
                    break
            db.update_user_plan(
                user["userId"], plan,
                stripe_subscription_id=subscription.get("id", ""),
            )
    elif status in ("canceled", "unpaid", "past_due"):
        db.update_user_plan(user["userId"], "free")


def _handle_subscription_deleted(subscription: dict):
    customer_id = subscription.get("customer", "")
    user = db.get_user_by_stripe_customer(customer_id)
    if user:
        db.update_user_plan(user["userId"], "free")

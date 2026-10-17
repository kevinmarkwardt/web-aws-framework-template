"""POST /api/webhooks/stripe: the one Stripe webhook. No user auth; the Stripe signature is the auth.

1. Refuse everything while the stage has no webhook secret (503: Stripe retries for 3 days), never check a signature
   against an empty one (A16).
2. Verify the signature (300 s tolerance). A bad one is a 400 logged to CloudWatch only, so anonymous requests can't fill
   the audit log (A15).
3. Claim the event exactly once (logs.claim_event: STRIPEEVT#{id}; a claim stuck in `processing` is taken over, A4).
4. Dispatch: the payments core (refunds, disputes) for every billing mode, then each enabled module's handle_event
   (credits: routes/wallet.py; subscriptions: lib/subscriptions.py). A module that is off ignores its events.
5. A handler error marks the event failed and answers 500, so Stripe's retry runs it again (every handler is safe to
   repeat).

scripts/stripe-setup.py subscribes the endpoint to EVENTS (per billing mode).
"""

from __future__ import annotations

import base64
import logging

try:
    from lib import config, logs, payments, response, stripe_config, subscriptions
    from routes import wallet
except ImportError:
    from api.lib import config, logs, payments, response, stripe_config, subscriptions
    from api.routes import wallet

log = logging.getLogger("yourapp.webhooks")

CORE_EVENTS = ["charge.refunded", "charge.refund.updated", "refund.updated", "refund.failed",
               "charge.dispute.created", "charge.dispute.closed"]
CREDITS_EVENTS = ["payment_intent.succeeded"]
SUBSCRIPTION_EVENTS = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted",
                       "invoice.paid", "invoice.payment_failed"]


def events_for(mode: str) -> list[str]:
    """Every event type the API handles in this billing mode (scripts/stripe-setup.py subscribes exactly these)."""
    out = list(CORE_EVENTS) if mode != "none" else []
    if mode in ("credits", "both"):
        out += CREDITS_EVENTS
    if mode in ("subscriptions", "both"):
        out += SUBSCRIPTION_EVENTS
    return out


def _core(evt_type: str, obj: dict) -> str | None:
    if evt_type == "charge.refunded":
        return payments.charge_refunded(obj)
    if evt_type == "charge.dispute.created":
        return payments.dispute_created(obj)
    if evt_type == "charge.dispute.closed":
        return payments.dispute_closed(obj)
    if evt_type in ("refund.failed", "refund.updated", "charge.refund.updated"):
        return payments.refund_failed(obj)  # only a refund whose status is failed changes anything
    return None


def _dispatch(evt_type: str, obj: dict) -> str:
    handlers = [_core]
    if config.credits_on():
        handlers.append(wallet.handle_event)
    if config.subscriptions_on():
        handlers.append(subscriptions.handle_event)
    for handler in handlers:
        result = handler(evt_type, obj)
        if result is not None:
            return result
    return "ignored"


def handle(event: dict) -> dict:
    if config.billing_mode() == "none":
        return response.not_found("No route: POST /api/webhooks/stripe")
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode()
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    secret = stripe_config.webhook_secret()
    if not secret:
        log.critical("STRIPE_WEBHOOK_SECRET_MISSING: events refused until scripts/stripe-setup.py stores it")
        return response.error("Webhook not configured", 503)
    try:
        evt = stripe_config.client().construct_event(body, headers.get("stripe-signature", ""), secret)
    except Exception as e:  # noqa: BLE001 - bad signature or payload: CloudWatch only (A15)
        log.warning("stripe webhook rejected: %s: %s", type(e).__name__, str(e)[:300])
        return response.error("Invalid signature", 400)
    obj = evt.data.object.to_dict() if hasattr(evt.data.object, "to_dict") else dict(evt.data.object)
    if not logs.claim_event(evt.id, evt.type, obj.get("id", "")):
        return response.ok({"received": True, "duplicate": True})  # Stripe retried an event that is done or running
    try:
        result = _dispatch(evt.type, obj)
    except Exception as e:  # noqa: BLE001 - mark it failed so Stripe's retry is processed again
        log.exception("WEBHOOK_FAILED %s %s", evt.type, evt.id)
        logs.finish_event(evt.id, "failed", f"{type(e).__name__}: {e}")
        return response.error("Webhook processing failed", 500)
    logs.finish_event(evt.id, "ok", result)
    log.info("stripe %s %s: %s", evt.type, obj.get("id"), result)
    return response.ok({"received": True})

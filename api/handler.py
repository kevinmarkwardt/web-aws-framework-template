"""YourApp API Handler — Lambda entry point.

Single Lambda handling all HTTP routes via Function URL.
Routes requests based on method + path to route modules.
"""

from __future__ import annotations

import re
import sys
import os

# When deployed as Lambda, handler.py is at root with lib/ and routes/ as subdirs
# When running tests, api/ is the parent. Support both.
_dir = os.path.dirname(os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

try:
    from lib.auth import get_token_claims, get_user_id
    from lib.response import ok, unauthorized, not_found, error, forbidden, unavailable
    from lib import auth, config, params, payments
    from routes import items, account, billing, admin, cards, wallet, webhooks
except ImportError:
    from api.lib.auth import get_token_claims, get_user_id
    from api.lib.response import ok, unauthorized, not_found, error, forbidden, unavailable
    from api.lib import auth, config, params, payments
    from api.routes import items, account, billing, admin, cards, wallet, webhooks

MAINTENANCE_MESSAGE = "YourApp is down for maintenance. Please try again soon."
SWEEP_TASK = "payments-sweep"
SWEEP_RESERVE_S = 27  # one more customer's Stripe calls can take ~26 s (lib/stripe_config.py timeouts); the Lambda stops at 30


def lambda_handler(event, context):
    """Main API handler routed via CloudFront /api/* -> Function URL; also the scheduled payments sweep."""
    if _is_payments_sweep(event):
        return _payments_sweep(context)
    if not params.from_cloudfront(event):  # went around CloudFront (the Function URL itself is public)
        return forbidden()
    try:
        return _dispatch(event)
    except params.BadRequest as e:  # malformed body or field (lib/params.py)
        return error(str(e), 400)


def _is_payments_sweep(event) -> bool:
    """The EventBridge rule PaymentsSweep (cdk stack, every 15 minutes) sends exactly {"source": "aws.events",
    "detail-type": "Scheduled Event", "app_task": "payments-sweep"}. A Function URL request can't: its event always has
    requestContext and headers, and the caller's body and headers stay inside them, never at the top level."""
    return (isinstance(event, dict) and event.get("app_task") == SWEEP_TASK and event.get("source") == "aws.events"
            and event.get("detail-type") == "Scheduled Event" and "requestContext" not in event and "headers" not in event)


def _payments_sweep(context) -> dict:
    """Settle every card refund Stripe hasn't confirmed yet (payments.sweep_pending), stopping in time; the next run goes
    on. A failure is logged as PAYMENTS_SWEEP_FAILED and raised, so Lambda retries."""
    if not config.credits_on():
        return {"task": SWEEP_TASK, "skipped": "credits off"}
    left_s = context.get_remaining_time_in_millis() / 1000 if context else 30
    try:
        out = payments.sweep_pending(budget_s=max(2.0, left_s - SWEEP_RESERVE_S))
    except Exception as e:
        print(f"PAYMENTS_SWEEP_FAILED {type(e).__name__}: {str(e)[:300]}")
        raise
    print(f"payments sweep: {out}")
    return {"task": SWEEP_TASK, **out}


def _dispatch(event: dict) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("requestContext", {}).get("http", {}).get("path", "")

    # Also support API Gateway v1 format
    if not method:
        method = event.get("httpMethod", "")
    if not path:
        path = event.get("path", "")

    # CORS preflight
    if method == "OPTIONS":
        return ok({"ok": True})

    # Stripe webhook: no JWT auth, the Stripe signature is the auth (keeps working in maintenance mode)
    if method == "POST" and path == "/api/webhooks/stripe":
        return webhooks.handle(event)

    # Test stage only: username login, no password or email (lib/auth.py); 404 everywhere else
    if method == "POST" and path == "/api/test-login":
        return _test_login(event)

    # Admin routes — use separate auth (Secrets Manager JWT); never blocked by maintenance mode
    if path.startswith("/api/admin/"):
        return _admin_route(method, path, event)

    # Public, no auth: the switches and limits the site shows before sign-in (landing page, sign-up form)
    if method == "GET" and path == "/api/public-config":
        return ok(_public_config())

    # Maintenance mode (admin site, Feature Toggles): every user route answers 503 until it is turned off
    if config.get_site_config()["maintenanceMode"]:
        return unavailable(MAINTENANCE_MESSAGE)

    # All other routes require JWT auth
    user_id = get_user_id(event)
    if not user_id:
        return unauthorized()

    return _route(method, path, user_id, event)


def _public_config() -> dict:
    """What the site needs before sign-in: the switches, plan limits, and which billing modules are on (the frontend
    shows or hides their pages from billingMode) with their public settings."""
    site = config.get_site_config()
    out = {k: site[k] for k in ("maintenanceMode", "signupsEnabled", "planLimits")}
    out["billingMode"] = config.billing_mode()
    if config.subscriptions_on():
        out["plans"] = config.plans()
    if config.credits_on():
        b = config.billing()
        out["credits"] = {"creditName": b["creditName"], "perDollar": 100, "packs": config.packs(), "custom": b.get("custom"),
                          "creditCosts": b["creditCosts"], "signupGift": int(b.get("signupGift") or 0),
                          "refundDays": int(b["refundDays"])}
    return out


# Each billing module's routes answer 404 while its module is off (BILLING_MODE): (path prefix, is the module on?)
_MODULE_ROUTES = (
    ("/api/billing/", config.subscriptions_on),
    ("/api/wallet", config.credits_on),
    ("/api/account/referral", config.credits_on),
    ("/api/account/cards", lambda: config.billing_mode() != "none"),
)


def _module_off(path: str) -> bool:
    return any(path.startswith(prefix) and not on() for prefix, on in _MODULE_ROUTES)


def _test_login(event: dict) -> dict:
    if not auth.TEST_LOGIN:
        return not_found("No route: POST /api/test-login")
    username = params.text(params.body(event), "username").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,31}", username):
        return error("Use 2-32 letters, numbers, - or _", 400)
    return ok(auth.issue_test_token(username))


def _route(method: str, path: str, user_id: str, event: dict) -> dict:
    if _module_off(path):
        return not_found(f"No route: {method} {path}")

    # --- Items ---
    if method == "GET" and path == "/api/items":
        return items.list_items(user_id, event)

    if method == "POST" and path == "/api/items":
        return items.create_item(user_id, event)

    m = re.match(r"^/api/items/([A-Za-z0-9]+)$", path)
    if m:
        item_id = m.group(1)
        if method == "PUT":
            return items.update_item(user_id, item_id, event)
        if method == "DELETE":
            return items.delete_item(user_id, item_id, event)

    # --- Account ---
    if method == "GET" and path == "/api/account":
        return account.get_account(user_id, event)

    if method == "PUT" and path == "/api/account/name":
        return account.update_name(user_id, event)

    if method == "PUT" and path == "/api/account/settings":
        return account.update_settings(user_id, event)

    if method == "GET" and path == "/api/account/notes":
        return account.list_notes(user_id, event)

    if method == "POST" and path == "/api/account/notes/dismiss":
        return account.dismiss_note(user_id, event)

    if method == "POST" and path == "/api/account/referral":
        return account.set_referral(user_id, event)

    # --- Saved cards (any billing mode but none) ---
    if path == "/api/account/cards" and method == "GET":
        return cards.list_cards(user_id)

    if path == "/api/account/cards/setup" and method == "POST":
        return cards.setup(user_id, _email(event), event)

    m = re.match(r"^/api/account/cards/(pm_[A-Za-z0-9_]+)(/default|/removal-check)?$", path)
    if m:
        pm_id, action = m.group(1), m.group(2)
        if action == "/default" and method == "POST":
            return cards.make_default(user_id, pm_id)
        if action == "/removal-check" and method == "GET":
            return cards.removal_check(user_id, pm_id)
        if action is None and method == "DELETE":
            return cards.remove(user_id, pm_id)

    # --- Credits wallet ---
    if method == "GET" and path == "/api/wallet":
        return wallet.get_wallet(user_id, event)

    if method == "POST" and path == "/api/wallet/charge":
        return wallet.charge(user_id, _email(event), event)

    m = re.match(r"^/api/wallet/charge/(pi_[A-Za-z0-9_]+)$", path)
    if m and method == "GET":
        return wallet.finish_charge(user_id, m.group(1))

    if method == "POST" and path == "/api/wallet/auto-reload":
        return wallet.auto_reload(user_id, event)

    if method == "GET" and path == "/api/wallet/refunds":
        return wallet.refund_options(user_id)

    if method == "POST" and path == "/api/wallet/refund":
        return wallet.request_refund(user_id, event)

    # --- Billing ---
    if method == "POST" and path == "/api/billing/checkout":
        return billing.create_checkout(user_id, event)

    if method == "POST" and path == "/api/billing/portal":
        return billing.create_portal(user_id, event)

    if method == "POST" and path == "/api/billing/change-plan":
        return billing.change_plan(user_id, event)

    if method == "POST" and path == "/api/billing/cancel":
        return billing.cancel_plan(user_id, event)

    return not_found(f"No route: {method} {path}")


def _email(event: dict) -> str:
    """The signed-in user's email from the token (receipts); the routes fall back to the profile's copy."""
    return str(get_token_claims(event).get("email") or "")


def _admin_route(method: str, path: str, event: dict) -> dict:
    # Login doesn't require admin JWT
    if method == "POST" and path == "/api/admin/login":
        return admin.login(event)

    # All other admin routes require admin JWT
    if method == "GET" and path == "/api/admin/overview":
        return admin.get_overview(event)

    if method == "GET" and path == "/api/admin/users":
        return admin.list_users(event)

    m = re.match(r"^/api/admin/users/([A-Za-z0-9-]+)$", path)
    if m:
        uid = m.group(1)
        if method == "GET":
            return admin.get_user_detail(event, uid)
        if method == "PUT":
            return admin.update_user(event, uid)
        if method == "DELETE":
            return admin.delete_user_account(event, uid)

    if method == "GET" and path == "/api/admin/items":
        return admin.list_all_items(event)

    m = re.match(r"^/api/admin/items/([A-Za-z0-9-]+)/([A-Za-z0-9]+)$", path)
    if m:
        uid, iid = m.group(1), m.group(2)
        if method == "PUT":
            return admin.update_admin_item(event, uid, iid)
        if method == "DELETE":
            return admin.delete_admin_item(event, uid, iid)

    if method == "GET" and path == "/api/admin/health":
        return admin.get_health(event)

    if method == "POST" and path == "/api/admin/actions/trigger-daily-job":
        return admin.trigger_daily_job(event)

    if method == "POST" and path == "/api/admin/actions/send-digest":
        return admin.trigger_digest(event)

    # Stripe config
    if path == "/api/admin/config/stripe":
        if method == "GET":
            return admin.get_stripe_config(event)
        if method == "PUT":
            return admin.update_stripe_config(event)

    # Site config
    if method == "GET" and path == "/api/admin/config":
        return admin.get_config(event)

    if method == "PUT" and path == "/api/admin/config":
        return admin.update_config(event)

    return not_found(f"No admin route: {method} {path}")

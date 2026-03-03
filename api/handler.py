"""YourApp API Handler — Lambda entry point.

Single Lambda handling all HTTP routes via Function URL.
Routes requests based on method + path to route modules.
"""

from __future__ import annotations

import json
import re
import sys
import os

# When deployed as Lambda, handler.py is at root with lib/ and routes/ as subdirs
# When running tests, api/ is the parent. Support both.
_dir = os.path.dirname(os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

try:
    from lib.auth import get_user_id
    from lib.response import ok, unauthorized, not_found, error
    from routes import links, pitches, account, billing, admin
except ImportError:
    from api.lib.auth import get_user_id
    from api.lib.response import ok, unauthorized, not_found, error
    from api.routes import links, pitches, account, billing, admin


def lambda_handler(event, context):
    """Main API handler routed via CloudFront /api/* -> Function URL."""
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

    # Stripe webhook — no JWT auth, uses Stripe signature
    if method == "POST" and path == "/api/webhooks/stripe":
        return billing.handle_webhook(event)

    # Admin routes — use separate auth (Secrets Manager JWT)
    if path.startswith("/api/admin/"):
        return _admin_route(method, path, event)

    # All other routes require JWT auth
    user_id = get_user_id(event)
    if not user_id:
        return unauthorized()

    return _route(method, path, user_id, event)


def _route(method: str, path: str, user_id: str, event: dict) -> dict:
    # --- Links ---
    if method == "GET" and path == "/api/links":
        return links.list_links(user_id, event)

    if method == "POST" and path == "/api/links":
        return links.create_link(user_id, event)

    if method == "POST" and path == "/api/links/csv":
        return links.create_links_csv(user_id, event)

    # Links with ID: /api/links/{linkId}/crawl
    m = re.match(r"^/api/links/([A-Za-z0-9]+)/crawl$", path)
    if m and method == "POST":
        return links.crawl_link(user_id, m.group(1), event)

    # Links with ID: /api/links/{linkId}/history
    m = re.match(r"^/api/links/([A-Za-z0-9]+)/history$", path)
    if m and method == "GET":
        return links.get_link_history(user_id, m.group(1), event)

    # Links with ID: /api/links/{linkId}
    m = re.match(r"^/api/links/([A-Za-z0-9]+)$", path)
    if m:
        link_id = m.group(1)
        if method == "PUT":
            return links.update_link(user_id, link_id, event)
        if method == "DELETE":
            return links.delete_link(user_id, link_id, event)

    # --- Pitches ---
    if method == "GET" and path == "/api/pitches":
        return pitches.list_pitches(user_id, event)

    if method == "POST" and path == "/api/pitches":
        return pitches.create_pitch(user_id, event)

    m = re.match(r"^/api/pitches/([A-Za-z0-9]+)$", path)
    if m:
        pitch_id = m.group(1)
        if method == "PUT":
            return pitches.update_pitch(user_id, pitch_id, event)
        if method == "DELETE":
            return pitches.delete_pitch(user_id, pitch_id, event)

    # --- Account ---
    if method == "GET" and path == "/api/account":
        return account.get_account(user_id, event)

    if method == "PUT" and path == "/api/account/name":
        return account.update_name(user_id, event)

    if method == "PUT" and path == "/api/account/settings":
        return account.update_settings(user_id, event)

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

    if method == "GET" and path == "/api/admin/links":
        return admin.list_all_links(event)

    m = re.match(r"^/api/admin/links/([A-Za-z0-9-]+)/([A-Za-z0-9]+)/crawl$", path)
    if m and method == "POST":
        return admin.crawl_admin_link(event, m.group(1), m.group(2))

    m = re.match(r"^/api/admin/links/([A-Za-z0-9-]+)/([A-Za-z0-9]+)$", path)
    if m:
        uid, lid = m.group(1), m.group(2)
        if method == "PUT":
            return admin.update_admin_link(event, uid, lid)
        if method == "DELETE":
            return admin.delete_admin_link(event, uid, lid)

    if method == "GET" and path == "/api/admin/pitches":
        return admin.list_all_pitches(event)

    m = re.match(r"^/api/admin/pitches/([A-Za-z0-9-]+)/([A-Za-z0-9]+)$", path)
    if m:
        uid, pid = m.group(1), m.group(2)
        if method == "PUT":
            return admin.update_admin_pitch(event, uid, pid)
        if method == "DELETE":
            return admin.delete_admin_pitch(event, uid, pid)

    if method == "GET" and path == "/api/admin/health":
        return admin.get_health(event)

    if method == "POST" and path == "/api/admin/actions/crawl-all":
        return admin.trigger_crawl_all(event)

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

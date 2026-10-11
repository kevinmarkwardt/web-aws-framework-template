"""YourApp admin API: the admin Lambda's entry point (same code bundle as handler.py, its own function and IAM role).

Reached only through the admin site's CloudFront distribution (admin.<domain>): /api/admin/* -> this Lambda's Function
URL with the admin X-Origin-Verify value, which differs from the user API's. Every request is checked before routing:
  1. X-Origin-Verify (403 without it: the Function URL itself is public)
  2. a valid Cognito ID token of this stage's pool (401 SIGNED_OUT)
  3. the caller is an admin: in the Cognito group "admins" (token and live) AND isAdmin on the profile (403 NOT_ADMIN);
     lib/admins.py, re-checked on every request
Maintenance mode never applies here. The user API Lambda (handler.py) answers 404 for every /api/admin/* path.
"""

from __future__ import annotations

import os
import re
import sys

_dir = os.path.dirname(os.path.abspath(__file__))
if _dir not in sys.path:
    sys.path.insert(0, _dir)

try:
    from lib.auth import get_token_claims
    from lib.response import ok, error, forbidden, not_found
    from lib import admins, params
    from routes import admin, support
except ImportError:
    from api.lib.auth import get_token_claims
    from api.lib.response import ok, error, forbidden, not_found
    from api.lib import admins, params
    from api.routes import admin, support

UID = r"(?P<uid>[A-Za-z0-9_-]{1,128})"

# (method, path pattern, handler(event, actor, **named groups)). Add your app's admin routes here.
ROUTES = [
    ("GET", r"/api/admin/me", admin.me),
    ("GET", r"/api/admin/overview", admin.overview),
    ("GET", r"/api/admin/users", admin.users),
    ("GET", rf"/api/admin/users/{UID}", admin.user_detail),
    ("POST", rf"/api/admin/users/{UID}/(?P<action>{'|'.join(admin.ACTIONS)})", admin.user_action),
    ("GET", r"/api/admin/payments", admin.payments_list),
    ("GET", r"/api/admin/payments/(?P<pi>[A-Za-z0-9_]{1,255})", admin.payment_detail),
    ("GET", r"/api/admin/stripe-log", admin.stripe_log),
    ("GET", r"/api/admin/webhooks", admin.webhooks),
    ("GET", r"/api/admin/webhooks/(?P<evt>evt_[A-Za-z0-9_]{1,255})", admin.webhook),
    ("GET", r"/api/admin/audit", admin.audit_log),
    ("GET", r"/api/admin/support", support.admin_list),
    ("POST", rf"/api/admin/support/(?P<tid>{support.TICKET_ID})", support.admin_update),
    ("GET", r"/api/admin/health", admin.health),
    ("GET", r"/api/admin/config", admin.get_config),
    ("PUT", r"/api/admin/config", admin.put_config),
    ("GET", r"/api/admin/config/stripe", admin.get_stripe_config),
    ("PUT", r"/api/admin/config/stripe", admin.put_stripe_config),
    ("GET", r"/api/admin/items", admin.items),
    ("DELETE", rf"/api/admin/items/{UID}/(?P<item_id>[A-Za-z0-9]{{1,64}})", admin.delete_item),
    ("POST", r"/api/admin/actions/(?P<task>daily-job|payments-sweep)", admin.run_task),
]
_COMPILED = [(m, re.compile(p + r"\Z"), fn) for m, p, fn in ROUTES]


def lambda_handler(event, context):
    if not params.from_cloudfront(event):  # went around the admin distribution
        return forbidden()
    try:
        return _dispatch(event)
    except params.BadRequest as e:
        return error(str(e), 400)


def _dispatch(event: dict) -> dict:
    method, path = params.method_path(event)
    if method == "OPTIONS":
        return ok({"ok": True})
    if not path.startswith("/api/admin/"):
        return not_found(f"No route: {method} {path}")

    claims = get_token_claims(event)
    uid, why = admins.check(claims)
    if not uid:
        if why == "SIGNED_OUT":
            return error("Sign in first", 401, "SIGNED_OUT")
        return error("This account isn't an admin of this site", 403, "NOT_ADMIN")
    actor = f"admin:{uid}"

    for m, pattern, fn in _COMPILED:
        hit = pattern.match(path)
        if hit and m == method:
            return fn(event, actor, **hit.groupdict())
    return not_found(f"No admin route: {method} {path}")


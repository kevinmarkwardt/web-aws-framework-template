"""HTTP response helpers."""

from __future__ import annotations

import json
import os
from decimal import Decimal

try:
    from lib import i18n
except ImportError:
    from api.lib import i18n


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            if o % 1 == 0:
                return int(o)
            return float(o)
        return super().default(o)


def ok(body: dict | list, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            # only the stage's own site (FRONTEND_URL, set by the stack); the site calls /api on its own origin anyway
            "Access-Control-Allow-Origin": os.environ.get("FRONTEND_URL") or "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Language",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def error(message: str, status: int = 400, code: str | None = None, **values) -> dict:
    """{"error": the English message, "message": the same in the request's language (lib/i18n.py), "code": an optional
    machine-readable reason the frontend branches on}. `message` is English: a plain sentence, an i18n.Text, or a
    template filled from `values` ("Choose between {min} and {max}", min=1, max=5). The sites show `message`."""
    if values:
        message = i18n.Text(message, **values)
    body = {"error": str(message), "message": i18n.translate(message)}
    return ok({**body, **({"code": code} if code else {})}, status=status)


def not_found(message: str = "Not found", **values) -> dict:
    return error(message, 404, **values)


def unauthorized(message: str = "Unauthorized") -> dict:
    return error(message, 401)


def forbidden(message: str = "Forbidden") -> dict:
    return error(message, 403)


def unavailable(message: str, code: str = "MAINTENANCE") -> dict:
    return error(message, 503, code)

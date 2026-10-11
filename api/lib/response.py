"""HTTP response helpers."""

from __future__ import annotations

import json
import os
from decimal import Decimal


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
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def error(message: str, status: int = 400, code: str | None = None) -> dict:
    """{"error": message} plus an optional machine-readable `code` the frontend can branch on."""
    return ok({"error": message, **({"code": code} if code else {})}, status=status)


def not_found(message: str = "Not found") -> dict:
    return error(message, 404)


def unauthorized(message: str = "Unauthorized") -> dict:
    return error(message, 401)


def forbidden(message: str = "Forbidden") -> dict:
    return error(message, 403)


def unavailable(message: str, code: str = "MAINTENANCE") -> dict:
    return error(message, 503, code)

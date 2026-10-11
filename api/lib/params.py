"""Request parsing shared by the routes: a malformed body or query parameter is the caller's mistake (400), never a 500.

The helpers raise BadRequest; handler.py turns it into a 400 with the message, so routes don't wrap each call.
"""

from __future__ import annotations

import base64
import datetime as dt
import hmac
import json
import os
import re


class BadRequest(Exception):
    """The request can't be used as sent; the message is shown to the caller."""


def body(event: dict) -> dict:
    """The JSON object body ({} when there is none). Malformed JSON or a non-object body -> BadRequest."""
    raw = event.get("body") or ""
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        data = json.loads(raw) if raw.strip() else None
    except ValueError:  # JSONDecodeError, bad base64 and bad UTF-8 are all ValueErrors
        raise BadRequest("The request body isn't valid JSON") from None
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise BadRequest("The request body must be a JSON object")
    return data


def text(data: dict, name: str, default: str = "") -> str:
    """A string field of a parsed body; missing or null -> default, any other type -> BadRequest."""
    value = data.get(name)
    if value is None:
        return default
    if not isinstance(value, str):
        raise BadRequest(f"{name} must be text")
    return value


def header(event: dict | None, name: str) -> str:
    """A request header's value, "" when absent (header names match in any case)."""
    name = name.lower()
    return next((str(v) for k, v in ((event or {}).get("headers") or {}).items() if k.lower() == name), "")


def from_cloudfront(event: dict | None) -> bool:
    """The Function URL is public. CloudFront adds X-Origin-Verify = ORIGIN_VERIFY (set by the CDK stack: the stack's
    own id, never in the repo) to every /api/* request it forwards, the Stripe webhook's too. A request without it went
    around CloudFront (its cache policy, any WAF, the security headers). Compared in constant time.
    No ORIGIN_VERIFY (local API, tests): every request passes."""
    secret = os.environ.get("ORIGIN_VERIFY", "")
    return not secret or hmac.compare_digest(header(event, "x-origin-verify").encode(), secret.encode())


def method_path(event: dict) -> tuple[str, str]:
    """(method, path) of a Function URL event, or of an API Gateway v1 event."""
    http = (event.get("requestContext") or {}).get("http") or {}
    return http.get("method") or event.get("httpMethod", ""), http.get("path") or event.get("path", "")


def query(event: dict, name: str, default: str = "") -> str:
    """A query string parameter ("" or default when absent)."""
    value = (event.get("queryStringParameters") or {}).get(name)
    return default if value in (None, "") else str(value)


def query_int(event: dict, name: str, default: int, lo: int, hi: int) -> int:
    """A whole-number query parameter between lo and hi (default when absent; anything else -> BadRequest)."""
    raw = query(event, name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise BadRequest(f"{name} must be a whole number") from None
    if not lo <= value <= hi:
        raise BadRequest(f"{name} must be between {lo} and {hi}")
    return value


def day(event: dict, name: str = "day") -> str:
    """A UTC day YYYY-MM-DD from the query string; today (UTC) when absent. The logs and payments are filed by UTC day."""
    value = query(event, name) or dt.datetime.now(dt.timezone.utc).date().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise BadRequest(f"{name} must be a date like 2026-10-11")
    return value

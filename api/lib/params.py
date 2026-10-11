"""Request parsing shared by the routes: a malformed body or query parameter is the caller's mistake (400), never a 500.

The helpers raise BadRequest; handler.py turns it into a 400 with the message, so routes don't wrap each call.
"""

from __future__ import annotations

import base64
import json


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

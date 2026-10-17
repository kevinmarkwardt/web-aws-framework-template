"""Operational logs for the admin site (docs/payments.md). All expire after 18 months (DynamoDB TTL, attribute `ttl`).

  STRIPELOG#{day} / {ts}#{id}      every call we make to Stripe: operation, redacted request, idempotency key, Stripe
                                   request id, status, a response summary (ids, amounts, states) or the error,
                                   milliseconds, who triggered it, userId. Never personal details (SENSITIVE, _summary).
  STRIPEEVT#{evt} / EVT            every webhook received: type, object id, status, result (the exactly-once claim)
  STRIPEEVTDAY#{day} / {at}#{evt}  the same, listed by day (admin Stripe log)
  AUDIT#{day} / {ts}#{id}          every admin (and automatic) account or money action: actor, action, target, reason,
                                   before / after

Reads for the admin site (phase 3 adds the routes): stripe_calls, webhooks, audits.
"""

from __future__ import annotations

import datetime as dt
import json
import time
import uuid

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

try:
    from lib import db
except ImportError:
    from api.lib import db

RETENTION_S = 548 * 86400  # 18 months
SENSITIVE = {"client_secret", "secret", "secretKey", "webhookSecret", "number", "cvc", "card_number", "password", "token",
             # personal data: the call log and audit rows are kept 18 months
             "email", "receipt_email", "name", "phone", "address", "billing_details", "shipping", "customer_details",
             "card", "payment_method_details", "ip_address", "ip"}
# what a Stripe answer keeps in the call log: ids, amounts and states only, never the customer's details
RESPONSE_FIELDS = ("id", "object", "status", "amount", "amount_received", "amount_refunded", "currency", "payment_intent",
                   "charge", "customer", "reason", "failure_code", "failure_message", "cancellation_reason", "livemode", "created")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _ttl() -> int:
    return int(time.time()) + RETENTION_S


def redact(value, depth: int = 0):
    """Drop secrets and trim big payloads before they are logged."""
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        return {k: ("[redacted]" if k in SENSITIVE else redact(v, depth + 1)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v, depth + 1) for v in list(value)[:50]]
    if isinstance(value, str) and len(value) > 500:
        return value[:500] + "…"
    return value


def _json(value) -> str:
    return json.dumps(redact(value), default=str)[:20000]


def _summary(body) -> dict:
    """A Stripe answer reduced to RESPONSE_FIELDS (a list: its ids). A retrieved payment carries the customer's name,
    email, address and card through its charge and payment method; none of that belongs in an 18-month log."""
    if not isinstance(body, dict):
        return {}
    if body.get("object") == "list":
        data = [d for d in body.get("data") or [] if isinstance(d, dict)]
        return {"object": "list", "count": len(data), "has_more": bool(body.get("has_more")), "ids": [d.get("id") for d in data[:50]]}
    out = {k: body[k] for k in RESPONSE_FIELDS if body.get(k) not in (None, "") and not isinstance(body[k], (dict, list))}
    for k in ("payment_intent", "charge", "customer", "latest_charge"):  # an expanded object: its id only
        if isinstance(body.get(k), dict) and body[k].get("id"):
            out[k] = body[k]["id"]
    err = body.get("last_payment_error")
    if isinstance(err, dict):
        out["last_payment_error"] = {k: err[k] for k in ("code", "decline_code", "message", "type") if err.get(k)}
    if isinstance(body.get("next_action"), dict):
        out["next_action"] = body["next_action"].get("type")
    return out


def stripe_call(op: str, fn, params: dict | None = None, *, user_id: str = "", actor: str = "system", idempotency_key: str = ""):
    """Run one Stripe API call and log it, success or failure. Re-raises Stripe errors after logging."""
    started = time.monotonic()
    entry = {"op": op, "request": _json(params or {}), "idempotencyKey": idempotency_key, "userId": user_id, "actor": actor}
    try:
        result = fn()
    except Exception as e:  # noqa: BLE001 - logged and re-raised
        entry.update(ok=False, error=f"{type(e).__name__}: {getattr(e, 'user_message', None) or str(e)}"[:1000],
                     errorCode=getattr(e, "code", None) or "", httpStatus=getattr(e, "http_status", None) or 0,
                     stripeRequestId=getattr(e, "request_id", None) or "")
        _put_stripelog(entry, started)
        raise
    last = getattr(result, "last_response", None)
    body = result.to_dict() if hasattr(result, "to_dict") else result
    entry.update(ok=True, httpStatus=getattr(last, "code", 200) or 200, stripeRequestId=getattr(last, "request_id", "") or "",
                 objectId=(body or {}).get("id", "") if isinstance(body, dict) else "", response=_json(_summary(body)))
    _put_stripelog(entry, started)
    return result


def stripe_find(op: str, fn, params: dict | None = None, *, user_id: str = ""):
    """stripe_call for looking up an id the caller sent: None when Stripe doesn't have it (made up, or from another
    account). Only for caller-supplied ids; an id we stored that has gone missing must still raise."""
    import stripe

    try:
        return stripe_call(op, fn, params, user_id=user_id)
    except stripe.InvalidRequestError as e:
        if e.code == "resource_missing":
            return None
        raise


def _put_stripelog(entry: dict, started: float) -> None:
    now = _now()
    entry = {k: v for k, v in entry.items() if v not in (None, "")}
    db._get_table().put_item(Item={"pk": f"STRIPELOG#{now.date().isoformat()}", "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
                                   "at": now.isoformat(), "ms": int((time.monotonic() - started) * 1000), "ttl": _ttl(), **entry})


STALE_CLAIM_S = 180  # a claim still "processing" after this lost its Lambda (30 s timeout): Stripe's retry takes it over


def claim_event(evt_id: str, evt_type: str, object_id: str) -> bool:
    """Record a webhook delivery; False if this event was already processed or is being processed right now (Stripe
    retries). A claim left "processing" for STALE_CLAIM_S (the Lambda that took it died) is taken over by the next
    delivery; every handler is safe to run again."""
    now = _now()
    try:
        db._get_table().put_item(
            Item={"pk": f"STRIPEEVT#{evt_id}", "sk": "EVT", "type": evt_type, "objectId": object_id, "at": now.isoformat(),
                  "status": "processing", "ttl": _ttl(), "day": now.date().isoformat()},
            ConditionExpression="attribute_not_exists(pk) OR #s = :failed OR (#s = :processing AND #at < :stale)",
            ExpressionAttributeNames={"#s": "status", "#at": "at"},
            ExpressionAttributeValues={":failed": "failed", ":processing": "processing",
                                       ":stale": (now - dt.timedelta(seconds=STALE_CLAIM_S)).isoformat()},
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def finish_event(evt_id: str, status: str, result: str) -> None:
    now = _now()
    table = db._get_table()
    table.update_item(Key={"pk": f"STRIPEEVT#{evt_id}", "sk": "EVT"}, UpdateExpression="SET #s = :s, #r = :r, finishedAt = :t",
                      ExpressionAttributeNames={"#s": "status", "#r": "result"},
                      ExpressionAttributeValues={":s": status, ":r": result[:2000], ":t": now.isoformat()})
    item = table.get_item(Key={"pk": f"STRIPEEVT#{evt_id}", "sk": "EVT"}).get("Item") or {}
    # day index so the admin log can list webhooks by date
    table.put_item(Item={"pk": f"STRIPEEVTDAY#{item.get('day', now.date().isoformat())}", "sk": f"{item.get('at', now.isoformat())}#{evt_id}",
                         "eventId": evt_id, "type": item.get("type", ""), "objectId": item.get("objectId", ""), "status": status,
                         "result": result[:2000], "ttl": _ttl()})


def audit(actor: str, action: str, target: str, reason: str = "", before=None, after=None) -> None:
    now = _now()
    db._get_table().put_item(Item={
        "pk": f"AUDIT#{now.date().isoformat()}", "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}", "at": now.isoformat(),
        "actor": actor, "action": action, "target": target, "reason": (reason or "")[:1000],
        "before": _json(before) if before is not None else "", "after": _json(after) if after is not None else "", "ttl": _ttl(),
    })


# ---- reads (admin site)

def _day_rows(pk: str, limit: int) -> list[dict]:
    rows = db._get_table().query(KeyConditionExpression=Key("pk").eq(pk), ScanIndexForward=False, Limit=limit).get("Items", [])
    return [{k: v for k, v in r.items() if k not in ("pk", "ttl")} for r in rows]


def stripe_calls(day: str, limit: int = 200, user_id: str = "", failures_only: bool = False) -> list[dict]:
    """One UTC day's Stripe calls (YYYY-MM-DD), newest first, optionally one user's or only the failed ones."""
    rows = _day_rows(f"STRIPELOG#{day}", 1000 if (user_id or failures_only) else limit)
    rows = [r for r in rows if (not user_id or r.get("userId") == user_id) and (not failures_only or not r.get("ok"))]
    return rows[:limit]


def webhooks(day: str, limit: int = 200, failures_only: bool = False) -> list[dict]:
    """One UTC day's webhook deliveries, newest first."""
    rows = _day_rows(f"STRIPEEVTDAY#{day}", 1000 if failures_only else limit)
    return [r for r in rows if not failures_only or r.get("status") != "ok"][:limit]


def webhook(evt_id: str) -> dict | None:
    return db._get_table().get_item(Key={"pk": f"STRIPEEVT#{evt_id}", "sk": "EVT"}).get("Item")


def audits(day: str, limit: int = 200, actor: str = "", target: str = "") -> list[dict]:
    """One UTC day's audit rows, newest first, optionally by actor ("admin:{uid}", "system", "stripe") or target
    ("user:{uid}")."""
    rows = _day_rows(f"AUDIT#{day}", 1000 if (actor or target) else limit)
    return [r for r in rows if (not actor or r.get("actor") == actor) and (not target or r.get("target") == target)][:limit]

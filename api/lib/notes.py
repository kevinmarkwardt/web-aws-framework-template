"""Account alerts: short notices shown in the user menu (auto reload results, warnings, a ban, a failed renewal...).

  USER#uid / NOTE#{ts}#{id}   kind, title, message, createdAt, ttl (expire after NOTE_TTL_S), dismissed

  GET  /api/account/notes             the visible ones, newest first
  POST /api/account/notes/dismiss {id}  hide one for good
"""

from __future__ import annotations

import datetime as dt
import time
import uuid

from boto3.dynamodb.conditions import Key

try:
    from lib import db
except ImportError:
    from api.lib import db

NOTE_TTL_S = 30 * 86400


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def add(user_id: str, kind: str, title: str, message: str, **extra) -> dict:
    item = {"pk": f"USER#{user_id}", "sk": f"NOTE#{_now()}#{uuid.uuid4().hex[:6]}", "kind": kind, "title": title[:200],
            "message": message[:2000], "createdAt": _now(), "ttl": int(time.time()) + NOTE_TTL_S,
            **{k: v for k, v in extra.items() if v not in (None, "")}}
    db._get_table().put_item(Item=item)
    return item


def visible(user_id: str, limit: int = 50) -> list[dict]:
    """Undismissed, unexpired alerts, newest first (DynamoDB's TTL deletes lag, so expiry is checked here too)."""
    rows = db._get_table().query(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("NOTE#"),
                                 ScanIndexForward=False, Limit=200).get("Items", [])
    now_s = int(time.time())
    out = [r for r in rows if int(r.get("ttl", now_s + 1)) > now_s and not r.get("dismissed")]
    return [{"id": r["sk"], **{k: v for k, v in r.items() if k not in ("pk", "sk", "ttl", "dismissed")}} for r in out[:limit]]


def dismiss(user_id: str, note_id: str) -> bool:
    """Hide one alert of this user's for good. Another user's or an unknown id changes nothing (False)."""
    if not isinstance(note_id, str) or not note_id.startswith("NOTE#"):
        return False
    return db.conditional(db._get_table().update_item, Key={"pk": f"USER#{user_id}", "sk": note_id},
                          UpdateExpression="SET dismissed = :t", ConditionExpression="attribute_exists(sk)",
                          ExpressionAttributeValues={":t": True})

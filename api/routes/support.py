"""Support requests: customers write in from the site's Support page; admins answer from the admin site's Support tab.

  User API (api/handler.py):
    GET  /api/support                       my requests (newest first) and the topics the form offers
    POST /api/support {topic, message}      open a request (ADMIN_EMAIL is emailed)
    POST /api/support/{id} {message}        add to my own open request (emailed too)
  Admin API (api/admin_handler.py):
    GET  /api/admin/support?status=open|closed|all
    POST /api/admin/support/{id} {reply?, status?}   reply (the customer gets an account alert and an email) and/or
                                                     open / close; audited

Topics and limits are code config: config.SUPPORT. Limits: maxOpen open requests per customer (429), followUpsPerDay
follow-ups per request per UTC day (429), about 300 KB per request (409: DynamoDB caps an item at 400 KB).
Replies show to the customer as from "support"; which admin wrote one is kept for the admin tab and the audit log.

  SUPPORT#{id} / TICKET                    userId, email, topic, message, status open|closed, createdAt, updatedAt,
                                           replies [{at, by: customer|support, admin?, text}]
  USER#uid / SUPPORTREF#{createdAt}#{id}   the customer's own list
  SUPPORTQ#{status} / {createdAt}#{id}     the admin queue per status (moved on open / close)
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

from boto3.dynamodb.conditions import Key

try:
    from lib import config, db, logs, mail, notes, params, response
except ImportError:
    from api.lib import config, db, logs, mail, notes, params, response

MAX_TEXT = 4000
MAX_TICKET_BYTES = 300_000    # past this the customer can't add more (a reply still fits under DynamoDB's 400 KB)
ADMIN_TICKET_BYTES = 350_000  # past this an admin's reply is refused too, instead of failing with a 500
TICKET_ID = r"[a-f0-9]{12}"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _t():
    return db._get_table()


def topics() -> dict[str, str]:
    return dict(config.SUPPORT["topics"])


def _topic_list() -> list[dict]:
    return [{"id": k, "label": v} for k, v in topics().items()]


def _view(t: dict, admin: bool = False) -> dict:
    """A request as its customer sees it (replies from "support", never an admin's id) or, for the admin tab, with
    who answered."""
    replies = [{"at": r.get("at"), "text": r.get("text"),
                "by": "customer" if r.get("by") == "customer" else ((r.get("admin") or "support") if admin else "support")}
               for r in t.get("replies") or []]
    out = {k: t.get(k) for k in ("id", "topic", "message", "status", "createdAt", "updatedAt")}
    if admin:
        out.update(userId=t.get("userId"), email=t.get("email"))
    return out | {"topicLabel": topics().get(t.get("topic", ""), t.get("topic", "")), "replies": replies}


def _too_long(ticket: dict, text: str, limit: int = MAX_TICKET_BYTES) -> bool:
    return len(json.dumps(ticket, default=str, ensure_ascii=False).encode()) + len(text.encode()) > limit


def _get(tid: str) -> dict | None:
    return _t().get_item(Key={"pk": f"SUPPORT#{tid}", "sk": "TICKET"}).get("Item")


def _mine(user_id: str, limit: int = 50) -> list[dict]:
    refs = _t().query(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("SUPPORTREF#"),
                      ScanIndexForward=False, Limit=limit).get("Items", [])
    found = {x["id"]: x for x in db.batch_get([{"pk": f"SUPPORT#{r['ticketId']}", "sk": "TICKET"} for r in refs])}
    return [found[r["ticketId"]] for r in refs if r["ticketId"] in found]


# ---- customers

def mine(user_id: str) -> dict:
    return response.ok({"requests": [_view(x) for x in _mine(user_id)], "topics": _topic_list(),
                        "maxOpen": int(config.SUPPORT["maxOpen"])})


def create(user_id: str, email: str, event: dict) -> dict:
    b = params.body(event)
    topic = params.text(b, "topic", "other")
    message = params.text(b, "message").strip()
    if topic not in topics():
        topic = "other" if "other" in topics() else next(iter(topics()))
    if len(message) < 10:
        return response.error("Please write at least a sentence so we can help", 400)
    max_open = int(config.SUPPORT["maxOpen"])
    if sum(1 for x in _mine(user_id) if x.get("status") == "open") >= max_open:
        return response.error(f"You have {max_open} open requests. Add to one of them, or wait for an answer.", 429, "TOO_MANY_OPEN")
    profile = db.get_user(user_id) or {}
    now, tid = _now(), uuid.uuid4().hex[:12]
    ticket = {"pk": f"SUPPORT#{tid}", "sk": "TICKET", "id": tid, "userId": user_id, "email": profile.get("email") or email,
              "topic": topic, "message": message[:MAX_TEXT], "status": "open", "createdAt": now, "updatedAt": now, "replies": []}
    db.transact([
        db.tx_put(ticket),
        db.tx_put({"pk": f"USER#{user_id}", "sk": f"SUPPORTREF#{now}#{tid}", "ticketId": tid}),
        db.tx_put({"pk": "SUPPORTQ#open", "sk": f"{now}#{tid}", "ticketId": tid}),
    ])
    mail.to_admin(f"Support: {topics()[topic]}", f"From {ticket['email'] or user_id}:\n\n{message[:MAX_TEXT]}\n\n"
                  "Answer it on the admin site's Support tab.")
    return response.ok(_view(ticket), 201)


def comment(user_id: str, tid: str, event: dict) -> dict:
    ticket = _get(tid)
    if not ticket or ticket.get("userId") != user_id:
        return response.not_found("Request not found")
    if ticket.get("status") != "open":
        return response.error("This request is closed; send a new one", 409, "CLOSED")
    message = params.text(params.body(event), "message").strip()[:MAX_TEXT]
    if len(message) < 2:
        return response.error("Write a message first", 400)
    now = _now()
    today = sum(1 for r in ticket.get("replies") or [] if r.get("by") == "customer" and str(r.get("at", ""))[:10] == now[:10])
    if today >= int(config.SUPPORT["followUpsPerDay"]):
        return response.error("That's a lot of messages for one request today. Support will answer; add more tomorrow.", 429)
    if _too_long(ticket, message):
        return response.error("This request is too long to add to. Start a new one.", 409, "TOO_LONG")
    _t().update_item(Key={"pk": ticket["pk"], "sk": "TICKET"},
                     UpdateExpression="SET replies = list_append(if_not_exists(replies, :e), :r), updatedAt = :n",
                     ExpressionAttributeValues={":e": [], ":r": [{"at": now, "by": "customer", "text": message}], ":n": now})
    mail.to_admin(f"Support follow-up: {topics().get(ticket['topic'], 'request')}",
                  f"From {ticket.get('email') or user_id}:\n\n{message}\n\nAnswer it on the admin site's Support tab.")
    return response.ok(_view(_get(tid)))


# ---- admins

def admin_list(event: dict, actor: str) -> dict:
    status = params.query(event, "status", "open")
    if status not in ("open", "closed", "all"):
        raise params.BadRequest("status must be open, closed or all")
    rows = []
    for s in (["open", "closed"] if status == "all" else [status]):
        rows += _t().query(KeyConditionExpression=Key("pk").eq(f"SUPPORTQ#{s}"), ScanIndexForward=False, Limit=200).get("Items", [])
    found = {x["id"]: x for x in db.batch_get([{"pk": f"SUPPORT#{r['ticketId']}", "sk": "TICKET"} for r in rows])}
    out = sorted((_view(found[r["ticketId"]], admin=True) for r in rows if r["ticketId"] in found),
                 key=lambda x: x["createdAt"], reverse=True)
    counts = {s: _t().query(KeyConditionExpression=Key("pk").eq(f"SUPPORTQ#{s}"), Select="COUNT")["Count"] for s in ("open", "closed")}
    return response.ok({"requests": out, "counts": counts, "topics": _topic_list()})


def admin_update(event: dict, actor: str, tid: str) -> dict:
    ticket = _get(tid)
    if not ticket:
        return response.not_found("Request not found")
    b = params.body(event)
    reply = params.text(b, "reply").strip()[:MAX_TEXT]
    status = b.get("status")
    if status not in (None, "open", "closed"):
        raise params.BadRequest("status must be open or closed")
    if not reply and status is None:
        raise params.BadRequest("Send a reply, a status, or both")
    if reply and _too_long(ticket, reply, ADMIN_TICKET_BYTES):
        return response.error("This request is too long to add to. Ask the customer to start a new one.", 409, "TOO_LONG")
    t, now = _t(), _now()
    if reply:  # the customer sees "support"; which admin answered stays in the ticket and the audit log
        t.update_item(Key={"pk": ticket["pk"], "sk": "TICKET"},
                      UpdateExpression="SET replies = list_append(if_not_exists(replies, :e), :r), updatedAt = :n",
                      ExpressionAttributeValues={":e": [], ":r": [{"at": now, "by": "support", "admin": actor, "text": reply}], ":n": now})
        notes.add(ticket["userId"], "support", "Support replied", reply[:500])
        mail.to_user(ticket["userId"], f"{mail.APP_NAME} support replied", f"{reply}\n\nYour request:\n{ticket['message']}")
    if status and status != ticket["status"]:
        q = f"{ticket['createdAt']}#{tid}"
        db.transact([
            db.tx_delete({"pk": f"SUPPORTQ#{ticket['status']}", "sk": q}),
            db.tx_put({"pk": f"SUPPORTQ#{status}", "sk": q, "ticketId": tid}),
            db.tx_update({"pk": ticket["pk"], "sk": "TICKET"}, "SET #s = :s, updatedAt = :n", {":s": status, ":n": now},
                         names={"#s": "status"}),
        ])
    # the reply itself stays in the ticket: audit rows are kept 18 months and hold no personal data (lib/logs.py)
    logs.audit(actor, "support.update", f"support:{tid}", " and ".join(filter(None, ["replied" if reply else "", f"set {status}" if status else ""])),
               after={"status": status or ticket["status"], "replied": bool(reply), "user": ticket["userId"]})
    return response.ok(_view(_get(tid), admin=True))

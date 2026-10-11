"""Account standing: status, warnings, bans and the admin flag (docs/payments.md).

  USER#uid / PROFILE      status active|suspended|banned, statusReason, bannedUntil, bannedAt, bannedBy, isAdmin
  USER#uid / WARN#{ts}    a warning: reason, actor, at, expiresAt; WARN#REF#{ref} when it is about one thing (a removed
                          post, say), so the same thing can only ever warn once while that warning is active
  BANNED#CARD / {fp}      card fingerprints of banned accounts (a top-up with one on another account emails the admin)

Rules (thresholds in config.ACCOUNT_RULES):
  - A warning expires after warningDays; the warningsToBan-th active one bans the account automatically.
  - A ban lasts banDays (lifted lazily once it has passed) and makes the account read-only: sign-in and reading work;
    spending, top-ups, cards, refunds, subscriptions and writes don't. The unspent paid balance goes back to the card,
    the bonus balance is forfeited, an active subscription is cancelled, and the account's cards go on BANNED#CARD.
  - `suspended` (an open dispute, or an admin's call) pauses spending and payments the same way but refunds nothing.

Admin-callable (phase 3 routes): ban, set_status (unban / suspend), add_warning, remove_warning, set_admin, warnings.
"""

from __future__ import annotations

import datetime as dt
import logging

from boto3.dynamodb.conditions import Key

try:
    from lib import config, db, i18n, logs, mail, notes
    from lib.i18n import Text
except ImportError:
    from api.lib import config, db, i18n, logs, mail, notes
    from api.lib.i18n import Text

log = logging.getLogger("yourapp.accounts")

STATUSES = ("active", "suspended", "banned")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _rules() -> dict:
    return config.ACCOUNT_RULES


def profile(user_id: str) -> dict:
    return db.get_user(user_id) or {}


def is_admin(user_id: str | None) -> bool:
    """The profile's isAdmin flag (set by scripts or another admin, never by the user). Re-checked on every admin call."""
    return bool(user_id) and profile(user_id).get("isAdmin") is True


def status(p: dict) -> str:
    """Effective status: a ban whose time has passed counts as lifted."""
    s = p.get("status", "active")
    if s == "banned" and p.get("bannedUntil") and p["bannedUntil"] <= _now().isoformat():
        return "active"
    return s if s in STATUSES else "active"


def standing(p: dict) -> dict:
    """What the site shows (GET /api/account): status, ban end, active warnings."""
    s = status(p)
    return {"status": s, "bannedUntil": p.get("bannedUntil") if s == "banned" else None,
            "statusReason": p.get("statusReason") if s != "active" else None}


def can_spend(user_id: str, p: dict | None = None) -> tuple[bool, str]:
    """Spending, top-ups, saved cards, refunds and subscription changes: refused while suspended or banned."""
    p = profile(user_id) if p is None else p
    s = status(p)
    if s == "banned":
        return False, Text("This account is banned until {date}. You can still sign in and view your data.", date=p.get("bannedUntil", "")[:10])
    if s == "suspended":
        return False, Text("Payments are paused on this account while we look into an issue. Contact support.")
    return True, ""


def can_write(user_id: str, p: dict | None = None) -> tuple[bool, str]:
    """Creating or changing the app's own records: refused only while banned (read-only)."""
    p = profile(user_id) if p is None else p
    if status(p) == "banned":
        return False, Text("This account is read-only until {date}.", date=p.get("bannedUntil", "")[:10])
    return True, ""


# ---- warnings

def warnings(user_id: str) -> list[dict]:
    """Every warning, newest first, each with `active`."""
    rows = db.query_all(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("WARN#"))
    rows.sort(key=lambda r: r.get("at", ""), reverse=True)
    now = _now().isoformat()
    for r in rows:
        r["active"] = not r.get("removed") and r.get("expiresAt", "") > now
    return rows


def active_warnings(user_id: str) -> int:
    return sum(1 for w in warnings(user_id) if w["active"])


def add_warning(user_id: str, reason: str, actor: str = "system", ref: str = "") -> dict:
    """Record a warning, tell the user, and ban at the warningsToBan-th active one. With `ref` (what it is about) the
    row is keyed by it and written only while no active warning holds that key, so a retried removal of the same
    thing adds nothing. Returns the warning (the existing one when nothing was added)."""
    now = _now()
    at = now.isoformat()
    item = {"pk": f"USER#{user_id}", "sk": f"WARN#REF#{ref}" if ref else f"WARN#{at}", "reason": reason[:500],
            "actor": actor, "ref": ref, "at": at, "expiresAt": (now + dt.timedelta(days=_rules()["warningDays"])).isoformat()}
    table = db._get_table()
    if not db.conditional(table.put_item, Item=item, ConditionExpression="attribute_not_exists(sk) OR removed = :t OR expiresAt <= :now",
                          ExpressionAttributeValues={":t": True, ":now": at}):
        return table.get_item(Key={"pk": item["pk"], "sk": item["sk"]}).get("Item") or item
    count, limit = active_warnings(user_id), _rules()["warningsToBan"]
    logs.audit(actor, "warning.add", f"user:{user_id}", reason, after={"activeWarnings": count, "ref": ref})
    if count >= limit:
        ban(user_id, f"{count} warnings in {_rules()['warningDays']} days (latest: {reason})", actor="system")
    else:
        lang = i18n.user_language(user_id)
        msg = i18n.t("Your account received a warning: {reason}. This is warning {count} of {max}; warnings expire after "
                     "{days} days.", lang, reason=reason, count=count, max=limit - 1, days=_rules()["warningDays"])
        if count == limit - 1:
            msg += " " + i18n.t("One more will make the account read-only.", lang)
        notes.add(user_id, "warning", i18n.t("Account warning", lang), msg)
        mail.to_user(user_id, i18n.t("A warning on your {app} account", lang, app=mail.APP_NAME), msg)
    return item


def remove_warning(user_id: str, warn_sk: str, actor: str, reason: str) -> bool:
    """Lift a warning (an admin's mistake, a restored post). A ban it already caused stays until set_status."""
    if not warn_sk.startswith("WARN#"):
        return False
    ok = db.conditional(db._get_table().update_item, Key={"pk": f"USER#{user_id}", "sk": warn_sk},
                        UpdateExpression="SET removed = :t, removedBy = :a, removedReason = :r", ConditionExpression="attribute_exists(sk)",
                        ExpressionAttributeValues={":t": True, ":a": actor, ":r": reason[:500]})
    if ok:
        logs.audit(actor, "warning.remove", f"user:{user_id}", reason, before={"warning": warn_sk})
    return ok


# ---- bans and status

def ban(user_id: str, reason: str, actor: str, days: int | None = None) -> dict:
    """Read-only for `days` (default banDays). The status is written first, so the ban holds even if a refund or the
    subscription cancel below fails (the admin is emailed). Returns {bannedUntil, refundedCents, subscriptionCancelled}."""
    try:
        from lib import payments, subscriptions
    except ImportError:
        from api.lib import payments, subscriptions

    before = profile(user_id)
    until = (_now() + dt.timedelta(days=days or _rules()["banDays"])).isoformat()
    db._get_table().update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET #s = :b, statusReason = :r, bannedUntil = :u, bannedAt = :t, bannedBy = :a",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":b": "banned", ":r": reason[:500], ":u": until, ":t": _now().isoformat(), ":a": actor},
    )
    for fp in before.get("cardFingerprints") or []:
        db._get_table().put_item(Item={"pk": "BANNED#CARD", "sk": fp, "userId": user_id, "at": _now().isoformat(), "reason": reason[:200]})
    refunded, cancelled = 0, False
    if config.credits_on():
        try:
            refunded = payments.refund_to_card(user_id, None, f"Account banned: {reason}", actor, policy="all",
                                               forfeit_bonus=True).get("refunded", 0)
        except payments.RefundError as e:
            log.warning("ban refund for %s: %s", user_id, e)
        except Exception:  # noqa: BLE001 - Stripe or Secrets Manager down: the ban itself stands
            log.exception("ban refund for %s failed", user_id)
            mail.to_admin("Ban refund failed", f"Refunding the unspent paid balance of banned user {user_id} failed (see the "
                          "API logs). The ban is in place; refund them from the admin site.")
    if config.subscriptions_on() and before.get("stripeSubscriptionId"):
        try:
            cancelled = subscriptions.cancel_now(user_id, actor, f"Account banned: {reason}")
        except Exception:  # noqa: BLE001
            log.exception("ban: cancelling the subscription of %s failed", user_id)
            mail.to_admin("Ban: subscription not cancelled", f"Cancelling the subscription of banned user {user_id} failed. "
                          "Cancel it in the Stripe dashboard.")
    logs.audit(actor, "user.ban", f"user:{user_id}", reason, before={"status": status(before)},
               after={"status": "banned", "bannedUntil": until, "refundedCents": refunded, "subscriptionCancelled": cancelled})
    lang = i18n.user_language(user_id)
    msg = i18n.t("Your {app} account is read-only until {date} ({reason}). You can still sign in and view your data.", lang,
                 app=mail.APP_NAME, date=until[:10], reason=reason)
    if refunded:
        msg += " " + i18n.t("Your unused paid balance, {amount}, has been refunded to your card.", lang, amount=f"${refunded / 100:,.2f}")
    if cancelled:
        msg += " " + i18n.t("Your subscription has been cancelled.", lang)
    notes.add(user_id, "banned", i18n.t("Account restricted", lang), msg)
    mail.to_user(user_id, i18n.t("Your {app} account has been restricted", lang, app=mail.APP_NAME), msg)
    return {"bannedUntil": until, "refundedCents": refunded, "subscriptionCancelled": cancelled}


def set_status(user_id: str, new_status: str, reason: str, actor: str) -> None:
    """Unban (active) or suspend (payments paused, nothing refunded). Use ban() to ban."""
    if new_status not in ("active", "suspended"):
        raise ValueError("set_status takes active or suspended; use ban()")
    before = profile(user_id)
    db._get_table().update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET #s = :s, statusReason = :r REMOVE bannedUntil",
        ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":s": new_status, ":r": reason[:500]},
    )
    logs.audit(actor, f"user.{new_status}", f"user:{user_id}", reason, before={"status": status(before)}, after={"status": new_status})


def set_admin(user_id: str, is_admin_flag: bool, actor: str, reason: str = "") -> None:
    db._get_table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="SET isAdmin = :a",
                                ExpressionAttributeValues={":a": bool(is_admin_flag)})
    logs.audit(actor, "user.admin", f"user:{user_id}", reason, after={"isAdmin": bool(is_admin_flag)})


def card_is_banned(fingerprint: str) -> dict | None:
    return db._get_table().get_item(Key={"pk": "BANNED#CARD", "sk": fingerprint}).get("Item") if fingerprint else None

"""Auto reload: when a spend takes the balance under the customer's trigger, buy their chosen pack with their default
card and leave an account alert with the result.

  USER#uid / PROFILE             autoReloadOn, autoReloadBelow (units), autoReloadPack (a config.packs() id),
                                 autoReloadAt (last attempt: one at a time)
  USER#uid / AUTORELOAD#{day}    n = reloads that day (at most maxPerDay; expires after 2 days)

credits.debit calls after_spend() after a spend that leaves the balance under the trigger. The charge is off-session
(the customer isn't there to confirm with their bank), so a decline or a bank check turns auto reload off until they
turn it on again. A reload is an ordinary top-up: same ledger key as the webhook's, refundable like any other.
"""

from __future__ import annotations

import datetime as dt
import logging
import time

from botocore.exceptions import ClientError

try:
    from lib import accounts, config, credits, db, i18n, notes
    from lib.i18n import Text
except ImportError:
    from api.lib import accounts, config, credits, db, i18n, notes
    from api.lib.i18n import Text

log = logging.getLogger("yourapp.autoreload")

MAX_BELOW = 100_000
LOCK_S = 120  # a second spend while a reload is being charged doesn't start another


def _cfg() -> dict:
    return config.BILLING["autoReload"]


def _default_pack() -> str:
    ps = config.packs()
    return ps[min(1, len(ps) - 1)]["id"] if ps else ""


def settings(p: dict) -> dict:
    return {"on": bool(p.get("autoReloadOn")), "below": int(p.get("autoReloadBelow", _cfg()["defaultBelow"])),
            "packId": p.get("autoReloadPack") or _default_pack(), "maxPerDay": int(_cfg()["maxPerDay"])}


def _has_card(user_id: str, p: dict) -> bool:
    """A saved card a reload could charge (a Stripe customer alone isn't enough: opening the add-card page makes one)."""
    cus = p.get("stripeCustomerId")
    if not cus:
        return False
    try:
        from lib import stripe_config
        from routes import cards
    except ImportError:
        from api.lib import stripe_config
        from api.routes import cards
    return bool(cards.default_card(stripe_config.client(), user_id, cus))


def save(user_id: str, body: dict) -> dict | str:
    """Validate and store the settings; returns them, or why not."""
    on = bool(body.get("on"))
    try:
        below = int(body.get("below", _cfg()["defaultBelow"]))
    except (TypeError, ValueError):
        return Text("The trigger must be a whole number of {unit}", unit=credits.unit_name())
    pack_id = str(body.get("packId") or _default_pack())
    if not 0 < below <= MAX_BELOW:
        return Text("Choose a trigger between 1 and {max} {unit}", max=f"{MAX_BELOW:,}", unit=credits.unit_name())
    if not config.pack(pack_id):
        return Text("Unknown pack")
    p = credits.profile(user_id)
    if on:
        ok, why = accounts.can_spend(user_id, p)
        if not ok:
            return why
        try:
            if not _has_card(user_id, p):
                return Text("Add a card first")
        except Exception:  # noqa: BLE001 - Stripe down, or the customer was deleted there: say so, never a 500
            log.exception("card check for %s failed", user_id)
            return Text("We couldn't check your saved card just now; try again in a minute")
    db._get_table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
                                UpdateExpression="SET autoReloadOn = :o, autoReloadBelow = :b, autoReloadPack = :p",
                                ExpressionAttributeValues={":o": on, ":b": below, ":p": pack_id})
    return settings({**p, "autoReloadOn": on, "autoReloadBelow": below, "autoReloadPack": pack_id})


def due(p: dict, balance_after: int) -> bool:
    return bool(p.get("autoReloadOn")) and balance_after < int(p.get("autoReloadBelow", 0))


def _claim(user_id: str) -> bool:
    """Take the one-at-a-time lock (only while auto reload is still on)."""
    return db.conditional(db._get_table().update_item, Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="SET autoReloadAt = :now",
                          ConditionExpression="autoReloadOn = :t AND (attribute_not_exists(autoReloadAt) OR autoReloadAt < :cut)",
                          ExpressionAttributeValues={":now": int(time.time()), ":cut": int(time.time()) - LOCK_S, ":t": True})


def _count_today(user_id: str) -> str:
    """Count this reload against today's cap: its slot ("{day}-{n}", the idempotency key's tail), or "" once the cap
    is reached (the first time, with an alert)."""
    cap = int(_cfg()["maxPerDay"])
    day = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    key = {"pk": f"USER#{user_id}", "sk": f"AUTORELOAD#{day}"}
    try:
        got = db._get_table().update_item(Key=key, UpdateExpression="ADD n :one SET #t = :ttl",
                                          ConditionExpression="attribute_not_exists(n) OR n < :cap", ExpressionAttributeNames={"#t": "ttl"},
                                          ExpressionAttributeValues={":one": 1, ":cap": cap, ":ttl": int(time.time()) + 2 * 86400},
                                          ReturnValues="UPDATED_NEW")
        return f"{day}-{int(got['Attributes']['n'])}"
    except ClientError as e:
        if not db.condition_failed(e):
            raise
    try:  # tell them once a day that it has stopped for today
        db._get_table().update_item(Key=key, UpdateExpression="SET capNoted = :t", ConditionExpression="attribute_not_exists(capNoted)",
                                    ExpressionAttributeValues={":t": True})
        lang = i18n.user_language(user_id)
        notes.add(user_id, "reload_failed", i18n.t("Auto reload paused for today", lang),
                  i18n.t("It already ran {n} times today, the daily limit. It starts again tomorrow, or add {unit} yourself now.",
                         lang, n=cap, unit=credits.unit_name()))
    except ClientError:
        pass
    return ""


def _fail(user_id: str, why: str) -> None:
    db._get_table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="SET autoReloadOn = :f",
                                ExpressionAttributeValues={":f": False})
    lang = i18n.user_language(user_id)
    notes.add(user_id, "reload_failed", i18n.t("Auto reload didn't go through", lang),
              i18n.t("{why} Auto reload is now off; check your card on the Wallet page and turn it back on.", lang,
                     why=i18n.translate(why, lang)))


def run(user_id: str) -> str:
    """Reload now if still due. Returns what happened: added | pending | failed | skipped."""
    try:
        from routes import wallet
    except ImportError:
        from api.routes import wallet
    if not _claim(user_id):
        return "skipped"
    p = credits.profile(user_id)
    s = settings(p)
    if not due(p, credits.balance(p)["credits"]):  # another reload or a refund landed meanwhile
        return "skipped"
    ok, why = accounts.can_spend(user_id, p)
    if not ok:
        _fail(user_id, why)
        return "failed"
    pack = config.pack(s["packId"])
    if not pack:
        _fail(user_id, Text("The pack you chose isn't sold any more."))
        return "failed"
    slot = _count_today(user_id)
    if not slot:
        return "skipped"
    pay, amount = pack["payCents"], pack["credits"]
    try:
        pi = wallet.charge_saved_card(user_id, p.get("email", ""), s["packId"], pay, amount,
                                      ("autoreload", user_id, slot), off_session=True)
    except wallet.ChargeError as e:
        if e.unknown:  # Stripe didn't answer in time: if it went through, the webhook credits it
            return "pending"  # (auto reload stays on; today's count and the lock stop a rerun)
        reason = i18n.message_of(e)
        _fail(user_id, Text("Your card was declined: {reason}.", reason=str(reason).rstrip(".")) if e.status == 402
              else reason if i18n.is_text(reason) else str(reason).rstrip(".") + ".")
        return "failed"
    d = pi.to_dict() if hasattr(pi, "to_dict") else dict(pi)
    if d.get("status") == "succeeded":
        wallet.credit_intent(d)
        lang = i18n.user_language(user_id)
        notes.add(user_id, "reload", i18n.t("Auto reload: {amount} added", lang, amount=credits.fmt(amount)),
                  i18n.t("Your balance went under {below}, so {usd} was charged to your default card. New balance: {balance}.", lang,
                         below=credits.fmt(s["below"]), usd=credits.usd(pay),
                         balance=credits.fmt(credits.balance(credits.profile(user_id))["credits"])))
        return "added"
    if d.get("status") == "processing":
        lang = i18n.user_language(user_id)
        notes.add(user_id, "reload", i18n.t("Auto reload is processing", lang),
                  i18n.t("{usd} for {amount} is waiting on your bank; they arrive as soon as it clears.", lang,
                         usd=credits.usd(pay), amount=credits.fmt(amount)))
        return "pending"
    _fail(user_id, Text("Your bank wants to confirm this payment, which can't happen automatically."))
    return "failed"


def after_spend(user_id: str, p: dict, balance_after: int) -> None:
    """Called by credits.debit with the profile it read. Never lets a reload problem fail the spend."""
    if not due(p, balance_after):
        return
    try:
        run(user_id)
    except Exception:  # noqa: BLE001 - the spend already happened; log and move on
        log.exception("auto reload for %s failed", user_id)

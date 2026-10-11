"""The credits wallet (billing mode credits | both; docs/payments.md). 100 units = $1; whole numbers everywhere. The
unit's display name is config.BILLING["creditName"].

  USER#uid / PROFILE        paidCredits (bought: card-refundable for refundDays), bonusCredits (gifts, pack bonus,
                            referral rewards: never cash). Balance = paid + bonus. Spending takes PAID first and bonus
                            only once paid is used up, so a bonus can't be spent while its money is refunded.
  USER#uid / TX#{key}       immutable ledger rows: kind, amount (+/-), paid, bonus, note, at (+ refs). A row that must
                            happen once has a deterministic key (TOPUP#{pi}, SPEND#{action}#{ref}, SIGNUP, ...) written
                            with attribute_not_exists in the same transaction as the balance change.
  USER#uid / PENDING#{release}#{id}  rewards on hold (referrals) until the payment behind them can't be refunded
  REFCODE#{code} / REFCODE  invite code -> userId (referrals)
  CARDFP#{fp} / USER#{uid}  accounts that paid with a card (payments.record_payment; the same-card referral check)

For apps: `spend(user_id, action, units=None, ref=None)` takes config creditCosts[action] (or `units`) once per ref, and
`refund_spend(user_id, action, ref)` gives it back once (a failed job, say).
"""

from __future__ import annotations

import datetime as dt
import time
import uuid

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

try:
    from lib import config, db
except ImportError:
    from api.lib import config, db

PER_DOLLAR = 100
REFUND_DAYS = int(config.BILLING["refundDays"])
# A top-up can't be refunded until this long after it was made: no rapid buy/refund cycles, and the payment clears
# first. Customer refunds only; admin refunds and bans skip it.
REFUND_HOLD_MINUTES = int(config.BILLING["refundHoldMinutes"])
HOLD_DAYS = REFUND_DAYS  # rewards wait out the refund window of the payment that earned them


class InsufficientCredits(Exception):
    def __init__(self, needed: int, balance: int):
        super().__init__(f"Not enough {unit_name()}: this costs {needed:,} and you have {balance:,}")
        self.needed, self.balance = needed, balance


class AlreadyDone(Exception):
    """The once-only ledger key already exists (a retry, or done already)."""


class Blocked(Exception):
    """The account may not spend (suspended or banned): accounts.can_spend's reason."""


class Declined(Exception):
    """A conditional take was refused. `codes`: one cancellation code per transaction item, in order (the TX row, the
    balance, then the caller's `extra` items), so the caller can tell which condition failed."""

    def __init__(self, codes: list[str]):
        super().__init__(", ".join(codes))
        self.codes = codes


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def today() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def unit_name() -> str:
    return str(config.BILLING.get("creditName") or "credits")


def usd(amount: int) -> str:
    return f"${int(amount) / PER_DOLLAR:,.2f}"


def fmt(n: int) -> str:
    """'1,250 credits'."""
    return f"{int(n):,} {unit_name()}"


def _table():
    return db._get_table()


def _profile_key(user_id: str) -> dict:
    return {"pk": f"USER#{user_id}", "sk": "PROFILE"}


def profile(user_id: str) -> dict:
    return _table().get_item(Key=_profile_key(user_id)).get("Item") or {}


def balance(p: dict) -> dict:
    paid, bonus = int(p.get("paidCredits", 0)), int(p.get("bonusCredits", 0))
    return {"credits": paid + bonus, "paidCredits": paid, "bonusCredits": bonus}


def _ensure_fields(user_id: str) -> None:
    _table().update_item(Key=_profile_key(user_id),
                         UpdateExpression="SET paidCredits = if_not_exists(paidCredits, :z), bonusCredits = if_not_exists(bonusCredits, :z)",
                         ExpressionAttributeValues={":z": 0})


def _tx_item(user_id: str, key: str, kind: str, amount: int, paid: int, bonus: int, note: str, refs: dict) -> dict:
    return {"pk": f"USER#{user_id}", "sk": f"TX#{key}", "kind": kind, "amount": int(amount), "paid": int(paid),
            "bonus": int(bonus), "note": note[:200], "at": now(), **{k: v for k, v in refs.items() if v not in (None, "")}}


# ---- the app-facing API

def spend(user_id: str, action: str, units: int | None = None, ref: str | None = None, note: str = "", extra=None) -> dict:
    """Charge the user for `action`: `units` or config creditCosts[action], paid units first. With `ref` (the job, the
    unlock, the request id) it happens once: a repeat raises AlreadyDone. `extra`: transaction items (db.tx_*) that must
    be written with the charge, or a function (paid, bonus) -> items for records that keep the split.
    Raises Blocked, InsufficientCredits, AlreadyDone, or ValueError (unknown action, bad units).
    Returns {paid, bonus, amount, txKey}."""
    if not config.credits_on():
        raise ValueError("the credits module is off (BILLING_MODE)")
    cost = config.credit_cost(action) if units is None else units
    if cost is None:
        raise ValueError(f"no creditCosts entry for {action!r} (api/lib/config.py)")
    if isinstance(cost, bool) or not isinstance(cost, int) or cost <= 0:
        raise ValueError("units must be a whole number above zero")
    try:
        from lib import accounts
    except ImportError:
        from api.lib import accounts
    ok, why = accounts.can_spend(user_id)
    if not ok:
        raise Blocked(why)
    key = f"SPEND#{action}#{ref}" if ref else None
    return debit(user_id, cost, "spend", note or action.replace("_", " ").capitalize(), key=key, extra=extra, action=action, ref=ref)


def refund_spend(user_id: str, action: str, ref: str, reason: str = "") -> bool:
    """Give back what spend(user, action, ref=ref) took, each part to where it came from, once. False when there was no
    such spend or it was given back already."""
    tx = _table().get_item(Key={"pk": f"USER#{user_id}", "sk": f"TX#SPEND#{action}#{ref}"}).get("Item")
    if not tx:
        return False
    return credit(user_id, -int(tx.get("paid", 0)), -int(tx.get("bonus", 0)), "refund", f"Refund: {reason or tx.get('note', action)}",
                  f"REFUND#SPEND#{action}#{ref}", refundOf=f"SPEND#{action}#{ref}", action=action, ref=ref)


# ---- ledger primitives

def debit(user_id: str, amount: int, kind: str, note: str, key: str | None = None, extra=None,
          auto_reload: bool = True, bonus_first: bool = False, **refs) -> dict:
    """Take `amount` units, paid first, then bonus, in one transaction with the TX row and `extra`. Admin corrections
    pass auto_reload=False (a take the customer didn't make never charges their card) and bonus_first=True. Raises
    InsufficientCredits or AlreadyDone. Retries when the balance changed between the read and the write."""
    amount = int(amount)
    key = key or f"{now()}#{uuid.uuid4().hex[:8]}"
    for _ in range(4):
        p = profile(user_id)
        if "paidCredits" not in p or "bonusCredits" not in p:
            _ensure_fields(user_id)
            p = profile(user_id)
        bal = balance(p)
        if bal["credits"] < amount:
            raise InsufficientCredits(amount, bal["credits"])
        # a part below 0 (a card refund took more than was left) has nothing to give: never "spend" it
        have_paid, have_bonus = max(0, bal["paidCredits"]), max(0, bal["bonusCredits"])
        if bonus_first:
            b = min(have_bonus, amount)
            paid = amount - b
        else:
            paid = min(have_paid, amount)
            b = amount - paid
        # guard both parts at write time so a race can't take the net balance below 0: a part taken from must still
        # cover its take plus any debt on the other part; an untouched part may not sink below what was read
        guard = {":p": paid + max(0, -bal["bonusCredits"]) if paid > 0 else min(0, bal["paidCredits"]),
                 ":b": b + max(0, -bal["paidCredits"]) if b > 0 else min(0, bal["bonusCredits"])}
        tx = _tx_item(user_id, key, kind, -amount, -paid, -b, note, refs)
        items = [
            db.tx_put(tx, "attribute_not_exists(sk)"),
            db.tx_update(_profile_key(user_id), "ADD paidCredits :mp, bonusCredits :mb", {":mp": -paid, ":mb": -b, **guard},
                         cond="paidCredits >= :p AND bonusCredits >= :b"),
            *(extra(paid, b) if callable(extra) else extra or []),
        ]
        try:
            db.transact(items)
        except ClientError as e:
            codes = db.tx_cancelled(e)
            if codes is None:
                raise
            if codes and codes[0] == "ConditionalCheckFailed":
                raise AlreadyDone(key) from e
            if len(codes) > 2 and any(c == "ConditionalCheckFailed" for c in codes[2:]):
                raise AlreadyDone(key) from e
            continue  # the balance changed between read and write: read again
        out = {"paid": paid, "bonus": b, "amount": amount, "txKey": key}
        if auto_reload:
            try:  # under the customer's trigger: buy their auto reload pack (api/lib/autoreload.py)
                from lib import autoreload
            except ImportError:
                from api.lib import autoreload
            autoreload.after_spend(user_id, p, bal["credits"] - amount)
        return out
    raise RuntimeError("balance kept changing; try again")


def credit(user_id: str, paid: int, bonus: int, kind: str, note: str, key: str, extra: list[dict] | None = None, **refs) -> bool:
    """Add units once per `key`, in one transaction with `extra`. False if that key was used already or an `extra`
    condition failed."""
    tx = _tx_item(user_id, key, kind, int(paid) + int(bonus), paid, bonus, note, refs)
    items = [
        db.tx_put(tx, "attribute_not_exists(sk)"),
        db.tx_update(_profile_key(user_id), "ADD paidCredits :p, bonusCredits :b", {":p": int(paid), ":b": int(bonus)}),
        *(extra or []),
    ]
    try:
        db.transact(items)
        return True
    except ClientError as e:
        if "ConditionalCheckFailed" in (db.tx_cancelled(e) or []):
            return False
        raise


def grant(user_id: str, amount: int, kind: str, note: str, key: str, **refs) -> bool:
    """Bonus units (gifts, rewards, admin goodwill), once per key."""
    return credit(user_id, 0, int(amount), kind, note, key, **refs) if int(amount) > 0 else False


def take(user_id: str, paid: int, bonus: int, kind: str, note: str, key: str, extra: list[dict] | None = None, **refs) -> None:
    """Remove exactly `paid` and `bonus` units once per `key` (card refunds, forfeited bonus, dashboard refunds), in one
    transaction with `extra`, and only while each part still covers what is taken: never below 0, so a refund and a
    spend racing each other can't both have the same units. Raises Declined (see its codes)."""
    paid, bonus = int(paid), int(bonus)
    tx = _tx_item(user_id, key, kind, -(paid + bonus), -paid, -bonus, note, refs)
    floors = [c for c, n in (("paidCredits >= :p", paid), ("bonusCredits >= :b", bonus)) if n > 0]
    items = [
        db.tx_put(tx, "attribute_not_exists(sk)"),
        db.tx_update(_profile_key(user_id), "ADD paidCredits :mp, bonusCredits :mb",
                     {":mp": -paid, ":mb": -bonus, **({":p": paid} if paid > 0 else {}), **({":b": bonus} if bonus > 0 else {})},
                     cond=" AND ".join(floors) or None),
        *(extra or []),
    ]
    try:
        db.transact(items)
    except ClientError as e:
        codes = db.tx_cancelled(e)
        if codes is not None:
            raise Declined(codes) from e
        raise


def history(user_id: str, limit: int = 500) -> list[dict]:
    """The newest `limit` ledger rows, each with the balance after it. TX# keys aren't in time order, so read them all."""
    rows = db.query_all(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("TX#"))
    rows.sort(key=lambda t: t.get("at", ""))
    out, running = [], 0
    for t in rows:
        amount = int(t.get("amount", 0))
        running += amount
        out.append({"kind": t.get("kind"), "amount": amount, "paid": int(t.get("paid", 0)), "bonus": int(t.get("bonus", 0)),
                    "note": t.get("note", ""), "at": t.get("at"), "action": t.get("action"), "ref": t.get("ref"),
                    "paymentIntent": t.get("paymentIntent"), "balanceAfter": running,
                    "payCents": int(t["payCents"]) if t.get("payCents") is not None else None})
    return out[::-1][:limit]


# ---- optional earning hooks (config.BILLING: signupGift, dailyBonus, referral; 0 = off)

def signup_gift(user_id: str) -> bool:
    n = int(config.BILLING.get("signupGift") or 0)
    return grant(user_id, n, "signup_gift", f"Welcome gift: {fmt(n)}", "SIGNUP") if n > 0 else False


def daily_bonus(user_id: str, p: dict) -> int:
    """dailyBonus units once a UTC day, only while the account has a top-up still paid for (no alt-account farming)."""
    n = int(config.BILLING.get("dailyBonus") or 0)
    if n <= 0 or not p.get("hasToppedUp"):
        return 0
    day = today()
    if p.get("lastDailyBonus") == day:
        return 0
    if not db.conditional(_table().update_item, Key=_profile_key(user_id), UpdateExpression="SET lastDailyBonus = :d",
                          ConditionExpression="attribute_not_exists(lastDailyBonus) OR lastDailyBonus <> :d",
                          ExpressionAttributeValues={":d": day}):
        return 0
    return n if grant(user_id, n, "daily_bonus", "Daily visit bonus", f"DAILY#{day}") else 0


def hold(earner: str, amount: int, kind: str, note: str, purchase_ref: str, **refs) -> str | None:
    """A reward that waits HOLD_DAYS (the refund window of the payment behind it) before it can be spent."""
    if int(amount) <= 0:
        return None
    release = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=HOLD_DAYS)).isoformat()
    sk = f"PENDING#{release}#{uuid.uuid4().hex[:8]}"
    _table().put_item(Item={"pk": f"USER#{earner}", "sk": sk, "amount": int(amount), "kind": kind, "note": note[:200],
                            "purchaseRef": purchase_ref, "releaseAt": release, "at": now(),
                            **{k: v for k, v in refs.items() if v not in (None, "")}})
    return sk


def pending(user_id: str) -> list[dict]:
    return db.query_all(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PENDING#"))


def release_due(user_id: str) -> int:
    """Move rewards whose hold has passed into the balance (on account or wallet load). The hold row is deleted in the
    grant's own transaction, so a clawback (cancel_hold) racing the release can't have both happen."""
    total = 0
    for row in db.query_all(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").between("PENDING#", f"PENDING#{now()}")):
        amount = int(row["amount"])
        gone = db.tx_delete({"pk": row["pk"], "sk": row["sk"]}, "attribute_exists(sk)")
        if amount > 0 and credit(user_id, 0, amount, row["kind"], row.get("note", "Reward"), f"EARN#{row['sk'][8:]}", extra=[gone]):
            total += amount
        else:  # clawed back meanwhile, or granted before its row was deleted: the row just goes
            _table().delete_item(Key={"pk": row["pk"], "sk": row["sk"]})
    return total


def cancel_hold(earner: str, sk: str) -> bool:
    """Claw back a reward still on hold (its payment was refunded or disputed)."""
    return db.conditional(_table().delete_item, Key={"pk": f"USER#{earner}", "sk": sk}, ConditionExpression="attribute_exists(sk)")


# ---- referrals (off unless config.BILLING["referral"] has amounts)

def referrals_on() -> bool:
    r = config.BILLING.get("referral") or {}
    return int(r.get("referrer") or 0) > 0 or int(r.get("referred") or 0) > 0


def referral_code(user_id: str, p: dict) -> str:
    """Short code for invite links (?ref=CODE), created on first use."""
    if p.get("referralCode"):
        return p["referralCode"]
    for _ in range(5):
        code = uuid.uuid4().hex[:8]
        if not db.conditional(_table().put_item, Item={"pk": f"REFCODE#{code}", "sk": "REFCODE", "userId": user_id},
                              ConditionExpression="attribute_not_exists(pk)"):
            continue
        _table().update_item(Key=_profile_key(user_id), UpdateExpression="SET referralCode = :c", ExpressionAttributeValues={":c": code})
        return code
    raise RuntimeError("could not create a referral code")


def set_referrer(user_id: str, code: str) -> str:
    """Record who invited this account: only a new account (under 7 days) that has never topped up. Returns why not."""
    row = _table().get_item(Key={"pk": f"REFCODE#{code.strip().lower()}", "sk": "REFCODE"}).get("Item")
    if not row:
        return "Unknown invite code"
    referrer = row["userId"]
    if referrer == user_id:
        return "You can't invite yourself"
    p = profile(user_id)
    created = p.get("createdAt", "")
    # firstTopUpAt stays after a refund clears hasToppedUp: a refunded account can't add an inviter and top up again
    if p.get("hasToppedUp") or p.get("firstTopUpAt") or (created and created < (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()):
        return "Invite codes only work on new accounts"
    if not db.conditional(_table().update_item, Key=_profile_key(user_id), UpdateExpression="SET referredBy = :r",
                          ConditionExpression="attribute_not_exists(referredBy)", ExpressionAttributeValues={":r": referrer}):
        return "This account already has an inviter"
    return ""


def card_users(fingerprints) -> set[str]:
    """Every account that has paid with one of these cards."""
    users: set[str] = set()
    for fp in fingerprints or []:
        users |= {r["sk"].split("#", 1)[1] for r in db.query_all(KeyConditionExpression=Key("pk").eq(f"CARDFP#{fp}"))}
    return users


def same_card_circle(user_id: str, fingerprints, other: str) -> bool:
    """Could `other` be `user_id` by card? True when `other` paid with one of these cards, or an account `other` invited
    did (one card behind a chain of invited alts), or the card is behind more than 50 accounts."""
    fps = set(fingerprints or [])
    if fps & set(profile(other).get("cardFingerprints") or []):
        return True
    users = card_users(fps) - {user_id}
    if len(users) > 50:
        return True
    inviters = {p.get("referredBy") for p in db.batch_get([_profile_key(u) for u in users])}
    return other in users or other in inviters


def pay_referral(user_id: str, pi: str = "") -> str:
    """After a referred account's first top-up (payment `pi`): both rewards go on hold for HOLD_DAYS, and the hold is
    cancelled if that payment is refunded or disputed (payments.cancel_referral). Skipped for good when the friend's
    card was used by the inviter or by another account the inviter invited."""
    if not referrals_on():
        return ""
    p = profile(user_id)
    referrer = p.get("referredBy")
    if not referrer or p.get("referralPaid"):
        return ""
    if not db.conditional(_table().update_item, Key=_profile_key(user_id), UpdateExpression="SET referralPaid = :t",
                          ConditionExpression="attribute_not_exists(referralPaid)", ExpressionAttributeValues={":t": True}):
        return ""  # once, even when the webhook and the charge route both get here
    if same_card_circle(user_id, p.get("cardFingerprints"), referrer):
        return "referral skipped: same card as the inviter or an account they invited"
    cfg = config.BILLING["referral"]
    ref = f"TOPUP#{pi}"
    holds = [[referrer, hold(referrer, int(cfg.get("referrer") or 0), "referral", "A friend you invited joined", ref, friend=user_id)],
             [user_id, hold(user_id, int(cfg.get("referred") or 0), "referred", "Bonus for joining with an invite", ref, referrer=referrer)]]
    holds = [h for h in holds if h[1]]
    if pi and holds:  # so a refund or dispute of this payment can cancel them
        _table().update_item(Key={"pk": f"PAY#{pi}", "sk": "PAY"}, UpdateExpression="SET referralHolds = :h",
                             ExpressionAttributeValues={":h": holds})
    return f"referral held for {referrer}"

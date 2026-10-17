"""Payments, card refunds and disputes mirrored from Stripe (docs/payments.md).

  PAY#{pi} / PAY                  user, kind (topup | subscription), paid, credit, bonus, fee, net, card
                                  brand/last4/exp/country/fingerprint, risk level/score, receipt url, refundedCents,
                                  refundAttempts, disputed, status, referralHolds (rewards on hold from a first top-up)
  PAY#{pi} / REFUND#{re}          amount, reason, actor, status
  PAY#{pi} / DISPUTE#{dp}         amount, reason, status, evidence due
  USER#uid / PAYREF#{ts}#{pi}     payments per user (newest first)
  USER#uid / REFUNDPENDING#{pi}#{n}  a card refund whose units are reserved and Stripe hasn't confirmed yet (reconcile)
  REFUNDPENDING / {uid}#{pi}#{n}  every such refund, for sweep_pending (the PaymentsSweep schedule, every 15 minutes)
  PAYDAY#{day} / {ts}#{pi}        payments per day (admin Payments tab)
  CARDFP#{fingerprint} / USER#{uid}  accounts that paid with a card (credits.same_card_circle)

Card refunds take the units first: one transaction takes them off the balance (never below 0), counts them on the
payment and writes the pending row; only then is Stripe asked, with a deterministic idempotency key
(yourapp-refund-{pi}-{attempt}). A refusal gives the units back; no answer (timeout) leaves the row for reconcile,
which asks again with the same key.

Refund policies: "window" is the customer's own (unspent paid units of top-ups made in the last refundDays, newest
first, a spent pack bonus deducted); "all" is for bans and admins (any unspent paid units, newest payment first). The
pack bonus goes with the paid units it came with.

Admin-callable (phase 3 routes): get, detail, for_user, by_day, breakdown, refundable, refund_to_card, adjust_balance,
sweep_pending.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
import uuid

from boto3.dynamodb.conditions import Key

try:
    from lib import config, db, logs, credits, mail, notes, stripe_config
    from lib.i18n import Text
except ImportError:
    from api.lib import config, db, logs, credits, mail, notes, stripe_config
    from api.lib.i18n import Text

log = logging.getLogger("yourapp.payments")
PENDING_AFTER_S = 60  # a reserved refund older than this lost its request (the API Lambda stops at 30 s): reconcile it
PENDING_INDEX = "REFUNDPENDING"  # REFUNDPENDING / {uid}#{pi}#{attempt}: every reserved card refund, for sweep_pending
REPLAY_S = 20 * 3600  # Stripe keeps an idempotency key's answer for 24 hours; after that, look the refund up instead


class RefundError(Exception):
    pass


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _table():
    return db._get_table()


def _profile(user_id: str) -> dict:
    return _table().get_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}).get("Item") or {}


def get(pi: str) -> dict | None:
    return _table().get_item(Key={"pk": f"PAY#{pi}", "sk": "PAY"}).get("Item")


def for_user(user_id: str, limit: int = 100) -> list[dict]:
    """The user's payment records, newest first (their PAYREF# order), read in one batch."""
    refs = _table().query(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PAYREF#"),
                          ScanIndexForward=False, Limit=limit).get("Items", [])
    keys = [{"pk": f"PAY#{r['paymentIntent']}", "sk": "PAY"} for r in refs]
    found = {p["pk"]: p for p in db.batch_get(keys)}
    return [found[k["pk"]] for k in keys if k["pk"] in found]


def topups(user_id: str, limit: int = 200) -> list[dict]:
    """The user's credit top-ups (not subscription payments), newest first: what card refunds of units work on."""
    return [x for x in for_user(user_id, limit) if x.get("kind", "topup") == "topup"]


def detail(pi: str) -> dict | None:
    """A payment with its refunds and disputes (admin)."""
    rows = db.query_all(KeyConditionExpression=Key("pk").eq(f"PAY#{pi}"))
    pay = next((r for r in rows if r["sk"] == "PAY"), None)
    if not pay:
        return None
    return {**pay, "refunds": [r for r in rows if r["sk"].startswith("REFUND#")],
            "disputes": [r for r in rows if r["sk"].startswith("DISPUTE#")]}


def by_day(day: str, limit: int = 200) -> list[dict]:
    """One UTC day's payments (YYYY-MM-DD), newest first, with their records (admin Payments tab)."""
    rows = _table().query(KeyConditionExpression=Key("pk").eq(f"PAYDAY#{day}"), ScanIndexForward=False, Limit=limit).get("Items", [])
    found = {p["pk"]: p for p in db.batch_get([{"pk": f"PAY#{r['paymentIntent']}", "sk": "PAY"} for r in rows])}
    return [found[f"PAY#{r['paymentIntent']}"] for r in rows if f"PAY#{r['paymentIntent']}" in found]


def ensure_customer(sc, user_id: str, email: str = "") -> str:
    """One Stripe customer per user (receipts, saved cards, subscriptions), created once (idempotency key per user)."""
    p = _profile(user_id)
    if p.get("stripeCustomerId"):
        return p["stripeCustomerId"]
    key = stripe_config.idem("customer", user_id)
    params = {"email": email or p.get("email") or None, "metadata": {"userId": user_id}}
    if params["email"] and "@" not in params["email"]:
        params["email"] = None
    customer = logs.stripe_call("customers.create", lambda: sc.v1.customers.create(params=params, options={"idempotency_key": key}),
                                params, user_id=user_id, idempotency_key=key)
    _table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="SET stripeCustomerId = :c",
                         ExpressionAttributeValues={":c": customer.id})
    return customer.id


def has_details(pay: dict) -> bool:
    """The payment record carries its charge details (record_payment got them from Stripe)."""
    return bool(pay.get("detailsAt") or pay.get("chargeId"))


def _pack_bonus(pay: dict) -> int:
    """The bonus credits the payment's pack came with."""
    return int(pay.get("bonusCredits", pay.get("bonusCents", 0)))


def _unrefunded(pay: dict) -> int:
    """What is still paid for on a payment (cents): nothing once it is disputed."""
    return 0 if pay.get("disputed") else max(0, int(pay["paidCents"]) - int(pay.get("refundedCents", 0)))


def _base(session: dict, credit: int, paid: int, created: str) -> dict:
    """A payment record's own fields (set once; refunds and disputes change refundedCents / disputed later)."""
    meta = session.get("metadata") or {}
    refund_until = (dt.datetime.fromisoformat(created) + dt.timedelta(days=credits.REFUND_DAYS)).isoformat()
    return {"userId": meta["userId"], "kind": "topup", "packId": meta.get("packId"), "paidCents": int(paid), "credits": int(credit),
            "bonusCredits": int(credit) - int(paid), "refundUntil": refund_until, "feeCents": 0, "netCents": int(paid),
            "refundedCents": 0, "disputed": False, "status": "succeeded", "createdAt": created,
            "checkoutSession": session.get("id"), "customer": session.get("customer")}


def _fill_in(fields: dict) -> tuple[str, dict, dict]:
    """(UpdateExpression, names, values) that set these fields only where missing: never resets a refund or dispute."""
    fields = {k: v for k, v in fields.items() if v is not None}
    names = {f"#f{i}": k for i, k in enumerate(fields)}
    values = {f":f{i}": v for i, v in enumerate(fields.values())}
    return "SET " + ", ".join(f"#f{i} = if_not_exists(#f{i}, :f{i})" for i in range(len(fields))), names, values


def _index_rows(user_id: str, pi_id: str, created: str, paid: int, kind: str = "topup") -> list[dict]:
    """The payment's listing rows: per user (PAYREF#, the wallet and refunds) and per day (PAYDAY#, the admin tab)."""
    return [{"pk": f"USER#{user_id}", "sk": f"PAYREF#{created}#{pi_id}", "paymentIntent": pi_id},
            {"pk": f"PAYDAY#{created[:10]}", "sk": f"{created}#{pi_id}", "paymentIntent": pi_id, "userId": user_id,
             "kind": kind, "paidCents": int(paid)}]


def payment_items(session: dict, credit: int, paid: int, created: str) -> list[dict]:
    """The payment's records, for the same transaction as its credit: a dispute or a dashboard refund always finds PAY#,
    and the customer always sees the purchase (and can refund it), even when the process dies right after the credit.
    record_payment adds the card and fee details."""
    user_id, pi_id = (session.get("metadata") or {})["userId"], session.get("payment_intent")
    expr, names, values = _fill_in(_base(session, credit, paid, created))
    return [db.tx_update({"pk": f"PAY#{pi_id}", "sk": "PAY"}, expr, values, names=names),
            *(db.tx_put(row) for row in _index_rows(user_id, pi_id, created, paid))]


def record_payment(session: dict, credit: int, paid: int) -> dict:
    """After a top-up is credited: pull the charge details from Stripe onto its payment record. Safe to run again: a
    retry fills in what a failed first run left out (detailsAt marks a complete record) and never resets a refund or a
    dispute already recorded."""
    meta = session.get("metadata") or {}
    user_id, pi_id = meta["userId"], session.get("payment_intent")
    card, details = {}, {}
    try:
        sc = stripe_config.client()
        pi = logs.stripe_call("payment_intents.retrieve", lambda: sc.v1.payment_intents.retrieve(
            pi_id, params={"expand": ["latest_charge.balance_transaction"]}), {"id": pi_id}, user_id=user_id)
        ch = pi.latest_charge
        charge_id = ch.id
        c = ch.payment_method_details.card if ch.payment_method_details and ch.payment_method_details.type == "card" else None
        if c:
            card = {"brand": c.brand, "last4": c.last4, "expMonth": c.exp_month, "expYear": c.exp_year, "country": c.country,
                    "funding": c.funding, "fingerprint": c.fingerprint}
        risk, money = {}, {}  # a charge without an outcome or a settled balance transaction is still recorded (its card
        if ch.outcome:        # above all: the same-card and banned-card checks read it); the fee stays 0 until known
            risk = {"level": ch.outcome.risk_level, "score": ch.outcome.risk_score, "networkStatus": ch.outcome.network_status}
        bt = ch.balance_transaction
        if bt and not isinstance(bt, str):
            money = {"feeCents": int(bt.fee), "netCents": int(bt.net)}
        receipt = ch.receipt_url or ""
        details = {"chargeId": charge_id, "card": card, "risk": risk, **money, "receiptUrl": receipt, "detailsAt": _now()}
    except Exception:  # noqa: BLE001 - the credit already happened; a later retry (webhook, charge page) fills them in
        log.exception("could not load charge details for %s", pi_id)
    # the base fields and listing rows are what the credit's transaction wrote (filled in only where missing, the same
    # keys again): they matter only for test-stage payments credited before that transaction carried them
    base = {k: v for k, v in _base(session, credit, paid, _now()).items() if k not in details}
    expr, names, values = _fill_in(base)
    for i, (k, v) in enumerate(details.items()):
        expr += f", #d{i} = :d{i}"
        names[f"#d{i}"], values[f":d{i}"] = k, v
    t = _table()
    item = t.update_item(Key={"pk": f"PAY#{pi_id}", "sk": "PAY"}, UpdateExpression=expr, ExpressionAttributeNames=names,
                         ExpressionAttributeValues=values, ReturnValues="ALL_NEW")["Attributes"]
    created = item["createdAt"]
    for row in _index_rows(user_id, pi_id, created, paid):
        t.put_item(Item=row)
    fp = card.get("fingerprint")
    if fp:
        t.update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="ADD cardFingerprints :f",
                      ExpressionAttributeValues={":f": {fp}})
        t.put_item(Item={"pk": f"CARDFP#{fp}", "sk": f"USER#{user_id}", "at": created})
        _flag_banned_card(user_id, fp, pi_id)
    return item


def _flag_banned_card(user_id: str, fingerprint: str, pi_id: str) -> None:
    try:
        from lib import accounts
    except ImportError:
        from api.lib import accounts
    hit = accounts.card_is_banned(fingerprint)
    if hit and hit.get("userId") != user_id:
        logs.audit("system", "card.banned_card_used", f"user:{user_id}",
                   f"card used by banned user {hit.get('userId')}", after={"paymentIntent": pi_id})
        mail.to_admin("A banned card was used", f"User {user_id} topped up with a card that belongs to banned user "
                      f"{hit.get('userId')} (payment {pi_id}). Review them in the admin Users tab.")


def _eligible(user_id: str, policy: str) -> list[dict]:
    """Payments that can still be refunded, newest first ("window" = within 14 days of the top-up)."""
    cutoff = _now()
    return [x for x in topups(user_id)
            if _unrefunded(x) > 0 and (policy == "all" or x.get("refundUntil", x.get("createdAt", "")) > cutoff)]


def _plan(user_id: str, policy: str) -> list[tuple[dict, int, int, int]]:
    """The payments a card refund can take from, in the order it takes them: (payment, the most it takes from it, its
    pack bonus still there, what a pro-rata share of that bonus is counted on). "window" follows breakdown purchase by
    purchase (a spent pack bonus comes off); "all" is every unrefunded, undisputed payment, newest first."""
    if policy == "window":
        return [(r["_pay"], r["refundable"], r["bonusNow"], r["refundable"]) for r in breakdown(user_id) if r["refundable"] > 0]
    return [(pay, _unrefunded(pay), _pack_bonus(pay), int(pay["paidCents"])) for pay in _eligible(user_id, policy)]


def refundable(user_id: str, policy: str = "window", plan: list[tuple] | None = None) -> dict:
    """What can go back to the card now (1 paid unit = 1 cent). "window" = the customer's rule (14 days, spent pack
    bonus deducted: see breakdown); "all" = admin and bans (any unused paid credits). `plan`: _plan's answer, when the
    caller has it already."""
    bal = credits.balance(_profile(user_id))
    left = sum(most for _, most, _, _ in (_plan(user_id, policy) if plan is None else plan))
    if policy == "window":
        return {"refundable": left, **bal, "policy": policy}
    return {"refundable": min(bal["paidCredits"], left), **bal, "chargesRemainingCents": left, "policy": policy}


def _all_tx(user_id: str) -> list[dict]:
    rows, kwargs = [], {"KeyConditionExpression": Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("TX#")}
    while True:
        page = _table().query(**kwargs)
        rows += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return sorted(rows, key=lambda t: t.get("at", ""))


SPEND_KINDS = {"spend", "adjustment"}  # ledger kinds that use paid units (credits.spend and admin corrections)


def _lots(user_id: str, pays: list[dict], paid_now: int) -> list[dict]:
    """Replay the ledger to see which purchase's paid credits each spend used .

    Paid credits are spent before any bonus, and they are used oldest purchase first, so newer purchases stay whole until
    older ones run out. Credits returned to the balance (a cancelled request, a purged image) go back to where they were
    taken from, latest first. Card refunds take what they refunded out of their own purchase."""
    index = {x["pk"].split("#", 1)[1]: i for i, x in enumerate(pays)}
    lots = [{"left": 0, "used": 0, "refunded": 0, "bonusRemoved": 0, "lines": {}} for _ in pays]
    stack: list[list] = []  # [lot, amount] in the order paid credits were used

    def line(i: int, t: dict, amount: int) -> None:
        d = lots[i]["lines"].setdefault(t.get("sk"), {"at": t.get("at"), "kind": t.get("kind"), "note": t.get("note", ""),
                                                     "imageId": t.get("imageId"), "amount": 0})
        d["amount"] += amount

    for t in _all_tx(user_id):
        kind, paid, bonus, pi = t.get("kind"), int(t.get("paid", 0)), int(t.get("bonus", 0)), t.get("paymentIntent")
        if kind == "topup":
            if pi in index:
                lots[index[pi]]["left"] += paid
            continue
        if t.get("cardRefundBack"):  # a card refund Stripe refused or that failed later: its credits are back in that purchase
            if pi in index:
                lot = lots[index[pi]]
                lot["left"] += paid
                lot["refunded"] -= paid
                lot["bonusRemoved"] -= bonus
                line(index[pi], t, -paid)
            continue
        if kind in ("refund_card", "refund_external") and pi in index:
            lot = lots[index[pi]]
            out = min(lot["left"], -paid)
            lot["left"] -= out
            lot["refunded"] += out
            lot["bonusRemoved"] += max(0, -bonus)
            if out:
                line(index[pi], t, out)
            continue
        if kind in ("refund", "creator_refund") and paid > 0:  # paid credits back to the balance: undo the latest use first
            back = paid
            while back > 0 and stack:
                where, used = stack[-1]
                give = min(back, used)
                back -= give
                stack[-1][1] -= give
                lots[where]["left"] += give
                lots[where]["used"] -= give
                line(where, t, -give)
                if stack[-1][1] <= 0:
                    stack.pop()
            continue
        if kind in SPEND_KINDS and paid < 0:
            need = -paid
            for i, lot in enumerate(lots):
                if need <= 0:
                    break
                use = min(lot["left"], need)
                if use <= 0:
                    continue
                lot["left"] -= use
                lot["used"] += use
                need -= use
                stack.append([i, use])
                line(i, t, use)
    # anything older the ledger can't itemise: settle it against the oldest purchases
    extra = sum(l["left"] for l in lots) - paid_now
    for lot in lots:
        if extra <= 0:
            break
        use = min(lot["left"], extra)
        if use > 0:
            lot["left"] -= use
            lot["used"] += use
            lot["lines"]["~earlier"] = {"at": None, "kind": "other", "note": "Earlier balance changes", "imageId": None, "amount": use}
            extra -= use
    return lots


def breakdown(user_id: str) -> list[dict]:
    """Every credit purchase, newest first, with what can still go back to its card :
      - Paid credits are spent before bonus, oldest purchase first, so the oldest one with anything left may be partial.
      - What's refundable is that purchase's unused paid credits; its pack bonus is never paid out and is removed.
        E.g. $20 for 2,000 + 200 bonus with 500 spent: $15 back, and the 200 bonus goes.
      - Only from an hour after buying (security: the payment clears first) until 14 days after, not disputed, and not
        after the card was removed.
      - A pack bonus that is no longer in the balance was spent, so it comes off that purchase's refund. Paid-first
        spending alone doesn't ensure it: paid credits can come back after the bonus was spent (a rejected or cancelled
        Studio request, a purge), and the bonus spent meanwhile must not become cash. The bonus balance goes to
        purchases newest first, each up to its own pack bonus; bonusNow is the part that is still there (and is removed
        with the refund). Rows keep their payment record under `_pay` (public_rows drops it)."""
    p = _profile(user_id)
    bal = credits.balance(p)
    pays = sorted(topups(user_id), key=lambda x: x.get("createdAt", ""))
    lots = _lots(user_id, pays, bal["paidCredits"])
    removed = p.get("removedCards") or {}  # card fingerprint -> when the customer removed it (no refunds to it after that)
    now = _now()
    cleared_before = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=credits.REFUND_HOLD_MINUTES)).isoformat()
    kept, avail = {}, max(0, bal["bonusCredits"])
    for x, lot in reversed(list(zip(pays, lots))):
        still = max(0, _pack_bonus(x) - lot["bonusRemoved"])
        kept[x["pk"]] = min(avail, still)
        avail -= kept[x["pk"]]
    rows = []
    for x, lot in zip(pays, lots):
        paid_cents = int(x["paidCents"])
        bonus = _pack_bonus(x)
        spent_bonus = min(lot["left"], max(0, bonus - lot["bonusRemoved"]) - kept[x["pk"]])
        if spent_bonus > 0:
            lot["lines"]["~bonus"] = {"at": None, "kind": "bonus_forfeited", "imageId": None, "amount": spent_bonus,
                                      "note": "The pack's bonus was already spent, so it comes off the refund"}
        left = lot["left"] - max(0, spent_bonus)
        cash = max(0, min(left, paid_cents - int(x.get("refundedCents", 0))))
        in_window = x.get("refundUntil", x.get("createdAt", "")) > now
        fp = (x.get("card") or {}).get("fingerprint")
        card_gone = bool(fp) and fp in removed and removed[fp] > x.get("createdAt", "")
        clearing = x.get("createdAt", "") > cleared_before
        reason = ("disputed" if x.get("disputed") else "refunded" if lot["left"] == 0 and lot["refunded"] > 0 else
                  "used" if cash == 0 else "card removed" if card_gone else "older than 14 days" if not in_window else
                  "clearing" if clearing else "")
        created = x.get("createdAt")
        refundable_from = ((dt.datetime.fromisoformat(created) + dt.timedelta(minutes=credits.REFUND_HOLD_MINUTES)).isoformat()
                           if created else None)
        rows.append({
            "paymentIntent": x["pk"].split("#", 1)[1], "createdAt": x.get("createdAt"), "refundUntil": x.get("refundUntil"),
            "card": {k: (x.get("card") or {}).get(k) for k in ("brand", "last4")}, "paidCents": paid_cents,
            "credits": paid_cents + bonus, "bonusCredits": bonus, "bonusNow": kept[x["pk"]],
            "refundedCents": int(x.get("refundedCents", 0)), "left": left, "usedCredits": lot["used"],
            "refundable": cash if not reason else 0, "partial": not reason and lot["used"] > 0,
            "reason": reason, "refundableFrom": refundable_from, "clearingCents": cash if reason == "clearing" else 0,
            "deductions": [d for d in lot["lines"].values() if d["amount"] != 0], "_fingerprint": fp, "_pay": x,
        })
    return list(reversed(rows))


def public_rows(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]


def refund_selected(user_id: str, payment_intents: list[str], actor: str, note: str = "") -> dict:
    """The customer's refund from the Refund dialog. Chosen purchases must run from the newest refundable one down,
    without gaps. Each gives back its unused paid credits; its pack bonus is removed from the balance."""
    reconcile(user_id)
    rows = [r for r in breakdown(user_id) if r["refundable"] > 0]
    chosen = set(payment_intents)
    if not chosen or not chosen <= {r["paymentIntent"] for r in rows}:
        raise RefundError("Pick purchases that can still be refunded")
    n = len(chosen)
    if {r["paymentIntent"] for r in rows[:n]} != chosen:
        raise RefundError("Choose purchases from the newest one down, without skipping any")
    reason = "Requested by the customer" + (f": {note.strip()[:400]}" if note.strip() else "")
    done, total = [], 0
    try:
        for r in rows[:n]:
            cash, bonus_out = r["refundable"], r["bonusNow"]
            note_text = f"Refunded {credits.usd(cash)} to card" + (f"; the pack's {bonus_out:,} bonus was removed" if bonus_out else "")
            out = _send(user_id, _reserve(user_id, r["_pay"], cash, bonus_out, reason, actor, note_text))
            done.append(out)
            total += cash
    finally:
        if done:
            logs.audit(actor, "refund.card", f"user:{user_id}", reason, after={"refunded": total, "refunds": done})
    return {"refunded": total, "refunds": done}


def refund_to_card(user_id: str, amount: int | None, reason: str, actor: str, policy: str = "window",
                   forfeit_bonus: bool = False) -> dict:
    """Refund `amount` paid credits (None = everything refundable) to the user's cards, newest payment first.
    The unspent bonus that came with each refunded payment is removed with it; `forfeit_bonus` removes all bonus (bans).
    "window" follows the customer's rules purchase by purchase (breakdown: a spent pack bonus comes off)."""
    reconcile(user_id)
    plan = _plan(user_id, policy)
    info = refundable(user_id, policy, plan)
    cap = info["refundable"]
    amount = cap if amount is None else int(amount)
    if amount <= 0 and not (forfeit_bonus and cap <= 0):  # a ban with nothing to refund still forfeits the bonus
        raise RefundError("Nothing to refund" if cap <= 0 else "Enter an amount above zero")
    if amount > cap:
        values = {"amount": credits.fmt(cap), "usd": credits.usd(cap)}
        if policy == "window":
            raise RefundError(Text("At most {amount} ({usd}) can be refunded to the card; paid {unit} are refundable for {days} "
                                   "days after their top-up", unit=credits.unit_name(), days=credits.REFUND_DAYS, **values))
        raise RefundError(Text("At most {amount} ({usd}) can be refunded to the card", **values))
    left, done, bonus_out, refunded, failed = amount, [], 0, 0, None
    try:
        for pay, most, pack_bonus, base in plan:
            if left <= 0:
                break
            take = min(most, left)
            # the pack bonus goes with its paid credits, pro rata, as far as it is still unspent
            bonus_now = max(0, credits.balance(_profile(user_id))["bonusCredits"])
            whole = take >= most or amount >= cap  # all that was left: the whole pack bonus goes too
            forfeit = 0 if forfeit_bonus else min(bonus_now, pack_bonus if whole else pack_bonus * take // max(1, base))
            try:
                out = _send(user_id, _reserve(user_id, pay, take, forfeit, reason, actor, f"Refunded {credits.usd(take)} to card ({reason})"))
            except RefundError as e:  # refused (the credits are back) or the balance moved: stop here, a ban still takes the bonus
                failed = e
                break
            bonus_out += forfeit
            refunded += take
            done.append(out)
            left -= take
        if forfeit_bonus:
            bonus_out += _forfeit_bonus(user_id)
    finally:
        logs.audit(actor, "refund.card", f"user:{user_id}", reason, before=info,
                   after={"refunded": refunded, "bonusRemoved": bonus_out, "refunds": done, "error": str(failed) if failed else None})
    if failed:
        raise failed
    return {"refunded": refunded, "bonusRemoved": bonus_out, "refunds": done}


def _forfeit_bonus(user_id: str) -> int:
    """Remove every bonus credit (a ban), never below 0 even while the user is spending. Returns what was removed."""
    for _ in range(4):
        bonus = credits.balance(_profile(user_id))["bonusCredits"]
        if bonus <= 0:
            return 0
        try:
            credits.take(user_id, 0, bonus, "bonus_forfeited", f"Bonus {credits.unit_name()} removed",
                         f"FORFEIT#{_now()}#{uuid.uuid4().hex[:6]}")
            return bonus
        except credits.Declined:
            continue  # spent meanwhile: read again
    return 0


# ---- card refunds: reserve, ask Stripe, settle

def _reserve(user_id: str, pay: dict, cash: int, bonus_out: int, reason: str, actor: str, note_text: str) -> dict:
    """Take a card refund's credits (and the pack bonus going with it) off the balance and count them on the payment,
    in one transaction, BEFORE Stripe is asked: a second refund request or a spend meanwhile finds them gone. The
    attempt number (refundAttempts on the payment) makes the ledger key and Stripe's idempotency key deterministic, so
    two requests can't both reserve the same purchase and the same attempt can be asked again safely. Returns the
    pending row. Raises RefundError."""
    if not pay.get("pk") or int(cash) <= 0:
        raise RefundError("Pick purchases that can still be refunded")
    pi = pay["pk"].split("#", 1)[1]
    n = int(pay.get("refundAttempts", 0))
    row = {"pk": f"USER#{user_id}", "sk": f"REFUNDPENDING#{pi}#{n}", "paymentIntent": pi, "attempt": n,
           "amountCents": int(cash), "bonusRemoved": int(bonus_out), "idempotencyKey": stripe_config.idem("refund", pi, n),
           "txKey": f"REFUNDCARD#{pi}#{n}", "reason": reason[:500], "actor": actor, "at": _now(), "atS": int(time.time())}
    counted = db.tx_update({"pk": f"PAY#{pi}", "sk": "PAY"}, "SET refundAttempts = :next ADD refundedCents :c",
                           {":next": n + 1, ":c": int(cash), ":f": False, ":most": int(pay["paidCents"]) - int(cash),
                            **({":n": n} if n else {})},
                           cond=("attribute_not_exists(refundAttempts)" if n == 0 else "refundAttempts = :n")
                           + " AND (attribute_not_exists(disputed) OR disputed = :f)"
                           + " AND (attribute_not_exists(refundedCents) OR refundedCents <= :most)")
    listed = db.tx_put({"pk": PENDING_INDEX, "sk": f"{user_id}#{pi}#{n}", "userId": user_id, "pendingSk": row["sk"], "at": row["at"]})
    try:
        credits.take(user_id, cash, bonus_out, "refund_card", note_text, row["txKey"],
                     extra=[counted, db.tx_put(row, "attribute_not_exists(sk)"), listed], paymentIntent=pi, refundAttempt=n)
    except credits.Declined as e:
        if len(e.codes) > 1 and e.codes[1] == "ConditionalCheckFailed":
            raise RefundError("Your balance changed while this was being refunded. Open the refund dialog again.") from e
        raise RefundError("This purchase is already being refunded, or it can't be refunded any more") from e
    return row


def _refund_params(user_id: str, row: dict) -> dict:
    """The same request every time for one attempt (Stripe refuses a key reused with other parameters)."""
    return {"payment_intent": row["paymentIntent"], "amount": int(row["amountCents"]), "reason": "requested_by_customer",
            "metadata": {"appRefund": "1", "appRefundKey": row["idempotencyKey"], "userId": user_id, "actor": row["actor"],
                         "reason": row["reason"][:400]}}


def _refused(e: Exception) -> bool:
    """Stripe answered no (a 4xx that isn't a conflict, a rate limit or a key clash): nothing was refunded, so the credits
    can go back. A timeout, a network error, a 5xx or anything unexpected may have refunded: that stays pending."""
    import stripe

    status = getattr(e, "http_status", None) or 0
    return (isinstance(e, stripe.StripeError)
            and not isinstance(e, (stripe.APIConnectionError, stripe.RateLimitError, stripe.IdempotencyError))
            and 400 <= int(status) < 500 and int(status) not in (409, 429) and getattr(e, "code", "") != "idempotency_key_in_use")


def _send(user_id: str, row: dict) -> dict:
    """Ask Stripe for a reserved refund and settle it. Asking again (reconcile) sends the same idempotency key, so Stripe
    answers with the first refund instead of making a second. A refusal gives the credits back (RefundError); no
    answer leaves the refund pending (status "pending", credits still reserved) for reconcile."""
    sc = stripe_config.client()
    params, key = _refund_params(user_id, row), row["idempotencyKey"]
    out = {"paymentIntent": row["paymentIntent"], "amountCents": int(row["amountCents"]), "bonusRemoved": int(row["bonusRemoved"])}
    try:
        re = logs.stripe_call("refunds.create", lambda: sc.v1.refunds.create(params=params, options={"idempotency_key": key}),
                              params, user_id=user_id, actor=row["actor"], idempotency_key=key)
    except Exception as e:  # noqa: BLE001 - sorted by _refused
        if not _refused(e):
            log.exception("card refund %s: no answer from Stripe; it stays pending", key)
            return {**out, "refundId": None, "status": "pending"}
        _give_back(user_id, row, f"{type(e).__name__}: {e}"[:300])
        raise RefundError(Text("The refund to your card didn't go through, so the {unit} are back in your balance. Try again later.",
                               unit=credits.unit_name())) from e
    _finish(user_id, row, re.id, re.status)
    return {**out, "refundId": re.id, "status": re.status}


def _finish(user_id: str, row: dict, refund_id: str, status: str) -> None:
    """Stripe made the refund: record it on the payment and clear the pending row, once."""
    pi = row["paymentIntent"]
    try:
        db.client().transact_write_items(TransactItems=[
            db.tx_delete({"pk": row["pk"], "sk": row["sk"]}, "attribute_exists(sk)"),
            db.tx_put({"pk": f"PAY#{pi}", "sk": f"REFUND#{refund_id}", "amountCents": int(row["amountCents"]), "status": status,
                       "reason": row["reason"], "actor": row["actor"], "at": _now(), "userId": user_id,
                       "bonusRemoved": int(row["bonusRemoved"]), "txKey": row["txKey"]}),
            db.tx_update({"pk": f"USER#{user_id}", "sk": f"TX#{row['txKey']}"}, "SET refundId = :r", {":r": refund_id}),
        ])
    except Exception as e:
        if db.tx_cancelled(e) is not None:
            return  # settled already (another request finished or gave it back)
        raise
    _payment_reversed(user_id, get(pi) or {})


def _credit_back(user_id: str, pi: str, cash: int, bonus: int, key: str, refund_of: str | None, extra: list[dict]) -> bool:
    """A card refund that didn't reach the card: its credits and pack bonus go back to the balance and the payment's
    refunded amount back down, once per `key`, in one transaction with `extra`. The ledger line's cardRefundBack and
    refundOf are what _lots reads to put the credits back into their purchase. False if already done."""
    back = credits.credit(user_id, int(cash), int(bonus), "refund", "Card refund didn't go through: the units are back", key,
                          extra=[db.tx_update({"pk": f"PAY#{pi}", "sk": "PAY"}, "ADD refundedCents :m", {":m": -int(cash)}), *extra],
                          paymentIntent=pi, cardRefundBack=True, refundOf=refund_of)
    if back:  # the payment is paid for again
        refresh_topped_up(user_id)
    return back


def _give_back(user_id: str, row: dict, why: str) -> bool:
    """A reserved refund didn't happen: its credits and pack bonus go back, once (the pending row goes in the same
    transaction)."""
    pi = row["paymentIntent"]
    back = _credit_back(user_id, pi, row["amountCents"], row["bonusRemoved"], f"REFUNDBACK#{pi}#{row['attempt']}", row["txKey"],
                        [db.tx_delete({"pk": row["pk"], "sk": row["sk"]}, "attribute_exists(sk)")])
    if back:
        logs.audit("system", "refund.card_failed", f"user:{user_id}", why,
                   after={"paymentIntent": pi, "amountCents": int(row["amountCents"]), "attempt": int(row["attempt"])})
    return back


def reconcile(user_id: str) -> int:
    """Settle card refunds whose request died after their credits were reserved (Lambda timeout, Stripe outage; A3): ask Stripe again with the same idempotency key, or after REPLAY_S look the refund up by that key (no match:
    it never happened, the credits go back). Runs when the wallet or the refund dialog loads and before a new refund.
    Returns how many were settled."""
    settled = 0
    for row in db.query_all(KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("REFUNDPENDING#")):
        age = time.time() - int(row.get("atS", 0))
        if age < PENDING_AFTER_S:
            continue  # its own request may still be running
        try:
            if age < REPLAY_S:
                settled += _send(user_id, row)["status"] != "pending"
            else:
                settled += _look_up(user_id, row)
        except RefundError:
            settled += 1  # Stripe refused it: the credits are back
        except Exception:  # noqa: BLE001 - never fail a wallet load over it; the next load tries again
            log.exception("reconcile %s %s", user_id, row["sk"])
    return settled


def sweep_pending(budget_s: float = 240) -> dict:
    """reconcile for every user with a card refund still pending (PENDING_INDEX), for a scheduled Lambda (none is deployed
    yet: until then reconcile runs when that customer opens the wallet or the refund dialog, or an admin refunds them).
    Safe at any time and next to wallet loads: each refund settles once. A listing row goes once its pending row is gone.
    Stops after `budget_s` with {more: true}: call again."""
    started = time.monotonic()
    by_user: dict[str, list[dict]] = {}
    for r in db.query_all(KeyConditionExpression=Key("pk").eq(PENDING_INDEX)):
        by_user.setdefault(r["userId"], []).append(r)
    out = {"users": 0, "settled": 0, "stillPending": 0, "more": False}
    t = _table()
    for uid, rows in by_user.items():
        if time.monotonic() - started > budget_s:
            out["more"] = True
            break
        out["users"] += 1
        out["settled"] += reconcile(uid)
        for r in rows:
            if t.get_item(Key={"pk": f"USER#{uid}", "sk": r["pendingSk"]}).get("Item"):
                out["stillPending"] += 1
            else:
                t.delete_item(Key={"pk": PENDING_INDEX, "sk": r["sk"]})
    return out


def _look_up(user_id: str, row: dict) -> bool:
    """Too old to ask again: find the refund Stripe made for this attempt (metadata appRefundKey) and settle it."""
    sc = stripe_config.client()
    params = {"payment_intent": row["paymentIntent"], "limit": 100}
    found = logs.stripe_call("refunds.list", lambda: sc.v1.refunds.list(params=params), params, user_id=user_id).data
    mine = next((r for r in found if ((getattr(r, "metadata", None) or {}).get("appRefundKey")) == row["idempotencyKey"]), None)
    if mine is not None and mine.status != "failed":
        _finish(user_id, row, mine.id, mine.status)
        return True
    return _give_back(user_id, row, "refund not found at Stripe after a day" if mine is None else "refund failed at Stripe")


class AdjustError(RefundError):
    """A correction larger than the balance (a RefundError, so the admin route answers 400 with the message)."""


def adjust_balance(user_id: str, amount: int, reason: str, actor: str) -> dict:
    """Admin adjustment (+ goodwill as bonus credits; - correction). A correction takes bonus first, then paid, in one
    conditional write that can't take either part below 0, and without setting off auto reload. Never the card."""
    amount = int(amount)
    before = credits.balance(_profile(user_id))
    key = f"ADJ#{_now()}#{uuid.uuid4().hex[:6]}"
    if amount >= 0:
        credits.grant(user_id, amount, "adjustment", reason, key, actor=actor)
    else:
        try:
            credits.debit(user_id, -amount, "adjustment", reason, key=key, auto_reload=False, bonus_first=True, actor=actor)
        except credits.InsufficientCredits as e:
            if e.balance <= 0:
                raise AdjustError(f"This user has no {credits.unit_name()} to take away") from e
            raise AdjustError(f"This user only has {credits.fmt(e.balance)}; take away at most {e.balance:,}") from e
    logs.audit(actor, "balance.adjust", f"user:{user_id}", reason, before=before, after={"delta": amount})
    return credits.balance(_profile(user_id))


# ---- webhook side

def cancel_referral(pay: dict) -> None:
    """A referred account's first top-up was refunded or disputed: the referral rewards still on hold are cancelled."""
    for earner, sk in pay.get("referralHolds") or []:
        credits.cancel_hold(earner, sk)


def refresh_topped_up(user_id: str) -> None:
    """hasToppedUp (the daily bonus, earning from someone's purchases) holds exactly while a top-up is still paid for
    (not all refunded, not disputed). This is the one place it is worked out: after a top-up is credited and after every
    change to a payment's refundedCents or disputed (a refund made, given back or failed at Stripe, a dashboard refund,
    a dispute). firstTopUpAt stays, so no invite code after a refund."""
    _table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, UpdateExpression="SET hasToppedUp = :v",
                         ExpressionAttributeValues={":v": any(_unrefunded(x) > 0 for x in topups(user_id))})


def _payment_reversed(user_id: str, pay: dict) -> None:
    """A payment was refunded or disputed: the referral rewards it set off are cancelled and hasToppedUp worked out again."""
    cancel_referral(pay)
    refresh_topped_up(user_id)


def charge_refunded(charge: dict) -> str:
    """Refunds made outside the site (Stripe dashboard): debit the matching paid credits. Ours are counted in
    refundedCents before Stripe is asked, so they come out as nothing new. The debit and the refundedCents change are
    one transaction, keyed by the charge's refunded total and conditional on the refundedCents it was worked out from,
    so a retry or two partial refunds processed at once can't debit twice or not at all."""
    pi, total = charge.get("payment_intent"), int(charge.get("amount_refunded", 0))
    for _ in range(4):
        pay = get(pi) if pi else None
        if not pay:
            return f"no payment record for {pi}"
        before = int(pay.get("refundedCents", 0))
        delta = total - before
        if delta <= 0:
            return "already applied"
        user_id = pay["userId"]
        counted = db.tx_update({"pk": f"PAY#{pi}", "sk": "PAY"}, "SET refundedCents = :new", {":new": total, ":old": before},
                               cond="refundedCents = :old" + (" OR attribute_not_exists(refundedCents)" if before == 0 else ""))
        if pay.get("kind", "topup") != "topup":  # a subscription (or other) payment: no wallet units behind it
            try:
                db.transact([counted])
            except Exception as e:
                if db.tx_cancelled(e) is None:
                    raise
                continue
            logs.audit("stripe", "refund.external", f"user:{user_id}", f"{pay.get('kind')} payment {pi}: {delta}c refunded in Stripe")
            return f"external refund {delta}c on a {pay.get('kind')} payment"
        debit = min(delta, max(0, int(_profile(user_id).get("paidCredits", 0))))
        try:
            credits.take(user_id, debit, 0, "refund_external", f"Refunded {credits.usd(delta)} from the Stripe dashboard",
                         f"REFUNDEXT#{charge.get('id')}#{total}", extra=[counted], paymentIntent=pi)
        except credits.Declined as e:
            if e.codes and e.codes[0] == "ConditionalCheckFailed":
                return "already applied"
            continue  # the balance or the payment changed meanwhile: work it out again
        note = f"external refund {delta}c, paid credits debited {debit}" + (" (balance short: flagged)" if debit < delta else "")
        logs.audit("stripe", "refund.external", f"user:{user_id}", note)
        _payment_reversed(user_id, pay)
        return note
    raise RuntimeError(f"payment {pi} kept changing; Stripe will retry")


def refund_failed(refund: dict) -> str:
    """A refund Stripe accepted failed later (e.g. the card was closed): the customer got no money, so what it took
    from the balance goes back, once, and the payment counts as paid for again (hasToppedUp). A failed refund made in
    the Stripe dashboard has no record here, so the admin is told instead."""
    if refund.get("status") != "failed":
        return "ignored"
    pi, rid = refund.get("payment_intent"), refund.get("id")
    row = _table().get_item(Key={"pk": f"PAY#{pi}", "sk": f"REFUND#{rid}"}).get("Item") if pi and rid else None
    if not row or not row.get("userId"):
        mail.to_admin("A refund failed", f"Refund {rid} on payment {pi} failed at Stripe and has no site record. Check it in Stripe.")
        return f"refund {rid} failed: no site record"
    user_id, cash = row["userId"], int(row["amountCents"])
    back = _credit_back(user_id, pi, cash, int(row.get("bonusRemoved", 0)), f"REFUNDFAILED#{rid}", row.get("txKey"),
                        [db.tx_update({"pk": f"PAY#{pi}", "sk": f"REFUND#{rid}"}, "SET #s = :f", {":f": "failed"}, names={"#s": "status"})])
    if not back:
        return "already given back"
    logs.audit("stripe", "refund.failed", f"user:{user_id}", f"refund {rid} failed; {cash} credits back")
    mail.to_admin("A card refund failed", f"Refund {rid} ({credits.usd(cash)}) to user {user_id} failed at Stripe. "
                  "The units are back in their balance.")
    return f"refund {rid} failed: {cash} credits back"


def _dispute_payment(dispute: dict, create: bool = True) -> dict | None:
    """The PAY# record a dispute is about. Top-ups and subscription invoices have one; any other charge of ours (made
    in the dashboard, say) gets a minimal record when its Stripe customer is one of our users, so the dispute still
    suspends the right account and the closing event finds it."""
    pi = dispute.get("payment_intent")
    key = pi or dispute.get("charge")
    pay = get(key) if key else None
    if pay or not create or not dispute.get("charge"):
        return pay
    sc = stripe_config.client()
    ch = logs.stripe_call("charges.retrieve", lambda: sc.v1.charges.retrieve(dispute["charge"]), {"id": dispute["charge"]})
    customer = ch.customer if isinstance(ch.customer, str) or ch.customer is None else ch.customer.id
    user = db.get_user_by_stripe_customer(customer) if customer else None
    if not user:
        return None
    created = _now()
    rec = {"userId": user["userId"], "kind": "external", "paidCents": int(ch.amount or 0), "credits": 0, "bonusCredits": 0,
           "refundedCents": int(getattr(ch, "amount_refunded", 0) or 0), "disputed": False, "status": "succeeded",
           "createdAt": created, "customer": customer, "chargeId": ch.id}
    _table().put_item(Item={"pk": f"PAY#{key}", "sk": "PAY", **rec})
    for row in _index_rows(user["userId"], key, created, rec["paidCents"], "external"):
        _table().put_item(Item=row)
    return get(key)


def record_invoice(invoice: dict, user_id: str, pi: str | None, plan: str) -> dict:
    """A paid subscription invoice as a payment record (kind "subscription"; admin Payments tab, disputes). Keyed by its
    PaymentIntent when Stripe gave one, else by the invoice id. Written once; a retry changes nothing."""
    key = pi or invoice.get("id")
    created = dt.datetime.fromtimestamp(int(invoice.get("created") or time.time()), dt.timezone.utc).isoformat()
    paid = int(invoice.get("amount_paid") or 0)
    fields = {"userId": user_id, "kind": "subscription", "plan": plan, "paidCents": paid, "credits": 0, "bonusCredits": 0,
              "feeCents": 0, "netCents": paid, "refundedCents": 0, "disputed": False, "status": "succeeded", "createdAt": created,
              "invoice": invoice.get("id"), "customer": invoice.get("customer"), "receiptUrl": invoice.get("hosted_invoice_url")}
    expr, names, values = _fill_in(fields)
    t = _table()
    item = t.update_item(Key={"pk": f"PAY#{key}", "sk": "PAY"}, UpdateExpression=expr, ExpressionAttributeNames=names,
                         ExpressionAttributeValues=values, ReturnValues="ALL_NEW")["Attributes"]
    for row in _index_rows(user_id, key, item["createdAt"], paid, "subscription"):
        t.put_item(Item=row)
    return item


def dispute_created(dispute: dict) -> str:
    """Chargeback: freeze spending, mark the payment, tell the admin (evidence has a deadline)."""
    try:
        from lib import accounts
    except ImportError:
        from api.lib import accounts
    pi = dispute.get("payment_intent")
    pay = _dispute_payment(dispute)
    if not pay:
        mail.to_admin("Payment disputed: no matching user", f"Dispute {dispute.get('id')} on payment {pi} matches no user "
                      "here. Respond to it in Stripe.")
        return f"no payment record for {pi}"
    pi = pay["pk"].split("#", 1)[1]
    user_id = pay["userId"]
    due = ((dispute.get("evidence_details") or {}).get("due_by")) or 0
    t = _table()
    t.update_item(Key={"pk": f"PAY#{pi}", "sk": "PAY"}, UpdateExpression="SET disputed = :t", ExpressionAttributeValues={":t": True})
    t.put_item(Item={"pk": f"PAY#{pi}", "sk": f"DISPUTE#{dispute.get('id')}", "amountCents": int(dispute.get("amount", 0)),
                     "reason": dispute.get("reason", ""), "status": dispute.get("status", ""), "evidenceDueBy": int(due), "at": _now(),
                     "userId": user_id})
    banned = accounts.status(accounts.profile(user_id)) == "banned"
    if not banned:  # a ban stays a ban: set_status would drop its end date
        accounts.set_status(user_id, "suspended", f"dispute {dispute.get('id')}", "stripe")
    _payment_reversed(user_id, pay)
    mail.to_admin("Payment disputed: respond in Stripe",
                  f"User {user_id} disputed payment {pi} (${int(dispute.get('amount', 0)) / 100:.2f}, reason "
                  f"{dispute.get('reason')}). Their spending is paused. Evidence is due by "
                  f"{dt.datetime.fromtimestamp(due, dt.timezone.utc).isoformat() if due else 'see Stripe'}.")
    return f"dispute recorded, user {user_id} " + ("already banned" if banned else "suspended")


def dispute_closed(dispute: dict) -> str:
    """A chargeback was decided. Won: the suspension it caused is lifted, if that dispute is still why the
    account is suspended. Lost: it stays suspended. The admin is told either way. The payment stays marked disputed (no card
    refunds of it)."""
    try:
        from lib import accounts
    except ImportError:
        from api.lib import accounts
    dp, status = dispute.get("id"), dispute.get("status", "")
    pay = _dispute_payment(dispute, create=False)
    if not pay:
        return f"no payment record for {dispute.get('payment_intent')}"
    pi, user_id = pay["pk"].split("#", 1)[1], pay["userId"]
    _table().update_item(Key={"pk": f"PAY#{pi}", "sk": f"DISPUTE#{dp}"}, UpdateExpression="SET #s = :s, closedAt = :t",
                         ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":s": status, ":t": _now()})
    p = accounts.profile(user_id)
    lifted = status == "won" and accounts.status(p) == "suspended" and p.get("statusReason") == f"dispute {dp}"
    if lifted:
        accounts.set_status(user_id, "active", f"dispute {dp} won", "stripe")
    mail.to_admin(f"Dispute {status}", f"The dispute {dp} on payment {pi} (user {user_id}) closed: {status}."
                  + (" Their spending is on again." if lifted else " Their account status was not changed."))
    return f"dispute {status}" + (", suspension lifted" if lifted else "")

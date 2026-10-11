"""Wallet (billing mode credits | both): balance, buying units with a saved card on the site, auto reload, refunds.

  GET  /api/wallet                    balance (paid + bonus), refundable now, rewards on hold, packs, history, settings
  POST /api/wallet/charge {packId | customUsd, paymentMethodId?, requestId}  charge a saved card (the default one
        unless one is picked) with a server-confirmed PaymentIntent. 3-D Secure, when the bank asks for it, returns a
        redirect, and GET /api/wallet/charge/{pi} finishes it on the way back.
  POST /api/wallet/auto-reload {on, below, packId}
  GET  /api/wallet/refunds            top-ups with what each could still refund (the refund dialog)
  POST /api/wallet/refund {paymentIntents: [...], reason?}  unused paid units back to the card (newest first, no gaps)

A top-up is credited exactly once (TX#TOPUP#{pi}) by whichever sees it first: the charge's answer, the 3-D Secure
return or the payment_intent.succeeded webhook (handle_event). Rules: api/lib/credits.py, api/lib/payments.py.
"""

from __future__ import annotations

import logging
import os
import time

import stripe

try:
    from lib import accounts, autoreload, config, credits, db, fx, i18n, logs, payments, regions, response, stripe_config
    from lib.params import body as _body
    from routes import cards
except ImportError:
    from api.lib import accounts, autoreload, config, credits, db, fx, i18n, logs, payments, regions, response, stripe_config
    from api.lib.params import body as _body
    from api.routes import cards

log = logging.getLogger("yourapp.wallet")

STILL_PROCESSING = "This payment is still being processed. Check your balance in a minute before trying again."


def _frontend() -> str:
    return os.environ.get("FRONTEND_URL", "https://yourapp.com")


def _profile(user_id: str) -> dict:
    return db.get_user(user_id) or {}


def _custom() -> dict | None:
    c = config.BILLING.get("custom")
    return {"minUsd": c["minUsd"], "maxUsd": c["maxUsd"]} if c else None


def get_wallet(user_id: str, event: dict | None = None) -> dict:
    credits.release_due(user_id)
    payments.reconcile(user_id)  # card refunds whose request died after their units were reserved
    p = _profile(user_id)
    held = credits.pending(user_id)
    test_mode = True
    try:
        test_mode = not stripe_config.is_live()
    except Exception:  # noqa: BLE001 - no Stripe secret yet: the wallet still shows the balance
        log.warning("no Stripe secret readable; wallet shown in test mode")
    return response.ok({
        **credits.balance(p),
        "creditName": credits.unit_name(),
        "perDollar": credits.PER_DOLLAR,
        "refundable": payments.refundable(user_id)["refundable"],
        "refundDays": credits.REFUND_DAYS,
        "pendingCredits": sum(int(h["amount"]) for h in held),
        "pending": [{"amount": int(h["amount"]), "kind": h["kind"], "note": h.get("note", ""), "releaseAt": h["releaseAt"]}
                    for h in sorted(held, key=lambda h: h["releaseAt"])],
        **accounts.standing(p),
        "transactions": credits.history(user_id, 200),
        "packs": config.packs(),
        "custom": _custom(),
        "creditCosts": config.BILLING["creditCosts"],
        "autoReload": autoreload.settings(p),
        "referralCode": credits.referral_code(user_id, p) if credits.referrals_on() else None,
        "testMode": test_mode,
        "canPay": regions.can_pay_here(event),
        "localCurrency": fx.local_for(event),
    })


# ---- crediting a top-up (charge answer, 3-D Secure return, webhook: one credit per payment)

def credit_intent(pi: dict) -> bool:
    """Credit a succeeded top-up PaymentIntent once (its metadata says the units). False if done already or not ours."""
    meta = pi.get("metadata") or {}
    if meta.get("kind") != "topup" or pi.get("status") != "succeeded" or not meta.get("credits") or not meta.get("userId"):
        return False
    session = {"id": None, "metadata": meta, "payment_intent": pi["id"], "customer": pi.get("customer")}
    paid = int(pi.get("amount_received") or pi.get("amount") or 0)
    user_id = meta["userId"]
    expected = int(meta.get("payCents") or 0)
    amount = int(meta.get("credits") or paid)
    if paid != expected:  # the price changed under us: credit exactly what was paid, no bonus
        log.warning("payment %s paid %s, expected %s", pi["id"], paid, expected)
        amount = paid
    bonus = max(0, amount - paid)
    note = f"Added {credits.fmt(amount)} (paid {credits.usd(paid)})" + (f", {bonus:,} bonus" if bonus else "")
    pi_id = pi["id"]
    # the payment record goes in the credit's own transaction: a dispute or a dashboard refund always finds it (A5)
    new = credits.credit(user_id, paid, bonus, "topup", note, f"TOPUP#{pi_id}",
                         extra=payments.payment_items(session, amount, paid, credits.now()),
                         packId=meta.get("packId"), payCents=paid, paymentIntent=pi_id)
    if not new and payments.has_details(payments.get(pi_id) or {}):
        return False  # a retry, or the other path got here first: nothing left to do
    # the first time, or again when the first attempt stopped before the card details: every step is safe to repeat
    db._get_table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
                                UpdateExpression="SET firstTopUpAt = if_not_exists(firstTopUpAt, :now)",
                                ExpressionAttributeValues={":now": credits.now()})
    known = payments.record_payment(session, amount, paid).get("detailsAt")
    payments.refresh_topped_up(user_id)
    if known:  # the card is known: the same-card referral check can run (else the next retry pays it)
        credits.pay_referral(user_id, pi_id)
    return new


def _require_details(pi: str | None) -> None:
    """A top-up credited without its card details (Stripe didn't answer the lookup): fail the event so Stripe's retry
    adds them. The credit itself is never repeated (its TX key)."""
    pay = payments.get(pi) if pi else None
    if pay and pay.get("userId") and not payments.has_details(pay):
        raise RuntimeError(f"payment {pi} recorded without its card details; Stripe's retry adds them")


def handle_event(evt_type: str, obj: dict) -> str | None:
    """The webhook events this module owns (routes/webhooks.py); None for any other."""
    if evt_type == "payment_intent.succeeded" and (obj.get("metadata") or {}).get("kind") == "topup":
        result = "credited" if credit_intent(obj) else "already credited"
        _require_details(obj.get("id"))
        return result
    return None


# ---- buying units

class ChargeError(Exception):
    """A charge that didn't succeed. `unknown`: no answer from Stripe in time, so the payment may have gone through (the
    webhook credits it); otherwise the card was not charged."""

    def __init__(self, message: str, status: int, unknown: bool = False):
        super().__init__(message)
        self.status = status
        self.unknown = unknown

    def response(self) -> dict:
        """The error answer, with `outcome` for the site: "unknown" (resend with the SAME requestId: Stripe answers with
        the first attempt's result instead of charging again) or "declined" (nothing was charged: a new attempt)."""
        return response.ok({"error": str(self), "message": i18n.translate(i18n.message_of(self)),
                            "outcome": "unknown" if self.unknown else "declined"}, self.status)


def charge_saved_card(user_id: str, email: str, pack_id: str, pay: int, amount: int, key_parts: tuple, pm_id: str = "",
                      off_session: bool = False):
    """Charge a saved card (the default one unless `pm_id`) for `amount` units; returns the PaymentIntent. The
    idempotency key is built from `key_parts`. `off_session`: the customer isn't there (auto reload), so the bank can't
    ask them to confirm. Raises ChargeError."""
    cus = _profile(user_id).get("stripeCustomerId")
    if not cus:
        raise ChargeError("Add a card first", 409)
    sc = stripe_config.client()
    pm_id = pm_id or cards.default_card(sc, user_id, cus)
    pm = cards.find_pm(sc, user_id, pm_id) if pm_id else None
    if pm is None or cards.owner(pm) != cus:
        raise ChargeError("Add a card first", 409)
    if not regions.card_accepted(getattr(pm.card, "country", None)):
        raise ChargeError(regions.CARD_NOT_ACCEPTED, 403)
    meta = {"kind": "topup", "userId": user_id, "packId": pack_id, "credits": str(amount), "payCents": str(pay),
            **({"autoReload": "1"} if off_session else {})}
    params = {"amount": pay, "currency": "usd", "customer": cus, "payment_method": pm_id, "payment_method_types": ["card"],
              "confirm": True, "metadata": meta, "description": credits.fmt(amount),
              **({"off_session": True} if off_session else {"return_url": f"{_frontend()}/dashboard/wallet?charge=done"}),
              **({"receipt_email": email} if email and "@" in email else {})}
    key = stripe_config.idem(*key_parts)
    for attempt in range(3):
        try:
            return logs.stripe_call("payment_intents.create", lambda: sc.v1.payment_intents.create(params=params, options={"idempotency_key": key}),
                                    params, user_id=user_id, idempotency_key=key)
        except Exception as e:  # noqa: BLE001 - card declined and friends: show Stripe's message
            if getattr(e, "code", None) == "idempotency_key_in_use":  # a double submit while the first is still running (A23)
                if attempt < 2:
                    time.sleep(1.5)
                    continue
                raise ChargeError(STILL_PROCESSING, 504, unknown=True) from e
            if isinstance(e, stripe.APIConnectionError):  # no answer in time: it may have gone through; never "failed"
                raise ChargeError(STILL_PROCESSING, 504, unknown=True) from e
            msg = getattr(getattr(e, "error", None), "message", None) or getattr(e, "user_message", None) or i18n.Text("The payment didn't go through")
            raise ChargeError(msg if i18n.is_text(msg) else str(msg), 402) from e


def _pack(body: dict) -> tuple[str, int, int] | str:
    pack_id = str(body.get("packId", "") or "")
    if pack_id:
        pack = config.pack(pack_id)
        return (pack_id, pack["payCents"], pack["credits"]) if pack else i18n.Text("Unknown pack")
    custom = _custom()
    if not custom:
        return i18n.Text("Choose a pack")
    raw = body.get("customUsd")
    if isinstance(raw, bool) or not isinstance(raw, int) or not custom["minUsd"] <= raw <= custom["maxUsd"]:
        return i18n.Text("Choose a whole-dollar amount between ${min} and ${max}", min=custom["minUsd"], max=custom["maxUsd"])
    return "custom", raw * 100, raw * 100


def charge(user_id: str, email: str, event: dict) -> dict:
    """Buy units with a saved card, without leaving the site."""
    body = _body(event)
    got = _pack(body)
    if isinstance(got, str):
        return response.error(got, 400)
    pack_id, pay, amount = got
    ok, why = accounts.can_spend(user_id)
    if not ok:
        return response.error(why, 403, "ACCOUNT_RESTRICTED")
    if no := regions.refusal(event):
        return no
    request_id = str(body.get("requestId", ""))[:64]
    if len(request_id) < 8:
        return response.error("Missing request id", 400)
    try:
        pi = charge_saved_card(user_id, email, pack_id, pay, amount, ("charge", user_id, request_id), str(body.get("paymentMethodId") or ""))
    except ChargeError as e:
        return e.response()
    return _charge_result(user_id, pi)


def auto_reload(user_id: str, event: dict) -> dict:
    """POST /api/wallet/auto-reload {on, below, packId}. Turning it on is paying, so only from a country that may pay
    (turning it off is always allowed)."""
    b = _body(event)
    if b.get("on") and (no := regions.refusal(event)):
        return no
    got = autoreload.save(user_id, b)
    return response.error(got, 400) if isinstance(got, str) else response.ok(got)


def _charge_result(user_id: str, pi) -> dict:
    d = pi.to_dict() if hasattr(pi, "to_dict") else dict(pi)
    if d.get("status") == "succeeded":
        credit_intent(d)
        return response.ok({"status": "succeeded", "paymentIntent": d["id"], **credits.balance(_profile(user_id))})
    if d.get("status") == "requires_action":
        url = ((d.get("next_action") or {}).get("redirect_to_url") or {}).get("url")
        return response.ok({"status": "requires_action", "paymentIntent": d["id"], "redirectUrl": url})
    if d.get("status") == "processing":
        return response.ok({"status": "processing", "paymentIntent": d["id"]})
    return ChargeError("The payment didn't go through. Try another card.", 402).response()


def finish_charge(user_id: str, pi_id: str) -> dict:
    """Back from a bank's 3-D Secure page: credit it if it went through. Only the caller's own payment."""
    sc = stripe_config.client()
    pi = logs.stripe_find("payment_intents.retrieve", lambda: sc.v1.payment_intents.retrieve(pi_id), {"id": pi_id}, user_id=user_id)
    meta = (pi.metadata.to_dict() if hasattr(pi.metadata, "to_dict") else dict(pi.metadata or {})) if pi is not None else {}
    if pi is None or meta.get("userId") != user_id:
        return response.not_found("Payment not found")
    return _charge_result(user_id, pi)


# ---- refunds

def refund_options(user_id: str) -> dict:
    payments.reconcile(user_id)
    rows = payments.public_rows(payments.breakdown(user_id))
    return response.ok({"purchases": rows, "refundDays": credits.REFUND_DAYS, "refundHoldMinutes": credits.REFUND_HOLD_MINUTES,
                        **credits.balance(_profile(user_id))})


def request_refund(user_id: str, event: dict) -> dict:
    """The customer's own refund: {paymentIntents: [...]} (newest refundable first, no gaps; see payments.breakdown)."""
    body = _body(event)
    ok, why = accounts.can_spend(user_id)
    if not ok:  # suspended (a dispute) or banned: the account is frozen, refunds included (A11)
        return response.error(why, 403, "ACCOUNT_RESTRICTED")
    pis = body.get("paymentIntents")
    if not isinstance(pis, list) or not pis:
        return response.error("Choose the purchases to refund", 400)  # always per purchase, so a spent pack bonus counts
    try:
        out = payments.refund_selected(user_id, [str(x) for x in pis][:100], f"user:{user_id}", str(body.get("reason") or "")[:500])
    except payments.RefundError as e:
        return response.error(i18n.message_of(e), 400)
    return response.ok({**out, **credits.balance(_profile(user_id))})

"""Saved cards, kept by Stripe on the user's Stripe customer (we only ever see brand, last 4, expiry and country).

  GET    /api/account/cards                     saved cards + which one is the default
  POST   /api/account/cards/setup {returnTo?}   -> {url}: a Stripe-hosted page (Checkout, setup mode) to add a card
  POST   /api/account/cards/{pm}/default        make it the default
  GET    /api/account/cards/{pm}/removal-check  top-ups made with it that could still be refunded (credits mode)
  DELETE /api/account/cards/{pm}                remove it (detach). Top-ups made with it before removal can no longer
                                                be refunded to it; the customer is warned first (removal-check).

Every card id the caller sends is checked against their own Stripe customer.
"""

from __future__ import annotations

import datetime as dt
import os
import time

try:
    from lib import accounts, config, db, logs, payments, regions, response, stripe_config
    from lib.params import body as _body
except ImportError:
    from api.lib import accounts, config, db, logs, payments, regions, response, stripe_config
    from api.lib.params import body as _body

RETURN_PAGES = {"wallet": "/dashboard/wallet", "plans": "/dashboard/plans"}


def _frontend() -> str:
    return os.environ.get("FRONTEND_URL", "https://yourapp.com")


def _customer(user_id: str) -> str | None:
    return accounts.profile(user_id).get("stripeCustomerId")


def _card(pm, default_id: str | None) -> dict:
    c = pm.card
    return {"id": pm.id, "brand": c.brand, "last4": c.last4, "expMonth": c.exp_month, "expYear": c.exp_year,
            "country": c.country, "accepted": regions.card_accepted(c.country), "isDefault": pm.id == default_id}


def _default_id(customer) -> str | None:
    d = getattr(getattr(customer, "invoice_settings", None), "default_payment_method", None)
    return d if isinstance(d, str) or d is None else d.id


def list_cards(user_id: str) -> dict:
    cus = _customer(user_id)
    if not cus:
        return response.ok({"cards": []})
    sc = stripe_config.client()
    customer = logs.stripe_call("customers.retrieve", lambda: sc.v1.customers.retrieve(cus), {"id": cus}, user_id=user_id)
    default_id = _default_id(customer)
    params = {"type": "card", "limit": 20}
    pms = logs.stripe_call("customers.payment_methods.list",
                           lambda: sc.v1.customers.payment_methods.list(cus, params=params), params, user_id=user_id).data
    if pms and not default_id:
        default_id = pms[0].id
        _set_default(sc, user_id, cus, default_id)
    return response.ok({"cards": [_card(pm, default_id) for pm in pms]})


def default_card(sc, user_id: str, cus: str) -> str | None:
    customer = logs.stripe_call("customers.retrieve", lambda: sc.v1.customers.retrieve(cus), {"id": cus}, user_id=user_id)
    d = _default_id(customer)
    if d:
        return d
    params = {"type": "card", "limit": 1}
    pms = logs.stripe_call("customers.payment_methods.list", lambda: sc.v1.customers.payment_methods.list(cus, params=params), params,
                           user_id=user_id).data
    return pms[0].id if pms else None


def find_pm(sc, user_id: str, pm_id: str):
    """The caller's card id, or None when Stripe has no such card."""
    return logs.stripe_find("payment_methods.retrieve", lambda: sc.v1.payment_methods.retrieve(pm_id), {"id": pm_id}, user_id=user_id)


def owner(pm) -> str | None:
    return pm.customer if isinstance(pm.customer, str) or pm.customer is None else pm.customer.id


def setup(user_id: str, email: str, event: dict | None = None) -> dict:
    ok, why = accounts.can_spend(user_id)
    if not ok:
        return response.error(why, 403, "ACCOUNT_RESTRICTED")
    if no := regions.refusal(event):  # a card is only for paying, which may be limited to some countries
        return no
    back = RETURN_PAGES.get(str(_body(event or {}).get("returnTo") or ""), "/dashboard/settings")
    sc = stripe_config.client()
    cus = payments.ensure_customer(sc, user_id, email)
    params = {"mode": "setup", "currency": "usd", "customer": cus, "payment_method_types": ["card"],
              "client_reference_id": user_id, "metadata": {"kind": "card_setup", "userId": user_id},
              "success_url": f"{_frontend()}{back}?card=added", "cancel_url": f"{_frontend()}{back}?card=cancelled"}
    key = stripe_config.idem("cardsetup", user_id, back.rsplit("/", 1)[-1], int(time.time() // 60))  # a double click: one page
    session = logs.stripe_call("checkout.sessions.create", lambda: sc.v1.checkout.sessions.create(params=params, options={"idempotency_key": key}),
                               params, user_id=user_id, idempotency_key=key)
    return response.ok({"url": session.url})


def _set_default(sc, user_id: str, cus: str, pm_id: str) -> None:
    params = {"invoice_settings": {"default_payment_method": pm_id}}
    logs.stripe_call("customers.update", lambda: sc.v1.customers.update(cus, params=params), params, user_id=user_id)


def _owned_pm(sc, user_id: str, pm_id: str):
    cus = _customer(user_id)
    if not cus:
        return None, None
    pm = find_pm(sc, user_id, pm_id)
    return (pm, cus) if pm is not None and owner(pm) == cus else (None, cus)


def make_default(user_id: str, pm_id: str) -> dict:
    sc = stripe_config.client()
    pm, cus = _owned_pm(sc, user_id, pm_id)
    if not pm:
        return response.not_found("Card not found")
    _set_default(sc, user_id, cus, pm_id)
    return list_cards(user_id)


def removal_check(user_id: str, pm_id: str) -> dict:
    """Before removing a card: top-ups made with it that could still be refunded (they can't be after removal)."""
    sc = stripe_config.client()
    pm, _ = _owned_pm(sc, user_id, pm_id)
    if not pm:
        return response.not_found("Card not found")
    if not config.credits_on():
        return response.ok({"refundable": [], "totalCents": 0})
    fp = pm.card.fingerprint
    rows = [r for r in payments.breakdown(user_id) if (r["refundable"] or r["clearingCents"]) > 0 and r.get("_fingerprint") == fp]
    return response.ok({"refundable": payments.public_rows(rows), "totalCents": sum(r["refundable"] + r["clearingCents"] for r in rows)})


def remove(user_id: str, pm_id: str) -> dict:
    sc = stripe_config.client()
    pm, _ = _owned_pm(sc, user_id, pm_id)
    if not pm:
        return response.not_found("Card not found")
    logs.stripe_call("payment_methods.detach", lambda: sc.v1.payment_methods.detach(pm_id), {"id": pm_id}, user_id=user_id)
    fp = getattr(pm.card, "fingerprint", None)
    if fp:  # top-ups made with this card before now can no longer be refunded to it (the customer was warned)
        key = {"pk": f"USER#{user_id}", "sk": "PROFILE"}
        db._get_table().update_item(Key=key, UpdateExpression="SET removedCards = if_not_exists(removedCards, :e)",
                                    ExpressionAttributeValues={":e": {}})
        db._get_table().update_item(Key=key, UpdateExpression="SET removedCards.#f = :t", ExpressionAttributeNames={"#f": fp},
                                    ExpressionAttributeValues={":t": dt.datetime.now(dt.timezone.utc).isoformat()})
    logs.audit(f"user:{user_id}", "card.remove", f"user:{user_id}", f"removed card {pm.card.brand} {pm.card.last4}")
    return list_cards(user_id)

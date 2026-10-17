"""Saved cards, auto reload, country gating and local-price hints (adapted from Never Ending Gallery's
test_api_support_cards.py; support tickets are in test_api_support.py)."""

import json
import sys
import time

import pytest

import api.handler as handler

from .conftest import call, profile
from .stripe_fake import Obj, signed_event, topup_event


@pytest.fixture
def site(stripe_fake, who, dynamodb_table):
    t = dynamodb_table
    t.put_item(Item={"pk": "USER#u1", "sk": "PROFILE", "userId": "u1", "email": "u1@example.com", "createdAt": "2026-09-25"})
    return t, stripe_fake


def _with_customer(t, paid=None):
    expr, vals = "SET stripeCustomerId = :c", {":c": "cus_1"}
    if paid is not None:
        expr += ", paidCredits = :p, bonusCredits = :z"
        vals.update({":p": paid, ":z": 0})
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression=expr, ExpressionAttributeValues=vals)


def _notes(t):
    return [n["kind"] for n in t.query(KeyConditionExpression="pk = :p AND begins_with(sk, :n)",
                                       ExpressionAttributeValues={":p": "USER#u1", ":n": "NOTE#"})["Items"]]


def test_saved_cards_list_default_setup_and_remove(site):
    t, fake = site
    assert call("/api/account/cards")["cards"] == []  # no Stripe customer yet
    url = call("/api/account/cards/setup", "POST", {"returnTo": "wallet"})["url"]
    assert url.startswith("https://checkout.stripe.com/") and fake.sessions[-1]["mode"] == "setup"
    assert fake.sessions[-1]["success_url"].endswith("/dashboard/wallet?card=added")
    assert fake.sessions[-1]["idempotency_key"].startswith("yourapp-cardsetup-u1-wallet-")
    assert fake.customers[0]["idempotency_key"] == "yourapp-customer-u1"
    cards = call("/api/account/cards")["cards"]
    assert cards == [{"id": "pm_1", "brand": "visa", "last4": "4242", "expMonth": 9, "expYear": 2030, "country": "US",
                      "accepted": True, "isDefault": True}]
    assert fake.default == "pm_1"  # the first card becomes the default
    fake.pms["pm_x"] = Obj(id="pm_x", customer="cus_other", card=fake.pms["pm_1"].card)
    call("/api/account/cards/pm_x", "DELETE", status=404)  # not theirs
    call("/api/account/cards/pm_nope/default", "POST", status=404)
    assert call("/api/account/cards/pm_1", "DELETE")["cards"] == []


def test_removing_a_card_warns_about_refunds_and_then_blocks_them(site):
    t, fake = site
    _with_customer(t)
    assert handler.lambda_handler(signed_event(topup_event("u1", "pi_r", 1000, 1000, "p10")), None)["statusCode"] == 200
    check = call("/api/account/cards/pm_1/removal-check")
    assert check["totalCents"] == 1000 and check["refundable"][0]["paymentIntent"] == "pi_r" and "_fingerprint" not in check["refundable"][0]
    call("/api/account/cards/pm_1", "DELETE")
    rows = call("/api/wallet/refunds")["purchases"]
    assert rows[0]["refundable"] == 0 and rows[0]["reason"] == "card removed"


def test_auto_reload_buys_the_pack_when_a_spend_goes_under_the_trigger(site):
    t, fake = site
    call("/api/wallet/auto-reload", "POST", {"on": True, "below": 500, "packId": "p10"}, status=400)  # no card yet
    _with_customer(t, paid=700)
    assert call("/api/wallet/auto-reload", "POST", {"on": True, "below": 500, "packId": "p10"})["on"] is True
    assert call("/api/account")["autoReload"] == {"on": True, "below": 500, "packId": "p10", "maxPerDay": 3}
    spend = handler.wallet.credits.spend
    spend("u1", "example_action", 100, "a")  # 600 left: still above the trigger
    assert fake.intents == []
    spend("u1", "example_action", 200, "b")  # 400 left: reload
    sent = fake.intents[0]["params"]
    assert sent["off_session"] is True and sent["amount"] == 1000 and "return_url" not in sent and sent["metadata"]["autoReload"] == "1"
    assert profile(t)["paidCredits"] == 1400 and _notes(t) == ["reload"]


def test_auto_reload_needs_a_saved_card_not_just_a_stripe_customer(site):
    t, fake = site
    call("/api/account/cards/setup", "POST")  # started, never finished
    assert profile(t)["stripeCustomerId"] == "cus_1"
    fake.pms.clear()
    out = call("/api/wallet/auto-reload", "POST", {"on": True, "below": 300, "packId": "p10"}, status=400)
    assert out["error"] == "Add a card first" and not profile(t).get("autoReloadOn")
    assert call("/api/wallet/auto-reload", "POST", {"on": False, "below": 300, "packId": "p10"})["on"] is False
    call("/api/wallet/auto-reload", "POST", {"on": False, "below": 300, "packId": "p999"}, status=400)


def test_a_declined_auto_reload_turns_it_off_and_says_why(site):
    t, fake = site
    _with_customer(t, paid=300)
    call("/api/wallet/auto-reload", "POST", {"on": True, "below": 500, "packId": "p5"})

    def declines(params, options=None):
        import stripe
        raise stripe.CardError("Your card was declined.", None, "card_declined", http_status=402)
    fake.v1.payment_intents.create = declines
    handler.wallet.credits.spend("u1", "example_action", 100, "x")  # the spend itself still goes through
    p = profile(t)
    assert p["paidCredits"] == 200 and p["autoReloadOn"] is False and _notes(t) == ["reload_failed"]


def test_an_auto_reload_stripe_never_answered_stays_on(site):
    import stripe
    t, fake = site
    _with_customer(t, paid=300)
    call("/api/wallet/auto-reload", "POST", {"on": True, "below": 500, "packId": "p5"})

    def hangs(params, options=None):
        raise stripe.APIConnectionError("Request timed out")
    fake.v1.payment_intents.create = hangs
    handler.wallet.credits.spend("u1", "example_action", 100, "x")
    p = profile(t)
    assert p["paidCredits"] == 200 and p["autoReloadOn"] is True and "reload_failed" not in _notes(t)


def test_auto_reload_stops_after_the_daily_limit(site):
    t, fake = site
    _with_customer(t, paid=100)
    call("/api/wallet/auto-reload", "POST", {"on": True, "below": 100_000, "packId": "p5"})  # always under the trigger
    ar = sys.modules["lib.autoreload"]
    for _ in range(5):
        t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="REMOVE autoReloadAt")  # no lock between tries
        ar.run("u1")
    assert len(fake.intents) == 3 and _notes(t).count("reload_failed") == 1  # one "paused for today" alert


def _from(country, path, method="GET", body=None, verify=None):
    headers = {"CloudFront-Viewer-Country": country} if country else {}
    if verify:
        headers["X-Origin-Verify"] = verify
    return handler.lambda_handler({"requestContext": {"http": {"method": method, "path": path}}, "headers": headers,
                                   "body": json.dumps(body) if body is not None else None}, None)


def test_without_a_region_list_anyone_can_pay(site):
    t, _ = site
    _with_customer(t)
    assert json.loads(_from("ES", "/api/wallet")["body"])["canPay"] is True
    assert _from("JP", "/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-anywhere"})["statusCode"] == 200


def test_payments_only_from_the_configured_countries(site, billing_cfg, monkeypatch):
    t, fake = site
    billing_cfg(regions=["US", "TW"])
    _with_customer(t)
    buy = {"packId": "p10", "requestId": "req-country-1"}
    assert json.loads(_from("ES", "/api/wallet")["body"])["canPay"] is False
    for path, body in (("/api/wallet/charge", buy), ("/api/account/cards/setup", {}), ("/api/billing/checkout", {"plan": "starter"})):
        out = _from("ES", path, "POST", body)
        assert out["statusCode"] == 403 and json.loads(out["body"])["code"] == "REGION", path
    assert not fake.intents and not fake.sessions
    on = _from("ES", "/api/wallet/auto-reload", "POST", {"on": True, "below": 200, "packId": "p10"})
    assert on["statusCode"] == 403
    assert _from("ES", "/api/wallet/auto-reload", "POST", {"on": False, "below": 200, "packId": "p10"})["statusCode"] == 200
    fake.pms["pm_1"].card.country = "TW"
    assert json.loads(_from("TW", "/api/wallet/charge", "POST", buy)["body"])["status"] == "succeeded"
    fake.pms["pm_1"].card.country = "DE"  # a German card, even from an allowed country: refused, nothing charged
    out = _from("TW", "/api/wallet/charge", "POST", {**buy, "requestId": "req-country-2"})
    assert out["statusCode"] == 403 and "can't be used here" in json.loads(out["body"])["error"] and len(fake.intents) == 1
    assert call("/api/account/cards")["cards"][0]["accepted"] is False
    # the country counts only when the request came through CloudFront (X-Origin-Verify); unknown is refused
    monkeypatch.delenv("ALLOW_NO_VIEWER_COUNTRY")
    monkeypatch.setenv("ORIGIN_VERIFY", "s3cret")
    assert _from("US", "/api/wallet")["statusCode"] == 403  # no proof it came through CloudFront: refused outright
    assert json.loads(_from(None, "/api/wallet", verify="s3cret")["body"])["canPay"] is False
    assert json.loads(_from("TW", "/api/wallet", verify="s3cret")["body"])["canPay"] is True


def test_local_price_hints_when_turned_on(site, billing_cfg, monkeypatch):
    t, _ = site
    fx = sys.modules["lib.fx"]
    assert json.loads(_from("SG", "/api/wallet")["body"])["localCurrency"] is None  # off by default
    billing_cfg(localPrices=True)
    calls = []
    monkeypatch.setattr(fx, "_fetch", lambda: calls.append(1) or {"SGD": "1.35", "TWD": "31.76"})
    assert json.loads(_from("SG", "/api/wallet")["body"])["localCurrency"] == {"currency": "SGD", "perUsd": "1.35"}
    assert json.loads(_from("TW", "/api/wallet")["body"])["localCurrency"]["currency"] == "TWD"
    assert json.loads(_from("US", "/api/wallet")["body"])["localCurrency"] is None
    assert len(calls) == 1  # fetched once, then kept
    # the feed down and the stored rate over a week old: nothing shown, and one failed try isn't repeated for hours
    t.update_item(Key={"pk": "CONFIG", "sk": "FX"}, UpdateExpression="SET #a = :old, triedAt = :old", ExpressionAttributeNames={"#a": "at"},
                  ExpressionAttributeValues={":old": str(int(time.time()) - 8 * 86400)})
    tries = []
    monkeypatch.setattr(fx, "_fetch", lambda: tries.append(1) or (_ for _ in ()).throw(OSError("feed down")))
    for _ in range(2):
        monkeypatch.setattr(fx, "_mem", {})  # another Lambda container
        assert json.loads(_from("SG", "/api/wallet")["body"])["localCurrency"] is None
    assert len(tries) == 1

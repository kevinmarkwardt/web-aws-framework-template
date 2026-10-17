"""Credits wallet: packs, custom amounts, the on-site charge, the idempotent webhook credit, paid-first spending, refunds
(14-day window, 1-hour hold, newest first, bonus deducted), the earning hooks. Stripe is faked (tests/stripe_fake.py)."""

import datetime as dt

import pytest

import api.handler as handler
from api.lib import credits

from .conftest import call, profile
from .stripe_fake import signed_event, topup_event


@pytest.fixture
def wallet(stripe_fake, who, dynamodb_table):
    return dynamodb_table, stripe_fake, who


def _topup(uid="u1", pi="pi_1", paid=1000, credit=1000, pack="p10"):
    resp = handler.lambda_handler(signed_event(topup_event(uid, pi, paid, credit, pack)), None)
    assert resp["statusCode"] == 200, resp


def _spend(uid, units, ref, note="Used it"):
    return credits.spend(uid, "example_action", units, ref, note=note)


def test_wallet_lists_packs_from_config_and_no_gift_by_default(wallet):
    t, _, _ = wallet
    call("/api/account")
    w = call("/api/wallet")
    assert [(p["id"], p["payCents"], p["credits"]) for p in w["packs"]] == [
        ("p5", 500, 500), ("p10", 1000, 1000), ("p20", 2000, 2200), ("p50", 5000, 6000)]
    assert w["credits"] == 0 and w["transactions"] == [] and w["testMode"] is True and w["creditName"] == "credits"
    assert w["custom"] == {"minUsd": 5, "maxUsd": 500} and w["referralCode"] is None


def test_signup_gift_once_and_the_unit_name_from_config(wallet, billing_cfg):
    billing_cfg(signupGift=200, creditName="gems")
    acct = call("/api/account")
    assert (acct["credits"], acct["bonusCredits"], acct["paidCredits"], acct["creditName"]) == (200, 200, 0, "gems")
    assert call("/api/account")["credits"] == 200
    w = call("/api/wallet")
    assert [x["kind"] for x in w["transactions"]] == ["signup_gift"] and w["transactions"][0]["note"] == "Welcome gift: 200 gems"


def test_webhook_credits_once_with_bonus(wallet):
    t, _, _ = wallet
    evt = topup_event("u1", "pi_1", 2000, 2200)
    assert handler.lambda_handler(signed_event(evt, secret="whsec_wrong"), None)["statusCode"] == 400
    _topup(pi="pi_1", paid=2000, credit=2200, pack="p20")
    assert handler.lambda_handler(signed_event({**evt, "id": "evt_retry"}), None)["statusCode"] == 200  # same payment again
    p = profile(t)
    assert p["paidCredits"] == 2000 and p["bonusCredits"] == 200 and p["hasToppedUp"] is True
    pay = t.get_item(Key={"pk": "PAY#pi_1", "sk": "PAY"})["Item"]
    assert pay["credits"] == 2200 and pay["bonusCredits"] == 200 and pay["refundUntil"] > pay["createdAt"]
    assert pay["card"]["fingerprint"] == "fp_card_1" and pay["feeCents"] == 88


def test_a_payment_intent_that_isnt_a_top_up_is_ignored(wallet):
    t, _, _ = wallet
    evt = topup_event()
    evt["data"]["object"]["metadata"] = {"kind": "something_else", "userId": "u1"}
    handler.lambda_handler(signed_event(evt), None)
    assert not profile(t)


def test_spending_takes_paid_first_and_is_once_per_ref(wallet):
    t, _, _ = wallet
    credits.grant("u1", 200, "gift", "a gift", "GIFT#1")
    _topup()
    out = _spend("u1", 1100, "job-1")
    assert out == {"paid": 1000, "bonus": 100, "amount": 1100, "txKey": "SPEND#example_action#job-1"}
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (0, 100)
    with pytest.raises(credits.AlreadyDone):
        _spend("u1", 10, "job-1")
    with pytest.raises(credits.InsufficientCredits):
        _spend("u1", 5000, "job-2")
    assert profile(t)["bonusCredits"] == 100


def test_spend_uses_the_configured_cost_and_refund_spend_gives_it_back_once(wallet, billing_cfg):
    t, _, _ = wallet
    billing_cfg(creditCosts={"unlock": 300})
    _topup()
    assert credits.spend("u1", "unlock", ref="doc-9")["amount"] == 300
    with pytest.raises(ValueError):
        credits.spend("u1", "no_such_action", ref="x")
    with pytest.raises(ValueError):
        credits.spend("u1", "unlock", units=-5, ref="y")
    assert credits.refund_spend("u1", "unlock", "doc-9", "the job failed") is True
    assert credits.refund_spend("u1", "unlock", "doc-9") is False
    assert profile(t)["paidCredits"] == 1000


def test_customer_refund_deducts_the_pack_bonus_that_was_spent(wallet):
    t, fake, _ = wallet
    _topup(paid=2000, credit=2200, pack="p20")
    _spend("u1", 500, "a", "Exported a report")  # all 500 from paid
    r = call("/api/wallet/refunds")["purchases"][0]
    assert (r["left"], r["usedCredits"], r["refundable"], r["partial"]) == (1500, 500, 1500, True)  # $15 back
    call("/api/wallet/refund", "POST", {"credits": 1000}, status=400)  # per purchase only
    out = call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]})
    assert out["refunded"] == 1500 and fake.refunds[0]["amount"] == 1500 and out["refunds"][0]["bonusRemoved"] == 200
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (0, 0)
    assert t.get_item(Key={"pk": "PAY#pi_1", "sk": "PAY"})["Item"]["refundedCents"] == 1500
    assert call("/api/wallet/refunds")["purchases"][0]["refundable"] == 0
    assert fake.refunds[0]["idempotency_key"] == "yourapp-refund-pi_1-0"


def test_unspent_pack_bonus_is_removed_and_nothing_deducted(wallet):
    t, fake, _ = wallet
    _topup(pi="pi_2", paid=2000, credit=2200, pack="p20")
    r = call("/api/wallet/refunds")["purchases"][0]
    assert (r["refundable"], r["partial"], r["left"]) == (2000, False, 2000)
    call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_2"]})
    p = profile(t)
    assert fake.refunds[0]["amount"] == 2000 and (p["paidCredits"], p["bonusCredits"]) == (0, 0)


def test_refunds_go_newest_first_without_gaps(wallet):
    t, fake, _ = wallet
    for n in (1, 2, 3):
        _topup(pi=f"pi_{n}")
        created = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=4 - n)).isoformat()  # newer each time
        t.update_item(Key={"pk": f"PAY#pi_{n}", "sk": "PAY"}, UpdateExpression="SET createdAt = :c",
                      ExpressionAttributeValues={":c": created})
    _spend("u1", 600, "x")
    rows = call("/api/wallet/refunds")["purchases"]
    assert [(r["paymentIntent"], r["usedCredits"], r["refundable"]) for r in rows] == [
        ("pi_3", 0, 1000), ("pi_2", 0, 1000), ("pi_1", 600, 400)]
    call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_2"]}, status=400)  # can't skip the newest
    out = call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_3", "pi_2", "pi_1"], "reason": "bought too much"})
    assert out["refunded"] == 2400 and out["paidCredits"] == 0
    assert [(x["payment_intent"], x["amount"]) for x in fake.refunds] == [("pi_3", 1000), ("pi_2", 1000), ("pi_1", 400)]
    assert fake.refunds[0]["metadata"]["reason"] == "Requested by the customer: bought too much"


def test_refund_window_closes_after_refund_days(wallet):
    t, _, _ = wallet
    _topup()
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=15)).isoformat()
    t.update_item(Key={"pk": "PAY#pi_1", "sk": "PAY"}, UpdateExpression="SET refundUntil = :u", ExpressionAttributeValues={":u": old})
    r = call("/api/wallet/refunds")["purchases"][0]
    assert (r["refundable"], r["reason"]) == (0, "older than 14 days")


def test_a_top_up_can_only_be_refunded_an_hour_after_it_was_made(wallet, monkeypatch):
    import sys
    for m in (credits, sys.modules.get("lib.credits")):
        if m:
            monkeypatch.setattr(m, "REFUND_HOLD_MINUTES", 60)
    t, fake, _ = wallet
    _topup()
    r = call("/api/wallet/refunds")["purchases"][0]
    assert (r["reason"], r["refundable"], r["clearingCents"]) == ("clearing", 0, 1000) and r["refundableFrom"] > r["createdAt"]
    call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]}, status=400)
    assert not fake.refunds
    earlier = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=61)).isoformat()
    t.update_item(Key={"pk": "PAY#pi_1", "sk": "PAY"}, UpdateExpression="SET createdAt = :c", ExpressionAttributeValues={":c": earlier})
    assert call("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]})["refunded"] == 1000


def test_buy_on_site_with_the_default_card_once_per_request_id(wallet):
    t, fake, _ = wallet
    call("/api/account")
    call("/api/wallet/charge", "POST", {"packId": "p20", "requestId": "req-12345678"}, status=409)  # no card yet
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET stripeCustomerId = :c", ExpressionAttributeValues={":c": "cus_1"})
    out = call("/api/wallet/charge", "POST", {"packId": "p20", "requestId": "req-12345678"})
    assert out["status"] == "succeeded" and (out["paidCredits"], out["bonusCredits"]) == (2000, 200)
    sent = fake.intents[0]
    assert sent["params"]["payment_method"] == "pm_1" and sent["amount"] == 2000 and sent["params"]["confirm"] is True
    assert sent["idempotency_key"] == "yourapp-charge-u1-req-12345678"
    call("/api/wallet/charge", "POST", {"packId": "p20", "requestId": "req-12345678"})  # a resend: same payment
    assert profile(t)["paidCredits"] == 2000 and len(fake.intents) == 1
    handler.lambda_handler(signed_event(topup_event("u1", "pi_site_1", 2000, 2200, "p20")), None)  # and its webhook
    assert profile(t)["paidCredits"] == 2000
    # another customer's card is refused, and so is an unknown pack or an out-of-range custom amount
    fake.pms["pm_x"] = type(fake.pms["pm_1"])(id="pm_x", customer="cus_other", card=fake.pms["pm_1"].card)
    call("/api/wallet/charge", "POST", {"packId": "p5", "requestId": "req-87654321", "paymentMethodId": "pm_x"}, status=409)
    call("/api/wallet/charge", "POST", {"packId": "p7", "requestId": "req-87654321"}, status=400)
    call("/api/wallet/charge", "POST", {"customUsd": 501, "requestId": "req-87654321"}, status=400)
    out = call("/api/wallet/charge", "POST", {"customUsd": 7, "requestId": "req-custom-01"})
    assert out["paidCredits"] == 2700 and out["bonusCredits"] == 200


def test_three_d_secure_returns_a_redirect_and_the_return_credits_it(wallet):
    t, fake, who = wallet
    call("/api/account")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET stripeCustomerId = :c", ExpressionAttributeValues={":c": "cus_1"})
    fake.pi_status = "requires_action"
    out = call("/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-3ds-0001"})
    assert out["status"] == "requires_action" and out["redirectUrl"] == "https://bank.example/3ds"
    assert profile(t).get("paidCredits", 0) == 0
    fake.intents[0]["status"] = "succeeded"  # the customer confirmed with their bank
    who["uid"] = "someone-else"
    call(f"/api/wallet/charge/{out['paymentIntent']}", status=404)  # not theirs
    who["uid"] = "u1"
    assert call(f"/api/wallet/charge/{out['paymentIntent']}")["status"] == "succeeded"
    assert profile(t)["paidCredits"] == 1000


def test_daily_bonus_and_referrals_are_off_by_default(wallet):
    t, _, who = wallet
    _topup()
    call("/api/account")
    call("/api/account")
    assert profile(t).get("bonusCredits", 0) == 0
    call("/api/account/referral", "POST", {"code": "abc"}, status=404)


def test_daily_bonus_when_configured_only_after_a_top_up(wallet, billing_cfg):
    t, _, _ = wallet
    billing_cfg(dailyBonus=5)
    call("/api/account")
    assert profile(t).get("bonusCredits", 0) == 0
    _topup()
    call("/api/account")
    call("/api/account")
    assert profile(t)["bonusCredits"] == 5


def test_referral_rewards_are_held_and_skipped_for_the_same_card(wallet, billing_cfg):
    t, _, who = wallet
    billing_cfg(referral={"referrer": 250, "referred": 100})
    who["uid"] = "inviter"
    code = call("/api/wallet")["referralCode"]
    who["uid"] = "friend"
    call("/api/account")
    call("/api/account/referral", "POST", {"code": "nope"}, status=400)
    call("/api/account/referral", "POST", {"code": code})
    _topup("friend", "pi_f", 500, 500, "p5")
    assert [int(h["amount"]) for h in credits.pending("inviter")] == [250]
    assert [int(h["amount"]) for h in credits.pending("friend")] == [100]
    _release_holds_now(t, "inviter", "friend")
    assert credits.release_due("inviter") == 250 and credits.release_due("friend") == 100
    # the inviter's own card on the next account: nothing
    who["uid"] = "alt"
    call("/api/account")
    t.update_item(Key={"pk": "USER#inviter", "sk": "PROFILE"}, UpdateExpression="SET cardFingerprints = :f",
                  ExpressionAttributeValues={":f": {"fp_card_1"}})
    call("/api/account/referral", "POST", {"code": code})
    _topup("alt", "pi_a", 500, 500, "p5")
    assert not credits.pending("inviter") and not credits.pending("alt")


def _release_holds_now(t, *uids):
    """Move these users' rewards on hold to a release time in the past (as if the 14 days had gone by)."""
    for uid in uids:
        for h in credits.pending(uid):
            t.delete_item(Key={"pk": h["pk"], "sk": h["sk"]})
            t.put_item(Item={**h, "sk": "PENDING#2000-01-01T00:00:00+00:00#" + h["sk"].rsplit("#", 1)[1], "releaseAt": "2000-01-01T00:00:00+00:00"})


def test_wallet_requires_sign_in(dynamodb_table):
    assert handler.lambda_handler({"requestContext": {"http": {"method": "GET", "path": "/api/wallet"}}, "headers": {}}, None)["statusCode"] == 401

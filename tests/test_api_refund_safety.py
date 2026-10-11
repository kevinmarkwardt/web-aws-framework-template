"""Card refunds and Stripe webhooks can't lose or create money. Ported from Never Ending Gallery's review branch
(review-notes/A-money.md: A1-A6, A11-A13, A15, A16, A18, A22, A23); each test reproduces a way it could go wrong."""

import sys
import time
from types import SimpleNamespace as NS

import pytest
import stripe
from boto3.dynamodb.conditions import Key

import api.handler as handler
from api.lib import credits

from .conftest import call, profile
from .stripe_fake import event, signed_event, topup_event
from .test_api_wallet import _release_holds_now


class Killed(BaseException):
    """The Lambda stopping mid-request (timeout, out of memory): no except/finally cleanup of ours can count on it."""


@pytest.fixture
def wallet(stripe_fake, who, dynamodb_table):
    return dynamodb_table, stripe_fake, who


def _lib(name):
    return sys.modules[f"lib.{name}"]  # the handler's copy of a module (import duality, CLAUDE.md)


def _topup(uid="u1", pi="pi_1", paid=1000, credit=1000, pack="p10"):
    assert handler.lambda_handler(signed_event(topup_event(uid, pi, paid, credit, pack)), None)["statusCode"] == 200


def _refund(pis, status=200):
    return call("/api/wallet/refund", "POST", {"paymentIntents": pis}, status=status)


def _spend(uid, units, ref):
    return credits.spend(uid, "example_action", units, ref)


def _pending(t, uid="u1"):
    return t.query(KeyConditionExpression=Key("pk").eq(f"USER#{uid}") & Key("sk").begins_with("REFUNDPENDING#"))["Items"]


def _age_pending(t, seconds, uid="u1"):
    for row in _pending(t, uid):
        t.update_item(Key={"pk": row["pk"], "sk": row["sk"]}, UpdateExpression="SET atS = :a",
                      ExpressionAttributeValues={":a": int(time.time()) - seconds})


def _pay(t, pi="pi_1"):
    return t.get_item(Key={"pk": f"PAY#{pi}", "sk": "PAY"})["Item"]


def _wallet_request(path, method="GET", body=None):
    return handler.lambda_handler({"requestContext": {"http": {"method": method, "path": path}}, "headers": {},
                                   "body": None if body is None else __import__("json").dumps(body)}, None)


# ---- A1: the units leave the balance before Stripe is asked

def test_two_refund_requests_at_once_refund_the_top_up_once(wallet):
    t, fake, _ = wallet
    _topup(paid=2000, credit=2200, pack="p20")
    _spend("u1", 1000, "x")  # $10 left to refund
    orig, second = fake._refund, {}

    def racing(params, options=None):
        if not second:  # a second request (a double click, a script) lands while Stripe answers the first
            second["resp"] = _wallet_request("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]})
        return orig(params, options)
    fake.v1.refunds.create = racing
    out = _refund(["pi_1"])
    assert out["refunded"] == 1000 and second["resp"]["statusCode"] == 400
    p = profile(t)
    assert [r["amount"] for r in fake.refunds] == [1000] and (p["paidCredits"], p["bonusCredits"]) == (0, 0)
    assert _pay(t)["refundedCents"] == 1000 and not _pending(t)


def test_a_spend_while_the_card_refund_runs_finds_the_units_gone(wallet):
    t, fake, _ = wallet
    _topup()
    orig, tried = fake._refund, []

    def racing(params, options=None):
        with pytest.raises(credits.InsufficientCredits):  # the refund already holds them
            _spend("u1", 1000, "race")
        tried.append(1)
        return orig(params, options)
    fake.v1.refunds.create = racing
    _refund(["pi_1"])
    assert tried and fake.refunds[0]["amount"] == 1000 and profile(t)["paidCredits"] == 0


def test_a_ban_during_a_purchase_never_takes_the_balance_below_zero(wallet):
    t, fake, _ = wallet
    _topup(paid=2000, credit=2200, pack="p20")
    orig = fake._refund

    def racing(params, options=None):
        with pytest.raises(credits.InsufficientCredits):
            credits.debit("u1", 2200, "spend", "Buying everything", key="SPEND#all")
        return orig(params, options)
    fake.v1.refunds.create = racing
    _lib("accounts").ban("u1", "spam", "admin:a")
    p = profile(t)
    assert fake.refunds[0]["amount"] == 2000 and (p["paidCredits"], p["bonusCredits"]) == (0, 0) and p["status"] == "banned"


# ---- A3: a refund whose request died is finished later with the same idempotency key

def test_a_refund_whose_request_died_after_stripe_is_settled_on_the_next_wallet_load(wallet):
    t, fake, _ = wallet
    _topup()
    orig = fake._refund

    def dies(params, options=None):
        orig(params, options)  # Stripe made the refund...
        raise Killed()         # ...and the Lambda stopped before it heard back
    fake.v1.refunds.create = dies
    with pytest.raises(Killed):
        _wallet_request("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]})
    assert profile(t)["paidCredits"] == 0 and len(_pending(t)) == 1  # reserved before Stripe was asked
    # Stripe's charge.refunded webhook finds the refund already counted: nothing more comes off
    handler.lambda_handler(signed_event(event("charge.refunded", {"id": "ch_1", "object": "charge", "payment_intent": "pi_1",
                                                                  "amount_refunded": 1000})), None)
    assert profile(t)["paidCredits"] == 0
    fake.v1.refunds.create = orig
    call("/api/wallet")
    assert len(_pending(t)) == 1  # too new: its own request might still be running
    _age_pending(t, 120)
    call("/api/wallet")
    assert not _pending(t) and len(fake.refunds) == 1  # asked again with the same key: Stripe's first answer
    assert fake.refunds[0]["idempotency_key"] == "yourapp-refund-pi_1-0"
    assert t.get_item(Key={"pk": "PAY#pi_1", "sk": "REFUND#re_1"})["Item"]["amountCents"] == 1000
    assert (profile(t)["paidCredits"], _pay(t)["refundedCents"]) == (0, 1000)


def test_no_answer_from_stripe_stays_pending_and_a_later_refusal_gives_the_units_back(wallet):
    t, fake, _ = wallet
    _topup(paid=2000, credit=2200, pack="p20")
    fake.refund_error = stripe.APIConnectionError("Stripe timed out")
    out = _refund(["pi_1"])
    assert out["refunds"][0]["status"] == "pending" and (profile(t)["paidCredits"], profile(t)["bonusCredits"]) == (0, 0)
    fake.refund_error, fake.fail_refunds = None, True
    _age_pending(t, 120)
    rows = call("/api/wallet/refunds")["purchases"]
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (2000, 200) and _pay(t)["refundedCents"] == 0 and not _pending(t)
    assert rows[0]["refundable"] == 2000  # can be asked for again
    fake.fail_refunds = False
    assert _refund(["pi_1"])["refunded"] == 2000 and fake.refunds[-1]["idempotency_key"] == "yourapp-refund-pi_1-1"
    kinds = [x["kind"] for x in credits.history("u1")]
    assert kinds.count("refund_card") == 2 and "refund" in kinds  # the failed try and its give-back stay in the ledger


def test_a_refund_stripe_refuses_gives_everything_back_at_once(wallet):
    t, fake, _ = wallet
    _topup()
    fake.fail_refunds = True
    assert _refund(["pi_1"], 400)["error"]
    assert profile(t)["paidCredits"] == 1000 and _pay(t)["refundedCents"] == 0 and not _pending(t)


def test_a_day_old_pending_refund_is_looked_up_at_stripe_by_its_key(wallet):
    t, fake, _ = wallet
    _topup()
    orig = fake._refund

    def dies(params, options=None):
        orig(params, options)
        raise Killed()
    fake.v1.refunds.create = dies
    with pytest.raises(Killed):
        _wallet_request("/api/wallet/refund", "POST", {"paymentIntents": ["pi_1"]})
    fake.v1.refunds.create = lambda params, options=None: pytest.fail("a key older than a day must not be sent again")
    _age_pending(t, 21 * 3600)
    call("/api/wallet")
    assert not _pending(t) and t.get_item(Key={"pk": "PAY#pi_1", "sk": "REFUND#re_1"}).get("Item")
    assert profile(t)["paidCredits"] == 0


# ---- A2: a pack bonus spent while the paid units were out can't become cash

def test_a_pack_bonus_spent_while_paid_units_were_out_comes_off_the_refund(wallet):
    t, fake, _ = wallet
    _topup(paid=5000, credit=6000, pack="p50")  # 5,000 paid + 1,000 bonus
    _spend("u1", 5000, "job")      # all paid
    _spend("u1", 1000, "bonus")    # all bonus
    assert credits.refund_spend("u1", "example_action", "job", "the job failed")  # paid back
    row = call("/api/wallet/refunds")["purchases"][0]
    assert (row["refundable"], row["bonusNow"], row["left"]) == (4000, 0, 4000)
    assert row["deductions"][-1]["amount"] == 1000 and row["deductions"][-1]["kind"] == "bonus_forfeited"
    out = _refund(["pi_1"])
    p = profile(t)
    assert out["refunded"] == 4000 and fake.refunds[0]["amount"] == 4000 and (p["paidCredits"], p["bonusCredits"]) == (1000, 0)


def test_other_bonus_in_the_balance_still_covers_the_pack_bonus(wallet):
    """Bonus units are one pool: while the balance holds the pack's bonus, the refund is whole and the bonus goes."""
    t, fake, _ = wallet
    credits.grant("u1", 200, "signup_gift", "gift", "SIGNUP")
    _topup(paid=2000, credit=2200, pack="p20")
    _spend("u1", 2000, "k")
    _spend("u1", 200, "c")
    credits.refund_spend("u1", "example_action", "k")
    row = call("/api/wallet/refunds")["purchases"][0]
    assert (row["refundable"], row["bonusNow"]) == (2000, 200)
    _refund(["pi_1"])
    assert (profile(t)["paidCredits"], profile(t)["bonusCredits"]) == (0, 0)


# ---- A4, A5: webhooks that died half-way are finished by Stripe's retry

def test_a_webhook_claim_left_processing_is_taken_over_by_a_later_retry(wallet):
    t, _, _ = wallet
    _lib("logs").claim_event("evt_pi_1", "payment_intent.succeeded", "pi_1")  # that Lambda timed out
    evt = topup_event("u1", "pi_1", 1000, 1000, "p10")
    assert call_webhook(evt).get("duplicate")  # too soon: it may still be running
    t.update_item(Key={"pk": "STRIPEEVT#evt_pi_1", "sk": "EVT"}, UpdateExpression="SET #a = :old",
                  ExpressionAttributeNames={"#a": "at"}, ExpressionAttributeValues={":old": "2026-01-01T00:00:00+00:00"})
    assert not call_webhook(evt).get("duplicate")
    assert profile(t)["paidCredits"] == 1000


def call_webhook(evt, status=200):
    import json
    resp = handler.lambda_handler(signed_event(evt), None)
    assert resp["statusCode"] == status, resp
    return json.loads(resp["body"])


def test_the_payment_record_comes_with_the_credit_and_a_retry_adds_the_card(wallet):
    t, fake, _ = wallet

    def down(pi_id, params=None):
        raise stripe.APIConnectionError("Stripe unreachable")
    real = fake.v1.payment_intents.retrieve
    fake.v1.payment_intents.retrieve = down
    evt = topup_event("u1", "pi_1", 1000, 1000, "p10")
    call_webhook(evt, 500)  # Stripe will retry for the details
    pay = _pay(t)
    assert pay["userId"] == "u1" and pay["paidCents"] == 1000 and "detailsAt" not in pay and profile(t)["paidCredits"] == 1000
    assert [r["paymentIntent"] for r in call("/api/wallet/refunds")["purchases"]] == ["pi_1"]
    fake.v1.payment_intents.retrieve = real
    call_webhook(evt)
    pay, p = _pay(t), profile(t)
    assert pay["card"]["fingerprint"] == "fp_card_1" and pay["detailsAt"] and p["cardFingerprints"] == {"fp_card_1"}
    assert p["paidCredits"] == 1000 and len(t.query(KeyConditionExpression=Key("pk").eq("USER#u1") & Key("sk").begins_with("PAYREF#"))["Items"]) == 1


def test_two_dashboard_refunds_processed_at_once_take_their_total(wallet, monkeypatch):
    t, _, _ = wallet
    _topup()
    payments = _lib("payments")
    payments.charge_refunded({"id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 500})
    stale, real_get = dict(_pay(t), refundedCents=0), payments.get
    reads = []

    def get_once_stale(pi):  # the second event read the payment before the first one's write landed
        reads.append(pi)
        return stale if len(reads) == 1 else real_get(pi)
    monkeypatch.setattr(payments, "get", get_once_stale)
    payments.charge_refunded({"id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 800})
    assert profile(t)["paidCredits"] == 200 and real_get("pi_1")["refundedCents"] == 800
    assert payments.charge_refunded({"id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 800}) == "already applied"


# ---- A13, A22: refunds that fail later, disputes that close, disputes on banned accounts

def test_a_refund_that_fails_later_gives_the_units_back_once(wallet):
    t, fake, _ = wallet
    _topup(paid=2000, credit=2200, pack="p20")
    _refund(["pi_1"])
    assert profile(t)["hasToppedUp"] is False  # the only top-up was refunded
    failed = {"id": "re_1", "object": "refund", "payment_intent": "pi_1", "status": "failed", "amount": 2000}
    call_webhook(event("refund.failed", failed, "evt_rf"))
    call_webhook(event("charge.refund.updated", failed, "evt_rf2"))
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (2000, 200) and _pay(t)["refundedCents"] == 0
    assert p["hasToppedUp"] is True
    assert t.get_item(Key={"pk": "PAY#pi_1", "sk": "REFUND#re_1"})["Item"]["status"] == "failed"
    assert call("/api/wallet/refunds")["purchases"][0]["refundable"] == 2000


def _dispute(evt_type, status, evt_id):
    return event(evt_type, {"id": "dp_1", "object": "dispute", "payment_intent": "pi_1", "charge": "ch_pi_1", "amount": 1000,
                            "reason": "fraudulent", "status": status, "evidence_details": {"due_by": 1790000000}}, evt_id)


def test_a_dispute_suspends_and_a_won_dispute_lifts_it(wallet):
    t, _, _ = wallet
    _topup()
    call_webhook(_dispute("charge.dispute.created", "needs_response", "evt_d1"))
    assert profile(t)["status"] == "suspended" and _pay(t)["disputed"] is True
    assert _refund(["pi_1"], 403)["error"]  # a suspended account is frozen, refunds too (A11)
    call("/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-suspended"}, status=403)
    with pytest.raises(credits.Blocked):
        _spend("u1", 10, "while-suspended")
    call_webhook(_dispute("charge.dispute.closed", "won", "evt_d2"))
    assert profile(t)["status"] == "active"


def test_a_dispute_on_a_banned_account_keeps_the_ban(wallet):
    t, _, _ = wallet
    _topup()
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #s = :b, bannedUntil = :u",
                  ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":b": "banned", ":u": "2099-09-30T00:00:00+00:00"})
    call_webhook(_dispute("charge.dispute.created", "needs_response", "evt_d1"))
    p = profile(t)
    assert p["status"] == "banned" and p["bannedUntil"] == "2099-09-30T00:00:00+00:00"


def test_a_dispute_on_a_charge_we_have_no_record_of_finds_the_user_by_customer(wallet):
    t, fake, _ = wallet
    t.put_item(Item={"pk": "USER#u9", "sk": "PROFILE", "userId": "u9", "stripeCustomerId": "cus_9"})
    from .stripe_fake import Obj
    fake.charges["ch_x"] = Obj(id="ch_x", customer="cus_9", amount=900, amount_refunded=0)
    evt = event("charge.dispute.created", {"id": "dp_9", "payment_intent": "pi_x", "charge": "ch_x", "amount": 900,
                                           "reason": "fraudulent", "status": "needs_response"}, "evt_d9")
    call_webhook(evt)
    assert profile(t, "u9")["status"] == "suspended" and _pay(t, "pi_x")["kind"] == "external"


# ---- A6: referral rewards and "has topped up" don't outlive a refunded top-up

def test_referral_rewards_wait_on_hold_and_a_refund_cancels_them(wallet, billing_cfg):
    t, fake, who = wallet
    billing_cfg(referral={"referrer": 250, "referred": 100}, dailyBonus=5)
    t.put_item(Item={"pk": "USER#main", "sk": "PROFILE", "paidCredits": 0, "bonusCredits": 0})  # never tops up
    code = credits.referral_code("main", {})
    assert credits.set_referrer("alt1", code) == ""
    _topup("alt1", "pi_alt1", 500, 500, "p5")
    assert [int(h["amount"]) for h in credits.pending("main")] == [250] and profile(t, "main")["bonusCredits"] == 0
    who["uid"] = "alt1"
    _refund(["pi_alt1"])
    assert not credits.pending("main") and not credits.pending("alt1")
    assert profile(t, "alt1")["hasToppedUp"] is False
    assert credits.daily_bonus("alt1", profile(t, "alt1")) == 0
    # the same card on the next throwaway account: it was used by an account main invited
    assert credits.set_referrer("alt2", code) == ""
    _topup("alt2", "pi_alt2", 500, 500, "p5")
    _release_holds_now(t, "main", "alt2")
    assert credits.release_due("main") == 0 and credits.release_due("alt2") == 0
    assert credits.set_referrer("alt1", code)  # a refunded account can't pick up an invite code to try again


def test_a_release_and_a_clawback_of_the_same_hold_cant_both_happen(wallet, monkeypatch):
    t, _, _ = wallet
    t.put_item(Item={"pk": "USER#u1", "sk": "PROFILE", "paidCredits": 0, "bonusCredits": 0})
    credits.hold("u1", 50, "referral", "Reward", "TOPUP#x")
    _release_holds_now(t, "u1")
    sk = credits.pending("u1")[0]["sk"]
    real_credit = credits.credit

    def clawed_back_first(*a, **k):  # cancel_hold lands between the release's read and its grant
        credits.cancel_hold("u1", sk)
        return real_credit(*a, **k)
    monkeypatch.setattr(credits, "credit", clawed_back_first)
    assert credits.release_due("u1") == 0
    assert profile(t)["bonusCredits"] == 0 and not credits.pending("u1")


# ---- A15, A16: the public webhook

def test_the_webhook_refuses_everything_while_its_secret_is_missing(wallet, monkeypatch):
    t, _, _ = wallet
    for m in (_lib("stripe_config"),):
        monkeypatch.setattr(m, "_cache", {"at": time.time(), "value": {"secretKey": "sk_test_x"}})
    assert handler.lambda_handler(signed_event(topup_event(), secret=""), None)["statusCode"] == 503
    assert not profile(t)


def test_bad_signatures_dont_fill_the_audit_log(wallet):
    t, _, _ = wallet
    for _ in range(3):
        assert handler.lambda_handler(signed_event(topup_event(), secret="whsec_wrong"), None)["statusCode"] == 400
    assert not [i for i in t.scan()["Items"] if i["pk"].startswith(("AUDIT#", "STRIPEEVT"))]


# ---- A18: every kind of use is itemised against its top-up

def test_spends_and_their_refunds_are_itemised_in_the_refund_dialog(wallet):
    t, _, _ = wallet
    _topup()
    credits.spend("u1", "example_action", 1, "p1", note="One small thing")
    credits.spend("u1", "example_action", 15, "j1", note="A bigger thing")
    credits.refund_spend("u1", "example_action", "j1", "it failed")
    row = call("/api/wallet/refunds")["purchases"][0]
    assert [(d["note"], d["amount"]) for d in row["deductions"]] == [
        ("One small thing", 1), ("A bigger thing", 15), ("Refund: it failed", -15)]
    assert (row["usedCredits"], row["refundable"]) == (1, 999)


# ---- A23: a double submit of the same charge

def test_a_double_submitted_charge_waits_for_the_first_answer(wallet, monkeypatch):
    t, fake, _ = wallet
    monkeypatch.setattr(sys.modules["routes.wallet"].time, "sleep", lambda s: None)
    t.put_item(Item={"pk": "USER#u1", "sk": "PROFILE", "userId": "u1", "stripeCustomerId": "cus_1", "paidCredits": 0, "bonusCredits": 0})
    calls, real = [], fake._pi_create

    def create_pi(params, options=None):
        calls.append(options["idempotency_key"])
        if len(calls) == 1:
            raise stripe.InvalidRequestError("There is currently another in-progress request using this key", None,
                                             code="idempotency_key_in_use", http_status=409)
        return real(params, options)
    fake.v1.payment_intents.create = create_pi
    out = call("/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-dup-0001"})
    assert out["status"] == "succeeded" and len(calls) == 2 and len(set(calls)) == 1 and profile(t)["paidCredits"] == 1000


# ---- Stripe timeouts: a hung call gives up inside the Lambda's 30 s, and no answer is never a refusal

def test_the_stripe_client_gives_up_well_inside_the_lambda_limit(monkeypatch):
    from api.lib import stripe_config as cfg
    monkeypatch.setattr(cfg, "_cache", {"at": time.time(), "value": {"secretKey": "sk_test_x"}})
    monkeypatch.setattr(cfg, "_http", {})
    made = []
    monkeypatch.setattr(cfg.stripe, "StripeClient", lambda key, **kw: made.append(kw) or NS(**kw))
    cfg.client()
    cfg.client()
    http, retries = made[0]["http_client"], made[0]["max_network_retries"]
    connect, read = http._timeout
    assert (retries + 1) * (connect + read) + 1 < 30 and retries <= 1
    assert made[1]["http_client"] is http  # one connection pool per warm Lambda


def test_the_test_stage_refuses_a_live_key(monkeypatch):
    from api.lib import stripe_config as cfg
    monkeypatch.setenv("STAGE", "test")
    monkeypatch.setattr(cfg, "_cache", {"at": time.time(), "value": {"secretKey": "sk_live_x"}})
    with pytest.raises(RuntimeError):
        cfg.client()


def test_a_charge_with_no_answer_from_stripe_says_processing_not_declined(wallet):
    t, fake, _ = wallet
    t.put_item(Item={"pk": "USER#u1", "sk": "PROFILE", "userId": "u1", "stripeCustomerId": "cus_1", "paidCredits": 0, "bonusCredits": 0})

    def hangs(params, options=None):
        raise stripe.APIConnectionError("Request timed out")
    fake.v1.payment_intents.create = hangs
    out = call("/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-slow-0001"}, status=504)
    assert "still being processed" in out["error"] and out["outcome"] == "unknown" and profile(t)["paidCredits"] == 0

    def declines(params, options=None):
        raise stripe.CardError("Your card was declined.", None, "card_declined", http_status=402)
    fake.v1.payment_intents.create = declines
    out = call("/api/wallet/charge", "POST", {"packId": "p10", "requestId": "req-slow-0001"}, status=402)
    assert out["outcome"] == "declined" and profile(t)["paidCredits"] == 0


# ---- the PaymentsSweep schedule

def test_the_sweep_settles_pending_refunds_for_every_user(wallet):
    t, fake, who = wallet
    for uid in ("u1", "u2"):
        who["uid"] = uid
        _topup(uid, f"pi_{uid}")
    fake.refund_error = stripe.APIConnectionError("Stripe timed out")
    for uid in ("u1", "u2"):
        who["uid"] = uid
        assert _refund([f"pi_{uid}"])["refunds"][0]["status"] == "pending"
    listed = t.query(KeyConditionExpression=Key("pk").eq("REFUNDPENDING"))["Items"]
    assert sorted(r["userId"] for r in listed) == ["u1", "u2"]
    fake.refund_error = None
    sweep = {"source": "aws.events", "detail-type": "Scheduled Event", "app_task": "payments-sweep"}
    assert handler.lambda_handler(sweep, None)["settled"] == 0  # too new: their own requests may still be running
    for uid in ("u1", "u2"):
        _age_pending(t, 120, uid)
    out = handler.lambda_handler(sweep, None)
    assert (out["users"], out["settled"], out["stillPending"], out["more"]) == (2, 2, 0, False)
    assert not _pending(t, "u1") and not _pending(t, "u2") and len(fake.refunds) == 2
    assert not t.query(KeyConditionExpression=Key("pk").eq("REFUNDPENDING"))["Items"]


def test_only_the_exact_scheduled_event_runs_the_sweep(wallet):
    # a Function URL request always has requestContext + headers: never the sweep, whatever its body says
    fake_req = {"source": "aws.events", "detail-type": "Scheduled Event", "app_task": "payments-sweep",
                "requestContext": {"http": {"method": "GET", "path": "/api/wallet"}}, "headers": {}}
    assert handler.lambda_handler(fake_req, None)["statusCode"] in (200, 401)
    assert "task" not in handler.lambda_handler(fake_req, None)

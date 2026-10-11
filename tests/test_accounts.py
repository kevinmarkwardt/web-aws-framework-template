"""Account standing: warnings expire, the 3rd active one bans; a ban is read-only, refunds the paid balance, forfeits the
bonus, cancels the subscription and blocks the cards; alerts in the user menu; a banned card used elsewhere is flagged."""

import datetime as dt
import sys

import pytest
from boto3.dynamodb.conditions import Key

import api.handler as handler

from .conftest import call, profile
from .stripe_fake import signed_event, topup_event


@pytest.fixture
def acct(stripe_fake, who, dynamodb_table, create_test_user, monkeypatch):
    create_test_user("u1", "u1@example.com")
    sent = []
    for name in ("lib.mail",):
        monkeypatch.setattr(sys.modules[name], "send", lambda to, subject, text: sent.append((to, subject)) or True)
    return dynamodb_table, stripe_fake, sent


def _accounts():
    return sys.modules["lib.accounts"]


def _audits(t, action):
    return [i for i in t.scan()["Items"] if i["pk"].startswith("AUDIT#") and i.get("action") == action]


def test_warnings_alert_and_the_third_bans(acct):
    t, _, sent = acct
    a = _accounts()
    a.add_warning("u1", "spam", "admin:a", ref="post-1")
    a.add_warning("u1", "spam again", "admin:a", ref="post-1")  # the same thing: still one warning
    assert a.active_warnings("u1") == 1 and ("u1@example.com", "A warning on your YourApp account") in sent
    a.add_warning("u1", "abuse", "admin:a", ref="post-2")
    assert profile(t).get("status", "active") == "active"
    a.add_warning("u1", "more abuse", "admin:a")
    p = profile(t)
    assert p["status"] == "banned" and p["bannedUntil"][:4] == str(dt.date.today().year + 1)
    assert [n["kind"] for n in call("/api/account/notes")["notes"]][0] == "banned"
    assert len(_audits(t, "warning.add")) == 3 and _audits(t, "user.ban")


def test_expired_and_removed_warnings_dont_count(acct):
    t, _, _ = acct
    a = _accounts()
    w = a.add_warning("u1", "one", "admin:a")
    t.update_item(Key={"pk": "USER#u1", "sk": w["sk"]}, UpdateExpression="SET expiresAt = :e",
                  ExpressionAttributeValues={":e": "2000-01-01T00:00:00+00:00"})
    w2 = a.add_warning("u1", "two", "admin:a", ref="x")
    assert a.active_warnings("u1") == 1
    assert a.remove_warning("u1", w2["sk"], "admin:a", "mistake") and a.active_warnings("u1") == 0


def test_a_ban_refunds_paid_forfeits_bonus_cancels_the_plan_and_blocks_cards(acct):
    t, fake, _ = acct
    assert handler.lambda_handler(signed_event(topup_event("u1", "pi_1", 2000, 2200, "p20")), None)["statusCode"] == 200
    sys.modules["lib.credits"].grant("u1", 300, "gift", "a gift", "GIFT#1")
    fake.add_sub("sub_1")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #p = :p, stripeSubscriptionId = :s, stripeCustomerId = :c",
                  ExpressionAttributeNames={"#p": "plan"}, ExpressionAttributeValues={":p": "pro", ":s": "sub_1", ":c": "cus_1"})
    out = _accounts().ban("u1", "fraud", "admin:a")
    p = profile(t)
    assert out["refundedCents"] == 2000 and out["subscriptionCancelled"] is True
    assert (p["paidCredits"], p["bonusCredits"], p["plan"], p["status"]) == (0, 0, "free", "banned")
    assert fake.refunds[0]["amount"] == 2000 and fake.cancelled_subs == ["sub_1"]
    assert t.get_item(Key={"pk": "BANNED#CARD", "sk": "fp_card_1"})["Item"]["userId"] == "u1"


def test_a_banned_account_is_read_only(acct):
    t, _, _ = acct
    call("/api/items", "POST", {"name": "before"}, status=201)
    _accounts().ban("u1", "abuse", "admin:a")
    call("/api/items")  # reading still works
    assert call("/api/items", "POST", {"name": "after"}, status=403)["code"] == "ACCOUNT_RESTRICTED"
    acct_body = call("/api/account")
    assert acct_body["status"] == "banned" and acct_body["bannedUntil"]
    _accounts().set_status("u1", "active", "appeal accepted", "admin:a")
    call("/api/items", "POST", {"name": "after"}, status=201)
    assert "bannedUntil" not in profile(t)


def test_a_banned_card_used_on_another_account_emails_the_admin(acct, monkeypatch):
    t, _, sent = acct
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    t.put_item(Item={"pk": "BANNED#CARD", "sk": "fp_card_1", "userId": "old-user"})
    handler.lambda_handler(signed_event(topup_event("u1", "pi_1", 1000, 1000, "p10")), None)
    assert any(to == "admin@example.com" and "banned card" in subj for to, subj in sent)
    assert _audits(t, "card.banned_card_used")


def test_alerts_list_and_dismiss_only_your_own(acct, who):
    t, _, _ = acct
    notes = sys.modules["lib.notes"]
    n = notes.add("u1", "info", "Hello", "A message")
    notes.add("u2", "info", "Not yours", "")
    assert [x["title"] for x in call("/api/account/notes")["notes"]] == ["Hello"]
    who["uid"] = "u2"
    call("/api/account/notes/dismiss", "POST", {"id": n["sk"]}, status=404)  # u1's alert, as u2: nothing changes
    who["uid"] = "u1"
    call("/api/account/notes/dismiss", "POST", {"id": n["sk"]})
    assert call("/api/account/notes")["notes"] == []
    expired = notes.add("u1", "info", "Old", "")
    t.update_item(Key={"pk": "USER#u1", "sk": expired["sk"]}, UpdateExpression="SET #t = :t", ExpressionAttributeNames={"#t": "ttl"},
                  ExpressionAttributeValues={":t": 1})
    assert call("/api/account/notes")["notes"] == []


def test_admin_balance_adjustments_are_audited_and_never_below_zero(acct):
    t, _, _ = acct
    payments = sys.modules["lib.payments"]
    payments.adjust_balance("u1", 500, "goodwill", "admin:a")
    assert profile(t)["bonusCredits"] == 500
    with pytest.raises(payments.AdjustError):
        payments.adjust_balance("u1", -600, "correction", "admin:a")
    payments.adjust_balance("u1", -200, "correction", "admin:a")
    assert profile(t)["bonusCredits"] == 300 and len(_audits(t, "balance.adjust")) == 2
    rows = t.query(KeyConditionExpression=Key("pk").eq("USER#u1") & Key("sk").begins_with("TX#ADJ#"))["Items"]
    assert sorted(int(r["amount"]) for r in rows) == [-200, 500]


def test_log_reads_for_the_admin_site(acct):
    t, _, _ = acct
    logs = sys.modules["lib.logs"]
    handler.lambda_handler(signed_event(topup_event("u1", "pi_1", 1000, 1000, "p10")), None)
    day = dt.datetime.now(dt.timezone.utc).date().isoformat()
    assert [w["type"] for w in logs.webhooks(day)] == ["payment_intent.succeeded"]
    assert any(c["op"] == "payment_intents.retrieve" for c in logs.stripe_calls(day, user_id="u1"))
    payments = sys.modules["lib.payments"]
    assert [p["pk"] for p in payments.by_day(day)] == ["PAY#pi_1"] and payments.detail("pi_1")["refunds"] == []

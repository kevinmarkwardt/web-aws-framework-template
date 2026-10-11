"""credits.spend, the API apps charge through, can't lose or create money: once per ref, atomic with the app's own
records, paid first, never below zero under races, refused for restricted accounts (adapted from Never Ending Gallery's
review branch, A7/A11/A20)."""

import pytest
from boto3.dynamodb.conditions import Key

from api.lib import credits, db

from .conftest import profile


@pytest.fixture
def funded(dynamodb_table, stripe_fake):
    t = dynamodb_table
    t.put_item(Item={"pk": "USER#u1", "sk": "PROFILE", "userId": "u1", "paidCredits": 300, "bonusCredits": 200})
    return t


def _tx(t, uid="u1"):
    return t.query(KeyConditionExpression=Key("pk").eq(f"USER#{uid}") & Key("sk").begins_with("TX#"))["Items"]


def test_the_apps_record_is_written_in_the_same_transaction_with_the_split(funded):
    t = funded

    def job(paid, bonus):  # the app's own record, carrying what paid for it (A20: never written after the charge)
        return [db.tx_put({"pk": "JOB#1", "sk": "JOB", "userId": "u1", "paid": paid, "bonus": bonus}, "attribute_not_exists(pk)")]
    out = credits.spend("u1", "example_action", 400, "job-1", extra=job)
    assert (out["paid"], out["bonus"]) == (300, 100)
    rec = t.get_item(Key={"pk": "JOB#1", "sk": "JOB"})["Item"]
    assert (rec["paid"], rec["bonus"]) == (300, 100)


def test_a_failed_app_condition_charges_nothing(funded):
    t = funded
    t.put_item(Item={"pk": "JOB#1", "sk": "JOB"})
    with pytest.raises(credits.AlreadyDone):
        credits.spend("u1", "example_action", 50, "job-1", extra=[db.tx_put({"pk": "JOB#1", "sk": "JOB"}, "attribute_not_exists(pk)")])
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (300, 200) and not _tx(t)


def test_a_refund_puts_each_part_back_where_it_came_from(funded):
    t = funded
    credits.spend("u1", "example_action", 400, "r1")
    assert (profile(t)["paidCredits"], profile(t)["bonusCredits"]) == (0, 100)
    assert credits.refund_spend("u1", "example_action", "r1")
    assert (profile(t)["paidCredits"], profile(t)["bonusCredits"]) == (300, 200)


def test_a_stale_read_cant_take_the_balance_below_zero(funded, monkeypatch):
    """Two requests read the same balance; the second one's conditional write is refused and it reads again."""
    t = funded
    real = credits.profile
    first = {"stale": real("u1")}

    def stale_once(uid):
        if first.get("stale") is not None:
            snap, first["stale"] = first["stale"], None
            credits.debit("u1", 450, "spend", "the other request", key="SPEND#other")  # lands after our read
            return snap
        return real(uid)
    monkeypatch.setattr(credits, "profile", stale_once)
    with pytest.raises(credits.InsufficientCredits):
        credits.spend("u1", "example_action", 400, "mine")
    p = profile(t)
    assert (p["paidCredits"], p["bonusCredits"]) == (0, 50)


def test_suspended_and_banned_accounts_cant_spend(funded):
    t = funded
    for status, until in (("suspended", None), ("banned", "2099-01-01T00:00:00+00:00")):
        t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #s = :s, bannedUntil = :u",
                      ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":s": status, ":u": until})
        with pytest.raises(credits.Blocked):
            credits.spend("u1", "example_action", 10, f"while-{status}")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET bannedUntil = :u",
                  ExpressionAttributeValues={":u": "2000-01-01T00:00:00+00:00"})  # a ban whose year has passed
    assert credits.spend("u1", "example_action", 10, "after-the-ban")["amount"] == 10


def test_spend_is_off_without_the_credits_module(funded, billing_mode):
    billing_mode("subscriptions")
    with pytest.raises(ValueError):
        credits.spend("u1", "example_action", 10, "x")

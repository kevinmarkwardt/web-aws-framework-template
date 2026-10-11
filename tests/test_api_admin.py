"""Admin API (api/admin_handler.py + routes/admin.py): overview, users (list-index, never a scan), user actions with a
required reason and an audit row, payments, Stripe log, webhooks, audit log, config, items, health, tasks."""

import datetime as dt
import sys

import pytest
from boto3.dynamodb.conditions import Key

import api.handler as handler

from .conftest import admin_call, profile
from .stripe_fake import signed_event, topup_event

TODAY = dt.datetime.now(dt.timezone.utc).date().isoformat()


@pytest.fixture
def site(stripe_fake, admin_who, dynamodb_table, create_test_user, monkeypatch):
    create_test_user("u1", "buyer@example.com", name="Buyer One", created_at="2026-09-20T00:00:00+00:00")
    sent = []
    for name in ("lib.mail",):
        monkeypatch.setattr(sys.modules[name], "send", lambda to, subject, text: sent.append((to, subject)) or True)
    return dynamodb_table, stripe_fake, admin_who


def _topup(user="u1", n=1, paid=2000, credit=2200):
    assert handler.lambda_handler(signed_event(topup_event(user, f"pi_{user}_{n}", paid, credit, "p20")), None)["statusCode"] == 200


def _act(uid, action, body, status=200):
    return admin_call(f"/api/admin/users/{uid}/{action}", "POST", body, status=status)


def _audits(t, action):
    return [i for i in t.query(KeyConditionExpression=Key("pk").eq(f"AUDIT#{TODAY}"))["Items"] if i["action"] == action]


def test_me_says_who_and_what_the_site_sells(site):
    me = admin_call("/api/admin/me")
    assert me["userId"] == "admin1" and me["billingMode"] == "both" and me["creditName"] == "credits"
    assert [p["id"] for p in me["plans"]] == ["free", "starter", "pro"] and me["packs"] and me["supportTopics"]


def test_overview_counts_money_users_and_subscriptions(site):
    t, _, _ = site
    _topup()
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #p = :p, stripeSubscriptionId = :s",
                  ExpressionAttributeNames={"#p": "plan"}, ExpressionAttributeValues={":p": "starter", ":s": "sub_1"})
    ov = admin_call("/api/admin/overview", qs={"days": "7"})
    assert ov["users"]["total"] == 2 and ov["users"]["admins"] == 1 and ov["users"]["active"] == 2
    assert ov["payments"]["count"] == 1 and ov["payments"]["paidCents"] == 2000 and ov["payments"]["feeCents"] == 88
    assert ov["payments"]["byKind"]["topup"]["count"] == 1 and ov["payments"]["disputed"] == 0
    assert ov["outstanding"]["paidCredits"] == 2000 and ov["outstanding"]["bonusCredits"] == 200
    assert ov["subscriptions"]["active"] == 1 and ov["subscriptions"]["mrrUsd"] == 9
    assert ov["subscriptions"]["byPlan"] == {"free": 1, "starter": 1}
    admin_call("/api/admin/overview", qs={"days": "0"}, status=400)


def test_overview_by_billing_mode(site, billing_mode):
    billing_mode("none")
    ov = admin_call("/api/admin/overview")
    assert "payments" not in ov and "outstanding" not in ov and "subscriptions" not in ov
    billing_mode("subscriptions")
    ov = admin_call("/api/admin/overview")
    assert "payments" in ov and "outstanding" not in ov and "subscriptions" in ov


def test_users_list_pages_from_the_index_without_scanning(site, create_test_user, monkeypatch):
    t, _, _ = site
    for i in range(55):
        create_test_user(f"x{i:02d}", f"x{i:02d}@example.com", created_at=f"2026-08-01T00:00:{i:02d}+00:00")
    real_scan = t.meta.client.scan
    monkeypatch.setattr(t.meta.client, "scan", lambda **kw: pytest.fail("the users tab scanned the table"))
    first = admin_call("/api/admin/users")
    assert len(first["users"]) == 50 and first["cursor"]
    assert first["users"][0]["userId"] == "u1"  # newest first (2026-09-20)
    rest = admin_call("/api/admin/users", qs={"cursor": first["cursor"]})
    assert len(rest["users"]) == 7 and rest["cursor"] is None  # 55 + u1 + admin1
    assert {u["userId"] for u in first["users"] + rest["users"]} >= {"u1", "admin1", "x00", "x54"}
    assert [u["email"] for u in admin_call("/api/admin/users", qs={"q": "BUYER"})["users"]] == ["buyer@example.com"]
    assert [u["userId"] for u in admin_call("/api/admin/users", qs={"q": "x07"})["users"]] == ["x07"]  # exact id
    assert admin_call("/api/admin/users", qs={"status": "banned"})["users"] == []
    admin_call("/api/admin/users", qs={"cursor": "not-a-cursor"}, status=400)
    admin_call("/api/admin/users", qs={"status": "weird"}, status=400)
    monkeypatch.setattr(t.meta.client, "scan", real_scan)


def test_user_detail_has_profile_balance_history_payments_and_more(site):
    _topup()
    d = admin_call("/api/admin/users/u1")
    assert d["user"]["email"] == "buyer@example.com" and d["user"]["paidCredits"] == 2000 and d["user"]["cards"] == 1
    assert [p["paidCents"] for p in d["payments"]] == [2000] and d["history"][0]["kind"] == "topup"
    assert d["refundable"]["all"]["refundable"] == 2000 and d["subscription"]["plan"] == "free"
    assert d["warnings"] == [] and d["notes"] == [] and d["pending"] == []
    admin_call("/api/admin/users/nobody", status=404)


def test_every_action_needs_a_reason_and_is_audited(site):
    t, fake, _ = site
    for action in ("ban", "unban", "suspend", "warn", "remove-warning", "adjust-balance", "refund-card", "admin"):
        assert _act("u1", action, {}, status=400)["code"] == "REASON_REQUIRED", action
    _act("u1", "suspend", {"reason": "looking into a chargeback"})
    assert profile(t)["status"] == "suspended"
    _act("u1", "unban", {"reason": "cleared"})
    assert profile(t)["status"] == "active"
    rows = _audits(t, "user.suspended") + _audits(t, "user.active")
    assert {r["actor"] for r in rows} == {"admin:admin1"} and {r["target"] for r in rows} == {"user:u1"}
    admin_call("/api/admin/users/u1/frobnicate", "POST", {"reason": "x"}, status=404)


def test_admins_cant_lock_themselves_out(site):
    for action in ("ban", "suspend", "admin"):
        _act("admin1", action, {"reason": "oops", "isAdmin": False}, status=400)


def test_card_refund_takes_unused_paid_units(site):
    t, fake, _ = site
    _topup()
    sys.modules["lib.credits"].spend("u1", "example_action", units=500, ref="r1")
    out = _act("u1", "refund-card", {"reason": "customer asked", "amount": "max"})
    assert out["refunded"] == 1500 and fake.refunds[0]["amount"] == 1500 and fake.refunds[0]["idempotency_key"]
    p = profile(t)
    assert p["paidCredits"] == 0
    assert t.get_item(Key={"pk": "PAY#pi_u1_1", "sk": "PAY"})["Item"]["refundedCents"] == 1500
    assert _act("u1", "refund-card", {"reason": "again", "amount": 100}, status=400)["error"]
    _act("u1", "refund-card", {"reason": "bad", "amount": -5}, status=400)
    assert any(a["actor"] == "admin:admin1" for a in _audits(t, "refund.card"))


def test_three_warnings_ban_and_refund(site):
    t, fake, _ = site
    _topup()
    for i in range(2):
        assert _act("u1", "warn", {"reason": f"spam {i}"})["status"] == "active"
    out = _act("u1", "warn", {"reason": "spam 3"})
    assert out["status"] == "banned" and out["activeWarnings"] == 3
    assert fake.refunds and fake.refunds[0]["amount"] == 2000
    d = admin_call("/api/admin/users/u1")
    assert d["user"]["status"] == "banned" and len(d["warnings"]) == 3
    removed = _act("u1", "remove-warning", {"reason": "mistake", "warningSk": d["warnings"][0]["sk"]})
    assert removed["activeWarnings"] == 2
    _act("u1", "remove-warning", {"reason": "mistake", "warningSk": "WARN#nope"}, status=404)


def test_ban_with_days_and_balance_adjustments(site):
    t, _, _ = site
    out = _act("u1", "ban", {"reason": "abuse", "days": 30})
    assert out["bannedUntil"][:10] == (dt.date.today() + dt.timedelta(days=30)).isoformat()
    _act("u1", "ban", {"reason": "abuse", "days": 0}, status=400)
    _act("u1", "unban", {"reason": "appeal"})
    assert _act("u1", "adjust-balance", {"reason": "goodwill", "amount": 300}) == {"credits": 300, "paidCredits": 0, "bonusCredits": 300}
    assert "at most 300" in _act("u1", "adjust-balance", {"reason": "fix", "amount": -400}, status=400)["error"]
    _act("u1", "adjust-balance", {"reason": "fix", "amount": 0}, status=400)
    assert _audits(t, "balance.adjust")


def test_credits_actions_are_off_without_the_wallet(site, billing_mode):
    billing_mode("subscriptions")
    _act("u1", "adjust-balance", {"reason": "x", "amount": 5}, status=404)
    _act("u1", "refund-card", {"reason": "x"}, status=404)
    assert "refundable" not in admin_call("/api/admin/users/u1")


def test_granting_admin_sets_the_group_and_the_flag(site, monkeypatch):
    t, _, _ = site
    calls = []

    class FakeCognito:
        def list_users(self, **kw):
            return {"Users": [{"Username": "cog-u1"}]} if 'sub = "u1"' in kw["Filter"] else {"Users": []}

        def admin_add_user_to_group(self, **kw):
            calls.append(("add", kw["Username"], kw["GroupName"]))

        def admin_remove_user_from_group(self, **kw):
            calls.append(("remove", kw["Username"], kw["GroupName"]))
    for name in ("lib.admins", "api.lib.admins"):
        monkeypatch.setattr(sys.modules[name], "_cognito", lambda: FakeCognito())
    _act("u1", "admin", {"reason": "co-admin", "isAdmin": True})
    assert profile(t)["isAdmin"] is True and calls == [("add", "cog-u1", "admins")]
    _act("u1", "admin", {"reason": "left", "isAdmin": False})
    assert profile(t)["isAdmin"] is False and calls[-1] == ("remove", "cog-u1", "admins")
    _act("u1", "admin", {"reason": "x", "isAdmin": "yes"}, status=400)
    t.put_item(Item={"pk": "USER#t-bob", "sk": "PROFILE", "userId": "t-bob", "listPk": "USER", "createdAt": "2026-01-02"})
    assert "Cognito" in _act("t-bob", "admin", {"reason": "x", "isAdmin": True}, status=400)["error"]
    assert len(_audits(t, "user.admin")) == 2


def test_payments_detail_disputes_stripe_log_webhooks_and_audit(site):
    t, fake, _ = site
    _topup()
    day = admin_call("/api/admin/payments")
    assert day["day"] == TODAY and [p["paymentIntent"] for p in day["payments"]] == ["pi_u1_1"] and day["totals"]["paidCents"] == 2000
    fake.fail_refunds = True  # Stripe refuses: logged as a failed call, the units are back
    _act("u1", "refund-card", {"reason": "x", "amount": 100}, status=400)
    failed = admin_call("/api/admin/stripe-log", qs={"failed": "1"})["entries"]
    assert failed and failed[0]["op"] == "refunds.create" and profile(t)["paidCredits"] == 2000
    assert admin_call("/api/admin/stripe-log", qs={"user": "u1"})["entries"]
    dp = {"id": "evt_d", "object": "event", "type": "charge.dispute.created", "api_version": "2024-06-20",
          "data": {"object": {"id": "dp_1", "object": "dispute", "payment_intent": "pi_u1_1", "amount": 2000, "reason": "fraudulent",
                              "status": "needs_response", "evidence_details": {"due_by": 1790000000}}}}
    assert handler.lambda_handler(signed_event(dp), None)["statusCode"] == 200
    detail = admin_call("/api/admin/payments/pi_u1_1")
    assert detail["disputed"] is True and detail["disputes"][0]["reason"] == "fraudulent"
    assert admin_call("/api/admin/users/u1")["user"]["status"] == "suspended"
    admin_call("/api/admin/payments/pi_nope", status=404)
    hooks = admin_call("/api/admin/webhooks")["entries"]
    assert {h["type"] for h in hooks} >= {"payment_intent.succeeded", "charge.dispute.created"}
    assert admin_call(f"/api/admin/webhooks/{hooks[0]['eventId']}")["status"] == "ok"
    audit = admin_call("/api/admin/audit", qs={"actor": "admin:admin1"})["entries"]
    assert audit and {a["actor"] for a in audit} == {"admin:admin1"}
    admin_call("/api/admin/audit", qs={"day": "yesterday"}, status=400)


def test_money_tabs_are_off_without_billing(site, billing_mode):
    billing_mode("none")
    for path in ("/api/admin/payments", "/api/admin/payments/pi_1", "/api/admin/stripe-log", "/api/admin/webhooks",
                 "/api/admin/config/stripe"):
        admin_call(path, status=404)
    assert "payments" not in admin_call("/api/admin/users/u1")


def test_config_get_put_is_audited(site):
    t, _, _ = site
    assert admin_call("/api/admin/config")["planLimits"]["free"] == 10
    assert admin_call("/api/admin/config", "PUT", {"maintenanceMode": True})["maintenanceMode"] is True
    assert _audits(t, "config.update")
    admin_call("/api/admin/me")  # the admin API never applies maintenance mode


def test_stripe_price_overrides(site):
    t, _, _ = site
    got = admin_call("/api/admin/config/stripe")
    assert got["mode"] == "test" and got["webhookSecret"] is True and got["priceOverrides"] == {"starter": "", "pro": ""}
    out = admin_call("/api/admin/config/stripe", "PUT", {"priceOverrides": {"starter": "price_abc"}})
    assert out["priceOverrides"]["starter"] == "price_abc"
    assert t.get_item(Key={"pk": "CONFIG", "sk": "STRIPE"})["Item"]["starterPriceId"] == "price_abc"
    admin_call("/api/admin/config/stripe", "PUT", {"priceOverrides": {"starter": ""}})
    assert "starterPriceId" not in t.get_item(Key={"pk": "CONFIG", "sk": "STRIPE"})["Item"]
    admin_call("/api/admin/config/stripe", "PUT", {"priceOverrides": {"starter": "sk_live_oops"}}, status=400)
    admin_call("/api/admin/config/stripe", "PUT", {"priceOverrides": {"gold": "price_x"}}, status=400)


def test_items_tab_lists_across_users_and_deletes_with_a_reason(site, create_test_item, monkeypatch):
    t, _, _ = site
    create_test_item("u1", "item1", "First")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET itemCount = :n", ExpressionAttributeValues={":n": 1})
    monkeypatch.setattr(t.meta.client, "scan", lambda **kw: pytest.fail("the items tab scanned the table"))
    rows = admin_call("/api/admin/items")["items"]
    assert [(r["itemId"], r["email"]) for r in rows] == [("item1", "buyer@example.com")]
    admin_call("/api/admin/items/u1/item1", "DELETE", {}, status=400)
    admin_call("/api/admin/items/u1/item1", "DELETE", {"reason": "spam"})
    assert admin_call("/api/admin/items")["items"] == [] and profile(t)["itemCount"] == 0
    assert _audits(t, "item.delete")


def test_health_reads_this_stages_resources(site, monkeypatch):
    monkeypatch.setenv("SES_FROM_EMAIL", "noreply@yourapp.com")
    h = admin_call("/api/admin/health")
    assert h["dynamodb"]["table"] == "yourapp-test" and {i["name"] for i in h["dynamodb"]["indexes"]} >= {"list-index"}
    assert "ses" in h and "lambda" in h and h["app"] == {"failedWebhooksToday": 0, "pendingRefunds": 0, "openSupport": 0}


def test_run_the_payments_sweep_now(site):
    assert admin_call("/api/admin/actions/payments-sweep", "POST", {}) == {"users": 0, "settled": 0, "stillPending": 0, "more": False}
    admin_call("/api/admin/actions/rm-rf", "POST", {}, status=404)

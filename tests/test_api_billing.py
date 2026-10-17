"""Subscriptions: Checkout, portal, plan changes and cancel (every route signed in, restricted accounts refused,
idempotency keys), and the webhook side: checkout completion, subscription updates, invoice.paid / payment_failed with a
grace period, exactly-once events. Stripe is faked (tests/stripe_fake.py)."""

import datetime as dt

import pytest

import api.handler as handler
from api.lib import config

from .conftest import call, profile
from .stripe_fake import event, signed_event


@pytest.fixture
def subs(stripe_fake, who, dynamodb_table, create_test_user):
    create_test_user("u1", "u1@example.com")
    return dynamodb_table, stripe_fake


def _hook(evt, status=200):
    resp = handler.lambda_handler(signed_event(evt), None)
    assert resp["statusCode"] == status, resp
    return resp


def _on_plan(t, plan="starter", sub="sub_1", customer="cus_1", **extra):
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #p = :p, stripeSubscriptionId = :s, stripeCustomerId = :c",
                  ExpressionAttributeNames={"#p": "plan"}, ExpressionAttributeValues={":p": plan, ":s": sub, ":c": customer})
    for k, v in extra.items():
        t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression=f"SET {k} = :v", ExpressionAttributeValues={":v": v})


# ---- routes

def test_checkout_uses_the_plan_price_a_customer_and_an_idempotency_key(subs):
    t, fake = subs
    url = call("/api/billing/checkout", "POST", {"plan": "pro"})["url"]
    assert url.startswith("https://checkout.stripe.com/")
    s = fake.sessions[0]
    assert s["mode"] == "subscription" and s["line_items"] == [{"price": "price_pro", "quantity": 1}] and s["customer"] == "cus_1"
    assert s["metadata"] == {"userId": "u1", "plan": "pro"} and s["subscription_data"]["metadata"]["plan"] == "pro"
    assert s["idempotency_key"].startswith("yourapp-subcheckout-u1-pro-") and profile(t)["stripeCustomerId"] == "cus_1"
    call("/api/billing/checkout", "POST", {"plan": "enterprise"}, status=400)
    call("/api/billing/checkout", "POST", {"plan": "free"}, status=400)


def test_checkout_is_refused_with_a_live_subscription_and_clears_a_stale_one(subs):
    t, fake = subs
    fake.add_sub("sub_1")
    _on_plan(t)
    assert call("/api/billing/checkout", "POST", {"plan": "pro"}, status=409)["code"] == "HAS_SUBSCRIPTION"
    fake.subs["sub_1"]["status"] = "canceled"
    call("/api/billing/checkout", "POST", {"plan": "pro"})
    assert "stripeSubscriptionId" not in profile(t)


def test_checkout_without_prices_set_up_is_a_503(subs):
    _, fake = subs
    fake.prices.clear()
    call("/api/billing/checkout", "POST", {"plan": "starter"}, status=503)


def test_an_admin_price_override_wins_over_the_lookup_key(subs):
    t, fake = subs
    t.put_item(Item={"pk": "CONFIG", "sk": "STRIPE", "starterPriceId": "price_custom"})
    call("/api/billing/checkout", "POST", {"plan": "starter"})
    assert fake.sessions[0]["line_items"][0]["price"] == "price_custom"


def test_change_plan_in_place_with_proration_and_a_key(subs):
    t, fake = subs
    fake.add_sub("sub_1")
    _on_plan(t)
    out = call("/api/billing/change-plan", "POST", {"plan": "pro"})
    assert out == {"action": "done", "plan": "pro"} and profile(t)["plan"] == "pro"
    u = fake.updated_subs[0]
    assert u["items"] == [{"id": "si_sub_1", "price": "price_pro"}] and u["proration_behavior"] == "create_prorations"
    assert u["idempotency_key"].startswith("yourapp-planchange-sub_1-pro-")


def test_change_plan_without_a_subscription_goes_through_checkout(subs):
    assert call("/api/billing/change-plan", "POST", {"plan": "starter"}) == {"action": "checkout"}


def test_downgrade_and_cancel_check_the_item_limits(subs):
    t, fake = subs
    fake.add_sub("sub_1", price="price_pro")
    _on_plan(t, "pro")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET itemCount = :n", ExpressionAttributeValues={":n": 150})
    assert call("/api/billing/change-plan", "POST", {"plan": "starter"}, status=409)["code"] == "PLAN_LIMIT"
    call("/api/billing/cancel", "POST", status=409)
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET itemCount = :n", ExpressionAttributeValues={":n": 3})
    assert call("/api/billing/cancel", "POST") == {"action": "done", "plan": "free"}
    assert fake.cancelled_subs == ["sub_1"] and profile(t)["plan"] == "free" and "stripeSubscriptionId" not in profile(t)
    call("/api/billing/cancel", "POST", status=400)  # already free


def test_portal_needs_a_billing_account(subs):
    t, fake = subs
    call("/api/billing/portal", "POST", status=400)
    _on_plan(t)
    assert call("/api/billing/portal", "POST")["url"].startswith("https://billing.stripe.com/")
    assert fake.portals[0]["customer"] == "cus_1"


def test_restricted_accounts_cant_subscribe_or_change_plans(subs):
    t, fake = subs
    fake.add_sub("sub_1")
    _on_plan(t)
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #s = :s", ExpressionAttributeNames={"#s": "status"},
                  ExpressionAttributeValues={":s": "suspended"})
    for path, body in (("/api/billing/checkout", {"plan": "pro"}), ("/api/billing/change-plan", {"plan": "pro"}),
                       ("/api/billing/cancel", None), ("/api/billing/portal", None)):
        assert call(path, "POST", body, status=403)["code"] == "ACCOUNT_RESTRICTED", path
    assert not fake.sessions and not fake.updated_subs and not fake.cancelled_subs


def test_every_billing_route_needs_sign_in(dynamodb_table, stripe_fake):
    """The lesson of A10: subscription routes reachable by anyone could open sessions on the Stripe account."""
    for path in ("/api/billing/checkout", "/api/billing/portal", "/api/billing/change-plan", "/api/billing/cancel"):
        assert handler.lambda_handler({"requestContext": {"http": {"method": "POST", "path": path}}, "headers": {},
                                       "body": '{"plan": "pro"}'}, None)["statusCode"] == 401, path
    assert not stripe_fake.sessions and not stripe_fake.portals


# ---- webhooks

def _session(plan="starter", sub="sub_1", user="u1"):
    return {"id": "cs_1", "object": "checkout.session", "mode": "subscription", "client_reference_id": user, "customer": "cus_1",
            "subscription": sub, "metadata": {"userId": user, "plan": plan}}


def _sub_obj(status="active", lookup="yourapp_plan_pro", sub="sub_1"):
    return {"id": sub, "object": "subscription", "customer": "cus_1", "status": status,
            "items": {"data": [{"id": "si_1", "price": {"id": "price_pro", "lookup_key": lookup}}]}}


def _invoice(inv="in_1", sub="sub_1", paid=900, new_api=True):
    obj = {"id": inv, "object": "invoice", "customer": "cus_1", "amount_paid": paid, "created": 1790000000,
           "hosted_invoice_url": "https://invoice.stripe.com/i/1"}
    if new_api:
        obj["parent"] = {"subscription_details": {"subscription": sub}}
        obj["payments"] = {"data": [{"payment": {"payment_intent": f"pi_{inv}"}}]}
    else:
        obj.update(subscription=sub, payment_intent=f"pi_{inv}")
    return obj


def test_checkout_completion_starts_the_plan_once(subs):
    t, fake = subs
    evt = event("checkout.session.completed", _session("pro"))
    _hook(evt)
    p = profile(t)
    assert (p["plan"], p["stripeSubscriptionId"], p["stripeCustomerId"]) == ("pro", "sub_1", "cus_1")
    assert '"duplicate": true' in _hook(evt)["body"]  # the same event again: claimed once


def test_a_second_checkout_cancels_the_previous_subscription(subs):
    t, fake = subs
    fake.add_sub("sub_old")
    _on_plan(t, "starter", "sub_old")
    _hook(event("checkout.session.completed", _session("pro", "sub_new")))
    assert fake.cancelled_subs == ["sub_old"] and profile(t)["stripeSubscriptionId"] == "sub_new"


def test_subscription_updates_follow_the_price_lookup_key_and_ignore_old_subscriptions(subs):
    t, _ = subs
    _on_plan(t, "starter")
    _hook(event("customer.subscription.updated", _sub_obj("active", "yourapp_plan_pro"), "evt_u1"))
    assert profile(t)["plan"] == "pro"
    _hook(event("customer.subscription.updated", _sub_obj("active", "yourapp_plan_starter", sub="sub_other"), "evt_u2"))
    assert profile(t)["plan"] == "pro"  # not the account's current subscription
    _hook(event("customer.subscription.updated", _sub_obj("unpaid"), "evt_u3"))
    assert profile(t)["plan"] == "free"


def test_subscription_deleted_goes_back_to_free(subs):
    t, _ = subs
    _on_plan(t, "pro")
    _hook(event("customer.subscription.deleted", _sub_obj("canceled")))
    p = profile(t)
    assert p["plan"] == "free" and "stripeSubscriptionId" not in p


def test_a_failed_renewal_keeps_the_plan_through_the_grace_period(subs):
    t, _ = subs
    _on_plan(t, "pro")
    _hook(event("invoice.payment_failed", _invoice("in_9"), "evt_f1"))
    _hook(event("invoice.payment_failed", _invoice("in_9"), "evt_f2"))  # Stripe's retry fails again: one alert
    p = profile(t)
    assert p["paymentFailedAt"] and p["subscriptionStatus"] == "past_due"
    acct = call("/api/account")
    assert acct["plan"] == "pro" and acct["subscription"]["graceUntil"] > acct["subscription"]["paymentFailedAt"]
    alerts = call("/api/account/notes")["notes"]
    assert [n["title"] for n in alerts] == ["Subscription payment failed"]
    # past_due from Stripe changes nothing more; the grace runs from the first failure
    _hook(event("customer.subscription.updated", _sub_obj("past_due"), "evt_pd"))
    assert profile(t)["paymentFailedAt"] == p["paymentFailedAt"] and profile(t)["plan"] == "pro"
    # the grace runs out: free limits apply until a paid invoice
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=config.BILLING["graceDays"] + 1)).isoformat()
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET paymentFailedAt = :o", ExpressionAttributeValues={":o": old})
    assert call("/api/account")["plan"] == "free" and call("/api/account")["itemLimit"] == 10
    _hook(event("invoice.paid", _invoice("in_9"), "evt_p1"))
    p = profile(t)
    assert "paymentFailedAt" not in p and p["subscriptionStatus"] == "active" and call("/api/account")["plan"] == "pro"


def test_a_paid_invoice_is_recorded_as_a_payment_for_both_api_shapes(subs):
    t, _ = subs
    _on_plan(t, "starter")
    _hook(event("invoice.paid", _invoice("in_1", new_api=True), "evt_a"))
    _hook(event("invoice.paid", _invoice("in_2", new_api=False), "evt_b"))
    for pi in ("pi_in_1", "pi_in_2"):
        pay = t.get_item(Key={"pk": f"PAY#{pi}", "sk": "PAY"})["Item"]
        assert (pay["kind"], pay["userId"], pay["paidCents"], pay["plan"]) == ("subscription", "u1", 900, "starter")
    assert not call("/api/wallet/refunds")["purchases"]  # subscription payments are never wallet top-ups


def test_a_dashboard_refund_of_a_subscription_payment_takes_no_wallet_units(subs):
    t, _ = subs
    _on_plan(t, "starter")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET paidCredits = :p, bonusCredits = :z",
                  ExpressionAttributeValues={":p": 500, ":z": 0})
    _hook(event("invoice.paid", _invoice("in_1"), "evt_a"))
    _hook(event("charge.refunded", {"id": "ch_1", "object": "charge", "payment_intent": "pi_in_1", "amount_refunded": 900}))
    assert profile(t)["paidCredits"] == 500
    assert t.get_item(Key={"pk": "PAY#pi_in_1", "sk": "PAY"})["Item"]["refundedCents"] == 900


def test_a_dispute_on_a_subscription_payment_suspends_the_account(subs):
    t, _ = subs
    _on_plan(t, "starter")
    _hook(event("invoice.paid", _invoice("in_1"), "evt_a"))
    _hook(event("charge.dispute.created", {"id": "dp_1", "payment_intent": "pi_in_1", "charge": "ch_1", "amount": 900,
                                           "reason": "fraudulent", "status": "needs_response"}))
    assert profile(t)["status"] == "suspended"


def test_a_failing_handler_marks_the_event_failed_and_stripe_retries_it(subs, monkeypatch):
    t, _ = subs
    import sys
    calls = []

    def boom(obj):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("DynamoDB hiccup")
        return "ok"
    monkeypatch.setattr(sys.modules["lib.subscriptions"], "_checkout_completed", boom)
    evt = event("checkout.session.completed", _session())
    _hook(evt, 500)
    assert t.get_item(Key={"pk": f"STRIPEEVT#{evt['id']}", "sk": "EVT"})["Item"]["status"] == "failed"
    _hook(evt)
    assert t.get_item(Key={"pk": f"STRIPEEVT#{evt['id']}", "sk": "EVT"})["Item"]["status"] == "ok" and len(calls) == 2


def test_items_follow_the_effective_plan(subs):
    t, _ = subs
    _on_plan(t, "starter")
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET itemCount = :n", ExpressionAttributeValues={":n": 10})
    call("/api/items", "POST", {"name": "eleventh"}, status=201)  # starter allows 100
    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat()
    t.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET paymentFailedAt = :o", ExpressionAttributeValues={":o": old})
    assert call("/api/items", "POST", {"name": "twelfth"}, status=403)["code"] == "PLAN_LIMIT"  # grace over: free's 10

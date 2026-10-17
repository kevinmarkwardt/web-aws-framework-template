"""BILLING_MODE (cdk.json context billingMode -> the API Lambda): a module that is off answers 404 on every route, its
webhook events are ignored, and GET /api/public-config tells the site what to show."""

import pytest

import api.handler as handler
from api.lib import config

from .conftest import call
from .stripe_fake import event, signed_event, topup_event

SUBSCRIPTION_ROUTES = [("POST", "/api/billing/checkout"), ("POST", "/api/billing/portal"), ("POST", "/api/billing/change-plan"),
                       ("POST", "/api/billing/cancel")]
CREDITS_ROUTES = [("GET", "/api/wallet"), ("POST", "/api/wallet/charge"), ("GET", "/api/wallet/charge/pi_1"),
                  ("POST", "/api/wallet/auto-reload"), ("GET", "/api/wallet/refunds"), ("POST", "/api/wallet/refund"),
                  ("POST", "/api/account/referral")]
CARD_ROUTES = [("GET", "/api/account/cards"), ("POST", "/api/account/cards/setup"), ("DELETE", "/api/account/cards/pm_1")]


@pytest.fixture
def signed(stripe_fake, who, create_test_user):
    create_test_user("u1", "u1@example.com")
    return stripe_fake


def _status(method, path):
    return handler.lambda_handler({"requestContext": {"http": {"method": method, "path": path}}, "headers": {}, "body": "{}"},
                                  None)["statusCode"]


@pytest.mark.parametrize("mode,off", [
    ("none", SUBSCRIPTION_ROUTES + CREDITS_ROUTES + CARD_ROUTES),
    ("credits", SUBSCRIPTION_ROUTES),
    ("subscriptions", CREDITS_ROUTES),
])
def test_routes_of_a_disabled_module_are_404(signed, billing_mode, mode, off):
    billing_mode(mode)
    for method, path in off:
        assert _status(method, path) == 404, (mode, method, path)


def test_both_modes_route_everything(signed):
    for method, path in SUBSCRIPTION_ROUTES + CREDITS_ROUTES[:1] + CARD_ROUTES[:1]:
        assert _status(method, path) != 404, path


def test_public_config_says_what_to_show(dynamodb_table, billing_mode):
    both = call("/api/public-config")
    assert both["billingMode"] == "both" and [p["id"] for p in both["plans"]] == ["free", "starter", "pro"]
    assert both["credits"]["creditName"] == "credits" and [p["id"] for p in both["credits"]["packs"]] == ["p5", "p10", "p20", "p50"]
    billing_mode("credits")
    cfg = call("/api/public-config")
    assert cfg["billingMode"] == "credits" and "plans" not in cfg and "credits" in cfg
    billing_mode("subscriptions")
    cfg = call("/api/public-config")
    assert "plans" in cfg and "credits" not in cfg
    billing_mode("none")
    cfg = call("/api/public-config")
    assert cfg["billingMode"] == "none" and "plans" not in cfg and "credits" not in cfg
    billing_mode("bogus")  # an unknown value turns billing off rather than guessing
    assert call("/api/public-config")["billingMode"] == "none"


def test_account_shows_only_the_enabled_modules(signed, billing_mode):
    acct = call("/api/account")
    assert acct["billingMode"] == "both" and "subscription" in acct and "credits" in acct
    billing_mode("subscriptions")
    acct = call("/api/account")
    assert "subscription" in acct and "credits" not in acct
    billing_mode("credits")
    acct = call("/api/account")
    assert "subscription" not in acct and acct["plan"] == "free" and "credits" in acct


def test_a_disabled_modules_webhook_events_are_ignored(signed, billing_mode, dynamodb_table):
    billing_mode("subscriptions")
    handler.lambda_handler(signed_event(topup_event("u1", "pi_1", 1000, 1000, "p10")), None)
    assert "paidCredits" not in dynamodb_table.get_item(Key={"pk": "USER#u1", "sk": "PROFILE"})["Item"]
    billing_mode("credits")
    session = {"id": "cs_1", "mode": "subscription", "client_reference_id": "u1", "customer": "cus_1", "subscription": "sub_1",
               "metadata": {"userId": "u1", "plan": "pro"}}
    handler.lambda_handler(signed_event(event("checkout.session.completed", session)), None)
    assert dynamodb_table.get_item(Key={"pk": "USER#u1", "sk": "PROFILE"})["Item"]["plan"] == "free"
    billing_mode("none")
    assert handler.lambda_handler(signed_event(event("charge.refunded", {"id": "ch_1"})), None)["statusCode"] == 404


def test_every_user_route_needs_sign_in(dynamodb_table):
    """No user route answers without a token (the lesson of NEG's A10)."""
    for method, path in [("GET", "/api/account"), ("GET", "/api/account/notes"), ("POST", "/api/account/notes/dismiss"),
                         *SUBSCRIPTION_ROUTES, *CREDITS_ROUTES, *CARD_ROUTES]:
        assert _status(method, path) == 401, (method, path)


def test_the_cdk_stack_passes_the_mode_and_sends_the_sweep_event_the_handler_expects():
    from pathlib import Path
    import json
    root = Path(__file__).resolve().parents[1]
    stack = (root / "cdk/lib/yourapp-stack.ts").read_text()
    assert f"app_task: '{handler.SWEEP_TASK}'" in stack and "BILLING_MODE: billingMode" in stack
    assert "events.Schedule.rate(cdk.Duration.minutes(15))" in stack
    # the template ships "both"; scripts/init.py writes the spec's modules.billing.mode
    assert json.loads((root / "cdk/cdk.json").read_text())["context"]["billingMode"] in config.BILLING_MODES

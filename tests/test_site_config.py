"""Site config (CONFIG | GLOBAL): defaults on a fresh install, merged admin saves, and the switches the API enforces:
plan limits, maintenance mode and sign-ups."""

import json
import sys
from unittest.mock import patch

import pytest

import api.handler as handler
from api.lib import config
from api.routes import account, items, billing, webhooks
from tests.conftest import admin_call, make_api_event


def _call(method, path, body=None):
    return handler.lambda_handler(make_api_event(method, path, body), None)


def _json(resp):
    return json.loads(resp["body"])


@pytest.fixture
def signed_in(monkeypatch):
    """Every request is user-123 (the Cognito check itself is tested in test_auth.py)."""
    monkeypatch.setattr(handler, "get_user_id", lambda event: "user-123")


@pytest.fixture
def as_admin(admin_who):
    """Admin requests go to the admin Lambda (api/admin_handler.py) as an admin (tests/conftest.py admin_who)."""
    return admin_who


def _store(dynamodb_table, **cfg):
    dynamodb_table.put_item(Item={"pk": "CONFIG", "sk": "GLOBAL", **cfg})


class TestDefaults:
    def test_fresh_install_has_every_section(self, dynamodb_table):
        cfg = config.get_site_config()
        assert cfg["maintenanceMode"] is False and cfg["signupsEnabled"] is True
        assert cfg["planLimits"] == {"free": 10, "starter": 100, "pro": None}
        assert set(cfg["jobSettings"]) == {"dailyJobHourUtc", "hourlyJobEnabled", "rateLimitDelayMs"}
        assert cfg["emailTemplates"]  # the admin Email Templates page lists these

    def test_admin_get_returns_defaults_without_a_record(self, dynamodb_table, as_admin):
        body = admin_call("/api/admin/config")
        assert body["planLimits"]["free"] == 10 and "emailTemplates" in body and "jobSettings" in body

    def test_old_record_missing_keys_is_filled_in(self, dynamodb_table):
        _store(dynamodb_table, maintenanceMode=False, planLimits={"free": 3})
        cfg = config.get_site_config()
        assert cfg["planLimits"] == {"free": 3, "starter": 100, "pro": None}
        assert cfg["jobSettings"]["dailyJobHourUtc"] == 8

    def test_bad_stored_limit_falls_back_to_the_default(self, dynamodb_table):
        _store(dynamodb_table, planLimits={"free": "lots", "starter": -4, "pro": 999})
        assert config.plan_limits() == {"free": 10, "starter": 100, "pro": 999}


class TestAdminSave:
    def test_saving_one_section_keeps_the_others(self, dynamodb_table, as_admin):
        admin_call("/api/admin/config", "PUT", {"signupsEnabled": False})
        admin_call("/api/admin/config", "PUT", {"planLimits": {"free": 3}})
        cfg = admin_call("/api/admin/config")
        assert cfg["signupsEnabled"] is False
        assert cfg["planLimits"] == {"free": 3, "starter": 100, "pro": None}

    @pytest.mark.parametrize("body", [
        {"planLimits": {"free": -1}},
        {"planLimits": {"free": "10"}},
        {"planLimits": {"enterprise": 5}},
        {"maintenanceMode": "yes"},
        {"jobSettings": {"dailyJobHourUtc": True}},
        {"somethingElse": 1},
    ])
    def test_bad_values_are_a_400(self, dynamodb_table, as_admin, body):
        admin_call("/api/admin/config", "PUT", body, status=400)

    def test_unlimited_is_null(self, dynamodb_table, as_admin):
        admin_call("/api/admin/config", "PUT", {"planLimits": {"starter": None}})
        assert config.plan_limit("starter") is None


class TestPlanLimits:
    def test_admin_limit_is_enforced(self, dynamodb_table, create_test_user):
        config.save_site_config({"planLimits": {"free": 2}})
        create_test_user(item_count=2)
        resp = items.create_item("user-123", make_api_event("POST", "/api/items", {"name": "third"}))
        assert resp["statusCode"] == 403 and _json(resp)["code"] == "PLAN_LIMIT"

    def test_unlimited_plan_has_no_cap(self, dynamodb_table, create_test_user):
        create_test_user(plan="pro", item_count=5000)
        resp = items.create_item("user-123", make_api_event("POST", "/api/items", {"name": "more"}))
        assert resp["statusCode"] == 201

    def test_cancel_checks_the_configured_free_limit(self, dynamodb_table, create_test_user):
        config.save_site_config({"planLimits": {"free": 1}})
        create_test_user(plan="starter", item_count=2)
        resp = billing.cancel_plan("user-123", make_api_event("POST", "/api/billing/cancel"))
        assert resp["statusCode"] == 409

    def test_account_reports_item_count_and_limits(self, dynamodb_table, create_test_user):
        config.save_site_config({"planLimits": {"starter": 42}})
        create_test_user(plan="starter", item_count=7)
        body = _json(account.get_account("user-123", make_api_event("GET", "/api/account")))
        assert body["itemCount"] == 7 and "linkCount" not in body
        assert body["itemLimit"] == 42
        assert body["planLimits"] == {"free": 10, "starter": 42, "pro": None}

    def test_public_config_shows_the_limits(self, dynamodb_table):
        body = _json(_call("GET", "/api/public-config"))
        assert {k: body[k] for k in ("maintenanceMode", "signupsEnabled", "planLimits", "billingMode")} == {
            "maintenanceMode": False, "signupsEnabled": True, "planLimits": {"free": 10, "starter": 100, "pro": None},
            "billingMode": "both"}
        assert [(p["id"], p["limits"]["items"]) for p in body["plans"]] == [("free", 10), ("starter", 100), ("pro", None)]


class TestMaintenanceMode:
    def test_user_routes_get_503(self, dynamodb_table, create_test_user, signed_in):
        create_test_user()
        _store(dynamodb_table, maintenanceMode=True)
        for method, path in (("GET", "/api/items"), ("GET", "/api/account"), ("POST", "/api/billing/checkout")):
            resp = _call(method, path, {} if method == "POST" else None)
            assert resp["statusCode"] == 503, path
            assert _json(resp)["code"] == "MAINTENANCE"

    def test_admin_public_config_and_webhooks_keep_working(self, dynamodb_table, as_admin, monkeypatch):
        _store(dynamodb_table, maintenanceMode=True)
        admin_call("/api/admin/config")  # the admin Lambda never applies maintenance mode
        assert _json(_call("GET", "/api/public-config"))["maintenanceMode"] is True
        for mod in (webhooks, sys.modules.get("routes.webhooks")):
            if mod:
                monkeypatch.setattr(mod, "handle", lambda event: {"statusCode": 200, "body": "{}"})
        assert _call("POST", "/api/webhooks/stripe", "{}")["statusCode"] == 200

    def test_off_by_default(self, dynamodb_table, create_test_user, signed_in):
        create_test_user()
        assert _call("GET", "/api/items")["statusCode"] == 200


class TestSignups:
    def test_closed_signups_refuse_new_profiles(self, dynamodb_table, signed_in):
        _store(dynamodb_table, signupsEnabled=False)
        resp = _call("GET", "/api/account")
        assert resp["statusCode"] == 403 and _json(resp)["code"] == "SIGNUPS_CLOSED"
        assert dynamodb_table.get_item(Key={"pk": "USER#user-123", "sk": "PROFILE"}).get("Item") is None

    def test_existing_accounts_still_work(self, dynamodb_table, create_test_user, signed_in):
        create_test_user()
        _store(dynamodb_table, signupsEnabled=False)
        assert _call("GET", "/api/account")["statusCode"] == 200

    def test_open_signups_create_the_profile(self, dynamodb_table, signed_in):
        assert _call("GET", "/api/account")["statusCode"] == 200
        assert dynamodb_table.get_item(Key={"pk": "USER#user-123", "sk": "PROFILE"}).get("Item")


class TestBadInput:
    def test_malformed_json_is_a_400_not_a_500(self, dynamodb_table, create_test_user, signed_in):
        create_test_user()
        assert _call("POST", "/api/items", "{not json")["statusCode"] == 400
        assert _call("POST", "/api/items", "[1, 2]")["statusCode"] == 400
        assert _call("POST", "/api/items", {"name": 5})["statusCode"] == 400

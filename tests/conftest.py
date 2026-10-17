"""Shared test fixtures for YourApp backend tests."""

import json
import os
import sys
import time

import boto3
import pytest
from moto import mock_aws
from unittest.mock import patch, MagicMock

# Ensure the project root is on sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Set environment variables before any app imports
os.environ["TABLE_NAME"] = "yourapp-test"
os.environ["USER_POOL_ID"] = "us-east-1_TestPool"
os.environ["USER_POOL_CLIENT_ID"] = "test-client-id"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["SES_FROM_EMAIL"] = "test@yourapp.com"
os.environ["FRONTEND_URL"] = "https://yourapp.com"
os.environ["STAGE"] = "prod"
os.environ.pop("ORIGIN_VERIFY", None)  # no CloudFront in tests: tests/test_origin_verify.py sets it where needed
os.environ.pop("TEST_LOGIN", None)
os.environ["BILLING_MODE"] = "both"  # tests/test_billing_modes.py switches it per test
os.environ["ALLOW_NO_VIEWER_COUNTRY"] = "1"  # no CloudFront in tests (api/lib/regions.py)
os.environ.pop("ADMIN_EMAIL", None)
os.environ["SITE_CONFIG"] = "off"  # the template's defaults, not api/site.json (scripts/init.py); test_site_json.py reads it


def _both(name: str):
    """A lib/routes module under both names it can be imported as: tests import api.lib.x, while api/handler.py (which
    puts api/ on sys.path, as Lambda does) imports lib.x. They are separate module objects with separate state."""
    import importlib

    mods = [importlib.import_module(f"api.{name}")]
    if name in sys.modules:
        mods.append(sys.modules[name])
    return mods


def _reset_module_state():
    for m in _both("lib.db"):
        m._table = None
    for m in _both("lib.config"):
        m._cache = None
    for m in _both("lib.stripe_config"):
        m.reset_cache()
        m._http.clear()
    for m in _both("lib.subscriptions"):
        m.reset_cache()
    for m in _both("lib.fx"):
        m._mem.clear()


@pytest.fixture(autouse=True)
def no_refund_hold(monkeypatch):
    """Top-ups in tests are made "now"; the one-hour refund hold is tested on its own (test_api_wallet)."""
    for m in _both("lib.credits"):
        monkeypatch.setattr(m, "REFUND_HOLD_MINUTES", 0)


@pytest.fixture(autouse=True)
def fresh_module_state():
    """Module-level caches (DynamoDB table handle, site config, secrets) start empty in every test."""
    _reset_module_state()
    yield
    _reset_module_state()


@pytest.fixture
def aws_credentials():
    """Mocked AWS credentials for moto."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"


@pytest.fixture
def dynamodb_table(aws_credentials):
    """Create a mocked DynamoDB table for testing."""
    with mock_aws():
        client = boto3.resource("dynamodb", region_name="us-east-1")
        table = client.create_table(
            TableName="yourapp-test",
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "stripeCustomerId", "AttributeType": "S"},
                {"AttributeName": "listPk", "AttributeType": "S"},
                {"AttributeName": "createdAt", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "stripe-customer-index",
                    "KeySchema": [{"AttributeName": "stripeCustomerId", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "list-index",
                    "KeySchema": [{"AttributeName": "listPk", "KeyType": "HASH"},
                                  {"AttributeName": "createdAt", "KeyType": "RANGE"}],
                    "Projection": {"ProjectionType": "KEYS_ONLY"},
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        table.meta.client.get_waiter("table_exists").wait(TableName="yourapp-test")

        # Reset the cached table references so they pick up the mock
        _reset_module_state()

        yield table

        _reset_module_state()


@pytest.fixture
def sample_user():
    """Sample user data."""
    return {
        "userId": "user-123",
        "email": "test@example.com",
        "plan": "free",
    }


@pytest.fixture
def sample_starter_user():
    """Sample starter-plan user data."""
    return {
        "userId": "user-starter",
        "email": "starter@example.com",
        "plan": "starter",
    }


@pytest.fixture
def sample_pro_user():
    """Sample pro-plan user data."""
    return {
        "userId": "user-pro",
        "email": "pro@example.com",
        "plan": "pro",
    }


@pytest.fixture
def create_test_user(dynamodb_table):
    """Factory fixture to insert a user into DynamoDB."""
    def _create(user_id="user-123", email="test@example.com", plan="free",
                item_count=0, stripe_customer_id="", stripe_subscription_id="", created_at="2026-01-01T00:00:00+00:00",
                **extra):
        item = {
            "pk": f"USER#{user_id}",
            "sk": "PROFILE",
            "userId": user_id,
            "email": email,
            "plan": plan,
            "itemCount": item_count,
            "createdAt": created_at,
            "listPk": "USER",
            **extra,
        }
        # Only set Stripe IDs when non-empty (empty strings invalid for GSI keys)
        if stripe_customer_id:
            item["stripeCustomerId"] = stripe_customer_id
        if stripe_subscription_id:
            item["stripeSubscriptionId"] = stripe_subscription_id
        dynamodb_table.put_item(Item=item)
        return user_id
    return _create


@pytest.fixture
def create_test_item(dynamodb_table):
    """Factory fixture to insert an item into DynamoDB."""
    def _create(user_id="user-123", item_id="item-001",
                name="Test item", status="ACTIVE"):
        dynamodb_table.put_item(Item={
            "pk": f"USER#{user_id}",
            "sk": f"ITEM#{item_id}",
            "userId": user_id,
            "itemId": item_id,
            "name": name,
            "status": status,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "listPk": "ITEM",
        })
        return item_id
    return _create



def make_api_event(method, path, body=None, user_id="user-123", headers=None):
    """Helper to construct an API Gateway v2 (Function URL) event."""
    event = {
        "requestContext": {
            "http": {
                "method": method,
                "path": path,
            },
        },
        "headers": headers or {},
    }
    if body is not None:
        event["body"] = json.dumps(body) if isinstance(body, (dict, list)) else body
    return event


def make_authed_event(method, path, body=None, user_id="user-123"):
    """Helper to construct an authenticated API event (with mock JWT bypass)."""
    event = make_api_event(method, path, body)
    # We'll patch get_user_id to return the user_id directly in tests
    event["_test_user_id"] = user_id
    return event


# ---- payments fixtures (tests/stripe_fake.py)

@pytest.fixture
def stripe_fake(dynamodb_table, monkeypatch):
    """A FakeStripe behind stripe_config.client() (both module copies) and a test secret with a webhook secret."""
    import api.handler  # noqa: F401  (loads the handler's lib.* copies so both get patched)
    from tests.stripe_fake import WHSEC, FakeStripe

    fake = FakeStripe()
    for m in _both("lib.stripe_config"):
        monkeypatch.setattr(m, "_cache", {"at": time.time(), "value": {"secretKey": "sk_test_x", "webhookSecret": WHSEC}})
        monkeypatch.setattr(m, "client", lambda: fake)
    return fake


@pytest.fixture
def who(monkeypatch):
    """The signed-in user for handler requests: who["uid"] (change it mid-test to switch users)."""
    import api.handler as handler

    current = {"uid": "u1"}
    monkeypatch.setattr(handler, "get_user_id", lambda event: current["uid"])
    monkeypatch.setattr(handler, "get_token_claims", lambda event: {"email": f"{current['uid']}@example.com"})
    for m in _both("routes.account"):
        monkeypatch.setattr(m, "get_token_claims", lambda event: {"email": f"{current['uid']}@example.com"})
    return current


def call(path, method="GET", body=None, status=200, headers=None):
    """A request through api.handler; asserts the status and returns the JSON body."""
    import api.handler as handler

    event = {"requestContext": {"http": {"method": method, "path": path}}, "headers": headers or {},
             "body": json.dumps(body) if body is not None else None}
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == status, resp
    return json.loads(resp["body"])


def profile(table, uid="u1"):
    return table.get_item(Key={"pk": f"USER#{uid}", "sk": "PROFILE"}).get("Item") or {}


@pytest.fixture
def billing_cfg(monkeypatch):
    """set(**kw): change config.BILLING keys (both module copies) for this test."""
    def _set(**kw):
        for m in _both("lib.config"):
            for k, v in kw.items():
                monkeypatch.setitem(m.BILLING, k, v)
    return _set


@pytest.fixture
def billing_mode(monkeypatch):
    """set("credits") etc.: BILLING_MODE for this test."""
    return lambda mode: monkeypatch.setenv("BILLING_MODE", mode)


# ---- admin API (api/admin_handler.py)

@pytest.fixture
def admin_who(dynamodb_table, monkeypatch):
    """Requests through api.admin_handler as an admin. state["uid"] is the caller (None: no token), state["groups"] the
    token's cognito:groups, state["live"] the groups Cognito answers live. The admin profile (isAdmin) exists."""
    import api.admin_handler as admin_handler

    state = {"uid": "admin1", "groups": ["admins"], "live": {"admins"}}

    def claims(event):
        if not state["uid"]:
            return {}
        return {"sub": state["uid"], "cognito:username": state["uid"], "cognito:groups": list(state["groups"]),
                "email": f"{state['uid']}@example.com", "token_use": "id"}
    monkeypatch.setattr(admin_handler, "get_token_claims", claims)
    for m in _both("lib.admins"):
        monkeypatch.setattr(m, "cognito_groups", lambda username: set(state["live"]))
    dynamodb_table.put_item(Item={"pk": "USER#admin1", "sk": "PROFILE", "userId": "admin1", "email": "admin1@example.com",
                                  "isAdmin": True, "listPk": "USER", "createdAt": "2025-06-01T00:00:00+00:00"})
    return state


def admin_call(path, method="GET", body=None, status=200, qs=None, headers=None):
    """A request through api.admin_handler; asserts the status and returns the JSON body."""
    import api.admin_handler as admin_handler

    event = {"requestContext": {"http": {"method": method, "path": path}}, "headers": headers or {},
             "queryStringParameters": qs, "body": json.dumps(body) if body is not None else None}
    resp = admin_handler.lambda_handler(event, None)
    assert resp["statusCode"] == status, resp
    return json.loads(resp["body"])

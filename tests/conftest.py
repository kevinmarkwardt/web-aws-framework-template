"""Shared test fixtures for LinkKeeper backend tests."""

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
os.environ["TABLE_NAME"] = "linkkeeper-test"
os.environ["USER_POOL_ID"] = "us-east-1_TestPool"
os.environ["USER_POOL_CLIENT_ID"] = "test-client-id"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["STRIPE_SECRET_KEY"] = "sk_test_fake"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_fake"
os.environ["STRIPE_STARTER_PRICE_ID"] = "price_starter_test"
os.environ["STRIPE_PRO_PRICE_ID"] = "price_pro_test"
os.environ["SES_FROM_EMAIL"] = "test@linkkeeper.co"
os.environ["FRONTEND_URL"] = "https://linkkeeper.co"
os.environ["REPORTS_BUCKET"] = "linkkeeper-reports-test"
os.environ["BEDROCK_MODEL_ID"] = "anthropic.claude-3-haiku-20240307-v1:0"
os.environ["ALERTS_FUNCTION"] = "linkkeeper-alerts-test"
os.environ["IMPACT_SCORER_FUNCTION"] = "linkkeeper-impact-scorer-test"


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
            TableName="linkkeeper-test",
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "email", "AttributeType": "S"},
                {"AttributeName": "stripeCustomerId", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "email-index",
                    "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": "stripe-customer-index",
                    "KeySchema": [{"AttributeName": "stripeCustomerId", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        table.meta.client.get_waiter("table_exists").wait(TableName="linkkeeper-test")

        # Reset the db module's cached table reference so it picks up the mock
        import api.lib.db as db_module
        db_module._table = None

        yield table

        db_module._table = None


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
                link_count=0, stripe_customer_id="", stripe_subscription_id=""):
        item = {
            "pk": f"USER#{user_id}",
            "sk": "PROFILE",
            "userId": user_id,
            "email": email,
            "plan": plan,
            "linkCount": link_count,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "settings": {
                "alertsEnabled": True,
                "digestEnabled": True,
                "remindersEnabled": True,
            },
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
def create_test_link(dynamodb_table):
    """Factory fixture to insert a link into DynamoDB."""
    def _create(user_id="user-123", link_id="link-001",
                page_url="https://blog.example.com/post",
                destination_url="https://mysite.com/product",
                anchor_text="my product",
                status="LIVE", status_history=None):
        dynamodb_table.put_item(Item={
            "pk": f"USER#{user_id}",
            "sk": f"LINK#{link_id}",
            "userId": user_id,
            "linkId": link_id,
            "pageUrl": page_url,
            "destinationUrl": destination_url,
            "anchorText": anchor_text,
            "status": status,
            "lastChecked": "2026-01-15T00:00:00+00:00",
            "firstAdded": "2026-01-01T00:00:00+00:00",
            "statusHistory": status_history or [],
            "jsWarning": False,
            "lastAlertSent": "",
        })
        return link_id
    return _create


@pytest.fixture
def create_test_pitch(dynamodb_table):
    """Factory fixture to insert a pitch into DynamoDB."""
    def _create(user_id="user-123", pitch_id="pitch-001",
                domain="blogsite.com", status="PITCHED"):
        dynamodb_table.put_item(Item={
            "pk": f"USER#{user_id}",
            "sk": f"PITCH#{pitch_id}",
            "userId": user_id,
            "pitchId": pitch_id,
            "domain": domain,
            "contactName": "Editor",
            "contactEmail": "editor@blogsite.com",
            "pitchSentDate": "2026-01-01T00:00:00+00:00",
            "status": status,
            "publishedUrl": "",
            "publishedDate": "",
            "notes": "",
            "linkedLinkId": "",
            "lastReminderSent": "",
        })
        return pitch_id
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

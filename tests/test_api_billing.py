"""Tests for Billing API routes."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch, MagicMock

from tests.conftest import make_api_event
from api.routes import billing
from api.lib import db

# Test values for Stripe config
TEST_SECRETS = {"publishableKey": "pk_test_fake", "secretKey": "sk_test_fake", "webhookSecret": "whsec_test_fake"}
TEST_PRICES = {"starter": "price_starter_test", "pro": "price_pro_test"}


@pytest.fixture(autouse=True)
def reset_billing_caches():
    """Reset billing module caches and stripe.api_key between tests."""
    billing.invalidate_caches()
    import stripe
    stripe.api_key = None
    yield
    billing.invalidate_caches()
    stripe.api_key = None


@mock_aws
class TestCreateCheckout:
    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_create_checkout_starter(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        create_test_user()
        mock_session = MagicMock()
        mock_session.url = "https://checkout.stripe.com/session/123"
        mock_stripe.checkout.Session.create.return_value = mock_session

        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "starter"})
        result = billing.create_checkout("user-123", event)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["url"] == "https://checkout.stripe.com/session/123"

    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_create_checkout_pro(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        create_test_user()
        mock_session = MagicMock()
        mock_session.url = "https://checkout.stripe.com/session/456"
        mock_stripe.checkout.Session.create.return_value = mock_session

        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "pro"})
        result = billing.create_checkout("user-123", event)

        assert result["statusCode"] == 200

    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._ensure_stripe_key")
    def test_invalid_plan(self, mock_ensure, mock_prices, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "enterprise"})
        result = billing.create_checkout("user-123", event)
        assert result["statusCode"] == 400
        assert "Invalid plan" in json.loads(result["body"])["error"]

    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_user_not_found(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table):
        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "starter"})
        result = billing.create_checkout("nonexistent", event)
        assert result["statusCode"] == 404

    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_reuses_existing_customer(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        create_test_user(stripe_customer_id="cus_existing")
        mock_session = MagicMock()
        mock_session.url = "https://checkout.stripe.com/session/789"
        mock_stripe.checkout.Session.create.return_value = mock_session

        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "starter"})
        result = billing.create_checkout("user-123", event)

        assert result["statusCode"] == 200
        call_kwargs = mock_stripe.checkout.Session.create.call_args[1]
        assert call_kwargs["customer"] == "cus_existing"


@mock_aws
class TestCreatePortal:
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_create_portal(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        create_test_user(stripe_customer_id="cus_123")
        mock_session = MagicMock()
        mock_session.url = "https://billing.stripe.com/portal/123"
        mock_stripe.billing_portal.Session.create.return_value = mock_session

        result = billing.create_portal("user-123", make_api_event("POST", "/api/billing/portal"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["url"] == "https://billing.stripe.com/portal/123"

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_no_billing_account(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        create_test_user()  # No stripe_customer_id
        result = billing.create_portal("user-123", make_api_event("POST", "/api/billing/portal"))
        assert result["statusCode"] == 400
        assert "No billing account" in json.loads(result["body"])["error"]


@mock_aws
class TestWebhook:
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_invalid_signature(self, mock_stripe, mock_secrets, dynamodb_table):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        mock_stripe.Webhook.construct_event.side_effect = \
            real_stripe.error.SignatureVerificationError("bad sig", "sig_header")

        event = make_api_event("POST", "/api/webhooks/stripe")
        event["body"] = "{}"
        event["headers"] = {"stripe-signature": "bad_sig"}
        result = billing.handle_webhook(event)
        assert result["statusCode"] == 400

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_checkout_completed(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        create_test_user()

        mock_stripe.Webhook.construct_event.return_value = {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "client_reference_id": "user-123",
                    "metadata": {"plan": "starter", "userId": "user-123"},
                    "customer": "cus_new",
                    "subscription": "sub_new",
                },
            },
        }

        event = make_api_event("POST", "/api/webhooks/stripe")
        event["body"] = '{"type": "checkout.session.completed"}'
        event["headers"] = {"stripe-signature": "valid_sig"}
        result = billing.handle_webhook(event)
        assert result["statusCode"] == 200

        # Verify user plan was updated
        user = db.get_user("user-123")
        assert user["plan"] == "starter"
        assert user["stripeCustomerId"] == "cus_new"

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_subscription_deleted(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        create_test_user(plan="starter", stripe_customer_id="cus_del")

        mock_stripe.Webhook.construct_event.return_value = {
            "type": "customer.subscription.deleted",
            "data": {
                "object": {
                    "customer": "cus_del",
                },
            },
        }

        event = make_api_event("POST", "/api/webhooks/stripe")
        event["body"] = '{"type": "customer.subscription.deleted"}'
        event["headers"] = {"stripe-signature": "valid_sig"}
        result = billing.handle_webhook(event)
        assert result["statusCode"] == 200

        user = db.get_user("user-123")
        assert user["plan"] == "free"

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_subscription_updated_canceled(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        create_test_user(plan="pro", stripe_customer_id="cus_upd")

        mock_stripe.Webhook.construct_event.return_value = {
            "type": "customer.subscription.updated",
            "data": {
                "object": {
                    "customer": "cus_upd",
                    "status": "canceled",
                },
            },
        }

        event = make_api_event("POST", "/api/webhooks/stripe")
        event["body"] = '{"type": "customer.subscription.updated"}'
        event["headers"] = {"stripe-signature": "valid_sig"}
        result = billing.handle_webhook(event)
        assert result["statusCode"] == 200

        user = db.get_user("user-123")
        assert user["plan"] == "free"


@mock_aws
class TestChangePlan:
    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_upgrade_starter_to_pro(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="starter", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", item_count=10)

        mock_sub = {"id": "sub_1", "status": "active", "items": {"data": [{"id": "si_item1"}]}}
        mock_stripe.Subscription.retrieve.return_value = mock_sub
        mock_stripe.Subscription.modify.return_value = mock_sub

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "pro"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["action"] == "done"
        assert body["plan"] == "pro"

        user = db.get_user("user-123")
        assert user["plan"] == "pro"

        mock_stripe.Subscription.modify.assert_called_once()
        call_kwargs = mock_stripe.Subscription.modify.call_args
        assert call_kwargs[1]["items"][0]["price"] == "price_pro_test"
        assert call_kwargs[1]["proration_behavior"] == "create_prorations"

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_needs_checkout_when_free(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="free", item_count=2)

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "starter"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["action"] == "checkout"

    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_downgrade_allowed(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="pro", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", item_count=10)

        mock_sub = {"id": "sub_1", "status": "active", "items": {"data": [{"id": "si_item1"}]}}
        mock_stripe.Subscription.retrieve.return_value = mock_sub
        mock_stripe.Subscription.modify.return_value = mock_sub

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "starter"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["action"] == "done"
        assert body["plan"] == "starter"

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_downgrade_blocked(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="pro", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", item_count=11)

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "free"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 409
        body = json.loads(result["body"])
        assert "11 items" in body["error"]

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_same_plan_error(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="starter", stripe_customer_id="cus_1", stripe_subscription_id="sub_1")

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "starter"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 400
        assert "Already on this plan" in json.loads(result["body"])["error"]

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_invalid_plan(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user()

        event = make_api_event("POST", "/api/billing/change-plan", body={"plan": "enterprise"})
        result = billing.change_plan("user-123", event)

        assert result["statusCode"] == 400
        assert "Invalid plan" in json.loads(result["body"])["error"]


@mock_aws
class TestCancelPlan:
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_cancel_success(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="starter", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", item_count=3)

        event = make_api_event("POST", "/api/billing/cancel")
        result = billing.cancel_plan("user-123", event)

        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["action"] == "done"
        assert body["plan"] == "free"

        user = db.get_user("user-123")
        assert user["plan"] == "free"
        mock_stripe.Subscription.cancel.assert_called_once_with("sub_1")

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_cancel_blocked(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="starter", stripe_customer_id="cus_1", stripe_subscription_id="sub_1", item_count=11)

        event = make_api_event("POST", "/api/billing/cancel")
        result = billing.cancel_plan("user-123", event)

        assert result["statusCode"] == 409
        body = json.loads(result["body"])
        assert "11 items" in body["error"]

    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_cancel_already_free(self, mock_stripe, mock_secrets, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="free")

        event = make_api_event("POST", "/api/billing/cancel")
        result = billing.cancel_plan("user-123", event)

        assert result["statusCode"] == 400
        assert "Already on free plan" in json.loads(result["body"])["error"]


@mock_aws
class TestCreateCheckoutGuard:
    @patch("api.routes.billing._get_price_ids", return_value=TEST_PRICES)
    @patch("api.routes.billing._get_stripe_secrets", return_value=TEST_SECRETS)
    @patch("api.routes.billing.stripe")
    def test_checkout_blocked_with_active_sub(self, mock_stripe, mock_secrets, mock_prices, dynamodb_table, create_test_user):
        import stripe as real_stripe
        mock_stripe.error = real_stripe.error
        create_test_user(plan="starter", stripe_customer_id="cus_1", stripe_subscription_id="sub_1")

        mock_stripe.Subscription.retrieve.return_value = {"id": "sub_1", "status": "active"}

        event = make_api_event("POST", "/api/billing/checkout", body={"plan": "pro"})
        result = billing.create_checkout("user-123", event)

        assert result["statusCode"] == 409
        assert "Active subscription exists" in json.loads(result["body"])["error"]

"""Tests for the alert sender Lambda."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch, MagicMock, call

from lambdas.alerts.handler import lambda_handler, _send_alert


@mock_aws
class TestAlertSender:
    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_sends_alert_on_status_change(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-a", email="user@example.com")
        create_test_link(
            user_id="user-a",
            link_id="link-a",
            status="MISSING",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 1
        mock_ses.send_email.assert_called_once()

        # Verify email content
        call_kwargs = mock_ses.send_email.call_args[1]
        assert call_kwargs["Destination"]["ToAddresses"] == ["user@example.com"]
        assert "MISSING" in call_kwargs["Message"]["Subject"]["Data"]

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_no_alert_when_status_unchanged(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-a", email="user@example.com")
        create_test_link(
            user_id="user-a",
            link_id="link-a",
            status="LIVE",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 0
        mock_ses.send_email.assert_not_called()

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_no_alert_with_single_history_entry(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-a", email="user@example.com")
        create_test_link(
            user_id="user-a",
            link_id="link-a",
            status="LIVE",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 0

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_no_alert_when_alerts_disabled(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        # Create user with alerts disabled
        dynamodb_table.put_item(Item={
            "pk": "USER#user-a",
            "sk": "PROFILE",
            "userId": "user-a",
            "email": "user@example.com",
            "plan": "free",
            "linkCount": 1,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "settings": {
                "alertsEnabled": False,
                "digestEnabled": True,
                "remindersEnabled": True,
            },
        })
        create_test_link(
            user_id="user-a",
            link_id="link-a",
            status="MISSING",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 0

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_skips_already_alerted(self, mock_ses, mock_lambda, dynamodb_table, create_test_user):
        create_test_user(user_id="user-a", email="user@example.com")
        # Link already has lastAlertSent matching the latest history entry
        dynamodb_table.put_item(Item={
            "pk": "USER#user-a",
            "sk": "LINK#link-a",
            "userId": "user-a",
            "linkId": "link-a",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "link",
            "status": "MISSING",
            "lastChecked": "2026-01-02T00:00:00+00:00",
            "firstAdded": "2026-01-01T00:00:00+00:00",
            "statusHistory": [
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
            ],
            "jsWarning": False,
            "lastAlertSent": "2026-01-02T00:00:00+00:00",  # Already alerted
        })

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 0

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_recovery_alert(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-a", email="user@example.com")
        create_test_link(
            user_id="user-a",
            link_id="link-a",
            status="LIVE",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 1
        call_kwargs = mock_ses.send_email.call_args[1]
        assert "live again" in call_kwargs["Message"]["Subject"]["Data"]

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_triggers_impact_scorer_for_pro(self, mock_ses, mock_lambda, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-pro", email="pro@example.com", plan="pro")
        create_test_link(
            user_id="user-pro",
            link_id="link-pro",
            status="MISSING",
            status_history=[
                {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
                {"date": "2026-01-02T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
            ],
        )

        result = lambda_handler({}, None)
        assert result["alertsSent"] == 1
        # Verify impact scorer was invoked
        mock_lambda.invoke.assert_called_once()
        invoke_kwargs = mock_lambda.invoke.call_args[1]
        assert invoke_kwargs["FunctionName"] == "linkkeeper-impact-scorer-test"


class TestSendAlert:
    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_missing_alert_email_content(self, mock_ses, mock_lambda):
        link = {
            "userId": "u1",
            "linkId": "l1",
            "pageUrl": "https://blog.example.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "my product",
        }
        _send_alert("user@test.com", link, "LIVE", "MISSING", "free")

        call_kwargs = mock_ses.send_email.call_args[1]
        subject = call_kwargs["Message"]["Subject"]["Data"]
        body = call_kwargs["Message"]["Body"]["Text"]["Data"]

        assert "MISSING" in subject
        assert "blog.example.com" in subject
        assert "my product" in body
        assert "mysite.com/product" in body
        assert "Possible causes" in body

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_404_alert_email_content(self, mock_ses, mock_lambda):
        link = {
            "userId": "u1",
            "linkId": "l1",
            "pageUrl": "https://blog.example.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "my product",
        }
        _send_alert("user@test.com", link, "LIVE", "404", "free")

        call_kwargs = mock_ses.send_email.call_args[1]
        subject = call_kwargs["Message"]["Subject"]["Data"]
        assert "404" in subject

    @patch("lambdas.alerts.handler.lambda_client")
    @patch("lambdas.alerts.handler.ses")
    def test_redirect_alert_email_content(self, mock_ses, mock_lambda):
        link = {
            "userId": "u1",
            "linkId": "l1",
            "pageUrl": "https://blog.example.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "my product",
        }
        _send_alert("user@test.com", link, "LIVE", "REDIRECT", "free")

        call_kwargs = mock_ses.send_email.call_args[1]
        subject = call_kwargs["Message"]["Subject"]["Data"]
        assert "redirecting" in subject.lower()

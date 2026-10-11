"""Requests that went around CloudFront (straight to the public Function URL) are refused once the stack sets
ORIGIN_VERIFY; local runs and tests (no ORIGIN_VERIFY) pass. Answers name only the stage's own site for CORS."""

import json

from api.handler import lambda_handler


def _event(path, method="GET", headers=None, body=None):
    return {"requestContext": {"http": {"method": method, "path": path}}, "headers": headers or {},
            "body": json.dumps(body) if body is not None else None}


def test_without_the_cloudfront_secret_every_route_is_refused(dynamodb_table, monkeypatch):
    monkeypatch.setenv("ORIGIN_VERIFY", "s3cret")
    for path, method in (("/api/public-config", "GET"), ("/api/webhooks/stripe", "POST"), ("/api/account", "GET"),
                         ("/api/admin/overview", "GET"), ("/api/admin/login", "POST"), ("/api/test-login", "POST"),
                         ("/api/items", "OPTIONS")):
        assert lambda_handler(_event(path, method), None)["statusCode"] == 403, path
        assert lambda_handler(_event(path, method, {"X-Origin-Verify": "s3cre"}), None)["statusCode"] == 403, path
    ok = lambda_handler(_event("/api/public-config", headers={"x-origin-verify": "s3cret"}), None)  # any header case
    assert ok["statusCode"] == 200
    ok = lambda_handler(_event("/api/public-config", headers={"X-Origin-Verify": "s3cret"}), None)
    assert ok["statusCode"] == 200


def test_local_runs_and_tests_have_no_secret_and_pass(dynamodb_table, monkeypatch):
    monkeypatch.delenv("ORIGIN_VERIFY", raising=False)
    assert lambda_handler(_event("/api/public-config"), None)["statusCode"] == 200


def test_answers_allow_only_the_stages_own_site(dynamodb_table, monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://test.yourapp.com")
    resp = lambda_handler(_event("/api/public-config"), None)
    assert resp["headers"]["Access-Control-Allow-Origin"] == "https://test.yourapp.com"

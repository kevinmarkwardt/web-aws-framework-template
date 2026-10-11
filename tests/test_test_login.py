"""Test-stage username login: token issue + verify, username rules, forged tokens, and off unless STAGE=test."""

import json
import sys

import pytest
from jose import jwt

import api.handler as handler
from api.lib import auth as api_auth


def _event(path, method="GET", body=None, token=None):
    return {"requestContext": {"http": {"method": method, "path": path}},
            "headers": {"authorization": f"Bearer {token}"} if token else {},
            "body": json.dumps(body) if body is not None else None}


def _auth_modules():
    """Both copies of lib/auth.py (tests import api.lib.auth; api/handler.py imports lib.auth, as Lambda does)."""
    return [m for m in (api_auth, sys.modules.get("lib.auth")) if m]


@pytest.fixture
def test_stage(dynamodb_table, monkeypatch):
    for m in _auth_modules():
        monkeypatch.setattr(m, "TEST_LOGIN", True)
        monkeypatch.setattr(m, "_test_key", "k" * 64)
    return dynamodb_table


def _login(username):
    return handler.lambda_handler(_event("/api/test-login", "POST", {"username": username}), None)


def test_username_login_creates_an_account(test_stage):
    resp = _login("Kevin")
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["userId"] == "t-kevin" and body["username"] == "kevin"
    acct = handler.lambda_handler(_event("/api/account", token=body["token"]), None)
    assert acct["statusCode"] == 200
    acct = json.loads(acct["body"])
    assert acct["userId"] == "t-kevin" and acct["email"] == "kevin@test.yourapp.com" and acct["plan"] == "free"
    items = handler.lambda_handler(_event("/api/items", token=body["token"]), None)
    assert items["statusCode"] == 200


def test_test_tokens_are_not_admin_tokens(test_stage, monkeypatch):
    import api.admin_handler as admin_handler

    token = json.loads(_login("admin")["body"])["token"]
    assert handler.lambda_handler(_event("/api/admin/users", token=token), None)["statusCode"] == 404  # user API: no admin
    test_stage.update_item(Key={"pk": "USER#t-admin", "sk": "PROFILE"}, UpdateExpression="SET isAdmin = :t",
                           ExpressionAttributeValues={":t": True})
    # even with the flag set and test login on in the same process (the local API), a test token is never an admin
    assert admin_handler.lambda_handler(_event("/api/admin/users", token=token), None)["statusCode"] == 403


def test_bad_usernames_and_forged_tokens(test_stage):
    for name in ("a@b.com", "x", "", "-dash-first", "a" * 33):
        assert _login(name)["statusCode"] == 400, name
    assert handler.lambda_handler(_event("/api/test-login", "POST", {"username": 7}), None)["statusCode"] == 400
    forged = jwt.encode({"sub": "t-kevin", "iss": "yourapp-test-login", "exp": 9999999999}, "wrong-key",
                        algorithm="HS256")
    assert handler.lambda_handler(_event("/api/account", token=forged), None)["statusCode"] == 401
    expired = jwt.encode({"sub": "t-kevin", "iss": "yourapp-test-login", "exp": 1}, "k" * 64, algorithm="HS256")
    assert handler.lambda_handler(_event("/api/account", token=expired), None)["statusCode"] == 401


def test_test_login_is_off_by_default(dynamodb_table):
    assert all(m.TEST_LOGIN is False for m in _auth_modules())  # conftest runs the API as STAGE=prod
    assert _login("kevin")["statusCode"] == 404


def test_test_tokens_are_refused_when_test_login_is_off(test_stage, monkeypatch):
    token = json.loads(_login("kevin")["body"])["token"]
    for m in _auth_modules():
        monkeypatch.setattr(m, "TEST_LOGIN", False)
    # without TEST_LOGIN the token is checked as a Cognito token, and fails (no such key id)
    for m in _auth_modules():
        monkeypatch.setattr(m, "_get_jwks", lambda: {"keys": []})
    assert handler.lambda_handler(_event("/api/account", token=token), None)["statusCode"] == 401


def test_only_the_test_stage_turns_it_on(monkeypatch):
    import importlib

    monkeypatch.setenv("STAGE", "prod")
    monkeypatch.setenv("TEST_LOGIN", "1")
    assert importlib.reload(api_auth).TEST_LOGIN is False
    monkeypatch.setenv("STAGE", "test")
    assert importlib.reload(api_auth).TEST_LOGIN is True
    monkeypatch.delenv("TEST_LOGIN")
    assert importlib.reload(api_auth).TEST_LOGIN is False
    monkeypatch.setenv("STAGE", "prod")
    importlib.reload(api_auth)

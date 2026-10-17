"""Who gets into the admin API (api/admin_handler.py, lib/admins.py): the admin Lambda's own X-Origin-Verify, a signed-in
user, the Cognito group "admins" (in the token AND live) AND isAdmin on the profile, re-checked on every request. The
user API Lambda never serves /api/admin/*."""

import json
import os

import boto3
import pytest
from moto import mock_aws

import api.admin_handler as admin_handler
import api.handler as handler

from .conftest import admin_call


def test_an_admin_gets_in(admin_who):
    assert admin_call("/api/admin/me")["userId"] == "admin1"


def test_no_token_is_401(admin_who):
    admin_who["uid"] = None
    assert admin_call("/api/admin/me", status=401)["code"] == "SIGNED_OUT"


def test_a_regular_user_is_403(admin_who, create_test_user):
    create_test_user("u1")
    admin_who.update(uid="u1", groups=[], live=set())
    assert admin_call("/api/admin/users", status=403)["code"] == "NOT_ADMIN"


def test_group_but_no_flag_is_403(admin_who, create_test_user):
    create_test_user("u1")
    admin_who.update(uid="u1", groups=["admins"], live={"admins"})
    admin_call("/api/admin/users", status=403)


def test_flag_but_no_group_is_403(admin_who, create_test_user):
    create_test_user("u1", isAdmin=True)
    admin_who.update(uid="u1", groups=[], live={"admins"})
    admin_call("/api/admin/users", status=403)
    admin_who.update(groups=["admins"], live=set())  # removed from the group since the token was issued
    admin_call("/api/admin/users", status=403)


def test_flag_removed_locks_out_on_the_next_request(admin_who, dynamodb_table):
    admin_call("/api/admin/me")
    dynamodb_table.update_item(Key={"pk": "USER#admin1", "sk": "PROFILE"}, UpdateExpression="SET isAdmin = :f",
                               ExpressionAttributeValues={":f": False})
    admin_call("/api/admin/me", status=403)


def test_cognito_unreachable_fails_closed(admin_who, monkeypatch):
    import sys

    def boom(username):
        raise RuntimeError("Cognito down")
    for name in ("lib.admins", "api.lib.admins"):
        monkeypatch.setattr(sys.modules[name], "cognito_groups", boom)
    admin_call("/api/admin/me", status=403)


def test_the_admin_lambda_checks_its_own_origin_header(admin_who, monkeypatch):
    monkeypatch.setenv("ORIGIN_VERIFY", "admin-secret")
    admin_call("/api/admin/me", status=403)  # no header: went around the admin distribution
    admin_call("/api/admin/me", status=403, headers={"X-Origin-Verify": "user-secret"})  # the user site's value
    admin_call("/api/admin/me", headers={"X-Origin-Verify": "admin-secret"})
    admin_call("/api/admin/nothing", status=403)  # before routing: even unknown paths


def test_the_user_api_never_serves_admin_routes(admin_who, monkeypatch):
    """Even for a real admin with a token: /api/admin/* is only on the admin Lambda."""
    monkeypatch.setattr(handler, "get_user_id", lambda event: "admin1")
    for method, path in (("GET", "/api/admin/me"), ("GET", "/api/admin/users"), ("POST", "/api/admin/users/u1/ban"),
                         ("PUT", "/api/admin/config"), ("GET", "/api/admin"), ("POST", "/api/admin/login")):
        event = {"requestContext": {"http": {"method": method, "path": path}}, "headers": {}, "body": "{}"}
        assert handler.lambda_handler(event, None)["statusCode"] == 404, path


def test_the_admin_lambda_serves_only_admin_routes(admin_who):
    for path in ("/api/account", "/api/items", "/api/webhooks/stripe", "/api/test-login"):
        event = {"requestContext": {"http": {"method": "GET", "path": path}}, "headers": {}}
        assert admin_handler.lambda_handler(event, None)["statusCode"] == 404, path


# ---- the live group check and set_admin against a (moto) Cognito pool

@pytest.fixture
def pool(dynamodb_table, monkeypatch):
    """A moto user pool with the admins group; USER_POOL_ID set. dynamodb_table's mock_aws covers cognito-idp too."""
    idp = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = idp.create_user_pool(PoolName="yourapp-test-users")["UserPool"]["Id"]
    idp.create_group(GroupName="admins", UserPoolId=pool_id)
    user = idp.admin_create_user(UserPoolId=pool_id, Username="kim@example.com",
                                 UserAttributes=[{"Name": "email", "Value": "kim@example.com"}])["User"]
    sub = next(a["Value"] for a in user["Attributes"] if a["Name"] == "sub")
    monkeypatch.setenv("USER_POOL_ID", pool_id)
    dynamodb_table.put_item(Item={"pk": f"USER#{sub}", "sk": "PROFILE", "userId": sub, "email": "kim@example.com",
                                  "listPk": "USER", "createdAt": "2026-01-01T00:00:00+00:00"})
    return idp, pool_id, sub


def test_live_group_check_and_grant_revoke_with_cognito(pool):
    from api.lib import admins

    idp, pool_id, sub = pool
    claims = {"sub": sub, "cognito:username": "kim@example.com", "cognito:groups": ["admins"]}
    assert admins.check(claims) == (None, "NOT_ADMIN")  # token says admins, Cognito and the profile don't
    admins.set_admin(sub, True, "cli:test", "first admin")
    assert admins.cognito_groups("kim@example.com") == {"admins"}
    assert admins.check(claims) == (sub, "")
    admins.set_admin(sub, False, "cli:test", "left")
    assert admins.check(claims) == (None, "NOT_ADMIN")
    assert admins.cognito_groups("kim@example.com") == set()
    with pytest.raises(admins.NotCognitoUser):
        admins.set_admin("t-bob", True, "cli:test", "test login account")


def test_make_admin_script(pool, tmp_path, capsys):
    """scripts/make-admin.py <stage> <email> [--revoke] against the stage's pool and table."""
    import importlib.util

    idp, pool_id, sub = pool
    outputs = tmp_path / "cdk-outputs-test.json"
    outputs.write_text(json.dumps({"YourAppTestStack": {"UserPoolId": pool_id, "TableName": "yourapp-test"}}))
    spec = importlib.util.spec_from_file_location("make_admin", os.path.join(os.path.dirname(__file__), "..", "scripts", "make-admin.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.main(["test", "Kim@Example.com", "--outputs", str(outputs)]) == 0
    from api.lib import admins
    assert admins.cognito_groups("kim@example.com") == {"admins"}
    t = boto3.resource("dynamodb", region_name="us-east-1").Table("yourapp-test")
    assert t.get_item(Key={"pk": f"USER#{sub}", "sk": "PROFILE"})["Item"]["isAdmin"] is True
    assert mod.main(["test", "kim@example.com", "--revoke", "--outputs", str(outputs)]) == 0
    assert admins.cognito_groups("kim@example.com") == set()
    assert t.get_item(Key={"pk": f"USER#{sub}", "sk": "PROFILE"})["Item"]["isAdmin"] is False
    assert mod.main(["test", "nobody@example.com", "--outputs", str(outputs)]) == 1
    assert mod.main(["staging", "kim@example.com"]) == 2

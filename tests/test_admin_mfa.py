"""Admin MFA (lib/admins.py, ADMIN_MFA=1): with the flag on, an admin without an enabled authenticator app (TOTP) gets
403 MFA_REQUIRED from every admin route, checked live in Cognito on every request and failing closed; non-admins still
get NOT_ADMIN (never a prompt to set up MFA). With the flag off (the test stage's default) TOTP isn't asked for."""

import sys

import pytest

from .conftest import admin_call


@pytest.fixture
def totp(admin_who, monkeypatch):
    """ADMIN_MFA on; state["totp"] is whether the caller has an authenticator app enabled (what Cognito answers live)."""
    monkeypatch.setenv("ADMIN_MFA", "1")
    admin_who["totp"] = False
    asked = []

    def has_totp(username):
        asked.append(username)
        return admin_who["totp"]
    for name in ("lib.admins", "api.lib.admins"):
        if name in sys.modules:
            monkeypatch.setattr(sys.modules[name], "has_totp", has_totp)
    admin_who["asked"] = asked
    return admin_who


def test_admin_without_totp_is_403_mfa_required(totp):
    for method, path in (("GET", "/api/admin/me"), ("GET", "/api/admin/users"), ("PUT", "/api/admin/config"),
                         ("POST", "/api/admin/actions/daily-job")):
        assert admin_call(path, method=method, body={}, status=403)["code"] == "MFA_REQUIRED", path


def test_admin_with_totp_gets_in(totp):
    totp["totp"] = True
    assert admin_call("/api/admin/me")["userId"] == "admin1"
    assert totp["asked"] == ["admin1"]  # the Cognito username, checked live


def test_totp_checked_on_every_request(totp):
    totp["totp"] = True
    admin_call("/api/admin/me")
    totp["totp"] = False  # MFA turned off since (e.g. an admin reset in the console)
    assert admin_call("/api/admin/me", status=403)["code"] == "MFA_REQUIRED"


def test_non_admin_gets_not_admin_not_an_mfa_prompt(totp, create_test_user):
    create_test_user("u1")
    totp.update(uid="u1", groups=[], live=set())
    assert admin_call("/api/admin/me", status=403)["code"] == "NOT_ADMIN"
    assert totp["asked"] == []  # MFA is only looked at once the caller is an admin


def test_signed_out_is_still_401(totp):
    totp["uid"] = None
    assert admin_call("/api/admin/me", status=401)["code"] == "SIGNED_OUT"


def test_cognito_unreachable_fails_closed(totp, monkeypatch):
    def boom(username):
        raise RuntimeError("Cognito down")
    for name in ("lib.admins", "api.lib.admins"):
        if name in sys.modules:
            monkeypatch.setattr(sys.modules[name], "has_totp", boom)
    assert admin_call("/api/admin/me", status=403)["code"] == "MFA_REQUIRED"


def test_flag_off_needs_no_totp(admin_who, monkeypatch):
    monkeypatch.delenv("ADMIN_MFA", raising=False)

    def never(username):
        raise AssertionError("TOTP looked up with ADMIN_MFA off")
    for name in ("lib.admins", "api.lib.admins"):
        if name in sys.modules:
            monkeypatch.setattr(sys.modules[name], "has_totp", never)
    assert admin_call("/api/admin/me")["userId"] == "admin1"
    monkeypatch.setenv("ADMIN_MFA", "0")
    assert admin_call("/api/admin/me")["userId"] == "admin1"


# ---- has_totp against a (moto) Cognito pool: UserMFASettingList from AdminGetUser

def test_has_totp_reads_the_users_mfa_settings(dynamodb_table, monkeypatch):
    import boto3

    from api.lib import admins

    idp = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = idp.create_user_pool(PoolName="yourapp-test-users", MfaConfiguration="OPTIONAL")["UserPool"]["Id"]
    client_id = idp.create_user_pool_client(UserPoolId=pool_id, ClientName="web",
                                            ExplicitAuthFlows=["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
                                            )["UserPoolClient"]["ClientId"]
    idp.admin_create_user(UserPoolId=pool_id, Username="kim@example.com",
                          UserAttributes=[{"Name": "email", "Value": "kim@example.com"}])
    idp.admin_set_user_password(UserPoolId=pool_id, Username="kim@example.com", Password="Passw0rd!x", Permanent=True)
    monkeypatch.setenv("USER_POOL_ID", pool_id)
    assert admins.has_totp("kim@example.com") is False

    # the admin site's setup: associate an authenticator, verify a code, make it the preferred MFA
    access = idp.admin_initiate_auth(UserPoolId=pool_id, ClientId=client_id, AuthFlow="ADMIN_USER_PASSWORD_AUTH",
                                     AuthParameters={"USERNAME": "kim@example.com", "PASSWORD": "Passw0rd!x"},
                                     )["AuthenticationResult"]["AccessToken"]
    idp.associate_software_token(AccessToken=access)
    assert admins.has_totp("kim@example.com") is False  # associated but not verified yet
    idp.verify_software_token(AccessToken=access, UserCode="123456")
    idp.admin_set_user_mfa_preference(UserPoolId=pool_id, Username="kim@example.com",
                                      SoftwareTokenMfaSettings={"Enabled": True, "PreferredMfa": True})
    assert admins.has_totp("kim@example.com") is True
    idp.admin_set_user_mfa_preference(UserPoolId=pool_id, Username="kim@example.com",
                                      SoftwareTokenMfaSettings={"Enabled": False, "PreferredMfa": False})
    assert admins.has_totp("kim@example.com") is False

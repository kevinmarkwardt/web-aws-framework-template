"""Who may use the admin API (api/admin_handler.py), and granting or revoking admin.

An admin is a Cognito user of this stage's pool who is BOTH
  - in the user pool group ADMIN_GROUP ("admins"; the CDK stack creates it), and
  - flagged isAdmin = true on their profile (USER#uid / PROFILE).
Both are re-checked on every admin request, never cached: the group in the verified ID token (`cognito:groups`) and
again live in Cognito (AdminListGroupsForUser), the flag in DynamoDB. Removing either one locks the account out of the
admin site on its next request. scripts/make-admin.py <stage> <email> [--revoke] sets both; so does an admin's
"admin" action on the Users tab (set_admin below).

Test-login tokens (the test stage's username login) are never admins: they aren't Cognito users, and the admin Lambda
doesn't accept them (it has no TEST_LOGIN).

Admin MFA (ADMIN_MFA=1; CDK context adminMfa, on by default in prod): an admin must also have an authenticator app
(TOTP) enabled on their Cognito user (AdminGetUser's UserMFASettingList has SOFTWARE_TOKEN_MFA), checked live on every
request. Without one the admin API answers 403 MFA_REQUIRED and the admin site walks them through the setup. With TOTP
enabled, Cognito asks every sign-in for the code (the pool's MFA is OPTIONAL: users may opt in, admins must).
"""

from __future__ import annotations

import os

import boto3

try:
    from lib import accounts, db
    from lib.auth import TEST_ISSUER
except ImportError:
    from api.lib import accounts, db
    from api.lib.auth import TEST_ISSUER

ADMIN_GROUP = "admins"


class NotCognitoUser(Exception):
    """The account has no Cognito user in this pool (a test-login account): it can't be an admin."""


def _cognito():
    return boto3.client("cognito-idp", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def _pool() -> str:
    return os.environ.get("USER_POOL_ID", "")


def cognito_groups(username: str) -> set[str]:
    """The groups `username` is in right now (live, not from the token)."""
    groups, kwargs = set(), {"UserPoolId": _pool(), "Username": username, "Limit": 60}
    while True:
        resp = _cognito().admin_list_groups_for_user(**kwargs)
        groups |= {g["GroupName"] for g in resp.get("Groups", [])}
        if not resp.get("NextToken"):
            return groups
        kwargs["NextToken"] = resp["NextToken"]


def check(claims: dict) -> tuple[str | None, str]:
    """(user id, "") for an admin; (None, why) otherwise. `claims` are verified token claims ({} = not signed in)."""
    uid = claims.get("sub")
    if not uid:
        return None, "SIGNED_OUT"
    if claims.get("iss") == TEST_ISSUER:
        return None, "NOT_ADMIN"
    in_token = claims.get("cognito:groups") or []
    if isinstance(in_token, str):
        in_token = in_token.split(",")
    if ADMIN_GROUP not in in_token:
        return None, "NOT_ADMIN"
    username = claims.get("cognito:username") or uid
    try:
        if ADMIN_GROUP not in cognito_groups(username):
            return None, "NOT_ADMIN"
    except Exception:  # noqa: BLE001 - can't confirm the group: refuse, never fail open
        return None, "NOT_ADMIN"
    if not accounts.is_admin(uid):
        return None, "NOT_ADMIN"
    if mfa_required():
        try:
            if not has_totp(username):
                return None, "MFA_REQUIRED"
        except Exception:  # noqa: BLE001 - can't confirm MFA: refuse, never fail open
            return None, "MFA_REQUIRED"
    return uid, ""


def mfa_required() -> bool:
    """Admins must have an authenticator app (ADMIN_MFA=1, set by the CDK stack's adminMfa context)."""
    return os.environ.get("ADMIN_MFA", "") == "1"


def has_totp(username: str) -> bool:
    """Whether `username` has a verified, enabled authenticator app (TOTP) right now (live, not from the token)."""
    user = _cognito().admin_get_user(UserPoolId=_pool(), Username=username)
    return "SOFTWARE_TOKEN_MFA" in (user.get("UserMFASettingList") or [])


def cognito_username(user_id: str) -> str:
    """The Cognito username of the user whose `sub` is user_id. Raises NotCognitoUser when there is none."""
    if not user_id or '"' in user_id:
        raise NotCognitoUser(user_id)
    users = _cognito().list_users(UserPoolId=_pool(), Filter=f'sub = "{user_id}"', Limit=1).get("Users", [])
    if not users:
        raise NotCognitoUser(user_id)
    return users[0]["Username"]


def set_admin(user_id: str, flag: bool, actor: str, reason: str) -> None:
    """Grant or revoke admin: the Cognito group and the profile flag together (audited by accounts.set_admin).
    Granting adds the group first, revoking clears the flag first, so a failure half way never leaves more access
    than intended."""
    username = cognito_username(user_id)
    if not db.get_user(user_id):
        raise NotCognitoUser(user_id)
    if flag:
        _cognito().admin_add_user_to_group(UserPoolId=_pool(), Username=username, GroupName=ADMIN_GROUP)
        accounts.set_admin(user_id, True, actor, reason)
    else:
        accounts.set_admin(user_id, False, actor, reason)
        _cognito().admin_remove_user_from_group(UserPoolId=_pool(), Username=username, GroupName=ADMIN_GROUP)

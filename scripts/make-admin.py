#!/usr/bin/env python3
"""Make a user an admin of a stage's admin site (admin.<domain> / admin.test.<domain>), or take it away.

  .venv/bin/python scripts/make-admin.py <test|prod> <email> [--revoke] [--outputs cdk-outputs-<stage>.json]

An admin needs both (api/lib/admins.py checks both on every admin request):
  - the Cognito group "admins" in the stage's user pool
  - isAdmin = true on their profile (USER#<sub> / PROFILE)
This sets or clears both, and writes an audit row (actor cli:<your login>). The user must have signed up and signed in
on the site once (that creates the profile). Test-login accounts (the test stage's username login) can't be admins:
they aren't Cognito users. Sign in again on the admin site afterwards (the group is in the ID token).

The pool and table come from cdk-outputs-<stage>.json (scripts/deploy.sh writes it), else from the stack's outputs.
Uses your AWS credentials; AWS_REGION defaults to us-east-1.
"""

from __future__ import annotations

import datetime as dt
import getpass
import json
import os
import sys
import time
import uuid
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parent.parent
STACKS = {"test": "YourAppTestStack", "prod": "YourAppStack"}
GROUP = "admins"
AUDIT_TTL_S = 548 * 86400  # 18 months, as api/lib/logs.py


def _outputs(stage: str, path: str | None) -> dict:
    file = Path(path) if path else ROOT / f"cdk-outputs-{stage}.json"
    if file.exists():
        return json.loads(file.read_text()).get(STACKS[stage], {})
    cfn = boto3.client("cloudformation", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    stack = cfn.describe_stacks(StackName=STACKS[stage])["Stacks"][0]
    return {o["OutputKey"]: o["OutputValue"] for o in stack.get("Outputs", [])}


def main(argv: list[str]) -> int:
    args = list(argv)
    out_file = None
    if "--outputs" in args:
        i = args.index("--outputs")
        out_file = args[i + 1] if i + 1 < len(args) else None
        del args[i:i + 2]
    revoke = "--revoke" in args
    args = [a for a in args if a != "--revoke"]
    if len(args) != 2 or args[0] not in STACKS:
        print(__doc__)
        return 2
    stage, email = args[0], args[1].strip().lower()
    region = os.environ.get("AWS_REGION", "us-east-1")
    outs = _outputs(stage, out_file)
    pool, table_name = outs.get("UserPoolId"), outs.get("TableName")
    if not pool or not table_name:
        print(f"UserPoolId / TableName missing from the {stage} stack outputs (deploy it first)")
        return 1

    idp = boto3.client("cognito-idp", region_name=region)
    if '"' in email:
        print("that isn't an email address")
        return 1
    users = idp.list_users(UserPoolId=pool, Filter=f'email = "{email}"', Limit=2).get("Users", [])
    if len(users) != 1:
        print(f"expected one Cognito user with email {email} on {stage}, found {len(users)} (sign up on the site first)")
        return 1
    username = users[0]["Username"]
    sub = next((a["Value"] for a in users[0].get("Attributes", []) if a["Name"] == "sub"), username)
    table = boto3.resource("dynamodb", region_name=region).Table(table_name)
    key = {"pk": f"USER#{sub}", "sk": "PROFILE"}
    if not table.get_item(Key=key).get("Item"):
        print(f"{email} has no profile on {stage} yet: sign in on the site once, then run this again")
        return 1

    if revoke:  # the flag first, so a failure half way never leaves more access than intended
        table.update_item(Key=key, UpdateExpression="SET isAdmin = :a", ExpressionAttributeValues={":a": False})
        idp.admin_remove_user_from_group(UserPoolId=pool, Username=username, GroupName=GROUP)
    else:
        idp.admin_add_user_to_group(UserPoolId=pool, Username=username, GroupName=GROUP)
        table.update_item(Key=key, UpdateExpression="SET isAdmin = :a", ExpressionAttributeValues={":a": True})

    now = dt.datetime.now(dt.timezone.utc)
    table.put_item(Item={"pk": f"AUDIT#{now.date().isoformat()}", "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
                         "at": now.isoformat(), "actor": f"cli:{getpass.getuser()}", "action": "user.admin",
                         "target": f"user:{sub}", "reason": "scripts/make-admin.py", "before": "",
                         "after": json.dumps({"isAdmin": not revoke}), "ttl": int(time.time()) + AUDIT_TTL_S})
    print(f"{email} on {stage}: admin {'revoked' if revoke else 'granted'} (group {GROUP!r} + isAdmin)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

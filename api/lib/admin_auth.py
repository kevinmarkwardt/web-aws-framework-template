"""Admin authentication via AWS Secrets Manager + bcrypt + JWT."""

from __future__ import annotations

import json
import os
import time

import bcrypt
import boto3
from jose import jwt

REGION = os.environ.get("AWS_REGION", "us-east-1")
SECRET_NAME = "yourapp/admin-credentials"


def _get_admin_secret() -> dict:
    client = boto3.client("secretsmanager", region_name=REGION)
    resp = client.get_secret_value(SecretId=SECRET_NAME)
    return json.loads(resp["SecretString"])


def verify_admin_login(email: str, password: str) -> str | None:
    """Verify admin email + password. Returns JWT token on success, None on failure."""
    secret = _get_admin_secret()
    if email != secret.get("email"):
        return None
    stored_hash = secret["passwordHash"].encode("utf-8")
    if not bcrypt.checkpw(password.encode("utf-8"), stored_hash):
        return None
    token = jwt.encode(
        {
            "sub": "admin",
            "email": email,
            "iat": int(time.time()),
            "exp": int(time.time()) + 86400,
        },
        secret["jwtSecret"],
        algorithm="HS256",
    )
    return token


def verify_admin_token(event: dict) -> bool:
    """Verify admin JWT from Authorization header. Returns True if valid."""
    headers = event.get("headers", {})
    auth = headers.get("authorization", headers.get("Authorization", ""))
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        secret = _get_admin_secret()
        claims = jwt.decode(token, secret["jwtSecret"], algorithms=["HS256"])
        return claims.get("sub") == "admin" and claims.get("exp", 0) > time.time()
    except Exception:
        return False

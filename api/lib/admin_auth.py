"""Admin authentication via AWS Secrets Manager + bcrypt + JWT.

The secret ({"email", "passwordHash", "jwtSecret"}) is written by scripts/setup-admin.sh <email>, one per stage
(yourapp/{stage}/admin-credentials). It is read through a 5-minute cache: every admin request verifies a token, and
Secrets Manager charges per call. A password reset reaches warm Lambdas within 5 minutes.
"""

from __future__ import annotations

import json
import os
import time

import bcrypt
import boto3
from jose import jwt

REGION = os.environ.get("AWS_REGION", "us-east-1")
STAGE = os.environ.get("STAGE", "prod")
SECRET_NAME = os.environ.get("ADMIN_SECRET_NAME", f"yourapp/{STAGE}/admin-credentials")
SECRET_TTL = 300  # seconds

_secret_cache: tuple[dict, float] | None = None


def _get_admin_secret() -> dict:
    global _secret_cache
    if _secret_cache and time.time() - _secret_cache[1] < SECRET_TTL:
        return _secret_cache[0]
    client = boto3.client("secretsmanager", region_name=REGION)
    resp = client.get_secret_value(SecretId=SECRET_NAME)
    _secret_cache = (json.loads(resp["SecretString"]), time.time())
    return _secret_cache[0]


def clear_cache() -> None:
    global _secret_cache
    _secret_cache = None


def verify_admin_login(email: str, password: str) -> str | None:
    """Verify admin email + password. Returns JWT token on success, None on failure."""
    secret = _get_admin_secret()
    if email.strip().lower() != str(secret.get("email", "")).strip().lower():
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
    headers = event.get("headers") or {}
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

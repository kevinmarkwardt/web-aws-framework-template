"""JWT token verification for Cognito tokens."""

from __future__ import annotations

import os
import json
import time
import urllib.request

from jose import jwk, jwt
from jose.utils import base64url_decode

USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
USER_POOL_CLIENT_ID = os.environ.get("USER_POOL_CLIENT_ID", "")
REGION = os.environ.get("AWS_REGION", "us-east-1")

_jwks_cache = None
_jwks_cache_time = 0
JWKS_CACHE_TTL = 3600  # 1 hour


def _get_jwks():
    global _jwks_cache, _jwks_cache_time
    now = time.time()
    if _jwks_cache and (now - _jwks_cache_time) < JWKS_CACHE_TTL:
        return _jwks_cache
    url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
    with urllib.request.urlopen(url) as resp:
        _jwks_cache = json.loads(resp.read())
        _jwks_cache_time = now
    return _jwks_cache


def verify_token(token: str) -> dict:
    """Verify a Cognito JWT and return claims. Raises on invalid token."""
    jwks = _get_jwks()
    headers = jwt.get_unverified_headers(token)
    kid = headers.get("kid")

    key = None
    for k in jwks.get("keys", []):
        if k["kid"] == kid:
            key = k
            break
    if key is None:
        raise ValueError("Token key ID not found in JWKS")

    public_key = jwk.construct(key)
    message, encoded_sig = token.rsplit(".", 1)
    decoded_sig = base64url_decode(encoded_sig.encode("utf-8"))
    if not public_key.verify(message.encode("utf-8"), decoded_sig):
        raise ValueError("Token signature verification failed")

    claims = jwt.get_unverified_claims(token)
    if claims.get("exp", 0) < time.time():
        raise ValueError("Token expired")
    if claims.get("iss") != f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}":
        raise ValueError("Token issuer mismatch")
    if claims.get("token_use") != "access" and claims.get("client_id") != USER_POOL_CLIENT_ID:
        if claims.get("token_use") == "id" and claims.get("aud") != USER_POOL_CLIENT_ID:
            raise ValueError("Token audience mismatch")

    return claims


def get_token_claims(event: dict) -> dict:
    """Extract all verified claims from Authorization header."""
    headers = event.get("headers", {})
    auth = headers.get("authorization", headers.get("Authorization", ""))
    if not auth.startswith("Bearer "):
        return {}
    token = auth[7:]
    try:
        return verify_token(token)
    except Exception:
        return {}


def get_user_id(event: dict) -> str | None:
    """Extract and verify user ID from Authorization header. Returns None on failure."""
    headers = event.get("headers", {})
    auth = headers.get("authorization", headers.get("Authorization", ""))
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        claims = verify_token(token)
        return claims.get("sub")
    except Exception:
        return None

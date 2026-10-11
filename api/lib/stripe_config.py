"""Stripe keys come from Secrets Manager at runtime; nothing secret lives in code, env vars or the repo.

The secret NAME is per stage (the CDK stack sets STRIPE_SECRET_NAME):
  yourapp/test/stripe   sandbox keys (test.yourapp.com)
  yourapp/prod/stripe   live keys    (yourapp.com)
Value: {"secretKey": "sk_...", "webhookSecret": "whsec_...", "publishableKey": "pk_..."} (scripts/stripe-secret.sh
writes secretKey, scripts/stripe-setup.py adds webhookSecret). Cached per Lambda container for 5 minutes, so a rotated
key is picked up without a deploy.

Every Stripe create sends an idempotency key (`idem(...)`), so a retried request never charges, refunds or subscribes
twice.
"""

from __future__ import annotations

import json
import os
import time

import boto3
import stripe

_cache: dict = {"at": 0.0, "value": None}
TTL_S = 300
# The API Lambda stops at 30 s; the SDK's default is 80 s per try. One call, retry included, gives up well inside that:
# 2 x (3 s connect + 10 s answer) + the retry's short pause. A call with no answer is handled as "no answer" (a card
# refund stays pending for payments.reconcile, a charge says it's still processing), never as a refusal.
CONNECT_TIMEOUT_S = 3
READ_TIMEOUT_S = 10
NETWORK_RETRIES = 1  # connection errors and timeouts only, with the same idempotency key
_http: dict = {}

KEY_PREFIX = "yourapp"  # idempotency keys and Stripe metadata (init.sh renames it with the app)


def secret_name() -> str:
    stage = os.environ.get("STAGE", "prod")
    return os.environ.get("STRIPE_SECRET_NAME") or f"yourapp/{stage}/stripe"


def _secret() -> dict:
    if _cache["value"] is None or time.time() - _cache["at"] > TTL_S:
        resp = boto3.client("secretsmanager").get_secret_value(SecretId=secret_name())
        _cache.update(value=json.loads(resp["SecretString"]), at=time.time())
    return _cache["value"]


def client() -> "stripe.StripeClient":
    """A Stripe client with this stage's key (never put in stripe.api_key) and short timeouts. The HTTP client (its
    connection pool) is kept for the warm Lambda. The test stage refuses a live key outright (real money on a site
    anyone can sign in to with a username); prod on sandbox keys is allowed before launch and shows as test mode."""
    if os.environ.get("STAGE") == "test" and is_live():
        raise RuntimeError(f"{secret_name()} holds a live Stripe key; the test stage only takes sk_test_ keys")
    if "client" not in _http:
        _http["client"] = stripe.RequestsClient(timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S))
    return stripe.StripeClient(_secret()["secretKey"], http_client=_http["client"], max_network_retries=NETWORK_RETRIES)


def webhook_secret() -> str:
    return _secret().get("webhookSecret", "")


def publishable_key() -> str:
    return _secret().get("publishableKey", "")


def is_live() -> bool:
    """A live key. The test stage must never hold one (scripts/stripe-secret.sh and stripe-setup.py refuse it)."""
    return _secret().get("secretKey", "").startswith(("sk_live_", "rk_live_"))


def idem(*parts) -> str:
    """A deterministic idempotency key: the same request (same parts) is answered once by Stripe."""
    return "-".join([KEY_PREFIX, *(str(p) for p in parts)])[:255]


def reset_cache() -> None:
    """Forget the cached secret (tests)."""
    _cache.update(value=None, at=0.0)

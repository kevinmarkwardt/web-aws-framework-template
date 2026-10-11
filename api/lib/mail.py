"""Email through SES, always sent from SES_FROM_EMAIL (noreply@ the domain; the stack's IAM condition allows no other
sender).

  to_user(user_id, subject, text)   to the address on the customer's profile; nothing when there is none
  to_admin(subject, text)           to ADMIN_EMAIL (cdk.json context adminEmail); nothing when it isn't set
A failed send is logged, never raised: the account alert or the admin page still says it.
"""

from __future__ import annotations

import logging
import os

import boto3

try:
    from lib import db
except ImportError:
    from api.lib import db

log = logging.getLogger("yourapp.mail")

APP_NAME = "YourApp"


def send(to: str, subject: str, text: str) -> bool:
    sender = os.environ.get("SES_FROM_EMAIL", "noreply@yourapp.com")
    try:
        boto3.client("ses").send_email(Source=f"{APP_NAME} <{sender}>", Destination={"ToAddresses": [to]},
                                       Message={"Subject": {"Data": subject[:200]}, "Body": {"Text": {"Data": text}}})
        return True
    except Exception:  # noqa: BLE001 - mail is a courtesy copy of what the site already shows
        log.exception("email failed: %s", subject[:80])
        return False


def to_user(user_id: str, subject: str, text: str) -> bool:
    to = (db.get_user(user_id) or {}).get("email")
    return send(to, subject, text) if to and "@" in to else False


def to_admin(subject: str, text: str) -> bool:
    to = os.environ.get("ADMIN_EMAIL", "")
    return send(to, f"[{APP_NAME}] {subject}", text) if to else False

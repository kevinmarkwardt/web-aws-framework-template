"""Email through SES, always sent from SES_FROM_EMAIL (noreply@ the domain; the stack's IAM condition allows no other
sender).

  to_user(user_id, subject, text, pref=None)   to the address on the customer's profile; nothing when there is none,
                                              or when `pref` (a lib/prefs.NOTIFICATIONS key) is turned off
  to_admin(subject, text)           to ADMIN_EMAIL (cdk.json context adminEmail); nothing when it isn't set
A failed send is logged, never raised: the account alert or the admin page still says it.
Write user mail in the user's language: i18n.t("...", lang=i18n.user_language(user_id), ...).
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


def to_user(user_id: str, subject: str, text: str, pref: str | None = None) -> bool:
    try:
        from lib import prefs
    except ImportError:
        from api.lib import prefs
    p = db.get_user(user_id) or {}
    if pref and not prefs.notifications(p).get(pref, True):
        return False
    to = p.get("email")
    return send(to, subject, text) if to and "@" in to else False


def to_admin(subject: str, text: str) -> bool:
    to = os.environ.get("ADMIN_EMAIL", "")
    return send(to, f"[{APP_NAME}] {subject}", text) if to else False

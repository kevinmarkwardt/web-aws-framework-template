"""A user's settings (PUT /api/account/settings, the Settings page): the profile's name and language, and the email
notifications they want. Stored on USER#uid / PROFILE: `name`, `language`, `notifications` {key: bool}.

NOTIFICATIONS are the email kinds a user can turn off, with their defaults. mail.to_user(..., pref=key) skips a mail
whose kind is off. Mail about the account's standing (warnings, bans) and money already taken always goes out.
Add a key here to give your own emails a switch (and its label in the Settings page's locale file).
"""

from __future__ import annotations

try:
    from lib import db, i18n
    from lib.i18n import Text
except ImportError:
    from api.lib import db, i18n
    from api.lib.i18n import Text

NOTIFICATIONS: dict[str, bool] = {
    "emailSupport": True,   # support answered a request
    "emailBilling": True,   # failed renewals and other billing notices
    "emailNews": False,     # product news and tips (the template sends none; for your own mailings)
}
NAME_MAX = 100


class Invalid(ValueError):
    """A setting the API won't store; the message (a Text) goes back as a 400."""


def notifications(p: dict) -> dict[str, bool]:
    """The user's notification switches: the defaults with their saved choices over them."""
    saved = p.get("notifications") or {}
    return {k: bool(saved.get(k, default)) for k, default in NOTIFICATIONS.items()}


def view(p: dict) -> dict:
    return {"name": p.get("name", ""), "language": i18n.normalize(p.get("language")) if p.get("language") else i18n.DEFAULT,
            "notifications": notifications(p)}


def validate(body: dict, p: dict) -> dict:
    """The fields to write from a settings body: any of name, language, notifications {key: bool}. Unknown keys and
    wrong types raise Invalid (nothing is written then)."""
    out: dict = {}
    for key in body:
        if key not in ("name", "language", "notifications"):
            raise Invalid(Text("Unknown setting: {key}", key=str(key)[:40]))
    if "name" in body:
        name = body["name"]
        if not isinstance(name, str) or not name.strip():
            raise Invalid(Text("Name cannot be empty."))
        if len(name.strip()) > NAME_MAX:
            raise Invalid(Text("Name must be {max} characters or less.", max=NAME_MAX))
        out["name"] = name.strip()
    if "language" in body:
        lang = body["language"]
        if not isinstance(lang, str) or lang not in i18n.LANGUAGES:
            raise Invalid(Text("Choose one of these languages: {languages}", languages=", ".join(i18n.LANGUAGES)))
        out["language"] = lang
    if "notifications" in body:
        given = body["notifications"]
        if not isinstance(given, dict):
            raise Invalid(Text("notifications must be an object"))
        merged = notifications(p)
        for k, v in given.items():
            if k not in NOTIFICATIONS:
                raise Invalid(Text("Unknown setting: {key}", key=f"notifications.{str(k)[:40]}"))
            if not isinstance(v, bool):
                raise Invalid(Text("{key} must be true or false", key=f"notifications.{k}"))
            merged[k] = v
        out["notifications"] = merged
    return out


def save(user_id: str, fields: dict) -> None:
    if not fields:
        return
    names = {f"#{k}": k for k in fields}
    db._get_table().update_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
                                UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
                                ExpressionAttributeNames=names, ExpressionAttributeValues={f":{k}": v for k, v in fields.items()})


def wants(user_id: str, key: str) -> bool:
    """Does the user want this kind of email (NOTIFICATIONS)?"""
    return notifications(db.get_user(user_id) or {}).get(key, True)

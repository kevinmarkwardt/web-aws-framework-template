"""The API's messages in the customer's language (CLAUDE.md, "i18n").

The sites send their language in an X-Language header (packages/shared/src/api.ts); handler.py calls `use(event)` per
request, and response.error / not_found / forbidden / unauthorized add the message in that language as `message` next
to the English `error` and the machine-readable `code`. Messages are keyed by their English text in
api/locales/{language}.json. A message with values in it is a template, filled after the lookup:
t("Choose between {min} and {max}", min=1, max=5).

The languages are the catalogs in api/locales/ (en.json lists every message, value = key, so a new language starts as
a copy of it); tests/test_language_sync.py keeps them equal to packages/shared/src/i18n/languages.ts.

Text for someone who isn't making the request (emails, account alerts) uses that person's saved language:
t(..., lang=user_language(user_id)). The profile's `language` is set by PUT /api/account/settings, or on the first
GET /api/account from the site's language. scripts/api-messages.py lists every message; tests/test_api_messages.py
keeps every catalog complete.
"""

from __future__ import annotations

import contextvars
import json
import pathlib

LOCALES = pathlib.Path(__file__).resolve().parents[1] / "locales"
DEFAULT = "en"
LANGUAGES: tuple[str, ...] = (DEFAULT,) + tuple(sorted(p.stem for p in LOCALES.glob("*.json") if p.stem != DEFAULT))
_current = contextvars.ContextVar("language", default=DEFAULT)
_catalogs: dict[str, dict[str, str]] = {}


def normalize(tag: str | None) -> str:
    """A language tag -> one of LANGUAGES: the exact code, else its base language ("es-MX" -> "es"), else English."""
    t = (tag or "").strip().replace("_", "-")
    by_lower = {c.lower(): c for c in LANGUAGES}
    if t.lower() in by_lower:
        return by_lower[t.lower()]
    return by_lower.get(t.lower().split("-")[0], DEFAULT)


def language_of(event: dict | None) -> str:
    """X-Language only (the sites send it on every call). Not Accept-Language: if a response is ever cached, X-Language
    is the header to add to the cache key, and answering by another header could hand one visitor's language to the next."""
    headers = {str(k).lower(): v for k, v in ((event or {}).get("headers") or {}).items()}
    return normalize(headers.get("x-language"))


def sent_language(event: dict | None) -> str | None:
    """The X-Language the request sent, normalized, or None when it sent none."""
    headers = {str(k).lower(): v for k, v in ((event or {}).get("headers") or {}).items()}
    return normalize(headers["x-language"]) if headers.get("x-language") else None


def use(event: dict | None) -> str:
    """This request's language (handler.py, once per request; a warm Lambda keeps the last one, so always call it)."""
    lang = language_of(event)
    _current.set(lang)
    return lang


def current() -> str:
    return _current.get()


def catalog(lang: str) -> dict[str, str]:
    if lang not in _catalogs:
        path = LOCALES / f"{lang}.json"
        _catalogs[lang] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return _catalogs[lang]


def t(text: str, lang: str | None = None, **values) -> str:
    """`text` (English, a template when values are given) in `lang` (default: this request's language). A message
    with no translation is sent in English."""
    lang = lang or current()
    out = text if lang == DEFAULT else catalog(lang).get(text, text)
    if values:
        try:
            out = out.format(**values)
        except (KeyError, IndexError, ValueError):  # a broken translation: fall back to the English template
            out = text.format(**values)
    return out


class Text(str):
    """An English message that keeps its template and values, so it can still be translated after it has been filled
    in and passed around (raised in an exception, returned as a reason): `raise BadRequest(Text("{name} must be text",
    name=name))`. It is the filled-in English string everywhere else. response.error translates it."""

    template: str
    values: dict

    def __new__(cls, template: str, **values):
        obj = super().__new__(cls, template.format(**values) if values else template)
        obj.template, obj.values = template, values
        return obj


def translate(message: str, lang: str | None = None) -> str:
    """A message (plain English or a Text) in `lang` (default: this request's)."""
    if is_text(message):  # by its attributes: tests load this module twice (lib.i18n and api.lib.i18n)
        return t(message.template, lang, **message.values)
    return t(message, lang)


def is_text(message) -> bool:
    return isinstance(message, str) and hasattr(message, "template") and hasattr(message, "values")


def message_of(e: BaseException) -> str:
    """An exception's message, keeping a Text (str(e) would drop its template)."""
    return e.args[0] if e.args and isinstance(e.args[0], str) else str(e)


def user_language(user_id: str) -> str:
    """The language saved on the user's profile (English when none)."""
    try:
        from lib import db
    except ImportError:
        from api.lib import db
    p = db._get_table().get_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}, ProjectionExpression="#l",
                                 ExpressionAttributeNames={"#l": "language"}).get("Item") or {}
    return normalize(p.get("language")) if p.get("language") else DEFAULT

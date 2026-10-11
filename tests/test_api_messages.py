"""The API's customer-facing messages (api/lib/i18n.py, scripts/api-messages.py): every message is in every language's
catalog with its {placeholders} intact, error answers keep their `code` and add `message` in the request's language,
and templates survive being raised."""

import importlib.util
import json
import pathlib
import re

import pytest

from api.lib import i18n, params, response
from api.lib.i18n import Text

from .conftest import _both, call

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("api_messages", ROOT / "scripts" / "api-messages.py")
api_messages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api_messages)


def _holes(s: str) -> list[str]:
    return sorted(re.findall(r"\{(\w*)\}", s))


def test_every_message_is_in_every_language_with_its_placeholders():
    messages, _ = api_messages.scan()
    assert len(messages) > 50  # the scan finds them (response.error, raised errors, i18n.t / Text)
    for lang in i18n.LANGUAGES:
        have = json.loads((i18n.LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
        missing = sorted(messages - set(have))
        assert not missing, f"{lang}: {len(missing)} missing, e.g. {missing[:3]} (scripts/api-messages.py --missing)"
        broken = [m for m in messages if _holes(have[m]) != _holes(m)]
        assert not broken, f"{lang}: placeholders differ in {broken[:3]}"


def test_english_catalog_is_exactly_the_messages():
    """en.json is what a new language copies: every message, value = key, nothing stale
    (scripts/api-messages.py --write-en rewrites it)."""
    messages, _ = api_messages.scan()
    en = json.loads((i18n.LOCALES / "en.json").read_text(encoding="utf-8"))
    assert set(en) == messages, f"stale: {sorted(set(en) - messages)[:3]}, new: {sorted(messages - set(en))[:3]}"
    assert all(k == v for k, v in en.items())


@pytest.fixture
def xx(monkeypatch):
    """A made-up second language "xx" with a few translations, in both copies of lib.i18n."""
    import api.handler  # noqa: F401  (loads the handler's lib.* copies)

    catalog = {"Name cannot be empty.": "XX: name empty", "{name} must be text": "XX: {name} text",
               "Unknown setting: {key}": "XX: unknown {key}", "Support replied": "XX: support replied",
               "No route: {method} {path}": "XX: no route {method} {path}"}
    for m in _both("lib.i18n"):
        monkeypatch.setattr(m, "LANGUAGES", ("en", "xx"))
        monkeypatch.setitem(m._catalogs, "xx", catalog)
    yield "xx"
    for m in _both("lib.i18n"):
        m.use({})


def test_error_keeps_code_and_english_and_adds_message():
    body = json.loads(response.error("You have {n} open requests. Add to one of them, or wait for an answer.", 429,
                                     "TOO_MANY_OPEN", n=3)["body"])
    assert body == {"error": "You have 3 open requests. Add to one of them, or wait for an answer.",
                    "message": "You have 3 open requests. Add to one of them, or wait for an answer.", "code": "TOO_MANY_OPEN"}


def test_messages_follow_the_request_language(xx, who, create_test_user):
    create_test_user("u1")
    h = {"X-Language": "xx"}
    out = call("/api/account/settings", "PUT", {"name": "  "}, status=400, headers=h)
    assert out["error"] == "Name cannot be empty." and out["message"] == "XX: name empty"
    out = call("/api/account/settings", "PUT", {"color": "red"}, status=400, headers=h)
    assert out["message"] == "XX: unknown color" and out["error"] == "Unknown setting: color"
    out = call("/api/nope", status=404, headers=h)
    assert out["message"] == "XX: no route GET /api/nope"
    # no header (or one we don't have): English
    assert call("/api/account/settings", "PUT", {"name": ""}, status=400)["message"] == "Name cannot be empty."
    assert call("/api/account/settings", "PUT", {"name": ""}, status=400, headers={"X-Language": "fr-CA"})["message"] == "Name cannot be empty."


def test_a_raised_template_is_still_translated(xx):
    for m in _both("lib.i18n"):  # response / params may use either copy (tests/conftest.py _both)
        m.use({"headers": {"x-language": "xx"}})
    with pytest.raises(params.BadRequest) as e:
        params.text({"name": 5}, "name")
    assert str(e.value) == "name must be text"  # plain English for logs
    assert json.loads(response.error(i18n.message_of(e.value), 400)["body"])["message"] == "XX: name text"
    assert i18n.translate(Text("{name} must be text", name="title"), "xx") == "XX: title text"
    assert i18n.t("not a known message") == "not a known message"


def test_language_tags_are_normalized(xx):
    assert i18n.normalize("XX") == "xx" and i18n.normalize("xx-YY") == "xx" and i18n.normalize("de") == "en"
    assert i18n.language_of({"headers": {"accept-language": "xx"}}) == "en"  # X-Language only
    assert i18n.sent_language({"headers": {}}) is None and i18n.sent_language({"headers": {"X-Language": "xx"}}) == "xx"


def test_cors_allows_the_language_header():
    assert "X-Language" in response.ok({})["headers"]["Access-Control-Allow-Headers"]

"""The Settings page's API (PUT /api/account/settings, api/lib/prefs.py): name, language and email notifications are
stored on the profile, every key is checked, a ban doesn't block them, and mail and alerts follow them."""

import sys

import pytest

from .conftest import _both, admin_call, call, profile


@pytest.fixture
def user(who, dynamodb_table, create_test_user):
    create_test_user("u1", "u1@example.com", name="Old Name")
    return dynamodb_table


def test_account_shows_the_settings_with_defaults(user):
    acct = call("/api/account")
    assert acct["name"] == "Old Name" and acct["language"] == "en"
    assert acct["notifications"] == {"emailSupport": True, "emailBilling": True, "emailNews": False}
    assert "settings" not in acct


def test_settings_are_saved(user):
    out = call("/api/account/settings", "PUT", {"name": "  New Name ", "language": "en",
                                                "notifications": {"emailNews": True, "emailSupport": False}})
    assert out == {"name": "New Name", "language": "en",
                   "notifications": {"emailSupport": False, "emailBilling": True, "emailNews": True}}
    p = profile(user)
    assert p["name"] == "New Name" and p["language"] == "en" and p["notifications"]["emailSupport"] is False
    # a partial save keeps the rest
    out = call("/api/account/settings", "PUT", {"notifications": {"emailBilling": False}})
    assert out["notifications"] == {"emailSupport": False, "emailBilling": False, "emailNews": True} and out["name"] == "New Name"
    assert call("/api/account")["notifications"]["emailBilling"] is False


@pytest.mark.parametrize("body", [
    {"color": "red"},                              # unknown key
    {"name": ""}, {"name": "x" * 101}, {"name": 5},
    {"language": "xx"}, {"language": 1},           # not a site language
    {"notifications": []}, {"notifications": {"emailSpam": True}}, {"notifications": {"emailNews": "yes"}},
    {"name": "Fine", "alertsEnabled": True},       # one bad key: nothing is written
])
def test_bad_settings_are_refused_and_nothing_is_written(user, body):
    call("/api/account/settings", "PUT", body, status=400)
    p = profile(user)
    assert p["name"] == "Old Name" and "notifications" not in p and "language" not in p


def test_a_banned_account_can_still_change_its_settings(user):
    user.update_item(Key={"pk": "USER#u1", "sk": "PROFILE"}, UpdateExpression="SET #s = :b, bannedUntil = :u",
                     ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":b": "banned", ":u": "2999-01-01"})
    assert call("/api/account/settings", "PUT", {"notifications": {"emailNews": False}})["notifications"]["emailNews"] is False


@pytest.fixture
def xx(monkeypatch):
    import api.handler  # noqa: F401

    for m in _both("lib.i18n"):
        monkeypatch.setattr(m, "LANGUAGES", ("en", "xx"))
        monkeypatch.setitem(m._catalogs, "xx", {"Support replied": "XX support replied", "{app} support replied": "XX {app}"})
    yield
    for m in _both("lib.i18n"):
        m.use({})


def test_the_site_language_is_saved_on_first_visit_and_then_only_by_settings(user, xx):
    assert call("/api/account", headers={"X-Language": "xx"})["language"] == "xx"
    assert profile(user)["language"] == "xx"
    assert call("/api/account", headers={"X-Language": "en"})["language"] == "xx"  # the setting, not the header
    assert call("/api/account/settings", "PUT", {"language": "en"})["language"] == "en"


def test_support_reply_mail_follows_the_users_language_and_switch(user, xx, admin_who, monkeypatch):
    sent = []
    monkeypatch.setattr(sys.modules["lib.mail"], "send", lambda to, subject, text: sent.append((to, subject)) or True)
    call("/api/account/settings", "PUT", {"language": "xx"})
    req = call("/api/support", "POST", {"topic": "billing", "message": "My credits did not show up after paying."}, status=201)
    admin_call(f"/api/admin/support/{req['id']}", "POST", {"reply": "Credited now."})
    assert ("u1@example.com", "XX YourApp") in sent
    assert call("/api/account/notes")["notes"][0]["title"] == "XX support replied"

    sent.clear()
    call("/api/account/settings", "PUT", {"notifications": {"emailSupport": False}})
    admin_call(f"/api/admin/support/{req['id']}", "POST", {"reply": "One more thing."})
    assert not [s for s in sent if s[0] == "u1@example.com"]  # switched off: no mail, the alert still comes
    assert len([n for n in call("/api/account/notes")["notes"] if n["kind"] == "support"]) == 2

"""Support requests: a customer writes in, follows up, the admin tab lists and answers it (alert + email), closing moves
it between queues; limits; only the customer's own requests; only admins see the admin side."""

import sys

import pytest

from .conftest import admin_call, call


@pytest.fixture
def site(who, admin_who, dynamodb_table, create_test_user, monkeypatch):
    create_test_user("u1", "u1@example.com")
    create_test_user("u2", "u2@example.com")
    sent = []
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setattr(sys.modules["lib.mail"], "send", lambda to, subject, text: sent.append((to, subject)) or True)
    return dynamodb_table, who, sent


def test_request_reaches_the_admin_tab_and_the_reply_comes_back(site):
    t, who, sent = site
    form = call("/api/support")
    assert form["requests"] == [] and {x["id"] for x in form["topics"]} == {"billing", "account", "bug", "other"}
    call("/api/support", "POST", {"topic": "billing", "message": "hi"}, status=400)  # too short
    req = call("/api/support", "POST", {"topic": "billing", "message": "My credits did not show up after paying."}, status=201)
    assert req["status"] == "open" and req["topicLabel"] == "Billing or payments" and "userId" not in req
    assert ("admin@example.com", "[YourApp] Support: Billing or payments") in sent
    follow = call(f"/api/support/{req['id']}", "POST", {"message": "Also my receipt never came."})
    assert follow["replies"][-1]["by"] == "customer"

    listing = admin_call("/api/admin/support")
    assert [r["id"] for r in listing["requests"]] == [req["id"]] and listing["counts"] == {"open": 1, "closed": 0}
    assert listing["requests"][0]["email"] == "u1@example.com"
    out = admin_call(f"/api/admin/support/{req['id']}", "POST", {"reply": "Found it, credited now.", "status": "closed"})
    assert out["status"] == "closed" and out["replies"][-1] == {**out["replies"][-1], "by": "admin:admin1"}
    assert admin_call("/api/admin/support")["requests"] == []
    assert admin_call("/api/admin/support", qs={"status": "closed"})["counts"] == {"open": 0, "closed": 1}
    assert len(admin_call("/api/admin/support", qs={"status": "all"})["requests"]) == 1
    admin_call("/api/admin/support", qs={"status": "weird"}, status=400)
    admin_call(f"/api/admin/support/{req['id']}", "POST", {}, status=400)

    mine = call("/api/support")["requests"]
    assert mine[0]["replies"][-1] == {**mine[0]["replies"][-1], "by": "support", "text": "Found it, credited now."}
    call(f"/api/support/{req['id']}", "POST", {"message": "one more"}, status=409)  # closed
    assert any(n["kind"] == "support" for n in call("/api/account/notes")["notes"])
    assert ("u1@example.com", "YourApp support replied") in sent
    audit = admin_call("/api/admin/audit", qs={"target": f"support:{req['id']}"})["entries"]
    assert audit and "Found it" not in audit[0]["reason"]  # the reply text isn't copied into the 18-month audit log


def test_only_your_own_requests(site):
    t, who, _ = site
    req = call("/api/support", "POST", {"topic": "account", "message": "Please change my email address."}, status=201)
    who["uid"] = "u2"
    assert call("/api/support")["requests"] == []
    call(f"/api/support/{req['id']}", "POST", {"message": "sneaky"}, status=404)


def test_limits_and_unknown_topics(site):
    for i in range(3):
        r = call("/api/support", "POST", {"topic": "nope", "message": f"Request number {i} with some words."}, status=201)
        assert r["topic"] == "other"
    assert call("/api/support", "POST", {"message": "A fourth open request is too many."}, status=429)["code"] == "TOO_MANY_OPEN"
    for _ in range(10):
        call(f"/api/support/{r['id']}", "POST", {"message": "and another thing"})
    call(f"/api/support/{r['id']}", "POST", {"message": "and another thing"}, status=429)


def test_non_admins_cant_answer(site):
    t, _, _ = site
    req = call("/api/support", "POST", {"topic": "bug", "message": "The page shows an error."}, status=201)
    t.update_item(Key={"pk": "USER#admin1", "sk": "PROFILE"}, UpdateExpression="SET isAdmin = :f", ExpressionAttributeValues={":f": False})
    admin_call(f"/api/admin/support/{req['id']}", "POST", {"reply": "hi"}, status=403)
    admin_call("/api/admin/support", status=403)

"""Contract test for __Entities__: the real API (api/routes/__routeModule__.py) answers the way the browser mocks did
(packages/shared/src/mocks/handlers.ts) for packages/shared/src/contracts/__entity__.ts: the list's shape, pages,
search, sort and filters, get, the 404 and 400 error shapes, admin create / update / delete, and every fixture record
passes the API's validation. Add your entity's business rules as tests next to these."""

import json
import pathlib
import re

import pytest

from tests.conftest import admin_call

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = json.loads(re.search(r"EntityContract = (\{.*\});", (ROOT / "packages/shared/src/contracts/__entity__.ts").read_text(encoding="utf-8"), re.S).group(1))
FIXTURE = json.loads((ROOT / "packages/shared/src/mocks/fixtures/__plural__.json").read_text(encoding="utf-8"))
FIELDS = {f["name"]: f for f in CONTRACT["fields"]}
TITLE = CONTRACT["titleField"]
PATH, ADMIN = CONTRACT["path"], CONTRACT["adminPath"]


def _route():
    from api.routes import __routeModule__
    return __routeModule__


def user_call(path, method="GET", body=None, status=200, qs=None, uid=None, monkeypatch=None):
    """A request through api.handler as `uid` (None: signed out)."""
    import api.handler as handler

    event = {"requestContext": {"http": {"method": method, "path": path}}, "headers": {},
             "queryStringParameters": qs, "body": json.dumps(body) if body is not None else None}
    monkeypatch.setattr(handler, "get_user_id", lambda event: uid)
    resp = handler.lambda_handler(event, None)
    assert resp["statusCode"] == status, resp
    return json.loads(resp["body"])


def sample(i: int) -> dict:
    """Fixture record i's fields (refs dropped: the referenced records don't exist in this test's table)."""
    rec = FIXTURE[i % len(FIXTURE)] if FIXTURE else {}
    out = {k: v for k, v in rec.items() if k in FIELDS and FIELDS[k]["type"] != "ref" and v is not None}
    for name, f in FIELDS.items():
        if f.get("required") and name not in out:
            out[name] = {"int": 1, "number": 1.5, "money": 100, "bool": True, "date": "2026-01-01",
                         "datetime": "2026-01-01T00:00:00Z", "enum": (f.get("values") or ["x"])[0], "tags": ["x"],
                         "email": "a@example.com", "url": "https://example.com", "image": "https://example.com/a.png",
                         "ref": "nope"}.get(f["type"], f"{name} {i}")
    out[TITLE] = f"{chr(ord('A') + i)} {out.get(TITLE, 'record')}"[:200]
    return out


@pytest.fixture
def made(dynamodb_table, admin_who):
    return [admin_call(ADMIN, "POST", sample(i), status=201) for i in range(3)]


def test_every_fixture_record_is_valid():
    from api.lib import entities

    for rec in FIXTURE:
        entities.validate(_route().ENTITY, {k: v for k, v in rec.items() if k in FIELDS}, partial=False)


def test_admin_create_answers_the_record(made):
    rec = made[0]
    assert rec["id"] and rec["createdAt"] and rec["updatedAt"] and rec[TITLE].startswith("A ")


def test_list_shape_pages_and_sort(made, monkeypatch):
    uid = None if CONTRACT["public"] else "u1"
    page = user_call(PATH, qs={"pageSize": "2", "sort": TITLE}, uid=uid, monkeypatch=monkeypatch)
    if CONTRACT["owner"] == "user" and not CONTRACT["public"]:
        assert page["total"] == 0  # private: admin-made records are nobody's
        return
    assert set(page) == {"items", "total", "page", "pageSize"}
    assert page["total"] == 3 and page["pageSize"] == 2 and len(page["items"]) == 2
    assert [r[TITLE][0] for r in page["items"]] == ["A", "B"]
    last = user_call(PATH, qs={"pageSize": "2", "page": "2", "sort": f"-{TITLE}"}, uid=uid, monkeypatch=monkeypatch)
    assert [r[TITLE][0] for r in last["items"]] == ["A"]
    found = user_call(PATH, qs={"q": made[1][TITLE].lower()}, uid=uid, monkeypatch=monkeypatch)
    assert made[1]["id"] in [r["id"] for r in found["items"]]


def test_get_and_not_found(made, monkeypatch):
    uid = None if CONTRACT["public"] else "u1"
    if not (CONTRACT["owner"] == "user" and not CONTRACT["public"]):
        assert user_call(f"{PATH}/{made[0]['id']}", uid=uid, monkeypatch=monkeypatch)["id"] == made[0]["id"]
    body = user_call(f"{PATH}/NOPE", status=404, uid=uid or "u1", monkeypatch=monkeypatch)
    assert body["code"] == "NOT_FOUND" and body["error"] and body["message"]


def test_bad_requests_name_the_field(made):
    body = admin_call(ADMIN, qs={"sort": "nonsense"}, status=400)
    assert body["code"] == "BAD_REQUEST" and body["field"] == "sort"
    required = next((n for n, f in FIELDS.items() if f.get("required")), None)
    if required:
        bad = admin_call(ADMIN, "POST", {k: v for k, v in sample(5).items() if k != required}, status=400)
        assert bad["field"] == required and bad["error"] and bad["message"]
    unknown = admin_call(ADMIN, "POST", {**sample(6), "notAField": 1}, status=400)
    assert unknown["field"] == "notAField"


def test_admin_update_and_delete(made):
    rid = made[0]["id"]
    out = admin_call(f"{ADMIN}/{rid}", "PUT", {TITLE: "Renamed"})
    assert out[TITLE] == "Renamed" and out["updatedAt"] >= made[0]["updatedAt"]
    assert admin_call(f"{ADMIN}/{rid}", "DELETE", {}) == {"deleted": True}
    admin_call(f"{ADMIN}/{rid}", status=404)
# #if userWrites


def test_users_write_only_their_own(dynamodb_table, admin_who, monkeypatch):
    mine = user_call(PATH, "POST", sample(1), status=201, uid="u1", monkeypatch=monkeypatch)
    assert mine["ownerId"] == "u1"
    user_call(f"{PATH}/{mine['id']}", "PUT", {TITLE: "Not yours"}, status=404, uid="u2", monkeypatch=monkeypatch)
    user_call(f"{PATH}/{mine['id']}", "DELETE", status=404, uid="u2", monkeypatch=monkeypatch)
    assert user_call(f"{PATH}/{mine['id']}", "PUT", {TITLE: "Still mine"}, uid="u1", monkeypatch=monkeypatch)[TITLE] == "Still mine"
    listed = user_call(PATH, qs={"mine": "1"}, uid="u1", monkeypatch=monkeypatch)
    assert [r["id"] for r in listed["items"]] == [mine["id"]]
    user_call(PATH, "POST", sample(2), status=401, uid=None, monkeypatch=monkeypatch)
# #endif

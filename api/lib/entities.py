"""The real backend of the spec's entities: the same HTTP contract as the browser mocks
(packages/shared/src/contracts/types.ts; the mocks are packages/shared/src/mocks/handlers.ts), so pages built on mocks
work unchanged once an entity is real.

An entity gets a backend with `python3 scripts/new-entity.py --backend <Entity>`, which writes api/routes/<plural>.py
(the entity's fields + its filter parameters), lists it in api/routes/entity_routes.py (handler.py and admin_handler.py
route through that), adds its filter parameters to the CloudFront cache key, writes tests/test_entity_<plural>.py and
turns the entity's mock off (mocks.config.ts).

Records: pk "<KIND>#<id>", sk "META", listPk "<KIND>" + createdAt (the list-index lists them newest first), ownerId for
user-owned entities. Lists read every record of the kind (db.list_all) and search / filter / sort / page in memory:
fine for hundreds or a few thousand records. Past that, add a GSI for the hot filter and query it instead.
Answers carry no Cache-Control, so CloudFront never caches them.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from decimal import Decimal

import ulid

try:
    from lib import accounts, db, logs, params, response
except ImportError:
    from api.lib import accounts, db, logs, params, response

SYSTEM_FIELDS = ("id", "createdAt", "updatedAt", "ownerId")
MAX_PAGE_SIZE = 100
LIMITS = {"string": 200, "text": 5000, "tags": 20, "tag": 40}
SEARCHABLE = {"string", "text", "email", "url", "tags"}
FILTERABLE = {"enum", "ref", "bool", "tags", "int"}
SORTABLE = {"string", "int", "number", "money", "date", "datetime", "enum", "bool", "email"}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_URL = re.compile(r"^(https?://|/)\S+$")
ID = r"[A-Za-z0-9_-]{1,64}"


@dataclass
class Entity:
    """One entity, as its contract describes it (api/routes/<plural>.py builds this from site.spec.yaml)."""
    name: str                 # Recipe
    plural: str               # recipes (the URL)
    kind: str                 # RECIPE (pk prefix, listPk)
    owner: str = "site"       # site | user | both
    public: bool = True
    title_field: str = "name"
    fields: list[dict] = field(default_factory=list)
    default_sort: str = "-createdAt"
    page_size: int = 24

    @property
    def path(self) -> str:
        return f"/api/{self.plural}"

    @property
    def admin_path(self) -> str:
        return f"/api/admin/{self.plural}"

    @property
    def user_writes(self) -> bool:
        return self.owner in ("user", "both")

    @property
    def read_access(self) -> str:
        return "public" if self.public else ("owner" if self.owner == "user" else "user")


class Invalid(Exception):
    """A 400 with the field it is about."""

    def __init__(self, message: str, field_name: str = "", **values):
        super().__init__(message)
        self.message, self.field, self.values = message, field_name, values


def _fail(message: str, status: int, code: str, field_name: str = "", **values) -> dict:
    resp = response.error(message, status, code, **values)
    if field_name:
        body = json.loads(resp["body"])
        body["field"] = field_name
        resp["body"] = json.dumps(body)
    return resp


def _not_found(e: Entity) -> dict:
    return response.error("{name} not found", 404, "NOT_FOUND", name=e.name)


# ---- validation (packages/shared/src/contracts/validate.ts)

def _empty(v) -> bool:
    return v is None or v == "" or (isinstance(v, list) and not v)


def _whole(v) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _check(f: dict, v):
    """None when `v` fits field `f`; else raises Invalid."""
    t, n = f["type"], f["name"]
    if v is None:
        return
    if t in ("string", "text"):
        if not isinstance(v, str):
            raise Invalid("{field} must be text", n, field=n)
        if len(v) > LIMITS[t]:
            raise Invalid("{field} must be at most {max} characters", n, field=n, max=LIMITS[t])
    elif t == "email":
        if not (isinstance(v, str) and _EMAIL.match(v)):
            raise Invalid("{field} must be an email address", n, field=n)
    elif t in ("url", "image"):
        if not (isinstance(v, str) and _URL.match(v)):
            raise Invalid("{field} must be a URL", n, field=n)
    elif t == "int":
        if not _whole(v):
            raise Invalid("{field} must be a whole number", n, field=n)
    elif t == "money":
        if not _whole(v):
            raise Invalid("{field} must be whole cents", n, field=n)
    elif t == "number":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
            raise Invalid("{field} must be a number", n, field=n)
    elif t == "bool":
        if not isinstance(v, bool):
            raise Invalid("{field} must be true or false", n, field=n)
    elif t == "date":
        if not (isinstance(v, str) and _DATE.match(v)):
            raise Invalid("{field} must be a date (YYYY-MM-DD)", n, field=n)
    elif t == "datetime":
        try:
            dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            raise Invalid("{field} must be a date and time", n, field=n) from None
        if not isinstance(v, str):
            raise Invalid("{field} must be a date and time", n, field=n)
    elif t == "enum":
        if v not in (f.get("values") or []):
            raise Invalid("{field} must be one of {values}", n, field=n, values=", ".join(f.get("values") or []))
    elif t == "ref":
        if not (isinstance(v, str) and 0 < len(v) <= 64):
            raise Invalid("{field} must be an id", n, field=n)
    elif t == "tags":
        if not (isinstance(v, list) and all(isinstance(x, str) and 0 < len(x) <= LIMITS["tag"] for x in v)):
            raise Invalid("{field} must be a list of short words", n, field=n)
        if len(v) > LIMITS["tags"]:
            raise Invalid("{field} takes at most {max}", n, field=n, max=LIMITS["tags"])


def validate(e: Entity, body, partial: bool) -> dict:
    """The body's fields, checked (create: every required one; update: those sent). Raises Invalid."""
    if not isinstance(body, dict):
        raise Invalid("The body must be a JSON object")
    known = {f["name"] for f in e.fields}
    for k in body:
        if k not in known and k not in SYSTEM_FIELDS:
            raise Invalid("Unknown field: {field}", k, field=k)
    out = {}
    for f in e.fields:
        n = f["name"]
        present = n in body
        if f.get("required") and (_empty(body.get(n)) if not partial else present and _empty(body[n])):
            raise Invalid("{field} is required", n, field=n)
        if present:
            v = None if body[n] == "" else body[n]
            if not _empty(v):
                _check(f, v)
            out[n] = v
    return out


def _store(v):
    """JSON values -> DynamoDB values (numbers as Decimal; whole floats as int)."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else Decimal(str(v))
    if isinstance(v, list):
        return [_store(x) for x in v]
    return v


# ---- reads

def _plain(record: dict) -> dict:
    return {k: v for k, v in record.items() if k not in ("pk", "sk", "listPk")}


def get(e: Entity, rid: str) -> dict | None:
    return db._get_table().get_item(Key={"pk": f"{e.kind}#{rid}", "sk": "META"}).get("Item")


def _sort_key(v):
    if v is None or v == "":
        return (1, "")
    if isinstance(v, bool):
        return (0, int(v))
    if isinstance(v, (int, float, Decimal)):
        return (0, float(v))
    return (0, str(v).lower())


def _matches(f: dict, v, want: str) -> bool:
    t = f["type"]
    if t == "tags":
        return isinstance(v, list) and any(str(x).lower() == want.lower() for x in v)
    if t == "bool":
        return str(v is True).lower() == want
    if t in ("int", "number", "money"):
        try:
            return v is not None and float(v) == float(want)
        except ValueError:
            return False
    return str(v if v is not None else "") == want


def query(e: Entity, event: dict, filters: dict[str, str], me: str | None, mine: bool = False) -> dict:
    """GET list: search (q), filters, sort, page, pageSize, mine=1. Raises Invalid for a bad sort or filter."""
    by_name = {f["name"]: f for f in e.fields}
    rows = [_plain(r) for r in db.list_all(e.kind)]
    if mine or params.query(event, "mine") == "1":
        rows = [r for r in rows if me and r.get("ownerId") == me]
    q = params.query(event, "q").strip().lower()
    if q:
        fs = [f for f in e.fields if f["type"] in SEARCHABLE]

        def hit(r):
            for f in fs:
                v = r.get(f["name"])
                if isinstance(v, list) and any(q in str(x).lower() for x in v):
                    return True
                if not isinstance(v, list) and q in str(v if v is not None else "").lower():
                    return True
            return False
        rows = [r for r in rows if hit(r)]
    for name, want in filters.items():
        if not want:
            continue
        f = by_name.get(name)
        if not f or f["type"] not in FILTERABLE:
            raise Invalid("Can't filter by {field}", name, field=name)
        rows = [r for r in rows if _matches(f, r.get(name), want)]
    sort = params.query(event, "sort") or e.default_sort
    desc = sort.startswith("-")
    key = sort[1:] if desc else sort
    if key not in ("createdAt", "updatedAt") and not (key in by_name and by_name[key]["type"] in SORTABLE):
        raise Invalid("Can't sort by {field}", "sort", field=key)
    rows.sort(key=lambda r: str(r.get("id")))
    filled = [r for r in rows if r.get(key) not in (None, "")]
    blank = [r for r in rows if r.get(key) in (None, "")]
    filled.sort(key=lambda r: _sort_key(r.get(key)), reverse=desc)
    rows = filled + blank  # empty values last either way
    size = params.query_int(event, "pageSize", e.page_size, 1, MAX_PAGE_SIZE)
    page = params.query_int(event, "page", 1, 1, 100000)
    return {"items": rows[(page - 1) * size: page * size], "total": len(rows), "page": page, "pageSize": size}


# ---- writes

def _refs_ok(e: Entity, data: dict, kinds: dict[str, str]) -> None:
    """Every ref value names an existing record (when the referenced entity has a backend too)."""
    for f in e.fields:
        if f["type"] == "ref" and data.get(f["name"]) and f.get("ref") in kinds:
            if not db._get_table().get_item(Key={"pk": f"{kinds[f['ref']]}#{data[f['name']]}", "sk": "META"}).get("Item"):
                raise Invalid("{field}: no {entity} with that id", f["name"], field=f["name"], entity=f["ref"])


def create(e: Entity, data: dict, owner: str | None, kinds: dict[str, str]) -> dict:
    _refs_ok(e, data, kinds)
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    rid = str(ulid.ULID())
    item = {"pk": f"{e.kind}#{rid}", "sk": "META", "listPk": e.kind, "id": rid, "createdAt": now, "updatedAt": now,
            **{k: _store(v) for k, v in data.items() if v is not None}}
    if e.user_writes:
        item["ownerId"] = owner
    db._get_table().put_item(Item={k: v for k, v in item.items() if v is not None})
    return _plain(item)


def update(e: Entity, record: dict, data: dict, kinds: dict[str, str]) -> dict:
    _refs_ok(e, data, kinds)
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    item = {**record, **{k: _store(v) for k, v in data.items()}, "updatedAt": now}
    db._get_table().put_item(Item={k: v for k, v in item.items() if v is not None})
    return _plain({k: v for k, v in item.items() if v is not None})


def delete(e: Entity, rid: str) -> None:
    db._get_table().delete_item(Key={"pk": f"{e.kind}#{rid}", "sk": "META"})


# ---- routing (handler.py and admin_handler.py, through routes/entity_routes.py)

def _body(event: dict):
    return params.body(event)


def route(e: Entity, method: str, path: str, user_id: str | None, event: dict, filters: dict[str, str],
          kinds: dict[str, str]) -> dict | None:
    """The user API's answer for `path` if it is this entity's, else None. Public reads need no sign-in; everything
    else does (401). Someone else's record (owner access) is "not found", never "forbidden"."""
    m = re.fullmatch(rf"{re.escape(e.path)}(?:/({ID}))?", path)
    if not m:
        return None
    rid = m.group(1)
    read = e.read_access
    try:
        if method == "GET":
            if read != "public" and not user_id:
                return response.unauthorized()
            if rid is None:
                return response.ok(query(e, event, filters, user_id, mine=read == "owner"))
            rec = get(e, rid)
            if not rec or (read == "owner" and rec.get("ownerId") != user_id):
                return _not_found(e)
            return response.ok(_plain(rec))
        if not e.user_writes or method not in ("POST", "PUT", "DELETE") or (method == "POST") != (rid is None):
            return None
        if not user_id:
            return response.unauthorized()
        allowed, why = accounts.can_write(user_id)
        if not allowed:
            return response.error(why, 403, "ACCOUNT_RESTRICTED")
        if method == "POST":
            return response.ok(create(e, validate(e, _body(event), False), user_id, kinds), 201)
        rec = get(e, rid)
        if not rec or rec.get("ownerId") != user_id:
            return _not_found(e)
        if method == "PUT":
            return response.ok(update(e, rec, validate(e, _body(event), True), kinds))
        delete(e, rid)
        return response.ok({"deleted": True})
    except Invalid as err:
        return _fail(err.message, 400, "BAD_REQUEST", err.field, **err.values)


def admin_routes(e: Entity, filters_of, kinds: dict[str, str]) -> list[tuple]:
    """ROUTES entries for api/admin_handler.py: (method, pattern, handler(event, actor, **groups)). English only; every
    write is audited (actor admin:{uid})."""
    def guard(fn):
        def run(event, actor, **kw):
            try:
                return fn(event, actor, **kw)
            except Invalid as err:
                return _fail(err.message, 400, "BAD_REQUEST", err.field, **err.values)
        return run

    target = lambda rid: f"{e.kind.lower()}:{rid}"  # noqa: E731

    def list_(event, actor):
        return response.ok(query(e, event, filters_of(event), None))

    def get_(event, actor, rid):
        rec = get(e, rid)
        return response.ok(_plain(rec)) if rec else _not_found(e)

    def create_(event, actor):
        out = create(e, validate(e, params.body(event), False), None, kinds)
        logs.audit(actor, f"{e.plural}.create", target(out["id"]), "", after=out)
        return response.ok(out, 201)

    def update_(event, actor, rid):
        rec = get(e, rid)
        if not rec:
            return _not_found(e)
        out = update(e, rec, validate(e, params.body(event), True), kinds)
        logs.audit(actor, f"{e.plural}.update", target(rid), "", before=_plain(rec), after=out)
        return response.ok(out)

    def delete_(event, actor, rid):
        rec = get(e, rid)
        if not rec:
            return _not_found(e)
        delete(e, rid)
        reason = str((params.body(event) if event.get("body") else {}).get("reason") or "")[:500]
        logs.audit(actor, f"{e.plural}.delete", target(rid), reason, before=_plain(rec))
        return response.ok({"deleted": True})

    one = rf"{re.escape(e.admin_path)}/(?P<rid>{ID})"
    return [("GET", re.escape(e.admin_path), guard(list_)), ("POST", re.escape(e.admin_path), guard(create_)),
            ("GET", one, guard(get_)), ("PUT", one, guard(update_)), ("DELETE", one, guard(delete_))]

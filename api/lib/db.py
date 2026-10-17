"""DynamoDB helpers for single-table design.

Listing an entity type across all users (the admin site's Users and Items tabs) never scans the table: records that can
be listed carry `listPk` (their type: "USER", "ITEM", ...) and `createdAt`, the keys of the KEYS_ONLY GSI `list-index`.
`list_page` reads one page newest first and fetches the records themselves in one batch. Only creation writes the
index (later updates to a profile or item never touch it). Give your own entity's records a listPk to list them too.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
LIST_INDEX = "list-index"  # partition listPk (the record type), sort createdAt; KEYS_ONLY (cdk stack)

_table = None
_client = None
_ser = TypeSerializer()


def _get_table():
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb")
        _table = dynamodb.Table(TABLE_NAME)
    return _table


def client():
    """The low-level DynamoDB client (typed values; transactions), made once per Lambda container."""
    global _client
    if _client is None:
        _client = boto3.client("dynamodb", region_name=_get_table().meta.client.meta.region_name)
    return _client


def query_all(**kwargs) -> list[dict]:
    """Every item a query matches, following LastEvaluatedKey."""
    table, out = _get_table(), []
    while True:
        page = table.query(**kwargs)
        out += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return out
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def batch_get(keys: list[dict]) -> list[dict]:
    """Items by {pk, sk} key, in no particular order (100 per request, retrying unprocessed keys)."""
    table = _get_table()
    keys = list({(k["pk"], k["sk"]): k for k in keys}.values())
    out: list[dict] = []
    for i in range(0, len(keys), 100):
        req = {table.name: {"Keys": keys[i:i + 100]}}
        while req:
            resp = table.meta.client.batch_get_item(RequestItems=req)
            out += resp["Responses"].get(table.name, [])
            req = resp.get("UnprocessedKeys") or None
    return out


# --- Conditional writes and transactions ---

def condition_failed(e: Exception) -> bool:
    """A single conditional write was refused (its ConditionExpression didn't hold)."""
    return isinstance(e, ClientError) and e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def conditional(call, **kwargs) -> bool:
    """Run one conditional write (e.g. `conditional(table.put_item, Item=..., ConditionExpression=...)`): True when it
    was written, False when its condition failed. Any other error raises."""
    try:
        call(**kwargs)
        return True
    except ClientError as e:
        if condition_failed(e):
            return False
        raise


def tx_cancelled(e: Exception) -> list[str] | None:
    """For a cancelled transaction: one cancellation code per item, in order ("ConditionalCheckFailed", "None", ...).
    None for any other error."""
    if not isinstance(e, ClientError) or e.response.get("Error", {}).get("Code") != "TransactionCanceledException":
        return None
    return [r.get("Code", "") for r in e.response.get("CancellationReasons", [])]


def low(d: dict) -> dict:
    """A record (or key, or expression values) in the low-level typed format transactions use; None values left out."""
    return {k: _ser.serialize(v) for k, v in d.items() if v is not None}


def _tx_cond(cond: str | None, names: dict | None, values: dict | None) -> dict:
    return {**({"ConditionExpression": cond} if cond else {}), **({"ExpressionAttributeNames": names} if names else {}),
            **({"ExpressionAttributeValues": low(values)} if values else {})}


def tx_put(item: dict, cond: str | None = None, names: dict | None = None, values: dict | None = None) -> dict:
    """A transaction Put of a plain-valued record into this stage's table."""
    return {"Put": {"TableName": _get_table().name, "Item": low(item), **_tx_cond(cond, names, values)}}


def tx_update(key: dict, expr: str, values: dict | None = None, cond: str | None = None, names: dict | None = None) -> dict:
    """A transaction Update (plain values) of the item at `key` in this stage's table."""
    return {"Update": {"TableName": _get_table().name, "Key": low(key), "UpdateExpression": expr,
                       **_tx_cond(cond, names, values)}}


def tx_delete(key: dict, cond: str | None = None, names: dict | None = None, values: dict | None = None) -> dict:
    """A transaction Delete of the item at `key` in this stage's table."""
    return {"Delete": {"TableName": _get_table().name, "Key": low(key), **_tx_cond(cond, names, values)}}


def transact(items: list[dict]) -> None:
    client().transact_write_items(TransactItems=items)


# --- Users ---

def get_user(user_id: str) -> dict | None:
    table = _get_table()
    resp = table.get_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"})
    return resp.get("Item")


def create_user(user_id: str, email: str, name: str = "") -> dict:
    table = _get_table()
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": f"USER#{user_id}",
        "sk": "PROFILE",
        "userId": user_id,
        "email": email or "unknown",
        "name": name,
        "plan": "free",
        "itemCount": 0,
        "createdAt": now,
        "listPk": "USER",  # list-index: the admin Users tab
        # language and notifications are added by the Settings page (lib/prefs.py; defaults until then)
    }
    # Don't set stripeCustomerId/stripeSubscriptionId — they're set during plan upgrade.
    # Empty strings are invalid for GSI key attributes.
    table.put_item(Item=item)
    return item


def increment_item_count(user_id: str, delta: int = 1):
    table = _get_table()
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET itemCount = itemCount + :d",
        ExpressionAttributeValues={":d": delta},
    )


# --- Items ---

def get_items(user_id: str) -> list[dict]:
    table = _get_table()
    resp = table.query(
        KeyConditionExpression=Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("ITEM#"),
    )
    return resp.get("Items", [])


def get_item(user_id: str, item_id: str) -> dict | None:
    table = _get_table()
    resp = table.get_item(Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"})
    return resp.get("Item")


def create_item(user_id: str, item_id: str, name: str, status: str = "ACTIVE") -> dict:
    table = _get_table()
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "pk": f"USER#{user_id}",
        "sk": f"ITEM#{item_id}",
        "userId": user_id,
        "itemId": item_id,
        "name": name,
        "status": status,
        "createdAt": now,
        "updatedAt": now,
        "listPk": "ITEM",  # list-index: the admin Items tab
    }
    table.put_item(Item=item)
    return item


def update_item(user_id: str, item_id: str, updates: dict) -> dict:
    table = _get_table()
    updates = dict(updates)  # copy to avoid mutating caller's dict
    updates["updatedAt"] = datetime.now(timezone.utc).isoformat()

    expr_parts = [f"#{k} = :{k}" for k in updates]
    expr_names = {f"#{k}": k for k in updates}
    expr_values = {f":{k}": v for k, v in updates.items()}

    resp = table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_item(user_id: str, item_id: str) -> None:
    table = _get_table()
    table.delete_item(Key={"pk": f"USER#{user_id}", "sk": f"ITEM#{item_id}"})


# --- Config ---

def get_config(config_key: str) -> dict | None:
    """Get a config record by key. Uses pk=CONFIG, sk={config_key}."""
    table = _get_table()
    resp = table.get_item(Key={"pk": "CONFIG", "sk": config_key})
    item = resp.get("Item")
    if item:
        item.pop("pk", None)
        item.pop("sk", None)
    return item


def put_config(config_key: str, data: dict):
    """Write a config record. Uses pk=CONFIG, sk={config_key}."""
    table = _get_table()
    item = {"pk": "CONFIG", "sk": config_key, **data}
    table.put_item(Item=item)


# --- Listing a record type across users (list-index; admin site) ---

class BadCursor(ValueError):
    """A list cursor that isn't one list_page returned."""


def _cursor_out(key: dict | None) -> str | None:
    return base64.urlsafe_b64encode(json.dumps(key, sort_keys=True).encode()).decode() if key else None


def _cursor_in(cursor: str | None) -> dict | None:
    if not cursor:
        return None
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except (ValueError, TypeError):
        raise BadCursor("bad cursor") from None
    if not isinstance(key, dict) or set(key) != {"pk", "sk", "listPk", "createdAt"} or not all(isinstance(v, str) for v in key.values()):
        raise BadCursor("bad cursor")
    return key


def list_page(kind: str, limit: int = 50, cursor: str | None = None) -> tuple[list[dict], str | None]:
    """One page of `kind` records (listPk), newest first, and the cursor for the next page (None at the end). A Query on
    the KEYS_ONLY list-index plus one BatchGetItem for the records: never a table scan."""
    kwargs = {"IndexName": LIST_INDEX, "KeyConditionExpression": Key("listPk").eq(kind), "ScanIndexForward": False,
              "Limit": max(1, min(int(limit), 100))}
    start = _cursor_in(cursor)
    if start:
        kwargs["ExclusiveStartKey"] = start
    resp = _get_table().query(**kwargs)
    keys = [{"pk": k["pk"], "sk": k["sk"]} for k in resp.get("Items", [])]
    found = {(r["pk"], r["sk"]): r for r in batch_get(keys)}
    rows = [found[(k["pk"], k["sk"])] for k in keys if (k["pk"], k["sk"]) in found]
    return rows, _cursor_out(resp.get("LastEvaluatedKey"))


def list_all(kind: str, page: int = 100):
    """Every `kind` record, newest first, a page at a time (generator). Reads them all: for totals on small sites."""
    cursor = None
    while True:
        rows, cursor = list_page(kind, page, cursor)
        yield from rows
        if not cursor:
            return


def count(kind: str) -> int:
    """How many `kind` records there are (a COUNT query on list-index; the records themselves aren't read)."""
    total, kwargs = 0, {"IndexName": LIST_INDEX, "KeyConditionExpression": Key("listPk").eq(kind), "Select": "COUNT"}
    while True:
        resp = _get_table().query(**kwargs)
        total += resp.get("Count", 0)
        if "LastEvaluatedKey" not in resp:
            return total
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def get_user_by_stripe_customer(customer_id: str) -> dict | None:
    """Find user by Stripe customer ID using GSI."""
    if not customer_id:
        return None
    table = _get_table()
    resp = table.query(
        IndexName="stripe-customer-index",
        KeyConditionExpression=Key("stripeCustomerId").eq(customer_id),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None

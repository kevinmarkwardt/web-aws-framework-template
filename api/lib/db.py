"""DynamoDB helpers for single-table design."""

from __future__ import annotations

import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")

_table = None


def _get_table():
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb")
        _table = dynamodb.Table(TABLE_NAME)
    return _table


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
        "settings": {
            "alertsEnabled": True,
            "digestEnabled": True,
            "remindersEnabled": True,
        },
    }
    # Don't set stripeCustomerId/stripeSubscriptionId — they're set during plan upgrade.
    # Empty strings are invalid for GSI key attributes.
    table.put_item(Item=item)
    return item


def update_user_plan(user_id: str, plan: str, stripe_customer_id: str = None,
                     stripe_subscription_id: str = None):
    table = _get_table()
    expr_parts = ["#plan = :plan"]
    names = {"#plan": "plan"}
    values = {":plan": plan}
    if stripe_customer_id:
        expr_parts.append("stripeCustomerId = :sci")
        values[":sci"] = stripe_customer_id
    if stripe_subscription_id:
        expr_parts.append("stripeSubscriptionId = :ssi")
        values[":ssi"] = stripe_subscription_id
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def clear_user_subscription(user_id: str):
    """Remove stale stripeSubscriptionId from user profile."""
    table = _get_table()
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="REMOVE stripeSubscriptionId",
    )


def update_user_name(user_id: str, name: str):
    table = _get_table()
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET #n = :n",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":n": name},
    )


def update_user_settings(user_id: str, settings: dict):
    table = _get_table()
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET settings = :s",
        ExpressionAttributeValues={":s": settings},
    )


def increment_item_count(user_id: str, delta: int = 1):
    table = _get_table()
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET itemCount = itemCount + :d",
        ExpressionAttributeValues={":d": delta},
    )


# --- Items ---

ITEM_LIMITS = {"free": 10, "starter": 100, "pro": float("inf")}


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


# --- Scan helpers (for worker Lambdas) ---

def scan_all_items(filter_plan: str = None) -> list[dict]:
    """Scan all items. Used by worker Lambdas."""
    table = _get_table()
    items = []
    params = {
        "FilterExpression": Key("sk").begins_with("ITEM#"),
    }
    while True:
        resp = table.scan(**params)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


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


def scan_all_users() -> list[dict]:
    """Scan all user profiles."""
    table = _get_table()
    items = []
    params = {
        "FilterExpression": Key("sk").eq("PROFILE"),
    }
    while True:
        resp = table.scan(**params)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items

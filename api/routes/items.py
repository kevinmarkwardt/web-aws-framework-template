"""Items CRUD routes.

This is the generic CRUD template. Rename 'items' to your domain entity
(e.g., 'posts', 'products', 'jobs') and extend with your business logic.
"""

from __future__ import annotations

import json

import ulid

try:
    from lib import db, response
except ImportError:
    from api.lib import db, response


def list_items(user_id: str, event: dict) -> dict:
    """GET /api/items — return all items for this user."""
    result = db.get_items(user_id)
    return response.ok(result)


def create_item(user_id: str, event: dict) -> dict:
    """POST /api/items — create a new item."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    plan = user.get("plan", "free")
    current_count = user.get("itemCount", 0)
    limit = db.ITEM_LIMITS.get(plan, 10)

    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    status = body.get("status", "ACTIVE").strip()

    if not name:
        return response.error("name is required", 400)

    if current_count >= limit:
        return response.error(
            f"Plan limit reached. {plan.title()} plan allows {int(limit)} items. "
            f"You have {current_count}.",
            403,
        )

    item_id = str(ulid.ULID())
    item = db.create_item(user_id, item_id, name, status)
    db.increment_item_count(user_id, 1)
    return response.ok(item, 201)


def update_item(user_id: str, item_id: str, event: dict) -> dict:
    """PUT /api/items/{itemId} — update name or status."""
    existing = db.get_item(user_id, item_id)
    if not existing:
        return response.not_found("Item not found")

    body = json.loads(event.get("body", "{}"))
    updates = {}
    if "name" in body:
        updates["name"] = body["name"].strip()
    if "status" in body:
        updates["status"] = body["status"].strip()

    updated = db.update_item(user_id, item_id, updates)
    return response.ok(updated)


def delete_item(user_id: str, item_id: str, event: dict) -> dict:
    """DELETE /api/items/{itemId} — remove an item."""
    existing = db.get_item(user_id, item_id)
    if not existing:
        return response.not_found("Item not found")

    db.delete_item(user_id, item_id)
    db.increment_item_count(user_id, -1)
    return response.ok({"deleted": True})

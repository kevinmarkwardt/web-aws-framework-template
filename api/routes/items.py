"""Items CRUD routes.

This is the generic CRUD template. Rename 'items' to your domain entity
(e.g., 'posts', 'products', 'jobs') and extend with your business logic.
"""

from __future__ import annotations

import ulid

try:
    from lib import config, db, params, response
except ImportError:
    from api.lib import config, db, params, response


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
    current_count = int(user.get("itemCount", 0))
    limit = config.plan_limit(plan)  # admin-editable (CONFIG | GLOBAL planLimits); None = unlimited

    body = params.body(event)
    name = params.text(body, "name").strip()
    status = params.text(body, "status", "ACTIVE").strip() or "ACTIVE"

    if not name:
        return response.error("name is required", 400)

    if limit is not None and current_count >= limit:
        return response.error(
            f"Plan limit reached. {plan.title()} plan allows {limit} items. "
            f"You have {current_count}.",
            403,
            "PLAN_LIMIT",
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

    body = params.body(event)
    updates = {}
    if "name" in body:
        updates["name"] = params.text(body, "name").strip()
        if not updates["name"]:
            return response.error("name cannot be empty", 400)
    if "status" in body:
        updates["status"] = params.text(body, "status").strip()
    if not updates:
        return response.ok(existing)

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

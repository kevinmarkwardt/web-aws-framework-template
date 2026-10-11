"""Items CRUD routes.

This is the generic CRUD template. Rename 'items' to your domain entity
(e.g., 'posts', 'products', 'jobs') and extend with your business logic.
"""

from __future__ import annotations

import ulid

try:
    from lib import accounts, config, db, params, response, subscriptions
except ImportError:
    from api.lib import accounts, config, db, params, response, subscriptions


def list_items(user_id: str, event: dict) -> dict:
    """GET /api/items — return all items for this user."""
    result = db.get_items(user_id)
    return response.ok(result)


def _read_only(user_id: str, user: dict | None = None) -> dict | None:
    """A banned account is read-only (api/lib/accounts.py): the 403 for writes, or None."""
    ok, why = accounts.can_write(user_id, user)
    return None if ok else response.error(why, 403, "ACCOUNT_RESTRICTED")


def create_item(user_id: str, event: dict) -> dict:
    """POST /api/items — create a new item."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)
    if refused := _read_only(user_id, user):
        return refused

    plan = subscriptions.effective_plan(user)  # free once a failed renewal's grace has run out
    current_count = int(user.get("itemCount", 0))
    limit = config.plan_limit(plan)  # admin-editable (CONFIG | GLOBAL planLimits); None = unlimited

    body = params.body(event)
    name = params.text(body, "name").strip()
    status = params.text(body, "status", "ACTIVE").strip() or "ACTIVE"

    if not name:
        return response.error("name is required", 400)

    if limit is not None and current_count >= limit:
        return response.error("Plan limit reached. The {plan} plan allows {limit} items. You have {count}.", 403, "PLAN_LIMIT",
                              plan=plan.title(), limit=limit, count=current_count)

    item_id = str(ulid.ULID())
    item = db.create_item(user_id, item_id, name, status)
    db.increment_item_count(user_id, 1)
    return response.ok(item, 201)


def update_item(user_id: str, item_id: str, event: dict) -> dict:
    """PUT /api/items/{itemId} — update name or status."""
    existing = db.get_item(user_id, item_id)
    if not existing:
        return response.not_found("Item not found")
    if refused := _read_only(user_id):
        return refused

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
    if refused := _read_only(user_id):
        return refused

    db.delete_item(user_id, item_id)
    db.increment_item_count(user_id, -1)
    return response.ok({"deleted": True})

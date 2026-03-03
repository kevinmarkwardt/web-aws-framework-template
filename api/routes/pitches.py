"""Pitches CRUD routes (Starter/Pro only)."""

from __future__ import annotations

import json

import ulid

try:
    from lib import db, response
except ImportError:
    from api.lib import db, response


ALLOWED_STATUSES = {
    "PITCHED", "FOLLOW_UP_DUE", "ACCEPTED", "DRAFT_SUBMITTED",
    "PUBLISHED", "REJECTED", "UNRESPONSIVE",
}


def _check_plan(user_id: str) -> dict | None:
    """Return error response if user is on free plan, else None."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)
    if user.get("plan", "free") == "free":
        return response.forbidden("Pipeline tracker requires Starter or Pro plan")
    return None


def list_pitches(user_id: str, event: dict) -> dict:
    err = _check_plan(user_id)
    if err:
        return err
    pitches = db.get_pitches(user_id)
    return response.ok(pitches)


def create_pitch(user_id: str, event: dict) -> dict:
    err = _check_plan(user_id)
    if err:
        return err

    body = json.loads(event.get("body", "{}"))
    if not body.get("domain"):
        return response.error("domain is required")

    pitch_id = str(ulid.ULID())
    item = db.create_pitch(user_id, pitch_id, body)
    return response.ok(item, 201)


def update_pitch(user_id: str, pitch_id: str, event: dict) -> dict:
    err = _check_plan(user_id)
    if err:
        return err

    existing = db.get_pitch(user_id, pitch_id)
    if not existing:
        return response.not_found("Pitch not found")

    body = json.loads(event.get("body", "{}"))
    allowed = {"domain", "contactName", "contactEmail", "pitchSentDate", "status",
               "publishedUrl", "publishedDate", "notes"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if "status" in updates and updates["status"] not in ALLOWED_STATUSES:
        return response.error(f"Invalid status. Must be one of: {', '.join(sorted(ALLOWED_STATUSES))}")

    # Auto-create monitored link when status changes to PUBLISHED
    if updates.get("status") == "PUBLISHED" and updates.get("publishedUrl"):
        user = db.get_user(user_id)
        plan = user.get("plan", "free") if user else "free"
        current_count = user.get("linkCount", 0) if user else 0
        limit = db.LINK_LIMITS.get(plan, 5)

        if current_count < limit:
            link_id = str(ulid.ULID())
            db.create_link(
                user_id, link_id,
                updates["publishedUrl"],
                updates.get("destinationUrl", updates["publishedUrl"]),
                "",
            )
            db.increment_link_count(user_id, 1)
            updates["linkedLinkId"] = link_id

    if updates:
        db.update_pitch(user_id, pitch_id, updates)

    updated = db.get_pitch(user_id, pitch_id)
    return response.ok(updated)


def delete_pitch(user_id: str, pitch_id: str, event: dict) -> dict:
    err = _check_plan(user_id)
    if err:
        return err

    existing = db.get_pitch(user_id, pitch_id)
    if not existing:
        return response.not_found("Pitch not found")

    db.delete_pitch(user_id, pitch_id)
    return response.ok({"deleted": pitch_id})

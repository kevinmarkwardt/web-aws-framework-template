"""Links CRUD routes."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

import ulid

try:
    from lib import db, response
except ImportError:
    from api.lib import db, response


def list_links(user_id: str, event: dict) -> dict:
    links = db.get_links(user_id)
    return response.ok(links)


def create_link(user_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    plan = user.get("plan", "free")
    current_count = user.get("linkCount", 0)
    limit = db.LINK_LIMITS.get(plan, 5)

    body = json.loads(event.get("body", "{}"))

    # Support single link or array of links
    is_bulk = isinstance(body, list)
    links_data = body if is_bulk else [body]

    if current_count + len(links_data) > limit:
        return response.error(
            f"Plan limit reached. {plan.title()} plan allows {int(limit)} links. "
            f"You have {current_count} and are trying to add {len(links_data)}.",
            403,
        )

    created = []
    for link_data in links_data:
        page_url = link_data.get("pageUrl", "").strip()
        destination_url = link_data.get("destinationUrl", "").strip()
        if not page_url or not destination_url:
            continue
        anchor_text = link_data.get("anchorText", "").strip()
        link_id = str(ulid.ULID())
        item = db.create_link(user_id, link_id, page_url, destination_url, anchor_text)
        created.append(item)

    if created:
        db.increment_link_count(user_id, len(created))

    # Return single object for single input, array for bulk
    result = created if is_bulk else (created[0] if created else {})
    return response.ok(result, 201)


def create_links_csv(user_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    plan = user.get("plan", "free")
    current_count = user.get("linkCount", 0)
    limit = db.LINK_LIMITS.get(plan, 5)

    body = event.get("body", "")
    if event.get("isBase64Encoded"):
        import base64
        body = base64.b64decode(body).decode("utf-8")

    reader = csv.DictReader(io.StringIO(body))
    links_data = []
    for row in reader:
        page_url = row.get("page_url", row.get("pageUrl", "")).strip()
        destination_url = row.get("destination_url", row.get("destinationUrl", "")).strip()
        anchor_text = row.get("anchor_text", row.get("anchorText", "")).strip()
        if page_url and destination_url:
            links_data.append({
                "pageUrl": page_url,
                "destinationUrl": destination_url,
                "anchorText": anchor_text,
            })

    if current_count + len(links_data) > limit:
        return response.error(
            f"Plan limit reached. {plan.title()} plan allows {int(limit)} links. "
            f"You have {current_count} and are trying to add {len(links_data)}.",
            403,
        )

    created = []
    for link_data in links_data:
        link_id = str(ulid.ULID())
        item = db.create_link(
            user_id, link_id,
            link_data["pageUrl"], link_data["destinationUrl"], link_data["anchorText"],
        )
        created.append(item)

    if created:
        db.increment_link_count(user_id, len(created))

    return response.ok(created, 201)


def update_link(user_id: str, link_id: str, event: dict) -> dict:
    existing = db.get_link(user_id, link_id)
    if not existing:
        return response.not_found("Link not found")

    body = json.loads(event.get("body", "{}"))
    allowed = {"pageUrl", "destinationUrl", "anchorText"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        return response.error("No valid fields to update")

    db.update_link(user_id, link_id, updates)
    updated = db.get_link(user_id, link_id)
    return response.ok(updated)


def delete_link(user_id: str, link_id: str, event: dict) -> dict:
    existing = db.get_link(user_id, link_id)
    if not existing:
        return response.not_found("Link not found")

    db.delete_link(user_id, link_id)
    db.increment_link_count(user_id, -1)
    return response.ok({"deleted": link_id})


def crawl_link(user_id: str, link_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user or user.get("plan") != "pro":
        return response.forbidden("On-demand crawl is a Pro feature")

    existing = db.get_link(user_id, link_id)
    if not existing:
        return response.not_found("Link not found")

    # Trigger async crawl via Lambda invocation
    import boto3
    client = boto3.client("lambda")
    payload = json.dumps({
        "singleLink": True,
        "userId": user_id,
        "linkId": link_id,
    })
    client.invoke(
        FunctionName=f"yourapp-crawler",
        InvocationType="Event",
        Payload=payload.encode(),
    )
    return response.ok({"message": "Crawl triggered", "linkId": link_id})


def get_link_history(user_id: str, link_id: str, event: dict) -> dict:
    existing = db.get_link(user_id, link_id)
    if not existing:
        return response.not_found("Link not found")

    return response.ok({
        "linkId": link_id,
        "status": existing.get("status"),
        "statusHistory": existing.get("statusHistory", []),
    })

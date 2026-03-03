"""YourApp Digest Sender — weekly Monday digest via SES.

Triggered by EventBridge every Monday at 7 AM ET.
Aggregates link stats per user and sends a summary email.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "digest@yourapp.com")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://yourapp.com")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
ses = boto3.client("ses")


def lambda_handler(event, context):
    """Generate and send weekly digest to all users."""
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()

    users = _scan_all_users()
    digests_sent = 0

    for user in users:
        settings = user.get("settings", {})
        if not settings.get("digestEnabled", True):
            continue

        email = user.get("email", "")
        if not email:
            continue

        user_id = user.get("userId", "")
        plan = user.get("plan", "free")

        links = _get_user_links(user_id)
        pitches = _get_user_pitches(user_id) if plan != "free" else []

        if not links:
            continue

        _send_digest(email, user_id, plan, links, pitches, week_ago, now)
        digests_sent += 1

    return {"digestsSent": digests_sent}


def _scan_all_users() -> list[dict]:
    items = []
    params = {"FilterExpression": Key("sk").eq("PROFILE")}
    while True:
        resp = table.scan(**params)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _get_user_links(user_id: str) -> list[dict]:
    resp = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("LINK#")
        )
    )
    return resp.get("Items", [])


def _get_user_pitches(user_id: str) -> list[dict]:
    resp = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PITCH#")
        )
    )
    return resp.get("Items", [])


def _send_digest(
    email: str,
    user_id: str,
    plan: str,
    links: list[dict],
    pitches: list[dict],
    week_ago: str,
    now: datetime,
):
    total = len(links)
    live = sum(1 for l in links if l.get("status") == "LIVE")
    missing = sum(1 for l in links if l.get("status") == "MISSING")
    errors = sum(1 for l in links if l.get("status") in ("404", "ERROR", "REDIRECT"))

    # Find losses and recoveries this week
    new_losses = []
    recovered = []
    for link in links:
        history = link.get("statusHistory", [])
        if len(history) < 2:
            continue
        for i in range(len(history) - 1, 0, -1):
            entry = history[i]
            if entry.get("date", "") < week_ago:
                break
            prev = history[i - 1]
            if prev.get("status") == "LIVE" and entry.get("status") in ("MISSING", "404"):
                new_losses.append({
                    "pageUrl": link.get("pageUrl"),
                    "status": entry.get("status"),
                    "date": entry.get("date", ""),
                })
            elif entry.get("status") == "LIVE" and prev.get("status") in ("MISSING", "404", "ERROR"):
                recovered.append({
                    "pageUrl": link.get("pageUrl"),
                    "date": entry.get("date", ""),
                })

    date_range = f"{(now - timedelta(days=7)).strftime('%b %d')} - {now.strftime('%b %d, %Y')}"
    subject = f"YourApp Weekly Digest — {date_range}"

    body_parts = [
        f"{total} links checked. {live} live, {missing} missing, {errors} errors.\n",
    ]

    if new_losses:
        body_parts.append("New losses since last week:")
        for loss in new_losses:
            body_parts.append(f"  - {loss['pageUrl']} — {loss['status'].lower()} since {loss['date'][:10]}")
        body_parts.append("")

    if recovered:
        body_parts.append("Recovered:")
        for rec in recovered:
            body_parts.append(f"  - {rec['pageUrl']} — back to live")
        body_parts.append("")

    if not new_losses and not recovered:
        body_parts.append("No status changes this week.\n")

    # Pipeline summary for Starter/Pro
    if plan != "free" and pitches:
        in_progress = sum(
            1 for p in pitches
            if p.get("status") in ("PITCHED", "FOLLOW_UP_DUE", "ACCEPTED", "DRAFT_SUBMITTED")
        )
        overdue = sum(
            1 for p in pitches
            if p.get("status") == "PITCHED"
            and p.get("pitchSentDate", "") < week_ago
        )
        published_this_week = sum(
            1 for p in pitches
            if p.get("status") == "PUBLISHED"
            and p.get("publishedDate", "") >= week_ago
        )
        body_parts.append("Pipeline:")
        body_parts.append(f"  - {in_progress} pitches in progress")
        body_parts.append(f"  - {overdue} follow-ups overdue")
        body_parts.append(f"  - {published_this_week} posts published this week")
        body_parts.append("")

    body_parts.append(f"View your dashboard: {FRONTEND_URL}/dashboard")

    body = "\n".join(body_parts)

    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
        },
    )

"""YourApp Alert Sender — status change detection + SES alerts.

Triggered after crawler completes. Scans links for status changes
since last alert and sends SES email notifications.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "alerts@yourapp.com")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://yourapp.com")
IMPACT_SCORER_FUNCTION = os.environ.get("IMPACT_SCORER_FUNCTION", "yourapp-impact-scorer")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
ses = boto3.client("ses")
lambda_client = boto3.client("lambda")


def lambda_handler(event, context):
    """Send alert emails for link status changes."""
    alerts_sent = 0

    # Scan all links
    links = _scan_links()

    # Group by user
    user_links = {}
    for link in links:
        uid = link.get("userId", "")
        if uid not in user_links:
            user_links[uid] = []
        user_links[uid].append(link)

    for user_id, links_list in user_links.items():
        user = _get_user(user_id)
        if not user:
            continue

        # Check if alerts are enabled
        settings = user.get("settings", {})
        if not settings.get("alertsEnabled", True):
            continue

        email = user.get("email", "")
        if not email:
            continue

        plan = user.get("plan", "free")

        for link in links_list:
            history = link.get("statusHistory", [])
            if len(history) < 2:
                continue

            current = history[-1]
            previous = history[-2]
            old_status = previous.get("status", "")
            new_status = current.get("status", "")

            if old_status == new_status:
                continue

            # Skip if we already sent an alert for this change
            last_alert = link.get("lastAlertSent", "")
            if last_alert and last_alert >= current.get("date", ""):
                continue

            _send_alert(email, link, old_status, new_status, plan)
            _mark_alert_sent(link["userId"], link["linkId"], current["date"])
            alerts_sent += 1

    return {"alertsSent": alerts_sent}


def _scan_links() -> list[dict]:
    items = []
    params = {"FilterExpression": Key("sk").begins_with("LINK#")}
    while True:
        resp = table.scan(**params)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _get_user(user_id: str) -> dict | None:
    resp = table.get_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"})
    return resp.get("Item")


def _send_alert(email: str, link: dict, old_status: str, new_status: str, plan: str):
    page_url = link.get("pageUrl", "")
    destination_url = link.get("destinationUrl", "")
    anchor_text = link.get("anchorText", "the link")
    from urllib.parse import urlparse
    domain = urlparse(page_url).netloc

    if old_status == "LIVE" and new_status == "MISSING":
        subject = f"YourApp Alert: Link on {domain} is now MISSING"
        body = (
            f"Your link on {page_url} changed status from {old_status} to {new_status}.\n\n"
            f'Your "{anchor_text}" link to {destination_url} is no longer detected on the page.\n\n'
            f"Possible causes:\n"
            f"- Page updated or redesigned (most common)\n"
            f"- Post deleted\n"
            f"- Link intentionally removed\n\n"
            f"View in Dashboard: {FRONTEND_URL}/dashboard\n"
        )

        # Trigger impact scoring for Pro users
        if plan == "pro":
            import json
            lambda_client.invoke(
                FunctionName=IMPACT_SCORER_FUNCTION,
                InvocationType="Event",
                Payload=json.dumps({
                    "userId": link["userId"],
                    "linkId": link["linkId"],
                    "pageUrl": page_url,
                    "destinationUrl": destination_url,
                    "email": email,
                }).encode(),
            )

    elif new_status == "LIVE" and old_status in ("MISSING", "404", "ERROR", "REDIRECT"):
        subject = f"YourApp: Link on {domain} is live again"
        body = (
            f"Good news — your link on {page_url} is back.\n\n"
            f'Your "{anchor_text}" link to {destination_url} is now detected on the page.\n\n'
            f"No action needed.\n"
        )

    elif new_status == "404":
        subject = f"YourApp Alert: Page on {domain} returning 404"
        body = (
            f"The page at {page_url} is returning a 404.\n\n"
            f'Your "{anchor_text}" link to {destination_url} was on this page.\n\n'
            f"View in Dashboard: {FRONTEND_URL}/dashboard\n"
        )

    elif new_status == "REDIRECT":
        subject = f"YourApp Alert: Page on {domain} redirecting"
        body = (
            f"The page at {page_url} is now redirecting to a different domain.\n\n"
            f'Your "{anchor_text}" link to {destination_url} may no longer be accessible.\n\n'
            f"View in Dashboard: {FRONTEND_URL}/dashboard\n"
        )

    else:
        subject = f"YourApp Alert: Link on {domain} is now {new_status}"
        body = (
            f"Your link on {page_url} changed status from {old_status} to {new_status}.\n\n"
            f"View in Dashboard: {FRONTEND_URL}/dashboard\n"
        )

    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
        },
    )


def _mark_alert_sent(user_id: str, link_id: str, timestamp: str):
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"LINK#{link_id}"},
        UpdateExpression="SET lastAlertSent = :t",
        ExpressionAttributeValues={":t": timestamp},
    )

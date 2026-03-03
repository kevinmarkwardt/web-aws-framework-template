"""LinkKeeper Reminder Sender — pipeline follow-up reminders.

Triggered by EventBridge daily at 8 AM ET.
Checks pitch dates and sends overdue follow-up reminders via SES.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("TABLE_NAME", "linkkeeper")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "reminders@linkkeeper.co")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://linkkeeper.co")

FOLLOWUP_DAYS = 7   # Remind after 7 days with no response
DRAFT_DAYS = 14     # Remind after 14 days with no draft submitted

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
ses = boto3.client("ses")


def lambda_handler(event, context):
    """Send daily follow-up reminders for overdue pitches."""
    now = datetime.now(timezone.utc)
    reminders_sent = 0

    users = _scan_all_users()

    for user in users:
        settings = user.get("settings", {})
        if not settings.get("remindersEnabled", True):
            continue

        plan = user.get("plan", "free")
        if plan == "free":
            continue  # Pipeline is Starter/Pro only

        email = user.get("email", "")
        if not email:
            continue

        user_id = user.get("userId", "")
        pitches = _get_user_pitches(user_id)

        for pitch in pitches:
            reminder = _check_pitch_reminder(pitch, now)
            if reminder:
                # Auto-update status to FOLLOW_UP_DUE when a follow-up is due
                if reminder == "followup" and pitch.get("status") == "PITCHED":
                    _update_pitch_status(user_id, pitch["pitchId"], "FOLLOW_UP_DUE")
                _send_reminder(email, pitch, reminder)
                _mark_reminder_sent(user_id, pitch["pitchId"], now.isoformat())
                reminders_sent += 1

    return {"remindersSent": reminders_sent}


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


def _get_user_pitches(user_id: str) -> list[dict]:
    resp = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"USER#{user_id}") & Key("sk").begins_with("PITCH#")
        )
    )
    return resp.get("Items", [])


def _check_pitch_reminder(pitch: dict, now: datetime) -> str | None:
    """Check if pitch needs a reminder. Returns reminder type or None."""
    status = pitch.get("status", "")
    pitch_date_str = pitch.get("pitchSentDate", "")
    last_reminder = pitch.get("lastReminderSent", "")

    # Don't send more than one reminder per day
    if last_reminder:
        try:
            last_dt = datetime.fromisoformat(last_reminder.replace("Z", "+00:00"))
            if (now - last_dt).days < 1:
                return None
        except (ValueError, TypeError):
            pass

    if not pitch_date_str:
        return None

    try:
        pitch_date = datetime.fromisoformat(pitch_date_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None

    days_ago = (now - pitch_date).days

    if status == "PITCHED" and days_ago >= FOLLOWUP_DAYS:
        return "followup"

    if status == "ACCEPTED" and days_ago >= DRAFT_DAYS:
        return "draft"

    return None


def _send_reminder(email: str, pitch: dict, reminder_type: str):
    domain = pitch.get("domain", "unknown")
    pitch_date = pitch.get("pitchSentDate", "")[:10]

    if reminder_type == "followup":
        try:
            pitch_dt = datetime.fromisoformat(pitch.get("pitchSentDate", "").replace("Z", "+00:00"))
            days_ago = (datetime.now(timezone.utc) - pitch_dt).days
        except (ValueError, TypeError):
            days_ago = 7
        subject = f"LinkKeeper: Follow up with {domain}"
        body = (
            f"{domain} hasn't responded to your pitch from {pitch_date} ({days_ago} days ago).\n\n"
            f"A quick follow-up email typically improves response rates by 2x.\n\n"
            f"Update status in Dashboard: {FRONTEND_URL}/dashboard/pipeline\n"
        )
    elif reminder_type == "draft":
        subject = f"LinkKeeper: Submit draft for {domain}"
        body = (
            f"Your guest post for {domain} was accepted but no draft has been submitted.\n\n"
            f"Pitch was sent on {pitch_date}.\n\n"
            f"Update status in Dashboard: {FRONTEND_URL}/dashboard/pipeline\n"
        )
    else:
        return

    ses.send_email(
        Source=SES_FROM_EMAIL,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
        },
    )


def _update_pitch_status(user_id: str, pitch_id: str, status: str):
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"PITCH#{pitch_id}"},
        UpdateExpression="SET #status = :s",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":s": status},
    )


def _mark_reminder_sent(user_id: str, pitch_id: str, timestamp: str):
    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"PITCH#{pitch_id}"},
        UpdateExpression="SET lastReminderSent = :t",
        ExpressionAttributeValues={":t": timestamp},
    )

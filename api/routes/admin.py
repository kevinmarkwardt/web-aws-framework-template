"""Admin API routes — /api/admin/*."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta

import boto3

try:
    from lib.admin_auth import verify_admin_login, verify_admin_token
    from lib.db import (
        _get_table, scan_all_users, scan_all_links, scan_all_pitches,
        get_user, get_links, get_pitches, update_user_plan,
        delete_link, delete_pitch, update_link, update_pitch,
        increment_link_count,
        get_config as db_get_config, put_config as db_put_config,
    )
    from lib.response import ok, error, unauthorized, not_found, forbidden
    from routes import billing
except ImportError:
    from api.lib.admin_auth import verify_admin_login, verify_admin_token
    from api.lib.db import (
        _get_table, scan_all_users, scan_all_links, scan_all_pitches,
        get_user, get_links, get_pitches, update_user_plan,
        delete_link, delete_pitch, update_link, update_pitch,
        increment_link_count,
        get_config as db_get_config, put_config as db_put_config,
    )
    from api.lib.response import ok, error, unauthorized, not_found, forbidden
    from api.routes import billing

REGION = os.environ.get("AWS_REGION", "us-east-1")


def _parse_body(event: dict) -> dict:
    import base64 as b64

    body = event.get("body", "{}")
    is_b64 = event.get("isBase64Encoded", False)

    if is_b64 and isinstance(body, str):
        body = b64.b64decode(body).decode("utf-8")

    if isinstance(body, str):
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            # Function URL may base64-encode without setting isBase64Encoded
            # (e.g. when CloudFront strips Content-Type). Try b64 as fallback.
            try:
                body = b64.b64decode(body).decode("utf-8")
                return json.loads(body)
            except Exception:
                pass
            raise
    return body if isinstance(body, dict) else {}


def _require_admin(event: dict):
    """Returns an error response if admin auth fails, None if OK."""
    if not verify_admin_token(event):
        return unauthorized("Invalid or expired admin token")
    return None


# --- Login ---

def login(event: dict) -> dict:
    body = _parse_body(event)
    email = body.get("email", "")
    password = body.get("password", "")
    if not email or not password:
        return error("Email and password required")
    token = verify_admin_login(email, password)
    if not token:
        return error("Invalid credentials", 401)
    return ok({"token": token})


# --- Overview ---

def get_overview(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    users = scan_all_users()
    links = scan_all_links()

    plan_counts = {"free": 0, "starter": 0, "pro": 0}
    for u in users:
        plan = u.get("plan", "free")
        plan_counts[plan] = plan_counts.get(plan, 0) + 1

    status_counts = {}
    for lnk in links:
        s = lnk.get("status", "PENDING")
        status_counts[s] = status_counts.get(s, 0) + 1

    mrr = plan_counts.get("starter", 0) * 9 + plan_counts.get("pro", 0) * 19

    return ok({
        "totalUsers": len(users),
        "planCounts": plan_counts,
        "totalLinks": len(links),
        "statusCounts": status_counts,
        "mrr": mrr,
    })


# --- Users ---

def list_users(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    users = scan_all_users()
    cleaned = []
    for u in users:
        u.pop("pk", None)
        u.pop("sk", None)
        cleaned.append(u)
    cleaned.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return ok(cleaned)


def get_user_detail(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    user.pop("pk", None)
    user.pop("sk", None)
    user_links = get_links(user_id)
    for lnk in user_links:
        lnk.pop("pk", None)
        lnk.pop("sk", None)
    user_pitches = get_pitches(user_id)
    for p in user_pitches:
        p.pop("pk", None)
        p.pop("sk", None)
    return ok({"user": user, "links": user_links, "pitches": user_pitches})


def update_user(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    body = _parse_body(event)
    new_plan = body.get("plan")
    if new_plan and new_plan in ("free", "starter", "pro"):
        update_user_plan(user_id, new_plan)
    return ok({"updated": True})


def delete_user_account(event: dict, user_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    user = get_user(user_id)
    if not user:
        return not_found("User not found")
    user_links = get_links(user_id)
    for lnk in user_links:
        delete_link(user_id, lnk["linkId"])
    user_pitches = get_pitches(user_id)
    for p in user_pitches:
        delete_pitch(user_id, p["pitchId"])
    table = _get_table()
    table.delete_item(Key={"pk": f"USER#{user_id}", "sk": "PROFILE"})
    return ok({"deleted": True})


# --- Links (admin) ---

def list_all_links(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    params = event.get("queryStringParameters") or {}
    status_filter = params.get("status")
    q = params.get("q", "").lower()

    links = scan_all_links()
    for lnk in links:
        lnk.pop("pk", None)
        lnk.pop("sk", None)

    if status_filter:
        links = [l for l in links if l.get("status") == status_filter]
    if q:
        links = [l for l in links if q in l.get("pageUrl", "").lower()
                 or q in l.get("destinationUrl", "").lower()
                 or q in l.get("anchorText", "").lower()]
    links.sort(key=lambda x: x.get("lastChecked", ""), reverse=True)
    return ok(links)


def update_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    allowed = {"pageUrl", "destinationUrl", "anchorText", "status"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        update_link(user_id, link_id, updates)
    return ok({"updated": True})


def delete_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    delete_link(user_id, link_id)
    increment_link_count(user_id, -1)
    return ok({"deleted": True})


def crawl_admin_link(event: dict, user_id: str, link_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-crawler",
        InvocationType="Event",
        Payload=json.dumps({"singleLink": True, "userId": user_id, "linkId": link_id}),
    )
    return ok({"crawlTriggered": True})


# --- Pitches (admin) ---

def list_all_pitches(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    pitches = scan_all_pitches()
    for p in pitches:
        p.pop("pk", None)
        p.pop("sk", None)
    pitches.sort(key=lambda x: x.get("pitchSentDate", ""), reverse=True)
    return ok(pitches)


def update_admin_pitch(event: dict, user_id: str, pitch_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    allowed = {"domain", "contactName", "contactEmail", "pitchSentDate",
               "status", "publishedUrl", "publishedDate", "notes"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if updates:
        update_pitch(user_id, pitch_id, updates)
    return ok({"updated": True})


def delete_admin_pitch(event: dict, user_id: str, pitch_id: str) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    delete_pitch(user_id, pitch_id)
    return ok({"deleted": True})


# --- Health ---

def get_health(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    cw = boto3.client("cloudwatch", region_name=REGION)
    lam = boto3.client("lambda", region_name=REGION)
    ddb = boto3.client("dynamodb", region_name=REGION)

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)

    functions = [
        "linkkeeper-api", "linkkeeper-crawler", "linkkeeper-alerts",
        "linkkeeper-digest", "linkkeeper-reminders",
        "linkkeeper-impact-scorer", "linkkeeper-report-generator",
    ]
    lambda_stats = {}
    for fn in functions:
        queries = [
            {"Id": "invocations", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Invocations", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Sum"}},
            {"Id": "errors", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Errors", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Sum"}},
            {"Id": "duration", "MetricStat": {"Metric": {"Namespace": "AWS/Lambda", "MetricName": "Duration", "Dimensions": [{"Name": "FunctionName", "Value": fn}]}, "Period": 86400, "Stat": "Average"}},
        ]
        try:
            resp = cw.get_metric_data(
                MetricDataQueries=queries,
                StartTime=start,
                EndTime=now,
            )
            results = {r["Id"]: r["Values"][0] if r["Values"] else 0 for r in resp["MetricDataResults"]}
            lambda_stats[fn] = {
                "invocations": int(results.get("invocations", 0)),
                "errors": int(results.get("errors", 0)),
                "avgDurationMs": round(results.get("duration", 0), 1),
            }
        except Exception:
            lambda_stats[fn] = {"invocations": 0, "errors": 0, "avgDurationMs": 0}

    try:
        table_desc = ddb.describe_table(TableName="linkkeeper")["Table"]
        ddb_stats = {
            "itemCount": table_desc.get("ItemCount", 0),
            "tableSizeBytes": table_desc.get("TableSizeBytes", 0),
            "provisionedRCU": table_desc.get("ProvisionedThroughput", {}).get("ReadCapacityUnits", 0),
            "provisionedWCU": table_desc.get("ProvisionedThroughput", {}).get("WriteCapacityUnits", 0),
        }
    except Exception:
        ddb_stats = {}

    try:
        ses = boto3.client("ses", region_name=REGION)
        ses_resp = ses.get_send_statistics()
        points = ses_resp.get("SendDataPoints", [])
        ses_stats = {
            "deliveryAttempts": sum(p.get("DeliveryAttempts", 0) for p in points),
            "bounces": sum(p.get("Bounces", 0) for p in points),
            "complaints": sum(p.get("Complaints", 0) for p in points),
            "rejects": sum(p.get("Rejects", 0) for p in points),
        }
    except Exception:
        ses_stats = {}

    return ok({
        "lambda": lambda_stats,
        "dynamodb": ddb_stats,
        "ses": ses_stats,
    })


# --- Actions ---

def trigger_crawl_all(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-crawler",
        InvocationType="Event",
        Payload=json.dumps({"tier": "daily"}),
    )
    return ok({"triggered": "crawl-all"})


def trigger_digest(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    client = boto3.client("lambda", region_name=REGION)
    client.invoke(
        FunctionName="linkkeeper-digest",
        InvocationType="Event",
        Payload="{}",
    )
    return ok({"triggered": "digest"})


# --- Site Config ---

CONFIG_PK = "CONFIG"
CONFIG_SK = "GLOBAL"

DEFAULT_CONFIG = {
    "maintenanceMode": False,
    "signupsEnabled": True,
    "crawlingEnabled": True,
    "alertsEnabled": True,
    "planLimits": {"free": 5, "starter": 50, "pro": 999999},
    "crawlSettings": {"dailyCrawlHourUtc": 4, "hourlyCrawlEnabled": True, "rateLimitDelayMs": 500},
    "emailTemplates": {
        "alertSubject": "LinkKeeper Alert: Link on {domain} is now {status}",
        "digestSubject": "LinkKeeper Weekly Digest — {dateRange}",
        "reminderSubject": "LinkKeeper: Follow up with {domain}",
    },
    "pricingDisplay": {
        "starter": {"name": "Starter", "price": 9, "features": ["50 links", "Daily crawls", "Pipeline tracker"]},
        "pro": {"name": "Pro", "price": 19, "features": ["Unlimited links", "Hourly crawls", "AI impact scoring", "Monthly reports"]},
    },
}


def get_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    table = _get_table()
    resp = table.get_item(Key={"pk": CONFIG_PK, "sk": CONFIG_SK})
    config = resp.get("Item")
    if not config:
        return ok(DEFAULT_CONFIG)
    config.pop("pk", None)
    config.pop("sk", None)
    return ok(config)


def update_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err
    body = _parse_body(event)
    table = _get_table()
    item = {"pk": CONFIG_PK, "sk": CONFIG_SK, **body}
    table.put_item(Item=item)
    return ok({"updated": True})


# --- Stripe Config ---

STRIPE_SECRET_NAME = "linkkeeper/stripe"


def _mask_secret(value: str) -> str:
    """Mask a secret value, showing first 4 and last 4 chars."""
    if not value or len(value) <= 8:
        return "****" if value else ""
    return value[:4] + "***" + value[-4:]


def get_stripe_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    # Price IDs from DynamoDB
    config = db_get_config("STRIPE") or {}
    starter_price_id = config.get("starterPriceId", "")
    pro_price_id = config.get("proPriceId", "")

    # Secrets from Secrets Manager (masked)
    publishable_key = ""
    secret_key = ""
    webhook_secret = ""
    has_publishable_key = False
    has_secret_key = False
    has_webhook_secret = False
    try:
        sm = boto3.client("secretsmanager", region_name=REGION)
        resp = sm.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        secrets = json.loads(resp["SecretString"])
        publishable_key = secrets.get("publishableKey", "")
        secret_key = secrets.get("secretKey", "")
        webhook_secret = secrets.get("webhookSecret", "")
        has_publishable_key = bool(publishable_key)
        has_secret_key = bool(secret_key)
        has_webhook_secret = bool(webhook_secret)
    except sm.exceptions.ResourceNotFoundException:
        pass
    except Exception:
        pass

    return ok({
        "starterPriceId": starter_price_id,
        "proPriceId": pro_price_id,
        "publishableKey": _mask_secret(publishable_key),
        "secretKey": _mask_secret(secret_key),
        "webhookSecret": _mask_secret(webhook_secret),
        "hasPublishableKey": has_publishable_key,
        "hasSecretKey": has_secret_key,
        "hasWebhookSecret": has_webhook_secret,
    })


def update_stripe_config(event: dict) -> dict:
    auth_err = _require_admin(event)
    if auth_err:
        return auth_err

    body = _parse_body(event)

    # Update price IDs in DynamoDB
    price_data = {}
    if "starterPriceId" in body:
        price_data["starterPriceId"] = body["starterPriceId"]
    if "proPriceId" in body:
        price_data["proPriceId"] = body["proPriceId"]
    if price_data:
        # Merge with existing config
        existing = db_get_config("STRIPE") or {}
        existing.update(price_data)
        db_put_config("STRIPE", existing)

    # Update secrets in Secrets Manager (skip masked values)
    publishable_key = body.get("publishableKey", "")
    secret_key = body.get("secretKey", "")
    webhook_secret = body.get("webhookSecret", "")
    update_secrets = False
    sm = boto3.client("secretsmanager", region_name=REGION)

    # Load current secrets
    current_secrets = {}
    try:
        resp = sm.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        current_secrets = json.loads(resp["SecretString"])
    except Exception:
        pass

    if publishable_key and not publishable_key.startswith("***"):
        current_secrets["publishableKey"] = publishable_key
        update_secrets = True
    if secret_key and not secret_key.startswith("***"):
        current_secrets["secretKey"] = secret_key
        update_secrets = True
    if webhook_secret and not webhook_secret.startswith("***"):
        current_secrets["webhookSecret"] = webhook_secret
        update_secrets = True

    if update_secrets:
        try:
            sm.put_secret_value(
                SecretId=STRIPE_SECRET_NAME,
                SecretString=json.dumps(current_secrets),
            )
        except sm.exceptions.ResourceNotFoundException:
            sm.create_secret(
                Name=STRIPE_SECRET_NAME,
                SecretString=json.dumps(current_secrets),
            )

    # Invalidate billing caches so new values take effect immediately
    billing.invalidate_caches()

    return ok({"updated": True})

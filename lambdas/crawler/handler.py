"""LinkKeeper Link Crawler — processes batches of links.

Triggered by EventBridge:
  - Daily at 11 PM ET for Free/Starter links
  - Hourly for Pro links
  - On-demand for single link crawl (Pro)
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
import requests
from boto3.dynamodb.conditions import Key
from bs4 import BeautifulSoup

TABLE_NAME = os.environ.get("TABLE_NAME", "linkkeeper")
ALERTS_FUNCTION = os.environ.get("ALERTS_FUNCTION", "linkkeeper-alerts")

USER_AGENT = (
    "Mozilla/5.0 (compatible; LinkKeeperBot/1.0; +https://linkkeeper.co/bot)"
)
REQUEST_TIMEOUT = 15
MAX_REDIRECTS = 3
SAME_DOMAIN_DELAY = 0.5  # 500ms

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
lambda_client = boto3.client("lambda")


def lambda_handler(event, context):
    """Crawl links and detect status changes."""
    # On-demand single link crawl
    if event.get("singleLink"):
        user_id = event["userId"]
        link_id = event["linkId"]
        link = _get_link(user_id, link_id)
        if link:
            _crawl_link(link)
        return {"processed": 1}

    # Scheduled crawl — determine which tier
    tier = event.get("tier", "daily")  # "daily" or "hourly"

    links = _get_links_for_tier(tier)
    processed = 0
    last_domain = None

    for link in links:
        domain = urlparse(link.get("pageUrl", "")).netloc
        if domain == last_domain:
            time.sleep(SAME_DOMAIN_DELAY)
        last_domain = domain

        _crawl_link(link)
        processed += 1

    # Trigger alert processing after crawl batch
    if processed > 0:
        lambda_client.invoke(
            FunctionName=ALERTS_FUNCTION,
            InvocationType="Event",
            Payload=json.dumps({"source": "crawler", "tier": tier}).encode(),
        )

    return {"processed": processed, "tier": tier}


def _get_links_for_tier(tier: str) -> list[dict]:
    """Get all links matching the crawl tier."""
    # Scan all links and filter by user plan
    users_cache = {}
    links = []

    params = {"FilterExpression": Key("sk").begins_with("LINK#")}
    while True:
        resp = table.scan(**params)
        for item in resp.get("Items", []):
            user_id = item.get("userId", "")
            if user_id not in users_cache:
                user_resp = table.get_item(
                    Key={"pk": f"USER#{user_id}", "sk": "PROFILE"}
                )
                users_cache[user_id] = user_resp.get("Item", {})
            user = users_cache[user_id]
            plan = user.get("plan", "free")

            if tier == "hourly" and plan == "pro":
                links.append(item)
            elif tier == "daily" and plan in ("free", "starter"):
                links.append(item)

        if "LastEvaluatedKey" not in resp:
            break
        params["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    return links


def _get_link(user_id: str, link_id: str) -> dict | None:
    resp = table.get_item(Key={"pk": f"USER#{user_id}", "sk": f"LINK#{link_id}"})
    return resp.get("Item")


def _crawl_link(link: dict):
    """Crawl a single link and update its status."""
    user_id = link["userId"]
    link_id = link["linkId"]
    page_url = link["pageUrl"]
    destination_url = link["destinationUrl"]
    anchor_text = link.get("anchorText", "")
    old_status = link.get("status", "PENDING")

    now = datetime.now(timezone.utc).isoformat()
    new_status = "ERROR"
    http_code = 0
    js_warning = False

    try:
        resp = requests.get(
            page_url,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
            stream=False,
        )
        http_code = resp.status_code

        # Check for domain redirect
        if resp.history:
            final_domain = urlparse(resp.url).netloc
            original_domain = urlparse(page_url).netloc
            if final_domain != original_domain:
                new_status = "REDIRECT"
                _update_link_status(
                    user_id, link_id, new_status, old_status, now, http_code, js_warning
                )
                return

        if 400 <= http_code < 500:
            new_status = "404"
        elif http_code >= 500:
            new_status = "ERROR"
        else:
            # Parse HTML and search for destination URL
            soup = BeautifulSoup(resp.text, "html.parser")

            # Detect JS-heavy pages
            scripts = soup.find_all("script")
            if len(scripts) > 15:
                js_warning = True

            found = _check_links(soup, destination_url, anchor_text)
            new_status = "LIVE" if found else "MISSING"

    except requests.exceptions.Timeout:
        new_status = "ERROR"
    except requests.exceptions.ConnectionError:
        new_status = "ERROR"
    except requests.exceptions.SSLError:
        new_status = "ERROR"
    except Exception:
        new_status = "ERROR"

    _update_link_status(
        user_id, link_id, new_status, old_status, now, http_code, js_warning
    )


def _normalize_url(url: str) -> str:
    """Normalize URL for comparison: strip trailing slash, www., http/https."""
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path.rstrip("/")
    return f"{host}{path}"


def _check_links(soup: BeautifulSoup, destination_url: str, anchor_text: str) -> bool:
    """Check if any <a href> matches the destination URL."""
    normalized_dest = _normalize_url(destination_url)

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        # Exact match
        if href.strip() == destination_url:
            return True
        # Normalized match
        if _normalize_url(href) == normalized_dest:
            return True

    # Secondary: anchor text search near external links
    if anchor_text:
        text_lower = anchor_text.lower()
        for a_tag in soup.find_all("a", href=True):
            tag_text = a_tag.get_text(strip=True).lower()
            if text_lower in tag_text:
                href = a_tag["href"]
                parsed = urlparse(href)
                if parsed.scheme in ("http", "https") and parsed.netloc:
                    return True

    return False


def _update_link_status(
    user_id: str,
    link_id: str,
    new_status: str,
    old_status: str,
    timestamp: str,
    http_code: int,
    js_warning: bool,
):
    """Update link status in DynamoDB, append to statusHistory."""
    history_entry = {
        "date": timestamp,
        "status": new_status,
        "httpCode": http_code,
    }

    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": f"LINK#{link_id}"},
        UpdateExpression=(
            "SET #status = :s, lastChecked = :lc, jsWarning = :jw, "
            "statusHistory = list_append(if_not_exists(statusHistory, :empty), :hist)"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":s": new_status,
            ":lc": timestamp,
            ":jw": js_warning,
            ":hist": [history_entry],
            ":empty": [],
        },
    )

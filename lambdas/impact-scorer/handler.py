"""YourApp Impact Scorer — Bedrock Haiku enrichment for Pro users.

Triggered asynchronously by the alerts Lambda when a LIVE -> MISSING
status change is detected for a Pro user. Uses Bedrock Claude Haiku
to assess link loss impact and sends an enriched alert email.
"""

from __future__ import annotations

import json
import os
from urllib.parse import urlparse

import boto3
import requests

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
SES_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL", "alerts@yourapp.com")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://yourapp.com")
OPEN_PAGERANK_API_KEY = os.environ.get("OPEN_PAGERANK_API_KEY", "")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
bedrock = boto3.client("bedrock-runtime")
ses = boto3.client("ses")


def lambda_handler(event, context):
    """Score link loss impact using Bedrock Claude Haiku."""
    user_id = event.get("userId", "")
    link_id = event.get("linkId", "")
    page_url = event.get("pageUrl", "")
    destination_url = event.get("destinationUrl", "")
    email = event.get("email", "")

    if not all([user_id, link_id, page_url, email]):
        return {"error": "Missing required fields"}

    # Get domain authority from Open PageRank
    domain = urlparse(page_url).netloc
    domain_authority = _get_domain_authority(domain)

    # Call Bedrock for impact assessment
    assessment = _assess_impact(page_url, destination_url, domain, domain_authority)

    # Send enriched email
    _send_impact_email(email, page_url, destination_url, domain, domain_authority, assessment)

    return {"scored": True, "linkId": link_id}


def _get_domain_authority(domain: str) -> dict:
    """Query Open PageRank API for domain authority data."""
    if not OPEN_PAGERANK_API_KEY:
        return {"rank": "unknown", "pageRank": "N/A"}

    try:
        resp = requests.get(
            "https://openpagerank.com/api/v1.0/getPageRank",
            params={"domains[]": domain},
            headers={"API-OPR": OPEN_PAGERANK_API_KEY},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("response", [])
            if results:
                entry = results[0]
                return {
                    "rank": entry.get("rank", "unknown"),
                    "pageRank": entry.get("page_rank_decimal", "N/A"),
                }
    except Exception:
        pass

    return {"rank": "unknown", "pageRank": "N/A"}


def _assess_impact(page_url: str, destination_url: str, domain: str, da: dict) -> str:
    """Use Bedrock Claude Haiku to generate impact assessment."""
    prompt = (
        f"A backlink was lost. Assess the SEO impact concisely (4-5 sentences max).\n\n"
        f"Linking page: {page_url}\n"
        f"Destination: {destination_url}\n"
        f"Linking domain: {domain}\n"
        f"Domain authority rank: {da.get('rank', 'unknown')}\n"
        f"PageRank: {da.get('pageRank', 'N/A')}\n\n"
        f"Cover: estimated impact severity (low/medium/high), "
        f"likely traffic impact, recovery recommendation, and suggested timeline."
    )

    try:
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )
        result = json.loads(response["body"].read())
        content = result.get("content", [])
        if content:
            return content[0].get("text", "Assessment unavailable.")
    except Exception:
        pass

    return "Impact assessment unavailable. Please review the link loss manually."


def _send_impact_email(
    email: str,
    page_url: str,
    destination_url: str,
    domain: str,
    da: dict,
    assessment: str,
):
    subject = f"YourApp Pro: Impact Assessment — Link lost on {domain}"
    body = (
        f"LINK LOSS IMPACT ASSESSMENT\n"
        f"{'=' * 40}\n\n"
        f"Page: {page_url}\n"
        f"Your URL: {destination_url}\n"
        f"Domain: {domain}\n"
        f"Domain Authority Rank: {da.get('rank', 'unknown')}\n"
        f"PageRank: {da.get('pageRank', 'N/A')}\n\n"
        f"AI ASSESSMENT:\n"
        f"{assessment}\n\n"
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

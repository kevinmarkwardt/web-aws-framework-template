"""
daily-job — Example EventBridge-scheduled Lambda.

This is a template. Replace this handler with your business logic.

Demonstrates:
  - Reading all items from DynamoDB
  - Optional Bedrock (Claude) AI call
  - Optional SES email summary

EventBridge triggers this daily at 8 AM UTC via the CDK schedule in
lib/yourapp-stack.ts. Adjust the cron expression there to change frequency.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["TABLE_NAME"]
FROM_EMAIL = os.environ["FROM_EMAIL"]
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-5-haiku-20241022-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb")
ses = boto3.client("ses")
bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)


def handler(event, context):
    """
    Main entry point — called by EventBridge on schedule.

    Replace this function with your application's scheduled job logic.
    """
    table = dynamodb.Table(TABLE_NAME)

    # ----------------------------------------------------------------
    # Step 1: Query DynamoDB for items to process
    # ----------------------------------------------------------------
    # Prefer Query over Scan in production — add a GSI if you need
    # to filter by status or other attributes.
    response = table.scan(
        FilterExpression=Key("sk").begins_with("ITEM#")
    )
    items = response.get("Items", [])
    print(f"[daily-job] Found {len(items)} items to process")

    # ----------------------------------------------------------------
    # Step 2: Process each item (replace with your logic)
    # ----------------------------------------------------------------
    results = []
    for item in items:
        item_id = item.get("itemId")
        # TODO: Add your business logic here.
        # Examples:
        #   - Check an external API for status changes
        #   - Update DynamoDB with new status
        #   - Send per-item alerts
        results.append({"itemId": item_id, "processed": True})

    # ----------------------------------------------------------------
    # Step 3: Optional — call Bedrock (Claude) for AI analysis
    # ----------------------------------------------------------------
    # Uncomment to enable:
    #
    # ai_response = bedrock.invoke_model(
    #     modelId=BEDROCK_MODEL_ID,
    #     body=json.dumps({
    #         "anthropic_version": "bedrock-2023-05-31",
    #         "max_tokens": 512,
    #         "messages": [{
    #             "role": "user",
    #             "content": f"Summarize these results: {json.dumps(results[:20])}"
    #         }]
    #     }),
    #     contentType="application/json",
    # )
    # summary = json.loads(ai_response["body"].read())["content"][0]["text"]
    # print(f"[daily-job] AI summary: {summary}")

    # ----------------------------------------------------------------
    # Step 4: Optional — send summary email via SES
    # ----------------------------------------------------------------
    # Uncomment to enable:
    #
    # ses.send_email(
    #     Source=FROM_EMAIL,
    #     Destination={"ToAddresses": ["admin@yourapp.com"]},
    #     Message={
    #         "Subject": {
    #             "Data": f"Daily Job — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    #         },
    #         "Body": {
    #             "Text": {
    #                 "Data": f"Processed {len(results)} items.\n\n{json.dumps(results, indent=2)}"
    #             }
    #         },
    #     }
    # )

    print(f"[daily-job] Done. Processed {len(results)} items.")
    return {
        "statusCode": 200,
        "body": json.dumps({
            "processed": len(results),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }),
    }

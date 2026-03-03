"""YourApp Stripe Webhook — payment event processing.

Handles Stripe webhook events for subscription lifecycle management.
Verifies webhook signature and updates user plan in DynamoDB.
"""

from __future__ import annotations

import json
import os

import boto3
import stripe
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ.get("TABLE_NAME", "yourapp")
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

stripe.api_key = STRIPE_SECRET_KEY

STARTER_PRICE_ID = os.environ.get("STRIPE_STARTER_PRICE_ID", "")
PRO_PRICE_ID = os.environ.get("STRIPE_PRO_PRICE_ID", "")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event, context):
    """Handle Stripe webhook events (subscription created/updated/canceled)."""
    body = event.get("body", "")
    headers = event.get("headers", {})
    sig = headers.get("stripe-signature", headers.get("Stripe-Signature", ""))

    try:
        evt = stripe.Webhook.construct_event(body, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": str(e)}),
        }

    event_type = evt["type"]
    data = evt["data"]["object"]

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data)
    elif event_type == "invoice.payment_failed":
        _handle_payment_failed(data)

    return {
        "statusCode": 200,
        "body": json.dumps({"received": True}),
    }


def _handle_checkout_completed(session: dict):
    """New subscription created via Checkout."""
    user_id = session.get("client_reference_id") or session.get("metadata", {}).get("userId")
    if not user_id:
        return

    plan = session.get("metadata", {}).get("plan", "starter")
    customer_id = session.get("customer", "")
    subscription_id = session.get("subscription", "")

    _update_user_plan(user_id, plan, customer_id, subscription_id)


def _handle_subscription_updated(subscription: dict):
    """Subscription plan changed or renewed."""
    customer_id = subscription.get("customer", "")
    status = subscription.get("status", "")
    user = _find_user_by_customer(customer_id)
    if not user:
        return

    user_id = user["userId"]

    if status == "active":
        plan = _plan_from_subscription(subscription)
        _update_user_plan(user_id, plan, stripe_subscription_id=subscription.get("id"))
    elif status in ("canceled", "unpaid", "past_due"):
        _update_user_plan(user_id, "free")


def _handle_subscription_deleted(subscription: dict):
    """Subscription canceled."""
    customer_id = subscription.get("customer", "")
    user = _find_user_by_customer(customer_id)
    if not user:
        return
    _update_user_plan(user["userId"], "free")


def _handle_payment_failed(invoice: dict):
    """Payment failed — could downgrade or send warning."""
    # For v1, just log it. The subscription.updated event with status
    # "past_due" will handle downgrading if Stripe retries fail.
    pass


def _plan_from_subscription(subscription: dict) -> str:
    """Determine plan name from Stripe subscription price ID."""
    items = subscription.get("items", {}).get("data", [])
    if items:
        price_id = items[0].get("price", {}).get("id", "")
        if price_id == PRO_PRICE_ID:
            return "pro"
        if price_id == STARTER_PRICE_ID:
            return "starter"
    return "starter"


def _find_user_by_customer(customer_id: str) -> dict | None:
    """Find user by Stripe customer ID using GSI."""
    if not customer_id:
        return None
    resp = table.query(
        IndexName="stripe-customer-index",
        KeyConditionExpression=Key("stripeCustomerId").eq(customer_id),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def _update_user_plan(
    user_id: str,
    plan: str,
    stripe_customer_id: str = None,
    stripe_subscription_id: str = None,
):
    """Update user plan and Stripe IDs in DynamoDB."""
    expr_parts = ["#plan = :plan"]
    names = {"#plan": "plan"}
    values = {":plan": plan}

    if stripe_customer_id is not None:
        expr_parts.append("stripeCustomerId = :sci")
        values[":sci"] = stripe_customer_id
    if stripe_subscription_id is not None:
        expr_parts.append("stripeSubscriptionId = :ssi")
        values[":ssi"] = stripe_subscription_id

    table.update_item(
        Key={"pk": f"USER#{user_id}", "sk": "PROFILE"},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )

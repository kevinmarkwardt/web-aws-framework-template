"""The Stripe call log keeps ids, amounts and states for 18 months, never the customer's personal details (A14)."""

import json

from boto3.dynamodb.conditions import Key

from api.lib import logs


class _Answer(dict):
    def to_dict(self):
        return dict(self)


PERSONAL = ("jo@example.com", "Jo Buyer", "1 Main St", "+15550100", "4242", "203.0.113.7")


def _rows(t):
    return [r for day in {i["pk"] for i in t.scan()["Items"] if i["pk"].startswith("STRIPELOG#")}
            for r in t.query(KeyConditionExpression=Key("pk").eq(day))["Items"]]


def test_a_retrieved_payment_logs_only_ids_amounts_and_state(dynamodb_table):
    pi = _Answer({
        "id": "pi_1", "object": "payment_intent", "status": "succeeded", "amount": 2000, "currency": "usd",
        "receipt_email": "jo@example.com", "customer": {"id": "cus_1", "email": "jo@example.com", "name": "Jo Buyer",
                                                        "phone": "+15550100", "address": {"line1": "1 Main St"}},
        "shipping": {"name": "Jo Buyer", "address": {"line1": "1 Main St"}},
        "latest_charge": {"id": "ch_1", "billing_details": {"email": "jo@example.com", "name": "Jo Buyer"},
                          "payment_method_details": {"card": {"last4": "4242", "fingerprint": "fp"}}},
        "last_payment_error": {"code": "card_declined", "message": "Your card was declined.",
                               "payment_method": {"billing_details": {"name": "Jo Buyer"}}},
        "metadata": {"ip": "203.0.113.7"},
    })
    logs.stripe_call("payment_intents.retrieve", lambda: pi,
                     {"id": "pi_1", "receipt_email": "jo@example.com", "billing_details": {"name": "Jo Buyer"}}, user_id="u1")
    [row] = _rows(dynamodb_table)
    stored = json.dumps(row, default=str)
    for value in PERSONAL:
        assert value not in stored, value
    resp = json.loads(row["response"])
    assert resp["id"] == "pi_1" and resp["status"] == "succeeded" and resp["amount"] == 2000 and resp["currency"] == "usd"
    assert resp["customer"] == "cus_1" and resp["latest_charge"] == "ch_1"
    assert resp["last_payment_error"] == {"code": "card_declined", "message": "Your card was declined."}
    assert json.loads(row["request"])["receipt_email"] == "[redacted]" and row["objectId"] == "pi_1"


def test_a_list_answer_keeps_only_its_ids(dynamodb_table):
    refunds = _Answer({"object": "list", "has_more": False,
                       "data": [{"id": "re_1", "object": "refund", "metadata": {"reason": "x"}, "receipt_email": "jo@example.com"}]})
    logs.stripe_call("refunds.list", lambda: refunds, {"payment_intent": "pi_1"})
    [row] = _rows(dynamodb_table)
    assert json.loads(row["response"]) == {"object": "list", "count": 1, "has_more": False, "ids": ["re_1"]}


def test_audit_rows_drop_personal_fields_too(dynamodb_table):
    logs.audit("admin:a", "test.action", "user:u1", "why", before={"email": "jo@example.com", "status": "active"})
    row = next(i for i in dynamodb_table.scan()["Items"] if i["pk"].startswith("AUDIT#"))
    assert "jo@example.com" not in row["before"] and json.loads(row["before"])["status"] == "active"

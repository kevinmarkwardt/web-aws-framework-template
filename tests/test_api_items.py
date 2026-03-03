"""Tests for Items CRUD API routes."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch

from tests.conftest import make_api_event
from api.routes import items
from api.lib import db


@mock_aws
class TestListItems:
    def test_list_empty(self, dynamodb_table, create_test_user):
        create_test_user()
        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body == []

    def test_list_with_items(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001")
        create_test_item(item_id="item-002", name="Second item")

        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert len(body) == 2


@mock_aws
class TestCreateItem:
    def test_create_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/items", body={
            "name": "My first item",
            "status": "ACTIVE",
        })

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert body["name"] == "My first item"
        assert body["status"] == "ACTIVE"
        assert "itemId" in body

    def test_create_item_missing_name(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/items", body={"status": "ACTIVE"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 400

    def test_free_plan_limit(self, dynamodb_table, create_test_user):
        create_test_user(item_count=10)  # free plan limit is 10
        event = make_api_event("POST", "/api/items", body={"name": "overflow item"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 403
        body = json.loads(result["body"])
        assert "limit" in body["error"].lower()

    def test_starter_plan_higher_limit(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter", item_count=10)
        event = make_api_event("POST", "/api/items", body={"name": "ok item"})

        result = items.create_item("user-123", event)
        assert result["statusCode"] == 201


@mock_aws
class TestUpdateItem:
    def test_update_item(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001", name="Old name")

        event = make_api_event("PUT", "/api/items/item-001", body={"name": "New name"})
        result = items.update_item("user-123", "item-001", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["name"] == "New name"

    def test_update_missing_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("PUT", "/api/items/missing-id", body={"name": "x"})
        result = items.update_item("user-123", "missing-id", event)
        assert result["statusCode"] == 404


@mock_aws
class TestDeleteItem:
    def test_delete_item(self, dynamodb_table, create_test_user, create_test_item):
        create_test_user()
        create_test_item(item_id="item-001")

        event = make_api_event("DELETE", "/api/items/item-001")
        result = items.delete_item("user-123", "item-001", event)
        assert result["statusCode"] == 200

        # Verify deleted
        result = items.list_items("user-123", make_api_event("GET", "/api/items"))
        body = json.loads(result["body"])
        assert len(body) == 0

    def test_delete_missing_item(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("DELETE", "/api/items/missing-id")
        result = items.delete_item("user-123", "missing-id", event)
        assert result["statusCode"] == 404

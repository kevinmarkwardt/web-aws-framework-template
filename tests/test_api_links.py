"""Tests for Links CRUD API routes."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch

from tests.conftest import make_api_event
from api.routes import links
from api.lib import db


@mock_aws
class TestListLinks:
    def test_list_empty(self, dynamodb_table, create_test_user):
        create_test_user()
        result = links.list_links("user-123", make_api_event("GET", "/api/links"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body == []

    def test_list_with_links(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user()
        create_test_link(link_id="link-001")
        create_test_link(link_id="link-002", page_url="https://other.com/page")

        result = links.list_links("user-123", make_api_event("GET", "/api/links"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert len(body) == 2


@mock_aws
class TestCreateLink:
    def test_create_single_link(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/links", body={
            "pageUrl": "https://blog.example.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "my product",
        })

        result = links.create_link("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert isinstance(body, dict)
        assert body["pageUrl"] == "https://blog.example.com/post"
        assert body["status"] == "PENDING"

    def test_create_bulk_links(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/links", body=[
            {"pageUrl": "https://blog1.com/post", "destinationUrl": "https://mysite.com/a"},
            {"pageUrl": "https://blog2.com/post", "destinationUrl": "https://mysite.com/b"},
        ])

        result = links.create_link("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert len(body) == 2

    def test_create_skips_invalid_entries(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("POST", "/api/links", body=[
            {"pageUrl": "https://blog.com/post", "destinationUrl": "https://mysite.com"},
            {"pageUrl": "", "destinationUrl": ""},  # invalid
        ])

        result = links.create_link("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert len(body) == 1

    def test_free_plan_limit_5(self, dynamodb_table, create_test_user):
        create_test_user(link_count=4)
        event = make_api_event("POST", "/api/links", body=[
            {"pageUrl": "https://a.com/1", "destinationUrl": "https://mysite.com/1"},
            {"pageUrl": "https://b.com/2", "destinationUrl": "https://mysite.com/2"},
        ])

        result = links.create_link("user-123", event)
        assert result["statusCode"] == 403
        body = json.loads(result["body"])
        assert "Plan limit" in body["error"]

    def test_free_plan_at_limit(self, dynamodb_table, create_test_user):
        create_test_user(link_count=5)
        event = make_api_event("POST", "/api/links", body={
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com",
        })

        result = links.create_link("user-123", event)
        assert result["statusCode"] == 403

    def test_starter_plan_limit_50(self, dynamodb_table, create_test_user):
        create_test_user(user_id="user-s", plan="starter", link_count=50)
        event = make_api_event("POST", "/api/links", body={
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com",
        })

        result = links.create_link("user-s", event)
        assert result["statusCode"] == 403

    def test_pro_plan_unlimited(self, dynamodb_table, create_test_user):
        create_test_user(user_id="user-p", plan="pro", link_count=500)
        event = make_api_event("POST", "/api/links", body={
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com",
        })

        result = links.create_link("user-p", event)
        assert result["statusCode"] == 201

    def test_user_not_found(self, dynamodb_table):
        event = make_api_event("POST", "/api/links", body={
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com",
        })

        result = links.create_link("nonexistent", event)
        assert result["statusCode"] == 404


@mock_aws
class TestCreateLinksCSV:
    def test_csv_upload(self, dynamodb_table, create_test_user):
        create_test_user()
        csv_body = "page_url,destination_url,anchor_text\nhttps://blog.com/post,https://mysite.com,my product\nhttps://blog2.com/post,https://mysite.com/other,other link"
        event = make_api_event("POST", "/api/links/csv")
        event["body"] = csv_body

        result = links.create_links_csv("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert len(body) == 2
        assert body[0]["pageUrl"] == "https://blog.com/post"

    def test_csv_plan_limit(self, dynamodb_table, create_test_user):
        create_test_user(link_count=4)
        csv_body = "page_url,destination_url,anchor_text\nhttps://a.com/1,https://mysite.com/1,a\nhttps://b.com/2,https://mysite.com/2,b"
        event = make_api_event("POST", "/api/links/csv")
        event["body"] = csv_body

        result = links.create_links_csv("user-123", event)
        assert result["statusCode"] == 403


@mock_aws
class TestUpdateLink:
    def test_update_link(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user()
        create_test_link()
        event = make_api_event("PUT", "/api/links/link-001", body={
            "pageUrl": "https://updated-blog.com/post",
        })

        result = links.update_link("user-123", "link-001", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["pageUrl"] == "https://updated-blog.com/post"

    def test_update_nonexistent_link(self, dynamodb_table, create_test_user):
        create_test_user()
        event = make_api_event("PUT", "/api/links/nonexistent", body={
            "pageUrl": "https://updated.com",
        })

        result = links.update_link("user-123", "nonexistent", event)
        assert result["statusCode"] == 404

    def test_update_no_valid_fields(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user()
        create_test_link()
        event = make_api_event("PUT", "/api/links/link-001", body={
            "invalidField": "value",
        })

        result = links.update_link("user-123", "link-001", event)
        assert result["statusCode"] == 400


@mock_aws
class TestDeleteLink:
    def test_delete_link(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user(link_count=1)
        create_test_link()

        result = links.delete_link("user-123", "link-001", make_api_event("DELETE", "/api/links/link-001"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["deleted"] == "link-001"

        # Verify link is gone
        assert db.get_link("user-123", "link-001") is None

    def test_delete_nonexistent_link(self, dynamodb_table, create_test_user):
        create_test_user()
        result = links.delete_link("user-123", "nonexistent", make_api_event("DELETE", "/api/links/nonexistent"))
        assert result["statusCode"] == 404


@mock_aws
class TestCrawlLink:
    def test_crawl_pro_only(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user(plan="free")
        create_test_link()

        result = links.crawl_link("user-123", "link-001", make_api_event("POST", "/api/links/link-001/crawl"))
        assert result["statusCode"] == 403
        assert "Pro feature" in json.loads(result["body"])["error"]

    def test_crawl_starter_denied(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-s", plan="starter")
        create_test_link(user_id="user-s")

        result = links.crawl_link("user-s", "link-001", make_api_event("POST", "/api/links/link-001/crawl"))
        assert result["statusCode"] == 403

    @patch("boto3.client")
    def test_crawl_pro_allowed(self, mock_client, dynamodb_table, create_test_user, create_test_link):
        create_test_user(user_id="user-pro", plan="pro")
        create_test_link(user_id="user-pro")

        mock_lambda = mock_client.return_value
        result = links.crawl_link("user-pro", "link-001", make_api_event("POST", "/api/links/link-001/crawl"))
        assert result["statusCode"] == 200
        assert json.loads(result["body"])["message"] == "Crawl triggered"
        mock_lambda.invoke.assert_called_once()

    def test_crawl_nonexistent_link(self, dynamodb_table, create_test_user):
        create_test_user(user_id="user-pro", plan="pro")

        result = links.crawl_link("user-pro", "nonexistent", make_api_event("POST", "/api/links/nonexistent/crawl"))
        assert result["statusCode"] == 404


@mock_aws
class TestGetLinkHistory:
    def test_get_history(self, dynamodb_table, create_test_user, create_test_link):
        create_test_user()
        history = [
            {"date": "2026-01-01T00:00:00+00:00", "status": "LIVE", "httpCode": 200},
            {"date": "2026-01-02T00:00:00+00:00", "status": "MISSING", "httpCode": 200},
        ]
        create_test_link(status_history=history)

        result = links.get_link_history("user-123", "link-001", make_api_event("GET", "/api/links/link-001/history"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["linkId"] == "link-001"
        assert len(body["statusHistory"]) == 2

    def test_history_nonexistent_link(self, dynamodb_table, create_test_user):
        create_test_user()
        result = links.get_link_history("user-123", "nonexistent", make_api_event("GET", "/api/links/nonexistent/history"))
        assert result["statusCode"] == 404

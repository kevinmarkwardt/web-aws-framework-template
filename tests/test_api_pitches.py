"""Tests for Pitches CRUD API routes."""

import json

import pytest
from moto import mock_aws
from unittest.mock import patch

from tests.conftest import make_api_event
from api.routes import pitches
from api.lib import db


@mock_aws
class TestListPitches:
    def test_free_user_denied(self, dynamodb_table, create_test_user):
        create_test_user(plan="free")
        result = pitches.list_pitches("user-123", make_api_event("GET", "/api/pitches"))
        assert result["statusCode"] == 403
        assert "Starter or Pro" in json.loads(result["body"])["error"]

    def test_starter_user_allowed(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter")
        result = pitches.list_pitches("user-123", make_api_event("GET", "/api/pitches"))
        assert result["statusCode"] == 200
        assert json.loads(result["body"]) == []

    def test_pro_user_allowed(self, dynamodb_table, create_test_user):
        create_test_user(plan="pro")
        result = pitches.list_pitches("user-123", make_api_event("GET", "/api/pitches"))
        assert result["statusCode"] == 200

    def test_list_with_pitches(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="starter")
        create_test_pitch(pitch_id="pitch-001")
        create_test_pitch(pitch_id="pitch-002", domain="other.com")

        result = pitches.list_pitches("user-123", make_api_event("GET", "/api/pitches"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert len(body) == 2


@mock_aws
class TestCreatePitch:
    def test_free_user_denied(self, dynamodb_table, create_test_user):
        create_test_user(plan="free")
        event = make_api_event("POST", "/api/pitches", body={"domain": "blog.com"})
        result = pitches.create_pitch("user-123", event)
        assert result["statusCode"] == 403

    def test_create_pitch(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter")
        event = make_api_event("POST", "/api/pitches", body={
            "domain": "blogsite.com",
            "contactName": "Editor",
            "contactEmail": "editor@blogsite.com",
            "notes": "Great blog about SEO",
        })

        result = pitches.create_pitch("user-123", event)
        assert result["statusCode"] == 201
        body = json.loads(result["body"])
        assert body["domain"] == "blogsite.com"
        assert body["status"] == "PITCHED"
        assert body["pitchId"]  # ULID generated

    def test_create_pitch_missing_domain(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter")
        event = make_api_event("POST", "/api/pitches", body={
            "contactName": "Editor",
        })

        result = pitches.create_pitch("user-123", event)
        assert result["statusCode"] == 400
        assert "domain is required" in json.loads(result["body"])["error"]


@mock_aws
class TestUpdatePitch:
    def test_update_status(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="starter")
        create_test_pitch()

        event = make_api_event("PUT", "/api/pitches/pitch-001", body={
            "status": "ACCEPTED",
        })
        result = pitches.update_pitch("user-123", "pitch-001", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["status"] == "ACCEPTED"

    def test_update_invalid_status(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="starter")
        create_test_pitch()

        event = make_api_event("PUT", "/api/pitches/pitch-001", body={
            "status": "INVALID_STATUS",
        })
        result = pitches.update_pitch("user-123", "pitch-001", event)
        assert result["statusCode"] == 400
        assert "Invalid status" in json.loads(result["body"])["error"]

    def test_update_nonexistent_pitch(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter")

        event = make_api_event("PUT", "/api/pitches/nonexistent", body={
            "status": "ACCEPTED",
        })
        result = pitches.update_pitch("user-123", "nonexistent", event)
        assert result["statusCode"] == 404

    def test_auto_create_link_on_published(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="starter", link_count=0)
        create_test_pitch()

        event = make_api_event("PUT", "/api/pitches/pitch-001", body={
            "status": "PUBLISHED",
            "publishedUrl": "https://blogsite.com/my-guest-post",
        })
        result = pitches.update_pitch("user-123", "pitch-001", event)
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body.get("linkedLinkId")  # Should have created a link

        # Verify the link was created in DynamoDB
        user_links = db.get_links("user-123")
        assert len(user_links) == 1
        assert user_links[0]["pageUrl"] == "https://blogsite.com/my-guest-post"

    def test_free_user_denied(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="free")
        create_test_pitch()

        event = make_api_event("PUT", "/api/pitches/pitch-001", body={
            "status": "ACCEPTED",
        })
        result = pitches.update_pitch("user-123", "pitch-001", event)
        assert result["statusCode"] == 403


@mock_aws
class TestDeletePitch:
    def test_delete_pitch(self, dynamodb_table, create_test_user, create_test_pitch):
        create_test_user(plan="starter")
        create_test_pitch()

        result = pitches.delete_pitch("user-123", "pitch-001", make_api_event("DELETE", "/api/pitches/pitch-001"))
        assert result["statusCode"] == 200
        body = json.loads(result["body"])
        assert body["deleted"] == "pitch-001"

        # Verify deleted
        assert db.get_pitch("user-123", "pitch-001") is None

    def test_delete_nonexistent_pitch(self, dynamodb_table, create_test_user):
        create_test_user(plan="starter")
        result = pitches.delete_pitch("user-123", "nonexistent", make_api_event("DELETE", "/api/pitches/nonexistent"))
        assert result["statusCode"] == 404

    def test_free_user_denied(self, dynamodb_table, create_test_user):
        create_test_user(plan="free")
        result = pitches.delete_pitch("user-123", "pitch-001", make_api_event("DELETE", "/api/pitches/pitch-001"))
        assert result["statusCode"] == 403

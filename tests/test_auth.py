"""Tests for JWT authentication."""

import time
from unittest.mock import patch, MagicMock

import pytest

from api.lib.auth import get_user_id, verify_token


class TestGetUserId:
    def test_missing_authorization_header(self):
        event = {"headers": {}}
        assert get_user_id(event) is None

    def test_empty_authorization_header(self):
        event = {"headers": {"authorization": ""}}
        assert get_user_id(event) is None

    def test_non_bearer_token(self):
        event = {"headers": {"authorization": "Basic abc123"}}
        assert get_user_id(event) is None

    def test_bearer_without_space(self):
        event = {"headers": {"authorization": "Bearertoken"}}
        assert get_user_id(event) is None

    def test_invalid_token_returns_none(self):
        event = {"headers": {"authorization": "Bearer invalid.token.here"}}
        with patch("api.lib.auth.verify_token", side_effect=ValueError("bad")):
            assert get_user_id(event) is None

    def test_valid_token_returns_sub(self):
        event = {"headers": {"authorization": "Bearer valid.jwt.token"}}
        mock_claims = {"sub": "user-abc-123", "token_use": "access"}
        with patch("api.lib.auth.verify_token", return_value=mock_claims):
            assert get_user_id(event) == "user-abc-123"

    def test_capital_authorization_header(self):
        event = {"headers": {"Authorization": "Bearer valid.jwt.token"}}
        mock_claims = {"sub": "user-456", "token_use": "access"}
        with patch("api.lib.auth.verify_token", return_value=mock_claims):
            assert get_user_id(event) == "user-456"


class TestVerifyToken:
    def test_expired_token_raises(self):
        mock_jwks = {
            "keys": [{"kid": "test-kid", "kty": "RSA", "n": "abc", "e": "AQAB"}]
        }
        expired_claims = {
            "sub": "user-123",
            "exp": int(time.time()) - 3600,
            "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool",
            "token_use": "access",
        }

        with patch("api.lib.auth._get_jwks", return_value=mock_jwks), \
             patch("api.lib.auth.jwt.get_unverified_headers", return_value={"kid": "test-kid"}), \
             patch("api.lib.auth.jwk.construct") as mock_construct, \
             patch("api.lib.auth.base64url_decode", return_value=b"sig"), \
             patch("api.lib.auth.jwt.get_unverified_claims", return_value=expired_claims):
            mock_key = MagicMock()
            mock_key.verify.return_value = True
            mock_construct.return_value = mock_key

            with pytest.raises(ValueError, match="Token expired"):
                verify_token("header.payload.signature")

    def test_wrong_issuer_raises(self):
        mock_jwks = {
            "keys": [{"kid": "test-kid", "kty": "RSA", "n": "abc", "e": "AQAB"}]
        }
        bad_claims = {
            "sub": "user-123",
            "exp": int(time.time()) + 3600,
            "iss": "https://wrong-issuer.example.com",
            "token_use": "access",
        }

        with patch("api.lib.auth._get_jwks", return_value=mock_jwks), \
             patch("api.lib.auth.jwt.get_unverified_headers", return_value={"kid": "test-kid"}), \
             patch("api.lib.auth.jwk.construct") as mock_construct, \
             patch("api.lib.auth.base64url_decode", return_value=b"sig"), \
             patch("api.lib.auth.jwt.get_unverified_claims", return_value=bad_claims):
            mock_key = MagicMock()
            mock_key.verify.return_value = True
            mock_construct.return_value = mock_key

            with pytest.raises(ValueError, match="Token issuer mismatch"):
                verify_token("header.payload.signature")

    def test_key_not_found_raises(self):
        mock_jwks = {"keys": [{"kid": "other-kid"}]}

        with patch("api.lib.auth._get_jwks", return_value=mock_jwks), \
             patch("api.lib.auth.jwt.get_unverified_headers", return_value={"kid": "missing-kid"}):
            with pytest.raises(ValueError, match="Token key ID not found"):
                verify_token("header.payload.signature")

    def test_signature_verification_failure(self):
        mock_jwks = {
            "keys": [{"kid": "test-kid", "kty": "RSA", "n": "abc", "e": "AQAB"}]
        }

        with patch("api.lib.auth._get_jwks", return_value=mock_jwks), \
             patch("api.lib.auth.jwt.get_unverified_headers", return_value={"kid": "test-kid"}), \
             patch("api.lib.auth.jwk.construct") as mock_construct, \
             patch("api.lib.auth.base64url_decode", return_value=b"sig"):
            mock_key = MagicMock()
            mock_key.verify.return_value = False
            mock_construct.return_value = mock_key

            with pytest.raises(ValueError, match="Token signature verification failed"):
                verify_token("header.payload.signature")

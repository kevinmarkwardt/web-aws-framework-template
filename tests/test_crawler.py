"""Tests for the link crawler Lambda."""

import json

import pytest
from bs4 import BeautifulSoup
from moto import mock_aws
from unittest.mock import patch, MagicMock

# Import crawler internals for unit testing
from lambdas.crawler.handler import (
    _normalize_url,
    _check_links,
    _crawl_link,
    _update_link_status,
    lambda_handler,
)


class TestNormalizeUrl:
    def test_basic_url(self):
        assert _normalize_url("https://example.com/path") == "example.com/path"

    def test_trailing_slash(self):
        assert _normalize_url("https://example.com/path/") == "example.com/path"

    def test_www_prefix(self):
        assert _normalize_url("https://www.example.com/path") == "example.com/path"

    def test_http_vs_https(self):
        url_http = _normalize_url("http://example.com/path")
        url_https = _normalize_url("https://example.com/path")
        assert url_http == url_https

    def test_www_and_trailing_slash(self):
        assert _normalize_url("http://www.example.com/path/") == "example.com/path"

    def test_uppercase_domain(self):
        assert _normalize_url("https://EXAMPLE.COM/path") == "example.com/path"

    def test_root_path(self):
        assert _normalize_url("https://example.com/") == "example.com"

    def test_no_path(self):
        assert _normalize_url("https://example.com") == "example.com"

    def test_whitespace_stripping(self):
        assert _normalize_url("  https://example.com/path  ") == "example.com/path"


class TestCheckLinks:
    def _make_soup(self, html):
        return BeautifulSoup(html, "html.parser")

    def test_exact_match(self):
        html = '<html><body><a href="https://mysite.com/product">My Product</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is True

    def test_normalized_match_trailing_slash(self):
        html = '<html><body><a href="https://mysite.com/product/">My Product</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is True

    def test_normalized_match_www(self):
        html = '<html><body><a href="https://www.mysite.com/product">My Product</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is True

    def test_normalized_match_http_https(self):
        html = '<html><body><a href="http://mysite.com/product">My Product</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is True

    def test_missing_link(self):
        html = '<html><body><a href="https://other.com/page">Other</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is False

    def test_no_links(self):
        html = '<html><body><p>No links here</p></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is False

    def test_anchor_text_match(self):
        html = '<html><body><a href="https://some-redirect.com/go">My Product Link</a></body></html>'
        soup = self._make_soup(html)
        # No exact URL match but anchor text "my product" matches
        assert _check_links(soup, "https://mysite.com/product", "My Product") is True

    def test_anchor_text_no_match(self):
        html = '<html><body><a href="https://some-redirect.com/go">Other Text</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "My Product") is False

    def test_anchor_text_requires_external_link(self):
        # Anchor text match only works for absolute external links
        html = '<html><body><a href="/internal/path">My Product</a></body></html>'
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "My Product") is False

    def test_multiple_links_one_matches(self):
        html = """
        <html><body>
            <a href="https://other1.com">Link 1</a>
            <a href="https://mysite.com/product">Target</a>
            <a href="https://other2.com">Link 3</a>
        </body></html>
        """
        soup = self._make_soup(html)
        assert _check_links(soup, "https://mysite.com/product", "") is True


class TestJSHeavyDetection:
    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_js_heavy_page_flagged(self, mock_table, mock_requests):
        """Page with >15 script tags should set jsWarning=True."""
        scripts = "<script>var x=1;</script>" * 20
        html = f"<html><body>{scripts}<a href='https://mysite.com/product'>link</a></body></html>"

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = html
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "user-1",
            "linkId": "link-1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "",
            "status": "PENDING",
        }
        _crawl_link(link)

        # Verify the update call included jsWarning=True
        call_args = mock_table.update_item.call_args
        expr_values = call_args[1]["ExpressionAttributeValues"]
        assert expr_values[":jw"] is True

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_normal_page_no_js_warning(self, mock_table, mock_requests):
        """Page with few script tags should set jsWarning=False."""
        html = "<html><body><script>var x=1;</script><a href='https://mysite.com/product'>link</a></body></html>"

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = html
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "user-1",
            "linkId": "link-1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "",
            "status": "PENDING",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        expr_values = call_args[1]["ExpressionAttributeValues"]
        assert expr_values[":jw"] is False


class TestCrawlLinkStatus:
    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_live_status(self, mock_table, mock_requests):
        html = '<html><body><a href="https://mysite.com/product">link</a></body></html>'
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = html
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "PENDING",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "LIVE"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_missing_status(self, mock_table, mock_requests):
        html = '<html><body><a href="https://other.com/page">other</a></body></html>'
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = html
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "MISSING"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_404_status(self, mock_table, mock_requests):
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "404"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_redirect_status(self, mock_table, mock_requests):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.url = "https://different-domain.com/page"
        # Simulate a redirect via history
        mock_redirect = MagicMock()
        mock_redirect.status_code = 301
        mock_resp.history = [mock_redirect]
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "REDIRECT"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_timeout_error(self, mock_table, mock_requests):
        import requests as real_requests
        mock_requests.get.side_effect = real_requests.exceptions.Timeout("timed out")
        mock_requests.exceptions = real_requests.exceptions

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "ERROR"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_connection_error(self, mock_table, mock_requests):
        import requests as real_requests
        mock_requests.get.side_effect = real_requests.exceptions.ConnectionError("DNS failed")
        mock_requests.exceptions = real_requests.exceptions

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "ERROR"

    @patch("lambdas.crawler.handler.requests")
    @patch("lambdas.crawler.handler.table")
    def test_server_error_500(self, mock_table, mock_requests):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.history = []
        mock_resp.url = "https://blog.com/post"
        mock_requests.get.return_value = mock_resp

        link = {
            "userId": "u1", "linkId": "l1",
            "pageUrl": "https://blog.com/post",
            "destinationUrl": "https://mysite.com/product",
            "anchorText": "", "status": "LIVE",
        }
        _crawl_link(link)

        call_args = mock_table.update_item.call_args
        assert call_args[1]["ExpressionAttributeValues"][":s"] == "ERROR"


class TestSameDomainDelay:
    @patch("lambdas.crawler.handler.time.sleep")
    @patch("lambdas.crawler.handler._crawl_link")
    @patch("lambdas.crawler.handler._get_links_for_tier")
    @patch("lambdas.crawler.handler.lambda_client")
    def test_same_domain_delay(self, mock_lambda, mock_get_links, mock_crawl, mock_sleep):
        """Links from the same domain should have a delay between crawls."""
        mock_get_links.return_value = [
            {"pageUrl": "https://blog.com/post1", "userId": "u1", "linkId": "l1"},
            {"pageUrl": "https://blog.com/post2", "userId": "u1", "linkId": "l2"},
            {"pageUrl": "https://other.com/post1", "userId": "u1", "linkId": "l3"},
        ]

        lambda_handler({"tier": "daily"}, None)

        # Should have one sleep call (between the two blog.com links)
        assert mock_sleep.call_count == 1
        mock_sleep.assert_called_with(0.5)
        assert mock_crawl.call_count == 3

#!/usr/bin/env python3
"""Run the API Lambdas locally for fast iteration: an HTTP server that turns each request into a Lambda Function URL
event and calls api/handler.py, or api/admin_handler.py for /api/admin/* (as the two CloudFront distributions do),
restarting itself whenever a file under api/ changes.

Started by scripts/local-test.sh (which sets the environment for a deployed stage). Listens on 127.0.0.1:3000, which is
where both Vite apps proxy /api (frontend/vite.config.ts, admin/vite.config.ts).
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "api"
PORT = int(os.environ.get("LOCAL_API_PORT", "3000"))


def serve() -> None:
    sys.path.insert(0, str(API))
    import admin_handler  # noqa: E402  (api/admin_handler.py: the admin Lambda)
    import handler  # noqa: E402  (api/handler.py, imported the way Lambda imports it)

    class Handler(BaseHTTPRequestHandler):
        def _handle(self) -> None:
            url = urlsplit(self.path)
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length).decode("utf-8", "replace") if length else None
            event = {
                "version": "2.0",
                "rawPath": url.path,
                "rawQueryString": url.query,
                "queryStringParameters": dict(parse_qsl(url.query)) or None,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "requestContext": {"http": {"method": self.command, "path": url.path, "sourceIp": self.client_address[0],
                                            "userAgent": self.headers.get("user-agent", "")}},
                "body": body,
                "isBase64Encoded": False,
            }
            started = time.time()
            try:
                target = admin_handler if url.path.startswith("/api/admin/") else handler
                resp = target.lambda_handler(event, None)
            except Exception as e:  # noqa: BLE001 - show the error instead of dropping the connection
                import traceback

                traceback.print_exc()
                resp = {"statusCode": 500, "headers": {"Content-Type": "application/json"},
                        "body": '{"error": "local API crashed: %s"}' % type(e).__name__}
            out = (resp.get("body") or "").encode()
            self.send_response(int(resp.get("statusCode", 200)))
            for k, v in (resp.get("headers") or {}).items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            try:
                self.wfile.write(out)
            except (BrokenPipeError, ConnectionResetError):  # the browser gave up on the request (navigation, reload)
                return
            print(f"{self.command} {self.path} -> {resp.get('statusCode')} ({(time.time() - started) * 1000:.0f} ms)",
                  flush=True)

        do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = _handle

        def log_message(self, *args) -> None:  # the line above is enough
            pass

    print(f"local API on http://127.0.0.1:{PORT} (stage {os.environ.get('STAGE')}, table {os.environ.get('TABLE_NAME')})",
          flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


def snapshot() -> dict:
    return {p: p.stat().st_mtime for p in API.rglob("*.py") if "__pycache__" not in p.parts}


def watch() -> None:
    """Parent: run the server as a child and restart it when api/ changes."""
    while True:
        before = snapshot()
        child = subprocess.Popen([sys.executable, __file__, "--serve"])
        try:
            while child.poll() is None and snapshot() == before:
                time.sleep(0.7)
        except KeyboardInterrupt:
            child.terminate()
            return
        if child.poll() is None:
            print("api/ changed: restarting", flush=True)
            child.terminate()
            child.wait()
        else:
            print("local API exited; waiting for a change to api/ to restart", flush=True)
            while snapshot() == before:
                time.sleep(0.7)


if __name__ == "__main__":
    serve() if "--serve" in sys.argv else watch()

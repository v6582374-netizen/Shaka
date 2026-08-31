"""Run the Shaka submission API with the Python standard library."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .core import ApiProblem, build_capabilities, run_invocation


ROOT = Path(__file__).resolve().parent
DOCS_ROOT = ROOT.parent / "docs" / "public-api"


class SubmissionHandler(BaseHTTPRequestHandler):
    server_version = "ShakaSubmission/1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/health", "/v1/health"}:
            self._json(HTTPStatus.OK, {"status": "ok", "service": "Shaka Submission API"})
        elif path == "/v1/capabilities":
            self._json(HTTPStatus.OK, build_capabilities())
        elif path == "/openapi.json":
            self._file(ROOT / "openapi.json", "application/json; charset=utf-8")
        elif path in {"/", "/index.html"}:
            self._file(DOCS_ROOT / "demo.html", "text/html; charset=utf-8")
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "route not found"}})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/v1/invocations":
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "route not found"}})
            return
        try:
            self._authorize()
            raw_length = self.headers.get("Content-Length", "0")
            length = int(raw_length)
            if length > 64_000:
                raise ApiProblem(413, "payload_too_large", "request body exceeds 64000 bytes")
            raw = self.rfile.read(length)
            try:
                payload: Any = json.loads(raw or b"{}")
            except json.JSONDecodeError as error:
                raise ApiProblem(400, "invalid_json", "request body is not valid JSON") from error
            self._json(HTTPStatus.OK, run_invocation(payload))
        except ApiProblem as problem:
            self._json(problem.status, problem.as_dict())
        except (TypeError, ValueError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": {"code": "invalid_request", "message": "invalid request"}})

    def _authorize(self) -> None:
        expected = os.environ.get("SHAKA_API_KEY")
        if expected and self.headers.get("Authorization") != f"Bearer {expected}":
            raise ApiProblem(401, "unauthorized", "missing or invalid bearer token")

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: int, body: Any) -> None:
        encoded = json.dumps(body, ensure_ascii=False, indent=2).encode()
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _file(self, path: Path, content_type: str) -> None:
        if not path.is_file():
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "asset not found"}})
            return
        encoded = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        if os.environ.get("SHAKA_API_QUIET") != "1":
            super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), SubmissionHandler)
    print(f"Shaka submission API listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

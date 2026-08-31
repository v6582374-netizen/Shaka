"""Run the Shaka submission API with the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .core import ApiProblem, build_capabilities, run_invocation
from .qwen_planner import assess_result, validate_plan


ROOT = Path(__file__).resolve().parent
DOCS_ROOT = ROOT.parent / "docs" / "public-api"
QWEN_EVIDENCE_ROOT = ROOT.parent / "artifacts" / "qwen-feedback-cycle"
QWEN_EVIDENCE = QWEN_EVIDENCE_ROOT / "cycle-summary.json"


def verify_qwen_manifest(directory: Path = QWEN_EVIDENCE_ROOT) -> dict[str, Any]:
    manifest_path = directory / "artifact-manifest.json"
    if not manifest_path.is_file():
        raise ApiProblem(404, "evidence_not_found", "retained Qwen evidence manifest is unavailable")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = manifest["files"]
        listed = {entry["path"] for entry in entries}
        actual = {path.name for path in directory.glob("*.json") if path.name != manifest_path.name}
        if listed != actual:
            raise ValueError("manifest file set mismatch")
        for entry in entries:
            content = (directory / entry["path"]).read_bytes()
            if hashlib.sha256(content).hexdigest() != entry["sha256"] or len(content) != entry["size_bytes"]:
                raise ValueError(f"manifest mismatch: {entry['path']}")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError) as error:
        raise ApiProblem(409, "evidence_integrity_failed", "retained Qwen evidence failed manifest verification") from error
    return manifest


def replay_qwen_cycle(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ApiProblem(400, "invalid_request", "request body must be a JSON object")
    selected_round = payload.get("round", "all")
    if selected_round not in {"all", 1, 2}:
        raise ApiProblem(422, "unsupported_round", "round must be all, 1, or 2")
    if not QWEN_EVIDENCE.is_file():
        raise ApiProblem(404, "evidence_not_found", "retained Qwen evidence is unavailable")

    verify_qwen_manifest()
    summary = json.loads(QWEN_EVIDENCE.read_text(encoding="utf-8"))
    plans = {
        round_number: json.loads(
            (QWEN_EVIDENCE_ROOT / f"round-{round_number}-plan.json").read_text(encoding="utf-8")
        )
        for round_number in (1, 2)
    }
    round_numbers = (1, 2) if selected_round == "all" else (selected_round,)
    replayed = []
    for round_number in round_numbers:
        plan = validate_plan(
            plans[round_number],
            expected_round=round_number,
            expected_scientific_question=plans[1]["scientific_question"] if round_number == 2 else None,
        )
        result = run_invocation(plan["request"])
        assessment = assess_result(plan, result)
        replayed.append(
            {
                "round": round_number,
                "plan_id": plan["plan_id"],
                "run_id": result["run_id"],
                "decision": assessment["decision"],
                "plan_controls": result["request"]["plan_controls"],
                "metrics": result["evaluation"]["metrics"],
                "action_plan": result["action_plan"],
                "evidence_digest": result["evidence_digest"],
            }
        )
    return {
        "cycle_id": summary["cycle_id"],
        "claim_boundary": summary["claim_boundary"],
        "replay_kind": "deterministic_contract_simulation",
        "qwen_called": False,
        "physical_execution": False,
        "manifest_verified": True,
        "rounds": replayed,
    }


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
        elif path == "/v1/qwen/evidence":
            self._file(QWEN_EVIDENCE, "application/json; charset=utf-8")
        elif path == "/openapi.json":
            self._file(ROOT / "openapi.json", "application/json; charset=utf-8")
        elif path in {"/", "/index.html"}:
            self._file(DOCS_ROOT / "demo.html", "text/html; charset=utf-8")
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "route not found"}})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in {"/v1/invocations", "/v1/qwen/replay"}:
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "route not found"}})
            return
        try:
            self._authorize()
            payload = self._read_json_body()
            body = replay_qwen_cycle(payload) if path == "/v1/qwen/replay" else run_invocation(payload)
            self._json(HTTPStatus.OK, body)
        except ApiProblem as problem:
            self._json(problem.status, problem.as_dict())
        except (TypeError, ValueError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": {"code": "invalid_request", "message": "invalid request"}})

    def _read_json_body(self) -> Any:
        raw_length = self.headers.get("Content-Length", "0")
        length = int(raw_length)
        if length > 64_000:
            raise ApiProblem(413, "payload_too_large", "request body exceeds 64000 bytes")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError as error:
            raise ApiProblem(400, "invalid_json", "request body is not valid JSON") from error

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

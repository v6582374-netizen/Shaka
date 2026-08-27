#!/usr/bin/env python3
"""Prepare, and only with ``--execute`` run, one connected-G1 zero-write invocation.

This is the public one-command entrypoint for the current UniFoLM-G1 vertical
slice. It creates a new invocation identity from the frozen manifest template,
then delegates to the existing single-invocation lifecycle. It never has a
physical execution mode and cannot create an arm, hand, or low-command writer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IDENTITY_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
DEFAULT_TEMPLATE = Path(
    "/mnt/data-hdd/Shaka/unifolm-vla-runner-v001/run-manifest-20260827-006.json"
)
DEFAULT_RUNNER = Path(__file__).with_name("run_single_invocation.py")
DEFAULT_PYTHON = Path(__file__).parents[1] / ".venv" / "bin" / "python"
ZERO_WRITE_MAXIMUM_DURATION_S = 900


@dataclass(frozen=True)
class PreparedManifest:
    path: Path
    run_id: str
    sha256: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _identity(value: str) -> str:
    if IDENTITY_PATTERN.fullmatch(value) is None:
        raise ValueError("run_id must contain only letters, numbers, '.', '_' or '-'")
    return value


def _read_template(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"zero-write manifest template is unreadable: {error}") from error
    if not isinstance(value, dict) or value.get("schema_version") != 2:
        raise ValueError("zero-write manifest template has an unsupported identity")
    if value.get("execution_mode") != "zero-write":
        raise ValueError("launcher only accepts a zero-write manifest template")
    output_root = value.get("output_root")
    if not isinstance(output_root, str) or not output_root:
        raise ValueError("zero-write manifest template lacks an output root")
    return value


def _generated_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"UNIFOLM-VLA-ZERO-WRITE-{timestamp}-{uuid.uuid4().hex[:8]}"


def prepare(template: Path, run_id: str) -> PreparedManifest:
    """Create one immutable-use manifest; it performs no robot I/O."""
    identity = _identity(run_id)
    source = _read_template(template.resolve())
    output_root = Path(str(source["output_root"])).resolve()
    manifest_path = output_root.parent / f"run-manifest-{identity}.json"
    if manifest_path.exists():
        raise FileExistsError(f"fresh run manifest already exists: {manifest_path}")
    value = {
        **source,
        "run_id": identity,
        "invocation_id": identity,
        # The model's immutable 18.98GB checkpoint can exceed the historical
        # 600-second run template once live capture, runtime preflight and
        # evidence post-roll are included. This is a zero-write wall-clock
        # budget only; it cannot enlarge any physical-rollout budget.
        "maximum_duration_s": ZERO_WRITE_MAXIMUM_DURATION_S,
    }
    manifest_path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return PreparedManifest(manifest_path, identity, _sha256(manifest_path))


def execute(prepared: PreparedManifest, python: Path) -> dict[str, Any]:
    if not python.is_file() or not DEFAULT_RUNNER.is_file():
        raise RuntimeError("the connected-G1 zero-write runner runtime is unavailable")
    completed = subprocess.run(
        [str(python), str(DEFAULT_RUNNER), "--manifest", str(prepared.path), "--connected-g1"],
        capture_output=True,
        text=True,
        check=False,
    )
    result: dict[str, Any] | None = None
    for line in reversed(completed.stdout.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            result = value
            break
    if result is None:
        raise RuntimeError(completed.stderr.strip() or "zero-write runner returned no JSON result")
    if result.get("command_publishers_created") != 0 or result.get("writes") != 0:
        raise RuntimeError("zero-write runner reported a command publication or write")
    if completed.returncode != 0:
        raise RuntimeError(str(result.get("reason", "zero-write runner rejected the invocation")))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--runner-python", type=Path, default=DEFAULT_PYTHON)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        prepared = prepare(args.template, args.run_id or _generated_run_id())
        result: dict[str, Any] = {
            "result": "connected_g1_zero_write_manifest_prepared",
            "run_id": prepared.run_id,
            "manifest": {"path": str(prepared.path), "sha256": prepared.sha256},
            "execution_mode": "zero-write",
            "physical_execution_authorized": False,
            "command_publishers_created": 0,
            "writes": 0,
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
        }
        if args.execute:
            result = {**result, "invocation": execute(prepared, args.runner_python)}
    except Exception as error:  # noqa: BLE001 - preserve one JSON result boundary
        result = {
            "result": "connected_g1_zero_write_launcher_rejected",
            "physical_execution_authorized": False,
            "reason": str(error),
            "command_publishers_created": 0,
            "writes": 0,
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
        }
        print(json.dumps(result, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

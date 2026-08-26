#!/usr/bin/env python3
"""Deterministic offline adapters used by the zero-write invocation runner."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"{description} is missing: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _audit(adapter: str, outcome: str) -> None:
    path_value = os.environ.get("SHAKA_INVOCATION_ADAPTER_AUDIT")
    if path_value is None:
        return
    event = {
        "adapter": adapter,
        "outcome": outcome,
        "time_ns": time.time_ns(),
        "command_publishers_created": 0,
        "writes": 0,
    }
    with Path(path_value).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True) + "\n")
        stream.flush()


def _base(**values: Any) -> dict[str, Any]:
    return {"command_publishers_created": 0, "writes": 0, **values}


def readiness(args: argparse.Namespace) -> dict[str, Any]:
    claim_directory = args.claim_directory.resolve()
    if args.execution_mode != "zero-write":
        raise ValueError("offline readiness only accepts zero-write mode")
    if not (claim_directory / "run-id.txt").is_file():
        raise RuntimeError("invocation authority claim is absent")
    return _base(
        ready=True,
        execution_mode="zero-write",
        control_authority="exclusive_local_claim",
        competing_command_publishers=0,
    )


def candidate(args: argparse.Namespace) -> dict[str, Any]:
    package = _read_object(args.package.resolve(), "candidate package")
    if package.get("schema_version") != 1:
        raise ValueError("candidate package schema_version must be 1")
    if "task_result" in package:
        raise ValueError("candidate output must not contain a task result")
    candidate_id = package.get("candidate_id")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise ValueError("candidate package candidate_id must be a non-empty string")
    deployment_evidence = package.get("deployment_evidence")
    if not isinstance(deployment_evidence, dict):
        raise TypeError("candidate deployment_evidence must be an object")
    return _base(
        candidate_id=candidate_id,
        deployment_status="completed",
        deployment_evidence=deployment_evidence,
    )


def release(args: argparse.Namespace) -> dict[str, Any]:
    del args
    return _base(released=True, control_authority="released")


def evaluation(args: argparse.Namespace) -> dict[str, Any]:
    evidence_manifest = args.evidence_manifest.resolve()
    if not evidence_manifest.is_file():
        raise FileNotFoundError("complete evidence manifest is absent")
    return _base(
        evaluator_version=args.evaluator_version,
        input_manifest_sha256=_sha256_file(evidence_manifest),
        visual_facts={
            "contact_visible": "not_evaluated",
            "retreat_visible": "not_evaluated",
            "evidence_scope": "offline_zero_write_validation",
        },
        task_result="indeterminate",
        reason="offline zero-write validation does not establish a task outcome",
    )


def reset(args: argparse.Namespace) -> dict[str, Any]:
    if args.execution_mode != "zero-write":
        raise ValueError("offline reset adapter only accepts zero-write mode")
    return _base(
        requested=False,
        task_result=args.task_result,
        reason="zero_write_validation_is_not_a_task_attempt",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="adapter", required=True)

    readiness_parser = subparsers.add_parser("readiness")
    readiness_parser.add_argument("--claim-directory", type=Path, required=True)
    readiness_parser.add_argument("--execution-mode", required=True)

    candidate_parser = subparsers.add_parser("candidate")
    candidate_parser.add_argument("--package", type=Path, required=True)

    subparsers.add_parser("release")

    evaluation_parser = subparsers.add_parser("evaluation")
    evaluation_parser.add_argument("--evidence-manifest", type=Path, required=True)
    evaluation_parser.add_argument("--evaluator-version", required=True)

    reset_parser = subparsers.add_parser("reset")
    reset_parser.add_argument("--execution-mode", required=True)
    reset_parser.add_argument("--task-result", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    adapter = str(args.adapter)
    functions = {
        "readiness": readiness,
        "candidate": candidate,
        "release": release,
        "evaluation": evaluation,
        "reset": reset,
    }
    try:
        result = functions[adapter](args)
    except Exception as error:  # noqa: BLE001 - adapter emits structured failure
        _audit(adapter, "failed")
        print(json.dumps(_base(result="failed", reason=str(error)), sort_keys=True))
        return 2
    _audit(adapter, "completed")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Read-only verification for a retained Qwen feedback-cycle evidence bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from submission_api.core import run_invocation
from submission_api.qwen_planner import (
    CLAIM_BOUNDARY,
    assess_result,
    validate_plan,
    verify_feedback_mapping,
)


REQUIRED_ARTIFACTS = {
    "cycle-summary.json",
    "failed-cycle-disclosure.json",
    "method-comparison.json",
    "parameter-space-audit.json",
    "plan-diff.json",
    "qwen-attempts.json",
    "qwen-context.json",
    "qwen-receipts.json",
    "repeatability.json",
    "round-1-assessment.json",
    "round-1-plan.json",
    "round-1-result.json",
    "round-2-assessment.json",
    "round-2-plan.json",
    "round-2-result.json",
}
FORBIDDEN_SECRET_KEYS = {"api_key", "authorization", "access_token", "secret", "credential_value"}


def _load(directory: Path, name: str) -> Any:
    return json.loads((directory / name).read_text(encoding="utf-8"))


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _walk(value: Any, path: str = "$"):
    if isinstance(value, dict):
        for key, child in value.items():
            yield path, key, child
            yield from _walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _walk(child, f"{path}[{index}]")


def _verify_manifest(directory: Path) -> dict[str, Any]:
    manifest = _load(directory, "artifact-manifest.json")
    entries = manifest.get("files")
    _assert(isinstance(entries, list), "manifest files must be an array")
    listed = {entry.get("path") for entry in entries}
    actual = {path.name for path in directory.glob("*.json") if path.name != "artifact-manifest.json"}
    _assert(listed == actual, "manifest must bind every JSON artifact except itself")
    _assert(REQUIRED_ARTIFACTS <= listed, "manifest is missing a required evidence artifact")
    for entry in entries:
        path = directory / entry["path"]
        content = path.read_bytes()
        _assert(hashlib.sha256(content).hexdigest() == entry.get("sha256"), f"hash mismatch: {path.name}")
        _assert(len(content) == entry.get("size_bytes"), f"size mismatch: {path.name}")
    return manifest


def verify(directory: Path) -> dict[str, Any]:
    directory = directory.resolve()
    _assert(directory.is_dir(), f"evidence directory does not exist: {directory}")
    manifest = _verify_manifest(directory)
    artifacts = {name: _load(directory, name) for name in REQUIRED_ARTIFACTS}

    summary = artifacts["cycle-summary.json"]
    round_one_plan = artifacts["round-1-plan.json"]
    round_two_plan = artifacts["round-2-plan.json"]
    round_one_result = artifacts["round-1-result.json"]
    round_two_result = artifacts["round-2-result.json"]
    round_one_assessment = artifacts["round-1-assessment.json"]
    round_two_assessment = artifacts["round-2-assessment.json"]

    _assert(manifest.get("cycle_id") == summary.get("cycle_id"), "manifest cycle_id mismatch")
    _assert(manifest.get("claim_boundary") == CLAIM_BOUNDARY, "manifest claim boundary mismatch")
    _assert(summary.get("claim_boundary") == CLAIM_BOUNDARY, "summary claim boundary mismatch")
    _assert(summary.get("physical_execution") is False, "bundle must not claim physical execution")
    _assert(summary.get("credential_recorded") is False, "bundle claims a retained credential")
    _assert(summary["round_one"]["decision"] == "adjust", "round one must be adjust")
    _assert(summary["round_two"]["decision"] == "accept", "round two must be accept")
    _assert(summary.get("action_plan_changed") is True, "action plan did not change")
    _assert(
        summary.get("round_two_domain_all_candidates_guaranteed_to_pass") is False,
        "round-two domain must retain both outcomes",
    )

    fixed_pose = {"base_x_m": 0.18, "base_y_m": -0.08, "base_yaw_deg": 12.0}
    _assert(round_one_result["request"]["initial_state"] == fixed_pose, "round-one pose mismatch")
    _assert(round_two_result["request"]["initial_state"] == fixed_pose, "round-two pose mismatch")
    _assert(round_one_result["request"]["seed"] == round_two_result["request"]["seed"] == 11, "seed mismatch")
    _assert(round_one_result["action_plan"] != round_two_result["action_plan"], "saved action plans are identical")

    replayed = []
    for round_number, plan, saved_result, saved_assessment, expected_decision in (
        (1, round_one_plan, round_one_result, round_one_assessment, "adjust"),
        (2, round_two_plan, round_two_result, round_two_assessment, "accept"),
    ):
        validated = validate_plan(
            plan,
            expected_round=round_number,
            expected_scientific_question=round_one_plan["scientific_question"] if round_number == 2 else None,
        )
        result = run_invocation(validated["request"])
        assessment = assess_result(validated, result)
        for key in ("request", "request_digest", "run_id", "action_plan", "evaluation", "evidence_digest"):
            _assert(result[key] == saved_result[key], f"round {round_number} replay mismatch: {key}")
        _assert(assessment == saved_assessment, f"round {round_number} assessment mismatch")
        _assert(assessment["decision"] == expected_decision, f"round {round_number} decision mismatch")
        replayed.append(result["run_id"])

    mapping = verify_feedback_mapping(round_one_plan, round_one_assessment, round_two_plan)
    plan_diff = artifacts["plan-diff.json"]
    _assert(mapping == plan_diff.get("verified_feedback_mapping"), "feedback mapping mismatch")
    _assert(plan_diff.get("action_plan_changed") is True, "plan diff does not record the action-plan change")

    audit = artifacts["parameter-space-audit.json"]
    _assert(audit.get("all_candidates_guaranteed_to_pass") is False, "parameter audit guarantees success")
    _assert(audit["decision_counts"].get("accept", 0) > 0, "parameter audit has no accept candidate")
    _assert(audit["decision_counts"].get("adjust", 0) > 0, "parameter audit has no adjust candidate")

    comparison = artifacts["method-comparison.json"]
    _assert(comparison["feedback_disabled"]["decision"] == "adjust", "no-feedback baseline mismatch")
    _assert(comparison["rule_based_feedback"]["decision"] == "adjust", "rule baseline mismatch")
    _assert(comparison["qwen_feedback_enabled"]["decision"] == "accept", "Qwen feedback result mismatch")

    failed_cycle = artifacts["failed-cycle-disclosure.json"]
    _assert(failed_cycle.get("round_decisions") == ["adjust", "adjust"], "failed-cycle disclosure mismatch")
    _assert(failed_cycle.get("full_bundle_retained") is False, "failed-cycle retention boundary mismatch")
    _assert(failed_cycle.get("primary_cycle_selected_after_prompt_revision") is True, "selection disclosure missing")

    receipts = artifacts["qwen-receipts.json"]
    _assert([item["request_id"] for item in receipts] == summary["qwen_request_ids"], "request IDs mismatch")
    _assert(sum(item["usage"].get("total_tokens", 0) for item in receipts) == summary["qwen_total_tokens"], "token total mismatch")

    for name, artifact in artifacts.items():
        for path, key, value in _walk(artifact):
            _assert(key.lower() not in FORBIDDEN_SECRET_KEYS, f"secret-like field retained in {name}: {path}.{key}")
            if key == "credential_recorded":
                _assert(value is False, f"credential_recorded must be false in {name}: {path}")
            if key == "credential_value_retained":
                _assert(value is False, f"credential_value_retained must be false in {name}: {path}")

    return {
        "verified": True,
        "cycle_id": summary["cycle_id"],
        "round_decisions": [round_one_assessment["decision"], round_two_assessment["decision"]],
        "replayed_run_ids": replayed,
        "manifest_files": len(manifest["files"]),
        "qwen_request_ids": summary["qwen_request_ids"],
        "credential_recorded": False,
        "physical_execution": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "evidence_directory",
        nargs="?",
        type=Path,
        default=REPOSITORY_ROOT / "artifacts" / "qwen-feedback-cycle",
    )
    args = parser.parse_args()
    try:
        result = verify(args.evidence_directory)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"verification failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

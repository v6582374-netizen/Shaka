#!/usr/bin/env python3
"""Explicitly project BrainCo targets into its live normalized position contract.

The frozen VLA model emits an unconstrained numerical trajectory.  This tool
does not conceal that fact: it binds a new zero-write evidence artifact to one
input-plan digest and records every altered hand value.  It leaves all 14 arm
coordinates untouched and grants no physical-execution authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.g1-vla-brainco-action-projection.v1"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
ARM_DIMENSION = 14


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"action plan is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError("action plan must be a JSON object")
    return value


def project(plan: dict[str, Any], source_sha256: str) -> dict[str, Any]:
    contract = plan.get("contract")
    trajectory = plan.get("trajectory")
    if (
        plan.get("schema_version") != 1
        or plan.get("kind") != "unifolm_vla_action_plan_evidence"
        or plan.get("execution_mode") != "zero-write"
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or not isinstance(trajectory, list)
        or len(trajectory) != ACTION_HORIZON
    ):
        raise ValueError("input does not declare the fixed 25x26 zero-write action-plan contract")
    if any(plan.get(key) != 0 for key in ("command_publishers_created", "writes")):
        raise ValueError("input plan lacks zero-write provenance")
    projected: list[list[float]] = []
    alterations: list[dict[str, Any]] = []
    for target_index, raw_target in enumerate(trajectory):
        if not isinstance(raw_target, list) or len(raw_target) != ACTION_DIMENSION:
            raise ValueError(f"target {target_index} lacks 26 values")
        try:
            target = [float(value) for value in raw_target]
        except (TypeError, ValueError) as error:
            raise ValueError(f"target {target_index} contains a non-number") from error
        if not all(math.isfinite(value) for value in target):
            raise ValueError(f"target {target_index} contains a non-finite value")
        for action_index in range(ARM_DIMENSION, ACTION_DIMENSION):
            original = target[action_index]
            bounded = min(1.0, max(0.0, original))
            if bounded != original:
                alterations.append(
                    {
                        "target_index": target_index,
                        "action_index": action_index,
                        "original": original,
                        "projected": bounded,
                    }
                )
                target[action_index] = bounded
        projected.append(target)
    result = dict(plan)
    result["trajectory"] = projected
    result["projection"] = {
        "protocol": PROTOCOL,
        "source_action_plan_sha256": source_sha256,
        "method": "brainco_position_clamp_to_closed_interval_0_1",
        "arm_coordinates_modified": False,
        "alterations": alterations,
        "warning": "projection is an explicit interface-boundary transform, not a claim that the model predicted bounded values",
    }
    result["physical_execution_authorized"] = False
    result["projection_writes"] = 0
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--expected-action-plan-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        expected = args.expected_action_plan_sha256.lower()
        if len(expected) != 64 or any(value not in "0123456789abcdef" for value in expected):
            raise ValueError("expected action-plan SHA-256 must be 64 lowercase hexadecimal characters")
        source = args.action_plan.resolve()
        if _sha256(source) != expected:
            raise ValueError("action-plan SHA-256 does not match its frozen value")
        output = args.output.resolve()
        if not output.parent.is_dir():
            raise ValueError(f"output parent does not exist: {output.parent}")
        value = project(_read_object(source), expected)
        temporary = output.with_name(f".{output.name}.tmp")
        try:
            temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            os.replace(temporary, output)
        finally:
            if temporary.exists():
                temporary.unlink()
        print(json.dumps({"protocol": PROTOCOL, "result": "g1_vla_brainco_action_projection_ok", "output": {"path": str(output), "sha256": _sha256(output)}, "alterations": len(value["projection"]["alterations"]), "physical_execution_authorized": False, "writes": 0}, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - machine-readable failure
        print(json.dumps({"protocol": PROTOCOL, "result": "g1_vla_brainco_action_projection_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

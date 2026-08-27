#!/usr/bin/env python3
"""Turn a frozen absolute-pose VLA plan into a live-pose-relative arm plan.

The VLA was trained with absolute joint values, while ``rt/arm_sdk`` needs a
trajectory that is meaningful from the robot's *current* pose.  This tool
preserves the model's temporal motion (each step relative to its first output)
but anchors it to a measured 14-joint live entry pose.  It is offline only and
never imports DDS or creates a publisher.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

ARM_DIMENSION = 14
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
PROTOCOL = "shaka.g1-vla-relative-arm-projection.v1"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("action plan must be an object")
    return value


def project(value: dict[str, Any], entry_positions_rad: list[float]) -> dict[str, Any]:
    contract = value.get("contract")
    trajectory = value.get("trajectory")
    if (
        value.get("kind") != "unifolm_vla_action_plan_evidence"
        or value.get("execution_mode") != "zero-write"
        or value.get("command_publishers_created") != 0
        or value.get("writes") != 0
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or not isinstance(trajectory, list)
        or len(trajectory) != ACTION_HORIZON
        or len(entry_positions_rad) != ARM_DIMENSION
    ):
        raise ValueError("input does not prove the fixed zero-write 25x26 contract")
    if any(not math.isfinite(float(item)) for item in entry_positions_rad):
        raise ValueError("live entry positions must be finite")
    if any(not isinstance(row, list) or len(row) != ACTION_DIMENSION for row in trajectory):
        raise ValueError("action plan contains a malformed trajectory row")
    if any(not math.isfinite(float(item)) for row in trajectory for item in row):
        raise ValueError("action plan contains a non-finite value")
    anchor = [float(item) for item in trajectory[0][:ARM_DIMENSION]]
    relative = [
        [float(entry_positions_rad[index]) + float(row[index]) - anchor[index] for index in range(ARM_DIMENSION)]
        for row in trajectory
    ]
    return {
        "schema_version": 1,
        "kind": "g1_vla_relative_arm_plan",
        "protocol": PROTOCOL,
        "source_execution_mode": "zero-write",
        "physical_execution_authorized": False,
        "entry_positions_rad": entry_positions_rad,
        "model_anchor_absolute_rad": anchor,
        "trajectory_arm_positions_rad": relative,
        "hands": "intentionally omitted until arm control handover is verified",
        "command_publishers_created": 0,
        "writes": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--entry-positions-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise FileExistsError("refusing to overwrite a relative arm plan")
        entry = json.loads(args.entry_positions_json.read_text(encoding="utf-8"))
        if not isinstance(entry, list):
            raise ValueError("entry positions must be a JSON list")
        result = project(_read(args.action_plan), [float(item) for item in entry])
        result["source_action_plan_sha256"] = _sha256(args.action_plan)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"result": "g1_vla_relative_arm_plan_projected", "writes": 0, "output_sha256": _sha256(args.output)}, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"result": "g1_vla_relative_arm_plan_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

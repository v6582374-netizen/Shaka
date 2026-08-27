#!/usr/bin/env python3
"""Build one unarmed, supervised P0 G1 VLA canary package.

This is intentionally smaller than the unattended robot-side-guardian path.
It does not publish DDS commands or try to infer workspace clearance.  Instead
it binds one successfully completed connected-G1 zero-write invocation to a
single, reviewable physical experiment:

* the VLA selects the direction of *one* wrist joint;
* the live executor may move it by at most 0.01 rad (about 0.57 degrees);
* hands and every other arm joint remain at their measured entry position;
* the executor must release ``rt/arm_sdk`` immediately after the one attempt.

The generated JSON remains unarmed.  A separate explicit ``--execute`` on the
hardware executor is required before it can create a command publisher.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.g1-vla-supervised-canary.v1"
PACKAGE_KIND = "g1_vla_supervised_canary_package"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
ACTIVE_ARM_INDEX = 6
ACTIVE_JOINT = "left_wrist_yaw_joint"
MAXIMUM_DELTA_RAD = 0.01
COMMAND_PERIOD_NS = 20_000_000
ACTIVE_TICKS = 15
RELEASE_TICKS = 50


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is unreadable: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be a JSON object")
    return value


def require_zero_write_action_plan(path: Path) -> dict[str, Any]:
    value = read_object(path, "action plan")
    contract = value.get("contract")
    trajectory = value.get("trajectory")
    if (
        value.get("schema_version") != 1
        or value.get("kind") != "unifolm_vla_action_plan_evidence"
        or value.get("execution_mode") != "zero-write"
        or value.get("command_publishers_created") != 0
        or value.get("writes") != 0
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or not isinstance(trajectory, list)
        or len(trajectory) != ACTION_HORIZON
    ):
        raise ValueError("action plan does not prove the fixed 25x26 zero-write VLA contract")
    for row_index, row in enumerate(trajectory):
        if not isinstance(row, list) or len(row) != ACTION_DIMENSION:
            raise ValueError(f"action plan trajectory row {row_index} is not 26-dimensional")
        if any(not isinstance(item, (int, float)) or not math.isfinite(float(item)) for item in row):
            raise ValueError(f"action plan trajectory row {row_index} contains a non-finite value")
    return value


def require_static_admission(path: Path, action_plan_digest: str) -> None:
    value = read_object(path, "static admission")
    if (
        value.get("result") != "g1_vla_action_plan_static_bounds_ok"
        or value.get("execution_mode") != "zero-write"
        or value.get("physical_execution_authorized") is not False
        or value.get("command_publishers_created") != 0
        or value.get("writes") != 0
    ):
        raise ValueError("static admission does not prove a passing zero-write action-plan check")
    bound_digest = value.get("action_plan_sha256")
    if bound_digest is not None and bound_digest != action_plan_digest:
        raise ValueError("static admission is bound to a different action plan")


def require_terminal_report(path: Path, action_plan_digest: str, static_admission_digest: str) -> None:
    value = read_object(path, "connected-G1 terminal report")
    if (
        value.get("execution_mode") != "zero-write"
        or value.get("command_publishers_created") != 0
        or value.get("writes") != 0
    ):
        raise ValueError("terminal report does not prove a connected-G1 zero-write invocation")
    artifacts = value.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("terminal report does not bind its artifacts")
    action = artifacts.get("action_plan")
    admission = artifacts.get("static_admission")
    if not isinstance(action, dict) or action.get("sha256") != action_plan_digest:
        raise ValueError("terminal report is not bound to this action plan")
    if not isinstance(admission, dict) or admission.get("sha256") != static_admission_digest:
        raise ValueError("terminal report is not bound to this static admission")


def package(
    *,
    action_plan: Path,
    static_admission: Path,
    terminal_report: Path,
    invocation_id: str,
) -> dict[str, Any]:
    plan = require_zero_write_action_plan(action_plan)
    plan_digest = sha256(action_plan)
    require_static_admission(static_admission, plan_digest)
    static_admission_digest = sha256(static_admission)
    require_terminal_report(terminal_report, plan_digest, static_admission_digest)
    proposed_target = float(plan["trajectory"][0][ACTIVE_ARM_INDEX])
    return {
        "schema_version": 1,
        "kind": PACKAGE_KIND,
        "protocol": PROTOCOL,
        "invocation_id": invocation_id,
        "execution_mode": "supervised-p0-review-only",
        "physical_execution_authorized": False,
        "source": {
            "action_plan": {"path": str(action_plan.resolve()), "sha256": plan_digest},
            "static_admission": {
                "path": str(static_admission.resolve()),
                "sha256": static_admission_digest,
            },
            "connected_g1_terminal_report": {
                "path": str(terminal_report.resolve()),
                "sha256": sha256(terminal_report),
            },
        },
        "canary": {
            "active_arm_index": ACTIVE_ARM_INDEX,
            "active_joint": ACTIVE_JOINT,
            "vla_proposed_absolute_target_rad": proposed_target,
            "target_interpretation": "sign(vla_target_rad - measured_entry_rad), never an absolute command",
            "maximum_delta_rad": MAXIMUM_DELTA_RAD,
            "command_period_ns": COMMAND_PERIOD_NS,
            "active_ticks": ACTIVE_TICKS,
            "release_ticks": RELEASE_TICKS,
            "hands": "disabled",
            "other_arm_joints": "hold_measured_entry_position",
            "attempt_budget": 1,
            "retry": "forbidden",
        },
        "limitations": [
            "This is a supervised physical canary, not an unattended-autonomy authorization.",
            "Workspace clearance and emergency stop readiness are external physical preconditions.",
            "Network-loss protection is provided only by explicit prompt authority release, not a robot-side guardian.",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "command_publishers_created": 0,
        "writes": 0,
    }


def write_new_json(path: Path, value: dict[str, Any]) -> None:
    destination = path.resolve()
    if destination.exists():
        raise FileExistsError(f"refusing to overwrite existing canary package: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--static-admission", type=Path, required=True)
    parser.add_argument("--terminal-report", type=Path, required=True)
    parser.add_argument("--invocation-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        value = package(
            action_plan=args.action_plan.resolve(),
            static_admission=args.static_admission.resolve(),
            terminal_report=args.terminal_report.resolve(),
            invocation_id=args.invocation_id,
        )
        write_new_json(args.output, value)
        print(
            json.dumps(
                {
                    "result": "g1_vla_supervised_canary_package_prepared",
                    "package": {"path": str(args.output.resolve()), "sha256": sha256(args.output)},
                    "physical_execution_authorized": False,
                    "command_publishers_created": 0,
                    "writes": 0,
                },
                sort_keys=True,
            )
        )
        return 0
    except Exception as error:  # noqa: BLE001 - retain a machine-readable command boundary
        print(
            json.dumps(
                {
                    "result": "g1_vla_supervised_canary_package_rejected",
                    "reason": str(error),
                    "physical_execution_authorized": False,
                    "command_publishers_created": 0,
                    "writes": 0,
                },
                sort_keys=True,
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

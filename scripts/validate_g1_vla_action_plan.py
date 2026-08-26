#!/usr/bin/env python3
"""Statically reject unsafe UniFoLM-VLA G1 + BrainCo action-plan evidence.

This program is intentionally not a controller.  It has no DDS, hardware, or
network imports, accepts a previously frozen zero-write action-plan JSON, and
checks only hard mechanical and hand-service bounds.  A passing result is not
physical authorization: velocity timing, workspace, contact, torque feedback,
control-entry watchdog, and release semantics require a separately frozen
control contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


PROTOCOL = "shaka.g1-vla-action-plan-static-admission.v1"
TRAINING_TIME_PROTOCOL = "shaka.brainco26-training-time-audit.v1"
PLAN_SCHEMA_VERSION = 1
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
BODY_DIMENSION = 34
ARM_BODY_OFFSET = 20
ARM_DIMENSION = 14
HAND_DIMENSION = 12


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be an object")
    return value


def _vector(value: Any, size: int, description: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != size:
        raise ValueError(f"{description} must contain exactly {size} values")
    try:
        result = tuple(float(item) for item in value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} contains a non-number") from error
    if not all(math.isfinite(item) for item in result):
        raise ValueError(f"{description} contains a non-finite value")
    return result


def _trajectory(plan: dict[str, Any]) -> tuple[tuple[float, ...], ...]:
    contract = plan.get("contract")
    if (
        plan.get("schema_version") != PLAN_SCHEMA_VERSION
        or plan.get("kind") != "unifolm_vla_action_plan_evidence"
        or plan.get("execution_mode") != "zero-write"
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or contract.get("live_brainco_action_units") != "normalized_0_to_1"
    ):
        raise ValueError("action plan does not declare the fixed live-normalized BrainCo26 contract")
    if any(plan.get(key) != 0 for key in ("command_publishers_created", "writes")):
        raise ValueError("action plan does not preserve its zero-write provenance")
    raw = plan.get("trajectory")
    if not isinstance(raw, list) or len(raw) != ACTION_HORIZON:
        raise ValueError("action plan does not contain 25 targets")
    return tuple(
        _vector(step, ACTION_DIMENSION, f"action target {index}")
        for index, step in enumerate(raw)
    )


def _live_state(observation: dict[str, Any]) -> tuple[float, ...]:
    robot_state = observation.get("robot_state")
    brainco = observation.get("brainco")
    if not isinstance(robot_state, dict) or not isinstance(brainco, dict):
        raise ValueError("observation lacks G1 or BrainCo state")
    body = _vector(robot_state.get("body"), BODY_DIMENSION, "G1 body state")
    left = brainco.get("left")
    right = brainco.get("right")
    if not isinstance(left, dict) or not isinstance(right, dict):
        raise ValueError("observation lacks a BrainCo hand")
    return (
        body[ARM_BODY_OFFSET : ARM_BODY_OFFSET + ARM_DIMENSION]
        + _vector(left.get("positions"), 6, "left BrainCo state")
        + _vector(right.get("positions"), 6, "right BrainCo state")
    )


def _arm_limits(urdf: Path, joint_order: tuple[str, ...]) -> tuple[tuple[float, float], ...]:
    try:
        root = ElementTree.parse(urdf).getroot()
    except (OSError, ElementTree.ParseError) as error:
        raise ValueError(f"G1 URDF is unreadable: {error}") from error
    raw = {
        str(joint.get("name")): joint.find("limit")
        for joint in root.findall("joint")
        if joint.get("name") is not None
    }
    limits: list[tuple[float, float]] = []
    for name in joint_order:
        limit = raw.get(name)
        if limit is None:
            raise ValueError(f"G1 URDF lacks a hard limit for {name}")
        try:
            lower = float(limit.attrib["lower"])
            upper = float(limit.attrib["upper"])
        except (KeyError, ValueError) as error:
            raise ValueError(f"G1 URDF limit for {name} is invalid") from error
        if not math.isfinite(lower) or not math.isfinite(upper) or lower >= upper:
            raise ValueError(f"G1 URDF limit for {name} is invalid")
        limits.append((lower, upper))
    return tuple(limits)


def _arm_velocity_limits(urdf: Path, joint_order: tuple[str, ...]) -> tuple[float, ...]:
    """Read URDF joint speed hard limits for an already-bound training cadence."""
    try:
        root = ElementTree.parse(urdf).getroot()
    except (OSError, ElementTree.ParseError) as error:
        raise ValueError(f"G1 URDF is unreadable: {error}") from error
    raw = {
        str(joint.get("name")): joint.find("limit")
        for joint in root.findall("joint")
        if joint.get("name") is not None
    }
    limits: list[float] = []
    for name in joint_order:
        limit = raw.get(name)
        if limit is None:
            raise ValueError(f"G1 URDF lacks a velocity limit for {name}")
        try:
            value = float(limit.attrib["velocity"])
        except (KeyError, ValueError) as error:
            raise ValueError(f"G1 URDF velocity limit for {name} is invalid") from error
        if not math.isfinite(value) or value <= 0.0:
            raise ValueError(f"G1 URDF velocity limit for {name} is invalid")
        limits.append(value)
    return tuple(limits)


def _training_sample_interval(audit: dict[str, Any]) -> float:
    semantics = audit.get("training_time_semantics")
    if (
        audit.get("result") != "brainco26_training_time_audit_ok"
        or audit.get("protocol") != TRAINING_TIME_PROTOCOL
        or audit.get("physical_execution_authorized") is not False
        or not isinstance(semantics, dict)
        or semantics.get("action_horizon_steps") != ACTION_HORIZON
    ):
        raise ValueError("training-time audit does not declare the fixed zero-write BrainCo26 contract")
    try:
        interval = float(semantics["sample_interval_seconds"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("training-time audit lacks a valid sample interval") from error
    if not math.isfinite(interval) or interval <= 0.0:
        raise ValueError("training-time audit has an invalid sample interval")
    return interval


def validate(
    plan: dict[str, Any],
    observation: dict[str, Any],
    standard_start: dict[str, Any],
    urdf: Path,
    training_time_audit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trajectory = _trajectory(plan)
    live_state = _live_state(observation)
    pose = standard_start.get("pose")
    if not isinstance(pose, dict):
        raise ValueError("standard-start configuration lacks a pose")
    names_raw = pose.get("arm_joint_order")
    if not isinstance(names_raw, list) or len(names_raw) != ARM_DIMENSION:
        raise ValueError("standard-start configuration lacks 14 ordered arm joints")
    joint_order = tuple(str(name) for name in names_raw)
    if len(set(joint_order)) != ARM_DIMENSION:
        raise ValueError("standard-start arm-joint order is not unique")
    standard_arm = _vector(pose.get("arm_values"), ARM_DIMENSION, "standard-start arm pose")
    limits = _arm_limits(urdf, joint_order)
    sample_interval = (
        _training_sample_interval(training_time_audit)
        if training_time_audit is not None
        else None
    )
    velocity_limits = (
        _arm_velocity_limits(urdf, joint_order) if sample_interval is not None else None
    )
    violations: list[dict[str, Any]] = []
    for target_index, target in enumerate(trajectory):
        for joint_index, (value, (lower, upper)) in enumerate(
            zip(target[:ARM_DIMENSION], limits, strict=True)
        ):
            if value < lower or value > upper:
                violations.append(
                    {
                        "kind": "arm_hard_limit",
                        "target_index": target_index,
                        "joint_index": joint_index,
                        "joint": joint_order[joint_index],
                        "value": value,
                        "lower": lower,
                        "upper": upper,
                    }
                )
        for hand_index, value in enumerate(target[ARM_DIMENSION:]):
            if value < 0.0 or value > 1.0:
                violations.append(
                    {
                        "kind": "brainco_normalized_limit",
                        "target_index": target_index,
                        "joint_index": ARM_DIMENSION + hand_index,
                        "value": value,
                        "lower": 0.0,
                        "upper": 1.0,
                    }
                )
    if sample_interval is not None and velocity_limits is not None:
        for target_index, (previous, current) in enumerate(
            zip(trajectory, trajectory[1:]), start=1
        ):
            for joint_index, (previous_value, current_value, velocity_limit) in enumerate(
                zip(
                    previous[:ARM_DIMENSION],
                    current[:ARM_DIMENSION],
                    velocity_limits,
                    strict=True,
                )
            ):
                implied_velocity = abs(current_value - previous_value) / sample_interval
                if implied_velocity > velocity_limit:
                    violations.append(
                        {
                            "kind": "arm_urdf_velocity_limit",
                            "target_index": target_index,
                            "joint_index": joint_index,
                            "joint": joint_order[joint_index],
                            "implied_velocity": implied_velocity,
                            "limit": velocity_limit,
                            "sample_interval_seconds": sample_interval,
                        }
                    )
    flattened = tuple(value for target in trajectory for value in target)
    max_live_delta = max(
        abs(value - current)
        for target in trajectory
        for value, current in zip(target, live_state, strict=True)
    )
    max_standard_arm_delta = max(
        abs(value - reference)
        for target in trajectory
        for value, reference in zip(target[:ARM_DIMENSION], standard_arm, strict=True)
    )
    max_step_delta = max(
        abs(current - previous)
        for previous_target, current_target in zip(trajectory, trajectory[1:])
        for previous, current in zip(previous_target, current_target, strict=True)
    )
    return {
        "result": "g1_vla_action_plan_static_bounds_ok" if not violations else "g1_vla_action_plan_rejected",
        "protocol": PROTOCOL,
        "execution_mode": "zero-write",
        "physical_execution_authorized": False,
        "reason": (
            "hard mechanical and normalized-hand bounds hold; physical execution remains unavailable pending a frozen dynamic safety contract"
            if not violations
            else "action plan violates a hard actuator contract"
        ),
        "violations": violations,
        "inputs": {
            "action_horizon": len(trajectory),
            "action_dimension": ACTION_DIMENSION,
            "arm_joint_order": list(joint_order),
            "action_minimum": min(flattened),
            "action_maximum": max(flattened),
            "maximum_target_delta_from_live": max_live_delta,
            "maximum_arm_target_delta_from_standard_start": max_standard_arm_delta,
            "maximum_per_target_delta": max_step_delta,
            "training_sample_interval_seconds": sample_interval,
            "maximum_adjacent_arm_target_velocity": (
                max(
                    abs(current - previous) / sample_interval
                    for previous_target, current_target in zip(trajectory, trajectory[1:])
                    for previous, current in zip(
                        previous_target[:ARM_DIMENSION],
                        current_target[:ARM_DIMENSION],
                        strict=True,
                    )
                )
                if sample_interval is not None
                else None
            ),
            "urdf": str(urdf),
            "urdf_sha256": _sha256(urdf),
        },
        "unassessed_requirements": [
            *(
                ["trajectory timestep and velocity limit"]
                if sample_interval is None
                else ["controller command-rate, acceleration, and trajectory-tracking limits"]
            ),
            "workspace and collision clearance",
            "torque/contact feedback abort",
            "rt/arm_sdk controller watchdog and authority release",
        ],
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
        "robot_runtime_consumed_s": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--standard-start", type=Path, required=True)
    parser.add_argument("--urdf", type=Path, required=True)
    parser.add_argument("--expected-action-plan-sha256", required=True)
    parser.add_argument("--training-time-audit", type=Path, required=True)
    parser.add_argument("--expected-training-time-audit-sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        plan_path = args.action_plan.resolve()
        expected = args.expected_action_plan_sha256.lower()
        if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
            raise ValueError("expected action-plan SHA-256 must be 64 lowercase hexadecimal characters")
        actual = _sha256(plan_path)
        if actual != expected:
            raise ValueError("action-plan SHA-256 does not match its frozen value")
        audit_path = args.training_time_audit.resolve()
        expected_audit = args.expected_training_time_audit_sha256.lower()
        if len(expected_audit) != 64 or any(char not in "0123456789abcdef" for char in expected_audit):
            raise ValueError("expected training-time audit SHA-256 must be 64 lowercase hexadecimal characters")
        if _sha256(audit_path) != expected_audit:
            raise ValueError("training-time audit SHA-256 does not match its frozen value")
        plan = _read_object(plan_path, "action plan")
        observation_path = args.observation.resolve()
        observation = _read_object(observation_path, "observation")
        plan_observation = plan.get("observation")
        if (
            not isinstance(plan_observation, dict)
            or plan_observation.get("sha256") != _sha256(observation_path)
        ):
            raise ValueError("action plan is not bound to the supplied observation")
        result = validate(
            plan,
            observation,
            _read_object(args.standard_start.resolve(), "standard-start configuration"),
            args.urdf.resolve(),
            _read_object(audit_path, "training-time audit"),
        )
    except Exception as error:  # noqa: BLE001 - preserve a machine-readable rejection
        result = {
            "result": "g1_vla_action_plan_rejected",
            "protocol": PROTOCOL,
            "execution_mode": "zero-write",
            "physical_execution_authorized": False,
            "reason": str(error),
            "command_publishers_created": 0,
            "writes": 0,
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
        }
    print(json.dumps(result, sort_keys=True))
    return 0 if result["result"] == "g1_vla_action_plan_static_bounds_ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())

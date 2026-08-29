"""Assemble the only command stream a future G1 VLA executor may consume.

The model's 25 absolute targets cannot be sent directly to either the G1 arm
or the BrainCo hands: a fresh robot can have started somewhere else.  This
zero-write adapter anchors the arm plan and hand plan to the same live state,
then interpolates the complete 26-channel trajectory at a fixed cadence.

It deliberately has no transport dependency.  A hardware executor must still
re-read feedback before every publish and require a digest-bound MuJoCo
admission for this exact output.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

ACTION_DIMENSION = 26
ACTION_HORIZON = 25
ARM_DIMENSION = 14
HAND_DIMENSION = 12
CONTROL_PERIOD_S = 0.02
PROTOCOL = "shaka.g1-vla-live-trajectory.v1"
BRAINCO_PROJECTION_PROTOCOL = "shaka.g1-vla-brainco-action-projection.v1"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _vector(value: Any, size: int, description: str) -> list[float]:
    if not isinstance(value, list) or len(value) != size:
        raise ValueError(f"{description} must contain exactly {size} values")
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} contains a non-number") from error
    if not all(math.isfinite(item) for item in result):
        raise ValueError(f"{description} contains a non-finite value")
    return result


def _live_entry(observation: dict[str, Any]) -> tuple[list[float], list[float]]:
    state = observation.get("robot_state")
    brainco = observation.get("brainco")
    if not isinstance(state, dict) or not isinstance(brainco, dict):
        raise TypeError("live observation lacks G1 or BrainCo state")
    body = _vector(state.get("body"), 34, "live G1 body state")
    hands: list[float] = []
    for side in ("left", "right"):
        value = brainco.get(side)
        if not isinstance(value, dict):
            raise TypeError(f"live observation lacks BrainCo {side} hand state")
        hands.extend(_vector(value.get("positions"), 6, f"live BrainCo {side} hand state"))
    if any(value < 0.0 or value > 1.0 for value in hands):
        raise ValueError("live BrainCo hand state is outside normalized [0, 1]")
    return body[20:34], hands


def _model_targets(plan: dict[str, Any]) -> list[list[float]]:
    contract = plan.get("contract")
    projection = plan.get("projection")
    trajectory = plan.get("trajectory")
    if (
        plan.get("schema_version") != 1
        or plan.get("kind") != "unifolm_vla_action_plan_evidence"
        or plan.get("execution_mode") != "zero-write"
        or plan.get("command_publishers_created") != 0
        or plan.get("writes") != 0
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or contract.get("live_brainco_action_units") != "normalized_0_to_1"
        or not isinstance(projection, dict)
        or projection.get("protocol") != BRAINCO_PROJECTION_PROTOCOL
        or not isinstance(trajectory, list)
        or len(trajectory) != ACTION_HORIZON
    ):
        raise ValueError("input must be a zero-write plan with an explicit BrainCo projection")
    targets = [_vector(row, ACTION_DIMENSION, f"model target {index}") for index, row in enumerate(trajectory)]
    if any(value < 0.0 or value > 1.0 for row in targets for value in row[ARM_DIMENSION:]):
        raise ValueError("projected BrainCo target is outside normalized [0, 1]")
    return targets


def _append_segment(
    frames: list[tuple[list[float], list[float]]],
    arm_target: list[float],
    hand_target: list[float],
    arm_speed_limits_rad_s: list[float],
    hand_speed_normalized: float,
) -> None:
    before_arm, before_hand = frames[-1]
    ratios = [
        abs(target - current) / (limit * CONTROL_PERIOD_S)
        for target, current, limit in zip(arm_target, before_arm, arm_speed_limits_rad_s, strict=True)
    ]
    ratios.extend(
        abs(target - current) / (hand_speed_normalized * CONTROL_PERIOD_S)
        for target, current in zip(hand_target, before_hand, strict=True)
    )
    steps = max(1, math.ceil(max(ratios)))
    for step in range(1, steps + 1):
        if step == steps:
            frames.append((list(arm_target), list(hand_target)))
            continue
        alpha = step / steps
        frames.append((
            [current + (target - current) * alpha for current, target in zip(before_arm, arm_target, strict=True)],
            [current + (target - current) * alpha for current, target in zip(before_hand, hand_target, strict=True)],
        ))


def assemble(
    plan: dict[str, Any],
    observation: dict[str, Any],
    arm_joint_order: list[str],
    arm_speed_limits_rad_s: list[float],
    *,
    hand_speed_normalized: float,
) -> dict[str, Any]:
    if len(arm_joint_order) != ARM_DIMENSION or len(set(arm_joint_order)) != ARM_DIMENSION:
        raise ValueError("arm joint order must contain fourteen unique joints")
    if len(arm_speed_limits_rad_s) != ARM_DIMENSION or any(
        not math.isfinite(float(limit)) or float(limit) <= 0.0 for limit in arm_speed_limits_rad_s
    ):
        raise ValueError("arm speed limits must contain fourteen positive finite values")
    if not math.isfinite(hand_speed_normalized) or not 0.0 < hand_speed_normalized <= 1.0:
        raise ValueError("BrainCo command speed must be normalized in (0, 1]")
    targets = _model_targets(plan)
    entry_arm, entry_hand = _live_entry(observation)
    model_arm_anchor = targets[0][:ARM_DIMENSION]
    frames: list[tuple[list[float], list[float]]] = [(entry_arm, entry_hand)]
    for target in targets:
        # Preserve the model's relative arm motion while making its first arm frame live.
        arm_target = [
            entry + model - anchor
            for entry, model, anchor in zip(entry_arm, target[:ARM_DIMENSION], model_arm_anchor, strict=True)
        ]
        _append_segment(
            frames,
            arm_target,
            target[ARM_DIMENSION:],
            [float(limit) for limit in arm_speed_limits_rad_s],
            hand_speed_normalized,
        )
    return {
        "schema_version": 1,
        "kind": "g1_vla_live_trajectory",
        "protocol": PROTOCOL,
        "source_execution_mode": "zero-write",
        "physical_execution_authorized": False,
        "control_period_s": CONTROL_PERIOD_S,
        "arm_joint_order": list(arm_joint_order),
        "arm_speed_limits_rad_s": [float(limit) for limit in arm_speed_limits_rad_s],
        "hand_command_speed_normalized": hand_speed_normalized,
        "model_arm_anchor_absolute_rad": model_arm_anchor,
        "entry_arm_positions_rad": entry_arm,
        "entry_hand_positions_normalized": entry_hand,
        "frames": [
            {
                "arm_positions_rad": arm,
                "hand_positions_normalized": hands,
                "hand_command_speed_normalized": hand_speed_normalized,
            }
            for arm, hands in frames
        ],
        "replays_model_targets": ACTION_HORIZON,
        "requires_fresh_feedback_at_execution": True,
        "command_publishers_created": 0,
        "writes": 0,
    }


def _arm_velocity_limits(urdf: Path, joint_order: list[str]) -> list[float]:
    try:
        root = ElementTree.parse(urdf).getroot()
    except (OSError, ElementTree.ParseError) as error:
        raise ValueError(f"G1 URDF is unreadable: {error}") from error
    limits = {joint.get("name"): joint.find("limit") for joint in root.findall("joint")}
    values: list[float] = []
    for name in joint_order:
        limit = limits.get(name)
        try:
            value = float(limit.attrib["velocity"]) if limit is not None else math.nan
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"G1 URDF lacks a valid velocity limit for {name}") from error
        if not math.isfinite(value) or value <= 0.0:
            raise ValueError(f"G1 URDF lacks a valid velocity limit for {name}")
        values.append(value)
    return values


def _action_joint_order(action_definition: dict[str, Any]) -> list[str]:
    names = action_definition.get("joint_names")
    if not isinstance(names, list) or len(names) != ACTION_DIMENSION:
        raise ValueError("action definition lacks the fixed 26-channel joint order")
    result = [str(value) for value in names[:ARM_DIMENSION]]
    if any(not value for value in result) or len(set(result)) != ARM_DIMENSION:
        raise ValueError("action definition has an invalid arm joint order")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--live-observation", type=Path, required=True)
    parser.add_argument("--action-definition", type=Path, required=True)
    parser.add_argument("--urdf", type=Path, required=True)
    parser.add_argument("--hand-speed-normalized", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise FileExistsError("refusing to overwrite a live trajectory artifact")
        action_plan = args.action_plan.resolve()
        observation = args.live_observation.resolve()
        result = assemble(
            _read_object(action_plan, "action plan"),
            _read_object(observation, "live observation"),
            _action_joint_order(_read_object(args.action_definition.resolve(), "action definition")),
            _arm_velocity_limits(args.urdf.resolve(), _action_joint_order(_read_object(args.action_definition.resolve(), "action definition"))),
            hand_speed_normalized=args.hand_speed_normalized,
        )
        result["source_action_plan_sha256"] = _sha256(action_plan)
        result["live_observation_sha256"] = _sha256(observation)
        result["urdf_sha256"] = _sha256(args.urdf.resolve())
        temporary = args.output.with_name(f".{args.output.name}.tmp")
        temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, args.output)
        print(json.dumps({"result": "g1_vla_live_trajectory_assembled", "frame_count": len(result["frames"]), "output_sha256": _sha256(args.output), "writes": 0}, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - machine-readable zero-write rejection
        print(json.dumps({"result": "g1_vla_live_trajectory_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

"""Run the blueprint's headless MuJoCo gate for a G1 live command stream.

This is kinematic replay, deliberately not a hand-built button/table scene:
every frame of the exact 26-channel stream is placed in the supplied G1 model
and checked for joint limits and self-contact.  BrainCo Revo2 fingers are not
present in the G1 MJCF, so their normalized continuity is checked from the
same stream rather than pretended to be simulated by an unrelated hand model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from itertools import pairwise
from pathlib import Path
from typing import Any

PROTOCOL = "shaka.g1-vla-mujoco-preflight.v1"
TRAJECTORY_PROTOCOL = "shaka.g1-vla-live-trajectory.v1"
ARM_DIMENSION = 14
HAND_DIMENSION = 12


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


def _trajectory(value: dict[str, Any]) -> tuple[list[str], list[float], float, list[dict[str, Any]]]:
    if (
        value.get("schema_version") != 1
        or value.get("kind") != "g1_vla_live_trajectory"
        or value.get("protocol") != TRAJECTORY_PROTOCOL
        or value.get("source_execution_mode") != "zero-write"
        or value.get("physical_execution_authorized") is not False
        or value.get("requires_fresh_feedback_at_execution") is not True
        or value.get("command_publishers_created") != 0
        or value.get("writes") != 0
    ):
        raise ValueError("input does not prove an unarmed complete live trajectory")
    names_raw = value.get("arm_joint_order")
    if not isinstance(names_raw, list) or len(names_raw) != ARM_DIMENSION:
        raise ValueError("live trajectory lacks fourteen ordered arm joints")
    names = [str(name) for name in names_raw]
    if any(not name for name in names) or len(set(names)) != ARM_DIMENSION:
        raise ValueError("live trajectory arm joint order is invalid")
    speeds = _vector(value.get("arm_speed_limits_rad_s"), ARM_DIMENSION, "arm speed limits")
    if any(speed <= 0.0 for speed in speeds):
        raise ValueError("arm speed limits must be positive")
    try:
        period = float(value.get("control_period_s"))
        hand_speed = float(value.get("hand_command_speed_normalized"))
    except (TypeError, ValueError) as error:
        raise ValueError("live trajectory control timing is invalid") from error
    if not math.isfinite(period) or period <= 0.0:
        raise ValueError("live trajectory control period must be positive")
    if not math.isfinite(hand_speed) or not 0.0 < hand_speed <= 1.0:
        raise ValueError("live trajectory BrainCo command speed must be normalized in (0, 1]")
    frames = value.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError("live trajectory requires an entry frame and at least one command frame")
    entry_arm = _vector(value.get("entry_arm_positions_rad"), ARM_DIMENSION, "entry arm state")
    entry_hand = _vector(value.get("entry_hand_positions_normalized"), HAND_DIMENSION, "entry hand state")
    if any(position < 0.0 or position > 1.0 for position in entry_hand):
        raise ValueError("entry hand state is outside normalized [0, 1]")
    parsed: list[dict[str, Any]] = []
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise TypeError(f"trajectory frame {index} is not an object")
        arm = _vector(frame.get("arm_positions_rad"), ARM_DIMENSION, f"trajectory frame {index} arm")
        hands = _vector(frame.get("hand_positions_normalized"), HAND_DIMENSION, f"trajectory frame {index} hands")
        try:
            frame_speed = float(frame.get("hand_command_speed_normalized"))
        except (TypeError, ValueError) as error:
            raise ValueError(f"trajectory frame {index} hand speed is invalid") from error
        if any(position < 0.0 or position > 1.0 for position in hands):
            raise ValueError(f"trajectory frame {index} hand position is outside normalized [0, 1]")
        if frame_speed != hand_speed:
            raise ValueError(f"trajectory frame {index} hand speed differs from the stream contract")
        parsed.append({"arm": arm, "hands": hands})
    if parsed[0]["arm"] != entry_arm or parsed[0]["hands"] != entry_hand:
        raise ValueError("trajectory entry frame does not exactly equal the captured live state")
    for index, (previous, current) in enumerate(pairwise(parsed), start=1):
        for joint, before, after, speed in zip(names, previous["arm"], current["arm"], speeds, strict=True):
            if abs(after - before) > speed * period + 1e-9:
                raise ValueError(f"arm transition exceeds declared speed at frame {index}, joint {joint}")
        if any(abs(after - before) > hand_speed * period + 1e-9 for before, after in zip(previous["hands"], current["hands"], strict=True)):
            raise ValueError(f"hand transition exceeds declared command speed at frame {index}")
    return names, speeds, period, parsed


def _mujoco() -> Any:
    try:
        import mujoco
    except ImportError as error:
        raise RuntimeError("MuJoCo Python bindings are not installed") from error
    return mujoco


def simulate(value: dict[str, Any], model_path: Path) -> dict[str, Any]:
    """Kinematically replay a complete stream; this function never writes hardware."""
    names, _speeds, _period, frames = _trajectory(value)
    mujoco = _mujoco()
    try:
        model = mujoco.MjModel.from_xml_path(str(model_path))
    except Exception as error:
        raise ValueError(f"G1 MuJoCo model cannot be loaded: {error}") from error
    data = mujoco.MjData(model)
    ids: list[int] = []
    qpos_addresses: list[int] = []
    for name in names:
        identifier = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        if identifier < 0:
            raise ValueError(f"G1 MuJoCo model lacks arm joint {name}")
        # The deployed contract is fourteen one-DoF revolute arm joints.
        if int(model.jnt_type[identifier]) != int(mujoco.mjtJoint.mjJNT_HINGE):
            raise ValueError(f"G1 MuJoCo arm joint {name} is not a hinge")
        if not bool(model.jnt_limited[identifier]):
            raise ValueError(f"G1 MuJoCo arm joint {name} lacks a finite joint limit")
        ids.append(identifier)
        qpos_addresses.append(int(model.jnt_qposadr[identifier]))
    contact_frames: list[dict[str, Any]] = []
    for frame_index, frame in enumerate(frames):
        data.qpos[:] = model.qpos0
        for name, identifier, address, target in zip(names, ids, qpos_addresses, frame["arm"], strict=True):
            lower, upper = (float(value) for value in model.jnt_range[identifier])
            if target < lower or target > upper:
                raise ValueError(f"MuJoCo joint limit exceeded at frame {frame_index}, joint {name}")
            data.qpos[address] = target
        mujoco.mj_forward(model, data)
        if data.ncon:
            pairs: list[dict[str, str]] = []
            for contact_index in range(data.ncon):
                contact = data.contact[contact_index]
                pairs.append(
                    {
                        "geom1": mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, contact.geom1) or str(contact.geom1),
                        "geom2": mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, contact.geom2) or str(contact.geom2),
                    }
                )
            contact_frames.append({"frame": frame_index, "pairs": pairs})
    if contact_frames:
        raise ValueError(f"MuJoCo self-contact detected: {contact_frames[0]}")
    return {
        "schema_version": 1,
        "kind": "g1_vla_simulation_admission",
        "protocol": PROTOCOL,
        "result": "g1_vla_mujoco_preflight_admitted",
        "execution_mode": "headless-mujoco-kinematic-replay",
        "physical_execution_authorized": False,
        "reason": "the digest-bound live 26-channel trajectory passes model joint-limit, self-contact, and command-continuity checks; live feedback is still required before each physical command",
        "checks": {
            "frames_checked": len(frames),
            "joint_limits": "passed",
            "self_collision": "passed",
            "arm_workspace": "represented by the supplied G1 kinematic model over every arm frame",
            "brainco_revo2": "command continuity checked separately because the supplied G1 MJCF has no Revo2 finger model",
        },
        "mujoco_model_path": str(model_path),
        "mujoco_model_sha256": _sha256(model_path),
        "requires_fresh_feedback_at_execution": True,
        "command_publishers_created": 0,
        "writes": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-trajectory", type=Path, required=True)
    parser.add_argument("--expected-live-trajectory-sha256", required=True)
    parser.add_argument("--mujoco-model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        expected = args.expected_live_trajectory_sha256.lower()
        if len(expected) != 64 or any(character not in "0123456789abcdef" for character in expected):
            raise ValueError("expected live trajectory SHA-256 must be 64 lowercase hexadecimal characters")
        source = args.live_trajectory.resolve()
        if _sha256(source) != expected:
            raise ValueError("live trajectory SHA-256 does not match the frozen value")
        output = args.output.resolve()
        if output.exists():
            raise FileExistsError("refusing to overwrite a simulation admission artifact")
        result = simulate(_read_object(source, "live trajectory"), args.mujoco_model.resolve())
        result["live_trajectory_sha256"] = expected
        temporary = output.with_name(f".{output.name}.tmp")
        temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, output)
        print(json.dumps({"result": result["result"], "output_sha256": _sha256(output), "frames_checked": result["checks"]["frames_checked"], "writes": 0}, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - preserve machine-readable zero-write failure
        print(json.dumps({"result": "g1_vla_mujoco_preflight_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

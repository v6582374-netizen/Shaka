#!/usr/bin/env python3
"""Fail-closed reference guard for the G1 ``humanoid`` arm-SDK entry.

This module intentionally has no DDS, network, subprocess, or hardware
imports.  It is the small decision kernel that must run *inside* the unique
robot-side control entry, immediately before an ``rt/arm_sdk`` message can be
accepted.  A sidecar or an auxiliary-host process is not an equivalent safety
boundary: it cannot release authority after its own transport or process has
failed.

The command-line interface is an offline contract/test-vector checker only.
It never creates a publisher and always reports physical execution as
unavailable.  The only admissible deployment is an integration that calls
``RobotSideGuardian.admit`` from the active ``humanoid`` process and executes
the returned ``release_authority`` action on every denial or watchdog expiry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.g1-vla-robot-side-guardian.v1"
CONTRACT_KIND = "g1_vla_robot_side_protection_contract"
ARM_DIMENSION = 14
HAND_DIMENSION = 12
ACTION_DIMENSION = ARM_DIMENSION + HAND_DIMENSION
BODY_DIMENSION = 34
MOTOR_DIMENSION = 29
ARM_MOTOR_OFFSET = 15
HUMANOID_PROCESS = "humanoid"
ARM_SDK_TOPIC = "rt/arm_sdk"


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


def _finite(value: Any, description: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} must be a number") from error
    if not math.isfinite(result):
        raise ValueError(f"{description} must be finite")
    return result


def _vector(value: Any, size: int, description: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != size:
        raise ValueError(f"{description} must contain exactly {size} values")
    return tuple(_finite(item, f"{description}[{index}]") for index, item in enumerate(value))


def _positive_vector(value: Any, size: int, description: str) -> tuple[float, ...]:
    result = _vector(value, size, description)
    if any(item <= 0.0 for item in result):
        raise ValueError(f"{description} must contain only positive values")
    return result


def _limits(value: Any, size: int, description: str) -> tuple[tuple[float, float], ...]:
    if not isinstance(value, list) or len(value) != size:
        raise ValueError(f"{description} must contain exactly {size} lower/upper pairs")
    result: list[tuple[float, float]] = []
    for index, raw_pair in enumerate(value):
        pair = _vector(raw_pair, 2, f"{description}[{index}]")
        if pair[0] >= pair[1]:
            raise ValueError(f"{description}[{index}] has an invalid lower/upper pair")
        result.append((pair[0], pair[1]))
    return tuple(result)


def _positive_integer(value: Any, description: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{description} must be a positive integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} must be a positive integer") from error
    if result <= 0 or result != value:
        raise ValueError(f"{description} must be a positive integer")
    return result


def _required_object(value: Any, description: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be an object")
    return value


def _require_true(value: Any, description: str) -> None:
    if value is not True:
        raise ValueError(f"{description} must be true")


@dataclass(frozen=True)
class ProtectionContract:
    """All limits the robot-side entry must enforce, in live command units."""

    arm_joint_order: tuple[str, ...]
    arm_hard_limits_rad: tuple[tuple[float, float], ...]
    arm_workspace_limits_rad: tuple[tuple[float, float], ...]
    arm_target_delta_rad: tuple[float, ...]
    arm_velocity_rad_s: tuple[float, ...]
    arm_acceleration_rad_s2: tuple[float, ...]
    arm_tracking_error_rad: tuple[float, ...]
    arm_abs_torque_nm: tuple[float, ...]
    hand_position_limits: tuple[tuple[float, float], ...]
    hand_target_delta: tuple[float, ...]
    hand_velocity_s: tuple[float, ...]
    hand_tracking_error: tuple[float, ...]
    hand_abs_current: tuple[float, ...]
    command_period_ns: int
    command_lease_ns: int
    maximum_state_age_ns: int

    @classmethod
    def from_object(cls, value: dict[str, Any]) -> "ProtectionContract":
        if (
            value.get("schema_version") != 1
            or value.get("kind") != CONTRACT_KIND
            or value.get("protocol") != PROTOCOL
        ):
            raise ValueError("protection contract has an unsupported identity")
        control_entry = _required_object(value.get("control_entry"), "control_entry")
        if (
            control_entry.get("process_name") != HUMANOID_PROCESS
            or control_entry.get("arm_sdk_topic") != ARM_SDK_TOPIC
        ):
            raise ValueError("protection contract is not bound to the humanoid rt/arm_sdk entry")
        _require_true(control_entry.get("enforced_at_control_entry"), "control_entry.enforced_at_control_entry")
        _require_true(value.get("workspace_collision_clearance_enforced"), "workspace_collision_clearance_enforced")
        _require_true(value.get("contact_abort_enforced"), "contact_abort_enforced")
        arm = _required_object(value.get("arm"), "arm")
        hands = _required_object(value.get("hands"), "hands")
        timing = _required_object(value.get("timing"), "timing")
        names = arm.get("joint_order")
        if not isinstance(names, list) or len(names) != ARM_DIMENSION:
            raise ValueError("arm.joint_order must contain exactly 14 names")
        joint_order = tuple(str(name) for name in names)
        if any(not name for name in joint_order) or len(set(joint_order)) != ARM_DIMENSION:
            raise ValueError("arm.joint_order must contain unique non-empty names")
        hard_limits = _limits(arm.get("hard_limits_rad"), ARM_DIMENSION, "arm.hard_limits_rad")
        workspace_limits = _limits(
            arm.get("workspace_limits_rad"), ARM_DIMENSION, "arm.workspace_limits_rad"
        )
        for index, ((hard_lower, hard_upper), (workspace_lower, workspace_upper)) in enumerate(
            zip(hard_limits, workspace_limits, strict=True)
        ):
            if workspace_lower < hard_lower or workspace_upper > hard_upper:
                raise ValueError(
                    f"arm.workspace_limits_rad[{index}] must be inside its mechanical hard limit"
                )
        hand_limits = _limits(hands.get("position_limits"), HAND_DIMENSION, "hands.position_limits")
        if any(lower < 0.0 or upper > 1.0 for lower, upper in hand_limits):
            raise ValueError("hands.position_limits must be inside the live normalized [0, 1] contract")
        command_period_ns = _positive_integer(timing.get("command_period_ns"), "timing.command_period_ns")
        command_lease_ns = _positive_integer(timing.get("command_lease_ns"), "timing.command_lease_ns")
        maximum_state_age_ns = _positive_integer(
            timing.get("maximum_state_age_ns"), "timing.maximum_state_age_ns"
        )
        if command_lease_ns < command_period_ns:
            raise ValueError("timing.command_lease_ns must cover at least one command period")
        return cls(
            arm_joint_order=joint_order,
            arm_hard_limits_rad=hard_limits,
            arm_workspace_limits_rad=workspace_limits,
            arm_target_delta_rad=_positive_vector(
                arm.get("maximum_target_delta_rad"), ARM_DIMENSION, "arm.maximum_target_delta_rad"
            ),
            arm_velocity_rad_s=_positive_vector(
                arm.get("maximum_velocity_rad_s"), ARM_DIMENSION, "arm.maximum_velocity_rad_s"
            ),
            arm_acceleration_rad_s2=_positive_vector(
                arm.get("maximum_acceleration_rad_s2"), ARM_DIMENSION, "arm.maximum_acceleration_rad_s2"
            ),
            arm_tracking_error_rad=_positive_vector(
                arm.get("maximum_tracking_error_rad"), ARM_DIMENSION, "arm.maximum_tracking_error_rad"
            ),
            arm_abs_torque_nm=_positive_vector(
                arm.get("maximum_abs_torque_nm"), ARM_DIMENSION, "arm.maximum_abs_torque_nm"
            ),
            hand_position_limits=hand_limits,
            hand_target_delta=_positive_vector(
                hands.get("maximum_target_delta"), HAND_DIMENSION, "hands.maximum_target_delta"
            ),
            hand_velocity_s=_positive_vector(
                hands.get("maximum_velocity_s"), HAND_DIMENSION, "hands.maximum_velocity_s"
            ),
            hand_tracking_error=_positive_vector(
                hands.get("maximum_tracking_error"), HAND_DIMENSION, "hands.maximum_tracking_error"
            ),
            hand_abs_current=_positive_vector(
                hands.get("maximum_abs_current"), HAND_DIMENSION, "hands.maximum_abs_current"
            ),
            command_period_ns=command_period_ns,
            command_lease_ns=command_lease_ns,
            maximum_state_age_ns=maximum_state_age_ns,
        )


@dataclass(frozen=True)
class LiveState:
    timestamp_ns: int
    arm_positions_rad: tuple[float, ...]
    arm_velocities_rad_s: tuple[float, ...]
    arm_torques_nm: tuple[float, ...]
    hand_positions: tuple[float, ...]
    hand_velocities_s: tuple[float, ...]
    hand_currents: tuple[float, ...]
    workspace_clear: bool
    contact_clear: bool
    control_entry_process: str
    control_entry_topic: str

    @classmethod
    def from_object(cls, value: dict[str, Any]) -> "LiveState":
        arm = _required_object(value.get("arm"), "state.arm")
        hands = _required_object(value.get("hands"), "state.hands")
        safety = _required_object(value.get("safety"), "state.safety")
        return cls(
            timestamp_ns=_positive_integer(value.get("timestamp_ns"), "state.timestamp_ns"),
            arm_positions_rad=_vector(arm.get("positions_rad"), ARM_DIMENSION, "state.arm.positions_rad"),
            arm_velocities_rad_s=_vector(
                arm.get("velocities_rad_s"), ARM_DIMENSION, "state.arm.velocities_rad_s"
            ),
            arm_torques_nm=_vector(arm.get("torques_nm"), ARM_DIMENSION, "state.arm.torques_nm"),
            hand_positions=_vector(hands.get("positions"), HAND_DIMENSION, "state.hands.positions"),
            hand_velocities_s=_vector(hands.get("velocities_s"), HAND_DIMENSION, "state.hands.velocities_s"),
            hand_currents=_vector(hands.get("currents"), HAND_DIMENSION, "state.hands.currents"),
            workspace_clear=safety.get("workspace_clear") is True,
            contact_clear=safety.get("contact_clear") is True,
            control_entry_process=str(safety.get("control_entry_process", "")),
            control_entry_topic=str(safety.get("control_entry_topic", "")),
        )


def live_state_from_connected_observation(
    observation: dict[str, Any], safety: dict[str, Any]
) -> LiveState:
    """Map the additive G1 telemetry envelope into one guardian feedback tick.

    The state envelope's first five ``body`` slots are IMU values.  Its arm
    pose used by the VLA starts at ``body[20]``, which corresponds to motor
    slots ``15..28`` in the native LowState arrays.  Workspace and contact
    safety are intentionally supplied separately: neither can be inferred
    from a raw joint-state packet.
    """
    robot_state = _required_object(observation.get("robot_state"), "observation.robot_state")
    brainco = _required_object(observation.get("brainco"), "observation.brainco")
    left = _required_object(brainco.get("left"), "observation.brainco.left")
    right = _required_object(brainco.get("right"), "observation.brainco.right")
    body = _vector(robot_state.get("body"), BODY_DIMENSION, "observation.robot_state.body")
    motor_velocities = _vector(
        robot_state.get("motor_velocities_rad_s"),
        MOTOR_DIMENSION,
        "observation.robot_state.motor_velocities_rad_s",
    )
    motor_torques = _vector(
        robot_state.get("motor_torques_nm"),
        MOTOR_DIMENSION,
        "observation.robot_state.motor_torques_nm",
    )
    return LiveState.from_object(
        {
            "timestamp_ns": robot_state.get("assembled_time_ns"),
            "arm": {
                "positions_rad": list(body[20 : 20 + ARM_DIMENSION]),
                "velocities_rad_s": list(
                    motor_velocities[ARM_MOTOR_OFFSET : ARM_MOTOR_OFFSET + ARM_DIMENSION]
                ),
                "torques_nm": list(
                    motor_torques[ARM_MOTOR_OFFSET : ARM_MOTOR_OFFSET + ARM_DIMENSION]
                ),
            },
            "hands": {
                "positions": list(
                    _vector(left.get("positions"), 6, "observation.brainco.left.positions")
                    + _vector(right.get("positions"), 6, "observation.brainco.right.positions")
                ),
                "velocities_s": list(
                    _vector(left.get("velocities"), 6, "observation.brainco.left.velocities")
                    + _vector(right.get("velocities"), 6, "observation.brainco.right.velocities")
                ),
                "currents": list(
                    _vector(left.get("currents"), 6, "observation.brainco.left.currents")
                    + _vector(right.get("currents"), 6, "observation.brainco.right.currents")
                ),
            },
            "safety": safety,
        }
    )


@dataclass(frozen=True)
class CandidateCommand:
    issued_at_ns: int
    expires_at_ns: int
    arm_positions_rad: tuple[float, ...]
    hand_positions: tuple[float, ...]

    @classmethod
    def from_object(cls, value: dict[str, Any]) -> "CandidateCommand":
        arm = _required_object(value.get("arm"), "candidate.arm")
        hands = _required_object(value.get("hands"), "candidate.hands")
        issued_at_ns = _positive_integer(value.get("issued_at_ns"), "candidate.issued_at_ns")
        expires_at_ns = _positive_integer(value.get("expires_at_ns"), "candidate.expires_at_ns")
        if expires_at_ns <= issued_at_ns:
            raise ValueError("candidate.expires_at_ns must be after candidate.issued_at_ns")
        return cls(
            issued_at_ns=issued_at_ns,
            expires_at_ns=expires_at_ns,
            arm_positions_rad=_vector(
                arm.get("positions_rad"), ARM_DIMENSION, "candidate.arm.positions_rad"
            ),
            hand_positions=_vector(hands.get("positions"), HAND_DIMENSION, "candidate.hands.positions"),
        )


@dataclass(frozen=True)
class GuardDecision:
    result: str
    reason: str | None
    release_authority: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "result": self.result,
            "reason": self.reason,
            "release_authority": self.release_authority,
            "protocol": PROTOCOL,
            "physical_execution_authorized": False,
            "command_publishers_created": 0,
            "writes": 0,
        }


class RobotSideGuardian:
    """Stateful decision kernel to embed at the unique robot-side entry."""

    def __init__(self, contract: ProtectionContract) -> None:
        self._contract = contract
        self._last_command: CandidateCommand | None = None
        self._older_command: CandidateCommand | None = None
        self._authority_active = False

    def _deny(self, reason: str) -> GuardDecision:
        self._authority_active = False
        self._last_command = None
        self._older_command = None
        return GuardDecision("g1_vla_guardian_abort_release", reason, True)

    def _state_violation(self, state: LiveState, now_ns: int) -> str | None:
        contract = self._contract
        if state.timestamp_ns > now_ns:
            return "state timestamp is in the future"
        if now_ns - state.timestamp_ns > contract.maximum_state_age_ns:
            return "state feedback is stale"
        if state.control_entry_process != HUMANOID_PROCESS or state.control_entry_topic != ARM_SDK_TOPIC:
            return "state is not bound to the humanoid rt/arm_sdk control entry"
        if not state.workspace_clear:
            return "workspace/collision clearance is not affirmatively true"
        if not state.contact_clear:
            return "contact abort condition is active or unavailable"
        for index, (velocity, limit) in enumerate(
            zip(state.arm_velocities_rad_s, contract.arm_velocity_rad_s, strict=True)
        ):
            if abs(velocity) > limit:
                return f"arm velocity limit exceeded at joint {index}"
        for index, (torque, limit) in enumerate(
            zip(state.arm_torques_nm, contract.arm_abs_torque_nm, strict=True)
        ):
            if abs(torque) > limit:
                return f"arm torque/contact limit exceeded at joint {index}"
        for index, (velocity, limit) in enumerate(
            zip(state.hand_velocities_s, contract.hand_velocity_s, strict=True)
        ):
            if abs(velocity) > limit:
                return f"hand velocity limit exceeded at channel {index}"
        for index, (current, limit) in enumerate(
            zip(state.hand_currents, contract.hand_abs_current, strict=True)
        ):
            if abs(current) > limit:
                return f"hand current/contact limit exceeded at channel {index}"
        if self._last_command is not None:
            for index, (actual, expected, limit) in enumerate(
                zip(
                    state.arm_positions_rad,
                    self._last_command.arm_positions_rad,
                    contract.arm_tracking_error_rad,
                    strict=True,
                )
            ):
                if abs(actual - expected) > limit:
                    return f"arm tracking error exceeded at joint {index}"
            for index, (actual, expected, limit) in enumerate(
                zip(
                    state.hand_positions,
                    self._last_command.hand_positions,
                    contract.hand_tracking_error,
                    strict=True,
                )
            ):
                if abs(actual - expected) > limit:
                    return f"hand tracking error exceeded at channel {index}"
        return None

    def admit(self, state: LiveState, candidate: CandidateCommand, now_ns: int) -> GuardDecision:
        """Permit one bounded tick or request authority release, never a write."""
        if now_ns <= 0:
            return self._deny("guardian clock is invalid")
        violation = self._state_violation(state, now_ns)
        if violation is not None:
            return self._deny(violation)
        contract = self._contract
        if candidate.issued_at_ns > now_ns:
            return self._deny("candidate issue time is in the future")
        if candidate.expires_at_ns < now_ns:
            return self._deny("candidate command lease has expired")
        if candidate.expires_at_ns - candidate.issued_at_ns > contract.command_lease_ns:
            return self._deny("candidate command lease exceeds the immutable maximum")
        if self._last_command is not None and (
            candidate.issued_at_ns - self._last_command.issued_at_ns != contract.command_period_ns
        ):
            return self._deny("candidate cadence differs from the immutable command period")
        for index, (target, hard, workspace, actual, delta) in enumerate(
            zip(
                candidate.arm_positions_rad,
                contract.arm_hard_limits_rad,
                contract.arm_workspace_limits_rad,
                state.arm_positions_rad,
                contract.arm_target_delta_rad,
                strict=True,
            )
        ):
            if target < hard[0] or target > hard[1]:
                return self._deny(f"arm mechanical hard limit exceeded at joint {index}")
            if target < workspace[0] or target > workspace[1]:
                return self._deny(f"arm workspace/collision envelope exceeded at joint {index}")
            if abs(target - actual) > delta:
                return self._deny(f"arm current-state-relative target limit exceeded at joint {index}")
        for index, (target, limits, actual, delta) in enumerate(
            zip(
                candidate.hand_positions,
                contract.hand_position_limits,
                state.hand_positions,
                contract.hand_target_delta,
                strict=True,
            )
        ):
            if target < limits[0] or target > limits[1]:
                return self._deny(f"hand position limit exceeded at channel {index}")
            if abs(target - actual) > delta:
                return self._deny(f"hand current-state-relative target limit exceeded at channel {index}")
        previous_arm = (
            state.arm_positions_rad if self._last_command is None else self._last_command.arm_positions_rad
        )
        previous_hand = state.hand_positions if self._last_command is None else self._last_command.hand_positions
        interval_s = contract.command_period_ns / 1_000_000_000
        arm_velocity = tuple((target - previous) / interval_s for target, previous in zip(candidate.arm_positions_rad, previous_arm, strict=True))
        hand_velocity = tuple((target - previous) / interval_s for target, previous in zip(candidate.hand_positions, previous_hand, strict=True))
        for index, (velocity, limit) in enumerate(zip(arm_velocity, contract.arm_velocity_rad_s, strict=True)):
            if abs(velocity) > limit:
                return self._deny(f"arm candidate velocity limit exceeded at joint {index}")
        for index, (velocity, limit) in enumerate(zip(hand_velocity, contract.hand_velocity_s, strict=True)):
            if abs(velocity) > limit:
                return self._deny(f"hand candidate velocity limit exceeded at channel {index}")
        if self._last_command is not None:
            older_arm = (
                state.arm_positions_rad
                if self._older_command is None
                else self._older_command.arm_positions_rad
            )
            older_hand = state.hand_positions if self._older_command is None else self._older_command.hand_positions
            for index, (target, previous, older, limit) in enumerate(
                zip(
                    candidate.arm_positions_rad,
                    previous_arm,
                    older_arm,
                    contract.arm_acceleration_rad_s2,
                    strict=True,
                )
            ):
                acceleration = abs(target - 2.0 * previous + older) / (interval_s * interval_s)
                if acceleration > limit:
                    return self._deny(f"arm candidate acceleration limit exceeded at joint {index}")
            for index, (target, previous, older, limit) in enumerate(
                zip(
                    candidate.hand_positions,
                    previous_hand,
                    older_hand,
                    contract.hand_velocity_s,
                    strict=True,
                )
            ):
                acceleration = abs(target - 2.0 * previous + older) / (interval_s * interval_s)
                if acceleration > limit / interval_s:
                    return self._deny(f"hand candidate acceleration limit exceeded at channel {index}")
        self._older_command = self._last_command
        self._last_command = candidate
        self._authority_active = True
        return GuardDecision("g1_vla_guardian_tick_permitted", None, False)

    def watchdog(self, now_ns: int) -> GuardDecision:
        """Fail closed when no fresh command remains under its lease."""
        if now_ns <= 0:
            return self._deny("guardian clock is invalid")
        if not self._authority_active or self._last_command is None:
            return GuardDecision("g1_vla_guardian_idle", None, False)
        if now_ns > self._last_command.expires_at_ns:
            return self._deny("command watchdog lease expired")
        return GuardDecision("g1_vla_guardian_watchdog_ok", None, False)


def load_contract(path: Path, expected_sha256: str) -> ProtectionContract:
    actual_sha256 = _sha256(path)
    if actual_sha256 != expected_sha256:
        raise ValueError("protection contract digest does not match the deployment-pinned digest")
    return ProtectionContract.from_object(_read_object(path, "protection contract"))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check a G1 robot-side guardian test vector without hardware")
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--contract-sha256", required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--now-ns", type=int, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        guardian = RobotSideGuardian(load_contract(args.contract, args.contract_sha256))
        state = LiveState.from_object(_read_object(args.state, "state test vector"))
        candidate = CandidateCommand.from_object(_read_object(args.candidate, "candidate test vector"))
        result = guardian.admit(state, candidate, args.now_ns).as_dict()
    except ValueError as error:
        result = GuardDecision("g1_vla_guardian_contract_rejected", str(error), True).as_dict()
    json.dump(result, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")
    return 0 if result["result"] == "g1_vla_guardian_tick_permitted" else 2


if __name__ == "__main__":  # pragma: no cover - command-line entry point
    raise SystemExit(main())

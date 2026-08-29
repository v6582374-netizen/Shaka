"""Capture one paired, read-only G1 + BrainCo entry state from DDS.

The snapshot is the execution-time boundary for VLA trajectories.  It includes
positions, velocities and currents for both BrainCo hands, rather than letting
an executor infer the hand's starting pose from a stale standard-start file.
No command topic is imported or created.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from pathlib import Path
from typing import Any

STATE_ENVELOPE_TOPIC = "rt/vegapunk/g1/state_envelope"
LEFT_HAND_STATE_TOPIC = "rt/brainco/left/state"
RIGHT_HAND_STATE_TOPIC = "rt/brainco/right/state"
PROTOCOL = "shaka.g1-live-entry-capture.v1"


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


def _hand(value: Any, side: str) -> dict[str, list[float]]:
    if not isinstance(value, dict):
        raise TypeError(f"{side} BrainCo feedback is not an object")
    positions = _vector(value.get("positions"), 6, f"{side} BrainCo positions")
    if any(position < 0.0 or position > 1.0 for position in positions):
        raise ValueError(f"{side} BrainCo positions are outside normalized [0, 1]")
    return {
        "positions": positions,
        "velocities": _vector(value.get("velocities"), 6, f"{side} BrainCo velocities"),
        "currents": _vector(value.get("currents"), 6, f"{side} BrainCo currents"),
    }


def build_snapshot(
    state: Any,
    left: Any,
    right: Any,
    *,
    state_received_ns: int,
    left_received_ns: int,
    right_received_ns: int,
) -> dict[str, Any]:
    if not isinstance(state, dict):
        raise TypeError("G1 state envelope is not an object")
    assembled = state.get("assembled_time_ns")
    if isinstance(assembled, bool) or not isinstance(assembled, int) or assembled <= 0:
        raise ValueError("G1 state envelope has an invalid assembled_time_ns")
    _vector(state.get("body"), 34, "G1 body state")
    received = [state_received_ns, left_received_ns, right_received_ns]
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in received):
        raise ValueError("feedback receive timestamps must be positive integers")
    return {
        "schema_version": 1,
        "kind": "g1_live_entry_snapshot",
        "protocol": PROTOCOL,
        "source": "connected-g1-read-only-dds",
        "captured_at_ns": assembled,
        "captured_local_time_ns": max(received),
        "feedback_pair_skew_ns": max(received) - min(received),
        "feedback_received_ns": {
            "g1_state": state_received_ns,
            "left_hand": left_received_ns,
            "right_hand": right_received_ns,
        },
        "robot_state": state,
        "brainco": {"left": _hand(left, "left"), "right": _hand(right, "right")},
        "physical_execution_authorized": False,
        "command_publishers_created": 0,
        "writes": 0,
    }


def _extract_hand(sample: Any) -> dict[str, list[float]]:
    states = tuple(sample.states)
    if len(states) != 6:
        raise ValueError(f"BrainCo state must contain six motors, got {len(states)}")
    return {
        "positions": [float(state.q) for state in states],
        "velocities": [float(state.dq) for state in states],
        "currents": [float(state.tau_est) for state in states],
    }


def _discover_type(participant: Any, topic_name: str, timeout_s: float) -> Any:
    from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsPublication
    from cyclonedds.core import InstanceState, ReadCondition
    from cyclonedds.dynamic import get_types_for_typeid
    from cyclonedds.util import duration

    reader = BuiltinDataReader(participant, BuiltinTopicDcpsPublication)
    condition = ReadCondition(reader, InstanceState.Alive)
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for publication in reader.take_iter(condition=condition, timeout=duration(milliseconds=50)):
            if publication.topic_name == topic_name and publication.type_id is not None:
                return get_types_for_typeid(participant, publication.type_id, duration(seconds=2))[0]
    raise RuntimeError(f"required DDS publication is absent: {topic_name}")


def capture(network_interface: str, timeout_s: float, maximum_pair_skew_ns: int) -> dict[str, Any]:
    if timeout_s <= 0.0 or maximum_pair_skew_ns <= 0:
        raise ValueError("capture timeout and maximum feedback skew must be positive")
    from cyclonedds.domain import DomainParticipant
    from cyclonedds.sub import DataReader, Subscriber
    from cyclonedds.topic import Topic
    from cyclonedds.util import duration
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize

    ChannelFactoryInitialize(0, network_interface)
    participant = DomainParticipant(0)
    subscriber = Subscriber(participant)
    topics = (STATE_ENVELOPE_TOPIC, LEFT_HAND_STATE_TOPIC, RIGHT_HAND_STATE_TOPIC)
    readers = {
        topic: DataReader(subscriber, Topic(participant, topic, _discover_type(participant, topic, timeout_s)))
        for topic in topics
    }
    samples: dict[str, tuple[int, Any]] = {}
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for topic, reader in readers.items():
            for sample in reader.take_iter(timeout=duration(milliseconds=10)):
                samples[topic] = (time.time_ns(), sample)
                break
        if set(samples) != set(topics):
            continue
        received = [samples[topic][0] for topic in topics]
        if max(received) - min(received) > maximum_pair_skew_ns:
            continue
        state_sample = samples[STATE_ENVELOPE_TOPIC][1]
        try:
            state = json.loads(str(state_sample.data))
        except (AttributeError, TypeError, json.JSONDecodeError) as error:
            raise ValueError("G1 state-envelope payload is invalid JSON") from error
        return build_snapshot(
            state,
            _extract_hand(samples[LEFT_HAND_STATE_TOPIC][1]),
            _extract_hand(samples[RIGHT_HAND_STATE_TOPIC][1]),
            state_received_ns=samples[STATE_ENVELOPE_TOPIC][0],
            left_received_ns=samples[LEFT_HAND_STATE_TOPIC][0],
            right_received_ns=samples[RIGHT_HAND_STATE_TOPIC][0],
        )
    raise RuntimeError("no time-paired G1 and dual-BrainCo feedback samples arrived before timeout")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network-interface", default="enp0s31f6")
    parser.add_argument("--timeout-s", type=float, default=5.0)
    parser.add_argument("--maximum-pair-skew-ms", type=float, default=50.0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise FileExistsError("refusing to overwrite a live-entry snapshot")
        maximum_pair_skew_ns = round(args.maximum_pair_skew_ms * 1_000_000)
        result = capture(args.network_interface, args.timeout_s, maximum_pair_skew_ns)
        temporary = args.output.with_name(f".{args.output.name}.tmp")
        temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, args.output)
        print(json.dumps({"result": "g1_live_entry_snapshot_captured", "feedback_pair_skew_ns": result["feedback_pair_skew_ns"], "writes": 0}, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"result": "g1_live_entry_snapshot_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

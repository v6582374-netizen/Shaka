#!/usr/bin/env python3
"""Read-only connected-G1 adapters for one zero-write invocation."""
# mypy: disable-error-code=import-not-found

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from _offline_invocation_adapter import (
    _audit,
    _base,
    candidate,
    evaluation,
    release,
    reset,
)
from record_evaluator_episode import (
    CAMERAS,
    LEFT_HAND_STATE_TOPIC,
    RIGHT_HAND_STATE_TOPIC,
    STATE_ENVELOPE_TOPIC,
    _decode_camera_message,
    _discover_type,
    _extract_hand_values,
)


def _command_publishers(
    participant: Any, topics: tuple[str, ...]
) -> list[tuple[str, str]]:
    from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsPublication
    from cyclonedds.core import InstanceState, ReadCondition
    from cyclonedds.util import duration

    reader = BuiltinDataReader(participant, BuiltinTopicDcpsPublication)
    condition = ReadCondition(reader, InstanceState.Alive)
    return sorted(
        {
            (str(publication.topic_name), str(publication.participant_key))
            for publication in reader.take_iter(
                condition=condition, timeout=duration(milliseconds=250)
            )
            if getattr(publication, "topic_name", None) in topics
        }
    )


def _allowed_command_publishers(values: list[str]) -> set[tuple[str, str]]:
    allowed: set[tuple[str, str]] = set()
    for value in values:
        topic, separator, participant_key = value.rpartition(":")
        if not separator or not topic or not participant_key:
            raise ValueError("allowed command publisher must be '<topic>:<UUID>'")
        allowed.add((topic, participant_key))
    return allowed


def _check_dds_sources(participant: Any, timeout_s: float) -> None:
    from cyclonedds.sub import DataReader, Subscriber
    from cyclonedds.topic import Topic
    from cyclonedds.util import duration

    subscriber = Subscriber(participant)
    for topic_name in (
        STATE_ENVELOPE_TOPIC,
        LEFT_HAND_STATE_TOPIC,
        RIGHT_HAND_STATE_TOPIC,
    ):
        datatype = _discover_type(participant, topic_name, timeout_s)
        reader = DataReader(subscriber, Topic(participant, topic_name, datatype))
        sample = next(
            reader.take_iter(timeout=duration(milliseconds=round(timeout_s * 1000))),
            None,
        )
        if sample is None:
            raise RuntimeError(f"required DDS sample is absent: {topic_name}")
        if topic_name == STATE_ENVELOPE_TOPIC:
            payload = json.loads(str(sample.data))
            if (
                not isinstance(payload.get("sequence"), int)
                or not isinstance(payload.get("assembled_time_ns"), int)
            ):
                raise RuntimeError("G1 state envelope is invalid")
        else:
            _extract_hand_values(sample)


def _check_camera_sources(camera_host: str, timeout_s: float) -> None:
    import zmq

    context = zmq.Context()
    sockets: dict[Any, Any] = {}
    poller = zmq.Poller()
    try:
        for spec in CAMERAS:
            socket = context.socket(zmq.SUB)
            socket.setsockopt(zmq.SUBSCRIBE, b"")
            socket.setsockopt(zmq.RCVHWM, 1)
            socket.connect(f"tcp://{camera_host}:{spec.port}")
            poller.register(socket, zmq.POLLIN)
            sockets[socket] = spec
        observed: set[str] = set()
        deadline = time.monotonic() + timeout_s
        while len(observed) != len(CAMERAS) and time.monotonic() < deadline:
            for socket, _ in poller.poll(50):
                frame = _decode_camera_message(socket.recv())
                spec = sockets[socket]
                if frame.camera_id != spec.camera_id:
                    raise RuntimeError(f"camera identity mismatch on port {spec.port}")
                if (frame.width, frame.height) != (spec.width, spec.height):
                    raise RuntimeError(f"camera dimensions changed for {spec.camera_id}")
                observed.add(frame.camera_id)
        if len(observed) != len(CAMERAS):
            raise RuntimeError("required physical camera source is absent")
    finally:
        for socket in sockets:
            socket.close(linger=0)
        context.term()


def readiness(args: argparse.Namespace) -> dict[str, Any]:
    if args.execution_mode != "zero-write":
        raise ValueError("connected-G1 readiness only accepts zero-write mode")
    if not (args.claim_directory.resolve() / "run-id.txt").is_file():
        raise RuntimeError("invocation authority claim is absent")
    if not args.command_topic:
        raise ValueError("connected-G1 readiness requires protected command topics")

    from cyclonedds.domain import DomainParticipant
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize

    ChannelFactoryInitialize(0, args.network_interface)
    participant = DomainParticipant(0)
    _check_dds_sources(participant, args.discovery_timeout_s)
    publishers = _command_publishers(participant, tuple(args.command_topic))
    allowed_publishers = _allowed_command_publishers(args.allowed_command_publisher)
    competing_publishers = sorted(set(publishers) - allowed_publishers)
    if competing_publishers:
        raise RuntimeError(
            "competing command publishers detected: "
            + ", ".join(
                f"{topic} ({participant_key})"
                for topic, participant_key in competing_publishers
            )
        )
    _check_camera_sources(args.camera_host, args.discovery_timeout_s)
    return _base(
        ready=True,
        environment="connected-g1",
        execution_mode="zero-write",
        control_authority=(
            "verified_unique_control_entry"
            if publishers
            else "observed_no_command_publishers"
        ),
        competing_command_publishers=0,
        observed_command_publishers=[
            {"topic": topic, "participant_key": participant_key}
            for topic, participant_key in publishers
        ],
        g1_state_source=STATE_ENVELOPE_TOPIC,
        brainco_state_sources=[LEFT_HAND_STATE_TOPIC, RIGHT_HAND_STATE_TOPIC],
        physical_camera_sources=3,
        logical_camera_views=4,
        command_topics=list(args.command_topic),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="adapter", required=True)

    readiness_parser = subparsers.add_parser("readiness")
    readiness_parser.add_argument("--claim-directory", type=Path, required=True)
    readiness_parser.add_argument("--execution-mode", required=True)
    readiness_parser.add_argument("--network-interface", required=True)
    readiness_parser.add_argument("--camera-host", required=True)
    readiness_parser.add_argument("--discovery-timeout-s", type=float, required=True)
    readiness_parser.add_argument("--command-topic", action="append", default=[])
    readiness_parser.add_argument(
        "--allowed-command-publisher", action="append", default=[]
    )

    candidate_parser = subparsers.add_parser("candidate")
    candidate_parser.add_argument("--runtime-package", type=Path, required=True)
    candidate_parser.add_argument("--observation", type=Path, required=True)
    candidate_parser.add_argument("--controller-trace", type=Path, required=True)
    candidate_parser.add_argument("--control-contract", type=Path, required=True)
    candidate_parser.add_argument("--timeout-s", type=float, required=True)

    release_parser = subparsers.add_parser("release")
    release_parser.add_argument("--controller-trace", type=Path)
    release_parser.add_argument("--controller-stdout", type=Path)

    evaluation_parser = subparsers.add_parser("evaluation")
    evaluation_parser.add_argument("--evidence-directory", type=Path, required=True)
    evaluation_parser.add_argument("--invocation-id", required=True)
    evaluation_parser.add_argument("--prepared-evidence-directory", type=Path, required=True)
    evaluation_parser.add_argument("--evaluator-config", type=Path, required=True)
    evaluation_parser.add_argument("--model-result-output", type=Path, required=True)

    reset_parser = subparsers.add_parser("reset")
    reset_parser.add_argument("--execution-mode", required=True)
    reset_parser.add_argument("--task-result", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    functions = {
        "readiness": readiness,
        "candidate": candidate,
        "release": release,
        "evaluation": evaluation,
        "reset": reset,
    }
    try:
        result = functions[args.adapter](args)
    except Exception as error:  # noqa: BLE001 - this is the structured boundary
        _audit(args.adapter, "failed")
        print(json.dumps(_base(result="failed", reason=str(error)), sort_keys=True))
        return 2
    if args.adapter == "candidate" and result.get("deployment_status") == "rejected":
        _audit(args.adapter, "failed", result)
        print(json.dumps(result, sort_keys=True))
        return 2
    _audit(args.adapter, "completed", result)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

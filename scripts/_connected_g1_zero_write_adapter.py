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
    candidate as offline_candidate,
    evaluation,
    release,
    reset,
)
from run_unifolm_vla_invocation_candidate import (
    RUNTIME_KIND as UNIFOLM_VLA_RUNTIME_KIND,
    preflight_runtime as preflight_unifolm_vla_runtime,
    run_candidate as run_unifolm_vla_candidate,
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

NATIVE_MOTION_CONTROLLER_TOPICS = frozenset(
    {"rt/lowcmd", "rt/sportmodestate", "rt/arm_sdk"}
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


def _native_motion_controller_participant(
    participant: Any, command_topics: tuple[str, ...], timeout_s: float
) -> str:
    """Verify the rotating native motion-controller identity by topology.

    Unitree creates a fresh DDS participant UUID after a controller restart, so
    a saved UUID is not an identity boundary. Its native control service has a
    stable signature: one participant publishes ``rt/lowcmd`` and
    ``rt/sportmodestate`` and owns the robot-side ``rt/arm_sdk`` subscription.
    This function rejects any additional protected command writer.
    """
    if command_topics != ("rt/lowcmd",):
        raise RuntimeError(
            "native motion-controller topology only supports rt/lowcmd"
        )
    from cyclonedds.builtin import (
        BuiltinDataReader,
        BuiltinTopicDcpsPublication,
        BuiltinTopicDcpsSubscription,
    )
    from cyclonedds.core import InstanceState, ReadCondition

    readers = (
        ("publication", BuiltinDataReader(participant, BuiltinTopicDcpsPublication)),
        ("subscription", BuiltinDataReader(participant, BuiltinTopicDcpsSubscription)),
    )
    conditions = {
        kind: ReadCondition(reader, InstanceState.Alive) for kind, reader in readers
    }
    endpoints: dict[tuple[str, str], tuple[str, str]] = {}
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for kind, reader in readers:
            for endpoint in reader.take(64, condition=conditions[kind]):
                topic_name = str(getattr(endpoint, "topic_name", ""))
                if topic_name not in NATIVE_MOTION_CONTROLLER_TOPICS:
                    continue
                endpoints[(kind, str(endpoint.key))] = (
                    topic_name,
                    str(endpoint.participant_key),
                )
        time.sleep(0.005)

    def participants(kind: str, topic_name: str) -> set[str]:
        return {
            participant_key
            for endpoint_kind, (endpoint_topic, participant_key) in endpoints.items()
            if endpoint_kind[0] == kind and endpoint_topic == topic_name
        }

    lowcmd_publishers = participants("publication", "rt/lowcmd")
    sport_publishers = participants("publication", "rt/sportmodestate")
    arm_sdk_subscribers = participants("subscription", "rt/arm_sdk")
    if len(lowcmd_publishers) != 1:
        raise RuntimeError(
            "expected exactly one alive rt/lowcmd publisher, found "
            f"{len(lowcmd_publishers)}"
        )
    if len(sport_publishers) != 1:
        raise RuntimeError(
            "expected exactly one alive rt/sportmodestate publisher, found "
            f"{len(sport_publishers)}"
        )
    if len(arm_sdk_subscribers) != 1:
        raise RuntimeError(
            "expected exactly one robot-side rt/arm_sdk subscriber, found "
            f"{len(arm_sdk_subscribers)}"
        )
    native_participant = next(iter(lowcmd_publishers))
    if (
        native_participant not in sport_publishers
        or native_participant not in arm_sdk_subscribers
    ):
        raise RuntimeError(
            "rt/lowcmd, rt/sportmodestate, and rt/arm_sdk subscriber do not "
            "belong to the same native motion-controller participant"
        )
    return native_participant


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
    allowed_publishers = _allowed_command_publishers(args.allowed_command_publisher)
    native_motion_controller_participant: str | None = None
    if args.native_motion_controller_topology:
        if allowed_publishers:
            raise RuntimeError(
                "native motion-controller topology cannot combine with a static "
                "command publisher UUID"
            )
        native_motion_controller_participant = _native_motion_controller_participant(
            participant, tuple(args.command_topic), args.discovery_timeout_s
        )
        publishers = [("rt/lowcmd", native_motion_controller_participant)]
        allowed_publishers = set(publishers)
    else:
        publishers = _command_publishers(participant, tuple(args.command_topic))
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
            "verified_native_motion_controller"
            if native_motion_controller_participant is not None
            else (
                "verified_unique_control_entry"
                if publishers
                else "observed_no_command_publishers"
            )
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
        native_motion_controller_participant=native_motion_controller_participant,
    )


def candidate(args: argparse.Namespace) -> dict[str, Any]:
    """Dispatch only the fixed VLA zero-write runtime outside the sandbox.

    All other candidates retain the generic bubblewrap replay boundary.  The
    VLA path needs the pre-existing CUDA runtime and is still inference-only.
    """
    package = json.loads(args.runtime_package.read_text(encoding="utf-8"))
    runtime = package.get("runtime")
    if isinstance(runtime, dict) and runtime.get("kind") == UNIFOLM_VLA_RUNTIME_KIND:
        if (
            args.raw_action_plan_output is None
            or args.action_plan_output is None
            or args.static_admission_output is None
        ):
            raise ValueError("UniFoLM-VLA candidate requires all plan evidence outputs")
        return run_unifolm_vla_candidate(
            args.runtime_package,
            args.observation,
            args.raw_action_plan_output,
            args.action_plan_output,
            args.static_admission_output,
            args.controller_trace,
            args.timeout_s,
        )
    return offline_candidate(args)


def runtime_preflight(args: argparse.Namespace) -> dict[str, Any]:
    """Verify the candidate runtime before beginning a live capture."""
    package = json.loads(args.runtime_package.read_text(encoding="utf-8"))
    runtime = package.get("runtime")
    if isinstance(runtime, dict) and runtime.get("kind") == UNIFOLM_VLA_RUNTIME_KIND:
        return preflight_unifolm_vla_runtime(args.runtime_package, args.timeout_s)
    return _base(
        result="candidate_runtime_ready",
        ready=True,
        runtime_kind=runtime.get("kind") if isinstance(runtime, dict) else "generic",
        physical_rollout_attempts_consumed=0,
        robot_runtime_consumed_s=0,
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
    readiness_parser.add_argument(
        "--native-motion-controller-topology", action="store_true"
    )

    candidate_parser = subparsers.add_parser("candidate")
    candidate_parser.add_argument("--runtime-package", type=Path, required=True)
    candidate_parser.add_argument("--observation", type=Path, required=True)
    candidate_parser.add_argument("--controller-trace", type=Path, required=True)
    candidate_parser.add_argument("--raw-action-plan-output", type=Path)
    candidate_parser.add_argument("--action-plan-output", type=Path)
    candidate_parser.add_argument("--static-admission-output", type=Path)
    candidate_parser.add_argument("--control-contract", type=Path, required=True)
    candidate_parser.add_argument("--timeout-s", type=float, required=True)

    runtime_preflight_parser = subparsers.add_parser("runtime-preflight")
    runtime_preflight_parser.add_argument("--runtime-package", type=Path, required=True)
    runtime_preflight_parser.add_argument("--timeout-s", type=float, required=True)

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
        "runtime-preflight": runtime_preflight,
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

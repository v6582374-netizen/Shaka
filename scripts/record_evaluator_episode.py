#!/usr/bin/env python3
"""Record one read-only G1 evaluator-evidence episode.

The recorder creates DDS readers and ZeroMQ subscribers only. It contains no
robot command topic, policy invocation, Redis write, or actuator publisher.
Camera JPEG payloads are stored byte-for-byte as received so the evidence does
not depend on a video re-encode.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import queue
import re
import signal
import statistics
import struct
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CAMERA_FRAME_MAGIC = b"ACF1"
CAMERA_FRAME_VERSION = 3
CAMERA_FRAME_PREFIX = struct.Struct("!4sBH")
MAX_CAMERA_HEADER_BYTES = 4096
STATE_ENVELOPE_TOPIC = "rt/vegapunk/g1/state_envelope"
LEFT_HAND_STATE_TOPIC = "rt/brainco/left/state"
RIGHT_HAND_STATE_TOPIC = "rt/brainco/right/state"
EPISODE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


@dataclass(frozen=True)
class CameraSpec:
    camera_id: str
    port: int
    width: int
    height: int


CAMERAS = (
    CameraSpec("head_camera", 11224, 1280, 480),
    CameraSpec("left_wrist_camera", 55558, 640, 480),
    CameraSpec("right_wrist_camera", 55559, 640, 480),
)


@dataclass(frozen=True)
class CameraFrame:
    camera_id: str
    sequence: int
    frame_time_ns: int
    time_origin: str
    clock_id: str
    source_capture_time_ns: int | None
    source_clock_id: str | None
    read_started_time_ns: int
    read_completed_time_ns: int
    width: int
    height: int
    payload: bytes
    payload_sha256: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode-id", required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--camera-host", default="192.168.123.164")
    parser.add_argument("--network-interface", default="enp0s31f6")
    parser.add_argument("--duration-s", type=float, default=5.0)
    parser.add_argument("--post-roll-s", type=float, default=1.0)
    parser.add_argument(
        "--lifecycle-handshake",
        action="store_true",
        help="publish ready/stop lifecycle events and treat SIGTERM as a graceful stop",
    )
    parser.add_argument("--discovery-timeout-s", type=float, default=8.0)
    parser.add_argument("--minimum-camera-frames", type=int, default=30)
    parser.add_argument("--minimum-state-samples", type=int, default=30)
    return parser.parse_args()


def _validate_episode_id(value: str) -> str:
    if EPISODE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError(
            "episode id must be 1-128 characters using letters, digits, '.', '_' or '-'"
        )
    return value


def _decode_camera_message(message: bytes) -> CameraFrame:
    if len(message) < CAMERA_FRAME_PREFIX.size:
        raise ValueError("camera frame is shorter than its prefix")
    magic, version, header_length = CAMERA_FRAME_PREFIX.unpack_from(message)
    if magic != CAMERA_FRAME_MAGIC or version != CAMERA_FRAME_VERSION:
        raise ValueError("camera frame protocol does not match ACF v3")
    if not 2 <= header_length <= MAX_CAMERA_HEADER_BYTES:
        raise ValueError("camera frame header length is invalid")
    payload_offset = CAMERA_FRAME_PREFIX.size + header_length
    if payload_offset >= len(message):
        raise ValueError("camera frame has no JPEG payload")
    try:
        metadata = json.loads(
            message[CAMERA_FRAME_PREFIX.size : payload_offset].decode("utf-8")
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("camera frame metadata is not valid JSON") from error
    if not isinstance(metadata, dict):
        raise TypeError("camera frame metadata must be an object")
    required = {
        "camera_id",
        "sequence",
        "frame_time_ns",
        "time_origin",
        "clock_id",
        "source_capture_time_ns",
        "source_clock_id",
        "read_started_time_ns",
        "read_completed_time_ns",
        "width",
        "height",
        "encoding",
        "payload_length",
        "payload_sha256",
    }
    if not required.issubset(metadata):
        raise ValueError("camera frame metadata is incomplete")
    payload = bytes(message[payload_offset:])
    digest = hashlib.sha256(payload).hexdigest()
    if metadata["encoding"] != "jpeg":
        raise ValueError("camera frame encoding is not JPEG")
    if int(metadata["payload_length"]) != len(payload):
        raise ValueError("camera frame payload length does not match")
    if metadata["payload_sha256"] != digest:
        raise ValueError("camera frame payload digest does not match")
    return CameraFrame(
        camera_id=str(metadata["camera_id"]),
        sequence=int(metadata["sequence"]),
        frame_time_ns=int(metadata["frame_time_ns"]),
        time_origin=str(metadata["time_origin"]),
        clock_id=str(metadata["clock_id"]),
        source_capture_time_ns=(
            None
            if metadata["source_capture_time_ns"] is None
            else int(metadata["source_capture_time_ns"])
        ),
        source_clock_id=(
            None
            if metadata["source_clock_id"] is None
            else str(metadata["source_clock_id"])
        ),
        read_started_time_ns=int(metadata["read_started_time_ns"]),
        read_completed_time_ns=int(metadata["read_completed_time_ns"]),
        width=int(metadata["width"]),
        height=int(metadata["height"]),
        payload=payload,
        payload_sha256=digest,
    )


def _extract_hand_values(sample: Any) -> tuple[tuple[float, ...], ...]:
    states = tuple(sample.states)
    if len(states) != 6:
        raise ValueError(f"BrainCo state must contain six motors, got {len(states)}")
    positions = tuple(float(state.q) for state in states)
    velocities = tuple(float(state.dq) for state in states)
    currents = tuple(float(state.tau_est) for state in states)
    return positions, velocities, currents


def _discover_type(participant: Any, topic_name: str, timeout_s: float) -> Any:
    from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsPublication
    from cyclonedds.core import InstanceState, ReadCondition
    from cyclonedds.dynamic import get_types_for_typeid
    from cyclonedds.util import duration

    reader = BuiltinDataReader(participant, BuiltinTopicDcpsPublication)
    condition = ReadCondition(reader, InstanceState.Alive)
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        for publication in reader.take_iter(
            condition=condition, timeout=duration(milliseconds=50)
        ):
            if publication.topic_name == topic_name and publication.type_id is not None:
                return get_types_for_typeid(
                    participant, publication.type_id, duration(seconds=2)
                )[0]
    raise RuntimeError(f"required DDS publication is absent: {topic_name}")


def _reader_worker(
    reader: Any,
    topic_name: str,
    output: queue.SimpleQueue[tuple[str, int, Any]],
    stop: threading.Event,
    errors: queue.SimpleQueue[str],
) -> None:
    from cyclonedds.util import duration

    try:
        while not stop.is_set():
            for sample in reader.take_iter(timeout=duration(milliseconds=100)):
                output.put((topic_name, time.time_ns(), sample))
                if stop.is_set():
                    break
    except Exception as error:  # noqa: BLE001 - surfaced to the main thread
        errors.put(f"{topic_name}: {error}")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _median_clock_offset_ns(samples: list[int]) -> int:
    if not samples:
        raise ValueError("clock offset samples must not be empty")
    return round(statistics.median(samples))


def _write_sha256_manifest(directory: Path) -> None:
    entries = []
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        if path.name == "sha256.txt":
            continue
        entries.append(f"{_sha256_file(path)}  {path.relative_to(directory)}")
    (directory / "sha256.txt").write_text("\n".join(entries) + "\n", encoding="utf-8")


def _json_line(stream: Any, value: dict[str, Any]) -> None:
    stream.write(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
    stream.flush()


class RecorderLifecycle:
    def __init__(
        self, episode_id: str, partial_directory: Path, publish_events: bool
    ) -> None:
        self.episode_id = episode_id
        self.partial_directory = partial_directory
        self.publish_events = publish_events
        self.phase = "initializing_output"
        self.ready = False

    def event(
        self,
        event: str,
        *,
        publish: bool = True,
        **values: Any,
    ) -> None:
        payload = {
            "event": event,
            "episode_id": self.episode_id,
            "time_ns": time.time_ns(),
            "execution_authority": "none",
            "command_publishers_created": 0,
            "writes": 0,
            **values,
        }
        try:
            if self.partial_directory.is_dir():
                with (self.partial_directory / "recorder_lifecycle.jsonl").open(
                    "a", encoding="utf-8"
                ) as stream:
                    _json_line(stream, payload)
        except OSError:
            if publish and self.publish_events and event == "read_only_recorder_failed":
                print(json.dumps(payload, sort_keys=True), flush=True)
            raise
        if publish and self.publish_events:
            print(json.dumps(payload, sort_keys=True), flush=True)


def _sources_available(counts: dict[str, int]) -> bool:
    return all(count > 0 for count in counts.values())


def _record(args: argparse.Namespace, lifecycle: RecorderLifecycle) -> dict[str, Any]:
    episode_id = _validate_episode_id(args.episode_id)
    post_roll_s = float(getattr(args, "post_roll_s", 1.0))
    lifecycle_handshake = bool(getattr(args, "lifecycle_handshake", False))
    if args.duration_s <= 0 or args.discovery_timeout_s <= 0:
        raise ValueError("recording duration and discovery timeout must be positive")
    if post_roll_s < 0:
        raise ValueError("post-roll duration must not be negative")
    if args.minimum_camera_frames < 1 or args.minimum_state_samples < 1:
        raise ValueError("minimum sample counts must be positive")

    output_root = args.output_root.resolve()
    final_directory = output_root / episode_id
    partial_directory = output_root / f".{episode_id}.partial"
    if final_directory.exists() or partial_directory.exists():
        raise FileExistsError(f"episode output already exists: {episode_id}")
    output_root.mkdir(parents=True, exist_ok=True)
    partial_directory.mkdir()
    lifecycle.event("read_only_recorder_initializing", publish=False)

    camera_directories = {
        spec.camera_id: partial_directory / "cameras" / spec.camera_id
        for spec in CAMERAS
    }
    for directory in camera_directories.values():
        directory.mkdir(parents=True)

    start_utc_ns = time.time_ns()
    controller_path = partial_directory / "controller_events.jsonl"
    state_path = partial_directory / "robot_state.jsonl"
    hand_path = partial_directory / "brainco_current.csv"
    camera_timestamp_path = partial_directory / "camera_timestamps.csv"

    counts: dict[str, int] = {spec.camera_id: 0 for spec in CAMERAS}
    counts.update({"state_envelope": 0, "left_hand": 0, "right_hand": 0})
    last_camera_sequences = {spec.camera_id: 0 for spec in CAMERAS}
    first_camera_sequences: dict[str, int] = {}
    state_sequences: list[int] = []
    clock_offset_samples_ns: list[int] = []
    hand_samples: list[
        tuple[
            int,
            str,
            tuple[float, ...],
            tuple[float, ...],
            tuple[float, ...],
        ]
    ] = []
    stop = threading.Event()
    external_stop_requested = threading.Event()
    sample_queue: queue.SimpleQueue[tuple[str, int, Any]] = queue.SimpleQueue()
    reader_errors: queue.SimpleQueue[str] = queue.SimpleQueue()
    threads: list[threading.Thread] = []
    context: Any | None = None
    sockets: dict[Any, CameraSpec] = {}
    previous_sigterm_handler = signal.getsignal(signal.SIGTERM)

    def request_stop(signum: int, frame: Any) -> None:
        del signum, frame
        external_stop_requested.set()

    if lifecycle_handshake:
        signal.signal(signal.SIGTERM, request_stop)

    termination_reason = "fixed_duration_elapsed"
    try:
        with (
            controller_path.open("w", encoding="utf-8") as controller_stream,
            state_path.open("w", encoding="utf-8") as state_stream,
            hand_path.open("w", encoding="utf-8", newline="") as hand_stream,
            camera_timestamp_path.open(
                "w", encoding="utf-8", newline=""
            ) as camera_stream,
        ):
            hand_writer = csv.writer(hand_stream)
            hand_writer.writerow(
                [
                    "local_received_time_ns",
                    "g1_estimated_time_ns",
                    "local_minus_g1_offset_ns",
                    "side",
                ]
                + [f"q_{index}" for index in range(6)]
                + [f"dq_{index}" for index in range(6)]
                + [f"current_a_{index}" for index in range(6)]
            )
            hand_stream.flush()
            camera_writer = csv.writer(camera_stream)
            camera_writer.writerow(
                [
                    "camera_id",
                    "file_name",
                    "sequence",
                    "frame_time_ns",
                    "time_origin",
                    "clock_id",
                    "source_capture_time_ns",
                    "source_clock_id",
                    "read_started_time_ns",
                    "read_completed_time_ns",
                    "payload_sha256",
                ]
            )
            _json_line(
                controller_stream,
                {
                    "event": "read_only_recorder_started",
                    "episode_id": episode_id,
                    "time_ns": start_utc_ns,
                    "execution_authority": "none",
                    "command_publishers_created": 0,
                    "writes": 0,
                },
            )

            lifecycle.phase = "initializing_sources"
            import zmq
            from cyclonedds.domain import DomainParticipant
            from cyclonedds.sub import DataReader, Subscriber
            from cyclonedds.topic import Topic
            from unitree_sdk2py.core.channel import ChannelFactoryInitialize

            ChannelFactoryInitialize(0, args.network_interface)
            participant = DomainParticipant(0)
            subscriber = Subscriber(participant)
            topic_types = {
                topic_name: _discover_type(
                    participant, topic_name, args.discovery_timeout_s
                )
                for topic_name in (
                    STATE_ENVELOPE_TOPIC,
                    LEFT_HAND_STATE_TOPIC,
                    RIGHT_HAND_STATE_TOPIC,
                )
            }
            for topic_name, datatype in topic_types.items():
                reader = DataReader(
                    subscriber, Topic(participant, topic_name, datatype)
                )
                thread = threading.Thread(
                    target=_reader_worker,
                    args=(reader, topic_name, sample_queue, stop, reader_errors),
                    daemon=True,
                )
                thread.start()
                threads.append(thread)

            context = zmq.Context()
            poller = zmq.Poller()
            for spec in CAMERAS:
                socket = context.socket(zmq.SUB)
                socket.setsockopt(zmq.SUBSCRIBE, b"")
                socket.setsockopt(zmq.RCVHWM, 4)
                socket.connect(f"tcp://{args.camera_host}:{spec.port}")
                poller.register(socket, zmq.POLLIN)
                sockets[socket] = spec

            lifecycle.phase = "waiting_for_observations"
            deadline = (
                None if lifecycle_handshake else time.monotonic() + args.duration_s
            )
            stop_deadline: float | None = None
            while True:
                now = time.monotonic()
                if stop_deadline is not None and now >= stop_deadline:
                    termination_reason = "external_stop_request"
                    break
                if deadline is not None and now >= deadline:
                    break
                for socket, _ in poller.poll(20):
                    spec = sockets[socket]
                    frame = _decode_camera_message(socket.recv())
                    if frame.camera_id != spec.camera_id:
                        raise ValueError(
                            f"camera identity mismatch on port {spec.port}"
                        )
                    if (frame.width, frame.height) != (spec.width, spec.height):
                        raise ValueError(
                            f"camera dimensions changed for {spec.camera_id}"
                        )
                    if frame.sequence <= last_camera_sequences[spec.camera_id]:
                        raise ValueError(
                            f"camera sequence did not advance for {spec.camera_id}"
                        )
                    file_name = f"{frame.sequence:012d}.jpg"
                    (camera_directories[spec.camera_id] / file_name).write_bytes(
                        frame.payload
                    )
                    camera_writer.writerow(
                        [
                            frame.camera_id,
                            f"cameras/{frame.camera_id}/{file_name}",
                            frame.sequence,
                            frame.frame_time_ns,
                            frame.time_origin,
                            frame.clock_id,
                            frame.source_capture_time_ns,
                            frame.source_clock_id,
                            frame.read_started_time_ns,
                            frame.read_completed_time_ns,
                            frame.payload_sha256,
                        ]
                    )
                    camera_stream.flush()
                    first_camera_sequences.setdefault(spec.camera_id, frame.sequence)
                    last_camera_sequences[spec.camera_id] = frame.sequence
                    counts[spec.camera_id] += 1

                while True:
                    try:
                        topic_name, received_time_ns, sample = sample_queue.get_nowait()
                    except queue.Empty:
                        break
                    if topic_name == STATE_ENVELOPE_TOPIC:
                        raw_payload = str(sample.data)
                        payload = json.loads(raw_payload)
                        sequence = int(payload["sequence"])
                        if state_sequences and sequence <= state_sequences[-1]:
                            raise ValueError("state envelope sequence did not advance")
                        _json_line(
                            state_stream,
                            {
                                "received_time_ns": received_time_ns,
                                "payload_sha256": hashlib.sha256(
                                    raw_payload.encode("utf-8")
                                ).hexdigest(),
                                "payload": payload,
                            },
                        )
                        state_sequences.append(sequence)
                        clock_offset_samples_ns.append(
                            received_time_ns - int(payload["assembled_time_ns"])
                        )
                        counts["state_envelope"] += 1
                    else:
                        positions, velocities, currents = _extract_hand_values(sample)
                        side = (
                            "left" if topic_name == LEFT_HAND_STATE_TOPIC else "right"
                        )
                        hand_samples.append(
                            (
                                received_time_ns,
                                side,
                                positions,
                                velocities,
                                currents,
                            )
                        )
                        counts[f"{side}_hand"] += 1

                if not reader_errors.empty():
                    raise RuntimeError(reader_errors.get())

                if not lifecycle.ready and _sources_available(counts):
                    lifecycle.ready = True
                    lifecycle.phase = "recording"
                    lifecycle.event("read_only_recorder_ready")

                if external_stop_requested.is_set() and stop_deadline is None:
                    if not lifecycle.ready:
                        raise RuntimeError(
                            "stop requested before recorder became ready"
                        )
                    lifecycle.phase = "post_roll"
                    stop_deadline = time.monotonic() + post_roll_s
                    lifecycle.event(
                        "read_only_recorder_stop_requested",
                        post_roll_s=post_roll_s,
                    )

            stop.set()
            for thread in threads:
                thread.join(timeout=1.0)
            if not reader_errors.empty():
                raise RuntimeError(reader_errors.get())

            if any(
                counts[spec.camera_id] < args.minimum_camera_frames for spec in CAMERAS
            ):
                raise RuntimeError(f"camera sample minimum not met: {counts}")
            if counts["state_envelope"] < args.minimum_state_samples:
                raise RuntimeError(f"state sample minimum not met: {counts}")
            if (
                counts["left_hand"] < args.minimum_state_samples
                or counts["right_hand"] < args.minimum_state_samples
            ):
                raise RuntimeError(f"BrainCo sample minimum not met: {counts}")
            if not clock_offset_samples_ns:
                raise RuntimeError("no local-to-G1 clock offset samples are available")

            median_clock_offset_ns = _median_clock_offset_ns(clock_offset_samples_ns)
            for received_time_ns, side, positions, velocities, currents in hand_samples:
                hand_writer.writerow(
                    [
                        received_time_ns,
                        received_time_ns - median_clock_offset_ns,
                        median_clock_offset_ns,
                        side,
                    ]
                    + list(positions)
                    + list(velocities)
                    + list(currents)
                )
            hand_stream.flush()
            end_utc_ns = time.time_ns()
            _json_line(
                controller_stream,
                {
                    "event": "read_only_recorder_completed",
                    "episode_id": episode_id,
                    "time_ns": end_utc_ns,
                    "execution_authority": "none",
                    "command_publishers_created": 0,
                    "writes": 0,
                },
            )
    finally:
        if lifecycle_handshake:
            signal.signal(signal.SIGTERM, previous_sigterm_handler)
        if not stop.is_set():
            stop.set()
        for thread in threads:
            thread.join(timeout=1.0)
        for socket in sockets:
            socket.close(linger=0)
        if context is not None:
            context.term()

    lifecycle.phase = "finalizing"
    metadata = {
        "schema_version": 1,
        "episode_id": episode_id,
        "purpose": "read_only_smoke_or_evaluator_evidence",
        "started_at_utc_ns": start_utc_ns,
        "ended_at_utc_ns": end_utc_ns,
        "duration_s": (end_utc_ns - start_utc_ns) / 1e9,
        "termination_reason": termination_reason,
        "post_roll_s": post_roll_s,
        "network_interface": args.network_interface,
        "camera_host": args.camera_host,
        "camera_protocol": "vegapunk.act.camera_frame.v3",
        "camera_storage": "byte_exact_jpeg_payloads",
        "head_camera_logical_views": ["cam_left_high", "cam_right_high"],
        "counts": counts,
        "first_camera_sequences": first_camera_sequences,
        "last_camera_sequences": last_camera_sequences,
        "state_sequence_range": [state_sequences[0], state_sequences[-1]],
        "local_minus_g1_clock_offset_ns": median_clock_offset_ns,
        "clock_offset_sample_range_ns": [
            min(clock_offset_samples_ns),
            max(clock_offset_samples_ns),
        ],
        "brainco_current_time_basis": "g1_estimated_from_state_envelope_offset",
        "execution_authority": "none",
        "command_publishers_created": 0,
        "writes": 0,
        "recorder_sha256": _sha256_file(Path(__file__).resolve()),
    }
    (partial_directory / "capture_metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    lifecycle.event(
        "read_only_recorder_finalizing",
        publish=False,
        termination_reason=termination_reason,
    )
    _write_sha256_manifest(partial_directory)
    os.replace(partial_directory, final_directory)
    return {
        "event": "read_only_recorder_completed",
        "result": "read_only_evaluator_episode_recorded",
        "episode_id": episode_id,
        "output_directory": str(final_directory),
        "counts": counts,
        "termination_reason": termination_reason,
        "execution_authority": "none",
        "command_publishers_created": 0,
        "writes": 0,
    }


def record(args: argparse.Namespace) -> dict[str, Any]:
    episode_id = str(args.episode_id)
    partial_directory = args.output_root.resolve() / f".{episode_id}.partial"
    lifecycle = RecorderLifecycle(
        episode_id,
        partial_directory,
        bool(getattr(args, "lifecycle_handshake", False)),
    )
    try:
        return _record(args, lifecycle)
    except BaseException as error:
        reason = (
            "operator interrupt" if isinstance(error, KeyboardInterrupt) else str(error)
        )
        lifecycle.event(
            "read_only_recorder_failed",
            result="read_only_evaluator_episode_rejected",
            phase=lifecycle.phase,
            ready=lifecycle.ready,
            reason=reason,
        )
        raise


def main() -> int:
    args = parse_args()
    try:
        result = record(args)
    except (KeyboardInterrupt, Exception) as error:  # noqa: BLE001
        if args.lifecycle_handshake:
            return 130 if isinstance(error, KeyboardInterrupt) else 2
        reason = (
            "operator interrupt" if isinstance(error, KeyboardInterrupt) else str(error)
        )
        print(
            json.dumps(
                {
                    "event": "read_only_recorder_failed",
                    "result": "read_only_evaluator_episode_rejected",
                    "reason": reason,
                    "phase": "validating_arguments",
                    "ready": False,
                    "command_publishers_created": 0,
                    "writes": 0,
                },
                sort_keys=True,
            ),
            flush=True,
        )
        return 130 if isinstance(error, KeyboardInterrupt) else 2
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

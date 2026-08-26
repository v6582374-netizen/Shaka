"""Deterministic offline replacements for the recorder's hardware dependencies."""

from __future__ import annotations

import hashlib
import json
import os
import struct
import sys
import threading
import time
import types
from pathlib import Path

MODE = os.environ.get("SHAKA_FAKE_RECORDER_MODE", "healthy")
AUDIT_PATH = Path(os.environ["SHAKA_FAKE_RECORDER_AUDIT"])
LOCK = threading.Lock()
TOPIC_READS: dict[str, int] = {}


def audit(event: str, **values: object) -> None:
    with LOCK, AUDIT_PATH.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"event": event, **values}, sort_keys=True) + "\n")


def install(name: str) -> types.ModuleType:
    module = types.ModuleType(name)
    sys.modules[name] = module
    if "." in name:
        parent_name, child_name = name.rsplit(".", 1)
        parent = sys.modules.setdefault(parent_name, types.ModuleType(parent_name))
        setattr(parent, child_name, module)
    return module


channel = install("unitree_sdk2py.core.channel")


def channel_factory_initialize(domain: int, interface: str) -> None:
    audit("channel_factory_initialized", domain=domain, interface=interface)
    if MODE == "initialization_failure":
        raise RuntimeError("simulated channel initialization failure")


channel.__dict__["ChannelFactoryInitialize"] = channel_factory_initialize


domain = install("cyclonedds.domain")
sub = install("cyclonedds.sub")
topic = install("cyclonedds.topic")
util = install("cyclonedds.util")
builtin = install("cyclonedds.builtin")
core = install("cyclonedds.core")
dynamic = install("cyclonedds.dynamic")


class DomainParticipant:
    def __init__(self, domain_id: int) -> None:
        self.domain_id = domain_id

    def find_topic(self, topic_name: str):
        return types.SimpleNamespace(topic_name=topic_name, data_type=object)


class Subscriber:
    def __init__(self, participant: DomainParticipant) -> None:
        self.participant = participant


class Topic:
    def __init__(
        self, participant: DomainParticipant, topic_name: str, datatype: object
    ):
        self.topic_name = topic_name


class HandState:
    def __init__(self, value: float) -> None:
        self.q = value
        self.dq = value + 0.5
        self.tau_est = value + 1.0


class DataReader:
    def __init__(self, subscriber: Subscriber, source_topic: Topic) -> None:
        self.topic_name = source_topic.topic_name
        audit("reader_created", topic=self.topic_name)

    def take_iter(self, timeout: object):
        del timeout
        time.sleep(0.002)
        with LOCK:
            count = TOPIC_READS.get(self.topic_name, 0) + 1
            TOPIC_READS[self.topic_name] = count
        if (
            MODE == "runtime_failure"
            and "state_envelope" in self.topic_name
            and count >= 8
        ):
            raise RuntimeError("simulated state source failure")
        if "state_envelope" in self.topic_name:
            payload = json.dumps(
                {"sequence": count, "assembled_time_ns": time.time_ns() - 1_000}
            )
            yield types.SimpleNamespace(data=payload)
            return
        yield types.SimpleNamespace(
            states=[HandState(float(index + count)) for index in range(6)]
        )


class BuiltinDataReader:
    def __init__(self, participant: DomainParticipant, builtin_topic: object) -> None:
        del participant, builtin_topic

    def take_iter(self, condition: object, timeout: object):
        del condition, timeout
        for topic_name in (
            "rt/vegapunk/g1/state_envelope",
            "rt/brainco/left/state",
            "rt/brainco/right/state",
        ):
            yield types.SimpleNamespace(topic_name=topic_name, type_id=topic_name)


class ReadCondition:
    def __init__(self, reader: BuiltinDataReader, state: object) -> None:
        del reader, state


class InstanceState:
    Alive = object()


domain.__dict__["DomainParticipant"] = DomainParticipant
sub.__dict__.update({"DataReader": DataReader, "Subscriber": Subscriber})
topic.__dict__["Topic"] = Topic
util.__dict__["duration"] = lambda **values: values
builtin.__dict__.update(
    {
        "BuiltinDataReader": BuiltinDataReader,
        "BuiltinTopicDcpsPublication": object(),
    }
)
core.__dict__.update({"InstanceState": InstanceState, "ReadCondition": ReadCondition})
dynamic.__dict__["get_types_for_typeid"] = lambda participant, type_id, timeout: (
    object(),
    None,
)


zmq = install("zmq")
zmq.__dict__.update({"SUB": 1, "SUBSCRIBE": 2, "RCVHWM": 3, "POLLIN": 4})


CAMERAS = {
    11224: ("head_camera", 1280, 480),
    55558: ("left_wrist_camera", 640, 480),
    55559: ("right_wrist_camera", 640, 480),
}


class Socket:
    def __init__(self) -> None:
        self.port = 0
        self.sequence = 0

    def setsockopt(self, option: int, value: object) -> None:
        del option, value

    def connect(self, address: str) -> None:
        self.port = int(address.rsplit(":", 1)[1])
        audit("camera_subscriber_created", port=self.port)

    def recv(self) -> bytes:
        self.sequence += 1
        camera_id, width, height = CAMERAS[self.port]
        payload = f"{camera_id}-{self.sequence}".encode()
        now_ns = time.time_ns()
        metadata = {
            "schema": "vegapunk.act.camera_frame.v3",
            "camera_id": camera_id,
            "sequence": self.sequence,
            "frame_time_ns": now_ns,
            "time_origin": "hardware_capture",
            "clock_id": "g1_cluster_realtime_ns",
            "source_capture_time_ns": now_ns - 2,
            "source_clock_id": "linux_clock_monotonic_ns",
            "read_started_time_ns": now_ns - 1,
            "read_completed_time_ns": now_ns,
            "width": width,
            "height": height,
            "encoding": "jpeg",
            "payload_length": len(payload),
            "payload_sha256": hashlib.sha256(payload).hexdigest(),
        }
        header = json.dumps(metadata).encode()
        return struct.pack("!4sBH", b"ACF1", 3, len(header)) + header + payload

    def close(self, linger: int = 0) -> None:
        del linger


class Context:
    def socket(self, socket_type: int) -> Socket:
        del socket_type
        return Socket()

    def term(self) -> None:
        pass


class Poller:
    def __init__(self) -> None:
        self.sockets: list[Socket] = []

    def register(self, socket: Socket, event: int) -> None:
        del event
        self.sockets.append(socket)

    def poll(self, timeout_ms: int):
        time.sleep(min(timeout_ms / 1000, 0.002))
        return [(socket, zmq.POLLIN) for socket in self.sockets]


zmq.__dict__.update({"Context": Context, "Poller": Poller})

#!/usr/bin/env python3
"""Serve a read-only G1 monitoring snapshot to the operator console.

The process creates DDS DataReaders, a DDS built-in publication reader, and
ZeroMQ SUB sockets only. It has no DDS command writer, no Unitree client, and
no actuator or configuration path. It listens on loopback by default so Vite or
the existing local sidecar can proxy its one JSON endpoint safely.
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import PurePosixPath
from typing import Any, Callable

from record_evaluator_episode import (
    CAMERAS,
    STATE_ENVELOPE_TOPIC,
    _decode_camera_message,
    _discover_type,
)

BMS_STATE_TOPIC = "rt/lf/bmsstate"
DEFAULT_COMMAND_TOPIC = "rt/lowcmd"
STATE_LIVE_AGE_NS = 750_000_000
BMS_LIVE_AGE_NS = 3_000_000_000
CAMERA_LIVE_AGE_NS = 3_000_000_000


@dataclass(frozen=True)
class Observed:
    received_monotonic_ns: int
    value: Any


def _state_for_age(age_ns: int | None, maximum_age_ns: int) -> str:
    if age_ns is None:
        return "unavailable"
    return "live" if age_ns <= maximum_age_ns else "stale"


def _age_ms(observed: Observed | None, now_ns: int) -> int | None:
    if observed is None:
        return None
    return max(0, round((now_ns - observed.received_monotonic_ns) / 1_000_000))


def _finite_percent(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if 0 <= result <= 100 else None


def _nonzero_numbers(value: Any) -> list[int]:
    try:
        return [int(item) for item in value if int(item) != 0]
    except (TypeError, ValueError):
        return []


def bms_metrics(sample: Any) -> dict[str, int | float | None]:
    """Translate the observed Unitree HG BMS struct without inventing fields.

    The HG IDL carries no units. The live values and the active-cell sum support
    millivolt scaling for `cell_vol` and `bmsvoltage`, and the current field is
    interpreted as milliamps. `bmsvoltage` has three slots whose aggregation
    meaning is not described by the SDK, so this deliberately reports its first
    active *pack* voltage and never sums slots into a fictional "total".
    """

    cell_mv = _nonzero_numbers(getattr(sample, "cell_vol", ()))
    voltage_mv = _nonzero_numbers(getattr(sample, "bmsvoltage", ()))
    temperatures = _nonzero_numbers(getattr(sample, "temperature", ()))
    voltage_v = voltage_mv[0] / 1_000 if voltage_mv else None
    current_raw = getattr(sample, "current", None)
    try:
        current_a = int(current_raw) / 1_000
    except (TypeError, ValueError):
        current_a = None
    cycle_raw = getattr(sample, "cycle", None)
    try:
        cycle = int(cycle_raw)
    except (TypeError, ValueError):
        cycle = None

    return {
        "soc_percent": _finite_percent(getattr(sample, "soc", None)),
        "soh_percent": _finite_percent(getattr(sample, "soh", None)),
        "pack_voltage_v": voltage_v,
        "pack_current_a": current_a,
        "power_w": None if voltage_v is None or current_a is None else voltage_v * current_a,
        "temperature_c": max(temperatures) if temperatures else None,
        "cell_voltage_spread_v": None if not cell_mv else (max(cell_mv) - min(cell_mv)) / 1_000,
        "cycle_count": cycle if cycle is not None and cycle >= 0 else None,
    }


def _empty_bms(state: str) -> dict[str, Any]:
    return {
        "state": state,
        "topic": BMS_STATE_TOPIC,
        "soc_percent": None,
        "soh_percent": None,
        "pack_voltage_v": None,
        "pack_current_a": None,
        "power_w": None,
        "temperature_c": None,
        "cell_voltage_spread_v": None,
        "cycle_count": None,
    }


class G1Monitor:
    """Owns all read-only G1 subscriptions and exposes their latest observations."""

    def __init__(self, network_interface: str, camera_host: str, command_topics: tuple[str, ...]):
        self._network_interface = network_interface
        self._camera_host = camera_host
        self._command_topics = command_topics
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._state: Observed | None = None
        self._bms: Observed | None = None
        self._camera_times: dict[str, int] = {}
        self._state_times: deque[int] = deque(maxlen=60)
        self._control: Observed | None = None
        self._errors: dict[str, str] = {}
        self._threads: list[threading.Thread] = []
        self._participant: Any | None = None

    def start(self) -> None:
        """Start read-only subscribers; source failures remain observable as empty state."""

        try:
            from cyclonedds.domain import DomainParticipant
            from cyclonedds.sub import DataReader, Subscriber
            from cyclonedds.topic import Topic
            from unitree_sdk2py.core.channel import ChannelFactoryInitialize

            ChannelFactoryInitialize(0, self._network_interface)
            self._participant = DomainParticipant(0)
            subscriber = Subscriber(self._participant)
            state_type = _discover_type(self._participant, STATE_ENVELOPE_TOPIC, 5.0)
            bms_type = _discover_type(self._participant, BMS_STATE_TOPIC, 5.0)
            state_reader = DataReader(subscriber, Topic(self._participant, STATE_ENVELOPE_TOPIC, state_type))
            bms_reader = DataReader(subscriber, Topic(self._participant, BMS_STATE_TOPIC, bms_type))
            self._spawn("g1-state-reader", self._dds_loop, state_reader, self._ingest_state)
            self._spawn("g1-bms-reader", self._dds_loop, bms_reader, self._ingest_bms)
            self._spawn("g1-control-discovery", self._control_loop)
        except Exception as error:  # noqa: BLE001 - a failed reader must surface as unavailable
            self._record_error("dds", str(error))
        self._spawn("g1-camera-reader", self._camera_loop)

    def close(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=1.0)

    def _spawn(self, name: str, target: Callable[..., None], *args: Any) -> None:
        thread = threading.Thread(name=name, target=target, args=args, daemon=True)
        thread.start()
        self._threads.append(thread)

    def _record_error(self, source: str, message: str) -> None:
        logging.warning("G1 monitor %s: %s", source, message)
        with self._lock:
            self._errors[source] = message

    def _dds_loop(self, reader: Any, ingest: Callable[[Any], None]) -> None:
        from cyclonedds.util import duration

        try:
            while not self._stop.is_set():
                for sample in reader.take_iter(timeout=duration(milliseconds=100)):
                    ingest(sample)
                    if self._stop.is_set():
                        break
        except Exception as error:  # noqa: BLE001 - see snapshot error state
            self._record_error("dds", str(error))

    def _ingest_state(self, sample: Any) -> None:
        try:
            payload = json.loads(str(sample.data))
            if not isinstance(payload.get("sequence"), int) or not isinstance(payload.get("assembled_time_ns"), int):
                raise ValueError("state envelope lacks sequence or assembled_time_ns")
        except Exception as error:  # noqa: BLE001 - malformed data cannot become a reading
            self._record_error("state_envelope", str(error))
            return
        received = time.monotonic_ns()
        with self._lock:
            self._state = Observed(received, payload)
            self._state_times.append(received)
            self._errors.pop("state_envelope", None)

    def _ingest_bms(self, sample: Any) -> None:
        received = time.monotonic_ns()
        with self._lock:
            self._bms = Observed(received, sample)
            self._errors.pop("bms", None)

    def _camera_loop(self) -> None:
        try:
            import zmq

            context = zmq.Context()
            sockets: dict[Any, Any] = {}
            poller = zmq.Poller()
            try:
                for spec in CAMERAS:
                    socket = context.socket(zmq.SUB)
                    socket.setsockopt(zmq.SUBSCRIBE, b"")
                    socket.setsockopt(zmq.RCVHWM, 1)
                    socket.connect(f"tcp://{self._camera_host}:{spec.port}")
                    poller.register(socket, zmq.POLLIN)
                    sockets[socket] = spec
                while not self._stop.is_set():
                    for socket, _ in poller.poll(100):
                        spec = sockets[socket]
                        frame = _decode_camera_message(socket.recv())
                        if frame.camera_id != spec.camera_id or (frame.width, frame.height) != (spec.width, spec.height):
                            raise ValueError(f"camera identity or dimensions changed for {spec.camera_id}")
                        with self._lock:
                            self._camera_times[spec.camera_id] = time.monotonic_ns()
                            self._errors.pop("cameras", None)
            finally:
                for socket in sockets:
                    socket.close(linger=0)
                context.term()
        except Exception as error:  # noqa: BLE001 - empty camera source state is safer than retrying blindly
            self._record_error("cameras", str(error))

    def _control_loop(self) -> None:
        """Observe, but never judge authority over, protected command publications."""

        if self._participant is None:
            return
        try:
            from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsPublication
            from cyclonedds.core import InstanceState, ReadCondition
            from cyclonedds.util import duration

            while not self._stop.is_set():
                reader = BuiltinDataReader(self._participant, BuiltinTopicDcpsPublication)
                condition = ReadCondition(reader, InstanceState.Alive)
                publishers = {
                    (str(item.topic_name), str(item.participant_key))
                    for item in reader.take_iter(condition=condition, timeout=duration(milliseconds=250))
                    if getattr(item, "topic_name", None) in self._command_topics
                }
                with self._lock:
                    self._control = Observed(time.monotonic_ns(), len(publishers))
                self._stop.wait(0.75)
        except Exception as error:  # noqa: BLE001
            self._record_error("control", str(error))

    def snapshot(self) -> dict[str, Any]:
        now = time.monotonic_ns()
        with self._lock:
            state = self._state
            bms = self._bms
            state_times = tuple(self._state_times)
            camera_times = dict(self._camera_times)
            control = self._control

        state_age_ms = _age_ms(state, now)
        state_age_ns = None if state_age_ms is None else state_age_ms * 1_000_000
        state_status = _state_for_age(state_age_ns, STATE_LIVE_AGE_NS)
        bms_age_ms = _age_ms(bms, now)
        bms_age_ns = None if bms_age_ms is None else bms_age_ms * 1_000_000
        bms_status = _state_for_age(bms_age_ns, BMS_LIVE_AGE_NS)

        if state is None:
            stream = {"state": "unavailable", "topic": STATE_ENVELOPE_TOPIC, "age_ms": None, "sequence": None, "frequency_hz": None}
        else:
            frequency_hz = None
            if len(state_times) >= 2 and state_times[-1] > state_times[0]:
                frequency_hz = round((len(state_times) - 1) * 1_000_000_000 / (state_times[-1] - state_times[0]), 1)
            stream = {
                "state": state_status,
                "topic": STATE_ENVELOPE_TOPIC,
                "age_ms": state_age_ms,
                "sequence": state.value["sequence"],
                "frequency_hz": frequency_hz,
            }

        online_cameras = sum(now - received <= CAMERA_LIVE_AGE_NS for received in camera_times.values())
        camera_status = "live" if online_cameras == len(CAMERAS) else "stale" if camera_times else "unavailable"
        if bms is None or bms_status != "live":
            bms_payload = _empty_bms(bms_status)
        else:
            bms_payload = {"state": "live", "topic": BMS_STATE_TOPIC, **bms_metrics(bms.value)}

        control_age_ms = _age_ms(control, now)
        if control is None or control_age_ms is None or control_age_ms > 2_000:
            control_payload = {"state": "unknown", "label": None}
        elif control.value:
            control_payload = {"state": "discovered", "label": f"{control.value} publisher(s) on {', '.join(self._command_topics)}"}
        else:
            control_payload = {"state": "unavailable", "label": f"no publisher observed on {', '.join(self._command_topics)}"}

        return {
            "observed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "state_stream": stream,
            "cameras": {"state": camera_status, "configured_sources": len(CAMERAS), "online_sources": online_cameras if camera_times else None},
            "control_entry": control_payload,
            "bms": bms_payload,
        }


class MonitorHandler(BaseHTTPRequestHandler):
    server: "MonitorServer"

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = PurePosixPath(self.path.split("?", 1)[0]).as_posix()
        if path == "/v1/embodied/g1/monitor":
            self._json(HTTPStatus.OK, self.server.monitor.snapshot())
        elif path == "/v1/health":
            self._json(HTTPStatus.OK, {"status": "ok", "default_workspace": None, "model": "g1-monitor-bridge"})
        elif (payload := self._empty_shell_payload(path)) is not None:
            # The monitor bridge can temporarily occupy the normal local port when
            # the full sidecar is not running. These are deliberately empty,
            # read-only list responses: they make the desktop shell navigable to
            # the G1 monitor but never pretend to provide sessions or connectors.
            self._json(HTTPStatus.OK, payload)
        else:
            self._json(HTTPStatus.NOT_FOUND, {"detail": "not found"})

    @staticmethod
    def _empty_shell_payload(path: str) -> dict[str, Any] | None:
        if path == "/v1/personas":
            return {"personas": []}
        if path == "/v1/settings":
            return {
                "provider": "",
                "model": "g1-monitor-bridge",
                "models": [],
                "model_labels": {},
                "model_ready": False,
                "surfaces": {"cowork": True, "chat": False, "code": False},
            }
        if path == "/v1/sessions":
            return {"sessions": []}
        if path == "/v1/workspaces/recent":
            return {"workspaces": []}
        if path == "/v1/automations":
            return {"tasks": []}
        if path == "/v1/connectors":
            return {"connectors": []}
        if path == "/v1/inbox":
            return {"items": []}
        if path.startswith("/v1/sessions/") and path.endswith("/artifacts"):
            return {"artifacts": []}
        if path.startswith("/v1/sessions/") and path.endswith("/roots"):
            return {"roots": []}
        if path.startswith("/v1/sessions/") and path.endswith("/connections"):
            return {"connections": []}
        if path.startswith("/v1/sessions/") and path.endswith("/unattended"):
            return {"unattended": False}
        return None

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:1420")
        self.end_headers()

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:1420")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class MonitorServer(ThreadingHTTPServer):
    monitor: G1Monitor

    def __init__(self, address: tuple[str, int], monitor: G1Monitor):
        super().__init__(address, MonitorHandler)
        self.monitor = monitor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network-interface", default="enp0s31f6")
    parser.add_argument("--camera-host", default="192.168.123.164")
    parser.add_argument("--command-topic", action="append", default=[DEFAULT_COMMAND_TOPIC])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    monitor = G1Monitor(args.network_interface, args.camera_host, tuple(dict.fromkeys(args.command_topic)))
    monitor.start()
    server = MonitorServer((args.host, args.port), monitor)

    def stop(_signal: int, _frame: Any) -> None:
        # BaseServer.shutdown() must run outside the serve_forever thread.
        threading.Thread(target=server.shutdown, name="g1-monitor-stop", daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    logging.info("G1 monitor bridge listening on http://%s:%s", args.host, args.port)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        monitor.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

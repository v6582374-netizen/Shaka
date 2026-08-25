from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "record_evaluator_episode.py"
SPEC = importlib.util.spec_from_file_location("record_evaluator_episode", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def camera_message(payload: bytes = b"jpeg-bytes") -> bytes:
    metadata = {
        "schema": "vegapunk.act.camera_frame.v3",
        "camera_id": "head_camera",
        "sequence": 7,
        "frame_time_ns": 100,
        "time_origin": "hardware_capture",
        "clock_id": "g1_cluster_realtime_ns",
        "source_capture_time_ns": 90,
        "source_clock_id": "linux_clock_monotonic_ns",
        "read_started_time_ns": 95,
        "read_completed_time_ns": 105,
        "width": 1280,
        "height": 480,
        "encoding": "jpeg",
        "payload_length": len(payload),
        "payload_sha256": hashlib.sha256(payload).hexdigest(),
    }
    header = json.dumps(metadata).encode()
    return struct.pack("!4sBH", b"ACF1", 3, len(header)) + header + payload


class CameraFrameTest(unittest.TestCase):
    def test_preserves_the_exact_jpeg_payload(self) -> None:
        payload = b"exact-jpeg-payload"
        frame = MODULE._decode_camera_message(camera_message(payload))
        self.assertEqual(frame.camera_id, "head_camera")
        self.assertEqual(frame.sequence, 7)
        self.assertEqual(frame.payload, payload)

    def test_rejects_payload_tampering(self) -> None:
        message = camera_message()[:-1] + b"x"
        with self.assertRaisesRegex(ValueError, "digest"):
            MODULE._decode_camera_message(message)


class HandStateTest(unittest.TestCase):
    def test_extracts_position_velocity_and_published_current(self) -> None:
        class State:
            def __init__(self, value: float) -> None:
                self.q = value
                self.dq = value + 1
                self.tau_est = value + 2

        class Sample:
            def __init__(self) -> None:
                self.states = [State(float(index)) for index in range(6)]

        positions, velocities, currents = MODULE._extract_hand_values(Sample())
        self.assertEqual(positions, tuple(float(index) for index in range(6)))
        self.assertEqual(velocities[0], 1.0)
        self.assertEqual(currents[-1], 7.0)


class EvidenceIdentityTest(unittest.TestCase):
    def test_uses_the_median_clock_offset_to_ignore_one_outlier(self) -> None:
        self.assertEqual(MODULE._median_clock_offset_ns([100, 101, 102, 10_000]), 102)

    def test_rejects_path_like_episode_ids(self) -> None:
        for value in ("", "../escape", "has space", "/absolute"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                MODULE._validate_episode_id(value)

    def test_hash_manifest_covers_nested_files_and_excludes_itself(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root / "cameras" / "head_camera"
            nested.mkdir(parents=True)
            (nested / "1.jpg").write_bytes(b"frame")
            MODULE._write_sha256_manifest(root)
            manifest = (root / "sha256.txt").read_text()
            self.assertIn("cameras/head_camera/1.jpg", manifest)
            self.assertNotIn("sha256.txt", manifest)


if __name__ == "__main__":
    unittest.main()

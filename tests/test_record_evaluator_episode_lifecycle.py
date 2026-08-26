from __future__ import annotations

import json
import os
import selectors
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "record_evaluator_episode.py"
FAKE_RUNTIME = ROOT / "tests" / "support" / "recorder_runtime"


class RecorderLifecycleTest(unittest.TestCase):
    def start_recorder(
        self,
        root: Path,
        mode: str = "healthy",
        *,
        duration_s: float = 10,
        post_roll_s: float = 0.05,
        handshake: bool = True,
    ) -> subprocess.Popen[str]:
        audit_path = root / "runtime-audit.jsonl"
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": mode,
                "SHAKA_FAKE_RECORDER_AUDIT": str(audit_path),
            }
        )
        arguments = [
            sys.executable,
            str(SCRIPT),
            "--episode-id",
            "INVOCATION-21",
            "--output-root",
            str(root / "evidence"),
            "--duration-s",
            str(duration_s),
            "--post-roll-s",
            str(post_roll_s),
            "--minimum-camera-frames",
            "1",
            "--minimum-state-samples",
            "1",
        ]
        if handshake:
            arguments.append("--lifecycle-handshake")
        return subprocess.Popen(
            arguments,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def read_event(self, process: subprocess.Popen[str], timeout_s: float = 3) -> dict:
        assert process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        self.assertTrue(
            selector.select(timeout_s), "recorder produced no lifecycle event"
        )
        line = process.stdout.readline()
        self.assertTrue(
            line, f"recorder exited before lifecycle event: {process.poll()}"
        )
        return json.loads(line)

    def assert_zero_write(self, event: dict) -> None:
        self.assertEqual(event["command_publishers_created"], 0)
        self.assertEqual(event["writes"], 0)

    def lifecycle_events(self, path: Path) -> list[dict]:
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def assert_runtime_is_read_only(self, root: Path) -> None:
        audit_events = self.lifecycle_events(root / "runtime-audit.jsonl")
        self.assertFalse(
            any(
                "publisher" in event["event"] or "write" in event["event"]
                for event in audit_events
            )
        )

    def test_external_stop_finishes_post_roll_then_atomically_publishes_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = self.start_recorder(root)
            ready = self.read_event(process)
            self.assertEqual(ready["event"], "read_only_recorder_ready")
            self.assert_zero_write(ready)
            partial = root / "evidence" / ".INVOCATION-21.partial"
            for relative_path in (
                "controller_events.jsonl",
                "robot_state.jsonl",
                "brainco_current.csv",
                "camera_timestamps.csv",
                "recorder_lifecycle.jsonl",
            ):
                self.assertTrue(
                    (partial / relative_path).is_file(),
                    f"ready was reported before {relative_path} existed",
                )
            ready_audit = self.lifecycle_events(root / "runtime-audit.jsonl")
            self.assertEqual(
                sum(event["event"] == "reader_created" for event in ready_audit), 3
            )
            self.assertEqual(
                sum(
                    event["event"] == "camera_subscriber_created"
                    for event in ready_audit
                ),
                3,
            )

            stop_requested_at = time.monotonic()
            process.terminate()
            stdout, stderr = process.communicate(timeout=5)
            elapsed = time.monotonic() - stop_requested_at
            self.assertEqual(process.returncode, 0, stderr)
            events = [json.loads(line) for line in stdout.splitlines() if line]
            self.assertGreaterEqual(elapsed, 0.04)
            self.assertEqual(
                [event["event"] for event in events],
                ["read_only_recorder_stop_requested", "read_only_recorder_completed"],
            )
            for event in events:
                self.assert_zero_write(event)

            evidence_root = root / "evidence"
            final_directory = evidence_root / "INVOCATION-21"
            self.assertTrue(final_directory.is_dir())
            self.assertFalse((evidence_root / ".INVOCATION-21.partial").exists())
            metadata = json.loads(
                (final_directory / "capture_metadata.json").read_text(encoding="utf-8")
            )
            self.assertEqual(metadata["termination_reason"], "external_stop_request")
            self.assertEqual(metadata["post_roll_s"], 0.05)
            self.assert_zero_write(metadata)
            manifest = (final_directory / "sha256.txt").read_text(encoding="utf-8")
            self.assertIn("capture_metadata.json", manifest)
            self.assertIn("recorder_lifecycle.jsonl", manifest)

            audit_events = self.lifecycle_events(root / "runtime-audit.jsonl")
            self.assertEqual(
                sum(event["event"] == "reader_created" for event in audit_events), 3
            )
            self.assertEqual(
                sum(
                    event["event"] == "camera_subscriber_created"
                    for event in audit_events
                ),
                3,
            )
            self.assert_runtime_is_read_only(root)

    def test_initialization_failure_stays_partial_and_reports_never_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = self.start_recorder(root, "initialization_failure")
            failed = self.read_event(process)
            _, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 2, stderr)
            self.assertEqual(failed["event"], "read_only_recorder_failed")
            self.assertEqual(failed["phase"], "initializing_sources")
            self.assertFalse(failed["ready"])
            self.assertIn("simulated channel initialization failure", failed["reason"])
            self.assert_zero_write(failed)

            evidence_root = root / "evidence"
            partial = evidence_root / ".INVOCATION-21.partial"
            self.assertTrue(partial.is_dir())
            self.assertFalse((evidence_root / "INVOCATION-21").exists())
            lifecycle = self.lifecycle_events(partial / "recorder_lifecycle.jsonl")
            self.assertEqual(lifecycle[-1]["event"], "read_only_recorder_failed")
            self.assertFalse(lifecycle[-1]["ready"])
            self.assertIn("initialization failure", lifecycle[-1]["reason"])
            self.assert_runtime_is_read_only(root)

    def test_runtime_source_failure_reports_that_recording_was_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = self.start_recorder(root, "runtime_failure")
            ready = self.read_event(process)
            failed = self.read_event(process)
            _, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 2, stderr)
            self.assertEqual(ready["event"], "read_only_recorder_ready")
            self.assertEqual(failed["event"], "read_only_recorder_failed")
            self.assertTrue(failed["ready"])
            self.assertEqual(failed["phase"], "recording")
            self.assertIn("simulated state source failure", failed["reason"])
            self.assert_zero_write(ready)
            self.assert_zero_write(failed)

            evidence_root = root / "evidence"
            partial = evidence_root / ".INVOCATION-21.partial"
            self.assertTrue(partial.is_dir())
            self.assertFalse((evidence_root / "INVOCATION-21").exists())
            lifecycle = self.lifecycle_events(partial / "recorder_lifecycle.jsonl")
            self.assertEqual(lifecycle[-1]["event"], "read_only_recorder_failed")
            self.assertTrue(lifecycle[-1]["ready"])
            self.assert_runtime_is_read_only(root)

    def test_interrupt_after_ready_is_a_failed_partial_recording(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = self.start_recorder(root)
            ready = self.read_event(process)
            self.assertEqual(ready["event"], "read_only_recorder_ready")
            process.send_signal(2)
            failed = self.read_event(process)
            _, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 130, stderr)
            self.assertEqual(failed["event"], "read_only_recorder_failed")
            self.assertTrue(failed["ready"])
            self.assertEqual(failed["phase"], "recording")
            self.assertEqual(failed["reason"], "operator interrupt")
            self.assert_zero_write(ready)
            self.assert_zero_write(failed)

            evidence_root = root / "evidence"
            self.assertTrue((evidence_root / ".INVOCATION-21.partial").is_dir())
            self.assertFalse((evidence_root / "INVOCATION-21").exists())
            self.assert_runtime_is_read_only(root)

    def test_fixed_duration_entry_remains_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process = self.start_recorder(root, duration_s=0.08, handshake=False)
            completed = self.read_event(process)
            _, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(completed["event"], "read_only_recorder_completed")
            self.assertEqual(completed["termination_reason"], "fixed_duration_elapsed")
            self.assert_zero_write(completed)
            final_directory = root / "evidence" / "INVOCATION-21"
            self.assertTrue(final_directory.is_dir())
            metadata = json.loads(
                (final_directory / "capture_metadata.json").read_text()
            )
            self.assertEqual(metadata["schema_version"], 1)
            self.assertEqual(metadata["termination_reason"], "fixed_duration_elapsed")
            self.assert_runtime_is_read_only(root)


if __name__ == "__main__":
    unittest.main()

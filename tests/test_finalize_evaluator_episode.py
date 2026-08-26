from __future__ import annotations

import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1] / "scripts"
SCRIPT = SCRIPTS / "finalize_evaluator_episode.py"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("finalize_evaluator_episode", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FinalizeEvaluatorEpisodeTest(unittest.TestCase):
    def _fixture(self, camera_end_ns: int) -> tuple[Path, Path, Path, tempfile.TemporaryDirectory[str]]:
        temporary = tempfile.TemporaryDirectory()
        episode = Path(temporary.name) / "episode"
        episode.mkdir()
        (episode / "capture_metadata.json").write_text(
            json.dumps(
                {
                    "episode_id": "EVAL-v001-DEV-001",
                    "execution_authority": "none",
                    "command_publishers_created": 0,
                    "writes": 0,
                }
            )
        )
        with (episode / "camera_timestamps.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=["camera_id", "frame_time_ns"])
            writer.writeheader()
            for camera_id in ("head_camera", "left_wrist_camera", "right_wrist_camera"):
                writer.writerows(
                    [
                        {"camera_id": camera_id, "frame_time_ns": 900},
                        {"camera_id": camera_id, "frame_time_ns": camera_end_ns},
                    ]
                )
        (episode / "robot_state.jsonl").write_text(
            '\n'.join(
                json.dumps({"payload": {"assembled_time_ns": value}})
                for value in (900, camera_end_ns)
            )
            + "\n"
        )
        with (episode / "brainco_current.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(
                stream, fieldnames=["side", "g1_estimated_time_ns"]
            )
            writer.writeheader()
            for side in ("left", "right"):
                writer.writerows(
                    [
                        {"side": side, "g1_estimated_time_ns": 900},
                        {"side": side, "g1_estimated_time_ns": camera_end_ns},
                    ]
                )
        (episode / "controller_events.jsonl").write_text(
            '{"event":"read_only_recorder_started"}\n'
        )
        (episode / "sha256.txt").write_text("original manifest\n")
        trace = Path(temporary.name) / "trace.json"
        trace.write_text(
            json.dumps(
                {
                    "protocol": "pilot-v1",
                    "outcome": "completed",
                    "checkpoint_digest": "digest",
                    "frames": [
                        {
                            "phase": "act_task",
                            "candidate_age_ms": 0.0,
                            "candidate_source_time_ns": 1000,
                            "loop_now_ns": 100,
                        },
                        {
                            "phase": "act_task",
                            "candidate_age_ms": 0.0,
                            "candidate_source_time_ns": 1100,
                            "loop_now_ns": 200,
                        },
                    ],
                }
            )
        )
        stdout = Path(temporary.name) / "stdout.log"
        stdout.write_text(
            "binding diagnostic\n"
            + json.dumps(
                {
                    "protocol": "pilot-v1",
                    "trace_artifact": str(trace),
                    "arm_publishers_created": 1,
                    "hand_publishers_created": 2,
                    "arm_writes": 10,
                    "hand_updates": 10,
                }
            )
            + "\n"
        )
        return episode, trace, stdout, temporary

    def test_accepts_complete_stream_coverage(self) -> None:
        episode, trace, stdout, temporary = self._fixture(camera_end_ns=1200)
        self.addCleanup(temporary.cleanup)

        result = MODULE.finalize(episode, trace, stdout)

        self.assertTrue(result["capture_valid"])
        metadata = json.loads((episode / "capture_metadata.json").read_text())
        self.assertTrue(metadata["capture_quality"]["valid"])
        self.assertEqual(metadata["controller"]["arm_writes"], 10)
        self.assertTrue((episode / "controller_trace.json").is_file())

    def test_rejects_capture_that_ends_before_controller(self) -> None:
        episode, trace, stdout, temporary = self._fixture(camera_end_ns=1050)
        self.addCleanup(temporary.cleanup)

        result = MODULE.finalize(episode, trace, stdout)

        self.assertFalse(result["capture_valid"])
        self.assertLess(result["coverage"]["head_camera"]["end_margin_ns"], 0)


if __name__ == "__main__":
    unittest.main()

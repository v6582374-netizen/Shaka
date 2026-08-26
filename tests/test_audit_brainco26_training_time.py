from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "audit_brainco26_training_time.py"
SPEC = importlib.util.spec_from_file_location("brainco26_training_time", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
AUDITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDITOR)


def row(episode: int, frame: int, *, timestamp: float | None = None) -> dict[str, object]:
    return {
        "episode_index": episode,
        "frame_index": frame,
        "timestamp": frame / 30 if timestamp is None else timestamp,
        "observation.state": [float(frame)] * 26,
        "action": [float(frame + 1)] * 26,
    }


class BrainCo26TrainingTimeAuditTest(unittest.TestCase):
    def test_validates_30hz_episode_timing_and_retains_26d_data(self) -> None:
        episodes, timing = AUDITOR.validate_episode_records(
            [row(1, 1), row(0, 0), row(1, 0), row(0, 1)], fps=30
        )

        self.assertEqual(sorted(episodes), [0, 1])
        self.assertEqual(timing["frames"], 4)
        self.assertEqual(timing["episodes"], 2)
        self.assertAlmostEqual(timing["sample_interval_seconds"], 1 / 30)
        self.assertEqual(episodes[0][1]["action"], (2.0,) * 26)

    def test_rejects_a_timestamp_gap(self) -> None:
        with self.assertRaisesRegex(ValueError, "timestamp"):
            AUDITOR.validate_episode_records([row(0, 0), row(0, 1, timestamp=0.2)], fps=30)

    def test_rejects_non_contiguous_frame_indices(self) -> None:
        with self.assertRaisesRegex(ValueError, "frame indices"):
            AUDITOR.validate_episode_records([row(0, 0), row(0, 2)], fps=30)

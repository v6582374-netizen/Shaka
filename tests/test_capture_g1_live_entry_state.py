from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "capture_g1_live_entry_state.py"
SPEC = importlib.util.spec_from_file_location("g1_live_entry_capture", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def hand(offset: float) -> dict[str, list[float]]:
    return {
        "positions": [0.2 + offset] * 6,
        "velocities": [0.01] * 6,
        "currents": [0.1] * 6,
    }


class LiveEntryCaptureTest(unittest.TestCase):
    def test_builds_a_zero_write_snapshot_with_both_hand_feedback_vectors(self) -> None:
        state = {"assembled_time_ns": 123, "body": [0.0] * 34}
        result = MODULE.build_snapshot(
            state, hand(0.0), hand(0.1), state_received_ns=1000, left_received_ns=1010, right_received_ns=1020
        )

        self.assertEqual(result["kind"], "g1_live_entry_snapshot")
        self.assertEqual(result["brainco"]["left"]["positions"], [0.2] * 6)
        for value in result["brainco"]["right"]["positions"]:
            self.assertAlmostEqual(value, 0.3)
        self.assertEqual(result["feedback_pair_skew_ns"], 20)
        self.assertEqual(result["writes"], 0)

    def test_rejects_missing_current_or_out_of_contract_position(self) -> None:
        state = {"assembled_time_ns": 123, "body": [0.0] * 34}
        incomplete = hand(0.0)
        del incomplete["currents"]
        with self.assertRaisesRegex(ValueError, "currents"):
            MODULE.build_snapshot(state, incomplete, hand(0.1), state_received_ns=1000, left_received_ns=1010, right_received_ns=1020)
        with self.assertRaisesRegex(ValueError, "normalized"):
            MODULE.build_snapshot(state, hand(0.9), hand(0.1), state_received_ns=1000, left_received_ns=1010, right_received_ns=1020)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("relative_plan", ROOT / "scripts" / "project_g1_vla_relative_arm_plan.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RelativeArmPlanTest(unittest.TestCase):
    def test_anchors_first_model_pose_to_live_entry_and_preserves_deltas(self) -> None:
        source = {
            "kind": "unifolm_vla_action_plan_evidence", "execution_mode": "zero-write",
            "command_publishers_created": 0, "writes": 0,
            "contract": {"action_dimension": 26, "action_horizon": 25},
            "trajectory": [[float(i) for i in range(26)], [float(i) + 0.1 for i in range(26)]] + [[float(i) for i in range(26)] for _ in range(23)],
        }
        entry = [10.0 + i for i in range(14)]
        result = MODULE.project(source, entry)
        self.assertEqual(result["trajectory_arm_positions_rad"][0], entry)
        for actual, expected in zip(result["trajectory_arm_positions_rad"][1], [value + 0.1 for value in entry], strict=True):
            self.assertAlmostEqual(actual, expected)
        self.assertEqual(result["hands"], "intentionally omitted until arm control handover is verified")
        self.assertEqual(result["writes"], 0)


if __name__ == "__main__":
    unittest.main()

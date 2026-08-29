from __future__ import annotations

import importlib.util
import sys
import unittest
from itertools import pairwise
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "assemble_g1_vla_live_trajectory.py"
SPEC = importlib.util.spec_from_file_location("live_trajectory", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


ARM_JOINTS = [
    "left_shoulder_pitch_joint", "left_shoulder_roll_joint", "left_shoulder_yaw_joint",
    "left_elbow_joint", "left_wrist_roll_joint", "left_wrist_pitch_joint",
    "left_wrist_yaw_joint", "right_shoulder_pitch_joint", "right_shoulder_roll_joint",
    "right_shoulder_yaw_joint", "right_elbow_joint", "right_wrist_roll_joint",
    "right_wrist_pitch_joint", "right_wrist_yaw_joint",
]


def observation() -> dict[str, object]:
    return {
        "captured_at_ns": 100,
        "robot_state": {"body": [0.0] * 20 + [0.2] * 14},
        "brainco": {
            "left": {"positions": [0.4, 0.4, 0.05, 0.05, 0.05, 0.05]},
            "right": {"positions": [0.4, 0.4, 0.05, 0.05, 0.05, 0.05]},
        },
    }


def plan() -> dict[str, object]:
    first = [1.2] * 14 + [0.1] * 12
    second = [1.3] * 14 + [0.6] * 12
    return {
        "schema_version": 1,
        "kind": "unifolm_vla_action_plan_evidence",
        "execution_mode": "zero-write",
        "command_publishers_created": 0,
        "writes": 0,
        "contract": {
            "action_dimension": 26,
            "action_horizon": 25,
            "live_brainco_action_units": "normalized_0_to_1",
        },
        "projection": {"protocol": "shaka.g1-vla-brainco-action-projection.v1"},
        "trajectory": [first, second] + [second] * 23,
    }


class LiveTrajectoryAssemblyTest(unittest.TestCase):
    def test_starts_at_fresh_measured_state_then_interpolates_every_channel(self) -> None:
        result = MODULE.assemble(
            plan(), observation(), ARM_JOINTS, [1.0] * 14, hand_speed_normalized=0.2
        )

        frames = result["frames"]
        self.assertEqual(frames[0]["arm_positions_rad"], [0.2] * 14)
        self.assertEqual(frames[0]["hand_positions_normalized"], observation()["brainco"]["left"]["positions"] + observation()["brainco"]["right"]["positions"])
        for value in frames[-1]["arm_positions_rad"]:
            self.assertAlmostEqual(value, 0.3)
        self.assertEqual(frames[-1]["hand_positions_normalized"], [0.6] * 12)
        for previous, current in pairwise(frames):
            for before, after in zip(previous["arm_positions_rad"], current["arm_positions_rad"], strict=True):
                self.assertLessEqual(abs(after - before), 1.0 * MODULE.CONTROL_PERIOD_S + 1e-9)
            for before, after in zip(previous["hand_positions_normalized"], current["hand_positions_normalized"], strict=True):
                self.assertLessEqual(abs(after - before), 0.2 * MODULE.CONTROL_PERIOD_S + 1e-9)

    def test_rejects_unprojected_or_unbounded_hand_targets(self) -> None:
        unprojected = plan()
        del unprojected["projection"]
        with self.assertRaisesRegex(ValueError, "BrainCo projection"):
            MODULE.assemble(unprojected, observation(), ARM_JOINTS, [1.0] * 14, hand_speed_normalized=0.2)

        malformed = plan()
        malformed["trajectory"][0][14] = 1.1  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, "normalized"):
            MODULE.assemble(malformed, observation(), ARM_JOINTS, [1.0] * 14, hand_speed_normalized=0.2)


if __name__ == "__main__":
    unittest.main()

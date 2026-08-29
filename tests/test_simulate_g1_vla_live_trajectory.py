from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "simulate_g1_vla_live_trajectory.py"
SPEC = importlib.util.spec_from_file_location("g1_mujoco_preflight", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


ARM_JOINTS = [f"arm_{index}" for index in range(14)]


def trajectory(*, bad_joint: bool = False, bad_hand_step: bool = False) -> dict[str, object]:
    second_arm = [0.2] * 14
    if bad_joint:
        second_arm[3] = 2.0
    second_hand = [0.504] * 12
    if bad_hand_step:
        second_hand[0] = 0.9
    return {
        "schema_version": 1,
        "kind": "g1_vla_live_trajectory",
        "protocol": "shaka.g1-vla-live-trajectory.v1",
        "source_execution_mode": "zero-write",
        "physical_execution_authorized": False,
        "control_period_s": 0.02,
        "arm_joint_order": ARM_JOINTS,
        "arm_speed_limits_rad_s": [1000.0] * 14,
        "hand_command_speed_normalized": 0.2,
        "entry_arm_positions_rad": [0.0] * 14,
        "entry_hand_positions_normalized": [0.5] * 12,
        "frames": [
            {
                "arm_positions_rad": [0.0] * 14,
                "hand_positions_normalized": [0.5] * 12,
                "hand_command_speed_normalized": 0.2,
            },
            {
                "arm_positions_rad": second_arm,
                "hand_positions_normalized": second_hand,
                "hand_command_speed_normalized": 0.2,
            },
        ],
        "requires_fresh_feedback_at_execution": True,
        "command_publishers_created": 0,
        "writes": 0,
    }


def model_xml() -> str:
    bodies = ""
    indent = ""
    for index in range(14):
        bodies += f'{indent}<body pos="{index * 0.2} 0 0.05"><joint name="arm_{index}" type="hinge" range="-1 1"/><geom type="sphere" size="0.01"/></body>'
    return f'<mujoco><compiler angle="radian"/><option gravity="0 0 0"/><worldbody><body name="base">{bodies}</body></worldbody></mujoco>'


class MuJoCoPreflightTest(unittest.TestCase):
    def test_admits_the_exact_complete_live_trajectory_without_hardware(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.xml"
            model.write_text(model_xml(), encoding="utf-8")
            result = MODULE.simulate(trajectory(), model)

        self.assertEqual(result["result"], "g1_vla_mujoco_preflight_admitted")
        self.assertEqual(result["checks"]["frames_checked"], 2)
        self.assertFalse(result["physical_execution_authorized"])
        self.assertEqual(result["writes"], 0)

    def test_rejects_a_joint_limit_or_hand_continuity_violation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.xml"
            model.write_text(model_xml(), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "joint limit"):
                MODULE.simulate(trajectory(bad_joint=True), model)
            with self.assertRaisesRegex(ValueError, "hand transition"):
                MODULE.simulate(trajectory(bad_hand_step=True), model)


if __name__ == "__main__":
    unittest.main()

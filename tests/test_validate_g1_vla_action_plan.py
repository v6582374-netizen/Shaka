from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "validate_g1_vla_action_plan.py"
SPEC = importlib.util.spec_from_file_location("g1_vla_plan_validator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)

ARM_JOINTS = [f"arm_{index}" for index in range(14)]


def write_urdf(path: Path, *, velocity: float | None = None) -> None:
    velocity_attribute = "" if velocity is None else f' velocity="{velocity}"'
    joints = "\n".join(
        f'<joint name="{name}"><limit lower="-1" upper="1"{velocity_attribute} /></joint>'
        for name in ARM_JOINTS
    )
    path.write_text(f"<robot>{joints}</robot>", encoding="utf-8")


def observation() -> dict[str, object]:
    return {
        "robot_state": {"body": [0.0] * 34},
        "brainco": {
            "left": {"positions": [0.2] * 6},
            "right": {"positions": [0.3] * 6},
        },
    }


def plan() -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": "unifolm_vla_action_plan_evidence",
        "execution_mode": "zero-write",
        "contract": {"action_dimension": 26, "action_horizon": 25},
        "trajectory": [[0.1] * 14 + [0.5] * 12 for _ in range(25)],
        "command_publishers_created": 0,
        "writes": 0,
    }


def standard_start() -> dict[str, object]:
    return {"pose": {"arm_joint_order": ARM_JOINTS, "arm_values": [0.0] * 14}}


def training_time_audit() -> dict[str, object]:
    return {
        "protocol": VALIDATOR.TRAINING_TIME_PROTOCOL,
        "result": "brainco26_training_time_audit_ok",
        "physical_execution_authorized": False,
        "training_time_semantics": {
            "action_horizon_steps": 25,
            "sample_interval_seconds": 1 / 30,
        },
    }


class G1VlaActionPlanValidatorTest(unittest.TestCase):
    def test_bounds_valid_plan_is_still_not_physical_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            urdf = temporary / "g1.urdf"
            write_urdf(urdf)
            result = VALIDATOR.validate(plan(), observation(), standard_start(), urdf)

        self.assertEqual(result["result"], "g1_vla_action_plan_static_bounds_ok")
        self.assertFalse(result["physical_execution_authorized"])
        self.assertEqual(result["writes"], 0)
        self.assertIn("workspace and collision clearance", result["unassessed_requirements"])

    def test_rejects_brainco_targets_outside_the_live_bridge_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            urdf = Path(directory) / "g1.urdf"
            write_urdf(urdf)
            unsafe = plan()
            unsafe["trajectory"][0][14] = -0.01  # type: ignore[index]
            result = VALIDATOR.validate(unsafe, observation(), standard_start(), urdf)

        self.assertEqual(result["result"], "g1_vla_action_plan_rejected")
        self.assertEqual(result["violations"][0]["kind"], "brainco_normalized_limit")
        self.assertFalse(result["physical_execution_authorized"])

    def test_rejects_arm_targets_beyond_the_urdf_hard_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            urdf = Path(directory) / "g1.urdf"
            write_urdf(urdf)
            unsafe = plan()
            unsafe["trajectory"][4][3] = 1.01  # type: ignore[index]
            result = VALIDATOR.validate(unsafe, observation(), standard_start(), urdf)

        self.assertEqual(result["result"], "g1_vla_action_plan_rejected")
        self.assertEqual(result["violations"][0]["kind"], "arm_hard_limit")
        self.assertEqual(result["violations"][0]["joint"], "arm_3")

    def test_rejects_adjacent_arm_targets_faster_than_the_urdf_velocity_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            urdf = Path(directory) / "g1.urdf"
            write_urdf(urdf, velocity=1.0)
            unsafe = plan()
            unsafe["trajectory"][1][0] = 0.2  # type: ignore[index]
            result = VALIDATOR.validate(
                unsafe, observation(), standard_start(), urdf, training_time_audit()
            )

        self.assertEqual(result["result"], "g1_vla_action_plan_rejected")
        self.assertEqual(result["violations"][0]["kind"], "arm_urdf_velocity_limit")
        self.assertAlmostEqual(result["violations"][0]["implied_velocity"], 3.0)
        self.assertEqual(result["inputs"]["training_sample_interval_seconds"], 1 / 30)

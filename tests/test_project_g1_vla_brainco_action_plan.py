from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "project_g1_vla_brainco_action_plan.py"
SPEC = importlib.util.spec_from_file_location("brainco_projector", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
PROJECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROJECTOR)


def plan() -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": "unifolm_vla_action_plan_evidence",
        "execution_mode": "zero-write",
        "contract": {"action_dimension": 26, "action_horizon": 25},
        "trajectory": [[0.25] * 14 + [-0.1, 1.2] + [0.5] * 10 for _ in range(25)],
        "command_publishers_created": 0,
        "writes": 0,
    }


class BrainCoActionProjectionTest(unittest.TestCase):
    def test_projects_only_hand_coordinates_and_keeps_provenance(self) -> None:
        result = PROJECTOR.project(plan(), "a" * 64)

        self.assertEqual(result["trajectory"][0][:14], [0.25] * 14)
        self.assertEqual(result["trajectory"][0][14:16], [0.0, 1.0])
        self.assertEqual(len(result["projection"]["alterations"]), 50)
        self.assertEqual(result["projection"]["source_action_plan_sha256"], "a" * 64)
        self.assertFalse(result["physical_execution_authorized"])
        self.assertEqual(result["writes"], 0)

    def test_rejects_a_plan_without_zero_write_provenance(self) -> None:
        unsafe = plan()
        unsafe["writes"] = 1

        with self.assertRaisesRegex(ValueError, "zero-write"):
            PROJECTOR.project(unsafe, "a" * 64)

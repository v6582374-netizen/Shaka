from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "prepare_g1_vla_supervised_canary.py"
SPEC = importlib.util.spec_from_file_location("prepare_g1_vla_supervised_canary", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
PREPARE = importlib.util.module_from_spec(SPEC)
import sys

sys.modules[SPEC.name] = PREPARE
SPEC.loader.exec_module(PREPARE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PrepareG1VlaSupervisedCanaryTest(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path, Path]:
        action = root / "action.json"
        action.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "kind": "unifolm_vla_action_plan_evidence",
                    "execution_mode": "zero-write",
                    "contract": {"action_dimension": 26, "action_horizon": 25},
                    "trajectory": [[float(index) / 100 for index in range(26)] for _ in range(25)],
                    "command_publishers_created": 0,
                    "writes": 0,
                }
            ),
            encoding="utf-8",
        )
        admission = root / "admission.json"
        admission.write_text(
            json.dumps(
                {
                    "result": "g1_vla_action_plan_static_bounds_ok",
                    "execution_mode": "zero-write",
                    "physical_execution_authorized": False,
                    "command_publishers_created": 0,
                    "writes": 0,
                    "action_plan_sha256": digest(action),
                }
            ),
            encoding="utf-8",
        )
        terminal = root / "terminal.json"
        terminal.write_text(
            json.dumps(
                {
                    "execution_mode": "zero-write",
                    "command_publishers_created": 0,
                    "writes": 0,
                    "artifacts": {
                        "action_plan": {"sha256": digest(action)},
                        "static_admission": {"sha256": digest(admission)},
                    },
                }
            ),
            encoding="utf-8",
        )
        return action, admission, terminal

    def test_binds_zero_write_evidence_and_uses_only_one_wrist_channel(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            action, admission, terminal = self.fixture(Path(directory))
            result = PREPARE.package(
                action_plan=action,
                static_admission=admission,
                terminal_report=terminal,
                invocation_id="INVOCATION-001",
            )
        self.assertEqual(result["kind"], PREPARE.PACKAGE_KIND)
        self.assertFalse(result["physical_execution_authorized"])
        self.assertEqual(result["canary"]["active_arm_index"], 6)
        self.assertEqual(result["canary"]["vla_proposed_absolute_target_rad"], 0.06)
        self.assertEqual(result["canary"]["maximum_delta_rad"], 0.01)
        self.assertEqual(result["canary"]["hands"], "disabled")
        self.assertEqual(result["writes"], 0)

    def test_rejects_static_admission_for_a_different_plan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            action, admission, terminal = self.fixture(Path(directory))
            value = json.loads(admission.read_text(encoding="utf-8"))
            value["action_plan_sha256"] = "f" * 64
            admission.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "different action plan"):
                PREPARE.package(
                    action_plan=action,
                    static_admission=admission,
                    terminal_report=terminal,
                    invocation_id="INVOCATION-001",
                )

    def test_rejects_terminal_report_that_does_not_bind_the_plan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            action, admission, terminal = self.fixture(Path(directory))
            value = json.loads(terminal.read_text(encoding="utf-8"))
            value["artifacts"]["action_plan"]["sha256"] = "e" * 64
            terminal.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not bound to this action plan"):
                PREPARE.package(
                    action_plan=action,
                    static_admission=admission,
                    terminal_report=terminal,
                    invocation_id="INVOCATION-001",
                )

    def test_never_overwrites_a_prepared_package(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "canary.json"
            output.write_text("already-present", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                PREPARE.write_new_json(output, {"hello": "world"})


if __name__ == "__main__":
    unittest.main()

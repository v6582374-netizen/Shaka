from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_g1_vla_mujoco_preflight.py"
SPEC = importlib.util.spec_from_file_location("g1_mujoco_preflight_runner", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


JOINTS = [f"arm_{index}" for index in range(14)]


def write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def plan() -> dict[str, object]:
    first = [0.2] * 14 + [0.2] * 12
    second = [0.22] * 14 + [0.204] * 12
    return {
        "schema_version": 1, "kind": "unifolm_vla_action_plan_evidence", "execution_mode": "zero-write",
        "command_publishers_created": 0, "writes": 0,
        "contract": {"action_dimension": 26, "action_horizon": 25, "live_brainco_action_units": "normalized_0_to_1"},
        "projection": {"protocol": "shaka.g1-vla-brainco-action-projection.v1"},
        "trajectory": [first, second] + [second] * 23,
    }


def snapshot() -> dict[str, object]:
    return {"robot_state": {"body": [0.0] * 20 + [0.1] * 14}, "brainco": {"left": {"positions": [0.2] * 6}, "right": {"positions": [0.2] * 6}}}


def urdf() -> str:
    return "<robot>" + "".join(f'<joint name="{name}"><limit lower="-1" upper="1" velocity="10"/></joint>' for name in JOINTS) + "</robot>"


def model() -> str:
    bodies = "".join(f'<body pos="{index * 0.2} 0 0"><joint name="{name}" type="hinge" range="-1 1"/><geom type="sphere" size="0.01"/></body>' for index, name in enumerate(JOINTS))
    return f'<mujoco><compiler angle="radian"/><option gravity="0 0 0"/><worldbody><body>{bodies}</body></worldbody></mujoco>'


class MuJoCoPreflightRunnerTest(unittest.TestCase):
    def test_writes_only_digest_bound_trajectory_and_simulation_admission(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            plan_path, snapshot_path = directory / "plan.json", directory / "entry.json"
            definition_path, urdf_path, model_path = directory / "definition.json", directory / "g1.urdf", directory / "g1.xml"
            write(plan_path, plan())
            write(snapshot_path, snapshot())
            write(definition_path, {"joint_names": JOINTS + [f"hand_{index}" for index in range(12)]})
            urdf_path.write_text(urdf(), encoding="utf-8")
            model_path.write_text(model(), encoding="utf-8")
            result = MODULE.run(plan_path, snapshot_path, definition_path, urdf_path, model_path, 0.2, directory / "out")
            trajectory = json.loads((directory / "out" / "live-trajectory.json").read_text(encoding="utf-8"))
            admission = json.loads((directory / "out" / "simulation-admission.json").read_text(encoding="utf-8"))

        self.assertEqual(result["result"], "g1_vla_mujoco_preflight_completed")
        self.assertEqual(admission["live_trajectory_sha256"], hashlib.sha256(json.dumps(trajectory, indent=2, sort_keys=True).encode() + b"\n").hexdigest())
        self.assertFalse(admission["physical_execution_authorized"])
        self.assertEqual(admission["writes"], 0)


if __name__ == "__main__":
    unittest.main()

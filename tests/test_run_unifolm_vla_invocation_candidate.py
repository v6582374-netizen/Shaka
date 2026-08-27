from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_unifolm_vla_invocation_candidate.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("unifolm_invocation_candidate", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class UniFoLMInvocationCandidateTest(unittest.TestCase):
    def test_repository_package_binds_its_two_runtime_artifacts(self) -> None:
        directory = ROOT / "configs" / "unifolm-vla-brainco26-v001"
        package = json.loads((directory / "candidate-package.json").read_text())
        self.assertEqual(package["runtime"]["kind"], MODULE.RUNTIME_KIND)
        for name, reference in package["artifacts"].items():
            artifact = directory / reference["path"]
            self.assertEqual(
                reference["sha256"], hashlib.sha256(artifact.read_bytes()).hexdigest(), name
            )

    def write_runtime(self, root: Path) -> tuple[Path, Path]:
        bundle = root / "candidate-bundle" / "configuration"
        bundle.mkdir(parents=True)
        configuration = bundle / "configuration.json"
        configuration.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "kind": "unifolm_vla_zero_write_candidate_configuration",
                    "instruction": "Press the yellow button.",
                    "device": "cuda:0",
                    "seed": 42,
                }
            ),
            encoding="utf-8",
        )
        runtime = root / "candidate-runtime.json"
        runtime.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": "unifolm-vla-brainco26-v001",
                    "runtime": {
                        "kind": "unifolm-vla-zero-write-v1",
                        "configuration_artifact": "configuration",
                    },
                    "artifacts": {
                        "configuration": {
                            "path": "candidate-bundle/configuration/configuration.json"
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        observation = root / "live-observation.json"
        observation.write_text(
            json.dumps({"schema_version": 1, "captured_at_ns": 1234}),
            encoding="utf-8",
        )
        return runtime, observation

    def test_runs_fixed_preflight_and_records_only_action_plan_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime, observation = self.write_runtime(root)
            raw_action_plan = root / "action-plan-raw.json"
            action_plan = root / "action-plan.json"
            static_admission = root / "static-admission.json"
            trace = root / "controller-trace.json"

            def fake_preflight(command: list[str], timeout_s: float) -> dict[str, object]:
                self.assertIn(str(observation), command)
                self.assertGreater(timeout_s, 0)
                raw_action_plan.write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "kind": "unifolm_vla_action_plan_evidence",
                            "execution_mode": "zero-write",
                            "observation": {"captured_at_ns": 1234},
                            "contract": {
                                "action_dimension": 26,
                                "action_horizon": 25,
                            },
                            "trajectory": [[0.0] * 26 for _ in range(25)],
                            "command_publishers_created": 0,
                            "writes": 0,
                        }
                    ),
                    encoding="utf-8",
                )
                return {
                    "result": "unifolm_vla_zero_write_preflight_ok",
                    "command_publishers_created": 0,
                    "writes": 0,
                    "action_plan": {
                        "path": str(raw_action_plan),
                        "sha256": hashlib.sha256(raw_action_plan.read_bytes()).hexdigest(),
                    },
                }

            with patch.object(MODULE, "_run_preflight", fake_preflight), patch.object(
                MODULE, "STATIC_INPUTS", {}
            ), patch.object(MODULE, "project", lambda plan, _: plan), patch.object(
                MODULE,
                "validate",
                lambda *_: {"result": "g1_vla_action_plan_static_bounds_ok"},
            ):
                result = MODULE.run_candidate(
                    runtime,
                    observation,
                    raw_action_plan,
                    action_plan,
                    static_admission,
                    trace,
                    1.0,
                    python=Path(sys.executable),
                )

            self.assertEqual(result["deployment_status"], "admitted")
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            controller_trace = json.loads(trace.read_text())
            self.assertEqual(
                controller_trace["protocol"], "shaka.zero-write-vla-controller-trace.v1"
            )
            self.assertEqual(
                controller_trace["frames"][0]["action_plan_sha256"],
                result["action_plan"]["sha256"],
            )
            self.assertTrue(static_admission.is_file())

    def test_rejects_runtime_that_escapes_its_artifact_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime, _ = self.write_runtime(root)
            value = json.loads(runtime.read_text())
            value["artifacts"]["configuration"]["path"] = "../../outside.json"
            runtime.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "escapes"):
                MODULE._runtime_configuration(runtime)

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_single_invocation.py"
FAKE_RECORDER_RUNTIME = ROOT / "tests" / "support" / "recorder_runtime"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SingleInvocationRunnerTest(unittest.TestCase):
    def write_fixture(self, root: Path) -> Path:
        preprocessor = root / "preprocess.py"
        preprocessor.write_text(
            """def preprocess(observation, configuration):
    return {
        "observation_time_ns": observation["captured_at_ns"],
        "scale": configuration["scale"],
    }
""",
            encoding="utf-8",
        )
        implementation = root / "candidate.py"
        implementation.write_text(
            """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [configuration["value"] * model_input["scale"]] * len(configuration["joint_names"]),
        "task_result": "succeeded",
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            encoding="utf-8",
        )
        joint_names = [
            "right_shoulder_pitch_joint",
            "right_elbow_joint",
            "right_wrist_pitch_joint",
        ]
        configuration = root / "candidate-config.json"
        configuration.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "action_definition_id": "g1-right-arm-position-v001",
                    "joint_names": joint_names,
                    "scale": 0.5,
                    "value": 0.2,
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        action_definition = root / "action-definition.json"
        action_definition.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "action_definition_id": "g1-right-arm-position-v001",
                    "command_type": "joint_position",
                    "joint_names": joint_names,
                    "value_dimension": len(joint_names),
                    "maximum_output_age_ns": 100_000_000,
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        observation = root / "saved-observation.json"
        observation.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "observation_id": "observation-001",
                    "captured_at_ns": 1_000_000_000,
                    "robot_state": {"joint_names": joint_names},
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        candidate_package = root / "candidate-package.json"
        candidate_package.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": "candidate-v001",
                    "source_version": "fixture-candidate-v001",
                    "artifacts": {
                        "implementation": {
                            "path": implementation.name,
                            "sha256": sha256_file(implementation),
                        },
                        "configuration": {
                            "path": configuration.name,
                            "sha256": sha256_file(configuration),
                        },
                        "input_preprocessor": {
                            "path": preprocessor.name,
                            "sha256": sha256_file(preprocessor),
                        },
                        "action_definition": {
                            "path": action_definition.name,
                            "sha256": sha256_file(action_definition),
                        },
                    },
                    "runtime": {
                        "kind": "python-callable-v1",
                        "preprocess": {
                            "artifact": "input_preprocessor",
                            "callable": "preprocess",
                        },
                        "inference": {
                            "artifact": "implementation",
                            "callable": "infer",
                        },
                    },
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        safety_config = root / "safety.json"
        safety_config.write_text(
            json.dumps({"schema_version": 1, "mode": "zero-write"}) + "\n",
            encoding="utf-8",
        )
        budget_artifact = root / "budget.json"
        budget_artifact.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "physical_rollout_budget": 0,
                    "robot_runtime_budget_s": 0,
                    "frozen_contracts_sha256": "1" * 64,
                    "global_stop_reasons": ["zero_write_validation_complete"],
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        manifest = root / "run-manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "run_id": "RUN-001",
                    "invocation_id": "INVOCATION-001",
                    "execution_mode": "zero-write",
                    "candidate": {
                        "candidate_id": "candidate-v001",
                        "package_path": str(candidate_package),
                        "package_sha256": sha256_file(candidate_package),
                        "observation": {
                            "path": str(observation),
                            "sha256": sha256_file(observation),
                        },
                    },
                    "task_contract_version": "yellow-button-contact-v001",
                    "evaluator_version": "offline-deterministic-v001",
                    "standard_start_version": "g1-evaluator-v001",
                    "safety_config": {
                        "path": str(safety_config),
                        "sha256": sha256_file(safety_config),
                    },
                    "maximum_duration_s": 2.0,
                    "budget_reference": "offline-budget-001",
                    "budget_artifact": {
                        "path": str(budget_artifact),
                        "sha256": sha256_file(budget_artifact),
                    },
                    "rollback_candidate_id": "candidate-v000",
                    "output_root": str(root / "runs"),
                    "recorder": {
                        "post_roll_s": 0.02,
                        "minimum_camera_frames": 1,
                        "minimum_state_samples": 1,
                    },
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        return manifest

    def run_cli(self, root: Path, manifest: Path) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RECORDER_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": "healthy",
                "SHAKA_FAKE_RECORDER_AUDIT": str(root / "recorder-audit.jsonl"),
            }
        )
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--manifest", str(manifest)],
            env=environment,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )

    def start_cli(self, root: Path, manifest: Path) -> subprocess.Popen[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RECORDER_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": "healthy",
                "SHAKA_FAKE_RECORDER_AUDIT": str(root / "recorder-audit.jsonl"),
            }
        )
        return subprocess.Popen(
            [sys.executable, str(SCRIPT), "--manifest", str(manifest)],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def update_manifest(self, manifest: Path, **values: object) -> None:
        content = json.loads(manifest.read_text())
        content.update(values)
        manifest.write_text(
            json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    def replace_candidate_implementation(self, manifest: Path, source: str) -> None:
        manifest_content = json.loads(manifest.read_text())
        package_path = Path(manifest_content["candidate"]["package_path"])
        package = json.loads(package_path.read_text())
        reference = package["artifacts"]["implementation"]
        implementation = package_path.parent / reference["path"]
        implementation.write_text(source, encoding="utf-8")
        reference["sha256"] = sha256_file(implementation)
        package_path.write_text(
            json.dumps(package, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        manifest_content["candidate"]["package_sha256"] = sha256_file(package_path)
        manifest.write_text(
            json.dumps(manifest_content, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def assert_candidate_deployment_defect(
        self,
        root: Path,
        manifest: Path,
        reason: str,
        *,
        publishers: int = 0,
        writes: int = 0,
    ) -> None:
        completed = self.run_cli(root, manifest)

        self.assertEqual(completed.returncode, 2)
        result = json.loads(completed.stdout)
        self.assertEqual(result["result"], "zero_write_candidate_rejected")
        self.assertEqual(result["failure_class"], "deployment_defect")
        self.assertEqual(result["physical_rollout_attempts_consumed"], 0)
        self.assertEqual(result["robot_runtime_consumed_s"], 0)
        self.assertEqual(result["command_publishers_created"], publishers)
        self.assertEqual(result["writes"], writes)
        run_directory = root / "runs" / "RUN-001"
        report = json.loads((run_directory / "terminal-report.json").read_text())
        self.assertNotIn("task_result", report)
        self.assertEqual(report["failure_class"], "deployment_defect")
        self.assertEqual(report["physical_rollout_attempts_consumed"], 0)
        self.assertEqual(report["robot_runtime_consumed_s"], 0)
        self.assertEqual(report["command_publishers_created"], publishers)
        self.assertEqual(report["writes"], writes)
        candidate_result = json.loads(
            (run_directory / "artifacts" / "candidate-result.json").read_text()
        )
        self.assertEqual(candidate_result["deployment_status"], "rejected")
        self.assertEqual(candidate_result["failure_class"], "deployment_defect")
        self.assertIn(reason, candidate_result["reason"])
        self.assertEqual(len(candidate_result["candidate_output_sha256"]), 64)
        self.assertEqual(candidate_result["command_publishers_created"], publishers)
        self.assertEqual(candidate_result["writes"], writes)

    def test_runs_one_complete_zero_write_invocation_through_the_public_cli(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["result"], "zero_write_invocation_completed")
            self.assertEqual(result["run_id"], "RUN-001")
            self.assertEqual(result["invocation_id"], "INVOCATION-001")
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)

            run_directory = root / "runs" / "RUN-001"
            self.assertTrue(run_directory.is_dir())
            self.assertFalse((root / "runs" / ".RUN-001.partial").exists())
            lifecycle = [
                json.loads(line)
                for line in (run_directory / "lifecycle.jsonl").read_text().splitlines()
            ]
            self.assertEqual(
                [event["stage"] for event in lifecycle],
                [
                    "manifest_validated",
                    "invocation_authority_acquired",
                    "readiness_confirmed",
                    "recorder_ready",
                    "candidate_completed",
                    "control_released",
                    "evidence_completed",
                    "evaluation_completed",
                    "reset_disposition_recorded",
                    "terminal_report_prepared",
                ],
            )
            for event in lifecycle:
                self.assertEqual(event["command_publishers_created"], 0)
                self.assertEqual(event["writes"], 0)

            reports = list(run_directory.glob("terminal-report*.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text())
            self.assertEqual(report["manifest_sha256"], sha256_file(manifest))
            self.assertEqual(report["completed_stage"], "terminal_report")
            self.assertEqual(
                report["terminal_reason"], "zero_write_invocation_completed"
            )
            self.assertEqual(report["task_result"], "indeterminate")
            self.assertEqual(report["next_disposition"], "stop_zero_write_validation")
            self.assertEqual(report["command_publishers_created"], 0)
            self.assertEqual(report["writes"], 0)
            manifest_content = json.loads(manifest.read_text())
            self.assertEqual(
                report["artifacts"]["candidate_package"]["sha256"],
                manifest_content["candidate"]["package_sha256"],
            )
            candidate_result_path = (
                run_directory / report["artifacts"]["candidate_result"]["path"]
            )
            candidate_result = json.loads(candidate_result_path.read_text())
            self.assertEqual(candidate_result["deployment_status"], "admitted")
            self.assertEqual(
                candidate_result["candidate_package_sha256"],
                manifest_content["candidate"]["package_sha256"],
            )
            self.assertEqual(
                candidate_result["input_observation_sha256"],
                manifest_content["candidate"]["observation"]["sha256"],
            )
            self.assertEqual(len(candidate_result["candidate_output_sha256"]), 64)
            self.assertEqual(
                candidate_result["diagnostics"],
                {
                    "action_definition_id": "g1-right-arm-position-v001",
                    "inference": "completed",
                    "output_validation": "compatible",
                    "preprocessing": "completed",
                },
            )
            self.assertEqual(
                candidate_result["ignored_candidate_claims"],
                {"task_result": "succeeded"},
            )
            self.assertNotIn("task_result", candidate_result)
            self.assertEqual(
                report["artifacts"]["safety_configuration"]["sha256"],
                manifest_content["safety_config"]["sha256"],
            )
            self.assertEqual(
                report["artifacts"]["budget_artifact"]["sha256"],
                manifest_content["budget_artifact"]["sha256"],
            )
            readiness_path = (
                run_directory / report["artifacts"]["readiness_result"]["path"]
            )
            readiness = json.loads(readiness_path.read_text())
            self.assertTrue(readiness["ready"])
            self.assertEqual(readiness["execution_mode"], "zero-write")
            self.assertEqual(readiness["control_authority"], "exclusive_local_claim")
            self.assertEqual(readiness["competing_command_publishers"], 0)
            self.assertEqual(readiness["command_publishers_created"], 0)
            self.assertEqual(readiness["writes"], 0)
            evaluation_path = (
                run_directory / report["artifacts"]["evaluation_result"]["path"]
            )
            evaluation = json.loads(evaluation_path.read_text())
            evidence_manifest = (
                run_directory
                / report["artifacts"]["invocation_evidence"]["path"]
                / "sha256.txt"
            )
            self.assertEqual(
                evaluation["input_manifest_sha256"], sha256_file(evidence_manifest)
            )
            self.assertIsInstance(evaluation["visual_facts"], dict)
            reset_path = run_directory / report["artifacts"]["reset_result"]["path"]
            reset = json.loads(reset_path.read_text())
            self.assertFalse(reset["requested"])
            self.assertEqual(
                reset["reason"], "zero_write_validation_is_not_a_task_attempt"
            )
            self.assertTrue(
                (run_directory / report["artifacts"]["invocation_evidence"]["path"])
                .joinpath("sha256.txt")
                .is_file()
            )

            recorder_audit = (root / "recorder-audit.jsonl").read_text()
            self.assertNotIn("publisher", recorder_audit)
            self.assertNotIn("write", recorder_audit)
            adapter_audit = [
                json.loads(line)
                for line in (run_directory / "artifacts" / "adapter-audit.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertEqual(
                [event["adapter"] for event in adapter_audit],
                ["readiness", "candidate", "release", "evaluation", "reset"],
            )
            for event in adapter_audit:
                self.assertEqual(event["command_publishers_created"], 0)
                self.assertEqual(event["writes"], 0)

    def test_rejects_unsupported_mode_before_starting_the_recorder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.update_manifest(manifest, execution_mode="write-enabled")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("only the 'zero-write'", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_write_enabled_safety_configuration_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            safety_path = Path(content["safety_config"]["path"])
            safety_path.write_text(
                json.dumps({"schema_version": 1, "mode": "write-enabled"}) + "\n",
                encoding="utf-8",
            )
            content["safety_config"]["sha256"] = sha256_file(safety_path)
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn(
                "safety configuration must enforce zero-write", result["reason"]
            )
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_missing_candidate_package_before_starting_the_recorder(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            content["candidate"]["package_path"] = str(root / "missing-package.json")
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("candidate package is missing", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_digest_mismatch_before_starting_the_recorder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            content["candidate"]["package_sha256"] = "0" * 64
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("candidate package digest does not match", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_missing_candidate_artifact_before_recording(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            (root / "candidate.py").unlink()

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("candidate artifact 'implementation' is missing", result["reason"])
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_candidate_artifact_digest_mismatch_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            (root / "preprocess.py").write_text("def preprocess(): pass\n")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn(
                "candidate artifact 'input_preprocessor' digest does not match",
                result["reason"],
            )
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_run_manifest_candidate_identity_mismatch_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            content["candidate"]["candidate_id"] = "candidate-v999"
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("identity does not match", result["reason"])
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_reused_invocation_identity_without_overwriting_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            first = self.run_cli(root, manifest)
            self.assertEqual(first.returncode, 0, first.stderr)
            first_report = (
                root / "runs" / "RUN-001" / "terminal-report.json"
            ).read_bytes()
            recorder_audit = (root / "recorder-audit.jsonl").read_bytes()
            self.update_manifest(manifest, run_id="RUN-002")

            second = self.run_cli(root, manifest)

            self.assertEqual(second.returncode, 2)
            result = json.loads(second.stdout)
            self.assertIn("invocation identity was already used", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertEqual(
                (root / "runs" / "RUN-001" / "terminal-report.json").read_bytes(),
                first_report,
            )
            self.assertFalse((root / "runs" / "RUN-002").exists())
            self.assertEqual(
                (root / "recorder-audit.jsonl").read_bytes(), recorder_audit
            )

    def test_rejects_an_existing_run_directory_without_overwriting_its_report(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            first = self.run_cli(root, manifest)
            self.assertEqual(first.returncode, 0, first.stderr)
            report_path = root / "runs" / "RUN-001" / "terminal-report.json"
            report_before_retry = report_path.read_bytes()
            recorder_audit = (root / "recorder-audit.jsonl").read_bytes()

            second = self.run_cli(root, manifest)

            self.assertEqual(second.returncode, 2)
            result = json.loads(second.stdout)
            self.assertIn("run output already exists", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertEqual(report_path.read_bytes(), report_before_retry)
            self.assertEqual(
                (root / "recorder-audit.jsonl").read_bytes(), recorder_audit
            )

    def test_rejects_a_package_attempt_to_supply_the_task_result_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            package_path = Path(content["candidate"]["package_path"])
            package = json.loads(package_path.read_text())
            package["task_result"] = "succeeded"
            package_path.write_text(json.dumps(package), encoding="utf-8")
            content["candidate"]["package_sha256"] = sha256_file(package_path)
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("must not contain a task result", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_dimension_error_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1],
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "dimension")

    def test_non_finite_output_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1, float("nan"), 0.3],
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "finite")

    def test_stale_timestamp_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"] - 200_000_000,
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "stale")

    def test_joint_order_error_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": list(reversed(configuration["joint_names"])),
        "values": [0.1, 0.2, 0.3],
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "joint names or order")

    def test_action_definition_mismatch_is_a_zero_budget_deployment_defect(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": "incompatible-action-v999",
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "incompatible")

    def test_nonzero_write_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
        "command_publishers_created": 0,
        "writes": 1,
    }
""",
            )

            self.assert_candidate_deployment_defect(
                root, manifest, "zero-write", writes=1
            )

    def test_nonzero_publisher_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
        "command_publishers_created": 1,
        "writes": 0,
    }
""",
            )

            self.assert_candidate_deployment_defect(
                root, manifest, "zero-write", publishers=1
            )

    def test_interrupting_an_accepted_run_publishes_one_terminal_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            process = self.start_cli(root, manifest)
            partial_directory = root / "runs" / ".RUN-001.partial"
            deadline = time.monotonic() + 2
            while not partial_directory.is_dir():
                self.assertIsNone(process.poll(), "runner exited before acceptance")
                self.assertLess(time.monotonic(), deadline, "runner was not accepted")
                time.sleep(0.01)

            process.terminate()
            stdout, stderr = process.communicate(timeout=5)

            self.assertEqual(process.returncode, 2, stderr)
            result = json.loads(stdout)
            self.assertEqual(result["result"], "zero_write_invocation_failed")
            self.assertIn("SIGTERM", result["reason"])
            run_directory = root / "runs" / "RUN-001"
            self.assertTrue(run_directory.is_dir())
            self.assertFalse((root / "runs" / ".RUN-001.partial").exists())
            reports = list(run_directory.glob("terminal-report*.json"))
            self.assertEqual(len(reports), 1)
            report = json.loads(reports[0].read_text())
            self.assertEqual(report["task_result"], "aborted")
            self.assertIn("SIGTERM", report["terminal_reason"])


if __name__ == "__main__":
    unittest.main()

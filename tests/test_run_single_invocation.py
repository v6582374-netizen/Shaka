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
INDETERMINATE_ASSESSMENT = {
    "button_visible": True,
    "designated_finger_visible": None,
    "contact_observed": None,
    "contact_panel_indices": [],
    "retreat_observed": None,
    "retreat_panel_indices": [],
    "wrong_finger_contact_observed": None,
    "visual_evidence_sufficient": False,
    "visual_result": "indeterminate",
    "uncertainty_reasons": ["zero-write evidence has no task attempt"],
    "summary": "no task outcome is visually established",
}


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
            json.dumps(
                {
                    "schema_version": 1,
                    "mode": "zero-write",
                    "control_contract": {
                        "action_definition_id": "g1-right-arm-position-v001",
                        "command_type": "joint_position",
                        "joint_names": joint_names,
                        "value_dimension": len(joint_names),
                        "maximum_output_age_ns": 100_000_000,
                    },
                },
                sort_keys=True,
            )
            + "\n",
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
        evaluator_directory = root / "evaluator"
        evaluator_directory.mkdir()
        evaluator_config = evaluator_directory / "evaluator.json"
        evaluator_config.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "evaluator_id": "offline-deterministic-v001",
                    "backend": "openai",
                    "model": "test-model",
                    "codex_model": "test-codex-model",
                    "image_detail": "high",
                    "maximum_panels": 4,
                    "pre_roll_seconds": 0.0,
                    "post_roll_seconds": 0.0,
                    "designated_fingertip": "right_index_fingertip",
                    "task_contract": "contact then retreat",
                    "audit_policy": {"mode": "shadow", "audit_all_results": True},
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        evaluator_prompt = evaluator_directory / "prompt.md"
        evaluator_prompt.write_text("judge visual facts\n", encoding="utf-8")
        manifest = root / "run-manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": 2,
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
                    "evaluator": {
                        "config_path": str(evaluator_config),
                        "config_sha256": sha256_file(evaluator_config),
                        "prompt_sha256": sha256_file(evaluator_prompt),
                    },
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

    def run_cli(
        self, root: Path, manifest: Path, *extra_arguments: str
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RECORDER_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": "healthy",
                "SHAKA_FAKE_RECORDER_AUDIT": str(root / "recorder-audit.jsonl"),
                "SHAKA_FAKE_MODEL_ASSESSMENT": json.dumps(
                    INDETERMINATE_ASSESSMENT
                ),
                "OPENAI_API_KEY": "test-key",
            }
        )
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--manifest",
                str(manifest),
                *extra_arguments,
            ],
            env=environment,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )

    def configure_connected_g1(self, manifest: Path) -> None:
        content = json.loads(manifest.read_text())
        content["connected_g1"] = {
            "schema_version": 1,
            "network_interface": "enp0s31f6",
            "camera_host": "192.168.123.164",
            "discovery_timeout_s": 1.0,
            "command_topics": ["rt/lowcmd"],
        }
        manifest.write_text(
            json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    def allow_connected_g1_command_publisher(
        self, manifest: Path, topic: str, participant_key: str
    ) -> None:
        content = json.loads(manifest.read_text())
        content["connected_g1"]["allowed_command_publishers"] = [
            {"topic": topic, "participant_key": participant_key}
        ]
        manifest.write_text(
            json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    def require_native_motion_controller_topology(self, manifest: Path) -> None:
        content = json.loads(manifest.read_text())
        content["connected_g1"]["native_motion_controller_topology"] = True
        manifest.write_text(
            json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    def start_cli(self, root: Path, manifest: Path) -> subprocess.Popen[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RECORDER_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": "healthy",
                "SHAKA_FAKE_RECORDER_AUDIT": str(root / "recorder-audit.jsonl"),
                "SHAKA_FAKE_MODEL_ASSESSMENT": json.dumps(
                    INDETERMINATE_ASSESSMENT
                ),
                "OPENAI_API_KEY": "test-key",
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
        self.replace_candidate_artifact(manifest, "implementation", source)

    def replace_candidate_artifact(
        self, manifest: Path, artifact_name: str, source: str
    ) -> None:
        manifest_content = json.loads(manifest.read_text())
        package_path = Path(manifest_content["candidate"]["package_path"])
        package = json.loads(package_path.read_text())
        reference = package["artifacts"][artifact_name]
        artifact = package_path.parent / reference["path"]
        artifact.write_text(source, encoding="utf-8")
        reference["sha256"] = sha256_file(artifact)
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
        reported_publishers: int | None = None,
        reported_writes: int | None = None,
    ) -> None:
        completed = self.run_cli(root, manifest)

        self.assertEqual(completed.returncode, 2)
        result = json.loads(completed.stdout)
        self.assertEqual(result["result"], "zero_write_candidate_rejected")
        self.assertEqual(result["failure_class"], "deployment_defect")
        self.assertEqual(result["physical_rollout_attempts_consumed"], 0)
        self.assertEqual(result["robot_runtime_consumed_s"], 0)
        self.assertEqual(result["command_publishers_created"], 0)
        self.assertEqual(result["writes"], 0)
        run_directory = root / "runs" / "RUN-001"
        report = json.loads((run_directory / "terminal-report.json").read_text())
        self.assertNotIn("task_result", report)
        self.assertEqual(report["failure_class"], "deployment_defect")
        self.assertEqual(report["physical_rollout_attempts_consumed"], 0)
        self.assertEqual(report["robot_runtime_consumed_s"], 0)
        self.assertEqual(report["command_publishers_created"], 0)
        self.assertEqual(report["writes"], 0)
        self.assertIn("invocation_evidence", report["artifacts"])
        candidate_result = json.loads(
            (run_directory / "artifacts" / "candidate-result.json").read_text()
        )
        self.assertEqual(candidate_result["deployment_status"], "rejected")
        self.assertEqual(candidate_result["failure_class"], "deployment_defect")
        self.assertIn(reason, candidate_result["reason"])
        self.assertEqual(len(candidate_result["candidate_output_sha256"]), 64)
        self.assertEqual(candidate_result["command_publishers_created"], 0)
        self.assertEqual(candidate_result["writes"], 0)
        recorder_events = [
            json.loads(line)["event"]
            for line in (run_directory / "artifacts" / "recorder-stdout.jsonl")
            .read_text()
            .splitlines()
        ]
        self.assertEqual(
            recorder_events,
            [
                "read_only_recorder_ready",
                "read_only_recorder_stop_requested",
                "read_only_recorder_completed",
            ],
        )
        if reported_publishers is not None:
            self.assertEqual(
                candidate_result["diagnostics"]["candidate_reported_command_publishers_created"],
                reported_publishers,
            )
        if reported_writes is not None:
            self.assertEqual(
                candidate_result["diagnostics"]["candidate_reported_writes"],
                reported_writes,
            )

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
            self.assertEqual(report["physical_rollout_attempts_consumed"], 0)
            self.assertEqual(report["robot_runtime_consumed_s"], 0)
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
                    "candidate_output_encoding": "canonical-json",
                    "candidate_reported_command_publishers_created": 0,
                    "candidate_reported_writes": 0,
                    "inference": "completed",
                    "output_validation": "compatible",
                    "preprocessed_input_encoding": "canonical-json",
                    "preprocessing": "completed",
                    "sandbox_policy": "bubblewrap-zero-write-v1",
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

    def test_connected_g1_cli_admits_a_recorder_snapshot_not_saved_observation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)

            completed = self.run_cli(root, manifest, "--connected-g1")

            self.assertEqual(completed.returncode, 0, completed.stderr)
            run_directory = root / "runs" / "RUN-001"
            report = json.loads((run_directory / "terminal-report.json").read_text())
            self.assertEqual(report["environment"], "connected-g1")
            self.assertEqual(report["command_publishers_created"], 0)
            self.assertEqual(report["writes"], 0)
            self.assertEqual(report["physical_rollout_attempts_consumed"], 0)
            self.assertEqual(report["robot_runtime_consumed_s"], 0)
            snapshot = report["artifacts"]["live_observation"]
            candidate_input = report["artifacts"]["candidate_input_observation"]
            saved_observation = report["artifacts"]["saved_candidate_observation"]
            self.assertEqual(candidate_input["sha256"], snapshot["sha256"])
            self.assertNotEqual(saved_observation["sha256"], snapshot["sha256"])
            live_observation = json.loads((run_directory / snapshot["path"]).read_text())
            self.assertEqual(live_observation["source"], "connected-g1-recorder-v1")
            self.assertEqual(
                set(live_observation["logical_views"]),
                {
                    "cam_left_high",
                    "cam_right_high",
                    "left_wrist_camera",
                    "right_wrist_camera",
                },
            )
            candidate_result = json.loads(
                (run_directory / "artifacts" / "candidate-result.json").read_text()
            )
            self.assertEqual(
                candidate_result["input_observation_sha256"], snapshot["sha256"]
            )
            self.assertNotEqual(
                candidate_result["input_observation_sha256"],
                json.loads(manifest.read_text())["candidate"]["observation"]["sha256"],
            )
            readiness = json.loads(
                (run_directory / "artifacts" / "readiness-result.json").read_text()
            )
            self.assertEqual(readiness["environment"], "connected-g1")
            self.assertEqual(readiness["competing_command_publishers"], 0)
            self.assertEqual(readiness["physical_camera_sources"], 3)
            self.assertEqual(readiness["logical_camera_views"], 4)
            adapter_audit = [
                json.loads(line)
                for line in (run_directory / "artifacts" / "adapter-audit.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertTrue(adapter_audit)
            for event in adapter_audit:
                self.assertEqual(event["command_publishers_created"], 0)
                self.assertEqual(event["writes"], 0)

    def test_connected_g1_rejects_a_competing_command_publisher_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            previous_publisher = os.environ.get("SHAKA_FAKE_COMMAND_PUBLISHER")
            os.environ["SHAKA_FAKE_COMMAND_PUBLISHER"] = "rt/lowcmd"
            try:
                completed = self.run_cli(root, manifest, "--connected-g1")
            finally:
                if previous_publisher is None:
                    os.environ.pop("SHAKA_FAKE_COMMAND_PUBLISHER", None)
                else:
                    os.environ["SHAKA_FAKE_COMMAND_PUBLISHER"] = previous_publisher

            self.assertEqual(completed.returncode, 2, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertIn("competing command publishers", result["reason"])
            report = json.loads(
                (root / "runs" / "RUN-001" / "terminal-report.json").read_text()
            )
            self.assertEqual(report["environment"], "connected-g1")
            self.assertEqual(report["completed_stage"], "invocation_authority_acquired")
            self.assertFalse(
                (root / "runs" / "RUN-001" / "artifacts" / "recorder-stdout.jsonl").exists()
            )

    def test_connected_g1_allows_the_manifest_bound_unique_control_entry(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            participant_key = "00000000-0000-0000-0000-000000000001"
            self.allow_connected_g1_command_publisher(
                manifest, "rt/lowcmd", participant_key
            )
            previous_publisher = os.environ.get("SHAKA_FAKE_COMMAND_PUBLISHER")
            os.environ["SHAKA_FAKE_COMMAND_PUBLISHER"] = "rt/lowcmd"
            try:
                completed = self.run_cli(root, manifest, "--connected-g1")
            finally:
                if previous_publisher is None:
                    os.environ.pop("SHAKA_FAKE_COMMAND_PUBLISHER", None)
                else:
                    os.environ["SHAKA_FAKE_COMMAND_PUBLISHER"] = previous_publisher

            self.assertEqual(completed.returncode, 0, completed.stderr)
            readiness = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "readiness-result.json").read_text()
            )
            self.assertEqual(readiness["control_authority"], "verified_unique_control_entry")
            self.assertEqual(
                readiness["observed_command_publishers"],
                [{"topic": "rt/lowcmd", "participant_key": participant_key}],
            )
            runtime = json.loads(
                (
                    root
                    / "runs"
                    / "RUN-001"
                    / "artifacts"
                    / "candidate-runtime-preflight.json"
                ).read_text()
            )
            self.assertTrue(runtime["ready"])
            stages = [
                json.loads(line)["stage"]
                for line in (root / "runs" / "RUN-001" / "lifecycle.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertLess(
                stages.index("candidate_runtime_ready"), stages.index("recorder_ready")
            )

    def test_connected_g1_verifies_rotating_native_motion_controller_topology(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            self.require_native_motion_controller_topology(manifest)
            previous_value = os.environ.get("SHAKA_FAKE_NATIVE_MOTION_CONTROLLER")
            os.environ["SHAKA_FAKE_NATIVE_MOTION_CONTROLLER"] = "1"
            try:
                completed = self.run_cli(root, manifest, "--connected-g1")
            finally:
                if previous_value is None:
                    os.environ.pop("SHAKA_FAKE_NATIVE_MOTION_CONTROLLER", None)
                else:
                    os.environ["SHAKA_FAKE_NATIVE_MOTION_CONTROLLER"] = previous_value

            self.assertEqual(completed.returncode, 0, completed.stderr)
            readiness = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "readiness-result.json").read_text()
            )
            self.assertEqual(
                readiness["control_authority"], "verified_native_motion_controller"
            )
            self.assertEqual(
                readiness["native_motion_controller_participant"],
                "00000000-0000-0000-0000-000000000001",
            )

    def test_connected_g1_rejects_multiple_allowed_control_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            content = json.loads(manifest.read_text())
            content["connected_g1"]["allowed_command_publishers"] = [
                {
                    "topic": "rt/lowcmd",
                    "participant_key": "00000000-0000-0000-0000-000000000001",
                },
                {
                    "topic": "rt/lowcmd",
                    "participant_key": "00000000-0000-0000-0000-000000000002",
                },
            ]
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest, "--connected-g1")

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("one unique control entry", result["reason"])
            self.assertFalse((root / "runs").exists())

    def test_connected_g1_requires_a_readable_g1_state_before_recording(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            previous_value = os.environ.get("SHAKA_FAKE_PREFLIGHT_EMPTY")
            os.environ["SHAKA_FAKE_PREFLIGHT_EMPTY"] = "1"
            try:
                completed = self.run_cli(root, manifest, "--connected-g1")
            finally:
                if previous_value is None:
                    os.environ.pop("SHAKA_FAKE_PREFLIGHT_EMPTY", None)
                else:
                    os.environ["SHAKA_FAKE_PREFLIGHT_EMPTY"] = previous_value

            self.assertEqual(completed.returncode, 2, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertIn("required DDS sample is absent", result["reason"])
            report = json.loads(
                (root / "runs" / "RUN-001" / "terminal-report.json").read_text()
            )
            self.assertEqual(report["completed_stage"], "invocation_authority_acquired")
            self.assertFalse(
                (root / "runs" / "RUN-001" / "artifacts" / "recorder-stdout.jsonl").exists()
            )

    def test_connected_g1_candidate_adapter_failure_releases_and_post_rolls(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.configure_connected_g1(manifest)
            previous_plan = os.environ.get("SHAKA_OFFLINE_ADAPTER_PLAN")
            os.environ["SHAKA_OFFLINE_ADAPTER_PLAN"] = json.dumps(
                {"candidate": {"failure": "simulated candidate adapter failure"}}
            )
            try:
                completed = self.run_cli(root, manifest, "--connected-g1")
            finally:
                if previous_plan is None:
                    os.environ.pop("SHAKA_OFFLINE_ADAPTER_PLAN", None)
                else:
                    os.environ["SHAKA_OFFLINE_ADAPTER_PLAN"] = previous_plan

            self.assertEqual(completed.returncode, 2, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["result"], "zero_write_invocation_failed")
            self.assertEqual(result["failure_class"], "runtime_failure")
            self.assertIn("simulated candidate adapter failure", result["reason"])
            run_directory = root / "runs" / "RUN-001"
            report = json.loads((run_directory / "terminal-report.json").read_text())
            self.assertEqual(report["environment"], "connected-g1")
            self.assertEqual(report["completed_stage"], "control_released")
            self.assertIn("invocation_evidence", report["artifacts"])
            recorder_events = [
                json.loads(line)["event"]
                for line in (run_directory / "artifacts" / "recorder-stdout.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertEqual(
                recorder_events,
                [
                    "read_only_recorder_ready",
                    "read_only_recorder_stop_requested",
                    "read_only_recorder_completed",
                ],
            )

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

    def test_rejects_a_missing_runtime_callable_before_starting_the_recorder(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            package_path = Path(content["candidate"]["package_path"])
            package = json.loads(package_path.read_text())
            package["runtime"]["inference"]["callable"] = "missing_infer"
            package_path.write_text(
                json.dumps(package, sort_keys=True) + "\n", encoding="utf-8"
            )
            content["candidate"]["package_sha256"] = sha256_file(package_path)
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            self.assertIn("inference callable is absent", json.loads(completed.stdout)["reason"])
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_a_candidate_action_contract_mismatch_before_recording(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            package_path = Path(content["candidate"]["package_path"])
            package = json.loads(package_path.read_text())
            reference = package["artifacts"]["action_definition"]
            definition_path = package_path.parent / reference["path"]
            definition = json.loads(definition_path.read_text())
            definition["command_type"] = "incompatible-command"
            definition_path.write_text(
                json.dumps(definition, sort_keys=True) + "\n", encoding="utf-8"
            )
            reference["sha256"] = sha256_file(definition_path)
            package_path.write_text(
                json.dumps(package, sort_keys=True) + "\n", encoding="utf-8"
            )
            content["candidate"]["package_sha256"] = sha256_file(package_path)
            manifest.write_text(json.dumps(content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            self.assertIn(
                "does not match the trusted control contract",
                json.loads(completed.stdout)["reason"],
            )
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_import_time_candidate_code_before_starting_the_recorder(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                '''raise RuntimeError("must not run during candidate validation")

def infer(model_input, configuration):
    return {}
''',
            )

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            self.assertIn(
                "must not execute code during import", json.loads(completed.stdout)["reason"]
            )
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_rejects_non_integral_action_dimensions_before_recording(self) -> None:
        for dimension in (True, 3.0):
            with self.subTest(dimension=dimension), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                manifest = self.write_fixture(root)
                content = json.loads(manifest.read_text())
                package_path = Path(content["candidate"]["package_path"])
                package = json.loads(package_path.read_text())
                reference = package["artifacts"]["action_definition"]
                definition_path = package_path.parent / reference["path"]
                definition = json.loads(definition_path.read_text())
                definition["value_dimension"] = dimension
                definition_path.write_text(
                    json.dumps(definition, sort_keys=True) + "\n", encoding="utf-8"
                )
                reference["sha256"] = sha256_file(definition_path)
                package_path.write_text(
                    json.dumps(package, sort_keys=True) + "\n", encoding="utf-8"
                )
                content["candidate"]["package_sha256"] = sha256_file(package_path)
                manifest.write_text(json.dumps(content), encoding="utf-8")

                completed = self.run_cli(root, manifest)

                self.assertEqual(completed.returncode, 2)
                self.assertIn(
                    "candidate action definition dimension must match joints",
                    json.loads(completed.stdout)["reason"],
                )
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

            self.assert_candidate_deployment_defect(root, manifest, "JSON-serializable")

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

    def test_future_timestamp_is_a_zero_budget_deployment_defect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"] + 1,
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "in the future")

    def test_admits_a_non_json_preprocessed_input_with_binary_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_artifact(
                manifest,
                "input_preprocessor",
                """def preprocess(observation, configuration):
    return {
        "observation_time_ns": observation["captured_at_ns"],
        "scale": configuration["scale"],
        "opaque": {"candidate", "input"},
    }
""",
            )

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "candidate-result.json").read_text()
            )
            self.assertEqual(
                result["diagnostics"]["preprocessed_input_encoding"], "pickle-v5"
            )
            self.assertEqual(len(result["preprocessed_input_sha256"]), 64)

    def test_non_json_output_is_a_zero_budget_deployment_defect_with_evidence(
        self,
    ) -> None:
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
        "debug": {"not", "json"},
    }
""",
            )

            self.assert_candidate_deployment_defect(root, manifest, "JSON-serializable")
            candidate_result = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "candidate-result.json").read_text()
            )
            self.assertEqual(
                candidate_result["diagnostics"]["candidate_output_encoding"],
                "pickle-v5",
            )

    def test_sandbox_blocks_a_host_write_when_candidate_omits_counters(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            target = root / "host-write-target.txt"
            target.write_text("unchanged\n", encoding="utf-8")
            content = json.loads(manifest.read_text())
            package_path = Path(content["candidate"]["package_path"])
            package = json.loads(package_path.read_text())
            configuration_reference = package["artifacts"]["configuration"]
            configuration_path = package_path.parent / configuration_reference["path"]
            configuration = json.loads(configuration_path.read_text())
            configuration["host_write_target"] = str(target)
            configuration_path.write_text(
                json.dumps(configuration, sort_keys=True) + "\n", encoding="utf-8"
            )
            configuration_reference["sha256"] = sha256_file(configuration_path)
            package_path.write_text(
                json.dumps(package, sort_keys=True) + "\n", encoding="utf-8"
            )
            content["candidate"]["package_sha256"] = sha256_file(package_path)
            manifest.write_text(json.dumps(content), encoding="utf-8")
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    from pathlib import Path
    try:
        Path(configuration["host_write_target"]).write_text("modified\\n", encoding="utf-8")
    except OSError:
        pass
    return {
        "action_definition_id": configuration["action_definition_id"],
        "timestamp_ns": model_input["observation_time_ns"],
        "joint_names": configuration["joint_names"],
        "values": [0.1, 0.2, 0.3],
    }
""",
            )

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(target.read_text(encoding="utf-8"), "unchanged\n")
            candidate_result = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "candidate-result.json").read_text()
            )
            self.assertEqual(candidate_result["command_publishers_created"], 0)
            self.assertEqual(candidate_result["writes"], 0)
            self.assertEqual(
                candidate_result["diagnostics"]["candidate_reported_command_publishers_created"],
                0,
            )
            self.assertEqual(candidate_result["diagnostics"]["candidate_reported_writes"], 0)

    def test_sandbox_hides_an_evaluator_outside_the_candidate_replay_bundle(
        self,
    ) -> None:
        with (
            tempfile.TemporaryDirectory() as temporary,
            tempfile.TemporaryDirectory(dir="/var/tmp") as evaluator_temporary,
        ):
            root = Path(temporary)
            evaluator_root = Path(evaluator_temporary)
            manifest = self.write_fixture(root)
            manifest_content = json.loads(manifest.read_text())
            original_evaluator = Path(manifest_content["evaluator"]["config_path"])
            external_evaluator = evaluator_root / "evaluator.json"
            external_prompt = evaluator_root / "prompt.md"
            external_evaluator.write_bytes(original_evaluator.read_bytes())
            external_prompt.write_bytes(original_evaluator.with_name("prompt.md").read_bytes())
            manifest_content["evaluator"]["config_path"] = str(external_evaluator)
            manifest_content["evaluator"]["config_sha256"] = sha256_file(
                external_evaluator
            )
            manifest_content["evaluator"]["prompt_sha256"] = sha256_file(
                external_prompt
            )
            manifest.write_text(json.dumps(manifest_content), encoding="utf-8")
            secret = evaluator_root / "evaluator-secret.txt"
            secret.write_text("EVALUATOR-SECRET-EXFILTRATED", encoding="utf-8")
            self.replace_candidate_artifact(
                manifest,
                "configuration",
                json.dumps(
                    {
                        "action_definition_id": "g1-right-arm-position-v001",
                        "joint_names": [
                            "right_shoulder_pitch_joint",
                            "right_elbow_joint",
                            "right_wrist_pitch_joint",
                        ],
                        "scale": 0.5,
                        "value": 0.2,
                        "evaluator_secret_path": str(secret),
                    },
                    sort_keys=True,
                ),
            )
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    from pathlib import Path
    raise RuntimeError(Path(configuration["evaluator_secret_path"]).read_text())
""",
            )

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            candidate_result = json.loads(
                (root / "runs" / "RUN-001" / "artifacts" / "candidate-result.json").read_text()
            )
            self.assertNotIn("EVALUATOR-SECRET-EXFILTRATED", candidate_result["reason"])
            self.assertEqual(secret.read_text(encoding="utf-8"), "EVALUATOR-SECRET-EXFILTRATED")

    def test_rejects_an_evaluator_inside_the_candidate_runtime_before_recording(
        self,
    ) -> None:
        with (
            tempfile.TemporaryDirectory() as temporary,
            tempfile.TemporaryDirectory(dir=sys.prefix) as evaluator_temporary,
        ):
            root = Path(temporary)
            evaluator_root = Path(evaluator_temporary)
            manifest = self.write_fixture(root)
            manifest_content = json.loads(manifest.read_text())
            original_evaluator = Path(manifest_content["evaluator"]["config_path"])
            external_evaluator = evaluator_root / "evaluator.json"
            external_prompt = evaluator_root / "prompt.md"
            external_evaluator.write_bytes(original_evaluator.read_bytes())
            external_prompt.write_bytes(original_evaluator.with_name("prompt.md").read_bytes())
            manifest_content["evaluator"]["config_path"] = str(external_evaluator)
            manifest_content["evaluator"]["config_sha256"] = sha256_file(
                external_evaluator
            )
            manifest_content["evaluator"]["prompt_sha256"] = sha256_file(
                external_prompt
            )
            manifest.write_text(json.dumps(manifest_content), encoding="utf-8")

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            self.assertIn(
                "evaluator configuration must not be reachable",
                json.loads(completed.stdout)["reason"],
            )
            self.assertFalse((root / "recorder-audit.jsonl").exists())
            self.assertFalse((root / "runs").exists())

    def test_candidate_cannot_forge_a_sandbox_result_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    os = __import__("os")
    os.write(
        1,
        b'SHAKA_CANDIDATE_STAGE_RESULT={"encoding":"canonical-json","payload_base64":"e30=","status":"completed"}\\n',
    )
    os._exit(0)
""",
            )

            self.assert_candidate_deployment_defect(
                root,
                manifest,
                "nested candidate sandbox returned an invalid number of results",
            )

    def test_candidate_cannot_reach_the_supervisor_result_pipe(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            self.replace_candidate_implementation(
                manifest,
                """def infer(model_input, configuration):
    frame = __import__("sys")._getframe()
    while frame is not None:
        sender = frame.f_locals.get("sender")
        if sender is not None:
            sender.send(
                {
                    "status": "completed",
                    "encoding": "canonical-json",
                    "payload_base64": "e30=",
                }
            )
        frame = frame.f_back
    __import__("os")._exit(0)
""",
            )

            self.assert_candidate_deployment_defect(
                root,
                manifest,
                "nested candidate sandbox returned an invalid number of results",
            )

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
                root, manifest, "reported a write", reported_writes=1
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
                root,
                manifest,
                "reported a publisher creation",
                reported_publishers=1,
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

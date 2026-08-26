from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_single_invocation.py"
EVALUATOR_SCRIPT = ROOT / "scripts" / "evaluate_episode_with_vlm.py"
FAKE_RUNTIME = ROOT / "tests" / "support" / "recorder_runtime"
HISTORICAL_V002 = Path(
    "/mnt/data-hdd/Shaka/evaluator-evidence-smoke/SMOKE-20260826-static-002"
)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class InvocationEvaluationIntegrationTest(unittest.TestCase):
    def write_fixture(self, root: Path) -> Path:
        preprocessor = root / "preprocess.py"
        preprocessor.write_text(
            """def preprocess(observation, configuration):
    return {"observation_time_ns": observation["captured_at_ns"]}
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
        "values": [0.0] * len(configuration["joint_names"]),
        "command_publishers_created": 0,
        "writes": 0,
    }
""",
            encoding="utf-8",
        )
        joint_names = ["right_shoulder_pitch_joint", "right_elbow_joint"]
        candidate_config = root / "candidate-config.json"
        candidate_config.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "action_definition_id": "g1-right-arm-position-v001",
                    "joint_names": joint_names,
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
        observation = root / "observation.json"
        observation.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "observation_id": "observation-eval-001",
                    "captured_at_ns": 1_000_000_000,
                    "robot_state": {"joint_names": joint_names},
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        candidate = root / "candidate.json"
        candidate.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": "candidate-v001",
                    "deployment_evidence": {
                        "preprocessing": "synthetic-observation-v001",
                        "output_shape": [26],
                    },
                    "source_version": "fixture-candidate-v001",
                    "artifacts": {
                        "implementation": {
                            "path": implementation.name,
                            "sha256": sha256_file(implementation),
                        },
                        "configuration": {
                            "path": candidate_config.name,
                            "sha256": sha256_file(candidate_config),
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
                    "visual_assessment": {
                        "visual_result": "succeeded",
                        "summary": "candidate-authored claims are not evaluator facts",
                    },
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        safety = root / "safety.json"
        safety.write_text(
            json.dumps({"schema_version": 1, "mode": "zero-write"}) + "\n",
            encoding="utf-8",
        )
        budget = root / "budget.json"
        budget.write_text(
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
                    "evaluator_id": "test-yellow-button-vlm-v001",
                    "backend": "openai",
                    "model": "test-model",
                    "codex_model": "test-codex-model",
                    "image_detail": "high",
                    "maximum_panels": 4,
                    "pre_roll_seconds": 0.0,
                    "post_roll_seconds": 0.0,
                    "designated_fingertip": "right_index_fingertip",
                    "task_contract": "right index fingertip contact then retreat",
                    "audit_policy": {"mode": "shadow", "audit_all_results": True},
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        prompt = evaluator_directory / "prompt.md"
        prompt.write_text(
            "judge only the chronological visual evidence\n", encoding="utf-8"
        )
        manifest = root / "run-manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "run_id": "RUN-EVAL-001",
                    "invocation_id": "INVOCATION-EVAL-001",
                    "execution_mode": "zero-write",
                    "candidate": {
                        "candidate_id": "candidate-v001",
                        "package_path": str(candidate),
                        "package_sha256": sha256_file(candidate),
                        "observation": {
                            "path": str(observation),
                            "sha256": sha256_file(observation),
                        },
                    },
                    "task_contract_version": "yellow-button-contact-v001",
                    "evaluator_version": "test-yellow-button-vlm-v001",
                    "evaluator": {
                        "config_path": str(evaluator_config),
                        "config_sha256": sha256_file(evaluator_config),
                        "prompt_sha256": sha256_file(prompt),
                    },
                    "standard_start_version": "g1-evaluator-v001",
                    "safety_config": {
                        "path": str(safety),
                        "sha256": sha256_file(safety),
                    },
                    "maximum_duration_s": 3.0,
                    "budget_reference": "offline-budget-001",
                    "budget_artifact": {
                        "path": str(budget),
                        "sha256": sha256_file(budget),
                    },
                    "rollback_candidate_id": "candidate-v000",
                    "output_root": str(root / "runs"),
                    "recorder": {
                        "post_roll_s": 0.03,
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

    def assessment(self, visual_result: str) -> dict[str, object]:
        succeeded = visual_result == "succeeded"
        return {
            "button_visible": True,
            "designated_finger_visible": True,
            "contact_observed": succeeded,
            "contact_panel_indices": [1] if succeeded else [],
            "retreat_observed": succeeded,
            "retreat_panel_indices": [2] if succeeded else [],
            "wrong_finger_contact_observed": False,
            "visual_evidence_sufficient": visual_result != "indeterminate",
            "visual_result": visual_result,
            "uncertainty_reasons": (
                ["synthetic evidence is inconclusive"]
                if visual_result == "indeterminate"
                else []
            ),
            "summary": f"replacement model returned {visual_result}",
        }

    def run_cli(
        self,
        root: Path,
        manifest: Path,
        *,
        visual_result: str = "succeeded",
        controller_outcome: str = "completed",
        controller_end_offset_ns: int = 0,
        model_available: bool = True,
        recorded_episode_id: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONPATH": str(FAKE_RUNTIME),
                "SHAKA_FAKE_RECORDER_MODE": "healthy",
                "SHAKA_FAKE_RECORDER_AUDIT": str(root / "recorder-audit.jsonl"),
                "SHAKA_FAKE_MODEL_ASSESSMENT": json.dumps(
                    self.assessment(visual_result)
                ),
                "SHAKA_OFFLINE_ADAPTER_PLAN": json.dumps(
                    {
                        "release": {
                            "controller_outcome": controller_outcome,
                            "controller_end_offset_ns": controller_end_offset_ns,
                        }
                    }
                ),
            }
        )
        if model_available:
            environment["OPENAI_API_KEY"] = "test-key"
        else:
            environment.pop("OPENAI_API_KEY", None)
        if recorded_episode_id is not None:
            environment["SHAKA_FAKE_RECORDED_EPISODE_ID"] = recorded_episode_id
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--manifest", str(manifest)],
            env=environment,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )

    def test_public_cli_finalizes_prepares_and_evaluates_complete_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            run_directory = root / "runs" / "RUN-EVAL-001"
            report = json.loads((run_directory / "terminal-report.json").read_text())
            self.assertEqual(report["task_result"], "succeeded")
            self.assertEqual(
                report["evaluation"]["evaluator_id"], "test-yellow-button-vlm-v001"
            )
            self.assertEqual(report["evaluation"]["task_result"], "succeeded")
            self.assertTrue(report["evaluation"]["human_audit_required"])
            for artifact in (
                "invocation_evidence",
                "evaluator_configuration",
                "frozen_evaluator_prompt",
                "prepared_evidence",
                "model_result",
            ):
                self.assertIn(artifact, report["artifacts"])
            stages = [
                json.loads(line)["stage"]
                for line in (run_directory / "lifecycle.jsonl").read_text().splitlines()
            ]
            self.assertLess(
                stages.index("evidence_completed"), stages.index("evaluation_completed")
            )
            evaluation = json.loads(
                (
                    run_directory / report["artifacts"]["model_result"]["path"]
                ).read_text()
            )
            self.assertEqual(evaluation["result"], "succeeded")
            self.assertEqual(
                evaluation["visual_assessment"]["summary"],
                "replacement model returned succeeded",
            )
            evidence_manifest = json.loads(
                (
                    run_directory
                    / report["artifacts"]["prepared_evidence"]["path"]
                    / "evidence_manifest.json"
                ).read_text()
            )
            self.assertTrue(evidence_manifest["capture_complete"])
            self.assertGreaterEqual(len(evidence_manifest["panels"]), 2)
            self.assertEqual(evidence_manifest["episode_id"], "INVOCATION-EVAL-001")
            self.assertEqual(
                evidence_manifest["source_invocation_summary"]["controller_outcome"],
                "completed",
            )
            self.assertTrue(
                evidence_manifest["source_invocation_summary"]["capture_valid"]
            )
            source_directory = Path(evidence_manifest["source_episode_directory"])
            self.assertFalse(source_directory.is_absolute())
            prepared_directory = (
                run_directory / report["artifacts"]["prepared_evidence"]["path"]
            )
            self.assertTrue((prepared_directory / source_directory).resolve().is_dir())

            environment = os.environ.copy()
            environment.update(
                {
                    "PYTHONPATH": str(FAKE_RUNTIME),
                    "SHAKA_FAKE_RECORDER_AUDIT": str(root / "reevaluation-audit.jsonl"),
                    "SHAKA_FAKE_MODEL_ASSESSMENT": json.dumps(
                        self.assessment("succeeded")
                    ),
                    "OPENAI_API_KEY": "test-key",
                }
            )
            reevaluated = subprocess.run(
                [
                    sys.executable,
                    str(EVALUATOR_SCRIPT),
                    "evaluate",
                    "--evidence-directory",
                    str(prepared_directory),
                    "--config",
                    str(
                        run_directory
                        / report["artifacts"]["evaluator_configuration"]["path"]
                    ),
                    "--output",
                    str(root / "reevaluated-model-result.json"),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            self.assertEqual(reevaluated.returncode, 0, reevaluated.stderr)
            self.assertEqual(json.loads(reevaluated.stdout)["task_result"], "succeeded")

    def test_replacement_model_covers_failed_and_indeterminate_results(self) -> None:
        for index, visual_result in enumerate(("failed", "indeterminate"), start=1):
            with (
                self.subTest(visual_result=visual_result),
                tempfile.TemporaryDirectory() as temporary,
            ):
                root = Path(temporary)
                manifest = self.write_fixture(root)
                content = json.loads(manifest.read_text())
                content["run_id"] = f"RUN-EVAL-{index + 1:03d}"
                content["invocation_id"] = f"INVOCATION-EVAL-{index + 1:03d}"
                manifest.write_text(json.dumps(content), encoding="utf-8")

                completed = self.run_cli(root, manifest, visual_result=visual_result)

                self.assertEqual(completed.returncode, 0, completed.stderr)
                report = json.loads(
                    (
                        root / "runs" / content["run_id"] / "terminal-report.json"
                    ).read_text()
                )
                self.assertEqual(report["task_result"], visual_result)

    def test_incomplete_capture_overrides_an_optimistic_visual_model(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)

            completed = self.run_cli(
                root,
                manifest,
                visual_result="succeeded",
                controller_end_offset_ns=1_000_000_000,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            run_directory = root / "runs" / "RUN-EVAL-001"
            report = json.loads((run_directory / "terminal-report.json").read_text())
            self.assertEqual(report["task_result"], "indeterminate")
            prepared = run_directory / report["artifacts"]["prepared_evidence"]["path"]
            evidence_manifest = json.loads(
                (prepared / "evidence_manifest.json").read_text()
            )
            self.assertFalse(evidence_manifest["capture_complete"])

    @unittest.skipUnless(
        HISTORICAL_V002.is_dir(), "controlled historical v002 evidence is unavailable"
    )
    def test_real_historical_v002_evidence_stays_indeterminate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            run_manifest = json.loads(manifest.read_text())
            evaluator_config = Path(run_manifest["evaluator"]["config_path"])
            prepared_directory = root / "historical-v002-prepared"

            prepared = subprocess.run(
                [
                    sys.executable,
                    str(EVALUATOR_SCRIPT),
                    "prepare",
                    "--episode-directory",
                    str(HISTORICAL_V002),
                    "--output-directory",
                    str(prepared_directory),
                    "--config",
                    str(evaluator_config),
                ],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            prepared_manifest = json.loads(
                (prepared_directory / "evidence_manifest.json").read_text()
            )
            self.assertEqual(
                prepared_manifest["episode_id"], "SMOKE-20260826-static-002"
            )
            self.assertFalse(prepared_manifest["capture_complete"])

            environment = os.environ.copy()
            environment.update(
                {
                    "PYTHONPATH": str(FAKE_RUNTIME),
                    "SHAKA_FAKE_RECORDER_AUDIT": str(root / "historical-audit.jsonl"),
                    "SHAKA_FAKE_MODEL_ASSESSMENT": json.dumps(
                        self.assessment("succeeded")
                    ),
                    "OPENAI_API_KEY": "test-key",
                }
            )
            evaluated = subprocess.run(
                [
                    sys.executable,
                    str(EVALUATOR_SCRIPT),
                    "evaluate",
                    "--evidence-directory",
                    str(prepared_directory),
                    "--config",
                    str(evaluator_config),
                    "--output",
                    str(root / "historical-v002-model-result.json"),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            self.assertEqual(evaluated.returncode, 0, evaluated.stderr)
            self.assertEqual(json.loads(evaluated.stdout)["task_result"], "indeterminate")

    def test_controller_outcomes_override_an_optimistic_visual_model(self) -> None:
        for controller_outcome, expected in (
            ("aborted", "aborted"),
            ("abstained", "abstained"),
        ):
            with (
                self.subTest(controller_outcome=controller_outcome),
                tempfile.TemporaryDirectory() as temporary,
            ):
                root = Path(temporary)
                manifest = self.write_fixture(root)

                completed = self.run_cli(
                    root,
                    manifest,
                    visual_result="succeeded",
                    controller_outcome=controller_outcome,
                )

                self.assertEqual(completed.returncode, 0, completed.stderr)
                report = json.loads(
                    (
                        root / "runs" / "RUN-EVAL-001" / "terminal-report.json"
                    ).read_text()
                )
                self.assertEqual(report["task_result"], expected)

    def test_evaluator_failure_has_no_fabricated_task_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)

            completed = self.run_cli(root, manifest, model_available=False)

            self.assertEqual(completed.returncode, 2, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertIn("OPENAI_API_KEY", result["reason"])
            report = json.loads(
                (root / "runs" / "RUN-EVAL-001" / "terminal-report.json").read_text()
            )
            self.assertEqual(report["completed_stage"], "evidence_completed")
            self.assertIsNone(report["task_result"])
            self.assertNotIn("evaluation", report)

    def test_identity_mismatch_never_reaches_the_evaluator(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)

            completed = self.run_cli(
                root,
                manifest,
                recorded_episode_id="DIFFERENT-INVOCATION",
            )

            self.assertEqual(completed.returncode, 2, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertIn("evidence identity", result["reason"])
            run_directory = root / "runs" / "RUN-EVAL-001"
            report = json.loads((run_directory / "terminal-report.json").read_text())
            self.assertNotIn("model_result", report["artifacts"])
            adapter_events = [
                json.loads(line)["adapter"]
                for line in (run_directory / "artifacts" / "adapter-audit.jsonl")
                .read_text()
                .splitlines()
            ]
            self.assertNotIn("evaluation", adapter_events)


if __name__ == "__main__":
    unittest.main()

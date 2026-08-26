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
FAKE_RECORDER_RUNTIME = ROOT / "tests" / "support" / "recorder_runtime"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SingleInvocationRunnerTest(unittest.TestCase):
    def write_fixture(self, root: Path) -> Path:
        candidate_script = root / "candidate.py"
        candidate_script.write_text(
            """
import json
print(json.dumps({
    "deployment_status": "completed",
    "command_publishers_created": 0,
    "writes": 0,
    "deployment_evidence": {"preprocessing": "offline-deterministic"}
}, sort_keys=True))
""".lstrip(),
            encoding="utf-8",
        )
        candidate_package = root / "candidate-package.json"
        candidate_package.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "candidate_id": "candidate-v001",
                    "entrypoint": [sys.executable, str(candidate_script)],
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

    def update_manifest(self, manifest: Path, **values: object) -> None:
        content = json.loads(manifest.read_text())
        content.update(values)
        manifest.write_text(
            json.dumps(content, indent=2, sort_keys=True) + "\n", encoding="utf-8"
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
            self.assertEqual(
                report["artifacts"]["safety_configuration"]["sha256"],
                manifest_content["safety_config"]["sha256"],
            )
            readiness_path = (
                run_directory / report["artifacts"]["readiness_result"]["path"]
            )
            readiness = json.loads(readiness_path.read_text())
            self.assertTrue(readiness["ready"])
            self.assertEqual(readiness["execution_mode"], "zero-write")
            self.assertEqual(readiness["command_publishers_created"], 0)
            self.assertEqual(readiness["writes"], 0)
            self.assertTrue(
                (run_directory / report["artifacts"]["invocation_evidence"]["path"])
                .joinpath("sha256.txt")
                .is_file()
            )

            recorder_audit = (root / "recorder-audit.jsonl").read_text()
            self.assertNotIn("publisher", recorder_audit)
            self.assertNotIn("write", recorder_audit)

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

    def test_rejects_a_candidate_attempt_to_supply_the_task_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = self.write_fixture(root)
            content = json.loads(manifest.read_text())
            package_path = Path(content["candidate"]["package_path"])
            package = json.loads(package_path.read_text())
            candidate_script = Path(package["entrypoint"][1])
            candidate_script.write_text(
                """
import json
print(json.dumps({
    "deployment_status": "completed",
    "command_publishers_created": 0,
    "writes": 0,
    "task_result": "succeeded"
}, sort_keys=True))
""".lstrip(),
                encoding="utf-8",
            )

            completed = self.run_cli(root, manifest)

            self.assertEqual(completed.returncode, 2)
            result = json.loads(completed.stdout)
            self.assertIn("must not contain a task result", result["reason"])
            self.assertEqual(result["command_publishers_created"], 0)
            self.assertEqual(result["writes"], 0)
            self.assertFalse((root / "runs" / "RUN-001").exists())
            partial = root / "runs" / ".RUN-001.partial"
            self.assertTrue(partial.is_dir())
            self.assertFalse(any(partial.glob("terminal-report*.json")))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_connected_g1_vla_zero_write.py"
SPEC = importlib.util.spec_from_file_location("run_connected_g1_vla_zero_write", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
LAUNCHER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = LAUNCHER
SPEC.loader.exec_module(LAUNCHER)


class ConnectedG1ZeroWriteLauncherTest(unittest.TestCase):
    def write_template(self, directory: Path) -> Path:
        template = directory / "template.json"
        template.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "execution_mode": "zero-write",
                    "run_id": "OLD-RUN",
                    "invocation_id": "OLD-RUN",
                    "output_root": str(directory / "runs"),
                }
            ),
            encoding="utf-8",
        )
        return template

    def test_prepares_a_fresh_single_use_manifest_without_running_it(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            template = self.write_template(directory)
            prepared = LAUNCHER.prepare(template, "G1-ZERO-WRITE-001")

            manifest = json.loads(prepared.path.read_text(encoding="utf-8"))
            original = json.loads(template.read_text(encoding="utf-8"))
            self.assertEqual(manifest["run_id"], "G1-ZERO-WRITE-001")
            self.assertEqual(manifest["invocation_id"], "G1-ZERO-WRITE-001")
            self.assertEqual(manifest["execution_mode"], "zero-write")
            self.assertEqual(
                manifest["maximum_duration_s"], LAUNCHER.ZERO_WRITE_MAXIMUM_DURATION_S
            )
            self.assertEqual(
                prepared.sha256, hashlib.sha256(prepared.path.read_bytes()).hexdigest()
            )
            self.assertEqual(original["run_id"], "OLD-RUN")

    def test_rejects_any_non_zero_write_template(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            template = self.write_template(directory)
            content = json.loads(template.read_text(encoding="utf-8"))
            content["execution_mode"] = "physical"
            template.write_text(json.dumps(content), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "zero-write"):
                LAUNCHER.prepare(template, "G1-ZERO-WRITE-001")

    def test_rejects_reusing_a_prepared_identity(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            template = self.write_template(directory)
            LAUNCHER.prepare(template, "G1-ZERO-WRITE-001")

            with self.assertRaisesRegex(FileExistsError, "already exists"):
                LAUNCHER.prepare(template, "G1-ZERO-WRITE-001")


if __name__ == "__main__":
    unittest.main()

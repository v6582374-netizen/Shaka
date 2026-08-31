from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import tempfile
import unittest

from scripts.verify_qwen_feedback_cycle import verify


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_DIRECTORY = REPOSITORY_ROOT / "artifacts" / "qwen-feedback-cycle"


def tree_digest(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(directory).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


class QwenCycleVerifierTest(unittest.TestCase):
    def test_verifies_bundle_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            evidence = Path(temporary_directory) / "evidence"
            shutil.copytree(EVIDENCE_DIRECTORY, evidence)
            before = tree_digest(evidence)

            result = verify(evidence)

            self.assertTrue(result["verified"])
            self.assertEqual(result["round_decisions"], ["adjust", "accept"])
            self.assertEqual(tree_digest(evidence), before)

    def test_rejects_a_tampered_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            evidence = Path(temporary_directory) / "evidence"
            shutil.copytree(EVIDENCE_DIRECTORY, evidence)
            path = evidence / "round-2-result.json"
            path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                verify(evidence)


if __name__ == "__main__":
    unittest.main()

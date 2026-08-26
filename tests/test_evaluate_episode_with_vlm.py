from __future__ import annotations

import csv
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from PIL import Image

SCRIPT = Path(__file__).parents[1] / "scripts" / "evaluate_episode_with_vlm.py"
SPEC = importlib.util.spec_from_file_location("evaluate_episode_with_vlm", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeResponses:
    def __init__(self, assessment: object) -> None:
        self.assessment = assessment
        self.arguments = None

    def parse(self, **arguments: object) -> object:
        self.arguments = arguments
        return SimpleNamespace(id="response-1", output_parsed=self.assessment)


class FakeClient:
    def __init__(self, assessment: object) -> None:
        self.responses = FakeResponses(assessment)


class VLMEpisodeEvaluatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.episode = self.root / "episode"
        self.episode.mkdir()
        (self.episode / "cameras" / "head_camera").mkdir(parents=True)
        (self.episode / "cameras" / "left_wrist_camera").mkdir(parents=True)
        (self.episode / "cameras" / "right_wrist_camera").mkdir(parents=True)
        rows = []
        for index, frame_time_ns in enumerate((1_000, 2_000, 3_000)):
            head_path = (
                self.episode
                / "cameras"
                / "head_camera"
                / f"{index:012d}.jpg"
            )
            head = Image.new("RGB", (1280, 480), "red")
            Image.new("RGB", (640, 480), "blue").save(self.root / "right.jpg")
            head.paste(Image.open(self.root / "right.jpg"), (640, 0))
            head.save(head_path)
            for camera_id, color in (
                ("left_wrist_camera", "green"),
                ("right_wrist_camera", "yellow"),
            ):
                path = self.episode / "cameras" / camera_id / f"{index:012d}.jpg"
                Image.new("RGB", (640, 480), color).save(path)
            for camera_id in MODULE.PHYSICAL_CAMERAS:
                path = self.episode / "cameras" / camera_id / f"{index:012d}.jpg"
                rows.append(
                    {
                        "camera_id": camera_id,
                        "file_name": str(path.relative_to(self.episode)),
                        "frame_time_ns": frame_time_ns,
                        "payload_sha256": MODULE._sha256_file(path),
                    }
                )
        with (self.episode / "camera_timestamps.csv").open(
            "w", newline="", encoding="utf-8"
        ) as stream:
            writer = csv.DictWriter(
                stream,
                fieldnames=[
                    "camera_id",
                    "file_name",
                    "frame_time_ns",
                    "payload_sha256",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)
        (self.episode / "capture_metadata.json").write_text(
            json.dumps(
                {
                    "episode_id": "episode-1",
                    "controller": {
                        "outcome": "completed",
                        "estimated_start_ns": 1_200,
                        "estimated_end_ns": 2_800,
                    },
                    "capture_quality": {"valid": True},
                }
            )
        )
        (self.episode / "sha256.txt").write_text("manifest\n")
        self.config_directory = self.root / "config"
        self.config_directory.mkdir()
        (self.config_directory / "evaluator.json").write_text(
            json.dumps(
                {
                    "evaluator_id": "test-evaluator",
                    "backend": "auto",
                    "model": "test-model",
                    "codex_model": "test-codex-model",
                    "image_detail": "high",
                    "maximum_panels": 3,
                    "pre_roll_seconds": 0.0,
                    "post_roll_seconds": 0.0,
                    "designated_fingertip": "right_index_fingertip",
                    "task_contract": "contact then retreat",
                    "audit_policy": {
                        "mode": "shadow",
                        "audit_all_results": True,
                    },
                }
            )
        )
        (self.config_directory / "prompt.md").write_text("judge visual facts")
        self.config = self.config_directory / "evaluator.json"

    def _assessment(self, result: str = "succeeded") -> object:
        return MODULE.VisualAssessment(
            button_visible=True,
            designated_finger_visible=True,
            contact_observed=True,
            contact_panel_indices=[1],
            retreat_observed=True,
            retreat_panel_indices=[2],
            wrong_finger_contact_observed=False,
            visual_evidence_sufficient=True,
            visual_result=result,
            uncertainty_reasons=[],
            summary="contact and retreat are visible",
        )

    def test_prepares_chronological_four_view_panels(self) -> None:
        output = self.root / "evidence"

        manifest = MODULE.prepare_evidence(self.episode, output, self.config)

        self.assertTrue(manifest["capture_complete"])
        self.assertEqual(len(manifest["panels"]), 2)
        panel = Image.open(output / manifest["panels"][0]["path"])
        self.assertEqual(panel.size, (1280, 1008))
        self.assertGreater(panel.getpixel((100, 100))[0], 200)
        self.assertGreater(panel.getpixel((700, 100))[2], 200)
        self.assertGreater(panel.getpixel((100, 600))[1], 50)
        red, green, _ = panel.getpixel((700, 600))
        self.assertGreater(red, 150)
        self.assertGreater(green, 150)

    def test_incomplete_capture_overrides_visual_success(self) -> None:
        result = MODULE.adjudicate(False, {"outcome": "completed"}, self._assessment())
        self.assertEqual(result, "indeterminate")

    def test_controller_abort_overrides_visual_success(self) -> None:
        result = MODULE.adjudicate(True, {"outcome": "aborted"}, self._assessment())
        self.assertEqual(result, "aborted")

    def test_calls_responses_api_with_images_and_structured_output(self) -> None:
        evidence = self.root / "evidence"
        MODULE.prepare_evidence(self.episode, evidence, self.config)
        client = FakeClient(self._assessment())

        result = MODULE.evaluate_evidence(
            evidence, self.config, client=client
        )

        self.assertEqual(result["result"], "succeeded")
        self.assertEqual(result["backend"], "openai")
        self.assertTrue(result["human_audit_required"])
        arguments = client.responses.arguments
        assert arguments is not None
        self.assertEqual(arguments["model"], "test-model")
        self.assertIs(arguments["text_format"], MODULE.VisualAssessment)
        self.assertFalse(arguments["store"])
        content = arguments["input"][0]["content"]
        self.assertEqual(
            sum(item["type"] == "input_image" for item in content), 2
        )

    def test_records_human_audit_without_rewriting_model_result(self) -> None:
        assessment_path = self.root / "assessment.json"
        assessment_path.write_text(
            json.dumps(
                {
                    "episode_id": "episode-1",
                    "evaluator_id": "test-evaluator",
                    "result": "succeeded",
                }
            )
        )

        audit = MODULE.record_human_audit(
            assessment_path,
            auditor_id="operator-1",
            agreement="disagree",
            audited_result="indeterminate",
            notes="retreat is outside the captured window",
        )

        self.assertEqual(audit["model_result"], "succeeded")
        self.assertEqual(audit["audited_result"], "indeterminate")
        self.assertIn("not live rollout feedback", audit["usage"])

    def test_codex_backend_inherits_user_provider_config(self) -> None:
        evidence = self.root / "evidence"
        manifest = MODULE.prepare_evidence(self.episode, evidence, self.config)
        captured_command = None

        def run(command: list[str], **_: object) -> object:
            nonlocal captured_command
            captured_command = command
            output_path = Path(command[command.index("--output-last-message") + 1])
            output_path.write_text(self._assessment().model_dump_json())
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with (
            mock.patch.object(MODULE.shutil, "which", return_value="/bin/codex"),
            mock.patch.object(MODULE.subprocess, "run", side_effect=run),
        ):
            MODULE._evaluate_with_codex_cli(
                evidence, manifest, "judge visual facts", "test-codex-model"
            )

        assert captured_command is not None
        self.assertNotIn("--ignore-user-config", captured_command)
        self.assertIn("--ephemeral", captured_command)
        self.assertIn("--ignore-rules", captured_command)
        self.assertEqual(
            captured_command[captured_command.index("--sandbox") + 1],
            "read-only",
        )

    def test_auto_backend_rejects_without_any_available_provider(self) -> None:
        evidence = self.root / "evidence"
        MODULE.prepare_evidence(self.episode, evidence, self.config)

        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch.object(MODULE.shutil, "which", return_value=None),
            self.assertRaisesRegex(RuntimeError, "nor Codex CLI"),
        ):
            MODULE.evaluate_evidence(evidence, self.config)


if __name__ == "__main__":
    unittest.main()

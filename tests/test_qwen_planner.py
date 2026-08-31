from __future__ import annotations

import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch

from scripts.run_qwen_feedback_cycle import _round_two_messages, run
from submission_api.core import run_invocation
from submission_api.qwen_planner import (
    CLAIM_BOUNDARY,
    PlanningError,
    assess_result,
    call_qwen_json,
    validate_plan,
    verify_feedback_mapping,
)


def plan(
    round_number: int,
    observation_duration_ms: int = 250,
    approach_scale: float = 1.0,
    motion_duration_scale: float = 1.0,
) -> dict:
    feedback_evidence = []
    if round_number == 2:
        feedback_evidence = [
            {
                "failed_check": "localization_confidence",
                "observed_value": 0.943,
                "criterion_value": 0.95,
                "changed_control": "observation_duration_ms",
                "from_value": 250,
                "to_value": observation_duration_ms,
            },
            {
                "failed_check": "predicted_contact_error",
                "observed_value": 3.19,
                "criterion_value": 3.0,
                "changed_control": "approach_scale",
                "from_value": 1.0,
                "to_value": approach_scale,
            },
            {
                "failed_check": "peak_joint_velocity",
                "observed_value": 0.658,
                "criterion_value": 0.60,
                "changed_control": "motion_duration_scale",
                "from_value": 1.0,
                "to_value": motion_duration_scale,
            },
        ]
    return {
        "plan_id": f"round-{round_number}",
        "round": round_number,
        "scientific_question": "Can action-plan controls satisfy frozen thresholds at a fixed pose?",
        "working_hypothesis": "Longer observation and a slower, smaller approach improve the software metrics.",
        "evidence_status": CLAIM_BOUNDARY,
        "request": {
            "mode": "simulation",
            "scenario": "shifted_base",
            "seed": 11,
            "guardian_present": True,
            "initial_state": {"base_x_m": 0.18, "base_y_m": -0.08, "base_yaw_deg": 12},
            "plan_controls": {
                "observation_duration_ms": observation_duration_ms,
                "approach_scale": approach_scale,
                "motion_duration_scale": motion_duration_scale,
            },
        },
        "expected_observations": ["structured metrics"],
        "success_criteria": {
            "min_localization_confidence": 0.95,
            "max_predicted_contact_error_mm": 3.0,
            "max_peak_joint_velocity_ratio": 0.60,
            "min_clearance_mm": 40.0,
        },
        "stop_conditions": ["abort when guardian is absent"],
        "changes_from_previous": [] if round_number == 1 else ["change action-plan controls from round one"],
        "feedback_evidence": feedback_evidence,
        "rationale": "Test one bounded change.",
    }


class QwenPlannerTest(unittest.TestCase):
    def test_non_demonstrative_cycle_is_retained_outside_primary_directory(self) -> None:
        receipts = [
            {"provider": "test", "request_id": f"request-{index}", "usage": {"total_tokens": 10}}
            for index in (1, 2)
        ]
        candidates = [plan(1), plan(2, 450, 0.92, 1.15)]
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "primary"
            with patch("scripts.run_qwen_feedback_cycle.load_dashscope_api_key", return_value="secret"), patch(
                "scripts.run_qwen_feedback_cycle.call_qwen_json",
                side_effect=list(zip(candidates, receipts, strict=True)),
            ):
                with self.assertRaisesRegex(RuntimeError, "failure evidence retained"):
                    run(output)
            self.assertFalse((output / "cycle-summary.json").exists())
            failures = list(output.parent.glob("primary-failed-*"))
            self.assertEqual(len(failures), 1)
            self.assertTrue((failures[0] / "failure-summary.json").is_file())
            self.assertTrue((failures[0] / "artifact-manifest.json").is_file())

    def test_round_two_prompt_prioritizes_margin_without_claiming_success(self) -> None:
        round_one = validate_plan(plan(1), expected_round=1)
        result = run_invocation(round_one["request"])
        assessment = assess_result(round_one, result)

        prompt = _round_two_messages(round_one, result, assessment)[1]["content"]

        self.assertIn("明确安全余量", prompt)
        self.assertIn("不要声称所选参数必然通过", prompt)
        self.assertIn("最终结果只能由程序决定", prompt)

    def test_qwen_receipt_retains_provenance_but_not_the_credential(self) -> None:
        expected = plan(1)

        def transport(url: str, api_key: str, payload: dict) -> dict:
            self.assertEqual(api_key, "secret-not-for-evidence")
            return {
                "id": "chatcmpl-test",
                "model": "qwen3-max",
                "created": 1,
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
                "choices": [{"message": {"content": __import__("json").dumps(expected)}}],
            }

        actual, receipt = call_qwen_json(
            [{"role": "user", "content": "plan"}],
            api_key="secret-not-for-evidence",
            transport=transport,
        )
        self.assertEqual(actual, expected)
        self.assertEqual(receipt["request_id"], "chatcmpl-test")
        self.assertFalse(receipt["credential_recorded"])
        self.assertNotIn("secret-not-for-evidence", str(receipt))

    def test_frozen_program_rejects_round_one_and_accepts_adjusted_round_two(self) -> None:
        round_one = validate_plan(plan(1), expected_round=1)
        round_two = validate_plan(plan(2, 550, 0.85, 1.20), expected_round=2)
        self.assertEqual(assess_result(round_one, run_invocation(round_one["request"]))["decision"], "adjust")
        self.assertEqual(assess_result(round_two, run_invocation(round_two["request"]))["decision"], "accept")
        self.assertNotEqual(
            run_invocation(round_one["request"])["action_plan"],
            run_invocation(round_two["request"])["action_plan"],
        )

    def test_model_cannot_change_the_evaluator_thresholds(self) -> None:
        invalid = plan(2, 550, 0.85, 1.20)
        invalid["success_criteria"]["min_localization_confidence"] = 0.90
        with self.assertRaises(PlanningError):
            validate_plan(invalid, expected_round=2)

    def test_model_cannot_change_the_frozen_seed_pose_or_control_bounds(self) -> None:
        invalid_seed = plan(2, 550, 0.85, 1.20)
        invalid_seed["request"]["seed"] = 12
        with self.assertRaises(PlanningError):
            validate_plan(invalid_seed, expected_round=2)

        invalid_pose = plan(2, 550, 0.85, 1.20)
        invalid_pose["request"]["initial_state"]["base_x_m"] = 0.10
        with self.assertRaises(PlanningError):
            validate_plan(invalid_pose, expected_round=2)

        invalid_first_round = plan(1, 550, 0.85, 1.20)
        with self.assertRaises(PlanningError):
            validate_plan(invalid_first_round, expected_round=1)

        invalid_controls = plan(2, 700, 0.85, 1.20)
        with self.assertRaises(PlanningError):
            validate_plan(invalid_controls, expected_round=2)

        fractional_observation = plan(2, 500.5, 0.85, 1.20)
        with self.assertRaises(PlanningError):
            validate_plan(fractional_observation, expected_round=2)

    def test_round_two_must_preserve_the_scientific_question(self) -> None:
        invalid = plan(2, 550, 0.85, 1.20)
        with self.assertRaises(PlanningError):
            validate_plan(
                invalid,
                expected_round=2,
                expected_scientific_question="A different question",
            )

    def test_feedback_mapping_is_verified_against_retained_results(self) -> None:
        round_one = validate_plan(plan(1), expected_round=1)
        result = run_invocation(round_one["request"])
        assessment = assess_result(round_one, result)
        round_two = validate_plan(plan(2, 550, 0.85, 1.20), expected_round=2)
        mapping = verify_feedback_mapping(round_one, assessment, round_two)
        self.assertEqual(
            mapping["failed_checks"],
            ["localization_confidence", "peak_joint_velocity", "predicted_contact_error"],
        )
        self.assertTrue(mapping["verified_by_deterministic_program"])

        invalid = plan(2, 550, 0.85, 1.20)
        invalid["feedback_evidence"][0]["observed_value"] = 0.999
        with self.assertRaises(PlanningError):
            verify_feedback_mapping(round_one, assessment, invalid)

    def test_round_two_domain_contains_both_accept_and_adjust_candidates(self) -> None:
        decisions = {
            assess_result(candidate, run_invocation(candidate["request"]))["decision"]
            for candidate in (
                plan(2, 250, 1.0, 1.0),
                plan(2, 650, 0.8, 1.3),
            )
        }
        self.assertEqual(decisions, {"accept", "adjust"})


if __name__ == "__main__":
    unittest.main()

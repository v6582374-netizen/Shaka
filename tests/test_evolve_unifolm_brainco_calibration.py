from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts/evolve_unifolm_brainco_calibration.py"
SPEC = importlib.util.spec_from_file_location("brainco_evolution", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
EVOLUTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVOLUTION)


class BrainCoCalibrationEvolutionTest(unittest.TestCase):
    def test_training_target_conversion_snaps_only_float32_hard_limit_noise(self) -> None:
        target = tuple(tuple([0.0] * 14 + [0.0] * 6 + [0.0, 0.0] + [1.47000003] * 4) for _ in range(25))

        result = EVOLUTION.training_targets_to_live_targets(target)

        self.assertEqual(result[0][22:], (1.0, 1.0, 1.0, 1.0))

    def test_bounded_calibrator_changes_only_hands(self) -> None:
        prediction = tuple(tuple([0.3] * 14 + [-4.0] * 6 + [4.0] * 6) for _ in range(25))
        result = EVOLUTION.apply_calibrator(prediction, (1.0,) * 12, (0.0,) * 12)

        self.assertEqual(result[0][:14], (0.3,) * 14)
        self.assertTrue(all(0.0 < value < 1.0 for value in result[0][14:]))

    def test_explicit_projection_follows_unit_conversion_and_records_every_change(self) -> None:
        low = [-0.1] * 6
        high = [limit * 1.2 for _, limit in EVOLUTION.RUNNER.HAND_LIMITS_RAD]
        prediction = tuple(tuple([0.3] * 14 + low + high) for _ in range(25))

        projected, alterations = EVOLUTION.explicitly_project_live_targets(prediction)

        self.assertEqual(projected[0][:14], (0.3,) * 14)
        self.assertEqual(projected[0][14:20], (0.0,) * 6)
        self.assertEqual(projected[0][20:], (1.0,) * 6)
        self.assertEqual(len(alterations), 25 * 12)
        self.assertEqual(alterations[0]["original_live_normalized"], -0.1 / 1.52)
        self.assertEqual(alterations[0]["projected_live_normalized"], 0.0)

    def test_explicit_projection_cannot_increase_error_against_a_live_label(self) -> None:
        prediction = tuple(
            tuple([0.0] * 14 + [-0.1] * 6 + [limit * 1.2 for _, limit in EVOLUTION.RUNNER.HAND_LIMITS_RAD])
            for _ in range(25)
        )
        converted = EVOLUTION.model_actions_to_live_targets(prediction)
        projected, _ = EVOLUTION.explicitly_project_live_targets(prediction)
        target = (0.25,) * 6 + (0.75,) * 6

        for raw_step, projected_step in zip(converted, projected, strict=True):
            for raw, bounded, expected in zip(raw_step[14:], projected_step[14:], target, strict=True):
                self.assertLessEqual(abs(bounded - expected), abs(raw - expected))
                self.assertLessEqual((bounded - expected) ** 2, (raw - expected) ** 2)

    def test_selection_rejects_a_bounded_candidate_that_regresses_error(self) -> None:
        baseline = {"brainco_values_outside_live_range": 0, "mean_mse_hand_normalized": 0.1}
        candidate = {"brainco_values_outside_live_range": 0, "mean_mse_hand_normalized": 0.2}

        selected, reason = EVOLUTION.select_candidate(baseline, candidate)

        self.assertEqual(selected, "unit_conversion_explicit_projection_baseline")
        self.assertIn("regressed", reason)

    def test_selection_accepts_a_bounded_candidate_that_improves_error(self) -> None:
        baseline = {"brainco_values_outside_live_range": 0, "mean_mse_hand_normalized": 0.1}
        candidate = {"brainco_values_outside_live_range": 0, "mean_mse_hand_normalized": 0.08}

        selected, _ = EVOLUTION.select_candidate(baseline, candidate)

        self.assertEqual(selected, "bounded_monotonic_calibrator")

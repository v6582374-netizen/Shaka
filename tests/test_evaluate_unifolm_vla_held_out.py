from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_unifolm_vla_held_out.py"
SPEC = importlib.util.spec_from_file_location("held_out_evaluator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)


class HeldOutEvaluationTest(unittest.TestCase):
    def test_target_chunk_matches_current_then_future_action_training_alignment(self) -> None:
        actions = [[float(index)] * 26 for index in range(3)]
        chunk = EVALUATOR.target_chunk(actions, frame=1)

        self.assertEqual(chunk[:3], ((1.0,) * 26, (2.0,) * 26, (2.0,) * 26))
        self.assertEqual(len(chunk), 25)

    def test_metrics_counts_unrepresentable_brainco_predictions(self) -> None:
        prediction = tuple(tuple([0.0] * 14 + [-0.1] * 12) for _ in range(25))
        target = tuple(tuple([0.0] * 26) for _ in range(25))
        result = EVALUATOR.metrics(prediction, target)

        self.assertEqual(result["predicted_brainco_values_outside_0_1"], 300)
        self.assertAlmostEqual(result["mse_arm_14d"], 0.0)
        self.assertAlmostEqual(result["mse_hand_12d"], 0.01)

    def test_aggregate_keeps_global_maximum_and_count_distinct_from_means(self) -> None:
        result = EVALUATOR.aggregate_metrics(
            [
                {"mse_26d": 1.0, "mae_26d": 2.0, "mse_arm_14d": 3.0, "mse_hand_12d": 4.0, "maximum_absolute_error": 5.0, "predicted_brainco_values_outside_0_1": 1},
                {"mse_26d": 3.0, "mae_26d": 4.0, "mse_arm_14d": 5.0, "mse_hand_12d": 6.0, "maximum_absolute_error": 8.0, "predicted_brainco_values_outside_0_1": 2},
            ]
        )

        self.assertEqual(result["mean_mse_26d"], 2.0)
        self.assertEqual(result["maximum_absolute_error"], 8.0)
        self.assertEqual(result["brainco_values_outside_0_1"], 3)
        self.assertEqual(result["brainco_values_outside_0_1_rate"], 3 / (2 * 25 * 12))

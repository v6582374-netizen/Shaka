from __future__ import annotations

import json
import unittest
from pathlib import Path

CONFIG = (
    Path(__file__).parents[1]
    / "configs"
    / "g1-evaluator-v001"
    / "standard_start.json"
)


class StandardStartConfigTest(unittest.TestCase):
    def test_configuration_has_one_complete_26_channel_start_state(self) -> None:
        configuration = json.loads(CONFIG.read_text())
        pose = configuration["pose"]
        self.assertEqual(len(pose["arm_joint_order"]), 14)
        self.assertEqual(len(pose["arm_values"]), 14)
        self.assertEqual(len(pose["hand_joint_order"]), 12)
        self.assertEqual(len(pose["hand_values"]), 12)
        self.assertEqual(pose["arm_units"], "radian")
        self.assertEqual(pose["hand_units"], "brainco_normalized_position")

    def test_configuration_is_bound_to_zero_write_source_evidence(self) -> None:
        configuration = json.loads(CONFIG.read_text())
        evidence = configuration["source_evidence"]
        self.assertEqual(evidence["command_publishers_created"], 0)
        self.assertEqual(evidence["writes"], 0)
        self.assertEqual(len(evidence["sha256_manifest_sha256"]), 64)
        self.assertEqual(len(evidence["capture_metadata_sha256"]), 64)

    def test_target_is_visible_in_both_head_views(self) -> None:
        configuration = json.loads(CONFIG.read_text())
        boxes = configuration["scene"]["yellow_button_baseline_bbox"]
        self.assertEqual(set(boxes), {"cam_left_high", "cam_right_high"})
        for x, y, width, height in boxes.values():
            self.assertGreater(width * height, 400)
            self.assertLessEqual(x + width, 640)
            self.assertLessEqual(y + height, 480)


if __name__ == "__main__":
    unittest.main()

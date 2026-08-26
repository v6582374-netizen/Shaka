from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "run_unifolm_vla_zero_write_preflight.py"
SPEC = importlib.util.spec_from_file_location("unifolm_preflight", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


def camera_payload() -> bytes:
    image = Image.new("RGB", (1280, 480), color=(12, 34, 56))
    output = io.BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def observation() -> dict[str, object]:
    payload = camera_payload()
    return {
        "schema_version": 1,
        "robot_state": {"body": [float(index) for index in range(34)]},
        "brainco": {
            "left": {"positions": [0.1] * 6},
            "right": {"positions": [0.2] * 6},
        },
        "physical_camera_frames": {
            "head_camera": {
                "jpeg_base64": base64.b64encode(payload).decode("ascii"),
                "payload_sha256": hashlib.sha256(payload).hexdigest(),
            }
        },
    }


class UniFoLMZeroWritePreflightTest(unittest.TestCase):
    def test_maps_current_envelope_body_layout_to_the_26d_vla_order(self) -> None:
        state = RUNNER.upper_body_state(observation())

        self.assertEqual(state[:14], tuple(float(index) for index in range(20, 34)))
        self.assertEqual(
            state[14:20], tuple(high * 0.1 for _, high in RUNNER.HAND_LIMITS_RAD)
        )
        self.assertEqual(
            state[20:], tuple(high * 0.2 for _, high in RUNNER.HAND_LIMITS_RAD)
        )

    def test_converts_between_live_normalized_hands_and_model_radians(self) -> None:
        radians = RUNNER.brainco_normalized_to_radians((0.5,) * 6, "test hand")

        self.assertEqual(
            radians, tuple(high * 0.5 for _, high in RUNNER.HAND_LIMITS_RAD)
        )
        self.assertEqual(RUNNER.brainco_radians_to_normalized(radians), (0.5,) * 6)

    def test_refuses_a_corrupted_camera_payload(self) -> None:
        value = observation()
        value["physical_camera_frames"]["head_camera"]["payload_sha256"] = "0" * 64  # type: ignore[index]

        with self.assertRaisesRegex(ValueError, "digest"):
            RUNNER.primary_camera_bytes(value)

    def test_primary_image_is_the_trained_left_stereo_view_at_224_square(self) -> None:
        image = RUNNER.primary_camera_image(observation())

        self.assertEqual(image.size, (224, 224))
        self.assertEqual(image.mode, "RGB")

    def test_normalization_round_trip_preserves_the_26d_contract(self) -> None:
        stats = {
            "q01": [0.0] * 26,
            "q99": [2.0] * 26,
            "mask": [True] * 26,
        }
        state = tuple(1.0 for _ in range(26))
        normalized = RUNNER.normalize_state(state, stats)
        actions = RUNNER.unnormalize_actions([list(normalized)] * 25, stats)

        self.assertTrue(all(abs(value) < 1e-7 for value in normalized))
        self.assertTrue(
            all(
                abs(actual - expected) < 1e-7
                for action in actions
                for actual, expected in zip(action, state, strict=True)
            )
        )

    def test_missing_statistic_mask_defaults_to_all_26_channels(self) -> None:
        stats = {"q01": [0.0] * 26, "q99": [2.0] * 26}

        normalized = RUNNER.normalize_state((1.0,) * 26, stats)

        self.assertTrue(all(abs(value) < 1e-7 for value in normalized))

    def test_prompt_matches_the_training_batch_transform(self) -> None:
        self.assertEqual(
            RUNNER.policy_prompt("Press the yellow button."),
            'You are a robot using the joint control. The task is "press the yellow '
            'button.". Please predict up to 10 key trajectory points to complete the '
            'task. Your answer should be formatted as a list of tuples, i.e. [[x1, y1], '
            '[x2, y2], ...], where each tuple contains the x and y coordinates of a point.',
        )

    def test_selects_the_26d_runtime_only_while_building_the_model(self) -> None:
        config = SimpleNamespace(
            framework=SimpleNamespace(
                action_model=SimpleNamespace(
                    action_dim=26,
                    state_dim=26,
                    action_horizon=25,
                )
            )
        )
        observed_argv: list[str] = []
        model = SimpleNamespace(
            action_model=SimpleNamespace(
                action_dim=26,
                proprio_dim=26,
                action_horizon=25,
            )
        )
        original_argv = list(sys.argv)

        def build_framework(value: object) -> object:
            self.assertIs(value, config)
            observed_argv.extend(sys.argv)
            return model

        self.assertIs(RUNNER._build_brainco26_policy(build_framework, config), model)
        self.assertIn(RUNNER.UNIFOLM_BRAINCO26_ARG, observed_argv)
        self.assertEqual(sys.argv, original_argv)

    def test_action_plan_is_bound_to_one_observation_and_has_no_execution_capability(
        self,
    ) -> None:
        actions = tuple(tuple(float(step) for _ in range(26)) for step in range(25))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "action-plan.json"
            digest = RUNNER.write_action_plan(
                output,
                checkpoint=Path("/models/final.pt"),
                checkpoint_sha256="a" * 64,
                observation=Path("/observations/live.json"),
                observation_sha256="b" * 64,
                captured_at_ns=123,
                actions=actions,
                model_actions=actions,
            )
            value = RUNNER._read_json(output, "action plan")
            self.assertEqual(digest, hashlib.sha256(output.read_bytes()).hexdigest())

        self.assertEqual(value["execution_mode"], "zero-write")
        self.assertEqual(value["trajectory"], [list(action) for action in actions])
        self.assertEqual(value["model_trajectory"], [list(action) for action in actions])
        self.assertEqual(value["checkpoint"]["sha256"], "a" * 64)
        self.assertEqual(value["observation"]["sha256"], "b" * 64)
        self.assertEqual(value["command_publishers_created"], 0)
        self.assertEqual(value["writes"], 0)

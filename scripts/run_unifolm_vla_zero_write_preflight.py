#!/usr/bin/env python3
"""Run one UniFoLM-VLA inference from a recorded G1 observation without writes.

This is deliberately an inference-only boundary.  It accepts the immutable
``live-observation.json`` produced by Shaka's read-only recorder, verifies the
trained model identity, then emits the 25 predicted 26-channel targets.  It
does not import a DDS or BrainCo command client and cannot create an actuator
publisher.

The training contract is fixed here rather than inferred from a model output:
the first half of the stereo head frame is ``cam_left_high``; state is G1 motor
slots 15..28 followed by the two six-channel BrainCo positions.  The current
state-envelope bridge prefixes its 29 motor positions with five IMU values,
which makes the arm slice ``body[20:34]``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.unifolm-vla-brainco26-zero-write-preflight.v1"
OBSERVATION_SCHEMA_VERSION = 1
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
BODY_DIMENSION = 34
BODY_MOTOR_OFFSET = 5
ARM_MOTOR_INDICES = tuple(range(15, 29))
ARM_BODY_INDICES = tuple(BODY_MOTOR_OFFSET + index for index in ARM_MOTOR_INDICES)
HAND_DIMENSION = 6
PRIMARY_CAMERA_ID = "head_camera"
PRIMARY_CAMERA_SIZE = (1280, 480)
PRIMARY_VIEW_SIZE = (640, 480)
MODEL_IMAGE_SIZE = (224, 224)
DEFAULT_INSTRUCTION = "Press the yellow button to open the instrument lid."
DEFAULT_ARTIFACT_ROOT = Path(
    "/mnt/data-hdd/Shaka/artifacts/brainco26-vla-action10k-b8-g16-v1-20260825"
)
DEFAULT_CHECKPOINT = DEFAULT_ARTIFACT_ROOT / "final_model" / "pytorch_model.pt"
DEFAULT_VLM_BASE = Path("/mnt/data-hdd/unifolm-vla/models/Unifolm-VLM-Base")
DEFAULT_SOURCE_ROOT = Path("/mnt/data-hdd/unifolm-vla/source/unifolm-vla")
EXPECTED_CHECKPOINT_SHA256 = (
    "c76c798f97d9efe16faf99fa8148b170130c0f0db7589422a7e16b9f3d34b732"
)
UNIFOLM_BRAINCO26_ARG = "--shaka-unifolm-platform=brainco26"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_json(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _finite_vector(value: Any, dimension: int, description: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != dimension:
        raise ValueError(f"{description} must contain exactly {dimension} values")
    try:
        result = tuple(float(item) for item in value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} contains a non-number") from error
    if not all(math.isfinite(item) for item in result):
        raise ValueError(f"{description} contains a non-finite value")
    return result


def upper_body_state(observation: dict[str, Any]) -> tuple[float, ...]:
    """Return the 14-arm + 12-hand vector used for VLA training and inference."""
    if observation.get("schema_version") != OBSERVATION_SCHEMA_VERSION:
        raise ValueError("live observation schema version is unsupported")
    robot_state = observation.get("robot_state")
    brainco = observation.get("brainco")
    if not isinstance(robot_state, dict) or not isinstance(brainco, dict):
        raise ValueError("live observation is missing robot or BrainCo state")
    body = _finite_vector(robot_state.get("body"), BODY_DIMENSION, "G1 body state")
    left = brainco.get("left")
    right = brainco.get("right")
    if not isinstance(left, dict) or not isinstance(right, dict):
        raise ValueError("live observation is missing a BrainCo hand")
    left_hand = _finite_vector(left.get("positions"), HAND_DIMENSION, "left BrainCo state")
    right_hand = _finite_vector(right.get("positions"), HAND_DIMENSION, "right BrainCo state")
    state = tuple(body[index] for index in ARM_BODY_INDICES) + left_hand + right_hand
    if len(state) != ACTION_DIMENSION:
        raise AssertionError("BrainCo26 state layout changed unexpectedly")
    return state


def primary_camera_bytes(observation: dict[str, Any]) -> bytes:
    frames = observation.get("physical_camera_frames")
    if not isinstance(frames, dict):
        raise ValueError("live observation is missing physical camera frames")
    frame = frames.get(PRIMARY_CAMERA_ID)
    if not isinstance(frame, dict):
        raise ValueError("live observation is missing the head camera frame")
    encoded = frame.get("jpeg_base64")
    expected_digest = frame.get("payload_sha256")
    if not isinstance(encoded, str) or not isinstance(expected_digest, str):
        raise ValueError("head camera frame is missing immutable JPEG evidence")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("head camera JPEG is not valid base64") from error
    if hashlib.sha256(payload).hexdigest() != expected_digest:
        raise ValueError("head camera JPEG digest does not match the observation")
    if not payload:
        raise ValueError("head camera JPEG is empty")
    return payload


def primary_camera_image(observation: dict[str, Any]) -> Any:
    """Decode the left half of the stereo head frame at the trained 224x224 size."""
    try:
        from PIL import Image
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"Pillow is unavailable: {error}") from error
    payload = primary_camera_bytes(observation)
    try:
        with Image.open(io.BytesIO(payload)) as source:
            image = source.convert("RGB")
    except OSError as error:
        raise ValueError(f"head camera JPEG cannot be decoded: {error}") from error
    if image.size != PRIMARY_CAMERA_SIZE:
        raise ValueError(
            f"head camera size {image.size} does not match {PRIMARY_CAMERA_SIZE}"
        )
    left_high = image.crop((0, 0, *PRIMARY_VIEW_SIZE))
    return left_high.resize(MODEL_IMAGE_SIZE, Image.Resampling.BILINEAR)


def policy_prompt(instruction: str) -> str:
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("instruction must be non-empty")
    return (
        "You are a robot using the joint control. The task is "
        f'"{instruction.lower()}". Please predict up to 10 key trajectory points '
        "to complete the task. Your answer should be formatted as a list of tuples, "
        "i.e. [[x1, y1], [x2, y2], ...], where each tuple contains the x and y "
        "coordinates of a point."
    )


def _normalization_stats(
    checkpoint: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    root = checkpoint.parent.parent
    stats = _read_json(root / "dataset_statistics.json", "dataset statistics")
    if set(stats) != {"rlds_brainco26"}:
        raise ValueError("checkpoint statistics do not identify one BrainCo26 dataset")
    contract = stats["rlds_brainco26"]
    if not isinstance(contract, dict):
        raise ValueError("BrainCo26 checkpoint statistics are invalid")
    proprio = contract.get("proprio")
    action = contract.get("action")
    if not isinstance(proprio, dict) or not isinstance(action, dict):
        raise ValueError("checkpoint statistics omit proprio or action ranges")
    return proprio, action


def _range_vectors(stats: dict[str, Any], description: str) -> tuple[tuple[float, ...], tuple[float, ...], tuple[bool, ...]]:
    low = _finite_vector(stats.get("q01"), ACTION_DIMENSION, f"{description} q01")
    high = _finite_vector(stats.get("q99"), ACTION_DIMENSION, f"{description} q99")
    # UniFoLM training and inference default a missing mask to every channel.
    # The frozen BrainCo26 statistics intentionally use that upstream default.
    mask_raw = stats.get("mask", [True] * ACTION_DIMENSION)
    if not isinstance(mask_raw, list) or len(mask_raw) != ACTION_DIMENSION:
        raise ValueError(f"{description} mask must contain {ACTION_DIMENSION} values")
    if any(not isinstance(value, bool) for value in mask_raw):
        raise ValueError(f"{description} mask must contain booleans")
    if any(lo >= hi for lo, hi, enabled in zip(low, high, mask_raw) if enabled):
        raise ValueError(f"{description} quantile range is invalid")
    return low, high, tuple(mask_raw)


def normalize_state(state: tuple[float, ...], stats: dict[str, Any]) -> tuple[float, ...]:
    low, high, mask = _range_vectors(stats, "proprio statistics")
    return tuple(
        max(-1.0, min(1.0, 2.0 * (value - lo) / (hi - lo + 1e-8) - 1.0))
        if enabled
        else value
        for value, lo, hi, enabled in zip(state, low, high, mask, strict=True)
    )


def unnormalize_actions(
    normalized: Any, stats: dict[str, Any]
) -> tuple[tuple[float, ...], ...]:
    low, high, mask = _range_vectors(stats, "action statistics")
    if not isinstance(normalized, list) or len(normalized) != ACTION_HORIZON:
        raise ValueError(f"VLA action horizon must contain {ACTION_HORIZON} targets")
    actions: list[tuple[float, ...]] = []
    for step, values in enumerate(normalized):
        target = _finite_vector(values, ACTION_DIMENSION, f"normalized action {step}")
        actions.append(
            tuple(
                0.5 * (value + 1.0) * (hi - lo + 1e-8) + lo if enabled else value
                for value, lo, hi, enabled in zip(target, low, high, mask, strict=True)
            )
        )
    return tuple(actions)


def _cuda_library_paths() -> list[str]:
    root = Path(sys.prefix) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages" / "nvidia"
    return [str(path) for path in sorted(root.glob("*/lib")) if path.is_dir()]


def _restart_with_environment_cuda_libraries() -> None:
    """Re-exec before importing torch so the environment CUDA 12.4 libraries win."""
    if os.environ.get("SHAKA_UNIFOLM_CUDA_READY") == "1":
        return
    library_paths = _cuda_library_paths()
    if not library_paths:
        return
    environment = os.environ.copy()
    environment["LD_LIBRARY_PATH"] = ":".join(
        library_paths + [environment.get("LD_LIBRARY_PATH", "")]
    )
    environment["SHAKA_UNIFOLM_CUDA_READY"] = "1"
    os.execvpe(sys.executable, [sys.executable, *sys.argv], environment)


def _build_brainco26_policy(build_framework: Any, config: Any) -> Any:
    """Build against the legacy source's 26-D platform selector, not its default.

    UniFoLM's action header currently obtains its dimensions at import time from
    a legacy ``sys.argv`` platform detector, even though the checkpoint config
    carries the authoritative dimensions.  The detector defaults to 23-D G1
    end-effector control when no selector is present.  Keep that implementation
    detail scoped to model construction, verify the frozen config first, and
    reject a process that has already imported a differently configured header.
    """
    action_config = config.framework.action_model
    expected_config = (
        action_config.action_dim,
        action_config.state_dim,
        action_config.action_horizon,
    )
    if expected_config != (ACTION_DIMENSION, ACTION_DIMENSION, ACTION_HORIZON):
        raise ValueError(
            "checkpoint action-head config is not the required 26-D, 25-step BrainCo contract"
        )

    original_argv = list(sys.argv)
    sys.argv.append(UNIFOLM_BRAINCO26_ARG)
    try:
        model = build_framework(config)
    finally:
        sys.argv[:] = original_argv

    actual_model = (
        model.action_model.action_dim,
        model.action_model.proprio_dim,
        model.action_model.action_horizon,
    )
    if actual_model != (ACTION_DIMENSION, ACTION_DIMENSION, ACTION_HORIZON):
        raise RuntimeError(
            "UniFoLM runtime did not construct the required 26-D, 25-step BrainCo action head"
        )
    return model


def _load_policy(
    checkpoint: Path,
    vlm_base: Path,
    source_root: Path,
    device: str,
) -> tuple[Any, Any]:
    if not source_root.is_dir():
        raise ValueError(f"UniFoLM-VLA source root is absent: {source_root}")
    source_package = source_root / "src"
    if str(source_package) not in sys.path:
        sys.path.insert(0, str(source_package))
    try:
        import torch
        from unifolm_vla.model.framework import build_framework
        from unifolm_vla.model.framework.share_tools import (
            dict_to_namespace,
            read_mode_config,
        )
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"UniFoLM-VLA runtime is unavailable: {error}") from error
    if not torch.cuda.is_available():
        raise RuntimeError("UniFoLM-VLA preflight requires an available CUDA device")
    if not vlm_base.is_dir():
        raise ValueError(f"UniFoLM VLM base is absent: {vlm_base}")

    config_value, statistics = read_mode_config(checkpoint)
    config = dict_to_namespace(config_value)
    config.framework.qwenvl.base_vlm = str(vlm_base)
    model = _build_brainco26_policy(build_framework, config)
    model.norm_stats = statistics
    try:
        state_dict = torch.load(
            checkpoint, map_location="cpu", mmap=True, weights_only=True
        )
    except (RuntimeError, ValueError, TypeError) as error:
        raise RuntimeError(f"checkpoint cannot be memory-mapped safely: {error}") from error
    model.load_state_dict(state_dict, strict=True)
    del state_dict
    model = model.to(torch.bfloat16).to(device).eval()
    return model, torch


def _infer(
    model: Any,
    torch_runtime: Any,
    state: tuple[float, ...],
    image: Any,
    instruction: str,
    stats: dict[str, Any],
    seed: int,
    device: str,
) -> tuple[tuple[float, ...], ...]:
    try:
        from qwen_vl_utils import process_vision_info
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"Qwen vision preprocessing is unavailable: {error}") from error
    prompt = policy_prompt(instruction)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    text = model.processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = model.processor(
        text=text,
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )
    qwen_inputs = {key: value.to(device) for key, value in inputs.items()}
    qwen_inputs["state"] = torch_runtime.tensor(
        [normalize_state(state, stats)], dtype=torch_runtime.bfloat16, device=device
    )
    torch_runtime.manual_seed(seed)
    normalized = model.predict_action(qwen_inputs)["normalized_actions"][0].tolist()
    return unnormalize_actions(normalized, stats)


def run_preflight(args: argparse.Namespace) -> dict[str, Any]:
    observation_path = args.observation.resolve()
    checkpoint = args.checkpoint.resolve()
    expected_digest = args.expected_checkpoint_sha256.lower()
    if not checkpoint.is_file():
        raise ValueError(f"VLA checkpoint is absent: {checkpoint}")
    if len(expected_digest) != 64 or any(character not in "0123456789abcdef" for character in expected_digest):
        raise ValueError("expected checkpoint SHA-256 must be 64 lowercase hexadecimal characters")
    checkpoint_digest = _sha256_file(checkpoint)
    if checkpoint_digest != expected_digest:
        raise RuntimeError("VLA checkpoint SHA-256 does not match the frozen artifact")
    observation = _read_json(observation_path, "live observation")
    observation_digest = _sha256_file(observation_path)
    state = upper_body_state(observation)
    image = primary_camera_image(observation)
    proprio_stats, action_stats = _normalization_stats(checkpoint)
    started_ns = time.time_ns()
    model, torch_runtime = _load_policy(
        checkpoint, args.vlm_base.resolve(), args.source_root.resolve(), args.device
    )
    loaded_ns = time.time_ns()
    actions = _infer(
        model,
        torch_runtime,
        state,
        image,
        args.instruction,
        proprio_stats,
        args.seed,
        args.device,
    )
    completed_ns = time.time_ns()
    flattened = tuple(value for action in actions for value in action)
    return {
        "result": "unifolm_vla_zero_write_preflight_ok",
        "protocol": PROTOCOL,
        "execution_mode": "zero-write",
        "checkpoint": {
            "path": str(checkpoint),
            "sha256": checkpoint_digest,
        },
        "observation": {
            "path": str(observation_path),
            "sha256": observation_digest,
            "captured_at_ns": observation.get("captured_at_ns"),
            "primary_camera": "cam_left_high",
            "primary_camera_transform": "head_camera_left_half_then_224x224_bilinear",
        },
        "input_contract": {
            "state_dimension": len(state),
            "state_layout": "g1_motor_15_to_28,left_brainco_6,right_brainco_6",
            "action_dimension": ACTION_DIMENSION,
            "action_horizon": len(actions),
            "instruction": args.instruction,
        },
        "timing": {
            "model_load_ms": (loaded_ns - started_ns) / 1_000_000,
            "inference_ms": (completed_ns - loaded_ns) / 1_000_000,
        },
        "action_summary": {
            "first_target": list(actions[0]),
            "minimum": min(flattened),
            "maximum": max(flattened),
        },
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
        "robot_runtime_consumed_s": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--vlm-base", type=Path, default=DEFAULT_VLM_BASE)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument(
        "--expected-checkpoint-sha256", default=EXPECTED_CHECKPOINT_SHA256
    )
    parser.add_argument("--instruction", default=DEFAULT_INSTRUCTION)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> int:
    _restart_with_environment_cuda_libraries()
    args = parse_args()
    try:
        result = run_preflight(args)
    except Exception as error:  # noqa: BLE001 - preserve a machine-readable failure
        print(
            json.dumps(
                {
                    "result": "unifolm_vla_zero_write_preflight_rejected",
                    "protocol": PROTOCOL,
                    "reason": str(error),
                    "command_publishers_created": 0,
                    "writes": 0,
                    "physical_rollout_attempts_consumed": 0,
                    "robot_runtime_consumed_s": 0,
                },
                sort_keys=True,
            )
        )
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

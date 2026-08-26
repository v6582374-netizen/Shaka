#!/usr/bin/env python3
"""Measure a frozen UniFoLM-VLA policy on held-out BrainCo26 demonstrations.

This program is strictly offline: it reads the first frame of each held-out
HDF5 demonstration, loads the frozen model once, and compares each 25-target
prediction to the exact 25-target chunk used by training.  It neither
discovers nor imports a robot, DDS, network, arm, or BrainCo command interface.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.unifolm-vla-held-out-evaluation.v1"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
ARM_DIMENSION = 14
HAND_DIMENSION = 12
TRAINING_TIME_PROTOCOL = "shaka.brainco26-training-time-audit.v1"
ROOT = Path(__file__).parents[1]
RUNNER_PATH = ROOT / "scripts/run_unifolm_vla_zero_write_preflight.py"
SPEC = importlib.util.spec_from_file_location("unifolm_zero_write_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be a JSON object")
    return value


def held_out_cases(summary: dict[str, Any], hdf5_root: Path) -> tuple[tuple[str, int, Path], ...]:
    manifest = summary.get("manifest")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("datasets"), list):
        raise ValueError("conversion summary lacks a dataset manifest")
    cases: list[tuple[str, int, Path]] = []
    for entry in manifest["datasets"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            raise ValueError("conversion manifest contains an invalid dataset")
        episode_ids = entry.get("held_out_episode_ids")
        if not isinstance(episode_ids, list) or not all(isinstance(value, int) and value >= 0 for value in episode_ids):
            raise ValueError(f"{entry['name']} has invalid held-out episode ids")
        for episode in episode_ids:
            path = hdf5_root / "held_out" / entry["name"] / f"episode_{episode:06d}.hdf5"
            if not path.is_file():
                raise ValueError(f"held-out episode is absent: {path}")
            cases.append((entry["name"], episode, path))
    if not cases:
        raise ValueError("conversion manifest has no held-out episodes")
    return tuple(cases)


def target_chunk(actions: Any, frame: int = 0) -> tuple[tuple[float, ...], ...]:
    """Exactly match the absolute-action end-of-trajectory repetition in training."""
    try:
        length = len(actions)
    except TypeError as error:
        raise ValueError("held-out actions are not a sequence") from error
    if frame < 0 or frame >= length:
        raise ValueError("held-out frame is outside its episode")
    result: list[tuple[float, ...]] = []
    for offset in range(ACTION_HORIZON):
        index = min(frame + offset, length - 1)
        values = tuple(float(value) for value in actions[index])
        if len(values) != ACTION_DIMENSION or not all(math.isfinite(value) for value in values):
            raise ValueError("held-out action does not satisfy the 26-D finite contract")
        result.append(values)
    return tuple(result)


def metrics(prediction: tuple[tuple[float, ...], ...], target: tuple[tuple[float, ...], ...]) -> dict[str, Any]:
    if len(prediction) != ACTION_HORIZON or len(target) != ACTION_HORIZON:
        raise ValueError("prediction and target must contain 25 targets")
    errors = [
        predicted - expected
        for predicted_step, expected_step in zip(prediction, target, strict=True)
        for predicted, expected in zip(predicted_step, expected_step, strict=True)
    ]
    arm_errors = [
        predicted - expected
        for predicted_step, expected_step in zip(prediction, target, strict=True)
        for predicted, expected in zip(predicted_step[:ARM_DIMENSION], expected_step[:ARM_DIMENSION], strict=True)
    ]
    hand_errors = [
        predicted - expected
        for predicted_step, expected_step in zip(prediction, target, strict=True)
        for predicted, expected in zip(predicted_step[ARM_DIMENSION:], expected_step[ARM_DIMENSION:], strict=True)
    ]
    live_targets = RUNNER.training_actions_to_live_targets(prediction)
    hand_values = [value for step in live_targets for value in step[ARM_DIMENSION:]]
    return {
        "mse_26d": sum(error * error for error in errors) / len(errors),
        "mae_26d": sum(abs(error) for error in errors) / len(errors),
        "mse_arm_14d": sum(error * error for error in arm_errors) / len(arm_errors),
        "mse_hand_12d": sum(error * error for error in hand_errors) / len(hand_errors),
        "maximum_absolute_error": max(abs(error) for error in errors),
        "predicted_brainco_values_outside_live_range": sum(value < 0.0 or value > 1.0 for value in hand_values),
    }


def aggregate_metrics(cases: list[dict[str, Any]]) -> dict[str, Any]:
    if not cases:
        raise ValueError("cannot aggregate an empty held-out evaluation")
    mean = lambda key: sum(float(case[key]) for case in cases) / len(cases)
    invalid = sum(int(case["predicted_brainco_values_outside_live_range"]) for case in cases)
    hand_values = len(cases) * ACTION_HORIZON * HAND_DIMENSION
    return {
        "mean_mse_26d": mean("mse_26d"),
        "mean_mae_26d": mean("mae_26d"),
        "mean_mse_arm_14d": mean("mse_arm_14d"),
        "mean_mse_hand_12d": mean("mse_hand_12d"),
        "maximum_absolute_error": max(float(case["maximum_absolute_error"]) for case in cases),
        "brainco_values_outside_live_range": invalid,
        "brainco_values_outside_live_range_rate": invalid / hand_values,
    }


def _audit_interval(path: Path, expected_digest: str) -> float:
    if _sha256(path) != expected_digest:
        raise ValueError("training-time audit SHA-256 does not match its frozen value")
    audit = _read_object(path, "training-time audit")
    semantics = audit.get("training_time_semantics")
    if audit.get("protocol") != TRAINING_TIME_PROTOCOL or audit.get("result") != "brainco26_training_time_audit_ok" or not isinstance(semantics, dict):
        raise ValueError("training-time audit is not the required successful BrainCo26 evidence")
    interval = float(semantics.get("sample_interval_seconds", 0.0))
    if not math.isfinite(interval) or interval <= 0.0:
        raise ValueError("training-time audit lacks a valid sample interval")
    return interval


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import h5py
        from PIL import Image
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"offline evaluation dependencies are unavailable: {error}") from error
    checkpoint = args.checkpoint.resolve()
    if _sha256(checkpoint) != args.expected_checkpoint_sha256.lower():
        raise ValueError("VLA checkpoint SHA-256 does not match the frozen artifact")
    interval = _audit_interval(args.training_time_audit.resolve(), args.expected_training_time_audit_sha256.lower())
    summary_path = args.conversion_summary.resolve()
    summary = _read_object(summary_path, "conversion summary")
    cases = held_out_cases(summary, args.hdf5_root.resolve())
    proprio_stats, _ = RUNNER._normalization_stats(checkpoint)
    model, torch_runtime = RUNNER._load_policy(checkpoint, args.vlm_base.resolve(), args.source_root.resolve(), args.device)
    per_case: list[dict[str, Any]] = []
    for index, (dataset, episode, path) in enumerate(cases):
        with h5py.File(path, "r") as source:
            if source["observations/qpos"].shape[1] != ACTION_DIMENSION or source["action"].shape[1] != ACTION_DIMENSION:
                raise ValueError(f"{path} violates the 26-D held-out contract")
            image_bytes = bytes(source["observations/images/image_left_top"][0])
            with Image.open(__import__("io").BytesIO(image_bytes)) as raw:
                image = raw.convert("RGB").resize(RUNNER.MODEL_IMAGE_SIZE, Image.Resampling.BILINEAR)
            state = tuple(float(value) for value in source["observations/qpos"][0])
            target = target_chunk(source["action"][:])
            instruction_raw = source["language_raw"][()]
        instruction = instruction_raw.decode("utf-8") if isinstance(instruction_raw, bytes) else str(instruction_raw)
        prediction = RUNNER._infer(model, torch_runtime, state, image, instruction, proprio_stats, args.seed + index, args.device)
        per_case.append({"dataset": dataset, "episode": episode, "source_hdf5": str(path), **metrics(prediction, target)})
    return {
        "schema_version": 1,
        "protocol": PROTOCOL,
        "result": "unifolm_vla_held_out_evaluation_ok",
        "execution_mode": "offline-zero-write",
        "checkpoint": {"path": str(checkpoint), "sha256": _sha256(checkpoint)},
        "inputs": {"conversion_summary": {"path": str(summary_path), "sha256": _sha256(summary_path)}, "training_time_audit": {"path": str(args.training_time_audit.resolve()), "sha256": _sha256(args.training_time_audit.resolve())}},
        "evaluation_contract": {"episodes": len(per_case), "frame_index": 0, "action_horizon": ACTION_HORIZON, "sample_interval_seconds": interval, "target_alignment": "current action through 24 future actions; terminal values repeat"},
        "aggregate": aggregate_metrics(per_case),
        "cases": per_case,
        "physical_execution_authorized": False,
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hdf5-root", type=Path, required=True)
    parser.add_argument("--conversion-summary", type=Path, required=True)
    parser.add_argument("--training-time-audit", type=Path, required=True)
    parser.add_argument("--expected-training-time-audit-sha256", required=True)
    parser.add_argument("--checkpoint", type=Path, default=RUNNER.DEFAULT_CHECKPOINT)
    parser.add_argument("--expected-checkpoint-sha256", default=RUNNER.EXPECTED_CHECKPOINT_SHA256)
    parser.add_argument("--vlm-base", type=Path, default=RUNNER.DEFAULT_VLM_BASE)
    parser.add_argument("--source-root", type=Path, default=RUNNER.DEFAULT_SOURCE_ROOT)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    RUNNER._restart_with_environment_cuda_libraries()
    args = parse_args()
    try:
        if not args.output.parent.is_dir():
            raise ValueError(f"output parent does not exist: {args.output.parent}")
        result = evaluate(args)
        temporary = args.output.with_name(f".{args.output.name}.tmp")
        try:
            temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            os.replace(temporary, args.output)
        finally:
            if temporary.exists():
                temporary.unlink()
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - machine-readable rejection
        print(json.dumps({"protocol": PROTOCOL, "result": "unifolm_vla_held_out_evaluation_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Run one budgeted, reversible BrainCo-output self-evolution experiment.

The experiment is deliberately narrow.  It fits twelve monotonic bounded
calibrators on the *training* episodes only, compares them with an explicit
model-radians -> live-normalized -> clip-to-[0,1] baseline on the frozen
held-out episodes, and records an automatic accept/reject decision.  Every
baseline projection is retained as evidence.  It reads no live robot interface
and cannot publish a command.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.unifolm-vla-brainco-calibration-evolution.v1"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
ARM_DIMENSION = 14
HAND_DIMENSION = 12
TRAINING_LABEL_LIMIT_TOLERANCE = 1e-6
ROOT = Path(__file__).parents[1]
EVALUATOR_PATH = ROOT / "scripts/evaluate_unifolm_vla_held_out.py"
SPEC = importlib.util.spec_from_file_location("unifolm_held_out_evaluator", EVALUATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)
RUNNER = EVALUATOR.RUNNER


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


def split_cases(summary: dict[str, Any], hdf5_root: Path, split: str) -> tuple[tuple[str, int, Path], ...]:
    if split not in {"train", "held_out"}:
        raise ValueError("split must be train or held_out")
    manifest = summary.get("manifest")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("datasets"), list):
        raise ValueError("conversion summary lacks a dataset manifest")
    field = f"{split}_episode_ids"
    result: list[tuple[str, int, Path]] = []
    for entry in manifest["datasets"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            raise ValueError("conversion manifest contains an invalid dataset")
        identifiers = entry.get(field)
        if not isinstance(identifiers, list) or not all(isinstance(value, int) and value >= 0 for value in identifiers):
            raise ValueError(f"{entry['name']} has invalid {split} episode ids")
        for episode in identifiers:
            path = hdf5_root / split / entry["name"] / f"episode_{episode:06d}.hdf5"
            if not path.is_file():
                raise ValueError(f"{split} episode is absent: {path}")
            result.append((entry["name"], episode, path))
    if not result:
        raise ValueError(f"conversion manifest has no {split} episodes")
    return tuple(result)


def model_actions_to_live_targets(
    prediction: tuple[tuple[float, ...], ...]
) -> tuple[tuple[float, ...], ...]:
    """The model was trained in hand radians; the live service receives [0,1]."""
    return RUNNER.training_actions_to_live_targets(prediction)


def explicitly_project_live_targets(
    prediction: tuple[tuple[float, ...], ...]
) -> tuple[tuple[tuple[float, ...], ...], tuple[dict[str, Any], ...]]:
    """Project only converted live hand values and retain every boundary change.

    This deliberately mirrors the action-plan interface transform: model
    actions are first converted out of their training-time radian coordinate
    system, then projected in the live service's closed normalized interval.
    It never treats a radian number as a normalized hand command.
    """
    live_targets = model_actions_to_live_targets(prediction)
    projected: list[tuple[float, ...]] = []
    alterations: list[dict[str, Any]] = []
    for target_index, target in enumerate(live_targets):
        if len(target) != ACTION_DIMENSION:
            raise ValueError(f"converted target {target_index} does not contain 26 values")
        bounded_hands: list[float] = []
        for hand_index, value in enumerate(target[ARM_DIMENSION:]):
            if not math.isfinite(value):
                raise ValueError("converted live hand target contains a non-finite value")
            bounded = min(1.0, max(0.0, value))
            if bounded != value:
                alterations.append(
                    {
                        "target_index": target_index,
                        "action_index": ARM_DIMENSION + hand_index,
                        "original_live_normalized": value,
                        "projected_live_normalized": bounded,
                    }
                )
            bounded_hands.append(bounded)
        projected.append(target[:ARM_DIMENSION] + tuple(bounded_hands))
    return tuple(projected), tuple(alterations)


def training_targets_to_live_targets(
    target: tuple[tuple[float, ...], ...]
) -> tuple[tuple[float, ...], ...]:
    """Absorb only known float32 representation noise at recorded hard limits."""
    converted = model_actions_to_live_targets(target)
    corrected: list[tuple[float, ...]] = []
    for step in converted:
        hands: list[float] = []
        for value in step[ARM_DIMENSION:]:
            if value < -TRAINING_LABEL_LIMIT_TOLERANCE or value > 1.0 + TRAINING_LABEL_LIMIT_TOLERANCE:
                raise ValueError("converted training target exceeds the live BrainCo [0,1] contract")
            hands.append(min(1.0, max(0.0, value)))
        corrected.append(step[:ARM_DIMENSION] + tuple(hands))
    return tuple(corrected)


def apply_calibrator(
    prediction: tuple[tuple[float, ...], ...], scales: tuple[float, ...], offsets: tuple[float, ...]
) -> tuple[tuple[float, ...], ...]:
    if len(scales) != HAND_DIMENSION or len(offsets) != HAND_DIMENSION:
        raise ValueError("calibrator must contain twelve scales and offsets")
    result = []
    for step in prediction:
        hands = tuple(
            1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, scale * value + offset))))
            for value, scale, offset in zip(step[ARM_DIMENSION:], scales, offsets, strict=True)
        )
        result.append(step[:ARM_DIMENSION] + hands)
    return tuple(result)


def fit_calibrator(
    predictions: list[tuple[tuple[float, ...], ...]], targets: list[tuple[tuple[float, ...], ...]], *, steps: int, learning_rate: float
) -> tuple[tuple[float, ...], tuple[float, ...], float]:
    """Fit p=sigmoid(softplus(a)*raw+b); monotonicity and bounds are structural."""
    if len(predictions) != len(targets) or not predictions:
        raise ValueError("calibration examples and targets must be non-empty and aligned")
    if steps <= 0 or learning_rate <= 0.0:
        raise ValueError("calibration budget must be positive")
    try:
        import torch
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"torch is required for calibration fitting: {error}") from error
    raw = torch.tensor(
        [[value for step in prediction for value in step[ARM_DIMENSION:]] for prediction in predictions],
        dtype=torch.float64,
    ).reshape(-1, HAND_DIMENSION)
    expected = torch.tensor(
        [
            [value for step in training_targets_to_live_targets(target) for value in step[ARM_DIMENSION:]]
            for target in targets
        ],
        dtype=torch.float64,
    ).reshape(-1, HAND_DIMENSION)
    if torch.any(expected < 0.0) or torch.any(expected > 1.0):
        raise ValueError("converted training targets violate the live BrainCo [0,1] contract")
    raw_scale = torch.zeros(HAND_DIMENSION, dtype=torch.float64, requires_grad=True)
    offset = torch.zeros(HAND_DIMENSION, dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.Adam((raw_scale, offset), lr=learning_rate)
    for _ in range(steps):
        optimizer.zero_grad()
        values = torch.sigmoid(torch.nn.functional.softplus(raw_scale) * raw + offset)
        loss = torch.mean((values - expected) ** 2)
        loss.backward()
        optimizer.step()
    scales = tuple(float(value) for value in torch.nn.functional.softplus(raw_scale).detach().tolist())
    offsets = tuple(float(value) for value in offset.detach().tolist())
    return scales, offsets, float(loss.detach())


def select_candidate(baseline: dict[str, Any], calibrated: dict[str, Any]) -> tuple[str, str]:
    if baseline["brainco_values_outside_live_range"] != 0:
        raise ValueError("explicit-projection baseline violated the closed hand-position contract")
    if calibrated["brainco_values_outside_live_range"] != 0:
        return (
            "unit_conversion_explicit_projection_baseline",
            "calibrator violated the closed hand-position contract",
        )
    if calibrated["mean_mse_hand_normalized"] > baseline["mean_mse_hand_normalized"] + 1e-12:
        return (
            "unit_conversion_explicit_projection_baseline",
            "calibrator regressed frozen held-out hand MSE",
        )
    return "bounded_monotonic_calibrator", "calibrator met all frozen held-out gates"


def _load_case(path: Path) -> tuple[tuple[float, ...], tuple[tuple[float, ...], ...], Any, str]:
    try:
        import h5py
        from PIL import Image
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"HDF5/image evaluation dependencies are unavailable: {error}") from error
    with h5py.File(path, "r") as source:
        state_raw = source["observations/qpos"]
        action_raw = source["action"]
        if state_raw.shape[1] != ACTION_DIMENSION or action_raw.shape[1] != ACTION_DIMENSION:
            raise ValueError(f"{path} violates the 26-D BrainCo contract")
        payload = bytes(source["observations/images/image_left_top"][0])
        with Image.open(io.BytesIO(payload)) as raw_image:
            image = raw_image.convert("RGB").resize(RUNNER.MODEL_IMAGE_SIZE, Image.Resampling.BILINEAR)
        instruction_raw = source["language_raw"][()]
        instruction = instruction_raw.decode("utf-8") if isinstance(instruction_raw, bytes) else str(instruction_raw)
        return (
            tuple(float(value) for value in state_raw[0]),
            EVALUATOR.target_chunk(action_raw[:]),
            image,
            instruction,
        )


def _predict_cases(
    cases: tuple[tuple[str, int, Path], ...], model: Any, torch_runtime: Any, stats: dict[str, Any], args: argparse.Namespace
) -> tuple[list[tuple[tuple[float, ...], ...]], list[tuple[tuple[float, ...], ...]]]:
    predictions = []
    targets = []
    for index, (_, _, path) in enumerate(cases):
        state, target, image, instruction = _load_case(path)
        predictions.append(RUNNER._infer(model, torch_runtime, state, image, instruction, stats, args.seed + index, args.device))
        targets.append(target)
    return predictions, targets


def _live_metrics(
    prediction: tuple[tuple[float, ...], ...], target: tuple[tuple[float, ...], ...]
) -> dict[str, float | int]:
    target_live = training_targets_to_live_targets(target)
    if len(prediction) != ACTION_HORIZON or len(target_live) != ACTION_HORIZON:
        raise ValueError("live prediction and target must contain 25 steps")
    arm_errors = [
        predicted - expected
        for predicted_step, expected_step in zip(prediction, target_live, strict=True)
        for predicted, expected in zip(
            predicted_step[:ARM_DIMENSION], expected_step[:ARM_DIMENSION], strict=True
        )
    ]
    hand_errors = [
        predicted - expected
        for predicted_step, expected_step in zip(prediction, target_live, strict=True)
        for predicted, expected in zip(
            predicted_step[ARM_DIMENSION:], expected_step[ARM_DIMENSION:], strict=True
        )
    ]
    hand_values = [value for step in prediction for value in step[ARM_DIMENSION:]]
    return {
        "mse_arm_14d": sum(error * error for error in arm_errors) / len(arm_errors),
        "mse_hand_normalized": sum(error * error for error in hand_errors) / len(hand_errors),
        "brainco_values_outside_live_range": sum(value < 0.0 or value > 1.0 for value in hand_values),
    }


def _aggregate_live(
    predictions: list[tuple[tuple[float, ...], ...]], targets: list[tuple[tuple[float, ...], ...]]
) -> dict[str, Any]:
    cases = [_live_metrics(prediction, target) for prediction, target in zip(predictions, targets, strict=True)]
    total_hand_values = len(cases) * ACTION_HORIZON * HAND_DIMENSION
    violations = sum(int(case["brainco_values_outside_live_range"]) for case in cases)
    return {
        "mean_mse_arm_14d": sum(float(case["mse_arm_14d"]) for case in cases) / len(cases),
        "mean_mse_hand_normalized": sum(float(case["mse_hand_normalized"]) for case in cases) / len(cases),
        "brainco_values_outside_live_range": violations,
        "brainco_values_outside_live_range_rate": violations / total_hand_values,
    }


def evolve(args: argparse.Namespace) -> dict[str, Any]:
    checkpoint = args.checkpoint.resolve()
    expected_checkpoint = args.expected_checkpoint_sha256.lower()
    if _sha256(checkpoint) != expected_checkpoint:
        raise ValueError("VLA checkpoint SHA-256 does not match the frozen artifact")
    audit_path = args.training_time_audit.resolve()
    interval = EVALUATOR._audit_interval(audit_path, args.expected_training_time_audit_sha256.lower())
    summary_path = args.conversion_summary.resolve()
    summary = _read_object(summary_path, "conversion summary")
    train_cases = split_cases(summary, args.hdf5_root.resolve(), "train")
    held_out_cases = split_cases(summary, args.hdf5_root.resolve(), "held_out")
    stats, _ = RUNNER._normalization_stats(checkpoint)
    model, torch_runtime = RUNNER._load_policy(checkpoint, args.vlm_base.resolve(), args.source_root.resolve(), args.device)
    train_predictions, train_targets = _predict_cases(train_cases, model, torch_runtime, stats, args)
    scales, offsets, train_loss = fit_calibrator(train_predictions, train_targets, steps=args.calibration_steps, learning_rate=args.calibration_learning_rate)
    held_predictions, held_targets = _predict_cases(held_out_cases, model, torch_runtime, stats, args)
    unprojected_baseline = _aggregate_live(
        [model_actions_to_live_targets(value) for value in held_predictions], held_targets
    )
    baseline_predictions: list[tuple[tuple[float, ...], ...]] = []
    projection_alterations: list[dict[str, Any]] = []
    for case_index, (prediction, (dataset, episode, _)) in enumerate(
        zip(held_predictions, held_out_cases, strict=True)
    ):
        projected, alterations = explicitly_project_live_targets(prediction)
        baseline_predictions.append(projected)
        projection_alterations.extend(
            {
                "case_index": case_index,
                "dataset": dataset,
                "episode": episode,
                **alteration,
            }
            for alteration in alterations
        )
    baseline = _aggregate_live(baseline_predictions, held_targets)
    baseline["explicit_projection"] = {
        "method": "model_radians_to_live_normalized_then_clamp_to_closed_interval_0_1",
        "alteration_count": len(projection_alterations),
        "alterations": projection_alterations,
        "warning": "projection is an explicit live-interface transform, not evidence that the model predicted bounded values",
    }
    calibrated = _aggregate_live(
        [apply_calibrator(value, scales, offsets) for value in held_predictions], held_targets
    )
    selected, decision = select_candidate(baseline, calibrated)
    return {
        "schema_version": 1,
        "protocol": PROTOCOL,
        "result": "unifolm_vla_brainco_calibration_evolution_completed",
        "execution_mode": "offline-zero-write",
        "hypothesis": "a monotonic bounded calibrator can improve frozen held-out normalized-hand error without weakening the explicit model-radians-to-live-normalized projection baseline",
        "inputs": {
            "checkpoint": {"path": str(checkpoint), "sha256": _sha256(checkpoint)},
            "conversion_summary": {"path": str(summary_path), "sha256": _sha256(summary_path)},
            "training_time_audit": {"path": str(audit_path), "sha256": _sha256(audit_path)},
        },
        "experiment_budget": {"train_episodes": len(train_cases), "held_out_episodes": len(held_out_cases), "calibration_parameters": HAND_DIMENSION * 2, "calibration_steps": args.calibration_steps},
        "contract": {"action_dimension": ACTION_DIMENSION, "action_horizon": ACTION_HORIZON, "sample_interval_seconds": interval, "hand_output_range": [0.0, 1.0]},
        "candidate": {"kind": "bounded_monotonic_calibrator", "formula": "sigmoid(softplus(scale)*raw_hand_action+offset)", "scales": list(scales), "offsets": list(offsets), "train_mse_hand_12d": train_loss},
        "frozen_held_out_evaluation": {
            "unit_conversion_before_explicit_projection_diagnostics": unprojected_baseline,
            "unit_conversion_explicit_projection_baseline": baseline,
            "bounded_monotonic_calibrator": calibrated,
        },
        "selection": {"selected": selected, "reason": decision, "physical_execution_authorized": False},
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
    parser.add_argument("--calibration-steps", type=int, default=500)
    parser.add_argument("--calibration-learning-rate", type=float, default=0.05)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    RUNNER._restart_with_environment_cuda_libraries()
    args = parse_args()
    try:
        if not args.output.parent.is_dir():
            raise ValueError(f"output parent does not exist: {args.output.parent}")
        result = evolve(args)
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
        print(json.dumps({"protocol": PROTOCOL, "result": "unifolm_vla_brainco_calibration_evolution_rejected", "reason": str(error), "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

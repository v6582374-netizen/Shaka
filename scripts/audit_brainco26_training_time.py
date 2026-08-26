#!/usr/bin/env python3
"""Verify the recorded 30 Hz BrainCo26 training-time contract without hardware I/O.

This is evidence generation, not a robot controller.  It reads the original
LeRobot parquet records and their 26-D HDF5 materialisation, checks that each
episode preserves every frame/state/action exactly, then binds the observed
sample interval to the frozen UniFoLM configuration.  A model's training
cadence is never an actuator permission or an allowed command frequency.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.brainco26-training-time-audit.v1"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
TIMESTAMP_TOLERANCE_SECONDS = 0.0001


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


def _vector(value: Any, description: str) -> tuple[float, ...]:
    if not isinstance(value, (list, tuple)) or len(value) != ACTION_DIMENSION:
        raise ValueError(f"{description} must contain {ACTION_DIMENSION} values")
    try:
        result = tuple(float(item) for item in value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{description} contains a non-number") from error
    if not all(math.isfinite(item) for item in result):
        raise ValueError(f"{description} contains a non-finite value")
    return result


def validate_episode_records(
    records: list[dict[str, Any]], *, fps: int
) -> tuple[dict[int, list[dict[str, Any]]], dict[str, Any]]:
    """Check timestamp/index continuity, retaining records for HDF5 comparison."""
    if not isinstance(fps, int) or fps <= 0:
        raise ValueError("dataset fps must be a positive integer")
    episodes: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row_number, record in enumerate(records):
        try:
            episode = int(record["episode_index"])
            frame = int(record["frame_index"])
            timestamp = float(record["timestamp"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"parquet row {row_number} lacks valid timing metadata") from error
        if episode < 0 or frame < 0 or not math.isfinite(timestamp):
            raise ValueError(f"parquet row {row_number} has invalid episode timing metadata")
        episodes[episode].append(
            {
                "frame_index": frame,
                "timestamp": timestamp,
                "state": _vector(record["observation.state"], f"row {row_number} state"),
                "action": _vector(record["action"], f"row {row_number} action"),
            }
        )
    if not episodes:
        raise ValueError("dataset contains no parquet records")
    expected_episodes = list(range(len(episodes)))
    if sorted(episodes) != expected_episodes:
        raise ValueError("episode indices are not contiguous from zero")

    expected_interval = 1.0 / fps
    minimum_interval = math.inf
    maximum_interval = 0.0
    maximum_interval_error = 0.0
    for episode, rows in episodes.items():
        rows.sort(key=lambda row: row["frame_index"])
        for expected_frame, row in enumerate(rows):
            if row["frame_index"] != expected_frame:
                raise ValueError(f"episode {episode} frame indices are not contiguous from zero")
            expected_timestamp = expected_frame * expected_interval
            if abs(row["timestamp"] - expected_timestamp) > TIMESTAMP_TOLERANCE_SECONDS:
                raise ValueError(f"episode {episode} timestamp disagrees with its {fps} Hz frame index")
        for previous, current in zip(rows, rows[1:]):
            interval = current["timestamp"] - previous["timestamp"]
            error = abs(interval - expected_interval)
            if error > TIMESTAMP_TOLERANCE_SECONDS:
                raise ValueError(f"episode {episode} contains a timestamp gap or cadence change")
            minimum_interval = min(minimum_interval, interval)
            maximum_interval = max(maximum_interval, interval)
            maximum_interval_error = max(maximum_interval_error, error)
    return episodes, {
        "episodes": len(episodes),
        "frames": sum(len(rows) for rows in episodes.values()),
        "fps": fps,
        "sample_interval_seconds": expected_interval,
        "minimum_observed_interval_seconds": None if minimum_interval == math.inf else minimum_interval,
        "maximum_observed_interval_seconds": None if minimum_interval == math.inf else maximum_interval,
        "maximum_interval_error_seconds": maximum_interval_error,
    }


def _read_parquet_records(paths: list[Path]) -> list[dict[str, Any]]:
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"pyarrow is required to read LeRobot parquet: {error}") from error
    columns = ["episode_index", "frame_index", "timestamp", "observation.state", "action"]
    records: list[dict[str, Any]] = []
    for path in paths:
        table = parquet.read_table(path, columns=columns)
        values = table.to_pydict()
        records.extend(dict(zip(columns, row, strict=True)) for row in zip(*(values[name] for name in columns), strict=True))
    return records


def _audit_hdf5(
    root: Path,
    dataset_name: str,
    split_ids: dict[str, list[int]],
    episodes: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    try:
        import h5py
        import numpy as np
    except ImportError as error:  # pragma: no cover - environment-specific
        raise RuntimeError(f"h5py and numpy are required to audit HDF5: {error}") from error
    files = 0
    for split, episode_ids in split_ids.items():
        for episode_id in episode_ids:
            path = root / split / dataset_name / f"episode_{episode_id:06d}.hdf5"
            if not path.is_file():
                raise ValueError(f"missing HDF5 episode: {path}")
            rows = episodes.get(episode_id)
            if rows is None:
                raise ValueError(f"HDF5 episode {episode_id} has no source parquet episode")
            with h5py.File(path, "r") as source:
                if int(source.attrs.get("schema_version", -1)) != 1:
                    raise ValueError(f"{path} has an unsupported HDF5 schema")
                if str(source.attrs.get("dataset_name", "")) != dataset_name:
                    raise ValueError(f"{path} records the wrong dataset name")
                if int(source.attrs.get("episode_index", -1)) != episode_id:
                    raise ValueError(f"{path} records the wrong episode index")
                if str(source.attrs.get("split", "")) != split:
                    raise ValueError(f"{path} records the wrong split")
                try:
                    h5_state = source["observations/qpos"][:]
                    h5_action = source["action"][:]
                    h5_image = source["observations/images/image_left_top"]
                except KeyError as error:
                    raise ValueError(f"{path} lacks a required BrainCo26 HDF5 field") from error
                expected_state = np.asarray([row["state"] for row in rows], dtype=np.float32)
                expected_action = np.asarray([row["action"] for row in rows], dtype=np.float32)
                if h5_state.shape != expected_state.shape or h5_action.shape != expected_action.shape:
                    raise ValueError(f"{path} does not preserve the source frame count and 26-D contract")
                if h5_image.shape[0] != len(rows):
                    raise ValueError(f"{path} primary-camera frame count differs from state/action")
                if not np.array_equal(h5_state, expected_state) or not np.array_equal(h5_action, expected_action):
                    raise ValueError(f"{path} state/action values differ from original LeRobot records")
            files += 1
    expected_ids = {episode for values in split_ids.values() for episode in values}
    if expected_ids != set(episodes):
        raise ValueError(f"{dataset_name} split manifest does not cover every source episode exactly once")
    return {"hdf5_files": files, "state_and_action_exactly_preserved": True}


def _manifest_datasets(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    manifest = summary.get("manifest")
    conversion = summary.get("conversion")
    if not isinstance(manifest, dict) or not isinstance(conversion, dict):
        raise ValueError("conversion summary lacks manifest or conversion evidence")
    declared = manifest.get("datasets")
    converted = conversion.get("datasets")
    if not isinstance(declared, list) or not isinstance(converted, list):
        raise ValueError("conversion summary has invalid dataset lists")
    converted_by_name = {
        item.get("dataset"): item for item in converted if isinstance(item, dict) and isinstance(item.get("dataset"), str)
    }
    result: dict[str, dict[str, Any]] = {}
    for item in declared:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValueError("conversion manifest contains an invalid dataset entry")
        name = item["name"]
        train = item.get("train_episode_ids")
        held_out = item.get("held_out_episode_ids")
        if not all(isinstance(value, int) and value >= 0 for value in (train or []) + (held_out or [])):
            raise ValueError(f"{name} split manifest has invalid episode ids")
        if not isinstance(train, list) or not isinstance(held_out, list) or set(train).intersection(held_out):
            raise ValueError(f"{name} split manifest is invalid")
        converted_item = converted_by_name.get(name)
        if not isinstance(converted_item, dict):
            raise ValueError(f"{name} is absent from conversion evidence")
        if converted_item.get("selected_episodes") != len(train) + len(held_out):
            raise ValueError(f"{name} selected episode count disagrees with its split manifest")
        if converted_item.get("written") != converted_item.get("selected_episodes") or converted_item.get("skipped") != 0:
            raise ValueError(f"{name} conversion was incomplete")
        result[name] = {"splits": {"train": train, "held_out": held_out}, "conversion": converted_item}
    if set(converted_by_name) != set(result):
        raise ValueError("conversion evidence contains datasets absent from the manifest")
    return result


def audit(
    datasets_root: Path, hdf5_root: Path, conversion_summary: Path, training_config: Path
) -> dict[str, Any]:
    summary = _read_object(conversion_summary, "conversion summary")
    entries = _manifest_datasets(summary)
    config = _read_object(training_config, "training config")
    action_model = config.get("framework", {}).get("action_model") if isinstance(config.get("framework"), dict) else None
    if not isinstance(action_model, dict) or (
        action_model.get("action_dim"), action_model.get("state_dim"), action_model.get("action_horizon")
    ) != (ACTION_DIMENSION, ACTION_DIMENSION, ACTION_HORIZON):
        raise ValueError("training config does not declare the frozen 26-D, 25-step BrainCo26 action head")

    datasets: dict[str, Any] = {}
    for name, entry in entries.items():
        root = datasets_root / name
        meta_path = root / "meta/info.json"
        meta = _read_object(meta_path, f"{name} LeRobot metadata")
        if meta.get("robot_type") != "Unitree_G1_Tqx" or meta.get("fps") != 30:
            raise ValueError(f"{name} is not the expected 30 Hz Unitree_G1_Tqx recording")
        parquet_paths = sorted((root / "data").rglob("*.parquet"))
        if not parquet_paths:
            raise ValueError(f"{name} has no parquet records")
        episodes, timing = validate_episode_records(_read_parquet_records(parquet_paths), fps=meta["fps"])
        if meta.get("total_frames") != timing["frames"] or meta.get("total_episodes") != timing["episodes"]:
            raise ValueError(f"{name} LeRobot metadata disagrees with its parquet records")
        if entry["conversion"].get("frames") != timing["frames"]:
            raise ValueError(f"{name} conversion frame count disagrees with original records")
        datasets[name] = {
            "meta": {"path": str(meta_path), "sha256": _sha256(meta_path)},
            "parquet": [{"path": str(path), "sha256": _sha256(path)} for path in parquet_paths],
            "timing": timing,
            "hdf5": _audit_hdf5(hdf5_root, name, entry["splits"], episodes),
        }
    return {
        "schema_version": 1,
        "protocol": PROTOCOL,
        "result": "brainco26_training_time_audit_ok",
        "inputs": {
            "conversion_summary": {"path": str(conversion_summary), "sha256": _sha256(conversion_summary)},
            "training_config": {"path": str(training_config), "sha256": _sha256(training_config)},
        },
        "datasets": datasets,
        "training_time_semantics": {
            "action_horizon_steps": ACTION_HORIZON,
            "sample_interval_seconds": 1.0 / 30.0,
            "predicted_sequence_span_seconds": ACTION_HORIZON / 30.0,
            "meaning": "adjacent action targets inherit the recorded 30 Hz training cadence",
        },
        "physical_execution_authorized": False,
        "unassessed_execution_requirements": [
            "trajectory resampling and conservative actuator velocity limits",
            "workspace and collision clearance",
            "torque/contact feedback abort",
            "rt/arm_sdk watchdog and authority release",
        ],
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets-root", type=Path, required=True)
    parser.add_argument("--hdf5-root", type=Path, required=True)
    parser.add_argument("--conversion-summary", type=Path, required=True)
    parser.add_argument("--training-config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if not args.output.parent.is_dir():
            raise ValueError(f"output parent does not exist: {args.output.parent}")
        result = audit(
            args.datasets_root.resolve(),
            args.hdf5_root.resolve(),
            args.conversion_summary.resolve(),
            args.training_config.resolve(),
        )
        temporary = args.output.with_name(f".{args.output.name}.tmp")
        try:
            temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            os.replace(temporary, args.output)
        finally:
            if temporary.exists():
                temporary.unlink()
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - keep failures machine-readable
        print(json.dumps({"protocol": PROTOCOL, "result": "brainco26_training_time_audit_rejected", "reason": str(error), "writes": 0}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

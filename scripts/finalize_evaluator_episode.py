#!/usr/bin/env python3
"""Bind one controller trace to an evaluator episode and verify time coverage."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import statistics
from pathlib import Path
from typing import Any

from artifact_identity import sha256_file as _sha256_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--episode-directory", type=Path, required=True)
    parser.add_argument("--controller-trace", type=Path, required=True)
    parser.add_argument("--controller-stdout", type=Path, required=True)
    return parser.parse_args()


def _write_sha256_manifest(directory: Path) -> None:
    lines = []
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        if path.name == "sha256.txt":
            continue
        lines.append(f"{_sha256_file(path)}  {path.relative_to(directory)}")
    (directory / "sha256.txt").write_text("\n".join(lines) + "\n")


def _json_stdout_events(path: Path) -> list[dict[str, Any]]:
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _controller_time_bounds(trace: dict[str, Any]) -> tuple[int, int, int]:
    frames = trace.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("controller trace has no frames")
    offsets = []
    for frame in frames:
        if frame.get("phase") != "act_task":
            continue
        age_ms = float(frame["candidate_age_ms"])
        if age_ms >= 100.0:
            continue
        offsets.append(
            int(frame["candidate_source_time_ns"])
            + round(age_ms * 1_000_000)
            - int(frame["loop_now_ns"])
        )
    if not offsets:
        raise ValueError("controller trace has no fresh ACT clock anchors")
    offset_ns = round(statistics.median(offsets))
    return (
        int(frames[0]["loop_now_ns"]) + offset_ns,
        int(frames[-1]["loop_now_ns"]) + offset_ns,
        offset_ns,
    )


def _camera_bounds(path: Path) -> dict[str, tuple[int, int]]:
    bounds: dict[str, list[int]] = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            bounds.setdefault(row["camera_id"], []).append(int(row["frame_time_ns"]))
    return {name: (min(values), max(values)) for name, values in bounds.items()}


def _state_bounds(path: Path) -> tuple[int, int]:
    values = []
    for line in path.read_text(encoding="utf-8").splitlines():
        payload = json.loads(line)["payload"]
        values.append(int(payload["assembled_time_ns"]))
    return min(values), max(values)


def _hand_bounds(path: Path) -> dict[str, tuple[int, int]]:
    values: dict[str, list[int]] = {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            values.setdefault(row["side"], []).append(
                int(row["g1_estimated_time_ns"])
            )
    return {name: (min(items), max(items)) for name, items in values.items()}


def _coverage(
    controller_start_ns: int,
    controller_end_ns: int,
    stream_bounds: dict[str, tuple[int, int]],
) -> tuple[bool, dict[str, dict[str, int | bool]]]:
    result = {}
    for name, (start_ns, end_ns) in stream_bounds.items():
        covers = start_ns <= controller_start_ns and end_ns >= controller_end_ns
        result[name] = {
            "start_ns": start_ns,
            "end_ns": end_ns,
            "covers_controller": covers,
            "start_margin_ns": controller_start_ns - start_ns,
            "end_margin_ns": end_ns - controller_end_ns,
        }
    return all(item["covers_controller"] for item in result.values()), result


def finalize(
    episode_directory: Path,
    controller_trace: Path,
    controller_stdout: Path,
) -> dict[str, Any]:
    metadata_path = episode_directory / "capture_metadata.json"
    original_manifest = episode_directory / "sha256.txt"
    if (episode_directory / "controller_trace.json").exists():
        raise FileExistsError("episode already has a bound controller trace")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    trace = json.loads(controller_trace.read_text(encoding="utf-8"))
    stdout_events = _json_stdout_events(controller_stdout)
    final_event = stdout_events[-1] if stdout_events else {}
    if final_event.get("protocol") != trace.get("protocol"):
        raise ValueError("controller stdout and trace protocols differ")
    if final_event.get("trace_artifact") != str(controller_trace):
        raise ValueError("controller stdout did not identify the supplied trace")

    controller_start_ns, controller_end_ns, clock_offset_ns = (
        _controller_time_bounds(trace)
    )
    stream_bounds = _camera_bounds(episode_directory / "camera_timestamps.csv")
    stream_bounds["robot_state"] = _state_bounds(
        episode_directory / "robot_state.jsonl"
    )
    stream_bounds.update(
        {
            f"{side}_hand": bounds
            for side, bounds in _hand_bounds(
                episode_directory / "brainco_current.csv"
            ).items()
        }
    )
    capture_valid, coverage = _coverage(
        controller_start_ns, controller_end_ns, stream_bounds
    )

    shutil.copyfile(original_manifest, episode_directory / "sha256.recorder.txt")
    shutil.copyfile(controller_trace, episode_directory / "controller_trace.json")
    shutil.copyfile(controller_stdout, episode_directory / "controller_stdout.log")

    controller_events_path = episode_directory / "controller_events.jsonl"
    existing_events = controller_events_path.read_text(encoding="utf-8").splitlines()
    combined_events = existing_events + [
        json.dumps(event, separators=(",", ":"), sort_keys=True)
        for event in stdout_events
    ]
    combined_events.append(
        json.dumps(
            {
                "capture_valid": capture_valid,
                "controller_end_ns": controller_end_ns,
                "controller_start_ns": controller_start_ns,
                "event": "controller_trace_bound",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    controller_events_path.write_text("\n".join(combined_events) + "\n")

    metadata["purpose"] = "evaluator_evidence_development_attempt"
    metadata["recorder"] = {
        "execution_authority": metadata.pop("execution_authority"),
        "command_publishers_created": metadata.pop("command_publishers_created"),
        "writes": metadata.pop("writes"),
    }
    metadata["controller"] = {
        "protocol": trace["protocol"],
        "outcome": trace["outcome"],
        "checkpoint_digest": trace["checkpoint_digest"],
        "trace_sha256": _sha256_file(controller_trace),
        "stdout_sha256": _sha256_file(controller_stdout),
        "arm_publishers_created": final_event.get("arm_publishers_created"),
        "hand_publishers_created": final_event.get("hand_publishers_created"),
        "arm_writes": final_event.get("arm_writes"),
        "hand_updates": final_event.get("hand_updates"),
        "source_to_loop_clock_offset_ns": clock_offset_ns,
        "estimated_start_ns": controller_start_ns,
        "estimated_end_ns": controller_end_ns,
    }
    metadata["capture_quality"] = {
        "valid": capture_valid,
        "stream_coverage": coverage,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _write_sha256_manifest(episode_directory)
    return {
        "episode_id": metadata["episode_id"],
        "capture_valid": capture_valid,
        "controller_outcome": trace["outcome"],
        "sha256_manifest_sha256": _sha256_file(original_manifest),
        "coverage": coverage,
    }


def main() -> int:
    args = parse_args()
    try:
        result = finalize(
            args.episode_directory, args.controller_trace, args.controller_stdout
        )
    except Exception as error:  # noqa: BLE001 - report a single terminal result
        print(json.dumps({"result": "episode_finalization_rejected", "reason": str(error)}))
        return 2
    print(json.dumps({"result": "episode_finalized", **result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

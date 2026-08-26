#!/usr/bin/env python3
"""Run one offline, zero-write invocation from an immutable run manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import selectors
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

IDENTITY_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
RECORDER = Path(__file__).with_name("record_evaluator_episode.py")


class ManifestError(ValueError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    return parser.parse_args()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    if not path.is_file():
        raise ManifestError(f"{description} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ManifestError(f"{description} is not valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise ManifestError(f"{description} must be a JSON object")
    return value


def _required_string(value: dict[str, Any], name: str) -> str:
    item = value.get(name)
    if not isinstance(item, str) or not item:
        raise ManifestError(f"run manifest field '{name}' must be a non-empty string")
    return item


def _identity(value: dict[str, Any], name: str) -> str:
    item = _required_string(value, name)
    if IDENTITY_PATTERN.fullmatch(item) is None:
        raise ManifestError(f"run manifest field '{name}' is not a valid identity")
    return item


def _artifact_path(manifest_path: Path, value: Any, description: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ManifestError(f"{description} path must be a non-empty string")
    path = Path(value)
    if not path.is_absolute():
        path = manifest_path.parent / path
    return path.resolve()


def _verified_artifact(
    manifest_path: Path, value: Any, description: str
) -> tuple[Path, str]:
    if not isinstance(value, dict):
        raise ManifestError(f"{description} must be an object")
    path = _artifact_path(manifest_path, value.get("path"), description)
    expected_digest = value.get("sha256")
    if not isinstance(expected_digest, str) or len(expected_digest) != 64:
        raise ManifestError(f"{description} sha256 must be a 64-character digest")
    if not path.is_file():
        raise ManifestError(f"{description} is missing: {path}")
    actual_digest = _sha256_file(path)
    if actual_digest != expected_digest:
        raise ManifestError(f"{description} digest does not match: {path}")
    return path, actual_digest


def _validate_manifest(manifest_path: Path) -> dict[str, Any]:
    manifest_path = manifest_path.resolve()
    manifest = _read_object(manifest_path, "run manifest")
    if manifest.get("schema_version") != 1:
        raise ManifestError("run manifest schema_version must be 1")

    run_id = _identity(manifest, "run_id")
    invocation_id = _identity(manifest, "invocation_id")
    execution_mode = _required_string(manifest, "execution_mode")
    if execution_mode != "zero-write":
        raise ManifestError("only the 'zero-write' execution mode is supported")

    for name in (
        "task_contract_version",
        "evaluator_version",
        "standard_start_version",
        "budget_reference",
        "rollback_candidate_id",
    ):
        _required_string(manifest, name)

    maximum_duration_s = manifest.get("maximum_duration_s")
    if not isinstance(maximum_duration_s, (int, float)) or maximum_duration_s <= 0:
        raise ManifestError("maximum_duration_s must be positive")

    output_root = _artifact_path(
        manifest_path, manifest.get("output_root"), "output root"
    )
    candidate = manifest.get("candidate")
    if not isinstance(candidate, dict):
        raise ManifestError("candidate must be an object")
    candidate_id = _required_string(candidate, "candidate_id")
    candidate_package, candidate_digest = _verified_artifact(
        manifest_path,
        {
            "path": candidate.get("package_path"),
            "sha256": candidate.get("package_sha256"),
        },
        "candidate package",
    )
    package = _read_object(candidate_package, "candidate package")
    if package.get("schema_version") != 1:
        raise ManifestError("candidate package schema_version must be 1")
    if package.get("candidate_id") != candidate_id:
        raise ManifestError(
            "candidate package identity does not match the run manifest"
        )
    entrypoint = package.get("entrypoint")
    if (
        not isinstance(entrypoint, list)
        or not entrypoint
        or any(not isinstance(item, str) or not item for item in entrypoint)
    ):
        raise ManifestError(
            "candidate package entrypoint must be a non-empty string list"
        )

    safety_config, safety_digest = _verified_artifact(
        manifest_path, manifest.get("safety_config"), "safety configuration"
    )
    recorder = manifest.get("recorder", {})
    if not isinstance(recorder, dict):
        raise ManifestError("recorder must be an object")
    post_roll_s = recorder.get("post_roll_s", 1.0)
    minimum_camera_frames = recorder.get("minimum_camera_frames", 1)
    minimum_state_samples = recorder.get("minimum_state_samples", 1)
    if not isinstance(post_roll_s, (int, float)) or post_roll_s < 0:
        raise ManifestError("recorder post_roll_s must not be negative")
    if not isinstance(minimum_camera_frames, int) or minimum_camera_frames < 1:
        raise ManifestError("recorder minimum_camera_frames must be positive")
    if not isinstance(minimum_state_samples, int) or minimum_state_samples < 1:
        raise ManifestError("recorder minimum_state_samples must be positive")

    return {
        "path": manifest_path,
        "value": manifest,
        "sha256": _sha256_file(manifest_path),
        "run_id": run_id,
        "invocation_id": invocation_id,
        "output_root": output_root,
        "maximum_duration_s": float(maximum_duration_s),
        "candidate_id": candidate_id,
        "candidate_package": candidate_package,
        "candidate_package_sha256": candidate_digest,
        "candidate_entrypoint": entrypoint,
        "safety_config": safety_config,
        "safety_config_sha256": safety_digest,
        "post_roll_s": float(post_roll_s),
        "minimum_camera_frames": minimum_camera_frames,
        "minimum_state_samples": minimum_state_samples,
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def _append_stage(path: Path, stage: str, **values: Any) -> None:
    event = {
        "stage": stage,
        "time_ns": time.time_ns(),
        "command_publishers_created": 0,
        "writes": 0,
        **values,
    }
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
        stream.flush()


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("invocation exceeded maximum_duration_s")
    return remaining


def _read_process_event(
    process: subprocess.Popen[str], deadline: float, transcript: Any
) -> dict[str, Any]:
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    if not selector.select(_remaining(deadline)):
        raise TimeoutError("recorder did not produce a lifecycle event in time")
    line = process.stdout.readline()
    if not line:
        stderr = process.stderr.read() if process.stderr is not None else ""
        raise RuntimeError(
            f"recorder exited before completing its lifecycle: {stderr.strip()}"
        )
    transcript.write(line)
    transcript.flush()
    try:
        event = json.loads(line)
    except json.JSONDecodeError as error:
        raise RuntimeError("recorder produced invalid lifecycle JSON") from error
    if not isinstance(event, dict):
        raise TypeError("recorder lifecycle event must be an object")
    return event


def _run_candidate(
    manifest: dict[str, Any], deadline: float, artifacts_directory: Path
) -> dict[str, Any]:
    environment = os.environ.copy()
    environment.update(
        {
            "SHAKA_RUN_ID": manifest["run_id"],
            "SHAKA_INVOCATION_ID": manifest["invocation_id"],
            "SHAKA_EXECUTION_MODE": "zero-write",
        }
    )
    completed = subprocess.run(
        manifest["candidate_entrypoint"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=_remaining(deadline),
        check=False,
    )
    (artifacts_directory / "candidate.stderr.txt").write_text(
        completed.stderr, encoding="utf-8"
    )
    if completed.returncode != 0:
        raise RuntimeError(f"candidate process exited with {completed.returncode}")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("candidate output is not valid JSON") from error
    if not isinstance(result, dict):
        raise TypeError("candidate output must be a JSON object")
    if "task_result" in result:
        raise RuntimeError("candidate output must not contain a task result")
    if result.get("deployment_status") != "completed":
        raise RuntimeError("candidate deployment did not complete")
    if result.get("command_publishers_created") != 0 or result.get("writes") != 0:
        raise RuntimeError("zero-write candidate reported a publisher or write")
    _write_json(artifacts_directory / "candidate-result.json", result)
    return result


def _artifact(path: Path, relative_to: Path) -> dict[str, str]:
    return {"path": str(path.relative_to(relative_to)), "sha256": _sha256_file(path)}


def run(manifest_path: Path) -> dict[str, Any]:
    manifest = _validate_manifest(manifest_path)
    output_root: Path = manifest["output_root"]
    run_id: str = manifest["run_id"]
    invocation_id: str = manifest["invocation_id"]
    final_directory = output_root / run_id
    partial_directory = output_root / f".{run_id}.partial"
    claim_directory = output_root / ".invocation-claims" / invocation_id
    if final_directory.exists() or partial_directory.exists():
        raise ManifestError(f"run output already exists: {run_id}")
    if claim_directory.exists():
        raise ManifestError(f"invocation identity was already used: {invocation_id}")

    output_root.mkdir(parents=True, exist_ok=True)
    claim_directory.parent.mkdir(parents=True, exist_ok=True)
    claim_directory.mkdir()
    (claim_directory / "run-id.txt").write_text(run_id + "\n", encoding="utf-8")
    partial_directory.mkdir()
    artifacts_directory = partial_directory / "artifacts"
    artifacts_directory.mkdir()
    candidate_package_snapshot = artifacts_directory / "candidate-package.json"
    candidate_package_snapshot.write_bytes(manifest["candidate_package"].read_bytes())
    safety_config_snapshot = artifacts_directory / "safety-configuration.json"
    safety_config_snapshot.write_bytes(manifest["safety_config"].read_bytes())
    lifecycle_path = partial_directory / "lifecycle.jsonl"
    evidence_root = partial_directory / "evidence"
    manifest_copy = partial_directory / "run-manifest.json"
    manifest_copy.write_bytes(manifest["path"].read_bytes())

    _append_stage(lifecycle_path, "manifest_validated")
    _append_stage(lifecycle_path, "invocation_authority_acquired")
    readiness_path = artifacts_directory / "readiness-result.json"
    _write_json(
        readiness_path,
        {
            "ready": True,
            "execution_mode": "zero-write",
            "command_publishers_created": 0,
            "writes": 0,
        },
    )
    _append_stage(lifecycle_path, "readiness_confirmed")

    deadline = time.monotonic() + manifest["maximum_duration_s"]
    recorder_command = [
        sys.executable,
        str(RECORDER),
        "--episode-id",
        invocation_id,
        "--output-root",
        str(evidence_root),
        "--duration-s",
        str(manifest["maximum_duration_s"]),
        "--post-roll-s",
        str(manifest["post_roll_s"]),
        "--minimum-camera-frames",
        str(manifest["minimum_camera_frames"]),
        "--minimum-state-samples",
        str(manifest["minimum_state_samples"]),
        "--lifecycle-handshake",
    ]
    recorder = subprocess.Popen(
        recorder_command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    recorder_transcript_path = artifacts_directory / "recorder-stdout.jsonl"
    try:
        with recorder_transcript_path.open("w", encoding="utf-8") as transcript:
            while True:
                recorder_event = _read_process_event(recorder, deadline, transcript)
                if recorder_event.get("event") == "read_only_recorder_ready":
                    break
                if recorder_event.get("event") == "read_only_recorder_failed":
                    raise RuntimeError(
                        f"recorder failed before ready: {recorder_event.get('reason')}"
                    )
            _append_stage(lifecycle_path, "recorder_ready")

            _run_candidate(manifest, deadline, artifacts_directory)
            _append_stage(lifecycle_path, "candidate_completed")

            control_release = {
                "released": True,
                "command_publishers_created": 0,
                "writes": 0,
            }
            _write_json(artifacts_directory / "control-release.json", control_release)
            _append_stage(lifecycle_path, "control_released")

            recorder.terminate()
            while True:
                recorder_event = _read_process_event(recorder, deadline, transcript)
                if recorder_event.get("event") == "read_only_recorder_completed":
                    break
                if recorder_event.get("event") == "read_only_recorder_failed":
                    raise RuntimeError(
                        f"recorder failed after stop: {recorder_event.get('reason')}"
                    )
        recorder.wait(timeout=_remaining(deadline))
        if recorder.returncode != 0:
            stderr = recorder.stderr.read() if recorder.stderr is not None else ""
            raise RuntimeError(f"recorder exited with {recorder.returncode}: {stderr}")
    finally:
        if recorder.poll() is None:
            recorder.kill()
            recorder.wait()

    evidence_directory = evidence_root / invocation_id
    evidence_manifest = evidence_directory / "sha256.txt"
    if not evidence_manifest.is_file():
        raise RuntimeError("recorder did not publish complete invocation evidence")
    _append_stage(lifecycle_path, "evidence_completed")

    evaluation = {
        "task_result": "indeterminate",
        "reason": "offline zero-write validation does not establish a task outcome",
        "evaluator_version": manifest["value"]["evaluator_version"],
    }
    evaluation_path = artifacts_directory / "evaluation-result.json"
    _write_json(evaluation_path, evaluation)
    _append_stage(lifecycle_path, "evaluation_completed")
    _append_stage(lifecycle_path, "terminal_report_prepared")

    candidate_result_path = artifacts_directory / "candidate-result.json"
    control_release_path = artifacts_directory / "control-release.json"
    terminal_report = {
        "schema_version": 1,
        "run_id": run_id,
        "invocation_id": invocation_id,
        "execution_mode": "zero-write",
        "manifest_sha256": manifest["sha256"],
        "completed_stage": "terminal_report",
        "terminal_reason": "zero_write_invocation_completed",
        "task_result": evaluation["task_result"],
        "next_disposition": "stop_zero_write_validation",
        "command_publishers_created": 0,
        "writes": 0,
        "artifacts": {
            "run_manifest": _artifact(manifest_copy, partial_directory),
            "candidate_package": _artifact(
                candidate_package_snapshot, partial_directory
            ),
            "safety_configuration": _artifact(
                safety_config_snapshot, partial_directory
            ),
            "readiness_result": _artifact(readiness_path, partial_directory),
            "candidate_result": _artifact(candidate_result_path, partial_directory),
            "control_release": _artifact(control_release_path, partial_directory),
            "recorder_lifecycle": _artifact(
                recorder_transcript_path, partial_directory
            ),
            "invocation_evidence": {
                "path": str(evidence_directory.relative_to(partial_directory)),
                "manifest_sha256": _sha256_file(evidence_manifest),
            },
            "evaluation_result": _artifact(evaluation_path, partial_directory),
            "lifecycle_journal": _artifact(lifecycle_path, partial_directory),
        },
    }
    _write_json(partial_directory / "terminal-report.json", terminal_report)
    os.replace(partial_directory, final_directory)
    return {
        "result": "zero_write_invocation_completed",
        "run_id": run_id,
        "invocation_id": invocation_id,
        "output_directory": str(final_directory),
        "command_publishers_created": 0,
        "writes": 0,
    }


def main() -> int:
    args = parse_args()
    try:
        result = run(args.manifest)
    except Exception as error:  # noqa: BLE001 - CLI emits one machine-readable result
        print(
            json.dumps(
                {
                    "result": "zero_write_invocation_rejected",
                    "reason": str(error),
                    "command_publishers_created": 0,
                    "writes": 0,
                },
                sort_keys=True,
            ),
            flush=True,
        )
        return 2
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn

IDENTITY_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
RECORDER = Path(__file__).with_name("record_evaluator_episode.py")
ADAPTER = Path(__file__).with_name("_offline_invocation_adapter.py")


class ManifestError(ValueError):
    """The submitted manifest is invalid and the run was not accepted."""


class InvocationFailed(RuntimeError):
    """An accepted invocation stopped with a published terminal report."""

    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__(str(result["reason"]))
        self.result = result


@dataclass(frozen=True)
class VerifiedArtifact:
    path: Path
    sha256: str


@dataclass(frozen=True)
class ValidatedManifest:
    path: Path
    value: dict[str, Any]
    sha256: str
    run_id: str
    invocation_id: str
    output_root: Path
    maximum_duration_s: float
    candidate_id: str
    candidate_package: VerifiedArtifact
    safety_config: VerifiedArtifact
    budget_artifact: VerifiedArtifact
    evaluator_version: str
    post_roll_s: float
    minimum_camera_frames: int
    minimum_state_samples: int


@dataclass(frozen=True)
class RunPaths:
    final: Path
    partial: Path
    claim: Path
    artifacts: Path
    lifecycle: Path
    evidence_root: Path
    manifest_copy: Path
    candidate_copy: Path
    safety_copy: Path
    budget_copy: Path
    adapter_audit: Path
    recorder_transcript: Path


@dataclass
class RunProgress:
    completed_stage: str = "invocation_authority_acquired"


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
) -> VerifiedArtifact:
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
    return VerifiedArtifact(path, actual_digest)


def _validate_budget(value: dict[str, Any]) -> None:
    if value.get("schema_version") != 1:
        raise ManifestError("budget artifact schema_version must be 1")
    if value.get("physical_rollout_budget") != 0:
        raise ManifestError("zero-write physical rollout budget must be 0")
    if value.get("robot_runtime_budget_s") != 0:
        raise ManifestError("zero-write robot runtime budget must be 0")
    contracts_digest = value.get("frozen_contracts_sha256")
    if not isinstance(contracts_digest, str) or len(contracts_digest) != 64:
        raise ManifestError(
            "budget artifact frozen_contracts_sha256 must be a 64-character digest"
        )
    stop_reasons = value.get("global_stop_reasons")
    if (
        not isinstance(stop_reasons, list)
        or not stop_reasons
        or any(not isinstance(reason, str) or not reason for reason in stop_reasons)
    ):
        raise ManifestError("budget artifact global_stop_reasons must be non-empty")


def _validate_manifest(manifest_path: Path) -> ValidatedManifest:
    manifest_path = manifest_path.resolve()
    manifest = _read_object(manifest_path, "run manifest")
    if manifest.get("schema_version") != 1:
        raise ManifestError("run manifest schema_version must be 1")

    run_id = _identity(manifest, "run_id")
    invocation_id = _identity(manifest, "invocation_id")
    if _required_string(manifest, "execution_mode") != "zero-write":
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

    candidate = manifest.get("candidate")
    if not isinstance(candidate, dict):
        raise ManifestError("candidate must be an object")
    candidate_id = _required_string(candidate, "candidate_id")
    candidate_package = _verified_artifact(
        manifest_path,
        {
            "path": candidate.get("package_path"),
            "sha256": candidate.get("package_sha256"),
        },
        "candidate package",
    )
    package = _read_object(candidate_package.path, "candidate package")
    if package.get("schema_version") != 1:
        raise ManifestError("candidate package schema_version must be 1")
    if package.get("candidate_id") != candidate_id:
        raise ManifestError(
            "candidate package identity does not match the run manifest"
        )
    if not isinstance(package.get("deployment_evidence"), dict):
        raise ManifestError("candidate package deployment_evidence must be an object")

    safety_config = _verified_artifact(
        manifest_path, manifest.get("safety_config"), "safety configuration"
    )
    safety = _read_object(safety_config.path, "safety configuration")
    if safety.get("schema_version") != 1 or safety.get("mode") != "zero-write":
        raise ManifestError("safety configuration must enforce zero-write")

    budget_artifact = _verified_artifact(
        manifest_path, manifest.get("budget_artifact"), "budget artifact"
    )
    _validate_budget(_read_object(budget_artifact.path, "budget artifact"))

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

    return ValidatedManifest(
        path=manifest_path,
        value=manifest,
        sha256=_sha256_file(manifest_path),
        run_id=run_id,
        invocation_id=invocation_id,
        output_root=_artifact_path(
            manifest_path, manifest.get("output_root"), "output root"
        ),
        maximum_duration_s=float(maximum_duration_s),
        candidate_id=candidate_id,
        candidate_package=candidate_package,
        safety_config=safety_config,
        budget_artifact=budget_artifact,
        evaluator_version=_required_string(manifest, "evaluator_version"),
        post_roll_s=float(post_roll_s),
        minimum_camera_frames=minimum_camera_frames,
        minimum_state_samples=minimum_state_samples,
    )


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


def _complete_stage(paths: RunPaths, progress: RunProgress, stage: str) -> None:
    _append_stage(paths.lifecycle, stage)
    progress.completed_stage = stage


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
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(_remaining(deadline)):
            raise TimeoutError("recorder did not produce a lifecycle event in time")
    finally:
        selector.close()
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


def _run_adapter(
    adapter: str,
    arguments: list[str],
    output_path: Path,
    paths: RunPaths,
    deadline: float,
) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["SHAKA_INVOCATION_ADAPTER_AUDIT"] = str(paths.adapter_audit)
    completed = subprocess.run(
        [sys.executable, str(ADAPTER), adapter, *arguments],
        env=environment,
        capture_output=True,
        text=True,
        timeout=_remaining(deadline),
        check=False,
    )
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{adapter} adapter returned invalid JSON") from error
    if not isinstance(result, dict):
        raise TypeError(f"{adapter} adapter result must be a JSON object")
    _write_json(output_path, result)
    if completed.returncode != 0:
        reason = result.get("reason", completed.stderr.strip())
        raise RuntimeError(f"{adapter} adapter failed: {reason}")
    if result.get("command_publishers_created") != 0 or result.get("writes") != 0:
        raise RuntimeError(f"{adapter} adapter violated zero-write mode")
    return result


def _artifact(path: Path, relative_to: Path) -> dict[str, str]:
    return {"path": str(path.relative_to(relative_to)), "sha256": _sha256_file(path)}


def _existing_artifacts(paths: RunPaths) -> dict[str, Any]:
    candidates = {
        "run_manifest": paths.manifest_copy,
        "candidate_package": paths.candidate_copy,
        "safety_configuration": paths.safety_copy,
        "budget_artifact": paths.budget_copy,
        "readiness_result": paths.artifacts / "readiness-result.json",
        "candidate_result": paths.artifacts / "candidate-result.json",
        "control_release": paths.artifacts / "control-release.json",
        "recorder_lifecycle": paths.recorder_transcript,
        "evaluation_result": paths.artifacts / "evaluation-result.json",
        "reset_result": paths.artifacts / "reset-result.json",
        "adapter_audit": paths.adapter_audit,
        "lifecycle_journal": paths.lifecycle,
    }
    artifacts: dict[str, Any] = {
        name: _artifact(path, paths.partial)
        for name, path in candidates.items()
        if path.is_file()
    }
    evidence = paths.evidence_root / paths.claim.name
    evidence_manifest = evidence / "sha256.txt"
    if evidence_manifest.is_file():
        artifacts["invocation_evidence"] = {
            "path": str(evidence.relative_to(paths.partial)),
            "manifest_sha256": _sha256_file(evidence_manifest),
        }
    else:
        partial_evidence = paths.evidence_root / f".{paths.claim.name}.partial"
        if partial_evidence.exists():
            artifacts["partial_invocation_evidence"] = {
                "path": str(partial_evidence.relative_to(paths.partial))
            }
    return artifacts


def _terminal_report(
    manifest: ValidatedManifest,
    paths: RunPaths,
    completed_stage: str,
    terminal_reason: str,
    task_result: str,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "run_id": manifest.run_id,
        "invocation_id": manifest.invocation_id,
        "execution_mode": "zero-write",
        "manifest_sha256": manifest.sha256,
        "completed_stage": completed_stage,
        "terminal_reason": terminal_reason,
        "task_result": task_result,
        "next_disposition": "stop_zero_write_validation",
        "command_publishers_created": 0,
        "writes": 0,
        "artifacts": _existing_artifacts(paths),
    }


def _publish_failure(
    manifest: ValidatedManifest,
    paths: RunPaths,
    progress: RunProgress,
    error: Exception,
) -> NoReturn:
    reason = str(error) or type(error).__name__
    _append_stage(paths.lifecycle, "terminal_report_prepared", outcome="failed")
    report = _terminal_report(
        manifest,
        paths,
        completed_stage=progress.completed_stage,
        terminal_reason=reason,
        task_result="not_evaluated",
    )
    _write_json(paths.partial / "terminal-report.json", report)
    os.replace(paths.partial, paths.final)
    raise InvocationFailed(
        {
            "result": "zero_write_invocation_failed",
            "reason": reason,
            "run_id": manifest.run_id,
            "invocation_id": manifest.invocation_id,
            "output_directory": str(paths.final),
            "command_publishers_created": 0,
            "writes": 0,
        }
    ) from error


def _accept_run(manifest: ValidatedManifest) -> RunPaths:
    final = manifest.output_root / manifest.run_id
    partial = manifest.output_root / f".{manifest.run_id}.partial"
    claim = manifest.output_root / ".invocation-claims" / manifest.invocation_id
    if final.exists() or partial.exists():
        raise ManifestError(f"run output already exists: {manifest.run_id}")
    if claim.exists():
        raise ManifestError(
            f"invocation identity was already used: {manifest.invocation_id}"
        )

    manifest.output_root.mkdir(parents=True, exist_ok=True)
    claim.parent.mkdir(parents=True, exist_ok=True)
    try:
        claim.mkdir()
    except FileExistsError as error:
        raise ManifestError(
            f"invocation identity was already used: {manifest.invocation_id}"
        ) from error
    (claim / "run-id.txt").write_text(manifest.run_id + "\n", encoding="utf-8")
    try:
        partial.mkdir()
    except FileExistsError as error:
        raise ManifestError(f"run output already exists: {manifest.run_id}") from error

    artifacts = partial / "artifacts"
    artifacts.mkdir()
    paths = RunPaths(
        final=final,
        partial=partial,
        claim=claim,
        artifacts=artifacts,
        lifecycle=partial / "lifecycle.jsonl",
        evidence_root=partial / "evidence",
        manifest_copy=partial / "run-manifest.json",
        candidate_copy=artifacts / "candidate-package.json",
        safety_copy=artifacts / "safety-configuration.json",
        budget_copy=artifacts / "budget-artifact.json",
        adapter_audit=artifacts / "adapter-audit.jsonl",
        recorder_transcript=artifacts / "recorder-stdout.jsonl",
    )
    paths.manifest_copy.write_bytes(manifest.path.read_bytes())
    paths.candidate_copy.write_bytes(manifest.candidate_package.path.read_bytes())
    paths.safety_copy.write_bytes(manifest.safety_config.path.read_bytes())
    paths.budget_copy.write_bytes(manifest.budget_artifact.path.read_bytes())
    _append_stage(paths.lifecycle, "manifest_validated")
    _append_stage(paths.lifecycle, "invocation_authority_acquired")
    return paths


def _start_recorder(
    manifest: ValidatedManifest, paths: RunPaths
) -> subprocess.Popen[str]:
    command = [
        sys.executable,
        str(RECORDER),
        "--episode-id",
        manifest.invocation_id,
        "--output-root",
        str(paths.evidence_root),
        "--duration-s",
        str(manifest.maximum_duration_s),
        "--post-roll-s",
        str(manifest.post_roll_s),
        "--minimum-camera-frames",
        str(manifest.minimum_camera_frames),
        "--minimum-state-samples",
        str(manifest.minimum_state_samples),
        "--lifecycle-handshake",
    ]
    return subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )


def run(manifest_path: Path) -> dict[str, Any]:
    manifest = _validate_manifest(manifest_path)
    paths = _accept_run(manifest)
    progress = RunProgress()
    deadline = time.monotonic() + manifest.maximum_duration_s
    recorder: subprocess.Popen[str] | None = None
    try:
        readiness = _run_adapter(
            "readiness",
            [
                "--claim-directory",
                str(paths.claim),
                "--execution-mode",
                "zero-write",
            ],
            paths.artifacts / "readiness-result.json",
            paths,
            deadline,
        )
        if readiness.get("ready") is not True:
            raise RuntimeError("readiness adapter did not establish readiness")
        _complete_stage(paths, progress, "readiness_confirmed")

        recorder = _start_recorder(manifest, paths)
        with paths.recorder_transcript.open("w", encoding="utf-8") as transcript:
            while True:
                event = _read_process_event(recorder, deadline, transcript)
                if event.get("event") == "read_only_recorder_ready":
                    break
                if event.get("event") == "read_only_recorder_failed":
                    raise RuntimeError(
                        f"recorder failed before ready: {event.get('reason')}"
                    )
            _complete_stage(paths, progress, "recorder_ready")

            candidate_result = _run_adapter(
                "candidate",
                ["--package", str(paths.candidate_copy)],
                paths.artifacts / "candidate-result.json",
                paths,
                deadline,
            )
            if candidate_result.get("candidate_id") != manifest.candidate_id:
                raise RuntimeError("candidate adapter returned the wrong identity")
            if candidate_result.get("deployment_status") != "completed":
                raise RuntimeError("candidate deployment did not complete")
            _complete_stage(paths, progress, "candidate_completed")

            release = _run_adapter(
                "release",
                [],
                paths.artifacts / "control-release.json",
                paths,
                deadline,
            )
            if release.get("released") is not True:
                raise RuntimeError("control release adapter did not release authority")
            _complete_stage(paths, progress, "control_released")

            recorder.terminate()
            while True:
                event = _read_process_event(recorder, deadline, transcript)
                if event.get("event") == "read_only_recorder_completed":
                    break
                if event.get("event") == "read_only_recorder_failed":
                    raise RuntimeError(
                        f"recorder failed after stop: {event.get('reason')}"
                    )
        recorder.wait(timeout=_remaining(deadline))
        if recorder.returncode != 0:
            stderr = recorder.stderr.read() if recorder.stderr is not None else ""
            raise RuntimeError(f"recorder exited with {recorder.returncode}: {stderr}")

        evidence_manifest = paths.evidence_root / manifest.invocation_id / "sha256.txt"
        if not evidence_manifest.is_file():
            raise RuntimeError("recorder did not publish complete invocation evidence")
        _complete_stage(paths, progress, "evidence_completed")

        evaluation = _run_adapter(
            "evaluation",
            [
                "--evidence-manifest",
                str(evidence_manifest),
                "--evaluator-version",
                manifest.evaluator_version,
            ],
            paths.artifacts / "evaluation-result.json",
            paths,
            deadline,
        )
        task_result = evaluation.get("task_result")
        if task_result not in {"succeeded", "failed", "indeterminate", "aborted"}:
            raise RuntimeError("evaluation adapter returned an invalid task result")
        _complete_stage(paths, progress, "evaluation_completed")

        reset = _run_adapter(
            "reset",
            ["--execution-mode", "zero-write", "--task-result", str(task_result)],
            paths.artifacts / "reset-result.json",
            paths,
            deadline,
        )
        if reset.get("requested") is not False:
            raise RuntimeError("zero-write reset adapter requested a reset")
        _complete_stage(paths, progress, "reset_disposition_recorded")
    except Exception as error:  # noqa: BLE001 - every accepted run must terminate
        if recorder is not None and recorder.poll() is None:
            recorder.kill()
            recorder.wait()
        _publish_failure(manifest, paths, progress, error)
    finally:
        if recorder is not None and recorder.poll() is None:
            recorder.kill()
            recorder.wait()

    _append_stage(paths.lifecycle, "terminal_report_prepared")
    report = _terminal_report(
        manifest,
        paths,
        completed_stage="terminal_report",
        terminal_reason="zero_write_invocation_completed",
        task_result=str(task_result),
    )
    _write_json(paths.partial / "terminal-report.json", report)
    os.replace(paths.partial, paths.final)
    return {
        "result": "zero_write_invocation_completed",
        "run_id": manifest.run_id,
        "invocation_id": manifest.invocation_id,
        "output_directory": str(paths.final),
        "command_publishers_created": 0,
        "writes": 0,
    }


def main() -> int:
    args = parse_args()
    try:
        result = run(args.manifest)
    except InvocationFailed as error:
        print(json.dumps(error.result, sort_keys=True), flush=True)
        return 2
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

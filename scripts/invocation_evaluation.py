"""Finalize, verify, prepare, and evaluate one invocation evidence directory."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from artifact_identity import sha256_file as _sha256_file
from evaluate_episode_with_vlm import evaluate_evidence, prepare_evidence
from finalize_evaluator_episode import finalize

SHA256_LINE = re.compile(r"([0-9a-f]{64})  (.+)\Z")


def _verified_manifest_entries(evidence_directory: Path) -> dict[Path, str]:
    manifest_path = evidence_directory / "sha256.txt"
    if not manifest_path.is_file():
        raise ValueError("complete invocation evidence manifest is absent")
    entries: dict[Path, str] = {}
    for line_number, line in enumerate(
        manifest_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        match = SHA256_LINE.fullmatch(line)
        if match is None:
            raise ValueError(f"invalid invocation evidence manifest line {line_number}")
        relative_path = Path(match.group(2))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("invocation evidence manifest contains an unsafe path")
        if relative_path in entries:
            raise ValueError("invocation evidence manifest contains a duplicate path")
        evidence_path = evidence_directory / relative_path
        resolved_path = evidence_path.resolve()
        if not resolved_path.is_relative_to(evidence_directory.resolve()):
            raise ValueError("invocation evidence manifest escapes its directory")
        if not evidence_path.is_file():
            raise ValueError(f"invocation evidence file is missing: {relative_path}")
        expected = match.group(1)
        if _sha256_file(evidence_path) != expected:
            raise ValueError(f"invocation evidence digest mismatch: {relative_path}")
        entries[relative_path] = expected
    actual_files = {
        path.relative_to(evidence_directory)
        for path in evidence_directory.rglob("*")
        if path.is_file() and path != manifest_path
    }
    if actual_files != set(entries):
        unbound = sorted(str(path) for path in actual_files - set(entries))
        missing = sorted(str(path) for path in set(entries) - actual_files)
        raise ValueError(
            f"invocation evidence manifest/file set differs: "
            f"unbound={unbound}, missing={missing}"
        )
    return entries


def verify_completed_evidence(
    evidence_directory: Path, invocation_id: str
) -> dict[str, Any]:
    evidence_directory = evidence_directory.resolve()
    if evidence_directory.name != invocation_id:
        raise ValueError("invocation evidence identity does not match its directory")
    entries = _verified_manifest_entries(evidence_directory)
    metadata_path = evidence_directory / "capture_metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invocation capture metadata is missing or invalid") from error
    if not isinstance(metadata, dict) or metadata.get("episode_id") != invocation_id:
        raise ValueError("invocation evidence identity does not match capture metadata")
    return {
        "invocation_id": invocation_id,
        "manifest_sha256": _sha256_file(evidence_directory / "sha256.txt"),
        "capture_metadata_sha256": _sha256_file(metadata_path),
        "files": len(entries),
        "capture_valid": bool(metadata.get("capture_quality", {}).get("valid", False)),
        "controller_outcome": (metadata.get("controller") or {}).get("outcome"),
    }


def finalize_invocation_evidence(
    evidence_directory: Path,
    invocation_id: str,
    controller_trace: Path,
    controller_stdout: Path,
) -> dict[str, Any]:
    before = verify_completed_evidence(evidence_directory, invocation_id)
    finalization = finalize(evidence_directory, controller_trace, controller_stdout)
    after = verify_completed_evidence(evidence_directory, invocation_id)
    return {"before": before, "finalization": finalization, "after": after}


def evaluate_finalized_invocation(
    evidence_directory: Path,
    invocation_id: str,
    prepared_evidence_directory: Path,
    evaluator_config: Path,
    *,
    client: Any | None = None,
) -> dict[str, Any]:
    source = verify_completed_evidence(evidence_directory, invocation_id)
    prepared = prepare_evidence(
        evidence_directory, prepared_evidence_directory, evaluator_config
    )
    if prepared.get("episode_id") != invocation_id:
        raise ValueError("prepared evidence identity differs from the invocation")
    model_result = evaluate_evidence(
        prepared_evidence_directory, evaluator_config, client=client
    )
    if model_result.get("episode_id") != invocation_id:
        raise ValueError("model result identity differs from the invocation")
    return {
        "source_evidence": source,
        "prepared_evidence": prepared,
        "model_result": model_result,
    }

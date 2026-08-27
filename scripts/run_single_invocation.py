#!/usr/bin/env python3
"""Run one offline, zero-write invocation from an immutable run manifest."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn

from artifact_identity import sha256_file as _sha256_file
from invocation_evaluation import finalize_invocation_evidence

IDENTITY_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
RECORDER = Path(__file__).with_name("record_evaluator_episode.py")
ADAPTER = Path(__file__).with_name("_offline_invocation_adapter.py")
CONNECTED_G1_ADAPTER = Path(__file__).with_name("_connected_g1_zero_write_adapter.py")
SANDBOX = shutil.which("bwrap")
TASK_RESULTS = frozenset(
    {"succeeded", "failed", "indeterminate", "aborted", "abstained"}
)


class ManifestError(ValueError):
    """The submitted manifest is invalid and the run was not accepted."""


class InvocationFailed(RuntimeError):
    """An accepted invocation stopped with a published terminal report."""

    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__(str(result["reason"]))
        self.result = result


class InvocationInterrupted(RuntimeError):
    """The runner received a process signal after accepting the invocation."""


class DeploymentDefect(RuntimeError):
    """Candidate replay failed before consuming a physical attempt."""

    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__(str(result["reason"]))
        self.result = result


class EvaluationFailed(RuntimeError):
    """Finalized evidence could not produce an independent task result."""


@dataclass(frozen=True)
class VerifiedFile:
    path: Path
    sha256: str
    content: bytes


@dataclass(frozen=True)
class VerifiedArtifact(VerifiedFile):
    value: dict[str, Any]


@dataclass(frozen=True)
class ConnectedG1:
    network_interface: str
    camera_host: str
    discovery_timeout_s: float
    command_topics: tuple[str, ...]
    allowed_command_publishers: tuple[tuple[str, str], ...]
    native_motion_controller_topology: bool


@dataclass(frozen=True)
class ValidatedManifest:
    path: Path
    sha256: str
    content: bytes
    run_id: str
    invocation_id: str
    output_root: Path
    maximum_duration_s: float
    candidate_id: str
    candidate_package: VerifiedArtifact
    candidate_artifacts: dict[str, VerifiedFile]
    candidate_observation: VerifiedArtifact
    safety_config: VerifiedArtifact
    budget_artifact: VerifiedArtifact
    evaluator_version: str
    evaluator_config: VerifiedArtifact
    evaluator_prompt_content: bytes
    post_roll_s: float
    minimum_camera_frames: int
    minimum_state_samples: int
    connected_g1: ConnectedG1 | None


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
    candidate_bundle: Path
    candidate_runtime: Path
    candidate_observation: Path
    saved_candidate_observation: Path
    live_observation: Path
    safety_copy: Path
    budget_copy: Path
    evaluator_config: Path
    evaluator_prompt: Path
    controller_trace: Path
    controller_stdout: Path
    raw_action_plan: Path
    action_plan: Path
    static_admission: Path
    evidence_finalization: Path
    prepared_evidence: Path
    model_result: Path
    adapter_audit: Path
    recorder_transcript: Path


@dataclass
class RunProgress:
    completed_stage: str = "invocation_authority_acquired"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--connected-g1",
        action="store_true",
        help="use the read-only connected-G1 admission path bound in the manifest",
    )
    return parser.parse_args()


def _read_object(path: Path, description: str) -> tuple[dict[str, Any], bytes]:
    if not path.is_file():
        raise ManifestError(f"{description} is missing: {path}")
    try:
        content = path.read_bytes()
        value = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"{description} is not valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise ManifestError(f"{description} must be a JSON object")
    return value, content


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
    verified = _verified_file(manifest_path, value, description)
    try:
        artifact_value = json.loads(verified.content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"{description} is not valid JSON: {verified.path}") from error
    if not isinstance(artifact_value, dict):
        raise ManifestError(f"{description} must be a JSON object")
    return VerifiedArtifact(
        verified.path,
        verified.sha256,
        verified.content,
        artifact_value,
    )


def _verified_file(
    manifest_path: Path, value: Any, description: str
) -> VerifiedFile:
    if not isinstance(value, dict):
        raise ManifestError(f"{description} must be an object")
    path = _artifact_path(manifest_path, value.get("path"), description)
    expected_digest = value.get("sha256")
    if (
        not isinstance(expected_digest, str)
        or SHA256_PATTERN.fullmatch(expected_digest) is None
    ):
        raise ManifestError(f"{description} sha256 must be a 64-character digest")
    if not path.is_file():
        raise ManifestError(f"{description} is missing: {path}")
    content = path.read_bytes()
    actual_digest = hashlib.sha256(content).hexdigest()
    if actual_digest != expected_digest:
        raise ManifestError(f"{description} digest does not match: {path}")
    return VerifiedFile(path, actual_digest, content)


def _validate_python_callable(
    artifact: VerifiedFile, callable_name: str, stage: str
) -> None:
    try:
        module = ast.parse(artifact.content.decode("utf-8"), filename=str(artifact.path))
    except (UnicodeDecodeError, SyntaxError) as error:
        raise ManifestError(
            f"candidate runtime {stage} artifact is not valid Python"
        ) from error
    functions: dict[str, ast.FunctionDef] = {}
    for node in module.body:
        if isinstance(node, ast.FunctionDef):
            if (
                node.decorator_list
                or node.args.defaults
                or node.args.kw_defaults
                or node.returns is not None
                or any(
                    argument.annotation is not None
                    for argument in [
                        *node.args.posonlyargs,
                        *node.args.args,
                        *node.args.kwonlyargs,
                    ]
                )
            ):
                raise ManifestError(
                    "candidate runtime artifacts must not execute code during import"
                )
            functions[node.name] = node
        elif (
            (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant))
            or (
                isinstance(node, ast.ImportFrom)
                and node.module == "__future__"
                and all(alias.name == "annotations" for alias in node.names)
            )
            or isinstance(node, ast.Pass)
        ):
            continue
        else:
            raise ManifestError(
                "candidate runtime artifacts must not execute code during import"
            )
    function = functions.get(callable_name)
    if function is None:
        raise ManifestError(
            f"candidate runtime {stage} callable is absent: {callable_name}"
        )
    if (
        len([*function.args.posonlyargs, *function.args.args]) != 2
        or function.args.vararg
        or function.args.kwarg
    ):
        raise ManifestError(
            f"candidate runtime {stage} callable must accept exactly two positional arguments"
        )


def _validated_action_definition(
    value: dict[str, Any], description: str
) -> dict[str, Any]:
    if value.get("schema_version") != 1:
        raise ManifestError(f"{description} schema_version must be 1")
    action_id = value.get("action_definition_id")
    command_type = value.get("command_type")
    joint_names = value.get("joint_names")
    dimension = value.get("value_dimension")
    maximum_age = value.get("maximum_output_age_ns")
    if not isinstance(action_id, str) or not action_id:
        raise ManifestError(f"{description} id must be non-empty")
    if not isinstance(command_type, str) or not command_type:
        raise ManifestError(f"{description} command_type must be non-empty")
    if (
        not isinstance(joint_names, list)
        or not joint_names
        or any(not isinstance(name, str) or not name for name in joint_names)
        or len(set(joint_names)) != len(joint_names)
    ):
        raise ManifestError(f"{description} joint_names must be unique")
    if (
        not isinstance(dimension, int)
        or isinstance(dimension, bool)
        or dimension != len(joint_names)
    ):
        raise ManifestError(f"{description} dimension must match joints")
    if not isinstance(maximum_age, int) or isinstance(maximum_age, bool) or maximum_age < 0:
        raise ManifestError(f"{description} maximum_output_age_ns must not be negative")
    return {
        "action_definition_id": action_id,
        "command_type": command_type,
        "joint_names": joint_names,
        "value_dimension": dimension,
        "maximum_output_age_ns": maximum_age,
    }


def _candidate_artifacts(
    package: VerifiedArtifact, trusted_action: dict[str, Any]
) -> dict[str, VerifiedFile]:
    if "task_result" in package.value:
        raise ManifestError("candidate package must not contain a task result")
    source_version = package.value.get("source_version")
    if not isinstance(source_version, str) or not source_version:
        raise ManifestError("candidate package source_version must be non-empty")
    references = package.value.get("artifacts")
    if not isinstance(references, dict):
        raise ManifestError("candidate package artifacts must be an object")
    runtime = package.value.get("runtime")
    if not isinstance(runtime, dict):
        raise ManifestError("candidate runtime must be an object")
    runtime_kind = runtime.get("kind")
    required = (
        {"configuration", "input_preprocessor", "action_definition"}
        if runtime_kind == "python-callable-v1"
        else {"configuration", "action_definition"}
    )
    if not required.issubset(references):
        missing = ", ".join(sorted(required - references.keys()))
        raise ManifestError(f"candidate package is missing required artifacts: {missing}")
    if (
        runtime_kind != "unifolm-vla-zero-write-v1"
        and "implementation" not in references
        and "model" not in references
    ):
        raise ManifestError("candidate package must bind an implementation or model")

    artifacts: dict[str, VerifiedFile] = {}
    for name, reference in references.items():
        if not isinstance(name, str) or IDENTITY_PATTERN.fullmatch(name) is None:
            raise ManifestError("candidate artifact names must be valid identities")
        artifacts[name] = _verified_file(
            package.path, reference, f"candidate artifact '{name}'"
        )

    if runtime_kind == "python-callable-v1":
        for stage in ("preprocess", "inference"):
            entrypoint = runtime.get(stage)
            if not isinstance(entrypoint, dict):
                raise ManifestError(f"candidate runtime {stage} must be an object")
            artifact_name = entrypoint.get("artifact")
            callable_name = entrypoint.get("callable")
            if artifact_name not in artifacts:
                raise ManifestError(
                    f"candidate runtime {stage} references an unknown artifact"
                )
            if (
                not isinstance(callable_name, str)
                or not callable_name.isidentifier()
            ):
                raise ManifestError(
                    f"candidate runtime {stage} callable must be a Python identifier"
                )
            _validate_python_callable(artifacts[artifact_name], callable_name, stage)
    elif runtime_kind == "unifolm-vla-zero-write-v1":
        if runtime.get("configuration_artifact") != "configuration":
            raise ManifestError(
                "UniFoLM-VLA runtime must bind its configuration artifact"
            )
        configuration = _read_verified_object(
            artifacts["configuration"], "UniFoLM-VLA configuration"
        )
        if (
            configuration.get("schema_version") != 1
            or configuration.get("kind")
            != "unifolm_vla_zero_write_candidate_configuration"
        ):
            raise ManifestError("UniFoLM-VLA configuration has an unsupported identity")
    else:
        raise ManifestError("candidate runtime kind is unsupported")

    action = _read_verified_object(artifacts["action_definition"], "action definition")
    candidate_action = _validated_action_definition(
        action, "candidate action definition"
    )
    if candidate_action != trusted_action:
        raise ManifestError(
            "candidate action definition does not match the trusted control contract"
        )
    _read_verified_object(artifacts["configuration"], "candidate configuration")
    return artifacts


def _read_verified_object(
    artifact: VerifiedFile, description: str
) -> dict[str, Any]:
    try:
        value = json.loads(artifact.content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"{description} is not valid JSON: {artifact.path}") from error
    if not isinstance(value, dict):
        raise ManifestError(f"{description} must be a JSON object")
    return value


def _verified_plain_file(
    path: Path, expected_digest: Any, description: str
) -> bytes:
    if (
        not isinstance(expected_digest, str)
        or SHA256_PATTERN.fullmatch(expected_digest) is None
    ):
        raise ManifestError(f"{description} sha256 must be a 64-character digest")
    if not path.is_file():
        raise ManifestError(f"{description} is missing: {path}")
    content = path.read_bytes()
    actual_digest = hashlib.sha256(content).hexdigest()
    if actual_digest != expected_digest:
        raise ManifestError(f"{description} digest does not match: {path}")
    return content


def _candidate_visible_runtime_paths() -> tuple[Path, ...]:
    paths = [Path(sys.prefix).resolve()]
    for path in (Path("/lib"), Path("/lib64"), Path("/usr/lib")):
        if path.exists():
            paths.append(path.resolve())
    return tuple(paths)


def _reject_candidate_visible_path(path: Path, description: str) -> None:
    if any(
        path.is_relative_to(runtime_path)
        for runtime_path in _candidate_visible_runtime_paths()
    ):
        raise ManifestError(
            f"{description} must not be reachable from the candidate runtime"
        )


def _validate_budget(value: dict[str, Any]) -> None:
    if value.get("schema_version") != 1:
        raise ManifestError("budget artifact schema_version must be 1")
    if value.get("physical_rollout_budget") != 0:
        raise ManifestError("zero-write physical rollout budget must be 0")
    if value.get("robot_runtime_budget_s") != 0:
        raise ManifestError("zero-write robot runtime budget must be 0")
    contracts_digest = value.get("frozen_contracts_sha256")
    if (
        not isinstance(contracts_digest, str)
        or SHA256_PATTERN.fullmatch(contracts_digest) is None
    ):
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


def _connected_g1_configuration(value: Any) -> ConnectedG1 | None:
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise ManifestError("connected_g1 must be a schema_version 1 object")
    network_interface = value.get("network_interface")
    camera_host = value.get("camera_host")
    discovery_timeout_s = value.get("discovery_timeout_s")
    command_topics = value.get("command_topics")
    allowed_command_publishers = value.get("allowed_command_publishers", [])
    native_motion_controller_topology = value.get(
        "native_motion_controller_topology", False
    )
    if not isinstance(network_interface, str) or not network_interface:
        raise ManifestError("connected_g1 network_interface must be non-empty")
    if not isinstance(camera_host, str) or not camera_host:
        raise ManifestError("connected_g1 camera_host must be non-empty")
    if (
        not isinstance(discovery_timeout_s, (int, float))
        or isinstance(discovery_timeout_s, bool)
        or discovery_timeout_s <= 0
    ):
        raise ManifestError("connected_g1 discovery_timeout_s must be positive")
    if (
        not isinstance(command_topics, list)
        or not command_topics
        or any(not isinstance(topic, str) or not topic for topic in command_topics)
        or len(set(command_topics)) != len(command_topics)
    ):
        raise ManifestError("connected_g1 command_topics must be non-empty and unique")
    if not isinstance(allowed_command_publishers, list):
        raise ManifestError("connected_g1 allowed_command_publishers must be a list")
    if not isinstance(native_motion_controller_topology, bool):
        raise ManifestError(
            "connected_g1 native_motion_controller_topology must be a boolean"
        )
    allowed: list[tuple[str, str]] = []
    for publisher in allowed_command_publishers:
        if not isinstance(publisher, dict):
            raise ManifestError("allowed command publisher must be an object")
        topic = publisher.get("topic")
        participant_key = publisher.get("participant_key")
        if not isinstance(topic, str) or topic not in command_topics:
            raise ManifestError(
                "allowed command publisher topic must be a protected command topic"
            )
        if not isinstance(participant_key, str):
            raise ManifestError("allowed command publisher key must be a UUID")
        try:
            canonical_key = str(uuid.UUID(participant_key))
        except ValueError as error:
            raise ManifestError("allowed command publisher key must be a UUID") from error
        allowed.append((topic, canonical_key))
    if len(set(allowed)) != len(allowed):
        raise ManifestError("allowed command publishers must be unique")
    if len({participant_key for _, participant_key in allowed}) > 1:
        raise ManifestError(
            "allowed command publishers must identify one unique control entry"
        )
    if native_motion_controller_topology:
        if command_topics != ["rt/lowcmd"]:
            raise ManifestError(
                "native motion-controller topology only protects rt/lowcmd"
            )
        if allowed:
            raise ManifestError(
                "native motion-controller topology cannot combine with a static "
                "command publisher UUID"
            )
    return ConnectedG1(
        network_interface=network_interface,
        camera_host=camera_host,
        discovery_timeout_s=float(discovery_timeout_s),
        command_topics=tuple(command_topics),
        allowed_command_publishers=tuple(allowed),
        native_motion_controller_topology=native_motion_controller_topology,
    )


def _validate_manifest(manifest_path: Path) -> ValidatedManifest:
    manifest_path = manifest_path.resolve()
    if SANDBOX is None:
        raise ManifestError("bubblewrap is required for zero-write candidate replay")
    manifest, manifest_content = _read_object(manifest_path, "run manifest")
    if manifest.get("schema_version") != 2:
        raise ManifestError("run manifest schema_version must be 2")

    run_id = _identity(manifest, "run_id")
    invocation_id = _identity(manifest, "invocation_id")
    if _required_string(manifest, "execution_mode") != "zero-write":
        raise ManifestError("only the 'zero-write' execution mode is supported")
    connected_g1 = _connected_g1_configuration(manifest.get("connected_g1"))

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
    package = candidate_package.value
    if package.get("schema_version") != 1:
        raise ManifestError("candidate package schema_version must be 1")
    if package.get("candidate_id") != candidate_id:
        raise ManifestError(
            "candidate package identity does not match the run manifest"
        )
    safety_config = _verified_artifact(
        manifest_path, manifest.get("safety_config"), "safety configuration"
    )
    safety = safety_config.value
    if safety.get("schema_version") != 1 or safety.get("mode") != "zero-write":
        raise ManifestError("safety configuration must enforce zero-write")
    trusted_action_value = safety.get("control_contract")
    if not isinstance(trusted_action_value, dict):
        raise ManifestError("safety configuration must bind a control contract")
    trusted_action = _validated_action_definition(
        {"schema_version": 1, **trusted_action_value}, "trusted control contract"
    )
    candidate_artifacts = _candidate_artifacts(candidate_package, trusted_action)
    candidate_observation = _verified_artifact(
        manifest_path, candidate.get("observation"), "candidate observation"
    )
    observation = candidate_observation.value
    if observation.get("schema_version") != 1:
        raise ManifestError("candidate observation schema_version must be 1")
    captured_at_ns = observation.get("captured_at_ns")
    if not isinstance(captured_at_ns, int) or captured_at_ns < 0:
        raise ManifestError("candidate observation captured_at_ns must not be negative")

    budget_artifact = _verified_artifact(
        manifest_path, manifest.get("budget_artifact"), "budget artifact"
    )
    _validate_budget(budget_artifact.value)

    evaluator = manifest.get("evaluator")
    if not isinstance(evaluator, dict):
        raise ManifestError("evaluator must be an object")
    evaluator_config = _verified_artifact(
        manifest_path,
        {
            "path": evaluator.get("config_path"),
            "sha256": evaluator.get("config_sha256"),
        },
        "evaluator configuration",
    )
    _reject_candidate_visible_path(
        evaluator_config.path, "evaluator configuration"
    )
    evaluator_version = _required_string(manifest, "evaluator_version")
    if evaluator_config.value.get("schema_version") != 1:
        raise ManifestError("evaluator configuration schema_version must be 1")
    if evaluator_config.value.get("evaluator_id") != evaluator_version:
        raise ManifestError(
            "evaluator configuration identity does not match evaluator_version"
        )
    evaluator_prompt_path = evaluator_config.path.with_name("prompt.md")
    evaluator_prompt_content = _verified_plain_file(
        evaluator_prompt_path,
        evaluator.get("prompt_sha256"),
        "frozen evaluator prompt",
    )
    _reject_candidate_visible_path(evaluator_prompt_path, "frozen evaluator prompt")

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
        sha256=hashlib.sha256(manifest_content).hexdigest(),
        content=manifest_content,
        run_id=run_id,
        invocation_id=invocation_id,
        output_root=_artifact_path(
            manifest_path, manifest.get("output_root"), "output root"
        ),
        maximum_duration_s=float(maximum_duration_s),
        candidate_id=candidate_id,
        candidate_package=candidate_package,
        candidate_artifacts=candidate_artifacts,
        candidate_observation=candidate_observation,
        safety_config=safety_config,
        budget_artifact=budget_artifact,
        evaluator_version=evaluator_version,
        evaluator_config=evaluator_config,
        evaluator_prompt_content=evaluator_prompt_content,
        post_roll_s=float(post_roll_s),
        minimum_camera_frames=minimum_camera_frames,
        minimum_state_samples=minimum_state_samples,
        connected_g1=connected_g1,
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
    adapter_path: Path,
    adapter: str,
    arguments: list[str],
    output_path: Path,
    paths: RunPaths,
    deadline: float,
) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["SHAKA_INVOCATION_ADAPTER_AUDIT"] = str(paths.adapter_audit)
    completed = subprocess.run(
        [sys.executable, str(adapter_path), adapter, *arguments],
        env=environment,
        capture_output=True,
        text=True,
        timeout=_remaining(deadline),
        check=False,
    )
    result = _adapter_result(completed.stdout, adapter)
    if not isinstance(result, dict):
        raise TypeError(f"{adapter} adapter result must be a JSON object")
    _write_json(output_path, result)
    if completed.returncode != 0:
        reason = result.get("reason", completed.stderr.strip())
        if adapter == "candidate" and result.get("failure_class") == "deployment_defect":
            raise DeploymentDefect(result)
        raise RuntimeError(f"{adapter} adapter failed: {reason}")
    if result.get("command_publishers_created") != 0 or result.get("writes") != 0:
        raise RuntimeError(f"{adapter} adapter violated zero-write mode")
    return result


def _adapter_result(stdout: str, adapter: str) -> dict[str, Any]:
    """Read the final structured result despite native SDK diagnostic output.

    Unitree's Python binding can write DDS initialization diagnostics to stdout
    before the adapter emits its one JSON result. The trailing JSON object is
    still the adapter's only protocol result; preceding diagnostics never alter
    the lifecycle result.
    """
    for line in reversed(stdout.splitlines()):
        try:
            result = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(result, dict):
            return result
    raise RuntimeError(f"{adapter} adapter returned invalid JSON")


def _artifact(path: Path, relative_to: Path) -> dict[str, str]:
    return {"path": str(path.relative_to(relative_to)), "sha256": _sha256_file(path)}


def _existing_artifacts(paths: RunPaths) -> dict[str, Any]:
    candidates = {
        "run_manifest": paths.manifest_copy,
        "candidate_package": paths.candidate_copy,
        "candidate_runtime": paths.candidate_runtime,
        "saved_candidate_observation": paths.saved_candidate_observation,
        "candidate_input_observation": paths.candidate_observation,
        "live_observation": paths.live_observation,
        "safety_configuration": paths.safety_copy,
        "budget_artifact": paths.budget_copy,
        "evaluator_configuration": paths.evaluator_config,
        "frozen_evaluator_prompt": paths.evaluator_prompt,
        "readiness_result": paths.artifacts / "readiness-result.json",
        "candidate_result": paths.artifacts / "candidate-result.json",
        "control_release": paths.artifacts / "control-release.json",
        "controller_trace": paths.controller_trace,
        "controller_stdout": paths.controller_stdout,
        "raw_action_plan": paths.raw_action_plan,
        "action_plan": paths.action_plan,
        "static_admission": paths.static_admission,
        "recorder_lifecycle": paths.recorder_transcript,
        "evidence_finalization": paths.evidence_finalization,
        "evaluation_result": paths.artifacts / "evaluation-result.json",
        "model_result": paths.model_result,
        "reset_result": paths.artifacts / "reset-result.json",
        "adapter_audit": paths.adapter_audit,
        "lifecycle_journal": paths.lifecycle,
    }
    artifacts: dict[str, Any] = {
        name: _artifact(path, paths.partial)
        for name, path in candidates.items()
        if path.is_file()
    }
    if paths.candidate_bundle.is_dir():
        for directory in sorted(paths.candidate_bundle.iterdir()):
            files = list(directory.iterdir()) if directory.is_dir() else []
            if len(files) == 1 and files[0].is_file():
                artifacts[f"candidate_artifact_{directory.name}"] = _artifact(
                    files[0], paths.partial
                )
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
    prepared_manifest = paths.prepared_evidence / "evidence_manifest.json"
    if prepared_manifest.is_file():
        artifacts["prepared_evidence"] = {
            "path": str(paths.prepared_evidence.relative_to(paths.partial)),
            "manifest_sha256": _sha256_file(prepared_manifest),
        }
    return artifacts


def _evaluation_summary(paths: RunPaths) -> dict[str, Any] | None:
    adapter_path = paths.artifacts / "evaluation-result.json"
    if not adapter_path.is_file() or not paths.model_result.is_file():
        return None
    adapter_result = json.loads(adapter_path.read_text(encoding="utf-8"))
    task_result = adapter_result.get("task_result")
    if task_result not in TASK_RESULTS:
        return None
    return {
        "evaluator_id": adapter_result["evaluator_version"],
        "task_result": task_result,
        "backend": adapter_result["backend"],
        "model": adapter_result["model"],
        "human_audit_required": adapter_result["human_audit_required"],
        "configuration_sha256": adapter_result["configuration_sha256"],
        "prompt_sha256": adapter_result["prompt_sha256"],
        "evidence_manifest_sha256": adapter_result[
            "evidence_manifest_sha256"
        ],
        "model_result_sha256": _sha256_file(paths.model_result),
    }


def _terminal_report(
    manifest: ValidatedManifest,
    paths: RunPaths,
    completed_stage: str,
    terminal_reason: str,
    task_result: str | None,
    include_task_result: bool = True,
    environment: str = "offline",
    **values: Any,
) -> dict[str, Any]:
    report = {
        "schema_version": 1,
        "run_id": manifest.run_id,
        "invocation_id": manifest.invocation_id,
        "execution_mode": "zero-write",
        "environment": environment,
        "manifest_sha256": manifest.sha256,
        "completed_stage": completed_stage,
        "terminal_reason": terminal_reason,
        "next_disposition": "stop_zero_write_validation",
        "command_publishers_created": values.pop("command_publishers_created", 0),
        "writes": values.pop("writes", 0),
        "physical_rollout_attempts_consumed": values.pop(
            "physical_rollout_attempts_consumed", 0
        ),
        "robot_runtime_consumed_s": values.pop("robot_runtime_consumed_s", 0),
        "artifacts": _existing_artifacts(paths),
        **values,
    }
    if include_task_result:
        report["task_result"] = task_result
    evaluation = _evaluation_summary(paths)
    if evaluation is not None:
        report["evaluation"] = evaluation
    return report


def _publish_failure(
    manifest: ValidatedManifest,
    paths: RunPaths,
    progress: RunProgress,
    error: BaseException,
    environment: str,
) -> NoReturn:
    reason = str(error) or type(error).__name__
    deployment_result = error.result if isinstance(error, DeploymentDefect) else None
    publishers = (
        deployment_result.get("command_publishers_created", 0)
        if deployment_result is not None
        else 0
    )
    writes = deployment_result.get("writes", 0) if deployment_result is not None else 0
    _append_stage(paths.lifecycle, "terminal_report_prepared", outcome="failed")
    report = _terminal_report(
        manifest,
        paths,
        completed_stage=progress.completed_stage,
        terminal_reason=reason,
        task_result=(
            None
            if deployment_result is not None or isinstance(error, EvaluationFailed)
            else "aborted"
        ),
        include_task_result=deployment_result is None,
        environment=environment,
        failure_class="deployment_defect" if deployment_result is not None else "runtime_failure",
        physical_rollout_attempts_consumed=0,
        robot_runtime_consumed_s=0,
        command_publishers_created=publishers,
        writes=writes,
    )
    _write_json(paths.partial / "terminal-report.json", report)
    os.replace(paths.partial, paths.final)
    raise InvocationFailed(
        {
            "result": "zero_write_candidate_rejected"
            if deployment_result is not None
            else "zero_write_invocation_failed",
            "reason": reason,
            "run_id": manifest.run_id,
            "invocation_id": manifest.invocation_id,
            "output_directory": str(paths.final),
            "failure_class": report["failure_class"],
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
            "command_publishers_created": publishers,
            "writes": writes,
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
        partial.mkdir()
    except FileExistsError as error:
        raise ManifestError(f"run output already exists: {manifest.run_id}") from error

    artifacts = partial / "artifacts"
    paths = RunPaths(
        final=final,
        partial=partial,
        claim=claim,
        artifacts=artifacts,
        lifecycle=partial / "lifecycle.jsonl",
        evidence_root=partial / "evidence",
        manifest_copy=partial / "run-manifest.json",
        candidate_copy=artifacts / "candidate-package.json",
        candidate_bundle=artifacts / "candidate-bundle",
        candidate_runtime=artifacts / "candidate-runtime.json",
        candidate_observation=artifacts / "candidate-observation.json",
        saved_candidate_observation=artifacts / "saved-candidate-observation.json",
        live_observation=artifacts / "live-observation.json",
        safety_copy=artifacts / "safety-configuration.json",
        budget_copy=artifacts / "budget-artifact.json",
        evaluator_config=artifacts / "evaluator" / "evaluator.json",
        evaluator_prompt=artifacts / "evaluator" / "prompt.md",
        controller_trace=artifacts / "controller-trace.json",
        controller_stdout=artifacts / "controller-stdout.jsonl",
        raw_action_plan=artifacts / "action-plan-raw.json",
        action_plan=artifacts / "action-plan.json",
        static_admission=artifacts / "static-admission.json",
        evidence_finalization=artifacts / "evidence-finalization.json",
        prepared_evidence=artifacts / "prepared-evidence",
        model_result=artifacts / "model-assessment.json",
        adapter_audit=artifacts / "adapter-audit.jsonl",
        recorder_transcript=artifacts / "recorder-stdout.jsonl",
    )
    claim_created = False
    try:
        artifacts.mkdir()
        paths.manifest_copy.write_bytes(manifest.content)
        paths.candidate_copy.write_bytes(manifest.candidate_package.content)
        paths.candidate_bundle.mkdir()
        runtime_artifacts: dict[str, dict[str, str]] = {}
        for name, artifact in manifest.candidate_artifacts.items():
            artifact_directory = paths.candidate_bundle / name
            artifact_directory.mkdir()
            destination = artifact_directory / artifact.path.name
            destination.write_bytes(artifact.content)
            runtime_artifacts[name] = {
                "path": str(destination.relative_to(paths.artifacts)),
                "sha256": artifact.sha256,
            }
        _write_json(
            paths.candidate_runtime,
            {
                "schema_version": 1,
                "candidate_id": manifest.candidate_id,
                "candidate_package_sha256": manifest.candidate_package.sha256,
                "source_version": manifest.candidate_package.value["source_version"],
                "artifacts": runtime_artifacts,
                "runtime": manifest.candidate_package.value["runtime"],
            },
        )
        paths.candidate_observation.write_bytes(manifest.candidate_observation.content)
        paths.saved_candidate_observation.write_bytes(manifest.candidate_observation.content)
        paths.safety_copy.write_bytes(manifest.safety_config.content)
        paths.budget_copy.write_bytes(manifest.budget_artifact.content)
        paths.evaluator_config.parent.mkdir()
        paths.evaluator_config.write_bytes(manifest.evaluator_config.content)
        paths.evaluator_prompt.write_bytes(manifest.evaluator_prompt_content)
        _append_stage(paths.lifecycle, "manifest_validated")
        try:
            claim.mkdir()
        except FileExistsError as error:
            raise ManifestError(
                f"invocation identity was already used: {manifest.invocation_id}"
            ) from error
        claim_created = True
        (claim / "run-id.txt").write_text(manifest.run_id + "\n", encoding="utf-8")
        _append_stage(paths.lifecycle, "invocation_authority_acquired")
        return paths
    except BaseException:
        if claim_created:
            run_id_path = claim / "run-id.txt"
            if run_id_path.exists():
                run_id_path.unlink()
            claim.rmdir()
        shutil.rmtree(partial)
        raise


def _start_recorder(
    manifest: ValidatedManifest, paths: RunPaths, connected_g1: bool
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
    if connected_g1:
        assert manifest.connected_g1 is not None
        command.extend(
            [
                "--network-interface",
                manifest.connected_g1.network_interface,
                "--camera-host",
                manifest.connected_g1.camera_host,
                "--discovery-timeout-s",
                str(manifest.connected_g1.discovery_timeout_s),
                "--live-observation-output",
                str(paths.live_observation),
            ]
        )
    return subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )


def _interrupt_invocation(signum: int, frame: Any) -> NoReturn:
    del frame
    signal_name = signal.Signals(signum).name
    raise InvocationInterrupted(f"invocation interrupted by {signal_name}")


def _wait_for_live_observation(path: Path, deadline: float) -> None:
    while not path.is_file():
        _remaining(deadline)
        time.sleep(0.01)
    value, _ = _read_object(path, "live observation")
    if (
        value.get("schema_version") != 1
        or value.get("source") != "connected-g1-recorder-v1"
        or not isinstance(value.get("captured_at_ns"), int)
    ):
        raise RuntimeError("recorder live observation is invalid")


def run(manifest_path: Path, *, connected_g1: bool = False) -> dict[str, Any]:
    manifest = _validate_manifest(manifest_path)
    if connected_g1 and manifest.connected_g1 is None:
        raise ManifestError("connected-g1 requires a connected_g1 manifest configuration")
    adapter_path = CONNECTED_G1_ADAPTER if connected_g1 else ADAPTER
    environment = "connected-g1" if connected_g1 else "offline"
    paths: RunPaths | None = None
    progress: RunProgress | None = None
    recorder: subprocess.Popen[str] | None = None
    previous_signal_handlers = {
        signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)
    }
    for signum in previous_signal_handlers:
        signal.signal(signum, _interrupt_invocation)
    blocked_signals = set(previous_signal_handlers)
    previous_signal_mask = signal.pthread_sigmask(signal.SIG_BLOCK, blocked_signals)
    try:
        try:
            paths = _accept_run(manifest)
            progress = RunProgress()
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_signal_mask)
        deadline = time.monotonic() + manifest.maximum_duration_s
        readiness_arguments = [
            "--claim-directory",
            str(paths.claim),
            "--execution-mode",
            "zero-write",
        ]
        if connected_g1:
            assert manifest.connected_g1 is not None
            readiness_arguments.extend(
                [
                    "--network-interface",
                    manifest.connected_g1.network_interface,
                    "--camera-host",
                    manifest.connected_g1.camera_host,
                    "--discovery-timeout-s",
                    str(manifest.connected_g1.discovery_timeout_s),
                ]
            )
            for topic in manifest.connected_g1.command_topics:
                readiness_arguments.extend(["--command-topic", topic])
            for topic, participant_key in manifest.connected_g1.allowed_command_publishers:
                readiness_arguments.extend(
                    ["--allowed-command-publisher", f"{topic}:{participant_key}"]
                )
            if manifest.connected_g1.native_motion_controller_topology:
                readiness_arguments.append("--native-motion-controller-topology")
        readiness = _run_adapter(
            adapter_path,
            "readiness",
            readiness_arguments,
            paths.artifacts / "readiness-result.json",
            paths,
            deadline,
        )
        if readiness.get("ready") is not True:
            raise RuntimeError("readiness adapter did not establish readiness")
        _complete_stage(paths, progress, "readiness_confirmed")

        if connected_g1:
            runtime_preflight = _run_adapter(
                adapter_path,
                "runtime-preflight",
                [
                    "--runtime-package",
                    str(paths.candidate_runtime),
                    "--timeout-s",
                    str(max(0.01, _remaining(deadline) - 0.25)),
                ],
                paths.artifacts / "candidate-runtime-preflight.json",
                paths,
                deadline,
            )
            if runtime_preflight.get("ready") is not True:
                raise RuntimeError("candidate runtime preflight did not establish readiness")
            _complete_stage(paths, progress, "candidate_runtime_ready")

        recorder = _start_recorder(manifest, paths, connected_g1)
        candidate_failure: Exception | None = None
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
            if connected_g1:
                _wait_for_live_observation(paths.live_observation, deadline)
                paths.candidate_observation.write_bytes(paths.live_observation.read_bytes())
                _complete_stage(paths, progress, "live_observation_captured")

            try:
                candidate_result = _run_adapter(
                    adapter_path,
                    "candidate",
                    [
                        "--runtime-package",
                        str(paths.candidate_runtime),
                        "--observation",
                        str(paths.candidate_observation),
                        "--controller-trace",
                        str(paths.controller_trace),
                        "--raw-action-plan-output",
                        str(paths.raw_action_plan),
                        "--action-plan-output",
                        str(paths.action_plan),
                        "--static-admission-output",
                        str(paths.static_admission),
                        "--control-contract",
                        str(paths.safety_copy),
                        "--timeout-s",
                        str(max(0.01, _remaining(deadline) - 0.25)),
                    ],
                    paths.artifacts / "candidate-result.json",
                    paths,
                    deadline,
                )
            except Exception as error:  # noqa: BLE001
                candidate_failure = error
            else:
                if candidate_result.get("candidate_id") != manifest.candidate_id:
                    candidate_failure = RuntimeError(
                        "candidate adapter returned the wrong identity"
                    )
                elif candidate_result.get("deployment_status") != "admitted":
                    candidate_failure = RuntimeError(
                        "candidate deployment did not complete"
                    )
                else:
                    _complete_stage(paths, progress, "candidate_completed")

            try:
                release = _run_adapter(
                    adapter_path,
                    "release",
                    (
                        []
                        if candidate_failure is not None
                        else [
                            "--controller-trace",
                            str(paths.controller_trace),
                            "--controller-stdout",
                            str(paths.controller_stdout),
                        ]
                    ),
                    paths.artifacts / "control-release.json",
                    paths,
                    deadline,
                )
                if release.get("released") is not True:
                    raise RuntimeError(
                        "control release adapter did not release authority"
                    )
                _complete_stage(paths, progress, "control_released")
            finally:
                if recorder.poll() is None:
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
        if candidate_failure is not None:
            raise candidate_failure

        evidence_directory = paths.evidence_root / manifest.invocation_id
        finalization = finalize_invocation_evidence(
            evidence_directory,
            manifest.invocation_id,
            paths.controller_trace,
            paths.controller_stdout,
        )
        _write_json(paths.evidence_finalization, finalization)
        _complete_stage(paths, progress, "evidence_completed")

        try:
            evaluation = _run_adapter(
                adapter_path,
                "evaluation",
                [
                    "--evidence-directory",
                    str(evidence_directory),
                    "--invocation-id",
                    manifest.invocation_id,
                    "--prepared-evidence-directory",
                    str(paths.prepared_evidence),
                    "--evaluator-config",
                    str(paths.evaluator_config),
                    "--model-result-output",
                    str(paths.model_result),
                ],
                paths.artifacts / "evaluation-result.json",
                paths,
                deadline,
            )
            task_result = evaluation.get("task_result")
            if task_result not in TASK_RESULTS:
                raise RuntimeError("evaluation adapter returned an invalid task result")
        except Exception as error:
            raise EvaluationFailed(str(error)) from error
        _complete_stage(paths, progress, "evaluation_completed")

        reset = _run_adapter(
            adapter_path,
            "reset",
            ["--execution-mode", "zero-write", "--task-result", str(task_result)],
            paths.artifacts / "reset-result.json",
            paths,
            deadline,
        )
        if reset.get("requested") is not False:
            raise RuntimeError("zero-write reset adapter requested a reset")
        _complete_stage(paths, progress, "reset_disposition_recorded")

        _append_stage(paths.lifecycle, "terminal_report_prepared")
        report = _terminal_report(
            manifest,
            paths,
            completed_stage="terminal_report",
            terminal_reason="zero_write_invocation_completed",
            task_result=str(task_result),
            environment=environment,
        )
        _write_json(paths.partial / "terminal-report.json", report)
        result = {
            "result": "zero_write_invocation_completed",
            "run_id": manifest.run_id,
            "invocation_id": manifest.invocation_id,
            "output_directory": str(paths.final),
            "command_publishers_created": 0,
            "writes": 0,
        }
        for signum in previous_signal_handlers:
            signal.signal(signum, signal.SIG_IGN)
        os.replace(paths.partial, paths.final)
        return result
    except BaseException as error:
        if paths is None or progress is None:
            raise
        if recorder is not None and recorder.poll() is None:
            recorder.kill()
            recorder.wait()
        _publish_failure(manifest, paths, progress, error, environment)
    finally:
        if recorder is not None and recorder.poll() is None:
            recorder.kill()
            recorder.wait()
        for signum, handler in previous_signal_handlers.items():
            signal.signal(signum, handler)


def main() -> int:
    args = parse_args()
    try:
        result = run(args.manifest, connected_g1=args.connected_g1)
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

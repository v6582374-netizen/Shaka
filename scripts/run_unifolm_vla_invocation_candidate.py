#!/usr/bin/env python3
"""Execute the fixed UniFoLM-VLA preflight as a runner-owned zero-write candidate.

This is deliberately not a general subprocess runtime.  It only invokes this
repository's fixed inference-only preflight with its frozen checkpoint defaults
and returns an immutable action-plan artifact to the single-invocation runner.
It has no DDS, hand, or arm command imports.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from project_g1_vla_brainco_action_plan import project
from validate_g1_vla_action_plan import validate


PROTOCOL = "shaka.unifolm-vla-invocation-candidate.v1"
RUNTIME_KIND = "unifolm-vla-zero-write-v1"
CONFIG_KIND = "unifolm_vla_zero_write_candidate_configuration"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
DEFAULT_PYTHON = Path("/home/loongge/miniconda3/envs/unifolm-vla/bin/python")
PREFLIGHT = Path(__file__).with_name("run_unifolm_vla_zero_write_preflight.py")
STANDARD_START = Path(__file__).parents[1] / "configs" / "g1-evaluator-v001" / "standard_start.json"
URDF = Path("/home/loongge/Robot/TWIST2-HZCU/assets/g1/g1_29dof_rev_1_0.urdf")
TRAINING_AUDIT = Path(
    "/mnt/data-hdd/Shaka/unifolm-vla-zero-write-preflight-v001/brainco26-training-time-audit-v001.json"
)
STATIC_INPUTS = {
    STANDARD_START: "590e3d69dbf94232ae46c29f7948bb85dab0d1840e7b5af0ed9aa45a081bf800",
    URDF: "824ce02c2c1e489aa8dece47a10fe02d1872289c0e6d01ba51abd291e66b7b2c",
    TRAINING_AUDIT: "c54e512ba3a6c1fc10f72d6ad8386f1d70a5d772797d84bdd25fa4bdfa1c8598",
}


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be an object")
    return value


def _sha256(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _runtime_configuration(runtime_package: Path) -> tuple[str, dict[str, Any]]:
    package = _read_object(runtime_package, "candidate runtime package")
    candidate_id = package.get("candidate_id")
    runtime = package.get("runtime")
    artifacts = package.get("artifacts")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise ValueError("candidate runtime package lacks a candidate identity")
    if not isinstance(runtime, dict) or runtime.get("kind") != RUNTIME_KIND:
        raise ValueError("candidate runtime is not the fixed UniFoLM-VLA zero-write kind")
    if runtime.get("configuration_artifact") != "configuration":
        raise ValueError("UniFoLM-VLA runtime must use its bound configuration artifact")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get("configuration"), dict):
        raise ValueError("candidate runtime lacks the bound UniFoLM-VLA configuration")
    relative_path = artifacts["configuration"].get("path")
    if not isinstance(relative_path, str) or not relative_path:
        raise ValueError("candidate runtime configuration path is invalid")
    configuration_path = (runtime_package.parent / relative_path).resolve()
    if not configuration_path.is_relative_to(runtime_package.parent.resolve()):
        raise ValueError("candidate runtime configuration escapes its artifact bundle")
    configuration = _read_object(configuration_path, "UniFoLM-VLA configuration")
    if configuration.get("schema_version") != 1 or configuration.get("kind") != CONFIG_KIND:
        raise ValueError("UniFoLM-VLA configuration has an unsupported identity")
    instruction = configuration.get("instruction")
    device = configuration.get("device", "cuda:0")
    seed = configuration.get("seed", 42)
    if not isinstance(instruction, str) or not instruction:
        raise ValueError("UniFoLM-VLA instruction must be non-empty")
    if not isinstance(device, str) or not device:
        raise ValueError("UniFoLM-VLA device must be non-empty")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ValueError("UniFoLM-VLA seed must be a non-negative integer")
    return candidate_id, {"instruction": instruction, "device": device, "seed": seed}


def _run_preflight(command: list[str], timeout_s: float) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout_s, check=False
        )
    except subprocess.TimeoutExpired as error:
        raise TimeoutError("UniFoLM-VLA zero-write preflight exceeded its deadline") from error
    result: dict[str, Any] | None = None
    for line in reversed(completed.stdout.splitlines()):
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict):
            result = candidate
            break
    if result is None:
        raise RuntimeError("UniFoLM-VLA preflight returned invalid JSON")
    if completed.returncode != 0:
        raise RuntimeError(f"UniFoLM-VLA preflight rejected: {result.get('reason', completed.stderr.strip())}")
    return result


def _validate_plan(path: Path) -> dict[str, Any]:
    plan = _read_object(path, "UniFoLM-VLA action plan")
    checkpoint = plan.get("checkpoint")
    contract = plan.get("contract")
    trajectory = plan.get("trajectory")
    if (
        plan.get("schema_version") != 1
        or plan.get("kind") != "unifolm_vla_action_plan_evidence"
        or plan.get("execution_mode") != "zero-write"
        or plan.get("command_publishers_created") != 0
        or plan.get("writes") != 0
        or not isinstance(checkpoint, dict)
        or not isinstance(checkpoint.get("sha256"), str)
        or len(checkpoint["sha256"]) != 64
        or not isinstance(contract, dict)
        or contract.get("action_dimension") != ACTION_DIMENSION
        or contract.get("action_horizon") != ACTION_HORIZON
        or not isinstance(trajectory, list)
        or len(trajectory) != ACTION_HORIZON
    ):
        raise ValueError("UniFoLM-VLA preflight emitted an incompatible action plan")
    for step in trajectory:
        if (
            not isinstance(step, list)
            or len(step) != ACTION_DIMENSION
            or any(
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(float(value))
                for value in step
            )
        ):
            raise ValueError("UniFoLM-VLA action plan contains an invalid target")
    return plan


def run_candidate(
    runtime_package: Path,
    observation: Path,
    raw_action_plan_output: Path,
    action_plan_output: Path,
    static_admission_output: Path,
    controller_trace: Path,
    timeout_s: float,
    *,
    python: Path = DEFAULT_PYTHON,
) -> dict[str, Any]:
    """Run one fixed inference-only VLA candidate and record its plan evidence."""
    candidate_id, configuration = _runtime_configuration(runtime_package.resolve())
    if not python.is_file() or not PREFLIGHT.is_file():
        raise RuntimeError("the fixed UniFoLM-VLA preflight runtime is unavailable")
    for output in (raw_action_plan_output, action_plan_output, static_admission_output):
        if output.exists():
            raise ValueError("UniFoLM-VLA candidate output must not already exist")
    command = [
        str(python),
        str(PREFLIGHT),
        "--observation",
        str(observation.resolve()),
        "--action-plan-output",
        str(raw_action_plan_output.resolve()),
        "--instruction",
        configuration["instruction"],
        "--device",
        configuration["device"],
        "--seed",
        str(configuration["seed"]),
    ]
    result = _run_preflight(command, timeout_s)
    if (
        result.get("result") != "unifolm_vla_zero_write_preflight_ok"
        or result.get("command_publishers_created") != 0
        or result.get("writes") != 0
    ):
        raise RuntimeError("UniFoLM-VLA preflight did not preserve zero-write execution")
    raw_plan_path = raw_action_plan_output.resolve()
    raw_plan = _validate_plan(raw_plan_path)
    checkpoint_digest = raw_plan["checkpoint"]["sha256"]
    plan_reference = result.get("action_plan")
    if not isinstance(plan_reference, dict) or plan_reference.get("path") != str(raw_plan_path):
        raise RuntimeError("UniFoLM-VLA preflight did not bind its action-plan output")
    if plan_reference.get("sha256") != _sha256(raw_plan_path):
        raise RuntimeError("UniFoLM-VLA preflight action-plan digest is invalid")
    for path, expected in STATIC_INPUTS.items():
        if not path.is_file() or _sha256(path) != expected:
            raise RuntimeError(f"frozen VLA static-admission input is unavailable: {path}")
    projected = project(raw_plan, str(plan_reference["sha256"]))
    _write_json(action_plan_output.resolve(), projected)
    projected_plan = _validate_plan(action_plan_output.resolve())
    static_admission = validate(
        projected_plan,
        _read_object(observation.resolve(), "live observation"),
        _read_object(STANDARD_START, "standard-start configuration"),
        URDF,
        _read_object(TRAINING_AUDIT, "training-time audit"),
    )
    _write_json(static_admission_output.resolve(), static_admission)
    if static_admission.get("result") != "g1_vla_action_plan_static_bounds_ok":
        raise RuntimeError("UniFoLM-VLA projected action plan failed static admission")
    projected_reference = {
        "path": str(action_plan_output.resolve()),
        "sha256": _sha256(action_plan_output.resolve()),
    }
    frame_time_ns = time.time_ns()
    controller_trace.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "protocol": "shaka.zero-write-vla-controller-trace.v1",
                "loop_clock_id": "local_utc_ns",
                "outcome": "running",
                "checkpoint_digest": checkpoint_digest,
                "frames": [
                    {
                        "phase": "act_task",
                        "candidate_age_ms": 0.0,
                        "candidate_source_time_ns": projected_plan["observation"]["captured_at_ns"],
                        "loop_now_ns": frame_time_ns,
                        "raw_action_plan_sha256": plan_reference.get("sha256"),
                        "action_plan_sha256": projected_reference["sha256"],
                        "static_admission_sha256": _sha256(static_admission_output.resolve()),
                    }
                ],
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return {
        "protocol": PROTOCOL,
        "candidate_id": candidate_id,
        "deployment_status": "admitted",
        "action_definition_id": "g1-brainco26-position-v001",
        "trajectory_steps": ACTION_HORIZON,
        "trajectory_dimension": ACTION_DIMENSION,
        "raw_action_plan": plan_reference,
        "action_plan": projected_reference,
        "static_admission": {
            "path": str(static_admission_output.resolve()),
            "sha256": _sha256(static_admission_output.resolve()),
        },
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
        "robot_runtime_consumed_s": 0,
    }

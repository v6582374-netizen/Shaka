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
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.unifolm-vla-invocation-candidate.v1"
RUNTIME_KIND = "unifolm-vla-zero-write-v1"
CONFIG_KIND = "unifolm_vla_zero_write_candidate_configuration"
ACTION_DIMENSION = 26
ACTION_HORIZON = 25
DEFAULT_PYTHON = Path("/home/loongge/miniconda3/envs/unifolm-vla/bin/python")
PREFLIGHT = Path(__file__).with_name("run_unifolm_vla_zero_write_preflight.py")


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be an object")
    return value


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
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("UniFoLM-VLA preflight returned invalid JSON") from error
    if completed.returncode != 0:
        raise RuntimeError(f"UniFoLM-VLA preflight rejected: {result.get('reason', completed.stderr.strip())}")
    if not isinstance(result, dict):
        raise TypeError("UniFoLM-VLA preflight result must be an object")
    return result


def _validate_plan(path: Path) -> dict[str, Any]:
    plan = _read_object(path, "UniFoLM-VLA action plan")
    contract = plan.get("contract")
    trajectory = plan.get("trajectory")
    if (
        plan.get("schema_version") != 1
        or plan.get("kind") != "unifolm_vla_action_plan_evidence"
        or plan.get("execution_mode") != "zero-write"
        or plan.get("command_publishers_created") != 0
        or plan.get("writes") != 0
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
    action_plan_output: Path,
    controller_trace: Path,
    timeout_s: float,
    *,
    python: Path = DEFAULT_PYTHON,
) -> dict[str, Any]:
    """Run one fixed inference-only VLA candidate and record its plan evidence."""
    candidate_id, configuration = _runtime_configuration(runtime_package.resolve())
    if not python.is_file() or not PREFLIGHT.is_file():
        raise RuntimeError("the fixed UniFoLM-VLA preflight runtime is unavailable")
    if action_plan_output.exists():
        raise ValueError("UniFoLM-VLA action-plan output must not already exist")
    command = [
        str(python),
        str(PREFLIGHT),
        "--observation",
        str(observation.resolve()),
        "--action-plan-output",
        str(action_plan_output.resolve()),
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
    plan = _validate_plan(action_plan_output.resolve())
    plan_reference = result.get("action_plan")
    if not isinstance(plan_reference, dict) or plan_reference.get("path") != str(action_plan_output.resolve()):
        raise RuntimeError("UniFoLM-VLA preflight did not bind its action-plan output")
    frame_time_ns = time.time_ns()
    controller_trace.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "protocol": "shaka.zero-write-vla-controller-trace.v1",
                "loop_clock_id": "local_utc_ns",
                "outcome": "running",
                "frames": [
                    {
                        "phase": "act_task",
                        "candidate_age_ms": 0.0,
                        "candidate_source_time_ns": plan["observation"]["captured_at_ns"],
                        "loop_now_ns": frame_time_ns,
                        "action_plan_sha256": plan_reference.get("sha256"),
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
        "action_plan": plan_reference,
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
        "robot_runtime_consumed_s": 0,
    }

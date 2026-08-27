#!/usr/bin/env python3
"""Validate a digest-bound G1 VLA canary package without arming a robot.

This is deliberately a review tool, not an executor.  It has no control
transport and every successful result remains unarmed.  The package makes the
evidence and the still-external safety attestations reviewable before a future,
separately authorized one-attempt command is even considered.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


PROTOCOL = "shaka.g1-vla-canary-authorization.v1"
PACKAGE_KIND = "g1_vla_canary_authorization_package"
DEPLOYMENT_ATTESTATION_KIND = "g1_vla_guardian_deployment_attestation"
SAFETY_TRUTH_KIND = "g1_vla_safety_truth_attestation"
HUMANOID_PROCESS = "humanoid"
ARM_SDK_TOPIC = "rt/arm_sdk"
LOWCMD_TOPIC = "rt/lowcmd"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _object(value: Any, description: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{description} must be an object")
    return value


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    return _object(value, description)


def _sha256_text(value: Any, description: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise ValueError(f"{description} must be 64 lowercase hexadecimal characters")
    return value


def _positive_integer(value: Any, description: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{description} must be a positive integer")
    return value


def _artifact(
    value: Any, directory: Path, description: str
) -> tuple[dict[str, Any], str, Path]:
    reference = _object(value, description)
    raw_path = reference.get("path")
    if not isinstance(raw_path, str) or not raw_path:
        raise ValueError(f"{description}.path must be a non-empty relative path")
    path = (directory / raw_path).resolve()
    try:
        path.relative_to(directory.resolve())
    except ValueError as error:
        raise ValueError(f"{description}.path must stay inside the package directory") from error
    expected = _sha256_text(reference.get("sha256"), f"{description}.sha256")
    if not path.is_file():
        raise ValueError(f"{description}.path does not name a readable file")
    actual = _sha256(path)
    if actual != expected:
        raise ValueError(f"{description} digest does not match its frozen value")
    return _read_object(path, description), actual, path


def _zero_write(value: dict[str, Any], description: str) -> None:
    if value.get("command_publishers_created") != 0 or value.get("writes") != 0:
        raise ValueError(f"{description} does not preserve zero-write provenance")
    if value.get("physical_execution_authorized") is True:
        raise ValueError(f"{description} cannot have physical execution authorization")


def _guardian_module() -> Any:
    script = Path(__file__).with_name("g1_vla_robot_side_guardian.py")
    specification = importlib.util.spec_from_file_location("g1_vla_robot_side_guardian", script)
    if specification is None or specification.loader is None:
        raise RuntimeError("cannot load the local guardian contract validator")
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    specification.loader.exec_module(module)
    return module


def _validate_disposition(value: Any) -> None:
    disposition = _object(value, "disposition")
    expected = {
        "on_pre_execution_rejection": "halt",
        "on_protection_intervention": "halt",
        "on_recorder_or_evaluator_failure": "halt",
        "on_failure_or_indeterminate": "preserve-evidence-and-halt",
        "on_success": "preserve-evidence-and-halt-for-human-review",
    }
    if disposition != expected:
        raise ValueError("disposition must halt on every outcome and require human success review")


def validate(package: dict[str, Any], directory: Path) -> dict[str, Any]:
    """Return a review result or fail closed; never return execution permission."""
    if (
        package.get("schema_version") != 1
        or package.get("kind") != PACKAGE_KIND
        or package.get("protocol") != PROTOCOL
    ):
        raise ValueError("authorization package has an unsupported identity")
    invocation_id = package.get("invocation_id")
    if not isinstance(invocation_id, str) or not invocation_id:
        raise ValueError("invocation_id must be a non-empty string")
    if package.get("execution_mode") != "physical-canary-review-only":
        raise ValueError("authorization package must remain review-only")
    if package.get("physical_execution_authorized") is not False:
        raise ValueError("authorization package must remain review-only and unarmed")

    candidate = _object(package.get("candidate"), "candidate")
    action_plan_reference = _object(candidate.get("action_plan"), "candidate.action_plan")
    action_plan, action_plan_sha256, _ = _artifact(
        action_plan_reference, directory, "candidate.action_plan"
    )
    _zero_write(action_plan, "candidate.action_plan")
    static_admission_reference = _object(
        candidate.get("static_admission"), "candidate.static_admission"
    )
    static_admission, static_admission_sha256, _ = _artifact(
        static_admission_reference, directory, "candidate.static_admission"
    )
    _zero_write(static_admission, "candidate.static_admission")
    if static_admission.get("result") != "g1_vla_action_plan_static_bounds_ok":
        raise ValueError("candidate.static_admission does not pass static bounds")
    if (
        _sha256_text(
            static_admission_reference.get("action_plan_sha256"),
            "candidate.static_admission.action_plan_sha256",
        )
        != action_plan_sha256
    ):
        raise ValueError("candidate.static_admission is not bound to candidate.action_plan")

    zero_write_reference = _object(package.get("zero_write_proof"), "zero_write_proof")
    zero_write, zero_write_sha256, _ = _artifact(
        zero_write_reference, directory, "zero_write_proof"
    )
    _zero_write(zero_write, "zero_write_proof")
    if (
        zero_write.get("result") != "zero_write_invocation_completed"
        or zero_write.get("physical_rollout_attempts_consumed") != 0
        or zero_write.get("robot_runtime_consumed_s") != 0
    ):
        raise ValueError("zero_write_proof is not a completed zero-rollout invocation")
    if (
        _sha256_text(
            zero_write_reference.get("action_plan_sha256"), "zero_write_proof.action_plan_sha256"
        )
        != action_plan_sha256
    ):
        raise ValueError("zero_write_proof is not bound to candidate.action_plan")

    boundary = _object(package.get("control_boundary"), "control_boundary")
    if (
        boundary.get("process_name") != HUMANOID_PROCESS
        or boundary.get("arm_sdk_topic") != ARM_SDK_TOPIC
        or boundary.get("lowcmd_topic") != LOWCMD_TOPIC
    ):
        raise ValueError("control_boundary is not bound to the humanoid arm-SDK entry")
    participant = boundary.get("native_motion_controller_participant_uuid")
    if not isinstance(participant, str) or not participant:
        raise ValueError("control_boundary.native_motion_controller_participant_uuid is required")
    protected_topics = boundary.get("protected_command_topics")
    if (
        not isinstance(protected_topics, list)
        or not all(isinstance(topic, str) and topic for topic in protected_topics)
        or len(set(protected_topics)) != len(protected_topics)
        or ARM_SDK_TOPIC not in protected_topics
        or LOWCMD_TOPIC not in protected_topics
    ):
        raise ValueError("control_boundary must bind every protected command topic, including lowcmd and arm_sdk")

    guardian_contract, guardian_contract_sha256, _ = _artifact(
        boundary.get("guardian_contract"), directory, "control_boundary.guardian_contract"
    )
    guardian = _guardian_module()
    contract = guardian.ProtectionContract.from_object(guardian_contract)
    if contract.command_lease_ns < contract.command_period_ns:
        raise ValueError("guardian contract cannot cover one command period")

    deployment, _, _ = _artifact(
        boundary.get("guardian_deployment_attestation"),
        directory,
        "control_boundary.guardian_deployment_attestation",
    )
    deployment_entry = _object(deployment.get("control_entry"), "guardian deployment control_entry")
    if (
        deployment.get("schema_version") != 1
        or deployment.get("kind") != DEPLOYMENT_ATTESTATION_KIND
        or deployment.get("guardian_protocol") != guardian.PROTOCOL
        or deployment.get("guardian_contract_sha256") != guardian_contract_sha256
        or deployment_entry.get("process_name") != HUMANOID_PROCESS
        or deployment_entry.get("arm_sdk_topic") != ARM_SDK_TOPIC
        or deployment_entry.get("enforced_at_control_entry") is not True
    ):
        raise ValueError("guardian deployment attestation is not bound to the robot-side control entry")
    deployment_details = _object(deployment.get("deployment"), "guardian deployment")
    if deployment_details.get("location") != "robot-side-humanoid" or deployment_details.get("attested") is not True:
        raise ValueError("guardian deployment attestation does not claim robot-side enforcement")

    safety_truth, safety_truth_sha256, _ = _artifact(
        package.get("safety_truth"), directory, "safety_truth"
    )
    if (
        safety_truth.get("schema_version") != 1
        or safety_truth.get("kind") != SAFETY_TRUTH_KIND
        or safety_truth.get("producer_location") != "robot-side-humanoid"
        or safety_truth.get("workspace_clear") is not True
        or safety_truth.get("contact_clear") is not True
    ):
        raise ValueError("safety_truth must be an affirmative robot-side workspace/contact attestation")

    attempt = _object(package.get("attempt"), "attempt")
    if attempt.get("physical_attempts") != 1 or attempt.get("retry_on_failure") is not False:
        raise ValueError("a canary must contain exactly one attempt and no retry")
    _positive_integer(attempt.get("maximum_robot_runtime_ms"), "attempt.maximum_robot_runtime_ms")
    _sha256_text(attempt.get("limits_configuration_sha256"), "attempt.limits_configuration_sha256")
    _validate_disposition(package.get("disposition"))

    return {
        "result": "g1_vla_canary_authorization_package_reviewable",
        "protocol": PROTOCOL,
        "invocation_id": invocation_id,
        "physical_execution_authorized": False,
        "reason": (
            "all required evidence is digest-bound for review; this offline validator never arms "
            "a physical canary or proves a deployment attestation"
        ),
        "evidence": {
            "action_plan_sha256": action_plan_sha256,
            "static_admission_sha256": static_admission_sha256,
            "zero_write_proof_sha256": zero_write_sha256,
            "guardian_contract_sha256": guardian_contract_sha256,
            "safety_truth_sha256": safety_truth_sha256,
        },
        "command_publishers_created": 0,
        "writes": 0,
        "physical_rollout_attempts_consumed": 0,
        "robot_runtime_consumed_s": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--expected-package-sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        package_path = args.package.resolve()
        expected = _sha256_text(args.expected_package_sha256, "expected package SHA-256")
        if _sha256(package_path) != expected:
            raise ValueError("authorization package digest does not match its frozen value")
        result = validate(_read_object(package_path, "authorization package"), package_path.parent)
    except Exception as error:  # noqa: BLE001 - preserve machine-readable rejection
        result = {
            "result": "g1_vla_canary_authorization_package_rejected",
            "protocol": PROTOCOL,
            "physical_execution_authorized": False,
            "reason": str(error),
            "command_publishers_created": 0,
            "writes": 0,
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
        }
    print(json.dumps(result, sort_keys=True))
    return 0 if result["result"] == "g1_vla_canary_authorization_package_reviewable" else 2


if __name__ == "__main__":
    raise SystemExit(main())

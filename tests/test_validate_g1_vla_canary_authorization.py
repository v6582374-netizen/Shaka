from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "validate_g1_vla_canary_authorization.py"
SPEC = importlib.util.spec_from_file_location("g1_vla_canary_authorization", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
AUTHORIZATION = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUTHORIZATION
SPEC.loader.exec_module(AUTHORIZATION)


def write_json(path: Path, value: object) -> str:
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def artifact(path: Path, value: object) -> dict[str, str]:
    return {"path": path.name, "sha256": write_json(path, value)}


def protection_contract() -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": "g1_vla_robot_side_protection_contract",
        "protocol": "shaka.g1-vla-robot-side-guardian.v1",
        "control_entry": {
            "process_name": "humanoid",
            "arm_sdk_topic": "rt/arm_sdk",
            "enforced_at_control_entry": True,
        },
        "workspace_collision_clearance_enforced": True,
        "contact_abort_enforced": True,
        "arm": {
            "joint_order": [f"arm_{index}" for index in range(14)],
            "hard_limits_rad": [[-1.0, 1.0] for _ in range(14)],
            "workspace_limits_rad": [[-0.5, 0.5] for _ in range(14)],
            "maximum_target_delta_rad": [0.1] * 14,
            "maximum_velocity_rad_s": [4.0] * 14,
            "maximum_acceleration_rad_s2": [200.0] * 14,
            "maximum_tracking_error_rad": [0.05] * 14,
            "maximum_abs_torque_nm": [3.0] * 14,
        },
        "hands": {
            "position_limits": [[0.0, 1.0] for _ in range(12)],
            "maximum_target_delta": [0.2] * 12,
            "maximum_velocity_s": [8.0] * 12,
            "maximum_tracking_error": [0.1] * 12,
            "maximum_abs_current": [2.0] * 12,
        },
        "timing": {
            "command_period_ns": 50_000_000,
            "command_lease_ns": 100_000_000,
            "maximum_state_age_ns": 60_000_000,
        },
    }


def package(directory: Path) -> dict[str, object]:
    plan = artifact(
        directory / "plan.json",
        {"command_publishers_created": 0, "writes": 0, "physical_execution_authorized": False},
    )
    static_admission = artifact(
        directory / "static-admission.json",
        {
            "result": "g1_vla_action_plan_static_bounds_ok",
            "physical_execution_authorized": False,
            "command_publishers_created": 0,
            "writes": 0,
        },
    )
    zero_write = artifact(
        directory / "zero-write.json",
        {
            "result": "zero_write_invocation_completed",
            "command_publishers_created": 0,
            "writes": 0,
            "physical_rollout_attempts_consumed": 0,
            "robot_runtime_consumed_s": 0,
        },
    )
    contract = artifact(directory / "guardian-contract.json", protection_contract())
    attestation = artifact(
        directory / "guardian-attestation.json",
        {
            "schema_version": 1,
            "kind": "g1_vla_guardian_deployment_attestation",
            "guardian_protocol": "shaka.g1-vla-robot-side-guardian.v1",
            "guardian_contract_sha256": contract["sha256"],
            "control_entry": {
                "process_name": "humanoid",
                "arm_sdk_topic": "rt/arm_sdk",
                "enforced_at_control_entry": True,
            },
            "deployment": {"location": "robot-side-humanoid", "attested": True},
        },
    )
    safety = artifact(
        directory / "safety-truth.json",
        {
            "schema_version": 1,
            "kind": "g1_vla_safety_truth_attestation",
            "producer_location": "robot-side-humanoid",
            "workspace_clear": True,
            "contact_clear": True,
        },
    )
    static_admission["action_plan_sha256"] = plan["sha256"]
    zero_write["action_plan_sha256"] = plan["sha256"]
    return {
        "schema_version": 1,
        "kind": "g1_vla_canary_authorization_package",
        "protocol": AUTHORIZATION.PROTOCOL,
        "invocation_id": "G1-VLA-CANARY-001",
        "execution_mode": "physical-canary-review-only",
        "physical_execution_authorized": False,
        "candidate": {"action_plan": plan, "static_admission": static_admission},
        "zero_write_proof": zero_write,
        "control_boundary": {
            "process_name": "humanoid",
            "arm_sdk_topic": "rt/arm_sdk",
            "lowcmd_topic": "rt/lowcmd",
            "protected_command_topics": [
                "rt/lowcmd",
                "rt/arm_sdk",
                "brainco-left-serial",
                "brainco-right-serial",
            ],
            "native_motion_controller_participant_uuid": "01108c7a-fe5e-fd9f-9ada-7acb000001c1",
            "guardian_contract": contract,
            "guardian_deployment_attestation": attestation,
        },
        "safety_truth": safety,
        "attempt": {
            "physical_attempts": 1,
            "retry_on_failure": False,
            "maximum_robot_runtime_ms": 1000,
            "limits_configuration_sha256": "a" * 64,
        },
        "disposition": {
            "on_pre_execution_rejection": "halt",
            "on_protection_intervention": "halt",
            "on_recorder_or_evaluator_failure": "halt",
            "on_failure_or_indeterminate": "preserve-evidence-and-halt",
            "on_success": "preserve-evidence-and-halt-for-human-review",
        },
    }


class G1VlaCanaryAuthorizationValidatorTest(unittest.TestCase):
    def test_reference_validator_has_no_control_transport_dependency(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")

        self.assertNotIn("cyclonedds", source)
        self.assertNotIn("ChannelPublisher", source)
        self.assertNotIn("unitree_sdk", source)

    def test_complete_review_package_remains_unarmed(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            result = AUTHORIZATION.validate(package(directory), directory)

        self.assertEqual(result["result"], "g1_vla_canary_authorization_package_reviewable")
        self.assertFalse(result["physical_execution_authorized"])
        self.assertEqual(result["writes"], 0)
        self.assertEqual(result["physical_rollout_attempts_consumed"], 0)

    def test_rejects_missing_robot_side_guardian_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            candidate = package(directory)
            del candidate["control_boundary"]["guardian_deployment_attestation"]  # type: ignore[index]

            with self.assertRaisesRegex(ValueError, "guardian_deployment_attestation"):
                AUTHORIZATION.validate(candidate, directory)

    def test_rejects_any_armed_or_retryable_package(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            candidate = package(directory)
            candidate["physical_execution_authorized"] = True

            with self.assertRaisesRegex(ValueError, "review-only"):
                AUTHORIZATION.validate(candidate, directory)

            candidate = package(directory)
            candidate["attempt"]["physical_attempts"] = 2  # type: ignore[index]
            with self.assertRaisesRegex(ValueError, "exactly one"):
                AUTHORIZATION.validate(candidate, directory)

    def test_rejects_tampered_digest_bound_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            candidate = package(directory)
            (directory / "plan.json").write_text("{}", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "digest"):
                AUTHORIZATION.validate(candidate, directory)


if __name__ == "__main__":
    unittest.main()

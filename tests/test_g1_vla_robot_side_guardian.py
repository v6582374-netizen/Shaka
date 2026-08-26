from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "g1_vla_robot_side_guardian.py"
SPEC = importlib.util.spec_from_file_location("g1_vla_robot_side_guardian", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
GUARDIAN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = GUARDIAN
SPEC.loader.exec_module(GUARDIAN)


def contract() -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": GUARDIAN.CONTRACT_KIND,
        "protocol": GUARDIAN.PROTOCOL,
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


def state(*, timestamp_ns: int = 1_000_000_000) -> dict[str, object]:
    return {
        "timestamp_ns": timestamp_ns,
        "arm": {
            "positions_rad": [0.0] * 14,
            "velocities_rad_s": [0.0] * 14,
            "torques_nm": [0.0] * 14,
        },
        "hands": {
            "positions": [0.5] * 12,
            "velocities_s": [0.0] * 12,
            "currents": [0.0] * 12,
        },
        "safety": {
            "workspace_clear": True,
            "contact_clear": True,
            "control_entry_process": "humanoid",
            "control_entry_topic": "rt/arm_sdk",
        },
    }


def candidate(*, issued_at_ns: int = 1_000_000_000) -> dict[str, object]:
    return {
        "issued_at_ns": issued_at_ns,
        "expires_at_ns": issued_at_ns + 100_000_000,
        "arm": {"positions_rad": [0.02] * 14},
        "hands": {"positions": [0.52] * 12},
    }


def guardian() -> object:
    return GUARDIAN.RobotSideGuardian(GUARDIAN.ProtectionContract.from_object(contract()))


class RobotSideGuardianTest(unittest.TestCase):
    def test_reference_guard_has_no_control_transport_dependency(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")

        self.assertNotIn("cyclonedds", source)
        self.assertNotIn("ChannelPublisher", source)
        self.assertNotIn("unitree_sdk", source)

    def test_permits_only_one_bounded_tick(self) -> None:
        result = guardian().admit(
            GUARDIAN.LiveState.from_object(state()),
            GUARDIAN.CandidateCommand.from_object(candidate()),
            1_020_000_000,
        )

        self.assertEqual(result.result, "g1_vla_guardian_tick_permitted")
        self.assertFalse(result.release_authority)

    def test_stale_feedback_releases_authority(self) -> None:
        result = guardian().admit(
            GUARDIAN.LiveState.from_object(state(timestamp_ns=900_000_000)),
            GUARDIAN.CandidateCommand.from_object(candidate()),
            1_020_000_000,
        )

        self.assertEqual(result.result, "g1_vla_guardian_abort_release")
        self.assertEqual(result.reason, "state feedback is stale")
        self.assertTrue(result.release_authority)

    def test_contact_or_workspace_uncertainty_releases_authority(self) -> None:
        unsafe_state = state()
        unsafe_state["safety"]["workspace_clear"] = False  # type: ignore[index]
        result = guardian().admit(
            GUARDIAN.LiveState.from_object(unsafe_state),
            GUARDIAN.CandidateCommand.from_object(candidate()),
            1_020_000_000,
        )

        self.assertEqual(result.result, "g1_vla_guardian_abort_release")
        self.assertIn("workspace/collision", result.reason)

    def test_torque_and_current_limits_release_authority(self) -> None:
        torque_state = state()
        torque_state["arm"]["torques_nm"][2] = 3.01  # type: ignore[index]
        result = guardian().admit(
            GUARDIAN.LiveState.from_object(torque_state),
            GUARDIAN.CandidateCommand.from_object(candidate()),
            1_020_000_000,
        )

        self.assertEqual(result.result, "g1_vla_guardian_abort_release")
        self.assertIn("torque/contact", result.reason)

    def test_missing_feedback_can_never_degrade_to_a_permit(self) -> None:
        incomplete = state()
        del incomplete["arm"]["torques_nm"]  # type: ignore[index]

        with self.assertRaisesRegex(ValueError, "state.arm.torques_nm"):
            GUARDIAN.LiveState.from_object(incomplete)

    def test_relative_target_and_velocity_limits_release_authority(self) -> None:
        unsafe = candidate()
        unsafe["arm"]["positions_rad"][0] = 0.3  # type: ignore[index]
        result = guardian().admit(
            GUARDIAN.LiveState.from_object(state()),
            GUARDIAN.CandidateCommand.from_object(unsafe),
            1_020_000_000,
        )

        self.assertEqual(result.result, "g1_vla_guardian_abort_release")
        self.assertIn("current-state-relative", result.reason)

    def test_watchdog_releases_after_last_command_lease(self) -> None:
        instance = guardian()
        allowed = instance.admit(
            GUARDIAN.LiveState.from_object(state()),
            GUARDIAN.CandidateCommand.from_object(candidate()),
            1_020_000_000,
        )
        result = instance.watchdog(1_100_000_001)

        self.assertEqual(allowed.result, "g1_vla_guardian_tick_permitted")
        self.assertEqual(result.result, "g1_vla_guardian_abort_release")
        self.assertEqual(result.reason, "command watchdog lease expired")

    def test_contract_must_claim_entry_enforcement_and_all_dynamic_guards(self) -> None:
        unsafe_contract = contract()
        unsafe_contract["contact_abort_enforced"] = False

        with self.assertRaisesRegex(ValueError, "contact_abort_enforced"):
            GUARDIAN.ProtectionContract.from_object(unsafe_contract)

    def test_contract_loader_pins_the_deployment_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            contract_path = temporary / "contract.json"
            state_path = temporary / "state.json"
            candidate_path = temporary / "candidate.json"
            contract_path.write_text(json.dumps(contract()), encoding="utf-8")
            state_path.write_text(json.dumps(state()), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate()), encoding="utf-8")
            digest = hashlib.sha256(contract_path.read_bytes()).hexdigest()
            loaded = GUARDIAN.load_contract(contract_path, digest)
            with self.assertRaisesRegex(ValueError, "deployment-pinned digest"):
                GUARDIAN.load_contract(contract_path, "0" * 64)

        self.assertEqual(loaded.arm_joint_order[0], "arm_0")


if __name__ == "__main__":
    unittest.main()

"""Create a digest-bound live trajectory and its headless MuJoCo admission.

This is the executable P0 simulation gate: it makes the full command stream
from a fresh read-only snapshot, then replays that exact stream in MuJoCo.
The output directory contains evidence only and cannot create hardware
publishers.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

PROTOCOL = "shaka.g1-vla-mujoco-preflight-runner.v1"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{description} is not readable JSON: {error}") from error
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _local_module(name: str, filename: str) -> Any:
    path = Path(__file__).with_name(filename)
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"cannot load local preflight component {filename}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


ASSEMBLER = _local_module("shaka_g1_live_trajectory_assembler", "assemble_g1_vla_live_trajectory.py")
SIMULATOR = _local_module("shaka_g1_mujoco_simulator", "simulate_g1_vla_live_trajectory.py")


def _write_object(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run(
    action_plan_path: Path,
    live_entry_path: Path,
    action_definition_path: Path,
    urdf_path: Path,
    mujoco_model_path: Path,
    hand_speed_normalized: float,
    output_directory: Path,
) -> dict[str, Any]:
    """Run an all-zero-write trajectory build and simulation admission atomically."""
    action_plan_path = action_plan_path.resolve()
    live_entry_path = live_entry_path.resolve()
    action_definition_path = action_definition_path.resolve()
    urdf_path = urdf_path.resolve()
    mujoco_model_path = mujoco_model_path.resolve()
    output_directory = output_directory.resolve()
    if output_directory.exists():
        raise FileExistsError("refusing to overwrite an existing preflight directory")
    action_definition = _read_object(action_definition_path, "action definition")
    joint_order = ASSEMBLER._action_joint_order(action_definition)
    trajectory = ASSEMBLER.assemble(
        _read_object(action_plan_path, "action plan"),
        _read_object(live_entry_path, "live entry snapshot"),
        joint_order,
        ASSEMBLER._arm_velocity_limits(urdf_path, joint_order),
        hand_speed_normalized=hand_speed_normalized,
    )
    trajectory["source_action_plan_sha256"] = _sha256(action_plan_path)
    trajectory["live_entry_snapshot_sha256"] = _sha256(live_entry_path)
    trajectory["action_definition_sha256"] = _sha256(action_definition_path)
    trajectory["urdf_sha256"] = _sha256(urdf_path)
    temporary = output_directory.with_name(f".{output_directory.name}.partial")
    if temporary.exists():
        raise FileExistsError("a partial preflight directory already exists")
    temporary.mkdir(parents=True)
    try:
        trajectory_path = temporary / "live-trajectory.json"
        _write_object(trajectory_path, trajectory)
        admission = SIMULATOR.simulate(trajectory, mujoco_model_path)
        admission["live_trajectory_sha256"] = _sha256(trajectory_path)
        admission["source_action_plan_sha256"] = trajectory["source_action_plan_sha256"]
        admission["live_entry_snapshot_sha256"] = trajectory["live_entry_snapshot_sha256"]
        admission_path = temporary / "simulation-admission.json"
        _write_object(admission_path, admission)
        os.replace(temporary, output_directory)
    except Exception:
        # Preserve failed evidence only in the caller's terminal output; never
        # leave a partially valid directory which could later be mistaken for an admission.
        for item in temporary.iterdir():
            item.unlink()
        temporary.rmdir()
        raise
    return {
        "result": "g1_vla_mujoco_preflight_completed",
        "protocol": PROTOCOL,
        "output_directory": str(output_directory),
        "live_trajectory_sha256": _sha256(output_directory / "live-trajectory.json"),
        "simulation_admission_sha256": _sha256(output_directory / "simulation-admission.json"),
        "physical_execution_authorized": False,
        "command_publishers_created": 0,
        "writes": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--action-plan", type=Path, required=True)
    parser.add_argument("--live-entry-snapshot", type=Path, required=True)
    parser.add_argument("--action-definition", type=Path, required=True)
    parser.add_argument("--g1-urdf", type=Path, required=True)
    parser.add_argument("--mujoco-model", type=Path, required=True)
    parser.add_argument("--hand-speed-normalized", type=float, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = run(
            args.action_plan,
            args.live_entry_snapshot,
            args.action_definition,
            args.g1_urdf,
            args.mujoco_model,
            args.hand_speed_normalized,
            args.output_directory,
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"result": "g1_vla_mujoco_preflight_rejected", "protocol": PROTOCOL, "reason": str(error), "physical_execution_authorized": False, "writes": 0}, sort_keys=True))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

"""Deterministic submission contract independent of robot availability.

The public adapter intentionally reports simulated evidence as simulated.  It
exercises the same formal lifecycle as a physical invocation without claiming
that a Unitree G1 executed the returned trajectory.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import math
from typing import Any


API_VERSION = "2026-08-31"
TASK_ID = "g1-yellow-button-contact-v1"
RESULT_STATES = ("succeeded", "failed", "indeterminate", "aborted", "abstained")
SCENARIOS = ("nominal", "shifted_base", "target_occluded", "guardian_absent")


@dataclass(frozen=True)
class ApiProblem(Exception):
    status: int
    code: str
    message: str
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"error": {"code": self.code, "message": self.message}}
        if self.details:
            body["error"]["details"] = self.details
        return body


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def build_capabilities() -> dict[str, Any]:
    return {
        "api_version": API_VERSION,
        "service": "Shaka Submission API",
        "task": {
            "task_id": TASK_ID,
            "name": "Unitree G1 yellow-button contact and retreat",
            "result_states": list(RESULT_STATES),
            "single_attempt": True,
            "stationary_base": True,
        },
        "execution_modes": [
            {
                "id": "simulation",
                "available": True,
                "requires_robot": False,
                "evidence_level": "deterministic_contract_simulation",
            },
            {
                "id": "connected_g1",
                "available": False,
                "requires_robot": True,
                "evidence_level": "physical_invocation_evidence",
                "availability_note": "Reserved for an approved on-site G1 adapter.",
            },
        ],
        "scenarios": [
            {"id": "nominal", "purpose": "Nominal reachable target."},
            {"id": "shifted_base", "purpose": "Admissible base-pose variation."},
            {"id": "target_occluded", "purpose": "Evaluator abstention under insufficient visual evidence."},
            {"id": "guardian_absent", "purpose": "Pre-motion hardware-boundary refusal."},
        ],
        "links": {
            "source": "https://github.com/v6582374-netizen/Shaka",
            "openapi": "/openapi.json",
            "interactive_demo": "/",
        },
    }


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ApiProblem(422, "invalid_request", f"{name} must be a finite number")
    number = float(value)
    if not minimum <= number <= maximum:
        raise ApiProblem(
            422,
            "invalid_request",
            f"{name} must be between {minimum} and {maximum}",
            {"field": name, "minimum": minimum, "maximum": maximum},
        )
    return number


def normalize_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ApiProblem(400, "invalid_json", "request body must be a JSON object")

    mode = payload.get("mode", "simulation")
    if mode != "simulation":
        raise ApiProblem(
            409,
            "hardware_unavailable",
            "the public endpoint accepts simulation mode; connected_g1 requires an approved on-site adapter",
        )

    task_id = payload.get("task_id", TASK_ID)
    if task_id != TASK_ID:
        raise ApiProblem(422, "unsupported_task", f"task_id must be {TASK_ID}")

    scenario = payload.get("scenario", "nominal")
    if scenario not in SCENARIOS:
        raise ApiProblem(422, "unsupported_scenario", f"scenario must be one of: {', '.join(SCENARIOS)}")

    instruction = payload.get(
        "instruction",
        "Locate the yellow button, touch it once with the right index fingertip, then retreat.",
    )
    if not isinstance(instruction, str) or not instruction.strip() or len(instruction) > 500:
        raise ApiProblem(422, "invalid_request", "instruction must contain 1 to 500 characters")

    initial = payload.get("initial_state", {})
    if not isinstance(initial, dict):
        raise ApiProblem(422, "invalid_request", "initial_state must be an object")

    seed = payload.get("seed", 7)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2_147_483_647:
        raise ApiProblem(422, "invalid_request", "seed must be an integer between 0 and 2147483647")

    guardian_present = payload.get("guardian_present", scenario != "guardian_absent")
    if not isinstance(guardian_present, bool):
        raise ApiProblem(422, "invalid_request", "guardian_present must be boolean")

    return {
        "task_id": task_id,
        "instruction": instruction.strip(),
        "mode": mode,
        "scenario": scenario,
        "seed": seed,
        "guardian_present": guardian_present,
        "initial_state": {
            "base_x_m": _number(initial.get("base_x_m", 0.0), "initial_state.base_x_m", -0.35, 0.35),
            "base_y_m": _number(initial.get("base_y_m", 0.0), "initial_state.base_y_m", -0.35, 0.35),
            "base_yaw_deg": _number(initial.get("base_yaw_deg", 0.0), "initial_state.base_yaw_deg", -25.0, 25.0),
        },
    }


def _trace_entry(index: int, phase: str, outcome: str, detail: str) -> dict[str, Any]:
    return {"sequence": index, "phase": phase, "outcome": outcome, "detail": detail}


def _nominal_metrics(request: dict[str, Any]) -> dict[str, float]:
    pose = request["initial_state"]
    displacement = math.hypot(pose["base_x_m"], pose["base_y_m"])
    yaw = abs(pose["base_yaw_deg"])
    variation = ((request["seed"] * 37) % 17) / 10_000
    return {
        "target_localization_confidence": round(max(0.82, 0.989 - displacement * 0.14 - yaw * 0.0015), 3),
        "predicted_contact_error_mm": round(2.1 + displacement * 4.0 + yaw * 0.025 + variation, 2),
        "peak_joint_velocity_ratio": round(0.51 + displacement * 0.09, 3),
        "minimum_clearance_mm": round(43.0 - displacement * 9.0 - yaw * 0.08, 2),
        "retreat_distance_mm": round(91.0 - displacement * 3.0, 2),
    }


def run_invocation(payload: Any) -> dict[str, Any]:
    request = normalize_request(payload)
    request_digest = _canonical_digest(request)
    run_id = f"sim-{request_digest[:16]}"
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    scenario = request["scenario"]

    trace = [
        _trace_entry(1, "ready_check", "passed", "single-attempt contract and standard start state accepted"),
        _trace_entry(2, "observe", "passed", "synthetic RGB-D and proprioceptive observation assembled"),
    ]
    metrics = _nominal_metrics(request)

    if not request["guardian_present"]:
        result = "aborted"
        trace.append(_trace_entry(3, "hardware_protection", "refused", "guardian_present=false; no action admitted"))
        summary = "The protection boundary refused the invocation before simulated motion."
        visual_facts = {"target_visible": True, "contact_observed": False, "retreat_observed": False}
        action_plan: list[dict[str, Any]] = []
    elif scenario == "target_occluded":
        result = "abstained"
        metrics["target_localization_confidence"] = 0.31
        trace.extend(
            [
                _trace_entry(3, "perceive", "insufficient_evidence", "yellow target is occluded in the synthetic observation"),
                _trace_entry(4, "independent_evaluate", "abstained", "visual evidence cannot establish contact and retreat"),
            ]
        )
        summary = "The evaluator abstained because the target was not sufficiently observable."
        visual_facts = {"target_visible": False, "contact_observed": False, "retreat_observed": False}
        action_plan = []
    else:
        result = "succeeded"
        trace.extend(
            [
                _trace_entry(3, "plan", "passed", "intent localized to a guarded five-waypoint arm trajectory"),
                _trace_entry(4, "hardware_protection", "passed", "joint-rate and workspace envelopes admitted the plan"),
                _trace_entry(5, "execute_simulation", "passed", "one contact attempt and retreat completed in the deterministic simulator"),
                _trace_entry(6, "independent_evaluate", "succeeded", "synthetic visual evidence contains fingertip contact followed by retreat"),
                _trace_entry(7, "retain", "passed", "request, plan, trace, metrics, and verdict bound by digest"),
            ]
        )
        summary = "The deterministic contract simulator completed one guarded contact-and-retreat attempt."
        visual_facts = {"target_visible": True, "contact_observed": True, "retreat_observed": True}
        action_plan = [
            {"waypoint": "observe", "duration_ms": 250, "right_arm_delta_rad": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]},
            {"waypoint": "pre_contact", "duration_ms": 900, "right_arm_delta_rad": [0.04, -0.11, 0.08, -0.16, 0.03, 0.10, -0.02]},
            {"waypoint": "contact", "duration_ms": 420, "right_arm_delta_rad": [0.01, -0.03, 0.02, -0.04, 0.00, 0.02, 0.00]},
            {"waypoint": "retreat", "duration_ms": 650, "right_arm_delta_rad": [-0.02, 0.08, -0.06, 0.11, -0.02, -0.07, 0.01]},
        ]

    response_core = {
        "run_id": run_id,
        "api_version": API_VERSION,
        "request_digest": request_digest,
        "task_result": result,
        "summary": summary,
        "execution": {
            "mode": "simulation",
            "physical_execution": False,
            "robot_required": False,
            "single_attempt": True,
            "writes_to_robot": 0,
            "scenario": scenario,
        },
        "request": request,
        "action_plan": action_plan,
        "trace": trace,
        "evaluation": {
            "evaluator_id": "shaka-contract-evaluator-v1",
            "evidence_level": "illustrative_simulation",
            "visual_facts": visual_facts,
            "metrics": metrics,
            "human_audit_required_for_physical_claim": True,
        },
        "provenance": {
            "source": "https://github.com/v6582374-netizen/Shaka",
            "claim_boundary": "This result proves API and lifecycle form only; it is not physical G1 evidence.",
        },
    }
    response_core["evidence_digest"] = _canonical_digest(response_core)
    response_core["generated_at"] = generated_at
    return response_core

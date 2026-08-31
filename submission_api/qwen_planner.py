"""Qwen-backed experiment planning and deterministic feedback assessment."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Callable
import urllib.request


DASHSCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_MODEL = "qwen3-max"
CLAIM_BOUNDARY = "deterministic_contract_simulation_only"
FIXED_POSE = (0.18, -0.08, 12.0)
ROUND_ONE_CONTROLS = {
    "observation_duration_ms": 250,
    "approach_scale": 1.0,
    "motion_duration_scale": 1.0,
}
ROUND_TWO_CONTROL_BOUNDS = {
    "observation_duration_ms": (250, 650),
    "approach_scale": (0.80, 1.00),
    "motion_duration_scale": (1.00, 1.30),
}
CHECK_DETAILS = {
    "localization_confidence": ("target_localization_confidence", "min_localization_confidence"),
    "predicted_contact_error": ("predicted_contact_error_mm", "max_predicted_contact_error_mm"),
    "peak_joint_velocity": ("peak_joint_velocity_ratio", "max_peak_joint_velocity_ratio"),
    "minimum_clearance": ("minimum_clearance_mm", "min_clearance_mm"),
}


class PlanningError(ValueError):
    """Raised when model output cannot enter the experiment loop."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def load_dashscope_api_key(settings_path: Path | None = None) -> str:
    if key := os.environ.get("DASHSCOPE_API_KEY"):
        return key
    path = settings_path or Path.home() / ".qwen" / "settings.json"
    if path.is_file():
        settings = json.loads(path.read_text(encoding="utf-8"))
        if key := settings.get("env", {}).get("DASHSCOPE_API_KEY"):
            return key
    raise PlanningError("DASHSCOPE_API_KEY is required; no credential is written to evidence")


def _post_json(url: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def call_qwen_json(
    messages: list[dict[str, str]],
    *,
    api_key: str,
    model: str = QWEN_MODEL,
    endpoint: str = DASHSCOPE_ENDPOINT,
    transport: Callable[[str, str, dict[str, Any]], dict[str, Any]] = _post_json,
) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    response = transport(endpoint, api_key, payload)
    try:
        content = response["choices"][0]["message"]["content"]
        plan = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise PlanningError("Qwen response did not contain one valid JSON object") from error
    receipt = {
        "provider": "Alibaba Cloud Model Studio (Bailian/DashScope)",
        "endpoint": endpoint,
        "model_requested": model,
        "model_returned": response.get("model"),
        "request_id": response.get("id"),
        "created": response.get("created"),
        "usage": response.get("usage", {}),
        "prompt_sha256": sha256_json(messages),
        "response_sha256": sha256_json(plan),
        "credential_recorded": False,
        "recorded_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    return plan, receipt


def validate_plan(
    plan: Any,
    *,
    expected_round: int,
    expected_scientific_question: str | None = None,
) -> dict[str, Any]:
    if not isinstance(plan, dict):
        raise PlanningError("plan must be an object")
    required_strings = ("plan_id", "scientific_question", "working_hypothesis", "rationale")
    for field in required_strings:
        if not isinstance(plan.get(field), str) or not plan[field].strip():
            raise PlanningError(f"{field} must be a non-empty string")
    if expected_scientific_question is not None and plan["scientific_question"] != expected_scientific_question:
        raise PlanningError("scientific_question must remain unchanged across rounds")
    if plan.get("round") != expected_round:
        raise PlanningError(f"round must be {expected_round}")
    if plan.get("evidence_status") != CLAIM_BOUNDARY:
        raise PlanningError(f"evidence_status must be {CLAIM_BOUNDARY}")
    request = plan.get("request")
    if not isinstance(request, dict):
        raise PlanningError("request must be an object")
    if request.get("mode") != "simulation" or request.get("scenario") != "shifted_base":
        raise PlanningError("the two-round case must remain in shifted_base simulation")
    if request.get("guardian_present") is not True:
        raise PlanningError("guardian_present must remain true")
    if request.get("seed") != 11:
        raise PlanningError("seed must remain frozen at 11")
    initial = request.get("initial_state")
    if not isinstance(initial, dict):
        raise PlanningError("request.initial_state must be an object")
    for field in ("base_x_m", "base_y_m", "base_yaw_deg"):
        value = initial.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PlanningError(f"request.initial_state.{field} must be numeric")
    pose = (initial["base_x_m"], initial["base_y_m"], float(initial["base_yaw_deg"]))
    if pose != FIXED_POSE:
        raise PlanningError("the base pose must remain frozen across both rounds")
    controls = request.get("plan_controls")
    if not isinstance(controls, dict):
        raise PlanningError("request.plan_controls must be an object")
    if set(controls) != set(ROUND_ONE_CONTROLS):
        raise PlanningError("request.plan_controls must contain exactly the three supported controls")
    for field, value in controls.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PlanningError(f"request.plan_controls.{field} must be numeric")
    if not isinstance(controls["observation_duration_ms"], int):
        raise PlanningError("request.plan_controls.observation_duration_ms must be an integer")
    if expected_round == 1 and controls != ROUND_ONE_CONTROLS:
        raise PlanningError("round 1 must use the frozen baseline action-plan controls")
    if expected_round == 2:
        for field, (minimum, maximum) in ROUND_TWO_CONTROL_BOUNDS.items():
            if not minimum <= controls[field] <= maximum:
                raise PlanningError(f"round 2 {field} must be between {minimum} and {maximum}")
        if controls == ROUND_ONE_CONTROLS:
            raise PlanningError("round 2 must change at least one action-plan control")
    criteria = plan.get("success_criteria")
    expected_criteria = {
        "min_localization_confidence": 0.95,
        "max_predicted_contact_error_mm": 3.0,
        "max_peak_joint_velocity_ratio": 0.60,
        "min_clearance_mm": 40.0,
    }
    if criteria != expected_criteria:
        raise PlanningError("success_criteria must remain frozen across rounds")
    for field in ("expected_observations", "stop_conditions", "changes_from_previous"):
        value = plan.get(field)
        if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
            raise PlanningError(f"{field} must be a list of non-empty strings")
    if expected_round == 2 and not plan["changes_from_previous"]:
        raise PlanningError("round 2 must state at least one evidence-linked change")
    feedback_evidence = plan.get("feedback_evidence")
    if not isinstance(feedback_evidence, list):
        raise PlanningError("feedback_evidence must be a list")
    if expected_round == 1 and feedback_evidence:
        raise PlanningError("round 1 feedback_evidence must be empty")
    if expected_round == 2:
        if not feedback_evidence:
            raise PlanningError("round 2 must include structured feedback_evidence")
        required_evidence_fields = {
            "failed_check",
            "observed_value",
            "criterion_value",
            "changed_control",
            "from_value",
            "to_value",
        }
        for item in feedback_evidence:
            if not isinstance(item, dict) or set(item) != required_evidence_fields:
                raise PlanningError("each feedback_evidence item must use the exact required fields")
    return plan


def verify_feedback_mapping(
    round_one_plan: dict[str, Any],
    round_one_assessment: dict[str, Any],
    round_two_plan: dict[str, Any],
) -> dict[str, Any]:
    failed_checks = {
        name for name, passed in round_one_assessment["checks"].items() if not passed and name in CHECK_DETAILS
    }
    before = round_one_plan["request"]["plan_controls"]
    after = round_two_plan["request"]["plan_controls"]
    changed_controls = {name for name in before if before[name] != after[name]}
    if not failed_checks:
        raise PlanningError("round one did not produce a metric failure to explain")
    if not changed_controls:
        raise PlanningError("round two did not change any action-plan control")

    verified: list[dict[str, Any]] = []
    referenced_checks: set[str] = set()
    referenced_controls: set[str] = set()
    for item in round_two_plan["feedback_evidence"]:
        failed_check = item["failed_check"]
        changed_control = item["changed_control"]
        if failed_check not in failed_checks:
            raise PlanningError(f"feedback_evidence references non-failed check: {failed_check}")
        if changed_control not in changed_controls:
            raise PlanningError(f"feedback_evidence references unchanged control: {changed_control}")
        metric_name, criterion_name = CHECK_DETAILS[failed_check]
        expected_observed = round_one_assessment["observed_metrics"][metric_name]
        expected_criterion = round_one_assessment["frozen_success_criteria"][criterion_name]
        expected_values = (expected_observed, expected_criterion, before[changed_control], after[changed_control])
        actual_values = (
            item["observed_value"],
            item["criterion_value"],
            item["from_value"],
            item["to_value"],
        )
        if actual_values != expected_values:
            raise PlanningError("feedback_evidence numeric values do not match retained artifacts")
        referenced_checks.add(failed_check)
        referenced_controls.add(changed_control)
        verified.append(item)
    if referenced_checks != failed_checks:
        raise PlanningError("feedback_evidence must cover every failed metric check")
    if referenced_controls != changed_controls:
        raise PlanningError("feedback_evidence must cover every changed action-plan control")
    return {
        "failed_checks": sorted(failed_checks),
        "changed_controls": {
            name: {"round_one": before[name], "round_two": after[name]} for name in sorted(changed_controls)
        },
        "verified_feedback_evidence": verified,
        "verified_by_deterministic_program": True,
    }


def assess_result(plan: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    criteria = plan["success_criteria"]
    metrics = result["evaluation"]["metrics"]
    checks = {
        "task_succeeded": result["task_result"] == "succeeded",
        "localization_confidence": metrics["target_localization_confidence"]
        >= criteria["min_localization_confidence"],
        "predicted_contact_error": metrics["predicted_contact_error_mm"]
        <= criteria["max_predicted_contact_error_mm"],
        "peak_joint_velocity": metrics["peak_joint_velocity_ratio"]
        <= criteria["max_peak_joint_velocity_ratio"],
        "minimum_clearance": metrics["minimum_clearance_mm"] >= criteria["min_clearance_mm"],
    }
    return {
        "plan_id": plan["plan_id"],
        "run_id": result["run_id"],
        "decision": "accept" if all(checks.values()) else "adjust",
        "checks": checks,
        "frozen_success_criteria": criteria,
        "observed_metrics": metrics,
        "deterministic_program_decision": True,
        "model_did_not_assign_task_result": True,
        "claim_boundary": CLAIM_BOUNDARY,
    }

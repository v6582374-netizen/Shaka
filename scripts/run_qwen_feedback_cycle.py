#!/usr/bin/env python3
"""Run and retain one genuine Qwen-planned two-round simulation cycle."""

from __future__ import annotations

import argparse
import copy
from datetime import UTC, datetime
import hashlib
from itertools import product
import json
from pathlib import Path
import sys
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from submission_api.core import run_invocation
from submission_api.qwen_planner import (
    CLAIM_BOUNDARY,
    QWEN_MODEL,
    assess_result,
    call_qwen_json,
    load_dashscope_api_key,
    sha256_json,
    validate_plan,
    verify_feedback_mapping,
)


SYSTEM_PROMPT = """你是科学实验任务规划器。你只能输出一个 JSON 对象，不要 Markdown，不要思维过程。
你必须区分已有事实、工作假设、模型推断和仍待验证内容。
本任务只运行确定性契约仿真；禁止声称真实 Unitree G1 已经完成物理实验。
Qwen 只负责生成实验计划与依据，任务结果和阈值判断由确定性程序完成。
输出必须包含：plan_id, round, scientific_question, working_hypothesis,
evidence_status, request, expected_observations, success_criteria,
stop_conditions, changes_from_previous, rationale。
plan_id、scientific_question、working_hypothesis、evidence_status、rationale 必须是字符串；
expected_observations、stop_conditions、changes_from_previous 必须是纯字符串数组，数组项不得是对象。
feedback_evidence 必须是数组。第一轮为空数组；第二轮每项必须恰含：
failed_check, observed_value, criterion_value, changed_control, from_value, to_value。
success_criteria 必须固定为：
{"min_localization_confidence":0.95,"max_predicted_contact_error_mm":3.0,
"max_peak_joint_velocity_ratio":0.6,"min_clearance_mm":40.0}。"""

PLAN_SHAPE = """request 必须是 JSON 对象，禁止写成字符串或数组，结构必须是：
{"mode":"simulation","scenario":"shifted_base","seed":11,"guardian_present":true,
"initial_state":{"base_x_m":0.18,"base_y_m":-0.08,"base_yaw_deg":12},
"plan_controls":{"observation_duration_ms":整数,"approach_scale":数值,
"motion_duration_scale":数值}}。基座位姿在两轮中必须完全不变。"""


def _write(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_manifest(output_directory: Path, cycle_id: str) -> None:
    files = []
    for path in sorted(output_directory.glob("*.json")):
        if path.name == "artifact-manifest.json":
            continue
        content = path.read_bytes()
        files.append(
            {
                "path": path.name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "size_bytes": len(content),
            }
        )
    _write(
        output_directory / "artifact-manifest.json",
        {
            "schema_version": 1,
            "cycle_id": cycle_id,
            "claim_boundary": CLAIM_BOUNDARY,
            "files": files,
        },
    )


def _round_one_messages() -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": PLAN_SHAPE + """
请把以下第一轮候选整理成可执行科学实验计划。
科学问题：在固定基座位姿扰动、任务和保护边界下，基于第一轮结果调整观察时长、接近幅度和动作时标，能否使黄色按钮任务的软件准入指标全部达标？
已有事实：公开执行器是确定性契约仿真；基座固定为 x=0.18m、y=-0.08m、yaw=12deg；评估器和阈值不可修改。
工作假设：第一轮基线动作计划可能无法满足全部阈值，结果反馈可指导第二轮动作计划控制量调整。
request 必须使用 mode=simulation, scenario=shifted_base, seed=11,
guardian_present=true，initial_state 必须恰为上述三个数值，plan_controls 必须恰为：
observation_duration_ms=250、approach_scale=1.0、motion_duration_scale=1.0。
evidence_status 必须是 deterministic_contract_simulation_only。
第一轮 changes_from_previous 和 feedback_evidence 都输出空数组。""",
        },
    ]


def _round_two_messages(
    round_one_plan: dict[str, Any],
    round_one_result: dict[str, Any],
    round_one_assessment: dict[str, Any],
) -> list[dict[str, str]]:
    context = {
        "round_one_plan": round_one_plan,
        "round_one_result": {
            "task_result": round_one_result["task_result"],
            "request": round_one_result["request"],
            "metrics": round_one_result["evaluation"]["metrics"],
        },
        "program_assessment": round_one_assessment,
    }
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": PLAN_SHAPE + """
下面是第一轮真实保存的计划、仿真输出和确定性阈值判断：
"""
            + json.dumps(context, ensure_ascii=False, sort_keys=True)
            + """
请生成第二轮调整计划。必须保持科学问题、模型外评估器、seed=11、
mode=simulation、scenario=shifted_base、guardian_present=true 和全部 success_criteria 不变。
基座位姿必须与第一轮完全相同。只能调整真正进入 action_plan 的三个控制量：
observation_duration_ms 范围 250~650，approach_scale 范围 0.80~1.00，
motion_duration_scale 范围 1.00~1.30。这个允许域同时包含会通过和不会通过的候选；
请选择你认为最可能同时满足全部门槛的一点，但最终结果只能由程序决定。
本实验没有奖励“最小改动”或“贴近阈值”；在缺少精确响应模型时，应优先为每个失败指标保留明确安全余量，
避免选择允许域中部或仅够越过阈值的边缘参数。不要声称所选参数必然通过。
changes_from_previous 必须说明变化。feedback_evidence 必须覆盖第一轮每个失败 check 和每个改变的控制量，
并逐项抄录 program_assessment 中的真实 observed_value、criterion_value，以及控制量 from_value/to_value。
evidence_status 必须是 deterministic_contract_simulation_only。""",
        },
    ]


def _request_valid_plan(
    messages: list[dict[str, str]],
    *,
    expected_round: int,
    api_key: str,
    attempts_path: Path,
    attempts: list[dict[str, Any]],
    expected_scientific_question: str | None = None,
    round_one_plan: dict[str, Any] | None = None,
    round_one_assessment: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]:
    working_messages = list(messages)
    for attempt_number in range(1, 4):
        candidate, receipt = call_qwen_json(working_messages, api_key=api_key)
        record: dict[str, Any] = {
            "round": expected_round,
            "attempt": attempt_number,
            "candidate": candidate,
            "receipt": receipt,
        }
        try:
            plan = validate_plan(
                candidate,
                expected_round=expected_round,
                expected_scientific_question=expected_scientific_question,
            )
            verified_mapping = None
            if expected_round == 2:
                if round_one_plan is None or round_one_assessment is None:
                    raise ValueError("round two requires retained round-one evidence")
                verified_mapping = verify_feedback_mapping(round_one_plan, round_one_assessment, plan)
        except ValueError as error:
            record["accepted"] = False
            record["rejection_reason"] = str(error)
            attempts.append(record)
            if attempt_number == 3:
                raise
            working_messages.extend(
                [
                    {"role": "assistant", "content": json.dumps(candidate, ensure_ascii=False, sort_keys=True)},
                    {
                        "role": "user",
                        "content": f"上一个 JSON 被确定性校验器拒绝：{error}。只修正该契约错误，重新输出完整 JSON 对象。",
                    },
                ]
            )
            continue
        record["accepted"] = True
        if verified_mapping is not None:
            record["verified_feedback_mapping"] = verified_mapping
        attempts.append(record)
        return plan, receipt, verified_mapping
    raise AssertionError("unreachable")


def _repeatability(plan: dict[str, Any], repetitions: int = 20) -> dict[str, Any]:
    results = [run_invocation(plan["request"]) for _ in range(repetitions)]
    assessments = [assess_result(plan, result) for result in results]
    metric_vectors = [result["evaluation"]["metrics"] for result in results]
    return {
        "repetitions": repetitions,
        "decision_counts": {
            decision: sum(assessment["decision"] == decision for assessment in assessments)
            for decision in ("accept", "adjust")
        },
        "unique_run_ids": sorted({result["run_id"] for result in results}),
        "unique_request_digests": sorted({result["request_digest"] for result in results}),
        "unique_metric_vectors": len({sha256_json(metrics) for metrics in metric_vectors}),
        "interpretation_boundary": (
            "Repeated equality establishes deterministic software behavior only; "
            "it is not statistical robustness or physical repeatability evidence."
        ),
    }


def _rule_based_request(round_one_request: dict[str, Any]) -> dict[str, Any]:
    request = copy.deepcopy(round_one_request)
    request["plan_controls"] = {
        "observation_duration_ms": 450,
        "approach_scale": 0.90,
        "motion_duration_scale": 1.10,
    }
    return request


def _parameter_space_audit(plan: dict[str, Any]) -> dict[str, Any]:
    observations = [250, 350, 450, 550, 650]
    approach_scales = [0.80, 0.90, 1.00]
    duration_scales = [1.00, 1.15, 1.30]
    decisions = {"accept": 0, "adjust": 0}
    examples: dict[str, list[dict[str, Any]]] = {"accept": [], "adjust": []}
    for observation, approach, duration in product(observations, approach_scales, duration_scales):
        request = copy.deepcopy(plan["request"])
        request["plan_controls"] = {
            "observation_duration_ms": observation,
            "approach_scale": approach,
            "motion_duration_scale": duration,
        }
        result = run_invocation(request)
        assessment = assess_result(plan, result)
        decision = assessment["decision"]
        decisions[decision] += 1
        if len(examples[decision]) < 3:
            examples[decision].append(
                {
                    "plan_controls": request["plan_controls"],
                    "metrics": result["evaluation"]["metrics"],
                }
            )
    return {
        "grid": {
            "observation_duration_ms": observations,
            "approach_scale": approach_scales,
            "motion_duration_scale": duration_scales,
            "candidate_count": len(observations) * len(approach_scales) * len(duration_scales),
        },
        "decision_counts": decisions,
        "examples": examples,
        "all_candidates_guaranteed_to_pass": decisions["adjust"] == 0,
        "claim_boundary": CLAIM_BOUNDARY,
    }


def run(
    output_directory: Path,
    settings_path: Path | None = None,
    *,
    replace_existing: bool = False,
) -> dict[str, Any]:
    if output_directory.exists() and any(output_directory.iterdir()) and not replace_existing:
        raise FileExistsError(f"refusing to overwrite non-empty evidence directory: {output_directory}")
    output_directory.mkdir(parents=True, exist_ok=True)
    api_key = load_dashscope_api_key(settings_path)

    attempts: list[dict[str, Any]] = []
    attempts_path = output_directory / "qwen-attempts.json"
    round_one_messages = _round_one_messages()
    round_one_plan, receipt_one, _ = _request_valid_plan(
        round_one_messages,
        expected_round=1,
        api_key=api_key,
        attempts_path=attempts_path,
        attempts=attempts,
    )
    round_one_result = run_invocation(round_one_plan["request"])
    round_one_assessment = assess_result(round_one_plan, round_one_result)

    round_two_messages = _round_two_messages(round_one_plan, round_one_result, round_one_assessment)
    round_two_plan, receipt_two, verified_mapping = _request_valid_plan(
        round_two_messages,
        expected_round=2,
        api_key=api_key,
        attempts_path=attempts_path,
        attempts=attempts,
        expected_scientific_question=round_one_plan["scientific_question"],
        round_one_plan=round_one_plan,
        round_one_assessment=round_one_assessment,
    )
    round_two_result = run_invocation(round_two_plan["request"])
    round_two_assessment = assess_result(round_two_plan, round_two_result)
    if round_one_assessment["decision"] != "adjust" or round_two_assessment["decision"] != "accept":
        retained_at = datetime.now(UTC)
        failure_directory = output_directory.parent / (
            f"{output_directory.name}-failed-{retained_at.strftime('%Y%m%dT%H%M%SZ')}"
        )
        failure_directory.mkdir(parents=True, exist_ok=False)
        failure_cycle_id = (
            f"qwen-cycle-{round_one_result['request_digest'][:8]}-{round_two_result['request_digest'][:8]}"
        )
        failure_context = {
            "system_prompt": SYSTEM_PROMPT,
            "round_one_messages": round_one_messages,
            "round_two_messages": round_two_messages,
            "credential_source": "DASHSCOPE_API_KEY or local Qwen official CLI settings",
            "credential_value_retained": False,
        }
        for name, value in (
            ("qwen-context.json", failure_context),
            ("qwen-attempts.json", attempts),
            ("qwen-receipts.json", [receipt_one, receipt_two]),
            ("round-1-plan.json", round_one_plan),
            ("round-1-result.json", round_one_result),
            ("round-1-assessment.json", round_one_assessment),
            ("round-2-plan.json", round_two_plan),
            ("round-2-result.json", round_two_result),
            ("round-2-assessment.json", round_two_assessment),
            (
                "failure-summary.json",
                {
                    "cycle_id": failure_cycle_id,
                    "generated_at": retained_at.isoformat().replace("+00:00", "Z"),
                    "provider": receipt_one["provider"],
                    "model": QWEN_MODEL,
                    "claim_boundary": CLAIM_BOUNDARY,
                    "round_decisions": [round_one_assessment["decision"], round_two_assessment["decision"]],
                    "qwen_request_ids": [receipt_one["request_id"], receipt_two["request_id"]],
                    "qwen_total_tokens": receipt_one["usage"].get("total_tokens", 0)
                    + receipt_two["usage"].get("total_tokens", 0),
                    "credential_recorded": False,
                    "physical_execution": False,
                    "published_as_primary_cycle": False,
                },
            ),
        ):
            _write(failure_directory / name, value)
        _write_manifest(failure_directory, failure_cycle_id)
        raise RuntimeError(
            "refusing to publish a non-demonstrative cycle: expected round one adjust and round two accept, "
            f"got {round_one_assessment['decision']} then {round_two_assessment['decision']}; "
            f"failure evidence retained at {failure_directory}"
        )

    no_feedback_result = run_invocation(round_one_plan["request"])
    no_feedback_assessment = assess_result(round_one_plan, no_feedback_result)
    rule_based_result = run_invocation(_rule_based_request(round_one_plan["request"]))
    rule_based_assessment = assess_result(round_one_plan, rule_based_result)
    plan_diff = {
        "frozen_initial_state": round_one_result["request"]["initial_state"],
        "action_plan_controls": verified_mapping["changed_controls"],
        "verified_feedback_mapping": verified_mapping,
        "action_plan_changed": round_one_result["action_plan"] != round_two_result["action_plan"],
        "changed_waypoints": [
            round_one_waypoint["waypoint"]
            for round_one_waypoint, round_two_waypoint in zip(
                round_one_result["action_plan"], round_two_result["action_plan"], strict=True
            )
            if round_one_waypoint != round_two_waypoint
        ],
        "qwen_explanation": round_two_plan["changes_from_previous"],
        "frozen_fields": [
            "task_id",
            "instruction",
            "mode",
            "scenario",
            "seed",
            "guardian_present",
            "initial_state",
            "success_criteria",
        ],
    }
    method_comparison = {
        "comparison_type": "feedback_policy_ablation",
        "shared_round_one_evidence_digest": round_one_result["evidence_digest"],
        "feedback_disabled": {
            "policy": "replay the round-one plan without using result feedback",
            "decision": no_feedback_assessment["decision"],
            "request": no_feedback_result["request"],
            "metrics": no_feedback_result["evaluation"]["metrics"],
        },
        "rule_based_feedback": {
            "policy": "fixed conservative rule: +200 ms observation, 0.90 approach scale, 1.10 duration scale",
            "decision": rule_based_assessment["decision"],
            "request": rule_based_result["request"],
            "metrics": rule_based_result["evaluation"]["metrics"],
        },
        "qwen_feedback_enabled": {
            "policy": "give Qwen the round-one result and deterministic assessment, then validate its bounded adjustment",
            "decision": round_two_assessment["decision"],
            "request": round_two_result["request"],
            "metrics": round_two_result["evaluation"]["metrics"],
        },
        "claim_boundary": CLAIM_BOUNDARY,
        "limitation": "The evaluator metrics are constructed contract fixtures, not sensor or physics measurements.",
        "fairness_note": (
            "All policies share the same round-one evidence, fixed pose, adjustment budget, seed, executor, "
            "and evaluator. Their second-round action-plan controls are policy outputs, not identical inputs."
        ),
    }
    repeatability = {
        "round_one": _repeatability(round_one_plan),
        "round_two": _repeatability(round_two_plan),
    }
    parameter_space_audit = _parameter_space_audit(round_one_plan)

    context = {
        "system_prompt": SYSTEM_PROMPT,
        "round_one_messages": round_one_messages,
        "round_two_messages": round_two_messages,
        "credential_source": "DASHSCOPE_API_KEY or local Qwen official CLI settings",
        "credential_value_retained": False,
    }
    summary = {
        "cycle_id": f"qwen-cycle-{round_one_result['request_digest'][:8]}-{round_two_result['request_digest'][:8]}",
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "provider": receipt_one["provider"],
        "model": QWEN_MODEL,
        "claim_boundary": CLAIM_BOUNDARY,
        "scientific_question": round_one_plan["scientific_question"],
        "round_one": {
            "plan_id": round_one_plan["plan_id"],
            "run_id": round_one_result["run_id"],
            "decision": round_one_assessment["decision"],
            "request": round_one_result["request"],
            "metrics": round_one_result["evaluation"]["metrics"],
            "action_plan": round_one_result["action_plan"],
        },
        "round_two": {
            "plan_id": round_two_plan["plan_id"],
            "run_id": round_two_result["run_id"],
            "decision": round_two_assessment["decision"],
            "request": round_two_result["request"],
            "metrics": round_two_result["evaluation"]["metrics"],
            "action_plan": round_two_result["action_plan"],
        },
        "measured_change": {
            "localization_confidence_delta": round(
                round_two_result["evaluation"]["metrics"]["target_localization_confidence"]
                - round_one_result["evaluation"]["metrics"]["target_localization_confidence"],
                3,
            ),
            "predicted_contact_error_mm_delta": round(
                round_two_result["evaluation"]["metrics"]["predicted_contact_error_mm"]
                - round_one_result["evaluation"]["metrics"]["predicted_contact_error_mm"],
                2,
            ),
            "minimum_clearance_mm_delta": round(
                round_two_result["evaluation"]["metrics"]["minimum_clearance_mm"]
                - round_one_result["evaluation"]["metrics"]["minimum_clearance_mm"],
                2,
            ),
        },
        "qwen_request_ids": [receipt_one["request_id"], receipt_two["request_id"]],
        "qwen_total_tokens": receipt_one["usage"].get("total_tokens", 0)
        + receipt_two["usage"].get("total_tokens", 0),
        "context_sha256": sha256_json(context),
        "credential_recorded": False,
        "physical_execution": False,
        "action_plan_changed": plan_diff["action_plan_changed"],
        "round_two_domain_all_candidates_guaranteed_to_pass": parameter_space_audit[
            "all_candidates_guaranteed_to_pass"
        ],
    }

    _write(output_directory / "qwen-context.json", context)
    _write(attempts_path, attempts)
    _write(output_directory / "round-1-plan.json", round_one_plan)
    _write(output_directory / "round-1-result.json", round_one_result)
    _write(output_directory / "round-1-assessment.json", round_one_assessment)
    _write(output_directory / "round-2-plan.json", round_two_plan)
    _write(output_directory / "round-2-result.json", round_two_result)
    _write(output_directory / "round-2-assessment.json", round_two_assessment)
    _write(output_directory / "plan-diff.json", plan_diff)
    _write(output_directory / "method-comparison.json", method_comparison)
    _write(output_directory / "repeatability.json", repeatability)
    _write(output_directory / "parameter-space-audit.json", parameter_space_audit)
    _write(output_directory / "qwen-receipts.json", [receipt_one, receipt_two])
    _write(output_directory / "cycle-summary.json", summary)
    _write_manifest(output_directory, summary["cycle_id"])
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-directory",
        type=Path,
        help="Evidence directory. Defaults to a new timestamped run directory.",
    )
    parser.add_argument("--qwen-settings", type=Path)
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="Allow overwriting files in an explicitly selected non-empty evidence directory.",
    )
    args = parser.parse_args()
    output_directory = args.output_directory
    if output_directory is None:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        output_directory = Path("artifacts/qwen-feedback-cycle-runs") / timestamp
    summary = run(
        output_directory.resolve(),
        args.qwen_settings,
        replace_existing=args.replace_existing,
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

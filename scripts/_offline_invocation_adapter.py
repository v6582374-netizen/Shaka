#!/usr/bin/env python3
"""Zero-write runner adapters, including the independent evaluator boundary."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from artifact_identity import sha256_file as _sha256_file
from invocation_evaluation import evaluate_finalized_invocation


def _sha256_json(value: Any) -> str:
    content = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(content).hexdigest()


def _read_object(path: Path, description: str) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"{description} is missing: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _atomic_replace_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    if path.exists():
        raise FileExistsError(f"output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_replace_json(path, value)


def _replace_json(path: Path, value: dict[str, Any]) -> None:
    _atomic_replace_json(path, value)


def _audit(adapter: str, outcome: str, result: dict[str, Any] | None = None) -> None:
    path_value = os.environ.get("SHAKA_INVOCATION_ADAPTER_AUDIT")
    if path_value is None:
        return
    event = {
        "adapter": adapter,
        "outcome": outcome,
        "time_ns": time.time_ns(),
        "command_publishers_created": 0
        if result is None
        else result.get("command_publishers_created", 0),
        "writes": 0 if result is None else result.get("writes", 0),
    }
    with Path(path_value).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(event, sort_keys=True) + "\n")
        stream.flush()


def _base(**values: Any) -> dict[str, Any]:
    return {"command_publishers_created": 0, "writes": 0, **values}


def _verified_path(
    runtime_path: Path, reference: Any, description: str
) -> Path:
    if not isinstance(reference, dict):
        raise TypeError(f"{description} reference must be an object")
    path_value = reference.get("path")
    expected_digest = reference.get("sha256")
    if not isinstance(path_value, str) or not path_value:
        raise ValueError(f"{description} path must be non-empty")
    if not isinstance(expected_digest, str) or len(expected_digest) != 64:
        raise ValueError(f"{description} sha256 must be a digest")
    path = Path(path_value)
    if not path.is_absolute():
        path = runtime_path.parent / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"{description} is missing: {path}")
    if _sha256_file(path) != expected_digest:
        raise ValueError(f"{description} digest does not match: {path}")
    return path


def _load_callable(path: Path, name: str, stage: str) -> Callable[..., Any]:
    module_name = f"shaka_candidate_{stage}_{_sha256_file(path)}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"candidate {stage} artifact cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    function = getattr(module, name, None)
    if not callable(function):
        raise TypeError(f"candidate {stage} callable is absent: {name}")
    return function


def _entrypoint(
    runtime: dict[str, Any], artifacts: dict[str, Path], stage: str
) -> Callable[..., Any]:
    value = runtime.get(stage)
    if not isinstance(value, dict):
        raise TypeError(f"candidate runtime {stage} must be an object")
    artifact_name = value.get("artifact")
    callable_name = value.get("callable")
    if artifact_name not in artifacts:
        raise ValueError(f"candidate runtime {stage} references an unknown artifact")
    if not isinstance(callable_name, str) or not callable_name.isidentifier():
        raise ValueError(f"candidate runtime {stage} callable is invalid")
    return _load_callable(artifacts[artifact_name], callable_name, stage)


def _adapter_plan(adapter: str) -> dict[str, Any]:
    raw_plan = os.environ.get("SHAKA_OFFLINE_ADAPTER_PLAN")
    if raw_plan is None:
        return {}
    plan = json.loads(raw_plan)
    if not isinstance(plan, dict):
        raise TypeError("offline adapter plan must be a JSON object")
    values = plan.get(adapter, {})
    if not isinstance(values, dict):
        raise TypeError(f"offline adapter plan for {adapter} must be an object")
    delay_s = values.get("delay_s", 0)
    if not isinstance(delay_s, (int, float)) or delay_s < 0:
        raise ValueError(f"offline adapter delay for {adapter} must not be negative")
    if delay_s:
        time.sleep(float(delay_s))
    failure = values.get("failure")
    if failure is not None:
        if not isinstance(failure, str) or not failure:
            raise TypeError(f"offline adapter failure for {adapter} must be a string")
        raise RuntimeError(failure)
    return values


def readiness(args: argparse.Namespace) -> dict[str, Any]:
    _adapter_plan("readiness")
    claim_directory = args.claim_directory.resolve()
    if args.execution_mode != "zero-write":
        raise ValueError("offline readiness only accepts zero-write mode")
    if not (claim_directory / "run-id.txt").is_file():
        raise RuntimeError("invocation authority claim is absent")
    return _base(
        ready=True,
        execution_mode="zero-write",
        control_authority="exclusive_local_claim",
        competing_command_publishers=0,
    )


def candidate(args: argparse.Namespace) -> dict[str, Any]:
    _adapter_plan("candidate")
    runtime_path = args.runtime_package.resolve()
    observation_path = args.observation.resolve()
    candidate_id: str | None = None
    package_sha256: str | None = None
    observation_sha256: str | None = None
    model_input: Any = None
    output: Any = None
    publishers = 0
    writes = 0
    diagnostics: dict[str, Any] = {
        "preprocessing": "pending",
        "inference": "pending",
        "output_validation": "pending",
    }
    try:
        package = _read_object(runtime_path, "candidate runtime package")
        if package.get("schema_version") != 1:
            raise ValueError("candidate runtime package schema_version must be 1")
        candidate_id_value = package.get("candidate_id")
        if not isinstance(candidate_id_value, str) or not candidate_id_value:
            raise ValueError("candidate package candidate_id must be non-empty")
        candidate_id = candidate_id_value
        package_digest_value = package.get("candidate_package_sha256")
        if not isinstance(package_digest_value, str) or len(package_digest_value) != 64:
            raise ValueError("candidate package digest must be present")
        package_sha256 = package_digest_value
        artifact_references = package.get("artifacts")
        if not isinstance(artifact_references, dict):
            raise TypeError("candidate runtime artifacts must be an object")
        artifacts = {
            name: _verified_path(
                runtime_path, reference, f"candidate artifact '{name}'"
            )
            for name, reference in artifact_references.items()
        }
        configuration = _read_object(
            artifacts["configuration"], "candidate configuration"
        )
        action_definition = _read_object(
            artifacts["action_definition"], "candidate action definition"
        )
        observation = _read_object(observation_path, "candidate observation")
        observation_sha256 = _sha256_file(observation_path)
        runtime = package.get("runtime")
        if not isinstance(runtime, dict) or runtime.get("kind") != "python-callable-v1":
            raise ValueError("candidate runtime kind is unsupported")

        preprocess = _entrypoint(runtime, artifacts, "preprocess")
        inference = _entrypoint(runtime, artifacts, "inference")
        model_input = preprocess(observation, configuration)
        diagnostics["preprocessing"] = "completed"
        output = inference(model_input, configuration)
        diagnostics["inference"] = "completed"
        if not isinstance(output, dict):
            raise TypeError("candidate inference output must be an object")

        publishers_value = output.get("command_publishers_created", 0)
        writes_value = output.get("writes", 0)
        if not isinstance(publishers_value, int) or isinstance(publishers_value, bool):
            raise TypeError("candidate command publisher count must be an integer")
        if not isinstance(writes_value, int) or isinstance(writes_value, bool):
            raise TypeError("candidate write count must be an integer")
        publishers = publishers_value
        writes = writes_value
        if publishers != 0 or writes != 0:
            raise RuntimeError("candidate violated zero-write mode")

        expected_names = action_definition.get("joint_names")
        values = output.get("values")
        if output.get("action_definition_id") != action_definition.get(
            "action_definition_id"
        ):
            raise ValueError("candidate output action definition is incompatible")
        if output.get("joint_names") != expected_names:
            raise ValueError("candidate output joint names or order do not match")
        if not isinstance(values, list) or len(values) != action_definition.get(
            "value_dimension"
        ):
            raise ValueError("candidate output dimension does not match")
        if any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(float(value))
            for value in values
        ):
            raise ValueError("candidate output values must be finite numbers")
        timestamp_ns = output.get("timestamp_ns")
        captured_at_ns = observation.get("captured_at_ns")
        maximum_age_ns = action_definition.get("maximum_output_age_ns")
        if not isinstance(timestamp_ns, int) or isinstance(timestamp_ns, bool):
            raise TypeError("candidate output timestamp_ns must be an integer")
        if not isinstance(captured_at_ns, int) or not isinstance(maximum_age_ns, int):
            raise TypeError("candidate timestamp contract is invalid")
        if captured_at_ns - timestamp_ns > maximum_age_ns:
            raise ValueError("candidate output timestamp is stale")

        diagnostics.update(
            {
                "action_definition_id": action_definition["action_definition_id"],
                "output_validation": "compatible",
            }
        )
        ignored_claims = {
            name: output[name]
            for name in ("task_result", "success", "succeeded")
            if name in output
        }
        frame_time_ns = time.time_ns()
        _write_json(
            args.controller_trace.resolve(),
            {
                "schema_version": 1,
                "protocol": "shaka.offline-controller-trace.v1",
                "outcome": "running",
                "checkpoint_digest": package_sha256,
                "frames": [
                    {
                        "phase": "act_task",
                        "candidate_age_ms": 0.0,
                        "candidate_source_time_ns": frame_time_ns,
                        "loop_now_ns": frame_time_ns,
                    }
                ],
            },
        )
        return _base(
            candidate_id=candidate_id,
            deployment_status="admitted",
            candidate_package_sha256=package_sha256,
            input_observation_sha256=observation_sha256,
            preprocessed_input_sha256=_sha256_json(model_input),
            candidate_output_sha256=_sha256_json(output),
            ignored_candidate_claims=ignored_claims,
            diagnostics=diagnostics,
        )
    except Exception as error:  # noqa: BLE001 - deployment evidence is the boundary
        diagnostics["output_validation"] = "rejected"
        result = _base(
            result="failed",
            deployment_status="rejected",
            failure_class="deployment_defect",
            reason=str(error),
            diagnostics=diagnostics,
            physical_rollout_attempts_consumed=0,
            robot_runtime_consumed_s=0,
            command_publishers_created=publishers,
            writes=writes,
        )
        if candidate_id is not None:
            result["candidate_id"] = candidate_id
        if package_sha256 is not None:
            result["candidate_package_sha256"] = package_sha256
        if observation_sha256 is not None:
            result["input_observation_sha256"] = observation_sha256
        if model_input is not None:
            result["preprocessed_input_sha256"] = _sha256_json(model_input)
        if output is not None:
            result["candidate_output_sha256"] = _sha256_json(output)
        return result


def release(args: argparse.Namespace) -> dict[str, Any]:
    plan = _adapter_plan("release")
    if args.controller_trace is None:
        return _base(released=True, control_authority="released")
    trace_path = args.controller_trace.resolve()
    trace = _read_object(trace_path, "controller trace")
    outcome = plan.get("controller_outcome", "completed")
    if outcome not in {"completed", "aborted", "abstained", "rejected"}:
        raise ValueError("offline controller outcome is invalid")
    end_offset_ns = plan.get("controller_end_offset_ns", 0)
    if not isinstance(end_offset_ns, int) or isinstance(end_offset_ns, bool):
        raise TypeError("offline controller end offset must be an integer")
    frame_time_ns = time.time_ns() + end_offset_ns
    trace["outcome"] = outcome
    trace["frames"].append(
        {
            "phase": "act_task",
            "candidate_age_ms": 0.0,
            "candidate_source_time_ns": frame_time_ns,
            "loop_now_ns": frame_time_ns,
        }
    )
    _replace_json(trace_path, trace)
    stdout_path = args.controller_stdout.resolve()
    stdout_path.write_text(
        json.dumps(
            {
                "protocol": trace["protocol"],
                "trace_artifact": str(trace_path),
                "outcome": outcome,
                "arm_publishers_created": 0,
                "hand_publishers_created": 0,
                "arm_writes": 0,
                "hand_updates": 0,
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return _base(
        released=True,
        control_authority="released",
        controller_outcome=outcome,
    )


def evaluation(args: argparse.Namespace) -> dict[str, Any]:
    _adapter_plan("evaluation")
    evaluated = evaluate_finalized_invocation(
        args.evidence_directory.resolve(),
        args.invocation_id,
        args.prepared_evidence_directory.resolve(),
        args.evaluator_config.resolve(),
    )
    model_result = evaluated["model_result"]
    _write_json(args.model_result_output.resolve(), model_result)
    return _base(
        evaluator_version=model_result["evaluator_id"],
        input_manifest_sha256=evaluated["source_evidence"]["manifest_sha256"],
        evidence_manifest_sha256=model_result["evidence_manifest_sha256"],
        configuration_sha256=model_result["configuration_sha256"],
        prompt_sha256=model_result["prompt_sha256"],
        backend=model_result["backend"],
        model=model_result["model"],
        response_id=model_result["response_id"],
        visual_facts=model_result["visual_assessment"],
        task_result=model_result["result"],
        human_audit_required=model_result["human_audit_required"],
        model_result_sha256=_sha256_file(args.model_result_output.resolve()),
    )


def reset(args: argparse.Namespace) -> dict[str, Any]:
    _adapter_plan("reset")
    if args.execution_mode != "zero-write":
        raise ValueError("offline reset adapter only accepts zero-write mode")
    return _base(
        requested=False,
        task_result=args.task_result,
        reason="zero_write_validation_is_not_a_task_attempt",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="adapter", required=True)

    readiness_parser = subparsers.add_parser("readiness")
    readiness_parser.add_argument("--claim-directory", type=Path, required=True)
    readiness_parser.add_argument("--execution-mode", required=True)

    candidate_parser = subparsers.add_parser("candidate")
    candidate_parser.add_argument("--runtime-package", type=Path, required=True)
    candidate_parser.add_argument("--observation", type=Path, required=True)
    candidate_parser.add_argument("--controller-trace", type=Path, required=True)

    release_parser = subparsers.add_parser("release")
    release_parser.add_argument("--controller-trace", type=Path)
    release_parser.add_argument("--controller-stdout", type=Path)

    evaluation_parser = subparsers.add_parser("evaluation")
    evaluation_parser.add_argument("--evidence-directory", type=Path, required=True)
    evaluation_parser.add_argument("--invocation-id", required=True)
    evaluation_parser.add_argument(
        "--prepared-evidence-directory", type=Path, required=True
    )
    evaluation_parser.add_argument("--evaluator-config", type=Path, required=True)
    evaluation_parser.add_argument("--model-result-output", type=Path, required=True)

    reset_parser = subparsers.add_parser("reset")
    reset_parser.add_argument("--execution-mode", required=True)
    reset_parser.add_argument("--task-result", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    adapter = str(args.adapter)
    functions = {
        "readiness": readiness,
        "candidate": candidate,
        "release": release,
        "evaluation": evaluation,
        "reset": reset,
    }
    try:
        result = functions[adapter](args)
    except Exception as error:  # noqa: BLE001 - adapter emits structured failure
        _audit(adapter, "failed")
        print(json.dumps(_base(result="failed", reason=str(error)), sort_keys=True))
        return 2
    if adapter == "candidate" and result.get("deployment_status") == "rejected":
        _audit(adapter, "failed", result)
        print(json.dumps(result, sort_keys=True))
        return 2
    _audit(adapter, "completed", result)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

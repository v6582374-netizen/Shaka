# Single-invocation runner

`scripts/run_single_invocation.py` runs the first offline, zero-write invocation
path from one immutable JSON manifest:

```bash
python scripts/run_single_invocation.py --manifest /path/to/run-manifest.json
```

The runner validates every referenced artifact before starting the recorder. It
then performs the following ordered stages:

```text
manifest validation
→ invocation identity claim
→ readiness check
→ recorder ready
→ candidate processing
→ control release
→ evidence identity and completeness finalization
→ four-view evidence preparation
→ independent multimodal evaluation
→ reset disposition
→ terminal report
```

Only `zero-write` is accepted. The readiness, candidate, release and reset
adapters are deterministic and offline; none creates a command publisher or
performs a robot write. Candidate replay executes the package's digest-bound
Python preprocessing and inference callables against a digest-bound saved
observation, checks the proposed action without publishing it, and emits a
controller trace rather than a task result. The independent evaluation adapter
is the only source of `task_result` and may call the configured OpenAI or Codex
model provider. After control release and recorder completion, the runner
verifies the invocation identity and every entry in `sha256.txt`, delegates
stream-coverage adjudication to the existing episode finalizer, and only then
calls the existing four-view evidence preparation and multimodal evaluator.
Controller `aborted`/`abstained` facts and incomplete capture retain priority
over optimistic visual output.

## Run manifest v2

```json
{
  "schema_version": 2,
  "run_id": "RUN-001",
  "invocation_id": "INVOCATION-001",
  "execution_mode": "zero-write",
  "candidate": {
    "candidate_id": "candidate-v001",
    "package_path": "/absolute/path/candidate-package.json",
    "package_sha256": "<sha256>",
    "observation": {
      "path": "/absolute/path/saved-observation.json",
      "sha256": "<sha256>"
    }
  },
  "task_contract_version": "yellow-button-contact-v001",
  "evaluator_version": "offline-deterministic-v001",
  "evaluator": {
    "config_path": "/absolute/path/evaluator.json",
    "config_sha256": "<sha256>",
    "prompt_sha256": "<sha256 of adjacent prompt.md>"
  },
  "standard_start_version": "g1-evaluator-v001",
  "safety_config": {
    "path": "/absolute/path/safety.json",
    "sha256": "<sha256>"
  },
  "maximum_duration_s": 30,
  "budget_reference": "offline-budget-001",
  "budget_artifact": {
    "path": "/absolute/path/budget.json",
    "sha256": "<sha256>"
  },
  "rollback_candidate_id": "candidate-v000",
  "output_root": "/absolute/path/invocation-runs",
  "recorder": {
    "post_roll_s": 1.0,
    "minimum_camera_frames": 30,
    "minimum_state_samples": 30
  }
}
```

Relative run-manifest paths are resolved from the manifest directory. A
candidate package is versioned JSON and binds its source version, implementation
or model, candidate-specific configuration, input preprocessing, action
definition, and runtime callables:

```json
{
  "schema_version": 1,
  "candidate_id": "candidate-v001",
  "source_version": "git:0123456789abcdef",
  "artifacts": {
    "implementation": {
      "path": "candidate.py",
      "sha256": "<sha256>"
    },
    "configuration": {
      "path": "candidate-config.json",
      "sha256": "<sha256>"
    },
    "input_preprocessor": {
      "path": "preprocess.py",
      "sha256": "<sha256>"
    },
    "action_definition": {
      "path": "action-definition.json",
      "sha256": "<sha256>"
    }
  },
  "runtime": {
    "kind": "python-callable-v1",
    "preprocess": {
      "artifact": "input_preprocessor",
      "callable": "preprocess"
    },
    "inference": {
      "artifact": "implementation",
      "callable": "infer"
    }
  }
}
```

Artifact paths in the candidate package are resolved from the package
directory. The package may additionally bind a `model` artifact; the public
contract does not depend on a VLA, behavior-cloning, reinforcement-learning, or
other framework. `preprocess(observation, configuration)` returns the real model
input, and `infer(model_input, configuration)` returns one proposed command:

```json
{
  "action_definition_id": "g1-arm-position-v001",
  "timestamp_ns": 1000000000,
  "joint_names": ["..."],
  "values": [0.0],
  "command_publishers_created": 0,
  "writes": 0
}
```

The action definition freezes the command type, joint names and order, value
dimension, and maximum allowed output age. Admission rejects incompatible
action definitions, wrong dimensions, non-finite values, stale timestamps,
wrong joint order, nonzero publisher counts, and nonzero writes. Any candidate
success claim is retained only under `ignored_candidate_claims`; it never enters
the task-result field.

The versioned budget artifact binds the zero-write limits and frozen contracts:

```json
{
  "schema_version": 1,
  "physical_rollout_budget": 0,
  "robot_runtime_budget_s": 0,
  "frozen_contracts_sha256": "<sha256>",
  "global_stop_reasons": ["zero_write_validation_complete"]
}
```

## Outputs

A successful run atomically publishes `<output_root>/<run_id>/` with:

- the accepted manifest;
- an append-only `lifecycle.jsonl` journal;
- candidate, control-release, recorder and evaluation artifacts;
- immutable copies of every candidate artifact and the saved observation;
- a candidate replay result binding the candidate-package, observation,
  preprocessed-input, and output digests plus validation diagnostics;
- the finalized invocation evidence and its completeness report;
- the frozen evaluator configuration and adjacent `prompt.md`;
- chronological four-view panels with their source-frame manifest;
- the model's original structured assessment, kept separate from human audit;
- an append-only audit of all five runner adapters, including the evaluator
  boundary;
- complete invocation evidence from the recorder;
- exactly one `terminal-report.json` containing artifact digests and the final
  zero-write disposition.

If evidence identity or integrity fails, evaluation is not invoked. If the
model provider is unavailable or evaluation fails, the terminal report records
the explicit failure reason with `task_result: null`; it does not manufacture a
five-state result. A successful evaluation adds a compact `evaluation` summary
to the terminal report while retaining digest-addressed references to the
configuration, prompt, prepared evidence manifest, and original model result.

Run and invocation identities are append-only. Existing final or partial run
directories and previously claimed invocation identities are rejected before
the recorder starts. Once identity authority has been acquired, any later
failure atomically publishes the run directory with its last completed stage
and exactly one failure terminal report instead of leaving an ambiguous partial
run.

An invalid candidate output produces a `deployment_defect` terminal report with
no `task_result`. It records zero physical rollout attempts and zero robot
runtime consumption, releases invocation authority, and stops before independent
task evaluation.

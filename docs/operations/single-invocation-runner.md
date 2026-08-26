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
→ evidence completion
→ controlled evaluation
→ reset disposition
→ terminal report
```

Only `zero-write` is accepted. Five deterministic subprocess adapters implement
readiness, candidate processing, control release, evaluation, and reset
disposition. They are offline, create no command publisher, and perform no
robot write. The candidate adapter reads only the digest-bound candidate JSON;
the package cannot name or execute an arbitrary entrypoint and cannot supply a
task result. The evaluation adapter binds its result to the complete evidence
manifest and returns structured visual facts plus `indeterminate`, because an
offline zero-write run does not establish physical task success.

## Run manifest v1

```json
{
  "schema_version": 1,
  "run_id": "RUN-001",
  "invocation_id": "INVOCATION-001",
  "execution_mode": "zero-write",
  "candidate": {
    "candidate_id": "candidate-v001",
    "package_path": "/absolute/path/candidate-package.json",
    "package_sha256": "<sha256>"
  },
  "task_contract_version": "yellow-button-contact-v001",
  "evaluator_version": "offline-deterministic-v001",
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

Relative artifact paths are resolved from the manifest directory. A candidate
package is also versioned JSON:

```json
{
  "schema_version": 1,
  "candidate_id": "candidate-v001",
  "deployment_evidence": {
    "preprocessing": "offline-deterministic",
    "output_shape": [26]
  }
}
```

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
- an append-only audit of all five offline adapters;
- complete invocation evidence from the recorder;
- exactly one `terminal-report.json` containing artifact digests and the final
  zero-write disposition.

Run and invocation identities are append-only. Existing final or partial run
directories and previously claimed invocation identities are rejected before
the recorder starts. Once identity authority has been acquired, any later
failure atomically publishes the run directory with its last completed stage
and exactly one failure terminal report instead of leaving an ambiguous partial
run.

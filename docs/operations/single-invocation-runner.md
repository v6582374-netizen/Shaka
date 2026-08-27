# Single-invocation runner

`scripts/run_single_invocation.py` runs a zero-write invocation path from one
immutable JSON manifest. Offline replay is the default; a separately configured
connected-G1 path is available for the final physical admission gate:

```bash
python scripts/run_single_invocation.py --manifest /path/to/run-manifest.json
```

## Connected-G1 zero-write acceptance

Run this only after the offline candidate admission, evaluator configuration,
and recorder lifecycle checks have passed. It starts DDS readers and ZeroMQ
subscribers only. It never creates a G1 or BrainCo command publisher, sends an
actuator command, moves the robot, or requests automatic reset.

The immutable manifest must add this exact shape. `command_topics` must list
every actuator-command topic owned by the unique robot-control entry point for
this deployment; the placeholder below is not a safe default for another G1
installation.

```json
{
  "connected_g1": {
    "schema_version": 1,
    "network_interface": "enp0s31f6",
    "camera_host": "192.168.123.164",
    "discovery_timeout_s": 8.0,
    "command_topics": ["rt/lowcmd"],
    "native_motion_controller_topology": true
  }
}
```

For G1's native controller, set `native_motion_controller_topology` to `true`
instead of copying a participant UUID. The controller receives a fresh DDS UUID
after a restart; the readiness check therefore requires exactly one
`rt/lowcmd` publisher whose participant also publishes `rt/sportmodestate` and
owns the robot-side `rt/arm_sdk` subscription. A second `rt/lowcmd` publisher,
or a broken three-way relationship, rejects the run. This mode only supports
the protected topic `rt/lowcmd` and cannot be combined with a static UUID.

`allowed_command_publishers` remains available for a deployment with a
separately managed, stable control entry. It may contain only one DDS
participant UUID; every observed publisher on a protected topic that is not
listed there rejects the run.

Before issuing the command, an operator must confirm that the G1, both BrainCo
hands, three physical camera streams (the head stream supplies two logical
views), network interface, emergency stop, fixed device pose, and standard
manipulator start state are ready. Stop every command publisher other than the
manifest-bound unique control entry. The command refuses to proceed if it
discovers an unbound publisher on a protected topic.

```bash
PYTHONPATH=/home/loongge/TWIST2-master/unitree_sdk2/python_binding/build-py310/lib \
  /home/loongge/miniconda3/envs/lerobot/bin/python \
  scripts/run_single_invocation.py \
  --manifest /absolute/path/to/connected-g1-run-manifest.json \
  --connected-g1
```

The connected readiness adapter first discovers and validates one G1 state
sample and one sample from each BrainCo hand, receives and validates a frame
from every physical camera source, then checks the configured command topics
for active publishers. The recorder repeats the source checks and, once it reports
`read_only_recorder_ready`, atomically writes `live-observation.json`. That
snapshot contains the current G1 state, both BrainCo states, byte-exact JPEG
payloads from three physical cameras, and the four logical-view mapping. The
candidate's normal sandboxed preprocessing and inference then consume this
snapshot rather than the saved offline observation. The terminal report labels
the two roles separately as `candidate_input_observation` and
`saved_candidate_observation`.

The terminal report is published at
`<output_root>/<run_id>/terminal-report.json`. Confirm all of the following
before treating the gate as passed:

- `environment` is `connected-g1`;
- `command_publishers_created` and `writes` are both `0` in the terminal
  report and every adapter artifact;
- `readiness-result.json` reports three physical sources, four logical views,
  and `competing_command_publishers: 0`;
- `live_observation`, `candidate_input_observation`,
  `saved_candidate_observation`, and `invocation_evidence` appear in
  `artifacts` with SHA-256 values;
- evidence finalization and the multimodal assessment exist. A natural
  zero-write capture may correctly conclude `indeterminate`.

On any failed readiness, recorder handshake, candidate admission, evidence, or
evaluation stage, preserve the published terminal report and its partial
diagnostic artifacts. Do not retry with a robot action, enable a publisher, or
perform automatic reset. Attach the resulting report path, evidence-manifest
digest, and operator's independent conclusion to Issue #26; do not close or
alter parent Issue #20.

After the operator has checked the raw panels and report, post the exact run
record without closing either issue:

```bash
REPORT=/absolute/output-root/RUN-ID/terminal-report.json
EVIDENCE=/absolute/output-root/RUN-ID/evidence/INVOCATION-ID/sha256.txt
gh issue comment 26 --repo v6582374-netizen/Shaka --body \
  "Connected-G1 zero-write acceptance: $(jq -r .terminal_reason "$REPORT");
terminal report: $REPORT ($(sha256sum "$REPORT" | cut -d' ' -f1));
evidence manifest: $EVIDENCE ($(sha256sum "$EVIDENCE" | cut -d' ' -f1));
operator conclusion: <succeeded|failed|indeterminate|aborted|abstained and rationale>."
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
performs a robot write. Candidate preprocessing and inference execute in two
fresh `bubblewrap-zero-write-v1` sandboxes. Each exposes only a read-only
interpreter/runtime, worker, and candidate replay bundle; host `/tmp`, `/run`,
home directories, evaluator artifacts, network, IPC, process namespace,
capabilities, and host devices are unavailable. The trusted adapter recomputes
the preprocessed-input and output digests from each sandbox payload and exposes
no command-publisher or action-write capability; its zero counts are
authoritative. A nested supervisor keeps the runner's public result channel and
private result pipe out of the candidate process; only the supervisor emits the
stage result consumed by the adapter. Candidate-reported counts remain
diagnostics and a nonzero declaration rejects admission. Candidate entrypoint
modules contain only non-executing definitions, so import-time code cannot
impersonate a replay stage. Candidate replay checks the proposed action without
publishing it and emits a controller trace rather than a task result. The host must provide
`bwrap`; its absence rejects the manifest before invocation authority or the
recorder starts. The independent evaluation adapter is the only source of
`task_result` and may call the configured OpenAI or Codex model provider. After
control release and recorder completion, the runner
verifies the invocation identity and every entry in `sha256.txt`, delegates
stream-coverage adjudication to the existing episode finalizer, and only then
calls the existing four-view evidence preparation and multimodal evaluator.
Controller `aborted`/`abstained` facts and incomplete capture retain priority
over optimistic visual output.

Evaluator configuration and its adjacent frozen prompt must not be placed in a
candidate-visible interpreter or system-library runtime path; the runner rejects
such manifests before recorder startup.

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

The digest-bound safety configuration provides the trusted control-entry
contract independently of the candidate:

```json
{
  "schema_version": 1,
  "mode": "zero-write",
  "control_contract": {
    "action_definition_id": "g1-arm-position-v001",
    "command_type": "joint_position",
    "joint_names": ["..."],
    "value_dimension": 1,
    "maximum_output_age_ns": 100000000
  }
}
```

Candidate action definitions must match every control field in this contract,
and both runtime entrypoints must be top-level two-argument functions with no
import-time code before the lifecycle begins.

The action definition freezes the command type, joint names and order, value
dimension, and maximum allowed output age. Admission rejects incompatible
action definitions, wrong dimensions, non-finite values, stale or future
timestamps, wrong joint order, nonzero publisher declarations, and nonzero write
declarations. Preprocessed values use canonical JSON when possible and a binary
evidence fallback otherwise; non-JSON candidate outputs are rejected with their
evidence digest retained. Any candidate success claim is retained only under
`ignored_candidate_claims`; it never enters the task-result field.

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

## UniFoLM-VLA zero-write candidate

`configs/unifolm-vla-brainco26-v001/candidate-package.json` defines the fixed
25×26 BrainCo26 candidate. When it is bound into a connected-G1 zero-write
manifest, the runner captures the recorder's current observation before
candidate execution and invokes only the repository's fixed
`run_unifolm_vla_zero_write_preflight.py` in the UniFoLM environment. Its
immutable plan is retained as `artifacts/action-plan.json` alongside the
controller trace. This path creates no DDS command publisher and cannot be
used for physical execution; a write-enabled canary remains a separately
authorized lifecycle extension.

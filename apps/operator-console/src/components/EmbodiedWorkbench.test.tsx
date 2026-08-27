import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  EmbodiedAttempt,
  EmbodiedEnvironment,
  EmbodiedRun,
  EmbodiedStageReport,
} from "../api";

vi.mock("../api", () => ({
  getEmbodiedEnvironment: vi.fn(),
  listEmbodiedRuns: vi.fn(),
  getEmbodiedRun: vi.fn(),
  getEmbodiedRunEvents: vi.fn(),
  startEmbodiedRun: vi.fn(),
  cancelEmbodiedRun: vi.fn(),
}));

import {
  cancelEmbodiedRun,
  getEmbodiedEnvironment,
  getEmbodiedRun,
  getEmbodiedRunEvents,
  listEmbodiedRuns,
  startEmbodiedRun,
} from "../api";
import { EmbodiedWorkbench, explainReason } from "./EmbodiedWorkbench";

/* ---------------------------------------------------------------- fixtures

   Shaped exactly like the sidecar's payloads, because the whole contract of this surface is that
   it shows nothing it was not given. A fixture that invented a field would hide a missing one. */

const environment = (over: Partial<EmbodiedEnvironment> = {}): EmbodiedEnvironment => ({
  environment_id: "sim-g1-left-arm",
  simulator: { available: true, detail: "mujoco 3.2.7", scene_path: "/scenes/g1.xml", reason: null },
  control_frequency_hz: 50,
  joints: ["left_shoulder_pitch_joint", "left_shoulder_roll_joint"],
  joint_count: 2,
  goal_offsets_rad: [0, 0.35],
  candidate_rates_rps: [0.15, 0.3, 0.6],
  velocity_margin: 0.8,
  velocity_budget_rps: 1.2,
  envelope: {
    max_duration_s: 20,
    max_joint_velocity_rps: 1.5,
    max_end_effector_force_n: 20,
    max_observation_age_s: 0.2,
    workspace_bounds_m: [
      [-1, 1],
      [-1, 1],
      [0, 2],
    ],
  },
  skill: {
    skill_id: "raise_left_shoulder",
    revision: 1,
    version_id: "raise_left_shoulder@1",
    kind: "deterministic",
    summary: "抬起左肩滚关节到已评审的姿态。",
    preconditions: ["workspace_clear", "guardian_present", "estop_reachable"],
    postconditions: ["at_reviewed_pose"],
    abort_conditions: ["force_exceeded", "human_stop"],
    max_duration_s: 10,
    reviewed_by: "loongge",
  },
  ladder: [
    { stage: "policy_evaluation", simulated: true },
    { stage: "offline_replay", simulated: true },
    { stage: "shadow_mode", simulated: false },
    { stage: "hardware_supervised", simulated: false },
  ],
  minimum_stage_attempts: 10,
  minimum_stage_success_rate: 0.9,
  approval_validity_hours: 8,
  stage_offsets_rad: { policy_evaluation: 0.01, offline_replay: 0.05 },
  unrepresentable: [
    "room facts: whether a guardian is present, the estop is reachable, and the workspace is clear are declared by an operator, never measured",
  ],
  camera_slots: [{ id: "head", label: "头部（双目拼接）", width: 1280, height: 480, port: 60001 }],
  ...over,
});

const attempt = (index: number, over: Partial<EmbodiedAttempt> = {}): EmbodiedAttempt => ({
  index,
  run_id: `sim-g1-left-arm-policy_evaluation-${String(index).padStart(3, "0")}`,
  outcome: "succeeded",
  variation_digest: `v${index}`,
  findings: [],
  abort_cause: null,
  ...over,
});

const stage = (over: Partial<EmbodiedStageReport> = {}): EmbodiedStageReport => ({
  campaign_id: "sim-g1-left-arm-policy_evaluation",
  stage: "policy_evaluation",
  scope: ["raise_left_shoulder@1", "e1a2e469f21c000f", null],
  planned_attempts: 10,
  executed_attempts: 10,
  successes: 10,
  completed: true,
  attempts: Array.from({ length: 10 }, (_, i) => attempt(i)),
  evidence: {
    stage: "policy_evaluation",
    attempts: 10,
    successes: 10,
    safety_violations: 0,
    recorded_at: "2026-08-15T02:00:00Z",
    notes: "",
    success_rate: 1,
    skill_version_id: "raise_left_shoulder@1",
    embodiment_digest: "e1a2e469f21c000f",
    policy_digest: null,
  },
  fidelity: {
    verdict: "represents",
    environment_id: "sim-g1-left-arm",
    environment_digest: "d1",
    embodiment_digest: "e1a2e469f21c000f",
    findings: [],
    unrepresented: [],
    represents: true,
  },
  halted: "completed",
  halt_detail: "ran all 10 planned attempts",
  next_stage: "offline_replay",
  next_stage_admitted: true,
  next_stage_blocking_reasons: [],
  ...over,
});

const run = (over: Partial<EmbodiedRun> = {}): EmbodiedRun => ({
  run_id: "run-nominal",
  state: "done",
  created_at: "2026-08-15T02:00:00Z",
  started_at: "2026-08-15T02:00:01Z",
  finished_at: "2026-08-15T02:00:02Z",
  request: {
    declared_supervision: {
      guardian_present: true,
      estop_engaged: false,
      estop_reachable: true,
      workspace_clear: true,
    },
    attempts_per_stage: 10,
    control_frequency_hz: 50,
    watch: false,
  },
  environment_id: "sim-g1-left-arm",
  skill_version_id: "raise_left_shoulder@1",
  embodiment_digest: "e1a2e469f21c000f",
  halted: "completed",
  halt_detail: "every simulated stage ran its full plan and opened the next",
  completed: true,
  // bench.py :: BenchReport.blocking_hardware returns hardware_decision.blocking_reasons verbatim,
  // so a run that completed every simulated stage still carries what hardware is waiting on.
  blocking_hardware: ["stage shadow_mode has no evidence for this configuration"],
  calibration: {
    measured_on: "sim-g1-left-arm",
    control_frequency_hz: 50,
    velocity_limit_rps: 1.5,
    margin: 0.8,
    budget_rps: 1.2,
    measurements: [
      {
        commanded_rate_rps: 0.15,
        peak_joint_velocity_rps: 0.123,
        tracking_error_rad: 0.007,
        settled_error_rad: 0.0031,
        overshoot_ratio: 0.82,
        max_step_rad: 0.003,
        max_lead_rad: 0.004,
        minimum_goal_tolerance_rad: 0.0062,
        fits: true,
      },
    ],
    admitted: {
      commanded_rate_rps: 0.15,
      peak_joint_velocity_rps: 0.123,
      tracking_error_rad: 0.007,
      settled_error_rad: 0.0031,
      overshoot_ratio: 0.82,
      max_step_rad: 0.003,
      max_lead_rad: 0.004,
      minimum_goal_tolerance_rad: 0.0062,
      fits: true,
    },
    findings: [],
  },
  goal: {
    skill_version_id: "raise_left_shoulder@1",
    target_joint_positions_rad: [0.2, 0.55],
    satisfies: ["at_reviewed_pose"],
    tolerance_rad: 0.02,
  },
  required_duration_s: 2.33,
  stages: [stage()],
  hardware_decision: {
    target_stage: "hardware_supervised",
    admitted: false,
    evidence_digest: "abc123",
    blocking_reasons: ["stage shadow_mode has no evidence for this configuration"],
  },
  error: null,
  preview: { watching: false, host: null, camera_slots: [] },
  ...over,
});

const QUARANTINE =
  "run 'sim-g1-left-arm-policy_evaluation-003' aborted with cause 'human_stop' and has no recorded human clearance";

const refusedRun = (): EmbodiedRun =>
  run({
    run_id: "run-estop",
    halted: "stage_incomplete",
    halt_detail: "stage policy_evaluation stopped after 4 of 10 attempts: " + QUARANTINE,
    completed: false,
    blocking_hardware: [QUARANTINE, "stage shadow_mode has no evidence for this configuration"],
    created_at: "2026-08-15T03:00:00Z",
    stages: [
      stage({
        executed_attempts: 4,
        successes: 3,
        completed: false,
        attempts: [
          attempt(0),
          attempt(1),
          attempt(2),
          attempt(3, { outcome: "aborted", abort_cause: "human_stop", findings: [QUARANTINE] }),
        ],
        halted: "aborted",
        halt_detail: QUARANTINE,
        next_stage_admitted: false,
        next_stage_blocking_reasons: [QUARANTINE],
      }),
    ],
  });

const mocked = {
  env: vi.mocked(getEmbodiedEnvironment),
  list: vi.mocked(listEmbodiedRuns),
  get: vi.mocked(getEmbodiedRun),
  events: vi.mocked(getEmbodiedRunEvents),
  start: vi.mocked(startEmbodiedRun),
  cancel: vi.mocked(cancelEmbodiedRun),
};

const arrange = (env: EmbodiedEnvironment, runs: EmbodiedRun[]) => {
  mocked.env.mockResolvedValue(env);
  mocked.list.mockResolvedValue({ runs });
  mocked.events.mockResolvedValue({ events: [], latest_sequence: 0 });
  mocked.get.mockImplementation(async (id: string) => runs.find((item) => item.run_id === id) ?? runs[0]);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("explainReason", () => {
  it("translates the reasons it knows and passes anything else through untouched", () => {
    expect(explainReason(QUARANTINE).zh).toContain("隔离");
    expect(explainReason("stage shadow_mode has no evidence for this configuration").zh).toContain("影子模式");
    // The fall-through is the safety property: an unknown refusal is never swallowed.
    expect(explainReason("something the bench said that this surface has never seen").zh).toBeNull();
  });
});

describe("EmbodiedWorkbench", () => {
  it("moves from loading to the environment it was given", async () => {
    arrange(environment(), []);
    render(<EmbodiedWorkbench />);

    expect(screen.getByTestId("embodied-loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("embodied-start")).toBeTruthy());
    expect(screen.queryByTestId("embodied-loading")).toBeNull();
    // Thresholds are the server's, not the surface's.
    expect(screen.getByText(/每级 ≥10 次 · ≥90%/)).toBeTruthy();
    expect(screen.getByText(/预算 1\.200 rad\/s = 上限 × 0\.8/)).toBeTruthy();
  });

  it("shows a refusal's raw backend reason beside its translation", async () => {
    arrange(environment(), [refusedRun()]);
    render(<EmbodiedWorkbench />);

    const blocking = await screen.findByTestId("embodied-blocking");
    // The verbatim module string is always present, so a mistranslation cannot hide the original.
    expect(within(blocking).getByText(QUARANTINE)).toBeTruthy();
    expect(within(blocking).getByText(/该配置已被隔离/)).toBeTruthy();
    expect(screen.getByTestId("embodied-halt").textContent).toContain("阶段没跑完就停了");
  });

  it("marks the rung that ran but did not open the next stage", async () => {
    arrange(
      environment(),
      [
        run({
          run_id: "run-thin",
          halted: "stage_did_not_open_the_next",
          halt_detail: "stage policy_evaluation ran to completion but did not open offline_replay",
          completed: false,
          blocking_hardware: ["stage policy_evaluation has 4 attempts, below the required 10"],
          stages: [
            stage({
              planned_attempts: 4,
              executed_attempts: 4,
              successes: 4,
              next_stage_admitted: false,
              next_stage_blocking_reasons: ["stage policy_evaluation has 4 attempts, below the required 10"],
            }),
          ],
        }),
      ],
    );
    render(<EmbodiedWorkbench />);

    const ladder = await screen.findByRole("list", { name: "准入阶梯" });
    expect(within(ladder).getByText(/4\/4 未打开/)).toBeTruthy();
    // The two rungs a simulation can never earn stay visible and stay closed.
    expect(within(ladder).getAllByText("仿真无法达成")).toHaveLength(2);
    expect(screen.getByTestId("embodied-blocking").textContent).toContain(
      "stage policy_evaluation has 4 attempts, below the required 10",
    );
  });

  it("refuses to offer a run when the simulator is unavailable, and still reads past evidence", async () => {
    arrange(
      environment({
        simulator: {
          available: false,
          detail: "",
          scene_path: null,
          reason: "mujoco is not installed in this interpreter",
        },
      }),
      [refusedRun()],
    );
    render(<EmbodiedWorkbench />);

    const notice = await screen.findByTestId("embodied-simulator-unavailable");
    expect(within(notice).getByText("mujoco is not installed in this interpreter")).toBeTruthy();
    expect(screen.getByTestId("embodied-start")).toHaveProperty("disabled", true);
    expect(mocked.start).not.toHaveBeenCalled();
    // Evidence outlives the simulator that produced it.
    expect(screen.getByTestId("embodied-blocking")).toBeTruthy();
  });

  it("selects a past run from the history and re-reads its verdict", async () => {
    const runs = [refusedRun(), run()];
    arrange(environment(), runs);
    render(<EmbodiedWorkbench />);

    const list = await screen.findByTestId("embodied-run-list");
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("embodied-halt").textContent).toContain("阶段没跑完就停了");

    fireEvent.click(buttons[1]);

    await waitFor(() =>
      expect(screen.getByTestId("embodied-halt").textContent).toContain("两级仿真都跑满了计划"),
    );
    expect(within(list).getAllByRole("button")[1].getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("embodied-admitted-rate").textContent).toContain("0.15 rad/s");
    // A finished run's blocking list is still the loudest thing about it.
    expect(screen.getByText("stage shadow_mode has no evidence for this configuration")).toBeTruthy();
  });

  it("declaring no guardian is offered, and says the bench will refuse it", async () => {
    arrange(environment(), []);
    mocked.start.mockResolvedValue({
      run: run({ run_id: "run-refused", state: "queued", halted: null, halt_detail: "" }),
    });
    render(<EmbodiedWorkbench />);

    const guardian = await screen.findByRole("switch", { name: /有人监护/ });
    expect(guardian.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(guardian);

    expect(guardian.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("embodied-will-refuse").textContent).toContain("SafetySupervisor");

    // The API deliberately accepts the declaration; the refusal it produces is real evidence.
    fireEvent.click(screen.getByTestId("embodied-start"));
    await waitFor(() => expect(mocked.start).toHaveBeenCalledTimes(1));
    expect(mocked.start.mock.calls[0][0].declared_supervision.guardian_present).toBe(false);
  });

  it("surfaces the unauthenticated-camera fact next to the watch control", async () => {
    arrange(environment(), []);
    render(<EmbodiedWorkbench />);

    const watch = await screen.findByRole("switch", { name: /边跑边看/ });
    expect(watch.getAttribute("aria-checked")).toBe("false");

    // The security fact must be reachable from the control itself, not merely somewhere on screen.
    const group = watch.parentElement as HTMLElement;
    expect(within(group).getByText(/无鉴权/)).toBeTruthy();
    expect(within(group).getByText(/自签证书/)).toBeTruthy();
    // The video lives in the existing Camera module; this surface points at it instead of
    // duplicating the WebRTC client.
    expect(within(group).getByText(/Camera/)).toBeTruthy();
  });

  it("offers cancel only while a run is in flight", async () => {
    const active = run({ run_id: "run-live", state: "running", halted: null, halt_detail: "", completed: false });
    arrange(environment(), [active]);
    mocked.cancel.mockResolvedValue(run({ run_id: "run-live", state: "cancelled", halted: null }));
    render(<EmbodiedWorkbench />);

    const cancelButton = await screen.findByRole("button", { name: "取消" });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(mocked.cancel).toHaveBeenCalledWith("run-live"));
  });
});

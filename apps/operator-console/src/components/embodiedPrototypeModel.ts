// PROTOTYPE ONLY — shared model for the Embodied Execution prototype.
//
// Every constant here is copied from the real Python profile in `vegapunk/embodied/`, and the
// calibration numbers are the ones `scripts/run_embodied_bench.py` actually measured on the
// MuJoCo G1 scene. That is the whole point: this surface must not be able to show a number the
// backend cannot produce, or a refusal the backend would not issue.
//
//   ladder stages + thresholds   admission.py  (ADMISSION_STAGE_ORDER, MINIMUM_STAGE_*)
//   halt reasons                 bench.py      (HALTED_*)
//   refusal wording              admission.py / trajectory.py / bench.py
//   unrepresentable facts        fidelity.py   (UNREPRESENTABLE_IN_SIMULATION)
//   camera slots                 simulation.py (CAMERA_SLOTS)
//
// Nothing here talks to the backend. The run is simulated in the browser so the prototype can be
// driven without MuJoCo, and so a refusal can be provoked on demand — which is the one thing a
// screenshot of a passing run can never show.

import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ the ladder */

export type StageKey = "policy_evaluation" | "offline_replay" | "shadow_mode" | "hardware_supervised";

export type StageDef = {
  key: StageKey;
  /** What a person would call it. */
  label: string;
  /** The question this rung answers, in one line. */
  question: string;
  /** Whether a simulation may earn it at all. */
  simulated: boolean;
  /** Why it cannot be simulated, for the two rungs that cannot. */
  whyNotSimulated?: string;
};

/** admission.py :: ADMISSION_STAGE_ORDER, in order. The order is the whole mechanism. */
export const LADDER: StageDef[] = [
  {
    key: "policy_evaluation",
    label: "控制器评估",
    question: "这个控制器到底能不能干成这件事？",
    simulated: true,
  },
  {
    key: "offline_replay",
    label: "离线重放",
    question: "部署时的初始条件波动，它能不能吸收？",
    simulated: true,
  },
  {
    key: "shadow_mode",
    label: "影子模式",
    question: "真机在旁边、但不听它指令时，它的判断对不对？",
    simulated: false,
    whyNotSimulated:
      "按构造无法仿真：它回放真实观测，旁边站着一台不受它指令的真机。需要先有硬件适配器。",
  },
  {
    key: "hardware_supervised",
    label: "监督下真机执行",
    question: "可以让人站在会动的机器人旁边了吗？",
    simulated: false,
    whyNotSimulated: "需要一份钉在当前证据摘要上的人类批准，且 8 小时后过期。",
  },
];

/** admission.py :: MINIMUM_STAGE_ATTEMPTS / MINIMUM_STAGE_SUCCESS_RATE / APPROVAL_VALIDITY */
export const MINIMUM_STAGE_ATTEMPTS = 10;
export const MINIMUM_STAGE_SUCCESS_RATE = 0.9;
export const APPROVAL_VALIDITY_HOURS = 8;

/** bench.py :: DEFAULT_NOMINAL_OFFSET_RAD / DEFAULT_DEPLOYMENT_OFFSET_RAD */
export const STAGE_OFFSET_RAD: Record<string, number> = {
  policy_evaluation: 0.01,
  offline_replay: 0.05,
};

/** fidelity.py :: UNREPRESENTABLE_IN_SIMULATION — stated unconditionally, never assessed. */
export const UNREPRESENTABLE = [
  { title: "房间事实", body: "有人监护、急停可达、工作区清空，全部由操作者声明，从不测量。" },
  { title: "接触现实", body: "材质、负载质量、夹具摩擦、关节摩擦，是场景作者的近似，不是这间实验室的。" },
  { title: "感知现实", body: "渲染帧不是这个房间的照片，所以策略的视觉鲁棒性在这里未被检验。" },
  { title: "硬件现实", body: "作动器磨损、延迟、丢包、热限制，模型里都不存在。" },
];

/* ------------------------------------------------------------------ the configuration */

/** simulation.py :: G1_LEFT_ARM_JOINTS */
export const JOINTS = [
  "left_shoulder_pitch_joint",
  "left_shoulder_roll_joint",
  "left_shoulder_yaw_joint",
  "left_elbow_joint",
  "left_wrist_roll_joint",
  "left_wrist_pitch_joint",
  "left_wrist_yaw_joint",
];

export const JOINT_SHORT = ["肩俯", "肩滚", "肩偏", "肘", "腕滚", "腕俯", "腕偏"];

/** scripts/run_embodied_bench.py :: GOAL_OFFSETS_RAD — raise the shoulder roll, nothing else. */
export const GOAL_OFFSETS_RAD = [0, 0.35, 0, 0, 0, 0, 0];

/** simulation.py :: stand keyframe, as measured off the compiled model. */
export const STAND_RAD = [0.2, 0.2, 0.0, 1.28, 0.0, 0.0, 0.0];

/** simulation.py :: CAMERA_SLOTS — fixed ports, because the GUI hard-codes them. */
export const CAMERA_SLOTS = [
  { id: "head", label: "头部（双目拼接）", width: 1280, height: 480, port: 60001 },
  { id: "leftWrist", label: "左腕", width: 640, height: 480, port: 60002 },
  { id: "rightWrist", label: "右腕", width: 640, height: 480, port: 60003 },
];

export const SCOPE = {
  environmentId: "sim-g1-left-arm",
  skillVersionId: "raise_left_shoulder@1",
  /** The digest the real bench produced. It differs from any physical G1's, by design. */
  embodimentDigest: "e1a2e469f21c000f",
  policyDigest: null as string | null,
  endEffector: "dex1_1",
  controlAuthority: "arm_and_gripper",
  controlHz: 50,
};

/** safety.py :: SafetyEnvelope, as declared by scripts/run_embodied_bench.py. */
export const ENVELOPE = {
  maxDurationS: 20,
  maxJointVelocityRps: 1.5,
  maxForceN: 20,
  maxObservationAgeS: 0.2,
  workspace: [
    [-1, 1],
    [-1, 1],
    [0, 2],
  ] as Array<[number, number]>,
};

/** calibration.py :: DEFAULT_VELOCITY_MARGIN */
export const VELOCITY_MARGIN = 0.8;
export const VELOCITY_BUDGET_RPS = ENVELOPE.maxJointVelocityRps * VELOCITY_MARGIN;

/* ------------------------------------------------------------------ scenarios */

/**
 * Each scenario provokes one specific outcome. The refusals matter more than the success: a
 * governance skeleton is only worth anything if you can watch it say no, and each of these is a
 * refusal the real bench issues today.
 */
export type ScenarioKey = "nominal" | "overshoot" | "tooSlow" | "estop" | "unverified";

export type ScenarioDef = {
  key: ScenarioKey;
  label: string;
  /** What the operator changed. */
  premise: string;
  /** What it is meant to teach. */
  teaches: string;
  tone: "ok" | "warn" | "stop";
};

export const SCENARIOS: ScenarioDef[] = [
  {
    key: "nominal",
    label: "标定并跑满两级",
    premise: "候选速率 0.15 / 0.3 / 0.6 rad/s，目标为抬起左肩滚 0.35 rad。",
    teaches: "两个仿真阶段各跑满 10 次并全部成功，然后阶梯依然拒绝真机。",
    tone: "ok",
  },
  {
    key: "overshoot",
    label: "伺服冲过头",
    premise: "同样的候选速率，但这台构型的伺服增益高得多。",
    teaches: "峰值速度全部超出预算，系统拒绝下发任何一个没被探测过的速率。",
    tone: "stop",
  },
  {
    key: "tooSlow",
    label: "目标飞不完",
    premise: "技能声明最长 0.05 秒，而这段动作需要 0.6 秒。",
    teaches: "在任何东西开始动之前就被拒绝，而不是跑到一半被中止并隔离配置。",
    tone: "stop",
  },
  {
    key: "estop",
    label: "第 4 次有人按急停",
    premise: "第 4 次尝试进行中，操作者按下急停。",
    teaches: "中止即隔离，没有自动重试，后面 6 次不会发生。",
    tone: "warn",
  },
  {
    key: "unverified",
    label: "本体有未验证字段",
    premise: "末端执行器型号还没有人去实测确认。",
    teaches: "缺失信息即不安全：连第一次尝试都不会发生。",
    tone: "stop",
  },
];

/* ------------------------------------------------------------------ run state */

export type Phase = "idle" | "calibrating" | "staging" | "settled";

export type Measurement = {
  commandedRps: number;
  peakRps: number;
  /** Whether the measured peak fit the budget. */
  fits: boolean;
  /** calibration.py reports these from the same probe. */
  trackingErrorRad: number;
  settledErrorRad: number;
};

export type AttemptOutcome = "succeeded" | "failed_verification" | "aborted" | "refused";

export type Attempt = {
  index: number;
  runId: string;
  stage: StageKey;
  /** The seeded perturbation this attempt started from, per joint. */
  offsetsRad: number[];
  outcome: AttemptOutcome;
  /** Peak joint velocity observed during the attempt. */
  peakRps: number;
  durationS: number;
  abortCause: string | null;
  findings: string[];
};

export type StageResult = {
  stage: StageKey;
  planned: number;
  attempts: Attempt[];
  /** trajectory.py counts these, not the campaign. */
  successes: number;
  halted: "completed" | "aborted" | "refused";
  haltDetail: string;
  nextStageAdmitted: boolean;
  blocking: string[];
};

export type HaltReason =
  | "completed"
  | "no_admitted_command_rate"
  | "goal_not_reachable_in_time"
  | "stage_incomplete"
  | "stage_did_not_open_the_next";

export type RunState = {
  scenario: ScenarioKey;
  phase: Phase;
  /** 0..1 across the whole run, for the surfaces that show one number. */
  progress: number;
  measurements: Measurement[];
  admittedRps: number | null;
  goalToleranceRad: number | null;
  requiredDurationS: number | null;
  stages: StageResult[];
  /** The stage currently being iterated, for the live surfaces. */
  liveStage: StageKey | null;
  liveAttempt: Attempt | null;
  /** Commanded vs measured joint positions, so a viewer can see the servo lag. */
  setpointRad: number[];
  measuredRad: number[];
  halted: HaltReason | null;
  haltDetail: string;
  /** What still stands between this configuration and a supervised hardware run. */
  blockingHardware: string[];
  log: LogLine[];
  quarantined: string | null;
};

export type LogLine = {
  t: number;
  kind: "measure" | "attempt" | "refuse" | "abort" | "evidence" | "verdict";
  text: string;
};

export const emptyRun = (scenario: ScenarioKey): RunState => ({
  scenario,
  phase: "idle",
  progress: 0,
  measurements: [],
  admittedRps: null,
  goalToleranceRad: null,
  requiredDurationS: null,
  stages: [],
  liveStage: null,
  liveAttempt: null,
  setpointRad: [...STAND_RAD],
  measuredRad: [...STAND_RAD],
  halted: null,
  haltDetail: "",
  blockingHardware: [],
  log: [],
  quarantined: null,
});

/* ------------------------------------------------------------------ the simulated run */

/** A tiny seeded PRNG, so an attempt's perturbation is reproducible like the real schedule's. */
function seeded(seed: number): () => number {
  let s = seed * 2654435761 + 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function offsetsFor(stage: StageKey, index: number): number[] {
  const bound = STAGE_OFFSET_RAD[stage] ?? 0.01;
  const random = seeded(index + 1 + (stage === "offline_replay" ? 1000 : 0));
  return JOINTS.map(() => (random() * 2 - 1) * bound);
}

/** The overshoot each scenario's servo exhibits. calibration.py measures this; it never assumes. */
const SERVO_GAIN: Record<ScenarioKey, number> = {
  nominal: 1.1,
  overshoot: 2.4,
  tooSlow: 1.1,
  estop: 1.1,
  unverified: 1.1,
};

const CANDIDATE_RATES = [0.15, 0.3, 0.6];

export function measurementsFor(scenario: ScenarioKey): Measurement[] {
  const gain = SERVO_GAIN[scenario];
  return CANDIDATE_RATES.map((rate) => {
    const peak = rate * gain;
    return {
      commandedRps: rate,
      peakRps: peak,
      fits: peak <= VELOCITY_BUDGET_RPS + 1e-9,
      trackingErrorRad: rate / SCOPE.controlHz + 0.004,
      settledErrorRad: 0.0031,
    };
  });
}

export function admittedFrom(measurements: Measurement[]): Measurement | null {
  const fitting = measurements.filter((m) => m.fits);
  return fitting.length ? fitting[fitting.length - 1] : null;
}

/** bench.py :: max(DEFAULT_GOAL_TOLERANCE_RAD, admitted.minimum_goal_tolerance_rad) */
export function toleranceFor(admitted: Measurement): number {
  return Math.max(0.02, admitted.settledErrorRad * 1.5);
}

/** The refusal wording the real modules emit, so the surface cannot soften it. */
export const REFUSALS = {
  unverified:
    "embodiment unverified_fields must be confirmed on hardware: end_effector",
  noRate: (budget: number) =>
    `没有任何候选速率的实测峰值落进速度预算 ${budget.toFixed(3)} rad/s，而本工作台不会下发一个从未被探测过的速率。`,
  infeasible: (needed: number, allowed: number) =>
    `这段动作需要 ${needed.toFixed(2)}s，超过本次运行被允许的 ${allowed.toFixed(2)}s；每次尝试都会在动作中途被中止，而第一次就会隔离该配置。`,
  quarantine: (runId: string) =>
    `run '${runId}' aborted with cause 'human_stop' and has no recorded human clearance`,
  noShadow: "stage shadow_mode has no evidence for this configuration",
  noApproval: "supervised hardware execution requires a human approval",
};

/**
 * The refusal strings above are what the modules literally emit, and several of them are English
 * identifiers by design (they name a stage, a field, a run id). A viewer needs the consequence in
 * their own language, with the module's own wording kept beside it as the citation.
 */
export function explainBlocking(reason: string): { zh: string; src?: string } {
  if (reason.startsWith("embodiment unverified_fields")) {
    return {
      zh: "本体还有未验证字段：末端执行器必须由人在真机上确认，未验证一律按不匹配处理。",
      src: reason,
    };
  }
  if (reason === REFUSALS.noShadow) {
    return {
      zh: "影子模式在这个配置下没有任何证据——它要求真机在旁边跑一遍而不接受指令，因此需要先有硬件适配器。",
      src: reason,
    };
  }
  if (reason === REFUSALS.noApproval) {
    return {
      zh: "监督下真机执行需要一份具名的人类批准，钉在当前证据摘要上，且 8 小时后过期。",
      src: reason,
    };
  }
  const attempts = reason.match(/^stage (\S+) has (\d+) attempts, below the required (\d+)$/);
  if (attempts) {
    return {
      zh: `阶段 ${attempts[1]} 只跑了 ${attempts[2]} 次，不到要求的 ${attempts[3]} 次，样本量不足以支撑放行。`,
      src: reason,
    };
  }
  const rate = reason.match(/^stage (\S+) success rate (\S+) is below the required (\S+)$/);
  if (rate) {
    return {
      zh: `阶段 ${rate[1]} 的成功率 ${rate[2]} 低于要求的 ${rate[3]}，这一级没有被打开。`,
      src: reason,
    };
  }
  if (reason.startsWith("run '")) {
    return {
      zh: "该配置已被隔离：有人按下急停，且没有具名的人清除记录。没有自动重试。",
      src: reason,
    };
  }
  return { zh: reason };
}

/* ------------------------------------------------------------------ driver */

type Emit = (next: (state: RunState) => RunState) => void;

/**
 * Drives one scenario. Deliberately event-shaped rather than a promise: every surface reads the
 * same state, and the whole point is that a viewer sees each refusal land in order.
 */
export function driveRun(scenario: ScenarioKey, speed: number, emit: Emit): () => void {
  let stopped = false;
  const timers: number[] = [];
  const at = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(() => !stopped && fn(), ms / speed));
  };
  const log = (kind: LogLine["kind"], text: string) => (s: RunState) => ({
    ...s,
    log: [...s.log, { t: Date.now(), kind, text }].slice(-200),
  });

  const measurements = measurementsFor(scenario);
  const admitted = admittedFrom(measurements);
  let clock = 0;

  // --- the embodiment gate comes before anything moves.
  if (scenario === "unverified") {
    at((clock += 260), () =>
      emit((s) => ({
        ...log("refuse", REFUSALS.unverified)(s),
        phase: "settled",
        progress: 1,
        halted: "stage_incomplete",
        haltDetail:
          "本体存在未验证字段，所以第一次尝试就被拒绝。缺失信息按不安全处理，而不是按大概没问题处理。",
        blockingHardware: [REFUSALS.unverified, REFUSALS.noShadow, REFUSALS.noApproval],
      })),
    );
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
    };
  }

  emit((s) => ({ ...s, phase: "calibrating", progress: 0.02 }));

  // --- calibration: one probe per candidate rate, slowest first.
  measurements.forEach((m, i) => {
    at((clock += 620), () =>
      emit((s) => ({
        ...log(
          "measure",
          `下发 ${m.commandedRps} rad/s，实测峰值 ${m.peakRps.toFixed(3)} rad/s${
            m.fits ? "" : " —— 超出预算"
          }`,
        )(s),
        measurements: measurements.slice(0, i + 1),
        progress: 0.02 + 0.12 * ((i + 1) / measurements.length),
        setpointRad: STAND_RAD.map((v, j) => v + GOAL_OFFSETS_RAD[j]),
        measuredRad: STAND_RAD.map(
          (v, j) => v + GOAL_OFFSETS_RAD[j] - (GOAL_OFFSETS_RAD[j] ? m.settledErrorRad : 0),
        ),
      })),
    );
  });

  if (!admitted) {
    at((clock += 420), () =>
      emit((s) => ({
        ...log("refuse", REFUSALS.noRate(VELOCITY_BUDGET_RPS))(s),
        phase: "settled",
        progress: 1,
        halted: "no_admitted_command_rate",
        haltDetail: REFUSALS.noRate(VELOCITY_BUDGET_RPS),
        blockingHardware: [
          REFUSALS.noRate(VELOCITY_BUDGET_RPS),
          REFUSALS.noShadow,
          REFUSALS.noApproval,
        ],
        setpointRad: [...STAND_RAD],
        measuredRad: [...STAND_RAD],
      })),
    );
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
    };
  }

  const tolerance = toleranceFor(admitted);
  const requiredDurationS = 0.35 / admitted.commandedRps;
  const allowedDurationS = scenario === "tooSlow" ? 0.05 : 10;

  at((clock += 380), () =>
    emit((s) => ({
      ...log(
        "measure",
        `admitted ${admitted.commandedRps} rad/s · 目标容差 ${tolerance.toFixed(4)} rad（由实测下垂决定）`,
      )(s),
      admittedRps: admitted.commandedRps,
      goalToleranceRad: tolerance,
      requiredDurationS,
      progress: 0.16,
    })),
  );

  if (requiredDurationS > allowedDurationS) {
    at((clock += 420), () =>
      emit((s) => ({
        ...log("refuse", REFUSALS.infeasible(requiredDurationS, allowedDurationS))(s),
        phase: "settled",
        progress: 1,
        halted: "goal_not_reachable_in_time",
        haltDetail: REFUSALS.infeasible(requiredDurationS, allowedDurationS),
        blockingHardware: [
          REFUSALS.infeasible(requiredDurationS, allowedDurationS),
          REFUSALS.noShadow,
          REFUSALS.noApproval,
        ],
      })),
    );
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
    };
  }

  // --- the two simulated rungs, in ladder order.
  const simulated = LADDER.filter((s) => s.simulated);
  let cursor = clock;

  simulated.forEach((stageDef, stageIdx) => {
    const abortAt = scenario === "estop" && stageIdx === 0 ? 4 : -1;
    const planned = MINIMUM_STAGE_ATTEMPTS;
    const attempts: Attempt[] = [];

    at((cursor += 300), () =>
      emit((s) => ({
        ...s,
        phase: "staging",
        liveStage: stageDef.key,
        stages: [
          ...s.stages.filter((x) => x.stage !== stageDef.key),
          {
            stage: stageDef.key,
            planned,
            attempts: [],
            successes: 0,
            halted: "completed",
            haltDetail: "",
            nextStageAdmitted: false,
            blocking: [],
          },
        ],
      })),
    );

    for (let i = 0; i < planned; i += 1) {
      const aborted = abortAt === i + 1;
      if (abortAt > 0 && i + 1 > abortAt) break;

      const offsets = offsetsFor(stageDef.key, i);
      const attempt: Attempt = {
        index: i,
        runId: `${SCOPE.environmentId}-${stageDef.key}-${String(i).padStart(3, "0")}`,
        stage: stageDef.key,
        offsetsRad: offsets,
        outcome: aborted ? "aborted" : "succeeded",
        peakRps: admitted.peakRps * (0.94 + 0.1 * ((i % 3) / 3)),
        durationS: requiredDurationS * (0.97 + 0.06 * ((i % 4) / 4)),
        abortCause: aborted ? "human_stop" : null,
        findings: aborted ? ["the estop was engaged"] : [],
      };
      attempts.push(attempt);

      at((cursor += 380), () =>
        emit((s) => {
          const done = attempts.slice(0, i + 1);
          const successes = done.filter((a) => a.outcome === "succeeded").length;
          const base = 0.16 + 0.78 * ((stageIdx * planned + i + 1) / (simulated.length * planned));
          return {
            ...log(
              aborted ? "abort" : "attempt",
              aborted
                ? `${attempt.runId} 被急停中止，原因 human_stop`
                : `${attempt.runId} 成功 · 起始扰动 ≤ ${(STAGE_OFFSET_RAD[stageDef.key] * 1000).toFixed(0)} mrad · 峰值 ${attempt.peakRps.toFixed(3)} rad/s`,
            )(s),
            progress: Math.min(0.94, base),
            liveStage: stageDef.key,
            liveAttempt: attempt,
            setpointRad: STAND_RAD.map((v, j) => v + GOAL_OFFSETS_RAD[j] + offsets[j]),
            measuredRad: STAND_RAD.map(
              (v, j) =>
                v +
                GOAL_OFFSETS_RAD[j] +
                offsets[j] -
                (GOAL_OFFSETS_RAD[j] ? admitted.settledErrorRad : 0),
            ),
            quarantined: aborted ? attempt.runId : s.quarantined,
            stages: s.stages.map((x) =>
              x.stage === stageDef.key
                ? {
                    ...x,
                    attempts: done,
                    successes,
                    halted: aborted ? "aborted" : "completed",
                    haltDetail: aborted
                      ? `run '${attempt.runId}' aborted with cause 'human_stop'; this configuration is quarantined until a named human clears that run`
                      : `ran all ${planned} planned attempts`,
                  }
                : x,
            ),
          };
        }),
      );
    }

    // --- the rung's verdict, decided by the ladder rather than by the campaign.
    at((cursor += 420), () =>
      emit((s) => {
        const mine = s.stages.find((x) => x.stage === stageDef.key);
        const executed = mine?.attempts.length ?? 0;
        const successes = mine?.successes ?? 0;
        const quarantine = s.quarantined;
        const rate = executed ? successes / executed : 0;
        const blocking: string[] = [];
        if (executed < MINIMUM_STAGE_ATTEMPTS) {
          blocking.push(
            `stage ${stageDef.key} has ${executed} attempts, below the required ${MINIMUM_STAGE_ATTEMPTS}`,
          );
        }
        if (rate < MINIMUM_STAGE_SUCCESS_RATE) {
          blocking.push(
            `stage ${stageDef.key} success rate ${rate.toFixed(2)} is below the required ${MINIMUM_STAGE_SUCCESS_RATE.toFixed(2)}`,
          );
        }
        if (quarantine) blocking.push(REFUSALS.quarantine(quarantine));
        const admittedNext = blocking.length === 0;
        return {
          ...log(
            "evidence",
            `${stageDef.key} 证据入账：${successes}/${executed} · ${
              admittedNext ? "已打开下一级" : "未打开下一级"
            }`,
          )(s),
          stages: s.stages.map((x) =>
            x.stage === stageDef.key ? { ...x, nextStageAdmitted: admittedNext, blocking } : x,
          ),
        };
      }),
    );
  });

  // --- the final verdict: simulated evidence never admits hardware.
  at((cursor += 520), () =>
    emit((s) => {
      const failed = s.stages.find((x) => !x.nextStageAdmitted);
      const blockingHardware = failed
        ? [...failed.blocking, REFUSALS.noShadow, REFUSALS.noApproval]
        : [REFUSALS.noShadow, REFUSALS.noApproval];
      return {
        ...log(
          "verdict",
          failed
            ? `停在 ${failed.stage}：它没有打开下一级`
            : "两个仿真阶段都跑满并打开了下一级；剩下的不是仿真工作",
        )(s),
        phase: "settled",
        progress: 1,
        liveAttempt: null,
        liveStage: null,
        halted: failed
          ? failed.halted === "aborted"
            ? "stage_incomplete"
            : "stage_did_not_open_the_next"
          : "completed",
        haltDetail: failed
          ? failed.haltDetail
          : "每个仿真阶段都跑满了计划次数并打开了下一级；在真机之前剩下的不是仿真工作。",
        blockingHardware,
      };
    }),
  );

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}

/* ------------------------------------------------------------------ spring */

/**
 * Critically damped spring toward `target`, animating from the CURRENT presentation value so a
 * re-target mid-flight never jumps (Apple: response + damping, not duration + easing).
 * Honours prefers-reduced-motion by snapping.
 */
export function useSpringValue(target: number, response = 0.4, damping = 1) {
  const [value, setValue] = useState(target);
  const state = useRef({ v: target, velocity: 0, raf: 0, last: 0, reduced: false });

  useEffect(() => {
    state.current.reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (state.current.reduced) {
      state.current.v = target;
      setValue(target);
      return;
    }
    const omega = (2 * Math.PI) / response;
    const zeta = damping;
    const step = (now: number) => {
      const s = state.current;
      const dt = Math.min(0.032, s.last ? (now - s.last) / 1000 : 0.016);
      s.last = now;
      const x = s.v - target;
      const accel = -omega * omega * x - 2 * zeta * omega * s.velocity;
      s.velocity += accel * dt;
      s.v += s.velocity * dt;
      if (Math.abs(s.v - target) < 0.0005 && Math.abs(s.velocity) < 0.002) {
        s.v = target;
        s.velocity = 0;
        setValue(target);
        s.raf = 0;
        return;
      }
      setValue(s.v);
      s.raf = requestAnimationFrame(step);
    };
    state.current.last = 0;
    cancelAnimationFrame(state.current.raf);
    state.current.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(state.current.raf);
  }, [target, response, damping]);

  return value;
}

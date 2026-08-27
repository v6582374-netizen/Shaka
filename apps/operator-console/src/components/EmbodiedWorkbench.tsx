// The Physical AI governance workbench: prototype variant A ("治理工作台") raised to production.
// Three resident columns — 声明与阶梯 · 本次运行 · 阻塞项 — so a verdict never requires navigating
// away from the thing that produced it.
//
// The rule this surface is built around, inherited verbatim from the prototype: it must never be
// able to show a number the bench cannot produce, or a refusal the bench would not issue. So every
// figure below is read off `GET /v1/embodied/environment` or a run snapshot, and anything the
// backend has no field for was deleted rather than approximated. In particular there is no live
// per-joint telemetry here: the bench exposes no per-control-step joint stream, and the servo story
// it CAN tell — commanded rate versus measured peak, and the droop that forces the goal tolerance —
// is told with `calibration.measurements[]`.
//
// Refusals are the payload, not the error path. Every backend reason string is shown verbatim as
// <code> beside its translation, and an unrecognised reason falls through to the raw string, so the
// surface cannot silently soften or swallow something the bench said no about.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelEmbodiedRun,
  getEmbodiedEnvironment,
  getEmbodiedRun,
  getEmbodiedRunEvents,
  listEmbodiedRuns,
  startEmbodiedRun,
  type EmbodiedAttempt,
  type EmbodiedEnvironment,
  type EmbodiedMeasurement,
  type EmbodiedRun,
  type EmbodiedRunEvent,
  type EmbodiedStageReport,
  type EmbodiedSupervision,
} from "../api";
import { Icon, type IconName } from "./Icon";
import { PanelHead } from "./PanelHead";

const CARD = "rounded-xl2 border border-line bg-panel";
const EVENT_POLL_MS = 400;
const SNAPSHOT_POLL_MS = 1000;
const FEED_LIMIT = 160;

const TERMINAL: ReadonlySet<string> = new Set(["done", "error", "cancelled"]);
const isActive = (run: EmbodiedRun | null | undefined): boolean => run != null && !TERMINAL.has(run.state);

const errText = (caught: unknown, fallback: string): string =>
  caught instanceof Error && caught.message ? caught.message : fallback;

const clockOf = (iso: string | null): string => {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleTimeString([], { hour12: false });
};

const dayOf = (iso: string | null): string => {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
};

/* ------------------------------------------------------------------ the surface's own copy

   The backend's ladder gives a stage id and whether a simulation may earn it. What a person would
   call the rung, the question it answers, and why two of them cannot be simulated are editorial —
   they live here, keyed by stage id, and an unknown id degrades to showing the id itself. */

const STAGE_COPY: Record<string, { label: string; question: string; whyNotSimulated?: string }> = {
  policy_evaluation: {
    label: "控制器评估",
    question: "这个控制器到底能不能干成这件事？",
  },
  offline_replay: {
    label: "离线重放",
    question: "部署时的初始条件波动，它能不能吸收？",
  },
  shadow_mode: {
    label: "影子模式",
    question: "真机在旁边、但不听它指令时，它的判断对不对？",
    whyNotSimulated: "按构造无法仿真：它回放真实观测，旁边站着一台不受它指令的真机。需要先有硬件适配器。",
  },
  hardware_supervised: {
    label: "监督下真机执行",
    question: "可以让人站在会动的机器人旁边了吗？",
    whyNotSimulated: "需要一份钉在当前证据摘要上的人类批准，过期即失效。",
  },
};

const stageLabel = (stage: string | null | undefined): string =>
  (stage && STAGE_COPY[stage]?.label) || stage || "—";

/** bench.py :: HALTED_* — the verdict vocabulary, in a reader's language. */
const HALT_COPY: Record<string, { zh: string; tone: "ok" | "warn" | "danger" }> = {
  completed: { zh: "两级仿真都跑满了计划", tone: "ok" },
  no_admitted_command_rate: { zh: "没有速率被准入", tone: "danger" },
  goal_not_reachable_in_time: { zh: "目标在允许时间内飞不完", tone: "danger" },
  stage_incomplete: { zh: "阶段没跑完就停了", tone: "danger" },
  stage_did_not_open_the_next: { zh: "阶段跑完了，但没打开下一级", tone: "warn" },
};

const OUTCOME_COPY: Record<EmbodiedAttempt["outcome"], { zh: string; tone: "ok" | "warn" | "danger" }> = {
  succeeded: { zh: "成功", tone: "ok" },
  refused: { zh: "被拒绝（没动）", tone: "danger" },
  failed_verification: { zh: "后置条件未达成", tone: "warn" },
  aborted: { zh: "中止", tone: "danger" },
};

/** safety.py :: ABORT_* — the four causes an abort can carry. */
const ABORT_COPY: Record<string, string> = {
  human_stop: "有人介入（急停或监护人离开）",
  envelope_violation: "越出安全包线",
  time_limit: "超出允许时长",
  observation_stale: "观测过期",
};

const SUPERVISION_FIELDS: Array<{
  key: keyof EmbodiedSupervision;
  label: string;
  hint: string;
  /** The value that makes SafetySupervisor.preflight refuse. */
  refusesWhen: boolean;
}> = [
  { key: "guardian_present", label: "有人监护", hint: "现场有人盯着这台机器人", refusesWhen: false },
  { key: "estop_reachable", label: "急停可达", hint: "监护人伸手就能按到急停", refusesWhen: false },
  { key: "workspace_clear", label: "工作区清空", hint: "动作范围内没有别的东西", refusesWhen: false },
  { key: "estop_engaged", label: "急停已按下", hint: "按下时任何运行都不该开始", refusesWhen: true },
];

/**
 * The bench emits its reasons as sentences and identifiers — it names a stage, a field, a run id.
 * A reader needs the consequence in their own language; the audit needs the module's own words. So
 * both are always shown, and anything unmatched falls through to the raw string verbatim rather
 * than being dropped, because a swallowed refusal is the one failure this surface cannot have.
 */
export function explainReason(reason: string): { zh: string | null } {
  if (reason.startsWith("embodiment unverified_fields must be confirmed on hardware:")) {
    return { zh: "本体还有未验证字段，必须由人在真机上确认；未验证一律按不匹配处理。" };
  }
  if (reason.startsWith("policy unverified_fields must be confirmed against the checkpoint:")) {
    return { zh: "策略还有未验证字段，必须对着 checkpoint 确认后才能采信。" };
  }
  if (reason === "supervised hardware execution requires a human approval") {
    return { zh: "监督下真机执行需要一份具名的人类批准，钉在当前证据摘要上。" };
  }
  if (reason === "the human approval was issued for a different skill revision, embodiment, or policy") {
    return { zh: "那份批准是给另一个技能版本／本体／策略的，换了作用域就不再有效。" };
  }
  if (reason === "the human approval has expired and must be re-issued before hardware execution") {
    return { zh: "批准已过期，真机执行前必须重新签发。" };
  }
  if (reason === "the human approval was pinned to a different evidence set; re-review the current evidence") {
    return { zh: "批准钉的是另一份证据；现在的证据需要重新评审。" };
  }
  const noEvidence = reason.match(/^stage (\S+) has no evidence for this configuration$/);
  if (noEvidence) {
    return { zh: `${stageLabel(noEvidence[1])} 在这个配置下没有任何证据，这一级还没被走过。` };
  }
  const violations = reason.match(/^stage (\S+) recorded (\d+) safety violation/);
  if (violations) {
    return { zh: `${stageLabel(violations[1])} 记录了 ${violations[2]} 次安全违规，真机准入被收回，直到它们被处理。` };
  }
  const attempts = reason.match(/^stage (\S+) has (\d+) attempts, below the required (\d+)$/);
  if (attempts) {
    return { zh: `${stageLabel(attempts[1])} 只跑了 ${attempts[2]} 次，不到要求的 ${attempts[3]} 次，样本量不足以放行。` };
  }
  const rate = reason.match(/^stage (\S+) success rate (\S+) is below the required (\S+)$/);
  if (rate) {
    return { zh: `${stageLabel(rate[1])} 的成功率 ${rate[2]} 低于要求的 ${rate[3]}，这一级没有被打开。` };
  }
  const quarantine = reason.match(/^run '(.+)' aborted with cause '(.+)' and has no recorded human clearance$/);
  if (quarantine) {
    const cause = ABORT_COPY[quarantine[2]] ?? quarantine[2];
    return { zh: `该配置已被隔离：${cause}，且没有具名的人清除这次运行。没有自动重试。` };
  }
  if (reason === "no guardian is present to supervise the run") {
    return { zh: "没有监护人在场，运行不被允许开始。" };
  }
  if (reason === "the estop is not reachable by the guardian") {
    return { zh: "监护人按不到急停，等于没有急停。" };
  }
  if (reason === "the estop is engaged") {
    return { zh: "急停处于按下状态，此时不允许任何运行开始。" };
  }
  if (reason.startsWith("observation is stale at")) {
    return { zh: "观测太旧了：陈旧的观测不能当作现在的房间状态。" };
  }
  if (reason.startsWith("the robot is not at rest at")) {
    return { zh: "机器人还在动，不满足静止起步的前置条件。" };
  }
  if (reason.startsWith("end-effector force")) {
    return { zh: "末端执行器的受力已经超限，运行前就不允许开始。" };
  }
  if (reason.startsWith("the end effector starts outside the workspace bounds")) {
    return { zh: "末端执行器的起始位置在工作空间之外。" };
  }
  const unobservable = reason.match(/^precondition '(.+)' is not observable/);
  if (unobservable) {
    return { zh: `前置条件 ${unobservable[1]} 无法被观测，因此不能被假定成立。` };
  }
  const unsatisfied = reason.match(/^precondition '(.+)' is not satisfied$/);
  if (unsatisfied) {
    return { zh: `前置条件 ${unsatisfied[1]} 不成立。` };
  }
  if (reason.startsWith("no candidate rate peaked at or below")) {
    return { zh: "没有任何候选速率的实测峰值落进预算，本工作台不会下发一个从未被探测过的速率。" };
  }
  if (reason.includes("the peak is not monotone in the commanded rate")) {
    return { zh: "峰值没有随下发速率单调上升——这正是标定要抓的反转，不能当成干净结果。" };
  }
  return { zh: null };
}

/* ------------------------------------------------------------------ primitives */

type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

const TONE_PILL: Record<Tone, string> = {
  neutral: "border-line bg-paper text-muted",
  ok: "border-okLine bg-okSoft text-ok",
  warn: "border-line bg-warnSoft text-warnInk",
  danger: "border-line bg-dangerSoft text-danger",
  accent: "border-line bg-accentSoft text-accent",
};

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex min-h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium ${TONE_PILL[tone]}`}
    >
      {children}
    </span>
  );
}

function CardHead({ icon, title, right }: { icon: IconName; title: string; right?: React.ReactNode }) {
  return (
    <header className="flex min-h-9 items-center gap-2 border-b border-line px-3 py-2">
      <Icon name={icon} size={13} className="shrink-0 text-faint" />
      <h3 className="min-w-0 truncate text-[12.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
      <span className="ml-auto flex items-center gap-1.5">{right}</span>
    </header>
  );
}

/** A raw backend string, always kept beside its translation so a reader can audit the wording. */
function RawReason({ text }: { text: string }) {
  return (
    <code className="mt-1 block break-words font-mono text-[10.5px] leading-[1.5] text-faint">{text}</code>
  );
}

function ReasonItem({ reason, tone = "danger" }: { reason: string; tone?: "danger" | "warn" }) {
  const { zh } = explainReason(reason);
  return (
    <li className="flex gap-2 border-t border-line px-3 py-2 first:border-t-0">
      <Icon
        name={tone === "danger" ? "shield" : "sliders"}
        size={13}
        className={`mt-0.5 shrink-0 ${tone === "danger" ? "text-danger" : "text-warnInk"}`}
      />
      <div className="min-w-0 flex-1">
        {zh ? <p className="text-[12px] leading-[1.55] text-ink">{zh}</p> : null}
        <RawReason text={reason} />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ calibration */

/**
 * One probe, drawn against the velocity budget. The measured peak is what can visibly cross the
 * budget marker — a commanded rate is a request, and this is the answer the robot gave.
 */
function MeasurementRow({ m, env }: { m: EmbodiedMeasurement; env: EmbodiedEnvironment }) {
  const full = env.envelope.max_joint_velocity_rps;
  const fill = Math.max(0, Math.min(1, m.peak_joint_velocity_rps / full));
  const marker = Math.max(0, Math.min(100, (env.velocity_budget_rps / full) * 100));
  return (
    <div className="border-t border-line px-3 py-2.5 first:border-t-0">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11.5px] text-ink">下发 {m.commanded_rate_rps} rad/s</span>
        <span className={`ml-auto font-mono text-[11.5px] ${m.fits ? "text-ok" : "text-danger"}`}>
          实测峰值 {m.peak_joint_velocity_rps.toFixed(4)} rad/s
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper">
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-300 motion-reduce:transition-none ${m.fits ? "bg-ok" : "bg-danger"}`}
          style={{ transform: `scaleX(${fill.toFixed(4)})` }}
        />
        <div
          className="absolute inset-y-[-2px] w-px bg-lineStrong"
          style={{ left: `${marker}%` }}
          aria-hidden="true"
        />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted sm:grid-cols-3">
        <div className="flex justify-between gap-1">
          <dt>过冲比</dt>
          <dd className="text-ink">{m.overshoot_ratio.toFixed(2)}×</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt>跟踪滞后</dt>
          <dd className="text-ink">{m.tracking_error_rad.toFixed(4)}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt>静态下垂</dt>
          <dd className="text-ink">{m.settled_error_rad.toFixed(4)}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt>单周期步长</dt>
          <dd className="text-ink">{m.max_step_rad.toFixed(4)}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt>允许超前</dt>
          <dd className="text-ink">{m.max_lead_rad.toFixed(4)}</dd>
        </div>
        <div className="flex justify-between gap-1">
          <dt>容差下限</dt>
          <dd className="text-ink">{m.minimum_goal_tolerance_rad.toFixed(4)}</dd>
        </div>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ ladder + attempts */

function rungStatus(
  simulated: boolean,
  report: EmbodiedStageReport | undefined,
): { badge: React.ReactNode; edge: string } {
  if (!simulated) {
    return { badge: <Pill>仿真无法达成</Pill>, edge: "border-line opacity-80" };
  }
  if (!report) {
    return { badge: <Pill>未开始</Pill>, edge: "border-line" };
  }
  if (!report.completed) {
    return {
      badge: (
        <Pill tone="danger">
          {report.executed_attempts}/{report.planned_attempts} 中断
        </Pill>
      ),
      edge: "border-danger/40 bg-dangerSoft/40",
    };
  }
  if (report.next_stage_admitted) {
    return {
      badge: (
        <Pill tone="ok">
          {report.successes}/{report.executed_attempts} 已打开下一级
        </Pill>
      ),
      edge: "border-okLine bg-okSoft/40",
    };
  }
  return {
    badge: (
      <Pill tone="warn">
        {report.successes}/{report.executed_attempts} 未打开
      </Pill>
    ),
    edge: "border-line bg-warnSoft/40",
  };
}

function Ladder({ env, run }: { env: EmbodiedEnvironment; run: EmbodiedRun | null }) {
  return (
    <ol className="flex flex-col gap-1.5 p-3" aria-label="准入阶梯">
      {env.ladder.map((rung, index) => {
        const copy = STAGE_COPY[rung.stage];
        const report = run?.stages.find((s) => s.stage === rung.stage);
        const { badge, edge } = rungStatus(rung.simulated, report);
        return (
          <li key={rung.stage} className={`flex gap-2.5 rounded-lg border px-2.5 py-2 ${edge}`}>
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line font-mono text-[10.5px] text-muted">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12.5px] font-medium text-ink">{copy?.label ?? rung.stage}</span>
                <span className="ml-auto">{badge}</span>
              </div>
              <code className="mt-0.5 block font-mono text-[10px] text-faint">{rung.stage}</code>
              {copy?.question ? <p className="mt-1 text-[11.5px] leading-[1.5] text-muted">{copy.question}</p> : null}
              {copy?.whyNotSimulated ? (
                <p className="mt-1 text-[11px] leading-[1.5] text-warnInk">{copy.whyNotSimulated}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The planned attempt slots, filled by what actually happened. The empty tail after a stop is the
 * point: an abort or refusal quarantines the configuration, so those attempts never happen — the
 * bench has no automatic retry.
 */
function AttemptGrid({ report }: { report: EmbodiedStageReport }) {
  const stopped = !report.completed;
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: Math.max(report.planned_attempts, report.attempts.length) }, (_, i) => {
        const attempt = report.attempts[i];
        const never = !attempt && stopped;
        const tone = attempt
          ? attempt.outcome === "succeeded"
            ? "border-okLine bg-okSoft text-ok"
            : "border-line bg-dangerSoft text-danger"
          : never
            ? "border-dashed border-line text-faint"
            : "border-line text-faint";
        const title = attempt
          ? `${attempt.run_id} · ${OUTCOME_COPY[attempt.outcome].zh}${attempt.abort_cause ? ` · ${ABORT_COPY[attempt.abort_cause] ?? attempt.abort_cause}` : ""}`
          : never
            ? "停下之后这次尝试不会发生：没有自动重试"
            : "尚未尝试";
        return (
          <span
            key={i}
            title={title}
            className={`grid h-6 w-6 place-items-center rounded-md border font-mono text-[10.5px] ${tone}`}
          >
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ event feed */

type FeedLine = { seq: number; at: string; tone: Tone; text: string };

function describeEvent(event: EmbodiedRunEvent): { tone: Tone; text: string } | null {
  switch (event.type) {
    case "run_started":
      return { tone: "accent", text: "运行开始" };
    case "calibration_measured": {
      const m = event.measurement;
      if (!m) return null;
      return {
        tone: m.fits ? "neutral" : "danger",
        text: `下发 ${m.commanded_rate_rps} rad/s → 实测峰值 ${m.peak_joint_velocity_rps.toFixed(4)} rad/s，${m.fits ? "落进预算" : "超出预算"}`,
      };
    }
    case "calibration_admitted":
      return event.admitted
        ? {
            tone: "ok",
            text: `准入速率 ${event.admitted.commanded_rate_rps} rad/s${
              typeof event.budget_rps === "number" ? `（预算 ${event.budget_rps.toFixed(4)} rad/s）` : ""
            }`,
          }
        : {
            tone: "danger",
            text: `没有候选速率被准入${
              typeof event.budget_rps === "number" ? `（预算 ${event.budget_rps.toFixed(4)} rad/s）` : ""
            }`,
          };
    case "goal_derived": {
      const tolerance = event.goal ? `目标容差 ${event.goal.tolerance_rad.toFixed(4)} rad` : "目标已推导";
      const timing =
        typeof event.required_duration_s === "number" && typeof event.allowed_duration_s === "number"
          ? ` · 需要 ${event.required_duration_s.toFixed(2)}s / 允许 ${event.allowed_duration_s.toFixed(2)}s`
          : "";
      return { tone: "neutral", text: `${tolerance}${timing}` };
    }
    case "stage_started":
      return {
        tone: "accent",
        text: `${stageLabel(event.stage)} 开跑，计划 ${event.planned_attempts ?? "?"} 次${
          typeof event.max_offset_rad === "number" ? ` · 起始扰动 ≤ ${(event.max_offset_rad * 1000).toFixed(0)} mrad` : ""
        }`,
      };
    case "attempt_recorded": {
      const outcome = event.outcome ? OUTCOME_COPY[event.outcome] : null;
      const cause = event.abort_cause ? ` · ${ABORT_COPY[event.abort_cause] ?? event.abort_cause}` : "";
      return {
        tone: outcome?.tone === "ok" ? "ok" : outcome?.tone === "warn" ? "warn" : "danger",
        text: `${stageLabel(event.stage)} 第 ${(event.index ?? 0) + 1} 次 · ${outcome?.zh ?? event.outcome ?? "?"}${cause}`,
      };
    }
    case "stage_completed":
      return {
        tone: event.next_stage_admitted ? "ok" : "warn",
        text: `${stageLabel(event.stage)} 结束 · ${event.successes ?? 0}/${event.executed_attempts ?? 0} 成功 · ${
          event.next_stage ? `${stageLabel(event.next_stage)} ${event.next_stage_admitted ? "已打开" : "未打开"}` : "无下一级"
        }`,
      };
    case "hardware_decision":
      return {
        tone: event.decision?.admitted ? "ok" : "warn",
        text: event.decision?.admitted
          ? "真机监督执行已准入"
          : `真机监督执行未准入，阻塞 ${event.decision?.blocking_reasons.length ?? 0} 项`,
      };
    case "run_halted":
      return {
        tone: event.halted === "completed" ? "ok" : "danger",
        text: `${event.halted ? (HALT_COPY[event.halted]?.zh ?? event.halted) : "运行结束"}${event.halt_detail ? `：${event.halt_detail}` : ""}`,
      };
    case "run_failed":
      return { tone: "danger", text: event.message ?? "运行失败" };
    case "run_cancelled":
      return { tone: "warn", text: "运行已取消" };
    default:
      return null;
  }
}

const FEED_TONE: Record<Tone, string> = {
  neutral: "text-muted",
  ok: "text-ok",
  warn: "text-warnInk",
  danger: "text-danger",
  accent: "text-accent",
};

function Feed({ lines }: { lines: FeedLine[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (!lines.length) {
    return (
      <p className="px-3 py-4 text-[11.5px] text-muted">
        声明房间事实、然后开跑。每一条结论都由拥有它的模块产出，这个界面不做任何判断。
      </p>
    );
  }
  return (
    <ol ref={ref} className="max-h-[260px] overflow-y-auto hairline-scroll" data-testid="embodied-feed">
      {lines.map((line) => (
        <li key={line.seq} className="flex gap-2 border-t border-line px-3 py-1.5 first:border-t-0">
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{clockOf(line.at)}</span>
          <span className={`min-w-0 flex-1 text-[11.5px] leading-[1.5] ${FEED_TONE[line.tone]}`}>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ the surface */

const DEFAULT_SUPERVISION: EmbodiedSupervision = {
  guardian_present: true,
  estop_engaged: false,
  estop_reachable: true,
  workspace_clear: true,
};

export function EmbodiedWorkbench() {
  const [env, setEnv] = useState<EmbodiedEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const [runs, setRuns] = useState<EmbodiedRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<Record<string, FeedLine[]>>({});
  const cursors = useRef(new Map<string, number>());

  const [supervision, setSupervision] = useState<EmbodiedSupervision>(DEFAULT_SUPERVISION);
  const [attempts, setAttempts] = useState(10);
  const [controlHz, setControlHz] = useState<number | null>(null);
  const [watch, setWatch] = useState(false);
  const [starting, setStarting] = useState(false);

  /* ---- environment + run history ---- */

  useEffect(() => {
    let alive = true;
    Promise.all([getEmbodiedEnvironment(), listEmbodiedRuns().catch(() => ({ runs: [] as EmbodiedRun[] }))])
      .then(([environment, history]) => {
        if (!alive) return;
        setEnv(environment);
        setAttempts(environment.minimum_stage_attempts);
        setControlHz(environment.control_frequency_hz);
        setRuns(history.runs);
        setSelectedId((prev) => prev ?? history.runs[0]?.run_id ?? null);
      })
      .catch((caught) => {
        if (alive) setError(errText(caught, "具身执行环境读不出来。"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => runs.find((run) => run.run_id === selectedId) ?? null,
    [runs, selectedId],
  );
  const activeRun = useMemo(() => runs.find((run) => isActive(run)) ?? null, [runs]);
  const watching = activeRun?.run_id === selectedId;

  /* ---- authoritative snapshot while a run is in flight ---- */

  const activeId = activeRun?.run_id ?? null;
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const timer = setInterval(() => {
      getEmbodiedRun(activeId)
        .then((fresh) => {
          if (alive) setRuns((prev) => prev.map((run) => (run.run_id === fresh.run_id ? fresh : run)));
        })
        .catch(() => {});
    }, SNAPSHOT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeId]);

  /* ---- cursor-polled event log: the live narration, and a finished run's replay ---- */

  const selectedActive = isActive(selected);
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const absorb = (events: EmbodiedRunEvent[]) => {
      if (!events.length) return;
      setFeeds((prev) => {
        const lines = [...(prev[selectedId] ?? [])];
        for (const event of events) {
          const described = describeEvent(event);
          if (described) lines.push({ seq: event.seq, at: event.at, ...described });
        }
        return { ...prev, [selectedId]: lines.slice(-FEED_LIMIT) };
      });
      if (events.some((event) => ["run_halted", "run_failed", "run_cancelled"].includes(event.type))) {
        getEmbodiedRun(selectedId)
          .then((fresh) => {
            if (alive) setRuns((prev) => prev.map((run) => (run.run_id === fresh.run_id ? fresh : run)));
          })
          .catch(() => {});
      }
    };

    const poll = async () => {
      try {
        const page = await getEmbodiedRunEvents(selectedId, cursors.current.get(selectedId) ?? 0);
        if (!alive) return;
        cursors.current.set(selectedId, Math.max(cursors.current.get(selectedId) ?? 0, page.latest_sequence));
        absorb(page.events);
      } catch (caught) {
        if (alive) setError(errText(caught, "运行事件读不出来。"));
      }
      if (alive && selectedActive) timer = setTimeout(() => void poll(), EVENT_POLL_MS);
    };

    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [selectedId, selectedActive]);

  /* ---- actions ---- */

  const start = useCallback(async () => {
    if (!env) return;
    setStarting(true);
    setError(null);
    try {
      const { run } = await startEmbodiedRun({
        declared_supervision: supervision,
        attempts_per_stage: attempts,
        control_frequency_hz: controlHz ?? env.control_frequency_hz,
        watch,
      });
      cursors.current.delete(run.run_id);
      setFeeds((prev) => ({ ...prev, [run.run_id]: [] }));
      setRuns((prev) => [run, ...prev.filter((item) => item.run_id !== run.run_id)]);
      setSelectedId(run.run_id);
      setStatus(`运行 ${run.run_id} 已开始`);
    } catch (caught) {
      setError(errText(caught, "运行起不来。"));
    } finally {
      setStarting(false);
    }
  }, [attempts, controlHz, env, supervision, watch]);

  const cancel = useCallback(async () => {
    if (!activeId) return;
    try {
      const fresh = await cancelEmbodiedRun(activeId);
      setRuns((prev) => prev.map((run) => (run.run_id === fresh.run_id ? fresh : run)));
    } catch (caught) {
      setError(errText(caught, "取消没有生效。"));
    }
  }, [activeId]);

  /* ---- derived ---- */

  const simulatorReady = env?.simulator.available === true;
  const willBeRefused = SUPERVISION_FIELDS.filter((field) => supervision[field.key] === field.refusesWhen);
  const halt = selected?.halted ? HALT_COPY[selected.halted] : null;
  const feed = (selectedId && feeds[selectedId]) || [];
  const focusStage = selected?.stages[selected.stages.length - 1];
  const runLabel = selected
    ? `${selected.run_id} · ${selected.state}${selected.halted ? ` · ${halt?.zh ?? selected.halted}` : ""}`
    : "还没有运行";

  /* ---- render ---- */

  return (
    <main className="flex-1 min-w-0 overflow-y-auto hairline-scroll bg-paper" data-testid="embodied-workbench">
      <div className="mx-auto w-full max-w-[1480px] px-5 py-6 sm:px-7">
        <PanelHead
          title="具身执行"
          sub="在有人站到会动的机器人旁边之前，这套治理骨架必须先能说出「不行」。屏幕上的每个数字都由 bench 产出。"
        />

        <p className="sr-only" role="status" aria-live="polite">
          {error ? error : status || runLabel}
        </p>

        {error ? (
          <div
            className="mb-4 flex items-start gap-2 rounded-xl2 border border-line bg-dangerSoft px-3 py-2.5 text-[12px] text-danger"
            role="alert"
          >
            <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" className="shrink-0 text-[11px] underline" onClick={() => setError(null)}>
              知道了
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="text-[12.5px] text-muted" data-testid="embodied-loading">
            正在读取环境…
          </p>
        ) : !env ? (
          <p className="text-[12.5px] text-muted">环境不可读，无法显示任何数字。</p>
        ) : (
          <>
            {/* The simulator's own verdict about itself. No dead buttons: when it cannot run, the
                reason it gave is the whole surface state, and starting is disabled. */}
            {!simulatorReady ? (
              <div
                className={`${CARD} mb-4 flex items-start gap-2.5 border-warnInk/25 bg-warnSoft px-3.5 py-3`}
                data-testid="embodied-simulator-unavailable"
              >
                <Icon name="wrench" size={15} className="mt-0.5 shrink-0 text-warnInk" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-warnInk">仿真器在这台机器上跑不起来，所以这里不会有任何运行。</p>
                  {env.simulator.reason ? <RawReason text={env.simulator.reason} /> : null}
                  {env.simulator.scene_path ? (
                    <p className="mt-1 break-all font-mono text-[10.5px] text-faint">场景：{env.simulator.scene_path}</p>
                  ) : null}
                  <p className="mt-1.5 text-[11.5px] leading-[1.5] text-muted">
                    历史运行仍然可以在下面读：证据一旦记下来，就不依赖仿真器还在不在。
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid min-h-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,360px)]">
              {/* ------------------------------------------------ 声明 · 阶梯 · 历史 */}
              <section className="flex min-w-0 flex-col gap-4" aria-label="声明与阶梯">
                <div className={CARD}>
                  <CardHead
                    icon="sliders"
                    title="房间事实：由人声明，从不测量"
                    right={<Pill tone={willBeRefused.length ? "danger" : "neutral"}>{willBeRefused.length ? "会被拒绝" : "可放行"}</Pill>}
                  />
                  <div className="flex flex-col gap-1.5 p-3">
                    {SUPERVISION_FIELDS.map((field) => {
                      const value = supervision[field.key];
                      const bad = value === field.refusesWhen;
                      return (
                        <button
                          key={field.key}
                          type="button"
                          role="switch"
                          aria-checked={value}
                          className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            bad ? "border-danger/40 bg-dangerSoft/50" : "border-line hover:bg-paper"
                          }`}
                          onClick={() => setSupervision((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        >
                          <span
                            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                              value ? "border-accent bg-accent text-white" : "border-lineStrong bg-paper text-transparent"
                            }`}
                            aria-hidden="true"
                          >
                            <Icon name="diamond" size={9} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[12.5px] font-medium text-ink">{field.label}</span>
                              <code className="font-mono text-[10px] text-faint">{field.key}</code>
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-[1.5] text-muted">{field.hint}</span>
                          </span>
                        </button>
                      );
                    })}

                    {/* Provoking a refusal is a first-class use of this surface, so the API accepts
                        a declaration the SafetySupervisor will reject. Saying so here keeps the
                        refusal legible as evidence rather than looking like a client bug. */}
                    {willBeRefused.length ? (
                      <p
                        className="rounded-lg border border-line bg-dangerSoft px-2.5 py-2 text-[11.5px] leading-[1.55] text-danger"
                        data-testid="embodied-will-refuse"
                      >
                        这份声明会在 preflight 被 SafetySupervisor 拒绝，接口不会替你拦下来——那条拒绝本身就是真实证据。
                      </p>
                    ) : null}

                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <label className="min-w-0">
                        <span className="mb-1 block text-[11px] text-muted">每级尝试次数</span>
                        <input
                          type="number"
                          min={1}
                          value={attempts}
                          onChange={(e) => setAttempts(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                        />
                        <span className="mt-1 block text-[10.5px] text-faint">
                          低于 {env.minimum_stage_attempts} 次时证据不足以放行
                        </span>
                      </label>
                      <label className="min-w-0">
                        <span className="mb-1 block text-[11px] text-muted">控制频率 Hz</span>
                        <input
                          type="number"
                          min={1}
                          step="1"
                          value={controlHz ?? env.control_frequency_hz}
                          onChange={(e) => setControlHz(Math.max(1, Number(e.target.value) || env.control_frequency_hz))}
                          className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                        />
                        <span className="mt-1 block text-[10.5px] text-faint">同一伺服在不同节拍下过冲不同</span>
                      </label>
                    </div>

                    {/* The watch switch publishes camera endpoints. The security fact sits next to
                        the control, because it is a property of turning it on, not a footnote. */}
                    <div className={`mt-1 rounded-lg border px-2.5 py-2 ${watch ? "border-warnInk/30 bg-warnSoft" : "border-line"}`}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={watch}
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => setWatch((prev) => !prev)}
                      >
                        <Icon name="image" size={13} className="shrink-0 text-faint" />
                        <span className="text-[12.5px] font-medium text-ink">边跑边看（watch）</span>
                        <span
                          className={`ml-auto h-4 w-7 shrink-0 rounded-full border transition-colors ${
                            watch ? "border-accent bg-accent" : "border-lineStrong bg-paper"
                          }`}
                          aria-hidden="true"
                        >
                          <span
                            className={`block h-3 w-3 translate-y-[1px] rounded-full bg-white transition-transform motion-reduce:transition-none ${
                              watch ? "translate-x-[13px]" : "translate-x-[1px]"
                            }`}
                          />
                        </span>
                      </button>
                      <p className="mt-1.5 text-[11px] leading-[1.55] text-warnInk">
                        打开后会发布 <b>无鉴权</b>、自签证书的 WebRTC 端口：能连到这些端口的人都能看这台机器人的相机。只在你信任的网络上打开。
                      </p>
                      <p className="mt-1 text-[11px] leading-[1.5] text-muted">
                        画面本身在侧边栏「Physical AI › Camera」里看——那边已经是这套端口的客户端，这里不重复一遍 WebRTC。
                      </p>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-95 disabled:opacity-50"
                        disabled={!simulatorReady || starting || activeRun != null}
                        onClick={() => void start()}
                        data-testid="embodied-start"
                      >
                        <Icon name={starting ? "refresh" : "diamond"} size={13} />
                        {starting ? "正在起…" : "开跑"}
                      </button>
                      {activeRun ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:bg-panel hover:text-ink"
                          onClick={() => void cancel()}
                        >
                          <Icon name="x" size={13} />
                          取消
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={CARD}>
                  <CardHead
                    icon="audit"
                    title="准入阶梯"
                    right={
                      <Pill>
                        每级 ≥{env.minimum_stage_attempts} 次 · ≥{(env.minimum_stage_success_rate * 100).toFixed(0)}%
                      </Pill>
                    }
                  />
                  <Ladder env={env} run={selected} />
                </div>

                {/* Runs are persisted, so past evidence is consumable: pick one and read its whole
                    verdict again. A surface that forgot the last run would be a demo. */}
                <div className={CARD}>
                  <CardHead icon="library" title="运行历史" right={<Pill>{runs.length}</Pill>} />
                  {runs.length ? (
                    <ul className="max-h-[300px] overflow-y-auto hairline-scroll" data-testid="embodied-run-list">
                      {runs.map((run) => {
                        const runHalt = run.halted ? HALT_COPY[run.halted] : null;
                        const current = run.run_id === selectedId;
                        return (
                          <li key={run.run_id} className="border-t border-line first:border-t-0">
                            <button
                              type="button"
                              aria-current={current ? "true" : undefined}
                              className={`flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors ${
                                current ? "bg-accentSoft" : "hover:bg-paper"
                              }`}
                              onClick={() => setSelectedId(run.run_id)}
                            >
                              <span className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{run.run_id}</span>
                                <Pill tone={isActive(run) ? "accent" : runHalt?.tone ?? (run.state === "error" ? "danger" : "neutral")}>
                                  {isActive(run) ? "进行中" : runHalt?.zh ?? run.state}
                                </Pill>
                              </span>
                              <span className="flex items-center gap-2 text-[10.5px] text-faint">
                                <span>
                                  {dayOf(run.created_at)} {clockOf(run.created_at)}
                                </span>
                                <span>每级 {run.request.attempts_per_stage} 次</span>
                                <span>{run.request.control_frequency_hz} Hz</span>
                                {run.blocking_hardware.length ? (
                                  <span className="ml-auto text-danger">阻塞 {run.blocking_hardware.length}</span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="px-3 py-4 text-[11.5px] text-muted">还没有运行。跑一次之后，它的裁决会一直留在这里。</p>
                  )}
                </div>
              </section>

              {/* ------------------------------------------------ 本次运行 */}
              <section className="flex min-w-0 flex-col gap-4" aria-label="本次运行">
                <div className={CARD}>
                  <CardHead
                    icon="wrench"
                    title="标定：速率是量出来的，不是设出来的"
                    right={
                      <Pill>
                        预算 {env.velocity_budget_rps.toFixed(3)} rad/s = 上限 × {env.velocity_margin}
                      </Pill>
                    }
                  />
                  {selected?.calibration?.measurements.length ? (
                    <>
                      <div>
                        {selected.calibration.measurements.map((m) => (
                          <MeasurementRow key={m.commanded_rate_rps} m={m} env={env} />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
                        <div className="bg-panel px-3 py-2">
                          <span className="block text-[10.5px] text-muted">准入速率</span>
                          <b
                            className={`font-mono text-[13px] ${selected.calibration.admitted ? "text-ok" : "text-danger"}`}
                            data-testid="embodied-admitted-rate"
                          >
                            {selected.calibration.admitted
                              ? `${selected.calibration.admitted.commanded_rate_rps} rad/s`
                              : "无"}
                          </b>
                        </div>
                        <div className="bg-panel px-3 py-2">
                          <span className="block text-[10.5px] text-muted">目标容差（由实测下垂决定）</span>
                          <b className="font-mono text-[13px] text-ink">
                            {selected.goal ? `${selected.goal.tolerance_rad.toFixed(4)} rad` : "—"}
                          </b>
                        </div>
                      </div>
                      {selected.calibration.findings.length ? (
                        <ul>
                          {selected.calibration.findings.map((finding) => (
                            <ReasonItem key={finding} reason={finding} tone="warn" />
                          ))}
                        </ul>
                      ) : null}
                      <p className="border-t border-line px-3 py-2 text-[11px] leading-[1.55] text-faint">
                        下发的是请求，实测峰值才是机器人的回答；停下来之后残留的静态下垂决定了目标容差的下限——比它更紧的容差永远达不到。
                      </p>
                    </>
                  ) : (
                    <p className="px-3 py-4 text-[11.5px] text-muted">
                      同一段动作，{env.candidate_rates_rps.join(" / ")} rad/s 各飞一遍，由慢到快，记录实际的关节峰值速度。
                    </p>
                  )}
                </div>

                {selected ? (
                  <div className={CARD}>
                    <CardHead
                      icon="branch"
                      title="阶段尝试"
                      right={
                        focusStage ? (
                          <Pill tone={focusStage.next_stage_admitted ? "ok" : "warn"}>
                            {stageLabel(focusStage.stage)}
                          </Pill>
                        ) : (
                          <Pill>未开始</Pill>
                        )
                      }
                    />
                    {selected.stages.length ? (
                      <div className="flex flex-col gap-3 p-3">
                        {selected.stages.map((stage) => (
                          <div key={stage.campaign_id} className="min-w-0">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                              <span className="text-[12.5px] font-medium text-ink">{stageLabel(stage.stage)}</span>
                              <code className="font-mono text-[10px] text-faint">{stage.stage}</code>
                              <span className="ml-auto font-mono text-[10.5px] text-muted">
                                {stage.successes}/{stage.executed_attempts} 成功 · 成功率{" "}
                                {(stage.evidence.success_rate * 100).toFixed(0)}%
                              </span>
                            </div>
                            {typeof env.stage_offsets_rad[stage.stage] === "number" ? (
                              <p className="mb-1.5 text-[10.5px] text-faint">
                                起始扰动 ≤ {(env.stage_offsets_rad[stage.stage] * 1000).toFixed(0)} mrad
                              </p>
                            ) : null}
                            <AttemptGrid report={stage} />
                            {stage.halt_detail ? (
                              <div className="mt-2">
                                <ReasonItem reason={stage.halt_detail} tone={stage.completed ? "warn" : "danger"} />
                              </div>
                            ) : null}
                            {!stage.fidelity.represents ? (
                              <div className="mt-1.5 rounded-lg border border-line bg-dangerSoft px-2.5 py-2">
                                <p className="text-[11.5px] text-danger">
                                  这个环境不代表证据所属的构型，在里面迭代只会积累关于另一套配置的数字。
                                </p>
                                {stage.fidelity.findings.map((finding) => (
                                  <RawReason key={finding} text={finding} />
                                ))}
                              </div>
                            ) : null}
                            {stage.next_stage_blocking_reasons.length ? (
                              <ul className="mt-1.5 rounded-lg border border-line">
                                {stage.next_stage_blocking_reasons.map((reason) => (
                                  <ReasonItem key={reason} reason={reason} tone="warn" />
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="px-3 py-4 text-[11.5px] text-muted">
                        这次运行在任何阶段开始之前就停下了——标定或目标推导阶段的拒绝，比任何一次尝试都更早。
                      </p>
                    )}
                  </div>
                ) : null}

                <div className={CARD}>
                  <CardHead
                    icon="fileCode"
                    title="运行事件"
                    right={
                      selected ? (
                        <Pill tone={isActive(selected) ? "accent" : "neutral"}>
                          {isActive(selected) ? "进行中" : watching ? "刚刚结束" : "回放"}
                        </Pill>
                      ) : null
                    }
                  />
                  <Feed lines={feed} />
                </div>
              </section>

              {/* ------------------------------------------------ 阻塞项 */}
              <section className="flex min-w-0 flex-col gap-4" aria-label="阻塞项">
                <div className={CARD}>
                  <CardHead
                    icon="shield"
                    title="裁决"
                    right={
                      selected?.halted ? (
                        <Pill tone={halt?.tone ?? "neutral"}>{selected.halted}</Pill>
                      ) : selected ? (
                        <Pill tone="accent">{selected.state}</Pill>
                      ) : null
                    }
                  />
                  {selected ? (
                    <div className="p-3">
                      <p className="text-[12.5px] font-medium text-ink" data-testid="embodied-halt">
                        {halt?.zh ?? (selected.state === "error" ? "运行失败" : isActive(selected) ? "正在跑" : selected.state)}
                      </p>
                      {selected.halt_detail ? <RawReason text={selected.halt_detail} /> : null}
                      {selected.error ? <RawReason text={selected.error} /> : null}
                      <dl className="mt-2.5 grid grid-cols-1 gap-1 font-mono text-[10.5px] text-muted">
                        <div className="flex justify-between gap-2">
                          <dt>技能版本</dt>
                          <dd className="truncate text-ink">{selected.skill_version_id}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>本体摘要</dt>
                          <dd className="truncate text-ink">{selected.embodiment_digest}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>环境</dt>
                          <dd className="truncate text-ink">{selected.environment_id}</dd>
                        </div>
                        {selected.required_duration_s != null ? (
                          <div className="flex justify-between gap-2">
                            <dt>需要时长</dt>
                            <dd className="text-ink">{selected.required_duration_s.toFixed(2)}s</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ) : (
                    <p className="px-3 py-4 text-[11.5px] text-muted">选一次运行，这里会给出它停下来的原因。</p>
                  )}
                </div>

                <div className={CARD}>
                  <CardHead
                    icon="diamond"
                    title="真机之前还差什么"
                    right={
                      selected?.hardware_decision ? (
                        <Pill tone={selected.hardware_decision.admitted ? "ok" : "danger"}>
                          {selected.hardware_decision.admitted ? "已准入" : "未准入"}
                        </Pill>
                      ) : null
                    }
                  />
                  {selected?.blocking_hardware.length ? (
                    <ul data-testid="embodied-blocking">
                      {selected.blocking_hardware.map((reason) => (
                        <ReasonItem key={reason} reason={reason} />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-4 text-[11.5px] text-muted">
                      {selected
                        ? "这次运行没有留下真机阻塞项——不代表可以上真机，只代表这一项没有话说。"
                        : "运行结束后，这里会列出人站在会动的机器人旁边之前还差什么。"}
                    </p>
                  )}
                  {selected?.hardware_decision ? (
                    <p className="border-t border-line px-3 py-2 font-mono text-[10.5px] text-faint">
                      证据摘要 {selected.hardware_decision.evidence_digest} · 目标级{" "}
                      {stageLabel(selected.hardware_decision.target_stage)}
                    </p>
                  ) : null}
                </div>

                <div className={CARD}>
                  <CardHead icon="table" title="仿真覆盖不到的事实" right={<Pill>无条件成立</Pill>} />
                  <ul>
                    {env.unrepresentable.map((item) => (
                      <li key={item} className="border-t border-line px-3 py-2 first:border-t-0">
                        <p className="break-words font-mono text-[11px] leading-[1.55] text-muted">{item}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t border-line px-3 py-2 text-[11px] leading-[1.55] text-faint">
                    这些不是评估结论，而是无条件陈述：再逼真的场景也不会把它们变成真的。
                  </p>
                </div>

                <div className={CARD}>
                  <CardHead icon="image" title="仿真相机" right={<Pill tone="warn">无鉴权</Pill>} />
                  <ul>
                    {env.camera_slots.map((slot) => (
                      <li key={slot.id} className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-ink">{slot.label}</span>
                          <span className="block font-mono text-[10.5px] text-faint">
                            {slot.width}×{slot.height} · :{slot.port}
                          </span>
                        </span>
                        <Pill tone={selected?.preview.watching && selected.run_id === selectedId ? "accent" : "neutral"}>
                          {selected?.preview.watching ? "已发布" : "未发布"}
                        </Pill>
                      </li>
                    ))}
                  </ul>
                  {selected?.preview.host ? (
                    <p className="border-t border-line px-3 py-2 font-mono text-[10.5px] text-faint">
                      主机 {selected.preview.host}
                    </p>
                  ) : null}
                </div>

                <div className={CARD}>
                  <CardHead icon="fileCode" title="技能契约" right={<Pill>{env.skill.kind}</Pill>} />
                  <div className="p-3">
                    <p className="font-mono text-[11.5px] text-ink">{env.skill.version_id}</p>
                    <p className="mt-1 text-[11.5px] leading-[1.55] text-muted">{env.skill.summary}</p>
                    <dl className="mt-2 flex flex-col gap-1.5 text-[10.5px]">
                      <div>
                        <dt className="text-muted">前置条件</dt>
                        <dd className="font-mono text-faint">{env.skill.preconditions.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">后置条件</dt>
                        <dd className="font-mono text-faint">{env.skill.postconditions.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">中止条件</dt>
                        <dd className="font-mono text-faint">{env.skill.abort_conditions.join(" · ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">最长时长 / 评审人</dt>
                        <dd className="font-mono text-faint">
                          {env.skill.max_duration_s}s · {env.skill.reviewed_by}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

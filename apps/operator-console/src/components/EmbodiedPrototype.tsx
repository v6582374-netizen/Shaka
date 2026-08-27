// PROTOTYPE PLAN: three structurally different surfaces for the Embodied Execution profile,
// on ?prototype=embodied, switchable via ?variant=A|B|C.
//
//   A — 治理工作台   three columns: 场景/阶梯 · 实时运行 · 阻塞项。什么都不用导航离开。
//   B — 单问题叙事   一次只回答一个问题，纵向推进，读完就懂为什么它拒绝。
//   C — 证据台账     逐次尝试的表格 + 侧栏裁决，为"看很多次运行"设计。
//
// All three drive the SAME simulated run (embodiedPrototypeModel.ts), whose stages, thresholds,
// refusal wording and calibration numbers are copied from the real `vegapunk/embodied/` modules
// and from what scripts/run_embodied_bench.py actually measured on the MuJoCo G1 scene.
//
// The prototype's real job is to make the REFUSALS visible. A screenshot of a passing run teaches
// nothing about a governance skeleton; watching it say no, and seeing exactly which rung said it,
// is the whole point. Hence the scenario picker.
//
// Actions are inert. Nothing is persisted, nothing talks to the backend, no robot moves.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import {
  CAMERA_SLOTS,
  ENVELOPE,
  GOAL_OFFSETS_RAD,
  JOINT_SHORT,
  JOINTS,
  LADDER,
  MINIMUM_STAGE_ATTEMPTS,
  MINIMUM_STAGE_SUCCESS_RATE,
  SCENARIOS,
  SCOPE,
  STAGE_OFFSET_RAD,
  STAND_RAD,
  UNREPRESENTABLE,
  VELOCITY_BUDGET_RPS,
  VELOCITY_MARGIN,
  driveRun,
  emptyRun,
  explainBlocking,
  useSpringValue,
  type Attempt,
  type Measurement,
  type RunState,
  type ScenarioKey,
  type StageDef,
  type StageResult,
} from "./embodiedPrototypeModel";
import "./embodied-prototype.css";

type VariantKey = "A" | "B" | "C";
const VARIANTS: Array<{ key: VariantKey; name: string }> = [
  { key: "A", name: "治理工作台" },
  { key: "B", name: "单问题叙事" },
  { key: "C", name: "证据台账" },
];

/* ------------------------------------------------------------------ the run, shared */

function useRun() {
  const [scenario, setScenario] = useState<ScenarioKey>("nominal");
  const [run, setRun] = useState<RunState>(() => emptyRun("nominal"));
  const stop = useRef<(() => void) | null>(null);

  const start = useCallback((key: ScenarioKey, speed = 1) => {
    stop.current?.();
    setScenario(key);
    setRun(emptyRun(key));
    stop.current = driveRun(key, speed, (next) => setRun((s) => next(s)));
  }, []);

  const reset = useCallback((key: ScenarioKey) => {
    stop.current?.();
    setScenario(key);
    setRun(emptyRun(key));
  }, []);

  useEffect(() => () => stop.current?.(), []);
  return { scenario, run, start, reset };
}

/* ------------------------------------------------------------------ shared pieces */

function Bar({ pct, tone }: { pct: number; tone?: "done" | "stop" }) {
  const v = useSpringValue(Math.max(0, Math.min(100, pct)));
  return (
    <div className={`eb-bar${tone === "done" ? " eb-bar--done" : tone === "stop" ? " eb-bar--stop" : ""}`}>
      <i style={{ transform: `scaleX(${(v / 100).toFixed(4)})` }} />
    </div>
  );
}

/** The measured peak against the budget. The budget marker is what the fill can visibly cross. */
function Meter({ m }: { m: Measurement }) {
  const full = ENVELOPE.maxJointVelocityRps;
  const v = useSpringValue((m.peakRps / full) * 100);
  return (
    <div className={`eb-meter${m.fits ? "" : " is-over"}`}>
      <i style={{ transform: `scaleX(${Math.min(1, v / 100).toFixed(4)})` }} />
      <div className="eb-meter-budget" style={{ left: `${(VELOCITY_BUDGET_RPS / full) * 100}%` }} />
      <span>
        <b>下发 {m.commandedRps.toFixed(2)}</b>
        <span style={{ color: m.fits ? "var(--ok)" : "var(--danger)" }}>
          实测峰值 {m.peakRps.toFixed(3)} rad/s
        </span>
      </span>
    </div>
  );
}

function ScenarioPicker({
  active,
  onPick,
}: {
  active: ScenarioKey;
  onPick: (key: ScenarioKey) => void;
}) {
  return (
    <div className="eb-scenarios">
      {SCENARIOS.map((s) => (
        <button
          key={s.key}
          type="button"
          className="eb-scenario"
          aria-pressed={s.key === active}
          onClick={() => onPick(s.key)}
        >
          <strong>
            <span className={`eb-pill eb-pill--${s.tone}`}>
              <span className="eb-dot" />
              {s.tone === "ok" ? "通过" : s.tone === "warn" ? "中止" : "拒绝"}
            </span>
            {s.label}
          </strong>
          <small>{s.premise}</small>
          <em>→ {s.teaches}</em>
        </button>
      ))}
    </div>
  );
}

function rungState(def: StageDef, run: RunState): { cls: string; badge: React.ReactNode } {
  const result = run.stages.find((s) => s.stage === def.key);
  if (!def.simulated) {
    return {
      cls: "eb-rung--closed",
      badge: <span className="eb-pill">仿真无法达成</span>,
    };
  }
  if (run.liveStage === def.key) {
    return {
      cls: "eb-rung--live",
      badge: (
        <span className="eb-pill eb-pill--live">
          <span className="eb-dot eb-dot--pulse" />
          进行中 {result?.attempts.length ?? 0}/{result?.planned ?? MINIMUM_STAGE_ATTEMPTS}
        </span>
      ),
    };
  }
  if (!result) return { cls: "", badge: <span className="eb-pill">未开始</span> };
  if (result.nextStageAdmitted) {
    return {
      cls: "eb-rung--earned",
      badge: (
        <span className="eb-pill eb-pill--ok">
          {result.successes}/{result.attempts.length} 已打开下一级
        </span>
      ),
    };
  }
  return {
    cls: "eb-rung--stop",
    badge: (
      <span className="eb-pill eb-pill--stop">
        {result.successes}/{result.attempts.length} 未打开
      </span>
    ),
  };
}

function Ladder({ run }: { run: RunState }) {
  return (
    <div className="eb-ladder">
      {LADDER.map((def, i) => {
        const { cls, badge } = rungState(def, run);
        return (
          <div key={def.key} className={`eb-rung ${cls}`}>
            <span className="eb-step">{i + 1}</span>
            <span>
              <strong>{def.label}</strong>
              <small>{def.question}</small>
              {def.whyNotSimulated ? <small className="eb-why">{def.whyNotSimulated}</small> : null}
            </span>
            {badge}
          </div>
        );
      })}
    </div>
  );
}

/** Commanded vs measured, per joint. The visible gap is the servo lag calibration measured. */
function JointReadout({ run }: { run: RunState }) {
  const span = 0.6;
  return (
    <div className="eb-joints">
      {JOINTS.map((_, i) => {
        const base = STAND_RAD[i];
        const set = ((run.setpointRad[i] - base) / span + 0.5) * 100;
        const meas = ((run.measuredRad[i] - base) / span + 0.5) * 100;
        return (
          <div className="eb-joint" key={i}>
            <span>{JOINT_SHORT[i]}</span>
            <div className="eb-joint-track">
              <div className="eb-zero" style={{ left: "50%" }} />
              <div className="eb-set" style={{ left: `${Math.max(2, Math.min(98, set))}%` }} />
              <div className="eb-meas" style={{ left: `${Math.max(2, Math.min(98, meas))}%` }} />
            </div>
            <span className="eb-num" style={{ color: GOAL_OFFSETS_RAD[i] ? "var(--ink)" : "var(--faint)" }}>
              {(run.measuredRad[i] - base >= 0 ? "+" : "") + (run.measuredRad[i] - base).toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AttemptGrid({ result, run }: { result: StageResult | undefined; run: RunState }) {
  const planned = result?.planned ?? MINIMUM_STAGE_ATTEMPTS;
  const attempts = result?.attempts ?? [];
  const halted = result?.halted === "aborted";
  return (
    <div className="eb-attempts">
      {Array.from({ length: planned }, (_, i) => {
        const a = attempts[i];
        const live = run.liveAttempt?.stage === result?.stage && run.liveAttempt?.index === i;
        const never = !a && halted;
        const cls = a
          ? a.outcome === "succeeded"
            ? "eb-attempt--ok"
            : "eb-attempt--abort"
          : never
            ? "eb-attempt--never"
            : "";
        return (
          <div
            key={i}
            className={`eb-attempt ${cls}${live ? " eb-attempt--live" : ""}`}
            title={
              a
                ? `${a.runId} · ${a.outcome} · 峰值 ${a.peakRps.toFixed(3)} rad/s`
                : never
                  ? "中止之后这次尝试不会发生：没有自动重试"
                  : "尚未尝试"
            }
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

function Log({ run, max }: { run: RunState; max?: number }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.log.length]);
  const kindLabel: Record<string, string> = {
    measure: "measure",
    attempt: "attempt",
    refuse: "refuse",
    abort: "abort",
    evidence: "evidence",
    verdict: "verdict",
  };
  const lines = max ? run.log.slice(-max) : run.log;
  return (
    <ul className="eb-log" ref={ref}>
      {lines.map((l, i) => (
        <li key={i} data-kind={l.kind}>
          <b>{kindLabel[l.kind]}</b>
          <span>{l.text}</span>
        </li>
      ))}
      {!lines.length ? (
        <li data-kind="verdict">
          <b>idle</b>
          <span>选一个场景，然后开跑。</span>
        </li>
      ) : null}
    </ul>
  );
}

function BlockingList({ run }: { run: RunState }) {
  if (!run.blockingHardware.length) {
    return (
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
        运行结束后，这里会列出人站在会动的机器人旁边之前还差什么。
      </p>
    );
  }
  return (
    <ul className="eb-blocking">
      {run.blockingHardware.map((reason, i) => {
        const said = explainBlocking(reason);
        return (
          <li key={i}>
            <span>✕</span>
            <span>
              {said.zh}
              {said.src ? <code>{said.src}</code> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Unrepresentable() {
  return (
    <ul className="eb-unrep">
      {UNREPRESENTABLE.map((item) => (
        <li key={item.title}>
          <span>{item.title}</span>
          <span>{item.body}</span>
        </li>
      ))}
    </ul>
  );
}

function Cameras() {
  return (
    <div className="eb-cams">
      {CAMERA_SLOTS.map((c) => (
        <div className="eb-cam" key={c.id}>
          <span>
            {c.label}
            <br />
            <span className="eb-mono">
              {c.width}×{c.height} · :{c.port}
            </span>
          </span>
          <span className="eb-pill">
            <Icon name="image" size={11} />
            WebRTC
          </span>
        </div>
      ))}
    </div>
  );
}

function CardHeader({ icon, title, right }: { icon: IconName; title: string; right?: React.ReactNode }) {
  return (
    <header>
      <Icon name={icon} size={13} />
      {title}
      <span className="eb-spacer" />
      {right}
    </header>
  );
}

function RunControls({
  scenario,
  run,
  start,
  reset,
}: {
  scenario: ScenarioKey;
  run: RunState;
  start: (key: ScenarioKey, speed?: number) => void;
  reset: (key: ScenarioKey) => void;
}) {
  const busy = run.phase === "calibrating" || run.phase === "staging";
  return (
    <>
      <button type="button" className="eb-btn eb-btn--primary" onClick={() => start(scenario, busy ? 3 : 1)}>
        <Icon name={busy ? "refresh" : "diamond"} size={13} />
        {busy ? "重新开跑" : run.phase === "settled" ? "再跑一次" : "开跑"}
      </button>
      <button type="button" className="eb-btn" onClick={() => start(scenario, 4)}>
        <Icon name="clock" size={13} />
        快进
      </button>
      <button type="button" className="eb-btn" onClick={() => reset(scenario)}>
        <Icon name="x" size={13} />
        清空
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ VARIANT A */

function VariantA({ scenario, run, start, reset }: ReturnType<typeof useRun>) {
  const live = run.liveStage ? run.stages.find((s) => s.stage === run.liveStage) : undefined;
  const focus = live ?? run.stages[run.stages.length - 1];
  return (
    <div className="eb-a">
      <section>
        <div className="eb-card">
          <CardHeader icon="sliders" title="场景" />
          <div className="eb-pad">
            <ScenarioPicker
              active={scenario}
              onPick={(key) => {
                reset(key);
                start(key);
              }}
            />
          </div>
        </div>
        <div className="eb-card">
          <CardHeader icon="image" title="仿真相机" right={<span className="eb-pill">无鉴权</span>} />
          <div className="eb-pad">
            <Cameras />
          </div>
        </div>
      </section>

      <section className="eb-a-center">
        <div className="eb-card">
          <CardHeader
            icon="wrench"
            title="标定：速率是量出来的，不是设出来的"
            right={
              <span className="eb-pill">
                预算 {VELOCITY_BUDGET_RPS.toFixed(2)} rad/s = 上限 × {VELOCITY_MARGIN}
              </span>
            }
          />
          <div className="eb-pad">
            {run.measurements.length ? (
              run.measurements.map((m) => <Meter key={m.commandedRps} m={m} />)
            ) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>
                同一段动作，三个候选速率各飞一遍，由慢到快。
              </p>
            )}
            <div className="eb-grid2">
              <div className="eb-stat">
                <span>准入速率</span>
                <b style={{ color: run.admittedRps ? "var(--ok)" : "var(--danger)" }}>
                  {run.admittedRps ? `${run.admittedRps} rad/s` : "无"}
                </b>
              </div>
              <div className="eb-stat">
                <span>目标容差（由实测下垂决定）</span>
                <b>{run.goalToleranceRad ? `${run.goalToleranceRad.toFixed(4)} rad` : "—"}</b>
              </div>
            </div>
          </div>
        </div>

        <div className="eb-card">
          <CardHeader
            icon="audit"
            title="准入阶梯"
            right={
              <span className="eb-pill">
                每级 ≥{MINIMUM_STAGE_ATTEMPTS} 次 · ≥{(MINIMUM_STAGE_SUCCESS_RATE * 100).toFixed(0)}% 成功
              </span>
            }
          />
          <div className="eb-pad">
            <Ladder run={run} />
            {focus ? (
              <>
                <div className="eb-label">
                  {focus.stage} · 起始扰动 ≤ {(STAGE_OFFSET_RAD[focus.stage] * 1000).toFixed(0)} mrad
                </div>
                <AttemptGrid result={focus} run={run} />
              </>
            ) : null}
          </div>
        </div>

        <div className="eb-card">
          <CardHeader
            icon="fileCode"
            title="运行日志"
            right={<Bar pct={run.progress * 100} tone={run.halted && run.halted !== "completed" ? "stop" : run.progress >= 1 ? "done" : undefined} />}
          />
          <div>
            <Log run={run} />
          </div>
        </div>
      </section>

      <section>
        <div className="eb-card">
          <CardHeader icon="branch" title="关节：下发 vs 实测" />
          <div className="eb-pad">
            <JointReadout run={run} />
            <p style={{ margin: 0, color: "var(--faint)", fontSize: 10.5, lineHeight: 1.5 }}>
              空心是下发的设定点，实心是量到的位置。两者的间隙就是伺服的静态下垂——目标容差不能比它更紧。
            </p>
          </div>
        </div>
        <div className="eb-card">
          <CardHeader
            icon="shield"
            title="真机之前还差什么"
            right={run.halted ? <span className={`eb-pill eb-pill--${run.halted === "completed" ? "ok" : "stop"}`}>{run.halted}</span> : null}
          />
          <div className="eb-pad">
            <BlockingList run={run} />
            {run.quarantined ? (
              <p style={{ margin: 0, color: "var(--danger)", fontSize: 11.5 }}>
                配置已被隔离：{run.quarantined}。需要具名的人清除，没有自动重试。
              </p>
            ) : null}
          </div>
        </div>
        <div className="eb-card">
          <CardHeader icon="diamond" title="仿真覆盖不到的事实" />
          <div className="eb-pad">
            <Unrepresentable />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ VARIANT B */

function VariantB({ scenario, run, start, reset }: ReturnType<typeof useRun>) {
  const def = SCENARIOS.find((s) => s.key === scenario)!;
  const stop = run.halted && run.halted !== "completed";
  return (
    <div className="eb-b">
      <div className="eb-b-inner">
        <div className="eb-b-hero">
          <span className="eb-label">具身执行 · 内层闭环</span>
          <h2>在有人站到会动的机器人旁边之前，这套东西必须先说出「不行」。</h2>
          <p>
            下面按顺序回答四个问题。前两个可以在仿真里回答，后两个按构造不能。每一步的结论都由拥有它的模块产出，
            这个界面不做任何判断。
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <RunControls scenario={scenario} run={run} start={start} reset={reset} />
          </div>
        </div>

        <div className="eb-b-step">
          <h3>
            <i>01</i> 这台构型能被指令多快？
          </h3>
          <p>
            不设定，而是测。同一段动作用三个候选速率各飞一遍，记录实际的关节峰值速度。
            位置伺服会冲过头，所以「速度上限」绝不能直接当成「下发指令」。
          </p>
          {run.measurements.length ? (
            run.measurements.map((m) => <Meter key={m.commandedRps} m={m} />)
          ) : (
            <div className="eb-card">
              <div className="eb-pad">
                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{def.premise}</span>
              </div>
            </div>
          )}
          {run.admittedRps ? (
            <p style={{ color: "var(--ink)" }}>
              准入 <b className="eb-num">{run.admittedRps} rad/s</b> —— 实测峰值落进预算的最快一档。
            </p>
          ) : null}
        </div>

        <div className="eb-b-step">
          <h3>
            <i>02</i> 这个测量值反过来约束目标
          </h3>
          <p>
            量出的伺服静态下垂决定了目标位姿的容差不能设得更紧，否则机器人明明到位了、系统却每次都报「验证失败」——
            那是把配置错误伪装成物理故障。
          </p>
          <div className="eb-card">
            <div className="eb-pad eb-grid2">
              <div className="eb-stat">
                <span>目标容差</span>
                <b>{run.goalToleranceRad ? `${run.goalToleranceRad.toFixed(4)} rad` : "—"}</b>
              </div>
              <div className="eb-stat eb-stat--muted">
                <span>这段动作需要</span>
                <b>{run.requiredDurationS ? `${run.requiredDurationS.toFixed(2)} s` : "—"}</b>
              </div>
            </div>
          </div>
        </div>

        <div className="eb-b-step">
          <h3>
            <i>03</i> 按阶梯顺序演练，一级也不能跳
          </h3>
          <p>
            每级至少 {MINIMUM_STAGE_ATTEMPTS} 次、成功率不低于 {(MINIMUM_STAGE_SUCCESS_RATE * 100).toFixed(0)}%。
            两级用不同的起始扰动区分：第一级问「能不能干成」，第二级问「波动能不能吸收」。
          </p>
          <Ladder run={run} />
          {run.stages.map((s) => (
            <div key={s.stage}>
              <div className="eb-label">
                {s.stage} · 扰动 ≤ {(STAGE_OFFSET_RAD[s.stage] * 1000).toFixed(0)} mrad
              </div>
              <AttemptGrid result={s} run={run} />
            </div>
          ))}
        </div>

        <div className={`eb-b-verdict${stop ? " is-stop" : run.halted === "completed" ? " is-ok" : ""}`}>
          <h3>
            <i>04</i> 结论：仿真证据永远不能批准真机
          </h3>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
            {run.haltDetail || "运行结束后，这里会给出停在哪一步、以及为什么。"}
          </p>
          <BlockingList run={run} />
          <div>
            <div className="eb-label">仿真覆盖不到的事实</div>
            <Unrepresentable />
          </div>
        </div>

        <div className="eb-b-step">
          <h3>
            <i>05</i> 换一个场景，看它换一种方式拒绝
          </h3>
          <ScenarioPicker
            active={scenario}
            onPick={(key) => {
              reset(key);
              start(key);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ VARIANT C */

function VariantC({ scenario, run, start, reset }: ReturnType<typeof useRun>) {
  const rows = useMemo(() => {
    const all: Attempt[] = [];
    run.stages.forEach((s) => all.push(...s.attempts));
    return all;
  }, [run.stages]);

  const totalPlanned = run.stages.reduce((a, s) => a + s.planned, 0);
  const succeeded = rows.filter((r) => r.outcome === "succeeded").length;

  return (
    <div className="eb-c">
      <div className="eb-c-strip">
        <div className="eb-card">
          <div className="eb-pad eb-stat">
            <span>准入速率</span>
            <b style={{ color: run.admittedRps ? "var(--ok)" : "var(--danger)" }}>
              {run.admittedRps ? `${run.admittedRps}` : "无"}
              <span style={{ fontSize: 11, color: "var(--faint)" }}> rad/s</span>
            </b>
          </div>
        </div>
        <div className="eb-card">
          <div className="eb-pad eb-stat">
            <span>已执行 / 计划</span>
            <b>
              {rows.length}
              <span style={{ fontSize: 11, color: "var(--faint)" }}> / {totalPlanned || "—"}</span>
            </b>
          </div>
        </div>
        <div className="eb-card">
          <div className="eb-pad eb-stat">
            <span>成功率</span>
            <b style={{ color: rows.length && succeeded / rows.length >= MINIMUM_STAGE_SUCCESS_RATE ? "var(--ok)" : "var(--danger)" }}>
              {rows.length ? `${((succeeded / rows.length) * 100).toFixed(0)}%` : "—"}
            </b>
          </div>
        </div>
        <div className="eb-card">
          <div className="eb-pad eb-stat">
            <span>停机原因</span>
            <b style={{ fontSize: 12, color: run.halted && run.halted !== "completed" ? "var(--danger)" : "var(--ok)" }}>
              {run.halted ?? "—"}
            </b>
          </div>
        </div>
      </div>

      <div className="eb-c-body">
        <div className="eb-card">
          <CardHeader
            icon="table"
            title="逐次尝试"
            right={
              <span className="eb-pill">
                作用域 {SCOPE.skillVersionId} · {SCOPE.embodimentDigest}
              </span>
            }
          />
          <div>
            <table className="eb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>run_id</th>
                  <th>阶段</th>
                  <th>起始扰动</th>
                  <th>峰值 rad/s</th>
                  <th>时长 s</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bound = Math.max(...r.offsetsRad.map((v) => Math.abs(v)));
                  const live = run.liveAttempt?.runId === r.runId;
                  return (
                    <tr key={r.runId} data-outcome={r.outcome} data-live={live ? "true" : undefined}>
                      <td className="eb-td-mono">{r.index + 1}</td>
                      <td className="eb-td-mono">{r.runId}</td>
                      <td className="eb-td-mono">{r.stage}</td>
                      <td className="eb-num">{(bound * 1000).toFixed(1)} mrad</td>
                      <td className="eb-num">{r.peakRps.toFixed(3)}</td>
                      <td className="eb-num">{r.durationS.toFixed(2)}</td>
                      <td>
                        <span className={`eb-pill eb-pill--${r.outcome === "succeeded" ? "ok" : "stop"}`}>
                          {r.outcome === "succeeded" ? "成功" : r.abortCause ?? r.outcome}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} style={{ color: "var(--muted)", padding: "14px 10px" }}>
                      还没有尝试。选一个场景开跑。
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <caption>
                成功次数由轨迹账本计数，不由迭代驱动自己统计——一个既能跑实验又能给实验打分的组件，
                是整个系统里唯一有能力虚报的地方。
              </caption>
            </table>
          </div>
        </div>

        <div className="eb-c-side">
          <div className="eb-card">
            <CardHeader icon="sliders" title="场景" />
            <div className="eb-pad">
              <ScenarioPicker
                active={scenario}
                onPick={(key) => {
                  reset(key);
                  start(key);
                }}
              />
            </div>
          </div>
          <div className="eb-card">
            <CardHeader icon="audit" title="阶梯" />
            <div className="eb-pad">
              <Ladder run={run} />
            </div>
          </div>
          <div className="eb-card">
            <CardHeader icon="shield" title="真机之前还差什么" />
            <div className="eb-pad">
              <BlockingList run={run} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ switcher + shell */

function Picker({
  current,
  onChange,
  onReplay,
}: {
  current: VariantKey;
  onChange: (key: VariantKey) => void;
  onReplay: () => void;
}) {
  const nav = useRef<HTMLElement | null>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState({ left: 0, width: 0 });

  const index = VARIANTS.findIndex((v) => v.key === current);

  const measure = useCallback(() => {
    const el = items.current[index];
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [index]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Enable the slide only after first paint, so load doesn't animate.
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = Number.parseInt(e.key, 10);
      if (num >= 1 && num <= VARIANTS.length) onChange(VARIANTS[num - 1].key);
      else if (e.key === "ArrowRight") onChange(VARIANTS[(index + 1) % VARIANTS.length].key);
      else if (e.key === "ArrowLeft")
        onChange(VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length].key);
      else if (e.key === "r" || e.key === "R") onReplay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onChange, onReplay]);

  return (
    <nav
      ref={nav}
      className="proto-picker"
      aria-label="Prototype variants"
      {...(ready ? { "data-ready": "" } : {})}
    >
      <span
        className="proto-picker-highlight"
        aria-hidden="true"
        style={{ width: `${box.width}px`, transform: `translateX(${box.left}px)` }}
      />
      {VARIANTS.map((v, i) => (
        <button
          key={v.key}
          type="button"
          ref={(el) => {
            items.current[i] = el;
          }}
          className="proto-picker-item"
          onClick={() => onChange(v.key)}
          {...(v.key === current ? { "data-active": "", "aria-current": "true" as const } : {})}
        >
          {v.name}
        </button>
      ))}
      <span className="proto-picker-divider" aria-hidden="true" />
      <button
        type="button"
        className="proto-picker-item proto-picker-replay"
        aria-label="Replay animation (R)"
        onClick={onReplay}
      >
        ↻
      </button>
    </nav>
  );
}

function readVariant(): VariantKey {
  const raw = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.some((v) => v.key === raw) ? (raw as VariantKey) : "A";
}

export function EmbodiedPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  // Bumped to re-mount the active variant, so entrance motion re-runs.
  const [mount, setMount] = useState(0);
  const state = useRun();

  const replay = useCallback(() => setMount((n) => n + 1), []);

  const change = useCallback((key: VariantKey) => {
    const params = new URLSearchParams(window.location.search);
    params.set("prototype", "embodied");
    params.set("variant", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    setVariant(key);
    setMount((n) => n + 1);
  }, []);

  useEffect(() => {
    const onPop = () => setVariant(readVariant());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="eb">
      <div>
        <div className="eb-top">
          <h1>具身执行 · 可靠性</h1>
          <div className="eb-scope">
            <span>
              环境 <b>{SCOPE.environmentId}</b>
            </span>
            <span>
              技能 <b>{SCOPE.skillVersionId}</b>
            </span>
            <span>
              本体 <b>{SCOPE.embodimentDigest}</b>
            </span>
            <span>
              节拍 <b>{SCOPE.controlHz} Hz</b>
            </span>
          </div>
          <span className="eb-spacer" />
          {variant !== "B" ? (
            <RunControls scenario={state.scenario} run={state.run} start={state.start} reset={state.reset} />
          ) : null}
        </div>
        <div className="eb-ribbon">
          <b>一次性 UI 研究</b>
          <span>
            仿真本体的摘要与真机不同，所以这里的任何证据在物理上不可能被读成关于真机的证据。控件是惰性的，没有机器人在动。
          </span>
        </div>
      </div>
      <div key={`${variant}-${mount}`} className="eb-stage">
        {variant === "A" ? <VariantA {...state} /> : null}
        {variant === "B" ? <VariantB {...state} /> : null}
        {variant === "C" ? <VariantC {...state} /> : null}
      </div>
      <Picker current={variant} onChange={change} onReplay={replay} />
    </div>
  );
}

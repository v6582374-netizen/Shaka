import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getG1MonitorSnapshot, type G1MonitorSnapshot } from "../api";
import { Icon } from "./Icon";

const POLL_LIVE_MS = 1_000;
const G1Hologram = lazy(async () => ({ default: (await import("./G1Hologram")).G1Hologram }));

type Tone = "ok" | "warn" | "danger" | "muted";
type ConnectionPhase = "idle" | "checking" | "connected" | "unavailable" | "error";

const number = (value: number | null, digits = 0): string | null =>
  value == null || !Number.isFinite(value) ? null : value.toFixed(digits);

const errorMessage = (caught: unknown): string => {
  const status = typeof caught === "object" && caught !== null && "status" in caught ? (caught as { status?: number }).status : undefined;
  if (status === 404) return "本机尚未启动 G1 只读监控桥接。";
  return caught instanceof Error && caught.message ? caught.message : "暂时无法读取 G1 的连接状态。";
};

/** A real wired connection is represented by the live DDS state envelope, not a cached BMS value or camera socket. */
const isLiveG1Connection = (snapshot: G1MonitorSnapshot): boolean => snapshot.state_stream.state === "live";

function Dot({ tone }: { tone: Tone }) {
  const fill = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warnInk" : tone === "danger" ? "bg-danger" : "bg-faint";
  return <i className={`g1-status-dot h-1.5 w-1.5 shrink-0 rounded-full ${fill}`} aria-hidden="true" />;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const color = tone === "ok"
    ? "border-ok/25 bg-okSoft text-ok"
    : tone === "warn"
      ? "border-warnInk/25 bg-warnSoft text-warnInk"
      : tone === "danger"
        ? "border-danger/25 bg-dangerSoft text-danger"
        : "border-line bg-paper text-muted";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${color}`}><Dot tone={tone} />{children}</span>;
}

function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="g1-info-hint group relative inline-flex align-middle">
      <button type="button" className="g1-info-trigger" aria-label={`说明：${label}`}>
        ?
      </button>
      <span role="tooltip" className="g1-info-tooltip">{children}</span>
    </span>
  );
}

function VitalLabel({ position, label, description, value, detail, tone = "muted" }: {
  position: string;
  label: string;
  description: string;
  value: string | null;
  detail: string;
  tone?: Tone;
}) {
  return (
    <section className={`g1-vital-label ${position}`}>
      <div className="g1-vital-label-head">
        <Dot tone={tone} />
        <span>{label}</span>
        <InfoHint label={label}>{description}</InfoHint>
      </div>
      <b className={value == null ? "is-empty" : undefined}>{value ?? "—"}</b>
      <p title={detail}>{detail}</p>
    </section>
  );
}

function HologramVitalsStage({ snapshot, phase, error }: {
  snapshot: G1MonitorSnapshot | null;
  phase: ConnectionPhase;
  error: string | null;
}) {
  const live = snapshot != null;
  const bms = live && snapshot.bms.state === "live" ? snapshot.bms : null;
  const stream = live ? snapshot.state_stream : null;
  const message = phase === "connected"
    ? "正在接收实时 DDS 状态流；断开后读数将立即清空。"
    : phase === "unavailable"
      ? "尚未观测到实时 DDS 状态流。投影保留，所有读数保持为空。"
      : phase === "error"
        ? "连接检测未完成。投影保留，所有读数保持为空。"
        : "投影已就绪。点击“连接 G1”后读取有线状态流。";
  return (
    <section className="g1-vitals-stage" aria-label="G1 全息体征界面" data-testid="g1-vitals-stage">
      <div className="g1-vitals-grid" aria-hidden="true" />
      <div className="g1-vitals-orbit orbit-one" aria-hidden="true" />
      <div className="g1-vitals-orbit orbit-two" aria-hidden="true" />
      <VitalLabel position="is-soc" label="荷电状态 / SOC" description="当前可用电量占电池额定容量的比例，由 BMS 的 SOC 字段提供。" value={bms?.soc_percent == null ? null : `${number(bms.soc_percent)}%`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-soh" label="电池健康度 / SOH" description="电池可维持容量相对出厂标称容量的比例，由 BMS 的 SOH 字段提供。" value={bms?.soh_percent == null ? null : `${number(bms.soh_percent)}%`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-voltage" label="包电压" description="BMS 报告的首个有效电池包电压槽位；不会把未定义语义的多个槽位相加。" value={bms?.pack_voltage_v == null ? null : `${number(bms.pack_voltage_v, 1)} V`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-current" label="电池电流" description="BMS 报告的电池包瞬时电流；负号表示电池向外供电，正号表示正在充电。" value={bms?.pack_current_a == null ? null : `${number(bms.pack_current_a, 1)} A`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-power" label="瞬时功率" description="由当前包电压与电池电流相乘得到的瞬时功率，仅在两项读数都有效时显示。" value={bms?.power_w == null ? null : `${number(bms.power_w)} W`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-temperature" label="BMS 温度" description="BMS 上报温度中的最高值，用于了解当前电池包的最高测得温度，并非安全阈值判断。" value={bms?.temperature_c == null ? null : `${number(bms.temperature_c, 1)} °C`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-spread" label="电芯压差" description="已上报电芯电压中的最大值减最小值，反映当前样本内的电芯电压离散度。" value={bms?.cell_voltage_spread_v == null ? null : `${number(bms.cell_voltage_spread_v, 3)} V`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <VitalLabel position="is-cycles" label="循环次数" description="BMS 记录的电池循环计数，用于描述累计使用历史，不表示本次运行时长。" value={bms?.cycle_count == null ? null : `${number(bms.cycle_count)} 次`} detail={bms ? "BMS 实时读数" : "等待 BMS 读数"} tone={bms ? "ok" : "muted"} />
      <div className="g1-vitals-hologram">
        <Suspense fallback={<section className="g1-hologram is-unavailable" aria-label="Unitree G1 静态外观全息投影" />}>
          <G1Hologram streamState={stream?.state ?? "unavailable"} />
        </Suspense>
      </div>
      <footer className={`g1-vitals-message is-${phase}`} data-testid="g1-monitor-connection-state">
        <Pill tone={phase === "connected" ? "ok" : phase === "unavailable" || phase === "error" ? "warn" : "muted"}>{phase === "connected" ? "实时观测" : "数据待接入"}</Pill>
        <p>{message}</p>
        {error ? <span role="alert">{error}</span> : null}
      </footer>
    </section>
  );
}

export function G1MonitorView() {
  const [snapshot, setSnapshot] = useState<G1MonitorSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ConnectionPhase>("idle");

  const connect = useCallback(async () => {
    setPhase("checking");
    setError(null);
    try {
      const next = await getG1MonitorSnapshot();
      if (!isLiveG1Connection(next)) {
        setSnapshot(null);
        setPhase("unavailable");
        return;
      }
      setSnapshot(next);
      setPhase("connected");
    } catch (caught) {
      setSnapshot(null);
      setError(errorMessage(caught));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (phase !== "connected") return;
    let alive = true;
    const timer = window.setInterval(() => {
      void getG1MonitorSnapshot()
        .then((next) => {
          if (!alive) return;
          if (!isLiveG1Connection(next)) {
            setSnapshot(null);
            setPhase("unavailable");
            return;
          }
          setSnapshot(next);
        })
        .catch((caught) => {
          if (!alive) return;
          setSnapshot(null);
          setError(errorMessage(caught));
          setPhase("error");
        });
    }, POLL_LIVE_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [phase]);

  return (
    <main className="g1-status-page min-w-0 flex-1 overflow-y-auto hairline-scroll" data-testid="g1-monitor">
      <div className="g1-status-shell mx-auto w-full max-w-[1480px] px-5 py-6 sm:px-7">
        <header className="g1-status-intro">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-faint">PHYSICAL AI / LIVE TELEMETRY</p>
            <h2>Body Status</h2>
            <p>只呈现此刻从有线 G1 读到的信号；无法观测的内容保持为空，不作推断。</p>
          </div>
          <div className="g1-status-actions">
            <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
              <InfoHint label="连接检测">以实时 DDS 状态封包作为 G1 有线连接的确认依据；检测全程只读。</InfoHint>
              {phase === "connected" ? "已连接 · 自动更新" : "需要手动检测"}
            </span>
            <button type="button" className="g1-connect-action" disabled={phase === "checking"} onClick={connect}>
              <Icon name={phase === "checking" ? "clock" : phase === "connected" ? "refresh" : "plug"} size={15} />
              {phase === "checking" ? "正在检测…" : phase === "connected" ? "刷新连接" : "连接 G1"}
            </button>
          </div>
        </header>

        <div className="g1-monitor-entrance">
          <HologramVitalsStage snapshot={snapshot} phase={phase} error={error} />
        </div>
      </div>
    </main>
  );
}

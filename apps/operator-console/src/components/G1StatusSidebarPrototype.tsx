// PROTOTYPE PLAN: three dedicated G1 monitoring pages, switchable via
// ?prototype=g1-status&variant=A|B|C. The question is what a focused monitor
// must show first — not where another sidebar belongs.
//
// A — 监控总览: everyday supervision. B — 信号台: liveness first.
// C — 参数检视: compact diagnosis. All values are in-memory fixtures.
// "当前链路" leaves BMS fields unavailable because the browser has no BMS API.

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import "./g1-status-sidebar-prototype.css";

type VariantKey = "A" | "B" | "C";
type SourceMode = "current" | "bms" | "stale";
type Tone = "ok" | "warn" | "danger" | "muted";

const VARIANTS: Array<{ key: VariantKey; name: string }> = [
  { key: "A", name: "监控总览" },
  { key: "B", name: "信号台" },
  { key: "C", name: "参数检视" },
];
const MODES: Array<{ key: SourceMode; label: string }> = [
  { key: "current", label: "当前链路" },
  { key: "bms", label: "BMS 模拟" },
  { key: "stale", label: "状态陈旧" },
];

const snapshots = {
  current: { stream: "在线", tone: "ok", age: "18 ms", sequence: 483_291, rate: "30 Hz", camera: "3 / 3", control: "已发现", bms: "未接入浏览器", bmsTone: "muted", soc: null, soh: null, voltage: null, current: null, power: null, temp: null, spread: null, cycle: null },
  bms: { stream: "在线", tone: "ok", age: "18 ms", sequence: 483_291, rate: "30 Hz", camera: "3 / 3", control: "已发现", bms: "模拟桥接", bmsTone: "ok", soc: 68, soh: 94, voltage: "75.8 V", current: "−6.4 A", power: "485 W 放电", temp: "28 °C", spread: "0.05 V", cycle: "132 次" },
  stale: { stream: "陈旧", tone: "danger", age: "3.2 s", sequence: 483_291, rate: "—", camera: "未知", control: "未知", bms: "不可采信", bmsTone: "danger", soc: null, soh: null, voltage: null, current: null, power: null, temp: null, spread: null, cycle: null },
} as const;
type Snapshot = (typeof snapshots)[SourceMode];

function readVariant(): VariantKey {
  const raw = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.some((item) => item.key === raw) ? (raw as VariantKey) : "A";
}
function Dot({ tone = "muted" }: { tone?: Tone }) { return <i className={`g1m-dot g1m-dot--${tone}`} aria-hidden="true" />; }
function Battery({ value }: { value: number | null }) { return <span className={`g1m-battery${value == null ? " is-empty" : ""}`} aria-hidden="true"><i style={{ transform: `scaleX(${value == null ? 0 : Math.max(value / 100, 0.06)})` }} /></span>; }
function Value({ value, fallback = "未接入" }: { value: string | number | null; fallback?: string }) { return <b className={value == null ? "g1m-value is-unavailable" : "g1m-value"}>{value ?? fallback}</b>; }

function MonitorNav() {
  return <aside className="g1m-nav" aria-label="应用导航（原型）"><header className="g1m-brand"><Icon name="logo" size={18} /><b>OpenWorker</b></header><div className="g1m-nav-label">Physical AI</div><nav><button type="button" className="is-current"><Icon name="database" size={16} /><span>Body Status</span><Dot tone="ok" /></button><button type="button"><Icon name="image" size={16} /><span>相机</span></button><button type="button"><Icon name="shield" size={16} /><span>具身执行</span></button></nav><footer><span className="g1m-nav-prototype">Prototype</span><small>只读监控 · 不发送指令</small></footer></aside>;
}

function PageHeader({ snapshot }: { snapshot: Snapshot }) {
  return <header className="g1m-header"><div className="g1m-breadcrumb"><span>Physical AI</span><Icon name="chevronRight" size={12} /><b>Body Status</b></div><div className="g1m-header-main"><div><h1>Body Status</h1><p>读数先说明来源与新鲜度；无法观测的字段保持为空。</p></div><div className="g1m-connection"><span><Dot tone={snapshot.tone} /> 状态流 {snapshot.stream}</span><b>最后更新 {snapshot.age} 前</b></div></div></header>;
}

function StreamStrip({ snapshot }: { snapshot: Snapshot }) {
  const cells = [
    [<><Dot tone={snapshot.tone} /> G1 状态封包</>, snapshot.stream, "rt/vegapunk/g1/state_envelope"],
    [<><Icon name="clock" size={14} /> 数据年龄</>, snapshot.age, "目标：连续且单调递增"],
    [<><Icon name="refresh" size={14} /> 最新序号</>, snapshot.sequence.toLocaleString(), snapshot.rate === "—" ? "频率不可得" : `观察频率 ${snapshot.rate}`],
    [<><Icon name="image" size={14} /> 相机源</>, snapshot.camera, "物理流状态"],
  ];
  return <section className="g1m-stream-strip" aria-label="状态流摘要">{cells.map(([label, value, detail], index) => <div key={index}><span>{label as ReactNode}</span><b className={index === 2 ? "g1m-mono" : ""}>{value as string}</b><small>{detail as string}</small></div>)}</section>;
}

function EnergyCard({ snapshot, mode }: { snapshot: Snapshot; mode: SourceMode }) {
  const unavailable = snapshot.soc == null;
  return <section className={`g1m-energy-card${unavailable ? " is-unavailable" : ""}`}><header><span className="g1m-card-title"><Battery value={snapshot.soc} /> 电池</span><span className="g1m-source-tag"><Dot tone={snapshot.bmsTone as Tone} /> {snapshot.bms}</span></header><div className="g1m-energy-value"><Value value={snapshot.soc == null ? null : `${snapshot.soc}%`} fallback={mode === "stale" ? "状态不可采信" : "等待 BMS"} /><span>荷电状态</span></div>{snapshot.soh != null ? <div className="g1m-energy-health"><span>健康度</span><b>{snapshot.soh}%</b></div> : null}<p>{unavailable ? "当前 Web 接口未提供 BMS 数据。电机电压不能替代电池总压。" : "模拟读数，仅用于判断监控页面的信息密度。"}</p><div className="g1m-energy-line"><i style={{ transform: `scaleX(${snapshot.soc == null ? 0 : snapshot.soc / 100})` }} /></div></section>;
}

function PowerMetrics({ snapshot }: { snapshot: Snapshot }) {
  const rows: Array<[string, string | null]> = [["电池总压", snapshot.voltage], ["电池电流", snapshot.current], ["瞬时功率", snapshot.power], ["BMS 温度", snapshot.temp], ["电芯压差", snapshot.spread], ["循环次数", snapshot.cycle]];
  return <section className="g1m-panel g1m-power" aria-label="电池与 BMS"><header><span className="g1m-card-title"><Icon name="sliders" size={15} /> 电池与 BMS</span><small>只展示有语义的汇总值</small></header><div className="g1m-metric-grid">{rows.map(([label, value]) => <div key={label}><span>{label}</span><Value value={value} /></div>)}</div></section>;
}

function SystemHealth({ snapshot }: { snapshot: Snapshot }) {
  const rows: Array<[string, string, Tone]> = [["DDS 状态流", snapshot.stream, snapshot.tone as Tone], ["相机源", snapshot.camera, snapshot.camera === "3 / 3" ? "ok" : snapshot.camera === "未知" ? "danger" : "muted"], ["控制入口", snapshot.control, snapshot.control === "已发现" ? "ok" : "muted"], ["BMS 桥接", snapshot.bms, snapshot.bmsTone as Tone]];
  return <section className="g1m-panel g1m-system" aria-label="链路与设备状态"><header><span className="g1m-card-title"><Icon name="plug" size={15} /> 链路状态</span><small>不以“正常”推断未观测项</small></header><dl>{rows.map(([label, value, tone]) => <div key={label}><dt><Dot tone={tone} /> {label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function VariantA({ snapshot, mode }: { snapshot: Snapshot; mode: SourceMode }) { return <><StreamStrip snapshot={snapshot} /><section className="g1m-overview"><EnergyCard snapshot={snapshot} mode={mode} /><PowerMetrics snapshot={snapshot} /><SystemHealth snapshot={snapshot} /></section></>; }

function SignalCard({ icon, title, state, detail, tone }: { icon: "database" | "sliders" | "image" | "plug"; title: string; state: string; detail: string; tone: Tone }) { return <article className={`g1m-signal is-${tone}`}><span className="g1m-signal-icon"><Icon name={icon} size={16} /></span><div><b>{title}</b><small>{detail}</small></div><span className="g1m-signal-state"><Dot tone={tone} /> {state}</span></article>; }

function VariantB({ snapshot, mode }: { snapshot: Snapshot; mode: SourceMode }) {
  const bmsTone: Tone = snapshot.soc != null ? "ok" : mode === "stale" ? "danger" : "warn";
  const cameraTone: Tone = snapshot.camera === "3 / 3" ? "ok" : snapshot.camera === "未知" ? "danger" : "muted";
  return <section className="g1m-signal-layout"><section className="g1m-live-card"><span className="g1m-eyebrow">当前正在被观察</span><h2>{snapshot.stream === "在线" ? "状态流持续到达" : "状态流已不再新鲜"}</h2><p>{snapshot.stream === "在线" ? `最近一帧距现在 ${snapshot.age}，序号 ${snapshot.sequence.toLocaleString()}。` : `最近一帧已过去 ${snapshot.age}；所有动态读数应当降级。`}</p><div className="g1m-live-track"><i className={snapshot.stream === "在线" ? "is-live" : "is-stale"} /></div><div className="g1m-live-meta"><span>来源 <b>state_envelope</b></span><span>频率 <b>{snapshot.rate}</b></span></div></section><section className="g1m-signal-list" aria-label="信号源状态"><SignalCard icon="database" title="G1 状态封包" state={snapshot.stream} detail={`数据年龄 ${snapshot.age}`} tone={snapshot.tone as Tone} /><SignalCard icon="sliders" title="BMS" state={snapshot.bms} detail={snapshot.soc == null ? "SOC、总压与健康度均不会猜测" : `SOC ${snapshot.soc}% · ${snapshot.voltage}`} tone={bmsTone} /><SignalCard icon="image" title="物理相机" state={snapshot.camera} detail="三个物理视频源" tone={cameraTone} /><SignalCard icon="plug" title="控制入口" state={snapshot.control} detail="本页不发送控制命令" tone={snapshot.control === "已发现" ? "ok" : "muted"} /></section><aside className="g1m-side-energy"><EnergyCard snapshot={snapshot} mode={mode} /><PowerMetrics snapshot={snapshot} /></aside></section>;
}

function InspectGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="g1m-inspect-group"><header>{title}</header>{children}</section>; }
function InspectRow({ label, value, tone }: { label: string; value: string | number | null; tone?: Tone }) { return <div className="g1m-inspect-row"><span>{tone ? <Dot tone={tone} /> : null}{label}</span><Value value={value} /></div>; }

function VariantC({ snapshot, mode }: { snapshot: Snapshot; mode: SourceMode }) {
  return <section className="g1m-inspector-layout"><section className="g1m-inspector-summary"><span className="g1m-eyebrow">G1 / LIVE INSPECTOR</span><div><Battery value={snapshot.soc} /><Value value={snapshot.soc == null ? null : `${snapshot.soc}%`} fallback="—" /><span>荷电</span></div><div><span /><Value value={snapshot.voltage} fallback="—" /><span>总压</span></div><div><span /><Value value={snapshot.age} /><span>数据年龄</span></div><p>{mode === "current" ? "当前链路：BMS 数据尚未接入。" : mode === "bms" ? "BMS 读数均为原型模拟。" : "状态陈旧：禁止据此判断现场。"}</p></section><section className="g1m-inspector-groups"><InspectGroup title="状态流"><InspectRow label="DDS 状态" value={snapshot.stream} tone={snapshot.tone as Tone} /><InspectRow label="数据年龄" value={snapshot.age} /><InspectRow label="最新序号" value={snapshot.sequence.toLocaleString()} /><InspectRow label="观察频率" value={snapshot.rate} /></InspectGroup><InspectGroup title="电池 / BMS"><InspectRow label="BMS 桥接" value={snapshot.bms} tone={snapshot.bmsTone as Tone} /><InspectRow label="荷电状态" value={snapshot.soc == null ? null : `${snapshot.soc}%`} /><InspectRow label="健康度" value={snapshot.soh == null ? null : `${snapshot.soh}%`} /><InspectRow label="包电压" value={snapshot.voltage} /><InspectRow label="电流 / 功率" value={snapshot.current == null ? null : `${snapshot.current} · ${snapshot.power}`} /><InspectRow label="温度 / 循环" value={snapshot.temp == null ? null : `${snapshot.temp} · ${snapshot.cycle}`} /><InspectRow label="电芯压差" value={snapshot.spread} /></InspectGroup><InspectGroup title="外围源"><InspectRow label="物理相机" value={snapshot.camera} /><InspectRow label="控制入口" value={snapshot.control} /></InspectGroup></section></section>;
}

function Switcher({ variant, mode, onVariant, onMode }: { variant: VariantKey; mode: SourceMode; onVariant: (key: VariantKey) => void; onMode: (key: SourceMode) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant); const cycle = (step: number) => onVariant(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key);
  return <nav className="g1m-switcher" aria-label="原型切换器"><button type="button" onClick={() => cycle(-1)} aria-label="上一个布局"><Icon name="arrowLeft" size={15} /></button><span>{variant} · {VARIANTS[index].name}</span><button type="button" className="g1m-switch-next" onClick={() => cycle(1)} aria-label="下一个布局"><Icon name="arrowLeft" size={15} /></button><i /><div>{MODES.map((item) => <button type="button" key={item.key} onClick={() => onMode(item.key)} aria-pressed={mode === item.key}>{item.label}</button>)}</div></nav>;
}

export function G1StatusSidebarPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant); const [mode, setMode] = useState<SourceMode>("current"); const snapshot = snapshots[mode];
  const changeVariant = useCallback((next: VariantKey) => { const params = new URLSearchParams(window.location.search); params.set("prototype", "g1-status"); params.set("variant", next); window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`); setVariant(next); }, []);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; if (target?.matches("input, textarea, [contenteditable='true']") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const index = VARIANTS.findIndex((item) => item.key === variant); changeVariant(VARIANTS[(index + (event.key === "ArrowRight" ? 1 : -1) + VARIANTS.length) % VARIANTS.length].key); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [changeVariant, variant]);
  const state = useMemo(() => `layout=${variant}; source=${mode}; stream=${snapshot.stream}; age=${snapshot.age}; BMS=${snapshot.bms}; camera=${snapshot.camera}; sequence=${snapshot.sequence}`, [variant, mode, snapshot]);
  return <div className="g1m"><MonitorNav /><main className="g1m-main"><PageHeader snapshot={snapshot} /><div className="g1m-content">{variant === "A" ? <VariantA snapshot={snapshot} mode={mode} /> : null}{variant === "B" ? <VariantB snapshot={snapshot} mode={mode} /> : null}{variant === "C" ? <VariantC snapshot={snapshot} mode={mode} /> : null}</div></main><output className="g1m-state">原型状态 <code>{state}</code></output><Switcher variant={variant} mode={mode} onVariant={changeVariant} onMode={setMode} /></div>;
}

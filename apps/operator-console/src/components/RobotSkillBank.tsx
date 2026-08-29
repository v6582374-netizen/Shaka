import { useState } from "react";
import { Icon } from "./Icon";
import "./robot-skill-bank.css";

// Robot Skill Bank is deliberately read-only for now. It presents the current action-asset
// evidence without treating a candidate implementation as an invocable robot capability.

type FactTone = "blocked" | "pending" | "verified";

type EvidenceFact = {
  label: string;
  value: string;
  note: string;
  tone: FactTone;
};

type RobotAsset = {
  id: string;
  name: string;
  revision: string;
  state: "候选实现" | "展示资产";
  proof: string;
  nextGate: string;
  facts: EvidenceFact[];
};

const NO_EVIDENCE_FACTS: EvidenceFact[] = [
  { label: "执行完成", value: "未记录", note: "仅用于目录展示，不代表一次真实执行。", tone: "pending" },
  { label: "命令被跟踪", value: "未记录", note: "尚无可审查的动作轨迹。", tone: "pending" },
  { label: "独立结果确认", value: "未记录", note: "尚无独立任务判定。", tone: "pending" },
];

const CURRENT_ASSET: RobotAsset = {
  id: "yellow-button-contact",
  name: "黄色按钮接触",
  revision: "c-017",
  state: "候选实现",
  proof: "0 项独立确认成功",
  nextGate: "先完成回放与零写入检查，再允许一次诊断性调用。",
  facts: [
    { label: "执行完成", value: "没有合格调用记录", note: "目前没有一次执行进入可审查范围。", tone: "blocked" },
    { label: "命令被跟踪", value: "没有轨迹证据", note: "尚未记录任何受控动作轨迹。", tone: "blocked" },
    { label: "独立结果确认", value: "没有 Oracle 结果", note: "目标任务尚未被独立确认。", tone: "blocked" },
  ],
};

const DISPLAY_ASSET_NAMES = [
  "红色按钮接触",
  "双手托盘抬升",
  "右臂指向目标",
  "前进 0.5 米",
  "原地转向 90°",
  "双手递送物体",
  "识别并抓取方块",
  "门把手下压",
  "避障后靠近工位",
  "坐姿到站姿",
];

const ACTION_ASSETS: RobotAsset[] = [
  CURRENT_ASSET,
  ...DISPLAY_ASSET_NAMES.map((name, index) => ({
    id: `display-action-${index + 1}`,
    name,
    revision: `展示-${String(index + 1).padStart(2, "0")}`,
    state: "展示资产" as const,
    proof: "展示数据，不代表实测机器人结果",
    nextGate: "补齐动作合同、独立验证证据与回滚路径后，才能进入评估。",
    facts: NO_EVIDENCE_FACTS,
  })),
];

function StatusPill({ state }: { state: RobotAsset["state"] }) {
  return <span className={`robot-skill-bank__state robot-skill-bank__state--${state === "候选实现" ? "candidate" : "display"}`}>{state}</span>;
}

function EvidenceFactCard({ fact }: { fact: EvidenceFact }) {
  return (
    <article className={`robot-skill-bank__fact robot-skill-bank__fact--${fact.tone}`}>
      <span><i aria-hidden="true" />{fact.label}</span>
      <strong>{fact.value}</strong>
      <small>{fact.note}</small>
    </article>
  );
}

function BundleContents() {
  return (
    <div className="robot-skill-bank__bundle-list" aria-label="安装包所需内容">
      {[
        ["contract.yaml", "前置条件与后置条件"],
        ["implementation.yaml", "冻结后的动作实现"],
        ["runtime/", "安全链独占适配器"],
        ["verifier/ + evidence/", "独立验证与 EpisodeArtifact"],
        ["lineage.yaml + rollback.yaml", "来源、版本与回滚路径"],
      ].map(([name, description]) => (
        <div key={name}>
          <Icon name="fileCode" size={14} />
          <span><strong>{name}</strong><small>{description}</small></span>
        </div>
      ))}
    </div>
  );
}

export function RobotSkillBank() {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(CURRENT_ASSET.id);
  const selectedAsset = ACTION_ASSETS.find((asset) => asset.id === selectedId) ?? CURRENT_ASSET;

  return (
    <div className="robot-skill-bank">
      <aside className="robot-skill-bank__rail" aria-label="动作资产">
        <div className="robot-skill-bank__brand"><Icon name="logo" size={18} /><span>Vegapunk</span></div>
        <div className="robot-skill-bank__rail-heading"><span>机器人技能库 · 11 项</span><strong>动作资产</strong></div>
        <div className="robot-skill-bank__asset-list">
          {ACTION_ASSETS.map((asset) => (
            <button key={asset.id} className={`robot-skill-bank__asset${asset.id === selectedAsset.id ? " is-selected" : ""}`} type="button" aria-current={asset.id === selectedAsset.id ? "page" : undefined} onClick={() => { setSelectedId(asset.id); setEvidenceOpen(false); }}>
              <span className="robot-skill-bank__asset-icon"><Icon name="fileCode" size={15} /></span>
              <span><strong>{asset.name}</strong><small>{asset.revision}</small></span>
              <StatusPill state={asset.state} />
            </button>
          ))}
        </div>
        <p className="robot-skill-bank__rail-rule"><Icon name="shield" size={13} />候选和展示资产都可检查，但绝不获得动作调用权。</p>
      </aside>

      <div className="robot-skill-bank__content">
        <header className="robot-skill-bank__header">
          <div><span>具身智能 / 机器人动作资产</span><h1>技能库</h1></div>
          <div className="robot-skill-bank__selection"><span>当前资产</span><strong>{selectedAsset.name} <em>{selectedAsset.revision}</em></strong><StatusPill state={selectedAsset.state} /></div>
        </header>

        <main className="robot-skill-bank__main">
          <section className="robot-skill-bank__hero">
            <div>
              <span>就绪度，而非成功分数</span>
              <h2>{selectedAsset.name}<em>{selectedAsset.revision}</em></h2>
              <p>{selectedAsset.proof}。{selectedAsset.state === "候选实现" ? "候选实现仅代表正在评估的方案；它不是机器人可调用的动作资产。" : "该条目用于展示技能库容量，不代表一个已习得或已验证的机器人动作。"}</p>
            </div>
            <div className="robot-skill-bank__next-gate">
              <span>下一道不可逆门槛</span>
              <strong>{selectedAsset.nextGate}</strong>
              <button type="button" onClick={() => setEvidenceOpen((open) => !open)}>{evidenceOpen ? "收起证据" : "查看证据"}<Icon name={evidenceOpen ? "chevronDown" : "chevronRight"} size={14} /></button>
            </div>
          </section>

          <section className="robot-skill-bank__section" aria-labelledby="robot-skill-facts">
            <div className="robot-skill-bank__section-head">
              <div><span>三类独立事实</span><h2 id="robot-skill-facts">当前真正已知的内容</h2></div>
              <p>执行、轨迹记录和独立结果确认不能被压缩成一个“成功”状态。</p>
            </div>
            <div className="robot-skill-bank__fact-grid">{selectedAsset.facts.map((fact) => <EvidenceFactCard key={fact.label} fact={fact} />)}</div>
          </section>

          {evidenceOpen && (
            <section className="robot-skill-bank__evidence" aria-label="证据详情">
              <div><span>当前证据边界</span><strong>{selectedAsset.state === "候选实现" ? "候选产物已冻结，等待回放与零写入检查。" : "展示条目没有接入任何机器人观测或训练记录。"}</strong><small>没有符合安装条件的 EpisodeArtifact；因此不存在可签发的动作版本。</small></div>
              <div><span>失败路由</span><strong>下一步优先排除 oracle_or_recording</strong><small>在出现独立确认前，不把任何执行记录解释为任务成功。</small></div>
              <div><span>执行权限</span><strong>安全链保持独占</strong><small>UI、模型与候选实现都不能直接拥有电机控制权。</small></div>
            </section>
          )}

          <section className="robot-skill-bank__two-up">
            <article className="robot-skill-bank__panel">
              <span>调用边界</span><h2>安全链拥有电机。</h2>
              <p>任何动作调用都必须经过 <code>检查前置条件 → 调用 → 观察进展 → 中止/恢复 → 验证后置条件</code>。不满足前置条件时必须弃权，不能试探。</p>
              <div className="robot-skill-bank__chips"><span>诊断模式 · 单回合假设</span><span>训练模式 · 受硬边界约束</span></div>
            </article>
            <article className="robot-skill-bank__panel">
              <span>安装条件</span><h2>把能力做成可回滚资产。</h2>
              <BundleContents />
            </article>
          </section>

          <section className="robot-skill-bank__progression" aria-label="动作资产晋级路径">
            <span>晋级路径</span>
            <div><strong className="is-current">{selectedAsset.state}</strong><i /><strong>新鲜重置下的独立复现</strong><i /><strong>封存安装包与回滚</strong></div>
          </section>
        </main>
      </div>
    </div>
  );
}

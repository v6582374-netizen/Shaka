import { useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./skills-manager-prototype.css";

// PROTOTYPE PLAN: the A Desktop Skills Manager layout on ?prototype=skills-manager.
// The selected Skill can enter the retained upstream Editor state. Actions are intentionally inert.

type VariantKey = "A";
type PageKey = "skills" | "tools" | "settings" | "editor";

type SkillRow = {
  id: string;
  description: string;
  scope: string;
  targets: string;
  source: string;
  status: "Healthy" | "Broken projection" | "Disabled" | "Read-only";
  statusTone: "ok" | "warn" | "muted" | "info";
  updated: string;
};

const VARIANTS: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: "A", name: "Split inventory", description: "Persistent list + source detail with external editor" },
];

const PAGE_NAV: Array<{ key: PageKey; label: string; icon: IconName; upstream: boolean }> = [
  { key: "skills", label: "Skills", icon: "sparkle", upstream: true },
  { key: "tools", label: "Tools", icon: "wrench", upstream: true },
  { key: "settings", label: "Settings", icon: "gear", upstream: true },
  { key: "editor", label: "Editor", icon: "fileCode", upstream: true },
];

const SKILLS: SkillRow[] = [
  {
    id: "codebase-memory",
    description: "Navigate and query a repository knowledge graph.",
    scope: "Global",
    targets: "Claude Code · Codex",
    source: "~/.skills-manager/skills/codebase-memory",
    status: "Healthy",
    statusTone: "ok",
    updated: "12 min ago",
  },
  {
    id: "gh-axi",
    description: "Operate GitHub through the local gh-axi bridge.",
    scope: "Global",
    targets: "Kiro · Trae",
    source: "~/.agents/skills/gh-axi",
    status: "Broken projection",
    statusTone: "warn",
    updated: "2 hours ago",
  },
  {
    id: "paper-tools",
    description: "Read, annotate, and transform research papers.",
    scope: "Project",
    targets: "Codex · Gemini CLI",
    source: ".agents/skills/paper-tools",
    status: "Disabled",
    statusTone: "muted",
    updated: "Yesterday",
  },
  {
    id: "frontend-design",
    description: "Design and review interface surfaces with a local plugin.",
    scope: "Plugin cache",
    targets: "Claude Code",
    source: "~/.claude/plugins/cache/frontend-design",
    status: "Read-only",
    statusTone: "info",
    updated: "3 days ago",
  },
];

const TOOLS = [
  { name: "Claude Code", path: "~/.claude/skills", detected: "Detected", enabled: "67 linked" },
  { name: "Codex", path: "~/.codex/skills", detected: "Detected", enabled: "28 user · 6 system" },
  { name: "Cursor", path: "~/.cursor/skills", detected: "User path missing", enabled: "18 built-in" },
  { name: "Gemini CLI", path: "~/.gemini/skills", detected: "User path missing", enabled: ".agents fallback" },
];

function getInitialVariant(): VariantKey {
  return "A";
}

function setPrototypeVariant(next: VariantKey) {
  const params = new URLSearchParams(window.location.search);
  params.set("prototype", "skills-manager");
  params.set("variant", next);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function StatusPill({ tone, children }: { tone: SkillRow["statusTone"]; children: ReactNode }) {
  return <span className={`sm-proto-status sm-proto-status--${tone}`}><i aria-hidden="true" />{children}</span>;
}

function SourceTag({ children, tone = "upstream" }: { children: ReactNode; tone?: "upstream" | "desktop" | "warning" }) {
  return <span className={`sm-proto-source-tag sm-proto-source-tag--${tone}`}>{children}</span>;
}

function ActionButton({ children, onClick, primary = false }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" className={`sm-proto-button${primary ? " sm-proto-button--primary" : ""}`} onClick={onClick}>{children}</button>;
}

function PageNav({ active, onChange }: { active: PageKey; onChange: (page: PageKey) => void }) {
  return (
    <nav className="sm-proto-inner-nav" aria-label="Skills Manager pages">
      <div className="sm-proto-inner-nav-heading">
        <span className="sm-proto-eyebrow">UPSTREAM SURFACE</span>
        <strong>Skills Manager</strong>
      </div>
      <div className="sm-proto-inner-nav-list">
        {PAGE_NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            className={active === item.key ? "is-active" : undefined}
            onClick={() => onChange(item.key)}
          >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
            {item.key === "skills" && <span className="sm-proto-nav-count">67</span>}
          </button>
        ))}
      </div>
      <div className="sm-proto-inner-nav-foot">
        <div className="sm-proto-legend-row"><SourceTag>UPSTREAM</SourceTag><span>behavior preserved</span></div>
        <div className="sm-proto-legend-row"><SourceTag tone="desktop">DESKTOP</SourceTag><span>outer shell only</span></div>
      </div>
    </nav>
  );
}

function DesktopRail({ active, onBack }: { active: boolean; onBack: () => void }) {
  const items: Array<{ label: string; icon: IconName; selected?: boolean }> = [
    { label: "Coworker", icon: "diamond" },
    { label: "Chat", icon: "chat" },
    { label: "Code", icon: "code" },
    { label: "Skills Manager", icon: "sparkle", selected: active },
  ];
  return (
    <aside className="sm-proto-desktop-rail">
      <div className="sm-proto-brand"><Icon name="logo" size={17} /><span>Vegapunk</span><em>DESKTOP</em></div>
      <div className="sm-proto-rail-label">WORKSPACES</div>
      <div className="sm-proto-rail-list">
        {items.map((item) => (
          <button key={item.label} type="button" className={item.selected ? "is-active" : undefined} onClick={item.selected ? undefined : onBack}>
            <Icon name={item.icon} size={16} /><span>{item.label}</span>{item.selected && <b>●</b>}
          </button>
        ))}
      </div>
      <div className="sm-proto-rail-spacer" />
      <button type="button" className="sm-proto-rail-quiet" onClick={onBack}><Icon name="arrowLeft" size={15} /><span>Back to workspace</span></button>
      <div className="sm-proto-rail-foot"><span className="sm-proto-live-dot" />Local Desktop · 1 window</div>
    </aside>
  );
}

function PrototypeSwitcher({ variant, onChange }: { variant: VariantKey; onChange: (next: VariantKey) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant);
  const cycle = (delta: number) => onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  return (
    <div className="sm-proto-switcher" aria-label="Prototype variants">
      <button type="button" aria-label="Previous prototype" onClick={() => cycle(-1)}><Icon name="arrowLeft" size={14} /></button>
      <div><span>PROTOTYPE</span><strong>{variant} · {VARIANTS[index].name}</strong><small>{VARIANTS[index].description}</small></div>
      <button type="button" aria-label="Next prototype" onClick={() => cycle(1)}><Icon name="chevronRight" size={14} /></button>
    </div>
  );
}

function SkillRowButton({ skill, selected, onSelect }: { skill: SkillRow; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`sm-proto-skill-row${selected ? " is-selected" : ""}`} onClick={onSelect}>
      <span className="sm-proto-skill-glyph"><Icon name="fileCode" size={15} /></span>
      <span className="sm-proto-skill-row-main">
        <strong>{skill.id}</strong>
        <small>{skill.description}</small>
        <em>{skill.scope} · {skill.targets}</em>
      </span>
      <StatusPill tone={skill.statusTone}>{skill.status}</StatusPill>
    </button>
  );
}

function SkillDetail({ skill, onAction, onOpenEditor }: { skill: SkillRow; onAction: (message: string) => void; onOpenEditor: () => void }) {
  return (
    <section className="sm-proto-detail-panel" aria-label={`${skill.id} detail`}>
      <div className="sm-proto-detail-head">
        <div>
          <div className="sm-proto-detail-kicker"><SourceTag>UPSTREAM SKILL</SourceTag><span>{skill.scope}</span></div>
          <h2>{skill.id}</h2>
          <p>{skill.description}</p>
        </div>
        <button type="button" className="sm-proto-icon-button" onClick={onOpenEditor} aria-label="Open Skills Manager editor"><Icon name="fileCode" size={16} /></button>
      </div>
      <div className="sm-proto-action-row">
        <ActionButton primary onClick={() => onAction(`Enable request queued for ${skill.id}`)}>Enable</ActionButton>
        <ActionButton onClick={() => onAction(`Sync check started for ${skill.id}`)}>Check sync</ActionButton>
        <ActionButton onClick={onOpenEditor}><Icon name="fileCode" size={13} /> Edit content</ActionButton>
        <ActionButton onClick={() => onAction("More actions are represented as inert prototype controls")}>•••</ActionButton>
      </div>
      <div className="sm-proto-detail-grid">
        <div className="sm-proto-detail-card sm-proto-detail-card--source">
          <span className="sm-proto-card-label">CENTRAL SOURCE</span>
          <code>{skill.source}</code>
          <div className="sm-proto-detail-meta"><span>sha256: 7b2a…e91c</span><span>{skill.updated}</span></div>
        </div>
        <div className="sm-proto-detail-card sm-proto-detail-card--targets">
          <span className="sm-proto-card-label">TOOL TARGETS</span>
          <div className="sm-proto-target-list">
            {skill.targets.split(" · ").map((target) => <div key={target}><span className="sm-proto-target-dot" />{target}<span className="sm-proto-target-state">linked</span></div>)}
          </div>
        </div>
      </div>
      <div className="sm-proto-editor-entry-box">
        <div className="sm-proto-external-editor-icon"><Icon name="fileCode" size={16} /></div>
        <div><strong>Edit the full Markdown inside Skills Manager</strong><p>Open the upstream editor when the full `SKILL.md` content needs to be reviewed or changed.</p><code>{skill.source}/SKILL.md</code></div>
        <button type="button" className="sm-proto-inline-link" onClick={onOpenEditor}>Open editor →</button>
      </div>
      <div className="sm-proto-warning-box">
        <div className="sm-proto-warning-icon"><Icon name="shield" size={15} /></div>
        <div><strong>Safety state visible before mutation</strong><p>Source, target, path and managed-link status stay in view before a real upstream command runs.</p></div>
      </div>
      <div className="sm-proto-detail-footer"><span>Command boundary</span><code>Skills Manager Rust service</code><span className="sm-proto-footer-ok">ready</span></div>
    </section>
  );
}

function VariantA({ selected, onSelect, onAction, onOpenEditor }: { selected: SkillRow; onSelect: (skill: SkillRow) => void; onAction: (message: string) => void; onOpenEditor: () => void }) {
  return (
    <div className="sm-proto-variant sm-proto-variant-a">
      <div className="sm-proto-surface-heading">
        <div><span className="sm-proto-eyebrow">UPSTREAM / SKILLS</span><h1>Skills</h1><p>Every discovered Skill, its source path, and the targets that consume it.</p></div>
        <div className="sm-proto-heading-actions"><ActionButton onClick={() => onAction("Refresh requested")}> <Icon name="refresh" size={14} /> Refresh</ActionButton><ActionButton primary onClick={() => onAction("Create Skill flow opened")}> <Icon name="plus" size={14} /> New Skill</ActionButton></div>
      </div>
      <div className="sm-proto-toolbar"><label><Icon name="search" size={14} /><input aria-label="Search Skills" placeholder="Search Skills, paths, or tools" /></label><div className="sm-proto-filter-chip">All scopes <Icon name="chevronDown" size={12} /></div><span className="sm-proto-toolbar-count">67 discovered · 4 shown in prototype</span></div>
      <div className="sm-proto-split">
        <div className="sm-proto-list-panel"><div className="sm-proto-list-head"><span>INVENTORY</span><strong>4 local records</strong></div><div className="sm-proto-list-scroll">{SKILLS.map((skill) => <SkillRowButton key={skill.id} skill={skill} selected={skill.id === selected.id} onSelect={() => onSelect(skill)} />)}</div><div className="sm-proto-list-foot"><span>Projection duplicates are grouped</span><button type="button" onClick={() => onAction("Source coverage opened")}>View coverage →</button></div></div>
        <SkillDetail skill={selected} onAction={onAction} onOpenEditor={onOpenEditor} />
      </div>
    </div>
  );
}

function VariantC({ selected, onAction }: { selected: SkillRow; onAction: (message: string) => void }) {
  const [draft, setDraft] = useState(`# ${selected.id}\n\n${selected.description}\n\n## Instructions\n\nRead the local source and use the managed command boundary.\n`);
  return (
    <div className="sm-proto-variant sm-proto-variant-c">
      <div className="sm-proto-editor-heading"><div><span className="sm-proto-eyebrow">UPSTREAM / EDITOR</span><h1>{selected.id}</h1><p><span className="sm-proto-dirty-dot" />Unsaved draft · editing remains an upstream file operation</p></div><div className="sm-proto-heading-actions"><ActionButton onClick={() => onAction("Draft discarded")}>Discard</ActionButton><ActionButton primary onClick={() => onAction("Save command previewed")}>Save Skill</ActionButton></div></div>
      <div className="sm-proto-editor-workspace"><aside className="sm-proto-file-tree"><div className="sm-proto-file-tree-head">FILES <button type="button" onClick={() => onAction("New file flow opened")}><Icon name="plus" size={13} /></button></div><div className="sm-proto-tree-root"><Icon name="folder" size={14} />{selected.id}</div><button type="button" className="is-active"><Icon name="fileCode" size={14} />SKILL.md</button><button type="button" onClick={() => onAction("References selected")}>↳ references/</button><button type="button" onClick={() => onAction("Scripts selected")}>↳ scripts/</button><div className="sm-proto-tree-note"><Icon name="shield" size={13} /><span>Read/write is checked by Rust before save.</span></div></aside><div className="sm-proto-editor-pane"><div className="sm-proto-editor-tabs"><span className="is-active">SKILL.md</span><span>Preview</span><span className="sm-proto-editor-path">{selected.source}/SKILL.md</span></div><textarea aria-label="Skill editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><div className="sm-proto-editor-status"><span>Markdown · UTF-8</span><span>Source hash changes after save</span></div></div><aside className="sm-proto-inspector"><div className="sm-proto-inspector-head"><span>DETAIL</span><button type="button" onClick={() => onAction("Inspector closed")}><Icon name="x" size={14} /></button></div><div className="sm-proto-inspector-section"><span className="sm-proto-card-label">SOURCE</span><code>{selected.source}</code><StatusPill tone={selected.statusTone}>{selected.status}</StatusPill></div><div className="sm-proto-inspector-section"><span className="sm-proto-card-label">TARGETS</span>{selected.targets.split(" · ").map((target) => <div className="sm-proto-inspector-target" key={target}><span className="sm-proto-target-dot" />{target}<small>linked</small></div>)}</div><div className="sm-proto-inspector-section"><span className="sm-proto-card-label">PROVENANCE</span><p>Local source · {selected.scope}</p><p>Updated {selected.updated}</p><p className="sm-proto-mono">sha256: 7b2a…e91c</p></div><div className="sm-proto-inspector-alert"><Icon name="shield" size={14} /><span>Unmanaged paths are never deleted by disable.</span></div></aside></div>
    </div>
  );
}

function ToolsPage({ onAction }: { onAction: (message: string) => void }) {
  return <PageFrame eyebrow="UPSTREAM / TOOLS" title="Tools" description="Detected tools and the paths where Skills are projected." action={<ActionButton onClick={() => onAction("Tool detection refreshed")}> <Icon name="refresh" size={14} /> Refresh detection</ActionButton>}><div className="sm-proto-tool-grid">{TOOLS.map((tool) => <article className="sm-proto-tool-card" key={tool.name}><div className="sm-proto-tool-card-head"><span className="sm-proto-tool-icon"><Icon name="wrench" size={16} /></span><div><strong>{tool.name}</strong><small>{tool.detected}</small></div><StatusPill tone={tool.detected === "Detected" ? "ok" : "warn"}>{tool.detected === "Detected" ? "Ready" : "Review"}</StatusPill></div><code>{tool.path}</code><p>{tool.enabled}</p><ActionButton onClick={() => onAction(`${tool.name} detail opened`)}>Manage targets</ActionButton></article>)}</div></PageFrame>;
}

function SettingsPage({ onAction }: { onAction: (message: string) => void }) {
  return <PageFrame eyebrow="DESKTOP / SETTINGS" title="Settings" description="Appearance, typography, and language follow the Vegapunk Desktop surface." action={<SourceTag tone="desktop">DESKTOP CONTRACT</SourceTag>}><div className="sm-proto-settings-grid"><article className="sm-proto-setting-card"><span className="sm-proto-card-label">STORAGE</span><h3>Central Skills directory</h3><code>~/.skills-manager/skills</code><p>Local Skills and tool projections remain on this machine.</p><ActionButton onClick={() => onAction("Directory picker opened")}>Choose directory</ActionButton></article><article className="sm-proto-setting-card"><span className="sm-proto-card-label">LOCAL CONFIG</span><h3>Configuration</h3><code>~/.skills-manager/config.json</code><p>Atomic writes, migrations, and local tool bindings.</p><StatusPill tone="ok">Writable</StatusPill></article><article className="sm-proto-setting-card"><span className="sm-proto-card-label">RISK SCANNING</span><h3>Safety scan</h3><p>Rules, cache, and optional LLM review remain available for local Skills.</p><button type="button" className="sm-proto-toggle is-on" onClick={() => onAction("Risk scan toggle changed in prototype")}><span />Deep scan enabled</button></article><article className="sm-proto-setting-card"><span className="sm-proto-card-label">DESKTOP INTEGRATION</span><h3>Shared visual contract</h3><p>Theme, font, and language are owned by the Vegapunk Desktop shell.</p><SourceTag tone="desktop">INHERITED</SourceTag></article></div></PageFrame>;
}

function PageFrame({ eyebrow, title, description, action, children }: { eyebrow: string; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <div className="sm-proto-generic-page"><div className="sm-proto-surface-heading"><div><span className="sm-proto-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="sm-proto-heading-actions">{action}</div></div>{children}</div>;
}

function SkillsPage({ selected, onSelect, onAction, onOpenEditor }: { selected: SkillRow; onSelect: (skill: SkillRow) => void; onAction: (message: string) => void; onOpenEditor: () => void }) {
  return <VariantA selected={selected} onSelect={onSelect} onAction={onAction} onOpenEditor={onOpenEditor} />;
}

export function SkillsManagerPrototype() {
  const [variant, setVariant] = useState<VariantKey>(getInitialVariant);
  const [activePage, setActivePage] = useState<PageKey>("skills");
  const [selected, setSelected] = useState<SkillRow>(SKILLS[0]);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedLabel = useMemo(() => selected.id, [selected]);

  const changeVariant = (next: VariantKey) => {
    setVariant(next);
    setPrototypeVariant(next);
  };
  const action = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3200);
  };

  return (
    <div className={`sm-proto sm-proto--${variant}`}>
      <DesktopRail active onBack={() => action("Outer Desktop navigation is represented by this prototype")} />
      <section className="sm-proto-window">
        <header className="sm-proto-window-bar">
          <div className="sm-proto-window-context"><button type="button" onClick={() => action("Back to Vegapunk requested")}><Icon name="arrowLeft" size={14} /></button><span>Vegapunk</span><b>/</b><strong>Skills Manager</strong></div>
          <div className="sm-proto-window-state"><span className="sm-proto-live-dot" />Desktop integration prototype <SourceTag tone="desktop">DESKTOP SHELL</SourceTag></div>
        </header>
        <div className="sm-proto-module">
          <PageNav active={activePage} onChange={setActivePage} />
          <main className="sm-proto-content">
            <div className="sm-proto-prototype-ribbon"><span>THROWAWAY UI STUDY</span><span>Upstream pages and behavior are labeled; controls are inert.</span><span className="sm-proto-ribbon-skill">selected: {selectedLabel}</span></div>
            {activePage === "skills" && <SkillsPage selected={selected} onSelect={setSelected} onAction={action} onOpenEditor={() => { setActivePage("editor"); action(`Opening the Skills Manager editor for ${selected.source}/SKILL.md`); }} />}
            {activePage === "tools" && <ToolsPage onAction={action} />}
            {activePage === "settings" && <SettingsPage onAction={action} />}
            {activePage === "editor" && <VariantC selected={selected} onAction={action} />}
          </main>
        </div>
        {notice && <div className="sm-proto-toast" role="status"><span className="sm-proto-live-dot" /><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice"><Icon name="x" size={13} /></button></div>}
      </section>
      <PrototypeSwitcher variant={variant} onChange={changeVariant} />
    </div>
  );
}

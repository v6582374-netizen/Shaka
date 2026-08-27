import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "./Icon";
import "./agents-md-prototype.css";

// PROTOTYPE PLAN: three radically different AGENTS.md file-management workspaces on the
// existing root route, switchable via ?prototype=agents-md&variant=A|B|C. Records and actions
// stay in memory so this study has no filesystem dependency.

type VariantKey = "A" | "B" | "C";
type LocationKey = "global" | "project" | "directory";

type FileRecord = {
  key: LocationKey;
  label: string;
  path: string;
  location: string;
  description: string;
  preview: string[];
  icon: IconName;
  modified: string;
  size: string;
  status: "Available" | "Read-only";
};

const VARIANTS: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: "A", name: "File Atlas", description: "Browse local AGENTS.md files by location" },
  { key: "B", name: "Markdown Workbench", description: "Edit one file with its metadata beside it" },
  { key: "C", name: "Source Desk", description: "Browse and inspect the local file catalog" },
];

const FILES: FileRecord[] = [
  {
    key: "global",
    label: "Global",
    path: "~/.codex/AGENTS.md",
    location: "Home directory file",
    description: "A user-owned Markdown file stored in the home directory.",
    preview: [
      "Use concise Markdown headings for local project guidance.",
      "Keep notes next to the work they describe.",
      "Record decisions with dates when context matters.",
    ],
    icon: "library",
    modified: "18 min ago",
    size: "4.8 KB",
    status: "Available",
  },
  {
    key: "project",
    label: "Project",
    path: "InternAgent/AGENTS.md",
    location: "Repository root file",
    description: "A Markdown file located at the root of the InternAgent checkout.",
    preview: [
      "Run the project checks before handing off changes.",
      "Keep generated artifacts out of source directories.",
      "Document the intended owner of each module.",
    ],
    icon: "folder",
    modified: "42 min ago",
    size: "8.1 KB",
    status: "Available",
  },
  {
    key: "directory",
    label: "Directory",
    path: "InternAgent/packages/desktop/AGENTS.md",
    location: "Nested project file",
    description: "A Markdown file placed inside a nested project directory.",
    preview: [
      "Use this directory's naming conventions.",
      "Keep examples close to the code they describe.",
      "Update the local notes when the folder changes.",
    ],
    icon: "fileCode",
    modified: "Yesterday",
    size: "2.6 KB",
    status: "Read-only",
  },
];

const SELECTED_FILE: LocationKey = "project";

function fileDraft(file: FileRecord) {
  return `# ${file.label} AGENTS.md\n\n${file.preview.map((item) => `- ${item}`).join("\n")}\n\n## File notes\n\n${file.description}\n`;
}

function initialVariant(): VariantKey {
  const value = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.some((item) => item.key === value) ? (value as VariantKey) : "A";
}

function setPrototypeVariant(next: VariantKey) {
  const params = new URLSearchParams(window.location.search);
  params.set("prototype", "agents-md");
  params.set("variant", next);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

function PrototypeSwitcher({ variant, onChange }: { variant: VariantKey; onChange: (next: VariantKey) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant);
  const current = VARIANTS[index] ?? VARIANTS[0];
  const cycle = (delta: number) => onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);

  return (
    <div className="ap-switcher" aria-label="AGENTS.md prototype variants">
      <button type="button" aria-label="Previous prototype" onClick={() => cycle(-1)}>
        <Icon name="arrowLeft" size={14} />
      </button>
      <div>
        <span>THROWAWAY UI STUDY</span>
        <strong>{current.key} · {current.name}</strong>
        <small>{current.description}</small>
      </div>
      <button type="button" aria-label="Next prototype" onClick={() => cycle(1)}>
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

function ProtoRail({ active, onAction }: { active: VariantKey; onAction: (message: string) => void }) {
  return (
    <aside className="ap-rail">
      <div className="ap-brand"><Icon name="logo" size={17} /><span>Harness</span><em>PROTOTYPE</em></div>
      <div className="ap-rail-label">HARNESS</div>
      <button type="button" className="ap-rail-item ap-rail-item--active" onClick={() => onAction("AGENTS.md is the selected Harness module")}>
        <Icon name="fileCode" size={16} /><span>AGENTS.md</span><b>●</b>
      </button>
      <button type="button" className="ap-rail-item" onClick={() => onAction("Skills Manager is shown as a sibling Harness module")}>
        <Icon name="sparkle" size={16} /><span>Skills Manager</span>
      </button>
      <div className="ap-rail-divider" />
      <div className="ap-rail-label">FILE TOOLS</div>
      <button type="button" className="ap-rail-item" onClick={() => onAction("Browse files is represented in the current view")}>
        <Icon name="library" size={16} /><span>Browse files</span>
      </button>
      <div className="ap-rail-spacer" />
      <div className="ap-rail-state"><span />3 sample files in memory</div>
      <div className="ap-rail-variant">Variant {active} · in-memory study</div>
    </aside>
  );
}

function WindowBar({ variant, onAction }: { variant: VariantKey; onAction: (message: string) => void }) {
  return (
    <header className="ap-window-bar">
      <div className="ap-breadcrumb">
        <button type="button" onClick={() => onAction("Back to Harness is represented")}><Icon name="arrowLeft" size={14} /></button>
        <span>Harness</span><b>/</b><strong>AGENTS.md</strong>
      </div>
      <div className="ap-window-state"><span className="ap-live-dot" /> {variant} · local files</div>
    </header>
  );
}

function LocationBadge({ file }: { file: FileRecord }) {
  return <span className={`ap-location-badge ap-location-badge--${file.key}`}>{file.label}</span>;
}

function FileAtlas({ selectedKey, onSelect, onAction }: { selectedKey: LocationKey; onSelect: (key: LocationKey) => void; onAction: (message: string) => void }) {
  const selected = FILES.find((file) => file.key === selectedKey) ?? FILES[0];

  return (
    <div className="ap-page ap-atlas">
      <div className="ap-page-heading">
        <div><span className="ap-eyebrow">HARNESS / FILE ATLAS</span><h1>AGENTS.md files</h1><p>Browse local Markdown files by location, then open one to inspect or edit.</p></div>
        <button type="button" className="ap-button ap-button--primary" onClick={() => onAction("Add file is represented in the prototype")}><Icon name="plus" size={14} /> Add file</button>
      </div>
      <div className="ap-atlas-summary">
        <div><strong>3</strong><span>sample files</span></div>
        <div><strong>3</strong><span>locations</span></div>
        <div><strong>MD</strong><span>file format</span></div>
        <div className="ap-atlas-summary-note"><Icon name="fileCode" size={15} /><span>In-memory records for a local file manager.</span></div>
      </div>
      <div className="ap-atlas-grid">
        <section className="ap-panel ap-file-list" aria-label="AGENTS.md file locations">
          <div className="ap-panel-head"><span>File locations</span><button type="button" onClick={() => onAction("File list refreshed")}><Icon name="refresh" size={13} /></button></div>
          <div className="ap-file-list-items">
            {FILES.map((file) => (
              <div key={file.key} className="ap-file-list-item">
                <button type="button" className={selectedKey === file.key ? "is-selected" : undefined} onClick={() => onSelect(file.key)}>
                  <span className="ap-file-list-icon"><Icon name={file.icon} size={15} /></span>
                  <span><strong>{file.label}</strong><small>{file.path}</small></span>
                  <Icon name={selectedKey === file.key ? "chevronDown" : "chevronRight"} size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="ap-file-list-foot"><span className="ap-check-dot" /> 3 sample files are available</div>
        </section>
        <section className="ap-panel ap-atlas-detail" aria-label={`${selected.label} AGENTS.md file`}>
          <div className="ap-detail-kicker"><LocationBadge file={selected} /><span>{selected.location}</span></div>
          <div className="ap-detail-title-row"><div><h2>{selected.label} file</h2><code>{selected.path}</code></div><button type="button" className="ap-icon-button" onClick={() => onAction(`Opening ${selected.path} is represented`)} aria-label="Open file"><Icon name="fileCode" size={16} /></button></div>
          <p className="ap-detail-summary">{selected.description}</p>
          <div className="ap-preview-label">CONTENT PREVIEW</div>
          <div className="ap-content-list">{selected.preview.map((line, index) => <div className="ap-content-row" key={line}><span>{String(index + 1).padStart(2, "0")}</span><p>{line}</p><button type="button" aria-label={`Inspect line ${index + 1}`} onClick={() => onAction(`Line ${index + 1} selected`)}><Icon name="chevronRight" size={14} /></button></div>)}</div>
          <div className="ap-detail-footer"><span>{selected.status}</span><strong>{selected.size}</strong><span>Updated {selected.modified}</span><button type="button" onClick={() => onAction("Opening the editor is represented")}>Open in editor <Icon name="chevronRight" size={13} /></button></div>
        </section>
        <aside className="ap-file-details">
          <div className="ap-file-details-heading"><div><span className="ap-eyebrow">FILE DETAILS</span><h2>AGENTS.md</h2></div><span className="ap-file-status">{selected.status.toLowerCase()}</span></div>
          <p>Details for the selected local file.</p>
          <div className="ap-file-details-stack"><div className="ap-file-details-row"><LocationBadge file={selected} /><span>{selected.location}</span></div><div className="ap-file-details-row"><span className="ap-detail-meta-label">PATH</span><span>{selected.path}</span></div><div className="ap-file-details-row"><span className="ap-detail-meta-label">UPDATED</span><span>{selected.modified}</span></div><div className="ap-file-details-row"><span className="ap-detail-meta-label">SIZE</span><span>{selected.size}</span></div></div>
          <div className="ap-file-actions"><Icon name="fileCode" size={14} /><div><strong>File actions</strong><p>Open the file or copy its path.</p><button type="button" onClick={() => onAction("File path copied")}>Copy file path</button></div></div>
        </aside>
      </div>
    </div>
  );
}

function MarkdownWorkbench({ selectedKey, onSelect, onAction }: { selectedKey: LocationKey; onSelect: (key: LocationKey) => void; onAction: (message: string) => void }) {
  const selected = FILES.find((file) => file.key === selectedKey) ?? FILES[0];
  const [draft, setDraft] = useState(() => fileDraft(selected));

  useEffect(() => {
    setDraft(fileDraft(selected));
  }, [selected]);

  return (
    <div className="ap-page ap-workbench">
      <div className="ap-page-heading"><div><span className="ap-eyebrow">HARNESS / MARKDOWN WORKBENCH</span><h1>{selected.label} / AGENTS.md</h1><p>Edit one local file while keeping its path and metadata visible beside it.</p></div><div className="ap-heading-actions"><button type="button" className="ap-button" onClick={() => onAction("Draft discarded")}>Discard</button><button type="button" className="ap-button ap-button--primary" onClick={() => onAction("Save preview is in-memory")}>Save changes</button></div></div>
      <div className="ap-workbench-meta"><code>{selected.path}</code><span><span className="ap-dirty-dot" />Unsaved draft · in memory</span><button type="button" onClick={() => onAction("File history is represented")}>View history</button></div>
      <div className="ap-workbench-grid">
        <aside className="ap-file-tree ap-panel"><div className="ap-panel-head"><span>Local files</span><button type="button" onClick={() => onAction("New file is represented")}><Icon name="plus" size={13} /></button></div><div className="ap-tree-list">{FILES.map((file) => <button key={file.key} type="button" className={selectedKey === file.key ? "is-selected" : undefined} onClick={() => { onSelect(file.key); onAction(`${file.label} file selected`); }}><Icon name={file.icon} size={14} /><span><strong>{file.label}</strong><small>{file.path}</small></span><LocationBadge file={file} /></button>)}</div><div className="ap-tree-note"><Icon name="shield" size={14} /><span>This prototype keeps edits in memory.</span></div></aside>
        <section className="ap-editor ap-panel"><div className="ap-editor-tabs"><span className="is-active">AGENTS.md</span><span>Preview</span><span className="ap-editor-path">{selected.path}</span></div><div className="ap-editor-body"><div className="ap-line-numbers">{draft.split("\n").map((_, index) => <span key={index}>{String(index + 1).padStart(2, "0")}</span>)}</div><textarea aria-label="AGENTS.md draft" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /></div><div className="ap-editor-status"><span>Markdown · UTF-8</span><span>Location: {selected.label}</span><span>Preview is in-memory</span></div></section>
        <aside className="ap-file-metadata-panel ap-panel"><div className="ap-panel-head"><span>File metadata</span><button type="button" onClick={() => onAction("Metadata panel closed")}><Icon name="x" size={13} /></button></div><div className="ap-file-metadata-intro"><span className="ap-file-metadata-icon"><Icon name="fileCode" size={16} /></span><div><strong>Local Markdown file</strong><p>Path and file details for the current document.</p></div></div><div className="ap-metadata-list"><div className="ap-metadata-row"><span>Location</span><strong>{selected.location}</strong></div><div className="ap-metadata-row"><span>Path</span><strong>{selected.path}</strong></div><div className="ap-metadata-row"><span>Updated</span><strong>{selected.modified}</strong></div><div className="ap-metadata-row"><span>Size</span><strong>{selected.size}</strong></div><div className="ap-metadata-row"><span>Status</span><strong>{selected.status}</strong></div></div><div className="ap-file-note"><Icon name="fileCode" size={14} /><div><strong>Prototype note</strong><p>Save and file permissions are not connected in this study.</p><button type="button" onClick={() => onAction("File path copied")}>Copy file path</button></div></div></aside>
      </div>
    </div>
  );
}

function SourceDesk({ selectedKey, onSelect, onAction }: { selectedKey: LocationKey; onSelect: (key: LocationKey) => void; onAction: (message: string) => void }) {
  return (
    <div className="ap-page ap-source-desk">
      <div className="ap-page-heading"><div><h1>Find an AGENTS.md file</h1><p>Browse local locations, inspect file details, and open content for editing.</p></div><button type="button" className="ap-button" onClick={() => onAction("Directory picker is represented")}><Icon name="folder" size={14} /> Add location</button></div>
      <div className="ap-location-strip">{FILES.map((file) => <div key={file.key} className="ap-location-step"><button type="button" className={file.key === selectedKey ? "is-selected" : undefined} onClick={() => onSelect(file.key)}><span className="ap-location-number"><Icon name={file.icon} size={12} /></span><strong>{file.label}</strong><small>{file.path}</small></button>{file.key !== "directory" && <Icon name="chevronRight" size={16} />}</div>)}</div>
      <div className="ap-source-grid">
        <section className="ap-source-list"><div className="ap-source-list-head"><div><span className="ap-eyebrow">LOCAL FILE CATALOG</span><h2>AGENTS.md records</h2></div><span className="ap-file-status">3 files · local</span></div><div className="ap-file-records">{FILES.map((file) => <div className="ap-file-record" key={file.key}><div className="ap-file-record-head"><span className={`ap-file-record-marker ap-file-record-marker--${file.key === selectedKey ? "current" : "default"}`} /><strong>{file.label}</strong><small>{file.modified}</small></div><p>{file.description}</p><div className="ap-file-path-row"><code>{file.path}</code><span className="ap-file-record-location">{file.location}</span><span className="ap-file-record-info">{file.size} · {file.status}</span><button type="button" className="ap-file-preview-button" aria-disabled="true">Preview content <Icon name="chevronRight" size={13} /></button></div></div>)}</div><button type="button" className="ap-link-button" onClick={() => onAction("Selected file opened in the editor")}>Open selected file <Icon name="chevronRight" size={13} /></button></section>
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return <div className="ap-toast" role="status"><span className="ap-live-dot" /><span>{message}</span><button type="button" aria-label="Dismiss message" onClick={onClose}><Icon name="x" size={13} /></button></div>;
}

export function AgentsMdPrototype() {
  const [variant, setVariant] = useState<VariantKey>(initialVariant);
  const [selectedKey, setSelectedKey] = useState<LocationKey>(SELECTED_FILE);
  const [message, setMessage] = useState("");
  const current = useMemo(() => VARIANTS.find((item) => item.key === variant) ?? VARIANTS[0], [variant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = VARIANTS.findIndex((item) => item.key === variant);
      const next = VARIANTS[(index + (event.key === "ArrowRight" ? 1 : -1) + VARIANTS.length) % VARIANTS.length].key;
      setVariant(next);
      setPrototypeVariant(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);

  const changeVariant = (next: VariantKey) => {
    setVariant(next);
    setPrototypeVariant(next);
    setMessage(`${next} · ${VARIANTS.find((item) => item.key === next)?.name} selected`);
  };
  const action = (next: string) => setMessage(next);

  return <div className="ap-prototype" data-prototype-variant={variant}><ProtoRail active={variant} onAction={action} /><main className="ap-window"><WindowBar variant={variant} onAction={action} /><div className="ap-prototype-ribbon"><strong>THROWAWAY PROTOTYPE</strong><span>AGENTS.md file browsing and editing with sample local records.</span><span className="ap-ribbon-current">{current.key} · {current.name}</span></div><div className="ap-content">{variant === "A" && <FileAtlas selectedKey={selectedKey} onSelect={setSelectedKey} onAction={action} />}{variant === "B" && <MarkdownWorkbench selectedKey={selectedKey} onSelect={setSelectedKey} onAction={action} />}{variant === "C" && <SourceDesk selectedKey={selectedKey} onSelect={setSelectedKey} onAction={action} />}</div></main><PrototypeSwitcher variant={variant} onChange={changeVariant} /><Toast message={message} onClose={() => setMessage("")} /></div>;
}

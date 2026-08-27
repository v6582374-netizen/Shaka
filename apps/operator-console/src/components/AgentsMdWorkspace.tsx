import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon, type IconName } from "./Icon";
import "./agents-md-workspace.css";

type LocationKey = "global" | "project" | "directory";

type FileRecord = {
  key: LocationKey;
  label: string;
  path: string;
  location: string;
  description: string;
  icon: IconName;
  modified: string;
  size: string;
  status: "Available" | "Read-only";
};

export type AgentsMdFileTarget = {
  key: LocationKey;
  rootPath: string;
  filePath: string;
  displayPath: string;
};

interface AgentsMdWorkspaceProps {
  workspacePath?: string;
  onOpenFile?: (target: AgentsMdFileTarget) => void;
}

const FILES: FileRecord[] = [
  {
    key: "global",
    label: "Global",
    path: "~/.codex/AGENTS.md",
    location: "Home directory file",
    description: "A user-owned Markdown file stored in the home directory.",
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
    icon: "fileCode",
    modified: "Yesterday",
    size: "2.6 KB",
    status: "Read-only",
  },
];

export function AgentsMdWorkspace({ workspacePath = "", onOpenFile }: AgentsMdWorkspaceProps) {
  const [selectedKey, setSelectedKey] = useState<LocationKey>("project");
  const [homePath, setHomePath] = useState("");

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("get_home_directory")
      .then((path) => {
        if (!cancelled) setHomePath(path);
      })
      .catch(() => {
        if (!cancelled) setHomePath("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const files = useMemo(() => {
    const join = (root: string, child: string) => {
      const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
      return normalized ? `${normalized}/${child}` : "";
    };
    const globalRoot = join(homePath, ".codex");
    const directoryRoot = join(workspacePath, "packages/desktop");

    return FILES.map((file): FileRecord & { target: AgentsMdFileTarget } => {
      const rootPath = file.key === "global"
        ? globalRoot
        : file.key === "project"
          ? workspacePath
          : directoryRoot;
      const filePath = "AGENTS.md";
      return {
        ...file,
        target: {
          key: file.key,
          rootPath,
          filePath,
          displayPath: file.path,
        },
      };
    });
  }, [homePath, workspacePath]);

  const openFile = (file: FileRecord & { target: AgentsMdFileTarget }) => {
    if (!file.target.rootPath) return;
    onOpenFile?.(file.target);
  };

  return (
    <main className="agents-md-workspace" data-testid="agents-md-view">
      <div className="agents-md-scroll">
        <div className="agents-md-shell">
          <header className="agents-md-heading">
            <div>
              <h1>Find an AGENTS.md file</h1>
              <p>Browse local locations, inspect file details, and open content for editing.</p>
            </div>
            <button type="button" className="agents-md-button" aria-label="Add file location">
              <Icon name="folder" size={14} /> Add location
            </button>
          </header>

          <div className="agents-md-location-strip" aria-label="AGENTS.md file locations">
            {files.map((file) => {
              const selected = file.key === selectedKey;
              return (
                <div className="agents-md-location-step" key={file.key}>
                  <button
                    type="button"
                    className={`agents-md-location-card${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    data-testid={`agents-md-location-${file.key}`}
                    onClick={() => setSelectedKey(file.key)}
                  >
                    <span className="agents-md-location-icon"><Icon name={file.icon} size={12} /></span>
                    <strong>{file.label}</strong>
                    <small>{file.path}</small>
                  </button>
                  {file.key !== "directory" && <Icon name="chevronRight" size={16} className="agents-md-location-arrow" />}
                </div>
              );
            })}
          </div>

          <section className="agents-md-catalog" aria-labelledby="agents-md-catalog-heading">
            <div className="agents-md-catalog-head">
              <div>
                <span className="agents-md-eyebrow">LOCAL FILE CATALOG</span>
                <h2 id="agents-md-catalog-heading">AGENTS.md records</h2>
              </div>
              <span className="agents-md-status">3 files · local</span>
            </div>

            <div className="agents-md-records">
              {files.map((file) => {
                const selected = file.key === selectedKey;
                return (
                  <article className={`agents-md-record${selected ? " is-selected" : ""}`} key={file.key} data-testid={`agents-md-record-${file.key}`}>
                    <div className="agents-md-record-head">
                      <span className={`agents-md-record-dot${selected ? " is-selected" : ""}`} />
                      <strong>{file.label}</strong>
                      <time>{file.modified}</time>
                    </div>
                    <p>{file.description}</p>
                    <div className="agents-md-path-row">
                      <code>{file.path}</code>
                      <span className="agents-md-record-location">{file.location}</span>
                      <span className="agents-md-record-info">{file.size} · {file.status}</span>
                      <button
                        type="button"
                        className="agents-md-preview-button"
                        aria-label={`Preview content for ${file.label} file`}
                        data-testid={`agents-md-preview-${file.key}`}
                        onClick={() => openFile(file)}
                      >
                        Preview content <Icon name="chevronRight" size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              className="agents-md-open-button"
              aria-label="Open selected file"
              onClick={() => {
                const selected = files.find((file) => file.key === selectedKey);
                if (selected) openFile(selected);
              }}
            >
              Open selected file <Icon name="chevronRight" size={13} />
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}

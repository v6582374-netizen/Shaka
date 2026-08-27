import { useCallback, useEffect, useState } from "react";
import {
  getDiscoveryArtifacts,
  readDiscoveryArtifact,
  revealDiscoveryArtifact,
  type DiscoveryArtifactContent,
  type DiscoveryArtifactInfo,
} from "../api";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function kindIcon(kind: string): "file" | "fileCode" | "image" | "table" {
  if (kind === "image") return "image";
  if (kind === "structured") return "table";
  if (kind === "code" || kind === "markdown") return "fileCode";
  return "file";
}

function artifactLabel(artifact: DiscoveryArtifactInfo): string {
  if (artifact.kind === "pdf") return "PDF artifact";
  if (artifact.kind === "office") return "Office artifact";
  if (artifact.kind === "binary") return "Binary artifact";
  if (!artifact.previewable) return "Large artifact";
  return artifact.kind;
}

function ArtifactPreview({
  content,
}: {
  content: DiscoveryArtifactContent | null;
}) {
  if (!content) return <div className="rail-muted">Loading artifact preview...</div>;
  if (!content.previewable) {
    return (
      <div className="artifact-open-prompt">
        <Icon name="panelOpen" size={28} />
        <p>{artifactLabel(content)} uses an explicit native Open or Reveal action.</p>
      </div>
    );
  }
  if (content.kind === "image") {
    return <img className="artifact-image" src={content.data_url ?? ""} alt={content.name} />;
  }
  if (content.kind === "markdown") {
    return (
      <div className="artifact-md">
        <Markdown text={content.content ?? ""} />
      </div>
    );
  }
  return <pre className="artifact-code">{content.content ?? ""}</pre>;
}

export function DiscoveryArtifactPanel({ launchId }: { launchId: string | null }) {
  const [artifacts, setArtifacts] = useState<DiscoveryArtifactInfo[]>([]);
  const [selected, setSelected] = useState<DiscoveryArtifactInfo | null>(null);
  const [content, setContent] = useState<DiscoveryArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!launchId) {
      setArtifacts([]);
      setSelected(null);
      setLoading(false);
      return;
    }
    try {
      const next = await getDiscoveryArtifacts(launchId);
      setArtifacts(next);
      setSelected((current) => (current ? next.find((item) => item.path === current.path) ?? null : null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discovery artifacts are unavailable.");
      setArtifacts([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [launchId]);

  useEffect(() => {
    setSelected(null);
    setContent(null);
    void refresh();
  }, [launchId, refresh]);

  useEffect(() => {
    let alive = true;
    setActionError(null);
    if (!launchId || !selected) {
      setContent(null);
      return () => {
        alive = false;
      };
    }
    setContent(null);
    readDiscoveryArtifact(launchId, selected.path)
      .then((next) => {
        if (alive) setContent(next);
      })
      .catch((caught) => {
        if (alive) {
          setContent(null);
          setActionError(caught instanceof Error ? caught.message : "Artifact preview failed.");
        }
      });
    return () => {
      alive = false;
    };
  }, [launchId, selected?.path]);

  async function nativeAction(mode: "reveal" | "open") {
    if (!selected || !launchId) return;
    setActionError(null);
    try {
      const result = await revealDiscoveryArtifact(launchId, selected.path, mode);
      if (!result.ok) setActionError(result.error ?? "The native artifact action failed.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The native artifact action failed.");
    }
  }

  return (
    <section className="rail-section" aria-label="Discovery Artifacts" data-testid="discovery-artifacts">
      <div className="rail-section-head">
        <div className="rail-section-toggle">
          <Icon name="file" size={14} />
          <span>Artifacts{artifacts.length ? ` (${artifacts.length})` : ""}</span>
        </div>
        <button
          type="button"
          className="rail-mini-btn"
          onClick={() => void refresh()}
          aria-label="Refresh Discovery artifacts"
          title="Refresh artifacts"
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
      <div className="rail-section-body">
        {selected ? (
          <div className="artifact-viewer">
            <div className="artifact-head">
              <button
                type="button"
                className="artifact-icon-btn"
                onClick={() => setSelected(null)}
                aria-label="Back to Discovery artifacts"
                title="Back"
              >
                <Icon name="arrowLeft" size={16} />
              </button>
              <div className="artifact-heading">
                <div className="artifact-title">
                  <span>Artifacts</span>
                  <span className="artifact-sep">/</span>
                  <span>{selected.name}</span>
                </div>
                <div className="artifact-path">{selected.path}</div>
              </div>
              <div className="rail-actions">
                {!selected.previewable && (
                  <button
                    type="button"
                    className="artifact-icon-btn"
                    onClick={() => void nativeAction("open")}
                    aria-label="Open Discovery artifact in default app"
                    title="Open in default app"
                  >
                    <Icon name="panelOpen" size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="artifact-icon-btn"
                  onClick={() => void nativeAction("reveal")}
                  aria-label="Show Discovery artifact in folder"
                  title="Show in folder"
                >
                  <Icon name="folder" size={16} />
                </button>
              </div>
            </div>
            <div className="artifact-preview">
              <ArtifactPreview content={content} />
              {actionError && <p className="rail-error" role="alert">{actionError}</p>}
            </div>
          </div>
        ) : loading && launchId ? (
          <div className="rail-muted">Loading Launch artifacts...</div>
        ) : error ? (
          <div className="rail-error" role="alert">{error}</div>
        ) : !launchId ? (
          <div className="rail-muted">Artifacts will appear after a Launch starts.</div>
        ) : artifacts.length === 0 ? (
          <div className="rail-muted">No Launch artifacts yet.</div>
        ) : (
          <div className="artifact-list">
            {artifacts.map((artifact) => (
              <button
                type="button"
                className="artifact-row"
                key={artifact.path}
                onClick={() => setSelected(artifact)}
              >
                <span className="artifact-ico" title={artifactLabel(artifact)}>
                  <Icon name={kindIcon(artifact.kind)} size={17} />
                </span>
                <span className="artifact-name">
                  {artifact.name}
                  <span className="artifact-row-meta">
                    {formatBytes(artifact.size)} · {artifactLabel(artifact)}
                  </span>
                </span>
                <span className="artifact-open">Open</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

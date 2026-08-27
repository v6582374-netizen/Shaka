import { Toggle } from "@/components/ui/toggle";
import { MODAL_LAYER_Z_INDEX, MODAL_OVERLAY_COLOR } from "@/constants/modal";
import type { Tool } from "../../types";
import type { TranslationPath } from "../../i18n";
import { getActionableToolIds } from "./getActionableToolIds";
import type { BatchSelectionSummary } from "./batchManageSelection";
import {
  getNextBatchToolEnabledState,
  isBatchToolChecked,
  type BatchToolStateSummary,
} from "./buildBatchToolStates";

interface BatchManageToolsDialogProps {
  open: boolean;
  selectedSummary: BatchSelectionSummary;
  tools: Tool[];
  toolStates: Record<string, BatchToolStateSummary>;
  query: string;
  submitting: boolean;
  onQueryChange: (value: string) => void;
  onToggleTool: (toolId: string, enabled: boolean) => void;
  onSubmitEnableAll: () => void;
  onSubmitDisableAll: () => void;
  onClose: () => void;
  t: (key: TranslationPath) => string;
}

function getCardTone(summary: BatchToolStateSummary | undefined) {
  if (!summary || summary.state === "none") {
    return {
      backgroundColor: "var(--background)",
      border: "1px solid var(--border)",
    };
  }

  if (summary.state === "all") {
    return {
      backgroundColor: "var(--color-success-bg)",
      border: "1px solid var(--color-success-border)",
    };
  }

  return {
    backgroundColor: "var(--primary-tint)",
    border: "1px solid var(--primary-tint-border)",
  };
}

export function BatchManageToolsDialog({
  open,
  selectedSummary,
  tools,
  toolStates,
  query,
  submitting,
  onQueryChange,
  onToggleTool,
  onSubmitEnableAll,
  onSubmitDisableAll,
  onClose,
  t,
}: BatchManageToolsDialogProps) {
  if (!open) {
    return null;
  }

  const actionableToolIds = getActionableToolIds(tools);
  const actionableTools = actionableToolIds
    .map((toolId) => tools.find((tool) => tool.id === toolId))
    .filter((tool): tool is Tool => Boolean(tool));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTools = actionableTools.filter((tool) => {
    if (!normalizedQuery) {
      return true;
    }

    return tool.name.toLowerCase().includes(normalizedQuery) || tool.id.toLowerCase().includes(normalizedQuery);
  });
  const hasSelection = selectedSummary.totalCount > 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: MODAL_OVERLAY_COLOR,
        zIndex: MODAL_LAYER_Z_INDEX,
      }}
      onClick={submitting ? undefined : onClose}
    >
      <div
        style={{
          width: "min(720px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 72px)",
          backgroundColor: "var(--background)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: 600, color: "var(--foreground)" }}>
              {t("skills.batchConfigureToolsTitle")}
            </h3>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              {t("skills.batchConfigureToolsDesc")
                .replace("{count}", String(selectedSummary.totalCount))
                .replace("{skills}", String(selectedSummary.skillCount))
                .replace("{groups}", String(selectedSummary.groupCount))
                .replace("{affected}", String(selectedSummary.affectedSkillCount))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--secondary)",
              color: "var(--muted-foreground)",
              cursor: submitting ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <svg
            style={{
              position: "absolute",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted-foreground)",
              pointerEvents: "none",
            }}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("skills.searchToolsPlaceholder")}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "8px 10px 8px 32px",
              fontSize: "12px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              backgroundColor: "var(--secondary)",
              color: "var(--foreground)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "10px",
            backgroundColor: "var(--secondary)",
            overflow: "hidden",
          }}
        >
          <div style={{ maxHeight: "320px", overflow: "auto", padding: "6px" }}>
            {filteredTools.length === 0 ? (
              <div
                style={{
                  padding: "30px 14px",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "var(--muted-foreground)",
                }}
              >
                {t("skills.noToolsInFilter")}
              </div>
            ) : (
              <div className="tools-grid">
                {filteredTools.map((tool) => {
                  const toolState = toolStates[tool.id];
                  const checked = isBatchToolChecked(toolState);
                  const cardTone = getCardTone(toolState);
                  const nextEnabled = getNextBatchToolEnabledState(toolState);

                  return (
                    <div
                      key={tool.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "10px",
                        minHeight: "48px",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        ...cardTone,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "6px",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "var(--foreground)",
                            lineHeight: 1.35,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          }}
                        >
                          {tool.name}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>{tool.id}</span>
                          {toolState && (
                            <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
                              {toolState.enabledCount}/{toolState.selectedCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <Toggle checked={checked} disabled={submitting} onChange={() => onToggleTool(tool.id, nextEnabled)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onSubmitEnableAll}
            disabled={submitting || !hasSelection || actionableTools.length === 0}
            style={{
              padding: "8px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-success)",
              backgroundColor: "var(--color-success-bg)",
              border: "1px solid var(--color-success-border)",
              borderRadius: "8px",
              cursor: submitting || !hasSelection || actionableTools.length === 0 ? "not-allowed" : "pointer",
              opacity: submitting || !hasSelection || actionableTools.length === 0 ? 0.5 : 1,
            }}
          >
            {t("skills.batchEnableAllTools")}
          </button>
          <button
            type="button"
            onClick={onSubmitDisableAll}
            disabled={submitting || !hasSelection || actionableTools.length === 0}
            style={{
              padding: "8px 14px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--destructive)",
              backgroundColor: "var(--color-error-bg)",
              border: "1px solid var(--color-error-border)",
              borderRadius: "8px",
              cursor: submitting || !hasSelection || actionableTools.length === 0 ? "not-allowed" : "pointer",
              opacity: submitting || !hasSelection || actionableTools.length === 0 ? 0.5 : 1,
            }}
          >
            {t("skills.batchDisableAllTools")}
          </button>
        </div>
      </div>
    </div>
  );
}

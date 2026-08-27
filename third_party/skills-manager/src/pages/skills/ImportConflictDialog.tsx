import { useEffect, useState } from "react";
import { MODAL_LAYER_Z_INDEX, MODAL_OVERLAY_COLOR } from "@/constants/modal";
import type {
  ConflictStrategy,
  ImportConflict,
  ImportPreview,
  ImportResolution,
} from "@/types";
import type { TranslationPath } from "@/i18n";

interface ImportConflictDialogProps {
  open: boolean;
  preview: ImportPreview | null;
  isProcessing: boolean;
  onCancel: () => void;
  onConfirm: (resolutions: ImportResolution[]) => void;
  t: (key: TranslationPath) => string;
}

const STRATEGIES: ConflictStrategy[] = ["skip", "overwrite", "rename"];

function strategyLabel(strategy: ConflictStrategy, t: (key: TranslationPath) => string): string {
  switch (strategy) {
    case "skip":
      return t("skills.importStrategySkip");
    case "overwrite":
      return t("skills.importStrategyOverwrite");
    case "rename":
      return t("skills.importStrategyRename");
  }
}

function strategyDesc(
  strategy: ConflictStrategy,
  skillId: string,
  t: (key: TranslationPath) => string,
): string {
  switch (strategy) {
    case "skip":
      return t("skills.importStrategySkipDesc");
    case "overwrite":
      return t("skills.importStrategyOverwriteDesc");
    case "rename":
      return t("skills.importStrategyRenameDesc").replace("{name}", skillId);
  }
}

export function ImportConflictDialog({
  open,
  preview,
  isProcessing,
  onCancel,
  onConfirm,
  t,
}: ImportConflictDialogProps) {
  const [perSkill, setPerSkill] = useState<Record<string, ConflictStrategy>>({});
  const [applyToAll, setApplyToAll] = useState(false);
  const [allStrategy, setAllStrategy] = useState<ConflictStrategy>("skip");

  // Reset local state whenever a new preview arrives.
  useEffect(() => {
    if (!open || !preview) {
      return;
    }
    const initial: Record<string, ConflictStrategy> = {};
    for (const conflict of preview.conflicts) {
      initial[conflict.skill_id] = "skip";
    }
    setPerSkill(initial);
    setApplyToAll(preview.conflicts.length > 1);
    setAllStrategy("skip");
  }, [open, preview]);

  if (!open || !preview) {
    return null;
  }

  const conflicts: ImportConflict[] = preview.conflicts;
  const hasConflicts = conflicts.length > 0;

  const resolveStrategy = (skillId: string): ConflictStrategy => {
    if (applyToAll) {
      return allStrategy;
    }
    return perSkill[skillId] ?? "skip";
  };

  const setStrategy = (skillId: string, strategy: ConflictStrategy) => {
    setPerSkill((current) => ({ ...current, [skillId]: strategy }));
  };

  const handleConfirm = () => {
    // Only conflicts need an explicit resolution. Non-conflict skills import
    // regardless of strategy (backend treats skip + no conflict as import).
    const resolutions: ImportResolution[] = conflicts.map((conflict) => ({
      skill_id: conflict.skill_id,
      strategy: resolveStrategy(conflict.skill_id),
    }));
    onConfirm(resolutions);
  };

  const totalCount = preview.manifest.skills.length;
  const conflictCount = conflicts.length;

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
      onClick={isProcessing ? undefined : onCancel}
    >
      <div
        style={{
          width: "min(640px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 72px)",
          backgroundColor: "var(--background)",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--foreground)" }}>
            {hasConflicts
              ? t("skills.importConflictTitle")
              : t("skills.importPreviewTitle")}
          </div>
          <div style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
            {hasConflicts
              ? t("skills.importPreviewDesc")
                  .replace("{count}", String(totalCount))
                  .replace("{conflicts}", String(conflictCount))
              : t("skills.importNoConflictsDesc").replace("{count}", String(totalCount))}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {hasConflicts && (
            <>
              {conflictCount > 1 && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    backgroundColor: "var(--secondary)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                      color: "var(--foreground)",
                      cursor: isProcessing ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={applyToAll}
                      disabled={isProcessing}
                      onChange={(e) => setApplyToAll(e.target.checked)}
                    />
                    {t("skills.importApplyToAll").replace(
                      "{count}",
                      String(conflictCount),
                    )}
                  </label>
                  {applyToAll && (
                    <select
                      value={allStrategy}
                      disabled={isProcessing}
                      onChange={(e) =>
                        setAllStrategy(e.target.value as ConflictStrategy)
                      }
                      style={{
                        padding: "6px 8px",
                        fontSize: "13px",
                        color: "var(--foreground)",
                        backgroundColor: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                      }}
                    >
                      {STRATEGIES.map((s) => (
                        <option key={s} value={s}>
                          {strategyLabel(s, t)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {conflicts.map((conflict) => {
                const current = resolveStrategy(conflict.skill_id);
                return (
                  <div
                    key={conflict.skill_id}
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--background)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--foreground)",
                        }}
                      >
                        {conflict.skill_name}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--muted-foreground)",
                          wordBreak: "break-all",
                        }}
                      >
                        {conflict.local_path}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        flexWrap: "wrap",
                      }}
                    >
                      {STRATEGIES.map((strategy) => {
                        const selected = current === strategy;
                        const disabled =
                          isProcessing || (applyToAll && allStrategy !== strategy);
                        return (
                          <button
                            key={strategy}
                            type="button"
                            disabled={disabled}
                            onClick={() => setStrategy(conflict.skill_id, strategy)}
                            title={strategyDesc(strategy, conflict.skill_id, t)}
                            style={{
                              padding: "6px 12px",
                              fontSize: "12px",
                              fontWeight: 500,
                              color: selected
                                ? "var(--primary-foreground)"
                                : "var(--foreground)",
                              backgroundColor: selected
                                ? "var(--primary)"
                                : "var(--background)",
                              border: selected
                                ? "1px solid var(--primary)"
                                : "1px solid var(--border)",
                              borderRadius: "6px",
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.5 : 1,
                            }}
                          >
                            {strategyLabel(strategy, t)}
                          </button>
                        );
                      })}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {strategyDesc(current, conflict.skill_id, t)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: isProcessing ? "not-allowed" : "pointer",
            }}
          >
            {t("skills.importCancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--primary)",
              border: "1px solid var(--primary)",
              borderRadius: "8px",
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.6 : 1,
            }}
          >
            {isProcessing ? t("skills.importStart") + "..." : t("skills.importStart")}
          </button>
        </div>
      </div>
    </div>
  );
}

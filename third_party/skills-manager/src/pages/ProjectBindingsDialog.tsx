import { useState, useEffect, useCallback } from "react";
import {
  MODAL_LAYER_Z_INDEX,
  MODAL_OVERLAY_COLOR,
} from "@/constants/modal";
import type { AppConfig, ProjectBinding } from "@/types";
import type { TranslationPath } from "@/i18n";

interface ProjectBindingsDialogProps {
  open: boolean;
  projects: AppConfig["projects"];
  activeProjectId: string | null;
  pendingProjectBinding: ProjectBinding | null;
  saving: boolean;
  onAddProject: () => void;
  onPendingProjectNameChange: (name: string) => void;
  onConfirmPendingProject: () => void;
  onCancelPendingProject: () => void;
  onSetActiveProject: (projectId: string | null) => void;
  onRemoveProject: (projectId: string) => void;
  onClose: () => void;
  t: (key: TranslationPath) => string;
}

export function ProjectBindingsDialog({
  open,
  projects,
  activeProjectId,
  pendingProjectBinding,
  saving,
  onAddProject,
  onPendingProjectNameChange,
  onConfirmPendingProject,
  onCancelPendingProject,
  onSetActiveProject,
  onRemoveProject,
  onClose,
  t,
}: ProjectBindingsDialogProps) {
  if (!open) {
    return null;
  }

  const currentProjects = projects ?? [];
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!open || saving) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDeleteId) {
          setConfirmDeleteId(null);
        } else if (pendingProjectBinding) {
          onCancelPendingProject();
        } else {
          onClose();
        }
      }
      if (e.key === "Enter" && pendingProjectBinding && !saving) {
        e.preventDefault();
        onConfirmPendingProject();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, saving, confirmDeleteId, pendingProjectBinding, onClose, onCancelPendingProject, onConfirmPendingProject]);

  const handleDeleteClick = useCallback((projectId: string) => {
    setConfirmDeleteId(projectId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (confirmDeleteId) {
      onRemoveProject(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, onRemoveProject]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

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
      onClick={saving ? undefined : onClose}
    >
      <div
        style={{
          width: "min(680px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 72px)",
          backgroundColor: "var(--background)",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: "0 0 4px 0",
                fontSize: "17px",
                fontWeight: 600,
                color: "var(--foreground)",
                letterSpacing: "-0.01em",
              }}
            >
              {t("settings.projectBindings")}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              {t("settings.projectBindingsDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: saving ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
              e.currentTarget.style.color = "var(--foreground)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--muted-foreground)";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Add Form - slides in from bottom */}
        {pendingProjectBinding && (
          <div
            className="animate-slide-down"
            style={{
              padding: "20px 24px",
              backgroundColor: "var(--secondary)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  backgroundColor: "var(--primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>
                  {t("settings.addProject")}
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                  {t("settings.addProjectHint")}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--muted-foreground)" }}>
                  {t("settings.projectName")}
                </span>
                <input
                  type="text"
                  value={pendingProjectBinding.name}
                  onChange={(e) => onPendingProjectNameChange(e.target.value)}
                  disabled={saving}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: "14px",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.15s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--primary)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "12px",
                  backgroundColor: "var(--background)",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {t("settings.projectSkillsPath")}
                </span>
                <code
                  style={{
                    display: "block",
                    width: "100%",
                    fontSize: "13px",
                    color: "var(--foreground)",
                    fontFamily: "ui-monospace, monospace",
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    lineHeight: 1.5,
                  }}
                >
                  {pendingProjectBinding.skills_dir}
                </code>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={onCancelPendingProject}
                disabled={saving}
                style={{
                  padding: "9px 16px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--muted-foreground)",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  cursor: saving ? "wait" : "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--secondary)";
                  e.currentTarget.style.color = "var(--foreground)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "var(--muted-foreground)";
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={onConfirmPendingProject}
                disabled={saving || !pendingProjectBinding.name.trim()}
                style={{
                  padding: "9px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--primary-foreground)",
                  backgroundColor: "var(--primary)",
                  border: "none",
                  borderRadius: "10px",
                  cursor: saving || !pendingProjectBinding.name.trim() ? "not-allowed" : "pointer",
                  opacity: saving || !pendingProjectBinding.name.trim() ? 0.6 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                {saving ? t("common.saving") : t("common.add")}
              </button>
            </div>
          </div>
        )}

        {/* Project List */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {currentProjects.length === 0 ? (
            <div
              style={{
                padding: "48px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "12px",
                color: "var(--muted-foreground)",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  backgroundColor: "var(--secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "4px",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div style={{ fontSize: "14px", fontWeight: 500 }}>{t("settings.noProjects")}</div>
              <div style={{ fontSize: "13px" }}>{t("settings.noProjectsHint")}</div>
            </div>
          ) : (
            <div style={{ padding: "0 12px" }}>
              {currentProjects.map((project, index) => {
                const isLast = index === currentProjects.length - 1;
                const isActive = activeProjectId === project.id;

                return (
                  <div
                    key={project.id}
                    style={{
                      padding: "14px 12px",
                      borderBottom: isLast ? "none" : "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      backgroundColor: isActive
                        ? "var(--primary-tint)"
                        : "transparent",
                    }}
                  >
                    {/* Content */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
                      {/* Project Info */}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "4px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "14px",
                              fontWeight: 600,
                              color: "var(--foreground)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {project.name}
                          </div>
                          {isActive && (
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                color: "var(--primary)",
                                backgroundColor: "var(--primary-tint)",
                                border: "1px solid var(--primary-tint-border)",
                                borderRadius: "999px",
                                padding: "2px 8px",
                                flexShrink: 0,
                              }}
                            >
                              {t("settings.currentProject")}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--muted-foreground)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {project.skills_dir}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {!confirmDeleteId || confirmDeleteId !== project.id ? (
                      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => onSetActiveProject(project.id)}
                            disabled={saving}
                            style={{
                              padding: "7px 12px",
                              fontSize: "12px",
                              fontWeight: 500,
                              color: "var(--foreground)",
                              backgroundColor: "var(--secondary)",
                              border: "1px solid var(--border)",
                              borderRadius: "8px",
                              cursor: saving ? "not-allowed" : "pointer",
                              opacity: saving ? 0.6 : 1,
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              if (!saving) {
                                e.currentTarget.style.backgroundColor = "var(--primary)";
                                e.currentTarget.style.color = "var(--primary-foreground)";
                                e.currentTarget.style.borderColor = "var(--primary)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--secondary)";
                              e.currentTarget.style.color = "var(--foreground)";
                              e.currentTarget.style.borderColor = "var(--border)";
                            }}
                          >
                            {t("settings.setActiveProject")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(project.id)}
                          disabled={saving}
                          style={{
                            padding: "7px 10px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "var(--destructive)",
                            backgroundColor: "transparent",
                            border: "1px solid transparent",
                            borderRadius: "8px",
                            cursor: saving ? "not-allowed" : "pointer",
                            opacity: saving ? 0.6 : 1,
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!saving) {
                              e.currentTarget.style.backgroundColor = "var(--color-error-bg)";
                              e.currentTarget.style.borderColor = "var(--color-error-border)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                            e.currentTarget.style.borderColor = "transparent";
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      /* Delete Confirmation */
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "6px 8px",
                          backgroundColor: "var(--color-error-bg)",
                          borderRadius: "10px",
                          border: "1px solid var(--color-error-border)",
                        }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--destructive)" }}>
                          {t("settings.confirmDelete")}
                        </span>
                        <button
                          type="button"
                          onClick={handleConfirmDelete}
                          disabled={saving}
                          style={{
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--primary-foreground)",
                            backgroundColor: "var(--destructive)",
                            border: "none",
                            borderRadius: "6px",
                            cursor: saving ? "wait" : "pointer",
                          }}
                        >
                          {t("common.delete")}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelDelete}
                          disabled={saving}
                          style={{
                            padding: "5px 10px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "var(--muted-foreground)",
                            backgroundColor: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            cursor: saving ? "wait" : "pointer",
                          }}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
            {currentProjects.length > 0 && (
              <span>
                {currentProjects.length} {currentProjects.length === 1 ? t("settings.projectCountSingular") : t("settings.projectCountPlural")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onAddProject}
            disabled={saving || !!pendingProjectBinding}
            style={{
              padding: "9px 16px",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--primary)",
              border: "none",
              borderRadius: "10px",
              cursor: saving || pendingProjectBinding ? "not-allowed" : "pointer",
              opacity: saving || pendingProjectBinding ? 0.6 : 1,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("settings.addProject")}
          </button>
        </div>
      </div>

      {/* Delete confirmation shortcut hints */}
      {confirmDeleteId && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "12px",
            color: "var(--muted-foreground)",
            backgroundColor: "var(--secondary)",
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid var(--border)",
          }}
        >
          {t("settings.pressEscToCancel")}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "@/i18n";
import { CheckCircle2, Circle, Loader2, RotateCw, FolderOpen } from "lucide-react";

interface ToolConfig {
  enabled: boolean;
  detected: boolean;
  skills_path: string;
  config_path: string;
}

interface Tool {
  id: string;
  name: string;
  detected: boolean;
  cli_available: boolean;
  config: ToolConfig;
  source?: "builtin" | "custom";
}

type ToastFn = (message: string, type?: "error" | "success" | "info", persistent?: boolean) => void;

interface ToolDetectionStepProps {
  onNext: () => void;
  onBack: () => void;
  onError?: ToastFn;
}

export function ToolDetectionStep({ onNext, onBack, onError }: ToolDetectionStepProps) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [focusedToolId, setFocusedToolId] = useState<string | null>(null);

  useEffect(() => {
    detectTools();
  }, []);

  async function detectTools() {
    setIsLoading(true);
    try {
      const result = await invoke<Tool[]>("detect_tools");
      setTools(result.filter((tool) => tool.source !== "custom"));
    } catch (error) {
      console.error("Failed to detect tools:", error);
      onError?.(t("welcome.detectToolsFailed") + ": " + String(error), "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCustomizePath(toolId: string) {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("tools.selectConfigPath"),
    });

    if (selected && typeof selected === "string") {
      try {
        await invoke("update_tool_paths", {
          toolId,
          configPath: selected,
          skillsPath: `${selected}/skills`,
        });
        await detectTools();
        onError?.(t("welcome.pathUpdated"), "success");
      } catch (error) {
        console.error("Failed to update tool paths:", error);
        onError?.(t("welcome.updatePathFailed") + ": " + String(error), "error");
      }
    }
  }

  async function handleToggleEnabled(tool: Tool, enabled: boolean) {
    if (enabled && !tool.detected) {
      return;
    }
    setTogglingId(tool.id);
    const previousEnabled = tool.config.enabled;
    // Optimistic update
    setTools(prev => prev.map(t =>
      t.id === tool.id ? { ...t, config: { ...t.config, enabled } } : t
    ));
    try {
      await invoke("set_tool_enabled", { toolId: tool.id, enabled });
      onError?.(
        enabled
          ? t("welcome.toolEnabled").replace("{name}", tool.name)
          : t("welcome.toolDisabled").replace("{name}", tool.name),
        "success"
      );
    } catch (error) {
      // Rollback on error
      setTools(prev => prev.map(t =>
        t.id === tool.id ? { ...t, config: { ...t.config, enabled: previousEnabled } } : t
      ));
      onError?.(t("welcome.toggleToolFailed") + ": " + String(error), "error");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleEnableAllDetected() {
    const detectedTools = tools.filter((t) => t.detected && !t.config.enabled);
    if (detectedTools.length === 0) return;
    setTogglingId("__bulk__");
    try {
      for (const tool of detectedTools) {
        await invoke("set_tool_enabled", { toolId: tool.id, enabled: true });
      }
      await detectTools();
      onError?.(
        t("welcome.bulkEnableSuccess").replace("{count}", String(detectedTools.length)),
        "success"
      );
    } catch (error) {
      await detectTools();
      onError?.(t("welcome.toggleToolFailed") + ": " + String(error), "error");
    } finally {
      setTogglingId(null);
    }
  }

  const detectedCount = tools.filter((t) => t.detected).length;
  const detectedNotEnabledCount = tools.filter((t) => t.detected && !t.config.enabled).length;

  return (
    <div>
      {/* Header - no icon, just text */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 8px 0' }}>
          {t("welcome.detectTools")}
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', margin: 0 }}>
          {t("welcome.detectToolsDesc")}
        </p>
      </div>

      {/* Content */}
      <div style={{ marginBottom: '24px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Loader2 style={{ width: '32px', height: '32px', color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', marginTop: '12px' }}>{t("welcome.detecting")}</p>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <>
            <div className="welcome-shell" style={{ marginBottom: '14px' }}>
              <div
                role="listbox"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const detected = tools.filter((t) => t.detected);
                    if (detected.length === 0) return;
                    const currentIndex = detected.findIndex((t) => t.id === focusedToolId);
                    let nextIndex: number;
                    if (currentIndex === -1) {
                      nextIndex = e.key === 'ArrowDown' ? 0 : detected.length - 1;
                    } else {
                      nextIndex = e.key === 'ArrowDown'
                        ? (currentIndex + 1) % detected.length
                        : (currentIndex - 1 + detected.length) % detected.length;
                    }
                    setFocusedToolId(detected[nextIndex].id);
                  } else if (e.key === ' ' || e.key === 'Enter') {
                    if (focusedToolId) {
                      e.preventDefault();
                      const tool = tools.find((t) => t.id === focusedToolId);
                      if (tool && tool.detected && togglingId !== tool.id) {
                        handleToggleEnabled(tool, !tool.config.enabled);
                      }
                    }
                  }
                }}
                style={{
                  maxHeight: '280px',
                  overflowY: 'auto',
                  outline: 'none',
                }}
                className="welcome-listbox"
              >
                {tools.map((tool) => {
                  const isEnabled = tool.config.enabled;
                  const isToggling = togglingId === tool.id || togglingId === "__bulk__";
                  const isFocused = focusedToolId === tool.id;
                  return (
                    <div
                      key={tool.id}
                      role="option"
                      aria-selected={isFocused}
                      data-focused={isFocused}
                      data-selected={tool.detected && isEnabled}
                      onMouseEnter={() => setFocusedToolId(tool.id)}
                      className="welcome-row"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '11px 14px',
                        opacity: tool.detected ? 1 : 0.5,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {tool.detected ? (
                          <CheckCircle2 style={{ width: '15px', height: '15px', color: 'var(--foreground)', opacity: 0.7, flexShrink: 0, strokeWidth: 1.75 }} />
                        ) : (
                          <Circle style={{ width: '15px', height: '15px', color: 'var(--muted-foreground)', opacity: 0.4, flexShrink: 0, strokeWidth: 1.75 }} />
                        )}
                        <span style={{
                          fontSize: '13px',
                          fontWeight: tool.detected ? 500 : 400,
                          color: tool.detected ? 'var(--foreground)' : 'var(--muted-foreground)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          letterSpacing: '-0.01em',
                        }}>
                          {tool.name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => handleCustomizePath(tool.id)}
                          title={t("welcome.customizePath")}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '22px',
                            height: '22px',
                            borderRadius: '5px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--muted-foreground)',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s, color 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--muted)';
                            e.currentTarget.style.color = 'var(--foreground)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = 'var(--muted-foreground)';
                          }}
                        >
                          <FolderOpen style={{ width: '13px', height: '13px', strokeWidth: 1.75 }} />
                        </button>
                        {tool.detected ? (
                          <button
                            onClick={() => !isToggling && handleToggleEnabled(tool, !isEnabled)}
                            disabled={isToggling}
                            title={isEnabled ? t("welcome.disableSync") : t("welcome.enableSync")}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                              fontWeight: 500,
                              padding: '3px 9px',
                              borderRadius: '5px',
                              border: isEnabled ? 'none' : '1px solid var(--primary)',
                              backgroundColor: isEnabled ? 'var(--primary)' : 'transparent',
                              color: isEnabled ? 'var(--primary-foreground)' : 'var(--primary)',
                              cursor: isToggling ? 'wait' : 'pointer',
                              opacity: isToggling ? 0.6 : 1,
                              transition: 'background-color 0.15s, opacity 0.15s',
                              lineHeight: 1.4,
                            }}
                          >
                            {isToggling ? (
                              <Loader2 style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite' }} />
                            ) : null}
                            {isEnabled ? t("welcome.enabled") : t("welcome.enableSync")}
                          </button>
                        ) : (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '3px 9px',
                              borderRadius: '5px',
                              backgroundColor: 'transparent',
                              color: 'var(--muted-foreground)',
                              border: '1px solid var(--border)',
                              lineHeight: 1.4,
                            }}
                          >
                            {t("welcome.notInstalled")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0, flex: 1, minWidth: 0 }}>
                {detectedCount > 0
                  ? t("welcome.detectedCount").replace("{count}", String(detectedCount))
                  : t("welcome.noToolsDetected")}
              </p>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {detectedNotEnabledCount > 0 && (
                  <button
                    onClick={handleEnableAllDetected}
                    disabled={togglingId !== null}
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '4px 10px',
                      borderRadius: '5px',
                      border: '1px solid var(--primary)',
                      backgroundColor: 'transparent',
                      color: 'var(--primary)',
                      cursor: togglingId !== null ? 'wait' : 'pointer',
                      opacity: togglingId !== null ? 0.6 : 1,
                      lineHeight: 1.4,
                    }}
                  >
                    {t("welcome.enableAllDetected")}
                  </button>
                )}
                <button
                  onClick={detectTools}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    color: 'var(--muted-foreground)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCw style={{ width: '11px', height: '11px', strokeWidth: 1.75 }} />
                  {t("welcome.redetect")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={onBack}
          style={{
            flex: 1,
            height: '44px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--foreground)',
            backgroundColor: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            cursor: 'pointer',
          }}
        >
          {t("welcome.previous")}
        </button>
        <button
          onClick={onNext}
          disabled={isLoading}
          style={{
            flex: 1,
            height: '44px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--primary-foreground)',
            backgroundColor: 'var(--primary)',
            border: 'none',
            borderRadius: '10px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          {t("welcome.next")}
        </button>
      </div>
    </div>
  );
}

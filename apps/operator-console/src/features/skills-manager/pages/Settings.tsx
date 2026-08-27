import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { AppConfig, DetectedEditor, UserPreferences } from "@skills-manager/types";
import { defaultPreferences } from "@skills-manager/constants/preferences";
import { useTranslation } from "@skills-manager/i18n";
import { getEditorIcon } from "@skills-manager/assets/editors";
import { Toggle } from "@skills-manager/components/ui/toggle";
import { Alert, AlertDescription } from "@skills-manager/components/ui/alert";
import { PageHeader } from "@skills-manager/components/ui/page-header";
import { usePageHeaderState } from "@skills-manager/components/PageHeaderContext";
import { ToastContainer, useToast } from "@skills-manager/components/ui/toast";
import { resolveActiveProjectId } from "./projectBindings";

const SETTINGS_SECTIONS = [
  { id: "settings-general", label: "General" },
  { id: "settings-appearance", label: "Appearance" },
  { id: "settings-sync", label: "Local synchronization" },
  { id: "settings-risk", label: "Risk scanning" },
  { id: "settings-advanced", label: "Advanced" },
] as const;

export function Settings() {
  const { t } = useTranslation();
  const location = useLocation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [availableEditors, setAvailableEditors] = useState<DetectedEditor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [resetting, setResetting] = useState(false);
  const [usageHookLoading, setUsageHookLoading] = useState(false);
  const { riskScanning, setRiskScanning } = usePageHeaderState();
  const { toasts, addToast, removeToast } = useToast();
  const saveTimerRef = useRef<number | null>(null);
  const saveStatusTimerRef = useRef<number | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const result = await invoke<AppConfig>("get_config");
      const preferences = { ...defaultPreferences, ...(result.preferences ?? {}) };
      const activeProjectId = resolveActiveProjectId(result.active_project_id, result.projects ?? []);
      setConfig({ ...result, preferences, active_project_id: activeProjectId });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    void invoke<DetectedEditor[]>("get_available_editors")
      .then(setAvailableEditors)
      .catch(() => setAvailableEditors([]));
  }, []);

  useEffect(() => {
    if (!config) return;
    const hash = window.location.hash.slice(1);
    if (!hash || !SETTINGS_SECTIONS.some((section) => section.id === hash)) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [config, location]);

  const saveConfig = useCallback(async (nextConfig: AppConfig) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    if (saveStatusTimerRef.current !== null) window.clearTimeout(saveStatusTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await invoke("save_config", { config: nextConfig });
        setSaveStatus("saved");
        saveStatusTimerRef.current = window.setTimeout(() => setSaveStatus("idle"), 1800);
      } catch (err) {
        setSaveStatus("idle");
        addToast(err instanceof Error ? err.message : t("settings.saveFailed"), "error");
      }
    }, 400);
  }, [addToast, t]);

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    if (!config) return;
    const nextConfig: AppConfig = {
      ...config,
      preferences: { ...defaultPreferences, ...(config.preferences ?? {}), [key]: value },
    };
    setConfig(nextConfig);
    void saveConfig(nextConfig);
  };

  const handleUsageMonitorChange = async (enabled: boolean) => {
    if (!config) return;
    const previous = config.preferences?.skill_usage_monitor ?? true;
    setUsageHookLoading(true);
    updatePreference("skill_usage_monitor", enabled);
    try {
      await invoke(enabled ? "install_usage_hook" : "uninstall_usage_hook");
      addToast(enabled ? t("settings.skillUsageMonitorEnabled") : t("settings.skillUsageMonitorDisabled"), "success");
    } catch (err) {
      updatePreference("skill_usage_monitor", previous);
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setUsageHookLoading(false);
    }
  };

  const handleRescanAll = async () => {
    setRiskScanning(true);
    try {
      await invoke("scan_all_risks");
      addToast(t("settings.riskScanRescanDone"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRiskScanning(false);
    }
  };

  const handleReset = async () => {
    if (!config) return;
    const accepted = await confirm(t("settings.resetSettingsConfirm"), {
      title: t("settings.resetSettingsConfirmTitle"),
      kind: "warning",
    });
    if (!accepted) return;
    setResetting(true);
    try {
      const nextConfig = { ...config, preferences: { ...defaultPreferences } };
      await invoke("save_config", { config: nextConfig });
      setConfig(nextConfig);
      addToast(t("settings.resetSettingsSuccess"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("settings.saveFailed"), "error");
    } finally {
      setResetting(false);
    }
  };

  if (error) {
    return <div className="page-main"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>;
  }
  if (!config) {
    return <div className="page-main" style={{ color: "var(--muted-foreground)" }}>{t("common.loading")}</div>;
  }

  const preferences = config.preferences ?? defaultPreferences;
  const selectedEditor = availableEditors.find((editor) => editor.id === preferences.default_editor);
  const EditorIcon = selectedEditor ? getEditorIcon(selectedEditor.id) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--background)" }}>
      <PageHeader title={t("settings.title")} actions={<SaveStatus status={saveStatus} />} />
      <main className="page-main" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <div className="page-container" style={{ maxWidth: 760 }}>
          <SectionTitle id="settings-general">{t("settings.general")}</SectionTitle>
          <SettingsCard>
            <SettingsRow label={t("settings.skillsDirectory")} description={t("settings.skillsDirectoryDesc")} isLast={false}>
              <code style={{ color: "var(--muted-foreground)", background: "var(--background)", padding: "6px 10px", borderRadius: 6, overflowWrap: "anywhere" }}>{config.skills_dir}</code>
            </SettingsRow>
            <SettingsRow label={t("settings.defaultEditor")} description={t("settings.defaultEditorDesc")} isLast={false}>
              <select value={preferences.default_editor} onChange={(event) => updatePreference("default_editor", event.target.value)} style={selectStyle}>
                {availableEditors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name}</option>)}
                {!availableEditors.some((editor) => editor.id === preferences.default_editor) && <option value={preferences.default_editor}>{preferences.default_editor}</option>}
              </select>
              {EditorIcon && <EditorIcon />}
            </SettingsRow>
            <SettingsRow label="Tab size" description="Number of spaces inserted for indentation" isLast>
              <select value={String(preferences.tab_size)} onChange={(event) => updatePreference("tab_size", Number(event.target.value) as 2 | 4)} style={selectStyle}><option value="2">2</option><option value="4">4</option></select>
            </SettingsRow>
          </SettingsCard>

          <SectionTitle id="settings-appearance">{t("settings.appearance")}</SectionTitle>
          <SettingsCard>
            <div style={{ padding: "16px 0", color: "var(--muted-foreground)", fontSize: 13, lineHeight: 1.6 }}>
              Appearance, typography, and language follow the Vegapunk Desktop Settings surface.
              This module does not maintain a second theme, font, or language preference.
            </div>
          </SettingsCard>

          <SectionTitle id="settings-sync">Local synchronization</SectionTitle>
          <SettingsCard>
            <SettingsRow label={t("settings.autoSync")} description={t("settings.autoSyncDesc")} isLast={false}><Toggle checked={preferences.auto_sync} onChange={(value) => updatePreference("auto_sync", value)} /></SettingsRow>
            <SettingsRow label="Sync on save" description="Synchronize local tool projections after saving a Skill" isLast={false}><Toggle checked={preferences.sync_on_save} onChange={(value) => updatePreference("sync_on_save", value)} /></SettingsRow>
            <SettingsRow label={t("settings.syncNotifications")} description={t("settings.syncNotificationsDesc")} isLast={false}><Toggle checked={preferences.show_sync_notifications} onChange={(value) => updatePreference("show_sync_notifications", value)} /></SettingsRow>
            <SettingsRow label={t("settings.removeLinksWhenDisablingTool")} description={t("settings.removeLinksWhenDisablingToolDesc")} isLast><Toggle checked={preferences.remove_links_when_disabling_tool} onChange={(value) => updatePreference("remove_links_when_disabling_tool", value)} /></SettingsRow>
          </SettingsCard>

          <SectionTitle id="settings-risk">{t("settings.riskScanTitle")}</SectionTitle>
          <SettingsCard>
            <SettingsRow label={t("settings.riskScanTitle")} description={t("settings.riskScanDesc")} isLast={false}>
              <select value={preferences.risk_scan_mode} onChange={(event) => updatePreference("risk_scan_mode", event.target.value as UserPreferences["risk_scan_mode"])} style={selectStyle}>
                <option value="off">{t("settings.riskScanModeOff")}</option><option value="basic">{t("settings.riskScanModeBasic")}</option><option value="deep">{t("settings.riskScanModeDeep")}</option>
              </select>
            </SettingsRow>
            {preferences.risk_scan_mode !== "off" && <SettingsRow label={t("settings.riskScanRescanAll")} description="Run the selected local scan mode across installed Skills" isLast><button type="button" onClick={handleRescanAll} disabled={riskScanning} style={buttonStyle}>{riskScanning ? t("settings.riskScanRescanning") : t("settings.riskScanRescanAll")}</button></SettingsRow>}
          </SettingsCard>

          <SectionTitle id="settings-advanced">{t("settings.advanced")}</SectionTitle>
          <SettingsCard>
            <SettingsRow label={t("settings.skillUsageMonitor")} description={t("settings.skillUsageMonitorDesc")} isLast={false}><Toggle checked={preferences.skill_usage_monitor} disabled={usageHookLoading} onChange={handleUsageMonitorChange} /></SettingsRow>
            <SettingsRow label="Skill analysis provider" description="Translation and deep risk review use the shared Vegapunk Models and Providers configuration." isLast={false}><span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Managed by Desktop</span></SettingsRow>
            <SettingsRow label={t("settings.resetSettings")} description={t("settings.resetSettingsDesc")} isLast><button type="button" onClick={handleReset} disabled={resetting} style={buttonStyle}>{resetting ? t("common.checking") : t("settings.resetSettings")}</button></SettingsRow>
          </SettingsCard>
        </div>
      </main>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return <span style={{ fontSize: 12, color: status === "saved" ? "var(--color-success)" : "var(--muted-foreground)" }}>{status === "saving" ? "Saving..." : "Saved"}</span>;
}

function SectionTitle({ children, id }: { children: ReactNode; id: string }) {
  return <h2 id={id} style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", color: "var(--foreground)", scrollMarginTop: 24 }}>{children}</h2>;
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "0 20px", marginBottom: 32 }}>{children}</div>;
}

function SettingsRow({ label, description, children, isLast }: { label: string; description: string; children: ReactNode; isLast: boolean }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "16px 0", borderBottom: isLast ? "none" : "1px solid color-mix(in srgb, var(--border) 70%, transparent)" }}><div style={{ minWidth: 0 }}><div style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 500 }}>{label}</div><div style={{ color: "var(--muted-foreground)", fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{description}</div></div><div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>{children}</div></div>;
}

const selectStyle = { background: "var(--background)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 13 } as const;
const buttonStyle = { background: "var(--background)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 12px", fontSize: 13, cursor: "pointer" } as const;

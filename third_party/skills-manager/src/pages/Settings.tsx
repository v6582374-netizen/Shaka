import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  AppConfig,
  UserPreferences,
  DetectedEditor,
  UpdateInfo,
  LlmProvider,
} from "@/types";
import { defaultPreferences } from "@/constants/preferences";
import { checkUpdate } from "@/services/updater";
import { useTranslation, Language, TranslationPath } from "@/i18n";
import { useSkillTranslation } from "@/hooks/useSkillTranslation";
import { useTheme } from "@/hooks/useTheme";
import { resolveTelemetryConsent } from "@/telemetry/consent";
import { getEditorIcon } from "@/assets/editors";
import { FontFamilyPreset, normalizeFontFamilyPreset } from "@/lib/fontFamily";
import wechatRewardCode from "@/assets/donation/wechat-reward-code.jpg";
import alipayRewardCode from "@/assets/donation/alipay-reward-code.jpg";
import { Toggle } from "@/components/ui/toggle";
import { AuthButton } from "@/components/auth/AuthButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { usePageHeaderState } from "@/components/PageHeaderContext";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { SunIcon, MoonIcon, MonitorIcon } from "@/components/icons/theme-icons";
import { resolveActiveProjectId } from "./projectBindings";

export function Settings() {
  const { t, language, setLanguage } = useTranslation();
  const { setTheme, setFontFamily } = useTheme();
  const location = useLocation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editorDropdownOpen, setEditorDropdownOpen] = useState(false);
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [availableEditors, setAvailableEditors] = useState<DetectedEditor[]>([]);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [resetting, setResetting] = useState(false);
  const [usageHookLoading, setUsageHookLoading] = useState(false);
  const { riskScanning, setRiskScanning } = usePageHeaderState();
  const { toasts, addToast, removeToast } = useToast();

  const SETTINGS_SECTIONS = [
    { id: "settings-general", label: t("settings.general") },
    { id: "settings-appearance", label: t("settings.appearance") },
    { id: "settings-llm", label: t("settings.llmTitle") },
    { id: "settings-account", label: t("settings.account") },
    { id: "settings-shortcuts", label: t("shortcuts.title") },
    { id: "settings-risk", label: t("settings.riskScanTitle") },
    { id: "settings-advanced", label: t("settings.advanced") },
    { id: "settings-about", label: t("settings.about") },
    { id: "settings-support", label: t("settings.support") },
  ] as const;

  const tRef = useRef(t);
  const addToastRef = useRef(addToast);
  useEffect(() => {
    tRef.current = t;
    addToastRef.current = addToast;
  });

  // Scroll to the section requested via location hash (e.g. "#settings-llm")
  // so the command palette can deep-link to a specific settings section.
  useEffect(() => {
    if (!config) return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    if (SETTINGS_SECTIONS.some((s) => s.id === hash)) {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [config, location]);

  const fetchConfig = useCallback(async () => {
    setError(null);
    try {
      const configResult = await invoke<AppConfig>("get_config");
      configResult.preferences = {
        ...defaultPreferences,
        ...(configResult.preferences ?? {}),
      };
      const nextActiveProjectId = resolveActiveProjectId(configResult.active_project_id, configResult.projects ?? []);
      if (nextActiveProjectId !== configResult.active_project_id) {
        addToastRef.current(tRef.current("settings.currentProjectMissing"), "info");
      }
      setConfig({ ...configResult, active_project_id: nextActiveProjectId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    async function loadEditors() {
      try {
        const editors = await invoke<DetectedEditor[]>("get_available_editors");
        setAvailableEditors(editors);
      } catch (err) {
        // Error handled silently - editors list will remain empty
      }
    }
    loadEditors();
  }, []);

  // Auto-check for updates on mount
  useEffect(() => {
    async function autoCheckUpdate() {
      try {
        const info = await checkUpdate();
        if (info.has_update) {
          setUpdateInfo(info);
        }
      } catch (err) {
        console.error("Failed to auto-check update:", err);
      }
    }
    autoCheckUpdate();
  }, []);

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    if (!config) return;

    const newConfig = {
      ...config,
      preferences: {
        ...defaultPreferences,
        ...config.preferences,
        [key]: value,
      },
    };
    setConfig(newConfig);

    // If language changed, update the app language immediately
    if (key === "language") {
      setLanguage(value as Language);
    }

    // If theme changed, update the app theme immediately
    if (key === "theme") {
      setTheme(value as "light" | "dark" | "system");
    }

    if (key === "font_family") {
      setFontFamily(value as FontFamilyPreset);
    }

    // Auto-save to disk (debounced)
    void autoSaveConfig(newConfig);
  };

  // Debounced auto-save function
  const autoSaveTimeoutRef = useRef<number | null>(null);
  const saveStatusTimeoutRef = useRef<number | null>(null);
  const autoSaveConfig = useCallback(async (configToSave: AppConfig) => {
    // Clear previous timeout
    if (autoSaveTimeoutRef.current !== null) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (saveStatusTimeoutRef.current !== null) {
      clearTimeout(saveStatusTimeoutRef.current);
    }

    // Show saving status immediately
    setSaveStatus('saving');

    // Set new timeout (800ms debounce)
    autoSaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await invoke("save_config", { config: configToSave });

        // Handle telemetry consent
        const prefs = configToSave.preferences || defaultPreferences;
        const telemetryConsent = resolveTelemetryConsent(prefs.telemetry_consent);
        if (telemetryConsent === "granted") {
          void invoke("telemetry_initialize").catch((err) => {
            console.warn("Failed to initialize telemetry after auto-save:", err);
          });
        } else if (telemetryConsent === "denied") {
          void invoke("telemetry_clear_local_data").catch((err) => {
            console.warn("Failed to clear telemetry after auto-save:", err);
          });
        }

        // Show saved status
        setSaveStatus('saved');

        // Reset to idle after 2 seconds
        saveStatusTimeoutRef.current = window.setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus('idle');
        // Show error toast
        addToast(
          err instanceof Error ? err.message : t("settings.saveFailed"),
          "error"
        );
      }
    }, 800);
  }, [addToast, t]);

  const handleSkillUsageMonitorChange = async (enabled: boolean) => {
    if (!config) return;
    setUsageHookLoading(true);
    const prev = config.preferences?.skill_usage_monitor ?? true;
    // Optimistically update UI
    updatePreference("skill_usage_monitor", enabled);
    try {
      if (enabled) {
        await invoke("install_usage_hook");
      } else {
        await invoke("uninstall_usage_hook");
      }
      addToast(
        enabled ? t("settings.skillUsageMonitorEnabled") : t("settings.skillUsageMonitorDisabled"),
        "success",
      );
    } catch (err) {
      // Revert on failure
      updatePreference("skill_usage_monitor", prev);
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setUsageHookLoading(false);
    }
  };

  const handleRescanAllRisks = async () => {
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

  const handleClearRiskCache = async () => {
    try {
      await invoke("clear_risk_cache_command");
      addToast(t("settings.riskScanCacheCleared"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCheckUpdate = async () => {
    if (updateInfo) {
      if (updateInfo.download_url) {
        await openUrl(updateInfo.download_url);
      }
      return;
    }

    setCheckingUpdate(true);
    try {
      const info = await checkUpdate();
      if (info.has_update) {
        setUpdateInfo(info);
        addToast(`${t("settings.updateAvailable")}: ${info.latest_version}`, "success");
      } else {
        addToast(t("settings.latestVersion"), "success");
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleResetSettings = async () => {
    if (!config) return;
    const confirmed = await confirm(t("settings.resetSettingsConfirm"), {
      title: t("settings.resetSettingsConfirmTitle"),
      kind: "warning",
    });
    if (!confirmed) return;

    setResetting(true);
    try {
      // Reset preferences to defaults and clear LLM provider
      const newConfig: AppConfig = {
        ...config,
        preferences: { ...defaultPreferences },
        llm_provider: null,
      };
      await invoke("save_config", { config: newConfig });
      setConfig(newConfig);

      // Apply default theme, language, font immediately
      setTheme(defaultPreferences.theme);
      setLanguage(defaultPreferences.language);
      setFontFamily(normalizeFontFamilyPreset(defaultPreferences.font_family));

      addToast(t("settings.resetSettingsSuccess"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("settings.saveFailed"), "error");
    } finally {
      setResetting(false);
    }
  };

  if (error) {
    return (
      <div className="page-main">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="page-main" style={{ color: 'var(--muted-foreground)' }}>
        {t("common.loading")}
      </div>
    );
  }

  const prefs = config.preferences || defaultPreferences;
  const selectedEditor = availableEditors.find(e => e.id === prefs.default_editor) || availableEditors[0];
  const FallbackEditorIcon = selectedEditor ? getEditorIcon(selectedEditor.id) : null;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: 'var(--background)',
    }}>
      <PageHeader
        title={t("settings.title")}
        actions={
          saveStatus !== 'idle' ? (
            <div style={{
              fontSize: '12px',
              color: saveStatus === 'saved' ? 'var(--color-success)' : 'var(--muted-foreground)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: saveStatus === 'saved' ? 'var(--color-success-bg)' : 'var(--muted)',
              borderRadius: '6px',
              transition: 'all 0.2s ease',
            }}>
              {saveStatus === 'saving' ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {t("common.saving")}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  {t("common.saved")}
                </>
              )}
            </div>
          ) : null
        }
      />

      <main className="page-main" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="page-container" style={{ maxWidth: '760px' }}>

          {/* General Section */}
          <SectionTitle id="settings-general">{t("settings.general")}</SectionTitle>
          <SettingsCard>
            <SettingsRow
              label={t("settings.skillsDirectory")}
              description={t("settings.skillsDirectoryDesc")}
              isLast={false}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <code
                  title={config.skills_dir}
                  style={{
                    display: 'block',
                    width: '100%',
                    fontSize: '12px',
                    color: 'var(--muted-foreground)',
                    backgroundColor: 'var(--secondary)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    lineHeight: 1.5,
                  }}
                >
                  {config.skills_dir}
                </code>
              </div>
            </SettingsRow>

            <SettingsRow
              label={t("settings.defaultEditor")}
              description={t("settings.defaultEditorDesc")}
              isLast={false}
            >
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setEditorDropdownOpen(!editorDropdownOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--foreground)',
                    backgroundColor: editorDropdownOpen ? 'var(--secondary)' : 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    minWidth: '160px',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!editorDropdownOpen) {
                      e.currentTarget.style.backgroundColor = 'var(--muted)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!editorDropdownOpen) {
                      e.currentTarget.style.backgroundColor = 'var(--background)';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {selectedEditor?.icon_data ? (
                      <img
                        src={selectedEditor.icon_data}
                        alt={selectedEditor.name}
                        style={{ width: 22, height: 22, borderRadius: 5 }}
                      />
                    ) : (
                      FallbackEditorIcon && <FallbackEditorIcon />
                    )}
                    <span>{selectedEditor?.name || t("editors.builtin")}</span>
                  </div>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transition: 'transform 0.2s ease',
                      transform: editorDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {editorDropdownOpen && (
                  <>
                    <div
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 10,
                      }}
                      onClick={() => setEditorDropdownOpen(false)}
                    />
                    <div className="animate-popover" style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--glass-border-strong)',
                      borderRadius: '10px',
                      zIndex: 20,
                      minWidth: '190px',
                      padding: '5px',
                      overflow: 'hidden',
                      boxShadow: 'var(--shadow-xl)',
                    }}>
                      {availableEditors.map((editor) => {
                        const FallbackIcon = getEditorIcon(editor.id);
                        const isSelected = prefs.default_editor === editor.id;
                        return (
                          <button
                            key={editor.id}
                            onClick={() => {
                              updatePreference("default_editor", editor.id);
                              setEditorDropdownOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              width: '100%',
                              padding: '7px 10px',
                              fontSize: '13px',
                              color: isSelected ? 'var(--foreground)' : 'var(--popover-foreground)',
                              backgroundColor: isSelected ? 'var(--secondary)' : 'transparent',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'var(--accent)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            {editor.icon_data ? (
                              <img
                                src={editor.icon_data}
                                alt={editor.name}
                                style={{ width: 20, height: 20, borderRadius: 5 }}
                              />
                            ) : (
                              <FallbackIcon />
                            )}
                            <span>{editor.name}</span>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto' }}>
                                <path d="M20 6L9 17l-5-5"/>
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </SettingsRow>

            <SettingsRow
              label={t("settings.autoSync")}
              description={t("settings.autoSyncDesc")}
              isLast={false}
            >
              <Toggle
                checked={prefs.auto_sync}
                onChange={(v) => updatePreference("auto_sync", v)}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.removeLinksWhenDisablingTool")}
              description={t("settings.removeLinksWhenDisablingToolDesc")}
              isLast={false}
            >
              <Toggle
                checked={prefs.remove_links_when_disabling_tool}
                onChange={(v) => updatePreference("remove_links_when_disabling_tool", v)}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.syncNotifications")}
              description={t("settings.syncNotificationsDesc")}
              isLast={false}
            >
              <Toggle
                checked={prefs.show_sync_notifications}
                onChange={(v) => updatePreference("show_sync_notifications", v)}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.skillUsageMonitor")}
              description={t("settings.skillUsageMonitorDesc")}
              isLast={false}
            >
              <Toggle
                checked={prefs.skill_usage_monitor}
                disabled={usageHookLoading}
                onChange={handleSkillUsageMonitorChange}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.githubToken")}
              description={t("settings.githubTokenDesc")}
              isLast={true}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <PasswordInput
                  value={prefs.github_token || ""}
                  onChange={(value) => updatePreference("github_token", value)}
                  placeholder={t("settings.githubTokenPlaceholder")}
                  visible={showGithubToken}
                  onToggleVisibility={() => setShowGithubToken((v) => !v)}
                  width={240}
                />
                <span style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: (prefs.github_token || "").trim() ? 'var(--color-success)' : 'var(--muted-foreground)',
                }}>
                  {(prefs.github_token || "").trim()
                    ? t("settings.marketplaceKeySaved")
                    : t("settings.marketplaceKeyMissing")}
                </span>
              </div>
            </SettingsRow>
          </SettingsCard>

          {/* Appearance Section */}
          <SectionTitle id="settings-appearance">{t("settings.appearance")}</SectionTitle>
          <SettingsCard>
            <SettingsRow
              label={t("settings.theme")}
              description={t("settings.themeDesc")}
              isLast={false}
            >
              <ThemeSelector
                value={prefs.theme}
                onChange={(v) => updatePreference("theme", v)}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.fontFamily")}
              description={t("settings.fontFamilyDesc")}
              isLast={false}
            >
              <SegmentedControl
                value={normalizeFontFamilyPreset(prefs.font_family)}
                onChange={(v) => updatePreference("font_family", normalizeFontFamilyPreset(v))}
                options={[
                  { value: "default", label: t("settings.fontFamilyDefault") },
                  { value: "serif", label: t("settings.fontFamilySerif") },
                ]}
              />
            </SettingsRow>

            <SettingsRow
              label={t("settings.language")}
              description={t("settings.languageDesc")}
              isLast={true}
            >
              <SegmentedControl
                value={language}
                onChange={(v) => updatePreference("language", v as "en" | "zh")}
                options={[
                  { value: "en", label: "English" },
                  { value: "zh", label: "中文" },
                ]}
              />
            </SettingsRow>
          </SettingsCard>

          {/* AI Translation */}
          <SectionTitle id="settings-llm">{t("settings.llmTitle")}</SectionTitle>
          <SettingsCard>
            <LlmProviderSection
              provider={config.llm_provider ?? null}
              onChange={(p) => setConfig((prev) => prev ? { ...prev, llm_provider: p } : prev)}
              addToast={addToast}
              t={t}
            />
          </SettingsCard>

          {/* Account & Cloud Sync */}
          <SectionTitle id="settings-account">{t("settings.account")}</SectionTitle>
          <SettingsCard>
            <SettingsRow
              label={t("settings.accountStatus")}
              description={t("settings.accountDesc")}
              isLast={false}
            >
              <AuthButton variant="inline" />
            </SettingsRow>
            <div style={{
              padding: '14px 0 18px 0',
              fontSize: '12px',
              color: 'var(--muted-foreground)',
              lineHeight: 1.6,
            }}>
              <div style={{
                marginBottom: '8px',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--foreground)',
              }}>
                {t("settings.accountFeaturesTitle")}
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                <li>{t("settings.accountFeature1")}</li>
                <li>{t("settings.accountFeature2")}</li>
                <li>{t("settings.accountFeature3")}</li>
              </ul>
              <div style={{
                marginTop: '8px',
                fontSize: '11px',
                color: 'var(--muted-foreground)',
                fontStyle: 'italic',
              }}>
                {t("settings.accountComingSoon")}
              </div>
            </div>
          </SettingsCard>

          {/* Keyboard shortcuts */}
          <SectionTitle id="settings-shortcuts">{t("shortcuts.title")}</SectionTitle>
          <SettingsCard>
            <ShortcutRow
              keys={detectModKey() + "K"}
              description={t("shortcuts.openCommandPalette")}
              isLast={false}
            />
            <ShortcutRow
              keys={detectModKey() + ","}
              description={t("shortcuts.openSettings")}
              isLast={false}
            />
            <ShortcutRow
              keys={detectModKey() + "S"}
              description={t("shortcuts.saveFile")}
              isLast={true}
            />
          </SettingsCard>

          {/* Risk Scan Section */}
          <SectionTitle id="settings-risk">{t("settings.riskScanTitle")}</SectionTitle>
          <SettingsCard>
            <SettingsRow
              label={t("settings.riskScanTitle")}
              description={t("settings.riskScanDesc")}
              isLast={false}
            >
              <div style={{ display: 'flex', gap: '4px', padding: '3px', backgroundColor: 'var(--muted)', borderRadius: '8px' }}>
                {(["off", "basic", "deep"] as const).map((mode) => {
                  const active = prefs.risk_scan_mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updatePreference("risk_scan_mode", mode)}
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: active ? 'var(--background)' : 'var(--foreground)',
                        backgroundColor: active ? 'var(--foreground)' : 'transparent',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {t(`settings.riskScanMode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as any)}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>

            {prefs.risk_scan_mode === "deep" && !config?.llm_provider && (
              <div style={{ padding: '0 16px 12px', fontSize: '12px', color: 'var(--warning, #e8a317)' }}>
                {t("settings.riskScanDeepNoLlmHint")}
              </div>
            )}

            {prefs.risk_scan_mode !== "off" && (
              <SettingsRow
                label={t("settings.riskScanRescanAll")}
                description={t(`settings.riskScanMode${prefs.risk_scan_mode.charAt(0).toUpperCase() + prefs.risk_scan_mode.slice(1)}Desc` as any)}
                isLast={true}
              >
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={handleRescanAllRisks}
                    disabled={riskScanning}
                    style={{
                      padding: '8px 14px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--foreground)',
                      backgroundColor: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      cursor: riskScanning ? 'not-allowed' : 'pointer',
                      opacity: riskScanning ? 0.6 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {riskScanning ? t("settings.riskScanRescanning") : t("settings.riskScanRescanAll")}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearRiskCache}
                    style={{
                      padding: '8px 14px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--foreground)',
                      backgroundColor: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {t("settings.riskScanClearCache")}
                  </button>
                </div>
              </SettingsRow>
            )}
          </SettingsCard>

          {/* Advanced Section */}
          <SectionTitle id="settings-advanced">{t("settings.advanced")}</SectionTitle>
          <SettingsCard>
            <SettingsRow
              label={t("settings.resetSettings")}
              description={t("settings.resetSettingsDesc")}
              isLast={true}
            >
              <button
                type="button"
                onClick={handleResetSettings}
                disabled={resetting}
                style={{
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--foreground)',
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  cursor: resetting ? 'not-allowed' : 'pointer',
                  opacity: resetting ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!resetting) {
                    e.currentTarget.style.backgroundColor = 'var(--muted)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--background)';
                }}
              >
                {resetting ? t("common.checking") : t("settings.resetSettings")}
              </button>
            </SettingsRow>
          </SettingsCard>

          {/* About Section */}
          <SectionTitle id="settings-about">{t("settings.about")}</SectionTitle>
          <SettingsCard>
            <div style={{ padding: '16px 0' }}>
              {/* First row: App info and version */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}>
                <div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--foreground)',
                    marginBottom: '2px',
                  }}>
                    <a
                      href="https://github.com/jiweiyeah/Skills-Manager"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                      {t("settings.appName")}
                    </a>
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--muted-foreground)',
                  }}>
                    {t("settings.appDescription")}
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  color: 'var(--muted-foreground)',
                  flexShrink: 0,
                  marginLeft: '16px',
                }}>
                  <span>v{config.version}</span>
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 500,
                      color: updateInfo ? 'var(--primary-foreground)' : 'var(--primary)',
                      backgroundColor: updateInfo ? 'var(--primary)' : 'var(--primary-tint)',
                      border: updateInfo ? 'none' : '1px solid var(--primary-tint-border)',
                      borderRadius: '4px',
                      cursor: checkingUpdate ? 'wait' : 'pointer',
                      opacity: checkingUpdate ? 0.7 : 1,
                    }}
                  >
                    {checkingUpdate
                      ? t("common.checking")
                      : updateInfo
                        ? t("settings.updateNow")
                        : t("settings.checkUpdate")
                    }
                  </button>
                </div>
              </div>

              {/* Second row: Privacy policy link */}
              <div style={{ marginBottom: '12px' }}>
                <a
                  href={language === 'zh'
                    ? "https://github.com/jiweiyeah/Skills-Manager/blob/main/PRIVACY_CN.md"
                    : "https://github.com/jiweiyeah/Skills-Manager/blob/main/PRIVACY.md"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '12px',
                    color: 'var(--primary)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                >
                  {t("settings.privacyPolicy")}
                </a>
              </div>

              {/* Third row: Star on GitHub CTA */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border)',
              }}>
                <div style={{
                  fontSize: '12px',
                  color: 'var(--muted-foreground)',
                  flex: 1,
                }}>
                  {t("settings.starOnGithubDesc")}
                </div>
                <a
                  href="https://github.com/jiweiyeah/Skills-Manager"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--primary-foreground)',
                    backgroundColor: 'var(--primary)',
                    border: 'none',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    transition: 'opacity 0.2s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  <span>⭐</span>
                  <span>{t("settings.starOnGithub")}</span>
                </a>
              </div>
            </div>
          </SettingsCard>

          {/* Support Section */}
          <SectionTitle id="settings-support">{t("settings.support")}</SectionTitle>
          <SettingsCard>
            <div style={{ padding: '20px 0' }}>
              <div style={{
                fontSize: '13px',
                color: 'var(--muted-foreground)',
                marginBottom: '16px',
              }}>
                {t("settings.supportDesc")}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '12px',
              }}>
                <RewardCodeCard
                  title={t("settings.wechatRewardCode")}
                  imageSrc={wechatRewardCode}
                />
                <RewardCodeCard
                  title={t("settings.alipayRewardCode")}
                  imageSrc={alipayRewardCode}
                />
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                marginTop: '16px',
                fontSize: '13px',
              }}>
                <span style={{ color: 'var(--muted-foreground)' }}>
                  {t("settings.kofiSupport")}
                </span>
                <a
                  href="https://ko-fi.com/yeheboo"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--primary)',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                >
                  ko-fi.com/yeheboo
                </a>
              </div>
            </div>
          </SettingsCard>

        </div>
      </main>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// --- Sub-components ---

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      style={{
        fontSize: '15px',
        fontWeight: 600,
        color: 'var(--foreground)',
        margin: '0 0 12px 0',
        scrollMarginTop: '24px',
      }}
    >
      {children}
    </h2>
  );
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'var(--secondary)',
      borderRadius: '12px',
      border: '1px solid var(--border)',
      padding: '0 20px',
      marginBottom: '32px',
    }}>
      {children}
    </div>
  );
}

interface RewardCodeCardProps {
  title: string;
  imageSrc: string;
}

function RewardCodeCard({ title, imageSrc }: RewardCodeCardProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px',
      padding: '16px',
      borderRadius: '10px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--background)',
    }}>
      <img
        src={imageSrc}
        alt={title}
        style={{
          width: '100%',
          maxWidth: '140px',
          aspectRatio: '1 / 1',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          backgroundColor: "var(--primary-foreground)",
          objectFit: 'cover',
        }}
      />
      <div style={{
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--foreground)',
      }}>
        {title}
      </div>
    </div>
  );
}

interface SettingsRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
  isLast?: boolean;
}

function SettingsRow({ label, description, children, isLast = false }: SettingsRowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 0',
      borderBottom: isLast ? 'none' : '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, marginRight: '16px' }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--foreground)',
          marginBottom: '2px',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: '13px',
          color: 'var(--muted-foreground)',
        }}>
          {description}
        </div>
      </div>
      {children}
    </div>
  );
}

interface ThemeSelectorProps {
  value: "light" | "dark" | "system";
  onChange: (value: "light" | "dark" | "system") => void;
}

function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const { t } = useTranslation();

  const options = [
    { value: "light" as const, labelKey: "settings.themeLight" as const, icon: <SunIcon /> },
    { value: "dark" as const, labelKey: "settings.themeDark" as const, icon: <MoonIcon /> },
    { value: "system" as const, labelKey: "settings.themeSystem" as const, icon: <MonitorIcon /> },
  ];

  return (
    <div style={{
      display: 'flex',
      backgroundColor: 'var(--background)',
      borderRadius: '8px',
      padding: '3px',
      border: '1px solid var(--border)',
    }}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            backgroundColor: value === option.value ? 'var(--secondary)' : 'transparent',
            color: value === option.value ? 'var(--foreground)' : 'var(--muted-foreground)',
            transition: 'all 0.15s',
          }}
        >
          {option.icon}
          {t(option.labelKey)}
        </button>
      ))}
    </div>
  );
}

interface SegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function SegmentedControl({ value, onChange, options }: SegmentedControlProps) {
  return (
    <div style={{
      display: 'flex',
      backgroundColor: 'var(--background)',
      borderRadius: '8px',
      padding: '3px',
      border: '1px solid var(--border)',
    }}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            backgroundColor: value === option.value ? 'var(--secondary)' : 'transparent',
            color: value === option.value ? 'var(--foreground)' : 'var(--muted-foreground)',
            transition: 'all 0.15s',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  visible: boolean;
  onToggleVisibility: () => void;
  width?: number;
}

function PasswordInput({ value, onChange, placeholder, visible, onToggleVisibility, width }: PasswordInputProps) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      width: width ? `${width}px` : '100%',
    }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 36px 8px 10px',
          fontSize: '13px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          backgroundColor: 'var(--background)',
          color: 'var(--foreground)',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        title={visible ? "隐藏" : "显示"}
        style={{
          position: 'absolute',
          right: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--secondary)';
          e.currentTarget.style.color = 'var(--foreground)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--muted-foreground)';
        }}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

type ToastFn = (msg: string, kind?: "success" | "error" | "info") => void;
type TFn = (key: TranslationPath) => string;

interface LlmErrorPayload {
  kind?: string;
  info?: unknown;
}

function formatLlmError(err: unknown, t: TFn): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const e = err as LlmErrorPayload;
    switch (e.kind) {
      case "not_configured":
        return t("settings.llmErrorNotConfigured");
      case "bad_base_url":
        return t("settings.llmErrorBadBaseUrl");
      case "network_error":
        return t("settings.llmErrorNetwork");
      case "unauthorized":
        return t("settings.llmErrorUnauthorized");
      case "rate_limited":
        return t("settings.llmErrorRateLimited");
      case "server_error": {
        const info = e.info as { status?: number } | undefined;
        const code = String(info?.status ?? 0);
        return t("settings.llmErrorServer").replace("{code}", code);
      }
      case "timeout":
        return t("settings.llmErrorTimeout");
      case "parse_error":
        return t("settings.llmErrorParse");
      case "content_too_large":
        return t("settings.llmErrorTooLarge");
    }
  }
  return typeof err === "string" ? err : String(err);
}

function isValidBaseUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\/.+/.test(trimmed);
}

interface LlmProviderSectionProps {
  provider: LlmProvider | null;
  onChange: (p: LlmProvider | null) => void;
  addToast: ToastFn;
  t: TFn;
}

function LlmProviderSection({ provider, onChange, addToast, t }: LlmProviderSectionProps) {
  const { refreshConfigured } = useSkillTranslation();
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "");
  const [apiKey, setApiKey] = useState(provider?.api_key ?? "");
  const [model, setModel] = useState(provider?.model ?? "gpt-4o-mini");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildProvider = (): LlmProvider | null => {
    const base = baseUrl.trim();
    const key = apiKey.trim();
    const m = model.trim();
    if (!base || !key || !m) return null;
    if (!isValidBaseUrl(base)) return null;
    return {
      base_url: base.replace(/\/+$/, ""),
      api_key: key,
      model: m,
      temperature: null,
      max_tokens: null,
      timeout_secs: null,
    };
  };

  const validateForm = (): LlmProvider | null => {
    if (baseUrl.trim() && !isValidBaseUrl(baseUrl)) {
      addToast(t("settings.llmErrorBadBaseUrl"), "error");
      return null;
    }
    return buildProvider();
  };

  const handleTest = async () => {
    const p = validateForm();
    if (!p) return;
    setTesting(true);
    try {
      await invoke<string>("test_llm_provider", { provider: p });
      addToast(t("settings.llmTestSuccess"), "success");
    } catch (err) {
      addToast(formatLlmError(err, t), "error");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const p = validateForm();
    if (!p) return;
    setSaving(true);
    try {
      await invoke("save_llm_provider", { provider: p });
      addToast(t("settings.llmSaved"), "success");
      onChange(p);
      void refreshConfigured();
    } catch (err) {
      addToast(typeof err === "string" ? err : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      await invoke("clear_llm_provider");
      setBaseUrl("");
      setApiKey("");
      setModel("");
      addToast(t("settings.llmCleared"), "info");
      onChange(null);
      void refreshConfigured();
    } catch (err) {
      addToast(typeof err === "string" ? err : String(err), "error");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    fontSize: "13px",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div style={{ padding: "12px 0" }}>
      <p
        style={{
          fontSize: "12px",
          color: "var(--muted-foreground)",
          margin: "0 0 16px 0",
        }}
      >
        {t("settings.llmDesc")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Field label={t("settings.llmBaseUrl")} hint={t("settings.llmBaseUrlHint")}>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            style={inputStyle}
          />
        </Field>

        <Field label={t("settings.llmApiKey")}>
          <PasswordInput
            value={apiKey}
            onChange={setApiKey}
            placeholder="sk-..."
            visible={showKey}
            onToggleVisibility={() => setShowKey((v) => !v)}
          />
        </Field>

        <Field label={t("settings.llmModel")} hint={t("settings.llmModelHint")}>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            style={inputStyle}
            list="llm-model-presets"
          />
          <datalist id="llm-model-presets">
            <option value="gpt-4o-mini" />
            <option value="gpt-4o" />
            <option value="deepseek-chat" />
            <option value="qwen-plus" />
            <option value="claude-3-5-haiku-latest" />
          </datalist>
        </Field>

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || saving}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              background: "transparent",
              color: "var(--foreground)",
              cursor: testing ? "not-allowed" : "pointer",
              opacity: testing ? 0.6 : 1,
            }}
          >
            {testing ? t("settings.llmTesting") : t("settings.llmTest")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={testing || saving}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              border: "none",
              borderRadius: "6px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {t("settings.llmSave")}
          </button>
          {provider && (
            <button
              type="button"
              onClick={handleClear}
              disabled={testing || saving}
              style={{
                padding: "6px 14px",
                fontSize: "13px",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                background: "transparent",
                color: "var(--muted-foreground)",
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              {t("settings.llmClear")}
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <button
            type="button"
            onClick={async () => {
              try {
                await invoke("clear_translation_cache");
                addToast(t("settings.llmCacheCleared"), "info");
              } catch (err) {
                addToast(typeof err === "string" ? err : String(err), "error");
              }
            }}
            style={{
              fontSize: "12px",
              color: "var(--muted-foreground)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {t("settings.llmClearCache")}
          </button>
          <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
            <span>{t("settings.llmNoApiHint")} </span>
            <button
              type="button"
              onClick={() => {
                void openUrl("https://yutou.virtualgoods.top");
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--primary)",
                cursor: "pointer",
                padding: 0,
                fontSize: "12px",
                textDecoration: "underline",
              }}
            >
              {t("settings.llmNoApiCta")} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label
        style={{
          fontSize: "12px",
          fontWeight: 500,
          color: "var(--foreground)",
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}

function detectModKey(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("macintosh") || ua.includes("mac os") ? "⌘+" : "Ctrl+";
}

function ShortcutRow({
  keys,
  description,
  isLast,
}: {
  keys: string;
  description: string;
  isLast: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0",
        borderBottom: isLast ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: "13px", color: "var(--foreground)" }}>{description}</div>
      <kbd
        style={{
          fontSize: "12px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "var(--foreground)",
          backgroundColor: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "3px 8px",
          whiteSpace: "nowrap",
        }}
      >
        {keys}
      </kbd>
    </div>
  );
}

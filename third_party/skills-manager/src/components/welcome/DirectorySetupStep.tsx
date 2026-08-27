import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/i18n";
import { Folder } from "lucide-react";

interface AppConfig {
  version: string;
  skills_dir: string;
  tools: Record<string, unknown>;
}

type ToastFn = (message: string, type?: "error" | "success" | "info", persistent?: boolean) => void;

interface DirectorySetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onError?: ToastFn;
}

export function DirectorySetupStep({ onNext, onBack, onError }: DirectorySetupStepProps) {
  const { t } = useTranslation();
  const [skillsDir, setSkillsDir] = useState("");

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const config = await invoke<AppConfig>("get_config");
      setSkillsDir(config.skills_dir);
    } catch (error) {
      console.error("Failed to load config:", error);
      onError?.(t("welcome.loadConfigFailed") + ": " + String(error), "error");
    }
  }

  function handleNext() {
    onNext();
  }

  return (
    <div>
      {/* Header - no icon, just text */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 8px 0' }}>
          {t("welcome.setDirectory")}
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', margin: 0 }}>
          {t("welcome.setDirectoryDesc")}
        </p>
      </div>

      {/* Directory selector */}
      <div style={{ marginBottom: '24px' }}>
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--background)',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'var(--secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Folder style={{ width: '20px', height: '20px', color: 'var(--muted-foreground)' }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {skillsDir ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px' }}>
                  {t("welcome.skillsDirectory")}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.5 }}>
                  {skillsDir}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>{t("common.loading")}</div>
            )}
          </div>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '8px', textAlign: 'center' }}>
          {t("welcome.defaultPath")}
        </p>
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
            opacity: 1,
          }}
        >
          {t("welcome.previous")}
        </button>
        <button
          onClick={handleNext}
          disabled={!skillsDir}
          style={{
            flex: 1,
            height: '44px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--primary-foreground)',
            backgroundColor: 'var(--primary)',
            border: 'none',
            borderRadius: '10px',
            cursor: !skillsDir ? 'not-allowed' : 'pointer',
            opacity: !skillsDir ? 0.5 : 1,
          }}
        >
          {t("welcome.next")}
        </button>
      </div>
    </div>
  );
}

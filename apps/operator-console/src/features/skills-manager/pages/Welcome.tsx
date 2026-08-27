import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { WelcomeStep } from "@skills-manager/components/welcome/WelcomeStep";
import { ToolDetectionStep } from "@skills-manager/components/welcome/ToolDetectionStep";
import { DirectorySetupStep } from "@skills-manager/components/welcome/DirectorySetupStep";
import { ImportSkillsStep } from "@skills-manager/components/welcome/ImportSkillsStep";
import { useTranslation } from "@skills-manager/i18n";
import { AppConfig } from "@skills-manager/types";
import { ToastContainer, useToast } from "@skills-manager/components/ui/toast";

type WizardStep = "welcome" | "tools" | "directory" | "import";

interface WelcomeProps {
  onComplete: () => Promise<void>;
}

export function Welcome({ onComplete }: WelcomeProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState<WizardStep>("welcome");
  const [appVersion, setAppVersion] = useState<string>("");
  const { toasts, addToast, removeToast } = useToast();

  const steps: WizardStep[] = ["welcome", "tools", "directory", "import"];
  const currentIndex = steps.indexOf(currentStep);

  // Load app version once on mount
  useEffect(() => {
    async function loadVersion() {
      try {
        const config = await invoke<AppConfig>("get_config");
        if (config.version) {
          setAppVersion(config.version);
        }
      } catch (error) {
        console.error("Failed to load app version:", error);
      }
    }
    loadVersion();
  }, []);

  async function goNext() {
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    } else {
      try {
        await onComplete();
      } catch (error) {
        console.error("Failed to complete setup:", error);
        addToast(
          `${t("welcome.completeSetupFailed")}: ${String(error)}`,
          "error"
        );
      }
    }
  }

  function goBack() {
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--background)',
        overflow: 'hidden',
      }}
    >
      {/* Unified listbox styles for welcome steps */}
      <style>{`
        .welcome-listbox {
          scrollbar-width: thin;
          scrollbar-color: transparent transparent;
          transition: scrollbar-color 0.2s;
        }
        .welcome-listbox:hover {
          scrollbar-color: var(--border) transparent;
        }
        .welcome-listbox::-webkit-scrollbar {
          width: 4px;
        }
        .welcome-listbox::-webkit-scrollbar-track {
          background: transparent;
        }
        .welcome-listbox::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 2px;
          transition: background-color 0.2s;
        }
        .welcome-listbox:hover::-webkit-scrollbar-thumb {
          background: var(--border);
        }
        .welcome-listbox::-webkit-scrollbar-thumb:hover {
          background: var(--muted-foreground);
        }

        .welcome-shell {
          border: 1px solid var(--border);
          border-radius: 10px;
          background-color: var(--secondary);
          overflow: hidden;
        }
        .welcome-row {
          position: relative;
          transition: background-color 0.15s ease;
        }
        .welcome-row + .welcome-row {
          border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
        }
        .welcome-row[data-focused="true"] {
          background-color: color-mix(in srgb, var(--foreground) 3%, transparent);
        }
        .welcome-row[data-selected="true"] {
          background-color: color-mix(in srgb, var(--foreground) 4%, transparent);
        }
        .welcome-mono {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        }
      `}</style>

      {/* Draggable title bar */}
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            getCurrentWindow().startDragging();
          }
        }}
        style={{
          height: '52px',
          flexShrink: 0,
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 16px',
          gap: '8px',
        }}
      >
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px 40px',
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '40px', flexShrink: 0 }}>
          {steps.map((_, index) => (
            <div
              key={index}
              style={{
                width: index <= currentIndex ? '24px' : '8px',
                height: '8px',
                borderRadius: '4px',
                backgroundColor: index <= currentIndex ? 'var(--primary)' : 'var(--muted)',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>

        {/* Step content container */}
        <div style={{ width: '100%', maxWidth: '560px', flexShrink: 0 }}>
          {currentStep === "welcome" && <WelcomeStep onNext={goNext} />}
          {currentStep === "tools" && (
            <ToolDetectionStep onNext={goNext} onBack={goBack} onError={addToast} />
          )}
          {currentStep === "directory" && (
            <DirectorySetupStep onNext={goNext} onBack={goBack} onError={addToast} />
          )}
          {currentStep === "import" && (
            <ImportSkillsStep onNext={goNext} onBack={goBack} onError={addToast} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ paddingBottom: '20px', textAlign: 'center' }}>
        <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0, opacity: 0.6 }}>
          <a
            href="https://github.com/jiweiyeah/Skills-Manager"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            Skills Manager{appVersion ? ` v${appVersion}` : ""}
          </a>
        </p>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/i18n";
import { Package, CheckCircle2, Loader2, Check } from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
}

type ToastFn = (message: string, type?: "error" | "success" | "info", persistent?: boolean) => void;

interface ImportSkillsStepProps {
  onNext: () => void;
  onBack: () => void;
  onError?: ToastFn;
}

export function ImportSkillsStep({ onNext, onBack, onError }: ImportSkillsStepProps) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [focusedSkillPath, setFocusedSkillPath] = useState<string | null>(null);

  useEffect(() => {
    scanSkills();
  }, []);

  async function scanSkills() {
    setIsScanning(true);
    try {
      const result = await invoke<Skill[]>("scan_existing_skills");
      // Filter out hidden directories (starting with .)
      const filteredSkills = result.filter((s) => !s.name.startsWith('.'));
      setSkills(filteredSkills);
      // Default: select none, let user explicitly choose what to import
      setSelectedSkills(new Set());
    } catch (error) {
      console.error("Failed to scan skills:", error);
      onError?.(t("welcome.scanSkillsFailed") + ": " + String(error), "error");
    } finally {
      setIsScanning(false);
    }
  }

  function toggleSkill(path: string) {
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedSkills(newSelected);
  }

  function selectAll() {
    setSelectedSkills(new Set(skills.map((s) => s.path)));
  }

  function selectNone() {
    setSelectedSkills(new Set());
  }

  async function handleImport(): Promise<boolean> {
    if (selectedSkills.size === 0) {
      return true;
    }

    setIsImporting(true);
    try {
      await invoke("import_skills_to_hub", {
        skillPaths: Array.from(selectedSkills),
      });
      setImportComplete(true);
      onError?.(
        t("welcome.importedCount").replace("{count}", String(selectedSkills.size)),
        "success"
      );
      return true;
    } catch (error) {
      console.error("Failed to import skills:", error);
      onError?.(t("welcome.importFailed") + ": " + String(error), "error");
      return false;
    } finally {
      setIsImporting(false);
    }
  }

  async function handleNext() {
    if (!importComplete && selectedSkills.size > 0) {
      const success = await handleImport();
      if (!success) {
        return;
      }
    }
    onNext();
  }

  return (
    <div>
      {/* Header - no icon, just text */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 8px 0' }}>
          {t("welcome.importSkills")}
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', margin: 0 }}>
          {t("welcome.importSkillsDesc")}
        </p>
      </div>

      {/* Content */}
      <div style={{ marginBottom: '24px' }}>
        {isScanning ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Loader2 style={{ width: '32px', height: '32px', color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', marginTop: '12px' }}>{t("welcome.scanning")}</p>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : skills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: "12px",
                backgroundColor: 'var(--secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
              }}
            >
              <Package style={{ width: '28px', height: '28px', color: 'var(--muted-foreground)', opacity: 0.5 }} />
            </div>
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px' }}>{t("welcome.noSkillsFound")}</p>
            <p style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>{t("welcome.canAddLater")}</p>
          </div>
        ) : importComplete ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: "12px",
                background: 'var(--color-success)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
              }}
            >
              <CheckCircle2 style={{ width: '28px', height: '28px', color: "var(--primary-foreground)" }} />
            </div>
            <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '4px' }}>{t("welcome.importComplete")}</p>
            <p style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>
              {t("welcome.importedCount").replace("{count}", String(selectedSkills.size))}
            </p>
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
                    if (skills.length === 0) return;
                    const currentIndex = skills.findIndex((s) => s.path === focusedSkillPath);
                    let nextIndex: number;
                    if (currentIndex === -1) {
                      nextIndex = e.key === 'ArrowDown' ? 0 : skills.length - 1;
                    } else {
                      nextIndex = e.key === 'ArrowDown'
                        ? (currentIndex + 1) % skills.length
                        : (currentIndex - 1 + skills.length) % skills.length;
                    }
                    setFocusedSkillPath(skills[nextIndex].path);
                  } else if (e.key === ' ' || e.key === 'Enter') {
                    if (focusedSkillPath) {
                      e.preventDefault();
                      toggleSkill(focusedSkillPath);
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
                {skills.map((skill) => {
                  const isSelected = selectedSkills.has(skill.path);
                  const isFocused = focusedSkillPath === skill.path;
                  const description = skill.description?.trim();
                  return (
                    <button
                      key={skill.path}
                      role="option"
                      aria-selected={isFocused}
                      data-focused={isFocused}
                      data-selected={isSelected}
                      onClick={() => toggleSkill(skill.path)}
                      onMouseEnter={() => setFocusedSkillPath(skill.path)}
                      className="welcome-row"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '11px',
                        padding: '11px 14px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        border: 'none',
                        backgroundColor: 'transparent',
                      }}
                    >
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          border: isSelected ? 'none' : '1.5px solid var(--border)',
                          backgroundColor: isSelected ? 'var(--foreground)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: '2px',
                          transition: 'background-color 0.15s, border-color 0.15s',
                        }}
                      >
                        {isSelected && <Check style={{ width: '11px', height: '11px', color: 'var(--background)', strokeWidth: 3 }} />}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: isSelected ? 500 : 400,
                          color: 'var(--foreground)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          letterSpacing: '-0.01em',
                        }}>
                          {skill.name}
                        </div>
                        {description ? (
                          <div style={{
                            fontSize: '12px',
                            color: 'var(--muted-foreground)',
                            marginTop: '2px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.4,
                          }}>
                            {description}
                          </div>
                        ) : null}
                        <div className="welcome-mono" style={{
                          fontSize: '11px',
                          color: 'var(--muted-foreground)',
                          opacity: 0.7,
                          marginTop: description ? '3px' : '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          lineHeight: 1.4,
                        }}>
                          {skill.path}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <p style={{ fontSize: '12px', color: 'var(--muted-foreground)', margin: 0 }}>
                {t("welcome.selectedCount").replace("{selected}", String(selectedSkills.size)).replace("{total}", String(skills.length))}
              </p>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={selectAll}
                  disabled={selectedSkills.size === skills.length}
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: selectedSkills.size === skills.length ? 'var(--muted-foreground)' : 'var(--foreground)',
                    cursor: selectedSkills.size === skills.length ? 'not-allowed' : 'pointer',
                    opacity: selectedSkills.size === skills.length ? 0.5 : 1,
                    lineHeight: 1.4,
                  }}
                >
                  {t("welcome.selectAll")}
                </button>
                <button
                  onClick={selectNone}
                  disabled={selectedSkills.size === 0}
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: selectedSkills.size === 0 ? 'var(--muted-foreground)' : 'var(--foreground)',
                    cursor: selectedSkills.size === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedSkills.size === 0 ? 0.5 : 1,
                    lineHeight: 1.4,
                  }}
                >
                  {t("welcome.selectNone")}
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
          disabled={isImporting}
          style={{
            flex: 1,
            height: '44px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--foreground)',
            backgroundColor: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            cursor: isImporting ? 'not-allowed' : 'pointer',
            opacity: isImporting ? 0.5 : 1,
          }}
        >
          {t("welcome.previous")}
        </button>
        <button
          onClick={handleNext}
          disabled={isScanning || isImporting}
          style={{
            flex: 1,
            height: '44px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--primary-foreground)',
            backgroundColor: 'var(--primary)',
            border: 'none',
            borderRadius: '10px',
            cursor: isScanning || isImporting ? 'not-allowed' : 'pointer',
            opacity: isScanning || isImporting ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {isImporting ? (
            <>
              <Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
              {t("welcome.importing")}
            </>
          ) : skills.length === 0 || importComplete ? (
            t("welcome.completeSetup")
          ) : (
            t("welcome.importAndComplete")
          )}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { TopBar } from "@/components/TopBar";
import { SyncReport, LinkReport } from "@/types";
import { useTranslation } from "@/i18n";

interface LayoutProps {
  onOpenPalette: () => void;
}

export function Layout({ onOpenPalette }: LayoutProps) {
  const { t } = useTranslation();
  const [remainingIssues, setRemainingIssues] = useState<number>(0);
  const [autoFixedCount, setAutoFixedCount] = useState<number>(0);
  const [showBanner, setShowBanner] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    void autoCheckAndFix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function autoCheckAndFix() {
    try {
      const report = await invoke<SyncReport>("check_sync_status");
      if (report.issues_count === 0) {
        return;
      }
      const result = await invoke<LinkReport>("fix_sync_issues");
      const failed = result.failed.length;
      if (failed === 0) {
        return;
      }
      setAutoFixedCount(result.success.length);
      setRemainingIssues(failed);
      setShowBanner(true);
    } catch (err) {
      console.error("Failed to auto-fix sync issues:", err);
    }
  }

  async function handleRetry() {
    setFixing(true);
    try {
      const result = await invoke<LinkReport>("fix_sync_issues");
      const success = result.success.length;
      const failed = result.failed.length;
      if (failed === 0) {
        setShowBanner(false);
      } else {
        setAutoFixedCount((prev) => prev + success);
        setRemainingIssues(failed);
      }
    } catch (err) {
      console.error("Failed to fix sync issues:", err);
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="flex flex-col h-screen relative overflow-hidden">
      <TopBar onOpenPalette={onOpenPalette} />
      <main
        className="flex-1 min-h-0 overflow-hidden bg-background relative"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, var(--glow-ember) 0%, transparent 35%)",
        }}
      >
        {showBanner && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "12px 24px",
              backgroundColor: "var(--color-warning-bg)",
              borderBottom: "1px solid var(--color-warning-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "8px",
              zIndex: 100,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span style={{ fontSize: "14px", color: "var(--color-warning)" }}>
                {autoFixedCount > 0
                  ? t("sync.autoFixPartial")
                      .replace("{success}", String(autoFixedCount))
                      .replace("{failed}", String(remainingIssues))
                  : t("sync.issuesDetected").replace("{count}", String(remainingIssues))}
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleRetry}
                disabled={fixing}
                style={{
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#fff",
                  backgroundColor: "var(--color-warning)",
                  border: "none",
                  borderRadius: "6px",
                  cursor: fixing ? "wait" : "pointer",
                  opacity: fixing ? 0.7 : 1,
                }}
              >
                {fixing ? t("sync.fixing") : t("sync.retryFix")}
              </button>
              <button
                onClick={() => setShowBanner(false)}
                style={{
                  padding: "6px 8px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-warning)",
                  opacity: 0.6,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

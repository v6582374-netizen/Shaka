import { useState, useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@/i18n";
import { checkUpdate } from "@/services/updater";
import { AuthButton } from "@/components/auth/AuthButton";
import { ScopeSearchField } from "@/components/ScopeSearchField";
import { useActionsTarget } from "@/components/PageHeaderContext";
import { UpdateInfo } from "@/types";

interface TopBarProps {
  onOpenPalette: () => void;
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const { t } = useTranslation();
  const actionsSlotRef = useRef<HTMLDivElement | null>(null);
  const { registerActionsTarget } = useActionsTarget();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  // Register the actions slot as the portal target for PageHeader actions.
  useEffect(() => {
    registerActionsTarget?.(actionsSlotRef.current);
    return () => registerActionsTarget?.(null);
  }, [registerActionsTarget]);

  useEffect(() => {
    checkUpdate()
      .then((info) => {
        if (info.has_update) setUpdateInfo(info);
      })
      .catch((err) => console.warn("Failed to check for updates:", err));
  }, []);

  async function handleUpdateClick() {
    if (updateInfo?.download_url) {
      await openUrl(updateInfo.download_url);
    }
  }

  return (
    <header
      className="glass"
      data-tauri-drag-region
      style={{
        height: 52,
        minHeight: 52,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        border: "none",
        borderBottom: "1px solid var(--glass-border)",
        position: "relative",
        zIndex: 50,
        cursor: "grab",
      }}
    >
      {/* Traffic-light space (macOS) — the whole header is draggable */}
      <div style={{ width: 72, height: "100%", flexShrink: 0 }} />

      {/* Brand: ember ✦ + wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ color: "var(--ember)", fontSize: 14 }}>✦</span>
        <span
          style={{
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {t("topbar.brand")}
        </span>
        {updateInfo?.has_update && (
          <button
            type="button"
            onClick={handleUpdateClick}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            title={`${t("settings.updateAvailable")}: ${updateInfo.latest_version}`}
            style={{
              marginLeft: 4,
              fontSize: 10,
              padding: "2px 8px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              borderRadius: 9999,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              lineHeight: 1.4,
              flexShrink: 0,
              transition: "opacity 0.2s",
            }}
          >
            {t("marketplace.update")}
          </button>
        )}
      </div>

      {/* Left spacer — pairs with the right spacer to center the search
          field regardless of how wide the page actions slot is. */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {/* Center scope search — the field shows the current page as a chip */}
      <ScopeSearchField onOpenPalette={onOpenPalette} />

      {/* Right spacer — mirrors the left spacer so the search field stays
          visually centered when actions width changes between pages. */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {/* Page actions — portalled here by the active page's <PageHeader/> */}
      <div
        ref={actionsSlotRef}
        style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, minHeight: 28 }}
      />

      {/* Right: auth */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        <AuthButton variant="sidebar" />
      </div>
    </header>
  );
}

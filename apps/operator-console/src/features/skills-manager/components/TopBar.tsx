import { useEffect, useRef } from "react";
import { ScopeSearchField } from "@skills-manager/components/ScopeSearchField";
import { useActionsTarget } from "@skills-manager/components/PageHeaderContext";

interface TopBarProps {
  onOpenPalette: () => void;
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const actionsSlotRef = useRef<HTMLDivElement | null>(null);
  const { registerActionsTarget } = useActionsTarget();

  // Register the actions slot as the portal target for PageHeader actions.
  useEffect(() => {
    registerActionsTarget?.(actionsSlotRef.current);
    return () => registerActionsTarget?.(null);
  }, [registerActionsTarget]);

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

    </header>
  );
}

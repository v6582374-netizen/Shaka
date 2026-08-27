import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation, TranslationPath } from "@/i18n";
import { usePageHeaderState } from "@/components/PageHeaderContext";
import { CustomCaretInput } from "@/components/ui/custom-caret-input";

interface ScopeSearchFieldProps {
  onOpenPalette: () => void;
}

// 平台相关快捷键提示：macOS 显示 ⌘K，Windows/Linux 显示 Ctrl+K
const SEARCH_HINT =
  typeof navigator !== "undefined" && /macintosh|mac os/i.test(navigator.userAgent)
    ? "⌘K"
    : "Ctrl+K";

interface PageEntry {
  path: string;
  labelKey: TranslationPath;
}

const PAGES: PageEntry[] = [
  { path: "/", labelKey: "nav.skills" },
  { path: "/tools", labelKey: "nav.tools" },
  { path: "/marketplace", labelKey: "nav.marketplace" },
  { path: "/settings", labelKey: "nav.settings" },
  { path: "/feedback", labelKey: "nav.feedback" },
];

export function ScopeSearchField({ onOpenPalette }: ScopeSearchFieldProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { pageSearchQuery, setPageSearchQuery, pageSearchPlaceholder, riskScanning } = usePageHeaderState();
  // switcherQuery only filters the page-switcher dropdown (State B). The
  // page-level search query lives in context so the active page can read it.
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Determine the current page from the pathname
  const currentPage = PAGES.find((p) => p.path === location.pathname) ?? PAGES[0];

  const filteredPages = PAGES.filter((p) =>
    t(p.labelKey).toLowerCase().includes(switcherQuery.replace(/^\//, "").toLowerCase()),
  );

  // Reset active index when filter changes
  useEffect(() => {
    setActiveIdx(0);
  }, [switcherQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
        setSwitcherQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [switcherOpen]);

  // Clear the shared page search query whenever the route changes so a stale
  // filter from the previous page doesn't bleed into the next one.
  useEffect(() => {
    setPageSearchQuery("");
  }, [location.pathname, setPageSearchQuery]);

  function selectPage(path: string) {
    navigate(path);
    setSwitcherOpen(false);
    setSwitcherQuery("");
    inputRef.current?.blur();
  }

  function handleBlur() {
    // 延迟检查，让点击下拉框选项或清除按钮的 click 事件先触发并可能
    // 重新聚焦 input。若焦点移到了搜索框之外（例如点击了 TopBar
    // 拖拽区域或页面其他位置），则关闭下拉框。这补充了 mousedown
    // handler，后者无法捕获 Tauri 拖拽区域上的点击。
    setTimeout(() => {
      if (dropdownRef.current && !dropdownRef.current.contains(document.activeElement)) {
        setSwitcherOpen(false);
        setSwitcherQuery("");
      }
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (switcherOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSwitcherOpen(false);
        setSwitcherQuery("");
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % Math.max(filteredPages.length, 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filteredPages.length) % Math.max(filteredPages.length, 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = filteredPages[activeIdx];
        if (target) selectPage(target.path);
        return;
      }
    }
    // "/" opens the switcher (first press) and is always prevented from
    // being typed into the field, so it can never appear as a literal char
    // alongside the decorative "/" indicator (no double-slash).
    if (e.key === "/") {
      e.preventDefault();
      if (!switcherOpen) setSwitcherOpen(true);
    }
  }

  // In State A the input's value is the shared page search query. In State B
  // (page switcher open) the input filters the page list instead.
  const inputValue = switcherOpen ? switcherQuery : pageSearchQuery;
  const placeholder = switcherOpen
    ? t("scope.typeToFilter")
    : pageSearchPlaceholder || t("topbar.search");

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\//g, "");
    if (switcherOpen) {
      setSwitcherQuery(next);
    } else {
      setPageSearchQuery(next);
    }
  }

  return (
    <div
      ref={dropdownRef}
      style={{ position: "relative", flex: "0 1 520px", maxWidth: 520, minWidth: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 36,
          padding: "0 12px",
          background: "var(--secondary)",
          border: `1px solid ${switcherOpen ? "var(--ring)" : "var(--border)"}`,
          borderRadius: "var(--radius)",
          transition: "border-color 0.15s",
        }}
      >
        {/* 全局风险扫描进度指示：扫描中在 chip 左侧显示脉冲圆点。
            与 chip 同步隐藏（switcherOpen 时不显示），避免干扰页面切换输入。 */}
        {riskScanning && !switcherOpen && (
          <span
            title={t("settings.riskScanRescanning")}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--primary)",
              animation: "riskScanPulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
        )}
        {/* Current-page chip — click to open the page switcher.
            When the switcher is open the chip hides so typed text is the
            only content in the field (no decorative "/" to double up). */}
        {!switcherOpen && (
          <button
            type="button"
            onClick={() => {
              setSwitcherOpen(true);
              inputRef.current?.focus();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "var(--muted)",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "2px 8px",
              cursor: "pointer",
              flexShrink: 0,
            }}
            title={t("scope.switchTo")}
          >
            <span style={{ color: "var(--ember)", fontSize: 11 }}>✦</span>
            <span className="scope-chip-text" style={{ color: "var(--foreground)", fontSize: 12, fontWeight: 500 }}>
              {t(currentPage.labelKey)}
            </span>
            <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>▾</span>
          </button>
        )}
        <CustomCaretInput
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            lineHeight: 1.4,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
          }}
        />
        {(switcherOpen ? switcherQuery : pageSearchQuery).length > 0 && (
          <button
            type="button"
            aria-label={t("common.reset")}
            onClick={() => {
              if (switcherOpen) {
                setSwitcherQuery("");
              } else {
                setPageSearchQuery("");
              }
              inputRef.current?.focus();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              color: "var(--muted-foreground)",
              background: "transparent",
              border: "none",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              flexShrink: 0,
              padding: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenPalette}
          className="scope-shortcut"
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--muted-foreground)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "1px 5px",
            background: "transparent",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {SEARCH_HINT}
        </button>
      </div>

      {switcherOpen && (
        <div
          style={{
            position: "absolute",
            top: 42,
            left: 0,
            right: 0,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 200,
            padding: 4,
          }}
          className="animate-slide-down"
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
              padding: "6px 10px 4px",
            }}
          >
            {t("scope.switchTo")}
          </div>
          {filteredPages.map((page, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={page.path}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => {
                  // Prevent the input from losing focus / the outside-click
                  // mousedown handler from racing the click. The selection is
                  // driven entirely by the click handler below.
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectPage(page.path);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "var(--radius)",
                  border: "none",
                  background: isActive ? "var(--sidebar-accent)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "var(--ember)", fontSize: 11 }}>✦</span>
                <span
                  style={{
                    fontSize: 12,
                    color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  {t(page.labelKey)}
                </span>
              </button>
            );
          })}
          {filteredPages.length === 0 && (
            <div style={{ padding: "10px", fontSize: 12, color: "var(--muted-foreground)" }}>
              {t("commandPalette.noResults")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

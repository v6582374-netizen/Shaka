import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "@/i18n";
import { Skill, MarketplaceSkill, MarketplaceSkillsResponse } from "@/types";
import { MODAL_LAYER_Z_INDEX, MODAL_OVERLAY_COLOR } from "@/constants/modal";
import { CustomCaretInput } from "@/components/ui/custom-caret-input";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  section: string;
  icon?: "skill" | "market" | "settings" | "nav";
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

const MAX_LOCAL_RESULTS = 8;
const MAX_MARKETPLACE_RESULTS = 6;
const MARKETPLACE_SEARCH_MIN_LENGTH = 2;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [localSkills, setLocalSkills] = useState<Skill[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [searchingMarketplace, setSearchingMarketplace] = useState(false);
  const [localLoaded, setLocalLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const marketRequestSeqRef = useRef(0);

  // Reset state when opening
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setMarketplaceSkills([]);
    setSearchingMarketplace(false);
    // Focus input on open
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Load local skills once when first opened
  useEffect(() => {
    if (!open || localLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const skills = await invoke<Skill[]>("list_skills");
        if (!cancelled) {
          setLocalSkills(skills);
          setLocalLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setLocalSkills([]);
          setLocalLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, localLoaded]);

  // Search marketplace with debounce (only when query is long enough)
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < MARKETPLACE_SEARCH_MIN_LENGTH) {
      setMarketplaceSkills([]);
      setSearchingMarketplace(false);
      marketRequestSeqRef.current += 1;
      return;
    }

    const seq = marketRequestSeqRef.current + 1;
    marketRequestSeqRef.current = seq;
    setSearchingMarketplace(true);
    const debounceTimer = window.setTimeout(async () => {
      try {
        const result = await invoke<MarketplaceSkillsResponse>("fetch_marketplace_skills", {
          forceRefresh: false,
          query: trimmed,
          page: 1,
          sourceIds: undefined,
        });
        if (seq !== marketRequestSeqRef.current) return;
        setMarketplaceSkills(result.skills.slice(0, MAX_MARKETPLACE_RESULTS));
      } catch {
        if (seq !== marketRequestSeqRef.current) return;
        setMarketplaceSkills([]);
      } finally {
        if (seq === marketRequestSeqRef.current) {
          setSearchingMarketplace(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(debounceTimer);
    };
  }, [query, open]);

  const goToSkills = useCallback(() => {
    navigate("/");
    onClose();
  }, [navigate, onClose]);

  const goToTools = useCallback(() => {
    navigate("/tools");
    onClose();
  }, [navigate, onClose]);

  const goToMarketplace = useCallback(() => {
    navigate("/marketplace");
    onClose();
  }, [navigate, onClose]);

  const goToSettings = useCallback(() => {
    navigate("/settings");
    onClose();
  }, [navigate, onClose]);

  const goToSettingsSection = useCallback((sectionId: string) => {
    navigate("/settings");
    // Defer hash setting so the Settings page has mounted and its scroll
    // listener can react. Using setTimeout(0) keeps navigation order stable.
    window.setTimeout(() => {
      window.location.hash = sectionId;
    }, 60);
    onClose();
  }, [navigate, onClose]);

  const goToFeedback = useCallback(() => {
    navigate("/feedback");
    onClose();
  }, [navigate, onClose]);

  const openLocalSkill = useCallback((skill: Skill) => {
    navigate(`/editor?root=${encodeURIComponent(skill.path)}`);
    onClose();
  }, [navigate, onClose]);

  const goToMarketplaceSkill = useCallback((skill: MarketplaceSkill) => {
    navigate("/marketplace");
    // Defer close so navigation happens first
    window.setTimeout(() => onClose(), 0);
    // Use skill id as a hash so Marketplace can highlight it if needed
    window.setTimeout(() => {
      window.location.hash = `skill-${skill.id}`;
    }, 100);
  }, [navigate, onClose]);

  const items = useMemo<CommandItem[]>(() => {
    const trimmed = query.trim().toLowerCase();
    const result: CommandItem[] = [];

    // Navigation items (always present, filtered by query)
    const navItems: CommandItem[] = [
      { id: "nav-skills", label: t("commandPalette.navSkills"), meta: "NAV", section: t("commandPalette.sectionNavigation"), icon: "nav", action: goToSkills },
      { id: "nav-tools", label: t("commandPalette.navTools"), meta: "NAV", section: t("commandPalette.sectionNavigation"), icon: "nav", action: goToTools },
      { id: "nav-marketplace", label: t("commandPalette.navMarketplace"), meta: "NAV", section: t("commandPalette.sectionNavigation"), icon: "nav", action: goToMarketplace },
      { id: "nav-settings", label: t("commandPalette.navSettings"), meta: "NAV", section: t("commandPalette.sectionNavigation"), icon: "nav", action: goToSettings },
      { id: "nav-feedback", label: t("commandPalette.navFeedback"), meta: "NAV", section: t("commandPalette.sectionNavigation"), icon: "nav", action: goToFeedback },
    ];
    const filteredNav = trimmed
      ? navItems.filter((item) => item.label.toLowerCase().includes(trimmed))
      : navItems;
    result.push(...filteredNav);

    // Settings items
    const settingsItems: CommandItem[] = [
      { id: "set-general", label: t("commandPalette.settingGeneral"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-general") },
      { id: "set-appearance", label: t("commandPalette.settingAppearance"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-appearance") },
      { id: "set-github-token", label: t("commandPalette.settingGithubToken"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-general") },
      { id: "set-llm", label: t("commandPalette.settingLlm"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-llm") },
      { id: "set-account", label: t("commandPalette.settingAccount"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-account") },
      { id: "set-about", label: t("commandPalette.settingAbout"), meta: "SETTING", section: t("commandPalette.sectionSettings"), icon: "settings", action: () => goToSettingsSection("settings-about") },
    ];
    const filteredSettings = trimmed
      ? settingsItems.filter((item) => item.label.toLowerCase().includes(trimmed))
      : settingsItems;
    result.push(...filteredSettings);

    // Local skills
    const filteredLocal = trimmed
      ? localSkills.filter(
          (skill) =>
            skill.name.toLowerCase().includes(trimmed) ||
            skill.id.toLowerCase().includes(trimmed) ||
            (skill.description ?? "").toLowerCase().includes(trimmed),
        )
      : localSkills;
    result.push(
      ...filteredLocal.slice(0, MAX_LOCAL_RESULTS).map((skill) => ({
        id: `local-${skill.instance_id}`,
        label: skill.name,
        description: skill.description ?? undefined,
        meta: "SKILL",
        section: t("commandPalette.sectionLocal"),
        icon: "skill" as const,
        action: () => openLocalSkill(skill),
      })),
    );

    // Marketplace skills
    result.push(
      ...marketplaceSkills.map((skill) => ({
        id: `market-${skill.id}`,
        label: skill.name,
        description: skill.description ?? skill.author ?? undefined,
        meta: "SKILL",
        section: t("commandPalette.sectionMarketplace"),
        icon: "market" as const,
        action: () => goToMarketplaceSkill(skill),
      })),
    );

    return result;
  }, [query, localSkills, marketplaceSkills, t, goToSkills, goToTools, goToMarketplace, goToSettings, goToSettingsSection, goToFeedback, openLocalSkill, goToMarketplaceSkill]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || items.length === 0) return;
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open, items.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => (idx + 1) % Math.max(items.length, 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => (idx - 1 + items.length) % Math.max(items.length, 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) {
        item.action();
      }
      return;
    }
  };

  if (!open) return null;

  // Group items by section while preserving order
  const grouped: { section: string; items: CommandItem[] }[] = [];
  let currentSection = "";
  for (const item of items) {
    if (item.section !== currentSection) {
      grouped.push({ section: item.section, items: [item] });
      currentSection = item.section;
    } else {
      grouped[grouped.length - 1].items.push(item);
    }
  }

  let flatIdx = -1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        backgroundColor: MODAL_OVERLAY_COLOR,
        zIndex: MODAL_LAYER_Z_INDEX,
      }}
      onClick={onClose}
    >
      <div
        className="animate-modal glass-elevated"
        style={{
          width: "min(640px, calc(100vw - 48px))",
          maxHeight: "70vh",
          borderRadius: "var(--radius-xl)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <CustomCaretInput
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("commandPalette.placeholder")}
            style={{
              flex: 1,
              fontSize: "15px",
              lineHeight: 1.4,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--foreground)",
            }}
          />
          <kbd
            style={{
              fontSize: "10px",
              color: "var(--muted-foreground)",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "1px 6px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "6px",
          }}
        >
          {items.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                fontSize: "13px",
                color: "var(--muted-foreground)",
              }}
            >
              {searchingMarketplace ? t("commandPalette.searching") : t("commandPalette.noResults")}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.section} style={{ marginBottom: "4px" }}>
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    padding: "8px 10px 4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {group.section}
                </div>
                {group.items.map((item) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      data-idx={idx}
                      type="button"
                      onClick={() => item.action()}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`glass-row ${isActive ? "glass-row-active" : ""}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: "8px",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", color: "var(--muted-foreground)", flexShrink: 0 }}>
                        {renderIcon(item.icon)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "var(--foreground)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.label}
                        </span>
                        {item.description && (
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--muted-foreground)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.description}
                          </span>
                        )}
                      </span>
                      {item.meta && (
                        <span
                          style={{
                            fontSize: "9px",
                            fontFamily: "var(--font-mono)",
                            letterSpacing: "0.02em",
                            color: "var(--muted-foreground)",
                            background: "var(--secondary)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: "1px 5px",
                            flexShrink: 0,
                          }}
                        >
                          {item.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "9px 14px",
            borderTop: "1px solid var(--border)",
            fontSize: "11px",
            color: "var(--muted-foreground)",
          }}
        >
          <span>{t("commandPalette.hint")}</span>
          <div style={{ display: "flex", gap: "14px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--muted-foreground)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <kbd style={kbdStyle}>↑</kbd>
              <kbd style={kbdStyle}>↓</kbd>
              {t("commandPalette.navigate")}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <kbd style={kbdStyle}>↵</kbd>
              {t("scope.select")}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <kbd style={kbdStyle}>Esc</kbd>
              {t("commandPalette.close")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: "10px",
  backgroundColor: "var(--secondary)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "1px 5px",
  fontFamily: "var(--font-mono)",
  color: "var(--muted-foreground)",
};

function renderIcon(icon: CommandItem["icon"]) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (icon) {
    case "skill":
      return (
        <svg {...common}>
          <path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z" />
        </svg>
      );
    case "market":
      return (
        <svg {...common}>
          <path d="M3 7h18l-1.2 12.2a2 2 0 0 1-2 1.8H6.2a2 2 0 0 1-2-1.8L3 7z" />
          <path d="M3 7l2-4h14l2 4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "nav":
    default:
      return (
        <svg {...common}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
  }
}

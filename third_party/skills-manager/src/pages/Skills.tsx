import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronRight, ExternalLink, Layers3, List, Minus, Sparkles } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { RefreshButton } from "@/components/ui/refresh-button";
import { PageHeader } from "@/components/ui/page-header";
import { usePageSearch } from "@/components/PageHeaderContext";
import { PageLoader } from "@/components/ui/loading";
import { CustomCaretInput } from "@/components/ui/custom-caret-input";
import { Toggle } from "@/components/ui/toggle";
import {
  CREATE_SKILL_MODAL_WIDTH,
  MODAL_LAYER_Z_INDEX,
  MODAL_OVERLAY_COLOR,
} from "@/constants/modal";
import {
  AppConfig,
  BatchSetSkillToolsRequest,
  BatchSetSkillToolsResponse,
  ImportPreview,
  ImportResolution,
  ImportResult,
  InstalledSkillPackage,
  ProjectBinding,
  Skill,
  SkillRiskReport,
  SkillUsageStats,
  Tool,
} from "@/types";
import { useTranslation, TranslationPath } from "@/i18n";
import {
  useSkillTranslation,
  makeTranslationKey,
  type SkillFileTranslationProgress,
} from "@/hooks/useSkillTranslation";
import { TranslateIconButton } from "@/components/translation/TranslateIconButton";
import { useFavorites } from "@/hooks/useFavorites";
import { useClickOutside } from "@/hooks/useClickOutside";
import { FavoriteIconButton } from "@/components/favorites/FavoriteIconButton";
import {
  applyTagFilterAction,
  getGroupMetadataKey,
  getGroupTags,
  getTagFilterSelectionSummary,
  getSkillMetadataKey,
  getSkillTagsForSkill,
  getUntaggedSkillsCount,
  hasSelectableTagFilters,
  normalizeSkillTags,
  updateMetadataTags,
  updateSkillTagsForSkill,
  hasSkillMetadataEntry,
  removeSkillMetadataEntry,
  migrateSkillMetadataToInstanceIds,
} from "./skills/skillTags";
import { orderToolIdsForSkill } from "./skills/orderToolIds";
import { getEnabledToolIds } from "./skills/getEnabledToolIds";
import {
  getSkillBulkToggleConfirmKey,
  getSkillBulkToggleMode,
  getSkillBulkToggleTargets,
} from "./skills/bulkToggleSkillTools";
import {
  buildUnifiedSkillItems,
  buildUnifiedItemTagSummaries,
  filterUnifiedSkillItems,
  getGroupBulkModeState,
  getGroupMemberSkills,
  getGroupToolLabel,
  getGroupToolVisualState,
  removeGroupSkillMetadataEntries,
  shouldShowGroupToolInEnabledOnly,
  type UnifiedSkillListItem,
  sortUnifiedSkillItems,
} from "./skills/buildUnifiedSkillItems";
import {
  saveSkillsListScrollOffset,
  takeSkillsListScrollOffset,
} from "./skills/skillsListScrollState";
import {
  buildBatchTargets,
  getSelectedBatchItems,
  pruneBatchSelectionToAvailable,
  selectVisibleBatchItems,
  summarizeBatchSelection,
  toggleBatchSelection,
} from "./skills/batchManageSelection";
import { getActionableToolIds } from "./skills/getActionableToolIds";
import { BatchManageToolsDialog } from "./skills/BatchManageToolsDialog";
import { ImportConflictDialog } from "./skills/ImportConflictDialog";
import { buildBatchToolStateSummaries } from "./skills/buildBatchToolStates";
import {
  buildGroupBulkToolActionPlan,
  buildGroupSingleToolActionRequest,
} from "./skills/groupToolBatchActions";
import {
  buildGroupedSkillSections,
  type GroupedSkillSection,
} from "./skills/buildGroupedSkillSections";
import {
  buildSkillsHeaderActionLayout,
  type SkillsHeaderActionId,
} from "./skills/headerActionLayout";
import {
  buildProjectBindingFromSkillsDir,
  hasProjectSkillsDirConflict,
  resolveActiveProjectId,
  resolveNextActiveProjectIdAfterAddition,
  resolveNextProjectBindingsAfterRemoval,
} from "./projectBindings";
import { ProjectBindingsDialog } from "./ProjectBindingsDialog";
import { getToolIconUrl } from "@/assets/tools";

type SkillsListViewMode = "grouped" | "flat";

const SKILLS_LIST_VIEW_MODE_KEY = "skills-manager:skills-list-view-mode:v2";
const EXPANDED_SKILL_GROUPS_KEY = "skills-manager:expanded-skill-groups:v1";

function loadSkillsListViewMode(): SkillsListViewMode {
  try {
    return window.localStorage.getItem(SKILLS_LIST_VIEW_MODE_KEY) === "grouped" ? "grouped" : "flat";
  } catch {
    return "flat";
  }
}

function loadExpandedSkillGroups(): Set<string> {
  try {
    const stored = window.localStorage.getItem(EXPANDED_SKILL_GROUPS_KEY);
    if (!stored) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function getToolDisplayName(toolId: string, tools: Tool[]): string {
  const tool = tools.find((t) => t.id === toolId);
  if (tool) return tool.name;
  return toolId;
}

function resolveToolIconSrc(tool: Tool | undefined): string | null {
  if (!tool) return null;
  if (tool.icon_path) return convertFileSrc(tool.icon_path);
  return getToolIconUrl(tool.id);
}

function ToolIconChip({
  toolId,
  tools,
  size,
  enabled,
  detected,
}: {
  toolId: string;
  tools: Tool[];
  size: number;
  enabled: boolean;
  detected: boolean;
}) {
  const tool = tools.find((t) => t.id === toolId);
  const displayName = getToolDisplayName(toolId, tools);
  const iconSrc = resolveToolIconSrc(tool);
  return (
    <span
      title={displayName}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 10,
        height: size + 10,
        borderRadius: 6,
        flexShrink: 0,
        border: enabled
          ? "1px solid var(--primary-tint-border)"
          : "1px solid var(--border)",
        backgroundColor: enabled ? "var(--primary-tint)" : "var(--background)",
        opacity: detected ? 1 : 0.6,
      }}
    >
      {iconSrc ? (
        <img
          src={iconSrc}
          alt={displayName}
          style={{
            width: size,
            height: size,
            borderRadius: 3,
            objectFit: "cover",
            filter: enabled ? "none" : "grayscale(1)",
          }}
        />
      ) : (
        <span
          style={{
            fontSize: size * 0.5,
            fontWeight: 600,
            color: enabled ? "var(--primary)" : "var(--muted-foreground)",
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function getSkillColor(name: string): { bg: string; icon: string } {
  const colors = [
    { bg: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)", icon: "#fff" },
    { bg: "linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)", icon: "#fff" },
  ];
  const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  return colors[index];
}

function buildTagFilterMenuItemStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    width: "100%",
    padding: "6px 10px 6px 28px",
    fontSize: "12px",
    fontWeight: active ? 600 : 500,
    color: active ? "var(--primary)" : "var(--popover-foreground)",
    backgroundColor: active ? "var(--primary-tint)" : "transparent",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease",
    position: "relative",
    boxShadow: active ? "var(--shadow-highlight)" : "none",
  };
}

function TagFilterCheck({ active }: { active: boolean }) {
  return (
    <span
      style={{
        position: "absolute",
        left: "9px",
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "12px",
        height: "12px",
        color: "var(--primary)",
        opacity: active ? 1 : 0,
        transition: "opacity 0.12s ease",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

type SkillEditorTab = "tools" | "tags" | "risk";

type SkillCardActionMenuProps = {
  deleting: boolean;
  editLabel: string;
  deleteLabel: string;
  moreActionsLabel: string;
  onEdit: () => void;
  onDelete: () => void;
};

const menuItemBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "6px 10px",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--popover-foreground)",
  backgroundColor: "transparent",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  textAlign: "left",
  transition: "background-color 0.12s ease, color 0.12s ease",
  position: "relative",
};

type SkillsHeaderMoreMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

function SkillsHeaderMoreMenu({
  label,
  items,
}: {
  label: string;
  items: SkillsHeaderMoreMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, open, () => setOpen(false));

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          padding: 0,
          color: open ? "var(--foreground)" : "var(--muted-foreground)",
          backgroundColor: open ? "var(--secondary)" : "transparent",
          border: "1px solid transparent",
          borderRadius: "6px",
          cursor: "pointer",
          transition: "color 0.15s, background-color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--foreground)";
          e.currentTarget.style.backgroundColor = "var(--secondary)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.color = "var(--muted-foreground)";
            e.currentTarget.style.backgroundColor = "transparent";
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </button>

      {open && (
        <div
          className="glass-elevated animate-popover"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: "120px",
            maxHeight: "320px",
            overflow: "auto",
            padding: "8px",
            borderRadius: "var(--radius-lg)",
            zIndex: MODAL_LAYER_Z_INDEX,
            background: "var(--background)",
          }}
        >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  if (!item.disabled) {
                    item.onClick();
                  }
                }}
                style={{
                  ...menuItemBaseStyle,
                  color: item.disabled ? "var(--muted-foreground)" : "var(--popover-foreground)",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {item.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function renderPreviewChips(chips: string[], overflowCount: number) {
  if (chips.length === 0 && overflowCount === 0) {
    return null;
  }

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--primary)",
            backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
            borderRadius: "999px",
            padding: "3px 8px",
            lineHeight: 1.2,
          }}
        >
          {chip}
        </span>
      ))}
      {overflowCount > 0 && (
        <span
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--muted-foreground)",
            padding: "3px 0",
          }}
        >
          +{overflowCount}
        </span>
      )}
    </>
  );
}

function SelectionIndicator({
  checked,
  indeterminate = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="skills-selection-indicator"
      data-state={checked ? "checked" : indeterminate ? "mixed" : "unchecked"}
      aria-label={label}
      aria-pressed={checked}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {checked ? <Check size={13} strokeWidth={3} /> : indeterminate ? <Minus size={13} strokeWidth={3} /> : null}
    </button>
  );
}

function getUnifiedItemMetaLabel(item: UnifiedSkillListItem, t: (key: TranslationPath) => string) {
  if (item.kind === "group") {
    return t("skills.groupMembersCount").replace("{count}", String(item.memberCount ?? 0));
  }

  const summary = item.toolSummary;
  if (!summary || summary.state === "none") {
    return t("skills.noToolsEnabled");
  }

  if (summary.state === "all") {
    return t("skills.allEnabled");
  }

  return `${t("skills.enableFor")} ${summary.enabledCount}/${summary.totalCount}`;
}

function SkillCardActionMenu({
  deleting,
  editLabel,
  deleteLabel,
  moreActionsLabel,
  onEdit,
  onDelete,
}: SkillCardActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, open]);

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={moreActionsLabel}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            closeMenu();
            return;
          }

          const triggerRect = e.currentTarget.getBoundingClientRect();
          const gap = 6;
          const menuHeight = 96;
          const right = Math.max(8, window.innerWidth - triggerRect.right);
          const hasRoomBelow = triggerRect.bottom + gap + menuHeight <= window.innerHeight - 8;
          setMenuPosition(hasRoomBelow
            ? { top: triggerRect.bottom + gap, right }
            : { bottom: window.innerHeight - triggerRect.top + gap, right });
          setOpen(true);
        }}
        disabled={deleting}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "30px",
          padding: 0,
          borderRadius: "8px",
          border: "none",
          backgroundColor: "transparent",
          color: "var(--muted-foreground)",
          cursor: deleting ? "wait" : "pointer",
          opacity: deleting ? 0.6 : 1,
          transition: "color 0.15s ease, background-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--foreground)";
          e.currentTarget.style.backgroundColor = "var(--surface-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--muted-foreground)";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && menuPosition && createPortal(
        <>
          <button
            type="button"
            aria-label={moreActionsLabel}
            onClick={(e) => {
              e.stopPropagation();
              closeMenu();
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: MODAL_LAYER_Z_INDEX - 1,
              background: "transparent",
              border: "none",
              padding: 0,
              margin: 0,
              cursor: "default",
            }}
          />
          <div
            className="glass-elevated animate-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menuPosition.top,
              bottom: menuPosition.bottom,
              right: menuPosition.right,
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              minWidth: "120px",
              maxHeight: "320px",
              overflow: "auto",
              padding: "8px",
              borderRadius: "var(--radius-lg)",
              zIndex: MODAL_LAYER_Z_INDEX,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
                onEdit();
              }}
              style={menuItemBaseStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--surface-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {editLabel}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
                onDelete();
              }}
              disabled={deleting}
              style={{
                ...menuItemBaseStyle,
                color: "var(--destructive)",
                cursor: deleting ? "wait" : "pointer",
                opacity: deleting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-error-bg)";
                e.currentTarget.style.color = "var(--destructive)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "var(--destructive)";
              }}
            >
              {deleteLabel}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// Module-level cache: survives route changes so revisiting the Skills page
// renders the last-known data immediately (no PageLoader flash) while a
// silent background refresh runs. Same pattern Marketplace uses.
interface SkillsPageCache {
  skills: Skill[];
  skillPackages: InstalledSkillPackage[];
  tools: Tool[];
  config: AppConfig | null;
}
let skillsPageCache: SkillsPageCache | null = null;

export function Skills() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const translation = useSkillTranslation();
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [skillTranslationProgress, setSkillTranslationProgress] = useState<Record<string, SkillFileTranslationProgress>>({});
  const [batchTranslating, setBatchTranslating] = useState(false);
  const [skills, setSkills] = useState<Skill[]>(() => skillsPageCache?.skills ?? []);
  const [skillPackages, setSkillPackages] = useState<InstalledSkillPackage[]>(() => skillsPageCache?.skillPackages ?? []);
  const [tools, setTools] = useState<Tool[]>(() => skillsPageCache?.tools ?? []);
  const [config, setConfig] = useState<AppConfig | null>(() => skillsPageCache?.config ?? null);
  // Page-level search query is shared with the TopBar scope field via context,
  // so the Skills page no longer renders its own search input.
  const { query: searchQuery } = usePageSearch(t("skills.searchPlaceholder"));
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [riskOnly, setRiskOnly] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null);
  const [toolEditorSkillId, setToolEditorSkillId] = useState<string | null>(null);
  const [toolEditorQuery, setToolEditorQuery] = useState("");
  const [toolEditorEnabledOnly, setToolEditorEnabledOnly] = useState(false);
  const [bulkTogglingSkillId, setBulkTogglingSkillId] = useState<string | null>(null);
  const [groupEditorPackageId, setGroupEditorPackageId] = useState<string | null>(null);
  const [groupEditorQuery, setGroupEditorQuery] = useState("");
  const [groupEditorEnabledOnly, setGroupEditorEnabledOnly] = useState(false);
  const [togglingGroupToolKey, setTogglingGroupToolKey] = useState<string | null>(null);
  const [bulkTogglingGroupId, setBulkTogglingGroupId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importProcessing, setImportProcessing] = useState(false);
  const importZipPathRef = useRef("");
  const [showProjectBindingsDialog, setShowProjectBindingsDialog] = useState(false);
  const [pendingProjectBinding, setPendingProjectBinding] = useState<ProjectBinding | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectBindingsSaving, setProjectBindingsSaving] = useState(false);
  const [showTagFilterMenu, setShowTagFilterMenu] = useState(false);
  const tagFilterMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(tagFilterMenuRef, showTagFilterMenu, () => setShowTagFilterMenu(false));
  const [skillEditorTab, setSkillEditorTab] = useState<SkillEditorTab>("tools");
  const [tagDraft, setTagDraft] = useState("");
  const [savingTagsSkillId, setSavingTagsSkillId] = useState<string | null>(null);
  const [isBatchManageMode, setIsBatchManageMode] = useState(false);
  const [selectedBatchItemKeys, setSelectedBatchItemKeys] = useState<Set<string>>(new Set());
  const [isBatchToolDialogOpen, setIsBatchToolDialogOpen] = useState(false);
  const [batchToolQuery, setBatchToolQuery] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [initialLoading, setInitialLoading] = useState(() => skillsPageCache === null);
  const [refreshing, setRefreshing] = useState(false);
  const [skillListViewMode, setSkillListViewMode] = useState<SkillsListViewMode>(loadSkillsListViewMode);
  const [expandedSkillGroups, setExpandedSkillGroups] = useState<Set<string>>(loadExpandedSkillGroups);
  const [expandedCardKeys, setExpandedCardKeys] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<Record<string, SkillUsageStats>>({});
  const [riskReports, setRiskReports] = useState<Record<string, SkillRiskReport>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const { toasts, addToast, updateToast, removeToast } = useToast();
  const skillMetadata = config?.skill_metadata;
  const favorites = useFavorites(skillMetadata);
  const listContainerRef = useRef<HTMLElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const highlightTargetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SKILLS_LIST_VIEW_MODE_KEY, skillListViewMode);
    } catch {
      // Local storage is optional; the in-memory preference still works.
    }
  }, [skillListViewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_SKILL_GROUPS_KEY, JSON.stringify([...expandedSkillGroups]));
    } catch {
      // Local storage is optional; the in-memory expansion state still works.
    }
  }, [expandedSkillGroups]);

  const handleToggleFavorite = useCallback(async (instanceId: string, skillName: string, event: MouseEvent) => {
    event.stopPropagation();
    const willFavorite = !favorites.isSkillFavorite(instanceId);
    try {
      await favorites.toggleSkillFavorite(instanceId, willFavorite);
      addToast(
        t(willFavorite ? "skills.favoriteSuccess" : "skills.unfavoriteSuccess").replace(
          "{name}",
          skillName,
        ),
        "success",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [addToast, favorites, t]);

  const handleOpenUnifiedItem = useCallback(async (item: UnifiedSkillListItem) => {
    if (!item.openPath) {
      return;
    }

    try {
      const editorId = config?.preferences?.default_editor || "builtin";

      if (editorId === "builtin") {
        const currentScrollOffset = listContainerRef.current?.scrollTop ?? 0;
        saveSkillsListScrollOffset(currentScrollOffset);
        navigate(`/editor?root=${encodeURIComponent(item.openPath)}`);
      } else {
        await invoke("open_in_editor", { editorId, path: item.openPath });
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [config, navigate, addToast]);

  const loadRiskReports = useCallback(() => {
    invoke<Record<string, SkillRiskReport>>("get_risk_reports_batch")
      .then(setRiskReports)
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    const settled = await Promise.allSettled([
      invoke<Skill[]>("list_skills"),
      invoke<InstalledSkillPackage[]>("list_skill_packages"),
      invoke<AppConfig>("get_config"),
      invoke<Tool[]>("detect_tools"),
      invoke<Record<string, SkillUsageStats>>("get_skill_usage_stats"),
    ]);

    const [skillsR, packagesR, configR, toolsR, usageR] = settled;
    const failures: string[] = [];
    for (const r of settled) {
      if (r.status === "rejected") {
        failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }

    try {
      if (skillsR.status === "fulfilled") setSkills(skillsR.value);
      if (packagesR.status === "fulfilled") setSkillPackages(packagesR.value);
      if (toolsR.status === "fulfilled") setTools(toolsR.value);
      if (usageR.status === "fulfilled") setUsageStats(usageR.value);

      if (configR.status === "fulfilled") {
        const configResult = configR.value;
        const skillsForMigration = skillsR.status === "fulfilled" ? skillsR.value : [];
        const migratedSkillMetadata = migrateSkillMetadataToInstanceIds(
          skillsForMigration,
          configResult.skill_metadata,
        );
        const nextConfig = migratedSkillMetadata === configResult.skill_metadata
          ? configResult
          : { ...configResult, skill_metadata: migratedSkillMetadata };
        if (nextConfig !== configResult) {
          try {
            await invoke("save_config", { config: nextConfig });
          } catch (err) {
            failures.push(err instanceof Error ? err.message : String(err));
          }
        }
        setConfig(nextConfig);
      }

      for (const msg of failures) {
        addToast(msg, "error");
      }
    } finally {
      setInitialLoading(false);
      // 后台异步加载风险报告，不阻塞页面首屏
      void loadRiskReports();
    }
  }, [addToast, loadRiskReports]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [skillsResult, skillPackagesResult, configResult, toolsResult, usageResult] = await Promise.all([
        invoke<Skill[]>("refresh_skills"),
        invoke<InstalledSkillPackage[]>("list_skill_packages"),
        invoke<AppConfig>("get_config"),
        invoke<Tool[]>("detect_tools"),
        invoke<Record<string, SkillUsageStats>>("get_skill_usage_stats"),
      ]);
      setSkills(skillsResult);
      setSkillPackages(skillPackagesResult);
      setConfig(configResult);
      setTools(toolsResult);
      setUsageStats(usageResult);
      addToast(t("common.refreshSuccess"), "success");
      // 后台异步刷新风险报告
      void loadRiskReports();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRefreshing(false);
    }
  }, [addToast, t, loadRiskReports]);

  const reloadData = useCallback(async () => {
    try {
      const [skillsResult, skillPackagesResult, configResult, toolsResult] = await Promise.all([
        invoke<Skill[]>("list_skills"),
        invoke<InstalledSkillPackage[]>("list_skill_packages"),
        invoke<AppConfig>("get_config"),
        invoke<Tool[]>("detect_tools"),
      ]);
      setSkills(skillsResult);
      setSkillPackages(skillPackagesResult);
      setConfig(configResult);
      setTools(toolsResult);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [addToast]);

  // Track whether this mount had cached data. If so, skip the automatic
  // loadData() — the cache was just populated moments ago when the user was
  // last on this page. The background Tauri calls would return identical data
  // but with new object references, triggering a wasteful full re-render of
  // 38+ useMemos and all skill cards. The user can click refresh for fresh data.
  const hadCacheOnMountRef = useRef(skillsPageCache !== null);

  useEffect(() => {
    if (hadCacheOnMountRef.current) return;
    loadData();
  }, [loadData]);

  // 监听 usage-stats-updated 事件，自动刷新调用次数统计
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen("usage-stats-updated", () => {
      invoke<Record<string, SkillUsageStats>>("get_skill_usage_stats")
        .then(setUsageStats)
        .catch(() => {});
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 监听 risk-scan-completed 事件，自动刷新风险报告
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen("risk-scan-completed", () => {
      invoke<Record<string, SkillRiskReport>>("get_risk_reports_batch")
        .then(setRiskReports)
        .catch(() => {});
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Keep the module-level cache in sync with the latest loaded data so the
  // next mount can render immediately without a PageLoader flash.
  useEffect(() => {
    if (initialLoading) return;
    skillsPageCache = { skills, skillPackages, tools, config };
  }, [initialLoading, skills, skillPackages, tools, config]);

  // Note: translation cache preloading is handled centrally by
  // SkillTranslationProvider (see useSkillTranslation.tsx). A page-level
  // preload effect here would duplicate the IPC calls and, worse, re-run
  // whenever the `skills` array reference changes (e.g. after background
  // refresh), each time triggering bump() → full app re-render.

  const persistMetadataTags = useCallback(async (metadataKey: string, nextTags: string[]) => {
    if (!config) {
      return;
    }

    const previousConfig = config;
    const nextSkillMetadata = updateMetadataTags(metadataKey, nextTags, config.skill_metadata);
    const nextConfig: AppConfig = {
      ...config,
      skill_metadata: nextSkillMetadata,
    };

    setConfig(nextConfig);
    setSavingTagsSkillId(metadataKey);

    try {
      await invoke("save_config", { config: nextConfig });
    } catch (err) {
      setConfig(previousConfig);
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingTagsSkillId(null);
    }
  }, [addToast, config]);

  const persistSkillTags = useCallback(async (skill: Skill, nextTags: string[]) => {
    if (!config) {
      return;
    }

    const previousConfig = config;
    const nextSkillMetadata = updateSkillTagsForSkill(skill, nextTags, config.skill_metadata);
    const nextConfig: AppConfig = {
      ...config,
      skill_metadata: nextSkillMetadata,
    };

    setConfig(nextConfig);
    setSavingTagsSkillId(getSkillMetadataKey(skill));

    try {
      await invoke("save_config", { config: nextConfig });
    } catch (err) {
      setConfig(previousConfig);
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingTagsSkillId(null);
    }
  }, [addToast, config]);

  const toggleTagFilter = useCallback((tag: string) => {
    const next = applyTagFilterAction(
      { selectedTags, untaggedOnly },
      { type: "toggle-tag", tag },
    );
    setSelectedTags(next.selectedTags);
    setUntaggedOnly(next.untaggedOnly);
    setShowTagFilterMenu(false);
  }, [selectedTags, untaggedOnly]);

  const handleToggleUntaggedOnly = useCallback(() => {
    const next = applyTagFilterAction(
      { selectedTags, untaggedOnly },
      { type: "toggle-untagged" },
    );
    setSelectedTags(next.selectedTags);
    setUntaggedOnly(next.untaggedOnly);
    setRiskOnly(false);
    setShowTagFilterMenu(false);
  }, [selectedTags, untaggedOnly]);

  const handleToggleRiskOnly = useCallback(() => {
    setRiskOnly((prev) => !prev);
    // 风险筛选与未标记筛选互斥
    setUntaggedOnly(false);
    setShowTagFilterMenu(false);
  }, []);

  const handleResetTagFilters = useCallback(() => {
    const next = applyTagFilterAction(
      { selectedTags, untaggedOnly },
      { type: "reset" },
    );
    setSelectedTags(next.selectedTags);
    setUntaggedOnly(next.untaggedOnly);
    setRiskOnly(false);
    setScopeFilter("all");
    setShowTagFilterMenu(false);
  }, [selectedTags, untaggedOnly]);

  const handleAddTag = useCallback(async (skill: Skill) => {
    const nextTag = normalizeSkillTags([tagDraft])[0];
    if (!nextTag) {
      return;
    }

    const currentTags = getSkillTagsForSkill(skill, skillMetadata);
    if (currentTags.includes(nextTag)) {
      setTagDraft("");
      return;
    }

    await persistSkillTags(skill, [...currentTags, nextTag]);
    setTagDraft("");
  }, [persistSkillTags, skillMetadata, tagDraft]);

  const handleRemoveTag = useCallback(async (skill: Skill, tag: string) => {
    const nextTags = getSkillTagsForSkill(skill, skillMetadata).filter((item: string) => item !== tag);
    await persistSkillTags(skill, nextTags);
  }, [persistSkillTags, skillMetadata]);

  const handleToggle = async (instanceId: string, skillName: string, toolId: string, enabled: boolean) => {
    const toggleKey = `${instanceId}:${toolId}`;
    setTogglingSkill(toggleKey);
    try {
      if (enabled) {
        await invoke("enable_skill", { instanceId, toolId });
        addToast(t("skills.enableSuccess").replace("{skill}", skillName).replace("{tool}", getToolDisplayName(toolId, tools)), "success");
      } else {
        await invoke("disable_skill", { instanceId, toolId });
        addToast(t("skills.disableSuccess").replace("{skill}", skillName).replace("{tool}", getToolDisplayName(toolId, tools)), "success");
      }
      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setTogglingSkill(null);
    }
  };

  const openSkillEditor = useCallback((skillIdentity: string, tab: SkillEditorTab = "tools") => {
    setToolEditorSkillId(skillIdentity);
    setGroupEditorPackageId(null);
    setSkillEditorTab(tab);
    setToolEditorQuery("");
    setToolEditorEnabledOnly(false);
    setGroupEditorQuery("");
    setGroupEditorEnabledOnly(false);
    setTagDraft("");
    setShowTagFilterMenu(false);
  }, []);

  const openGroupEditor = useCallback((packageId: string) => {
    setGroupEditorPackageId(packageId);
    setToolEditorSkillId(null);
    setSkillEditorTab("tools");
    setToolEditorQuery("");
    setToolEditorEnabledOnly(false);
    setGroupEditorQuery("");
    setGroupEditorEnabledOnly(false);
    setTagDraft("");
    setShowTagFilterMenu(false);
  }, []);

  const closeSkillEditor = useCallback(() => {
    setToolEditorSkillId(null);
    setGroupEditorPackageId(null);
    setSkillEditorTab("tools");
    setToolEditorQuery("");
    setToolEditorEnabledOnly(false);
    setGroupEditorQuery("");
    setGroupEditorEnabledOnly(false);
    setTagDraft("");
  }, []);

  const handleBulkToggle = useCallback(async (skill: Skill, visibleToolIds: string[]) => {
    const bulkMode = getSkillBulkToggleMode(visibleToolIds, skill.enabled, tools);
    const targetToolIds = getSkillBulkToggleTargets(visibleToolIds, skill.enabled, tools, bulkMode);
    if (targetToolIds.length === 0) {
      return;
    }

    const enabled = bulkMode === "enable";
    const confirmed = await confirm(
      t(getSkillBulkToggleConfirmKey(bulkMode)).replace("{count}", String(targetToolIds.length)),
      {
        title: t("skills.bulkConfirmTitle"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    setBulkTogglingSkillId(skill.instance_id);

    setSkills((prevSkills) =>
      prevSkills.map((item) => {
        if (item.instance_id !== skill.instance_id) {
          return item;
        }

        const nextEnabled = { ...item.enabled };
        targetToolIds.forEach((toolId) => {
          nextEnabled[toolId] = enabled;
        });

        return { ...item, enabled: nextEnabled };
      }),
    );

    try {
      const command = enabled ? "enable_skill" : "disable_skill";
      const results = await Promise.allSettled(
        targetToolIds.map((toolId) => invoke(command, { instanceId: skill.instance_id, toolId })),
      );

      const failedCount = results.filter((result) => result.status === "rejected").length;
      const changedCount = targetToolIds.length - failedCount;

      if (changedCount > 0) {
        const successMessage = enabled ? t("skills.bulkEnableSuccess") : t("skills.bulkDisableSuccess");
        addToast(successMessage.replace("{count}", String(changedCount)), "success");
      }

      if (failedCount > 0) {
        const failedMessage = t("skills.bulkTogglePartialFailed").replace("{count}", String(failedCount));
        addToast(failedMessage, "error");
      }

      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
      await reloadData();
    } finally {
      setBulkTogglingSkillId(null);
    }
  }, [addToast, reloadData, t, tools]);

  const formatTranslationError = useCallback(
    (err: unknown): string => {
      if (typeof err === "object" && err !== null && "kind" in err) {
        const e = err as { kind?: string; info?: unknown };
        switch (e.kind) {
          case "not_configured": return t("settings.llmErrorNotConfigured");
          case "bad_base_url": return t("settings.llmErrorBadBaseUrl");
          case "network_error": return t("settings.llmErrorNetwork");
          case "unauthorized": return t("settings.llmErrorUnauthorized");
          case "rate_limited": return t("settings.llmErrorRateLimited");
          case "server_error": {
            const info = e.info as { status?: number } | undefined;
            return t("settings.llmErrorServer").replace("{code}", String(info?.status ?? 0));
          }
          case "timeout": return t("settings.llmErrorTimeout");
          case "parse_error": return t("settings.llmErrorParse");
          case "content_too_large": return t("settings.llmErrorTooLarge");
        }
      }
      return typeof err === "string" ? err : String(err);
    },
    [t],
  );

  const handleTranslateSkill = useCallback(
    async (skill: Skill, force: boolean = false) => {
      let configured = translation.isConfigured;
      if (!configured) {
        configured = await translation.refreshConfigured();
      }
      if (!configured) {
        addToast(t("skills.llmNotConfigured"), "error");
        return;
      }
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.add(skill.instance_id);
        return next;
      });
      try {
        const result = await translation.translateSkillFiles(skill.instance_id, language, force, (progress) => {
          setSkillTranslationProgress((prev) => ({
            ...prev,
            [skill.instance_id]: progress,
          }));
        });
        if (result.failed.length > 0) {
          addToast(
            t("editor.translateFilesPartialFailed")
              .replace("{ok}", String(result.files.length))
              .replace("{fail}", String(result.failed.length)),
            "error",
          );
        }
      } catch (err) {
        addToast(formatTranslationError(err), "error");
      } finally {
        setSkillTranslationProgress((prev) => {
          const next = { ...prev };
          delete next[skill.instance_id];
          return next;
        });
        setTranslatingIds((prev) => {
          const next = new Set(prev);
          next.delete(skill.instance_id);
          return next;
        });
      }
    },
    [translation, language, addToast, t, formatTranslationError],
  );

  const handleBatchTranslate = useCallback(
    async (skillsToTranslate: Skill[]) => {
      let configured = translation.isConfigured;
      if (!configured) {
        configured = await translation.refreshConfigured();
      }
      if (!configured) {
        addToast(t("skills.llmNotConfigured"), "error");
        return;
      }

      const pending: Skill[] = [];
      let skipped = 0;
      for (const skill of skillsToTranslate) {
        const key = makeTranslationKey(skill.instance_id, language);
        if (translation.getTranslation(key)) {
          skipped += 1;
        } else {
          pending.push(skill);
        }
      }

      if (pending.length === 0) {
        addToast(t("skills.batchTranslateNoNew"), "info");
        return;
      }

      const confirmMessage = skipped > 0
        ? t("skills.batchTranslateConfirmSkip")
            .replace("{new}", String(pending.length))
            .replace("{skipped}", String(skipped))
        : t("skills.batchTranslateConfirm").replace("{count}", String(pending.length));

      const confirmed = await confirm(confirmMessage, { title: t("skills.batchTranslate") });
      if (!confirmed) return;

      setBatchTranslating(true);
      let progressToastId: string | undefined;
      try {
        const ids = pending.map((s) => s.instance_id);
        const result = await translation.translateBatch(ids, language, (p) => {
          const progressMsg = t("skills.batchTranslateProgress")
            .replace("{current}", String(p.current))
            .replace("{total}", String(p.total))
            .replace("{name}", p.skill_name);

          if (!progressToastId) {
            // 创建持久化进度 toast
            progressToastId = addToast(progressMsg, "info", true);
          } else {
            // 更新现有 toast
            updateToast(progressToastId, progressMsg);
          }
        });

        // 翻译完成：移除进度 toast，显示结果
        if (progressToastId) {
          removeToast(progressToastId);
        }

        const fail = result.failed.length;
        const ok = result.succeeded.length;
        addToast(
          t("skills.batchTranslateDone")
            .replace("{ok}", String(ok))
            .replace("{total}", String(pending.length))
            .replace("{fail}", String(fail)),
          fail > 0 ? "error" : "success",
        );
      } catch (err) {
        if (progressToastId) {
          removeToast(progressToastId);
        }
        addToast(formatTranslationError(err), "error");
      } finally {
        setBatchTranslating(false);
      }
    },
    [translation, language, addToast, updateToast, removeToast, t, formatTranslationError],
  );

  const handleDelete = async (skill: Skill) => {
    const confirmed = await confirm(t("skills.deleteConfirm").replace("{name}", skill.name), {
      title: t("skills.delete"),
      kind: "warning",
    });
    if (!confirmed) return;

    setDeletingSkill(skill.instance_id);
    try {
      await invoke("delete_skill", { instanceId: skill.instance_id });
      if (toolEditorSkillId === skill.instance_id) {
        closeSkillEditor();
      }
      if (config && hasSkillMetadataEntry(skill, config.skill_metadata)) {
        const nextConfig: AppConfig = {
          ...config,
          skill_metadata: removeSkillMetadataEntry(skill, config.skill_metadata),
        };
        try {
          await invoke("save_config", { config: nextConfig });
          setConfig(nextConfig);
        } catch (cleanupError) {
          addToast(cleanupError instanceof Error ? cleanupError.message : String(cleanupError), "error");
        }
      }
      addToast(t("skills.deleteSuccess").replace("{name}", skill.name), "success");
      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDeletingSkill(null);
    }
  };

  const handleCreateSkill = async (
    skillName: string,
    skillDescription: string,
    targetToolIds: string[],
    tags: string[],
  ) => {
    setCreating(true);
    try {
      const newSkill = await invoke<Skill>("create_skill", {
        name: skillName,
        description: skillDescription || null,
      });

      // 创建后按选择启用到目标工具
      for (const toolId of targetToolIds) {
        try {
          await invoke("enable_skill", { instanceId: newSkill.instance_id, toolId });
        } catch (err) {
          addToast(
            t("skills.enableFailed").replace("{tool}", getToolDisplayName(toolId, tools)),
            "error",
          );
        }
      }

      // 创建后按输入设置标签
      if (tags.length > 0 && config) {
        try {
          const nextSkillMetadata = updateSkillTagsForSkill(newSkill, tags, config.skill_metadata);
          const nextConfig: AppConfig = {
            ...config,
            skill_metadata: nextSkillMetadata,
          };
          await invoke("save_config", { config: nextConfig });
          setConfig(nextConfig);
        } catch (err) {
          addToast(err instanceof Error ? err.message : String(err), "error");
        }
      }

      addToast(t("skills.createSuccess").replace("{name}", skillName), "success");
      setShowCreateDialog(false);

      const editorId = config?.preferences?.default_editor || "builtin";
      if (editorId === "builtin") {
        navigate(`/editor?root=${encodeURIComponent(newSkill.path)}`);
      } else {
        await invoke("open_in_editor", { editorId, path: newSkill.path });
        await reloadData();
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCreating(false);
    }
  };

  const unifiedItems = useMemo(() => buildUnifiedSkillItems({
    skills,
    skillPackages,
    tools,
    skillMetadata,
    groupBadgeLabel: t("skills.groupBadge"),
  }), [skillMetadata, skillPackages, skills, t, tools]);

  const allTagSummaries = useMemo(
    () => buildUnifiedItemTagSummaries(unifiedItems),
    [unifiedItems],
  );

  const untaggedSkillsCount = useMemo(
    () => getUntaggedSkillsCount(skills, skillMetadata),
    [skillMetadata, skills],
  );

  const showTagFilterControl = useMemo(
    () => hasSelectableTagFilters(allTagSummaries),
    [allTagSummaries],
  );

  const tagFilterSelection = useMemo(
    () => getTagFilterSelectionSummary(selectedTags, untaggedOnly),
    [selectedTags, untaggedOnly],
  );

  const activeProjectName = useMemo(() => {
    const projects = config?.projects ?? [];
    const activeId = resolveActiveProjectId(config?.active_project_id, projects);
    if (!activeId) {
      return null;
    }
    return projects.find((project) => project.id === activeId)?.name ?? null;
  }, [config?.active_project_id, config?.projects]);

  const hasActiveSkillFilters = Boolean(searchQuery.trim()) || selectedTags.length > 0 || untaggedOnly || riskOnly || scopeFilter !== "all";

  // Active tag-filter conditions shown as a numeric badge on the filter icon.
  const tagFilterActiveCount =
    (scopeFilter !== "all" ? 1 : 0) +
    (untaggedOnly ? 1 : 0) +
    (riskOnly ? 1 : 0) +
    selectedTags.length;

  const scopeFilterCounts = useMemo(() => {
    const globalCount = unifiedItems.filter((item) => item.scopeLabel === "global").length;
    const projectCount = unifiedItems.filter((item) => item.scopeLabel === "project").length;
    return { global: globalCount, project: projectCount };
  }, [unifiedItems]);

  const riskMarkedCount = useMemo(() => {
    return unifiedItems.filter((item) =>
      item.kind === "skill" && item.skill
        ? riskReports[item.skill.instance_id]?.level !== "safe" && riskReports[item.skill.instance_id]?.level !== undefined
        : false,
    ).length;
  }, [unifiedItems, riskReports]);

  const filteredUnifiedItems = useMemo(() => {
    const base = filterUnifiedSkillItems(unifiedItems, {
      searchQuery,
      selectedTags,
      untaggedOnly,
      scopeFilter,
    });
    let result = base;
    if (riskOnly) {
      result = base.filter((item) =>
        item.kind === "skill" && item.skill
          ? riskReports[item.skill.instance_id]?.level !== "safe" && riskReports[item.skill.instance_id]?.level !== undefined
          : false,
      );
    }
    if (!favoritesOnly) return result;
    // 仅看收藏：只保留已收藏的 skill（group 项不参与）
    return result.filter((item) =>
      item.kind === "skill" && item.skill
        ? favorites.isSkillFavorite(item.skill.instance_id)
        : false,
    );
  }, [searchQuery, selectedTags, unifiedItems, untaggedOnly, riskOnly, scopeFilter, riskReports, favoritesOnly, favorites]);

  const sortedUnifiedItems = useMemo(() => {
    const sorted = sortUnifiedSkillItems(filteredUnifiedItems, searchQuery);
    // 已收藏的 skill 置顶（按收藏时间倒序，最新收藏在前）
    const ts = favorites.skillFavoriteTimestamps;
    if (ts.size === 0) return sorted;
    return [...sorted].sort((a, b) => {
      const aFav = a.kind === "skill" && a.skill ? ts.get(a.skill.instance_id) : undefined;
      const bFav = b.kind === "skill" && b.skill ? ts.get(b.skill.instance_id) : undefined;
      if (aFav && bFav) return bFav - aFav;
      if (aFav) return -1;
      if (bFav) return 1;
      return 0;
    });
  }, [filteredUnifiedItems, searchQuery, favorites.skillFavoriteTimestamps]);

  const groupedSkillCollection = useMemo(
    () => buildGroupedSkillSections(unifiedItems, sortedUnifiedItems),
    [sortedUnifiedItems, unifiedItems],
  );

  const flatSkillItems = useMemo(
    () => sortedUnifiedItems.filter((item) => item.kind === "skill"),
    [sortedUnifiedItems],
  );

  const hasVisibleSkillItems = skillListViewMode === "grouped"
    ? groupedSkillCollection.groups.length > 0 || groupedSkillCollection.standaloneSkills.length > 0
    : flatSkillItems.length > 0;

  const forceExpandFilteredGroups = hasActiveSkillFilters;

  useEffect(() => {
    const highlight = searchParams.get("highlight");
    if (!highlight || initialLoading) return;

    const matched = sortedUnifiedItems.find(
      (item) => item.skill?.marketplace_meta?.marketplace_skill_id === highlight,
    );
    if (!matched) return;

    setHighlightKey(matched.key);
    setSearchParams(
      (prev) => {
        prev.delete("highlight");
        return prev;
      },
      { replace: true },
    );
  }, [searchParams, sortedUnifiedItems, initialLoading, setSearchParams]);

  useEffect(() => {
    if (!highlightKey) return;
    const scrollTimer = window.setTimeout(() => {
      highlightTargetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimer = window.setTimeout(() => setHighlightKey(null), 4500);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightKey]);

  const actionableToolIds = useMemo(
    () => getActionableToolIds(tools),
    [tools],
  );

  const visibleBatchItemKeys = useMemo(() => {
    if (skillListViewMode === "flat") {
      return flatSkillItems.map((item) => item.key);
    }

    return [
      ...groupedSkillCollection.groups.flatMap((section) => section.members.map((item) => item.key)),
      ...groupedSkillCollection.standaloneSkills.map((item) => item.key),
    ];
  }, [flatSkillItems, groupedSkillCollection, skillListViewMode]);

  const allBatchItemKeys = useMemo(
    () => unifiedItems.map((item) => item.key),
    [unifiedItems],
  );

  const selectedBatchItems = useMemo(
    () => getSelectedBatchItems(unifiedItems, selectedBatchItemKeys),
    [selectedBatchItemKeys, unifiedItems],
  );

  const batchSelectionSummary = useMemo(
    () => summarizeBatchSelection(selectedBatchItems, skills),
    [selectedBatchItems, skills],
  );

  const batchToolStates = useMemo(
    () => buildBatchToolStateSummaries(selectedBatchItems, skills, tools),
    [selectedBatchItems, skills, tools],
  );

  const headerActionLayout = useMemo(
    () => buildSkillsHeaderActionLayout(isBatchManageMode),
    [isBatchManageMode],
  );

  // In batch mode, compute the set of skill instance_ids to export based on
  // current selection (expands group selections to their member skills).
  const selectedExportInstanceIds = useMemo(() => {
    if (!isBatchManageMode || selectedBatchItems.length === 0) {
      return undefined;
    }
    const ids = new Set<string>();
    selectedBatchItems.forEach((item) => {
      if (item.kind === "skill" && item.skill) {
        ids.add(item.skill.instance_id);
      } else if (item.kind === "group" && item.skillPackage) {
        getGroupMemberSkills(item.skillPackage, skills).forEach((s) =>
          ids.add(s.instance_id),
        );
      }
    });
    return ids.size > 0 ? Array.from(ids) : undefined;
  }, [isBatchManageMode, selectedBatchItems, skills]);

  const enterBatchManageMode = useCallback(() => {
    setIsBatchManageMode(true);
  }, []);

  const exitBatchManageMode = useCallback(() => {
    setIsBatchManageMode(false);
    setSelectedBatchItemKeys(new Set());
    setIsBatchToolDialogOpen(false);
    setBatchToolQuery("");
    setExpandedCardKeys(new Set());
  }, []);

  const handleToggleCardExpand = useCallback((itemKey: string) => {
    setExpandedCardKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  }, []);

  const handleToggleSkillGroup = useCallback((packageId: string) => {
    setExpandedSkillGroups((current) => {
      const next = new Set(current);
      if (next.has(packageId)) {
        next.delete(packageId);
      } else {
        next.add(packageId);
      }
      return next;
    });
  }, []);

  const handleToggleBatchItemSelection = useCallback((itemKey: string) => {
    setSelectedBatchItemKeys((current) => toggleBatchSelection(current, itemKey));
  }, []);

  const handleSelectAllVisibleItems = useCallback(() => {
    setSelectedBatchItemKeys((current) => selectVisibleBatchItems(current, visibleBatchItemKeys));
  }, [visibleBatchItemKeys]);

  const handleClearBatchSelection = useCallback(() => {
    setSelectedBatchItemKeys(new Set());
  }, []);

  const handleExportSkills = useCallback(async (instanceIds?: string[]) => {
    // Filter to global-scope, local/imported source skills (matches backend rule).
    const eligibleInstanceIds = skills
      .filter((skill) => skill.scope === "global"
        && (skill.source === "local" || skill.source === "imported"))
      .map((skill) => skill.instance_id);

    if (eligibleInstanceIds.length === 0) {
      addToast(t("skills.exportNoSkills"), "error");
      return;
    }

    // If caller passed explicit ids (batch mode), intersect with eligible.
    const targetIds = instanceIds
      ? instanceIds.filter((id) => eligibleInstanceIds.includes(id))
      : undefined;

    if (targetIds && targetIds.length === 0) {
      addToast(t("skills.exportNoSkills"), "error");
      return;
    }

    const defaultName = `skills-export-${new Date().toISOString().slice(0, 10)}.zip`;
    const outputPath = await save({
      defaultPath: defaultName,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });

    if (!outputPath || typeof outputPath !== "string") {
      return;
    }

    try {
      const exportedCount = await invoke<number>("export_skills", {
        instanceIds: targetIds,
        outputPath,
      });
      addToast(
        t("skills.exportSuccess").replace("{count}", String(exportedCount)),
        "success",
      );
    } catch (err) {
      addToast(
        t("skills.exportFailed").replace(
          "{error}",
          err instanceof Error ? err.message : String(err),
        ),
        "error",
      );
    }
  }, [addToast, skills, t]);

  const handleImportSkills = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
      title: t("skills.importSelectFile"),
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    const zipPath = selected as string;
    try {
      const preview = await invoke<ImportPreview>("preview_import_skills", { zipPath });
      importZipPathRef.current = zipPath;
      setImportPreview(preview);
      setImportDialogOpen(true);
    } catch (err) {
      addToast(
        t("skills.importFailed").replace(
          "{error}",
          err instanceof Error ? err.message : String(err),
        ),
        "error",
      );
    }
  }, [addToast, t]);

  const handleConfirmImport = useCallback(async (resolutions: ImportResolution[]) => {
    if (!importPreview) {
      return;
    }

    setImportProcessing(true);
    try {
      const result = await invoke<ImportResult>("import_skills", {
        zipPath: importZipPathRef.current,
        resolutions,
      });

      const importedCount = result.imported.length + result.renamed.length;
      const failedCount = result.failed.length;
      addToast(
        t("skills.importResultSummary")
          .replace("{imported}", String(importedCount))
          .replace("{failed}", String(failedCount)),
        failedCount > 0 ? "error" : "success",
      );

      setImportDialogOpen(false);
      setImportPreview(null);
      await reloadData();
    } catch (err) {
      addToast(
        t("skills.importFailed").replace(
          "{error}",
          err instanceof Error ? err.message : String(err),
        ),
        "error",
      );
    } finally {
      setImportProcessing(false);
    }
  }, [addToast, importPreview, reloadData, t]);

  const handleCloseImportDialog = useCallback(() => {
    if (importProcessing) {
      return;
    }
    setImportDialogOpen(false);
    setImportPreview(null);
  }, [importProcessing]);

  const handleOpenBatchToolDialog = useCallback(() => {
    if (selectedBatchItems.length === 0) {
      addToast(t("skills.batchNoSelection"), "error");
      return;
    }

    setIsBatchToolDialogOpen(true);
  }, [addToast, selectedBatchItems.length, t]);

  const renderHeaderActionButton = useCallback((actionId: SkillsHeaderActionId) => {
    switch (actionId) {
      case "batch-manage":
        return (
          <button
            key={actionId}
            type="button"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 500,
              color: isBatchManageMode ? "var(--primary-foreground)" : "var(--foreground)",
              backgroundColor: isBatchManageMode ? "var(--foreground)" : "var(--background)",
              border: isBatchManageMode ? "none" : "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
            onClick={isBatchManageMode ? exitBatchManageMode : enterBatchManageMode}
          >
            {isBatchManageMode ? t("skills.exitBatchManage") : t("skills.batchManage")}
          </button>
        );
      case "batch-configure":
        return (
          <button
            key={actionId}
            type="button"
            onClick={handleOpenBatchToolDialog}
            disabled={selectedBatchItems.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: selectedBatchItems.length === 0 ? "not-allowed" : "pointer",
              opacity: selectedBatchItems.length === 0 ? 0.6 : 1,
            }}
          >
            {t("skills.batchConfigureTools")}
          </button>
        );
      case "project-bindings":
        return (
          <button
            key={actionId}
            type="button"
            onClick={handleOpenProjectBindingsDialog}
            disabled={isBatchManageMode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: isBatchManageMode ? "not-allowed" : "pointer",
              opacity: isBatchManageMode ? 0.6 : 1,
            }}
          >
            {t("settings.projectBindings")}
          </button>
        );
      case "export-skills":
        // Primary action in batch mode: export selection if any, else all.
        return (
          <button
            key={actionId}
            type="button"
            onClick={() => void handleExportSkills(selectedExportInstanceIds)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {selectedExportInstanceIds && selectedExportInstanceIds.length > 0
              ? t("skills.exportSelectedSkills")
              : t("skills.exportAllSkills")}
          </button>
        );
      case "create-skill":
        return (
          <button
            key={actionId}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              padding: 0,
              color: isBatchManageMode ? "var(--muted-foreground)" : "var(--primary-foreground)",
              backgroundColor: isBatchManageMode ? "transparent" : "var(--primary)",
              border: "1px solid transparent",
              borderRadius: "6px",
              cursor: isBatchManageMode ? "not-allowed" : "pointer",
              transition: "color 0.15s, background-color 0.15s, box-shadow 0.15s",
              opacity: isBatchManageMode ? 0.5 : 1,
              boxShadow: isBatchManageMode ? "none" : "var(--shadow-sm)",
            }}
            onMouseEnter={(e) => {
              if (!isBatchManageMode) {
                e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--primary) 85%, transparent)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isBatchManageMode ? "transparent" : "var(--primary)";
            }}
            onClick={() => {
              if (!isBatchManageMode) {
                setShowCreateDialog(true);
              }
            }}
            title={t("skills.newSkill")}
            aria-label={t("skills.newSkill")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        );
    }
  }, [
    enterBatchManageMode,
    exitBatchManageMode,
    handleExportSkills,
    handleOpenBatchToolDialog,
    isBatchManageMode,
    selectedBatchItems.length,
    selectedExportInstanceIds,
    t,
  ]);

  const handleCloseBatchToolDialog = useCallback(() => {
    if (batchSubmitting) {
      return;
    }

    setIsBatchToolDialogOpen(false);
  }, [batchSubmitting]);

  const handleOpenProjectBindingsDialog = useCallback(() => {
    if (isBatchManageMode) {
      return;
    }
    setShowProjectBindingsDialog(true);
  }, [isBatchManageMode]);

  const saveProjectBindingsConfig = useCallback(async (nextConfig: AppConfig) => {
    const previousConfig = config;
    const previousSkills = skills;
    setConfig(nextConfig);
    setProjectBindingsSaving(true);

    try {
      await invoke("save_config", { config: nextConfig });
      const refreshedSkills = await invoke<Skill[]>("refresh_skills");
      setSkills(refreshedSkills);
    } catch (err) {
      if (previousConfig) {
        setConfig(previousConfig);
      }
      setSkills(previousSkills);
      addToast(err instanceof Error ? err.message : String(err), "error");
      throw err;
    } finally {
      setProjectBindingsSaving(false);
    }
  }, [addToast, config, skills]);

  const handleAddProjectBinding = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("settings.selectProjectSkillsDir"),
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    try {
      setPendingProjectBinding(buildProjectBindingFromSkillsDir(selected));
    } catch (err) {
      if (err instanceof Error) {
        addToast(err.message, "error");
      } else if (typeof err === "string") {
        addToast(err, "error");
      }
    }
  }, [addToast, t]);

  const handlePendingProjectNameChange = useCallback((name: string) => {
    setPendingProjectBinding((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        name,
      };
    });
  }, []);

  const handleCancelPendingProjectBinding = useCallback(() => {
    setPendingProjectBinding(null);
  }, []);

  const handleConfirmPendingProjectBinding = useCallback(async () => {
    if (!config || !pendingProjectBinding) {
      return;
    }

    try {
      const nextProject = buildProjectBindingFromSkillsDir(
        pendingProjectBinding.skills_dir,
        pendingProjectBinding.name,
      );
      const existingProjects = config.projects ?? [];
      if (hasProjectSkillsDirConflict(existingProjects, nextProject)) {
        addToast(t("settings.projectAlreadyAdded").replace("{name}", nextProject.name), "error");
        return;
      }

      const nextConfig: AppConfig = {
        ...config,
        projects: [...existingProjects, nextProject],
        active_project_id: resolveNextActiveProjectIdAfterAddition(
          config.active_project_id,
          existingProjects,
          nextProject,
        ),
      };
      await saveProjectBindingsConfig(nextConfig);
      setPendingProjectBinding(null);
      addToast(t("settings.projectAdded").replace("{name}", nextProject.name), "success");
    } catch (err) {
      if (err instanceof Error) {
        addToast(err.message, "error");
      } else if (typeof err === "string") {
        addToast(err, "error");
      }
    }
  }, [addToast, config, pendingProjectBinding, saveProjectBindingsConfig, t]);

  const handleCloseProjectBindingsDialog = useCallback(() => {
    if (projectBindingsSaving) {
      return;
    }
    setPendingProjectBinding(null);
    setShowProjectBindingsDialog(false);
  }, [projectBindingsSaving]);

  const handleSetActiveProjectBinding = useCallback(async (projectId: string | null) => {
    if (!config) {
      return;
    }

    const nextConfig: AppConfig = {
      ...config,
      active_project_id: resolveActiveProjectId(projectId, config.projects ?? []),
    };
    await saveProjectBindingsConfig(nextConfig);
  }, [config, saveProjectBindingsConfig]);

  const handleRemoveProjectBinding = useCallback(async (projectId: string) => {
    if (!config) {
      return;
    }

    const nextProjectBindings = resolveNextProjectBindingsAfterRemoval(
      config.projects,
      projectId,
      config.active_project_id,
    );
    const nextConfig: AppConfig = {
      ...config,
      projects: nextProjectBindings.projects,
      active_project_id: nextProjectBindings.activeProjectId,
    };
    await saveProjectBindingsConfig(nextConfig);
  }, [config, saveProjectBindingsConfig]);

  const handleSubmitBatchToolAction = useCallback(async (
    action: "enable" | "disable",
    toolIdsForAction: string[],
    confirmMessage: string,
    options?: { closeOnSuccess?: boolean },
  ) => {
    if (selectedBatchItems.length === 0) {
      addToast(t("skills.batchNoSelection"), "error");
      return;
    }

    if (toolIdsForAction.length === 0) {
      addToast(t("skills.batchNoToolsSelected"), "error");
      return;
    }

    const confirmed = await confirm(confirmMessage, {
      title: t("skills.bulkConfirmTitle"),
      kind: "warning",
    });
    if (!confirmed) {
      return;
    }

    setBatchSubmitting(true);

    try {
      const request: BatchSetSkillToolsRequest = {
        targets: buildBatchTargets(selectedBatchItems),
        tool_ids: toolIdsForAction,
        action,
      };
      const response = await invoke<BatchSetSkillToolsResponse>("batch_set_skill_tools", { request });

      if (response.applied_count > 0) {
        addToast(t("skills.batchSubmitSuccess").replace("{count}", String(response.applied_count)), "success");
      } else if (response.failed_count === 0 && response.skipped_count > 0) {
        addToast(t("skills.batchNoChangesNeeded"), "success");
      }

      if (response.failed_count > 0) {
        addToast(t("skills.batchSubmitPartialFailed").replace("{count}", String(response.failed_count)), "error");
      }

      await reloadData();
      if (options?.closeOnSuccess ?? true) {
        exitBatchManageMode();
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBatchSubmitting(false);
    }
  }, [addToast, exitBatchManageMode, reloadData, selectedBatchItems, t]);

  const handleBatchToolToggle = useCallback(async (toolId: string, enabled: boolean) => {
    const confirmKey = enabled ? "skills.batchConfirmEnableSelectedTools" : "skills.batchConfirmDisableSelectedTools";
    const confirmMessage = t(confirmKey)
      .replace("{count}", String(batchSelectionSummary.totalCount))
      .replace("{affected}", String(batchSelectionSummary.affectedSkillCount))
      .replace("{tools}", "1");

    await handleSubmitBatchToolAction(enabled ? "enable" : "disable", [toolId], confirmMessage, {
      closeOnSuccess: false,
    });
  }, [batchSelectionSummary.totalCount, handleSubmitBatchToolAction, t]);

  const handleBatchTranslateSelected = useCallback(async () => {
    const targets = selectedBatchItems
      .filter((item) => item.kind === "skill" && item.skill)
      .map((item) => item.skill!) as Skill[];
    if (targets.length === 0) {
      addToast(t("skills.batchTranslateNoSkills"), "info");
      return;
    }
    await handleBatchTranslate(targets);
  }, [addToast, handleBatchTranslate, selectedBatchItems, t]);

  const handleBatchDeleteSelected = useCallback(async () => {
    if (selectedBatchItems.length === 0) {
      return;
    }
    const confirmed = await confirm(
      t("skills.batchDeleteConfirm").replace("{count}", String(selectedBatchItems.length)),
      {
        title: t("skills.batchDeleteConfirmTitle"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    setBatchDeleting(true);
    let successCount = 0;
    let failedCount = 0;
    try {
      for (const item of selectedBatchItems) {
        try {
          if (item.kind === "skill" && item.skill) {
            await invoke("delete_skill", { instanceId: item.skill.instance_id });
            if (config?.skill_metadata && hasSkillMetadataEntry(item.skill, config.skill_metadata)) {
              const nextConfig: AppConfig = {
                ...config,
                skill_metadata: removeSkillMetadataEntry(item.skill, config.skill_metadata),
              };
              try {
                await invoke("save_config", { config: nextConfig });
                setConfig(nextConfig);
              } catch {
                // metadata 清理失败不阻断主流程
              }
            }
          } else if (item.kind === "group" && item.skillPackage) {
            await invoke("remove_skill_package", { packageId: item.skillPackage.package_id });
            if (config?.skill_metadata) {
              const nextConfig: AppConfig = {
                ...config,
                skill_metadata: removeGroupSkillMetadataEntries(
                  config.skill_metadata,
                  item.skillPackage.installed_members,
                  item.skillPackage.package_id,
                ),
              };
              try {
                await invoke("save_config", { config: nextConfig });
                setConfig(nextConfig);
              } catch {
                // metadata 清理失败不阻断主流程
              }
            }
          }
          successCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      if (successCount > 0) {
        addToast(t("skills.batchDeleteSuccess").replace("{count}", String(successCount)), "success");
      }
      if (failedCount > 0) {
        addToast(t("skills.batchDeletePartialFailed").replace("{count}", String(failedCount)), "error");
      }
      exitBatchManageMode();
      await reloadData();
    } finally {
      setBatchDeleting(false);
    }
  }, [addToast, config, exitBatchManageMode, reloadData, selectedBatchItems, t]);

  useEffect(() => {
    if (!isBatchManageMode) {
      return;
    }

    setSelectedBatchItemKeys((current) => pruneBatchSelectionToAvailable(current, allBatchItemKeys));
  }, [allBatchItemKeys, isBatchManageMode]);

  const toolIds = useMemo(
    () => getEnabledToolIds(tools),
    [tools],
  );

  const toolsById = useMemo(
    () => new Map(tools.map((tool) => [tool.id, tool])),
    [tools],
  );

  const toolEditorSkill = useMemo(
    () => skills.find((skill) => skill.instance_id === toolEditorSkillId) ?? null,
    [skills, toolEditorSkillId],
  );

  const toolEditorOrderedToolIds = useMemo(() => {
    if (!toolEditorSkill) {
      return [];
    }

    return orderToolIdsForSkill(toolIds, toolEditorSkill.enabled);
  }, [toolEditorSkill, toolIds]);

  const toolEditorFilteredToolIds = useMemo(() => {
    if (!toolEditorSkill) {
      return [];
    }

    const normalizedQuery = toolEditorQuery.trim().toLowerCase();
    return toolEditorOrderedToolIds.filter((toolId) => {
      if (toolEditorEnabledOnly && !toolEditorSkill.enabled[toolId]) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const displayName = getToolDisplayName(toolId, tools).toLowerCase();
      return displayName.includes(normalizedQuery) || toolId.toLowerCase().includes(normalizedQuery);
    });
  }, [toolEditorEnabledOnly, toolEditorOrderedToolIds, toolEditorQuery, toolEditorSkill, tools]);

  const toolEditorEnabledCount = useMemo(() => {
    if (!toolEditorSkill) {
      return 0;
    }
    return toolEditorOrderedToolIds.filter((toolId) => Boolean(toolEditorSkill.enabled[toolId])).length;
  }, [toolEditorOrderedToolIds, toolEditorSkill]);

  const toolEditorBulkToggleMode = useMemo(() => {
    if (!toolEditorSkill) {
      return "enable";
    }

    return getSkillBulkToggleMode(toolEditorFilteredToolIds, toolEditorSkill.enabled, tools);
  }, [toolEditorFilteredToolIds, toolEditorSkill, tools]);

  const toolEditorBulkToggleTargets = useMemo(() => {
    if (!toolEditorSkill) {
      return [];
    }

    return getSkillBulkToggleTargets(
      toolEditorFilteredToolIds,
      toolEditorSkill.enabled,
      tools,
      toolEditorBulkToggleMode,
    );
  }, [toolEditorFilteredToolIds, toolEditorSkill, tools, toolEditorBulkToggleMode]);

  const toolEditorIsBulkToggling = toolEditorSkill ? bulkTogglingSkillId === toolEditorSkill.instance_id : false;
  const toolEditorHasPendingSingleToggle = toolEditorSkill
    ? Boolean(togglingSkill?.startsWith(`${toolEditorSkill.instance_id}:`))
    : false;
  const toolEditorBulkToggleDisabled =
    toolEditorIsBulkToggling || toolEditorHasPendingSingleToggle || toolEditorBulkToggleTargets.length === 0;
  const toolEditorBulkToggleLabel = toolEditorIsBulkToggling
    ? t("skills.bulkUpdating")
    : toolEditorBulkToggleMode === "enable"
      ? t("skills.bulkEnable")
      : t("skills.bulkDisable");

  const toolEditorItems = useMemo(() => {
    if (!toolEditorSkill) {
      return [];
    }

    const skillStats = usageStats[toolEditorSkill.id];
    return toolEditorFilteredToolIds.map((toolId) => {
      const isEnabled = toolEditorSkill.enabled[toolId] ?? false;
      const toggleKey = `${toolEditorSkill.instance_id}:${toolId}`;
      const isToggling = togglingSkill === toggleKey;
      const tool = tools.find((item) => item.id === toolId);
      const isDetected = tool?.detected ?? false;
      const isToolEnabled = tool?.config.enabled ?? false;
      const isDisabled = toolEditorIsBulkToggling || isToggling || !isDetected || !isToolEnabled;

      return {
        id: toolId,
        label: getToolDisplayName(toolId, tools),
        enabled: isEnabled,
        disabled: isDisabled,
        tooltip: !isDetected ? t("skills.toolNotDetected") : undefined,
        dimmed: !isDetected,
        callCount: skillStats?.by_tool[toolId] ?? 0,
      };
    });
  }, [toolEditorFilteredToolIds, toolEditorIsBulkToggling, toolEditorSkill, togglingSkill, tools, t, usageStats]);

  const toolEditorTags = useMemo(
    () => (toolEditorSkill ? getSkillTagsForSkill(toolEditorSkill, skillMetadata) : []),
    [skillMetadata, toolEditorSkill],
  );
  const toolEditorTagSuggestions = useMemo(() => {
    if (!toolEditorSkill) {
      return [];
    }

    return allTagSummaries
      .map((item) => item.tag)
      .filter((tag) => !toolEditorTags.includes(tag))
      .slice(0, 8);
  }, [allTagSummaries, toolEditorSkill, toolEditorTags]);

  const groupEditorItem = useMemo(
    () => unifiedItems.find((item) => item.kind === "group" && item.id === groupEditorPackageId) ?? null,
    [groupEditorPackageId, unifiedItems],
  );

  const groupEditorMetadataKey = useMemo(
    () => (groupEditorItem ? getGroupMetadataKey(groupEditorItem.id) : null),
    [groupEditorItem],
  );

  const groupEditorTags = useMemo(
    () => (groupEditorItem ? getGroupTags(groupEditorItem.id, skillMetadata) : []),
    [groupEditorItem, skillMetadata],
  );

  const groupEditorTagSuggestions = useMemo(() => {
    if (!groupEditorItem) {
      return [];
    }

    return allTagSummaries
      .map((item) => item.tag)
      .filter((tag) => !groupEditorTags.includes(tag))
      .slice(0, 8);
  }, [allTagSummaries, groupEditorItem, groupEditorTags]);

  const groupEditorOrderedToolIds = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return [];
    }

    return orderToolIdsForSkill(
      toolIds,
      getGroupBulkModeState(groupEditorItem.groupToolStateById),
    );
  }, [groupEditorItem, toolIds]);

  const groupEditorFilteredToolIds = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return [];
    }

    const normalizedQuery = groupEditorQuery.trim().toLowerCase();
    return groupEditorOrderedToolIds.filter((toolId) => {
      const toolState = groupEditorItem.groupToolStateById?.[toolId];
      if (!toolState) {
        return false;
      }

      if (groupEditorEnabledOnly && !shouldShowGroupToolInEnabledOnly(toolState)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const displayName = getToolDisplayName(toolId, tools).toLowerCase();
      return displayName.includes(normalizedQuery) || toolId.toLowerCase().includes(normalizedQuery);
    });
  }, [groupEditorEnabledOnly, groupEditorItem, groupEditorOrderedToolIds, groupEditorQuery, tools]);

  const groupEditorEnabledCount = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return 0;
    }

    return Object.values(groupEditorItem.groupToolStateById).filter((state) => state.fullyEnabled).length;
  }, [groupEditorItem]);

  const groupEditorBulkToggleMode = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return "enable";
    }

    return getSkillBulkToggleMode(
      groupEditorFilteredToolIds,
      getGroupBulkModeState(groupEditorItem.groupToolStateById),
      tools,
    );
  }, [groupEditorFilteredToolIds, groupEditorItem, tools]);

  const groupEditorBulkToggleTargets = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return [];
    }

    return getSkillBulkToggleTargets(
      groupEditorFilteredToolIds,
      getGroupBulkModeState(groupEditorItem.groupToolStateById),
      tools,
      groupEditorBulkToggleMode,
    );
  }, [groupEditorBulkToggleMode, groupEditorFilteredToolIds, groupEditorItem, tools]);

  const groupEditorIsBulkToggling = groupEditorItem ? bulkTogglingGroupId === groupEditorItem.id : false;
  const groupEditorHasPendingSingleToggle = groupEditorItem
    ? Boolean(togglingGroupToolKey?.startsWith(`${groupEditorItem.id}:`))
    : false;
  const groupEditorBulkToggleDisabled =
    groupEditorIsBulkToggling || groupEditorHasPendingSingleToggle || groupEditorBulkToggleTargets.length === 0;
  const groupEditorBulkToggleLabel = groupEditorIsBulkToggling
    ? t("skills.bulkUpdating")
    : groupEditorBulkToggleMode === "enable"
      ? t("skills.bulkEnable")
      : t("skills.bulkDisable");

  const groupEditorItems = useMemo(() => {
    if (!groupEditorItem?.groupToolStateById) {
      return [];
    }

    return groupEditorFilteredToolIds.map((toolId) => {
      const state = groupEditorItem.groupToolStateById?.[toolId];
      const toggleKey = `${groupEditorItem.id}:${toolId}`;
      const isToggling = togglingGroupToolKey === toggleKey;
      const tool = tools.find((item) => item.id === toolId);
      const isDetected = tool?.detected ?? false;
      const isToolEnabled = tool?.config.enabled ?? false;
      const isDisabled = groupEditorIsBulkToggling || isToggling || !isDetected || !isToolEnabled;
      return {
        id: toolId,
        label: state ? getGroupToolLabel(getToolDisplayName(toolId, tools), state) : getToolDisplayName(toolId, tools),
        enabled: state ? getGroupToolVisualState(state) : false,
        disabled: isDisabled,
        tooltip: !isDetected ? t("skills.toolNotDetected") : undefined,
        dimmed: !isDetected,
      };
    });
  }, [groupEditorFilteredToolIds, groupEditorIsBulkToggling, groupEditorItem, togglingGroupToolKey, tools, t]);

  const handleGroupToggle = useCallback(async (groupItem: UnifiedSkillListItem, toolId: string, enabled: boolean) => {
    const request = buildGroupSingleToolActionRequest(groupItem, toolId, enabled);
    if (!request) {
      return;
    }

    const toggleKey = `${groupItem.id}:${toolId}`;
    setTogglingGroupToolKey(toggleKey);
    try {
      const response = await invoke<BatchSetSkillToolsResponse>("batch_set_skill_tools", { request });

      if (response.applied_count > 0) {
        const message = enabled ? t("skills.groupToolEnableSuccess") : t("skills.groupToolDisableSuccess");
        addToast(
          message.replace("{count}", String(response.applied_count)).replace("{tool}", getToolDisplayName(toolId, tools)),
          "success",
        );
      }

      if (response.failed_count > 0) {
        addToast(t("skills.bulkTogglePartialFailed").replace("{count}", String(response.failed_count)), "error");
      }

      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
      await reloadData();
    } finally {
      setTogglingGroupToolKey(null);
    }
  }, [addToast, reloadData, t, tools]);

  const handleGroupBulkToggle = useCallback(async (groupItem: UnifiedSkillListItem, visibleToolIds: string[]) => {
    const skillPackage = groupItem.skillPackage;
    const plan = buildGroupBulkToolActionPlan(groupItem, visibleToolIds, tools);
    if (!skillPackage || !plan) {
      return;
    }

    const confirmed = await confirm(
      plan.bulkMode === "enable"
        ? t("skills.groupBulkConfirmEnable")
          .replace("{tools}", String(plan.targetToolIds.length))
          .replace("{members}", String(skillPackage.installed_members.length))
        : t("skills.groupBulkConfirmDisable")
          .replace("{tools}", String(plan.targetToolIds.length))
          .replace("{members}", String(skillPackage.installed_members.length)),
      {
        title: t("skills.bulkConfirmTitle"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    setBulkTogglingGroupId(groupItem.id);
    try {
      const response = await invoke<BatchSetSkillToolsResponse>("batch_set_skill_tools", { request: plan.request });

      if (response.applied_count > 0) {
        const successMessage = plan.bulkMode === "enable" ? t("skills.groupBulkEnableSuccess") : t("skills.groupBulkDisableSuccess");
        addToast(successMessage.replace("{count}", String(response.applied_count)), "success");
      }

      if (response.failed_count > 0) {
        addToast(t("skills.bulkTogglePartialFailed").replace("{count}", String(response.failed_count)), "error");
      }

      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
      await reloadData();
    } finally {
      setBulkTogglingGroupId(null);
    }
  }, [addToast, reloadData, t, tools]);

  const handleDeleteGroup = useCallback(async (groupItem: UnifiedSkillListItem) => {
    const skillPackage = groupItem.skillPackage;
    if (!skillPackage) {
      return;
    }

    const confirmed = await confirm(
      t("skills.groupDeleteConfirm")
        .replace("{name}", groupItem.title)
        .replace("{count}", String(skillPackage.installed_members.length)),
      {
        title: t("skills.delete"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }

    setDeletingGroupId(groupItem.id);
    try {
      await invoke("remove_skill_package", { packageId: skillPackage.package_id });
      if (groupEditorPackageId === groupItem.id) {
        closeSkillEditor();
      }
      if (config?.skill_metadata) {
        const nextConfig: AppConfig = {
          ...config,
          skill_metadata: removeGroupSkillMetadataEntries(
            config.skill_metadata,
            skillPackage.installed_members,
            skillPackage.package_id,
          ),
        };
        try {
          await invoke("save_config", { config: nextConfig });
          setConfig(nextConfig);
        } catch (cleanupError) {
          addToast(cleanupError instanceof Error ? cleanupError.message : String(cleanupError), "error");
        }
      }
      addToast(t("skills.groupDeleteSuccess").replace("{name}", groupItem.title), "success");
      await reloadData();
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDeletingGroupId(null);
    }
  }, [addToast, closeSkillEditor, config, groupEditorPackageId, reloadData, t]);

  useEffect(() => {
    if (initialLoading || hasRestoredScrollRef.current) {
      return;
    }

    const container = listContainerRef.current;
    if (!container) {
      return;
    }

    const savedScrollOffset = takeSkillsListScrollOffset();
    if (savedScrollOffset === null) {
      hasRestoredScrollRef.current = true;
      return;
    }

    container.scrollTop = savedScrollOffset;
    hasRestoredScrollRef.current = true;
  }, [initialLoading, sortedUnifiedItems.length]);

  if (initialLoading) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--background)",
      }}>
        <PageHeader title={t("skills.title")} />
        <main className="page-main" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <PageLoader />
        </main>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--background)",
      }}>
        <PageHeader title={t("skills.title")} />
        <main className="page-main" style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          color: "var(--muted-foreground)",
        }}>
          <div>{t("skills.loadFailed")}</div>
          <button
            onClick={() => {
              setInitialLoading(true);
              loadData();
            }}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--primary)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {t("common.retry")}
          </button>
        </main>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  const renderSkillListRow = (
    item: UnifiedSkillListItem,
    parentGroup: UnifiedSkillListItem | null = null,
  ) => {
    if (item.kind !== "skill" || !item.skill) {
      return null;
    }

    const skill = item.skill;
    const translationKey = makeTranslationKey(skill.instance_id, language);
    const translated = translation.getTranslation(translationKey);
    const isTranslatedView = translation.getView(translationKey) === "translated" && translated != null;
    const title = isTranslatedView && translated ? translated.name : item.title;
    const description = isTranslatedView && translated
      ? translated.description || t("skills.noDescription")
      : item.description || t("skills.noDescription");
    const isSelected = selectedBatchItemKeys.has(item.key);
    const isExpanded = expandedCardKeys.has(item.key);
    const isHighlighted = highlightKey === item.key;
    const owningGroup = parentGroup ?? groupedSkillCollection.groupBySkillKey.get(item.key) ?? null;
    const riskReport = riskReports[skill.instance_id];
    const fileProgress = skillTranslationProgress[skill.instance_id];
    const fileProgressText = fileProgress
      ? t("editor.translateFilesCompact")
          .replace("{current}", String(fileProgress.current))
          .replace("{total}", String(fileProgress.total))
          .replace("{path}", fileProgress.path)
      : null;

    return (
      <div
        key={item.key}
        ref={isHighlighted ? highlightTargetRef : undefined}
        className="skills-list-row-anchor"
      >
        <article
          className={`skills-list-row${parentGroup ? " is-group-member" : ""}${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}`}
        >
          <div className="skills-list-row-main">
            {isBatchManageMode && (
              <SelectionIndicator
                checked={isSelected}
                label={title}
                onToggle={() => handleToggleBatchItemSelection(item.key)}
              />
            )}

            <button
              type="button"
              className="skills-list-row-summary"
              aria-expanded={isExpanded}
              aria-label={t(isExpanded ? "skills.collapseSkillDetails" : "skills.expandSkillDetails")}
              onClick={() => {
                if (isBatchManageMode) {
                  handleToggleBatchItemSelection(item.key);
                  return;
                }
                handleToggleCardExpand(item.key);
              }}
            >
              <span className="skills-list-row-icon" aria-hidden>
                <Sparkles size={16} strokeWidth={1.8} />
              </span>
              <span className="skills-list-row-copy">
                <span className="skills-list-row-title-line">
                  <span className="skills-list-row-title">{title}</span>
                  {skill.scope === "project" && (
                    <span className="skills-scope-badge is-project">
                      {activeProjectName ?? t("skills.scopeProject")}
                    </span>
                  )}
                  {!parentGroup && owningGroup && (
                    <span className="skills-membership-label">{owningGroup.title}</span>
                  )}
                </span>
                <span className="skills-list-row-description">{description}</span>
                {item.tags.length > 0 && (
                  <span className="skills-list-row-tags">
                    {item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                    {item.tags.length > 2 && <span>+{item.tags.length - 2}</span>}
                  </span>
                )}
              </span>

              <span className="skills-list-row-tools">
                {item.toolSummary?.state === "none" && <span>{t("skills.noToolsEnabled")}</span>}
                {item.toolSummary?.state === "all" && <span>{t("skills.allEnabled")}</span>}
                {item.toolSummary?.state === "partial" && (
                  <>
                    <span className="skills-list-row-tool-icons">
                      {item.toolSummary.visibleEnabledToolIds.map((toolId) => (
                        <ToolIconChip
                          key={toolId}
                          toolId={toolId}
                          tools={tools}
                          size={14}
                          enabled
                          detected={toolsById.get(toolId)?.detected ?? false}
                        />
                      ))}
                    </span>
                    <span className="skills-list-row-tool-count">
                      {item.toolSummary.enabledCount}/{item.toolSummary.totalCount}
                    </span>
                  </>
                )}
              </span>

              <ChevronRight
                className={`skills-row-chevron${isExpanded ? " is-expanded" : ""}`}
                size={16}
                strokeWidth={2}
                aria-hidden
              />
            </button>

            {!isBatchManageMode && (
              <div className="skills-list-row-actions">
                {riskReport && riskReport.level !== "safe" && (
                  <button
                    type="button"
                    className={`skills-risk-button risk-${riskReport.level}`}
                    title={riskReport.findings[0]?.message ?? riskReport.level}
                    onClick={() => {
                      setToolEditorSkillId(skill.instance_id);
                      setSkillEditorTab("risk");
                    }}
                  >
                    {t(`settings.riskLevel${riskReport.level.charAt(0).toUpperCase() + riskReport.level.slice(1)}` as TranslationPath)}
                  </button>
                )}
                {fileProgressText && <span className="skills-file-progress" title={fileProgressText}>{fileProgress.current}/{fileProgress.total}</span>}
                <FavoriteIconButton
                  favorited={favorites.isSkillFavorite(skill.instance_id)}
                  onClick={(event) => void handleToggleFavorite(skill.instance_id, title, event)}
                  favoriteLabel={t("skills.favoriteAction")}
                  unfavoriteLabel={t("skills.unfavoriteAction")}
                  size={28}
                />
                {item.openPath && (
                  <button
                    type="button"
                    className="skills-row-icon-button"
                    title={t("skills.openEditor")}
                    aria-label={t("skills.openEditor")}
                    onClick={() => void handleOpenUnifiedItem(item)}
                  >
                    <ExternalLink size={14} strokeWidth={2} />
                  </button>
                )}
                <TranslateIconButton
                  hasTranslation={translated != null}
                  showingTranslation={isTranslatedView}
                  translating={translatingIds.has(skill.instance_id)}
                  translateLabel={t("skills.translateAction")}
                  showOriginalLabel={t("skills.showOriginal")}
                  showTranslationLabel={t("skills.showTranslated")}
                  translatingLabel={t("skills.translating")}
                  retranslateLabel={t("skills.retranslate")}
                  onClick={() => {
                    if (translated) {
                      translation.setView(translationKey, isTranslatedView ? "original" : "translated");
                    } else {
                      void handleTranslateSkill(skill);
                    }
                  }}
                  onRetranslate={() => void handleTranslateSkill(skill, true)}
                />
                <SkillCardActionMenu
                  deleting={deletingSkill === skill.instance_id}
                  editLabel={t("skills.configureTools")}
                  deleteLabel={t("skills.delete")}
                  moreActionsLabel={t("skills.moreActions")}
                  onEdit={() => openSkillEditor(skill.instance_id, "tools")}
                  onDelete={() => void handleDelete(skill)}
                />
              </div>
            )}
          </div>

          {isExpanded && !isBatchManageMode && (
            <div className="skills-list-row-details">
              <div>
                <span className="skills-detail-label">{t("skills.skillDescription")}</span>
                <p>{skill.description || t("skills.noDescription")}</p>
              </div>
              {item.openPath && (
                <div>
                  <span className="skills-detail-label">{t("skills.skillPath")}</span>
                  <code>{item.openPath}</code>
                </div>
              )}
              {toolIds.length > 0 && (
                <div>
                  <span className="skills-detail-label">{t("skills.configureToolsTitle")}</span>
                  <div className="skills-detail-tools">
                    {toolIds.map((toolId) => (
                      <ToolIconChip
                        key={toolId}
                        toolId={toolId}
                        tools={tools}
                        size={18}
                        enabled={skill.enabled[toolId] ?? false}
                        detected={toolsById.get(toolId)?.detected ?? false}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </article>
      </div>
    );
  };

  const renderGroupSection = (section: GroupedSkillSection) => {
    const groupItem = section.group;
    const skillPackage = groupItem.skillPackage;
    if (!skillPackage) {
      return null;
    }

    const isExpanded = forceExpandFilteredGroups || expandedSkillGroups.has(groupItem.id);
    const isSelected = selectedBatchItemKeys.has(groupItem.key);
    const selectedMemberCount = section.allMembers.filter((member) => selectedBatchItemKeys.has(member.key)).length;
    const isPartiallySelected = !isSelected && selectedMemberCount > 0;
    const enabledGroupTools = Object.values(groupItem.groupToolStateById ?? {})
      .filter((state) => state.anyEnabled)
      .sort((left, right) => Number(right.fullyEnabled) - Number(left.fullyEnabled));

    return (
      <section key={groupItem.key} className={`skills-group-section${isSelected ? " is-selected" : ""}`}>
        <div className="skills-group-header">
          {isBatchManageMode && (
            <SelectionIndicator
              checked={isSelected}
              indeterminate={isPartiallySelected}
              label={groupItem.title}
              onToggle={() => handleToggleBatchItemSelection(groupItem.key)}
            />
          )}

          <button
            type="button"
            className="skills-group-summary"
            aria-expanded={isExpanded}
            aria-label={t(isExpanded ? "skills.collapseGroup" : "skills.expandGroup")}
            onClick={() => {
              if (isBatchManageMode) {
                handleToggleBatchItemSelection(groupItem.key);
                return;
              }
              handleToggleSkillGroup(groupItem.id);
            }}
          >
            <ChevronRight
              className={`skills-group-chevron${isExpanded ? " is-expanded" : ""}`}
              size={17}
              strokeWidth={2.2}
              aria-hidden
            />
            <span className="skills-group-icon" aria-hidden><Layers3 size={17} strokeWidth={1.8} /></span>
            <span className="skills-group-copy">
              <span className="skills-group-title-line">
                <span className="skills-group-title">{groupItem.title}</span>
                <span className="skills-group-count">
                  {t("skills.groupMembersCount").replace("{count}", String(skillPackage.installed_members.length))}
                </span>
              </span>
              <span className="skills-group-subline">
                <span>{skillPackage.package_id}</span>
                {groupItem.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                {section.missingMemberIds.length > 0 && (
                  <span className="is-warning">
                    {t("skills.missingGroupMembers").replace("{count}", String(section.missingMemberIds.length))}
                  </span>
                )}
              </span>
            </span>
          </button>

          <div className="skills-group-tool-summary">
            {enabledGroupTools.length === 0 ? (
              <span className="skills-group-no-tools">{t("skills.noToolsEnabled")}</span>
            ) : (
              <>
                {enabledGroupTools.slice(0, 3).map((state) => (
                  <span
                    key={state.toolId}
                    className={`skills-group-tool-coverage${state.fullyEnabled ? " is-full" : " is-partial"}`}
                    title={`${getToolDisplayName(state.toolId, tools)} ${state.enabledMemberCount}/${state.memberCount}`}
                  >
                    <ToolIconChip
                      toolId={state.toolId}
                      tools={tools}
                      size={13}
                      enabled={state.anyEnabled}
                      detected={toolsById.get(state.toolId)?.detected ?? false}
                    />
                    <span>{state.enabledMemberCount}/{state.memberCount}</span>
                  </span>
                ))}
                {enabledGroupTools.length > 3 && <span className="skills-group-more-tools">+{enabledGroupTools.length - 3}</span>}
              </>
            )}
          </div>

          {!isBatchManageMode && (
            <SkillCardActionMenu
              deleting={deletingGroupId === groupItem.id}
              editLabel={t("skills.configureTools")}
              deleteLabel={t("skills.delete")}
              moreActionsLabel={t("skills.moreActions")}
              onEdit={() => openGroupEditor(groupItem.id)}
              onDelete={() => void handleDeleteGroup(groupItem)}
            />
          )}
        </div>

        {isExpanded && (
          <div className="skills-group-members">
            {section.members.map((member) => renderSkillListRow(member, groupItem))}
            {section.members.length === 0 && section.missingMemberIds.length > 0 && (
              <div className="skills-group-empty-members">
                {t("skills.missingGroupMembers").replace("{count}", String(section.missingMemberIds.length))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
      backgroundColor: "var(--background)",
    }}>
      <PageHeader
        title={t("skills.title")}
        actions={
          <>
            <RefreshButton onClick={handleRefresh} loading={refreshing} iconOnly />
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              title={t("skills.favoritesOnly")}
              aria-label={t("skills.favoritesOnly")}
              aria-pressed={favoritesOnly}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                padding: 0,
                color: favoritesOnly ? 'var(--primary)' : 'var(--muted-foreground)',
                backgroundColor: favoritesOnly ? 'var(--primary-tint)' : 'transparent',
                border: favoritesOnly ? '1px solid var(--primary-tint-border)' : '1px solid transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!favoritesOnly) {
                  e.currentTarget.style.color = 'var(--foreground)';
                  e.currentTarget.style.backgroundColor = 'var(--secondary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!favoritesOnly) {
                  e.currentTarget.style.color = 'var(--muted-foreground)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={favoritesOnly ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>

            {showTagFilterControl && (
              <div ref={tagFilterMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setShowTagFilterMenu((current) => !current)}
                  title={t("skills.tagFilterButton")}
                  aria-label={t("skills.tagFilterButton")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    padding: 0,
                    color: tagFilterActiveCount > 0 ? "var(--primary)" : "var(--muted-foreground)",
                    backgroundColor: tagFilterActiveCount > 0 ? "var(--primary-tint)" : "transparent",
                    border: tagFilterActiveCount > 0 ? "1px solid var(--primary-tint-border)" : "1px solid transparent",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "color 0.15s, background-color 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (tagFilterActiveCount === 0) {
                      e.currentTarget.style.color = "var(--foreground)";
                      e.currentTarget.style.backgroundColor = "var(--secondary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (tagFilterActiveCount === 0) {
                      e.currentTarget.style.color = "var(--muted-foreground)";
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M6 12h12M10 18h4" />
                  </svg>
                  {tagFilterActiveCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        minWidth: 16,
                        height: 16,
                        padding: "0 4px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--primary-foreground)",
                        backgroundColor: "var(--primary)",
                        borderRadius: 9999,
                        border: "1.5px solid var(--card)",
                        lineHeight: 1,
                      }}
                    >
                      {tagFilterActiveCount}
                    </span>
                  )}
                </button>

                {showTagFilterMenu && (
                  <div
                    className="glass-elevated animate-popover"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      width: "280px",
                      maxHeight: "420px",
                      overflow: "auto",
                      padding: "8px",
                      borderRadius: "var(--radius-lg)",
                      zIndex: MODAL_LAYER_Z_INDEX,
                      background: "var(--background)",
                    }}
                  >
                      <div style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "4px 6px 10px",
                        marginBottom: "6px",
                        borderBottom: "1px solid var(--border)",
                      }}>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--foreground)", letterSpacing: "-0.01em" }}>
                            {t("skills.tagFilterButton")}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "2px", lineHeight: 1.4 }}>
                            {t("skills.tagFilterHintCompact")}
                          </div>
                        </div>
                        {(selectedTags.length > 0 || untaggedOnly || riskOnly || scopeFilter !== "all") && (
                          <button
                            type="button"
                            onClick={handleResetTagFilters}
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "var(--primary)",
                              backgroundColor: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: "4px 6px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t("common.reset")}
                          </button>
                        )}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "10px" }}>
                        {([
                          { value: "all" as const, label: t("skills.scopeFilterAll"), count: unifiedItems.length },
                          { value: "global" as const, label: t("skills.scopeGlobal"), count: scopeFilterCounts.global },
                          { value: "project" as const, label: activeProjectName ?? t("skills.scopeProject"), count: scopeFilterCounts.project },
                        ]).map(({ value, label, count }) => {
                          const isActive = scopeFilter === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => { setScopeFilter(value); setShowTagFilterMenu(false); }}
                              onMouseEnter={(e) => {
                                if (!isActive) {
                                  e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = isActive ? "var(--primary-tint)" : "transparent";
                              }}
                              style={{
                                ...buildTagFilterMenuItemStyle(isActive),
                                paddingLeft: "28px",
                              }}
                            >
                              <TagFilterCheck active={isActive} />
                              <span style={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                              }}>
                                {label}
                              </span>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 500,
                                color: isActive ? "var(--primary)" : "var(--muted-foreground)",
                                flexShrink: 0,
                                fontVariantNumeric: "tabular-nums",
                              }}>
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <button
                          type="button"
                          onClick={handleResetTagFilters}
                          onMouseEnter={(e) => {
                            if (tagFilterSelection.kind !== "all") {
                              e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = tagFilterSelection.kind === "all" ? "var(--primary-tint)" : "transparent";
                          }}
                          style={buildTagFilterMenuItemStyle(tagFilterSelection.kind === "all")}
                        >
                          <TagFilterCheck active={tagFilterSelection.kind === "all"} />
                          <span>{t("skills.allTags")}</span>
                          <span style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            color: tagFilterSelection.kind === "all" ? "var(--primary)" : "var(--muted-foreground)",
                            flexShrink: 0,
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {skills.length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={handleToggleRiskOnly}
                          onMouseEnter={(e) => {
                            if (!riskOnly) {
                              e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = riskOnly ? "var(--primary-tint)" : "transparent";
                          }}
                          style={buildTagFilterMenuItemStyle(riskOnly)}
                        >
                          <TagFilterCheck active={riskOnly} />
                          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: riskMarkedCount > 0 ? "#f59e0b" : "var(--muted-foreground)",
                              flexShrink: 0,
                            }} />
                            {t("skills.riskMarked")}
                          </span>
                          <span style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            color: riskOnly ? "var(--primary)" : "var(--muted-foreground)",
                            flexShrink: 0,
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {riskMarkedCount}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={handleToggleUntaggedOnly}
                          onMouseEnter={(e) => {
                            if (!untaggedOnly) {
                              e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = untaggedOnly ? "var(--primary-tint)" : "transparent";
                          }}
                          style={buildTagFilterMenuItemStyle(untaggedOnly)}
                        >
                          <TagFilterCheck active={untaggedOnly} />
                          <span>{t("skills.untagged")}</span>
                          <span style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            color: untaggedOnly ? "var(--primary)" : "var(--muted-foreground)",
                            flexShrink: 0,
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {untaggedSkillsCount}
                          </span>
                        </button>

                        {allTagSummaries.map(({ tag, count }) => {
                          const active = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTagFilter(tag)}
                              onMouseEnter={(e) => {
                                if (!active) {
                                  e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = active ? "var(--primary-tint)" : "transparent";
                              }}
                              style={buildTagFilterMenuItemStyle(active)}
                            >
                              <TagFilterCheck active={active} />
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>#</span>
                                {tag}
                              </span>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 500,
                                color: active ? "var(--primary)" : "var(--muted-foreground)",
                                flexShrink: 0,
                                fontVariantNumeric: "tabular-nums",
                              }}>
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                  </div>
                )}
              </div>
            )}

            {headerActionLayout.primaryActionIds.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {headerActionLayout.primaryActionIds.map((actionId) =>
                  renderHeaderActionButton(actionId),
                )}
              </div>
            )}

            {headerActionLayout.moreActionIds.length > 0 && (
              <SkillsHeaderMoreMenu
                label={t("skills.more")}
                items={headerActionLayout.moreActionIds.map<SkillsHeaderMoreMenuItem | null>((actionId) => {
                  switch (actionId) {
                    case "batch-manage":
                      return {
                        id: actionId,
                        label: t("skills.batchManage"),
                        onClick: enterBatchManageMode,
                      };
                    case "project-bindings":
                      return {
                        id: actionId,
                        label: t("settings.projectBindings"),
                        onClick: handleOpenProjectBindingsDialog,
                      };
                    case "import-skills":
                      return {
                        id: actionId,
                        label: t("skills.importSkillsMenu"),
                        onClick: handleImportSkills,
                      };
                    case "export-skills":
                      return {
                        id: actionId,
                        label: t("skills.exportSkillsMenu"),
                        onClick: () => void handleExportSkills(),
                      };
                    default:
                      return null;
                  }
                }).filter((item): item is SkillsHeaderMoreMenuItem => item !== null)}
              />
            )}

            {headerActionLayout.secondaryActionIds.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {headerActionLayout.secondaryActionIds.map((actionId) =>
                  renderHeaderActionButton(actionId),
                )}
              </div>
            )}
          </>
        }
      />

      <main
        ref={listContainerRef}
        className="page-main"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
          <div className="skills-view-toolbar">
            <div className="skills-view-switch" role="group" aria-label={t("skills.title")}>
              <button
                type="button"
                className={skillListViewMode === "flat" ? "is-active" : undefined}
                aria-pressed={skillListViewMode === "flat"}
                disabled={isBatchManageMode}
                onClick={() => setSkillListViewMode("flat")}
              >
                <List size={15} strokeWidth={2} />
                <span>{t("skills.flatView")}</span>
              </button>
              <button
                type="button"
                className={skillListViewMode === "grouped" ? "is-active" : undefined}
                aria-pressed={skillListViewMode === "grouped"}
                disabled={isBatchManageMode}
                onClick={() => setSkillListViewMode("grouped")}
              >
                <Layers3 size={14} strokeWidth={2} />
                <span>{t("skills.groupedView")}</span>
              </button>
            </div>
            <div className="skills-view-summary" aria-live="polite">
              {skillListViewMode === "grouped"
                ? `${groupedSkillCollection.groups.length} ${t("skills.skillGroupsSection")} · ${groupedSkillCollection.standaloneSkills.length} ${t("skills.standaloneSkillsSection")}`
                : `${flatSkillItems.length} Skills`}
            </div>
          </div>

          {isBatchManageMode && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "12px 14px",
                marginBottom: "16px",
                borderRadius: "12px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--secondary)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>
                {t("skills.batchSelectedCount")
                  .replace("{count}", String(batchSelectionSummary.totalCount))
                  .replace("{skills}", String(batchSelectionSummary.skillCount))
                  .replace("{groups}", String(batchSelectionSummary.groupCount))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleSelectAllVisibleItems}
                  disabled={visibleBatchItemKeys.length === 0}
                  style={{
                    padding: "7px 10px",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "var(--foreground)",
                    backgroundColor: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    cursor: visibleBatchItemKeys.length === 0 ? "not-allowed" : "pointer",
                    opacity: visibleBatchItemKeys.length === 0 ? 0.6 : 1,
                  }}
                >
                  {t("skills.batchSelectAllFiltered")}
                </button>
                {batchSelectionSummary.totalCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearBatchSelection}
                    disabled={batchDeleting || batchTranslating}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--foreground)",
                      backgroundColor: "var(--background)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      cursor: batchDeleting || batchTranslating ? "not-allowed" : "pointer",
                      opacity: batchDeleting || batchTranslating ? 0.6 : 1,
                    }}
                  >
                    {t("skills.batchClearSelection")}
                  </button>
                )}
                {batchSelectionSummary.skillCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleBatchTranslateSelected()}
                    disabled={batchDeleting || batchTranslating}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--primary)",
                      backgroundColor: "var(--primary-tint)",
                      border: "1px solid var(--primary-tint-border)",
                      borderRadius: "8px",
                      cursor: batchDeleting || batchTranslating ? "not-allowed" : "pointer",
                      opacity: batchDeleting || batchTranslating ? 0.6 : 1,
                    }}
                  >
                    {batchTranslating ? t("skills.translating") : t("skills.batchTranslateSelected")}
                  </button>
                )}
                {batchSelectionSummary.totalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleBatchDeleteSelected()}
                    disabled={batchDeleting || batchTranslating}
                    style={{
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "var(--destructive)",
                      backgroundColor: "var(--color-error-bg)",
                      border: "1px solid var(--color-error-border)",
                      borderRadius: "8px",
                      cursor: batchDeleting || batchTranslating ? "not-allowed" : "pointer",
                      opacity: batchDeleting || batchTranslating ? 0.6 : 1,
                    }}
                  >
                    {batchDeleting ? t("common.loading") : t("skills.batchDeleteSelected")}
                  </button>
                )}
              </div>
            </div>
          )}
          {!hasVisibleSkillItems ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '64px 24px',
              textAlign: 'center',
              gap: 12,
            }}>
              <div style={{ fontSize: 32, color: 'var(--ember)', opacity: 0.5 }}>✦</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)' }}>
                {hasActiveSkillFilters ? t("skills.noMatch") : t("skills.noSkills")}
              </div>
            </div>
          ) : skillListViewMode === "grouped" ? (
            <div className="skills-grouped-list">
              {groupedSkillCollection.groups.length > 0 && (
                <section className="skills-list-section">
                  <div className="skills-list-section-heading">
                    <span>{t("skills.skillGroupsSection")}</span>
                    <span>{groupedSkillCollection.groups.length}</span>
                  </div>
                  <div className="skills-groups-stack">
                    {groupedSkillCollection.groups.map(renderGroupSection)}
                  </div>
                </section>
              )}

              {groupedSkillCollection.standaloneSkills.length > 0 && (
                <section className="skills-list-section">
                  <div className="skills-list-section-heading">
                    <span>{t("skills.standaloneSkillsSection")}</span>
                    <span>{groupedSkillCollection.standaloneSkills.length}</span>
                  </div>
                  <div className="skills-standalone-list">
                    {groupedSkillCollection.standaloneSkills.map((item) => renderSkillListRow(item))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="card-grid">
              {flatSkillItems.map((item) => {
                const color = getSkillColor(item.title);
                const canOpen = Boolean(item.openPath);
                const translationKey = item.kind === "skill" && item.skill
                  ? makeTranslationKey(item.skill.instance_id, language)
                  : null;
                const translated = translationKey ? translation.getTranslation(translationKey) : null;
                const isTranslatedView = translationKey
                  ? translation.getView(translationKey) === "translated" && translated != null
                  : false;
                const cardTitle = isTranslatedView && translated ? translated.name : item.title;
                const description = item.kind === "group"
                  ? item.skillPackage?.package_id ?? getUnifiedItemMetaLabel(item, t)
                  : isTranslatedView && translated
                    ? translated.description || t("skills.noDescription")
                    : item.description || t("skills.noDescription");
                const previewChips = item.previewChips.map((chip) => `#${chip}`);
                const fileProgress = item.kind === "skill" && item.skill
                  ? skillTranslationProgress[item.skill.instance_id]
                  : undefined;
                const fileProgressText = fileProgress
                  ? t("editor.translateFilesCompact")
                      .replace("{current}", String(fileProgress.current))
                      .replace("{total}", String(fileProgress.total))
                      .replace("{path}", fileProgress.path)
                  : null;
                const fileProgressPercent = fileProgress && fileProgress.total > 0
                  ? Math.max(0, Math.min(100, (fileProgress.current / fileProgress.total) * 100))
                  : 0;

                const isBatchSelected = selectedBatchItemKeys.has(item.key);
                const isCardExpanded = expandedCardKeys.has(item.key);
                const canToggleExpand = !isBatchManageMode;
                const isHighlighted = highlightKey === item.key;

                return (
                  <div
                    key={item.key}
                    ref={isHighlighted ? highlightTargetRef : undefined}
                    onClick={isBatchManageMode
                      ? () => handleToggleBatchItemSelection(item.key)
                      : canToggleExpand
                        ? () => handleToggleCardExpand(item.key)
                        : undefined}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      padding: "18px 20px",
                      backgroundColor: isBatchSelected ? "var(--primary-tint)" : "var(--secondary)",
                      borderRadius: "var(--radius)",
                      border: isHighlighted
                        ? "2px solid var(--primary)"
                        : isBatchSelected
                          ? "1px solid var(--primary-tint-border)"
                          : isCardExpanded
                            ? "1px solid var(--ring)"
                            : "1px solid var(--border)",
                      boxShadow: isHighlighted ? "0 0 0 4px var(--primary-tint)" : undefined,
                      transition: canToggleExpand ? "border-color 0.2s, box-shadow 0.2s" : undefined,
                      cursor: canToggleExpand ? "pointer" : isBatchManageMode ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => {
                      if (!canToggleExpand) {
                        return;
                      }
                      e.currentTarget.style.borderColor = isCardExpanded ? "var(--ring)" : "var(--ring)";
                      e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                    }}
                    onMouseLeave={(e) => {
                      if (!canToggleExpand) {
                        return;
                      }
                      e.currentTarget.style.borderColor = isBatchSelected
                        ? "var(--primary-tint-border)"
                        : isCardExpanded
                          ? "var(--ring)"
                          : "var(--border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div style={{ display: "flex", gap: "14px", marginBottom: "16px", alignItems: "flex-start" }}>
                      {isBatchManageMode && (
                        <div
                          style={{
                            width: "20px",
                            height: "20px",
                            marginTop: "12px",
                            borderRadius: "6px",
                            border: isBatchSelected ? "1px solid var(--primary)" : "1px solid var(--border)",
                            backgroundColor: isBatchSelected ? "var(--foreground)" : "var(--background)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {isBatchSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="3">
                              <path d="m5 12 5 5L20 7" />
                            </svg>
                          )}
                        </div>
                      )}
                      <div style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: color.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        boxShadow: "var(--shadow-sm)",
                      }}>
                        {item.kind === "group" ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color.icon} strokeWidth="2">
                            <rect x="3" y="4" width="7" height="7" rx="1.5" />
                            <rect x="14" y="4" width="7" height="7" rx="1.5" />
                            <rect x="3" y="14" width="7" height="7" rx="1.5" />
                            <rect x="14" y="14" width="7" height="7" rx="1.5" />
                          </svg>
                        ) : (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color.icon} strokeWidth="2">
                            <path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z" />
                          </svg>
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                          <div style={{
                            fontSize: "15px",
                            fontWeight: 600,
                            color: "var(--foreground)",
                            lineHeight: 1.3,
                            minWidth: 0,
                          }}>
                            {cardTitle}
                          </div>
                          {item.scopeLabel && (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              height: "18px",
                              padding: "0 6px",
                              fontSize: "10px",
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                              color: item.scopeLabel === "project"
                                ? "var(--primary-foreground)"
                                : "var(--muted-foreground)",
                              backgroundColor: item.scopeLabel === "project"
                                ? "var(--primary)"
                                : "var(--background)",
                              border: item.scopeLabel === "project"
                                ? "none"
                                : "1px solid var(--border)",
                              borderRadius: "4px",
                            }}>
                              {item.scopeLabel === "project"
                                ? (activeProjectName ?? t("skills.scopeProject"))
                                : t("skills.scopeGlobal")}
                            </span>
                          )}
                          {item.badgeLabel && (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              height: "22px",
                              padding: "0 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "var(--muted-foreground)",
                              backgroundColor: "var(--background)",
                              border: "1px solid var(--border)",
                              borderRadius: "999px",
                            }}>
                              {item.badgeLabel}
                            </span>
                          )}
                          {item.kind === "skill" && groupedSkillCollection.groupBySkillKey.get(item.key) && (
                            <span className="skills-membership-label">
                              {groupedSkillCollection.groupBySkillKey.get(item.key)?.title}
                            </span>
                          )}
                          {(() => {
                            const instanceId = item.skill?.instance_id;
                            if (!instanceId) return null;
                            const report = riskReports[instanceId];
                            if (!report || report.level === "safe") return null;
                            const levelColors: Record<string, { fg: string; bg: string }> = {
                              low: { fg: "#2563eb", bg: "rgba(37,99,235,0.12)" },
                              medium: { fg: "#ca8a04", bg: "rgba(202,138,4,0.12)" },
                              high: { fg: "#ea580c", bg: "rgba(234,88,12,0.12)" },
                              critical: { fg: "#dc2626", bg: "rgba(220,38,38,0.12)" },
                            };
                            const colors = levelColors[report.level] ?? levelColors.low;
                            return (
                              <span
                                title={report.findings.length > 0 ? report.findings[0].message : ""}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  height: "20px",
                                  padding: "0 7px",
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  color: colors.fg,
                                  backgroundColor: colors.bg,
                                  border: "none",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setToolEditorSkillId(instanceId);
                                  setSkillEditorTab("risk" as SkillEditorTab);
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: colors.fg }} />
                                {t(`settings.riskLevel${report.level.charAt(0).toUpperCase() + report.level.slice(1)}` as any)}
                              </span>
                            );
                          })()}
                        </div>
                        <p style={{
                          fontSize: "13px",
                          color: "var(--muted-foreground)",
                          margin: 0,
                          lineHeight: 1.5,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}>
                          {description}
                        </p>
                      </div>

                      {!isBatchManageMode && item.kind === "skill" && item.skill && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, minWidth: 0 }}>
                          <FavoriteIconButton
                            favorited={favorites.isSkillFavorite(item.skill.instance_id)}
                            onClick={(e) => void handleToggleFavorite(item.skill!.instance_id, cardTitle, e)}
                            favoriteLabel={t("skills.favoriteAction")}
                            unfavoriteLabel={t("skills.unfavoriteAction")}
                            size={28}
                          />
                          {fileProgressText && (
                            <div
                              role="status"
                              aria-live="polite"
                              title={fileProgressText}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                maxWidth: 190,
                                minWidth: 0,
                                height: 28,
                                padding: "0 8px",
                                fontSize: 11,
                                color: "var(--foreground)",
                                backgroundColor: "color-mix(in srgb, var(--primary) 7%, var(--background))",
                                border: "1px solid var(--border)",
                                borderRadius: 7,
                                flexShrink: 1,
                              }}
                            >
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {fileProgressText}
                              </span>
                              <div
                                aria-hidden
                                style={{
                                  width: 46,
                                  height: 3,
                                  borderRadius: 999,
                                  overflow: "hidden",
                                  backgroundColor: "color-mix(in srgb, var(--foreground) 14%, transparent)",
                                  flexShrink: 0,
                                }}
                              >
                                <div
                                  style={{
                                    width: `${fileProgressPercent}%`,
                                    height: "100%",
                                    backgroundColor: "var(--primary)",
                                    transition: "width 0.2s ease",
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {canOpen && (
                            <button
                              type="button"
                              title={t("skills.openEditor")}
                              aria-label={t("skills.openEditor")}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleOpenUnifiedItem(item);
                              }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "28px",
                                height: "28px",
                                padding: 0,
                                borderRadius: "8px",
                                border: "none",
                                backgroundColor: "transparent",
                                color: "var(--muted-foreground)",
                                cursor: "pointer",
                                flexShrink: 0,
                                transition: "color 0.15s ease, background-color 0.15s ease",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "var(--foreground)";
                                e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "var(--muted-foreground)";
                                e.currentTarget.style.backgroundColor = "transparent";
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M7 17 17 7" />
                                <path d="M7 7h10v10" />
                              </svg>
                            </button>
                          )}
                          <TranslateIconButton
                            hasTranslation={translated != null}
                            showingTranslation={isTranslatedView}
                            translating={translatingIds.has(item.skill.instance_id)}
                            translateLabel={t("skills.translateAction")}
                            showOriginalLabel={t("skills.showOriginal")}
                            showTranslationLabel={t("skills.showTranslated")}
                            translatingLabel={t("skills.translating")}
                            retranslateLabel={t("skills.retranslate")}
                            onClick={() => {
                              if (translated && translationKey) {
                                translation.setView(translationKey, isTranslatedView ? "original" : "translated");
                              } else {
                                void handleTranslateSkill(item.skill!);
                              }
                            }}
                            onRetranslate={() => void handleTranslateSkill(item.skill!, true)}
                          />
                          <SkillCardActionMenu
                            deleting={deletingSkill === item.skill.instance_id}
                            editLabel={t("skills.configureTools")}
                            deleteLabel={t("skills.delete")}
                            moreActionsLabel={t("skills.moreActions")}
                            onEdit={() => openSkillEditor(item.skill!.instance_id, "tools")}
                            onDelete={() => void handleDelete(item.skill!)}
                          />
                        </div>
                      )}
                      {!isBatchManageMode && item.kind === "group" && item.skillPackage && (
                        <SkillCardActionMenu
                          deleting={deletingGroupId === item.id}
                          editLabel={t("skills.configureTools")}
                          deleteLabel={t("skills.delete")}
                          moreActionsLabel={t("skills.moreActions")}
                          onEdit={() => openGroupEditor(item.id)}
                          onDelete={() => void handleDeleteGroup(item)}
                        />
                      )}
                    </div>

                    {renderPreviewChips(previewChips, item.previewOverflowCount) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px", minHeight: "24px" }}>
                        {renderPreviewChips(previewChips, item.previewOverflowCount)}
                      </div>
                    )}

                    <div style={{
                      paddingTop: "12px",
                      borderTop: "1px solid var(--border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}>
                      <div style={{
                        fontSize: "12px",
                        color: "var(--muted-foreground)",
                        lineHeight: 1.5,
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}>
                        <span>{getUnifiedItemMetaLabel(item, t)}</span>
                        {item.kind === "skill" && item.skill && (() => {
                          const stats = usageStats[item.skill.id];
                          if (!stats || stats.total === 0) return null;
                          return (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              padding: "1px 7px",
                              borderRadius: "6px",
                              backgroundColor: "var(--background)",
                              border: "1px solid var(--border)",
                              color: "var(--muted-foreground)",
                              fontSize: "11px",
                              fontWeight: 500,
                              whiteSpace: "nowrap",
                            }}>
                              {t("skills.callsCount").replace("{count}", String(stats.total))}
                            </span>
                          );
                        })()}
                      </div>
                      {item.kind === "skill" && item.toolSummary?.state === "partial" && item.toolSummary.visibleEnabledToolIds.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                          {item.toolSummary.visibleEnabledToolIds.map((toolId) => (
                            <ToolIconChip
                              key={toolId}
                              toolId={toolId}
                              tools={tools}
                              size={18}
                              enabled={true}
                              detected={true}
                            />
                          ))}
                          {item.toolSummary.remainingCount > 0 && (
                            <span style={{
                              fontSize: "12px",
                              fontWeight: 500,
                              color: "var(--muted-foreground)",
                              whiteSpace: "nowrap",
                            }}>
                              +{item.toolSummary.remainingCount}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {isCardExpanded && !isBatchManageMode && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          marginTop: "12px",
                          paddingTop: "12px",
                          borderTop: "1px dashed var(--border)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        {item.kind === "skill" && item.skill && (
                          <>
                            <div>
                              <div style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "var(--muted-foreground)",
                                marginBottom: "4px",
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                              }}>
                                {t("skills.skillDescription")}
                              </div>
                              <div style={{
                                fontSize: "13px",
                                color: "var(--foreground)",
                                lineHeight: 1.6,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}>
                                {item.skill.description || t("skills.noDescription")}
                              </div>
                            </div>
                            {item.openPath && (
                              <div>
                                <div style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: "var(--muted-foreground)",
                                  marginBottom: "4px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}>
                                  {t("skills.skillPath")}
                                </div>
                                <div style={{
                                  fontSize: "12px",
                                  color: "var(--muted-foreground)",
                                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  wordBreak: "break-all",
                                  lineHeight: 1.5,
                                }}>
                                  {item.openPath}
                                </div>
                              </div>
                            )}
                            {toolIds.length > 0 && (
                              <div>
                                <div style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: "var(--muted-foreground)",
                                  marginBottom: "6px",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}>
                                  {t("skills.configureToolsTitle")}
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                  {toolIds.map((toolId) => {
                                    const isEnabled = item.skill!.enabled[toolId] ?? false;
                                    const tool = tools.find((it) => it.id === toolId);
                                    const isDetected = tool?.detected ?? false;
                                    return (
                                      <ToolIconChip
                                        key={toolId}
                                        toolId={toolId}
                                        tools={tools}
                                        size={20}
                                        enabled={isEnabled}
                                        detected={isDetected}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {item.kind === "group" && item.skillPackage && (
                          <>
                            <div>
                              <div style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "var(--muted-foreground)",
                                marginBottom: "4px",
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                              }}>
                                {t("skills.skillDescription")}
                              </div>
                              <div style={{
                                fontSize: "13px",
                                color: "var(--foreground)",
                                lineHeight: 1.6,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}>
                                {item.description || t("skills.noDescription")}
                              </div>
                            </div>
                            <div>
                              <div style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "var(--muted-foreground)",
                                marginBottom: "4px",
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                              }}>
                                {t("skills.groupMembersCount").replace("{count}", "")}
                              </div>
                              <div style={{
                                fontSize: "12px",
                                color: "var(--muted-foreground)",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                wordBreak: "break-all",
                                lineHeight: 1.5,
                              }}>
                                {item.skillPackage.installed_members.join(", ")}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {toolEditorSkill && (
        <SkillManageDialog
          skillName={toolEditorSkill.name}
          skillDescription={toolEditorSkill.description || t("skills.noDescription")}
          activeTab={skillEditorTab}
          availableTabs={
            riskReports[toolEditorSkill.instance_id]
              ? (["tools", "tags", "risk"] as SkillEditorTab[])
              : (["tools", "tags"] as SkillEditorTab[])
          }
          onTabChange={setSkillEditorTab}
          onClose={closeSkillEditor}
          doneLabel={t("common.done")}
          toolsTitle={t("skills.configureToolsTitle")}
          toolsDescription={t("skills.configureToolsDesc")
            .replace("{skill}", toolEditorSkill.name)
            .replace("{enabled}", String(toolEditorEnabledCount))
            .replace("{total}", String(toolEditorOrderedToolIds.length))}
          query={toolEditorQuery}
          enabledOnly={toolEditorEnabledOnly}
          searchPlaceholder={t("skills.searchToolsPlaceholder")}
          enabledOnlyLabel={t("skills.enabledOnly")}
          bulkToggleLabel={toolEditorBulkToggleLabel}
          bulkToggleDisabled={toolEditorBulkToggleDisabled}
          bulkToggleTitle={toolEditorBulkToggleTargets.length === 0 ? t("skills.bulkNoTarget") : undefined}
          items={toolEditorItems}
          emptyLabel={t("skills.noToolsInFilter")}
          onQueryChange={setToolEditorQuery}
          onEnabledOnlyChange={setToolEditorEnabledOnly}
          onToggle={(toolId, enabled) => handleToggle(toolEditorSkill.instance_id, toolEditorSkill.name, toolId, enabled)}
          onBulkToggle={() => handleBulkToggle(toolEditorSkill, toolEditorFilteredToolIds)}
          tags={toolEditorTags}
          tagDraft={tagDraft}
          onTagDraftChange={setTagDraft}
          onAddTag={() => void handleAddTag(toolEditorSkill)}
          onRemoveTag={(tag) => void handleRemoveTag(toolEditorSkill, tag)}
          tagSuggestions={toolEditorTagSuggestions}
          onSelectTagSuggestion={(tag) => void persistSkillTags(toolEditorSkill, [...toolEditorTags, tag])}
          savingTags={savingTagsSkillId === getSkillMetadataKey(toolEditorSkill)}
          riskReport={riskReports[toolEditorSkill.instance_id] ?? null}
          t={t}
        />
      )}

      {groupEditorItem && groupEditorItem.skillPackage && (
        <SkillManageDialog
          skillName={groupEditorItem.title}
          skillDescription={groupEditorItem.skillPackage.package_id}
          activeTab={skillEditorTab}
          onTabChange={setSkillEditorTab}
          onClose={closeSkillEditor}
          doneLabel={t("common.done")}
          toolsTitle={t("skills.groupConfigureToolsTitle")}
          toolsDescription={t("skills.groupConfigureToolsDesc")
            .replace("{group}", groupEditorItem.title)
            .replace("{enabled}", String(groupEditorEnabledCount))
            .replace("{total}", String(groupEditorOrderedToolIds.length))}
          query={groupEditorQuery}
          enabledOnly={groupEditorEnabledOnly}
          searchPlaceholder={t("skills.searchToolsPlaceholder")}
          enabledOnlyLabel={t("skills.enabledOnly")}
          bulkToggleLabel={groupEditorBulkToggleLabel}
          bulkToggleDisabled={groupEditorBulkToggleDisabled}
          bulkToggleTitle={groupEditorBulkToggleTargets.length === 0 ? t("skills.bulkNoTarget") : undefined}
          items={groupEditorItems}
          emptyLabel={t("skills.noToolsInFilter")}
          onQueryChange={setGroupEditorQuery}
          onEnabledOnlyChange={setGroupEditorEnabledOnly}
          onToggle={(toolId, enabled) => void handleGroupToggle(groupEditorItem, toolId, enabled)}
          onBulkToggle={() => void handleGroupBulkToggle(groupEditorItem, groupEditorFilteredToolIds)}
          tags={groupEditorTags}
          tagDraft={tagDraft}
          onTagDraftChange={setTagDraft}
          onAddTag={() => {
            if (!groupEditorMetadataKey) {
              return;
            }
            const nextTag = normalizeSkillTags([tagDraft])[0];
            if (!nextTag) {
              return;
            }
            if (groupEditorTags.includes(nextTag)) {
              setTagDraft("");
              return;
            }
            void persistMetadataTags(groupEditorMetadataKey, [...groupEditorTags, nextTag]);
            setTagDraft("");
          }}
          onRemoveTag={(tag) => {
            if (!groupEditorMetadataKey) {
              return;
            }
            void persistMetadataTags(
              groupEditorMetadataKey,
              groupEditorTags.filter((item) => item !== tag),
            );
          }}
          tagSuggestions={groupEditorTagSuggestions}
          onSelectTagSuggestion={(tag) => {
            if (!groupEditorMetadataKey) {
              return;
            }
            void persistMetadataTags(groupEditorMetadataKey, [...groupEditorTags, tag]);
          }}
          savingTags={savingTagsSkillId === groupEditorMetadataKey}
          t={t}
        />
      )}

      <BatchManageToolsDialog
        open={isBatchToolDialogOpen}
        selectedSummary={batchSelectionSummary}
        tools={tools.filter((tool) => actionableToolIds.includes(tool.id))}
        toolStates={batchToolStates}
        query={batchToolQuery}
        submitting={batchSubmitting}
        onQueryChange={setBatchToolQuery}
        onToggleTool={(toolId, enabled) => void handleBatchToolToggle(toolId, enabled)}
        onSubmitEnableAll={() => void handleSubmitBatchToolAction(
          "enable",
          actionableToolIds,
          t("skills.batchConfirmEnableAllTools")
            .replace("{count}", String(batchSelectionSummary.totalCount))
            .replace("{affected}", String(batchSelectionSummary.affectedSkillCount)),
        )}
        onSubmitDisableAll={() => void handleSubmitBatchToolAction(
          "disable",
          actionableToolIds,
          t("skills.batchConfirmDisableAllTools")
            .replace("{count}", String(batchSelectionSummary.totalCount))
            .replace("{affected}", String(batchSelectionSummary.affectedSkillCount)),
        )}
        onClose={handleCloseBatchToolDialog}
        t={t}
      />

      <ImportConflictDialog
        open={importDialogOpen}
        preview={importPreview}
        isProcessing={importProcessing}
        onCancel={handleCloseImportDialog}
        onConfirm={(resolutions) => void handleConfirmImport(resolutions)}
        t={t}
      />

      {showCreateDialog && (
        <CreateSkillDialog
          creating={creating}
          existingIds={skills.filter((skill) => skill.scope === "global").map((skill) => skill.id)}
          tools={tools}
          onCancel={() => setShowCreateDialog(false)}
          onCreate={handleCreateSkill}
          t={t}
        />
      )}

      {showProjectBindingsDialog && config && (
        <ProjectBindingsDialog
          open={showProjectBindingsDialog}
          projects={config.projects ?? []}
          activeProjectId={resolveActiveProjectId(config.active_project_id, config.projects ?? [])}
          pendingProjectBinding={pendingProjectBinding}
          saving={projectBindingsSaving}
          onAddProject={() => void handleAddProjectBinding()}
          onPendingProjectNameChange={handlePendingProjectNameChange}
          onConfirmPendingProject={handleConfirmPendingProjectBinding}
          onCancelPendingProject={handleCancelPendingProjectBinding}
          onSetActiveProject={(projectId) => void handleSetActiveProjectBinding(projectId)}
          onRemoveProject={(projectId) => void handleRemoveProjectBinding(projectId)}
          onClose={handleCloseProjectBindingsDialog}
          t={t}
        />
      )}
    </div>
  );
}



function SkillManageDialog({
  skillName,
  skillDescription,
  activeTab,
  availableTabs = ["tools", "tags"],
  onTabChange,
  onClose,
  doneLabel,
  toolsTitle,
  toolsDescription,
  query,
  enabledOnly,
  searchPlaceholder,
  enabledOnlyLabel,
  bulkToggleLabel,
  bulkToggleDisabled,
  bulkToggleTitle,
  items,
  emptyLabel,
  onQueryChange,
  onEnabledOnlyChange,
  onToggle,
  onBulkToggle,
  tags,
  tagDraft,
  onTagDraftChange,
  onAddTag,
  onRemoveTag,
  tagSuggestions,
  onSelectTagSuggestion,
  savingTags,
  riskReport,
  t,
}: {
  skillName: string;
  skillDescription: string;
  activeTab: SkillEditorTab;
  availableTabs?: SkillEditorTab[];
  onTabChange: (tab: SkillEditorTab) => void;
  onClose: () => void;
  doneLabel: string;
  toolsTitle: string;
  toolsDescription: string;
  query: string;
  enabledOnly: boolean;
  searchPlaceholder: string;
  enabledOnlyLabel: string;
  bulkToggleLabel: string;
  bulkToggleDisabled: boolean;
  bulkToggleTitle?: string;
  items: Array<{
    id: string;
    label: string;
    enabled: boolean;
    disabled: boolean;
    tooltip?: string;
    dimmed?: boolean;
    callCount?: number;
  }>;
  emptyLabel: string;
  onQueryChange: (query: string) => void;
  onEnabledOnlyChange: (enabledOnly: boolean) => void;
  onToggle: (itemId: string, enabled: boolean) => void;
  onBulkToggle: () => void;
  tags: string[];
  tagDraft: string;
  onTagDraftChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  tagSuggestions: string[];
  onSelectTagSuggestion: (tag: string) => void;
  savingTags: boolean;
  riskReport?: SkillRiskReport | null;
  t: (key: TranslationPath) => string;
}) {
  const canAddTag = normalizeSkillTags([tagDraft]).length > 0;
  const enabledCount = items.filter((i) => i.enabled).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: MODAL_OVERLAY_COLOR,
        zIndex: MODAL_LAYER_Z_INDEX,
        padding: "24px",
      }}
      onClick={onClose}
    >
      <div
        className="animate-modal"
        style={{
          width: "min(640px, calc(100vw - 48px))",
          height: "min(560px, calc(100vh - 72px))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            padding: "16px 18px 12px",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--foreground)",
                letterSpacing: "-0.01em",
              }}
            >
              {skillName}
            </h3>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "12px",
                color: "var(--muted-foreground)",
                lineHeight: 1.45,
              }}
            >
              {skillDescription}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={doneLabel}
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              backgroundColor: "var(--secondary)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "background-color 0.15s, color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--muted)";
              e.currentTarget.style.color = "var(--foreground)";
              e.currentTarget.style.borderColor = "var(--ring)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
              e.currentTarget.style.color = "var(--muted-foreground)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ padding: "0 18px 12px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {availableTabs.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onTabChange(tab)}
                  style={{
                    padding: "5px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: active ? "var(--primary-foreground)" : "var(--foreground)",
                    backgroundColor: active ? "var(--foreground)" : "transparent",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                >
                  {tab === "tools" ? t("skills.manageToolsTab") : tab === "tags" ? t("skills.manageTagsTab") : t("settings.riskScanTitle")}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "16px 18px",
          }}
        >
          {activeTab === "tools" ? (
            <>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: "16px" }}>
                <strong style={{ display: "block", color: "var(--foreground)", marginBottom: "4px" }}>{toolsTitle}</strong>
                <div>{toolsDescription}</div>
              </div>

              {/* Search */}
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  height: "38px",
                  padding: "0 12px",
                  marginBottom: "12px",
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  transition: "border-color 0.15s",
                }}
                onFocusCapture={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onBlurCapture={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg
                  style={{
                    color: "var(--muted-foreground)",
                    flexShrink: 0,
                    marginRight: "8px",
                  }}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <CustomCaretInput
                  type="text"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder={searchPlaceholder}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "13px",
                    lineHeight: 1.4,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--foreground)",
                  }}
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    aria-label="clear"
                    onClick={() => onQueryChange("")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "18px",
                      height: "18px",
                      color: "var(--muted-foreground)",
                      background: "transparent",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      flexShrink: 0,
                      padding: 0,
                      marginLeft: "6px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--foreground)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted-foreground)")}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "0 0 12px",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    color: enabledOnly ? "var(--foreground)" : "var(--muted-foreground)",
                    userSelect: "none",
                    cursor: "pointer",
                    transition: "color 0.15s",
                  }}
                  onClick={() => onEnabledOnlyChange(!enabledOnly)}
                >
                  <Toggle
                    checked={enabledOnly}
                    onChange={(checked) => onEnabledOnlyChange(checked)}
                  />
                  {enabledOnlyLabel}
                </label>

                <button
                  type="button"
                  onClick={onBulkToggle}
                  disabled={bulkToggleDisabled}
                  title={bulkToggleTitle}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "var(--foreground)",
                    backgroundColor: "var(--secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: bulkToggleDisabled ? "not-allowed" : "pointer",
                    opacity: bulkToggleDisabled ? 0.5 : 1,
                    transition: "background-color 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (bulkToggleDisabled) return;
                    e.currentTarget.style.backgroundColor = "var(--muted)";
                    e.currentTarget.style.borderColor = "var(--ring)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--secondary)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
                  </svg>
                  {bulkToggleLabel}
                </button>
              </div>

              {/* List */}
              <div style={{ padding: "8px 0 0" }}>
                {items.length === 0 ? (
                  <div
                    style={{
                      padding: "40px 14px",
                      textAlign: "center",
                      fontSize: "12px",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {emptyLabel}
                  </div>
                ) : (
                  items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        minHeight: "40px",
                        padding: "8px 12px",
                        marginBottom: "4px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid transparent",
                        backgroundColor: item.enabled ? "var(--primary-tint)" : "transparent",
                        opacity: item.dimmed ? 0.6 : 1,
                        cursor: item.disabled ? "default" : "pointer",
                        transition: "background-color 0.12s ease, border-color 0.12s ease",
                      }}
                      title={item.tooltip}
                      onMouseEnter={(e) => {
                        if (item.disabled) return;
                        if (!item.enabled) {
                          e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (item.disabled) return;
                        e.currentTarget.style.backgroundColor = item.enabled
                          ? "var(--primary-tint)"
                          : "transparent";
                      }}
                      onClick={() => {
                        if (item.disabled) return;
                        onToggle(item.id, !item.enabled);
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            flexShrink: 0,
                            backgroundColor: item.enabled ? "var(--ember)" : "var(--border)",
                            transition: "background-color 0.15s",
                          }}
                        />
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "var(--foreground)",
                            lineHeight: 1.35,
                            minWidth: 0,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.label}
                        </div>
                        {item.callCount != null && item.callCount > 0 && (
                          <span style={{
                            fontSize: "11px",
                            fontWeight: 500,
                            padding: "1px 7px",
                            borderRadius: "6px",
                            backgroundColor: "var(--background)",
                            border: "1px solid var(--border)",
                            color: "var(--muted-foreground)",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}>
                            {t("skills.callsCount").replace("{count}", String(item.callCount))}
                          </span>
                        )}
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={item.enabled}
                          disabled={item.disabled}
                          onChange={(checked) => onToggle(item.id, checked)}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : activeTab === "tags" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                {t("skills.tagEditorHint")}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", minHeight: "30px" }}>
                {tags.length === 0 ? (
                  <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                    {t("skills.noTags")}
                  </span>
                ) : (
                  tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 500,
                        color: "var(--muted-foreground)",
                        backgroundColor: "var(--primary-tint)",
                        border: "1px solid var(--primary-tint-border)",
                        borderRadius: "var(--radius-md)",
                        padding: "3px 5px 3px 8px",
                      }}
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveTag(tag)}
                        disabled={savingTags}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "18px",
                          height: "18px",
                          padding: 0,
                          color: "var(--muted-foreground)",
                          backgroundColor: "transparent",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: savingTags ? "wait" : "pointer",
                        }}
                        title={t("skills.removeTag")}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={tagDraft}
                  placeholder={t("skills.tagInputPlaceholder")}
                  onChange={(e) => onTagDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && !savingTags) {
                      e.preventDefault();
                      onAddTag();
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "8px 10px",
                    fontSize: "12px",
                    color: "var(--foreground)",
                    backgroundColor: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={onAddTag}
                  disabled={savingTags || !canAddTag}
                  style={{
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--primary-foreground)",
                    backgroundColor: "var(--foreground)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: savingTags || !canAddTag ? "not-allowed" : "pointer",
                    opacity: savingTags || !canAddTag ? 0.5 : 1,
                  }}
                >
                  {t("skills.addTag")}
                </button>
              </div>

              {tagSuggestions.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted-foreground)" }}>
                    {t("skills.commonTags")}
                  </span>
                  {tagSuggestions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => onSelectTagSuggestion(tag)}
                      disabled={savingTags}
                      style={{
                        padding: "5px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--foreground)",
                        backgroundColor: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        cursor: savingTags ? "wait" : "pointer",
                      }}
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {(!riskReport || riskReport.findings.length === 0) ? (
                <div style={{ fontSize: "13px", color: "var(--muted-foreground)", padding: "24px 0", textAlign: "center" }}>
                  {t("settings.riskNoFindings")}
                  {riskReport?.llm_reviewed && (
                    <span style={{ display: "block", marginTop: 6, fontSize: 11, color: "var(--muted-foreground)" }}>
                      {t("settings.riskBadgeLlmReviewed")}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {(() => {
                      const levelColors: Record<string, { fg: string; bg: string }> = {
                        low: { fg: "#2563eb", bg: "rgba(37,99,235,0.12)" },
                        medium: { fg: "#ca8a04", bg: "rgba(202,138,4,0.12)" },
                        high: { fg: "#ea580c", bg: "rgba(234,88,12,0.12)" },
                        critical: { fg: "#dc2626", bg: "rgba(220,38,38,0.12)" },
                      };
                      const colors = levelColors[riskReport.level] ?? levelColors.low;
                      return (
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          height: "22px",
                          padding: "0 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: colors.fg,
                          backgroundColor: colors.bg,
                          borderRadius: "4px",
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: colors.fg }} />
                          {t(`settings.riskLevel${riskReport.level.charAt(0).toUpperCase() + riskReport.level.slice(1)}` as any)}
                        </span>
                      );
                    })()}
                    {riskReport.llm_reviewed && (
                      <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
                        {t("settings.riskBadgeLlmReviewed")}
                      </span>
                    )}
                  </div>
                  {riskReport.findings.map((finding, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 12px",
                        backgroundColor: "var(--secondary)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{finding.message}</span>
                        <span style={{
                          fontSize: "10px",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          backgroundColor: "var(--muted)",
                          color: "var(--muted-foreground)",
                        }}>
                          {t(`settings.riskCategory${finding.category.charAt(0).toUpperCase() + finding.category.slice(1)}` as any)}
                        </span>
                        <span style={{
                          fontSize: "10px",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          backgroundColor: finding.source === "llm" ? "var(--primary)" : "var(--muted)",
                          color: finding.source === "llm" ? "var(--primary-foreground)" : "var(--muted-foreground)",
                        }}>
                          {finding.source === "llm" ? t("settings.riskSourceLlm") : t("settings.riskSourceRule")}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted-foreground)", backgroundColor: "var(--background)", padding: "6px 8px", borderRadius: "4px", border: "1px solid var(--border)", overflow: "auto" }}>
                        {finding.evidence}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--muted-foreground)", marginTop: "4px" }}>
                        {t("settings.riskLocationLabel")}: {finding.location.file}:{finding.location.line}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "10px 18px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            {activeTab === "tools" ? `${enabledCount}/${items.length}` : activeTab === "tags" ? `${tags.length}` : `${riskReport?.findings.length ?? 0}`}
          </div>
          <button
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "7px 16px",
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateSkillDialog({
  creating,
  existingIds,
  tools,
  onCancel,
  onCreate,
  t,
}: {
  creating: boolean;
  existingIds: string[];
  tools: Tool[];
  onCancel: () => void;
  onCreate: (name: string, description: string, targetToolIds: string[], tags: string[]) => void;
  t: (key: TranslationPath) => string;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [tagsInput, setTagsInput] = useState("");

  const actionableTools = useMemo(
    () => tools.filter((tool) => tool.detected && tool.config.enabled),
    [tools],
  );

  const toId = (n: string): string =>
    n.trim().toLowerCase().replace(/ /g, "-").replace(/[^a-z0-9_-]/g, "");

  const parseTags = (input: string): string[] => {
    return input
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("skills.nameRequired"));
      return;
    }
    const id = toId(trimmed);
    if (existingIds.includes(id)) {
      setError(t("skills.nameConflict").replace("{name}", trimmed));
      return;
    }
    onCreate(trimmed, description.trim(), [...selectedToolIds], parseTags(tagsInput));
  };

  const toggleTool = (toolId: string) => {
    setSelectedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: MODAL_OVERLAY_COLOR,
        zIndex: MODAL_LAYER_Z_INDEX,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          width: CREATE_SKILL_MODAL_WIDTH,
          backgroundColor: "var(--background)",
          borderRadius: "14px",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-xl)",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--foreground)", margin: "0 0 4px 0" }}>
          {t("skills.createSkill")}
        </h2>
        <p style={{ fontSize: "13px", color: "var(--muted-foreground)", margin: "0 0 20px 0" }}>
          {t("skills.createSkillDesc")}
        </p>

        <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--foreground)", marginBottom: "6px" }}>
          {t("skills.skillName")}
        </label>
        <input
          autoFocus
          type="text"
          placeholder={t("skills.skillNamePlaceholder")}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !creating) handleSubmit(); }}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "13px",
            border: error ? "1px solid var(--color-error)" : "1px solid var(--border)",
            borderRadius: "8px",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            outline: "none",
            boxSizing: "border-box",
            marginBottom: error ? "4px" : "16px",
          }}
        />
        {error && (
          <p style={{ fontSize: "12px", color: "var(--color-error)", margin: "0 0 12px 0" }}>{error}</p>
        )}

        <label style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--foreground)", marginBottom: "6px" }}>
          {t("skills.skillDescription")}
        </label>
        <textarea
          placeholder={t("skills.skillDescPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !creating) handleSubmit(); }}
          rows={3}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "13px",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            outline: "none",
            boxSizing: "border-box",
            marginBottom: "20px",
            resize: "vertical",
            maxHeight: "120px",
            fontFamily: "inherit",
            lineHeight: 1.5,
          }}
        />

        {actionableTools.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
              <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>
                {t("skills.createTargetTools")}
              </label>
              <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
                {t("skills.createTargetToolsHint")}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {actionableTools.map((tool) => {
                const isSelected = selectedToolIds.has(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    disabled={creating}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: isSelected ? "var(--primary-foreground)" : "var(--foreground)",
                      backgroundColor: isSelected ? "var(--primary)" : "var(--background)",
                      border: isSelected ? "1px solid var(--primary)" : "1px solid var(--border)",
                      borderRadius: "8px",
                      cursor: creating ? "not-allowed" : "pointer",
                      transition: "background-color 0.15s, color 0.15s, border-color 0.15s",
                    }}
                  >
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    {tool.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--foreground)" }}>
              {t("skills.createTags")}
            </label>
            <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>
              {t("skills.createTagsHint")}
            </span>
          </div>
          <input
            type="text"
            placeholder={t("skills.createTagsPlaceholder")}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            disabled={creating}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "13px",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={onCancel}
            disabled={creating}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--foreground)",
              backgroundColor: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={creating}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              backgroundColor: "var(--foreground)",
              border: "none",
              borderRadius: "8px",
              cursor: creating ? "wait" : "pointer",
              opacity: creating ? 0.7 : 1,
            }}
          >
            {creating ? t("skills.creating") : t("skills.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

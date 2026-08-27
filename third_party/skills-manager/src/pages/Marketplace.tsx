import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type UIEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, Check, ExternalLink, Link2 } from "lucide-react";
import { RefreshButton } from "@/components/ui/refresh-button";
import { PageHeader } from "@/components/ui/page-header";
import { usePageSearch } from "@/components/PageHeaderContext";
import { PageLoader } from "@/components/ui/loading";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { InstallCountBadge } from "@/components/marketplace/InstallCountBadge";
import {
  InstallResult,
  MarketplaceFavoriteMap,
  MarketplaceFavoriteMeta,
  MarketplaceSkill,
  MarketplaceSkillsResponse,
  MarketplaceSyncResult,
  Skill,
} from "@/types";
import { useTranslation } from "@/i18n";
import { useSkillTranslation, makeTranslationKey } from "@/hooks/useSkillTranslation";
import { useFavorites } from "@/hooks/useFavorites";
import { useClickOutside } from "@/hooks/useClickOutside";
import { FavoriteIconButton } from "@/components/favorites/FavoriteIconButton";
import { TranslateIconButton } from "@/components/translation/TranslateIconButton";
import { SkillDetailModal } from "@/components/marketplace/SkillDetailModal";
import { highlightMatch } from "@/components/marketplace/highlightMatch";
import { formatInstallCountLabel } from "@/pages/marketplace/formatInstallCount";
import { buildMarketplaceMetaItems } from "@/pages/marketplace/buildMarketplaceMetaItems";
import { sortMarketplaceSkillsByInstallStatus } from "@/pages/marketplace/sortMarketplaceSkillsByInstallStatus";
import { getMarketplaceMetaChipStyle } from "@/components/marketplace/marketplaceMetaChipStyle";
import { MODAL_LAYER_Z_INDEX, MODAL_OVERLAY_COLOR } from "@/constants/modal";

const DESCRIPTION_BATCH_SIZE = 12;
const DIRECT_GITHUB_INSTALL_ID = "__github_direct_install__";
const marketplaceDescriptionCache = new Map<string, string | null>();
const MARKETPLACE_SORT_STORAGE_KEY = "marketplace.sortMode";
const MARKETPLACE_SORT_MODES = ["default", "newest", "popular", "name"] as const;
type MarketplaceSortMode = typeof MARKETPLACE_SORT_MODES[number];

/**
 * 前端本地查询匹配（与后端 filter_marketplace_skills_by_query 逻辑一致）：
 * - 按空白分词，每个 token 必须命中至少一个字段（AND between tokens, OR between fields）
 * - 大小写不敏感的子串包含
 * - 匹配字段：name / slug / description / author / source_name / tags
 * 用于收藏模式下对本地快照的搜索过滤（不触发远程请求）。
 */
function skillMatchesLocalQuery(skill: MarketplaceSkill, query: string): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => {
    const t = token.toLowerCase();
    if (!t) return true;
    return (
      skill.name.toLowerCase().includes(t)
      || (skill.slug?.toLowerCase().includes(t) ?? false)
      || (skill.description?.toLowerCase().includes(t) ?? false)
      || (skill.author?.toLowerCase().includes(t) ?? false)
      || skill.source_name.toLowerCase().includes(t)
      || skill.tags.some((tag) => tag.toLowerCase().includes(t))
    );
  });
}

// 模块级内存缓存：保存上次成功加载的市场列表首屏数据，
// 让再次进入市场页时能立即渲染，避免每次都显示全屏 loader。
// 同时持久化到 localStorage，应用重启后也能快速恢复。
interface MarketplaceSnapshot {
  skills: MarketplaceSkill[];
  hasMore: boolean;
  fetchedAt: number;
}
const MARKETPLACE_SNAPSHOT_STORAGE_KEY = "marketplace.snapshot";
const MARKETPLACE_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

function loadSnapshotFromStorage(): MarketplaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(MARKETPLACE_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketplaceSnapshot;
    if (!parsed || !Array.isArray(parsed.skills)) return null;
    if (Date.now() - parsed.fetchedAt > MARKETPLACE_SNAPSHOT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistSnapshotToStorage(snapshot: MarketplaceSnapshot): void {
  try {
    window.localStorage.setItem(MARKETPLACE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore quota / serialization errors
  }
}

let marketplaceSnapshot: MarketplaceSnapshot | null = loadSnapshotFromStorage();

function loadSortModeFromStorage(): MarketplaceSortMode {
  try {
    const stored = window.localStorage.getItem(MARKETPLACE_SORT_STORAGE_KEY);
    if (stored && (MARKETPLACE_SORT_MODES as readonly string[]).includes(stored)) {
      return stored as MarketplaceSortMode;
    }
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "default";
}

function persistSortMode(mode: MarketplaceSortMode) {
  try {
    window.localStorage.setItem(MARKETPLACE_SORT_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

interface MarketplaceDescriptionRequest {
  id: string;
  repo_url: string;
  skill_path: string;
}

// Generate consistent colors based on skill name
function getSkillColor(name: string): { bg: string; icon: string } {
  const colors = [
    { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', icon: '#fff' },
    { bg: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)', icon: '#fff' },
  ];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  return colors[index];
}

function primeDescriptionCache(skills: MarketplaceSkill[]) {
  skills.forEach((skill) => {
    const description = skill.description?.trim();
    if (description) {
      marketplaceDescriptionCache.set(skill.id, description);
    }
  });
}

function withCachedDescription(skill: MarketplaceSkill): MarketplaceSkill {
  const cached = marketplaceDescriptionCache.get(skill.id);
  if (!cached || cached === skill.description) {
    return skill;
  }
  return { ...skill, description: cached };
}

function skeletonBarStyle(widthFraction: number): CSSProperties {
  return {
    width: `${Math.round(widthFraction * 100)}%`,
    height: '8px',
    borderRadius: '4px',
  };
}

/** 将市场收藏快照转换为 MarketplaceSkill，用于断网时展示。
 *  install_status 无法从快照得知，默认 not_installed；调用方可用当前 skills 列表覆盖。 */
function snapshotToMarketplaceSkill(id: string, meta: MarketplaceFavoriteMeta): MarketplaceSkill {
  return {
    id,
    slug: null,
    name: meta.name,
    description: meta.description ?? null,
    author: null,
    source_id: meta.source_id,
    source_name: meta.source_name,
    install_count: meta.install_count ?? null,
    install_url: null,
    created_at: null,
    repo_url: meta.repo_url ?? null,
    skill_path: meta.skill_path ?? null,
    external_url: meta.external_url ?? null,
    remote_revision: null,
    tags: meta.tags,
    install_status: "not_installed",
    clawhub_slug: meta.clawhub_slug ?? null,
    clawhub_owner: meta.clawhub_owner ?? null,
    clawhub_version: meta.clawhub_version ?? null,
  };
}

export function Marketplace() {
  const { t, language } = useTranslation();
  const translation = useSkillTranslation();
  const navigate = useNavigate();
  const favorites = useFavorites(undefined);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteSnapshot, setFavoriteSnapshot] = useState<MarketplaceFavoriteMap>({});
  const [translatingMarketIds, setTranslatingMarketIds] = useState<Set<string>>(new Set());
  const { toasts, addToast, removeToast } = useToast();
  const [skills, setSkills] = useState<MarketplaceSkill[]>(
    () => marketplaceSnapshot?.skills ?? [],
  );
  const [hasMore, setHasMore] = useState(() => marketplaceSnapshot?.hasMore ?? false);
  const [currentPage, setCurrentPage] = useState(1);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(tagDropdownRef, tagDropdownOpen, () => setTagDropdownOpen(false));
  const [githubInstallDialogOpen, setGithubInstallDialogOpen] = useState(false);
  // Page-level search query is shared with the TopBar scope field via context,
  // so the Marketplace page no longer renders its own search input.
  const { query: searchQuery, setQuery: setSearchQuery } = usePageSearch(t("marketplace.searchPlaceholder"));
  const [githubInstallUrl, setGithubInstallUrl] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(null);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [uninstallConfirmSkill, setUninstallConfirmSkill] = useState<MarketplaceSkill | null>(null);
  const [uninstallingSkillId, setUninstallingSkillId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [initialLoading, setInitialLoading] = useState(() => marketplaceSnapshot === null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [descriptionHydrationTick, setDescriptionHydrationTick] = useState(0);
  const [sortMode, setSortMode] = useState<MarketplaceSortMode>(() => loadSortModeFromStorage());
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(sortDropdownRef, sortDropdownOpen, () => setSortDropdownOpen(false));
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const listRequestSeqRef = useRef(0);
  const remoteLoadSeqRef = useRef(0);
  const descriptionInFlightRef = useRef<Set<string>>(new Set());
  const descriptionFetchedRef = useRef<Set<string>>(new Set());
  const descriptionRequestSeqRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const normalizedRemoteQuery = useMemo(
    () => deferredSearchQuery.trim(),
    [deferredSearchQuery],
  );

  const showMarketplaceError = useCallback((err: unknown, fallbackMessage: string) => {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const rateLimited =
      /(^|[^0-9])429([^0-9]|$)/.test(rawMessage)
      || /too many requests/i.test(rawMessage)
      || /rate limit/i.test(rawMessage)
      || /请求过于频繁/.test(rawMessage);
    addToast(rateLimited ? t("marketplace.rateLimited") : fallbackMessage, "error");
    console.error("[marketplace] request failed", err);
  }, [addToast, t]);

  const loadSkills = useCallback(async (options?: {
    forceRefresh?: boolean;
    query?: string;
    page?: number;
    append?: boolean;
    sourceIds?: string[];
  }) => {
    const forceRefresh = options?.forceRefresh ?? false;
    const query = options?.query;
    const page = options?.page ?? 1;
    const append = options?.append ?? false;
    const sourceIds = options?.sourceIds;
    const normalizedQuery = query && query.trim().length > 0 ? query.trim() : undefined;
    const requestSeq = listRequestSeqRef.current + 1;
    listRequestSeqRef.current = requestSeq;
    const isStaleRequest = () => requestSeq !== listRequestSeqRef.current;

    try {
      const result = await invoke<MarketplaceSkillsResponse>("fetch_marketplace_skills", {
        forceRefresh,
        query: normalizedQuery,
        page,
        sourceIds: sourceIds && sourceIds.length > 0 ? sourceIds : undefined,
      });
      if (isStaleRequest()) {
        return;
      }
      primeDescriptionCache(result.skills);
      const incoming = result.skills.map(withCachedDescription);

      setSkills((prev) => {
        if (!append || page === 1) {
          return sortMarketplaceSkillsByInstallStatus(incoming);
        }
        const merged = [...prev];
        const existingIds = new Set(prev.map((skill) => skill.id));
        for (const skill of incoming) {
          if (!existingIds.has(skill.id)) {
            merged.push(skill);
          }
        }
        return sortMarketplaceSkillsByInstallStatus(merged);
      });
      setHasMore(result.has_more);
      setCurrentPage(page);
      // 首屏默认视图（无搜索词、无 source 过滤）成功加载时更新内存快照，
      // 下次进入市场页可立即渲染这份缓存，跳过全屏 loader。
      if (page === 1 && !append && !normalizedQuery && (!sourceIds || sourceIds.length === 0)) {
        marketplaceSnapshot = {
          skills: sortMarketplaceSkillsByInstallStatus(incoming),
          hasMore: result.has_more,
          fetchedAt: Date.now(),
        };
        persistSnapshotToStorage(marketplaceSnapshot);
      }
    } catch (err) {
      if (isStaleRequest()) {
        return;
      }
      showMarketplaceError(err, t("marketplace.networkError"));
    } finally {
      if (page === 1 && !isStaleRequest()) {
        setInitialLoading(false);
      }
    }
  }, [showMarketplaceError, t]);

  useEffect(() => {
    // 仅看收藏时跳过远程加载，使用本地快照
    if (favoritesOnly) {
      setSearching(false);
      return;
    }
    const loadSeq = remoteLoadSeqRef.current + 1;
    remoteLoadSeqRef.current = loadSeq;
    setSearching(true);
    void loadSkills({
      page: 1,
      query: normalizedRemoteQuery,
      sourceIds: undefined,
    }).finally(() => {
      if (remoteLoadSeqRef.current === loadSeq) {
        setSearching(false);
      }
    });
  }, [loadSkills, normalizedRemoteQuery, favoritesOnly]);

  // 切换到"仅看收藏"时加载本地快照
  useEffect(() => {
    if (!favoritesOnly) return;
    let cancelled = false;
    void favorites.loadMarketplaceFavorites().then((map) => {
      if (cancelled) return;
      setFavoriteSnapshot(map ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [favoritesOnly, favorites]);

  useEffect(() => {
    if (skills.length === 0) return;
    const inputs = skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
    void translation.preloadCachedMarketplace(inputs, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, language, translation.preloadCachedMarketplace]);

  useEffect(() => {
    const candidates = skills
      .filter((skill) => {
        if (skill.description) {
          return false;
        }
        if (!skill.repo_url || !skill.skill_path) {
          return false;
        }
        if (descriptionFetchedRef.current.has(skill.id) || descriptionInFlightRef.current.has(skill.id)) {
          return false;
        }
        return true;
      })
      .slice(0, DESCRIPTION_BATCH_SIZE);

    if (candidates.length === 0) {
      return;
    }

    const requestId = descriptionRequestSeqRef.current + 1;
    descriptionRequestSeqRef.current = requestId;
    candidates.forEach((skill) => descriptionInFlightRef.current.add(skill.id));
    let cancelled = false;
    let continueHydration = false;

    async function hydrateDescriptions() {
      try {
        const payload: MarketplaceDescriptionRequest[] = candidates
          .filter((skill) => Boolean(skill.repo_url && skill.skill_path))
          .map((skill) => ({
            id: skill.id,
            repo_url: skill.repo_url as string,
            skill_path: skill.skill_path as string,
          }));

        if (payload.length === 0) {
          continueHydration = true;
          return;
        }

        const descriptions = await invoke<Record<string, string | null>>(
          "fetch_marketplace_skill_descriptions",
          { skills: payload },
        );

        if (cancelled || requestId !== descriptionRequestSeqRef.current) {
          return;
        }

        Object.entries(descriptions).forEach(([skillId, description]) => {
          const normalized = description?.trim() || null;
          marketplaceDescriptionCache.set(skillId, normalized);
        });

        setSkills((prev) => {
          let changed = false;
          const next = prev.map((skill) => {
            const cached = marketplaceDescriptionCache.get(skill.id);
            if (!cached || cached === skill.description) {
              return skill;
            }
            changed = true;
            return { ...skill, description: cached };
          });
          return changed ? next : prev;
        });

        setSelectedSkill((current) => {
          if (!current) {
            return current;
          }
          const cached = marketplaceDescriptionCache.get(current.id);
          if (!cached || cached === current.description) {
            return current;
          }
          return { ...current, description: cached };
        });

        continueHydration = true;
      } catch (_err) {
        // ignore hydration errors and keep list responsive;
        // mark as fetched so skeleton placeholder can be replaced with empty state
        continueHydration = true;
      } finally {
        candidates.forEach((skill) => {
          descriptionInFlightRef.current.delete(skill.id);
          if (continueHydration) {
            descriptionFetchedRef.current.add(skill.id);
          }
        });
        if (!cancelled && continueHydration) {
          setDescriptionHydrationTick((value) => value + 1);
        }
      }
    }

    void hydrateDescriptions();

    return () => {
      cancelled = true;
    };
  }, [skills, descriptionHydrationTick]);

  const handleRefresh = useCallback(async () => {
    descriptionFetchedRef.current.clear();
    descriptionInFlightRef.current.clear();
    setRefreshing(true);
    try {
      await loadSkills({
        forceRefresh: true,
        page: 1,
        query: normalizedRemoteQuery,
        sourceIds: undefined,
      });
      addToast(t("common.refreshSuccess"), "success");
    } catch (err) {
      showMarketplaceError(err, t("marketplace.networkError"));
    } finally {
      setRefreshing(false);
    }
  }, [addToast, loadSkills, normalizedRemoteQuery, showMarketplaceError, t]);

  const updateAvailableCount = useMemo(
    () => skills.filter((skill) => skill.install_status === "update_available").length,
    [skills],
  );
  const installingGithubUrl = installingSkill === DIRECT_GITHUB_INSTALL_ID;

  const handleUpdateAll = useCallback(async () => {
    if (updatingAll || updateAvailableCount === 0 || installingSkill) {
      return;
    }

    setUpdatingAll(true);
    try {
      const syncResult = await invoke<MarketplaceSyncResult>(
        "sync_marketplace_installed_skills",
        {
          sourceIds: undefined,
        },
      );
      if (syncResult.updated > 0) {
        addToast(
          t("marketplace.syncUpdated").replace("{count}", String(syncResult.updated)),
          "success",
        );
      }
      if (syncResult.failed.length > 0) {
        addToast(
          t("marketplace.syncPartialFailed").replace(
            "{count}",
            String(syncResult.failed.length),
          ),
          "error",
        );
      }

      await loadSkills({
        forceRefresh: true,
        page: 1,
        query: normalizedRemoteQuery,
        sourceIds: undefined,
      });
    } catch (err) {
      showMarketplaceError(err, t("marketplace.networkError"));
    } finally {
      setUpdatingAll(false);
    }
  }, [
    installingSkill,
    loadSkills,
    normalizedRemoteQuery,
    showMarketplaceError,
    t,
    updateAvailableCount,
    updatingAll,
  ]);

  const handleLoadMore = useCallback(async () => {
    // 标签筛选为纯前端过滤，加载更多无意义且会与新页数据错配
    if (favoritesOnly || selectedTags.length > 0 || loadingMore || refreshing || initialLoading || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      await loadSkills({
        page: currentPage + 1,
        append: true,
        query: normalizedRemoteQuery,
        sourceIds: undefined,
      });
    } finally {
      setLoadingMore(false);
    }
  }, [
    currentPage,
    favoritesOnly,
    hasMore,
    initialLoading,
    loadSkills,
    loadingMore,
    normalizedRemoteQuery,
    refreshing,
  ]);

  const handleInstall = useCallback(async (skill: MarketplaceSkill, event?: MouseEvent) => {
    event?.stopPropagation();
    if (skill.install_status === "installed") return;

    const isUpdateAction = skill.install_status === "update_available";
    setInstallingSkill(skill.id);
    try {
      const result = await invoke<InstallResult>("install_marketplace_skill", { skillId: skill.id });
      if (result.success) {
        setSelectedSkill((current) => (
          current && current.id === skill.id
            ? { ...current, install_status: "installed" }
            : current
        ));
        await loadSkills({
          forceRefresh: true,
          page: 1,
          query: normalizedRemoteQuery,
          sourceIds: undefined,
        });
        const successMessage = t(isUpdateAction ? "marketplace.updateSuccess" : "marketplace.installSuccess").replace(
          "{name}",
          skill.name,
        );
        if (isUpdateAction) {
          addToast(successMessage, "success");
        } else {
          addToast(successMessage, "success", false, {
            label: t("marketplace.viewAction"),
            onClick: () => navigate(`/?highlight=${encodeURIComponent(skill.id)}`),
          });
        }
      } else {
        addToast(
          t(isUpdateAction ? "marketplace.updateFailed" : "marketplace.installFailed"),
          "error",
        );
      }
    } catch (err) {
      showMarketplaceError(
        err,
        t(isUpdateAction ? "marketplace.updateFailed" : "marketplace.installFailed"),
      );
    } finally {
      setInstallingSkill(null);
    }
  }, [addToast, loadSkills, navigate, normalizedRemoteQuery, showMarketplaceError, t]);

  const handleUninstallConfirm = useCallback(async (skill: MarketplaceSkill) => {
    if (uninstallingSkillId) return;
    setUninstallingSkillId(skill.id);
    try {
      const localSkills = await invoke<Skill[]>("list_skills");
      const targets = localSkills.filter(
        (s) => s.source === "marketplace"
          && s.marketplace_meta?.marketplace_skill_id === skill.id,
      );
      if (targets.length === 0) {
        addToast(t("marketplace.uninstallFailed"), "error");
        return;
      }
      for (const target of targets) {
        await invoke("delete_skill", { instanceId: target.instance_id });
      }
      addToast(
        t("marketplace.uninstallSuccess").replace("{name}", skill.name),
        "success",
      );
      setSelectedSkill((current) => (
        current && current.id === skill.id
          ? { ...current, install_status: "not_installed" }
          : current
      ));
      setUninstallConfirmSkill(null);
      await loadSkills({
        forceRefresh: true,
        page: 1,
        query: normalizedRemoteQuery,
        sourceIds: undefined,
      });
    } catch (err) {
      showMarketplaceError(err, t("marketplace.uninstallFailed"));
    } finally {
      setUninstallingSkillId(null);
    }
  }, [addToast, loadSkills, normalizedRemoteQuery, showMarketplaceError, t, uninstallingSkillId]);

  const handleGithubInstall = useCallback(async () => {
    const directUrl = githubInstallUrl.trim();
    if (!directUrl) {
      addToast(t("marketplace.githubInstallRequired"), "error");
      return;
    }
    if (installingSkill || updatingAll || refreshing) {
      return;
    }

    setInstallingSkill(DIRECT_GITHUB_INSTALL_ID);
    try {
      const result = await invoke<InstallResult>("install_marketplace_skill_by_ref", {
        reference: {
          name: "",
          repo_url: directUrl,
        },
      });
      if (result.success) {
        addToast(t("marketplace.githubInstallSuccess"), "success");
        setGithubInstallUrl("");
        setGithubInstallDialogOpen(false);
        await loadSkills({
          forceRefresh: true,
          page: 1,
          query: normalizedRemoteQuery,
          sourceIds: undefined,
        });
      } else {
        addToast(t("marketplace.githubInstallFailed"), "error");
      }
    } catch (err) {
      showMarketplaceError(err, t("marketplace.githubInstallFailed"));
    } finally {
      setInstallingSkill(null);
    }
  }, [
    addToast,
    githubInstallUrl,
    installingSkill,
    loadSkills,
    normalizedRemoteQuery,
    refreshing,
    showMarketplaceError,
    t,
    updatingAll,
  ]);

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

  const handleTranslateMarketSkill = useCallback(
    async (skill: MarketplaceSkill, event: MouseEvent | null, force: boolean = false) => {
      event?.stopPropagation();
      const key = makeTranslationKey(skill.id, language);
      if (!force) {
        const existing = translation.getTranslation(key);
        if (existing) {
          const isTranslated = translation.getView(key) === "translated";
          translation.setView(key, isTranslated ? "original" : "translated");
          return;
        }
      }
      let configured = translation.isConfigured;
      if (!configured) {
        configured = await translation.refreshConfigured();
      }
      if (!configured) {
        addToast(t("skills.llmNotConfigured"), "error");
        return;
      }
      setTranslatingMarketIds((prev) => {
        const next = new Set(prev);
        next.add(skill.id);
        return next;
      });
      try {
        await translation.translateMarketplace(
          { id: skill.id, name: skill.name, description: skill.description },
          language,
          force,
        );
      } catch (err) {
        addToast(formatTranslationError(err), "error");
      } finally {
        setTranslatingMarketIds((prev) => {
          const next = new Set(prev);
          next.delete(skill.id);
          return next;
        });
      }
    },
    [translation, language, addToast, t, formatTranslationError],
  );

  const handleOpenExternalLink = useCallback(async (event: MouseEvent, url: string) => {
    event.stopPropagation();
    if (url) {
      try {
        await openUrl(url);
      } catch (err) {
        showMarketplaceError(err, t("marketplace.networkError"));
      }
    }
  }, [showMarketplaceError, t]);

  // clawhub skill 文件预览解析出 owner/version 后，补全到 skills 列表和 selectedSkill，
  // 使卡片列表和详情弹窗都能构造正确的外部链接 {origin}/{owner}/skills/{slug}
  const handleResolveClawhubMeta = useCallback(
    (skillId: string, owner: string, version: string) => {
      setSkills((prev) =>
        prev.map((skill) => {
          if (skill.id !== skillId) return skill;
          if (skill.clawhub_owner === owner && skill.clawhub_version === version) return skill;
          return { ...skill, clawhub_owner: owner, clawhub_version: version };
        }),
      );
      setSelectedSkill((current) => {
        if (!current || current.id !== skillId) return current;
        if (current.clawhub_owner === owner && current.clawhub_version === version) return current;
        return { ...current, clawhub_owner: owner, clawhub_version: version };
      });
    },
    [],
  );

  const handleToggleFavorite = useCallback(async (skill: MarketplaceSkill, event?: MouseEvent) => {
    event?.stopPropagation();
    const willFavorite = !favorites.isMarketplaceFavorite(skill.id);
    try {
      await favorites.toggleMarketplaceFavorite(skill, willFavorite);
      // 若当前处于"仅看收藏"，取消收藏后需刷新快照以从列表移除
      if (favoritesOnly && !willFavorite) {
        const fresh = await favorites.loadMarketplaceFavorites();
        setFavoriteSnapshot(fresh ?? {});
      }
      addToast(
        t(willFavorite ? "skills.favoriteSuccess" : "skills.unfavoriteSuccess").replace(
          "{name}",
          skill.name,
        ),
        "success",
      );
    } catch (err) {
      showMarketplaceError(err, t("marketplace.networkError"));
    }
  }, [addToast, favorites, favoritesOnly, showMarketplaceError, t]);

  const handleMainScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const shouldShow = el.scrollTop > el.clientHeight;
    setShowBackToTop((prev) => (prev !== shouldShow ? shouldShow : prev));
  }, []);

  const handleBackToTop = useCallback(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (favoritesOnly || selectedTags.length > 0 || !hasMore || initialLoading || refreshing) {
      return;
    }
    const target = loadMoreRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void handleLoadMore();
        }
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [favoritesOnly, handleLoadMore, hasMore, initialLoading, refreshing, selectedTags.length, skills.length]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    skills.forEach((skill) => {
      skill.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [skills]);

  const filteredSkills = useMemo(() => {
    // 仅看收藏：从本地快照构建列表，用当前 skills 数据覆盖（保留 install_status 等实时信息）
    if (favoritesOnly) {
      const skillsMap = new Map(skills.map((s) => [s.id, s]));
      const list = Object.entries(favoriteSnapshot).map(([id, meta]) => {
        const existing = skillsMap.get(id);
        return existing ?? snapshotToMarketplaceSkill(id, meta);
      });
      const filtered = list.filter((skill) => {
        const matchesTags = selectedTags.length === 0
          || selectedTags.some((tag) => skill.tags.includes(tag));
        // 收藏模式也支持搜索词过滤（本地匹配，不触发远程请求）
        const matchesQuery = !normalizedRemoteQuery
          || skillMatchesLocalQuery(skill, normalizedRemoteQuery);
        return matchesTags && matchesQuery;
      });
      if (sortMode === "default") {
        // 默认按收藏时间倒序（最新收藏在前）
        const tsMap: Record<string, number> = {};
        Object.entries(favoriteSnapshot).forEach(([id, meta]) => {
          tsMap[id] = meta.favorited_at;
        });
        return filtered.sort((a, b) => (tsMap[b.id] ?? 0) - (tsMap[a.id] ?? 0));
      }
      const sorted = [...filtered];
      if (sortMode === "name") {
        sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      } else if (sortMode === "newest") {
        sorted.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
      } else if (sortMode === "popular") {
        sorted.sort((a, b) => (b.install_count ?? 0) - (a.install_count ?? 0));
      }
      return sorted;
    }
    const filtered = skills.filter((skill) => {
      const matchesTags = selectedTags.length === 0
        || selectedTags.some((tag) => skill.tags.includes(tag));
      return matchesTags;
    });
    if (sortMode === "default") {
      return filtered;
    }
    const sorted = [...filtered];
    if (sortMode === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } else if (sortMode === "newest") {
      sorted.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    } else if (sortMode === "popular") {
      sorted.sort((a, b) => (b.install_count ?? 0) - (a.install_count ?? 0));
    }
    return sorted;
  }, [selectedTags, skills, sortMode, favoritesOnly, favoriteSnapshot, normalizedRemoteQuery]);

  useEffect(() => {
    persistSortMode(sortMode);
  }, [sortMode]);

  const sortLabelMap: Record<MarketplaceSortMode, string> = {
    default: t("marketplace.sortDefault"),
    newest: t("marketplace.sortNewest"),
    popular: t("marketplace.sortPopular"),
    name: t("marketplace.sortName"),
  };

  const showTagFilter = availableTags.length > 0;

  const toggleTagSelection = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      }
      return [...prev, tag];
    });
  }, []);

  if (initialLoading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: 'var(--background)',
      }}>
        <PageHeader title={t("marketplace.title")} />
        <main className="marketplace-main" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <PageLoader />
        </main>
      </div>
    );
  }

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
        title={t("marketplace.title")}
        actions={
          <>
            {updateAvailableCount > 0 && (
              <button
                type="button"
                onClick={handleUpdateAll}
                disabled={updatingAll || refreshing || installingSkill !== null}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid var(--primary-tint-border)',
                  color: 'var(--primary)',
                  backgroundColor: 'var(--primary-tint)',
                  cursor: updatingAll || refreshing || installingSkill !== null ? 'not-allowed' : 'pointer',
                  opacity: updatingAll || refreshing || installingSkill !== null ? 0.7 : 1,
                }}
              >
                {updatingAll
                  ? t("marketplace.updatingAll")
                  : t("marketplace.updateAll").replace("{count}", String(updateAvailableCount))}
              </button>
            )}
            <button
              type="button"
              onClick={() => setGithubInstallDialogOpen(true)}
              disabled={installingSkill !== null || updatingAll}
              title={t("marketplace.githubInstallOpen")}
              aria-label={t("marketplace.githubInstallOpen")}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                padding: 0,
                color: installingSkill !== null || updatingAll ? 'var(--muted-foreground)' : 'var(--muted-foreground)',
                backgroundColor: 'transparent',
                border: '1px solid transparent',
                borderRadius: '6px',
                cursor: installingSkill !== null || updatingAll ? 'not-allowed' : 'pointer',
                opacity: installingSkill !== null || updatingAll ? 0.5 : 1,
                transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (installingSkill === null && !updatingAll) {
                  e.currentTarget.style.color = 'var(--foreground)';
                  e.currentTarget.style.backgroundColor = 'var(--secondary)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--muted-foreground)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Link2 size={14} />
            </button>
            <RefreshButton onClick={handleRefresh} loading={refreshing || updatingAll || searching} iconOnly />
            <div ref={sortDropdownRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setSortDropdownOpen((v) => !v)}
                title={`${t("marketplace.sortLabel")}: ${sortLabelMap[sortMode]}`}
                aria-label={`${t("marketplace.sortLabel")}: ${sortLabelMap[sortMode]}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  padding: 0,
                  color: sortMode !== 'default'
                    ? 'var(--primary)'
                    : (sortDropdownOpen ? 'var(--foreground)' : 'var(--muted-foreground)'),
                  backgroundColor: sortMode !== 'default'
                    ? 'var(--primary-tint)'
                    : (sortDropdownOpen ? 'var(--secondary)' : 'transparent'),
                  border: sortMode !== 'default'
                    ? '1px solid var(--primary-tint-border)'
                    : '1px solid transparent',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (sortMode === 'default' && !sortDropdownOpen) {
                    e.currentTarget.style.color = 'var(--foreground)';
                    e.currentTarget.style.backgroundColor = 'var(--secondary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (sortMode === 'default' && !sortDropdownOpen) {
                    e.currentTarget.style.color = 'var(--muted-foreground)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <ArrowUpDown size={14} />
                {sortMode !== 'default' && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: 'var(--primary)',
                      border: '1.5px solid var(--card)',
                    }}
                  />
                )}
              </button>
              {sortDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: '172px',
                    backgroundColor: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: MODAL_LAYER_Z_INDEX,
                    padding: '6px',
                  }}
                >
                    {MARKETPLACE_SORT_MODES.map((mode) => {
                      const active = mode === sortMode;
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            setSortMode(mode);
                            setSortDropdownOpen(false);
                          }}
                          onMouseEnter={(e) => {
                            if (!active) {
                              e.currentTarget.style.backgroundColor = 'var(--secondary)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!active) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                            }
                          }}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            padding: '7px 10px',
                            fontSize: '12px',
                            fontWeight: active ? 600 : 500,
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: active ? 'var(--secondary)' : 'transparent',
                            color: active ? 'var(--foreground)' : 'var(--popover-foreground)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'color 0.12s ease, background-color 0.12s ease',
                          }}
                        >
                          <span>{sortLabelMap[mode]}</span>
                          {active && (
                            <Check
                              size={13}
                              strokeWidth={2.5}
                              style={{ color: 'var(--primary)', flexShrink: 0 }}
                            />
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
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
                color: favoritesOnly ? 'var(--primary)' : (sortDropdownOpen ? 'var(--foreground)' : 'var(--muted-foreground)'),
                backgroundColor: favoritesOnly ? 'var(--primary-tint)' : 'transparent',
                border: favoritesOnly ? '1px solid var(--primary-tint-border)' : '1px solid transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
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
            {showTagFilter && (
              <div ref={tagDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setTagDropdownOpen((v) => !v)}
                  title={t("marketplace.tagFilter")}
                  aria-label={t("marketplace.tagFilter")}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    padding: 0,
                    color: selectedTags.length > 0 ? 'var(--primary)' : (tagDropdownOpen ? 'var(--foreground)' : 'var(--muted-foreground)'),
                    backgroundColor: selectedTags.length > 0 ? 'var(--primary-tint)' : (tagDropdownOpen ? 'var(--secondary)' : 'transparent'),
                    border: selectedTags.length > 0 ? '1px solid var(--primary-tint-border)' : '1px solid transparent',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'color 0.15s, background-color 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedTags.length === 0 && !tagDropdownOpen) {
                      e.currentTarget.style.color = 'var(--foreground)';
                      e.currentTarget.style.backgroundColor = 'var(--secondary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedTags.length === 0 && !tagDropdownOpen) {
                      e.currentTarget.style.color = 'var(--muted-foreground)';
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  {selectedTags.length > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--primary-foreground)',
                        backgroundColor: 'var(--primary)',
                        borderRadius: 9999,
                        border: '1.5px solid var(--card)',
                        lineHeight: 1,
                      }}
                    >
                      {selectedTags.length}
                    </span>
                  )}
                </button>

                {tagDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      minWidth: '220px',
                      maxHeight: '320px',
                      overflowY: 'auto',
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-lg)',
                      zIndex: MODAL_LAYER_Z_INDEX,
                      padding: '6px',
                    }}
                  >
                      <button
                        onClick={() => {
                          setSelectedTags([]);
                          setTagDropdownOpen(false);
                        }}
                        onMouseEnter={(e) => {
                          if (selectedTags.length > 0) {
                            e.currentTarget.style.backgroundColor = 'var(--secondary)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedTags.length > 0) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          padding: '7px 10px',
                          fontSize: '12px',
                          fontWeight: selectedTags.length === 0 ? 600 : 500,
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: selectedTags.length === 0 ? 'var(--secondary)' : 'transparent',
                          color: selectedTags.length === 0 ? 'var(--foreground)' : 'var(--popover-foreground)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'color 0.12s ease, background-color 0.12s ease',
                        }}
                      >
                        <span>{t("marketplace.tagFilterAll")}</span>
                        {selectedTags.length === 0 && (
                          <Check
                            size={13}
                            strokeWidth={2.5}
                            style={{ color: 'var(--primary)', flexShrink: 0 }}
                          />
                        )}
                      </button>
                      {availableTags.map((tag) => {
                        const selected = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => toggleTagSelection(tag)}
                            onMouseEnter={(e) => {
                              if (!selected) {
                                e.currentTarget.style.backgroundColor = 'var(--secondary)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selected) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              padding: '7px 10px',
                              fontSize: '12px',
                              fontWeight: selected ? 600 : 500,
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: selected ? 'var(--secondary)' : 'transparent',
                              color: selected ? 'var(--foreground)' : 'var(--popover-foreground)',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'color 0.12s ease, background-color 0.12s ease',
                            }}
                          >
                            <span>{tag}</span>
                            {selected && (
                              <Check
                                size={13}
                                strokeWidth={2.5}
                                style={{ color: 'var(--primary)', flexShrink: 0 }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                )}
              </div>
            )}
          </>
        }
      />

      <main
        ref={mainScrollRef}
        onScroll={handleMainScroll}
        className="marketplace-main"
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        <div className="page-container" style={{ maxWidth: '1200px' }}>
          {filteredSkills.length === 0 ? (
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
                {searching
                  ? t("loading.default")
                  : favoritesOnly
                    ? t("skills.favoritesEmpty")
                    : skills.length === 0
                      ? t("marketplace.noSkills")
                      : t("marketplace.noMatch")}
              </div>
              {/* 空结果引导：有搜索词或标签筛选时，提供清除按钮 */}
              {!searching && (normalizedRemoteQuery || selectedTags.length > 0) && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                    {t("marketplace.noMatchHint")}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {normalizedRemoteQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--primary)',
                          backgroundColor: 'var(--primary-tint)',
                          border: '1px solid var(--primary-tint-border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        {t("marketplace.clearSearch")}
                      </button>
                    )}
                    {selectedTags.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTags([])}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--primary)',
                          backgroundColor: 'var(--primary-tint)',
                          border: '1px solid var(--primary-tint-border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        {t("marketplace.clearTags")}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
            {(normalizedRemoteQuery || selectedTags.length > 0) && !favoritesOnly && (
              <div style={{
                fontSize: 12,
                color: 'var(--muted-foreground)',
                padding: '8px 2px 12px',
              }}>
                {t("marketplace.resultsCount").replace("{count}", String(filteredSkills.length))}
              </div>
            )}
            <div className="marketplace-grid">
              {filteredSkills.map((skill) => {
                const color = getSkillColor(skill.name);
                const isInstalled = skill.install_status === "installed";
                const isUpdateAvailable = skill.install_status === "update_available";
                const isInstalling = installingSkill === skill.id;
                const isUninstalling = uninstallingSkillId === skill.id;
                const actionBusy = isInstalling || updatingAll || isUninstalling;
                // clawhub skill 的 owner 需打开详情弹窗后从详情端点解析，
                // 列表阶段无 owner 无法构造正确链接，因此不在卡片上显示链接入口。
                const externalUrl = skill.clawhub_slug
                  ? null
                  : (skill.external_url || skill.repo_url);
                const installCountLabel = formatInstallCountLabel(skill.install_count);
                const metaChipStyle = getMarketplaceMetaChipStyle("compact");
                const translationKey = makeTranslationKey(skill.id, language);
                const cachedTranslation = translation.getTranslation(translationKey);
                const showingTranslation =
                  cachedTranslation != null && translation.getView(translationKey) === "translated";
                const displayedName = showingTranslation && cachedTranslation
                  ? cachedTranslation.name
                  : skill.name;
                const displayedDescription = showingTranslation && cachedTranslation
                  ? cachedTranslation.description
                  : skill.description;
                // 搜索时高亮匹配子串；翻译展示时不重复高亮（避免翻译后文本与 query 不对应）
                const highlightQuery = normalizedRemoteQuery && !showingTranslation
                  ? normalizedRemoteQuery
                  : null;
                const isTranslating = translatingMarketIds.has(skill.id);
                const isDescriptionLoading = !showingTranslation
                  && !skill.description
                  && !descriptionFetchedRef.current.has(skill.id);
                const metaItems = buildMarketplaceMetaItems(
                  skill.author ? t("marketplace.author").replace("{author}", skill.author) : null,
                  installCountLabel,
                );
                return (
                    <div
                      key={skill.id}
                      onClick={() => setSelectedSkill(skill)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '12px 14px',
                        backgroundColor: 'var(--secondary)',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--ring)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: color.bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          boxShadow: 'var(--shadow-sm)',
                        }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color.icon} strokeWidth="2">
                            <path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z"/>
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--foreground)',
                            marginBottom: '3px',
                            lineHeight: 1.3,
                          }}>
                            <span style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {highlightQuery
                                ? highlightMatch(displayedName, highlightQuery)
                                : displayedName}
                            </span>
                            {externalUrl && (
                              <span
                                style={{
                                  color: 'var(--muted-foreground)',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                                onClick={(e) => handleOpenExternalLink(e, externalUrl)}
                                title={t("marketplace.openInBrowser")}
                              >
                                <ExternalLink size={13} />
                              </span>
                            )}
                            <FavoriteIconButton
                              favorited={favorites.isMarketplaceFavorite(skill.id)}
                              onClick={(e) => void handleToggleFavorite(skill, e)}
                              favoriteLabel={t("skills.favoriteAction")}
                              unfavoriteLabel={t("skills.unfavoriteAction")}
                              size={22}
                            />
                            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                              <TranslateIconButton
                                hasTranslation={cachedTranslation != null}
                                showingTranslation={showingTranslation}
                                translating={isTranslating}
                                translateLabel={t("skills.translateAction")}
                                showOriginalLabel={t("skills.showOriginal")}
                                showTranslationLabel={t("skills.showTranslated")}
                                translatingLabel={t("skills.translating")}
                                retranslateLabel={t("skills.retranslate")}
                                onClick={(e) => void handleTranslateMarketSkill(skill, e)}
                                onRetranslate={() => void handleTranslateMarketSkill(skill, null, true)}
                                size={22}
                              />
                            </div>
                          </div>
                          {isDescriptionLoading ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                minHeight: '34px',
                                justifyContent: 'center',
                              }}
                              aria-busy="true"
                            >
                              <div className="marketplace-skeleton-bar" style={skeletonBarStyle(0.9)} />
                              <div className="marketplace-skeleton-bar" style={skeletonBarStyle(0.6)} />
                            </div>
                          ) : (
                            <p style={{
                              fontSize: '12px',
                              color: 'var(--muted-foreground)',
                              margin: 0,
                              lineHeight: 1.4,
                              minHeight: '34px',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}>
                              {displayedDescription
                                ? (highlightQuery
                                  ? highlightMatch(displayedDescription, highlightQuery)
                                  : displayedDescription)
                                : t("skills.noDescription")}
                            </p>
                          )}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-end',
                          flexShrink: 0,
                        }}>
                          {isInstalled ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '10px',
                                fontWeight: 500,
                                color: 'var(--color-success)',
                                backgroundColor: 'var(--color-success-bg)',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid var(--color-success-border)',
                                flexShrink: 0,
                              }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                {t("marketplace.installed")}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUninstallConfirmSkill(skill);
                                }}
                                disabled={actionBusy}
                                title={t("marketplace.uninstall")}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px 8px',
                                  fontSize: '10px',
                                  fontWeight: 500,
                                  color: 'var(--color-error)',
                                  backgroundColor: 'var(--color-error-bg)',
                                  border: '1px solid var(--color-error-border)',
                                  borderRadius: '6px',
                                  cursor: actionBusy ? 'wait' : 'pointer',
                                  opacity: actionBusy ? 0.7 : 1,
                                  flexShrink: 0,
                                }}
                              >
                                {isUninstalling
                                  ? t("marketplace.uninstalling")
                                  : t("marketplace.uninstall")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => handleInstall(skill, e)}
                              disabled={actionBusy}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '5px 10px',
                                fontSize: '10px',
                                fontWeight: 500,
                                color: 'var(--primary-foreground)',
                                backgroundColor: isUpdateAvailable ? 'var(--primary)' : 'var(--foreground)',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: actionBusy ? 'wait' : 'pointer',
                                opacity: actionBusy ? 0.7 : 1,
                                flexShrink: 0,
                              }}
                            >
                              {isInstalling
                                ? t(isUpdateAvailable ? "marketplace.updating" : "marketplace.installing")
                                : t(isUpdateAvailable ? "marketplace.update" : "marketplace.install")}
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        marginBottom: '6px',
                      }}>
                        {metaItems.map((item) => (
                          item.kind === "install_count" ? (
                            <InstallCountBadge key={item.key} label={item.label} />
                          ) : (
                            <span
                              key={item.key}
                              style={{
                                ...metaChipStyle,
                              }}
                            >
                              {item.label}
                            </span>
                          )
                        ))}
                        {skill.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {skill.tags.slice(0, 3).map((tag) => {
                              const selected = selectedTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTagSelection(tag);
                                  }}
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    color: selected ? '#fff' : 'var(--primary)',
                                    backgroundColor: selected ? 'var(--primary)' : 'var(--primary-tint)',
                                    padding: '2px 6px',
                                    borderRadius: '999px',
                                    border: '1px solid var(--primary-tint-border)',
                                  }}
                                >
                                  {highlightQuery
                                    ? highlightMatch(tag, highlightQuery)
                                    : tag}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                );
              })}
            </div>
            </>
          )}

          {hasMore && !favoritesOnly && selectedTags.length === 0 && (
            <>
              <div ref={loadMoreRef} style={{ height: '1px' }} />
              {loadingMore && (
                <div style={{
                  marginTop: '8px',
                  textAlign: 'center',
                  fontSize: '11px',
                  color: 'var(--muted-foreground)',
                }}>
                  {t("loading.default")}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {showBackToTop && (
        <button
          type="button"
          onClick={handleBackToTop}
          aria-label={t("marketplace.backToTop")}
          title={t("marketplace.backToTop")}
          style={{
            position: 'fixed',
            bottom: '28px',
            right: '32px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--background)',
            color: 'var(--foreground)',
            boxShadow: 'var(--shadow-lg)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7"/>
          </svg>
        </button>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {selectedSkill && (
        <SkillDetailModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onInstall={handleInstall}
          installing={updatingAll || installingSkill === selectedSkill.id}
          isFavorite={favorites.isMarketplaceFavorite(selectedSkill.id)}
          onToggleFavorite={(skill) => void handleToggleFavorite(skill)}
          onTagClick={(tag) => {
            setSelectedSkill(null);
            toggleTagSelection(tag);
          }}
          onResolveClawhubMeta={handleResolveClawhubMeta}
        />
      )}

      <GithubInstallDialog
        open={githubInstallDialogOpen}
        installing={installingGithubUrl}
        value={githubInstallUrl}
        onChange={setGithubInstallUrl}
        onClose={() => setGithubInstallDialogOpen(false)}
        onSubmit={() => void handleGithubInstall()}
      />

      <UninstallConfirmDialog
        skill={uninstallConfirmSkill}
        uninstalling={uninstallingSkillId !== null}
        onCancel={() => setUninstallConfirmSkill(null)}
        onConfirm={() => {
          if (uninstallConfirmSkill) {
            void handleUninstallConfirm(uninstallConfirmSkill);
          }
        }}
      />
    </div>
  );
}

function UninstallConfirmDialog({
  skill,
  uninstalling,
  onCancel,
  onConfirm,
}: {
  skill: MarketplaceSkill | null;
  uninstalling: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!skill) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uninstalling) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [skill, uninstalling, onCancel]);

  if (!skill) return null;

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
      onClick={() => {
        if (!uninstalling) onCancel();
      }}
    >
      <div
        style={{
          width: "min(440px, calc(100vw - 48px))",
          backgroundColor: "var(--background)",
          borderRadius: "18px",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-xl)",
          padding: "22px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--foreground)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "10px",
                background: "var(--color-error-bg)",
                color: "var(--color-error)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </span>
            {t("marketplace.uninstallConfirmTitle")}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              lineHeight: 1.6,
              color: "var(--muted-foreground)",
            }}
          >
            {t("marketplace.uninstallConfirmDesc").replace("{name}", skill.name)}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={uninstalling}
            style={{
              padding: "9px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--secondary)",
              color: "var(--foreground)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: uninstalling ? "wait" : "pointer",
              opacity: uninstalling ? 0.7 : 1,
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={uninstalling}
            style={{
              padding: "9px 16px",
              borderRadius: "10px",
              border: "1px solid var(--color-error)",
              backgroundColor: "var(--color-error)",
              color: "white",
              fontSize: "13px",
              fontWeight: 700,
              cursor: uninstalling ? "wait" : "pointer",
              opacity: uninstalling ? 0.7 : 1,
            }}
          >
            {uninstalling ? t("marketplace.uninstalling") : t("marketplace.uninstall")}
          </button>
        </div>
      </div>
    </div>
  );
}

function GithubInstallDialog({
  open,
  installing,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  installing: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [installing, onClose, open]);

  if (!open) {
    return null;
  }

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
      onClick={() => {
        if (!installing) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "min(560px, calc(100vw - 48px))",
          backgroundColor: "var(--background)",
          borderRadius: "18px",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-xl)",
          padding: "22px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "15px",
              fontWeight: 650,
              letterSpacing: "-0.01em",
              color: "var(--foreground)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "var(--radius-md)",
                background: "var(--primary-tint)",
                color: "var(--primary)",
                border: "1px solid var(--primary-tint-border)",
              }}
            >
              <Link2 size={14} />
            </span>
            {t("marketplace.githubInstallTitle")}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              lineHeight: 1.55,
              color: "var(--muted-foreground)",
            }}
          >
            {t("marketplace.githubInstallDesc")}
          </p>
        </div>

        <input
          autoFocus
          type="text"
          placeholder={t("marketplace.githubInstallInputPlaceholder")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: "13px",
            border: `1px solid ${inputFocused ? 'var(--ring)' : 'var(--border)'}`,
            borderRadius: "12px",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            outline: "none",
            boxSizing: "border-box",
            boxShadow: inputFocused ? "var(--shadow-ring)" : "none",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            color: "var(--muted-foreground)",
            lineHeight: 1.5,
          }}
        >
          <span>{t("marketplace.example")}</span>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--foreground)",
              backgroundColor: "var(--secondary)",
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
            }}
          >
            {t("marketplace.githubInstallPlaceholder")}
          </code>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={installing}
            style={{
              padding: "9px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--secondary)",
              color: "var(--foreground)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: installing ? "wait" : "pointer",
              opacity: installing ? 0.7 : 1,
              transition: "background-color 0.15s ease, opacity 0.15s ease",
            }}
            onMouseEnter={(e) => {
              if (!installing) {
                e.currentTarget.style.backgroundColor = "var(--muted)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={installing}
            style={{
              padding: "9px 16px",
              borderRadius: "10px",
              border: "1px solid var(--primary)",
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
              fontSize: "13px",
              fontWeight: 700,
              cursor: installing ? "wait" : "pointer",
              opacity: installing ? 0.7 : 1,
              transition: "opacity 0.15s ease, transform 0.12s ease",
            }}
            onMouseEnter={(e) => {
              if (!installing) {
                e.currentTarget.style.opacity = "0.92";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = installing ? "0.7" : "1";
            }}
            onMouseDown={(e) => {
              if (!installing) {
                e.currentTarget.style.transform = "scale(0.98)";
              }
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {installing ? t("marketplace.installing") : t("marketplace.githubInstallAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

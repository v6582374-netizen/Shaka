import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useLocation } from "react-router-dom";
import { useTranslation } from "../i18n";

export interface SkillTranslationOutput {
  name: string;
  description: string;
  content_md: string | null;
  cached: boolean;
}

export interface MarketplaceTranslationInput {
  id: string;
  name: string;
  description: string | null;
  content_md?: string | null;
}

export interface BatchTranslationProgress {
  current: number;
  total: number;
  instance_id: string;
  skill_name: string;
}

export interface BatchTranslationFailure {
  instance_id: string;
  reason: string;
}

export interface BatchTranslationResult {
  succeeded: string[];
  failed: BatchTranslationFailure[];
}

export type SkillFileTranslationStatus = "started" | "completed" | "failed";

export interface SkillFileTranslationProgress {
  current: number;
  total: number;
  instance_id: string;
  skill_name: string;
  path: string;
  status: SkillFileTranslationStatus;
  target_lang: string;
}

export interface SkillFileTranslationEntry {
  path: string;
  translation: SkillTranslationOutput;
}

export interface SkillFileTranslationFailure {
  path: string;
  reason: string;
}

export interface SkillFilesTranslationResult {
  files: SkillFileTranslationEntry[];
  failed: SkillFileTranslationFailure[];
}

type ViewMode = "translated" | "original";

interface TranslationStore {
  results: Map<string, SkillTranslationOutput>;
  fileResults: Map<string, SkillTranslationOutput>;
  view: Map<string, ViewMode>;
  inFlight: Map<string, Promise<SkillTranslationOutput>>;
  fileInFlight: Map<string, Promise<SkillFilesTranslationResult>>;
}

interface SkillTranslationContextValue {
  isConfigured: boolean;
  refreshConfigured: () => Promise<boolean>;
  translateSkill: (instanceId: string, targetLang: string, force?: boolean) => Promise<SkillTranslationOutput>;
  translateMarketplace: (
    input: MarketplaceTranslationInput,
    targetLang: string,
    force?: boolean
  ) => Promise<SkillTranslationOutput>;
  translateBatch: (
    instanceIds: string[],
    targetLang: string,
    onProgress?: (p: BatchTranslationProgress) => void
  ) => Promise<BatchTranslationResult>;
  translateSkillFiles: (
    instanceId: string,
    targetLang: string,
    force?: boolean,
    onProgress?: (p: SkillFileTranslationProgress) => void
  ) => Promise<SkillFilesTranslationResult>;
  getTranslation: (key: string) => SkillTranslationOutput | null;
  getFileTranslation: (instanceId: string, targetLang: string, path: string) => SkillTranslationOutput | null;
  getView: (key: string) => ViewMode;
  setView: (key: string, mode: ViewMode) => void;
  preloadCachedSkills: (instanceIds: string[], targetLang: string) => Promise<void>;
  preloadCachedMarketplace: (
    inputs: MarketplaceTranslationInput[],
    targetLang: string
  ) => Promise<void>;
  clearAll: () => void;
  clearCache: () => Promise<void>;
}

const SkillTranslationContext = createContext<SkillTranslationContextValue | null>(null);

function normalizeTranslationPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function SkillTranslationProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<TranslationStore>({
    results: new Map(),
    fileResults: new Map(),
    view: new Map(),
    inFlight: new Map(),
    fileInFlight: new Map(),
  });
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  const [isConfigured, setIsConfigured] = useState(false);

  const refreshConfigured = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await invoke<unknown>("get_llm_provider");
      const configured = provider != null;
      setIsConfigured(configured);
      return configured;
    } catch {
      setIsConfigured(false);
      return false;
    }
  }, []);

  useEffect(() => {
    refreshConfigured();
  }, [refreshConfigured]);

  const cacheKey = (instanceId: string, targetLang: string) =>
    `${targetLang}::${instanceId}`;

  const fileCacheKey = (instanceId: string, targetLang: string, path: string) =>
    `${targetLang}::${instanceId}::${normalizeTranslationPath(path)}`;

  const translateSkill = useCallback(
    async (instanceId: string, targetLang: string, force: boolean = false): Promise<SkillTranslationOutput> => {
      const key = cacheKey(instanceId, targetLang);
      const inflightKey = force ? `${key}::force` : key;
      const existing = storeRef.current.inFlight.get(inflightKey);
      if (existing) return existing;

      const promise = (async () => {
        const result = await invoke<SkillTranslationOutput>("translate_skill", {
          instanceId,
          targetLang,
          force,
        });
        storeRef.current.results.set(key, result);
        storeRef.current.view.set(key, "translated");
        bump();
        return result;
      })().finally(() => {
        storeRef.current.inFlight.delete(inflightKey);
      });

      storeRef.current.inFlight.set(inflightKey, promise);
      return promise;
    },
    [bump]
  );

  const translateMarketplace = useCallback(
    async (
      input: MarketplaceTranslationInput,
      targetLang: string,
      force: boolean = false
    ): Promise<SkillTranslationOutput> => {
      const key = cacheKey(input.id, targetLang);
      const inflightKey = force ? `${key}::force` : key;
      const existing = storeRef.current.inFlight.get(inflightKey);
      if (existing) return existing;

      const promise = (async () => {
        const result = await invoke<SkillTranslationOutput>("translate_marketplace_skill", {
          input,
          targetLang,
          force,
        });
        storeRef.current.results.set(key, result);
        storeRef.current.view.set(key, "translated");
        bump();
        return result;
      })().finally(() => {
        storeRef.current.inFlight.delete(inflightKey);
      });

      storeRef.current.inFlight.set(inflightKey, promise);
      return promise;
    },
    [bump]
  );

  const translateBatch = useCallback(
    async (
      instanceIds: string[],
      targetLang: string,
      onProgress?: (p: BatchTranslationProgress) => void
    ): Promise<BatchTranslationResult> => {
      let unlisten: UnlistenFn | null = null;
      if (onProgress) {
        unlisten = await listen<BatchTranslationProgress>(
          "llm:batch-progress",
          (event) => onProgress(event.payload)
        );
      }
      try {
        const result = await invoke<BatchTranslationResult>("translate_skills_batch", {
          instanceIds,
          targetLang,
        });
        for (const id of result.succeeded) {
          storeRef.current.view.set(cacheKey(id, targetLang), "translated");
        }
        bump();
        return result;
      } finally {
        if (unlisten) unlisten();
      }
    },
    [bump]
  );

  const translateSkillFiles = useCallback(
    async (
      instanceId: string,
      targetLang: string,
      force: boolean = false,
      onProgress?: (p: SkillFileTranslationProgress) => void
    ): Promise<SkillFilesTranslationResult> => {
      const key = cacheKey(instanceId, targetLang);
      const inflightKey = force ? `${key}::files::force` : `${key}::files`;
      const existing = storeRef.current.fileInFlight.get(inflightKey);
      if (existing) return existing;

      const promise = (async () => {
        let unlisten: UnlistenFn | null = null;
        if (onProgress) {
          unlisten = await listen<SkillFileTranslationProgress>(
            "llm:skill-files-progress",
            (event) => {
              const payload = event.payload;
              if (payload.instance_id === instanceId && payload.target_lang === targetLang) {
                onProgress(payload);
              }
            }
          );
        }

        try {
          const result = await invoke<SkillFilesTranslationResult>("translate_skill_files", {
            instanceId,
            targetLang,
            force,
          });
          for (const file of result.files) {
            const normalizedPath = normalizeTranslationPath(file.path);
            storeRef.current.fileResults.set(
              fileCacheKey(instanceId, targetLang, normalizedPath),
              file.translation,
            );
            if (normalizedPath.toLowerCase().endsWith("skill.md")) {
              storeRef.current.results.set(key, file.translation);
              storeRef.current.view.set(key, "translated");
            }
          }
          bump();
          return result;
        } finally {
          if (unlisten) unlisten();
        }
      })().finally(() => {
        storeRef.current.fileInFlight.delete(inflightKey);
      });

      storeRef.current.fileInFlight.set(inflightKey, promise);
      return promise;
    },
    [bump]
  );

  const getTranslation = useCallback((key: string) => {
    return storeRef.current.results.get(key) ?? null;
  }, []);

  const getFileTranslation = useCallback((instanceId: string, targetLang: string, path: string) => {
    return storeRef.current.fileResults.get(fileCacheKey(instanceId, targetLang, path)) ?? null;
  }, []);

  const getView = useCallback((key: string): ViewMode => {
    return storeRef.current.view.get(key) ?? "original";
  }, []);

  const setView = useCallback(
    (key: string, mode: ViewMode) => {
      storeRef.current.view.set(key, mode);
      bump();
    },
    [bump]
  );

  const clearAll = useCallback(() => {
    storeRef.current.results.clear();
    storeRef.current.fileResults.clear();
    storeRef.current.view.clear();
    bump();
  }, [bump]);

  const clearCache = useCallback(async () => {
    await invoke("clear_translation_cache");
    clearAll();
  }, [clearAll]);

  const preloadCachedSkills = useCallback(
    async (instanceIds: string[], targetLang: string): Promise<void> => {
      if (instanceIds.length === 0) return;
      try {
        const entries = await invoke<Array<{ key: string; translation: SkillTranslationOutput | null }>>(
          "get_cached_skill_translations",
          { instanceIds, targetLang },
        );
        let changed = false;
        for (const entry of entries) {
          if (!entry.translation) continue;
          const key = cacheKey(entry.key, targetLang);
          if (!storeRef.current.results.has(key)) {
            storeRef.current.results.set(key, entry.translation);
            changed = true;
          }
        }
        if (changed) bump();
      } catch {
        // ignore preload failure
      }
    },
    [bump],
  );

  const preloadCachedMarketplace = useCallback(
    async (inputs: MarketplaceTranslationInput[], targetLang: string): Promise<void> => {
      if (inputs.length === 0) return;
      try {
        const entries = await invoke<Array<{ key: string; translation: SkillTranslationOutput | null }>>(
          "get_cached_marketplace_translations",
          { inputs, targetLang },
        );
        let changed = false;
        for (const entry of entries) {
          if (!entry.translation) continue;
          const key = cacheKey(entry.key, targetLang);
          if (!storeRef.current.results.has(key)) {
            storeRef.current.results.set(key, entry.translation);
            changed = true;
          }
        }
        if (changed) bump();
      } catch {
        // ignore preload failure
      }
    },
    [bump],
  );

  // 自动缓存预热：仅在语言变化时预热当前路由对应页面的翻译。
  // 不在每次路由切换时运行 — 那会重复调用 list_skills 并触发 bump(),
  // 导致整个应用树重渲染（SkillTranslationProvider 包裹整个 app），
  // 是 Skills 页面切换卡顿的主要根源。页面自己会在数据加载后预热。
  const location = useLocation();
  const { language } = useTranslation();
  const lastPreloadedLangRef = useRef<string | null>(null);
  const lastPreloadedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const preloadForRoute = async () => {
      if (!isConfigured) return;
      // 同一语言 + 同一路径只预热一次，避免每次 mount 重复触发
      if (lastPreloadedLangRef.current === language && lastPreloadedPathRef.current === location.pathname) {
        return;
      }

      try {
        if (location.pathname === '/skills') {
          // Skills 页面：预热所有已安装 skill
          const skills = await invoke<Array<{ instance_id: string }>>('list_skills');
          const instanceIds = skills.map(s => s.instance_id);
          await preloadCachedSkills(instanceIds, language);
        } else if (location.pathname === '/marketplace') {
          // Marketplace 页面：预热前 50 个
          const items = await invoke<Array<{ id: string; name: string; description: string }>>(
            'get_marketplace_skills'
          );
          const top50 = items.slice(0, 50).map(s => ({
            id: s.id,
            name: s.name,
            description: s.description,
          }));
          await preloadCachedMarketplace(top50, language);
        }
        lastPreloadedLangRef.current = language;
        lastPreloadedPathRef.current = location.pathname;
      } catch (err) {
        // 预热失败静默处理，不影响用户
        console.debug('Cache preload failed:', err);
      }
    };

    preloadForRoute();
  }, [location.pathname, language, isConfigured, preloadCachedSkills, preloadCachedMarketplace]);

  const value: SkillTranslationContextValue = {
    isConfigured,
    refreshConfigured,
    translateSkill,
    translateMarketplace,
    translateBatch,
    translateSkillFiles,
    getTranslation,
    getFileTranslation,
    getView,
    setView,
    preloadCachedSkills,
    preloadCachedMarketplace,
    clearAll,
    clearCache,
  };

  return (
    <SkillTranslationContext.Provider value={value}>
      {children}
    </SkillTranslationContext.Provider>
  );
}

export function useSkillTranslation() {
  const ctx = useContext(SkillTranslationContext);
  if (!ctx) {
    throw new Error("useSkillTranslation must be used within SkillTranslationProvider");
  }
  return ctx;
}

export function makeTranslationKey(instanceId: string, targetLang: string): string {
  return `${targetLang}::${instanceId}`;
}

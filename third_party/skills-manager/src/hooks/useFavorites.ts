import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  MarketplaceFavoriteMap,
  MarketplaceSkill,
  SkillMetadataMap,
} from "@/types";

/**
 * 收藏状态管理。
 * - skillFavorites: 本地 skill（按 instance_id 索引），来自 config.skill_metadata
 *   - 仅当 skill_metadata[instance_id].favorited_at != null 视为已收藏
 * - marketplaceFavorites: 市场 skill（按 marketplace skill id 索引），来自 config.marketplace_favorites
 *
 * 两个 map 由调用方传入（Skills/Marketplace 页已持有 config 或可单独加载），
 * 本 hook 仅负责 toggle 操作和本地状态同步。
 */
export interface UseFavoritesResult {
  skillFavoriteIds: Set<string>;
  marketplaceFavoriteIds: Set<string>;
  isSkillFavorite: (instanceId: string) => boolean;
  isMarketplaceFavorite: (skillId: string) => boolean;
  toggleSkillFavorite: (instanceId: string, favorited: boolean) => Promise<void>;
  toggleMarketplaceFavorite: (skill: MarketplaceSkill, favorited: boolean) => Promise<void>;
  /** 加载市场收藏快照（用于断网展示） */
  loadMarketplaceFavorites: () => Promise<MarketplaceFavoriteMap>;
  /** 本地 skill 收藏的 instance_id → favorited_at 映射，用于排序 */
  skillFavoriteTimestamps: Map<string, number>;
}

export function useFavorites(
  skillMetadata: SkillMetadataMap | undefined,
): UseFavoritesResult {
  const [skillFavoriteIds, setSkillFavoriteIds] = useState<Set<string>>(new Set());
  const [skillFavoriteTimestamps, setSkillFavoriteTimestamps] = useState<Map<string, number>>(new Map());
  const [marketplaceFavoriteIds, setMarketplaceFavoriteIds] = useState<Set<string>>(new Set());

  // 从传入的 skill_metadata 同步本地收藏状态
  useEffect(() => {
    const ids = new Set<string>();
    const timestamps = new Map<string, number>();
    if (skillMetadata) {
      for (const [instanceId, meta] of Object.entries(skillMetadata)) {
        if (meta?.favorited_at != null) {
          ids.add(instanceId);
          timestamps.set(instanceId, meta.favorited_at);
        }
      }
    }
    setSkillFavoriteIds(ids);
    setSkillFavoriteTimestamps(timestamps);
  }, [skillMetadata]);

  // 启动时加载一次市场收藏列表
  useEffect(() => {
    let cancelled = false;
    void invoke<MarketplaceFavoriteMap>("list_marketplace_favorites")
      .then((map) => {
        if (cancelled) return;
        setMarketplaceFavoriteIds(new Set(Object.keys(map ?? {})));
      })
      .catch(() => {
        // 忽略：加载失败不阻塞页面
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isSkillFavorite = useCallback(
    (instanceId: string) => skillFavoriteIds.has(instanceId),
    [skillFavoriteIds],
  );

  const isMarketplaceFavorite = useCallback(
    (skillId: string) => marketplaceFavoriteIds.has(skillId),
    [marketplaceFavoriteIds],
  );

  const toggleSkillFavorite = useCallback(
    async (instanceId: string, favorited: boolean) => {
      await invoke("toggle_skill_favorite", { instanceId, favorited });
      setSkillFavoriteIds((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(instanceId);
        else next.delete(instanceId);
        return next;
      });
      setSkillFavoriteTimestamps((prev) => {
        const next = new Map(prev);
        if (favorited) {
          next.set(instanceId, Math.floor(Date.now() / 1000));
        } else {
          next.delete(instanceId);
        }
        return next;
      });
    },
    [],
  );

  const toggleMarketplaceFavorite = useCallback(
    async (skill: MarketplaceSkill, favorited: boolean) => {
      await invoke("toggle_marketplace_favorite", { skill, favorited });
      setMarketplaceFavoriteIds((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(skill.id);
        else next.delete(skill.id);
        return next;
      });
    },
    [],
  );

  const loadMarketplaceFavorites = useCallback(async () => {
    try {
      return await invoke<MarketplaceFavoriteMap>("list_marketplace_favorites");
    } catch {
      return {};
    }
  }, []);

  return {
    skillFavoriteIds,
    marketplaceFavoriteIds,
    isSkillFavorite,
    isMarketplaceFavorite,
    toggleSkillFavorite,
    toggleMarketplaceFavorite,
    loadMarketplaceFavorites,
    skillFavoriteTimestamps,
  };
}

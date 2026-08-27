import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SkillMetadataMap } from "@skills-manager/types";

export interface UseFavoritesResult {
  skillFavoriteIds: Set<string>;
  isSkillFavorite: (instanceId: string) => boolean;
  toggleSkillFavorite: (instanceId: string, favorited: boolean) => Promise<void>;
  skillFavoriteTimestamps: Map<string, number>;
}

export function useFavorites(skillMetadata: SkillMetadataMap | undefined): UseFavoritesResult {
  const [skillFavoriteIds, setSkillFavoriteIds] = useState<Set<string>>(new Set());
  const [skillFavoriteTimestamps, setSkillFavoriteTimestamps] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const ids = new Set<string>();
    const timestamps = new Map<string, number>();
    for (const [instanceId, metadata] of Object.entries(skillMetadata ?? {})) {
      if (metadata?.favorited_at == null) continue;
      ids.add(instanceId);
      timestamps.set(instanceId, metadata.favorited_at);
    }
    setSkillFavoriteIds(ids);
    setSkillFavoriteTimestamps(timestamps);
  }, [skillMetadata]);

  const isSkillFavorite = useCallback((instanceId: string) => skillFavoriteIds.has(instanceId), [skillFavoriteIds]);

  const toggleSkillFavorite = useCallback(async (instanceId: string, favorited: boolean) => {
    await invoke("toggle_skill_favorite", { instanceId, favorited });
    setSkillFavoriteIds((previous) => {
      const next = new Set(previous);
      if (favorited) next.add(instanceId);
      else next.delete(instanceId);
      return next;
    });
    setSkillFavoriteTimestamps((previous) => {
      const next = new Map(previous);
      if (favorited) next.set(instanceId, Math.floor(Date.now() / 1000));
      else next.delete(instanceId);
      return next;
    });
  }, []);

  return { skillFavoriteIds, isSkillFavorite, toggleSkillFavorite, skillFavoriteTimestamps };
}

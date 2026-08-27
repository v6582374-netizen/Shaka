import type { Skill, SkillMetadataMap } from "@/types";

export interface SkillTagSummary {
  tag: string;
  count: number;
}

export type TagFilterSelectionSummary =
  | { kind: "all" }
  | { kind: "untagged" }
  | { kind: "single"; tag: string }
  | { kind: "multiple"; count: number };

export interface TagFilterState {
  selectedTags: string[];
  untaggedOnly: boolean;
}

export type TagFilterAction =
  | { type: "toggle-tag"; tag: string }
  | { type: "toggle-untagged" }
  | { type: "reset" };

export interface SkillTagFilters {
  searchQuery: string;
  selectedTags: string[];
  untaggedOnly: boolean;
}

function normalizeSkillTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeSkillTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const value = normalizeSkillTag(tag);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

export function getSkillTags(skillId: string, skillMetadata?: SkillMetadataMap): string[] {
  return normalizeSkillTags(skillMetadata?.[skillId]?.tags ?? []);
}

export function getSkillMetadataKey(skill: Pick<Skill, "instance_id">): string {
  return skill.instance_id;
}

function getLegacyGlobalSkillMetadataKey(skill: Pick<Skill, "id" | "scope">): string | null {
  return skill.scope === "global" ? skill.id : null;
}

export function getSkillTagsForSkill(skill: Skill, skillMetadata?: SkillMetadataMap): string[] {
  const metadataKey = getSkillMetadataKey(skill);
  const nextTags = getSkillTags(metadataKey, skillMetadata);
  if (nextTags.length > 0) {
    return nextTags;
  }

  const legacyMetadataKey = getLegacyGlobalSkillMetadataKey(skill);
  if (!legacyMetadataKey) {
    return nextTags;
  }

  return getSkillTags(legacyMetadataKey, skillMetadata);
}

function hasLegacyGlobalMetadataEntry(
  skill: Pick<Skill, "id" | "scope">,
  skillMetadata?: SkillMetadataMap,
): boolean {
  const legacyMetadataKey = getLegacyGlobalSkillMetadataKey(skill);
  return legacyMetadataKey ? Boolean(skillMetadata?.[legacyMetadataKey]) : false;
}

export function hasSkillMetadataEntry(
  skill: Pick<Skill, "id" | "scope" | "instance_id">,
  skillMetadata?: SkillMetadataMap,
): boolean {
  return Boolean(skillMetadata?.[getSkillMetadataKey(skill)]) || hasLegacyGlobalMetadataEntry(skill, skillMetadata);
}

export function removeSkillMetadataEntry(
  skill: Pick<Skill, "id" | "scope" | "instance_id">,
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  const nextMetadata = removeMetadataEntry(getSkillMetadataKey(skill), skillMetadata);
  const legacyMetadataKey = getLegacyGlobalSkillMetadataKey(skill);
  return legacyMetadataKey ? removeMetadataEntry(legacyMetadataKey, nextMetadata) : nextMetadata;
}

export function migrateSkillMetadataToInstanceIds(
  skills: Pick<Skill, "id" | "scope" | "instance_id">[],
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  const originalMetadata = skillMetadata ?? {};
  const nextMetadata = { ...originalMetadata };
  let changed = false;

  for (const skill of skills) {
    if (skill.scope !== "global") {
      continue;
    }

    const legacyMetadataKey = getLegacyGlobalSkillMetadataKey(skill);
    const metadataKey = getSkillMetadataKey(skill);
    if (!legacyMetadataKey || legacyMetadataKey === metadataKey) {
      continue;
    }

    if (nextMetadata[metadataKey] || !nextMetadata[legacyMetadataKey]) {
      continue;
    }

    nextMetadata[metadataKey] = nextMetadata[legacyMetadataKey];
    delete nextMetadata[legacyMetadataKey];
    changed = true;
  }

  return changed ? nextMetadata : originalMetadata;
}

export function migrateSkillMetadataEntryToInstanceId(
  skill: Pick<Skill, "id" | "scope" | "instance_id">,
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  return migrateSkillMetadataToInstanceIds([skill], skillMetadata);
}

export function updateSkillTagsForSkill(
  skill: Pick<Skill, "id" | "scope" | "instance_id">,
  nextTags: string[],
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  const migratedMetadata = migrateSkillMetadataEntryToInstanceId(skill, skillMetadata);
  return updateMetadataTags(getSkillMetadataKey(skill), nextTags, migratedMetadata);
}

export function getUntaggedSkillsCount(skills: Skill[], skillMetadata?: SkillMetadataMap): number {
  return skills.filter((skill) => getSkillTagsForSkill(skill, skillMetadata).length === 0).length;
}

export function getGroupMetadataKey(groupId: string): string {
  return `group:${groupId}`;
}

export function getGroupTags(groupId: string, skillMetadata?: SkillMetadataMap): string[] {
  return normalizeSkillTags(skillMetadata?.[getGroupMetadataKey(groupId)]?.tags ?? []);
}

export function updateMetadataTags(
  metadataKey: string,
  nextTags: string[],
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  const normalizedTags = normalizeSkillTags(nextTags);
  const nextMetadata = { ...(skillMetadata ?? {}) };

  if (normalizedTags.length === 0) {
    delete nextMetadata[metadataKey];
  } else {
    nextMetadata[metadataKey] = { tags: normalizedTags };
  }

  return nextMetadata;
}

export function removeMetadataEntry(
  metadataKey: string,
  skillMetadata?: SkillMetadataMap,
): SkillMetadataMap {
  const nextMetadata = { ...(skillMetadata ?? {}) };
  delete nextMetadata[metadataKey];
  return nextMetadata;
}

export function buildAllTagSummaries(skillMetadata?: SkillMetadataMap): SkillTagSummary[] {
  const counts = new Map<string, number>();

  for (const metadata of Object.values(skillMetadata ?? {})) {
    for (const tag of normalizeSkillTags(metadata.tags ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

export function buildSkillTagSummaries(
  skills: Skill[],
  skillMetadata?: SkillMetadataMap,
): SkillTagSummary[] {
  const counts = new Map<string, number>();

  for (const skill of skills) {
    for (const tag of getSkillTagsForSkill(skill, skillMetadata)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

export function hasSelectableTagFilters(tagSummaries: SkillTagSummary[]): boolean {
  return tagSummaries.length > 0;
}

export function getTagFilterSelectionSummary(
  selectedTags: string[],
  untaggedOnly: boolean,
): TagFilterSelectionSummary {
  const normalizedTags = normalizeSkillTags(selectedTags);

  if (untaggedOnly) {
    return { kind: "untagged" };
  }

  if (normalizedTags.length === 0) {
    return { kind: "all" };
  }

  if (normalizedTags.length === 1) {
    return { kind: "single", tag: normalizedTags[0] };
  }

  return { kind: "multiple", count: normalizedTags.length };
}

export function applyTagFilterAction(
  state: TagFilterState,
  action: TagFilterAction,
): TagFilterState & { closeMenu: true } {
  switch (action.type) {
    case "toggle-tag": {
      const normalizedTag = normalizeSkillTags([action.tag])[0];
      const selectedTags = normalizedTag
        ? state.selectedTags.includes(normalizedTag)
          ? state.selectedTags.filter((tag) => tag !== normalizedTag)
          : [...normalizeSkillTags(state.selectedTags), normalizedTag]
        : normalizeSkillTags(state.selectedTags);

      return {
        selectedTags,
        untaggedOnly: false,
        closeMenu: true,
      };
    }
    case "toggle-untagged":
      return {
        selectedTags: [],
        untaggedOnly: !state.untaggedOnly,
        closeMenu: true,
      };
    case "reset":
      return {
        selectedTags: [],
        untaggedOnly: false,
        closeMenu: true,
      };
  }
}

function matchesSearch(skill: Skill, tags: string[], searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return (
    skill.name.toLowerCase().includes(query) ||
    skill.id.toLowerCase().includes(query) ||
    skill.instance_id.toLowerCase().includes(query) ||
    (skill.description?.toLowerCase().includes(query) ?? false) ||
    tags.some((tag) => tag.includes(query))
  );
}

export function filterSkills(
  skills: Skill[],
  skillMetadata: SkillMetadataMap | undefined,
  filters: SkillTagFilters,
): Skill[] {
  const selectedTags = normalizeSkillTags(filters.selectedTags);

  return skills.filter((skill) => {
    const tags = getSkillTagsForSkill(skill, skillMetadata);

    if (!matchesSearch(skill, tags, filters.searchQuery)) {
      return false;
    }

    if (filters.untaggedOnly) {
      return tags.length === 0;
    }

    if (selectedTags.length === 0) {
      return true;
    }

    return selectedTags.some((tag) => tags.includes(tag));
  });
}

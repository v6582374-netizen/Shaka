import type { InstalledSkillPackage, Skill, SkillMetadataMap, Tool } from "../../types/index.ts";
import { getEnabledToolIds } from "./getEnabledToolIds.ts";
import { orderToolIdsForSkill } from "./orderToolIds.ts";
import { summarizeEnabledTools, type EnabledToolsSummary } from "./summarizeEnabledTools.ts";
import { getGroupMetadataKey, getGroupTags, getSkillTagsForSkill, normalizeSkillTags, type SkillTagSummary } from "./skillTags.ts";

export interface GroupToolState {
  toolId: string;
  enabledMemberCount: number;
  memberCount: number;
  fullyEnabled: boolean;
  anyEnabled: boolean;
}

export interface UnifiedSkillListItem {
  kind: "skill" | "group";
  key: string;
  id: string;
  title: string;
  description: string | null;
  openPath: string | null;
  searchText: string;
  tags: string[];
  supportsTagFilter: boolean;
  badgeLabel: string | null;
  scopeLabel: "global" | "project" | null;
  previewChips: string[];
  previewOverflowCount: number;
  sortName: string;
  sortPriority: number;
  memberCount?: number;
  toolSummary?: EnabledToolsSummary;
  groupToolStateById?: Record<string, GroupToolState>;
  skill?: Skill;
  skillPackage?: InstalledSkillPackage;
}

interface BuildUnifiedSkillItemsOptions {
  skills: Skill[];
  skillPackages: InstalledSkillPackage[];
  tools: Tool[];
  skillMetadata: SkillMetadataMap | undefined;
  groupBadgeLabel: string;
}

interface UnifiedSkillListFilters {
  searchQuery: string;
  selectedTags: string[];
  untaggedOnly: boolean;
  scopeFilter?: "all" | "global" | "project";
}

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n")
    .toLowerCase();
}

function getSearchRank(item: UnifiedSkillListItem, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const id = item.id.toLowerCase();
  const title = item.title.toLowerCase();
  const description = item.description?.toLowerCase() ?? "";

  if (title.startsWith(normalizedQuery) || id.startsWith(normalizedQuery)) {
    return 0;
  }

  if (title.includes(normalizedQuery) || id.includes(normalizedQuery)) {
    return 1;
  }

  if (description.includes(normalizedQuery) || item.searchText.includes(normalizedQuery)) {
    return 2;
  }

  return 3;
}

export function getGroupMemberSkills(skillPackage: InstalledSkillPackage, skills: Skill[]): Skill[] {
  const memberIds = new Set(skillPackage.installed_members);
  return skills.filter((skill) => memberIds.has(skill.id) && skill.scope === "global");
}

export function buildGroupToolStateById(
  skillPackage: InstalledSkillPackage,
  skills: Skill[],
  enabledToolIds: string[],
): Record<string, GroupToolState> {
  const memberSkills = getGroupMemberSkills(skillPackage, skills);
  const memberCount = skillPackage.installed_members.length;

  return Object.fromEntries(
    enabledToolIds.map((toolId) => {
      const enabledMemberCount = memberSkills.filter((skill) => Boolean(skill.enabled[toolId])).length;

      return [toolId, {
        toolId,
        enabledMemberCount,
        memberCount,
        fullyEnabled: memberCount > 0 && enabledMemberCount === memberCount,
        anyEnabled: enabledMemberCount > 0,
      }];
    }),
  );
}

export function getGroupToolVisualState(state: GroupToolState): boolean {
  return state.fullyEnabled;
}

export function shouldShowGroupToolInEnabledOnly(state: GroupToolState): boolean {
  return state.anyEnabled;
}

export function removeGroupSkillMetadataEntries(
  skillMetadata: SkillMetadataMap | undefined,
  memberSkillIds: string[],
  packageId?: string,
): SkillMetadataMap {
  const memberSkillIdSet = new Set(memberSkillIds);
  const groupMetadataKey = packageId ? getGroupMetadataKey(packageId) : null;

  return Object.fromEntries(
    Object.entries(skillMetadata ?? {}).filter(([skillId]) => !memberSkillIdSet.has(skillId) && skillId !== groupMetadataKey),
  );
}

export function getGroupBulkModeState(groupToolStateById: Record<string, GroupToolState>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(groupToolStateById).map(([toolId, state]) => [toolId, state.fullyEnabled]),
  );
}

export function getGroupToolCoverageLabel(state: GroupToolState): string {
  return `${state.enabledMemberCount}/${state.memberCount}`;
}

export function getGroupToolLabel(toolLabel: string, state: GroupToolState): string {
  if (state.fullyEnabled || !state.anyEnabled) {
    return toolLabel;
  }

  return `${toolLabel} · ${getGroupToolCoverageLabel(state)}`;
}

function getSkillBadgeLabel(_skill: Skill): string | null {
  return null;
}

function getSkillSearchText(skill: Skill, tags: string[]): string {
  return buildSearchText([
    skill.name,
    skill.id,
    skill.instance_id,
    skill.description,
    skill.scope,
    skill.project_id ?? null,
    skill.project_name ?? null,
    ...tags,
  ]);
}

function getSkillPreviewChips(_skill: Skill, tags: string[]): string[] {
  return tags.slice(0, 3);
}

export function buildUnifiedSkillItems({
  skills,
  skillPackages,
  tools,
  skillMetadata,
  groupBadgeLabel,
}: BuildUnifiedSkillItemsOptions): UnifiedSkillListItem[] {
  const enabledToolIds = getEnabledToolIds(tools);

  const skillItems = skills.map((skill): UnifiedSkillListItem => {
    const tags = getSkillTagsForSkill(skill, skillMetadata);
    const orderedToolIds = orderToolIdsForSkill(enabledToolIds, skill.enabled);
    const previewChips = getSkillPreviewChips(skill, tags);
    const previewTotal = tags.length;

    return {
      kind: "skill",
      key: `skill:${skill.instance_id}`,
      id: skill.instance_id,
      title: skill.name,
      description: skill.description,
      openPath: skill.path,
      searchText: getSkillSearchText(skill, tags),
      tags,
      supportsTagFilter: true,
      badgeLabel: getSkillBadgeLabel(skill),
      scopeLabel: skill.scope,
      previewChips,
      previewOverflowCount: Math.max(0, previewTotal - previewChips.length),
      sortName: skill.name.toLowerCase(),
      sortPriority: skill.scope === "project" ? 0 : 1,
      toolSummary: summarizeEnabledTools(orderedToolIds, skill.enabled, 2),
      skill,
    };
  });

  const groupItems = skillPackages.map((skillPackage): UnifiedSkillListItem => {
    const tags = getGroupTags(skillPackage.package_id, skillMetadata);
    const previewChips = tags.length > 0 ? tags.slice(0, 3) : skillPackage.installed_members.slice(0, 3);

    return {
      kind: "group",
      key: `group:${skillPackage.package_id}`,
      id: skillPackage.package_id,
      title: skillPackage.name,
      description: null,
      openPath: skillPackage.path ?? null,
      searchText: buildSearchText([
        skillPackage.name,
        skillPackage.package_id,
        ...skillPackage.installed_members,
        ...tags,
      ]),
      tags,
      supportsTagFilter: tags.length > 0,
      badgeLabel: groupBadgeLabel,
      scopeLabel: null,
      previewChips,
      previewOverflowCount: Math.max(
        0,
        (tags.length > 0 ? tags.length : skillPackage.installed_members.length) - previewChips.length,
      ),
      sortName: skillPackage.name.toLowerCase(),
      sortPriority: 2,
      memberCount: skillPackage.installed_members.length,
      groupToolStateById: buildGroupToolStateById(skillPackage, skills, enabledToolIds),
      skillPackage,
    };
  });

  return [...skillItems, ...groupItems];
}

export function buildUnifiedItemTagSummaries(
  items: UnifiedSkillListItem[],
): SkillTagSummary[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

export function filterUnifiedSkillItems(
  items: UnifiedSkillListItem[],
  filters: UnifiedSkillListFilters,
): UnifiedSkillListItem[] {
  const query = filters.searchQuery.trim().toLowerCase();
  const selectedTags = normalizeSkillTags(filters.selectedTags);
  const scopeFilter = filters.scopeFilter ?? "all";

  return items.filter((item) => {
    if (scopeFilter !== "all") {
      if (item.scopeLabel !== scopeFilter) {
        return false;
      }
    }

    if (query && !item.searchText.includes(query)) {
      return false;
    }

    if (!item.supportsTagFilter) {
      return !(filters.untaggedOnly || selectedTags.length > 0);
    }

    if (filters.untaggedOnly) {
      return item.tags.length === 0;
    }

    if (selectedTags.length === 0) {
      return true;
    }

    return selectedTags.some((tag) => item.tags.includes(tag));
  });
}

export function sortUnifiedSkillItems(
  items: UnifiedSkillListItem[],
  searchQuery: string,
): UnifiedSkillListItem[] {
  const query = searchQuery.trim().toLowerCase();

  return [...items].sort((a, b) => {
    if (query) {
      const rankDiff = getSearchRank(a, query) - getSearchRank(b, query);
      if (rankDiff !== 0) {
        return rankDiff;
      }
    }

    const priorityDiff = a.sortPriority - b.sortPriority;
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return a.sortName.localeCompare(b.sortName);
  });
}

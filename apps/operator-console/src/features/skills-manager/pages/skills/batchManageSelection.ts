import type { BatchSkillToolTarget, Skill } from "../../types";
import { getGroupMemberSkills, type UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";

export interface BatchSelectionSummary {
  totalCount: number;
  skillCount: number;
  groupCount: number;
  affectedSkillCount: number;
}

export function toggleBatchSelection(currentKeys: Set<string>, itemKey: string): Set<string> {
  const next = new Set(currentKeys);

  if (next.has(itemKey)) {
    next.delete(itemKey);
    return next;
  }

  next.add(itemKey);
  return next;
}

export function selectVisibleBatchItems(
  currentKeys: Set<string>,
  visibleKeys: string[],
): Set<string> {
  const next = new Set(currentKeys);
  visibleKeys.forEach((key) => next.add(key));
  return next;
}

export function pruneBatchSelectionToAvailable(
  currentKeys: Set<string>,
  availableKeys: string[],
): Set<string> {
  const availableKeySet = new Set(availableKeys);
  return new Set([...currentKeys].filter((key) => availableKeySet.has(key)));
}

export function getSelectedBatchItems(
  items: UnifiedSkillListItem[],
  selectedKeys: Set<string>,
): UnifiedSkillListItem[] {
  return items.filter((item) => selectedKeys.has(item.key));
}

export function buildBatchTargets(items: UnifiedSkillListItem[]): BatchSkillToolTarget[] {
  return items.map((item) => ({
    kind: item.kind,
    id: item.kind === "skill" ? (item.skill?.instance_id ?? item.id) : item.id,
  }));
}

function getAffectedSkillCount(items: UnifiedSkillListItem[], skills: Skill[]): number {
  const affectedSkillIds = new Set<string>();

  items.forEach((item) => {
    if (item.kind === "skill") {
      affectedSkillIds.add(item.skill?.instance_id ?? item.id);
      return;
    }

    if (item.skillPackage) {
      getGroupMemberSkills(item.skillPackage, skills).forEach((skill) => affectedSkillIds.add(skill.instance_id));
    }
  });

  return affectedSkillIds.size;
}

export function summarizeBatchSelection(
  items: UnifiedSkillListItem[],
  skills: Skill[] = [],
): BatchSelectionSummary {
  const skillCount = items.filter((item) => item.kind === "skill").length;
  const groupCount = items.length - skillCount;

  return {
    totalCount: items.length,
    skillCount,
    groupCount,
    affectedSkillCount: getAffectedSkillCount(items, skills),
  };
}

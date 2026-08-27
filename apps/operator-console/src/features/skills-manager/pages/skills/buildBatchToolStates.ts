import type { Skill, Tool } from "../../types";
import { getGroupMemberSkills, type UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";

export type BatchToolCoverageState = "none" | "partial" | "all";

export interface BatchToolStateSummary {
  toolId: string;
  selectedCount: number;
  enabledCount: number;
  state: BatchToolCoverageState;
}

export function isBatchToolChecked(summary: BatchToolStateSummary | undefined): boolean {
  return Boolean(summary && summary.state !== "none");
}

export function getNextBatchToolEnabledState(summary: BatchToolStateSummary | undefined): boolean {
  return summary?.state !== "all";
}

export function buildBatchToolStateSummaries(
  items: UnifiedSkillListItem[],
  skills: Skill[],
  tools: Tool[],
): Record<string, BatchToolStateSummary> {
  const expandedSelections = items.flatMap((item) => {
    if (item.kind === "skill" && item.skill) {
      return [item.skill];
    }

    if (item.kind === "group" && item.skillPackage) {
      return getGroupMemberSkills(item.skillPackage, skills);
    }

    return [];
  });

  const uniqueSkills = new Map(expandedSelections.map((skill) => [skill.instance_id, skill]));

  return Object.fromEntries(
    tools.map((tool) => {
      const selectedCount = uniqueSkills.size;
      const enabledCount = [...uniqueSkills.values()].filter((skill) => Boolean(skill.enabled[tool.id])).length;
      const state: BatchToolCoverageState = selectedCount === 0
        ? "none"
        : enabledCount === 0
          ? "none"
          : enabledCount === selectedCount
            ? "all"
            : "partial";

      return [tool.id, {
        toolId: tool.id,
        selectedCount,
        enabledCount,
        state,
      }];
    }),
  );
}

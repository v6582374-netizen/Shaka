import type { Skill, SkillLinkStatus as SkillLinkStatusValue } from "../../types/index.ts";

export type SkillLinkStatus = SkillLinkStatusValue;
export type SkillLinkStatusTone = "success" | "warning" | "error" | "muted";
export type SkillLinkStatusLabelKey =
  | "skills.inventoryLinked"
  | "skills.inventoryBroken"
  | "skills.inventoryConflict"
  | "skills.inventoryPresentUnmanaged"
  | "skills.inventoryUnlinked";

export interface SkillLinkStatusSummary {
  linkedCount: number;
  unmanagedCount: number;
  attentionCount: number;
  totalCount: number;
}

export function getSkillLinkStatus(skill: Skill, toolId: string): SkillLinkStatus {
  return skill.link_status?.[toolId] ?? (skill.enabled[toolId] ? "linked" : "missing");
}

export function getSkillLinkStatusTone(status: SkillLinkStatus): SkillLinkStatusTone {
  switch (status) {
    case "linked":
      return "success";
    case "unmanaged":
      return "warning";
    case "broken":
    case "wrong_target":
      return "error";
    case "missing":
      return "muted";
  }
}

export function getSkillLinkStatusLabelKey(status: SkillLinkStatus): SkillLinkStatusLabelKey {
  switch (status) {
    case "linked":
      return "skills.inventoryLinked";
    case "broken":
      return "skills.inventoryBroken";
    case "wrong_target":
      return "skills.inventoryConflict";
    case "unmanaged":
      return "skills.inventoryPresentUnmanaged";
    case "missing":
      return "skills.inventoryUnlinked";
  }
}

export function getSkillLinkStatusSummary(skill: Skill, toolIds: string[]): SkillLinkStatusSummary {
  let linkedCount = 0;
  let unmanagedCount = 0;
  let attentionCount = 0;

  for (const toolId of toolIds) {
    const status = getSkillLinkStatus(skill, toolId);
    if (status === "linked") {
      linkedCount += 1;
    } else if (status === "unmanaged") {
      unmanagedCount += 1;
      attentionCount += 1;
    } else if (status === "broken" || status === "wrong_target") {
      attentionCount += 1;
    }
  }

  return {
    linkedCount,
    unmanagedCount,
    attentionCount,
    totalCount: toolIds.length,
  };
}

export function getSkillLinkStatusAttentionToolIds(skill: Skill, toolIds: string[]): string[] {
  return toolIds.filter((toolId) => {
    const status = getSkillLinkStatus(skill, toolId);
    return status !== "linked" && status !== "missing";
  });
}

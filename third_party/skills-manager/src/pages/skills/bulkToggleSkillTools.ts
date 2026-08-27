import type { Tool } from "../../types";
import { isActionableTool } from "./getActionableToolIds.ts";

export type SkillBulkToggleMode = "enable" | "disable";
export type SkillBulkToggleConfirmKey = "skills.bulkConfirmEnable" | "skills.bulkConfirmDisable";

type SkillEnabledMap = Record<string, boolean | undefined>;

type ToolLike = Pick<Tool, "id" | "detected" | "config">;

function buildToolsById(tools: ToolLike[]): Map<string, ToolLike> {
  return new Map(tools.map((tool) => [tool.id, tool]));
}

function getVisibleActionableToolIds(visibleToolIds: string[], tools: ToolLike[]): string[] {
  const toolsById = buildToolsById(tools);
  return visibleToolIds.filter((toolId) => isActionableTool(toolsById.get(toolId)));
}

export function getSkillBulkToggleMode(
  visibleToolIds: string[],
  skillEnabled: SkillEnabledMap,
  tools: ToolLike[],
): SkillBulkToggleMode {
  const actionableToolIds = getVisibleActionableToolIds(visibleToolIds, tools);

  if (actionableToolIds.length === 0) {
    return "enable";
  }

  const allEnabled = actionableToolIds.every((toolId) => Boolean(skillEnabled[toolId]));
  return allEnabled ? "disable" : "enable";
}

export function getSkillBulkToggleTargets(
  visibleToolIds: string[],
  skillEnabled: SkillEnabledMap,
  tools: ToolLike[],
  mode: SkillBulkToggleMode,
): string[] {
  const actionableToolIds = getVisibleActionableToolIds(visibleToolIds, tools);

  if (mode === "enable") {
    return actionableToolIds.filter((toolId) => !Boolean(skillEnabled[toolId]));
  }

  return actionableToolIds.filter((toolId) => Boolean(skillEnabled[toolId]));
}

export function getSkillBulkToggleConfirmKey(mode: SkillBulkToggleMode): SkillBulkToggleConfirmKey {
  return mode === "enable" ? "skills.bulkConfirmEnable" : "skills.bulkConfirmDisable";
}

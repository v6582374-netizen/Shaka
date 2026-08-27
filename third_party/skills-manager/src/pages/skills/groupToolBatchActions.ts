import type { BatchSetSkillToolsRequest, Tool } from "../../types";
import { getSkillBulkToggleMode, getSkillBulkToggleTargets } from "./bulkToggleSkillTools.ts";
import { getGroupBulkModeState, type UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";

export interface GroupBulkToolActionPlan {
  bulkMode: "enable" | "disable";
  request: BatchSetSkillToolsRequest;
  targetToolIds: string[];
}

export function buildGroupSingleToolActionRequest(
  groupItem: UnifiedSkillListItem,
  toolId: string,
  enabled: boolean,
): BatchSetSkillToolsRequest | null {
  if (groupItem.kind !== "group" || !groupItem.skillPackage) {
    return null;
  }

  return {
    targets: [{ kind: "group", id: groupItem.id }],
    tool_ids: [toolId],
    action: enabled ? "enable" : "disable",
  };
}

export function buildGroupBulkToolActionPlan(
  groupItem: UnifiedSkillListItem,
  visibleToolIds: string[],
  tools: Tool[],
): GroupBulkToolActionPlan | null {
  if (groupItem.kind !== "group" || !groupItem.skillPackage || !groupItem.groupToolStateById) {
    return null;
  }

  const groupBulkModeState = getGroupBulkModeState(groupItem.groupToolStateById);
  const bulkMode = getSkillBulkToggleMode(visibleToolIds, groupBulkModeState, tools);
  const targetToolIds = getSkillBulkToggleTargets(visibleToolIds, groupBulkModeState, tools, bulkMode);
  if (targetToolIds.length === 0) {
    return null;
  }

  return {
    bulkMode,
    targetToolIds,
    request: {
      targets: [{ kind: "group", id: groupItem.id }],
      tool_ids: targetToolIds,
      action: bulkMode,
    },
  };
}

import type { Tool } from "../../types";

export type BulkToggleMode = "enable" | "disable";
export type BulkToggleConfirmKey = "tools.bulkConfirmEnable" | "tools.bulkConfirmDisable";

function isActionableInBulk(tool: Tool): boolean {
  return tool.detected || tool.config.enabled;
}

export function getNextBulkToggleMode(tools: Tool[]): BulkToggleMode {
  const actionableTools = tools.filter(isActionableInBulk);

  if (actionableTools.length === 0) {
    return "enable";
  }

  const allEnabled = actionableTools.every((tool) => tool.config.enabled);
  return allEnabled ? "disable" : "enable";
}

export function getBulkToggleTargets(tools: Tool[], mode: BulkToggleMode): Tool[] {
  if (mode === "enable") {
    return tools.filter((tool) => tool.detected && !tool.config.enabled);
  }

  return tools.filter((tool) => tool.config.enabled);
}

export function getBulkToggleConfirmKey(mode: BulkToggleMode): BulkToggleConfirmKey {
  return mode === "enable" ? "tools.bulkConfirmEnable" : "tools.bulkConfirmDisable";
}

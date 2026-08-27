import type { Tool } from "../../types";

export function isActionableTool(tool: Pick<Tool, "detected" | "config"> | undefined): boolean {
  return Boolean(tool?.detected && tool.config.enabled);
}

export function getActionableToolIds(tools: Array<Pick<Tool, "id" | "detected" | "config">>): string[] {
  return tools.filter((tool) => isActionableTool(tool)).map((tool) => tool.id);
}

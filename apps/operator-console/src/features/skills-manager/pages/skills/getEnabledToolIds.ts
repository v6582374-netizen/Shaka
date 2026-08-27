import type { Tool } from "../../types/index.ts";

type ToolLike = Pick<Tool, "id" | "config">;

export function getEnabledToolIds(tools: ToolLike[]): string[] {
  return tools
    .filter((tool) => tool.config.enabled)
    .map((tool) => tool.id)
    .sort();
}

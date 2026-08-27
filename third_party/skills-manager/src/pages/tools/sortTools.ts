import type { Tool } from "../../types";

export function sortToolsByEnabled(tools: Tool[]): Tool[] {
  return tools
    .map((tool, index) => ({ tool, index }))
    .sort((a, b) => {
      const enabledDiff = Number(b.tool.config.enabled) - Number(a.tool.config.enabled);
      if (enabledDiff !== 0) {
        return enabledDiff;
      }

      // Keep existing order when enabled state is the same.
      return a.index - b.index;
    })
    .map(({ tool }) => tool);
}

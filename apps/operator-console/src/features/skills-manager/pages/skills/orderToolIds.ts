export function orderToolIdsForSkill(
  baseToolIds: string[],
  enabledByTool: Record<string, boolean | undefined>,
): string[] {
  return baseToolIds
    .map((toolId, index) => ({ toolId, index }))
    .sort((a, b) => {
      const enabledDiff = Number(Boolean(enabledByTool[b.toolId])) - Number(Boolean(enabledByTool[a.toolId]));
      if (enabledDiff !== 0) {
        return enabledDiff;
      }

      // Keep base order for tool ids with the same enabled state.
      return a.index - b.index;
    })
    .map(({ toolId }) => toolId);
}

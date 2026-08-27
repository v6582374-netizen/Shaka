export type ToolSelectionState = "none" | "all" | "partial";

export interface EnabledToolsSummary {
  state: ToolSelectionState;
  enabledCount: number;
  totalCount: number;
  visibleEnabledToolIds: string[];
  remainingCount: number;
}

export function summarizeEnabledTools(
  orderedToolIds: string[],
  enabledByTool: Record<string, boolean | undefined>,
  maxVisible: number,
): EnabledToolsSummary {
  const enabledToolIds = orderedToolIds.filter((toolId) => Boolean(enabledByTool[toolId]));
  const enabledCount = enabledToolIds.length;
  const totalCount = orderedToolIds.length;

  if (enabledCount === 0) {
    return {
      state: "none",
      enabledCount,
      totalCount,
      visibleEnabledToolIds: [],
      remainingCount: 0,
    };
  }

  if (totalCount > 0 && enabledCount === totalCount) {
    return {
      state: "all",
      enabledCount,
      totalCount,
      visibleEnabledToolIds: [],
      remainingCount: 0,
    };
  }

  const visibleEnabledToolIds = enabledToolIds.slice(0, Math.max(0, maxVisible));
  const remainingCount = Math.max(0, enabledCount - visibleEnabledToolIds.length);

  return {
    state: "partial",
    enabledCount,
    totalCount,
    visibleEnabledToolIds,
    remainingCount,
  };
}

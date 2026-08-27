export function orderSkillIdsForTool(
  baseOrder: string[],
  enabled: Record<string, boolean | undefined>,
): string[] {
  const enabledIds = baseOrder.filter((id) => enabled[id]);
  const disabledIds = baseOrder.filter((id) => !enabled[id]);
  return [...enabledIds, ...disabledIds];
}

export type ToolBulkToggleMode = "enable" | "disable";
export type ToolBulkToggleConfirmKey =
  | "tools.bulkConfirmEnableSkills"
  | "tools.bulkConfirmDisableSkills";

type SkillEnabledMap = Record<string, boolean | undefined>;

export function getToolBulkToggleMode(
  visibleSkillIds: string[],
  enabled: SkillEnabledMap,
): ToolBulkToggleMode {
  return visibleSkillIds.some((id) => !enabled[id]) ? "enable" : "disable";
}

export function getToolBulkToggleTargets(
  visibleSkillIds: string[],
  enabled: SkillEnabledMap,
  mode: ToolBulkToggleMode,
): string[] {
  return visibleSkillIds.filter((id) => (mode === "enable" ? !enabled[id] : enabled[id]));
}

export function getToolBulkToggleConfirmKey(mode: ToolBulkToggleMode): ToolBulkToggleConfirmKey {
  return mode === "enable" ? "tools.bulkConfirmEnableSkills" : "tools.bulkConfirmDisableSkills";
}

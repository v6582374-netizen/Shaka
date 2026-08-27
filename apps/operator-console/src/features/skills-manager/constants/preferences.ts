import { UserPreferences } from "@skills-manager/types";

export const defaultPreferences: UserPreferences = {
  auto_sync: true,
  sync_on_save: true,
  default_editor: "system",
  tab_size: 2,
  show_sync_notifications: true,
  remove_links_when_disabling_tool: false,
  skill_usage_monitor: true,
  risk_scan_mode: "off",
};

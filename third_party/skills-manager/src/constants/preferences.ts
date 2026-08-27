import { UserPreferences } from "@/types";

export const defaultPreferences: UserPreferences = {
  theme: "system",
  font_family: "default",
  language: "en",
  auto_sync: true,
  sync_on_save: true,
  cloud_sync_auto: true,
  cloud_sync_interval_minutes: 10,
  default_editor: "system",
  tab_size: 2,
  show_sync_notifications: true,
  remove_links_when_disabling_tool: false,
  vault_backup_consent: "unknown",
  telemetry_consent: "unknown",
  skill_usage_monitor: true,
  risk_scan_mode: "off",
  github_token: "",
};

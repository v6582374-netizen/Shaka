// TypeScript type definitions matching Rust backend models
// Note: Field names use snake_case to match Rust serde serialization

export type SkillScope = "global" | "project";
export type SkillLinkStatus = "linked" | "broken" | "wrong_target" | "unmanaged" | "missing";
export type SkillSource = "local" | "imported" | "marketplace" | "vault" | (string & {});

export interface Skill {
  id: string;
  instance_id: string;
  scope: SkillScope;
  project_id?: string | null;
  project_name?: string | null;
  name: string;
  description: string | null;
  version: string;
  source: SkillSource;
  enabled: Record<string, boolean>;
  link_status?: Record<string, SkillLinkStatus>;
  /** Capabilities reported by the inventory source. External bodies are read-only. */
  read_only?: boolean;
  can_edit?: boolean;
  can_delete?: boolean;
  toggle_allowed?: Record<string, boolean>;
  source_tool_id?: string | null;
  package_meta?: SkillPackageMeta | null;
  path: string;
}

export interface ProjectBinding {
  id: string;
  name: string;
  skills_dir: string;
}

export interface SkillPackageMeta {
  package_id: string;
  package_name?: string | null;
  package_member_id: string;
  package_version?: string | null;
}

export interface InstalledSkillPackage {
  package_id: string;
  name: string;
  version: string;
  installed_members: string[];
  selected_members: string[];
  path?: string | null;
  manifest_hash?: string | null;
  installed_at: number;
  updated_at: number;
}

export interface SkillMetadata {
  tags: string[];
  favorited_at?: number | null;
}

export type SkillMetadataMap = Record<string, SkillMetadata>;

export interface ToolConfig {
  enabled: boolean;
  detected: boolean;
  skills_path: string;
  config_path: string;
}

export interface Tool {
  id: string;
  name: string;
  detected: boolean;
  cli_available: boolean;
  config: ToolConfig;
  source: "builtin" | "custom";
  icon_path?: string | null;
}

// Risk scan
export type RiskScanMode = "off" | "basic" | "deep";
export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";
export type RiskCategory = "destructive" | "network" | "privilege" | "payload";

export interface RiskLocation {
  file: string;
  line: number;
}

export interface RiskFinding {
  rule_id: string;
  category: RiskCategory;
  level: RiskLevel;
  confidence: number;
  message: string;
  evidence: string;
  location: RiskLocation;
  source: "rule" | "llm";
}

export interface SkillRiskReport {
  instance_id: string;
  level: RiskLevel;
  findings: RiskFinding[];
  scanned_at: number;
  scanner_version: string;
  mode: RiskScanMode;
  llm_reviewed: boolean;
}

// User preferences for the application
export interface UserPreferences {
  // Sync behavior
  auto_sync: boolean;
  sync_on_save: boolean;

  // Editor settings
  default_editor: string;
  tab_size: 2 | 4;

  // Notifications
  show_sync_notifications: boolean;
  remove_links_when_disabling_tool: boolean;
  skill_usage_monitor: boolean;
  risk_scan_mode: RiskScanMode;
}

export interface SkillUsageStats {
  total: number;
  by_tool: Record<string, number>;
  last_called_at: number | null;
}

export interface AppConfig {
  version: string;
  skills_dir: string;
  tools: Record<string, ToolConfig>;
  custom_tools?: Record<string, CustomToolConfig>;
  skill_metadata?: SkillMetadataMap;
  preferences?: UserPreferences;
  projects?: ProjectBinding[];
  active_project_id?: string | null;
  llm_provider?: LlmProvider | null;
}

export interface LlmProvider {
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number | null;
  max_tokens?: number | null;
  timeout_secs?: number | null;
}

export interface CustomToolConfig {
  name: string;
  config_path: string;
  skills_path: string;
  enabled: boolean;
  icon_path?: string | null;
}

export interface SyncReport {
  issues_count: number;
}

export interface LinkResult {
  skill_id: string;
  tool_id: string;
  message: string | null;
}

export interface LinkReport {
  success: LinkResult[];
  failed: LinkResult[];
}

export type BatchSkillToolTargetKind = "skill" | "group";
export type BatchSkillToolAction = "enable" | "disable";

export interface BatchSkillToolTarget {
  kind: BatchSkillToolTargetKind;
  id: string;
}

export interface BatchSetSkillToolsRequest {
  targets: BatchSkillToolTarget[];
  tool_ids: string[];
  action: BatchSkillToolAction;
}

export interface BatchSetSkillToolsFailure {
  target_kind: BatchSkillToolTargetKind;
  target_id: string;
  skill_id?: string | null;
  tool_id?: string | null;
  message: string;
}

export interface BatchSetSkillToolsResponse {
  requested_target_count: number;
  requested_tool_count: number;
  resolved_skill_count: number;
  attempted_operation_count: number;
  applied_count: number;
  skipped_count: number;
  failed_count: number;
  failures: BatchSetSkillToolsFailure[];
}

// Detected editor from backend
export interface DetectedEditor {
  id: string;
  name: string;
  command: string;
  available: boolean;
  icon: string;
  icon_data?: string;  // Base64 encoded PNG from app bundle
}

// File tree node
export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export interface PollOption {
  id: string;
  label: string;
}

export interface PollOptionResult extends PollOption {
  votes: number;
}

export interface Poll {
  id: string;
  title: string;
  locale: string;
  defaultLocale: string;
  isActive: boolean;
  options: PollOption[];
  createdAt: number;
}

export interface PollResult {
  id: string;
  title: string;
  locale: string;
  defaultLocale: string;
  isActive: boolean;
  options: PollOptionResult[];
  totalVotes: number;
  createdAt: number;
}

export interface PollVoteRequest {
  voterId: string;
  optionId: string;
}

export interface PollVote {
  id: string;
  pollId: string;
  voterId: string;
  optionId: string;
  createdAt: number;
}

export interface PollClientState {
  voterId: string | null;
  votedOptions: Record<string, string>;
}

// Skill import/export (cross-device sync)
export interface ExportedSkillMeta {
  id: string;
  name: string;
  description: string | null;
  version: string;
  folder: string;
  enabled_tools: string[];
  tags: string[];
  favorited_at: number | null;
}

export interface ExportManifest {
  format_version: number;
  exported_at: number;
  app_version: string;
  skills: ExportedSkillMeta[];
}

export interface ImportConflict {
  skill_id: string;
  skill_name: string;
  local_path: string;
}

export interface ImportPreview {
  manifest: ExportManifest;
  conflicts: ImportConflict[];
}

export type ConflictStrategy = "skip" | "overwrite" | "rename";

export interface ImportResolution {
  skill_id: string;
  strategy: ConflictStrategy;
}

export interface ImportedSkillRecord {
  original_id: string;
  final_id: string;
  name: string;
}

export interface RenamedSkillRecord {
  original_id: string;
  new_id: string;
  name: string;
}

export interface ImportFailure {
  skill_id: string;
  message: string;
}

export interface ImportResult {
  imported: ImportedSkillRecord[];
  skipped: string[];
  overwritten: string[];
  renamed: RenamedSkillRecord[];
  failed: ImportFailure[];
}

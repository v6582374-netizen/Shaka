// TypeScript type definitions matching Rust backend models
// Note: Field names use snake_case to match Rust serde serialization

export type SkillScope = "global" | "project";

export interface SkillMarketplaceMeta {
  marketplace_source_id?: string | null;
  marketplace_skill_id?: string | null;
  marketplace_skill_slug?: string | null;
  repo_url?: string | null;
  skill_path?: string | null;
  remote_revision?: string | null;
}

export interface Skill {
  id: string;
  instance_id: string;
  scope: SkillScope;
  project_id?: string | null;
  project_name?: string | null;
  name: string;
  description: string | null;
  version: string;
  source: "local" | "imported" | "marketplace" | "vault";
  enabled: Record<string, boolean>;
  package_meta?: SkillPackageMeta | null;
  marketplace_meta?: SkillMarketplaceMeta | null;
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

export interface MarketplaceFavoriteMeta {
  favorited_at: number;
  name: string;
  description?: string | null;
  source_id: string;
  source_name: string;
  repo_url?: string | null;
  skill_path?: string | null;
  external_url?: string | null;
  install_count?: number | null;
  tags: string[];
  clawhub_slug?: string | null;
  clawhub_owner?: string | null;
  clawhub_version?: string | null;
}

export type MarketplaceFavoriteMap = Record<string, MarketplaceFavoriteMeta>;

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

export type VaultBackupConsent = "unknown" | "granted" | "denied";
export type TelemetryConsent = "unknown" | "granted" | "denied";

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
  // Appearance
  theme: "light" | "dark" | "system";
  font_family: "default" | "serif";
  language: "zh" | "en";

  // Sync behavior
  auto_sync: boolean;
  sync_on_save: boolean;
  cloud_sync_auto: boolean;
  cloud_sync_interval_minutes: number;

  // Editor settings
  default_editor: string;
  tab_size: 2 | 4;

  // Notifications
  show_sync_notifications: boolean;
  remove_links_when_disabling_tool: boolean;
  vault_backup_consent: VaultBackupConsent;
  telemetry_consent: TelemetryConsent;
  skill_usage_monitor: boolean;
  risk_scan_mode: RiskScanMode;

  // Marketplace auth
  github_token?: string | null;
}

export interface SkillUsageStats {
  total: number;
  by_tool: Record<string, number>;
  last_called_at: number | null;
}

export interface AuthProfile {
  username: string;
  avatar_url?: string | null;
}

export interface AuthSession {
  provider: string;
  access_token?: string | null;
  refresh_token?: string | null;
  profile: AuthProfile;
}

export interface AuthStartResult {
  auth_url: string;
  state: string;
}

export interface AuthMeResponse {
  user_id: string;
  provider?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
}

export interface CloudSyncState {
  device_id: string;
  last_revision: number;
  last_synced_at?: number | null;
  last_payload_hash?: string | null;
}

export interface CloudSyncSkill {
  id: string;
  instance_id?: string | null;
  scope?: SkillScope | null;
  project_id?: string | null;
  project_name?: string | null;
  name: string;
  source: "local" | "imported" | "marketplace" | "vault";
  version: string;
  marketplace?: CloudSyncMarketplaceMeta | null;
  vault?: CloudSyncVaultMeta | null;
}

export interface CloudSyncMarketplaceMeta {
  marketplace_source_id?: string | null;
  marketplace_skill_id?: string | null;
  marketplace_skill_slug?: string | null;
  repo_url?: string | null;
  skill_path?: string | null;
  remote_revision?: string | null;
}

export interface CloudSyncVaultMeta {
  provider?: string | null;
  user_id?: string | null;
  skill_id?: string | null;
  version?: string | null;
  hash?: string | null;
  size?: number | null;
  updated_at?: number | null;
}

export interface CloudSyncToolState {
  enabled: boolean;
  enabled_skills: string[];
}

export interface CloudSyncCustomTool {
  id: string;
  name: string;
  config_path: string;
  skills_path: string;
  enabled: boolean;
}

export interface CloudSyncPayload {
  version: number;
  updated_at: number;
  device_id: string;
  skills: CloudSyncSkill[];
  tool_states: Record<string, CloudSyncToolState>;
  custom_tools: CloudSyncCustomTool[];
  preferences?: UserPreferences | null;
}

export interface CloudSyncSnapshot {
  revision: number;
  payload: CloudSyncPayload | null;
}

export interface VaultBackupResult {
  uploaded: number;
  skipped: number;
  failed: string[];
}

export type CloudSyncPushResult =
  | { status: "synced"; revision: number }
  | { status: "skipped"; reason: string }
  | {
      status: "conflict";
      revision: number;
      payload: CloudSyncPayload;
      local_payload: CloudSyncPayload;
    };

export interface AppConfig {
  version: string;
  skills_dir: string;
  tools: Record<string, ToolConfig>;
  custom_tools?: Record<string, CustomToolConfig>;
  skill_metadata?: SkillMetadataMap;
  marketplace_favorites?: MarketplaceFavoriteMap;
  preferences?: UserPreferences;
  marketplace_sources?: MarketplaceSource[];
  poll_client_state?: PollClientStateConfig | null;
  auth_session?: AuthSession | null;
  cloud_sync?: CloudSyncState | null;
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

export interface PollClientStateConfig {
  voter_id?: string | null;
  voted_options?: Record<string, string>;
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

export interface MarketplaceSource {
  id: string;
  name: string;
  url: string;
  source_type: "github_repo" | "api" | "crawler" | "manual" | "unknown" | "clawhub_api";
  enabled: boolean;
  builtin: boolean;
  api_key?: string | null;
}

export interface MarketplaceSkill {
  id: string;
  slug?: string | null;
  name: string;
  description: string | null;
  author: string | null;
  source_id: string;
  source_name: string;
  install_count?: number | null;
  install_url?: string | null;
  created_at?: number | null;
  repo_url: string | null;
  skill_path: string | null;
  external_url: string | null;
  remote_revision?: string | null;
  tags: string[];
  install_status: "not_installed" | "installed" | "update_available";
  clawhub_slug?: string | null;
  clawhub_owner?: string | null;
  clawhub_version?: string | null;
}

export interface MarketplaceSkillsResponse {
  skills: MarketplaceSkill[];
  has_more: boolean;
}

export interface SkillFileNode {
  name: string;
  path: string;
  is_dir: boolean;
  download_url: string | null;
  sha?: string | null;
  children?: SkillFileNode[];
}

/** fetch_clawhub_skill_files 返回结构：文件树 + 解析出的 owner/version */
export interface ClawhubSkillFilesResponse {
  tree: SkillFileNode;
  resolved_owner?: string | null;
  resolved_version?: string | null;
}

export interface InstallResult {
  success: boolean;
  skill_id: string;
  message: string | null;
  installed_path: string | null;
}

export interface MarketplaceSyncResult {
  checked: number;
  updated: number;
  failed: string[];
}

export interface MarketplaceUpdateCheckResult {
  performed: boolean;
  checked: number;
  update_available: number;
}

export interface UpdateInfo {
  has_update: boolean;
  latest_version: string;
  download_url: string;
  release_notes?: string;
}

export type FeedbackContactType =
  | "wechat"
  | "email"
  | "other";

export interface FeedbackRequest {
  contact_type: FeedbackContactType;
  contact_value: string;
  content: string;
  source?: string | null;
  language?: string | null;
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

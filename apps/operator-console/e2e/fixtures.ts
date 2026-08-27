import { test as base, expect, type Page } from "@playwright/test";

// The app-wide /ws/events socket each page opened (UX-026 toast et al.) — specs
// push server events through it via sendAppEvent below.
const eventSockets = new WeakMap<Page, { send: (data: string) => void }>();

/** Push an app-wide event exactly as the server would over /ws/events. Waits for
 * the GUI to have connected its socket first. */
export async function sendAppEvent(page: Page, obj: unknown): Promise<void> {
  for (let i = 0; i < 50 && !eventSockets.get(page); i++) await page.waitForTimeout(100);
  const ws = eventSockets.get(page);
  if (!ws) throw new Error("the app never opened /ws/events");
  ws.send(JSON.stringify(obj));
}

// Hermetic API mock. Every /v1 request the GUI makes is fulfilled from the fixtures below (shapes
// mirrored from the real backend), and the event WebSocket is a SCRIPTED FAKE AGENT (ready on
// connect; user_message → turn_start/deltas/assistant_message/turn_done; "run a tool" triggers the
// approval flow), so specs run with no Python server and never touch real state. Mutations
// (sessions, personas, inbox, routing, channel subscriptions) are held in per-test in-memory state
// so add/remove/toggle reflect through the real UI on re-fetch.

const HEALTH = { status: "ok", default_workspace: null, model: "anthropic:claude-opus-4-8" };

const DISCOVERY = {
  module: "discovery",
  schema_version: 1,
  contexts: [
    { id: "preparation", label: "Preparation", description: "Gather and review research inputs before a launch." },
    { id: "launch", label: "Current Launch", description: "Observe the active Discovery launch." },
    { id: "history", label: "History", description: "Review completed and interrupted Discovery launches." },
  ],
  active_context: "preparation",
  preparation: {
    status: "empty",
    dirty: false,
    draft: { text: "", sources: [] },
    saved: { text: "", sources: [] },
    revisions: [],
    conversion: {
      status: "pending",
      model_id: null,
      error: null,
      saved_revision_id: null,
      base_fingerprint: null,
      current_fingerprint: "fixture-empty",
    },
  },
  current_launch: null,
  history: [],
};
const DISCOVERY_SOURCE_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx", ".csv", ".zip"]);

const SETTINGS = {
  provider: "openai",
  model: "anthropic:claude-opus-4-8",
  models: ["anthropic:claude-opus-4-8", "gpt-5.5", "gpt-4o", "gpt-4o-mini", "o3-mini"],
  has_key: true,
  model_ready: true,
  source: "store",
  onboarded: true,
  experimental_connectors: false,
  surfaces: { cowork: true, chat: false, code: true },
  nav_layout: "grouped",
  scratch_base: "~/OpenWorker",
  secrets_path: "/Users/test/.config/coworker/secrets.json",
  sessions_peek: 5,
  // Token savings (PDF attachments): 2-page limit keeps the composer threshold test's
  // fixture PDF small; the real default is 20.
  pdf_fallback: "text",
  pdf_max_pages: 2,
  pdf_max_mb: 10,
  // Curated-matrix display names (subset — mirrors /v1/settings.model_labels).
  model_labels: {
    "anthropic:claude-opus-4-8": "Claude Opus 4.8 · Anthropic",
    "zai:glm-5.2": "GLM-5.2 · Z AI",
  },
};

const PERSONAS = {
  personas: [
    { id: "cowork", name: "OpenWorker", icon: "cowork", tagline: "Produce a deliverable — research, analysis, scripts", needs_workspace: true, builtin: true, family: "knowledge", workspace: "deliverable", tools: ["files", "search"], enabled: true, surfaced: true, default: true },
    { id: "code", name: "Code", icon: "code", tagline: "Work in a codebase — files, git, shell", needs_workspace: true, builtin: true, family: "code", workspace: "git", tools: ["code_files", "git"], enabled: true, surfaced: true, default: false },
    { id: "chat", name: "Chat", icon: "chat", tagline: "Quick questions — no workspace", needs_workspace: false, builtin: true, family: "knowledge", workspace: "none", tools: [], enabled: true, surfaced: false, default: false },
    { id: "ops", name: "Ops Coworker", icon: "wrench", tagline: "Operate and investigate — runbooks, logs, infrastructure", needs_workspace: true, builtin: true, family: "knowledge", workspace: "deliverable", tools: ["files", "shell"], enabled: true, surfaced: true, default: false },
    // A non-builtin install (disabled pending consent — invisible to picker specs) so the
    // Personas page's delete/enable affordances have a target.
    { id: "acme-notes", name: "Acme Notes", icon: "pencil", tagline: "Acme's note-taking coworker", needs_workspace: true, builtin: false, family: "knowledge", workspace: "deliverable", tools: ["files"], enabled: false, surfaced: false, default: false },
  ],
};

// The boot-resume target (most recent updated_at) — existing specs open it by title.
const PINNED_SESSION = {
  session_id: "pinned-cowork-1",
  title: "Draft the launch note",
  workspace: "/Users/test/OpenWorker/launch-note",
  agent: "cowork",
  model: "anthropic:claude-opus-4-8",
  mode: "interactive",
  updated_at: "2026-07-01 09:00:00",
  messages: 2,
  pinned: true,
  archived: false,
  attention: 0,
  liveness: "idle",
  subscriptions: [],
};

// Seven unpinned Coworker sessions: enough to exercise the sidebar peek cap (5) + "Show more (2)".
// wp-3 carries the pending Inbox approval below (attention badge parity). All OLDER than the
// pinned session so boot-resume stays deterministic.
const EXTRA_SESSIONS = Array.from({ length: 7 }, (_, i) => ({
  session_id: `wp-${i + 1}`,
  title: `Weekly plan ${i + 1}`,
  workspace: "",
  agent: "cowork",
  model: "anthropic:claude-opus-4-8",
  mode: "interactive",
  updated_at: `2026-06-2${8 - Math.min(i, 7)} 10:00:00`,
  messages: 3,
  pinned: false,
  archived: false,
  attention: i + 1 === 3 ? 1 : 0,
  liveness: "idle",
  subscriptions: [],
}));

// One Ops session (older than everything above so boot-resume stays deterministic) — the
// target for the disable-archives-conversations confirm flow on the Personas page.
const OPS_SESSION = {
  session_id: "ops-1",
  title: "Ops triage",
  workspace: "/Users/test/OpenWorker/ops-triage",
  agent: "ops",
  model: "anthropic:claude-opus-4-8",
  mode: "interactive",
  updated_at: "2026-06-15 10:00:00",
  messages: 4,
  pinned: false,
  archived: false,
  attention: 0,
  liveness: "idle",
  subscriptions: [],
};

// §31: a mention-spawned session — lives in the sidebar's collapsed "From Slack" group, never
// in Recent. Older than everything else so boot-resume stays deterministic.
const SLACK_SESSION = {
  session_id: "slack-thread-1",
  title: "#general — check the deploy?",
  workspace: "",
  agent: "cowork",
  model: "anthropic:claude-opus-4-8",
  mode: "interactive",
  updated_at: "2026-06-10 10:00:00",
  messages: 2,
  pinned: false,
  archived: false,
  attention: 0,
  liveness: "idle",
  subscriptions: [],
  origin: "slack",
  origin_label: "#general · T0AB",
};

const CONNECTORS = {
  connectors: [
    { name: "browser", title: "Browser", icon: "B", blurb: "Headless browser.", auth: "none", two_way: false, channels: false, available: true, brand_color: "#6b7280", logo: "", fields: [], instructions: [], connected: true, account: null, enabled: true, allowed_users: [], tools: [] },
    { name: "telegram", title: "Telegram", icon: "T", blurb: "Two-way Telegram messaging.", auth: "bot_token", two_way: true, channels: true, available: true, brand_color: "#229ed9", logo: "telegram", fields: [{ key: "bot_token", label: "Bot token", secret: true, required: true, help: "", placeholder: "123456:ABC…" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // Multi-account connector: each manual token paste lands as its own account.
    // Carries pre-connect detail copy (§38): about + access + tools drive available-detail.spec.ts.
    { name: "gmail", title: "Gmail", icon: "✉", blurb: "Search, summarize, draft, and send email.", about: "Search, summarize, and send over your Gmail.", access: ["Reads and searches your mail.", "Sends email as you.", "Never deletes mail or changes account settings."], auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#ea4335", logo: "gmail", fields: [{ key: "access_token", label: "OAuth access token", secret: true, required: true, help: "", placeholder: "" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [{ name: "gmail_search", label: "Search mail", kind: "read", description: "Search messages.", enabled: true, requires_approval: false }, { name: "gmail_send", label: "Send email", kind: "write", description: "Send a message.", enabled: true, requires_approval: true }] },
    { name: "google_calendar", title: "Google Calendar", icon: "◷", blurb: "Read availability, summarize schedules, and create events.", auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#4285f4", logo: "google_calendar", fields: [{ key: "access_token", label: "OAuth access token", secret: true, required: true, help: "", placeholder: "" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // Two-mode connector: one-click with access radios (read | write) OR a private-app token.
    { name: "hubspot", title: "HubSpot", icon: "⊚", blurb: "Search CRM records; log notes and tasks, update records. No deletes.", auth: "token", two_way: false, channels: false, available: true, brand_color: "#ff7a59", logo: "hubspot", fields: [{ key: "token", label: "Private app token", secret: true, required: true, help: "", placeholder: "pat-…" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // Generic multi-account connector (accounts.py layer): one-click OR integration token.
    { name: "notion", title: "Notion", icon: "◰", blurb: "Search pages, read content, query databases, create pages.", auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#1f2328", logo: "", fields: [{ key: "access_token", label: "Integration secret", secret: true, required: true, help: "", placeholder: "ntn_…" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // Email-keyed multi-account connector (outlook) — drives the onboarding tools list.
    { name: "outlook", title: "Outlook", icon: "◎", blurb: "Microsoft 365 mail and calendar: search, draft, and send email; manage events and respond to invites.", aliases: ["calendar", "email", "mail", "microsoft", "office"], auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#0078d4", logo: "outlook", fields: [{ key: "access_token", label: "OAuth access token", secret: true, required: true, help: "", placeholder: "" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // Sixth active row in the onboarding tools list (promoted 2026-07-19).
    { name: "attio", title: "Attio", icon: "▣", blurb: "Search and read Attio CRM records; log notes.", auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#2d6ae0", logo: "attio", fields: [{ key: "access_token", label: "OAuth access token", secret: true, required: true, help: "", placeholder: "" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
    // MCP-BACKED connectors (§42): vendor-hosted MCP + local OAuth, pinned tool subset.
    // monday is one-click ONLY (no manual fields); jira also has a manual token path
    // (two-mode modal): local MCP OAuth alongside manual fields.
    { name: "monday", title: "monday.com", icon: "▦", blurb: "Read boards and items, track work, create items and post updates.", aliases: ["project management", "tasks", "boards"], auth: "oauth", two_way: false, channels: false, available: true, brand_color: "#6161ff", logo: "monday", mcp: true, fields: [], instructions: ["One click connects via monday.com sign-in in your browser.", "Sign-in is fully local — tokens stay on this Mac."], connected: false, account: null, enabled: false, allowed_users: [], tools: [{ name: "mcp__monday__get_board_info", label: "Read board", kind: "read", description: "Read a board's columns and groups.", enabled: true, requires_approval: false }, { name: "mcp__monday__create_item", label: "Create item", kind: "write", description: "Create an item on a board.", enabled: true, requires_approval: true }] },
    { name: "jira", title: "Jira", icon: "◆", blurb: "Search, summarize, create, and update issues.", aliases: ["issues", "tickets", "atlassian"], auth: "api_token", two_way: false, channels: false, available: true, brand_color: "#0052cc", logo: "jira", mcp: true, fields: [{ key: "base_url", label: "Atlassian site URL", secret: false, required: true, help: "", placeholder: "" }, { key: "email", label: "Account email", secret: false, required: true, help: "", placeholder: "" }, { key: "api_token", label: "API token", secret: true, required: true, help: "", placeholder: "" }], instructions: [], connected: false, account: null, enabled: false, allowed_users: [], tools: [] },
  ],
};

// Two pending items across two personas: drives the Inbox kind tabs, the persona filter chips
// (which only render with >1 persona), and resolve-removes-card. The question's session is NOT in
// the sessions list on purpose — the Inbox must be self-contained (server-joined context fields).
const INBOX_ITEMS = [
  {
    id: "inb-approval-1",
    session_id: "wp-3",
    kind: "approval",
    title: "Approve: run_shell",
    body: "rm -rf build/",
    state: "pending",
    resolution: null,
    inbox: "default",
    created_at: "2026-07-01 08:00:00",
    resolved_at: null,
    session_title: "Weekly plan 3",
    session_agent: "cowork",
    session_workspace: "",
    session_exists: true,
  },
  {
    id: "inb-question-1",
    session_id: "ops-1",
    kind: "question",
    title: "Which environment should I restart?",
    body: "",
    options: ["staging", "production"],
    allow_text: true,
    multi: false,
    state: "pending",
    resolution: null,
    inbox: "default",
    created_at: "2026-07-01 08:05:00",
    resolved_at: null,
    session_title: "Investigate alerts",
    session_agent: "ops",
    session_workspace: "",
    session_exists: true,
  },
];



// Persona detail (GET /v1/personas/:id) — SourcesDrawer/PersonaView read `recommends` and
// `default_connections` as arrays, so these must be present (not the catch-all {}).
const PERSONA_DETAIL = {
  id: "cowork",
  name: "OpenWorker",
  icon: "cowork",
  tagline: "Produce a deliverable — research, analysis, scripts",
  description: "",
  enabled: true,
  tools: ["files", "search"],
  recommended_models: ["anthropic:claude-opus-4-8"],
  default_permission_mode: "interactive",
  workspace: "deliverable",
  recommends: [],
  default_connections: [],
};

const CONNECTIONS = {
  connected: [
    { connector: "browser", enabled: true, detail: "Browser" },
    { connector: "slack", enabled: true, detail: "Slack" },
    // two_way WITHOUT channels (relay mentions, no subscriptions) — pins the
    // "GitHub shows Channels" regression (owner report 2026-07-13).
    { connector: "github", enabled: true, detail: "GitHub" },
  ],
  recommended: [
    { connector: "gmail", reason: "email context for morning summaries", tier: "core", connected: false },
  ],
  attention: 1,
};

// One scheduled automation with a running run: its session id uses the real `__run__` convention
// so the session view's run banner (detection is id-based) can be exercised end-to-end.
const AUTOMATION = {
  id: "task-1",
  title: "Daily AI News",
  instructions: "Fetch the latest AI news and produce an HTML+Tailwind presentation.",
  schedule: "Every day at ~5:40 PM",
  schedule_raw: { kind: "cron", cron: "40 17 * * *", fire_at: null, timezone: "local" },
  workspace: "",
  agent: "cowork",
  enabled: true,
  next_run: Math.floor(Date.now() / 1000) + 3600,
  last_run: Math.floor(Date.now() / 1000) - 60,
  last_status: "running",
  run_count: 1,
  notify_on_completion: false,
  // One standing scoped approval (§25) so the detail page's revoke list has content.
  always_allowed: [
    { entry: "send_message slack:T1/C1", tool: "send_message", target: "slack:T1/C1" },
  ],
  // UX-023 sidebar badges: two unopened runs, the newest of them failed.
  unseen_runs: 2,
  unseen_failed: true,
  seen_runs_at: 0,
};
// A second, quiet automation so the Scheduled band shows badge-less rows too.
const AUTOMATION_CLEAN = {
  ...AUTOMATION,
  id: "task-2",
  title: "Weekly CRM digest",
  schedule: "Every Monday at ~9:00 AM",
  last_status: "ok",
  unseen_runs: 0,
  unseen_failed: false,
  always_allowed: [],
};
const AUTOMATION_RUNS = [
  {
    run_id: "r1",
    task_id: "task-1",
    session_id: "__run__r1",
    started_at: Math.floor(Date.now() / 1000) - 60,
    finished_at: null,
    status: "running",
    result_text: null,
    artifacts: [],
    error: null,
    trigger: "schedule",
  },
];

const PRIMARY_ROOT = { path: "/Users/test/OpenWorker/launch-note", writable: true, label: "scratch", primary: true, exists: true };
const baseName = (p: string) => p.split("/").filter(Boolean).pop() || p;

const PROVIDERS = [
  // openai: configured + used (drives the "Last used" sub-line and the status dot).
  { name: "openai", title: "OpenAI", needs_key: true, fields: [{ key: "api_key", label: "OpenAI API key", secret: true, required: true, help: "", placeholder: "sk-…" }], configured: true, values: {}, suggested_models: ["gpt-5.5"], key_set_at: "2026-06-12", last_used_at: Math.floor(Date.now() / 1000) - 7200 },
  // anthropic: configured but never used ("Not used yet").
  { name: "anthropic", title: "Claude (Anthropic)", needs_key: true, fields: [{ key: "api_key", label: "API key", secret: true, required: true, help: "", placeholder: "sk-…" }], configured: true, values: {}, suggested_models: ["claude-opus-4-8"], key_set_at: null, last_used_at: null },
  // zai: an OpenAI-compatible vendor — unconfigured, with a prefilled editable endpoint + blurb.
  { name: "zai", title: "Z AI (GLM)", needs_key: true, blurb: "Uses Z AI's OpenAI-compatible API — the endpoint is prefilled, just add your key.", fields: [{ key: "api_key", label: "Z AI API key", secret: true, required: true, help: "", placeholder: "" }, { key: "base_url", label: "Endpoint", secret: false, required: false, help: "Prefilled with Z AI's international endpoint.", placeholder: "https://api.z.ai/api/paas/v4", default: "https://api.z.ai/api/paas/v4" }], configured: false, values: {}, suggested_models: ["glm-5.2"], key_set_at: null, last_used_at: null },
  // ollama: keyless local provider — "configured" without proving anything runs; the
  // onboarding gallery shows "No key needed" and its form is endpoint + Detect (§39).
  { name: "ollama", title: "Ollama (local models)", needs_key: false, fields: [{ key: "base_url", label: "Endpoint", secret: false, required: false, help: "", placeholder: "http://127.0.0.1:11434", default: "http://127.0.0.1:11434" }], configured: true, values: {}, suggested_models: ["qwen3-coder:30b"], key_set_at: null, last_used_at: null },
  // relay: Responses-native text provider, intentionally last in the gallery.
  { name: "relay", title: "Relay", needs_key: true, blurb: "Uses Relay's Responses-native API. Add a key, then choose any text model it exposes.", fields: [{ key: "api_key", label: "Relay API key", secret: true, required: true, help: "", placeholder: "Paste your Relay key" }, { key: "base_url", label: "Endpoint", secret: false, required: false, help: "Responses-native Relay endpoint.", placeholder: "https://ai.cloudyz.top/v1", default: "https://ai.cloudyz.top/v1" }], configured: false, values: {}, suggested_models: ["gpt-5.6-sol"], key_set_at: null, last_used_at: null },
];

/** Install the API + WebSocket mocks on a page. Returns handles for assertions/seed data. */
export async function mockApi(page: import("@playwright/test").Page) {
  const discoveryConversionPrompt = {
    instruction: "Compile the saved Preparation into one structured Execution Input.",
    configured: true,
  };
  const discovery: any = {
    ...DISCOVERY,
    preparation: {
      status: "empty" as "empty" | "draft" | "saved",
      dirty: false,
      draft: { text: "", sources: [] as any[] },
      saved: { text: "", sources: [] as any[] },
      revisions: [] as any[],
      conversion: {
        status: "pending" as "pending" | "editing" | "saved" | "dirty" | "failed",
        model_id: null as string | null,
        error: null as string | null,
        saved_revision_id: null as string | null,
        base_fingerprint: null as string | null,
        current_fingerprint: "fixture-empty",
      },
    },
  };
  let nextDiscoverySourceId = 1;
  let nextDiscoveryRevisionId = 1;
  let nextDiscoveryLaunchId = 1;
  const discoveryLaunchesByKey = new Map<string, { fingerprint: string; result: any }>();
  const discoveryArtifactsByLaunch = new Map<string, { report: string; summary: string }>();

  const findDiscoveryLaunch = (launchId: string) =>
    discovery.current_launch?.launch_id === launchId
      ? discovery.current_launch
      : discovery.history.find((candidate: any) => candidate.launch_id === launchId) ?? null;

  const discoveryStatus = (launch: any) => {
    const completed = launch.state === "completed";
    const stopped = launch.state === "stopped";
    const interrupted = launch.state === "interrupted";
    const active = ["starting", "running", "stopping"].includes(launch.state);
    const timelineState = completed ? "completed" : stopped || interrupted ? "stopped" : "running";
    const milestones = [
      { id: "preparing", key: "preparing", label: "Prepare sources", position: 1, state: completed ? "completed" : "completed", summary: null, started_at: null, ended_at: null, attempts: [] },
      { id: "research", key: "research", label: "Run discovery", position: 2, state: completed ? "completed" : launch.stage === "research" ? "running" : "pending", summary: null, started_at: null, ended_at: null, attempts: [] },
      { id: "finalizing", key: "finalizing", label: "Finalize outputs", position: 3, state: completed ? "completed" : "pending", summary: null, started_at: null, ended_at: null, attempts: [] },
    ];
    return {
      launch,
      state: launch.state,
      stage: launch.stage,
      round: launch.round,
      checkpoint: launch.checkpoint ?? null,
      timeline: {
        revision: 1,
        percent: completed ? 100 : launch.state === "running" ? 33 : 0,
        current_milestone_id: completed ? null : launch.stage === "research" ? "research" : null,
        milestones,
      },
      activity: {
        oldest_sequence: 1,
        newest_sequence: 1,
        truncated_before_sequence: 0,
        items: [{ sequence: 1, occurred_at: "2026-08-01T00:00:00.000Z", level: "info", milestone_id: "research", text: "Fixture Discovery runner is observable." }],
      },
      allowed_actions: active ? ["stop"] : stopped || interrupted ? ["resume"] : [],
      produced_outputs: [...(discoveryArtifactsByLaunch.get(launch.launch_id) ? [{ path: "report.md", label: "report.md" }, { path: "summary.json", label: "summary.json" }] : [])],
      latest_event_sequence: 1,
      timelineState,
    };
  };

  const invalidateConversion = (status: "pending" | "dirty") => {
    discovery.preparation.conversion = {
      status,
      model_id: null,
      error: null,
      saved_revision_id: null,
      base_fingerprint: null,
      current_fingerprint: `fixture-${discovery.preparation.saved.text.length}-${discovery.preparation.saved.sources.length}`,
    };
  };

  const updateDiscoveryStatus = () => {
    const dirty =
      discovery.preparation.draft.text !== discovery.preparation.saved.text ||
      JSON.stringify(discovery.preparation.draft.sources) !==
        JSON.stringify(discovery.preparation.saved.sources);
    discovery.preparation.dirty = dirty;
    discovery.preparation.status = dirty
      ? "draft"
      : discovery.preparation.saved.text.trim() || discovery.preparation.saved.sources.length
        ? "saved"
        : "empty";
    if (dirty) {
      discovery.preparation.revisions.forEach((revision: any) => {
        revision.eligible = false;
      });
      invalidateConversion("dirty");
    }
  };

  const subscriptions: any[] = [
    // One existing subscription (a non-pinned session) so the Slack page's
    // "Listening" row has an entry. Socket Mode channels are bare ids (slack:C…).
    { session_id: "wp-1", session_title: "Weekly plan 1", agent: "cowork", channel: "slack:C0AAA111", channel_name: "ocw-test", routing_target: null, collision: false },
  ];
  // Parked unauthorized messages (§19) — mutable so Allow/Dismiss round-trip through the UI.
  const parked: any[] = [
    { id: "pk1", platform: "slack", chat_id: "C0AAA111", chat_name: "#ocw-test", user_id: "U0NEW", user_name: "Maya", chat_type: "channel", text: "hey ocw, can you summarize this thread?", ts: Date.now() / 1000 - 120 },
  ];
  // Slack connector — PER-TEST state (Socket Mode, ONE workspace) so allow/disconnect
  // mutations never leak across tests sharing a worker. Backend parity: the flat
  // allow-list mirrors the single slack:default profile.
  const slackState = {
    connected: true,
    account: "deeplearning.ai",
    allowed_users: ["U_ME"] as string[],
    allowed_user_names: { U_ME: "Rohit Prasad" } as Record<string, string | null>,
    approval_owner_ids: ["U_ME"] as string[],
    approval_owner_names: { U_ME: "Rohit Prasad" } as Record<string, string | null>,
  };
  const slackConnector = () => ({
    name: "slack", title: "Slack", icon: "#", blurb: "Two-way Slack messaging.",
    auth: "bot_token", two_way: true, channels: true, available: true, brand_color: "#611f69", logo: "slack",
    fields: [
      { key: "bot_token", label: "Bot token", secret: true, required: true, help: "", placeholder: "xoxb-…" },
      { key: "app_token", label: "App token", secret: true, required: true, help: "", placeholder: "xapp-…" },
    ],
    instructions: [], connected: slackState.connected,
    account: slackState.account, enabled: slackState.connected,
    allowed_users: [...slackState.allowed_users],
    allowed_user_names: { ...slackState.allowed_user_names },
    approval_owner_ids: [...slackState.approval_owner_ids],
    approval_owner_names: { ...slackState.approval_owner_names },
    tools: [], mode: "",
    unauthorized: parked.map((x) => ({ ...x })),
  });
  // GitHub — PER-TEST state (a personal access token, ONE account + one parked
  // mention) mirroring the backend's single github profile.
  const githubParked: any[] = [
    { id: "gh-pk1", platform: "github", chat_id: "acme/site#7", chat_name: "acme/site#7", user_id: "maya-dev", user_name: "maya-dev", chat_type: "channel", text: "@ocw please take a look at this flaky test", ts: Date.now() / 1000 - 90 },
  ];
  const githubState = {
    connected: true,
    account: "rohit-dev",
    allowed_users: ["rohit-dev"] as string[],
  };
  const githubConnector = () => ({
    name: "github", title: "GitHub", icon: "⌘", blurb: "Work with issues, pull requests, repository files, and CI status.",
    auth: "token", two_way: true, channels: false, available: true, brand_color: "#1f2328", logo: "github",
    fields: [{ key: "token", label: "Personal access token", secret: true, required: true, help: "", placeholder: "" }],
    instructions: [], connected: githubState.connected,
    account: githubState.account,
    enabled: githubState.connected,
    allowed_users: [...githubState.allowed_users],
    tools: [], mode: "",
    unauthorized: githubParked.map((x) => ({ ...x })),
  });
  // Gmail — PER-TEST multi-account state (starts disconnected; each token paste adds
  // a mailbox, mirroring the backend's gmail:account:<email> profiles).
  const gmailState = {
    accounts: [] as {
      email: string; default: boolean; scopes: string; needs_reauth: boolean;
    }[],
    filters: { senders: [] as string[], labels: [] as string[] },
  };
  const GMAIL_NEXT = ["rohit@gmail.com", "work@dlai.com", "third@x.com"];
  const gmailConnector = () => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === "gmail");
    return {
      ...base,
      connected: gmailState.accounts.length > 0,
      enabled: gmailState.accounts.length > 0,
      account: gmailState.accounts.find((a) => a.default)?.email ?? null,
      accounts: gmailState.accounts.map((a) => ({ ...a })),
      filters: { senders: [...gmailState.filters.senders], labels: [...gmailState.filters.labels] },
    };
  };
  // Google Calendar — PER-TEST multi-account state (gmail's shape, no filters).
  const gcalState = {
    accounts: [] as {
      email: string; default: boolean; scopes: string; needs_reauth: boolean;
    }[],
  };
  const GCAL_NEXT = ["rohit@gmail.com", "work@dlai.com", "third@x.com"];
  const gcalConnector = () => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === "google_calendar");
    return {
      ...base,
      connected: gcalState.accounts.length > 0,
      enabled: gcalState.accounts.length > 0,
      account: gcalState.accounts.find((a) => a.default)?.email ?? null,
      accounts: gcalState.accounts.map((a) => ({ ...a })),
    };
  };
  // Notion — PER-TEST generic multi-account state (accounts.py layer: AccountRow shape).
  const notionState = {
    accounts: [] as { account_id: string; name: string; default: boolean }[],
  };
  const NOTION_NEXT = [
    { account_id: "ws-1", name: "Rohit's Workspace" },
    { account_id: "ws-2", name: "Ops Space" },
  ];
  const notionConnector = () => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === "notion");
    return {
      ...base,
      connected: notionState.accounts.length > 0,
      enabled: notionState.accounts.length > 0,
      account: notionState.accounts.find((a) => a.default)?.name ?? null,
      accounts: notionState.accounts.map((a) => ({ ...a })),
    };
  };
  // Outlook — email-keyed accounts (mirrors outlook:account:<email> profiles).
  const outlookState = {
    accounts: [] as { account_id: string; name: string; default: boolean }[],
  };
  // MCP-backed connectors (§42) — per-test connect state; the mock "browser flow"
  // completes instantly so the modal's poll picks it up.
  const mcpState = { monday: false, jira: false };
  const mcpConnector = (name: "monday" | "jira") => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === name);
    return {
      ...base,
      connected: mcpState[name],
      enabled: mcpState[name],
      mode: mcpState[name] ? "mcp" : "",
    };
  };
  const outlookConnector = () => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === "outlook");
    return {
      ...base,
      connected: outlookState.accounts.length > 0,
      enabled: outlookState.accounts.length > 0,
      account: outlookState.accounts.find((a) => a.default)?.name ?? null,
      accounts: outlookState.accounts.map((a) => ({ ...a })),
    };
  };
  // HubSpot — PER-TEST multi-portal state (starts disconnected; each token paste adds
  // portals instantly, mirroring the backend's hubspot:portal:<hub_id> profiles).
  const hubspotState = {
    portals: [] as {
      hub_id: string; name: string; sandbox: boolean; default: boolean;
      access: string;
    }[],
    hidden_fields: [] as string[],
  };
  const HUBSPOT_NEXT = [
    { hub_id: "111", name: "Acme Inc", sandbox: false },
    { hub_id: "222", name: "Acme Sandbox", sandbox: true },
  ];
  const hubspotConnector = () => {
    const base = CONNECTORS.connectors.find((c: any) => c.name === "hubspot");
    return {
      ...base,
      connected: hubspotState.portals.length > 0,
      enabled: hubspotState.portals.length > 0,
      account: hubspotState.portals.find((p) => p.default)?.name ?? null,
      portals: hubspotState.portals.map((p) => ({ ...p })),
      hidden_fields: [...hubspotState.hidden_fields],
    };
  };
  // Installed personas — mutable so enable/surface/delete round-trip through the UI.
  const personas: any[] = PERSONAS.personas.map((p) => ({ ...p }));
  // Sessions — mutable so archive (PATCH), rename (PATCH), and delete round-trip.
  const sessions: any[] = [
    { ...PINNED_SESSION },
    ...EXTRA_SESSIONS.map((s) => ({ ...s })),
    { ...OPS_SESSION },
    { ...SLACK_SESSION },
  ];
  // Inbox items + the outbound routing binding — mutable for resolve + the inline Slack config.
  const inbox: any[] = INBOX_ITEMS.map((i) => ({ ...i }));
  const routing: { name: string; channel: string | null; target: string } = {
    name: "default",
    channel: null,
    target: "",
  };
  // Session roots — the primary (writable, non-removable) scratch plus any added folders. Mutable so
  // the RO/RW add/toggle round-trips through the real UI. POST upserts by path (a toggle re-adds).
  const roots: any[] = [{ ...PRIMARY_ROOT }];
  // Session connections — PER-TEST copy so the Access section's mute toggle (POST) can flip
  // `enabled` without leaking into sibling tests.
  const connections = {
    connected: CONNECTIONS.connected.map((c) => ({ ...c })),
    recommended: CONNECTIONS.recommended.map((r) => ({ ...r })),
    attention: CONNECTIONS.attention,
  };
  // Providers — mutable so save (POST) flips `configured` and stamps key_set_at, matching the
  // backend's set_provider. verify (POST) never mutates: it's a live read-only credential check.
  const providers: any[] = PROVIDERS.map((p) => ({ ...p }));
  // Automations — mutable so Run now appends a run, enable/disable toggles, and delete removes.
  const automations: any[] = [{ ...AUTOMATION }, { ...AUTOMATION_CLEAN }];
  // MCP servers (empty by default; the granola OAuth quick-add test populates it).
  const mcpServers: any[] = [];
  const automationRuns: any[] = AUTOMATION_RUNS.map((r) => ({ ...r }));
  // Per-session unattended flag — mutable so the composer's "Send to Inbox" toggle persists and
  // the app reads it back (which is what gates parking approvals to the Inbox vs an inline card).
  const unattended: Record<string, boolean> = {};


  // The scripted fake agent behind the session WebSocket. Speaks the real event protocol
  // ({type, data}), so the full send → stream → render loop and the approval round-trip run
  // through the production code paths:
  //   · on connect: `ready`
  //   · user_message: turn_start (with input, exercising the foreground dedupe) → two
  //     assistant_deltas → assistant_message "Echo: <text>" → turn_done
  //   · a message containing "run a tool": tool_proposed + permission_required, then the turn
  //     SUSPENDS until the client's approval decision arrives (deny → skipped; else → ran)
  // App-wide event stream: register the socket so sendAppEvent can push into it.
  await page.routeWebSocket(/\/ws\/events$/, (ws) => {
    eventSockets.set(page, ws);
  });

  await page.routeWebSocket(/\/ws\/session\//, (ws) => {
    const send = (type: string, data: Record<string, unknown> = {}) =>
      ws.send(JSON.stringify({ type, data }));
    send("ready");
    let pendingTool = "run_shell"; // which proposal the next approval decision resolves
    let epicTimer: ReturnType<typeof setInterval> | null = null; // the slow stream, stoppable via interrupt
    let hadTurn = false; // a user_message landed — set_model is now a mid-session switch
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "user_message") {
        hadTurn = true;
        send("turn_start", { input: msg.text });
        if (/run a tool/i.test(msg.text)) {
          pendingTool = "run_shell";
          send("tool_proposed", { name: "run_shell", arguments: { command: "ls" } });
          send("permission_required", {
            name: "run_shell",
            arguments: { command: "ls" },
            reason: "The coworker wants to run a command.",
          });
          return; // suspended on the approval
        }
        // §35 compact row: a routine workspace write (content rides in the args).
        if (/write a file/i.test(msg.text)) {
          pendingTool = "write_file";
          const args = {
            path: "src/fetch_data.py",
            content: "import json\nimport urllib.request\n\ncompanies = [\"NVDA\", \"AMD\"]\nprint(len(companies))\ndone = True",
          };
          send("tool_proposed", { name: "write_file", arguments: args });
          send("permission_required", { name: "write_file", arguments: args, reason: "" });
          return; // suspended on the approval
        }
        // A one-paragraph digest with NO newlines — the owner-repro shape that once
        // ballooned the card to full-transcript height (char clamp, 2026-07-15).
        if (/post the long digest/i.test(msg.text)) {
          pendingTool = "send_message";
          const args = {
            target: "slack:T1/C1",
            text:
              "aisuite — last 24 hours of work (through Jul 15): 5 PRs merged covering chat-completion streaming with unified chunks across providers, multimodal input conversion, Slack collaboration improvements, human attribution for outbound posts, and repo-wide formatting. ".repeat(
                6,
              ),
          };
          send("tool_proposed", { name: "send_message", arguments: args });
          send("permission_required", { name: "send_message", arguments: args, reason: "", category: "messaging" });
          return;
        }
        // Standing scoped approvals (§25): an eligible connector-ish write — the event
        // carries the pinnable target, exactly like the real engine computes it.
        if (/post the digest/i.test(msg.text)) {
          pendingTool = "send_message";
          send("tool_proposed", {
            name: "send_message",
            arguments: { target: "slack:T1/C1", text: "Weekly digest ready" },
          });
          send("permission_required", {
            name: "send_message",
            arguments: { target: "slack:T1/C1", text: "Weekly digest ready" },
            reason: "",
            category: "messaging",
            standing_target: "slack:T1/C1",
          });
          return;
        }
        // §25 consent card: the agent proposes the automation's permission set on the
        // gated create call; the existing approval card renders disclosure/grant lines.
        if (/create an automation/i.test(msg.text)) {
          pendingTool = "create_scheduled_task";
          send("tool_proposed", { name: "create_scheduled_task", arguments: {} });
          send("permission_required", {
            name: "create_scheduled_task",
            arguments: {
              title: "Weekly digest",
              instructions: "Summarize the week and post it.",
              cron: "0 9 * * 1",
              permissions: [
                { tool: "send_message", target: "slack:T1/C1", access: "write" },
                { tool: "github_list_commits", target: "rohit/agent-platform", access: "read" },
              ],
            },
            reason: "",
            category: "automation",
          });
          return;
        }
        // A reasoning model's turn: thinking deltas tick in slowly, then the answer —
        // the assistant_message carries the full trace like the real engine's payload.
        if (/think hard/i.test(msg.text)) {
          const thoughts = ["Weighing options. ", "Comparing tradeoffs. ", "Settling it. "];
          let tick = 0;
          const timer = setInterval(() => {
            if (tick < thoughts.length) {
              send("reasoning_delta", { text: thoughts[tick] });
              tick += 1;
              return;
            }
            clearInterval(timer);
            send("assistant_delta", { text: "Decision made." });
            send("assistant_message", {
              text: "Decision made.",
              reasoning: thoughts.join(""),
            });
            send("turn_done");
          }, 120);
          return;
        }
        // A turn that dies on a provider error; the follow-up {type:"retry"} recovers.
        if (/fail the turn/i.test(msg.text)) {
          send("error", { error: "model unreachable" });
          send("turn_done");
          return;
        }
        // A deliberately SLOW multi-second stream (~40 ticks × 120ms) so specs can
        // interact mid-turn — the follow/pin scroll contract (FB-004) is untestable
        // against the instant echo below.
        if (/stream the epic/i.test(msg.text)) {
          let ticks = 0;
          const line = "The epic scrolls ever onward, line upon line upon line. ";
          epicTimer = setInterval(() => {
            ticks += 1;
            send("assistant_delta", { text: line.repeat(3) + "\n\n" });
            if (ticks >= 40) {
              clearInterval(epicTimer!);
              epicTimer = null;
              send("assistant_message", { text: ("The epic concludes. " + line).repeat(20) });
              send("turn_done");
            }
          }, 120);
          return;
        }
        send("assistant_delta", { text: "Echo: " });
        send("assistant_delta", { text: msg.text });
        // Echo the model the message carried — pins the model-per-message contract (the
        // composer's visible model must ride on every user_message; 2026-07-04 fix).
        send("assistant_message", { text: `Echo: ${msg.text} [model=${msg.model || "none"}]` });
        send("turn_done");
      } else if (msg.type === "approval") {
        if (pendingTool === "run_shell") {
          if (msg.decision === "deny") {
            send("tool_finished", { name: "run_shell", status: "denied" });
            send("assistant_message", { text: "Understood — skipped the command." });
          } else {
            send("tool_finished", { name: "run_shell", status: "done", result_preview: "README.md" });
            send("assistant_message", { text: "The command ran; 1 file found." });
          }
        } else if (msg.decision === "deny") {
          send("tool_finished", { name: pendingTool, status: "denied" });
          send("assistant_message", { text: "Understood — skipped it." });
        } else {
          send("tool_finished", { name: pendingTool, status: "done", result_preview: "ok" });
          // The decision echoes back so specs can pin what rode the wire (e.g. always_task).
          send("assistant_message", { text: `Done via ${pendingTool} [decision=${msg.decision}]` });
        }
        send("turn_done");
      } else if (msg.type === "interrupt") {
        // Stop mid-stream: like the real engine, end the turn with `interrupted` and
        // NO assistant_message — the client owns promoting the partial into the transcript.
        if (epicTimer) {
          clearInterval(epicTimer);
          epicTimer = null;
        }
        send("interrupted", {});
        send("turn_done");
      } else if (msg.type === "set_model") {
        // Mid-session switch: the server applies it and broadcasts the persisted marker.
        // Like the real server, the FIRST bind (fresh session) is silent.
        if (hadTurn)
          send("model_changed", {
            model: msg.model,
            text: `Model switched to ${msg.model}`,
          });
      } else if (msg.type === "retry") {
        // Like the real engine: re-runs with NO new user message (turn_start input is empty).
        send("turn_start", { input: "" });
        send("assistant_message", { text: "Recovered after retry." });
        send("turn_done");
      }
    });
  });

  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const m = req.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // session-scoped (id-agnostic — any session resolves to the same fixture).
    // POST = the per-session mute override (§32 Access toggles) — flip the shared state so
    // the section's reload sees the change.
    if (/\/v1\/sessions\/[^/]+\/connections$/.test(p)) {
      if (m === "POST") {
        const b = req.postDataJSON() || {};
        const row = connections.connected.find((c) => c.connector === b.connector);
        if (row) row.enabled = !!b.enabled;
        return json({ ok: true });
      }
      return json(connections);
    }
    if (/\/v1\/sessions\/[^/]+\/roots$/.test(p)) {
      if (m === "POST") {
        const b = req.postDataJSON();
        const existing = roots.find((r) => r.path === b.path);
        if (existing) existing.writable = !!b.writable;
        else roots.push({ path: b.path, writable: !!b.writable, label: baseName(b.path), primary: false, exists: true });
        return json({ ok: true, roots });
      }
      if (m === "DELETE") {
        const rp = new URL(req.url()).searchParams.get("path");
        const i = roots.findIndex((r) => r.path === rp && !r.primary);
        if (i >= 0) roots.splice(i, 1);
        return json({ ok: true, roots });
      }
      return json({ roots });
    }
    if (/\/v1\/sessions\/[^/]+\/messages$/.test(p)) return json({ messages: [] });
    if (/\/v1\/sessions\/[^/]+\/unattended$/.test(p)) {
      const id = decodeURIComponent(p.split("/").slice(-2)[0]);
      if (m === "POST") {
        unattended[id] = !!req.postDataJSON().unattended;
        return json({ ok: true, unattended: unattended[id] });
      }
      return json({ unattended: !!unattended[id] });
    }
    if (/\/v1\/sessions\/[^/]+$/.test(p)) {
      const id = decodeURIComponent(p.split("/").pop()!);
      const i = sessions.findIndex((s) => s.session_id === id);
      if (m === "PATCH") {
        if (i >= 0) Object.assign(sessions[i], req.postDataJSON());
        return json({ ok: true });
      }
      if (m === "DELETE") {
        if (i >= 0) sessions.splice(i, 1);
        return json({ ok: true });
      }
      return json(i >= 0 ? sessions[i] : PINNED_SESSION);
    }

    if (p.endsWith("/v1/health")) return json(HEALTH);
    if (p.endsWith("/v1/discovery/input-conversion-prompt")) {
      if (m === "PUT") {
        const body = req.postDataJSON() ?? {};
        if (typeof body.instruction !== "string" || !body.instruction.trim()) {
          return json({ detail: "instruction is required" }, 422);
        }
        discoveryConversionPrompt.instruction = body.instruction;
      }
      return json(discoveryConversionPrompt);
    }
    if (p.endsWith("/v1/discovery/preparation/intake") && m === "POST") {
      const body = req.postDataJSON();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ detail: "intake payload must be an object" }, 422);
      }
      const hasText = Object.prototype.hasOwnProperty.call(body, "text");
      const rawFiles = body.files ?? [];
      if (!Array.isArray(rawFiles)) {
        return json({ detail: "files must be a list" }, 422);
      }
      if (!hasText && rawFiles.length === 0) {
        return json({ detail: "intake requires text or at least one file" }, 422);
      }
      if (hasText && typeof body.text !== "string") {
        return json({ detail: "text must be a string" }, 422);
      }
      const validatedFiles: Array<{
        filename: string;
        extension: string;
        size: number;
      }> = [];
      for (const rawFile of rawFiles) {
        if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile)) {
          return json({ detail: "each file must be an object" }, 422);
        }
        const file = rawFile as Record<string, unknown>;
        const filename = file.filename;
        if (typeof filename !== "string" || !filename.trim()) {
          return json({ detail: "filename is required" }, 422);
        }
        const extension = filename.includes(".")
          ? filename.slice(filename.lastIndexOf(".")).toLowerCase()
          : "";
        if (
          file.is_directory ||
          file.relative_path ||
          filename === "." ||
          filename === ".." ||
          filename.includes("\0") ||
          filename.includes("/") ||
          filename.includes("\\")
        ) {
          return json({ detail: "folders are not supported as Discovery sources" }, 422);
        }
        if (!DISCOVERY_SOURCE_EXTENSIONS.has(extension)) {
          return json({ detail: "unsupported source type" }, 422);
        }
        const encoded = file.content_base64;
        if (typeof encoded !== "string") {
          return json({ detail: "content_base64 is required" }, 422);
        }
        if (
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        ) {
          return json({ detail: "content_base64 must contain valid bytes" }, 422);
        }
        const content = Buffer.from(encoded, "base64");
        if (!encoded || content.toString("base64") !== encoded) {
          return json({ detail: "content_base64 must contain valid bytes" }, 422);
        }
        const size = file.size;
        if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || content.length !== size) {
          return json({ detail: "received source bytes do not match the declared size" }, 422);
        }
        if (content.length === 0) {
          return json({ detail: "empty source files are not supported" }, 422);
        }
        validatedFiles.push({ filename, extension, size });
      }
      if (hasText) {
        discovery.preparation.draft.text = body.text;
      }
      for (const file of validatedFiles) {
        const sourceId = `fixture-source-${nextDiscoverySourceId++}`;
        discovery.preparation.draft.sources.push({
          source_id: sourceId,
          filename: file.filename,
          extension: file.extension,
          size: file.size,
          sha256: `fixture-hash-${sourceId}`,
        });
      }
      updateDiscoveryStatus();
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery/preparation/save") && m === "POST") {
      const rawBody = req.postDataJSON();
      const body = rawBody == null ? {} : rawBody;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ detail: "save payload must be an object" }, 422);
      }
      if (Object.prototype.hasOwnProperty.call(body, "text") && typeof body.text !== "string") {
        return json({ detail: "text must be a string" }, 422);
      }
      if (Object.prototype.hasOwnProperty.call(body, "text")) {
        discovery.preparation.draft.text = body.text;
      }
      const previousSaved = JSON.stringify(discovery.preparation.saved);
      discovery.preparation.saved = JSON.parse(JSON.stringify(discovery.preparation.draft));
      updateDiscoveryStatus();
      if (previousSaved !== JSON.stringify(discovery.preparation.saved)) {
        discovery.preparation.revisions.forEach((revision: any) => {
          revision.eligible = false;
        });
      }
      invalidateConversion("pending");
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery/preparation/reset") && m === "POST") {
      discovery.preparation.draft = { text: "", sources: [] };
      discovery.preparation.saved = { text: "", sources: [] };
      discovery.preparation.revisions = [];
      discovery.preparation.dirty = false;
      discovery.preparation.status = "empty";
      invalidateConversion("pending");
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery/preparation/convert") && m === "POST") {
      const hasInput =
        discovery.preparation.saved.text.trim() || discovery.preparation.saved.sources.length;
      if (discovery.preparation.dirty) {
        return json({ detail: "save the Preparation before Conversion" }, 422);
      }
      if (!hasInput) {
        return json({ detail: "Conversion requires a non-empty saved Preparation" }, 422);
      }
      const executionInput = {
        task_description: "Compare two constrained baselines against the supplied evidence.",
        domain: "Scientific ML",
        background: `${discovery.preparation.saved.text || "Use the committed source bundle as evidence."} ${discovery.preparation.saved.sources.map((source: any) => `[source: ${source.filename}]`).join(" ")}`.trim(),
        constraints: ["Use only the committed source bundle."],
      };
      discovery.preparation.conversion = {
        status: "editing",
        execution_input: executionInput,
        model_id: SETTINGS.model,
        error: null,
        saved_revision_id: null,
        base_fingerprint: "fixture-current",
        current_fingerprint: "fixture-current",
      };
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery/preparation/revisions") && m === "POST") {
      const body = req.postDataJSON() ?? {};
      const executionInput = body.execution_input;
      if (!executionInput || typeof executionInput !== "object") {
        return json({ detail: "Discovery Execution Input must not be empty" }, 422);
      }
      if (discovery.preparation.dirty || !discovery.preparation.conversion.execution_input) {
        return json({ detail: "convert the committed Preparation before saving a revision" }, 422);
      }
      const revisionId = `fixture-revision-${nextDiscoveryRevisionId++}`;
      discovery.preparation.revisions.push({
        revision_id: revisionId,
        created_at: "2026-08-01T00:00:00.000Z",
        execution_input: executionInput,
        model_id: discovery.preparation.conversion.model_id,
        eligible: true,
      });
      discovery.preparation.conversion = {
        ...discovery.preparation.conversion,
        status: "saved",
        execution_input: executionInput,
        saved_revision_id: revisionId,
        error: null,
      };
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery/launches") && m === "POST") {
      const body = req.postDataJSON() ?? {};
      const key = req.headers()["idempotency-key"] ?? "";
      const revisionId = body.revision_id;
      const revision = discovery.preparation.revisions.find(
        (candidate: any) => candidate.revision_id === revisionId,
      );
      const fingerprint = JSON.stringify({
        preparation_id: body.preparation_id ?? "preparation",
        revision_id: revisionId,
      });
      const previous = discoveryLaunchesByKey.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          return json({ detail: "Idempotency-Key was already used for a different Launch request" }, 409);
        }
        return json(previous.result, 201);
      }
      if (!key) return json({ detail: "Idempotency-Key is required to start a Launch" }, 422);
      if (discovery.current_launch) return json({ detail: "another Discovery Launch is already active" }, 409);
      if (
        discovery.preparation.dirty ||
        !revision ||
        !revision.eligible ||
        !revision.execution_input
      ) {
        return json({ detail: "the saved Preparation and revision must be current before Run" }, 422);
      }
      const launch = {
        launch_id: `fixture-launch-${nextDiscoveryLaunchId++}`,
        preparation_id: "preparation",
        revision_id: revisionId,
        created_at: "2026-08-01T00:00:00.000Z",
        started_at: null,
        completed_at: null,
        state: "starting",
        stage: "admission",
        round: 0,
        attempts: [{ attempt_id: `fixture-attempt-${nextDiscoveryLaunchId}`, started_at: null, finished_at: null, state: "starting" }],
        current_attempt_id: `fixture-attempt-${nextDiscoveryLaunchId}`,
        runner_pid: null,
        checkpoint: null,
        resumable: false,
        stop_requested_at: null,
        stopped_at: null,
        stop_reason: null,
        outcome: null,
        error: null,
      };
      discovery.current_launch = launch;
      const result = {
        launch_id: launch.launch_id,
        state: "starting",
        snapshot: JSON.parse(JSON.stringify(discovery)),
      };
      discoveryLaunchesByKey.set(key, { fingerprint, result });
      setTimeout(() => {
        if (discovery.current_launch?.launch_id !== launch.launch_id) return;
        const completed = {
          ...launch,
          state: "completed",
          stage: "completed",
          round: 3,
          outcome: "completed",
          resumable: false,
          attempts: launch.attempts.map((attempt: any) => ({ ...attempt, state: "completed", finished_at: "2026-08-01T00:00:01.000Z" })),
        };
        discovery.current_launch = null;
        discovery.history.unshift(completed);
        discoveryArtifactsByLaunch.set(launch.launch_id, {
          report: `# Discovery report\n\nLaunch \`${launch.launch_id}\` completed.\n`,
          summary: JSON.stringify({ launch_id: launch.launch_id, state: "completed", rounds: 3 }),
        });
      }, 1000);
      return json(result, 201);
    }
    const stopMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/stop$/);
    if (stopMatch && m === "POST") {
      const launchId = decodeURIComponent(stopMatch[1]);
      const current = discovery.current_launch;
      if (!current || current.launch_id !== launchId) {
        const history = discovery.history.find((candidate: any) => candidate.launch_id === launchId);
        if (!history) return json({ detail: "Discovery Launch not found" }, 404);
        return json({ detail: `Stop is unavailable while Launch is ${history.state}` }, 409);
      }
      if (current.state === "stopping") return json(discovery);
      current.state = "stopping";
      current.stop_requested_at = "2026-08-01T00:00:00.500Z";
      current.stop_reason = "researcher requested graceful stop";
      setTimeout(() => {
        if (discovery.current_launch?.launch_id !== launchId) return;
        const stopped = {
          ...discovery.current_launch,
          state: "stopped",
          stage: "stopped",
          outcome: "stopped",
          resumable: true,
          stopped_at: "2026-08-01T00:00:01.000Z",
          checkpoint: { attempt_id: discovery.current_launch.current_attempt_id, stage: "research", round: 2, reason: "stop", created_at: "2026-08-01T00:00:00.900Z" },
          attempts: discovery.current_launch.attempts.map((attempt: any) => ({ ...attempt, state: "stopped", finished_at: "2026-08-01T00:00:01.000Z" })),
        };
        discovery.current_launch = null;
        discovery.history.unshift(stopped);
      }, 100);
      return json(discovery);
    }
    const resumeMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/resume$/);
    if (resumeMatch && m === "POST") {
      const launchId = decodeURIComponent(resumeMatch[1]);
      const key = req.headers()["idempotency-key"] ?? "";
      const fingerprint = JSON.stringify({ launch_id: launchId });
      const previous = discoveryLaunchesByKey.get(`resume:${key}`);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          return json({ detail: "Idempotency-Key was already used for a different Launch request" }, 409);
        }
        return json(previous.result, 201);
      }
      if (!key) return json({ detail: "Idempotency-Key is required to resume a Launch" }, 422);
      if (discovery.current_launch) return json({ detail: "another Discovery Launch is already active" }, 409);
      const historyIndex = discovery.history.findIndex((candidate: any) => candidate.launch_id === launchId);
      const previousLaunch = historyIndex >= 0 ? discovery.history[historyIndex] : null;
      if (!previousLaunch) return json({ detail: "Discovery Launch not found" }, 404);
      if (!["stopped", "interrupted"].includes(previousLaunch.state) || !previousLaunch.resumable) {
        return json({ detail: `Resume is unavailable while Launch is ${previousLaunch.state}` }, 409);
      }
      discovery.history.splice(historyIndex, 1);
      const resumedAttempt = { attempt_id: `fixture-attempt-${nextDiscoveryLaunchId++}`, started_at: null, finished_at: null, state: "starting", resume_from_round: previousLaunch.checkpoint?.round ?? 0 };
      const resumed = {
        ...previousLaunch,
        state: "starting",
        stage: "resuming",
        round: previousLaunch.checkpoint?.round ?? 0,
        outcome: null,
        error: null,
        resumable: false,
        attempts: [...previousLaunch.attempts, resumedAttempt],
        current_attempt_id: resumedAttempt.attempt_id,
        stopped_at: null,
        stop_reason: null,
      };
      discovery.current_launch = resumed;
      const result = { launch_id: launchId, state: "starting", snapshot: JSON.parse(JSON.stringify(discovery)) };
      discoveryLaunchesByKey.set(`resume:${key}`, { fingerprint, result });
      setTimeout(() => {
        if (discovery.current_launch?.launch_id !== launchId) return;
        const completed = { ...resumed, state: "completed", stage: "completed", round: 3, outcome: "completed", resumable: false, attempts: resumed.attempts.map((attempt: any) => ({ ...attempt, state: "completed", finished_at: "2026-08-01T00:00:02.000Z" })) };
        discovery.current_launch = null;
        discovery.history.unshift(completed);
        discoveryArtifactsByLaunch.set(launchId, {
          report: `# Discovery report\n\nLaunch \`${launchId}\` completed after Resume.\n`,
          summary: JSON.stringify({ launch_id: launchId, state: "completed", rounds: 3 }),
        });
      }, 1000);
      return json(result, 201);
    }
    const launchStatusMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/status$/);
    if (launchStatusMatch && m === "GET") {
      const launch = findDiscoveryLaunch(decodeURIComponent(launchStatusMatch[1]));
      return launch ? json(discoveryStatus(launch)) : json({ detail: "Discovery Launch not found" }, 404);
    }
    const launchEventsMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/events$/);
    if (launchEventsMatch && m === "GET") {
      const launch = findDiscoveryLaunch(decodeURIComponent(launchEventsMatch[1]));
      return launch ? json({ events: [], latest_sequence: 1 }) : json({ detail: "Discovery Launch not found" }, 404);
    }
    const launchLogMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/logs\/stream$/);
    if (launchLogMatch && m === "GET") {
      const launch = findDiscoveryLaunch(decodeURIComponent(launchLogMatch[1]));
      return launch
        ? route.fulfill({ status: 200, contentType: "text/event-stream", body: "data: fixture-runner: research round=1\n\n" })
        : json({ detail: "Discovery Launch not found" }, 404);
    }
    const artifactsMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/artifacts$/);
    if (artifactsMatch && m === "GET") {
      const launchId = decodeURIComponent(artifactsMatch[1]);
      const launch = findDiscoveryLaunch(launchId);
      if (!launch) return json({ detail: "Discovery Launch not found" }, 404);
      const artifacts = discoveryArtifactsByLaunch.has(launchId)
        ? [
            { path: "report.md", name: "report.md", kind: "markdown", size: 64, modified_at: 1, previewable: true },
            { path: "summary.json", name: "summary.json", kind: "structured", size: 64, modified_at: 1, previewable: true },
          ]
        : [];
      return json({ launch_id: launchId, artifacts });
    }
    const artifactReadMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/artifacts\/read$/);
    if (artifactReadMatch && m === "GET") {
      const launchId = decodeURIComponent(artifactReadMatch[1]);
      const launch = findDiscoveryLaunch(launchId);
      const artifact = discoveryArtifactsByLaunch.get(launchId);
      const artifactPath = new URL(req.url()).searchParams.get("path");
      if (!launch || !artifact || !artifactPath || !["report.md", "summary.json"].includes(artifactPath)) {
        return json({ detail: "Discovery artifact is not available" }, 404);
      }
      const markdown = artifactPath === "report.md";
      return json({
        ok: true,
        path: artifactPath,
        name: artifactPath,
        kind: markdown ? "markdown" : "structured",
        size: artifactPath === "report.md" ? artifact.report.length : artifact.summary.length,
        modified_at: 1,
        previewable: true,
        content: markdown ? artifact.report : artifact.summary,
        data_url: null,
        truncated: false,
      });
    }
    const artifactRevealMatch = p.match(/\/v1\/discovery\/launches\/([^/]+)\/artifacts\/reveal$/);
    if (artifactRevealMatch && m === "POST") {
      const launchId = decodeURIComponent(artifactRevealMatch[1]);
      const launch = findDiscoveryLaunch(launchId);
      const body = req.postDataJSON() ?? {};
      if (!launch || !discoveryArtifactsByLaunch.has(launchId) || !["report.md", "summary.json"].includes(body.path)) {
        return json({ detail: "Discovery artifact is not available" }, 404);
      }
      return json({ ok: true, path: body.path, mode: body.mode ?? "reveal" });
    }
    if (p.endsWith("/v1/discovery/launches") && m === "GET") {
      return json(discovery);
    }
    const sourceMatch = p.match(/\/v1\/discovery\/preparation\/sources\/([^/]+)$/);
    if (sourceMatch && m === "DELETE") {
      const sourceId = decodeURIComponent(sourceMatch[1]);
      const sourceIndex = discovery.preparation.draft.sources.findIndex(
        (source) => source.source_id === sourceId,
      );
      if (sourceIndex < 0) return json({ detail: "source entry not found" }, 404);
      discovery.preparation.draft.sources.splice(sourceIndex, 1);
      updateDiscoveryStatus();
      return json(discovery);
    }
    if (p.endsWith("/v1/discovery")) return json(discovery);
    if (p.endsWith("/v1/settings")) return json(SETTINGS);
    if (p.endsWith("/v1/settings/pdf") && m === "POST") {
      Object.assign(SETTINGS, req.postDataJSON());
      return json({
        ok: true,
        pdf_fallback: SETTINGS.pdf_fallback,
        pdf_max_pages: SETTINGS.pdf_max_pages,
        pdf_max_mb: SETTINGS.pdf_max_mb,
      });
    }
    if (p.endsWith("/v1/attachments/inspect-pdf") && m === "POST") {
      // Page count for the composer threshold check: the tests encode it in the PDF body
      // as "%%pages=N" (the mock doesn't parse real PDFs).
      const data = String(req.postDataJSON()?.data_url || "");
      const match = /%%pages=(\d+)/.exec(atob(data.split(",")[1] || "") || "");
      return json({ ok: true, pages: match ? Number(match[1]) : 1, bytes: data.length });
    }
    if (p.endsWith("/v1/workspaces/recent")) return json({ workspaces: [] });
    if (p.endsWith("/v1/workspaces/pick") && m === "POST") {
      return json({ ok: true, path: "/tmp/picked-folder" });
    }
    if (p.endsWith("/v1/workspaces/open") && m === "POST") {
      const b = req.postDataJSON();
      return json({ ok: true, path: b.path, git_branch: "main" });
    }
    // must precede the /v1/personas/{id} catch-all (install matches it too)
    if (p.endsWith("/v1/personas/install") && m === "POST") {
      const b = req.postDataJSON();
      return json({ ok: false, error: "unsupported in mock" });
    }
    if (/\/v1\/personas\/[^/]+$/.test(p) && m === "POST") {
      // Persona flag update (enabled/surfaced/default). Backend parity: enabling implies
      // surfacing (registry.set_enabled sets surfaced — the PM-invisible bug fix).
      const id = p.split("/").pop();
      const t = personas.find((x) => x.id === id);
      if (!t) return json({ ok: false, error: `unknown persona: ${id}` });
      const b = req.postDataJSON();
      if (b.default) personas.forEach((x) => (x.default = x.id === id));
      let archivedCount = 0;
      if (typeof b.enabled === "boolean") {
        t.enabled = b.enabled;
        if (b.enabled) t.surfaced = true;
        // Backend parity (disable-archives, §18): disabling archives the persona's real
        // sessions server-side, so its sidebar section disappears with it.
        if (!b.enabled) {
          for (const s of sessions) {
            if (s.agent === id && !s.archived && !s.session_id.startsWith("__")) {
              s.archived = true;
              archivedCount++;
            }
          }
        }
      }
      if (typeof b.surfaced === "boolean") t.surfaced = b.surfaced;
      return json({ ok: true, personas, archived_sessions: archivedCount });
    }
    if (/\/v1\/personas\/[^/]+$/.test(p) && m === "DELETE") {
      const id = p.split("/").pop();
      const i = personas.findIndex((x) => x.id === id && !x.builtin);
      if (i < 0) return json({ ok: false, error: `unknown persona: ${id}` });
      personas.splice(i, 1);
      return json({ ok: true, personas });
    }
    if (/\/v1\/personas\/[^/]+$/.test(p)) return json(PERSONA_DETAIL);
    if (p.endsWith("/v1/personas")) return json({ personas });
    if (p.endsWith("/v1/sessions")) return json({ sessions });
    if (/\/v1\/connectors\/slack\/unauthorized\/[^/]+$/.test(p) && m === "POST") {
      const id = p.split("/").pop();
      const i = parked.findIndex((x) => x.id === id);
      if (i < 0) return json({ ok: false, error: "unknown item" });
      const b = req.postDataJSON();
      const item = parked.splice(i, 1)[0];
      // Socket Mode is one workspace: allowing lands on the single flat list.
      if (b.action === "allow" || b.action === "allow_deliver") {
        const pool = slackState.allowed_users;
        if (!pool.includes(item.user_id)) pool.push(item.user_id);
      }
      return json({ ok: true });
    }
    // Allow/disallow against the single workspace's flat list.
    if (/\/v1\/connectors\/slack\/(allow|disallow)$/.test(p) && m === "POST") {
      const b = req.postDataJSON();
      const add = p.endsWith("/allow");
      const pool = slackState.allowed_users;
      const i = pool.indexOf(b.user_id);
      if (add && i < 0) pool.push(b.user_id);
      if (!add && i >= 0) pool.splice(i, 1);
      // Directory picks carry the display name — backend seeds the people directory.
      if (add && b.name) slackState.allowed_user_names[b.user_id] = b.name;
      return json({ ok: true, allowed_users: [...pool] });
    }
    if (p.endsWith("/v1/connectors/slack/approval-owners/add") && m === "POST") {
      const b = req.postDataJSON();
      if (!slackState.approval_owner_ids.includes(b.user_id))
        slackState.approval_owner_ids.push(b.user_id);
      if (!slackState.allowed_users.includes(b.user_id))
        slackState.allowed_users.push(b.user_id);
      return json({
        ok: true,
        approval_owner_ids: [...slackState.approval_owner_ids],
        allowed_users: [...slackState.allowed_users],
      });
    }
    if (p.endsWith("/v1/connectors/slack/approval-owners/remove") && m === "POST") {
      const b = req.postDataJSON();
      const i = slackState.approval_owner_ids.indexOf(b.user_id);
      if (i >= 0) slackState.approval_owner_ids.splice(i, 1);
      return json({ ok: true, approval_owner_ids: [...slackState.approval_owner_ids] });
    }
    // Workspace rosters for the pickers (users.list / conversations.list, mocked).
    if (p.endsWith("/v1/connectors/slack/directory") && m === "GET") {
      const q = (new URL(req.url()).searchParams.get("q") || "").toLowerCase();
      const members = [
        { id: "U9MAYA", name: "Maya Chen", handle: "maya", guest: false },
        { id: "U8ROHIT", name: "Rohit Prasad", handle: "rohit", guest: false },
        { id: "U7CAL", name: "Contractor Cal", handle: "cal", guest: true },
      ].filter((mem) => !q || mem.name.toLowerCase().includes(q) || mem.handle.includes(q));
      return json({ ok: true, members });
    }
    if (p.endsWith("/v1/connectors/slack/channels") && m === "GET") {
      const q = (new URL(req.url()).searchParams.get("q") || "").toLowerCase();
      const channels = [
        { id: "C9LAUNCH", name: "launch-team", is_private: false, is_member: true },
        { id: "C8LEADS", name: "leads", is_private: true, is_member: true },
        { id: "C7LOBBY", name: "lobby", is_private: false, is_member: false },
      ].filter((c) => !q || c.name.includes(q));
      return json({ ok: true, channels });
    }
    // GitHub (PAT): allow/disallow + parked resolution against one flat allow-list.
    if (/\/v1\/connectors\/github\/unauthorized\/[^/]+$/.test(p) && m === "POST") {
      const id = p.split("/").pop();
      const i = githubParked.findIndex((x) => x.id === id);
      if (i < 0) return json({ ok: false, error: "unknown item" });
      const b = req.postDataJSON();
      const item = githubParked.splice(i, 1)[0];
      if (b.action === "allow" || b.action === "allow_deliver") {
        const pool = githubState.allowed_users;
        if (!pool.includes(item.user_id)) pool.push(item.user_id);
      }
      return json({ ok: true });
    }
    if (/\/v1\/connectors\/github\/(allow|disallow)$/.test(p) && m === "POST") {
      const b = req.postDataJSON();
      const pool = githubState.allowed_users;
      const add = p.endsWith("/allow");
      const i = pool.indexOf(b.user_id);
      if (add && i < 0) pool.push(b.user_id);
      if (!add && i >= 0) pool.splice(i, 1);
      return json({ ok: true, allowed_users: [...pool] });
    }
    // Gmail multi-account management (M3.6 Step 3): per-account disconnect/default
    // + the "Never show agents" filter lists.
    if (/\/v1\/connectors\/gmail\/accounts\/[^/]+\/disconnect$/.test(p) && m === "POST") {
      const email = decodeURIComponent(p.split("/").slice(-2)[0]);
      const i = gmailState.accounts.findIndex((a) => a.email === email);
      if (i < 0) return json({ ok: false, error: "account not connected" });
      const wasDefault = gmailState.accounts[i].default;
      gmailState.accounts.splice(i, 1);
      if (wasDefault && gmailState.accounts[0]) gmailState.accounts[0].default = true;
      return json({ ok: true, remaining_accounts: gmailState.accounts.length });
    }
    if (/\/v1\/connectors\/google_calendar\/accounts\/[^/]+\/disconnect$/.test(p) && m === "POST") {
      const email = decodeURIComponent(p.split("/accounts/")[1].split("/")[0]);
      const i = gcalState.accounts.findIndex((a) => a.email === email);
      if (i < 0) return json({ ok: false, error: "account not connected" });
      const wasDefault = gcalState.accounts[i].default;
      gcalState.accounts.splice(i, 1);
      if (wasDefault && gcalState.accounts[0]) gcalState.accounts[0].default = true;
      return json({ ok: true, remaining_accounts: gcalState.accounts.length });
    }
    if (/\/v1\/connectors\/google_calendar\/accounts\/[^/]+\/default$/.test(p) && m === "POST") {
      const email = decodeURIComponent(p.split("/accounts/")[1].split("/")[0]);
      if (!gcalState.accounts.some((a) => a.email === email))
        return json({ ok: false, error: "account not connected" });
      for (const a of gcalState.accounts) a.default = a.email === email;
      return json({ ok: true, default_account: email });
    }
    if (/\/v1\/connectors\/gmail\/accounts\/[^/]+\/default$/.test(p) && m === "POST") {
      const email = decodeURIComponent(p.split("/").slice(-2)[0]);
      if (!gmailState.accounts.some((a) => a.email === email))
        return json({ ok: false, error: "account not connected" });
      for (const a of gmailState.accounts) a.default = a.email === email;
      return json({ ok: true, default_account: email });
    }
    if (p.endsWith("/v1/connectors/gmail/filters") && m === "PATCH") {
      const b = req.postDataJSON() || {};
      if (Array.isArray(b.senders)) gmailState.filters.senders = b.senders;
      if (Array.isArray(b.labels)) gmailState.filters.labels = b.labels;
      return json({ ok: true, filters: { ...gmailState.filters } });
    }
    // Generic multi-account management (accounts.py layer; notion in fixtures).
    if (/\/v1\/connectors\/notion\/accounts\/[^/]+\/disconnect$/.test(p) && m === "POST") {
      const id = decodeURIComponent(p.split("/accounts/")[1].split("/")[0]);
      const i = notionState.accounts.findIndex((a) => a.account_id === id);
      if (i < 0) return json({ ok: false, error: "account not connected" });
      const wasDefault = notionState.accounts[i].default;
      notionState.accounts.splice(i, 1);
      if (wasDefault && notionState.accounts[0]) notionState.accounts[0].default = true;
      return json({ ok: true, remaining_accounts: notionState.accounts.length });
    }
    if (/\/v1\/connectors\/notion\/accounts\/[^/]+\/default$/.test(p) && m === "POST") {
      const id = decodeURIComponent(p.split("/accounts/")[1].split("/")[0]);
      if (!notionState.accounts.some((a) => a.account_id === id))
        return json({ ok: false, error: "account not connected" });
      for (const a of notionState.accounts) a.default = a.account_id === id;
      return json({ ok: true, default_account: id });
    }
    // HubSpot multi-portal management (M3.6 Step 4).
    if (/\/v1\/connectors\/hubspot\/portals\/[^/]+\/disconnect$/.test(p) && m === "POST") {
      const hub = decodeURIComponent(p.split("/").slice(-2)[0]);
      const i = hubspotState.portals.findIndex((x) => x.hub_id === hub);
      if (i < 0) return json({ ok: false, error: "portal not connected" });
      const wasDefault = hubspotState.portals[i].default;
      hubspotState.portals.splice(i, 1);
      if (wasDefault && hubspotState.portals[0]) hubspotState.portals[0].default = true;
      return json({ ok: true, remaining_portals: hubspotState.portals.length });
    }
    if (/\/v1\/connectors\/hubspot\/portals\/[^/]+\/default$/.test(p) && m === "POST") {
      const hub = decodeURIComponent(p.split("/").slice(-2)[0]);
      if (!hubspotState.portals.some((x) => x.hub_id === hub))
        return json({ ok: false, error: "portal not connected" });
      for (const x of hubspotState.portals) x.default = x.hub_id === hub;
      return json({ ok: true, default_portal: hub });
    }
    if (p.endsWith("/v1/connectors/hubspot/hidden-fields") && m === "PATCH") {
      const b = req.postDataJSON() || {};
      if (Array.isArray(b.hidden_fields))
        hubspotState.hidden_fields = b.hidden_fields.map((f: string) => f.trim().toLowerCase());
      return json({ ok: true, hidden_fields: [...hubspotState.hidden_fields] });
    }
    if (p.endsWith("/v1/connectors"))
      return json({
        connectors: [
          slackConnector(),
          githubConnector(),
          ...CONNECTORS.connectors.map((c: any) =>
            c.name === "gmail"
              ? gmailConnector()
              : c.name === "google_calendar"
                ? gcalConnector()
                : c.name === "hubspot"
                  ? hubspotConnector()
                  : c.name === "notion"
                    ? notionConnector()
                    : c.name === "outlook"
                      ? outlookConnector()
                      : c.name === "monday" || c.name === "jira"
                        ? mcpConnector(c.name)
                        : { ...c },
          ),
        ],
      });
    // Whole-connector disconnect (drops the stored credentials). Accounts-layer
    // connectors clear every account; the rest just flip to not-connected.
    if (/\/v1\/connectors\/[^/]+\/disconnect$/.test(p) && m === "POST") {
      const name = p.match(/\/v1\/connectors\/([^/]+)\/disconnect$/)?.[1] || "";
      if (name === "slack") {
        slackState.connected = false;
        return json({ ok: true });
      }
      if (name === "github") {
        githubState.connected = false;
        return json({ ok: true });
      }
      if (name === "gmail") gmailState.accounts.length = 0;
      if (name === "google_calendar") gcalState.accounts.length = 0;
      if (name === "notion") notionState.accounts.length = 0;
      if (name === "outlook") outlookState.accounts.length = 0;
      if (name === "hubspot") hubspotState.portals.length = 0;
      if (name in mcpState) mcpState[name as "monday" | "jira"] = false;
      return json({ ok: true });
    }
    if (/\/v1\/connectors\/[^/]+\/mcp-connect$/.test(p) && m === "POST") {
      // Local MCP OAuth flow — no cloud sign-in required; completes instantly here.
      const name = p.match(/\/v1\/connectors\/([^/]+)\/mcp-connect$/)?.[1] as
        | "monday"
        | "jira";
      if (name in mcpState) {
        mcpState[name] = true;
        return json({ ok: true, started: true });
      }
      return json({ ok: false, error: `${name} has no MCP connect path` });
    }
    // Manual token connect — the ONE connect path now. Connectors on the accounts
    // layer append an account per connect (mirroring the backend's <name>:account:<id>
    // profiles); the rest just flip to connected.
    if (/\/v1\/connectors\/[^/]+\/connect$/.test(p) && m === "POST") {
      const name = p.match(/\/v1\/connectors\/([^/]+)\/connect$/)?.[1] || "";
      const fields = (req.postDataJSON() || {}).fields || {};
      if (name === "slack") {
        // Socket Mode needs BOTH tokens; the backend validates them together.
        if (!fields.bot_token || !fields.app_token)
          return json({ ok: false, error: "both tokens are required" });
        slackState.connected = true;
        return json({ ok: true, account: slackState.account });
      }
      if (name === "github") {
        githubState.connected = true;
        return json({ ok: true, account: githubState.account });
      }
      if (name === "gmail") {
        const email = GMAIL_NEXT[gmailState.accounts.length] || `acct${gmailState.accounts.length}@x.com`;
        gmailState.accounts.push({
          email, default: gmailState.accounts.length === 0,
          scopes: "gmail.readonly gmail.send", needs_reauth: false,
        });
        return json({ ok: true, account: email });
      }
      if (name === "google_calendar") {
        const email = GCAL_NEXT[gcalState.accounts.length] || `acct${gcalState.accounts.length}@x.com`;
        gcalState.accounts.push({
          email, default: gcalState.accounts.length === 0,
          scopes: "calendar", needs_reauth: false,
        });
        return json({ ok: true, account: email });
      }
      if (name === "outlook") {
        const id = `mbx${outlookState.accounts.length + 1}@openworker.com`;
        outlookState.accounts.push({
          account_id: id, name: id, default: outlookState.accounts.length === 0,
        });
        return json({ ok: true, account: id });
      }
      if (name === "notion") {
        const next = NOTION_NEXT[notionState.accounts.length] || {
          account_id: `ws-${notionState.accounts.length + 1}`, name: "extra",
        };
        notionState.accounts.push({ ...next, default: notionState.accounts.length === 0 });
        return json({ ok: true, account: next.name });
      }
      if (name === "hubspot") {
        const next = HUBSPOT_NEXT[hubspotState.portals.length] || {
          hub_id: `9${hubspotState.portals.length}`, name: "extra", sandbox: false,
        };
        hubspotState.portals.push({
          ...next, default: hubspotState.portals.length === 0, access: "",
        });
        return json({ ok: true, account: next.name });
      }
      return json({ ok: true, account: "connected" });
    }
    // provider credential check (read-only) — an api_key containing "bad" fails, else ok.
    if (p.endsWith("/v1/providers/verify") && m === "POST") {
      const key = String(req.postDataJSON()?.fields?.api_key || "");
      return /bad/i.test(key)
        ? json({ ok: false, error: "Invalid API key." })
        : json({ ok: true });
    }
    // save a provider key — flips `configured`, stamps key_set_at (backend set_provider parity).
    if (p.endsWith("/v1/providers") && m === "POST") {
      const b = req.postDataJSON();
      const prov = providers.find((x) => x.name === b.name);
      if (!prov) return json({ ok: false, error: `unknown provider: ${b.name}` });
      if (b.fields?.api_key) {
        prov.configured = true;
        prov.key_set_at = "2026-07-05";
      }
      // Backend parity: non-secret fields merge into `values` (empty clears them).
      for (const [k, v] of Object.entries(b.fields || {})) {
        if (k === "api_key") continue;
        if (v) prov.values = { ...prov.values, [k]: v };
        else if (prov.values) delete prov.values[k];
      }
      return json({ ok: true, provider: b.name, recommended_model: null });
    }
    // forget a provider's stored config (Settings ▸ Models "Remove key…").
    if (/\/v1\/providers\/[^/]+$/.test(p) && m === "DELETE") {
      const name = p.split("/").pop()!;
      const prov = providers.find((x) => x.name === name);
      if (!prov) return json({ ok: false, error: `unknown provider: ${name}` });
      prov.configured = !prov.needs_key; // keyless (ollama) stays "configured"
      prov.key_set_at = null;
      return json({ ok: true, provider: name });
    }
    if (p.endsWith("/v1/providers")) return json(providers);
    if (p.endsWith("/v1/channels/recent"))
      return json({
        channels: [
          { channel: "slack:C0AAA111", name: "ocw-test", last_from: "amy", last_text: "standup at 10" },
          { channel: "slack:C0BBB222", last_from: "bob", last_text: "deploy failed" },
        ],
      });

    // inbox: pending items + the outbound routing binding (inline Slack config)
    if (/\/v1\/inbox\/[^/]+\/resolve$/.test(p) && m === "POST") {
      const id = decodeURIComponent(p.split("/")[p.split("/").length - 2]);
      const it = inbox.find((x) => x.id === id);
      if (it) {
        it.state = "resolved";
        it.resolution = req.postDataJSON().resolution;
      }
      return json({ ok: true });
    }
    if (p.endsWith("/v1/inbox/routing/binding") && m === "POST") {
      const b = req.postDataJSON();
      routing.channel = b.channel;
      routing.target = b.target;
      return json({ ok: true, bindings: [{ ...routing }] });
    }
    if (p.endsWith("/v1/inbox/routing")) return json({ bindings: [{ ...routing }] });
    if (p.endsWith("/v1/inbox")) {
      const q = new URL(req.url()).searchParams;
      const sid = q.get("session_id");
      const state = q.get("state");
      return json({
        items: inbox.filter(
          (i) => (!sid || i.session_id === sid) && (!state || i.state === state),
        ),
      });
    }

    // automations: one scheduled task with a running run (drives the Automations detail page
    // and the run-session banner + Back-to-runs flow). Mutable: Run now appends a run and opens
    // its live session; the enable toggle (PATCH) and delete (DELETE) round-trip through the UI.
    if (/\/v1\/automations\/[^/]+\/seen$/.test(p) && m === "POST") {
      const id = p.split("/").slice(-2)[0];
      const task = automations.find((t) => t.id === id);
      if (task) {
        task.unseen_runs = 0;
        task.unseen_failed = false;
        task.seen_runs_at = Math.floor(Date.now() / 1000);
      }
      return json({ ok: !!task });
    }
    if (/\/v1\/automations\/[^/]+\/run$/.test(p) && m === "POST") {
      const id = p.split("/").slice(-2)[0];
      const task = automations.find((t) => t.id === id);
      if (!task) return json({ ok: false, error: "unknown task" });
      const runId = `r${automationRuns.length + 1}`;
      automationRuns.unshift({
        run_id: runId,
        task_id: id,
        session_id: `__run__${runId}`,
        started_at: Math.floor(Date.now() / 1000),
        finished_at: null,
        status: "running",
        result_text: null,
        artifacts: [],
        error: null,
        trigger: "manual",
      });
      return json({
        ok: true,
        run_id: runId,
        session_id: `__run__${runId}`,
        workspace: task.workspace,
        agent: task.agent,
        prompt: task.instructions,
      });
    }
    if (/\/v1\/automations\/[^/]+$/.test(p) && m === "GET") {
      const id = p.split("/").pop();
      const task = automations.find((t) => t.id === id) ?? automations[0];
      return json({ task, runs: automationRuns.filter((r) => r.task_id === task?.id) });
    }
    if (/\/v1\/automations\/[^/]+$/.test(p) && m === "PATCH") {
      const id = p.split("/").pop();
      const task = automations.find((t) => t.id === id);
      const body = req.postDataJSON() ?? {};
      if (task && body.revoke) {
        // Standing-rule revocation (§25): remove the entry; `revoke` is a command,
        // not a field to Object.assign onto the task.
        task.always_allowed = (task.always_allowed || []).filter(
          (r: any) => r.entry !== body.revoke,
        );
        return json({ ok: true, task });
      }
      if (task) Object.assign(task, body);
      return json({ ok: true, task });
    }
    if (/\/v1\/automations\/[^/]+$/.test(p) && m === "DELETE") {
      const id = p.split("/").pop();
      const i = automations.findIndex((t) => t.id === id);
      if (i >= 0) automations.splice(i, 1);
      return json({ ok: true });
    }
    if (p.endsWith("/v1/automations") && m === "POST") {
      // GUI/onboarding-recipe create (§24) — mirrors the server: title+instructions+cron
      // required; §25 permissions become always_allowed entries (write grants only).
      const body = req.postDataJSON() || {};
      if (!body.title || !body.instructions || !(body.cron || body.fire_at))
        return json({ ok: false, error: "missing fields" });
      const grants = (body.permissions || [])
        .filter((g: any) => g && g.access === "write" && g.tool && g.target)
        .map((g: any) => ({ entry: `${g.tool} ${g.target}`, tool: g.tool, target: g.target }));
      const task = {
        ...AUTOMATION,
        id: `task-ob-${automations.length}`,
        title: body.title,
        instructions: body.instructions,
        schedule: body.cron || body.fire_at,
        always_allowed: grants,
        run_count: 0,
      };
      automations.push(task);
      return json({ ok: true, task });
    }
    if (p.endsWith("/v1/automations")) return json({ tasks: automations });
    if (p.endsWith("/v1/settings/onboarded") && m === "POST") {
      return json({ ok: true, onboarded: !!(req.postDataJSON() || {}).value });
    }
    // MCP servers — mutable so the OAuth quick-add (granola) flow reflects through the
    // UI: add → needs_auth, connect → authorizing, next poll → connected (6 tools).
    if (p.endsWith("/v1/mcp") && m === "GET") {
      for (const s2 of mcpServers) {
        if (s2.status === "authorizing" && s2._flip) {
          s2.status = "connected";
          s2.tool_count = 6;
        }
        if (s2.status === "authorizing") s2._flip = true;
      }
      return json({ servers: mcpServers.map(({ _flip, ...s2 }) => s2) });
    }
    if (p.endsWith("/v1/mcp") && m === "POST") {
      const b = req.postDataJSON();
      mcpServers.push({
        name: b.name,
        enabled: true,
        transport: b.config?.url ? "http" : "stdio",
        requires_approval: true,
        auth: b.config?.auth === "oauth" ? "oauth" : null,
        status: b.config?.auth === "oauth" ? "needs_auth" : "configured",
        last_error: null,
        tool_count: null,
        config: b.config || {},
      });
      return json({ ok: true, name: b.name });
    }
    {
      const mc = p.match(/\/v1\/mcp\/([^/]+)\/connect$/);
      if (mc && m === "POST") {
        const s2 = mcpServers.find((x) => x.name === decodeURIComponent(mc[1]));
        if (s2) s2.status = "authorizing";
        return json({ ok: true, started: true });
      }
      const ms = p.match(/\/v1\/mcp\/([^/]+)\/signout$/);
      if (ms && m === "POST") {
        const s2 = mcpServers.find((x) => x.name === decodeURIComponent(ms[1]));
        if (s2) {
          s2.status = "needs_auth";
          s2.tool_count = null;
          s2._flip = false;
        }
        return json({ ok: true });
      }
    }
    if (p.endsWith("/v1/unrouted")) return json([]);

    // channel subscriptions — mutable so add/remove reflect through the UI
    if (p.endsWith("/v1/subscriptions") && m === "GET") return json({ subscriptions });
    if (p.endsWith("/v1/subscriptions") && m === "POST") {
      const b = req.postDataJSON();
      // Backend parity with resolve_channel: Copy-link URLs resolve to the id; bare #names
      // can't be looked up and are rejected with the same hint the server gives.
      const raw = String(b.channel || "").trim();
      if (raw.startsWith("#"))
        return json({
          ok: false,
          error:
            "Channel names can't be looked up — paste the channel ID (channel name ▸ About) or the channel's Copy-link URL.",
        });
      const link = raw.match(/slack\.com\/archives\/([A-Za-z0-9]+)/);
      const channel = link ? `slack:${link[1].toUpperCase()}` : raw;
      subscriptions.push({ session_id: b.session_id, session_title: "", agent: "", channel, routing_target: null, collision: false });
      return json({ ok: true, channel });
    }
    if (p.endsWith("/v1/subscriptions/remove") && m === "POST") {
      const b = req.postDataJSON();
      const i = subscriptions.findIndex((s) => s.session_id === b.session_id && s.channel === b.channel);
      if (i >= 0) subscriptions.splice(i, 1);
      return json({ ok: true });
    }

    // Anything else: an empty-but-valid body. GET list endpoints read `?? []`/`?? {}` fallbacks.
    return json({});
  });
}

// A `test` whose page has the API mocked before navigation.
export const test = base.extend({
  page: async ({ page }, use) => {
    await mockApi(page);
    await use(page);
  },
});

export { expect };

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  convertDiscoveryPreparation,
  createDiscoveryIdempotencyKey,
  deleteDiscoverySource,
  getDiscovery,
  getDiscoveryConversionPrompt,
  getDiscoveryLaunchEvents,
  getDiscoveryLaunchStatus,
  intakeDiscoveryPreparation,
  resetDiscoveryPreparation,
  resumeDiscoveryLaunch,
  saveDiscoveryPreparation,
  saveDiscoveryConversionPrompt,
  saveDiscoveryRevision,
  startDiscoveryLaunch,
  stopDiscoveryLaunch,
  streamDiscoveryLaunchLog,
  type DiscoveryContext,
  type DiscoveryContextId,
  type DiscoveryActivityStream,
  type DiscoveryCheckpoint,
  type DiscoveryCheckpointKey,
  type DiscoveryConversionPrompt,
  type DiscoveryConversionState,
  type DiscoveryExecutionInput,
  type DiscoveryLaunchEvent,
  type DiscoveryLaunch,
  type DiscoveryLaunchStatus,
  type DiscoveryPreparation,
  type DiscoveryPreparationContent,
  type DiscoveryProgressTimeline,
  type DiscoverySnapshot,
  type DiscoveryTimelineMilestone,
  type DiscoverySourceEntry,
} from "../api";
import { Icon } from "./Icon";
import { DiscoveryArtifactPanel } from "./DiscoveryArtifacts";

const FALLBACK_CONTEXTS: DiscoveryContext[] = [
  {
    id: "preparation",
    label: "Preparation",
    description: "Gather and review research inputs before a launch.",
  },
  {
    id: "launch",
    label: "Current Launch",
    description: "Observe the active Discovery launch.",
  },
  {
    id: "history",
    label: "History",
    description: "Review completed and interrupted Discovery launches.",
  },
];

const CARD = "rounded-xl2 border border-line bg-panel";
const EMPTY_CONTENT: DiscoveryPreparationContent = { text: "", sources: [] };
const RAW_LOG_LINE_LIMIT = 2000;
const STAGES = [
  ["Gather", "Files and text"],
  ["Convert", "Explicit model action"],
  ["Review", "Edit and save"],
  ["Run", "Immutable Launch snapshot"],
] as const;

const HUMAN_REVIEW_CHECKPOINTS: Array<{
  key: DiscoveryCheckpointKey;
  order: number;
  label: string;
  short: string;
  reason: string;
  artifacts: Array<[string, string]>;
  preview: Array<[string, string]>;
}> = [
  {
    key: "mas",
    order: 1,
    label: "After MAS ranking",
    short: "Every ranking → AWAITING_FEEDBACK",
    reason: "Inspect ranked ideas before the next MAS cycle.",
    artifacts: [
      ["ranked-ideas.json", "scores + rank"],
      ["critique-and-evidence.md", "evidence links"],
      ["traj.json", "session trajectory"],
    ],
    preview: [
      ["Top candidates", "Ranking bundle"],
      ["Ranking context", "MAS iteration context"],
      ["Next operation", "Reflection / evolution"],
    ],
  },
  {
    key: "method",
    order: 2,
    label: "Before experiment",
    short: "One batch per Discovery Round",
    reason: "Inspect refined methods before ExperimentRunner or ReportWriter starts.",
    artifacts: [
      ["method-batch.json", "refined methods"],
      ["baseline-metrics.json", "run comparison"],
      ["execution-plan.md", "resources + limits"],
    ],
    preview: [
      ["Round", "Refined method batch"],
      ["Execution context", "Runtime configuration"],
      ["Next operation", "Experiment / report path"],
    ],
  },
  {
    key: "handoff",
    order: 3,
    label: "Before PaperOrchestra",
    short: "One checkpoint per Launch",
    reason: "Inspect the aggregate Discovery outcome before paper generation.",
    artifacts: [
      ["discovery_summary.json", "rounds + results"],
      ["candidate-reports/", "successful candidates"],
      ["paper-input-manifest.json", "source-faithful inputs"],
    ],
    preview: [
      ["Outcome", "Discovery summary"],
      ["Provenance", "Launch-owned artifacts"],
      ["Next operation", "One PaperOrchestra Run"],
    ],
  },
];

const CHECKPOINT_ORDER = new Map(
  HUMAN_REVIEW_CHECKPOINTS.map((checkpoint) => [checkpoint.key, checkpoint.order]),
);

type Busy =
  | "intake"
  | "save"
  | "delete"
  | "reset"
  | "convert"
  | "prompt"
  | "revision"
  | "launch"
  | "stop"
  | "resume"
  | null;

const EMPTY_CONVERSION: DiscoveryConversionState = {
  status: "pending",
  model_id: null,
  error: null,
  saved_revision_id: null,
  base_fingerprint: null,
  current_fingerprint: "",
};

const CONVERSION_STATUSES = ["pending", "editing", "saved", "dirty", "failed"] as const;

function normalizePreparation(raw: DiscoveryPreparation | { status?: string }): DiscoveryPreparation {
  const candidate = raw as Partial<DiscoveryPreparation>;
  const conversion = candidate.conversion as Partial<DiscoveryConversionState> | undefined;
  const status = CONVERSION_STATUSES.includes(conversion?.status as (typeof CONVERSION_STATUSES)[number])
    ? (conversion?.status as DiscoveryConversionState["status"])
    : EMPTY_CONVERSION.status;
  return {
    status:
      candidate.status === "draft" || candidate.status === "saved" ? candidate.status : "empty",
    dirty: candidate.dirty ?? false,
    draft: candidate.draft ?? EMPTY_CONTENT,
    saved: candidate.saved ?? EMPTY_CONTENT,
    revisions: Array.isArray(candidate.revisions)
      ? candidate.revisions.map((revision) => ({
          ...revision,
          execution_input: normalizeExecutionInput(revision.execution_input),
        }))
      : [],
    conversion: {
      ...EMPTY_CONVERSION,
      ...conversion,
      status,
      execution_input: normalizeExecutionInput(conversion?.execution_input),
    },
  };
}

function normalizeExecutionInput(raw: unknown): DiscoveryExecutionInput | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Partial<DiscoveryExecutionInput>;
  const constraints = Array.isArray(candidate.constraints)
    ? candidate.constraints.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return {
    task_description: String(candidate.task_description ?? ""),
    domain: String(candidate.domain ?? ""),
    background: String(candidate.background ?? ""),
    constraints,
    // Legacy Web revisions omitted the branch and were materialized as sci.
    task_type: candidate.task_type === "auto" ? "auto" : "sci",
  };
}

function executionInputEqual(left: DiscoveryExecutionInput | undefined, right: DiscoveryExecutionInput | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyProgressTimeline(): DiscoveryProgressTimeline {
  return {
    revision: 0,
    percent: 0,
    current_milestone_id: null,
    milestones: [],
  };
}

function emptyActivityStream(): DiscoveryActivityStream {
  return {
    oldest_sequence: null,
    newest_sequence: null,
    truncated_before_sequence: 0,
    items: [],
  };
}

function normalizeTimeline(raw: Partial<DiscoveryProgressTimeline> | undefined): DiscoveryProgressTimeline {
  if (!raw || !Array.isArray(raw.milestones)) return emptyProgressTimeline();
  const milestones: DiscoveryTimelineMilestone[] = raw.milestones.map((milestone, index) => ({
    id: milestone.id ?? `milestone-${index + 1}`,
    key: milestone.key ?? milestone.id ?? `milestone-${index + 1}`,
    label: milestone.label ?? milestone.key ?? `Milestone ${index + 1}`,
    position: milestone.position ?? index + 1,
    state: milestone.state ?? "pending",
    summary: milestone.summary ?? null,
    started_at: milestone.started_at ?? null,
    ended_at: milestone.ended_at ?? null,
    attempts: Array.isArray(milestone.attempts) ? milestone.attempts : [],
  }));
  return {
    revision: raw.revision ?? 0,
    percent: raw.percent ?? 0,
    current_milestone_id: raw.current_milestone_id ?? null,
    milestones,
  };
}

function normalizeActivity(raw: Partial<DiscoveryActivityStream> | undefined): DiscoveryActivityStream {
  if (!raw || !Array.isArray(raw.items)) return emptyActivityStream();
  return {
    oldest_sequence: raw.oldest_sequence ?? null,
    newest_sequence: raw.newest_sequence ?? null,
    truncated_before_sequence: raw.truncated_before_sequence ?? 0,
    items: raw.items,
  };
}

function canonicalCheckpointKey(value: unknown): DiscoveryCheckpointKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "mas" || normalized.includes("mas_ranking")) return "mas";
  if (normalized === "method" || normalized.includes("before_experiment")) return "method";
  if (
    normalized === "handoff" ||
    normalized.includes("paperorchestra") ||
    normalized.includes("paper_orchestra")
  ) {
    return "handoff";
  }
  return null;
}

function checkpointKeyFromRecord(checkpoint: DiscoveryCheckpoint | null | undefined): DiscoveryCheckpointKey | null {
  if (!checkpoint) return null;
  return (
    canonicalCheckpointKey(checkpoint.seam) ??
    canonicalCheckpointKey(checkpoint.stage) ??
    canonicalCheckpointKey(checkpoint.reason)
  );
}

function activeCheckpointKey(
  launch: DiscoveryLaunch | null,
  status: DiscoveryLaunchStatus | null,
): DiscoveryCheckpointKey | null {
  if (!launch) return null;
  return (
    checkpointKeyFromRecord(status?.checkpoint ?? launch.checkpoint) ??
    ((status?.state ?? launch.state) === "awaiting_review"
      ? canonicalCheckpointKey(status?.stage ?? launch.stage)
      : null)
  );
}

type CheckpointSlotState = "locked" | "active" | "done";

function checkpointSlotState(
  key: DiscoveryCheckpointKey,
  launch: DiscoveryLaunch | null,
  status: DiscoveryLaunchStatus | null,
): CheckpointSlotState {
  if (!launch) return "locked";
  const observedState = status?.state ?? launch.state;
  const active = activeCheckpointKey(launch, status);
  if (observedState === "completed") return "done";
  if (observedState === "awaiting_review" && active) {
    const activeOrder = CHECKPOINT_ORDER.get(active) ?? 0;
    const slotOrder = CHECKPOINT_ORDER.get(key) ?? 0;
    if (slotOrder < activeOrder) return "done";
    if (slotOrder === activeOrder) return "active";
  }

  const completed = (status?.checkpoints ?? [])
    .map((checkpoint) => checkpointKeyFromRecord(checkpoint))
    .filter((candidate): candidate is DiscoveryCheckpointKey => candidate !== null);
  if (completed.includes(key)) return "done";
  return "locked";
}

function checkpointStatusLabel(state: CheckpointSlotState): string {
  if (state === "active") return "Current checkpoint";
  if (state === "done") return "Available";
  return "Not reached";
}

function checkpointArtifactRows(
  definition: (typeof HUMAN_REVIEW_CHECKPOINTS)[number],
  launch: DiscoveryLaunch | null,
  status: DiscoveryLaunchStatus | null,
): Array<[string, string]> {
  if (!launch) return definition.artifacts;
  const checkpoint = status?.checkpoint ?? launch.checkpoint;
  const key = checkpointKeyFromRecord(checkpoint);
  if (key === definition.key && checkpoint?.artifacts?.length) {
    return checkpoint.artifacts.map(
      (artifact): [string, string] => [artifact.path, artifact.detail ?? artifact.label],
    );
  }
  return definition.artifacts;
}

function normalizeLaunchStatus(raw: DiscoveryLaunchStatus | DiscoverySnapshot): DiscoveryLaunchStatus | null {
  const candidate = raw as Partial<DiscoveryLaunchStatus> & Partial<DiscoverySnapshot>;
  const launch = candidate.launch ?? candidate.current_launch;
  if (!launch) return null;
  return {
    launch,
    state: candidate.state ?? launch.state,
    stage: candidate.stage ?? launch.stage,
    round: candidate.round ?? launch.round,
    checkpoint: candidate.checkpoint ?? launch.checkpoint ?? null,
    timeline: normalizeTimeline(candidate.timeline),
    activity: normalizeActivity(candidate.activity),
    allowed_actions: Array.isArray(candidate.allowed_actions) ? candidate.allowed_actions : [],
    produced_outputs: Array.isArray(candidate.produced_outputs) ? candidate.produced_outputs : [],
    checkpoints: Array.isArray(candidate.checkpoints) ? candidate.checkpoints : undefined,
    latest_event_sequence: candidate.latest_event_sequence ?? 0,
  };
}

function applyLaunchEvents(
  status: DiscoveryLaunchStatus,
  events: DiscoveryLaunchEvent[],
): DiscoveryLaunchStatus {
  return events.reduce((current, event) => {
    const data = event.data;
    if (event.type === "work.state.updated") {
      const state = typeof data.state === "string" ? data.state : current.state;
      const stage = typeof data.stage === "string" ? data.stage : current.stage;
      const round = typeof data.round === "number" ? data.round : current.round;
      return {
        ...current,
        state: state as DiscoveryLaunchStatus["state"],
        stage,
        round,
        launch: { ...current.launch, state: state as DiscoveryLaunch["state"], stage, round },
      };
    }
    if (event.type === "progress.milestone.updated" && data.timeline) {
      return {
        ...current,
        timeline: normalizeTimeline(data.timeline as Partial<DiscoveryProgressTimeline>),
      };
    }
    if (event.type === "checkpoint.created" && data.checkpoint && typeof data.checkpoint === "object") {
      const checkpoint = data.checkpoint as DiscoveryCheckpoint;
      return {
        ...current,
        state: "awaiting_review",
        stage: checkpoint.stage,
        round: checkpoint.round,
        checkpoint,
        allowed_actions: ["resume"],
        launch: {
          ...current.launch,
          state: "awaiting_review",
          stage: checkpoint.stage,
          round: checkpoint.round,
          checkpoint,
          resumable: true,
        },
      };
    }
    return current;
  }, status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The Discovery sidecar rejected this change.";
}

function hasPreparationInput(content: DiscoveryPreparationContent): boolean {
  return Boolean(content.text.trim() || content.sources.length);
}

function isCommittedPreparation(preparation: DiscoveryPreparation): boolean {
  return preparation.status === "saved" && !preparation.dirty && hasPreparationInput(preparation.draft);
}

function withDraftText(snapshot: DiscoverySnapshot, text: string): DiscoverySnapshot {
  const preparation = normalizePreparation(snapshot.preparation);
  const draft = { ...preparation.draft, text };
  const dirty =
    draft.text !== preparation.saved.text ||
    JSON.stringify(draft.sources) !== JSON.stringify(preparation.saved.sources);
  const status = dirty
    ? "draft"
    : hasPreparationInput(draft)
      ? "saved"
      : "empty";
  const savedRevision = preparation.conversion.saved_revision_id
    ? preparation.revisions.find(
        (revision) => revision.revision_id === preparation.conversion.saved_revision_id,
      )
    : null;
  let conversion = preparation.conversion;
  if (dirty) {
    conversion = { ...conversion, status: "dirty", error: null };
  } else if (
    conversion.status === "dirty" &&
    savedRevision?.eligible &&
    savedRevision.execution_input &&
    executionInputEqual(
      conversion.execution_input,
      savedRevision.execution_input,
    )
  ) {
    conversion = { ...conversion, status: "saved", error: null };
  } else if (
    conversion.status === "dirty" &&
    !conversion.execution_input
  ) {
    conversion = { ...conversion, status: "pending", error: null };
  }
  return {
    ...snapshot,
    preparation: { ...preparation, status, dirty, draft, conversion },
  };
}

function EmptyContext({ context }: { context: DiscoveryContextId }) {
  if (context === "preparation") return null;

  if (context === "launch") {
    return <PrototypeLaunchHero launch={null} status={null} />;
  }

  return (
    <section className={CARD + " p-5 sm:p-6"} aria-labelledby="discovery-history-heading">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper text-muted">
          <Icon name="library" size={17} />
        </span>
        <div>
          <h2 id="discovery-history-heading" className="text-[15px] font-semibold text-ink">
            No Launch history yet
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            Completed, stopped, or interrupted Discovery launches will stay available here as
            read-only records.
          </p>
        </div>
      </div>
    </section>
  );
}

function prototypeLaunchShortId(launch: DiscoveryLaunch): string {
  return launch.launch_id.slice(0, 12);
}

function prototypeLaunchTitle(launch: DiscoveryLaunch): string {
  const title = launch.title ?? launch.input_summary?.title;
  if (typeof title === "string" && title.trim()) {
    return title.length <= 54 ? title : `${title.slice(0, 51)}...`;
  }
  return `Discovery Launch ${prototypeLaunchShortId(launch)}`;
}

function prototypeTextLanguage(value: string): "zh-CN" | "en" {
  return /[\u3400-\u9fff]/u.test(value) ? "zh-CN" : "en";
}

function prototypeLaunchIsActive(launch: DiscoveryLaunch): boolean {
  return launch.state === "starting" || launch.state === "running" || launch.state === "stopping";
}

function prototypeMilestoneState(
  milestone: DiscoveryProgressTimeline["milestones"][number],
  currentMilestoneId: string | null | undefined,
): "done" | "active" | "pending" {
  const done = milestone.state === "completed";
  const active =
    !done &&
    (milestone.id === currentMilestoneId || milestone.state === "active" || milestone.state === "running");
  return done ? "done" : active ? "active" : "pending";
}

function prototypeLaunchElapsed(launch: DiscoveryLaunch): string {
  const startedAt = Date.parse(launch.started_at ?? launch.created_at ?? "");
  if (!Number.isFinite(startedAt)) return "—";
  const endedAt = launch.completed_at ? Date.parse(launch.completed_at) : Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function prototypeLaunchStageLabel(status: DiscoveryLaunchStatus | null, fallback: string): string {
  const currentMilestone = status?.timeline.milestones.find(
    (milestone) => milestone.id === status.timeline.current_milestone_id || milestone.state === "active" || milestone.state === "running",
  );
  return currentMilestone?.summary ?? currentMilestone?.label ?? fallback;
}

function prototypeLaunchStateLabel(state: string): string {
  if (state === "awaiting_review") return "Awaiting review";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function PrototypeStatusPill({ state }: { state: DiscoveryLaunch["state"] }) {
  const live = state === "starting" || state === "running" || state === "stopping";
  const stateClass =
    state === "completed"
      ? "is-ready"
      : state === "failed" || state === "interrupted"
        ? "is-danger"
        : live ? "is-live" : "is-warn";
  return (
    <span className={`discovery-status-pill ${state === "awaiting_review" ? "is-review" : ""}`}>
      <span className={`discovery-status-dot ${stateClass}`} />
      {state === "awaiting_review" ? "Execution inactive" : state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

function PrototypeLaunchAction({
  launch,
  busy,
  onStop,
  onResume,
}: {
  launch: DiscoveryLaunch;
  busy: Busy;
  onStop?: () => void;
  onResume?: () => void;
}) {
  const resumable =
    launch.state === "awaiting_review" ||
    ((launch.state === "stopped" || launch.state === "interrupted") && launch.resumable);
  if (prototypeLaunchIsActive(launch) && onStop) {
    return (
      <button
        type="button"
        className="discovery-button discovery-button-small"
        disabled={busy === "stop" || launch.state === "stopping"}
        onClick={onStop}
      >
        {launch.state === "stopping" || busy === "stop" ? "Stopping..." : "Stop"}
      </button>
    );
  }
  if (resumable && onResume) {
    return (
      <button
        type="button"
        className="discovery-button discovery-button-small discovery-button-primary"
        disabled={busy === "resume"}
        onClick={onResume}
      >
        {busy === "resume" ? "Resuming..." : "Resume"}
      </button>
    );
  }
  return null;
}

function DiscoveryLaunchNotice({
  launch,
  status,
}: {
  launch: DiscoveryLaunch | null;
  status: DiscoveryLaunchStatus | null;
}) {
  const active = activeCheckpointKey(launch, status);
  const activeDefinition = HUMAN_REVIEW_CHECKPOINTS.find((checkpoint) => checkpoint.key === active);
  const observedState = status?.state ?? launch?.state ?? "idle";
  const awaitingReview = observedState === "awaiting_review" && Boolean(activeDefinition);
  const errorState = observedState === "failed" || observedState === "interrupted";
  const message = !launch
    ? "Preparation is the current state. Start a Discovery run from Preparation when you are ready."
    : awaitingReview
    ? `Execution inactive at ${activeDefinition!.label}. Review the read-only bundle, then Resume.`
    : observedState === "failed"
      ? launch.error
        ? `Launch failed: ${launch.error}`
        : "Launch failed. Open Current Launch for the failure details."
    : observedState === "interrupted"
      ? "Launch interrupted. Review its durable checkpoint before resuming."
    : observedState === "stopped"
      ? "Launch stopped at a durable checkpoint. Resume it when you are ready."
    : observedState === "completed"
      ? "This Launch is complete. All three checkpoint bundles remain available as read-only history."
      : "The Launch is active. Checkpoint slots remain unavailable until their boundary is reached.";
  return (
    <div className={`discovery-launch-notice ${awaitingReview ? "is-review" : ""} ${errorState ? "is-error" : ""} ${!launch ? "is-empty" : ""}`} role="status">
      <span className="discovery-launch-notice-dot" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function DiscoveryCheckpointStrip({
  launch,
  status,
  selected,
  onSelect,
}: {
  launch: DiscoveryLaunch | null;
  status: DiscoveryLaunchStatus | null;
  selected: DiscoveryCheckpointKey;
  onSelect: (key: DiscoveryCheckpointKey) => void;
}) {
  return (
    <section
      className="discovery-checkpoint-strip"
      aria-label="Human review checkpoints"
      data-testid="discovery-checkpoint-strip"
    >
      <div className="discovery-checkpoint-strip-head">
        <div>
          <h3>Review checkpoints</h3>
          <span>Fixed Launch artifacts · open as each seam is reached</span>
        </div>
        <span className="discovery-checkpoint-strip-count">3 seams</span>
      </div>
      <div className="discovery-checkpoint-grid">
        {HUMAN_REVIEW_CHECKPOINTS.map((definition) => {
          const state = checkpointSlotState(definition.key, launch, status);
          const disabled = state === "locked";
          const artifacts = checkpointArtifactRows(definition, launch, status);
          return (
            <article
              key={definition.key}
              className={`discovery-checkpoint-slot is-${state} ${selected === definition.key ? "is-selected" : ""}`}
              aria-disabled={disabled ? "true" : undefined}
              aria-current={selected === definition.key ? "true" : undefined}
              data-testid={`discovery-checkpoint-slot-${definition.key}`}
            >
              <div className="discovery-checkpoint-slot-top">
                <span className="discovery-checkpoint-icon" aria-hidden="true">
                  {state === "done" ? "✓" : state === "active" ? "•" : "—"}
                </span>
                <div className="discovery-checkpoint-slot-title">
                  <strong>{definition.label}</strong>
                  <span>{definition.short}</span>
                </div>
                <span className="discovery-checkpoint-status">{checkpointStatusLabel(state)}</span>
              </div>
              <p>{definition.reason}</p>
              <div className="discovery-checkpoint-artifacts">
                {artifacts.map(([name, detail]) => (
                  <div key={name} className={`discovery-checkpoint-artifact ${disabled ? "is-disabled" : ""}`}>
                    <span>{name}</span>
                    <span>{detail}</span>
                  </div>
                ))}
              </div>
              <div className="discovery-checkpoint-slot-footer">
                <span className="discovery-checkpoint-readonly">
                  {disabled ? "Available after seam" : "Read-only bundle"}
                </span>
                {disabled ? (
                  <span className="discovery-checkpoint-lock">Locked</span>
                ) : (
                  <button
                    type="button"
                    className="discovery-checkpoint-open"
                    onClick={() => onSelect(definition.key)}
                    aria-label={`Open ${definition.label} checkpoint bundle`}
                  >
                    Open
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function prototypeLaunchCanResume(launch: DiscoveryLaunch): boolean {
  return (
    launch.state === "awaiting_review" ||
    ((launch.state === "stopped" || launch.state === "interrupted") && Boolean(launch.resumable))
  );
}

function prototypeLaunchListSummary(launch: DiscoveryLaunch, observedState: string): string {
  if (observedState === "failed") {
    return launch.error ?? "The Launch failed before a trusted terminal outcome was recorded.";
  }
  if (observedState === "interrupted") {
    return launch.error ?? "The worker stopped unexpectedly. Its last durable checkpoint remains available.";
  }
  if (observedState === "stopped") {
    return launch.stop_reason ?? "The Launch was stopped at a durable checkpoint.";
  }
  if (observedState === "completed") {
    return launch.outcome?.trim() || `Completed ${launch.stage} in round ${launch.round}.`;
  }
  if (observedState === "awaiting_review") {
    return "Execution is paused at a deliberate human review seam.";
  }
  return `${prototypeLaunchStateLabel(observedState)} · ${launch.stage}`;
}

function PrototypeHistoryConsolidatedRow({
  launch,
  selected,
  onSelect,
  index,
  status,
  selectedIsActive,
  busy,
  onStop,
  onResume,
}: {
  launch: DiscoveryLaunch;
  selected: boolean;
  onSelect: () => void;
  index: number;
  status: DiscoveryLaunchStatus | null;
  selectedIsActive: boolean;
  busy: Busy;
  onStop?: () => void;
  onResume?: () => void;
}) {
  const title = prototypeLaunchTitle(launch);
  const started = launch.started_at ?? launch.created_at;
  const date = started
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(started))
    : "—";
  const time = started
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(started))
    : "—";
  const statusMatches = status?.launch.launch_id === launch.launch_id;
  const observedState = statusMatches ? status.state : launch.state;
  const summary = prototypeLaunchListSummary(launch, observedState);
  const sourceCount = launch.input_summary?.source_count ?? launch.input_summary?.sources?.length ?? 0;
  const outputCount = statusMatches ? status?.produced_outputs.length ?? 0 : null;
  const hasAction =
    (selectedIsActive && Boolean(onStop) && prototypeLaunchIsActive(launch)) ||
    (!selectedIsActive && Boolean(onResume) && prototypeLaunchCanResume(launch));
  return (
    <article className={`discovery-history-consolidated-row ${selected ? "is-selected" : ""} ${observedState === "failed" || observedState === "interrupted" ? "is-error" : ""} ${hasAction ? "has-action" : ""}`}>
      <button
        type="button"
        className="discovery-history-consolidated-hit"
        aria-label={`Select ${prototypeLaunchTitle(launch)}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="discovery-history-consolidated-grid">
          <span className="discovery-history-consolidated-main">
            <span className="discovery-history-consolidated-main-top"><span className="discovery-history-consolidated-index">{String(index + 1).padStart(2, "0")}</span><strong className="discovery-history-consolidated-title" lang={prototypeTextLanguage(title)}>{title}</strong></span>
            <span className="discovery-history-consolidated-summary" lang={prototypeTextLanguage(summary)}>{summary}</span>
          </span>
          <span className="discovery-history-consolidated-started"><span className="discovery-history-consolidated-label">Started</span><span className="discovery-history-consolidated-value">{date}</span><span className="discovery-history-consolidated-muted">{time} · Round {String(launch.round).padStart(2, "0")}</span></span>
          <span className="discovery-history-consolidated-facts"><span><span className="discovery-history-consolidated-label">Duration</span><strong>{prototypeLaunchElapsed(launch)}</strong></span><span><span className="discovery-history-consolidated-label">Sources</span><strong>{sourceCount || "—"}</strong></span><span><span className="discovery-history-consolidated-label">Outputs</span><strong>{outputCount === null ? "—" : outputCount}</strong></span></span>
          <span className="discovery-history-consolidated-tail"><PrototypeStatusPill state={observedState as DiscoveryLaunch["state"]} /><span className="discovery-history-consolidated-workspace">{launch.input_summary?.preparation_id ?? launch.preparation_id}</span><span className="discovery-history-consolidated-id">{prototypeLaunchShortId(launch)}</span></span>
        </span>
      </button>
      {hasAction && (
        <div className="discovery-history-consolidated-action">
          <PrototypeLaunchAction launch={{ ...launch, state: observedState as DiscoveryLaunch["state"] }} busy={busy} onStop={onStop} onResume={onResume} />
        </div>
      )}
    </article>
  );
}

function prototypeActivityTime(value: string | undefined, sequence: number): string {
  const match = value?.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? String(sequence).padStart(2, "0");
}

function PrototypeRuntimeDesk({
  status,
  busy,
  emptyState = false,
  rawOpen,
  rawLines,
  rawError,
  onToggleRaw,
  onStop,
  onResume,
}: {
  status: DiscoveryLaunchStatus | null;
  busy: Busy;
  emptyState?: boolean;
  rawOpen: boolean;
  rawLines: string[];
  rawError: string | null;
  onToggleRaw: () => void;
  onStop?: () => void;
  onResume?: () => void;
}) {
  const rawConsoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (rawOpen && rawConsoleRef.current) {
      rawConsoleRef.current.scrollTop = rawConsoleRef.current.scrollHeight;
    }
  }, [rawLines, rawOpen]);

  if (!status && emptyState) {
    return (
      <div className="discovery-runtime-desk is-empty" aria-label="Runtime Desk" data-testid="runtime-desk">
        <section className="discovery-prototype-panel discovery-runtime-pulse-panel" aria-label="Runtime pulse">
          <div className="discovery-prototype-panel-head">
            <div>
              <h3>Runtime pulse</h3>
              <span>Standby until a Launch is confirmed</span>
            </div>
            <button
              type="button"
              className="discovery-button discovery-button-quiet"
              aria-expanded={rawOpen}
              disabled={!rawOpen}
              onClick={rawOpen ? onToggleRaw : undefined}
            >
              {rawOpen ? "Hide Raw Console" : "View Raw Console"}
            </button>
          </div>
          <div className="discovery-runtime-events discovery-runtime-empty-panel">
            No runtime events yet. Start a Discovery run from Preparation when you are ready.
          </div>
          {rawOpen && (
            <div className="discovery-raw-console discovery-raw-console-in" aria-label="Raw Discovery Console">
              <div className="discovery-raw-console-head"><span>Raw Discovery Console</span><span>stdout + stderr</span></div>
              <pre ref={rawConsoleRef}>Waiting for a Launch before runner.log output is available...</pre>
            </div>
          )}
          <div className="discovery-runtime-footer">
            <span>Standby · no process started</span>
          </div>
        </section>
      </div>
    );
  }
  if (!status) {
    return (
      <section className="discovery-prototype-panel p-5" aria-label="Runtime Desk" aria-busy="true">
        <h2 className="text-[15px] font-semibold text-ink">Runtime Desk</h2>
        <p className="mt-1.5 text-[12px] text-muted">Loading the server-authoritative Launch status.</p>
      </section>
    );
  }
  const canStop = status.allowed_actions.includes("stop") && Boolean(onStop);
  const canResume = status.allowed_actions.includes("resume") && Boolean(onResume);
  const lastActivity = status.activity.items[status.activity.items.length - 1];
  const lastDurableUpdate = lastActivity
    ? prototypeActivityTime(lastActivity.occurred_at, lastActivity.sequence)
    : "—";
  return (
    <div className="discovery-runtime-desk is-live" aria-label="Runtime Desk" data-testid="runtime-desk">
      <section className="discovery-prototype-panel discovery-runtime-pulse-panel" aria-label="Runtime pulse">
        <div className="discovery-prototype-panel-head">
          <div>
            <h3>Runtime pulse</h3>
            <span>Curated state changes, newest first</span>
          </div>
          <button type="button" className="discovery-button discovery-button-quiet" aria-expanded={rawOpen} onClick={onToggleRaw}>
            {rawOpen ? "Hide Raw Console" : "View Raw Console"}
          </button>
        </div>
        <div className="discovery-runtime-events">
          {status.activity.items.length ? status.activity.items.map((item) => {
            const tone = item.level === "error" ? "danger" : item.level === "warning" ? "warn" : "normal";
            const milestone = item.milestone_id
              ? status.timeline.milestones.find((candidate) => candidate.id === item.milestone_id)
              : null;
            const stateLabel =
              item.level === "error"
                ? "Error"
                : milestone?.state === "completed" || status.state === "completed" || status.state === "failed" || status.state === "stopped"
                  ? "Done"
                  : "Live";
            return (
              <div key={item.sequence} className={`discovery-runtime-event discovery-runtime-event-in ${tone}`}>
                <span className="discovery-runtime-event-time">{prototypeActivityTime(item.occurred_at, item.sequence)}</span>
                <div className="discovery-runtime-event-copy">
                  <strong>{item.text}</strong>
                  <span>{milestone?.summary ?? (item.milestone_id ? `Milestone: ${item.milestone_id}` : "Launch event")}</span>
                </div>
                <span className="discovery-runtime-event-state">{stateLabel}</span>
              </div>
            );
          }) : (
            <div className="discovery-runtime-empty">No curated activity yet.</div>
          )}
        </div>
        {rawOpen && (
          <div className="discovery-raw-console discovery-raw-console-in" aria-label="Raw Discovery Console">
            <div className="discovery-raw-console-head"><span>Raw Discovery Console</span><span>stdout + stderr</span></div>
            <pre ref={rawConsoleRef}>{rawLines.length ? rawLines.join("") : "Waiting for durable runner.log output..."}</pre>
            {rawError && <p role="alert">{rawError}</p>}
          </div>
        )}
      </section>

      <div className="discovery-runtime-footer">
        <div className="discovery-beacon-runtime-meta">
          <span>Last durable update {lastDurableUpdate}</span>
          <span>launch_id {prototypeLaunchShortId(status.launch)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canStop && <button type="button" className="discovery-button discovery-button-small" disabled={busy === "stop"} onClick={onStop}>{busy === "stop" ? "Stopping..." : "Stop"}</button>}
          {canResume && <button type="button" className="discovery-button discovery-button-small discovery-button-primary" disabled={busy === "resume"} onClick={onResume}>{busy === "resume" ? "Resuming..." : "Resume"}</button>}
        </div>
      </div>
      <div className="discovery-beacon-legend" aria-label="Launch state legend">
        <span><i className="is-live" />Live state</span>
        <span><i className="is-durable" />Durable checkpoint</span>
        <span><i className="is-pending" />Awaiting start</span>
      </div>
    </div>
  );
}

function PrototypeLaunchHero({
  launch,
  status,
}: {
  launch: DiscoveryLaunch | null;
  status: DiscoveryLaunchStatus | null;
}) {
  const standby = !launch;
  const milestones = status?.timeline.milestones ?? [];
  const currentMilestoneId = status?.timeline.current_milestone_id;
  const currentMilestone = milestones.find(
    (milestone) => milestone.id === currentMilestoneId || prototypeMilestoneState(milestone, currentMilestoneId) === "active",
  );
  const observedState = String(status?.state ?? launch?.state ?? "preparation");
  const observedStage = standby
    ? "Preparation"
    : prototypeLaunchStageLabel(status, currentMilestone?.summary ?? currentMilestone?.label ?? launch?.stage ?? "Preparation");
  const stateLabel = standby ? "Ready to launch" : prototypeLaunchStateLabel(observedState);
  const signalCopy =
    standby
      ? "Preparation is the current state. Confirm a Launch from Preparation when you are ready to begin."
      : observedState === "awaiting_review"
      ? "The run is paused at a deliberate human seam. Review the read-only bundle before resuming."
      : observedState === "failed"
        ? launch?.error
          ? `The Launch failed: ${launch.error}`
          : "The Launch failed before it produced a trusted terminal outcome. Open Current Launch for details."
      : observedState === "interrupted"
        ? "The worker stopped unexpectedly. Review the durable checkpoint before resuming."
      : observedState === "stopped"
        ? "The Launch was stopped at a durable checkpoint. Resume it when you are ready."
      : observedState === "completed"
        ? "The run is complete. Its timeline and artifacts remain available as immutable history."
        : "Evidence is moving through the current seam. The Launch remains interruptible and durable artifacts stay preserved.";
  return (
    <section className={`discovery-prototype-panel discovery-hero-panel discovery-beacon-hero ${standby ? "is-standby" : ""} ${observedState === "failed" || observedState === "interrupted" ? "is-error" : ""}`} aria-label="Current Discovery Launch">
      <div className="discovery-beacon-signal">
        <div className="discovery-beacon-signal-head">
          <div className="discovery-beacon-orb" aria-hidden="true"><span /></div>
          <div className="min-w-0">
            <div className="discovery-beacon-eyebrow">
              {standby ? "CURRENT OBSERVATION · PREPARATION" : `Live observation · round ${String(launch?.round ?? 0).padStart(2, "0")}`}
            </div>
            <h2 className="discovery-launch-title discovery-beacon-title">{observedStage}</h2>
            <p className="discovery-beacon-copy">{signalCopy}</p>
          </div>
        </div>
        <div className="discovery-beacon-track" aria-label="Launch timeline">
          <div className="discovery-beacon-track-head"><strong>Launch timeline</strong><span>semantic state rail</span></div>
          <div className="discovery-beacon-stage-list">
            {milestones.length ? milestones.map((milestone) => {
              const state = prototypeMilestoneState(milestone, currentMilestoneId);
              return (
                <div key={milestone.id} className={`discovery-beacon-stage is-${state}`}>
                  <strong>{milestone.label}</strong>
                  <span>{milestone.summary ?? (state === "done" ? "Completed" : state === "active" ? "In progress" : "Awaiting start")}</span>
                  <em>{state === "done" ? "DONE" : state === "active" ? "LIVE" : "NEXT"}</em>
                </div>
              );
            }) : (
              <div className={`discovery-beacon-stage ${standby ? "is-standby" : "is-active"}`}>
                <strong>{observedStage}</strong>
                <span>{standby ? "Waiting for a confirmed Launch" : "Waiting for the first durable timeline snapshot"}</span>
                <em>{standby ? "READY" : "LIVE"}</em>
              </div>
            )}
          </div>
        </div>
        {launch && <span className="sr-only">Launch {prototypeLaunchShortId(launch)}</span>}
        <span className="sr-only">{observedState}</span>
        {observedState === "awaiting_review" && <span className="sr-only">Execution inactive</span>}
      </div>
      <div className="discovery-beacon-metrics">
        <div className="discovery-beacon-metric"><span>State</span><strong>{stateLabel}</strong><small>server-authoritative</small></div>
        <div className="discovery-beacon-metric"><span>Elapsed</span><strong>{launch ? prototypeLaunchElapsed(launch) : "—"}</strong><small>since Launch start</small></div>
        <div className="discovery-beacon-metric"><span>Current seam</span><strong>{currentMilestone ? `${String(currentMilestone.position).padStart(2, "0")} / ${String(milestones.length).padStart(2, "0")}` : "—"}</strong><small>{currentMilestone?.label ?? observedStage}</small></div>
        <div className="discovery-beacon-metric"><span>Artifacts</span><strong>{status?.produced_outputs.length ?? 0}</strong><small>read-only references</small></div>
      </div>
    </section>
  );
}

function LaunchContext({
  launch,
  busy,
  onStop,
  onResume,
  error,
  runtimeStatus,
  rawOpen,
  rawLines,
  rawError,
  onToggleRaw,
}: {
  launch: DiscoveryLaunch | null;
  busy: Busy;
  onStop: () => void;
  onResume: () => void;
  error: string | null;
  runtimeStatus: DiscoveryLaunchStatus | null;
  rawOpen: boolean;
  rawLines: string[];
  rawError: string | null;
  onToggleRaw: () => void;
}) {
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<DiscoveryCheckpointKey | null>(null);
  const fallbackCheckpoint = launch
    ? activeCheckpointKey(launch, runtimeStatus) ??
      HUMAN_REVIEW_CHECKPOINTS.find(
        (checkpoint) => checkpointSlotState(checkpoint.key, launch, runtimeStatus) !== "locked",
      )?.key ??
      "mas"
    : "mas";
  const selectedCheckpointKey =
    launch &&
    selectedCheckpoint &&
    checkpointSlotState(selectedCheckpoint, launch, runtimeStatus) !== "locked"
      ? selectedCheckpoint
      : fallbackCheckpoint;

  return (
    <>
      <div className="discovery-stage-strip-layout discovery-stage-strip-layout-ma">
        <PrototypeLaunchHero
          launch={launch}
          status={runtimeStatus}
        />
        {launch && <DiscoveryLaunchNotice launch={launch} status={runtimeStatus} />}
        <div className="discovery-ma-runtime-row">
          <PrototypeRuntimeDesk
            status={runtimeStatus}
            busy={busy}
            emptyState={!launch}
            rawOpen={rawOpen}
            rawLines={rawLines}
            rawError={rawError}
            onToggleRaw={onToggleRaw}
            onStop={onStop}
            onResume={onResume}
          />
        </div>
        <div className="discovery-ma-checkpoint-row">
          <DiscoveryCheckpointStrip
            launch={launch}
            status={runtimeStatus}
            selected={selectedCheckpointKey}
            onSelect={setSelectedCheckpoint}
          />
        </div>
        <div className="discovery-ma-artifact-row discovery-artifact-rail">
          <DiscoveryArtifactPanel launchId={launch?.launch_id ?? null} />
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function HistoryContext({
  currentLaunch,
  history,
  selectedId,
  busy,
  onSelect,
  onResume,
  onStop,
  error,
  runtimeStatus,
  rawOpen,
  rawLines,
  rawError,
  onToggleRaw,
}: {
  currentLaunch: DiscoveryLaunch | null;
  history: DiscoveryLaunch[];
  selectedId: string | null;
  busy: Busy;
  onSelect: (launchId: string) => void;
  onResume: (launch: DiscoveryLaunch) => void;
  onStop: () => void;
  error: string | null;
  runtimeStatus: DiscoveryLaunchStatus | null;
  rawOpen: boolean;
  rawLines: string[];
  rawError: string | null;
  onToggleRaw: () => void;
}) {
  if (!history.length && !currentLaunch) {
    return (
      <>
        <EmptyContext context="history" />
        {error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }
  // Reconciliation can briefly retain the same immutable launch in both the active slot and
  // history (or replay it twice in history). The UI is a projection, so it must render each
  // launch once rather than relying on React keys to mask an inconsistent transport snapshot.
  const launches = [...(currentLaunch ? [currentLaunch] : []), ...history].filter(
    (launch, index, all) => all.findIndex((candidate) => candidate.launch_id === launch.launch_id) === index,
  );
  const selected = launches.find((launch) => launch.launch_id === selectedId) ?? launches[0];
  const selectedIsActive = currentLaunch?.launch_id === selected.launch_id;
  return (
    <>
      <div className="discovery-history-consolidated" aria-label="Discovery Launch history">
        <section className="discovery-history-consolidated-frame" aria-label="Launch records">
          <div className="discovery-history-consolidated-frame-head"><strong>Launch records</strong><span>Newest first <i aria-hidden="true" /> List only</span></div>
          <div className="discovery-history-consolidated-list" tabIndex={0} aria-label="Scrollable launch history">
            {launches.map((launch, index) => (
              <PrototypeHistoryConsolidatedRow
                key={launch.launch_id}
                launch={launch}
                selected={launch.launch_id === selected.launch_id}
                onSelect={() => onSelect(launch.launch_id)}
                index={index}
                status={runtimeStatus}
                selectedIsActive={selectedIsActive && launch.launch_id === selected.launch_id}
                busy={busy}
                onStop={selectedIsActive && launch.launch_id === selected.launch_id ? onStop : undefined}
                onResume={!selectedIsActive && launch.launch_id === selected.launch_id ? () => onResume(selected) : undefined}
              />
            ))}
          </div>
        </section>
      </div>
      <div className="discovery-history-selected-surface">
        <LaunchContext
          launch={selected}
          busy={busy}
          onStop={selectedIsActive ? onStop : () => undefined}
          onResume={() => onResume(selected)}
          error={error}
          runtimeStatus={runtimeStatus}
          rawOpen={rawOpen}
          rawLines={rawLines}
          rawError={rawError}
          onToggleRaw={onToggleRaw}
        />
      </div>
      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function StageCanvas({ preparation }: { preparation: DiscoveryPreparation }) {
  const preparationSaved = isCommittedPreparation(preparation);
  const conversionReady =
    Boolean(preparation.conversion.execution_input) && preparation.conversion.status !== "failed";
  const revisionSaved =
    preparationSaved &&
    preparation.conversion.status === "saved" &&
    preparation.revisions.some(
      (revision) =>
        revision.revision_id === preparation.conversion.saved_revision_id && revision.eligible,
    );
  const activeStage = revisionSaved ? 4 : conversionReady ? 3 : preparationSaved ? 2 : 1;
  const completed = [preparationSaved, conversionReady, revisionSaved, false];

  return (
    <div className="discovery-stage-bar" aria-label="Preparation stages" role="list">
      {STAGES.map(([stage, description], index) => {
        const stageNumber = index + 1;
        return (
          <div
            key={stage}
            className={`discovery-stage ${activeStage >= stageNumber ? "is-active" : ""}`}
            role="listitem"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-extrabold tracking-[0.08em] text-faint">
                0{stageNumber}
              </span>
              {completed[index] && (
                <span className="discovery-stage-complete" aria-label="Completed">
                  ✓
                </span>
              )}
            </div>
            <strong className="mt-1 block text-[12px] font-semibold text-ink">{stage}</strong>
            <small className="mt-0.5 block text-[10.5px] text-muted">{description}</small>
          </div>
        );
      })}
    </div>
  );
}

function SourceStrip({
  sources,
  busy,
  onDelete,
}: {
  sources: DiscoverySourceEntry[];
  busy: boolean;
  onDelete: (source: DiscoverySourceEntry) => void;
}) {
  if (!sources.length) {
    return <span className="text-[11px] text-faint">No files yet.</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Accepted Source Entries">
      {sources.map((source) => (
        <li key={source.source_id}>
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-[11px] text-muted">
            <span className="font-semibold text-faint">{source.extension.replace(".", "").toUpperCase()}</span>
            <span className="max-w-[220px] truncate">{source.filename}</span>
            <button
              type="button"
              className="text-[16px] leading-none text-faint transition-colors hover:text-danger disabled:cursor-wait disabled:opacity-50"
              aria-label={`Remove ${source.filename}`}
              disabled={busy}
              onClick={() => onDelete(source)}
            >
              ×
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function GatherContext({
  preparation,
  text,
  resetNotice,
  busy,
  error,
  onTextChange,
  onFiles,
  onSave,
  onDelete,
}: {
  preparation: DiscoveryPreparation;
  text: string;
  resetNotice: boolean;
  busy: Busy;
  error: string | null;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onSave: () => void;
  onDelete: (source: DiscoverySourceEntry) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEmpty = !hasPreparationInput(preparation.draft);
  const statusLabel =
    busy === "intake"
      ? "Adding Source Entries..."
      : busy === "delete"
        ? "Removing Source Entry..."
        : busy === "save"
          ? "Saving Preparation..."
          : resetNotice
            ? "Preparation reset"
            : preparation.dirty
              ? "Draft changes not saved"
              : isEmpty
                ? "Empty Preparation - add text or one source to begin"
                : "Preparation saved";

  function handleFiles(files: File[]) {
    if (files.length) onFiles(files);
  }

  return (
    <section className={CARD + " discovery-gather-section overflow-hidden"} aria-labelledby="discovery-gather-heading">
      <div className="discovery-gather-header flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h3 id="discovery-gather-heading" className="text-[13px] font-semibold text-ink">
            Gather context
          </h3>
          <p className="mt-0.5 text-[11px] text-faint">
            Drop files individually. Folders are intentionally absent.
          </p>
        </div>
        <div className="discovery-gather-header-actions">
          <div className="discovery-gather-inline-meta" aria-label="Preparation status">
            <span className="discovery-gather-inline-status" aria-live="polite">
              {statusLabel}
            </span>
            <span className="discovery-gather-inline-count">
              {preparation.draft.sources.length} files
            </span>
            <button
              type="button"
              className="discovery-button discovery-button-small"
              disabled={!preparation.dirty || busy !== null}
              onClick={onSave}
            >
              Save Preparation
            </button>
          </div>
          <button
            type="button"
            className="discovery-button discovery-button-small discovery-gather-add"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
          >
            + Add file
          </button>
        </div>
      </div>

      <div className="discovery-gather-body grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
        <div>
          <div
            className="discovery-drop-zone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <div>
              <div className="discovery-drop-icon">⇧</div>
              <strong className="block text-[13px] text-ink">Choose individual files</strong>
              <p className="mx-auto mt-1 max-w-[320px] text-[11px] text-muted">
                .txt, .md, .pdf, .docx, .csv, and .zip are accepted. Add as many as this
                Preparation needs.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="discovery-button discovery-button-small"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy !== null}
                >
                  Choose files
                </button>
                <span className="discovery-button discovery-button-small discovery-button-ghost">
                  Individual files only
                </span>
              </div>
            </div>
          </div>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            multiple
            accept=".txt,.md,.pdf,.docx,.csv,.zip"
            aria-label="Source files"
            disabled={busy !== null}
            onChange={(event) => {
              handleFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <div className="mt-3">
            <SourceStrip sources={preparation.draft.sources} busy={busy !== null} onDelete={onDelete} />
          </div>
        </div>

        <label className="block">
          <textarea
            className="discovery-text-input min-h-[172px]"
            aria-label="Research text"
            placeholder="Describe the research question, context, or constraints."
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
          />
          <span className="mt-1.5 block text-[11px] text-faint">
            Free-form text stays separate from uploaded file entries.
          </span>
        </label>
      </div>

      {error && (
        <p className="mx-4 mb-4 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger sm:mx-5" role="alert">
          {error}
        </p>
      )}
      {preparation.dirty && hasPreparationInput(preparation.saved) && (
        <p className="mx-4 mb-3 text-[11px] text-muted sm:mx-5">
          Saved Preparation remains unchanged until Save.
        </p>
      )}
    </section>
  );
}

function ReviewableInput({
  preparation,
  busy,
  error,
  onConvert,
  onOpenInput,
  onOpenPrompt,
}: {
  preparation: DiscoveryPreparation;
  busy: Busy;
  error: string | null;
  onConvert: () => void;
  onOpenInput: () => void;
  onOpenPrompt: () => void;
}) {
  const preparationSaved = isCommittedPreparation(preparation);
  const conversion = preparation.conversion;
  const executionInput = conversion.execution_input;
  const convertLabel =
    busy === "convert"
      ? "Converting..."
      : conversion.status === "failed"
        ? "Try again"
        : executionInput
          ? "Re-convert"
          : "Convert";

  return (
    <section className={CARD + " discovery-review-section overflow-hidden"} aria-labelledby="discovery-review-heading">
      <div className="discovery-review-header flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h3 id="discovery-review-heading" className="text-[13px] font-semibold text-ink">
            Reviewable Input
          </h3>
          <p className="mt-0.5 text-[11px] text-faint">
            {preparationSaved
              ? "Review the single backend-shaped Execution Input in the shared editor."
              : "Save the Preparation first to create the structured input."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="discovery-button discovery-button-small"
            onClick={onOpenPrompt}
            data-testid="conversion-prompt-entry"
          >
            Conversion Prompt
          </button>
          <button
            type="button"
            className="discovery-button discovery-button-small discovery-button-primary"
            disabled={!preparationSaved || busy !== null}
            onClick={onConvert}
          >
            {convertLabel}
          </button>
        </div>
      </div>
      <div className="discovery-review-body p-3 sm:p-4" data-testid="execution-input-list">
        {conversion.status === "failed" && (
          <p className="mb-3 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
            {conversion.error ?? "The model did not produce a structured Discovery Execution Input."}
          </p>
        )}
        {!executionInput ? (
          <div className="rounded-lg border border-dashed border-lineStrong bg-paper px-4 py-6 text-center text-[12px] text-muted" aria-live="polite">
            {preparationSaved ? "Convert the saved Preparation to create the Execution Input." : "No structured Execution Input yet."}
          </div>
        ) : (
          <button
            type="button"
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-3 text-left transition-colors hover:bg-paper sm:px-4"
            onClick={onOpenInput}
            data-testid="execution-input-row"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-ink group-hover:text-accent">
                {executionInput.task_description}
              </span>
              <span className="mt-1 block truncate text-[10px] text-faint">
                {executionInput.domain} · {executionInput.task_type ?? "sci"} · {executionInput.constraints.length} constraint{executionInput.constraints.length === 1 ? "" : "s"}
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-[16px] text-accent">↗</span>
          </button>
        )}
        {error && conversion.status !== "failed" && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

type ExecutionInputField =
  | "task_type"
  | "task_description"
  | "domain"
  | "background"
  | "constraints"
;

const EXECUTION_INPUT_EDITOR_FIELDS: Array<{ key: ExecutionInputField; label: string }> = [
  { key: "task_type", label: "Task type" },
  { key: "task_description", label: "Task description" },
  { key: "domain", label: "Domain" },
  { key: "background", label: "Background" },
  { key: "constraints", label: "Constraints" },
];

function DiscoveryEditorSurface({
  testId,
  title,
  backLabel,
  saveLabel,
  saveDisabled,
  onBack,
  onSave,
  children,
}: {
  testId: string;
  title: string;
  backLabel: string;
  saveLabel: string;
  saveDisabled: boolean;
  onBack: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <main className="discovery-editor-route" data-testid={testId}>
      <div className="mb-4 flex items-center gap-3">
        <button type="button" className="discovery-button discovery-button-small" onClick={onBack}>
          {backLabel}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
            Shared editor surface
          </div>
          <h2 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.04em] text-ink">
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="discovery-button discovery-button-small discovery-button-primary"
          disabled={saveDisabled}
          onClick={onSave}
        >
          {saveLabel}
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_250px]">
        {children}
      </div>
    </main>
  );
}

function ExecutionInputEditor({
  input,
  busy,
  error,
  onBack,
  onSave,
}: {
  input: DiscoveryExecutionInput;
  busy: Busy;
  error: string | null;
  onBack: () => void;
  onSave: (input: DiscoveryExecutionInput) => void;
}) {
  const [draft, setDraft] = useState<DiscoveryExecutionInput>(input);
  const [field, setField] = useState<ExecutionInputField>("task_description");
  const fieldDefinition = EXECUTION_INPUT_EDITOR_FIELDS.find((item) => item.key === field)!;
  const isListField = field === "constraints";
  const isTaskTypeField = field === "task_type";
  const value = draft[field];
  const textValue = Array.isArray(value) ? value.join("\n") : value ?? "";
  const updateValue = (next: string) => {
    setDraft((current) => ({
      ...current,
      [field]: isListField
        ? next.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : next,
    }));
  };

  return (
    <DiscoveryEditorSurface
      testId="discovery-execution-input-editor"
      title="Structured Execution Input"
      backLabel="← Reviewable Input"
      saveLabel={busy === "revision" ? "Saving..." : "Save"}
      saveDisabled={busy !== null}
      onBack={onBack}
      onSave={() => onSave(draft)}
    >
        <div className="col-span-full discovery-execution-focus">
          <nav className="discovery-execution-schema" aria-label="Execution schema" role="tablist">
            <div className="discovery-execution-schema-header">
              <div>
                <h3>Execution schema</h3>
                <p>Five backend fields · select one to focus the editor.</p>
              </div>
              <span>structured.execution_input</span>
            </div>
            <div className="discovery-execution-schema-list">
              {EXECUTION_INPUT_EDITOR_FIELDS.map((definition, index) => {
                const selected = field === definition.key;
                return (
                  <button
                    key={definition.key}
                    id={`execution-input-tab-${definition.key}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="execution-input-field-panel"
                    className={selected ? "is-active" : ""}
                    onClick={() => setField(definition.key)}
                  >
                    <span className="discovery-execution-schema-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="discovery-execution-schema-label">{definition.label}</span>
                    <span className="discovery-execution-schema-check" aria-hidden="true">✓</span>
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            key={field}
            className={CARD + " discovery-execution-focus-card min-w-0 overflow-hidden"}
            aria-label="Execution input field editor"
            id="execution-input-field-panel"
            role="tabpanel"
            aria-labelledby={`execution-input-tab-${field}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Field editor</div>
                <h3 className="mt-1 font-serif text-[20px] font-medium tracking-[-0.03em] text-ink">{fieldDefinition.label}</h3>
              </div>
              <span className="font-mono text-[9px] text-faint">structured.execution_input.{field}</span>
            </div>
            <div className="p-5">
              <label className="block text-[11px] font-semibold text-muted" htmlFor="execution-input-field-editor">
                {fieldDefinition.label}
                <span className="float-right text-[9px] font-normal text-faint">
                  {isTaskTypeField ? "choose one" : isListField ? "one item per line" : "multiline"}
                </span>
              </label>
              {isTaskTypeField ? (
                <select
                  id="execution-input-field-editor"
                  aria-label={fieldDefinition.label}
                  className="discovery-text-input mt-2"
                  value={textValue === "auto" ? "auto" : "sci"}
                  onChange={(event) => updateValue(event.target.value)}
                  disabled={busy !== null}
                >
                  <option value="auto">auto · repository/code task</option>
                  <option value="sci">sci · scientific reproduction task</option>
                </select>
              ) : (
                <textarea
                  id="execution-input-field-editor"
                  aria-label={fieldDefinition.label}
                  className="discovery-text-input mt-2 min-h-[290px]"
                  value={textValue}
                  onChange={(event) => updateValue(event.target.value)}
                  disabled={busy !== null}
                />
              )}
              <p className="mt-2 text-[10px] text-faint">Changes stay in the review draft until Save.</p>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3">
              <button
                type="button"
                className="discovery-button discovery-button-small"
                disabled={field === EXECUTION_INPUT_EDITOR_FIELDS[0].key}
                onClick={() => {
                  const index = EXECUTION_INPUT_EDITOR_FIELDS.findIndex((item) => item.key === field);
                  setField(EXECUTION_INPUT_EDITOR_FIELDS[Math.max(0, index - 1)].key);
                }}
              >
                ← Previous field
              </button>
              <button
                type="button"
                className="discovery-button discovery-button-small"
                disabled={field === EXECUTION_INPUT_EDITOR_FIELDS[EXECUTION_INPUT_EDITOR_FIELDS.length - 1].key}
                onClick={() => {
                  const index = EXECUTION_INPUT_EDITOR_FIELDS.findIndex((item) => item.key === field);
                  setField(EXECUTION_INPUT_EDITOR_FIELDS[Math.min(EXECUTION_INPUT_EDITOR_FIELDS.length - 1, index + 1)].key);
                }}
              >
                Next field →
              </button>
            </div>
            {error && <p className="mx-5 mb-5 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">{error}</p>}
          </section>
        </div>
    </DiscoveryEditorSurface>
  );
}

function ConversionPromptEditor({
  prompt,
  busy,
  error,
  backLabel,
  onBack,
  onSave,
}: {
  prompt: DiscoveryConversionPrompt | null;
  busy: Busy;
  error: string | null;
  backLabel: string;
  onBack: () => void;
  onSave: (instruction: string) => void;
}) {
  const [draft, setDraft] = useState(prompt?.instruction ?? "");
  const original = prompt?.instruction ?? "";
  const dirty = draft !== original;

  useEffect(() => {
    setDraft(original);
  }, [original]);

  return (
    <DiscoveryEditorSurface
      testId="discovery-conversion-prompt-editor"
      title="Discovery Input Conversion Prompt"
      backLabel={backLabel}
      saveLabel={busy === "prompt" ? "Saving..." : "Save"}
      saveDisabled={busy !== null || !dirty || !draft.trim()}
      onBack={onBack}
      onSave={() => onSave(draft)}
    >
        <section className={CARD + " overflow-hidden"} aria-label="Prompt contract">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[12px] font-semibold text-ink">Prompt contract</h3>
            <p className="mt-0.5 text-[10px] text-faint">Active for the next Conversion.</p>
          </div>
          <div className="space-y-1 p-2">
            {["Evidence boundaries", "Structured JSON output", "Research text language"].map((label, index) => (
              <div key={label} className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-[10px] text-muted">
                <span className="w-5 font-mono text-[9px] text-faint">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="text-ok">✓</span>
              </div>
            ))}
          </div>
        </section>
        <section className={CARD + " min-w-0 overflow-hidden"} aria-label="Conversion prompt editor">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Prompt editor</div>
              <h3 className="mt-1 text-[14px] font-semibold text-ink">Instruction</h3>
            </div>
            <span className="font-mono text-[9px] text-faint">discovery.input_conversion</span>
          </div>
          <div className="p-4">
            <label className="block text-[11px] font-semibold text-muted" htmlFor="discovery-conversion-prompt-editor-field">
              Discovery Input Conversion Prompt
              <span className="float-right text-[9px] font-normal text-faint">multiline</span>
            </label>
            <textarea
              id="discovery-conversion-prompt-editor-field"
              aria-label="Discovery Input Conversion Prompt"
              className="discovery-text-input mt-2 min-h-[360px] font-mono"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy !== null || prompt === null}
              spellCheck={false}
            />
            <p className="mt-2 text-[10px] text-faint">Changes stay in this editor until Save.</p>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <button
              type="button"
              className="discovery-button discovery-button-small"
              disabled={!dirty || busy !== null}
              onClick={() => setDraft(original)}
            >
              Reset
            </button>
            <span className="text-[10px] text-faint">{draft.length.toLocaleString()} characters</span>
          </div>
          {error && <p className="mx-4 mb-4 rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">{error}</p>}
        </section>
        <section className={CARD + " overflow-hidden"} aria-label="Editor guidance">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[12px] font-semibold text-ink">Editor guidance</h3>
            <p className="mt-0.5 text-[10px] text-faint">Keep the conversion boundary explicit.</p>
          </div>
          <div className="space-y-3 p-4 text-[11px] leading-relaxed text-muted">
            <p>Sources are evidence, not instructions.</p>
            <p>Do not invent sources, data, experiments, or capabilities.</p>
            <p>Return one backend-consumable structured input.</p>
          </div>
        </section>
    </DiscoveryEditorSurface>
  );
}

function RunLaunch({
  preparation,
  currentLaunch,
  busy,
  error,
  confirming,
  onRequestRun,
  onCancel,
  onConfirm,
}: {
  preparation: DiscoveryPreparation;
  currentLaunch: DiscoveryLaunch | null;
  busy: Busy;
  error: string | null;
  confirming: boolean;
  onRequestRun: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const revision = preparation.conversion.saved_revision_id
    ? preparation.revisions.find(
        (candidate) => candidate.revision_id === preparation.conversion.saved_revision_id,
      )
    : null;
  const eligible = Boolean(
    !preparation.dirty &&
    preparation.conversion.status === "saved" &&
    revision?.eligible,
  );
  const executionInput = preparation.conversion.execution_input;
  const canRun = eligible && Boolean(executionInput) && currentLaunch === null && busy === null;

  return (
    <section className={CARD + " discovery-run-section overflow-hidden"} aria-labelledby="discovery-run-heading">
      <div className="discovery-run-header flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h3 id="discovery-run-heading" className="text-[13px] font-semibold text-ink">
            Run Discovery
          </h3>
          <p className="mt-0.5 text-[11px] text-faint">
            Confirm once to freeze this reviewed revision into a Launch Snapshot.
          </p>
        </div>
        <button
          type="button"
          className="discovery-button discovery-button-small discovery-button-primary"
          disabled={!canRun}
          onClick={onRequestRun}
        >
          {busy === "launch" ? "Starting..." : "Run"}
        </button>
      </div>
      <div className="discovery-run-body space-y-3 p-4 sm:p-5">
        <div className="discovery-notice" role="status" aria-live="polite">
          <span aria-hidden="true">{currentLaunch ? "•" : "→"}</span>
          <span>
            <strong>
              {currentLaunch
                ? `Launch ${currentLaunch.state}`
                : eligible
                  ? executionInput
                    ? "Ready to run"
                    : "Execution Input is missing"
                  : "Run is gated"}
            </strong>{" "}
            {currentLaunch
                ? "Preparation remains editable while this immutable Launch runs."
                : eligible
                ? executionInput
                  ? "The single backend-shaped Execution Input will be frozen into this Launch Snapshot."
                  : "Convert and save the Execution Input before Run."
                : "Save the Preparation, convert it, and save a non-empty revision first."}
          </span>
        </div>
        {error && (
          <p className="rounded-lg border border-danger/30 bg-dangerSoft px-3 py-2.5 text-[12px] text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
      {confirming && (
        <div
          className="border-t border-line bg-paper px-4 py-4 sm:px-5"
          role="dialog"
          aria-modal="false"
          aria-labelledby="discovery-run-confirm-heading"
        >
          <h4 id="discovery-run-confirm-heading" className="text-[13px] font-semibold text-ink">
            Start a long-running Discovery Launch?
          </h4>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            This action freezes the selected input and effective configuration. The Preparation can
            still be edited for a later Launch.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="discovery-button discovery-button-small" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="discovery-button discovery-button-small discovery-button-primary"
              onClick={onConfirm}
            >
              Start Launch
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PreparationCanvas({
  preparation,
  text,
  resetNotice,
  busy,
  error,
  reviewError,
  onTextChange,
  onFiles,
  onSave,
  onDelete,
  onConvert,
  onOpenInput,
  onOpenPrompt,
  currentLaunch,
  launchError,
  confirmingRun,
  onRequestRun,
  onCancelRun,
  onConfirmRun,
}: {
  preparation: DiscoveryPreparation;
  text: string;
  resetNotice: boolean;
  busy: Busy;
  error: string | null;
  reviewError: string | null;
  onTextChange: (value: string) => void;
  onFiles: (files: File[]) => void;
  onSave: () => void;
  onDelete: (source: DiscoverySourceEntry) => void;
  onConvert: () => void;
  onOpenInput: () => void;
  onOpenPrompt: () => void;
  currentLaunch: DiscoveryLaunch | null;
  launchError: string | null;
  confirmingRun: boolean;
  onRequestRun: () => void;
  onCancelRun: () => void;
  onConfirmRun: () => void;
}) {
  return (
    <>
      <div className="discovery-canvas-stack">
        <StageCanvas
          preparation={preparation}
        />
        <GatherContext
          preparation={preparation}
          text={text}
          resetNotice={resetNotice}
          busy={busy}
          error={error}
          onTextChange={onTextChange}
          onFiles={onFiles}
          onSave={onSave}
          onDelete={onDelete}
        />
        <ReviewableInput
          preparation={preparation}
          busy={busy}
          error={reviewError}
          onConvert={onConvert}
          onOpenInput={onOpenInput}
          onOpenPrompt={onOpenPrompt}
        />
        <RunLaunch
          preparation={preparation}
          currentLaunch={currentLaunch}
          busy={busy}
          error={launchError}
          confirming={confirmingRun}
          onRequestRun={onRequestRun}
          onCancel={onCancelRun}
          onConfirm={onConfirmRun}
        />
      </div>
    </>
  );
}

function ErrorContext() {
  return (
    <section
      className={CARD + " p-5 sm:p-6"}
      aria-labelledby="discovery-error-heading"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper text-muted">
          <Icon name="refresh" size={17} />
        </span>
        <div>
          <h2 id="discovery-error-heading" className="text-[15px] font-semibold text-ink">
            Discovery is unavailable
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            The sidecar did not return the Discovery state. Reconnect it and try again.
          </p>
        </div>
      </div>
    </section>
  );
}

function LoadingContext() {
  return (
    <section
      className={CARD + " p-5 sm:p-6"}
      aria-labelledby="discovery-loading-heading"
      aria-busy="true"
    >
      <h2 id="discovery-loading-heading" className="text-[15px] font-semibold text-ink">
        Loading Discovery
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Checking the sidecar for the current Preparation and Launch state.
      </p>
    </section>
  );
}

function ResetPreparationDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: Busy;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="discovery-reset-overlay">
      <div
        className="discovery-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-reset-heading"
        aria-describedby="discovery-reset-description"
      >
        <h2 id="discovery-reset-heading" className="text-[16px] font-semibold text-ink">
          Reset Preparation?
        </h2>
        <p id="discovery-reset-description" className="mt-2 text-[12px] leading-relaxed text-muted">
          This clears text, source files, Conversion drafts, and saved revisions. Current and past
          Launches remain unchanged.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="discovery-button discovery-button-small"
            onClick={onCancel}
            disabled={busy !== null}
          >
            Cancel
          </button>
          <button
            type="button"
            className="discovery-button discovery-button-small discovery-button-primary"
            onClick={onConfirm}
            disabled={busy !== null}
          >
            {busy === "reset" ? "Resetting..." : "Reset Preparation"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DiscoveryView() {
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null);
  const [context, setContext] = useState<DiscoveryContextId>("preparation");
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  // A terminal Launch is no longer an automatic navigation event. Keep its last
  // server-authoritative projection visible on Current Launch until the user leaves
  // that surface, while the backend remains free to remove it from current_launch.
  const [terminalLaunch, setTerminalLaunch] = useState<DiscoveryLaunch | null>(null);
  const [editingExecutionInput, setEditingExecutionInput] = useState(false);
  const [editingConversionPrompt, setEditingConversionPrompt] = useState(false);
  const [conversionPromptReturn, setConversionPromptReturn] = useState<"preparation" | "input">("preparation");
  const [conversionPrompt, setConversionPrompt] = useState<DiscoveryConversionPrompt | null>(null);
  const [conversionPromptLoaded, setConversionPromptLoaded] = useState(false);
  const [conversionPromptError, setConversionPromptError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [resetNotice, setResetNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingRun, setConfirmingRun] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<DiscoveryLaunchStatus | null>(null);
  const [rawOpen, setRawOpen] = useState(true);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [rawError, setRawError] = useState<string | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const eventCursors = useRef(new Map<string, number>());
  const stopGrace = useRef<{ launch: DiscoveryLaunch; until: number } | null>(null);

  const launchSurfaceLaunch = snapshot?.current_launch ?? (context === "launch" ? terminalLaunch : null);
  const observedLaunchId =
    context === "launch"
      ? launchSurfaceLaunch?.launch_id ?? null
      : context === "history"
        ? snapshot?.current_launch?.launch_id === selectedHistoryId
          ? snapshot.current_launch.launch_id
          : snapshot?.history.find((launch) => launch.launch_id === selectedHistoryId)?.launch_id ??
            snapshot?.current_launch?.launch_id ??
            snapshot?.history[0]?.launch_id ??
            null
        : null;

  useEffect(() => {
    let alive = true;
    getDiscovery()
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
        setText(normalizePreparation(next.preparation).draft.text);
        setEditingExecutionInput(false);
        setEditingConversionPrompt(false);
        setResetNotice(false);
        setTerminalLaunch(null);
        setContext(next.active_context);
      })
      .catch(() => {
        if (alive) setError("Discovery is unavailable. Try again when the sidecar is ready.");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (context !== "launch") setTerminalLaunch(null);
  }, [context]);

  useEffect(() => {
    if (!observedLaunchId) {
      setRuntimeStatus(null);
      setRawLines([]);
      setRawError(null);
      return undefined;
    }

    let alive = true;
    const controller = new AbortController();
    let requestInFlight = false;
    let terminalRefreshNextAt = 0;
    const refreshStatus = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const status = normalizeLaunchStatus(await getDiscoveryLaunchStatus(observedLaunchId));
        if (!alive) return;
        setRuntimeStatus(status);
        if (status) {
          setSnapshot((current) => {
            if (!current) return current;
            return {
              ...current,
              current_launch:
                current.current_launch?.launch_id === status.launch.launch_id
                  ? status.launch
                  : current.current_launch,
              history: current.history.map((launch) =>
                launch.launch_id === status.launch.launch_id ? status.launch : launch,
              ),
            };
          });
        }
        const eventCursor = eventCursors.current.get(observedLaunchId) ?? 0;
        const events = await getDiscoveryLaunchEvents(observedLaunchId, eventCursor, controller.signal);
        if (alive) {
          eventCursors.current.set(observedLaunchId, events.latest_sequence);
          const restored = status ? applyLaunchEvents(status, events.events) : null;
          setRuntimeStatus(restored);
          if (restored) {
            setSnapshot((current) => {
              if (!current) return current;
              return {
                ...current,
                current_launch:
                  current.current_launch?.launch_id === restored.launch.launch_id
                    ? restored.launch
                    : current.current_launch,
                history: current.history.map((launch) =>
                  launch.launch_id === restored.launch.launch_id ? restored.launch : launch,
                ),
                };
              });
            }
            const terminal = restored
              ? ["completed", "failed", "stopped", "interrupted"].includes(restored.state)
              : false;
            if (terminal && Date.now() >= terminalRefreshNextAt) {
              terminalRefreshNextAt = Date.now() + 2000;
              try {
                const next = await getDiscovery();
                if (!alive) return;
                const pendingStop = stopGrace.current;
                if (
                  context === "launch" &&
                  pendingStop?.launch.launch_id === observedLaunchId &&
                  Date.now() < pendingStop.until &&
                  !next.current_launch
                ) {
                  setSnapshot((current) =>
                    current
                      ? { ...next, current_launch: pendingStop.launch }
                      : next,
                  );
                } else {
                  stopGrace.current = null;
                  if (context === "launch" && restored) {
                    // The durable store moves terminal launches into history. Keep a
                    // local presentation copy on Current Launch so completion/error
                    // feedback remains visible without forcing a context switch.
                    setTerminalLaunch(restored.launch);
                    setSnapshot({
                      ...next,
                      current_launch: next.current_launch ?? restored.launch,
                    });
                  } else {
                    setSnapshot(next);
                  }
                }
              } catch {
                // The status projection remains visible if the one reconciliation
                // snapshot is unavailable; a later user refresh can retry it.
              }
            }
          }
      } catch {
        // The full Discovery snapshot remains the fallback while a status poll retries.
      } finally {
        requestInFlight = false;
      }
    };
    const streamRawLog = async () => {
      await refreshStatus();
      if (!alive || !rawOpen) return;
      setRawLines([]);
      setRawError(null);
      try {
        await streamDiscoveryLaunchLog(
          observedLaunchId,
          (line) => {
            if (alive) {
              setRawLines((current) => [...current, line].slice(-RAW_LOG_LINE_LIMIT));
            }
          },
          controller.signal,
        );
      } catch (caught) {
        if (alive && !(caught instanceof DOMException && caught.name === "AbortError")) {
          setRawError(errorMessage(caught));
        }
      }
    };
    void (rawOpen ? streamRawLog() : refreshStatus());
    const timer = window.setInterval(() => void refreshStatus(), 200);

    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [context, observedLaunchId, rawOpen]);

  const contexts = snapshot?.contexts?.length ? snapshot.contexts : FALLBACK_CONTEXTS;
  const activeContext = contexts.find((item) => item.id === context) ?? contexts[0];
  const pageContextLabel = activeContext.id === "history" ? "Launch history" : activeContext.label;
  const preparation = snapshot ? normalizePreparation(snapshot.preparation) : null;
  const editingInput = editingExecutionInput ? preparation?.conversion.execution_input ?? null : null;
  const loading = snapshot === null && error === null;

  function setDraftText(value: string) {
    setText(value);
    setResetNotice(false);
    setMutationError(null);
    setReviewError(null);
    setSnapshot((current) => (current ? withDraftText(current, value) : current));
  }

  async function addFiles(files: File[]) {
    if (!snapshot) return;
    setMutationError(null);
    setReviewError(null);
    setResetNotice(false);
    setBusy("intake");
    try {
      const next = await intakeDiscoveryPreparation(text, files);
      setSnapshot(next);
      setText(normalizePreparation(next.preparation).draft.text);
    } catch (caught) {
      setMutationError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function savePreparation() {
    setMutationError(null);
    setReviewError(null);
    setBusy("save");
    try {
      const previous = snapshot ? normalizePreparation(snapshot.preparation) : null;
      const next = await saveDiscoveryPreparation(text);
      setSnapshot(next);
      setText(normalizePreparation(next.preparation).draft.text);
      setResetNotice(
        next.preparation.status === "empty" &&
          Boolean(
            previous &&
              (hasPreparationInput(previous.saved) || hasPreparationInput(previous.draft)),
          ),
      );
    } catch (caught) {
      setMutationError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function resetPreparation() {
    setConfirmingReset(false);
    setMutationError(null);
    setReviewError(null);
    setBusy("reset");
    try {
      const next = await resetDiscoveryPreparation();
      setSnapshot(next);
      setText("");
      setEditingExecutionInput(false);
      setEditingConversionPrompt(false);
      setResetNotice(true);
    } catch (caught) {
      setMutationError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function removeSource(source: DiscoverySourceEntry) {
    setMutationError(null);
    setReviewError(null);
    setBusy("delete");
    setResetNotice(false);
    try {
      const next = await deleteDiscoverySource(source.source_id);
      setSnapshot(withDraftText(next, text));
      setText(text);
    } catch (caught) {
      setMutationError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function convertPreparation() {
    setMutationError(null);
    setReviewError(null);
    setBusy("convert");
    try {
      const next = await convertDiscoveryPreparation();
      setSnapshot(next);
      setEditingExecutionInput(false);
    } catch (caught) {
      setReviewError(null);
      setSnapshot((current) => {
        if (!current) return current;
        const preparation = normalizePreparation(current.preparation);
        return {
          ...current,
          preparation: {
            ...preparation,
            conversion: {
              ...preparation.conversion,
              status: "failed",
              error: errorMessage(caught),
            },
          },
        };
      });
    } finally {
      setBusy(null);
    }
  }

  function openExecutionInput() {
    setEditingExecutionInput(true);
    setReviewError(null);
  }

  function openConversionPrompt() {
    setConversionPromptReturn(editingExecutionInput ? "input" : "preparation");
    setEditingConversionPrompt(true);
    setConversionPromptError(null);
    if (conversionPromptLoaded) return;
    setBusy("prompt");
    void getDiscoveryConversionPrompt()
      .then((next) => {
        setConversionPrompt(next);
        setConversionPromptLoaded(true);
      })
      .catch((caught) => {
        setConversionPromptError(errorMessage(caught));
      })
      .finally(() => setBusy(null));
  }

  async function saveConversionPrompt(instruction: string) {
    setConversionPromptError(null);
    setBusy("prompt");
    try {
      const next = await saveDiscoveryConversionPrompt(instruction);
      setConversionPrompt(next);
      setConversionPromptLoaded(true);
      setEditingConversionPrompt(false);
    } catch (caught) {
      setConversionPromptError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveRevision(input: DiscoveryExecutionInput) {
    if (!preparation) return;
    setMutationError(null);
    setReviewError(null);
    setBusy("revision");
    try {
      const next = await saveDiscoveryRevision(input);
      setSnapshot(next);
      setEditingExecutionInput(false);
    } catch (caught) {
      setReviewError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function requestRun() {
    setLaunchError(null);
    setConfirmingRun(true);
    if (preparation?.conversion.saved_revision_id) {
      const key = `start:${preparation.conversion.saved_revision_id}`;
      if (!idempotencyKeys.current.has(key)) {
        idempotencyKeys.current.set(key, createDiscoveryIdempotencyKey("discovery-start"));
      }
    }
  }

  function cancelRun() {
    if (busy === null) setConfirmingRun(false);
  }

  function applyLaunchResult(result: Awaited<ReturnType<typeof startDiscoveryLaunch>>) {
    const next = result.snapshot;
    // Older/replayed admission responses may omit the bounded `launch` field;
    // recover the same immutable record from whichever snapshot collection owns it.
    const launch =
      result.launch ??
      next.current_launch ??
      next.history.find((candidate) => candidate.launch_id === result.launch_id);
    if (!launch) {
      setSnapshot(next);
      setContext("launch");
      return;
    }
    const currentMatches = next.current_launch?.launch_id === launch.launch_id;
    const history = [
      launch,
      ...next.history.filter((candidate) => candidate.launch_id !== launch.launch_id),
    ];
    setSnapshot(
      currentMatches
        ? next
        : { ...next, history },
    );
    setTerminalLaunch(
      currentMatches || !["completed", "failed", "stopped", "interrupted"].includes(launch.state)
        ? null
        : launch,
    );
    // A start/resume response always belongs on Current Launch. A terminal response
    // is still a record, but it must not pull the user into History automatically.
    setContext("launch");
  }

  async function confirmRun() {
    if (!preparation) return;
    const revisionId = preparation.conversion.saved_revision_id;
    if (!revisionId) return;
    setConfirmingRun(false);
    setLaunchError(null);
    setTerminalLaunch(null);
    setBusy("launch");
    try {
      const key = `start:${revisionId}`;
      const requestKey =
        idempotencyKeys.current.get(key) ?? createDiscoveryIdempotencyKey("discovery-start");
      idempotencyKeys.current.set(key, requestKey);
      const result = await startDiscoveryLaunch(revisionId, requestKey);
      idempotencyKeys.current.delete(key);
      stopGrace.current = null;
      applyLaunchResult(result);
    } catch (caught) {
      setLaunchError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function stopLaunch() {
    const launch = snapshot?.current_launch;
    if (!launch) return;
    setLaunchError(null);
    setBusy("stop");
    const stoppingLaunch: DiscoveryLaunch = {
      ...launch,
      state: "stopping",
      stage: "stopping",
      stop_requested_at: launch.stop_requested_at ?? new Date().toISOString(),
      stop_reason: launch.stop_reason ?? "researcher requested graceful stop",
    };
    stopGrace.current = { launch: stoppingLaunch, until: Date.now() + 400 };
    setSelectedHistoryId(launch.launch_id);
    setSnapshot((current) =>
      current?.current_launch?.launch_id === launch.launch_id
        ? { ...current, current_launch: stoppingLaunch }
        : current,
    );
    setRuntimeStatus((current) =>
      current?.launch.launch_id === launch.launch_id
        ? {
            ...current,
            state: "stopping",
            stage: "stopping",
            launch: { ...current.launch, state: "stopping", stage: "stopping" },
          }
        : current,
    );
    try {
      const next = await stopDiscoveryLaunch(launch.launch_id);
      setSnapshot(
        next.current_launch
          ? next
          : { ...next, current_launch: stoppingLaunch },
      );
    } catch (caught) {
      stopGrace.current = null;
      setSnapshot((current) =>
        current?.current_launch?.launch_id === launch.launch_id
          ? { ...current, current_launch: launch }
          : current,
      );
      setLaunchError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function resumeLaunch(launch: DiscoveryLaunch) {
    const key = `resume:${launch.launch_id}`;
    const requestKey =
      idempotencyKeys.current.get(key) ?? createDiscoveryIdempotencyKey("discovery-resume");
    idempotencyKeys.current.set(key, requestKey);
    setLaunchError(null);
    setTerminalLaunch(null);
    setBusy("resume");
    try {
      const result = await resumeDiscoveryLaunch(launch.launch_id, requestKey);
      idempotencyKeys.current.delete(key);
      stopGrace.current = null;
      applyLaunchResult(result);
    } catch (caught) {
      setLaunchError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper" data-testid="discovery-view">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto hairline-scroll">
        <div className="discovery-page-frame mx-auto w-full max-w-[1420px] px-5 py-6 sm:px-7 sm:py-8">
          <header className="discovery-page-header">
            <div className="min-w-0">
              <h1 className="discovery-page-title" aria-label="Discovery">
                Discovery <span aria-hidden="true" className="discovery-page-title-separator">/</span>{" "}
                <span>{pageContextLabel}</span>
              </h1>
              <p className="discovery-page-subtitle">
                One current Preparation · one active Launch · native sidecar transport
              </p>
            </div>
            <div className="discovery-page-actions">
              {activeContext.id === "preparation" && preparation ? (
                <button
                  type="button"
                  className="discovery-button discovery-page-refresh"
                  aria-label="Refresh Preparation"
                  title="Reset Preparation"
                  disabled={busy !== null}
                  onClick={() => setConfirmingReset(true)}
                >
                  <Icon name="refresh" size={14} />
                  <span>Refresh</span>
                </button>
              ) : (
                <span className={`discovery-connection ${error ? "is-error" : ""}`}>
                  {error ? "Sidecar reconnect needed" : loading ? "Connecting" : "Sidecar connected"}
                </span>
              )}
              {snapshot?.current_launch && (
                <PrototypeLaunchAction
                  launch={snapshot.current_launch}
                  busy={busy}
                  onStop={stopLaunch}
                  onResume={() => resumeLaunch(snapshot.current_launch!)}
                />
              )}
              <span className="sr-only" aria-label="Discovery status">
                {error ? "Sidecar reconnect needed" : loading ? "Loading" : preparation?.status === "draft" ? "Draft" : "Ready"}
              </span>
            </div>
          </header>

          {activeContext.id === "preparation" && confirmingReset && (
            <ResetPreparationDialog
              busy={busy}
              onCancel={() => setConfirmingReset(false)}
              onConfirm={resetPreparation}
            />
          )}

          <div className="discovery-context-nav-row">
            <nav className="discovery-context-nav" aria-label="Discovery sections" role="tablist">
              <div className="flex min-w-0 gap-1 overflow-x-auto">
                {contexts.map((item) => {
                  const selected = item.id === activeContext.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      id={`discovery-tab-${item.id}`}
                      aria-controls={`discovery-panel-${item.id}`}
                      className={
                        "shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors " +
                        (selected
                          ? "border-accent text-ink"
                          : "border-transparent text-muted hover:border-lineStrong hover:text-ink")
                      }
                      onClick={() => {
                        setContext(item.id);
                        setConfirmingReset(false);
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </nav>
            {preparation && (
              <span className="discovery-status-pill discovery-context-status">
                <span
                  className={`discovery-status-dot ${isCommittedPreparation(preparation) ? "is-ready" : "is-warn"}`}
                />
                {isCommittedPreparation(preparation) ? "Preparation committed" : "Preparation in progress"}
              </span>
            )}
          </div>

          <div
            className="mt-5"
            role="tabpanel"
            id={`discovery-panel-${activeContext.id}`}
            aria-labelledby={`discovery-tab-${activeContext.id}`}
          >
            {loading ? (
              <LoadingContext />
            ) : error ? (
              <ErrorContext />
            ) : activeContext.id === "preparation" && preparation ? (
              <>
                {editingConversionPrompt ? (
                  <ConversionPromptEditor
                    prompt={conversionPrompt}
                    busy={busy}
                    error={conversionPromptError}
                    backLabel={conversionPromptReturn === "input" ? "← Reviewable Input" : "← Preparation"}
                    onBack={() => {
                      setEditingConversionPrompt(false);
                      setConversionPromptError(null);
                    }}
                    onSave={saveConversionPrompt}
                  />
                ) : editingInput ? (
                  <ExecutionInputEditor
                    input={editingInput}
                    busy={busy}
                    error={reviewError}
                    onBack={() => setEditingExecutionInput(false)}
                    onSave={saveRevision}
                  />
                ) : (
                  <PreparationCanvas
                    preparation={preparation}
                    text={text}
                    resetNotice={resetNotice}
                    busy={busy}
                    error={mutationError}
                    reviewError={reviewError}
                    onTextChange={setDraftText}
                    onFiles={addFiles}
                    onSave={savePreparation}
                    onDelete={removeSource}
                    onConvert={convertPreparation}
                    onOpenInput={openExecutionInput}
                    onOpenPrompt={openConversionPrompt}
                    currentLaunch={snapshot?.current_launch ?? null}
                    launchError={launchError}
                    confirmingRun={confirmingRun}
                    onRequestRun={requestRun}
                    onCancelRun={cancelRun}
                    onConfirmRun={confirmRun}
                  />
                )}
              </>
            ) : activeContext.id === "launch" ? (
              <LaunchContext
                launch={launchSurfaceLaunch}
                busy={busy}
                onStop={stopLaunch}
                onResume={() => {
                  if (snapshot?.current_launch) void resumeLaunch(snapshot.current_launch);
                }}
                error={launchError}
                runtimeStatus={runtimeStatus}
                rawOpen={rawOpen}
                rawLines={rawLines}
                rawError={rawError}
                onToggleRaw={() => setRawOpen((open) => !open)}
              />
            ) : activeContext.id === "history" ? (
              <HistoryContext
                currentLaunch={snapshot?.current_launch ?? null}
                history={snapshot?.history ?? []}
                selectedId={selectedHistoryId}
                busy={busy}
                onSelect={setSelectedHistoryId}
                onResume={resumeLaunch}
                onStop={stopLaunch}
                error={launchError}
                runtimeStatus={runtimeStatus}
                rawOpen={rawOpen}
                rawLines={rawLines}
                rawError={rawError}
                onToggleRaw={() => setRawOpen((open) => !open)}
              />
            ) : (
              <EmptyContext context={activeContext.id} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

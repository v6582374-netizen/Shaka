// The BabelDOC document-translation surface: prototype variant B ("Library home") raised to
// production. The module's home is the LIBRARY of finished translations — a translation outlives
// the run that made it, and the module is opened to look at past work at least as often as to
// start new work. Opening one document splits the surface into library · run · artifacts.
//
// Everything on screen comes from the real endpoints in ../api. Progress is driven by the
// server's own append-only event log (getTranslationRunEvents, cursor-polled); the run's own
// `stages` array is authoritative for the stage table, with TRANSLATE_STAGES as a fallback only.
// The one semantic this integration adds on top of upstream BabelDOC is the bundle directory:
// source + translations land in ONE folder beside the original document, so that absolute path
// is given first-class treatment in the artifacts column.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTranslationRun,
  fetchTranslationArtifactBlobUrl,
  forgetTranslationDocument,
  getTranslationRun,
  getTranslationRunEvents,
  getTranslationSettings,
  listTranslationDocuments,
  listTranslationRuns,
  registerTranslationDocuments,
  revealTranslationBundle,
  startTranslationRuns,
  streamTranslationRunLog,
  translationArtifactUrl,
  type TranslationArtifact,
  type TranslationDocument,
  type TranslationRun,
  type TranslationRunEvent,
  type TranslationStage,
  type TranslationUploadFile,
} from "../api";
import { Icon } from "./Icon";
import {
  ARTIFACT_ROLE_LABEL,
  TRANSLATE_STAGES,
  bundleDirFor,
  dirOf,
  formatBytes,
  formatDuration,
  relativeTime,
  shortStage,
} from "./translationOptions";

const CARD = "rounded-xl2 border border-line bg-panel";
const EVENT_POLL_MS = 450;
const RUNS_POLL_MS = 1200;
const FEED_LIMIT = 120;
const LOG_LIMIT = 400;

/** Progress projected from the event log — the live truth while a run is in flight. */
type Progress = {
  stage: string | null;
  stage_index: number;
  stage_current: number;
  stage_total: number;
  stage_progress: number;
  overall_progress: number;
};

type FeedLine = { seq: number; at: number; type: string; text: string };

const isActive = (run: TranslationRun | null): boolean =>
  run != null && (run.state === "queued" || run.state === "running");

const errText = (caught: unknown, fallback: string): string =>
  caught instanceof Error && caught.message ? caught.message : fallback;

/* ------------------------------------------------------------------ motion */

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia?.(query).matches ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia?.(query) ?? null;
    } catch {
      return;
    }
    if (!mq?.addEventListener) return;
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * Exponential approach to `target`, ~200ms to settle. Progress arrives as discrete event jumps;
 * interpolating keeps the bar continuous. A new target simply retargets the same motion, so it is
 * interruptible by construction, and reduced-motion / non-visual environments jump straight there.
 */
function useSmoothed(target: number, reduced: boolean): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== "function") {
      current.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    let last = typeof performance !== "undefined" ? performance.now() : Date.now();
    const tick = (now: number) => {
      const dt = Math.min(64, Math.max(1, now - last));
      last = now;
      const delta = target - current.current;
      if (Math.abs(delta) < 0.05) {
        current.current = target;
        setValue(target);
        return;
      }
      current.current += delta * (1 - Math.exp(-dt / 80));
      setValue(current.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);

  return value;
}

/* ------------------------------------------------------------------ progress primitives */

function ProgressBar({
  pct,
  label,
  valueText,
  tone = "accent",
}: {
  pct: number;
  label: string;
  valueText: string;
  tone?: "accent" | "ok" | "danger";
}) {
  const reduced = usePrefersReducedMotion();
  const clamped = Math.max(0, Math.min(100, pct));
  const shown = useSmoothed(clamped, reduced);
  const fill = tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText}
      className="h-1.5 w-full overflow-hidden rounded-full bg-paper"
    >
      <div
        className={`h-full w-full origin-left rounded-full ${fill}`}
        style={{ transform: `scaleX(${(shown / 100).toFixed(4)})` }}
      />
    </div>
  );
}

/**
 * One ring, one number. The prototype's Translate step reports progress with a single radial
 * rather than a stack of bars: while a run is in flight there is exactly one question ("how far
 * along?"), and one answer should occupy the middle of the screen. Per-stage bars live in the
 * stage list below it, where they are detail rather than headline.
 */
function Radial({
  pct,
  label,
  valueText,
  done,
}: {
  pct: number;
  label: string;
  valueText: string;
  done?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const clamped = Math.max(0, Math.min(100, pct));
  const shown = useSmoothed(clamped, reduced);
  const radius = 104;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText}
      data-testid="translation-radial"
      className="relative grid h-[232px] w-[232px] place-items-center"
    >
      <svg viewBox="0 0 232 232" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="116" cy="116" r={radius} fill="none" strokeWidth="9" className="stroke-faint/20" />
        <circle
          cx="116"
          cy="116"
          r={radius}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className={done ? "stroke-ok" : "stroke-accent"}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
        />
      </svg>
      <div className="font-mono text-[44px] font-semibold leading-none tabular-nums tracking-[-0.035em] text-ink">
        {Math.round(shown)}
        <span className="text-[20px] font-medium text-muted">%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small shells */

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "accent" }) {
  const map = {
    neutral: "border-line bg-paper text-muted",
    ok: "border-okLine bg-okSoft text-ok",
    warn: "border-line bg-warnSoft text-warnInk",
    danger: "border-line bg-dangerSoft text-danger",
    accent: "border-line bg-accentSoft text-accent",
  } as const;
  return (
    <span className={`inline-flex min-h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

function stateTone(state: TranslationRun["state"]): "neutral" | "ok" | "warn" | "danger" | "accent" {
  if (state === "done") return "ok";
  if (state === "error") return "danger";
  if (state === "cancelled") return "warn";
  if (state === "running") return "accent";
  return "neutral";
}

const STATE_LABEL: Record<TranslationRun["state"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Bundled",
  error: "Failed",
  cancelled: "Cancelled",
};
/** The absolute path of the folder holding source + translations. The added semantic, made loud. */
function BundlePath({ path, pending, onCopy }: { path: string; pending?: boolean; onCopy: (path: string) => void }) {
  return (
    <div className={`${CARD} p-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
        {pending ? "Will be written to" : "Bundled beside the original"}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        <Icon name="folder" size={13} className={pending ? "mt-0.5 shrink-0 text-muted" : "mt-0.5 shrink-0 text-ok"} />
        <code
          className={`min-w-0 flex-1 break-all font-mono text-[11.5px] leading-[1.45] ${pending ? "text-muted" : "text-ink"}`}
          data-testid="translation-bundle-dir"
        >
          {path}/
        </code>
      </div>
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:bg-paper hover:text-ink"
        onClick={() => onCopy(path)}
      >
        <Icon name="copy" size={12} /> Copy path
      </button>
    </div>
  );
}

/**
 * One entry in the library. A finished translation is the thing the user came back for, so the
 * card leads with the bundle folder that holds it — not with the source path, which is where the
 * document merely came from.
 */
function LibraryCard({
  doc,
  run: docRun,
  live,
  focused,
  removing,
  starting,
  onOpen,
  onRemove,
  onRun,
}: {
  doc: TranslationDocument;
  run: TranslationRun | null;
  live?: number;
  focused: boolean;
  removing: boolean;
  starting?: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRun?: () => void;
}) {
  const done = docRun?.state === "done";
  const active = isActive(docRun);
  const pct = active ? live ?? docRun?.overall_progress ?? 0 : null;
  // A translated document is located by its bundle; an untranslated one by where it sits now.
  const where = done ? docRun?.bundle_dir || doc.bundle_dir : dirOf(doc.source_path);

  return (
    <div
      className={
        "flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors " +
        (focused ? "border-accent bg-accentSoft/40" : "border-line bg-panel hover:bg-paper")
      }
    >
      <span
        className={
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg " +
          (done ? "bg-okSoft text-ok" : "bg-paper text-muted")
        }
      >
        <Icon name={done ? "library" : "file"} size={13} />
      </span>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-current={focused}
        aria-label={`Open ${doc.filename}`}
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink" title={doc.filename}>
            {doc.filename}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted" title={where}>
            {where}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-faint">
            {done && docRun?.finished_at
              ? relativeTime(docRun.finished_at * 1000)
              : active
                ? docRun?.stage
                  ? shortStage(docRun.stage)
                  : "starting"
                : doc.pages != null
                  ? `${doc.pages} pages`
                  : formatBytes(doc.size)}
          </span>
        </span>
        {active ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent">{(pct ?? 0).toFixed(0)}%</span>
        ) : docRun && docRun.state !== "done" ? (
          <Pill tone={stateTone(docRun.state)}>{STATE_LABEL[docRun.state]}</Pill>
        ) : null}
      </button>
      {onRun && !active && (
        <button
          type="button"
          className="shrink-0 rounded-md border border-line px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-40"
          aria-label={`Translate ${doc.filename}`}
          disabled={starting}
          onClick={onRun}
        >
          <Icon name="sparkle" size={12} />
        </button>
      )}
      <button
        type="button"
        className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-dangerSoft hover:text-danger disabled:opacity-40"
        aria-label={`Remove ${doc.filename} from the library`}
        title="Remove from the library"
        disabled={removing}
        onClick={onRemove}
      >
        <Icon name="trash" size={13} />
      </button>
    </div>
  );
}

/** The four-beat trail of the flow. Reviewing a past translation is not one of the beats. */
function StepRail({ step }: { step: "confirm" | "translate" | "collect" }) {
  const order = ["choose", "confirm", "translate", "collect"] as const;
  const at = order.indexOf(step);
  return (
    <div
      className="flex items-center gap-1.5 text-[10.5px] text-faint"
      data-testid="translation-steps"
      data-step={step}
    >
      {["Choose", "Confirm", "Translate", "Collect"].map((label, index) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={index === at ? "text-ink" : undefined}>{label}</span>
          {index < 3 && (
            <i className={`block h-[3px] w-[22px] rounded-full ${index < at ? "bg-accent" : "bg-faint/25"}`} />
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * BabelDOC's stages, as a list. `compact` keeps the horizon short: everything finished, the one
 * running, and the next two. A thirteen-row table of things that have not happened yet is not
 * progress information.
 */
function StageRows({
  stages,
  stageIndex,
  stageFrac,
  stageCurrent,
  stageTotal,
  running,
  compact,
}: {
  stages: TranslationStage[];
  stageIndex: number;
  stageFrac: number;
  stageCurrent: number;
  stageTotal: number;
  running: boolean;
  compact?: boolean;
}) {
  const weightTotal = stages.reduce((sum, stage) => sum + stage.weight, 0) || 1;
  return (
    <ol className="flex flex-col">
      {stages.map((stage, index) => {
        const done = stageIndex > index;
        const active = stageIndex === index && running;
        if (compact && !done && !active && index > (stageIndex < 0 ? 1 : stageIndex + 2)) return null;
        return (
          <li
            key={`${stage.name}-${index}`}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line/70 py-2 first:border-t-0"
          >
            <span
              className={
                "grid h-5 w-5 place-items-center rounded-full border text-[9.5px] font-bold " +
                (done
                  ? "border-transparent bg-okSoft text-ok"
                  : active
                    ? "border-accent text-accent"
                    : "border-line text-faint")
              }
            >
              {done ? <Icon name="sparkle" size={11} /> : index + 1}
            </span>
            <div className="min-w-0">
              <div
                className={
                  "truncate text-[12.5px] " +
                  (active ? "font-semibold text-ink" : done ? "text-ink" : "text-muted")
                }
              >
                {shortStage(stage.name)}
              </div>
              {active && (
                <>
                  <div className="mt-1.5">
                    <ProgressBar
                      pct={stageFrac * 100}
                      label={`${shortStage(stage.name)} progress`}
                      valueText={
                        stageTotal > 0 ? `${stageCurrent} of ${stageTotal}` : `${(stageFrac * 100).toFixed(0)} percent`
                      }
                    />
                  </div>
                  {stageTotal > 0 && (
                    <div className="mt-1 text-[10.5px] text-faint">
                      <span className="font-mono tabular-nums">
                        {stageCurrent}/{stageTotal}
                      </span>{" "}
                      items
                    </div>
                  )}
                </>
              )}
            </div>
            <span className="font-mono text-[10px] tabular-nums text-faint">
              {((stage.weight / weightTotal) * 100).toFixed(1)}%
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The bundle as it sits on disk. One folder, beside the original — drawn rather than described. */
function BundleTree({ bundleDir, names }: { bundleDir: string; names: string[] }) {
  const leaf = bundleDir.split("/").filter(Boolean).pop() ?? bundleDir;
  return (
    <div
      className="flex flex-col gap-px font-mono text-[11px] leading-[1.6] text-muted"
      data-testid="translation-bundle-tree"
    >
      <div>
        <b className="font-semibold text-ink">{dirOf(bundleDir)}/</b>
      </div>
      <div>
        └─ <em className="not-italic text-accent">{leaf}/</em>
      </div>
      {names.length === 0 ? (
        <div className="pl-[22px] text-faint">(nothing written yet)</div>
      ) : (
        names.map((name, index) => (
          <div key={name} className="pl-[22px]">
            {index === names.length - 1 ? "└─" : "├─"} {name}
          </div>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the view */

export function TranslationView({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const [documents, setDocuments] = useState<TranslationDocument[]>([]);
  const [runs, setRuns] = useState<TranslationRun[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [feed, setFeed] = useState<Record<string, FeedLine[]>>({});
  const [focusedDocId, setFocusedDocId] = useState<string | null>(null);
  const [langPair, setLangPair] = useState<string | null>(null);
  // A non-empty `pages` setting silently narrows every run: the document finishes at 100% with
  // its other pages still in the source language. The surface has to say so.
  const [pagesLimit, setPagesLimit] = useState<string>("");
  // `only_include_translated_page` changes WHAT the restriction does: the pages outside the range
  // are not passed through, they are absent from the output. Different fact, different sentence.
  const [pagesDropped, setPagesDropped] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const [pathDraft, setPathDraft] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Expanded only on request. An empty library expands it implicitly, because then the intake
  // IS the content and there is nothing for it to overshadow.
  const [intakeExpanded, setIntakeExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrls = useRef<string[]>([]);
  const cursors = useRef(new Map<string, number>());

  /* ---- load ---- */

  const reload = useCallback(async () => {
    try {
      const [docs, runList] = await Promise.all([listTranslationDocuments(), listTranslationRuns()]);
      setDocuments(docs.documents);
      setRuns(runList.runs);
      setError(null);
    } catch (caught) {
      setError(errText(caught, "The translation service is unavailable."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    getTranslationSettings()
      .then((doc) => {
        setLangPair(`${doc.values.lang_in || "auto"} → ${doc.values.lang_out || "zh"}`);
        setPagesLimit(String(doc.values.pages ?? "").trim());
        setPagesDropped(doc.values.only_include_translated_page === true);
      })
      .catch(() => setLangPair(null));
  }, [reload]);

  /* ---- selection ---- */

  const runsByDoc = useMemo(() => {
    const map = new Map<string, TranslationRun>();
    for (const run of [...runs].sort((a, b) => a.created_at - b.created_at)) map.set(run.document_id, run);
    return map;
  }, [runs]);

  // Strictly what the user opened. There is deliberately NO fallback to `documents[0]`: the
  // module's home is the LIBRARY of finished translations, and "nothing focused" is a first-class
  // state. Opening this module to look at a past translation is at least as common as starting a
  // new one, so the library — not a run — is what the surface shows first.
  const focusedDoc = useMemo(
    () => documents.find((doc) => doc.document_id === focusedDocId) ?? null,
    [documents, focusedDocId],
  );
  const serverRun = focusedDoc ? runsByDoc.get(focusedDoc.document_id) ?? null : null;
  const runId = serverRun?.run_id ?? null;
  const runActive = isActive(serverRun);

  const intakeOpen = documents.length === 0 || intakeExpanded;

  // The one run this surface is WATCHING right now. A run that crosses the finish line in front
  // of the user earns the live treatment (progress, stages, events); one that was already over
  // when opened does not. Deliberately a single id, not a set: leaving the run and coming back
  // later is a review like any other, so the memory dies with the visit.
  const [watchedRunId, setWatchedRunId] = useState<string | null>(null);
  useEffect(() => {
    if (runId && runActive) setWatchedRunId(runId);
  }, [runId, runActive]);
  useEffect(() => {
    setWatchedRunId(null);
  }, [focusedDocId]);

  /* ---- the library: what the module shows when nothing is focused ----
   * A finished translation outlives the run that produced it, so the three groups below are the
   * home state. Newest first, because a library is read from the top. */

  // One pairing of document → its latest run, shared by all three groups: the grouping is a
  // filter over the same list, not three separate derivations of it.
  const entries = useMemo(
    () => documents.map((doc) => ({ doc, run: runsByDoc.get(doc.document_id) ?? null })),
    [documents, runsByDoc],
  );

  const translated = useMemo(
    () =>
      entries
        .filter((entry) => entry.run?.state === "done")
        .sort((a, b) => (b.run?.finished_at ?? 0) - (a.run?.finished_at ?? 0)),
    [entries],
  );

  const inFlight = useMemo(() => entries.filter((entry) => isActive(entry.run)), [entries]);

  // Everything else: never run, or run to a non-`done` end (cancelled, failed). Both are waiting
  // on the user, so they share one group rather than being split by a distinction they do not feel.
  const waiting = useMemo(
    () => entries.filter((entry) => !isActive(entry.run) && entry.run?.state !== "done"),
    [entries],
  );

  /* ---- authoritative snapshots while anything is in flight ---- */

  const activeKey = runs.filter((run) => isActive(run)).map((run) => run.run_id).join(",");
  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    const timer = setInterval(() => {
      listTranslationRuns()
        .then((next) => {
          if (alive) setRuns(next.runs);
        })
        .catch(() => {});
    }, RUNS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeKey]);

  /* ---- cursor-polled event log: the progress driver ---- */

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const absorb = (events: TranslationRunEvent[]) => {
      if (!events.length) return;
      setProgress((prev) => {
        const base: Progress = prev[runId] ?? {
          stage: null,
          stage_index: -1,
          stage_current: 0,
          stage_total: 0,
          stage_progress: 0,
          overall_progress: 0,
        };
        const next = { ...base };
        for (const event of events) {
          if (typeof event.stage === "string" && event.stage) next.stage = event.stage;
          if (typeof event.stage_current === "number") next.stage_current = event.stage_current;
          if (typeof event.stage_total === "number") next.stage_total = event.stage_total;
          if (typeof event.stage_progress === "number") next.stage_progress = event.stage_progress;
          if (typeof event.overall_progress === "number") next.overall_progress = event.overall_progress;
        }
        return { ...prev, [runId]: next };
      });
      setFeed((prev) => {
        const lines = [...(prev[runId] ?? [])];
        for (const event of events) {
          lines.push({ seq: event.sequence, at: event.at, type: event.type, text: describeEvent(event) });
        }
        return { ...prev, [runId]: lines.slice(-FEED_LIMIT) };
      });
      const terminal = events.some((event) => ["finish", "error", "cancelled", "cancel"].includes(event.type));
      if (terminal) {
        getTranslationRun(runId)
          .then((fresh) => {
            if (!alive) return;
            setRuns((prev) => prev.map((run) => (run.run_id === fresh.run_id ? fresh : run)));
          })
          .catch(() => {});
      }
    };

    const poll = async () => {
      try {
        const page = await getTranslationRunEvents(runId, cursors.current.get(runId) ?? 0);
        if (!alive) return;
        cursors.current.set(runId, Math.max(cursors.current.get(runId) ?? 0, page.latest_sequence));
        absorb(page.events);
      } catch (caught) {
        if (alive) setError(errText(caught, "Run events could not be read."));
      }
      if (alive && runActive) timer = setTimeout(() => void poll(), EVENT_POLL_MS);
    };

    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, runActive]);

  /* ---- raw log tail ---- */

  useEffect(() => {
    if (!logOpen || !runId) return;
    const controller = new AbortController();
    setLog([]);
    streamTranslationRunLog(
      runId,
      (line) => setLog((prev) => [...prev, line].slice(-LOG_LIMIT)),
      controller.signal,
    ).catch(() => {});
    return () => controller.abort();
  }, [logOpen, runId]);

  /* ---- PDF preview, in its own browser tab ----
     A translated page has to be readable at full size, which an inline panel inside a three-column
     surface can never be. The artifact endpoint is authenticated, so the tab cannot just point at
     the URL: the bytes are fetched with the launch credential and handed over as a blob. Those blob
     URLs stay alive as long as this surface does — revoking one closes the tab reading it — and are
     released together when the module unmounts. */

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current = [];
  }, []);

  useEffect(() => setPreviewError(null), [runId]);

  /* ---- actions ---- */

  const announce = (message: string) => setStatus(message);

  /** A newly registered document joins the library and takes focus, so the next thing the user
   *  sees is the confirmation for the document they just added. */
  function mergeDocuments(added: TranslationDocument[]) {
    if (!added.length) return;
    setDocuments((prev) => {
      const seen = new Set(prev.map((doc) => doc.document_id));
      return [...prev, ...added.filter((doc) => !seen.has(doc.document_id))];
    });
    setFocusedDocId(added[0].document_id);
  }

  const registerFiles = async (files: File[]) => {
    const pdfs = files.filter((file) => /\.pdf$/i.test(file.name));
    if (!pdfs.length) {
      setError("Only PDF documents can be translated.");
      return;
    }
    setBusy("register");
    setError(null);
    try {
      const payload: TranslationUploadFile[] = await Promise.all(
        pdfs.map(async (file) => ({
          filename: file.name,
          content_base64: await readBase64(file),
          size: file.size,
        })),
      );
      const { documents: added } = await registerTranslationDocuments({ files: payload });
      mergeDocuments(added);
      announce(`${added.length} document${added.length === 1 ? "" : "s"} added to the library.`);
    } catch (caught) {
      setError(errText(caught, "Those documents could not be registered."));
    } finally {
      setBusy(null);
    }
  };

  const registerPaths = async () => {
    const paths = pathDraft
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!paths.length) return;
    setBusy("register");
    setError(null);
    try {
      const { documents: added } = await registerTranslationDocuments({ paths });
      mergeDocuments(added);
      setPathDraft("");
      announce(`${added.length} local document${added.length === 1 ? "" : "s"} registered.`);
    } catch (caught) {
      setError(errText(caught, "That path could not be registered."));
    } finally {
      setBusy(null);
    }
  };

  const start = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy("start");
    setError(null);
    try {
      const { runs: started } = await startTranslationRuns(ids);
      setRuns((prev) => {
        const byId = new Map(prev.map((run) => [run.run_id, run] as const));
        for (const run of started) byId.set(run.run_id, run);
        return [...byId.values()];
      });
      // A restarted run re-reads its event log from sequence 0, so its projection starts clean.
      for (const run of started) cursors.current.delete(run.run_id);
      setProgress((prev) => {
        const next = { ...prev };
        for (const run of started) delete next[run.run_id];
        return next;
      });
      setFeed((prev) => {
        const next = { ...prev };
        for (const run of started) next[run.run_id] = [];
        return next;
      });
      if (started[0]) setFocusedDocId(started[0].document_id);
      announce(`Started ${started.length} translation run${started.length === 1 ? "" : "s"}.`);
    } catch (caught) {
      setError(errText(caught, "The run could not be started."));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (id: string) => {
    setBusy("cancel");
    try {
      const fresh = await cancelTranslationRun(id);
      setRuns((prev) => prev.map((run) => (run.run_id === fresh.run_id ? fresh : run)));
      announce(`Run cancelled: ${fresh.filename}.`);
    } catch (caught) {
      setError(errText(caught, "The run could not be cancelled."));
    } finally {
      setBusy(null);
    }
  };

  // Removing a library entry drops this module's own bookkeeping (the registry entry and every
  // run folder) and cancels anything still running for it. The server decides whether the
  // document's bytes go too: a staged upload's copy is ours to delete, a path the user
  // registered never is, and a folder holding finished translations is left alone.
  const remove = async (doc: TranslationDocument) => {
    setBusy(`remove:${doc.document_id}`);
    setError(null);
    try {
      const removal = await forgetTranslationDocument(doc.document_id);
      const goneRunIds = new Set(runs.filter((run) => run.document_id === doc.document_id).map((run) => run.run_id));
      setDocuments((prev) => prev.filter((item) => item.document_id !== doc.document_id));
      setRuns((prev) => prev.filter((run) => run.document_id !== doc.document_id));
      // Drop the per-run projections too, or a re-registered document would inherit them.
      for (const runId of goneRunIds) cursors.current.delete(runId);
      const drop = <T,>(map: Record<string, T>): Record<string, T> =>
        Object.fromEntries(Object.entries(map).filter(([key]) => !goneRunIds.has(key)));
      setProgress((prev) => drop(prev));
      setFeed((prev) => drop(prev));
      setFocusedDocId((prev) => (prev === doc.document_id ? null : prev));
      const kept = removal.source_deleted ? "" : " The file itself was left in place.";
      announce(`Removed ${removal.filename}.${kept}`);
    } catch (caught) {
      setError(errText(caught, "That document could not be removed."));
    } finally {
      setBusy(null);
    }
  };

  /** Hand the bundle folder to the OS file manager. The server derives the folder from the run,
   *  so there is no path to pass; a failure is reported rather than swallowed. */
  const revealBundle = async () => {
    if (!runId) return;
    try {
      const outcome = await revealTranslationBundle(runId);
      announce(outcome.ok ? `Revealed ${outcome.path ?? bundleDir}` : outcome.error || "That folder could not be opened.");
      if (!outcome.ok) setError(outcome.error || "That folder could not be opened.");
    } catch (caught) {
      setError(errText(caught, "That folder could not be opened."));
    }
  };

  const copyPath = (path: string) => {
    navigator.clipboard?.writeText?.(path).catch(() => {});
    announce(`Copied ${path}`);
  };

  const openPreview = async (artifact: TranslationArtifact) => {
    if (!runId) return;
    setPreviewError(null);
    // The tab is claimed inside the click, before the await. A window opened after an async hop
    // has lost the user gesture and browsers block it as unsolicited.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await fetchTranslationArtifactBlobUrl(runId, artifact.name);
      previewUrls.current.push(url);
      if (!tab) {
        setPreviewError("Your browser blocked the preview tab. Allow pop-ups for this app, or use Download.");
        return;
      }
      tab.location.replace(url);
      announce(`Opened ${artifact.name} in a new tab.`);
    } catch (caught) {
      tab?.close();
      setPreviewError(errText(caught, "That artifact could not be previewed."));
    }
  };

  /* ---- derived view model ---- */

  const stages: TranslationStage[] = serverRun?.stages?.length ? serverRun.stages : TRANSLATE_STAGES;
  const live = runId ? progress[runId] : undefined;

  const stageIndex = (() => {
    if (!serverRun) return -1;
    if (serverRun.state === "done") return stages.length;
    if (live?.stage) {
      const found = stages.findIndex((stage) => stage.name === live.stage);
      if (found >= 0) return found;
    }
    return serverRun.stage_index;
  })();

  const stageCurrent = live?.stage_current ?? serverRun?.stage_current ?? 0;
  const stageTotal = live?.stage_total ?? serverRun?.stage_total ?? 0;
  const stageFrac = (() => {
    if (serverRun?.state === "done") return 1;
    const explicit = live?.stage_progress ?? serverRun?.stage_progress;
    if (typeof explicit === "number" && explicit > 0) return Math.min(1, explicit / 100);
    if (stageTotal > 0) return Math.min(1, stageCurrent / stageTotal);
    return 0;
  })();

  const overall = (() => {
    if (serverRun?.state === "done") return 100;
    if (!serverRun) return 0;
    const fromEvents = live?.overall_progress;
    return Math.max(0, Math.min(100, fromEvents ?? serverRun.overall_progress ?? 0));
  })();

  const currentStageName = stageIndex >= 0 && stageIndex < stages.length ? stages[stageIndex].name : null;
  const runFeed = runId ? feed[runId] ?? [] : [];
  const artifacts = serverRun?.artifacts ?? [];
  const bundleDir = serverRun?.bundle_dir || focusedDoc?.bundle_dir || (focusedDoc ? bundleDirFor(focusedDoc.source_path) : "");

  // A finished run the user OPENED, versus one that finished in front of them. The judge is
  // whether this surface ever SAW the run in flight — not whether events exist, because a past
  // run's log is replayed in full the moment it is opened. They deserve different surfaces: a
  // review shows what exists, not a 100% progress bar celebrating something long over.
  const reviewing = serverRun?.state === "done" && runId != null && watchedRunId !== runId;

  // Which step the flow is on. Derived from the run's own state rather than stored: the server
  // is the authority on whether a translation is pending, in flight, or finished, and a stored
  // step could disagree with it after a reload.
  const step: "confirm" | "translate" | "collect" = runActive
    ? "translate"
    : serverRun && !isActive(serverRun)
      ? "collect"
      : "confirm";

  const runLabel = serverRun
    ? `${STATE_LABEL[serverRun.state]} · ${overall.toFixed(0)}% overall${currentStageName ? ` · ${shortStage(currentStageName)}` : ""}`
    : "No run yet";

  /* ---- render ---- */

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper" data-testid="translation-view">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto hairline-scroll">
        <div className="mx-auto w-full max-w-[1480px] px-5 py-6 sm:px-7 sm:py-8">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="editorial-heading text-[26px] font-medium leading-[1.1] tracking-[-0.04em]">
                Document translation
              </h1>
              <p className="mt-1.5 text-[13px] leading-[1.5] text-muted">
                BabelDOC runs locally · source and translations are bundled beside the original file
              </p>
            </div>
            <div className="flex items-center gap-2">
              {langPair && <Pill tone="neutral">{langPair}</Pill>}
              {onOpenSettings && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:bg-panel hover:text-ink"
                  onClick={onOpenSettings}
                >
                  <Icon name="gear" size={13} /> Options
                </button>
              )}
            </div>
          </header>

          <p className="sr-only" role="status" aria-live="polite">
            {error ? error : status || runLabel}
          </p>

          {error && (
            <div
              className="mb-4 flex items-start gap-2 rounded-xl2 border border-line bg-dangerSoft px-3 py-2.5 text-[12px] text-danger"
              role="alert"
            >
              <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button type="button" className="shrink-0 text-[11px] underline" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}

          {/* A page filter is the one setting whose effect a successful run does NOT report: every
              stage completes, the bundle is written, and the pages outside the range are still in
              the source language. So the restriction is stated up front, next to the library it
              silently applies to, rather than being discovered by reading the output. */}
          {pagesLimit && (
            <div
              className="mb-4 flex items-start gap-2 rounded-xl2 border border-line bg-warnSoft px-3 py-2.5 text-[12px] text-warnInk"
              data-testid="translation-pages-restriction"
            >
              <Icon name="sliders" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Only {/^\d+$/.test(pagesLimit) ? `page ${pagesLimit} is` : `pages ${pagesLimit} are`} translated.{" "}
                {pagesDropped
                  ? "No other page appears in the output at all."
                  : "Every other page is copied through in its original language."}
              </span>
              {onOpenSettings && (
                <button type="button" className="shrink-0 text-[11px] underline" onClick={onOpenSettings}>
                  Change
                </button>
              )}
            </div>
          )}

          {focusedDoc ? (
            /* ---------------------------------------------------------------- the flow.
               One document, one screen per step. The prototype's shape: a narrow centred
               column so the single decision in front of the user has nothing to compete
               with. Each step REPLACES the last rather than accumulating panels. */
            <div
              className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-5 text-center"
              data-testid="translation-flow"
            >
              <button
                type="button"
                className="self-start inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-muted transition-colors hover:bg-panel hover:text-ink"
                onClick={() => setFocusedDocId(null)}
              >
                <Icon name="arrowLeft" size={13} />
                Back to library
              </button>

              {/* The rail belongs to a translation in flight. Reviewing a finished document is
                  not a step in that sequence, so it gets a plain heading that states when. */}
              {reviewing ? (
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.13em] text-faint"
                  data-testid="translation-record-when"
                >
                  Translated {serverRun?.finished_at ? relativeTime(serverRun.finished_at * 1000) : ""}
                </div>
              ) : (
                <StepRail step={step} />
              )}

              <section
                className="flex w-full flex-col items-center gap-4"
                aria-label={reviewing ? "Translation record" : "Current run"}
              >
                <div className="sr-only" data-testid="translation-run-phase">
                  {!serverRun
                    ? "Ready"
                    : serverRun.state === "done"
                      ? reviewing
                        ? "Translated"
                        : "Complete"
                      : serverRun.state === "error"
                        ? "Failed"
                        : serverRun.state === "cancelled"
                          ? "Cancelled"
                          : `Stage ${Math.max(0, stageIndex) + 1} of ${stages.length}`}
                </div>

                {step === "confirm" && (
                  <>
                    <h2 className="text-[27px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
                      {focusedDoc.filename}
                    </h2>
                    <p className="max-w-[420px] text-[13px] text-muted">
                      {focusedDoc.pages != null && `${focusedDoc.pages} pages · `}
                      {formatBytes(focusedDoc.size)}
                      {langPair ? ` · ${langPair}` : ""}
                    </p>
                    {/* The bundle directory is this integration's one added semantic, so it is
                        stated BEFORE the run rather than discovered by reading the output. */}
                    <div className={`${CARD} w-full p-[18px] text-left`} data-testid="translation-confirm">
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11.5px]">
                        <dt className="text-faint">Source</dt>
                        <dd className="m-0 break-all font-mono text-ink">{focusedDoc.source_path}</dd>
                        <dt className="text-faint">Bundle</dt>
                        <dd className="m-0 break-all font-mono text-accent">{bundleDir}/</dd>
                        <dt className="text-faint">Outputs</dt>
                        <dd className="m-0 text-ink">Bilingual + translated-only, plus the extracted glossary</dd>
                        <dt className="text-faint">Engine</dt>
                        <dd className="m-0 text-ink">BabelDOC, locally — nothing is copied elsewhere</dd>
                      </dl>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-xl2 bg-accent px-[18px] py-2.5 text-[13.5px] font-medium text-onSolid transition-opacity hover:opacity-90 disabled:opacity-40"
                        disabled={busy === "start"}
                        onClick={() => void start([focusedDoc.document_id])}
                      >
                        <Icon name="sparkle" size={15} /> Run translation
                      </button>
                      {onOpenSettings && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-xl2 border border-line px-[18px] py-2.5 text-[13.5px] text-muted transition-colors hover:bg-panel hover:text-ink"
                          onClick={onOpenSettings}
                        >
                          <Icon name="sliders" size={14} /> Options
                        </button>
                      )}
                    </div>
                  </>
                )}

                {step === "translate" && (
                  <>
                    <Radial
                      pct={overall}
                      label={`Overall translation progress for ${focusedDoc.filename}`}
                      valueText={
                        currentStageName
                          ? `${overall.toFixed(0)} percent · ${shortStage(currentStageName)}`
                          : `${overall.toFixed(0)} percent`
                      }
                    />
                    <div className="max-w-[220px] text-[11.5px] text-muted">
                      <strong className="block text-[13px] font-medium text-ink">
                        {currentStageName ? shortStage(currentStageName) : "starting"}
                      </strong>
                      stage {Math.max(0, stageIndex) + 1} of {stages.length}
                      {stageTotal > 0 && (
                        <>
                          {" · "}
                          <span className="font-mono tabular-nums">
                            {stageCurrent}/{stageTotal}
                          </span>{" "}
                          items
                        </>
                      )}
                      {serverRun && ` · ${formatDuration(serverRun.elapsed_seconds)}`}
                    </div>
                    <div className={`${CARD} w-full p-3.5 text-left`}>
                      <StageRows
                        stages={stages}
                        stageIndex={stageIndex}
                        stageFrac={stageFrac}
                        stageCurrent={stageCurrent}
                        stageTotal={stageTotal}
                        running
                        compact
                      />
                    </div>
                    <div className={`${CARD} w-full p-2.5 text-left`}>
                      <div className="mb-1.5 flex items-center gap-2 px-1">
                        <h4 className="text-[12px] font-semibold text-ink">Events</h4>
                        <Pill tone="neutral">{runFeed.length}</Pill>
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-1.5 py-0.5 text-[10.5px] text-muted transition-colors hover:bg-paper hover:text-ink"
                          aria-expanded={logOpen}
                          onClick={() => setLogOpen((prev) => !prev)}
                        >
                          <Icon name={logOpen ? "chevronDown" : "chevronRight"} size={11} /> Raw log
                        </button>
                      </div>
                      {runFeed.length === 0 ? (
                        <p className="px-1 pb-1 font-mono text-[10.5px] text-faint">waiting for the first event…</p>
                      ) : (
                        <div className="flex max-h-[150px] flex-col gap-0.5 overflow-y-auto rounded-lg bg-paper px-2 py-1.5 hairline-scroll">
                          {[...runFeed].reverse().map((line) => (
                            <div key={line.seq} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[1.55]">
                              <span className="shrink-0 tabular-nums text-faint">{clockOf(line.at)}</span>
                              <span
                                className={
                                  "w-[54px] shrink-0 truncate font-semibold " +
                                  (line.type === "error" ? "text-danger" : line.type === "finish" ? "text-ok" : "text-accent")
                                }
                              >
                                {line.type}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-muted" title={line.text}>
                                {line.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {logOpen && (
                        <pre
                          className="mt-1.5 max-h-[150px] overflow-auto rounded-lg bg-paper p-2 font-mono text-[10.5px] leading-[1.5] text-muted"
                          data-testid="translation-raw-log"
                        >
                          {log.length ? log.join("\n") : "No raw output yet."}
                        </pre>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-panel hover:text-ink disabled:opacity-40"
                        disabled={busy === "cancel"}
                        onClick={() => serverRun && void cancel(serverRun.run_id)}
                      >
                        <Icon name="x" size={13} /> Cancel run
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-panel hover:text-ink"
                        onClick={() => setFocusedDocId(null)}
                      >
                        Leave it running
                      </button>
                    </div>
                  </>
                )}

                {step === "collect" && (
                  <>
                    {/* The ring reports a run in flight reaching its end. A translation from last
                        week has no finish line to cross here, so it is simply absent. */}
                    {!reviewing && serverRun?.state === "done" && (
                      <Radial
                        pct={100}
                        done
                        label={`Overall translation progress for ${focusedDoc.filename}`}
                        valueText="100 percent · complete"
                      />
                    )}
                    <h2 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">
                      {serverRun?.state === "error"
                        ? "The run failed"
                        : serverRun?.state === "cancelled"
                          ? "Cancelled"
                          : reviewing
                            ? focusedDoc.filename
                            : "Bundled beside the original"}
                    </h2>
                    <p className="max-w-[420px] text-[13px] text-muted">
                      {serverRun?.state === "done"
                        ? `${serverRun.finished_at ? `${relativeTime(serverRun.finished_at * 1000)} · ` : ""}${formatDuration(serverRun.elapsed_seconds)} · ${artifacts.length} file${artifacts.length === 1 ? "" : "s"}`
                        : "Nothing was written."}
                    </p>
                    {serverRun?.state === "error" && serverRun.error && (
                      <p className="max-w-[420px] text-[12px] text-danger">{serverRun.error}</p>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:bg-panel disabled:opacity-40"
                      disabled={busy === "start"}
                      onClick={() => void start([focusedDoc.document_id])}
                    >
                      <Icon name="refresh" size={14} /> Run again
                    </button>
                  </>
                )}
              </section>

              {step === "collect" && (
                <section className="flex w-full flex-col gap-2.5 text-left" aria-label="Artifacts">
                  <BundlePath path={bundleDir} pending={serverRun?.state !== "done"} onCopy={copyPath} />

                  {artifacts.length === 0 ? (
                    <p className="rounded-xl2 border border-dashed border-line px-3 py-4 text-center text-[11.5px] leading-[1.5] text-muted">
                      {serverRun?.state === "error"
                        ? "The run failed before writing artifacts."
                        : serverRun?.state === "cancelled"
                          ? "Cancelled before any artifact was written."
                          : "Nothing was written to the bundle."}
                    </p>
                  ) : (
                    <>
                      <div className={`${CARD} p-3.5`}>
                        <BundleTree bundleDir={bundleDir} names={artifacts.map((artifact) => artifact.name)} />
                      </div>
                      <div className="flex flex-col gap-1">
                        {artifacts.map((artifact) => (
                          <div
                            key={artifact.name}
                            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-panel"
                            data-testid={`translation-artifact-${artifact.role}`}
                          >
                            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-panel text-muted">
                              <Icon
                                name={artifact.role === "glossary" ? "table" : artifact.role === "log" ? "fileCode" : "file"}
                                size={13}
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-medium text-ink" title={artifact.name}>
                                {artifact.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                                {ARTIFACT_ROLE_LABEL[artifact.role] ?? artifact.role} ·{" "}
                                <span className="font-mono tabular-nums">{formatBytes(artifact.size)}</span>
                              </span>
                            </span>
                            {/\.pdf$/i.test(artifact.name) && (
                              <button
                                type="button"
                                className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:bg-paper hover:text-ink"
                                onClick={() => void openPreview(artifact)}
                              >
                                Preview
                              </button>
                            )}
                            {runId && (
                              <a
                                className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:bg-paper hover:text-ink"
                                href={translationArtifactUrl(runId, artifact.name)}
                                download={artifact.name}
                              >
                                Download
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {runId && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-onSolid transition-opacity hover:opacity-90"
                        onClick={() => void revealBundle()}
                      >
                        <Icon name="folder" size={14} /> Reveal folder
                      </button>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-panel hover:text-ink"
                      onClick={() => copyPath(bundleDir)}
                    >
                      <Icon name="copy" size={14} /> Copy path
                    </button>
                  </div>

                  {previewError && (
                    <p className="text-[11px] text-danger" role="alert">
                      {previewError}
                    </p>
                  )}

                </section>
              )}
            </div>
          ) : (
            /* ---------------------------------------------------------------- the library.
               The resident home, and the whole surface while it is showing: a translation
               outlives the run that made it, so past bundles are the subject here — not an
               upload form, and not scaffolding for a run that has not been asked for. */
            <section
              className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col gap-4"
              aria-label="Translation library"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">Library</h2>
                  <p className="mt-1 text-[13px] leading-[1.5] text-muted">
                    {loading
                      ? "Loading your translations…"
                      : translated.length === 0
                        ? "Nothing translated yet. Every finished translation stays here, beside its original."
                        : `${translated.length} translated ${translated.length === 1 ? "document" : "documents"}, newest first. Each one is a folder beside its original.`}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl2 bg-accent px-[18px] py-2.5 text-[13.5px] font-medium text-onSolid transition-opacity hover:opacity-90"
                  onClick={() => {
                    setIntakeExpanded(true);
                    fileInput.current?.click();
                  }}
                >
                  <Icon name="sparkle" size={15} /> Translate a document
                </button>
              </div>

              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                aria-label="Choose PDF documents"
                onChange={(event) => {
                  void registerFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />

              {/* An empty shelf may advertise how to fill it. Once something is on it, the intake
                  folds away rather than outweighing the translations themselves. */}
              {intakeOpen && (
                <div className="flex flex-col gap-2">
                  <div
                    className={
                      "grid place-items-center gap-2 rounded-xl2 border-[1.5px] border-dashed px-4 py-6 text-center transition-colors duration-200 " +
                      (dragOver ? "border-accent bg-accentSoft text-accent" : "border-lineStrong bg-panel/60 text-muted")
                    }
                    role="button"
                    tabIndex={0}
                    aria-label="Add PDF documents: drop files here, or activate to choose files"
                    data-testid="translation-dropzone"
                    onClick={() => fileInput.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInput.current?.click();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOver(false);
                      void registerFiles(Array.from(event.dataTransfer?.files ?? []));
                    }}
                  >
                    <Icon name="folderPlus" size={26} />
                    <strong className="block text-[13px] font-medium text-ink">
                      Drop PDFs here, or click to choose
                    </strong>
                    <small className="text-[11px] leading-[1.45] text-faint">
                      Outputs land next to each source file — nothing is copied elsewhere
                    </small>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-[11px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                      placeholder="/absolute/path/paper.pdf"
                      aria-label="Register a local document by absolute path"
                      value={pathDraft}
                      onChange={(event) => setPathDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void registerPaths();
                      }}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-[11px] text-muted transition-colors hover:bg-panel hover:text-ink disabled:opacity-40"
                      disabled={!pathDraft.trim() || busy === "register"}
                      onClick={() => void registerPaths()}
                    >
                      Add path
                    </button>
                  </div>
                </div>
              )}

              {inFlight.length > 0 && (
                <section className="flex flex-col gap-1.5" aria-label="In progress">
                  <div className="flex items-center gap-1.5 px-1 text-[9.5px] font-bold uppercase tracking-[0.13em] text-faint">
                    <span className="h-[7px] w-[7px] rounded-full bg-accent" /> In progress
                  </div>
                  {inFlight.map(({ doc, run: docRun }) => (
                    <LibraryCard
                      key={doc.document_id}
                      doc={doc}
                      run={docRun}
                      live={docRun ? progress[docRun.run_id]?.overall_progress : undefined}
                      focused={false}
                      removing={busy === `remove:${doc.document_id}`}
                      onOpen={() => setFocusedDocId(doc.document_id)}
                      onRemove={() => void remove(doc)}
                    />
                  ))}
                </section>
              )}

              {translated.length > 0 && (
                <section className="flex flex-col gap-1.5" aria-label="Translated documents">
                  <div className="px-1 text-[9.5px] font-bold uppercase tracking-[0.13em] text-faint">Translated</div>
                  {translated.map(({ doc, run: docRun }) => (
                    <LibraryCard
                      key={doc.document_id}
                      doc={doc}
                      run={docRun}
                      focused={false}
                      removing={busy === `remove:${doc.document_id}`}
                      onOpen={() => setFocusedDocId(doc.document_id)}
                      onRemove={() => void remove(doc)}
                    />
                  ))}
                </section>
              )}

              {waiting.length > 0 && (
                <section className="flex flex-col gap-1.5" aria-label="Not translated yet">
                  <div className="px-1 text-[9.5px] font-bold uppercase tracking-[0.13em] text-faint">
                    Not translated yet
                  </div>
                  {waiting.map(({ doc, run: docRun }) => (
                    <LibraryCard
                      key={doc.document_id}
                      doc={doc}
                      run={docRun}
                      focused={false}
                      removing={busy === `remove:${doc.document_id}`}
                      onOpen={() => setFocusedDocId(doc.document_id)}
                      onRemove={() => void remove(doc)}
                      onRun={() => void start([doc.document_id])}
                      starting={busy === "start"}
                    />
                  ))}
                </section>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ helpers */

function describeEvent(event: TranslationRunEvent): string {
  const stage = typeof event.stage === "string" && event.stage ? shortStage(event.stage) : null;
  if (typeof event.message === "string" && event.message) return stage ? `${stage} · ${event.message}` : event.message;
  if (event.type === "progress_end" && stage) {
    const overall = typeof event.overall_progress === "number" ? ` · ${event.overall_progress.toFixed(1)}% overall` : "";
    return `${stage} complete${overall}`;
  }
  if (stage) {
    const counts =
      typeof event.stage_current === "number" && typeof event.stage_total === "number"
        ? ` ${event.stage_current}/${event.stage_total}`
        : "";
    return `${stage}${counts}`;
  }
  return event.type;
}

function clockOf(at: number): string {
  const ms = at > 1e11 ? at : at * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

/** base64 of a picked file, via FileReader's data URL (no new dependency, works in the webview). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

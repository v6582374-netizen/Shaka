// PROTOTYPE PLAN: three structurally different layouts for the BabelDOC document-translation
// module, on ?prototype=babeldoc, switchable via ?variant=A|B|C.
//
//   A — Run desk        three columns: queue · live run · artifacts. Nothing ever navigates away.
//   B — Focus flow      a library of past translations; entering one document gives it the
//                       whole screen: a single big radial and a staged reveal.
//   C — Batch monitor   a table of runs with inline expansion; built for many documents.
//
// All three drive the SAME simulated event stream (babeldocPrototypeModel.ts), whose stages,
// weights, and event shapes are copied from BabelDOC's own TRANSLATE_STAGES / async_translate.
// The one behavior we add on top of upstream: when a run finishes, the source document and every
// artifact are collected into one folder created beside the ORIGINAL document's absolute path.
// Actions are inert; nothing is persisted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import {
  BABELDOC_STAGES,
  DEFAULT_OPTIONS,
  HISTORY_SEEDS,
  SAMPLE_DOCS,
  STAGE_SHORT,
  bundleDirFor,
  bundleFilesFor,
  changedKeys,
  dirOf,
  finishedDoc,
  newDoc,
  relativeTime,
  runDoc,
  useSpringValue,
  type DocState,
  type LogLine,
  type ProgressEvent,
} from "./babeldocPrototypeModel";
import "./babeldoc-prototype.css";

type VariantKey = "A" | "B" | "C";
const VARIANTS: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: "A", name: "Run desk", description: "Queue · live run · artifacts, all resident" },
  { key: "B", name: "Focus flow", description: "Library home, then one document at a time" },
  { key: "C", name: "Batch monitor", description: "Run table with inline expansion" },
];

const totalWeight = BABELDOC_STAGES.reduce((a, s) => a + s.weight, 0);
const short = (stage: string) => STAGE_SHORT[stage] ?? stage;

/* ------------------------------------------------------------------ shared pieces */

function useRuns() {
  const [docs, setDocs] = useState<DocState[]>([]);
  const stops = useRef(new Map<string, () => void>());

  const push = useCallback((seeds: typeof SAMPLE_DOCS) => {
    setDocs((prev) => {
      const have = new Set(prev.map((d) => d.id));
      return [...prev, ...seeds.filter((s) => !have.has(s.id)).map(newDoc)];
    });
  }, []);

  const apply = useCallback((id: string, ev: ProgressEvent, patch: Partial<DocState>) => {
    setDocs((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch } as DocState;
        const line = logLineFor(ev);
        if (line) next.log = [...d.log, line].slice(-160);
        return next;
      }),
    );
  }, []);

  const start = useCallback(
    (id: string, speed = 1) => {
      setDocs((prev) => {
        const doc = prev.find((d) => d.id === id);
        if (!doc || doc.status === "running") return prev;
        stops.current.get(id)?.();
        stops.current.set(id, runDoc({ ...doc, status: "running", log: [] }, { speed, onEvent: apply }));
        return prev.map((d) => (d.id === id ? { ...d, status: "running", overall: 0, log: [], result: null, elapsed: 0 } : d));
      });
    },
    [apply],
  );

  const reset = useCallback((id: string) => {
    stops.current.get(id)?.();
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...newDoc(d), id: d.id } : d)));
  }, []);

  /** Drop a document and its run entirely. Distinct from `reset`, which keeps the document and
   *  only clears its run — a library needs both "run it again" and "I am done with this". */
  const forget = useCallback((id: string) => {
    stops.current.get(id)?.();
    stops.current.delete(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }, []);

  /** Load runs that completed before this session. The module is opened to LOOK at these at
   *  least as often as to start a new one, so they exist from the first frame. */
  const seed = useCallback((entries: DocState[]) => {
    setDocs((prev) => {
      const have = new Set(prev.map((d) => d.id));
      return [...prev, ...entries.filter((e) => !have.has(e.id))];
    });
  }, []);

  useEffect(() => () => stops.current.forEach((stop) => stop()), []);
  return { docs, push, start, reset, forget, seed };
}

function logLineFor(ev: ProgressEvent): LogLine | null {
  const t = Date.now();
  if (ev.type === "progress_start") return { t, kind: "start", stage: ev.stage, detail: `0/${ev.stage_total}` };
  if (ev.type === "progress_end") return { t, kind: "end", stage: ev.stage, detail: `${ev.stage_total}/${ev.stage_total} · ${ev.overall_progress.toFixed(1)}% overall` };
  if (ev.type === "finish") return { t, kind: "finish", stage: "finish", detail: `bundle → ${ev.translate_result.bundle_dir}` };
  if (ev.type === "error") return { t, kind: "error", stage: "error", detail: ev.error };
  return null;
}

function Bar({ pct, done, thin }: { pct: number; done?: boolean; thin?: boolean }) {
  const v = useSpringValue(Math.max(0, Math.min(100, pct)));
  return (
    <div className={`bd-bar${thin ? " bd-bar--thin" : ""}${done ? " bd-bar--done" : ""}`}>
      <i style={{ transform: `scaleX(${(v / 100).toFixed(4)})`, width: "100%" }} />
    </div>
  );
}

/** One weighted segment. Its own component so the spring hook is not called inside a loop. */
function WeightedSegment({ stage, weight, frac }: { stage: string; weight: number; frac: number }) {
  const spring = useSpringValue(frac);
  return (
    <span style={{ flex: weight }} className={frac >= 1 ? "is-done" : undefined} title={`${short(stage)} · ${((weight / totalWeight) * 100).toFixed(1)}%`}>
      <i style={{ transform: `scaleX(${spring.toFixed(4)})` }} />
    </span>
  );
}

/** Weight-proportional segments: the bar itself teaches which stage owns the wall time. */
function WeightedBar({ doc }: { doc: DocState }) {
  return (
    <div className="bd-bar-track-weights" title="Segment width = BabelDOC stage weight">
      {BABELDOC_STAGES.map((s, i) => (
        <WeightedSegment
          key={s.name}
          stage={s.name}
          weight={s.weight}
          frac={doc.stageIndex > i || doc.status === "done" ? 1 : doc.stageIndex === i ? doc.stageProgress / 100 : 0}
        />
      ))}
    </div>
  );
}

function StageList({ doc, compact }: { doc: DocState; compact?: boolean }) {
  return (
    <div className="bd-stage-list">
      {BABELDOC_STAGES.map((s, i) => {
        const done = doc.stageIndex > i || doc.status === "done";
        const active = doc.stageIndex === i && doc.status === "running";
        if (compact && !done && !active && i > (doc.stageIndex < 0 ? 1 : doc.stageIndex + 2)) return null;
        return (
          <div key={s.name} className={`bd-stage${done ? " is-done" : ""}${active ? " is-active" : ""}`}>
            <span className="bd-stage-mark">{done ? <Icon name="sparkle" size={11} /> : i + 1}</span>
            <div>
              <div className="bd-stage-name">{short(s.name)}</div>
              {active && (
                <>
                  <div className="bd-stage-bar"><Bar pct={doc.stageProgress} thin /></div>
                  <div className="bd-stage-meta" style={{ marginTop: 4 }}>
                    {doc.stageCurrent}/{doc.stageTotal} items
                  </div>
                </>
              )}
            </div>
            <span className="bd-stage-weight">{((s.weight / totalWeight) * 100).toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function EventLog({ doc }: { doc: DocState }) {
  const lines = [...doc.log].reverse();
  return (
    <div className="bd-log" style={{ flex: 1 }}>
      {lines.length === 0 && <div className="bd-log-line"><span className="bd-log-t">--:--</span> waiting for the first event…</div>}
      {lines.map((l, i) => (
        <div key={`${l.t}-${i}`} className={`bd-log-line${l.kind === "end" || l.kind === "finish" ? " is-end" : ""}`}>
          <span className="bd-log-t">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>
          <b>{l.kind === "finish" ? "finish" : l.kind === "start" ? "start" : "end"}</b>
          <span>{l.kind === "finish" ? l.detail : `${short(l.stage)} ${l.detail}`}</span>
        </div>
      ))}
    </div>
  );
}

/** The added behavior, made visible: one folder beside the original, holding everything. */
function BundlePanel({ doc, onAction }: { doc: DocState; onAction: (m: string) => void }) {
  const bundle = bundleDirFor(doc);
  const files = bundleFilesFor(doc);
  return (
    <>
      <div className="bd-bundle">
        <div className="bd-eyebrow" style={{ color: "var(--ok)" }}>BUNDLED BESIDE THE ORIGINAL</div>
        <div className="bd-bundle-path"><Icon name="folder" size={13} />{bundle}/</div>
      </div>
      <div className="bd-tree">
        <div><b>{dirOf(doc.sourcePath)}/</b></div>
        <div>└─ <em>{bundle.split("/").pop()}/</em></div>
        {files.map((f, i) => (
          <div key={f.name} style={{ paddingLeft: 22 }}>{i === files.length - 1 ? "└─" : "├─"} {f.name}</div>
        ))}
      </div>
      <div>
        {files.map((f) => (
          <div key={f.name} className="bd-file-row">
            <span className="bd-file-glyph"><Icon name={f.kind === "meta" ? "table" : "file"} size={13} /></span>
            <span className="bd-file-main">
              <strong>{f.name}</strong>
              <small>{f.role} · {f.size}</small>
            </span>
            <span className="bd-file-actions">
              <button className="bd-btn bd-btn--ghost" data-press onClick={() => onAction(`Open ${f.name}`)}>Open</button>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="bd-btn bd-btn--primary" data-press onClick={() => onAction(`Reveal ${bundle} in the file manager`)}>
          <Icon name="folder" size={14} /> Reveal folder
        </button>
        <button className="bd-btn" data-press onClick={() => onAction(`Copied ${bundle}`)}><Icon name="copy" size={14} /> Copy path</button>
      </div>
    </>
  );
}

function DropZone({ onAdd, className, big }: { onAdd: () => void; className?: string; big?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`bd-drop${over ? " is-over" : ""}${className ? ` ${className}` : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(); }}
      onClick={onAdd}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onAdd(); }}
      data-press
    >
      <Icon name="folderPlus" size={big ? 26 : 20} />
      <strong>{big ? "Drop PDFs here, or click to choose" : "Drop PDFs or click to add"}</strong>
      <small>Outputs land next to each source file — nothing is copied elsewhere</small>
    </div>
  );
}

function ActiveOptions({ onAction }: { onAction: (m: string) => void }) {
  const changed = changedKeys(DEFAULT_OPTIONS);
  return (
    <div className="bd-card" style={{ padding: 12 }}>
      <div className="bd-section-head" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 12.5 }}>Processing options</h2>
        <span className="bd-tag">{changed.length === 0 ? "Defaults" : `${changed.length} changed`}</span>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--muted)" }}>
        Owned by Settings → Document Translation, so a run is one click. English → Chinese, bilingual + translated-only,
        glossary extraction on.
      </p>
      <button className="bd-btn bd-btn--ghost" data-press style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => onAction("Would open Settings → Document Translation")}>
        <Icon name="gear" size={13} /> Edit in Settings
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ variant A: run desk */

function VariantA({ runs, onAction }: { runs: ReturnType<typeof useRuns>; onAction: (m: string) => void }) {
  const { docs, push, start, reset } = runs;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;

  const addNext = () => {
    const next = SAMPLE_DOCS.filter((s) => !docs.some((d) => d.id === s.id))[0];
    if (!next) return onAction("All sample documents are already queued");
    push([next]);
    setSelectedId(next.id);
  };

  return (
    <div className="bd-desk">
      <div className="bd-desk-col">
        <div className="bd-desk-head">
          <h2>Documents</h2>
          <span className="bd-tag">{docs.length}</span>
        </div>
        <DropZone onAdd={addNext} />
        <div className="bd-queue">
          {docs.map((d) => (
            <button key={d.id} className={`bd-queue-row${selected?.id === d.id ? " is-selected" : ""}`} onClick={() => setSelectedId(d.id)} data-press>
              <span className="bd-queue-glyph"><Icon name="file" size={14} /></span>
              <span className="bd-queue-main">
                <strong>{d.name}</strong>
                <small>{d.pages} pages · {dirOf(d.sourcePath)}</small>
              </span>
              {d.status === "done" ? <span className="bd-tag bd-tag--ok">Bundled</span> : d.status === "running" ? <span className="bd-queue-pct">{d.overall.toFixed(0)}%</span> : <span className="bd-tag">Queued</span>}
            </button>
          ))}
        </div>
        <ActiveOptions onAction={onAction} />
      </div>

      <div className="bd-desk-col bd-desk-col--center">
        {!selected ? (
          <div style={{ margin: "auto", textAlign: "center", color: "var(--muted)" }}>
            <Icon name="file" size={26} />
            <p style={{ fontSize: 12.5 }}>Add a document to start a run.</p>
          </div>
        ) : (
          <>
            <div className="bd-run-hero bd-card">
              <div>
                <span className="bd-eyebrow">{selected.status === "done" ? "COMPLETE" : selected.status === "running" ? `STAGE ${selected.stageIndex + 1} OF ${BABELDOC_STAGES.length}` : "READY"}</span>
                <h1>{selected.name}</h1>
                <p>{selected.pages} pages · {selected.sizeMb.toFixed(1)} MB · en → zh</p>
              </div>
              <div className="bd-run-figure">
                <strong>{selected.overall.toFixed(0)}<span style={{ fontSize: 20, fontWeight: 500 }}>%</span></strong>
                <small>{selected.status === "running" ? short(BABELDOC_STAGES[Math.max(0, selected.stageIndex)].name) : selected.status === "done" ? `finished in ${selected.elapsed.toFixed(1)}s` : "not started"}</small>
              </div>
              <WeightedBar doc={selected} />
              <div className="bd-run-actions">
                {selected.status === "running" ? (
                  <button className="bd-btn" data-press onClick={() => reset(selected.id)}><Icon name="x" size={14} /> Cancel</button>
                ) : (
                  <button className="bd-btn bd-btn--primary bd-btn--lg" data-press onClick={() => start(selected.id)}>
                    <Icon name="sparkle" size={15} /> {selected.status === "done" ? "Run again" : "Run translation"}
                  </button>
                )}
                <button className="bd-btn bd-btn--ghost" data-press onClick={() => start(selected.id, 6)}>Fast-forward</button>
                <span className="bd-tag" style={{ marginLeft: "auto" }}>{selected.elapsed.toFixed(1)}s elapsed</span>
              </div>
            </div>
            <div className="bd-card" style={{ padding: 14 }}>
              <div className="bd-section-head"><h2>Stages</h2><span className="bd-tag">BabelDOC weights</span></div>
              <StageList doc={selected} />
            </div>
            <div className="bd-card" style={{ display: "flex", flexDirection: "column", padding: 12, minHeight: 190 }}>
              <div className="bd-section-head"><h2>Event stream</h2><span className="bd-tag">async_translate</span></div>
              <EventLog doc={selected} />
            </div>
          </>
        )}
      </div>

      <div className="bd-desk-col">
        <div className="bd-desk-head"><h2>Artifacts</h2>{selected?.status === "done" && <span className="bd-tag bd-tag--ok">Bundled</span>}</div>
        {selected?.status === "done" ? (
          <BundlePanel doc={selected} onAction={onAction} />
        ) : (
          <>
            <div className="bd-card" style={{ padding: 12 }}>
              <div className="bd-eyebrow">WILL BE WRITTEN TO</div>
              <div className="bd-mono" style={{ marginTop: 6, wordBreak: "break-all", color: "var(--muted)" }}>{selected ? `${bundleDirFor(selected)}/` : "—"}</div>
              <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--muted)" }}>
                A folder named after the document, created beside the original. The source moves in with the outputs, so the
                pair never drifts apart.
              </p>
            </div>
            {selected && bundleFilesFor(selected).map((f) => (
              <div key={f.name} className="bd-file-row" style={{ opacity: 0.45 }}>
                <span className="bd-file-glyph"><Icon name="file" size={13} /></span>
                <span className="bd-file-main"><strong>{f.name}</strong><small>{f.role}</small></span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ variant B: focus flow */

function Radial({ pct, done }: { pct: number; done: boolean }) {
  const v = useSpringValue(pct);
  const r = 104;
  const c = 2 * Math.PI * r;
  return (
    <div className="bd-radial">
      <svg viewBox="0 0 232 232">
        <circle className="bd-radial-track" cx="116" cy="116" r={r} fill="none" strokeWidth="9" />
        <circle
          className={`bd-radial-fill${done ? " is-done" : ""}`}
          cx="116" cy="116" r={r} fill="none" strokeWidth="9"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
        />
      </svg>
      <div style={{ display: "grid", placeItems: "center" }}>
        <div className="bd-radial-num">{Math.round(v)}<span style={{ fontSize: 20, fontWeight: 500 }}>%</span></div>
      </div>
    </div>
  );
}

/**
 * B — Focus flow, rebuilt around a Library home.
 *
 * The original B was one document at a time and nothing else, which quietly asserted that the
 * module IS a run in progress. A finished translation outlives its run: the common visit is
 * "show me what I translated last week", not "start something new". So B now has two states,
 * and only one of them is the flow:
 *
 *   Library  — the resident home. Past bundles, newest first, plus anything running right now.
 *              Reachable at every step, so the flow is a place you enter and leave, not a trap.
 *   Flow     — Confirm → Translate → Collect for ONE document, which is what B is good at.
 *
 * Focus is preserved by making it a *destination* rather than the only room. Everything else
 * (staged reveal, single radial, one decision per screen) is unchanged.
 */

function HistoryCard({
  doc,
  onOpen,
  onForget,
}: {
  doc: DocState;
  onOpen: () => void;
  onForget: () => void;
}) {
  const running = doc.status === "running";
  return (
    <div className={`bd-lib-card${running ? " is-running" : ""}`}>
      <button className="bd-lib-hit" data-press onClick={onOpen} aria-label={`Open ${doc.name}`}>
        <span className="bd-lib-glyph">
          <Icon name={running ? "refresh" : "library"} size={14} />
        </span>
        <span className="bd-lib-text">
          <strong>{doc.name}</strong>
          <small className="bd-mono">{running ? dirOf(doc.sourcePath) : `${bundleDirFor(doc)}/`}</small>
        </span>
        <span className="bd-lib-meta">
          {running ? (
            <>
              <em>{short(BABELDOC_STAGES[Math.max(0, doc.stageIndex)].name)}</em>
              <span className="bd-lib-pct">{doc.overall.toFixed(0)}%</span>
            </>
          ) : (
            <>
              <em>{doc.finishedAt ? relativeTime(doc.finishedAt) : "ready"}</em>
              <span className="bd-lib-pct">{doc.pages} pages</span>
            </>
          )}
        </span>
      </button>
      {running ? (
        <div className="bd-lib-progress"><Bar pct={doc.overall} thin /></div>
      ) : (
        <button className="bd-lib-forget" data-press onClick={onForget} aria-label={`Forget ${doc.name}`}>
          <Icon name="trash" size={13} />
        </button>
      )}
    </div>
  );
}

function VariantB({ runs, onAction }: { runs: ReturnType<typeof useRuns>; onAction: (m: string) => void }) {
  const { docs, push, start, reset, forget, seed } = runs;
  // Which document the flow is focused on. `null` means the Library is showing — the home
  // state, and where the module opens.
  const [focusId, setFocusId] = useState<string | null>(null);

  // Past translations exist before the user does anything, because that is the case this
  // variant was missing: opening the module to LOOK at a translation, not to start one.
  useEffect(() => {
    seed([
      finishedDoc(HISTORY_SEEDS[0], 42 * 60_000, 41.2),
      finishedDoc(HISTORY_SEEDS[1], 26 * 60 * 60_000, 63.8),
      finishedDoc(HISTORY_SEEDS[2], 6 * 24 * 60 * 60_000, 18.4),
    ]);
  }, [seed]);

  const doc = docs.find((d) => d.id === focusId) ?? null;
  const running = docs.filter((d) => d.status === "running");
  const library = useMemo(
    () =>
      docs
        .filter((d) => d.status === "done")
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [docs],
  );

  // Leaving the flow is navigation, nothing more. It never destroys a run: the whole point of a
  // library home is that a translation outlives the moment you were looking at it. Discarding is
  // its own explicit act, on the card ("forget"), never a side effect of pressing Back.
  const leave = () => setFocusId(null);

  const add = () => {
    const next = SAMPLE_DOCS.find((s) => !docs.some((d) => d.id === s.id));
    if (!next) return onAction("Every sample document is already in the library");
    push([next]);
    setFocusId(next.id);
  };

  if (!doc) {
    return (
      <div className="bd-focus">
        <div className="bd-focus-inner bd-focus-inner--wide">
          <div className="bd-lib-head">
            <div>
              <h1>Document Translation</h1>
              <p style={{ margin: "4px 0 0" }}>
                {library.length === 0
                  ? "Nothing translated yet. Every finished translation stays here, beside its original."
                  : `${library.length} translated ${library.length === 1 ? "document" : "documents"}, newest first. Each one is a folder beside its original.`}
              </p>
            </div>
            <button className="bd-btn bd-btn--primary bd-btn--lg" data-press onClick={add}>
              <Icon name="sparkle" size={15} /> Translate a document
            </button>
          </div>

          {running.length > 0 && (
            <section className="bd-lib-section">
              <div className="bd-lib-label">
                <span className="bd-dot bd-dot--live" /> In progress
              </div>
              {running.map((d) => (
                <HistoryCard key={d.id} doc={d} onOpen={() => setFocusId(d.id)} onForget={() => forget(d.id)} />
              ))}
            </section>
          )}

          <section className="bd-lib-section">
            {library.length > 0 && <div className="bd-lib-label">Translated</div>}
            {library.map((d) => (
              <HistoryCard key={d.id} doc={d} onOpen={() => setFocusId(d.id)} onForget={() => forget(d.id)} />
            ))}
            {library.length === 0 && running.length === 0 && (
              <DropZone big className="bd-focus-drop" onAdd={add} />
            )}
          </section>
        </div>
      </div>
    );
  }

  // A finished document opened from the Library lands directly on Collect — reviewing a past
  // translation must not look like a run that is about to start.
  const step = doc.status === "queued" ? 1 : doc.status === "running" ? 2 : 3;
  // A run watched here leaves its event log behind; one loaded from the library has none.
  // That distinction decides whether this screen is a finish line or a record.
  const reviewing = doc.status === "done" && doc.log.length === 0;

  return (
    <div className="bd-focus">
      <div className="bd-focus-inner">
        <button className="bd-focus-back" data-press onClick={leave}>
          <Icon name="arrowLeft" size={13} /> Library
        </button>

        {/* The step trail belongs to a translation in flight. Reviewing a finished document is
            not a step in that sequence, so it gets a plain heading instead. */}
        {reviewing ? (
          <div className="bd-lib-label" style={{ alignSelf: "center" }}>
            Translated {doc.finishedAt ? relativeTime(doc.finishedAt) : ""}
          </div>
        ) : (
          <div className="bd-focus-steps">
            {["Choose", "Confirm", "Translate", "Collect"].map((label, i) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, color: i === step ? "var(--ink)" : undefined }}>
                {label}
                {i < 3 && <i className={i < step ? "is-on" : undefined} />}
              </span>
            ))}
          </div>
        )}

        {step === 1 && (
          <>
            <h1>{doc.name}</h1>
            <p>{doc.pages} pages · {doc.sizeMb.toFixed(1)} MB · English → Chinese</p>
            <div className="bd-card bd-focus-sheet">
              <dl className="bd-kv">
                <dt>Source</dt><dd className="bd-mono">{doc.sourcePath}</dd>
                <dt>Bundle</dt><dd className="bd-mono" style={{ color: "var(--accent)" }}>{bundleDirFor(doc)}/</dd>
                <dt>Outputs</dt><dd>Bilingual + translated-only, watermarked</dd>
                <dt>Options</dt><dd>Settings defaults ({changedKeys(DEFAULT_OPTIONS).length} changed)</dd>
              </dl>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bd-btn bd-btn--primary bd-btn--lg" data-press onClick={() => start(doc.id)}><Icon name="sparkle" size={15} /> Run translation</button>
              <button className="bd-btn bd-btn--lg" data-press onClick={() => start(doc.id, 6)}>Fast-forward</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Radial pct={doc.overall} done={false} />
            <div className="bd-radial-cap">
              <strong style={{ display: "block", fontSize: 13, color: "var(--ink)" }}>{short(BABELDOC_STAGES[Math.max(0, doc.stageIndex)].name)}</strong>
              stage {doc.stageIndex + 1} of {BABELDOC_STAGES.length} · {doc.stageCurrent}/{doc.stageTotal} items · {doc.elapsed.toFixed(0)}s
            </div>
            <div className="bd-card bd-focus-detail" style={{ padding: 14 }}>
              <StageList doc={doc} compact />
            </div>
            <div className="bd-card bd-focus-detail" style={{ padding: 10, minHeight: 130, display: "flex" }}>
              <EventLog doc={doc} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bd-btn bd-btn--ghost" data-press onClick={() => reset(doc.id)}>Cancel run</button>
              <button className="bd-btn bd-btn--ghost" data-press onClick={() => setFocusId(null)}>Leave it running</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {/* The ring reports a run in flight reaching its end. Reviewing a translation from
                last week has no progress to report, so it is simply absent. */}
            {!reviewing && <Radial pct={100} done />}
            <h1 style={{ fontSize: 22 }}>{reviewing ? doc.name : "Bundled beside the original"}</h1>
            <p>
              {doc.finishedAt ? `${relativeTime(doc.finishedAt)} · ` : ""}
              {doc.elapsed.toFixed(1)}s · {doc.result?.total_valid_character_count.toLocaleString()} characters translated.
            </p>
            <div className="bd-card bd-focus-detail" style={{ padding: 14 }}>
              <BundlePanel doc={doc} onAction={onAction} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="bd-btn" data-press onClick={() => start(doc.id, 6)}><Icon name="refresh" size={14} /> Translate again</button>
              <button className="bd-btn bd-btn--ghost" data-press onClick={() => setFocusId(null)}>Back to library</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ variant C: batch monitor */

function VariantC({ runs, onAction }: { runs: ReturnType<typeof useRuns>; onAction: (m: string) => void }) {
  const { docs, push, start, reset } = runs;
  const [openId, setOpenId] = useState<string | null>(null);
  const running = docs.filter((d) => d.status === "running").length;
  const done = docs.filter((d) => d.status === "done").length;
  const aggregate = docs.length ? docs.reduce((a, d) => a + d.overall, 0) / docs.length : 0;

  useEffect(() => {
    if (docs.length === 0) push(SAMPLE_DOCS);
  }, [docs.length, push]);

  return (
    <div className="bd-batch">
      <div className="bd-batch-toolbar">
        <button className="bd-btn bd-btn--primary" data-press onClick={() => docs.filter((d) => d.status !== "running").forEach((d) => start(d.id, 2))}>
          <Icon name="sparkle" size={14} /> Run all
        </button>
        <button className="bd-btn" data-press onClick={() => push(SAMPLE_DOCS)}><Icon name="folderPlus" size={14} /> Add documents</button>
        <button className="bd-btn bd-btn--ghost" data-press onClick={() => docs.forEach((d) => reset(d.id))}><Icon name="refresh" size={14} /> Reset</button>
        <span className="bd-tag" style={{ marginLeft: "auto" }}>en → zh</span>
        <button className="bd-btn bd-btn--ghost" data-press onClick={() => onAction("Would open Settings → Document Translation")}><Icon name="gear" size={14} /> Options</button>
      </div>

      <div className="bd-batch-table">
        <div className="bd-batch-row is-head">
          <span />
          <span>Document</span>
          <span>Progress</span>
          <span>Stage</span>
          <span style={{ textAlign: "right" }}>Elapsed</span>
          <span />
        </div>
        {docs.map((d) => (
          <div key={d.id}>
            <div className="bd-batch-row">
              <span className="bd-queue-glyph" style={{ width: 26, height: 26 }}>
                <Icon name={d.status === "done" ? "table" : "file"} size={13} />
              </span>
              <span className="bd-batch-name">
                <strong>{d.name}</strong>
                <small>{d.status === "done" ? `${bundleDirFor(d)}/` : dirOf(d.sourcePath)}</small>
              </span>
              <span><Bar pct={d.overall} done={d.status === "done"} thin /></span>
              <span className="bd-batch-stage">
                {d.status === "running" ? short(BABELDOC_STAGES[Math.max(0, d.stageIndex)].name) : d.status === "done" ? "Bundled beside original" : "Queued"}
              </span>
              <span className="bd-batch-pct">{d.status === "queued" ? "—" : `${d.elapsed.toFixed(0)}s`}</span>
              <button className="bd-batch-expand" data-press onClick={() => setOpenId(openId === d.id ? null : d.id)} aria-label="Toggle detail">
                <Icon name={openId === d.id ? "chevronDown" : "chevronRight"} size={14} />
              </button>
            </div>
            {openId === d.id && (
              <div className="bd-batch-detail">
                <div>
                  <div className="bd-section-head"><h2>Stages</h2><span className="bd-tag">{d.overall.toFixed(0)}%</span></div>
                  <StageList doc={d} />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {d.status === "running" ? (
                      <button className="bd-btn" data-press onClick={() => reset(d.id)}>Cancel</button>
                    ) : (
                      <button className="bd-btn bd-btn--primary" data-press onClick={() => start(d.id, 2)}>{d.status === "done" ? "Run again" : "Run"}</button>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  {d.status === "done" ? (
                    <BundlePanel doc={d} onAction={onAction} />
                  ) : (
                    <>
                      <div className="bd-card" style={{ padding: 11 }}>
                        <div className="bd-eyebrow">BUNDLE TARGET</div>
                        <div className="bd-mono" style={{ marginTop: 5, wordBreak: "break-all", color: "var(--muted)" }}>{bundleDirFor(d)}/</div>
                      </div>
                      <div className="bd-batch-detail-log"><EventLog doc={d} /></div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bd-batch-foot">
        <span className="bd-dot bd-dot--live" style={{ background: running ? undefined : "var(--faint)" }} />
        <span className="bd-batch-foot-figure">{running} running · {done} bundled · {docs.length} total</span>
        <div style={{ flex: 1, maxWidth: 320 }}><Bar pct={aggregate} done={done === docs.length && docs.length > 0} /></div>
        <span className="bd-batch-foot-figure">{aggregate.toFixed(0)}% overall</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export function Rail({ onAction, active = "module" }: { onAction: (m: string) => void; active?: "module" | "settings" }) {
  const items: Array<{ label: string; icon: IconName; active?: boolean; badge?: string }> = [
    { label: "Coworker", icon: "diamond" },
    { label: "Chat", icon: "chat" },
    { label: "Code", icon: "code" },
    { label: "Discovery", icon: "sparkle" },
    { label: "Document Translation", icon: "library", active: active === "module", badge: "NEW" },
  ];
  return (
    <aside className="bd-rail">
      <div className="bd-brand"><Icon name="logo" size={17} /><span>Vegapunk</span><em>DESKTOP</em></div>
      <div className="bd-rail-label">Modules</div>
      {items.map((it) => (
        <button key={it.label} className={`bd-rail-item${it.active ? " is-active" : ""}`} data-press onClick={() => onAction(`${it.label} is the outer shell, represented here`)}>
          <Icon name={it.icon} size={15} />
          <span>{it.label}</span>
          {it.badge && <b>{it.badge}</b>}
        </button>
      ))}
      <div className="bd-rail-spacer" />
      <button className={`bd-rail-item${active === "settings" ? " is-active" : ""}`} data-press onClick={() => onAction("Would open Settings → Document Translation")}>
        <Icon name="gear" size={15} /><span>Settings</span>
      </button>
      <div className="bd-rail-foot"><span className="bd-dot" /> BabelDOC engine ready</div>
    </aside>
  );
}

export function PrototypeSwitcher({
  variants,
  variant,
  onChange,
}: {
  variants: Array<{ key: string; name: string; description: string }>;
  variant: string;
  onChange: (next: string) => void;
}) {
  const index = Math.max(0, variants.findIndex((v) => v.key === variant));
  const cycle = (delta: number) => onChange(variants[(index + delta + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="bd-switcher" aria-label="Prototype variants">
      <button data-press aria-label="Previous variant" onClick={() => cycle(-1)}><Icon name="arrowLeft" size={14} /></button>
      <div>
        <span>THROWAWAY PROTOTYPE</span>
        <strong>{variants[index].key} · {variants[index].name}</strong>
        <small>{variants[index].description}</small>
      </div>
      <button data-press aria-label="Next variant" onClick={() => cycle(1)}><Icon name="chevronRight" size={14} /></button>
    </div>
  );
}

export function useVariant<T extends string>(prototype: string, keys: readonly T[]): [T, (next: T) => void] {
  const initial = (() => {
    const v = new URLSearchParams(window.location.search).get("variant") as T | null;
    return v && keys.includes(v) ? v : keys[0];
  })();
  const [variant, setVariant] = useState<T>(initial);
  const change = (next: T) => {
    setVariant(next);
    const params = new URLSearchParams(window.location.search);
    params.set("prototype", prototype);
    params.set("variant", next);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };
  return [variant, change];
}

export function BabelDocPrototype() {
  const [variant, setVariant] = useVariant<VariantKey>("babeldoc", ["A", "B", "C"] as const);
  const runs = useRuns();
  const [notice, setNotice] = useState<string | null>(null);
  const onAction = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 3000);
  };
  const active = useMemo(() => VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0], [variant]);
  const anyRunning = runs.docs.some((d) => d.status === "running");

  return (
    <div className="bd">
      <Rail onAction={onAction} />
      <section className="bd-window">
        <header className="bd-window-bar">
          <div className="bd-crumbs">
            <button data-press onClick={() => onAction("Back to the workspace")}><Icon name="arrowLeft" size={14} /></button>
            <span>Vegapunk</span><b>/</b><strong>Document Translation</strong>
          </div>
          <div className="bd-window-state">
            <span className={`bd-dot ${anyRunning ? "bd-dot--live" : "bd-dot--idle"}`} />
            {anyRunning ? "BabelDOC running" : "Idle"} · en → zh
          </div>
        </header>
        <div className="bd-ribbon">
          <strong>Prototype</strong>
          <span>Real BabelDOC stage weights and event shapes; simulated run, inert actions.</span>
          <span className="bd-ribbon-tail">{active.key} · {active.name}</span>
        </div>
        <div className="bd-body">
          {variant === "A" && <VariantA runs={runs} onAction={onAction} />}
          {variant === "B" && <VariantB runs={runs} onAction={onAction} />}
          {variant === "C" && <VariantC runs={runs} onAction={onAction} />}
        </div>
      </section>
      {notice && (
        <div className="bd-toast" role="status">
          <span className="bd-dot" />
          <span>{notice}</span>
          <button data-press onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={13} /></button>
        </div>
      )}
      <PrototypeSwitcher variants={VARIANTS} variant={variant} onChange={(k) => setVariant(k as VariantKey)} />
    </div>
  );
}

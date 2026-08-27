// The run desk, exercised against a fully mocked ../api: the whole point of the surface is that
// every pixel traces back to a real endpoint, so these tests drive it exactly as the server does —
// register, start, feed the cursor-polled event log, finish, cancel, fail.

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TranslationView } from "./TranslationView";
import type { TranslationDocument, TranslationRun } from "../api";

const mocks = vi.hoisted(() => ({
  getTranslationSettings: vi.fn(),
  listTranslationDocuments: vi.fn(),
  listTranslationRuns: vi.fn(),
  registerTranslationDocuments: vi.fn(),
  startTranslationRuns: vi.fn(),
  getTranslationRun: vi.fn(),
  getTranslationRunEvents: vi.fn(),
  cancelTranslationRun: vi.fn(),
  forgetTranslationDocument: vi.fn(),
  streamTranslationRunLog: vi.fn(),
  translationArtifactUrl: vi.fn(),
  fetchTranslationArtifactBlobUrl: vi.fn(),
}));

vi.mock("../api", () => mocks);

const {
  getTranslationSettings,
  listTranslationDocuments,
  listTranslationRuns,
  registerTranslationDocuments,
  startTranslationRuns,
  getTranslationRun,
  getTranslationRunEvents,
  cancelTranslationRun,
  forgetTranslationDocument,
  streamTranslationRunLog,
  translationArtifactUrl,
} = mocks;

const DOC: TranslationDocument = {
  document_id: "doc-1",
  filename: "attention-is-all-you-need.pdf",
  source_path: "/home/loongge/papers/attention-is-all-you-need.pdf",
  size: 2_411_724,
  sha256: "a".repeat(64),
  pages: 15,
  bundle_dir: "/home/loongge/papers/attention-is-all-you-need",
};

const STAGES = [
  { name: "Parse PDF and Create Intermediate Representation", weight: 14.12 },
  { name: "Translate Paragraphs", weight: 46.96 },
  { name: "Save PDF", weight: 6.34 },
];

function run(overrides: Partial<TranslationRun> = {}): TranslationRun {
  return {
    run_id: "run-1",
    document_id: DOC.document_id,
    filename: DOC.filename,
    source_path: DOC.source_path,
    bundle_dir: DOC.bundle_dir,
    state: "running",
    stage: null,
    stage_index: 0,
    stage_total_count: STAGES.length,
    stage_current: 0,
    stage_total: 0,
    stage_progress: 0,
    overall_progress: 0,
    created_at: 1_760_000_000,
    started_at: 1_760_000_001,
    finished_at: null,
    elapsed_seconds: 3.4,
    error: null,
    lang_in: "en",
    lang_out: "zh",
    stages: STAGES,
    artifacts: [],
    result: null,
    ...overrides,
  };
}

const noEvents = { run_id: "run-1", events: [], oldest_sequence: null, latest_sequence: 0, truncated_before_sequence: 0 };

beforeEach(() => {
  getTranslationSettings.mockResolvedValue({ values: { lang_in: "en", lang_out: "zh" } });
  listTranslationDocuments.mockResolvedValue({ documents: [] });
  listTranslationRuns.mockResolvedValue({ runs: [] });
  registerTranslationDocuments.mockResolvedValue({ documents: [] });
  startTranslationRuns.mockResolvedValue({ runs: [] });
  getTranslationRun.mockResolvedValue(run());
  getTranslationRunEvents.mockResolvedValue(noEvents);
  cancelTranslationRun.mockResolvedValue(run({ state: "cancelled" }));
  forgetTranslationDocument.mockResolvedValue({
    document_id: DOC.document_id,
    filename: DOC.filename,
    removed_runs: 1,
    cancelled_runs: [],
    source_deleted: false,
    bundle_dir: "",
  });
  streamTranslationRunLog.mockResolvedValue(undefined);
  mocks.fetchTranslationArtifactBlobUrl.mockResolvedValue("blob:artifact");
  translationArtifactUrl.mockImplementation((runId: string, name: string) => `http://local/${runId}/${name}`);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const library = () => screen.getByRole("region", { name: "Translation library" });
const card = (filename: string) => screen.getByRole("button", { name: `Open ${filename}` });
const runPanel = () => screen.getByRole("region", { name: "Current run" });
const artifactPanel = () => screen.getByRole("region", { name: "Artifacts" });

it("states plainly that the library is empty, and offers both ways in", async () => {
  render(<TranslationView />);

  await waitFor(() => expect(screen.getByText(/Nothing translated yet/i)).toBeTruthy());
  expect(within(library()).getByLabelText(/Add PDF documents/i)).toBeTruthy();
  expect(within(library()).getByLabelText(/Register a local document by absolute path/i)).toBeTruthy();
  // Nothing is focused, so neither the run nor the artifacts column is competing for attention.
  expect(screen.queryByRole("region", { name: "Current run" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Artifacts" })).toBeNull();
  expect(startTranslationRuns).not.toHaveBeenCalled();
});

it("registers a local absolute path and shows the document in the library", async () => {
  registerTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  render(<TranslationView />);
  await waitFor(() => expect(screen.getByText(/Nothing translated yet/i)).toBeTruthy());

  fireEvent.change(within(library()).getByLabelText(/Register a local document by absolute path/i), {
    target: { value: DOC.source_path },
  });
  fireEvent.click(within(library()).getByRole("button", { name: "Add path" }));

  await waitFor(() => expect(registerTranslationDocuments).toHaveBeenCalledWith({ paths: [DOC.source_path] }));
  // Adding a document is step "Choose", so the flow advances to Confirm for that document.
  const sheet = await waitFor(() => screen.getByTestId("translation-confirm"));
  expect(sheet.textContent).toContain(DOC.source_path);
});

it("registers dropped PDF bytes as base64 and ignores everything that is not a PDF", async () => {
  registerTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  render(<TranslationView />);
  await waitFor(() => expect(screen.getByText(/Nothing translated yet/i)).toBeTruthy());

  const pdf = new File(["%PDF-1.7 body"], DOC.filename, { type: "application/pdf" });
  const notes = new File(["nope"], "notes.txt", { type: "text/plain" });
  fireEvent.drop(within(library()).getByLabelText(/Add PDF documents/i), { dataTransfer: { files: [pdf, notes] } });

  await waitFor(() => expect(registerTranslationDocuments).toHaveBeenCalledTimes(1));
  const payload = registerTranslationDocuments.mock.calls[0][0];
  expect(payload.files).toHaveLength(1);
  expect(payload.files[0].filename).toBe(DOC.filename);
  expect(payload.files[0].content_base64.length).toBeGreaterThan(0);
  expect(payload.files[0].content_base64).not.toContain("data:");
});

it("starts a run for the queued document and advances progress from the event log", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  startTranslationRuns.mockResolvedValue({ runs: [run()] });
  render(<TranslationView />);
  await waitFor(() => expect(within(library()).getByTitle(DOC.filename)).toBeTruthy());

  fireEvent.click(within(library()).getByRole("button", { name: `Translate ${DOC.filename}` }));
  await waitFor(() => expect(startTranslationRuns).toHaveBeenCalledWith([DOC.document_id]));
  // Starting takes the user into the run, which is the only moment focus moves on its own.
  await waitFor(() => expect(screen.getByRole("region", { name: "Current run" })).toBeTruthy());

  const overall = () => screen.getByRole("progressbar", { name: new RegExp(`Overall translation progress`) });
  await waitFor(() => expect(overall().getAttribute("aria-valuenow")).toBe("0"));

  getTranslationRunEvents.mockResolvedValue({
    ...noEvents,
    latest_sequence: 2,
    events: [
      { sequence: 1, at: 1_760_000_002, type: "progress_start", stage: "Translate Paragraphs", stage_current: 0, stage_total: 240, overall_progress: 30.6 },
      { sequence: 2, at: 1_760_000_003, type: "progress_update", stage: "Translate Paragraphs", stage_current: 120, stage_total: 240, stage_progress: 50, overall_progress: 54.2 },
    ],
  });

  await waitFor(() => expect(overall().getAttribute("aria-valuenow")).toBe("54"), { timeout: 3000 });
  expect(overall().getAttribute("aria-valuetext")).toContain("Translate");
  // The count shows twice on purpose: once in the hero line, once on the active stage row.
  expect(within(runPanel()).getAllByText("120/240").length).toBe(2);
  expect(within(runPanel()).getByRole("progressbar", { name: /Translate progress/i }).getAttribute("aria-valuetext")).toBe("120 of 240");
  expect(getTranslationRunEvents.mock.calls[0][0]).toBe("run-1");
  expect(getTranslationRunEvents.mock.calls[0][1]).toBe(0);
});

it("shows the artifacts and the bundle directory once the run finishes", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run()] });
  const finished = run({
    state: "done",
    finished_at: 1_760_000_120,
    elapsed_seconds: 118.4,
    overall_progress: 100,
    artifacts: [
      { name: "attention-is-all-you-need.pdf", role: "source", size: 2_411_724, path: `${DOC.bundle_dir}/attention-is-all-you-need.pdf` },
      { name: "attention.zh.mono.pdf", role: "mono", size: 2_610_881, path: `${DOC.bundle_dir}/attention.zh.mono.pdf` },
      { name: "attention.zh.dual.pdf", role: "dual", size: 5_018_112, path: `${DOC.bundle_dir}/attention.zh.dual.pdf` },
      { name: "glossary.csv", role: "glossary", size: 2_048, path: `${DOC.bundle_dir}/glossary.csv` },
    ],
  });
  getTranslationRun.mockResolvedValue(finished);
  getTranslationRunEvents.mockResolvedValue({
    ...noEvents,
    latest_sequence: 9,
    events: [{ sequence: 9, at: 1_760_000_120, type: "finish", overall_progress: 100, message: "bundle written" }],
  });

  render(<TranslationView />);
  fireEvent.click(await waitFor(() => card(DOC.filename)));

  await waitFor(() => expect(within(artifactPanel()).getByText("attention.zh.dual.pdf")).toBeTruthy(), { timeout: 3000 });
  const panel = artifactPanel();
  const row = (role: string) => within(panel).getByTestId(`translation-artifact-${role}`);
  expect(row("dual").textContent).toContain("Side-by-side bilingual");
  expect(row("mono").textContent).toContain("Translated only");
  expect(row("glossary").textContent).toContain("Auto-extracted terms");
  expect(row("source").textContent).toContain("Original document");
  expect(within(panel).getByText(/Bundled beside the original/i)).toBeTruthy();
  expect(screen.getByTestId("translation-bundle-dir").textContent).toContain(DOC.bundle_dir);
  expect(within(panel).getAllByRole("link", { name: "Download" }).length).toBe(4);
  // Opened from the library, so this is a review: the bundle and its files are the point,
  // not a progress bar reporting a finish the user did not just watch.
  expect(screen.getByTestId("translation-run-phase").textContent).toBe("Translated");
});

it("cancels the active run and reflects the cancelled state", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run({ state: "running", overall_progress: 22 })] });
  cancelTranslationRun.mockResolvedValue(run({ state: "cancelled", overall_progress: 22, finished_at: 1_760_000_050 }));

  render(<TranslationView />);
  fireEvent.click(await waitFor(() => card(DOC.filename)));
  const cancelButton = await waitFor(() => within(runPanel()).getByRole("button", { name: /Cancel run/i }));
  fireEvent.click(cancelButton);

  await waitFor(() => expect(cancelTranslationRun).toHaveBeenCalledWith("run-1"));
  await waitFor(() => expect(screen.getByTestId("translation-run-phase").textContent).toBe("Cancelled"));
  expect(within(artifactPanel()).getByText(/Cancelled before any artifact was written/i)).toBeTruthy();
  expect(within(runPanel()).getByRole("button", { name: /Run again/i })).toBeTruthy();
});

it("surfaces a failed run's message, and a dead service as one dismissible alert", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({
    runs: [run({ state: "error", error: "BabelDOC exited with code 1: no OpenAI credentials", finished_at: 1_760_000_030 })],
  });

  render(<TranslationView />);
  fireEvent.click(await waitFor(() => card(DOC.filename)));
  await waitFor(() => expect(screen.getByTestId("translation-run-phase").textContent).toBe("Failed"));
  expect(within(runPanel()).getByText(/no OpenAI credentials/i)).toBeTruthy();
  expect(within(artifactPanel()).getByText(/failed before writing artifacts/i)).toBeTruthy();

  cleanup();
  listTranslationDocuments.mockRejectedValue(new Error("translation service is not running"));
  render(<TranslationView />);

  const alert = await waitFor(() => screen.getByRole("alert"));
  expect(alert.textContent).toContain("translation service is not running");
  fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("removes a library entry, dropping its runs and telling the user the file stayed put", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run({ state: "done" })] });

  render(<TranslationView />);
  await waitFor(() => expect(within(library()).getByTitle(DOC.filename)).toBeTruthy());

  fireEvent.click(within(library()).getByRole("button", { name: `Remove ${DOC.filename} from the library` }));

  await waitFor(() => expect(forgetTranslationDocument).toHaveBeenCalledWith(DOC.document_id));
  // The row goes, and so does the run that belonged to it.
  await waitFor(() => expect(within(library()).queryByTitle(DOC.filename)).toBeNull());
  expect(await screen.findByText(/left in place/i)).toBeTruthy();
});

it("says so plainly when removing also deleted the staged upload", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  forgetTranslationDocument.mockResolvedValue({
    document_id: DOC.document_id,
    filename: DOC.filename,
    removed_runs: 0,
    cancelled_runs: [],
    source_deleted: true,
    bundle_dir: "",
  });

  render(<TranslationView />);
  await waitFor(() => expect(within(library()).getByTitle(DOC.filename)).toBeTruthy());
  fireEvent.click(within(library()).getByRole("button", { name: `Remove ${DOC.filename} from the library` }));

  await waitFor(() => expect(within(library()).queryByTitle(DOC.filename)).toBeNull());
  expect(screen.queryByText(/left in place/i)).toBeNull();
});

it("keeps the row and reports why when removal fails", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  forgetTranslationDocument.mockRejectedValue(new Error("document is still being written"));

  render(<TranslationView />);
  await waitFor(() => expect(within(library()).getByTitle(DOC.filename)).toBeTruthy());
  fireEvent.click(within(library()).getByRole("button", { name: `Remove ${DOC.filename} from the library` }));

  const alert = await waitFor(() => screen.getByRole("alert"));
  expect(alert.textContent).toContain("document is still being written");
  expect(within(library()).getByTitle(DOC.filename)).toBeTruthy();
});

/* ------------------------------------------------------------------ active restrictions */

it("says out loud when a page restriction will leave most of the document untranslated", async () => {
  // A page filter is the one setting that makes a fully successful run return a document whose
  // other pages are still in the source language. Silent partial output is worse than an error.
  getTranslationSettings.mockResolvedValue({ values: { lang_in: "en", lang_out: "zh", pages: "1" } });
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  render(<TranslationView />);

  const notice = await waitFor(() => screen.getByTestId("translation-pages-restriction"));
  expect(notice.textContent).toContain("1");
  expect(notice.textContent).toMatch(/only/i);
});

it("stays quiet when every page is translated", async () => {
  getTranslationSettings.mockResolvedValue({ values: { lang_in: "en", lang_out: "zh", pages: "" } });
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  render(<TranslationView />);

  await waitFor(() => expect(within(library()).getByTitle(DOC.filename)).toBeTruthy());
  expect(screen.queryByTestId("translation-pages-restriction")).toBeNull();
});

/* ------------------------------------------------------------------ library home (B) */

const DONE_DOC: TranslationDocument = {
  document_id: "doc-past",
  filename: "scaling-laws-revisited.pdf",
  source_path: "/home/loongge/papers/scaling/scaling-laws-revisited.pdf",
  size: 4_400_000,
  sha256: "b".repeat(64),
  pages: 22,
  bundle_dir: "/home/loongge/papers/scaling/scaling-laws-revisited",
};

const DONE_RUN: TranslationRun = run({
  run_id: "run-past",
  document_id: DONE_DOC.document_id,
  filename: DONE_DOC.filename,
  source_path: `${DONE_DOC.bundle_dir}/${DONE_DOC.filename}`,
  bundle_dir: DONE_DOC.bundle_dir,
  state: "done",
  stage: null,
  stage_index: STAGES.length,
  overall_progress: 100,
  created_at: 1_759_000_000,
  started_at: 1_759_000_001,
  finished_at: 1_759_000_064,
  elapsed_seconds: 63.8,
  artifacts: [
    { name: "scaling-laws-revisited.zh.mono.pdf", role: "mono", size: 4_000_000, path: `${DONE_DOC.bundle_dir}/scaling-laws-revisited.zh.mono.pdf` },
  ],
});

it("opens on the library of finished translations, not on an upload form", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  await waitFor(() => expect(card(DONE_DOC.filename)).toBeTruthy());
  // The bundle path is the point of the module, so the library states it per entry.
  expect(within(library()).getByText(DONE_DOC.bundle_dir, { exact: false })).toBeTruthy();
  // Nothing is focused, so no run panel is competing for attention.
  expect(screen.queryByRole("region", { name: "Current run" })).toBeNull();
});

it("reviews a past translation without looking like a run about to start", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));

  const panel = await waitFor(() => screen.getByRole("region", { name: "Translation record" }));
  expect(within(panel).queryByRole("progressbar")).toBeNull();
  expect(within(artifactPanel()).getByTestId("translation-artifact-mono")).toBeTruthy();
});

it("returns to the library without discarding a finished translation", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));
  fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /Back to library/i })));

  expect(await waitFor(() => card(DONE_DOC.filename))).toBeTruthy();
  expect(forgetTranslationDocument).not.toHaveBeenCalled();
});

it("keeps a running translation reachable from the library after leaving it", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run({ state: "running", overall_progress: 37 })] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DOC.filename)));
  fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /Leave it running/i })));

  const inFlight = await waitFor(() => screen.getByRole("region", { name: "In progress" }));
  expect(within(inFlight).getByRole("button", { name: `Open ${DOC.filename}` })).toBeTruthy();
  expect(cancelTranslationRun).not.toHaveBeenCalled();
});

it("keeps a reviewed translation free of progress even after its events replay", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  // A finished run's log is not empty — opening it replays every event it ever emitted.
  getTranslationRunEvents.mockResolvedValue({
    run_id: DONE_RUN.run_id,
    events: [
      { sequence: 1, at: 1_759_000_002, type: "progress_start", stage: "Translate Paragraphs", stage_current: 0, stage_total: 88, overall_progress: 30.6 },
      { sequence: 2, at: 1_759_000_064, type: "finish", overall_progress: 100, message: "bundle written" },
    ],
    oldest_sequence: 1,
    latest_sequence: 2,
    truncated_before_sequence: 0,
  });

  render(<TranslationView />);
  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));

  const panel = await waitFor(() => screen.getByRole("region", { name: "Translation record" }));
  await waitFor(() => expect(getTranslationRunEvents).toHaveBeenCalled());
  // Reviewing stays a review: the replayed history must not resurrect the live run surface.
  await waitFor(() => expect(within(panel).queryByRole("progressbar")).toBeNull());
  expect(within(panel).queryByText(/Segment width/i)).toBeNull();
});

it("keeps the intake compact once the library has entries", async () => {
  // The module's subject is the library. An empty shelf may advertise how to fill it, but once
  // something is on it the big dropzone must not outweigh the translations themselves.
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  await waitFor(() => expect(card(DONE_DOC.filename)).toBeTruthy());
  expect(screen.queryByTestId("translation-dropzone")).toBeNull();
  // Both ways in stay reachable, just folded away.
  expect(screen.getByRole("button", { name: /Translate a document/i })).toBeTruthy();
});

it("advertises the dropzone while the library is still empty", async () => {
  render(<TranslationView />);

  await waitFor(() => expect(screen.getByText(/Nothing translated yet/i)).toBeTruthy());
  expect(screen.getByTestId("translation-dropzone")).toBeTruthy();
});

it("reviews a past translation without celebrating it", async () => {
  // The largest thing on screen for a week-old translation must not be "100%" and a duration:
  // that is a finish line, and the user did not just cross it. State when, and what exists.
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));
  const panel = await waitFor(() => screen.getByRole("region", { name: "Translation record" }));

  expect(panel.textContent).not.toMatch(/100\s*%/);
  expect(screen.getByTestId("translation-run-phase").textContent).toBe("Translated");
  expect(panel.textContent).toMatch(/ago|yesterday|just now/i);
});

it("treats a re-opened run as a review, not as a live run", async () => {
  // `witnessed` must mean "watching it finish", not "saw it once". Coming back to a translation
  // later in the same session is a review like any other.
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run({ state: "running", overall_progress: 40 })] });
  const finished = run({ state: "done", overall_progress: 100, finished_at: 1_760_000_120, elapsed_seconds: 61 });
  getTranslationRun.mockResolvedValue(finished);
  getTranslationRunEvents.mockResolvedValue({
    ...noEvents,
    latest_sequence: 3,
    events: [{ sequence: 3, at: 1_760_000_120, type: "finish", overall_progress: 100, message: "bundle written" }],
  });

  render(<TranslationView />);
  fireEvent.click(await waitFor(() => card(DOC.filename)));
  // Watched it finish: this is the celebration, and it is earned.
  await waitFor(() => expect(screen.getByRole("region", { name: "Current run" })).toBeTruthy());

  listTranslationRuns.mockResolvedValue({ runs: [finished] });
  fireEvent.click(screen.getByRole("button", { name: /Back to library/i }));
  fireEvent.click(await waitFor(() => card(DOC.filename)));

  // Re-opened later: a review, so the live chrome must not come back.
  const panel = await waitFor(() => screen.getByRole("region", { name: "Translation record" }));
  expect(within(panel).queryByRole("progressbar")).toBeNull();
});

it("tells the truth when restricted pages are dropped rather than passed through", async () => {
  // `only_include_translated_page` changes the fact this notice exists to convey: the other
  // pages are not in the output at all. Saying they are "copied through" would be a lie.
  getTranslationSettings.mockResolvedValue({
    values: { lang_in: "en", lang_out: "zh", pages: "1-3", only_include_translated_page: true },
  });
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  render(<TranslationView />);

  const notice = await waitFor(() => screen.getByTestId("translation-pages-restriction"));
  expect(notice.textContent).toMatch(/pages 1-3 are/);
  expect(notice.textContent).not.toMatch(/copied through/i);
  expect(notice.textContent).toMatch(/no other page|not appear|left out/i);
});

it("orders the library newest first", async () => {
  const older: TranslationDocument = { ...DONE_DOC, document_id: "doc-older", filename: "older.pdf" };
  listTranslationDocuments.mockResolvedValue({ documents: [older, DONE_DOC] });
  listTranslationRuns.mockResolvedValue({
    runs: [
      run({ run_id: "run-older", document_id: older.document_id, filename: older.filename, state: "done", finished_at: 1_000_000 }),
      { ...DONE_RUN, finished_at: 9_000_000 },
    ],
  });
  render(<TranslationView />);

  await waitFor(() => expect(card(DONE_DOC.filename)).toBeTruthy());
  const names = within(library())
    .getAllByRole("button", { name: /^Open / })
    .map((node) => node.getAttribute("aria-label"));
  expect(names).toEqual([`Open ${DONE_DOC.filename}`, `Open ${older.filename}`]);
});

/* ------------------------------------------------------------------ prototype B fidelity
 * The prototype is a staged single-column flow, not three resident columns. These tests pin the
 * shape itself: one screen per step, a Confirm step that states where the bundle will land
 * BEFORE anything runs, a single radial while it runs, and a folder tree when it is done. */

const stepRail = () => screen.getByTestId("translation-steps");
const flow = () => screen.getByTestId("translation-flow");

it("opens the library as one wide column, with no run scaffolding beside it", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  await waitFor(() => expect(card(DONE_DOC.filename)).toBeTruthy());
  // The library is the whole surface at home: no step rail, no flow, no resident columns.
  expect(screen.queryByTestId("translation-steps")).toBeNull();
  expect(screen.queryByTestId("translation-flow")).toBeNull();
  expect(screen.queryByRole("region", { name: "Artifacts" })).toBeNull();
  // One primary way forward, stated as an action rather than a dropzone.
  expect(screen.getByRole("button", { name: /Translate a document/i })).toBeTruthy();
});

it("stops at Confirm before running, and states where the bundle will land", async () => {
  // The prototype's whole reason for a Confirm step: the bundle directory is this integration's
  // one added semantic, and the user should see it BEFORE committing, not discover it after.
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DOC.filename)));

  const sheet = await waitFor(() => screen.getByTestId("translation-confirm"));
  expect(sheet.textContent).toContain(DOC.source_path);
  expect(sheet.textContent).toContain(DOC.bundle_dir);
  // Arriving at Confirm must not have started anything.
  expect(startTranslationRuns).not.toHaveBeenCalled();
  // The step rail says where we are.
  expect(stepRail().getAttribute("data-step")).toBe("confirm");
  // And the commit is explicit.
  fireEvent.click(screen.getByRole("button", { name: /Run translation/i }));
  await waitFor(() => expect(startTranslationRuns).toHaveBeenCalledWith([DOC.document_id]));
});

it("shows one radial while translating, and only the stages that matter", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [run({ state: "running", overall_progress: 54 })] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DOC.filename)));

  await waitFor(() => expect(stepRail().getAttribute("data-step")).toBe("translate"));
  const radial = await waitFor(() => screen.getByTestId("translation-radial"));
  expect(radial.getAttribute("aria-valuenow")).toBe("54");
  // The radial IS the progress report: no second linear overall bar competing with it.
  expect(within(flow()).queryByTestId("translation-overall-bar")).toBeNull();
  expect(screen.getByRole("button", { name: /Leave it running/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Cancel run/i })).toBeTruthy();
});

it("collects the bundle as a folder tree once the run is done", async () => {
  const finished = run({
    state: "done",
    overall_progress: 100,
    finished_at: 1_760_000_120,
    artifacts: [
      { name: "attention.zh.dual.pdf", role: "dual", size: 5_018_112, path: `${DOC.bundle_dir}/attention.zh.dual.pdf` },
      { name: "glossary.csv", role: "glossary", size: 2_048, path: `${DOC.bundle_dir}/glossary.csv` },
    ],
  });
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [finished] });
  getTranslationRun.mockResolvedValue(finished);
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DOC.filename)));

  const tree = await waitFor(() => screen.getByTestId("translation-bundle-tree"));
  // The tree shows the nesting the bundle actually has on disk.
  expect(tree.textContent).toContain("attention.zh.dual.pdf");
  expect(tree.textContent).toContain("glossary.csv");
  expect(screen.getByTestId("translation-bundle-dir").textContent).toContain(DOC.bundle_dir);
  expect(screen.getByRole("button", { name: /Reveal folder/i })).toBeTruthy();
});

it("walks Confirm to Translate to Collect on one document without ever leaving the flow", async () => {
  // The flow is a sequence, and each step replaces the last rather than accumulating panels.
  listTranslationDocuments.mockResolvedValue({ documents: [DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [] });
  const started = run({ state: "running", overall_progress: 4 });
  startTranslationRuns.mockResolvedValue({ runs: [started] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DOC.filename)));
  await waitFor(() => expect(stepRail().getAttribute("data-step")).toBe("confirm"));

  listTranslationRuns.mockResolvedValue({ runs: [started] });
  getTranslationRun.mockResolvedValue(started);
  fireEvent.click(screen.getByRole("button", { name: /Run translation/i }));

  await waitFor(() => expect(stepRail().getAttribute("data-step")).toBe("translate"));
  // Confirm is gone, not merely scrolled past.
  expect(screen.queryByTestId("translation-confirm")).toBeNull();

  const finished = run({ state: "done", overall_progress: 100, finished_at: 1_760_000_200, artifacts: [] });
  listTranslationRuns.mockResolvedValue({ runs: [finished] });
  getTranslationRun.mockResolvedValue(finished);

  await waitFor(() => expect(stepRail().getAttribute("data-step")).toBe("collect"), { timeout: 3000 });
  // Watched to the end, so the ring stays and reads 100: this finish line was actually crossed.
  expect(screen.getByTestId("translation-radial").getAttribute("aria-valuenow")).toBe("100");
});

it("skips the rail entirely when reviewing a past translation", async () => {
  // Reviewing is not a step in the sequence: it is a record, so the rail is replaced by a
  // plain heading that states when.
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));

  await waitFor(() => expect(screen.getByTestId("translation-bundle-tree")).toBeTruthy());
  expect(screen.queryByTestId("translation-steps")).toBeNull();
  expect(screen.queryByTestId("translation-radial")).toBeNull();
  expect(screen.getByTestId("translation-record-when").textContent).toMatch(/ago|yesterday|just now/i);
});

it("previews a finished PDF in its own browser tab, not inline under the artifacts", async () => {
  // A translated page is unreadable in a panel wedged into a three-column surface, so Preview
  // hands the artifact to a full tab. The endpoint is authenticated, hence blob bytes rather
  // than a bare URL.
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  getTranslationRun.mockResolvedValue(DONE_RUN);
  mocks.fetchTranslationArtifactBlobUrl.mockResolvedValue("blob:preview-1");
  const replace = vi.fn();
  const tab = { location: { replace }, opener: {} as unknown, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));
  const row = await waitFor(() => within(artifactPanel()).getByTestId("translation-artifact-mono"));
  fireEvent.click(within(row).getByRole("button", { name: "Preview" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("blob:preview-1"));
  // Claimed inside the click, before the await, or the browser treats it as an unsolicited pop-up.
  expect(open).toHaveBeenCalledWith("", "_blank");
  expect(open.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.fetchTranslationArtifactBlobUrl.mock.invocationCallOrder[0],
  );
  expect(tab.opener).toBeNull();
  expect(mocks.fetchTranslationArtifactBlobUrl).toHaveBeenCalledWith(DONE_RUN.run_id, "scaling-laws-revisited.zh.mono.pdf");
  // Nothing is embedded in the surface any more.
  expect(screen.queryByTestId("translation-artifact-preview")).toBeNull();
  open.mockRestore();
});

it("says so when the browser blocks the preview tab", async () => {
  listTranslationDocuments.mockResolvedValue({ documents: [DONE_DOC] });
  listTranslationRuns.mockResolvedValue({ runs: [DONE_RUN] });
  getTranslationRun.mockResolvedValue(DONE_RUN);
  mocks.fetchTranslationArtifactBlobUrl.mockResolvedValue("blob:preview-2");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<TranslationView />);

  fireEvent.click(await waitFor(() => card(DONE_DOC.filename)));
  const row = await waitFor(() => within(artifactPanel()).getByTestId("translation-artifact-mono"));
  fireEvent.click(within(row).getByRole("button", { name: "Preview" }));

  const alert = await waitFor(() => screen.getByRole("alert"));
  expect(alert.textContent).toMatch(/blocked the preview tab/i);
  open.mockRestore();
});

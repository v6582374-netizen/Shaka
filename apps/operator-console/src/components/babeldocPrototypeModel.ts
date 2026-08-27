// PROTOTYPE ONLY — shared model for the two BabelDOC prototypes.
//
// The stage list and weights are copied verbatim from BabelDOC
// (babeldoc/format/pdf/high_level.py :: TRANSLATE_STAGES), and the emitted events mirror
// `async_translate`'s documented contract (progress_start / progress_update / progress_end /
// finish / error). That keeps the progress visualization honest: whatever we design here is
// drivable by the real stream without reshaping it.
//
// The option catalog mirrors README "PDF Processing Options" + the Output Control subset we
// intend to surface. `cli` is the real flag, so the settings prototype can render the exact
// command it would produce.

import { useEffect, useRef, useState } from "react";

/** The prototype and the production surface must read time identically, so there is one
 *  implementation of it and the prototype borrows it rather than keeping a second copy. */
export { relativeTime } from "./translationOptions";

export type StageDef = { name: string; weight: number };

/** BabelDOC TRANSLATE_STAGES, verbatim (name, weight). */
export const BABELDOC_STAGES: StageDef[] = [
  { name: "Parse PDF and Create Intermediate Representation", weight: 14.12 },
  { name: "DetectScannedFile", weight: 2.45 },
  { name: "Parse Page Layout", weight: 14.03 },
  { name: "Parse Paragraphs", weight: 6.26 },
  { name: "Parse Formulas and Styles", weight: 1.66 },
  { name: "Automatic Term Extraction", weight: 30.0 },
  { name: "Translate Paragraphs", weight: 46.96 },
  { name: "Typesetting", weight: 4.71 },
  { name: "Add Fonts", weight: 0.61 },
  { name: "Generate drawing instructions", weight: 1.96 },
  { name: "Subset font", weight: 0.92 },
  { name: "Save PDF", weight: 6.34 },
];

/** Short labels for dense surfaces. The full stage name is what the stream actually sends. */
export const STAGE_SHORT: Record<string, string> = {
  "Parse PDF and Create Intermediate Representation": "Parse PDF → IL",
  DetectScannedFile: "Detect scanned",
  "Parse Page Layout": "Page layout",
  "Parse Paragraphs": "Paragraphs",
  "Parse Formulas and Styles": "Formulas & styles",
  "Automatic Term Extraction": "Term extraction",
  "Translate Paragraphs": "Translate",
  Typesetting: "Typesetting",
  "Add Fonts": "Fonts",
  "Generate drawing instructions": "Draw instructions",
  "Subset font": "Subset font",
  "Save PDF": "Save PDF",
};

export type ProgressEvent =
  | { type: "progress_start"; stage: string; stage_current: number; stage_total: number; overall_progress: number }
  | { type: "progress_update"; stage: string; stage_progress: number; stage_current: number; stage_total: number; overall_progress: number }
  | { type: "progress_end"; stage: string; stage_current: number; stage_total: number; overall_progress: number }
  | { type: "finish"; translate_result: TranslateResult }
  | { type: "error"; error: string };

/** Mirrors BabelDOC's TranslateResult, plus the one field we add (see BUNDLE below). */
export type TranslateResult = {
  original_pdf_path: string;
  total_seconds: number;
  mono_pdf_path: string;
  dual_pdf_path: string;
  auto_extracted_glossary_path: string | null;
  total_valid_character_count: number;
  /** OUR ADDITION: the folder next to the source document holding source + outputs. */
  bundle_dir: string;
};

export type DocState = {
  id: string;
  name: string;
  /** Absolute path of the user's source document — the bundle root is derived from it. */
  sourcePath: string;
  pages: number;
  sizeMb: number;
  status: "queued" | "running" | "done" | "error";
  overall: number;
  stageIndex: number;
  stageProgress: number;
  stageCurrent: number;
  stageTotal: number;
  elapsed: number;
  log: LogLine[];
  result: TranslateResult | null;
  error: string | null;
  /** Epoch ms the run reached `done`. A finished translation is a durable thing the user
   *  comes back to look at, so it carries its own timestamp rather than only a duration. */
  finishedAt: number | null;
};

export type LogLine = { t: number; kind: "start" | "update" | "end" | "finish" | "error"; stage: string; detail: string };

/** The immutable facts about a document; every run-derived field is added by `newDoc`. */
export type DocSeed = Pick<DocState, "id" | "name" | "sourcePath" | "pages" | "sizeMb">;

export const SAMPLE_DOCS: DocSeed[] = [
  { id: "d1", name: "attention-is-all-you-need.pdf", sourcePath: "/home/loongge/papers/transformer/attention-is-all-you-need.pdf", pages: 15, sizeMb: 2.1 },
  { id: "d2", name: "sparse-autoencoders-2025.pdf", sourcePath: "/home/loongge/papers/interp/sparse-autoencoders-2025.pdf", pages: 34, sizeMb: 8.7 },
  { id: "d3", name: "pdf-reference-1.7.pdf", sourcePath: "/home/loongge/refs/pdf-reference-1.7.pdf", pages: 1310, sizeMb: 31.4 },
];

/** Documents that were translated BEFORE this session. A finished translation outlives the run
 *  that produced it, so the module has to be able to show them without re-running anything. */
export const HISTORY_SEEDS: DocSeed[] = [
  { id: "h1", name: "spacetime-composability.pdf", sourcePath: "/home/loongge/papers/vegapunk/spacetime-composability.pdf", pages: 88, sizeMb: 12.6 },
  { id: "h2", name: "scaling-laws-revisited.pdf", sourcePath: "/home/loongge/papers/scaling/scaling-laws-revisited.pdf", pages: 22, sizeMb: 4.4 },
  { id: "h3", name: "il-typesetting-notes.pdf", sourcePath: "/home/loongge/notes/il-typesetting-notes.pdf", pages: 6, sizeMb: 0.8 },
];

/** A run that already reached `done`, reconstructed from its seed — what the sidecar would
 *  hand back for a past run: a bundle on disk, a result, and the moment it finished. */
export function finishedDoc(seed: DocSeed, finishedAgoMs: number, seconds: number): DocState {
  const bundle = bundleDirFor(seed);
  const stem = stemOf(seed.name);
  return {
    ...newDoc(seed),
    status: "done",
    overall: 100,
    stageIndex: BABELDOC_STAGES.length - 1,
    stageProgress: 100,
    elapsed: seconds,
    finishedAt: Date.now() - finishedAgoMs,
    result: {
      original_pdf_path: `${bundle}/${seed.name}`,
      total_seconds: seconds,
      mono_pdf_path: `${bundle}/${stem}.zh.mono.pdf`,
      dual_pdf_path: `${bundle}/${stem}.zh.dual.pdf`,
      auto_extracted_glossary_path: `${bundle}/${stem}.glossary.csv`,
      total_valid_character_count: Math.round(seed.pages * 2480),
      bundle_dir: bundle,
    },
  };
}

export function newDoc(seed: DocSeed): DocState {
  return {
    ...seed,
    status: "queued",
    overall: 0,
    stageIndex: -1,
    stageProgress: 0,
    stageCurrent: 0,
    stageTotal: 0,
    elapsed: 0,
    log: [],
    result: null,
    error: null,
    finishedAt: null,
  };
}

export const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
export const stemOf = (name: string) => name.replace(/\.pdf$/i, "");

/**
 * THE ONE BEHAVIOR CHANGE we make to BabelDOC: after a run finishes, the source document and
 * every produced artifact live in ONE folder, created beside the source document (absolute path
 * of the original). BabelDOC itself writes to `--output` (cwd by default) and leaves the source
 * where it was.
 */
export const bundleDirFor = (doc: Pick<DocState, "sourcePath" | "name">) =>
  `${dirOf(doc.sourcePath)}/${stemOf(doc.name)}`;

export function bundleFilesFor(doc: DocState): Array<{ name: string; role: string; size: string; kind: "source" | "mono" | "dual" | "meta" }> {
  const stem = stemOf(doc.name);
  return [
    { name: doc.name, role: "Original — moved in from the upload folder", size: `${doc.sizeMb.toFixed(1)} MB`, kind: "source" },
    { name: `${stem}.zh.mono.pdf`, role: "Translated only", size: `${(doc.sizeMb * 0.92).toFixed(1)} MB`, kind: "mono" },
    { name: `${stem}.zh.dual.pdf`, role: "Side-by-side bilingual", size: `${(doc.sizeMb * 1.83).toFixed(1)} MB`, kind: "dual" },
    { name: `${stem}.glossary.csv`, role: "Auto-extracted terms", size: "6 KB", kind: "meta" },
  ];
}

/* ------------------------------------------------------------------ run simulator */

/** Per-stage item counts, so stage_current/stage_total read plausibly for a given page count. */
function stageTotal(stage: string, pages: number): number {
  switch (stage) {
    case "Translate Paragraphs":
    case "Parse Paragraphs":
      return Math.max(6, Math.round(pages * 4.2));
    case "Automatic Term Extraction":
      return Math.max(4, Math.round(pages * 0.8));
    case "Add Fonts":
    case "Subset font":
    case "Save PDF":
      return 1;
    default:
      return Math.max(1, pages);
  }
}

/** Drives one DocState through the real stage sequence, emitting real-shaped events. */
export function runDoc(
  doc: DocState,
  opts: { speed?: number; onEvent: (docId: string, ev: ProgressEvent, patch: Partial<DocState>) => void },
): () => void {
  const speed = opts.speed ?? 1;
  const stages = BABELDOC_STAGES;
  const totalWeight = stages.reduce((a, s) => a + s.weight, 0);
  const t0 = performance.now();
  let raf = 0;
  let stopped = false;

  // Weight also decides how long a stage takes — Translate Paragraphs should visibly dominate.
  const durations = stages.map((s) => (s.weight / totalWeight) * 26_000 / speed);
  let i = 0;
  let stageStart = t0;
  let started = false;

  const overallAt = (index: number, frac: number) => {
    const before = stages.slice(0, index).reduce((a, s) => a + s.weight, 0);
    return ((before + stages[index].weight * frac) / totalWeight) * 100;
  };

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const stage = stages[i];
    const total = stageTotal(stage.name, doc.pages);

    if (!started) {
      started = true;
      stageStart = now;
      opts.onEvent(
        doc.id,
        { type: "progress_start", stage: stage.name, stage_current: 0, stage_total: total, overall_progress: overallAt(i, 0) },
        { status: "running", stageIndex: i, stageProgress: 0, stageCurrent: 0, stageTotal: total },
      );
    }

    const frac = Math.min(1, (now - stageStart) / durations[i]);
    const current = Math.round(total * frac);
    const overall = overallAt(i, frac);
    opts.onEvent(
      doc.id,
      { type: "progress_update", stage: stage.name, stage_progress: frac * 100, stage_current: current, stage_total: total, overall_progress: overall },
      { status: "running", stageIndex: i, stageProgress: frac * 100, stageCurrent: current, stageTotal: total, overall, elapsed: (now - t0) / 1000 },
    );

    if (frac >= 1) {
      opts.onEvent(
        doc.id,
        { type: "progress_end", stage: stage.name, stage_current: total, stage_total: total, overall_progress: overallAt(i, 1) },
        { stageProgress: 100, stageCurrent: total, overall: overallAt(i, 1) },
      );
      i += 1;
      started = false;
      if (i >= stages.length) {
        const seconds = (now - t0) / 1000;
        const bundle = bundleDirFor(doc);
        const stem = stemOf(doc.name);
        const result: TranslateResult = {
          original_pdf_path: `${bundle}/${doc.name}`,
          total_seconds: Number(seconds.toFixed(1)),
          mono_pdf_path: `${bundle}/${stem}.zh.mono.pdf`,
          dual_pdf_path: `${bundle}/${stem}.zh.dual.pdf`,
          auto_extracted_glossary_path: `${bundle}/${stem}.glossary.csv`,
          total_valid_character_count: Math.round(doc.pages * 2480),
          bundle_dir: bundle,
        };
        opts.onEvent(doc.id, { type: "finish", translate_result: result }, { status: "done", overall: 100, result, elapsed: seconds, finishedAt: Date.now() });
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/* ------------------------------------------------------------------ spring */

/**
 * Critically damped spring toward `target`, animating from the CURRENT presentation value so a
 * re-target mid-flight never jumps (Apple: response + damping, not duration + easing).
 * damping 1.0 / response 0.4 is the house default; progress must never overshoot backwards.
 */
export function useSpringValue(target: number, response = 0.4, damping = 1) {
  const [value, setValue] = useState(target);
  const state = useRef({ v: target, velocity: 0, raf: 0, last: 0, reduced: false });

  useEffect(() => {
    state.current.reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (state.current.reduced) {
      state.current.v = target;
      setValue(target);
      return;
    }
    const omega = (2 * Math.PI) / response;
    const zeta = damping;
    const step = (now: number) => {
      const s = state.current;
      const dt = Math.min(0.032, s.last ? (now - s.last) / 1000 : 0.016);
      s.last = now;
      const x = s.v - target;
      const accel = -omega * omega * x - 2 * zeta * omega * s.velocity;
      s.velocity += accel * dt;
      s.v += s.velocity * dt;
      if (Math.abs(s.v - target) < 0.01 && Math.abs(s.velocity) < 0.05) {
        s.v = target;
        s.velocity = 0;
        setValue(target);
        s.raf = 0;
        return;
      }
      setValue(s.v);
      s.raf = requestAnimationFrame(step);
    };
    state.current.last = 0;
    cancelAnimationFrame(state.current.raf);
    state.current.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(state.current.raf);
  }, [target, response, damping]);

  return value;
}

/* ------------------------------------------------------------------ options catalog */

export type OptionKind = "toggle" | "number" | "text" | "choice";
export type OptionDef = {
  key: string;
  cli: string;
  label: string;
  help: string;
  kind: OptionKind;
  group: "pages" | "layout" | "output" | "scanned" | "fonts" | "glossary" | "advanced";
  advanced?: boolean;
  choices?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

export type OptionValues = Record<string, boolean | number | string>;

/** README §"PDF Processing Options" (+ the Output Control entries a GUI user needs). */
export const OPTION_DEFS: OptionDef[] = [
  { key: "pages", cli: "--pages", label: "Pages", help: "Which pages to translate, e.g. 1,2,1-,-3,3-5. Empty means every page.", kind: "text", group: "pages", placeholder: "all pages" },
  { key: "only_include_translated_page", cli: "--only-include-translated-page", label: "Only keep translated pages", help: "Drop untouched pages from the output. Only has an effect when a page range is set.", kind: "toggle", group: "pages" },
  { key: "max_pages_per_part", cli: "--max-pages-per-part", label: "Split every", help: "Translate long documents in parts of this many pages, then merge. 0 disables splitting.", kind: "number", group: "pages", min: 0, max: 500, step: 10 },

  { key: "watermark_output_mode", cli: "--watermark-output-mode", label: "Watermark", help: "Watermarked adds BabelDOC's mark to the translation; both writes a clean copy alongside it.", kind: "choice", group: "output", choices: ["watermarked", "no_watermark", "both"] },
  { key: "no_dual", cli: "--no-dual", label: "Skip bilingual PDF", help: "Do not produce the side-by-side original/translation file.", kind: "toggle", group: "output" },
  { key: "no_mono", cli: "--no-mono", label: "Skip translated-only PDF", help: "Do not produce the translation-only file.", kind: "toggle", group: "output" },
  { key: "use_alternating_pages_dual", cli: "--use-alternating-pages-dual", label: "Alternate pages in bilingual PDF", help: "Original and translated pages alternate instead of sitting side by side on one page.", kind: "toggle", group: "output" },
  { key: "dual_translate_first", cli: "--dual-translate-first", label: "Translation first", help: "Put the translated page before the original in the bilingual PDF.", kind: "toggle", group: "output" },

  { key: "split_short_lines", cli: "--split-short-lines", label: "Split short lines", help: "Force short lines into separate paragraphs. Can hurt typesetting — use on ragged sources.", kind: "toggle", group: "layout" },
  { key: "short_line_split_factor", cli: "--short-line-split-factor", label: "Short-line threshold", help: "Multiplied by the median line length on the page to decide what counts as short.", kind: "number", group: "layout", min: 0.1, max: 2, step: 0.1 },
  { key: "translate_table_text", cli: "--translate-table-text", label: "Translate table text", help: "Experimental. Table cells are left untranslated by default.", kind: "toggle", group: "layout" },
  { key: "merge_alternating_line_numbers", cli: "--merge-alternating-line-numbers", label: "Merge line-numbered layouts", help: "Rejoin paragraphs split by a line-number column (common in legal and manuscript PDFs).", kind: "toggle", group: "layout", advanced: true },
  { key: "remove_non_formula_lines", cli: "--remove-non-formula-lines", label: "Remove decorative lines", help: "Strip rules that are not part of a formula, while protecting figure and table areas.", kind: "toggle", group: "layout", advanced: true },
  { key: "skip_form_render", cli: "--skip-form-render", label: "Skip form rendering", help: "Leave PDF form widgets out of the output.", kind: "toggle", group: "layout", advanced: true },
  { key: "skip_curve_render", cli: "--skip-curve-render", label: "Skip curve rendering", help: "Leave vector curves out of the output.", kind: "toggle", group: "layout", advanced: true },

  { key: "enhance_compatibility", cli: "--enhance-compatibility", label: "Compatibility mode", help: "Umbrella for skip-clean + translation-first + no rich text. Reach for it when a PDF renders wrong.", kind: "toggle", group: "advanced" },
  { key: "skip_clean", cli: "--skip-clean", label: "Skip PDF cleaning", help: "Leave the source structure untouched before parsing.", kind: "toggle", group: "advanced", advanced: true },
  { key: "disable_rich_text_translate", cli: "--disable-rich-text-translate", label: "Disable rich-text translation", help: "Translate plain runs only. Improves compatibility with unusual PDFs.", kind: "toggle", group: "advanced", advanced: true },

  { key: "skip_scanned_detection", cli: "--skip-scanned-detection", label: "Skip scanned detection", help: "Faster, but a scanned document will be treated as digital text.", kind: "toggle", group: "scanned" },
  { key: "auto_enable_ocr_workaround", cli: "--auto-enable-ocr-workaround", label: "Auto OCR workaround", help: "If a document looks heavily scanned, switch on the OCR workaround automatically.", kind: "toggle", group: "scanned" },
  { key: "ocr_workaround", cli: "--ocr-workaround", label: "Force OCR workaround", help: "Cover original text with white blocks and force black text. Only for black-on-white scans.", kind: "toggle", group: "scanned" },

  { key: "primary_font_family", cli: "--primary-font-family", label: "Primary font family", help: "Override font selection for translated text. Automatic follows the original run's properties.", kind: "choice", group: "fonts", choices: ["auto", "serif", "sans-serif", "script"] },
  { key: "formular_font_pattern", cli: "--formular-font-pattern", label: "Formula font pattern", help: "Regex identifying fonts that carry formulas, so they are left alone.", kind: "text", group: "fonts", advanced: true, placeholder: "none" },
  { key: "formular_char_pattern", cli: "--formular-char-pattern", label: "Formula char pattern", help: "Regex identifying formula characters.", kind: "text", group: "fonts", advanced: true, placeholder: "none" },

  { key: "auto_extract_glossary", cli: "--no-auto-extract-glossary", label: "Auto-extract glossary", help: "Pull recurring terms out first and hold them consistent across the document.", kind: "toggle", group: "glossary" },
  { key: "save_auto_extracted_glossary", cli: "--save-auto-extracted-glossary", label: "Save extracted glossary", help: "Write the extracted term list next to the outputs so it can be reviewed and reused.", kind: "toggle", group: "glossary" },
  { key: "min_text_length", cli: "--min-text-length", label: "Minimum text length", help: "Fragments shorter than this are left in the source language.", kind: "number", group: "glossary", min: 0, max: 50, step: 1, advanced: true },
];

export const GROUP_META: Record<OptionDef["group"], { label: string; blurb: string; icon: "file" | "sliders" | "image" | "shield" | "library" | "wrench" | "table" }> = {
  pages: { label: "Pages & splitting", blurb: "What gets translated, and whether long documents are cut into parts.", icon: "file" },
  output: { label: "Output documents", blurb: "Which PDFs come out of a run, and how the bilingual file is arranged.", icon: "table" },
  layout: { label: "Layout & typesetting", blurb: "How paragraphs, tables, and decorative elements are reconstructed.", icon: "sliders" },
  scanned: { label: "Scanned documents", blurb: "Detection and the OCR workaround for image-based PDFs.", icon: "image" },
  fonts: { label: "Fonts & formulas", blurb: "Font selection for translated text, and what to treat as a formula.", icon: "wrench" },
  glossary: { label: "Terminology", blurb: "Term extraction, so the same term reads the same way throughout.", icon: "library" },
  advanced: { label: "Compatibility", blurb: "Escape hatches for PDFs that come out wrong.", icon: "shield" },
};

export const DEFAULT_OPTIONS: OptionValues = {
  pages: "",
  only_include_translated_page: false,
  max_pages_per_part: 0,
  watermark_output_mode: "watermarked",
  no_dual: false,
  no_mono: false,
  use_alternating_pages_dual: false,
  dual_translate_first: false,
  split_short_lines: false,
  short_line_split_factor: 0.8,
  translate_table_text: false,
  merge_alternating_line_numbers: false,
  remove_non_formula_lines: false,
  skip_form_render: false,
  skip_curve_render: false,
  enhance_compatibility: false,
  skip_clean: false,
  disable_rich_text_translate: false,
  skip_scanned_detection: false,
  auto_enable_ocr_workaround: false,
  ocr_workaround: false,
  primary_font_family: "auto",
  formular_font_pattern: "",
  formular_char_pattern: "",
  auto_extract_glossary: true,
  save_auto_extracted_glossary: true,
  min_text_length: 5,
};

export type PresetKey = "balanced" | "fast" | "compatible" | "scanned";
export const PRESETS: Array<{ key: PresetKey; label: string; blurb: string; patch: OptionValues }> = [
  { key: "balanced", label: "Balanced", blurb: "BabelDOC defaults with glossary extraction on. Best for papers.", patch: {} },
  { key: "fast", label: "Fast draft", blurb: "Skip detection and glossary work. Roughly half the wall time.", patch: { skip_scanned_detection: true, auto_extract_glossary: false, no_dual: true } },
  { key: "compatible", label: "Maximum compatibility", blurb: "For PDFs that come out mangled — plain runs, no cleaning.", patch: { enhance_compatibility: true, skip_clean: true, disable_rich_text_translate: true, dual_translate_first: true } },
  { key: "scanned", label: "Scanned / OCR", blurb: "Black-on-white scans: cover the original text and force black.", patch: { auto_enable_ocr_workaround: true, ocr_workaround: true, translate_table_text: false } },
];

/** The command a given option set would produce — the settings surface's ground truth. */
export function buildCli(values: OptionValues, sample = "paper.pdf"): string {
  const parts = ["babeldoc", `--files ${sample}`, "--lang-in en", "--lang-out zh"];
  for (const def of OPTION_DEFS) {
    const v = values[def.key];
    const d = DEFAULT_OPTIONS[def.key];
    if (v === d) continue;
    if (def.kind === "toggle") {
      if (def.key === "auto_extract_glossary") parts.push("--no-auto-extract-glossary");
      else if (v === true) parts.push(def.cli);
    } else if (def.kind === "text") {
      if (v) parts.push(`${def.cli} "${v}"`);
    } else if (def.kind === "number") {
      if (def.key === "max_pages_per_part" && Number(v) === 0) continue;
      parts.push(`${def.cli} ${v}`);
    } else {
      if (def.key === "primary_font_family" && v === "auto") continue;
      parts.push(`${def.cli} ${v}`);
    }
  }
  return parts.join(" \\\n  ");
}

export function changedKeys(values: OptionValues): string[] {
  return Object.keys(DEFAULT_OPTIONS).filter((k) => values[k] !== DEFAULT_OPTIONS[k]);
}

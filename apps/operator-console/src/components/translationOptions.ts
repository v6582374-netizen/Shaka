// The option catalog for BabelDOC document translation: one declarative table that both the
// Settings section and the run desk read from. Every entry names the real BabelDOC CLI flag it
// corresponds to, so the settings surface can render the exact command a configuration produces
// and reviewers can check our labels against upstream's own documentation.
//
// The stage list is BabelDOC's TRANSLATE_STAGES, verbatim (name, weight), and is only a fallback:
// a live run carries its own `stages` array from the server, which is authoritative.

import type { TranslationSettingsValues } from "../api";

export type StageDef = { name: string; weight: number };

/** BabelDOC TRANSLATE_STAGES (babeldoc/format/pdf/high_level.py), verbatim. */
export const TRANSLATE_STAGES: StageDef[] = [
  { name: "Parse PDF and Create Intermediate Representation", weight: 14.12 },
  { name: "DetectScannedFile", weight: 2.45 },
  { name: "Parse Page Layout", weight: 14.03 },
  { name: "Parse Table", weight: 1.0 },
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
  "Parse Table": "Tables",
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

export const shortStage = (stage: string): string => STAGE_SHORT[stage] ?? stage;

export type OptionKind = "toggle" | "number" | "text" | "choice" | "provider" | "model";
export type OptionGroup = "engine" | "pages" | "output" | "layout" | "scanned" | "fonts" | "glossary" | "advanced";

export type OptionDef = {
  key: keyof TranslationSettingsValues;
  /** The real BabelDOC flag. `invertedFlag` marks options whose flag disables the default. */
  cli: string;
  invertedFlag?: boolean;
  label: string;
  help: string;
  kind: OptionKind;
  group: OptionGroup;
  /** Advanced options stay collapsed until asked for — most runs never touch them. */
  advanced?: boolean;
  /** Static choices. The "provider" and "model" kinds ignore these: their options are the
      live, configured providers reported by /v1/providers (and each provider's own model
      list), so the catalog cannot go stale against Settings. */
  choices?: string[];
  choiceLabels?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** Rendered instead of the raw value when the field is at its "off" sentinel. */
  zeroLabel?: string;
};

/** README §"PDF Processing Options", plus the engine and output-control entries a GUI needs. */
export const OPTION_DEFS: OptionDef[] = [
  { key: "provider", cli: "--openai-base-url/--openai-api-key", label: "Provider", help: "Reuses a provider you already set up in Settings \u25b8 Models \u2014 its key and endpoint are read at run time. Only providers that speak the OpenAI-compatible API can drive BabelDOC.", kind: "provider", group: "engine" },
  { key: "lang_in", cli: "--lang-in", label: "Source language", help: "BCP-47-ish code BabelDOC passes to the model, e.g. en, ja, auto.", kind: "text", group: "engine", placeholder: "en" },
  { key: "lang_out", cli: "--lang-out", label: "Target language", help: "The language documents are translated into.", kind: "text", group: "engine", placeholder: "zh" },
  { key: "openai_model", cli: "--openai-model", label: "Model", help: "Translates paragraphs and extracts terms. The list follows the provider above \u2014 a model the provider does not serve fails every paragraph.", kind: "model", group: "engine", placeholder: "gpt-4o-mini" },
  { key: "openai_base_url", cli: "--openai-base-url", label: "Base URL", help: "Point at any OpenAI-compatible endpoint. Empty uses the official API.", kind: "text", group: "engine", placeholder: "https://api.openai.com/v1" },
  { key: "qps", cli: "--qps", label: "Requests per second", help: "Upper bound on translation requests. Raise it if your provider allows more.", kind: "number", group: "engine", min: 1, max: 100, step: 1 },
  { key: "pool_max_workers", cli: "--pool-max-workers", label: "Worker threads", help: "Parallel translation workers. Automatic derives this from the QPS limit.", kind: "number", group: "engine", min: 0, max: 64, step: 1, zeroLabel: "auto", advanced: true },
  { key: "ignore_cache", cli: "--ignore-cache", label: "Ignore translation cache", help: "Re-translate everything instead of reusing previously translated paragraphs.", kind: "toggle", group: "engine", advanced: true },
  { key: "custom_system_prompt", cli: "--custom-system-prompt", label: "Custom system prompt", help: "Replaces BabelDOC's own translation instructions. Leave empty unless you have a reason.", kind: "text", group: "engine", advanced: true, placeholder: "BabelDOC default" },

  { key: "pages", cli: "--pages", label: "Pages", help: "Which pages to translate, e.g. 1,2,1-,-3,3-5. Empty means every page.", kind: "text", group: "pages", placeholder: "all pages" },
  { key: "only_include_translated_page", cli: "--only-include-translated-page", label: "Only keep translated pages", help: "Drop untouched pages from the output. Only has an effect when a page range is set.", kind: "toggle", group: "pages" },
  { key: "max_pages_per_part", cli: "--max-pages-per-part", label: "Split every", help: "Translate long documents in parts of this many pages, then merge. 0 disables splitting.", kind: "number", group: "pages", min: 0, max: 500, step: 10, zeroLabel: "no split" },

  { key: "watermark_output_mode", cli: "--watermark-output-mode", label: "Watermark", help: "Watermarked adds BabelDOC's mark to the translation; both writes a clean copy alongside it.", kind: "choice", group: "output", choices: ["watermarked", "no_watermark", "both"], choiceLabels: { watermarked: "Watermarked", no_watermark: "No watermark", both: "Both copies" } },
  { key: "no_dual", cli: "--no-dual", label: "Skip bilingual PDF", help: "Do not produce the side-by-side original/translation file.", kind: "toggle", group: "output" },
  { key: "no_mono", cli: "--no-mono", label: "Skip translated-only PDF", help: "Do not produce the translation-only file.", kind: "toggle", group: "output" },
  { key: "use_alternating_pages_dual", cli: "--use-alternating-pages-dual", label: "Alternate pages in bilingual PDF", help: "Original and translated pages alternate instead of sitting side by side on one page.", kind: "toggle", group: "output" },
  { key: "dual_translate_first", cli: "--dual-translate-first", label: "Translation first", help: "Put the translated page before the original in the bilingual PDF.", kind: "toggle", group: "output" },

  { key: "split_short_lines", cli: "--split-short-lines", label: "Split short lines", help: "Force short lines into separate paragraphs. Can hurt typesetting — use on ragged sources.", kind: "toggle", group: "layout" },
  { key: "short_line_split_factor", cli: "--short-line-split-factor", label: "Short-line threshold", help: "Multiplied by the median line length on the page to decide what counts as short.", kind: "number", group: "layout", min: 0.1, max: 1, step: 0.1 },
  { key: "translate_table_text", cli: "--translate-table-text", label: "Translate table text", help: "Experimental. Table cells are left untranslated by default.", kind: "toggle", group: "layout" },
  { key: "merge_alternating_line_numbers", cli: "--no-merge-alternating-line-numbers", invertedFlag: true, label: "Merge line-numbered layouts", help: "Rejoin paragraphs split by a line-number column (common in legal and manuscript PDFs).", kind: "toggle", group: "layout", advanced: true },
  { key: "remove_non_formula_lines", cli: "--remove-non-formula-lines", label: "Remove decorative lines", help: "Strip rules that are not part of a formula, while protecting figure and table areas.", kind: "toggle", group: "layout", advanced: true },
  { key: "skip_form_render", cli: "--skip-form-render", label: "Skip form rendering", help: "Leave PDF form widgets out of the output.", kind: "toggle", group: "layout", advanced: true },
  { key: "skip_curve_render", cli: "--skip-curve-render", label: "Skip curve rendering", help: "Leave vector curves out of the output.", kind: "toggle", group: "layout", advanced: true },

  { key: "skip_scanned_detection", cli: "--skip-scanned-detection", label: "Skip scanned detection", help: "Faster, but a scanned document will be treated as digital text.", kind: "toggle", group: "scanned" },
  { key: "auto_enable_ocr_workaround", cli: "--auto-enable-ocr-workaround", label: "Auto OCR workaround", help: "If a document looks heavily scanned, switch on the OCR workaround automatically.", kind: "toggle", group: "scanned" },
  { key: "ocr_workaround", cli: "--ocr-workaround", label: "Force OCR workaround", help: "Cover original text with white blocks and force black text. Only for black-on-white scans.", kind: "toggle", group: "scanned" },

  { key: "primary_font_family", cli: "--primary-font-family", label: "Primary font family", help: "Override font selection for translated text. Automatic follows the original run's properties.", kind: "choice", group: "fonts", choices: ["auto", "serif", "sans-serif", "script"], choiceLabels: { auto: "Automatic", serif: "Serif", "sans-serif": "Sans-serif", script: "Script" } },
  { key: "formular_font_pattern", cli: "--formular-font-pattern", label: "Formula font pattern", help: "Regex identifying fonts that carry formulas, so they are left alone.", kind: "text", group: "fonts", advanced: true, placeholder: "none" },
  { key: "formular_char_pattern", cli: "--formular-char-pattern", label: "Formula char pattern", help: "Regex identifying formula characters.", kind: "text", group: "fonts", advanced: true, placeholder: "none" },

  { key: "auto_extract_glossary", cli: "--no-auto-extract-glossary", invertedFlag: true, label: "Auto-extract glossary", help: "Pull recurring terms out first and hold them consistent across the document.", kind: "toggle", group: "glossary" },
  { key: "save_auto_extracted_glossary", cli: "--save-auto-extracted-glossary", label: "Save extracted glossary", help: "Write the extracted term list into the bundle so it can be reviewed and reused.", kind: "toggle", group: "glossary" },
  { key: "min_text_length", cli: "--min-text-length", label: "Minimum text length", help: "Fragments shorter than this are left in the source language.", kind: "number", group: "glossary", min: 0, max: 50, step: 1, advanced: true },

  { key: "enhance_compatibility", cli: "--enhance-compatibility", label: "Compatibility mode", help: "Umbrella for skip-clean + translation-first + no rich text. Reach for it when a PDF renders wrong.", kind: "toggle", group: "advanced" },
  { key: "skip_clean", cli: "--skip-clean", label: "Skip PDF cleaning", help: "Leave the source structure untouched before parsing.", kind: "toggle", group: "advanced", advanced: true },
  { key: "disable_rich_text_translate", cli: "--disable-rich-text-translate", label: "Disable rich-text translation", help: "Translate plain runs only. Improves compatibility with unusual PDFs.", kind: "toggle", group: "advanced", advanced: true },
];

export type GroupMeta = { label: string; blurb: string; icon: "code" | "file" | "sliders" | "image" | "shield" | "library" | "wrench" | "table" };

export const GROUP_META: Record<OptionGroup, GroupMeta> = {
  engine: { label: "Engine & languages", blurb: "Which model does the translating, into which language, and how hard we push it.", icon: "code" },
  pages: { label: "Pages & splitting", blurb: "What gets translated, and whether long documents are cut into parts.", icon: "file" },
  output: { label: "Output documents", blurb: "Which PDFs come out of a run, and how the bilingual file is arranged.", icon: "table" },
  layout: { label: "Layout & typesetting", blurb: "How paragraphs, tables, and decorative elements are reconstructed.", icon: "sliders" },
  scanned: { label: "Scanned documents", blurb: "Detection and the OCR workaround for image-based PDFs.", icon: "image" },
  fonts: { label: "Fonts & formulas", blurb: "Font selection for translated text, and what to treat as a formula.", icon: "wrench" },
  glossary: { label: "Terminology", blurb: "Term extraction, so the same term reads the same way throughout.", icon: "library" },
  advanced: { label: "Compatibility", blurb: "Escape hatches for PDFs that come out wrong.", icon: "shield" },
};

export const GROUP_ORDER: OptionGroup[] = ["engine", "pages", "output", "layout", "scanned", "fonts", "glossary", "advanced"];

export const optionsInGroup = (group: OptionGroup): OptionDef[] => OPTION_DEFS.filter((d) => d.group === group);

/** Keys whose value differs from the server-reported defaults. */
export function changedKeys(
  values: TranslationSettingsValues,
  defaults: TranslationSettingsValues,
): Array<keyof TranslationSettingsValues> {
  return (Object.keys(defaults) as Array<keyof TranslationSettingsValues>).filter((k) => values[k] !== defaults[k]);
}

/**
 * The command a given configuration would produce. This is the settings surface's ground truth:
 * if the rendered command looks wrong, the configuration is wrong.
 */
export function buildCli(
  values: TranslationSettingsValues,
  defaults: TranslationSettingsValues,
  sample = "paper.pdf",
): string {
  const parts = ["babeldoc", `--files "${sample}"`];
  for (const def of OPTION_DEFS) {
    const value = values[def.key];
    if (value === defaults[def.key] && def.group !== "engine") continue;
    // A chosen provider supplies the key and endpoint at run time; the command shows where
    // they come from rather than inventing flag values we do not have (and must not print).
    if (def.kind === "provider") {
      if (value) parts.push(`--openai-api-key "<${String(value)} key from Settings>"`);
      continue;
    }
    if (def.kind === "toggle") {
      if (def.invertedFlag) {
        if (value === false) parts.push(def.cli);
      } else if (value === true) parts.push(def.cli);
      continue;
    }
    if (def.kind === "text") {
      if (value !== "" && value != null) parts.push(`${def.cli} "${String(value)}"`);
      continue;
    }
    if (def.kind === "number") {
      if (def.zeroLabel && Number(value) === 0) continue;
      parts.push(`${def.cli} ${value}`);
      continue;
    }
    if (value !== "auto") parts.push(`${def.cli} ${value}`);
  }
  return parts.join(" \\\n  ");
}

export const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/")) || "/";
export const stemOf = (name: string): string => name.replace(/\.pdf$/i, "");

/**
 * THE ONE BEHAVIOR WE ADD ON TOP OF BABELDOC: after a run finishes, the source document and every
 * artifact live in ONE folder, created beside the original document's absolute path. Upstream
 * writes outputs to `--output` (cwd by default) and leaves the source where it was.
 */
export const bundleDirFor = (sourcePath: string): string =>
  `${dirOf(sourcePath)}/${stemOf(sourcePath.slice(sourcePath.lastIndexOf("/") + 1))}`;

export const ARTIFACT_ROLE_LABEL: Record<string, string> = {
  source: "Original document",
  mono: "Translated only",
  dual: "Side-by-side bilingual",
  glossary: "Auto-extracted terms",
  log: "Run log",
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Coarse relative time, for the library of finished translations. A past translation is read at
 * a glance ("yesterday"), not audited to the second — precision here would be noise.
 *
 * Takes epoch MILLISECONDS. The run API reports seconds, so those callers scale at the call site:
 * one unit convention here beats two near-identical functions.
 */
export function relativeTime(epochMs: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - epochMs) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

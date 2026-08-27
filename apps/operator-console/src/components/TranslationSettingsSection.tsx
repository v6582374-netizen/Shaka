// Document Translation settings: prototype variant A ("Grouped sections") raised to production.
// One card per concern, advanced options folded away, and the bundle-destination policy stated
// up front because it is the one behavior this integration adds on top of upstream BabelDOC.
//
// The option catalog lives in ./translationOptions and names the real BabelDOC flag for every
// field, so the rendered command is the ground truth for what a configuration will do. Values
// are read from and written to /v1/translation/settings — the server owns validation.

import { useEffect, useMemo, useState } from "react";
import {
  getProviders,
  getTranslationSettings,
  setTranslationSettings,
  type ProviderInfo,
  type TranslationSettingsDocument,
  type TranslationSettingsValues,
} from "../api";
import { Icon } from "./Icon";
import { PanelHead } from "./PanelHead";
import {
  GROUP_META,
  GROUP_ORDER,
  OPTION_DEFS,
  buildCli,
  changedKeys,
  optionsInGroup,
  type OptionDef,
  type OptionGroup,
} from "./translationOptions";

const CARD = "rounded-xl2 border border-line bg-panel";
const FIELD_LABEL = "text-[12.5px] font-medium text-ink";
const FIELD_HELP = "text-[12px] text-muted mt-1 leading-relaxed";
const INPUT =
  "min-w-0 px-3 py-2 rounded-lg border border-line bg-paper text-[13px] text-ink outline-none focus:border-accent";
const BTN_ACCENT = "text-[12.5px] px-3 py-2 rounded-lg bg-accent text-white shrink-0 disabled:opacity-40";
const BTN_BORDERED =
  "text-[12.5px] px-3 py-2 rounded-lg border border-line bg-paper hover:border-lineStrong shrink-0 disabled:opacity-40";

type Values = TranslationSettingsValues;

export type ProviderChoice = {
  name: string;
  title: string;
  /** The models this provider actually serves — the Model field's options once it is chosen. */
  models: string[];
  recommended: string | null;
};

/**
 * The providers this module can actually drive: already configured in Settings ▸ Models AND
 * reachable over the plain OpenAI-compatible API. BabelDOC's OpenAITranslator only speaks that
 * dialect, so listing a native-SDK provider (Claude, Gemini, Bedrock, Vertex) would offer a
 * choice that cannot run. `openai_compatible` is absent on older sidecars — treat that as false
 * rather than guessing, so the list is never optimistic.
 *
 * Each choice carries its own model list, because a provider and a model that belong to
 * different vendors is the one misconfiguration BabelDOC does not survive: it rejects every
 * paragraph and still finishes, leaving an untranslated document behind.
 */
export function usableProviders(providers: ProviderInfo[]): ProviderChoice[] {
  return providers
    .filter((p) => p.configured && p.openai_compatible === true)
    .map((p) => ({
      name: p.name,
      title: p.title,
      models: p.suggested_models ?? [],
      recommended: p.recommended_model ?? null,
    }));
}

/** The model the Model field should hold when a provider is picked: its own recommendation,
 *  else its first served model, else leave the current value for the user to type. */
export function modelForProvider(
  providers: ProviderChoice[],
  name: string,
  fallback: string,
): string {
  const chosen = providers.find((p) => p.name === name);
  if (!chosen) return fallback;
  return chosen.recommended || chosen.models[0] || fallback;
}

/** A toggle that reads as a switch, and marks itself when it departs from the server default. */
function Switch({
  on,
  dirty,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  dirty: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={
        "relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-40 " +
        (on ? "bg-accent border-accent" : "bg-paper border-line hover:border-lineStrong")
      }
    >
      <span
        className={
          "absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-[left] duration-150 ease-out " +
          (on ? "left-[19px]" : "left-[2px]")
        }
      />
      {dirty && <span className="absolute -right-2 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
    </button>
  );
}

function Control({
  def,
  value,
  disabled,
  providers,
  provider,
  onChange,
}: {
  def: OptionDef;
  value: Values[keyof Values];
  disabled: boolean;
  providers: ProviderChoice[];
  provider: string;
  onChange: (v: Values[keyof Values]) => void;
}) {
  if (def.kind === "model") {
    const current = String(value ?? "");
    const chosen = providers.find((p) => p.name === provider);
    // No provider chosen means no authoritative list (the OpenAI slot resolves its key from the
    // environment), so the field stays free text rather than pretending to know the catalog.
    if (!chosen || chosen.models.length === 0) {
      return (
        <input
          className={INPUT + " w-[220px]"}
          aria-label={def.label}
          value={current}
          placeholder={def.placeholder}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    const foreign = current && !chosen.models.includes(current);
    return (
      <div className="flex flex-col items-end gap-1">
        <select
          className={INPUT + " w-[220px]"}
          aria-label={def.label}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {chosen.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {foreign && <option value={current}>{current} (not served)</option>}
        </select>
        {foreign && (
          <span className="text-[11.5px] text-danger">{chosen.title} does not serve this model.</span>
        )}
      </div>
    );
  }
  if (def.kind === "provider") {
    const current = String(value ?? "");
    // A saved provider that is no longer usable (key removed) stays selectable so the stored
    // value is visible rather than silently reading as "OpenAI slot".
    const stale = current && !providers.some((p) => p.name === current);
    return (
      <select
        className={INPUT + " w-[220px]"}
        aria-label={def.label}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">OpenAI slot (default)</option>
        {providers.map((p) => (
          <option key={p.name} value={p.name}>
            {p.title}
          </option>
        ))}
        {stale && <option value={current}>{current} (not configured)</option>}
      </select>
    );
  }
  if (def.kind === "toggle") {
    return (
      <Switch
        on={Boolean(value)}
        dirty={false}
        label={def.label}
        disabled={disabled}
        onToggle={() => onChange(!value)}
      />
    );
  }
  if (def.kind === "number") {
    const n = Number(value);
    return (
      <div className="flex items-center gap-2">
        {def.zeroLabel && n === 0 && <span className="text-[12px] text-muted">{def.zeroLabel}</span>}
        <input
          className={INPUT + " w-[92px] text-right tabular-nums"}
          type="number"
          aria-label={def.label}
          value={Number.isFinite(n) ? n : 0}
          min={def.min}
          max={def.max}
          step={def.step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    );
  }
  if (def.kind === "text") {
    return (
      <input
        className={INPUT + " w-[220px]"}
        aria-label={def.label}
        value={String(value ?? "")}
        placeholder={def.placeholder}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className="seg" role="radiogroup" aria-label={def.label}>
      {def.choices?.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={value === choice}
          className={value === choice ? "active" : ""}
          disabled={disabled}
          onClick={() => onChange(choice)}
        >
          {def.choiceLabels?.[choice] ?? choice.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}

function Field({
  def,
  values,
  defaults,
  disabled,
  providers,
  onChange,
}: {
  def: OptionDef;
  values: Values;
  defaults: Values;
  disabled: boolean;
  providers: ProviderChoice[];
  onChange: (key: keyof Values, value: Values[keyof Values]) => void;
}) {
  const dirty = values[def.key] !== defaults[def.key];
  return (
    <div className="flex items-start gap-4 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className={FIELD_LABEL + (dirty ? " text-accent" : "")}>{def.label}</div>
        <div className={FIELD_HELP}>{def.help}</div>
        <code className="mt-1.5 inline-block rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-faint">
          {def.cli}
        </code>
      </div>
      <div className="shrink-0 pt-0.5">
        <Control
          def={def}
          value={values[def.key]}
          disabled={disabled}
          providers={providers}
          provider={String(values.provider ?? "")}
          onChange={(v) => onChange(def.key, v)}
        />
      </div>
    </div>
  );
}

function GroupCard({
  group,
  values,
  defaults,
  disabled,
  providers,
  onChange,
}: {
  group: OptionGroup;
  values: Values;
  defaults: Values;
  disabled: boolean;
  providers: ProviderChoice[];
  onChange: (key: keyof Values, value: Values[keyof Values]) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = GROUP_META[group];
  const defs = optionsInGroup(group);
  const plain = defs.filter((d) => !d.advanced);
  const advanced = defs.filter((d) => d.advanced);
  const dirty = defs.filter((d) => values[d.key] !== defaults[d.key]).length;

  return (
    <div className={CARD + " p-4 mb-4"}>
      <div className="flex items-start gap-2.5 pb-1">
        <Icon name={meta.icon} size={15} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">{meta.label}</div>
          <div className={FIELD_HELP}>{meta.blurb}</div>
        </div>
        {dirty > 0 && (
          <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
            {dirty} changed
          </span>
        )}
      </div>
      <div className="mt-1">
        {plain.map((def) => (
          <Field
            key={def.key}
            def={def}
            values={values}
            defaults={defaults}
            disabled={disabled}
            providers={providers}
            onChange={onChange}
          />
        ))}
        {open &&
          advanced.map((def) => (
            <Field
              key={def.key}
              def={def}
              values={values}
              defaults={defaults}
              disabled={disabled}
              providers={providers}
              onChange={onChange}
            />
          ))}
      </div>
      {advanced.length > 0 && (
        <button
          type="button"
          className="mt-2.5 flex items-center gap-1.5 text-[12px] text-muted hover:text-ink"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
          {open ? "Hide advanced" : `${advanced.length} advanced ${advanced.length === 1 ? "option" : "options"}`}
        </button>
      )}
    </div>
  );
}

/** The one semantic this integration adds on top of upstream BabelDOC, stated as policy. */
function DestinationCard() {
  return (
    <div className={CARD + " p-4 mb-4"}>
      <div className="flex items-start gap-2.5">
        <Icon name="folder" size={15} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink">Where results are written</div>
          <div className={FIELD_HELP}>
            A finished run collects the original document and every artifact into one folder created beside the
            original, at its own absolute path. Upstream BabelDOC writes to <code>--output</code> and leaves the source
            where it was.
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-muted">
          Vegapunk behavior
        </span>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-muted">
{`~/papers/transformer/
└─ attention-is-all-you-need/
   ├─ attention-is-all-you-need.pdf
   ├─ attention-is-all-you-need.zh.mono.pdf
   ├─ attention-is-all-you-need.zh.dual.pdf
   └─ attention-is-all-you-need.glossary.csv`}
      </pre>
    </div>
  );
}

export function TranslationSettingsSection() {
  const [doc, setDoc] = useState<TranslationSettingsDocument | null>(null);
  const [draft, setDraft] = useState<Values | null>(null);
  const [providers, setProviders] = useState<ProviderChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCli, setShowCli] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getTranslationSettings();
      setDoc(next);
      setDraft(next.values);
      // The provider list only populates a dropdown; if it fails the rest of the form still
      // works and the stored value stays visible.
      try {
        setProviders(usableProviders(await getProviders()));
      } catch {
        setProviders([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load translation settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const dirtyKeys = useMemo(
    () => (draft && doc ? changedKeys(draft, doc.values) : []),
    [draft, doc],
  );
  const changedFromDefaults = useMemo(
    () => (draft && doc ? changedKeys(draft, doc.defaults) : []),
    [draft, doc],
  );

  const set = (key: keyof Values, value: Values[keyof Values]) => {
    setNotice(null);
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value } as Values;
      // Picking a provider also picks its model. Leaving the previous vendor's model behind is
      // the failure mode this field exists to prevent, so the choice is made atomically.
      if (key === "provider") {
        next.openai_model = modelForProvider(providers, String(value ?? ""), prev.openai_model);
      }
      return next;
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await setTranslationSettings(draft);
      setDoc(next);
      setDraft(next.values);
      setNotice("Saved. New runs use these defaults.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save translation settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section>
        <PanelHead title="Document Translation" sub="How BabelDOC processes a PDF." />
        <div className="text-[13px] text-muted">Loading…</div>
      </section>
    );
  }

  if (!doc || !draft) {
    return (
      <section>
        <PanelHead title="Document Translation" sub="How BabelDOC processes a PDF." />
        <div className={CARD + " p-4"}>
          <div className="text-[13px] text-ink">{error || "Translation settings are unavailable."}</div>
          <button className={BTN_BORDERED + " mt-3"} onClick={() => void load()}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <PanelHead
        title="Document Translation"
        sub="Run defaults for the Document Translation module. The module itself only asks for a file."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11.5px] text-muted">
          {changedFromDefaults.length === 0
            ? "All BabelDOC defaults"
            : `${changedFromDefaults.length} changed from BabelDOC defaults`}
        </span>
        {changedFromDefaults.length > 0 && (
          <button
            className="text-[12px] text-muted hover:text-ink flex items-center gap-1.5"
            onClick={() => setDraft(doc.defaults)}
            disabled={saving}
          >
            <Icon name="refresh" size={13} /> Reset to defaults
          </button>
        )}
        <div className="flex-1" />
        <button
          className="text-[12px] text-muted hover:text-ink flex items-center gap-1.5"
          onClick={() => setShowCli((v) => !v)}
        >
          <Icon name={showCli ? "chevronDown" : "chevronRight"} size={13} /> Equivalent command
        </button>
      </div>

      {showCli && (
        <pre className="mb-4 overflow-x-auto rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-muted">
          {buildCli(draft, doc.defaults)}
        </pre>
      )}

      <DestinationCard />

      {GROUP_ORDER.map((group) => (
        <GroupCard
          key={group}
          group={group}
          values={draft}
          defaults={doc.values}
          disabled={saving}
          providers={providers}
          onChange={set}
        />
      ))}

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur">
        <button className={BTN_ACCENT} onClick={() => void save()} disabled={saving || dirtyKeys.length === 0}>
          {saving ? "Saving…" : dirtyKeys.length ? `Save ${dirtyKeys.length} change${dirtyKeys.length === 1 ? "" : "s"}` : "Saved"}
        </button>
        {dirtyKeys.length > 0 && (
          <button className={BTN_BORDERED} onClick={() => setDraft(doc.values)} disabled={saving}>
            Discard
          </button>
        )}
        {error && <span className="text-[12.5px] text-red-500">{error}</span>}
        {!error && notice && <span className="text-[12.5px] text-muted">{notice}</span>}
        <div className="flex-1" />
        <span className="text-[11.5px] text-faint">{OPTION_DEFS.length} options</span>
      </div>
    </section>
  );
}

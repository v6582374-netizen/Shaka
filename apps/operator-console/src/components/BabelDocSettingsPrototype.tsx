// PROTOTYPE PLAN: three structurally different homes for BabelDOC's "PDF Processing Options"
// inside our own Settings surface, on ?prototype=babeldoc-settings, variant=A|B|C.
//
//   A — Grouped sections   settings nav + one card per concern, advanced folded away.
//   B — Preset first       pick an intent, see the diff it produces, only then open the knobs.
//   C — Flag table         dense searchable table of every flag with the live CLI beside it.
//
// The option catalog, flags, defaults and preset patches all live in babeldocPrototypeModel.ts
// and mirror BabelDOC's README/CLI, so whatever wins here maps 1:1 onto real arguments.
// Values are in memory only; Save is inert.

import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Rail, PrototypeSwitcher, useVariant } from "./BabelDocPrototype";
import {
  DEFAULT_OPTIONS,
  GROUP_META,
  OPTION_DEFS,
  PRESETS,
  buildCli,
  changedKeys,
  type OptionDef,
  type OptionValues,
  type PresetKey,
} from "./babeldocPrototypeModel";
import "./babeldoc-prototype.css";

type VariantKey = "A" | "B" | "C";
const VARIANTS: Array<{ key: VariantKey; name: string; description: string }> = [
  { key: "A", name: "Grouped sections", description: "Settings nav · one card per concern" },
  { key: "B", name: "Preset first", description: "Pick an intent, see the diff, then tune" },
  { key: "C", name: "Flag table", description: "Dense table with the live CLI beside it" },
];

const GROUP_ORDER = ["pages", "output", "layout", "scanned", "fonts", "glossary", "advanced"] as const;

/* ------------------------------------------------------------------ controls */

function Switch({ on, dirty, onToggle, label }: { on: boolean; dirty: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`bd-switch${on ? " is-on" : ""}`}
      data-dirty={dirty ? "1" : "0"}
      data-press
      onPointerDown={onToggle}
    >
      <i />
    </button>
  );
}

function Control({ def, value, onChange }: { def: OptionDef; value: OptionValues[string]; onChange: (v: OptionValues[string]) => void }) {
  const dirty = value !== DEFAULT_OPTIONS[def.key];
  if (def.kind === "toggle") return <Switch on={Boolean(value)} dirty={dirty} label={def.label} onToggle={() => onChange(!value)} />;
  if (def.kind === "number")
    return (
      <input
        className="bd-num"
        type="number"
        aria-label={def.label}
        value={Number(value)}
        min={def.min}
        max={def.max}
        step={def.step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  if (def.kind === "text")
    return <input className="bd-text" aria-label={def.label} value={String(value)} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="bd-seg" role="radiogroup" aria-label={def.label}>
      {def.choices?.map((c) => (
        <button key={c} role="radio" aria-checked={value === c} className={value === c ? "is-on" : undefined} data-press onPointerDown={() => onChange(c)}>
          {c === "auto" ? "Automatic" : c.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}

function Field({ def, values, set }: { def: OptionDef; values: OptionValues; set: (k: string, v: OptionValues[string]) => void }) {
  return (
    <div className="bd-field">
      <div>
        <div className="bd-field-label">{def.label}</div>
        <p className="bd-field-help">{def.help}</p>
        <div className="bd-field-cli"><code className="bd-tag">{def.cli}</code></div>
      </div>
      <div className="bd-field-control">
        <Control def={def} value={values[def.key]} onChange={(v) => set(def.key, v)} />
      </div>
    </div>
  );
}

/** Our one behavior change, stated as a settings policy rather than buried in the run screen. */
function DestinationCard({ onAction }: { onAction: (m: string) => void }) {
  return (
    <div className="bd-card bd-section">
      <div className="bd-section-head">
        <Icon name="folder" size={15} />
        <h2>Where results are written</h2>
        <span className="bd-tag bd-tag--ok">Vegapunk behavior</span>
      </div>
      <p className="bd-field-help" style={{ marginTop: 0 }}>
        A finished run collects the original document and every artifact into one folder created beside the original, at its
        own absolute path. Upstream BabelDOC writes to <code>--output</code> and leaves the source behind.
      </p>
      <div className="bd-tree" style={{ marginTop: 10 }}>
        <div><b>/home/loongge/papers/transformer/</b></div>
        <div>└─ <em>attention-is-all-you-need/</em></div>
        <div style={{ paddingLeft: 22 }}>├─ attention-is-all-you-need.pdf</div>
        <div style={{ paddingLeft: 22 }}>├─ attention-is-all-you-need.zh.mono.pdf</div>
        <div style={{ paddingLeft: 22 }}>├─ attention-is-all-you-need.zh.dual.pdf</div>
        <div style={{ paddingLeft: 22 }}>└─ attention-is-all-you-need.glossary.csv</div>
      </div>
      <button className="bd-btn bd-btn--ghost" data-press style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => onAction("Folder naming is fixed in this prototype")}>
        <Icon name="pencil" size={13} /> Folder naming
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ variant A: grouped sections */

const SETTINGS_NAV = [
  { key: "general", label: "General", icon: "sliders" as const },
  { key: "models", label: "Models", icon: "code" as const },
  { key: "discovery", label: "Discovery Launch", icon: "sliders" as const },
  { key: "prompts", label: "Prompt Library", icon: "library" as const },
  { key: "personas", label: "Personas", icon: "sparkle" as const },
  { key: "translation", label: "Document Translation", icon: "file" as const },
];

function SettingsNav({ onAction }: { onAction: (m: string) => void }) {
  return (
    <nav className="bd-set-nav">
      <div className="bd-set-nav-title"><Icon name="gear" size={15} /> Settings</div>
      {SETTINGS_NAV.map((item) => (
        <button
          key={item.key}
          className={item.key === "translation" ? "is-active" : undefined}
          data-press
          onClick={() => (item.key === "translation" ? undefined : onAction(`${item.label} is an existing Settings section`))}
        >
          <Icon name={item.icon} size={14} />
          <span>{item.label}</span>
          {item.key === "translation" && <b>NEW</b>}
        </button>
      ))}
    </nav>
  );
}

function GroupCard({
  group,
  values,
  set,
}: {
  group: (typeof GROUP_ORDER)[number];
  values: OptionValues;
  set: (k: string, v: OptionValues[string]) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = GROUP_META[group];
  const defs = OPTION_DEFS.filter((d) => d.group === group);
  const plain = defs.filter((d) => !d.advanced);
  const advanced = defs.filter((d) => d.advanced);
  const dirty = defs.filter((d) => values[d.key] !== DEFAULT_OPTIONS[d.key]).length;

  return (
    <div className="bd-card bd-section">
      <div className="bd-section-head">
        <Icon name={meta.icon} size={15} />
        <div>
          <h2>{meta.label}</h2>
          <p>{meta.blurb}</p>
        </div>
        {dirty > 0 && <span className="bd-tag bd-tag--live">{dirty} changed</span>}
      </div>
      {plain.map((d) => <Field key={d.key} def={d} values={values} set={set} />)}
      {advanced.length > 0 && (
        <>
          {open && advanced.map((d) => <Field key={d.key} def={d} values={values} set={set} />)}
          <button className="bd-disclose" data-press onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
            {open ? "Hide" : `${advanced.length} advanced ${advanced.length === 1 ? "option" : "options"}`}
          </button>
        </>
      )}
    </div>
  );
}

function VariantA({ values, set, reset, onAction }: SurfaceProps) {
  const changed = changedKeys(values);
  return (
    <div className="bd-set">
      <SettingsNav onAction={onAction} />
      <div className="bd-set-body">
        <div className="bd-set-inner">
          <div className="bd-set-head">
            <h1>Document Translation</h1>
            <p>
              How BabelDOC processes a PDF. These are the run defaults for the Document Translation module — the module
              itself only asks for a file.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span className="bd-tag">{changed.length === 0 ? "All BabelDOC defaults" : `${changed.length} changed from defaults`}</span>
              {changed.length > 0 && (
                <button className="bd-btn bd-btn--ghost" data-press onClick={reset}><Icon name="refresh" size={13} /> Reset</button>
              )}
            </div>
          </div>
          <DestinationCard onAction={onAction} />
          {GROUP_ORDER.map((g) => <GroupCard key={g} group={g} values={values} set={set} />)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ variant B: preset first */

function describe(value: OptionValues[string]): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === "") return "empty";
  return String(value);
}

function VariantB({ values, set, reset, onAction, preset, applyPreset }: SurfaceProps) {
  const [open, setOpen] = useState(false);
  const changed = changedKeys(values);

  return (
    <div className="bd-set">
      <SettingsNav onAction={onAction} />
      <div className="bd-set-body">
        <div className="bd-set-inner">
          <div className="bd-set-head">
            <h1>Document Translation</h1>
            <p>Start from an intent. Every preset is a set of BabelDOC flags — the diff below is exactly what it changes.</p>
          </div>

          <div className="bd-presets">
            {PRESETS.map((p) => (
              <button key={p.key} className={`bd-preset${preset === p.key ? " is-on" : ""}`} data-press onPointerDown={() => applyPreset(p.key)}>
                {preset === p.key && <em>Active</em>}
                <strong>{p.label}</strong>
                <small>{p.blurb}</small>
              </button>
            ))}
          </div>

          <div className="bd-card bd-section">
            <div className="bd-section-head">
              <Icon name="sliders" size={15} />
              <h2>What this changes</h2>
              <span className="bd-tag">{changed.length} vs BabelDOC defaults</span>
            </div>
            {changed.length === 0 ? (
              <p className="bd-field-help" style={{ marginTop: 0 }}>Nothing. This is BabelDOC exactly as it ships.</p>
            ) : (
              <div className="bd-diff">
                {changed.map((key) => {
                  const def = OPTION_DEFS.find((d) => d.key === key)!;
                  return (
                    <div key={key} className="bd-diff-row">
                      <code className="bd-tag">{def.cli}</code>
                      <span>{def.label}</span>
                      <b>{describe(DEFAULT_OPTIONS[key])} → {describe(values[key])}</b>
                    </div>
                  );
                })}
              </div>
            )}
            {changed.length > 0 && (
              <button className="bd-btn bd-btn--ghost" data-press style={{ marginTop: 10, paddingLeft: 0 }} onClick={reset}>
                <Icon name="refresh" size={13} /> Back to defaults
              </button>
            )}
          </div>

          <DestinationCard onAction={onAction} />

          <button className="bd-disclose" data-press onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
            {open ? "Hide individual options" : `Tune individual options (${OPTION_DEFS.length})`}
          </button>
          {open && GROUP_ORDER.map((g) => <GroupCard key={g} group={g} values={values} set={set} />)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ variant C: flag table + live CLI */

function VariantC({ values, set, reset, onAction }: SurfaceProps) {
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const changed = changedKeys(values);
  const q = query.trim().toLowerCase();

  const rows = useMemo(
    () =>
      OPTION_DEFS.filter((d) => {
        if (onlyChanged && values[d.key] === DEFAULT_OPTIONS[d.key]) return false;
        if (!q) return true;
        return `${d.label} ${d.cli} ${d.help}`.toLowerCase().includes(q);
      }),
    [q, onlyChanged, values],
  );

  const cli = buildCli(values);

  return (
    <div className="bd-cli">
      <div className="bd-cli-list">
        <div className="bd-set-head">
          <h1>PDF Processing Options</h1>
          <p>Every BabelDOC flag we expose, in one table. The command on the right is what a run would execute.</p>
        </div>
        <div className="bd-cli-filter">
          <input className="bd-cli-search" placeholder="Filter by name, flag, or description" aria-label="Filter options" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className={`bd-btn${onlyChanged ? " bd-btn--primary" : ""}`} data-press onPointerDown={() => setOnlyChanged(!onlyChanged)}>
            Changed only <span style={{ fontVariantNumeric: "tabular-nums" }}>{changed.length}</span>
          </button>
          <button className="bd-btn bd-btn--ghost" data-press onClick={reset}><Icon name="refresh" size={13} /> Reset</button>
        </div>

        {GROUP_ORDER.map((g) => {
          const groupRows = rows.filter((d) => d.group === g);
          if (groupRows.length === 0) return null;
          return (
            <div key={g}>
              <div className="bd-cli-group">
                <div className="bd-eyebrow">{GROUP_META[g].label}</div>
              </div>
              {groupRows.map((d) => (
                <div key={d.key} className={`bd-cli-row${values[d.key] !== DEFAULT_OPTIONS[d.key] ? " is-dirty" : ""}`}>
                  <div>
                    <div className="bd-field-label">{d.label}</div>
                    <code className="bd-tag" style={{ marginTop: 4 }}>{d.cli}</code>
                  </div>
                  <p>{d.help}</p>
                  <div className="bd-cli-control">
                    <Control def={d} value={values[d.key]} onChange={(v) => set(d.key, v)} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {rows.length === 0 && <p className="bd-field-help">No option matches “{query}”.</p>}
      </div>

      <aside className="bd-cli-aside">
        <div className="bd-section-head" style={{ marginBottom: 0 }}>
          <Icon name="code" size={15} />
          <h2>Resulting command</h2>
          <span className="bd-tag">{changed.length} flags</span>
        </div>
        <pre className="bd-cli-pre">{cli}</pre>
        <button className="bd-btn" data-press onClick={() => onAction("Copied the command")}><Icon name="copy" size={13} /> Copy command</button>
        <DestinationCard onAction={onAction} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

type SurfaceProps = {
  values: OptionValues;
  set: (k: string, v: OptionValues[string]) => void;
  reset: () => void;
  onAction: (m: string) => void;
  preset: PresetKey | null;
  applyPreset: (k: PresetKey) => void;
};

export function BabelDocSettingsPrototype() {
  const [variant, setVariant] = useVariant<VariantKey>("babeldoc-settings", ["A", "B", "C"] as const);
  const [values, setValues] = useState<OptionValues>({ ...DEFAULT_OPTIONS });
  const [preset, setPreset] = useState<PresetKey | null>("balanced");
  const [notice, setNotice] = useState<string | null>(null);

  const onAction = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 3000);
  };
  const set = (k: string, v: OptionValues[string]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setPreset(null);
  };
  const reset = () => {
    setValues({ ...DEFAULT_OPTIONS });
    setPreset("balanced");
  };
  const applyPreset = (k: PresetKey) => {
    const found = PRESETS.find((p) => p.key === k);
    setValues({ ...DEFAULT_OPTIONS, ...(found?.patch ?? {}) });
    setPreset(k);
  };

  const active = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  const surface: SurfaceProps = { values, set, reset, onAction, preset, applyPreset };
  const changed = changedKeys(values).length;

  return (
    <div className="bd">
      <Rail onAction={onAction} active="settings" />
      <section className="bd-window">
        <header className="bd-window-bar">
          <div className="bd-crumbs">
            <button data-press onClick={() => onAction("Back to the workspace")} aria-label="Back"><Icon name="arrowLeft" size={14} /></button>
            <span>Settings</span><b>/</b><strong>Document Translation</strong>
          </div>
          <div className="bd-window-state">
            <span className={`bd-dot ${changed ? "bd-dot--live" : "bd-dot--idle"}`} />
            {changed ? `${changed} changed from BabelDOC defaults` : "BabelDOC defaults"}
          </div>
        </header>
        <div className="bd-ribbon">
          <strong>Prototype</strong>
          <span>Real BabelDOC flags, defaults, and preset patches; values are in memory and Save is inert.</span>
          <span className="bd-ribbon-tail">{active.key} · {active.name}</span>
        </div>
        <div className="bd-body">
          {variant === "A" && <VariantA {...surface} />}
          {variant === "B" && <VariantB {...surface} />}
          {variant === "C" && <VariantC {...surface} />}
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

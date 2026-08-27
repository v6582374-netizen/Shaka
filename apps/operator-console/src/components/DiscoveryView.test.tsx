import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiscoveryView } from "./DiscoveryView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders one empty Discovery shell with internal context navigation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      module: "discovery",
      schema_version: 1,
      contexts: [
        { id: "preparation", label: "Preparation", description: "Prepare inputs." },
        { id: "launch", label: "Current Launch", description: "Observe a launch." },
        { id: "history", label: "History", description: "Review history." },
      ],
      active_context: "preparation",
      preparation: { status: "empty" },
      current_launch: null,
      history: [],
    }),
  })));

  render(<DiscoveryView />);

  expect(await screen.findByRole("heading", { name: "Gather context" })).toBeTruthy();
  expect(screen.queryByText("Native module", { exact: true })).toBeNull();
  expect(screen.queryByText("Free-form text", { exact: true })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Research text" }).className).toContain("min-h-[172px]");
  expect(screen.getByText(/Empty Preparation/)).toBeTruthy();
  expect(screen.queryByText("CURRENT OBSERVATION · PREPARATION")).toBeNull();
  expect(screen.queryByText("Ready to launch")).toBeNull();
  expect(screen.queryByText("Waiting for a confirmed Launch")).toBeNull();
  expect(screen.getByRole("heading", { name: "Discovery" })).toBeTruthy();
  expect(screen.getByText("Preparation in progress").closest(".discovery-context-nav-row")).toBeTruthy();
  expect(screen.queryByText("Preparation / stage canvas", { exact: false })).toBeNull();
  expect(screen.queryByText("Move one Preparation through four deliberate stages.", { exact: true })).toBeNull();
  expect(screen.queryByTestId("discovery-artifacts")).toBeNull();
  expect(screen.getByRole("button", { name: "Refresh Preparation" })).toBeTruthy();
  const preparationTab = screen.getByRole("tab", { name: "Preparation" });
  expect(preparationTab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(preparationTab.id);

  fireEvent.click(screen.getByRole("tab", { name: "Current Launch" }));
  expect(screen.queryByRole("button", { name: "Refresh Preparation" })).toBeNull();
  expect(await screen.findByTestId("discovery-checkpoint-strip")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Preparation" })).toBeTruthy();
  expect(screen.getByText("CURRENT OBSERVATION · PREPARATION")).toBeTruthy();
  expect(screen.getByText("Ready to launch")).toBeTruthy();
  expect(screen.getByText("Waiting for a confirmed Launch")).toBeTruthy();
  expect(screen.queryByText("No current Launch")).toBeNull();
  expect(screen.queryByText("Execution inactive. Start a Discovery run from Preparation to activate this surface.")).toBeNull();
  expect(screen.getByText("Runtime pulse")).toBeTruthy();
  expect(screen.getByTestId("discovery-checkpoint-slot-mas").className).toContain("is-locked");
  expect(screen.getByTestId("discovery-checkpoint-slot-method").className).toContain("is-locked");
  expect(screen.getByTestId("discovery-checkpoint-slot-handoff").className).toContain("is-locked");
  expect(screen.getByTestId("runtime-desk")).toBeTruthy();
  expect(screen.getByText("Artifacts will appear after a Launch starts.")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "History" }));
  expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: "Refresh Preparation" })).toBeNull();
  expect(screen.getByRole("heading", { name: "No Launch history yet" })).toBeTruthy();
});

it("does not present an empty Preparation when the sidecar is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "missing token" }),
  })));

  render(<DiscoveryView />);

  expect(await screen.findByRole("heading", { name: "Discovery is unavailable" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Your first Preparation is empty" })).toBeNull();
});

it("accepts text and files into a draft and saves the whole Preparation explicitly", async () => {
  const source = {
    source_id: "source-1",
    filename: "notes.md",
    extension: ".md",
    size: 5,
    sha256: "hash-1",
  };
  const base = {
    module: "discovery",
    schema_version: 1,
    contexts: [
      { id: "preparation", label: "Preparation", description: "Prepare inputs." },
      { id: "launch", label: "Current Launch", description: "Observe a launch." },
      { id: "history", label: "History", description: "Review history." },
    ],
    active_context: "preparation",
    current_launch: null,
    history: [],
  } as const;
  const empty = {
    ...base,
    preparation: {
      status: "empty",
      dirty: false,
      draft: { text: "", sources: [] },
      saved: { text: "", sources: [] },
    },
  };
  const draft = {
    ...base,
    preparation: {
      status: "draft",
      dirty: true,
      draft: { text: "Research salinity.", sources: [source] },
      saved: { text: "", sources: [] },
    },
  };
  const saved = {
    ...base,
    preparation: {
      status: "saved",
      dirty: false,
      draft: { text: "Research salinity.", sources: [source] },
      saved: { text: "Research salinity.", sources: [source] },
    },
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/discovery/preparation/intake")) {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body)).text).toBe("Research salinity.");
      return { ok: true, status: 200, json: async () => draft } as Response;
    }
    if (url.endsWith("/v1/discovery/preparation/save")) {
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Research salinity." });
      return { ok: true, status: 200, json: async () => saved } as Response;
    }
    return { ok: true, status: 200, json: async () => empty } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByRole("heading", { name: "Gather context" })).toBeTruthy();

  fireEvent.change(screen.getByRole("textbox", { name: "Research text" }), {
    target: { value: "Research salinity." },
  });
  const file = new File(["hello"], "notes.md", { type: "text/markdown" });
  fireEvent.change(screen.getByLabelText("Source files"), { target: { files: [file] } });

  expect(await screen.findByText("notes.md")).toBeTruthy();
  expect(screen.getByText("Draft changes not saved")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Convert" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save Preparation" }));

  await waitFor(() => expect(screen.getAllByText("Preparation saved").length).toBeGreaterThan(0));
  expect((screen.getByRole("button", { name: "Convert" }) as HTMLButtonElement).disabled).toBe(false);
  expect(request).toHaveBeenCalled();
});

it("confirms and atomically resets Preparation without affecting Launch navigation", async () => {
  const source = {
    source_id: "source-1",
    filename: "brief.md",
    extension: ".md",
    size: 5,
    sha256: "hash-1",
  };
  const revision = {
    revision_id: "revision-1",
    created_at: "2026-08-01T00:00:00.000Z",
    execution_input: {
      task_description: "Reviewed input",
      domain: "Scientific ML",
      background: "",
      constraints: [],
    },
    model_id: "gpt-test",
    eligible: true,
  };
  const base = {
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    active_context: "preparation" as const,
    current_launch: null,
    history: [],
  };
  const populated = {
    ...base,
    preparation: {
      status: "saved" as const,
      dirty: false,
      draft: { text: "Reset this input.", sources: [source] },
      saved: { text: "Reset this input.", sources: [source] },
      revisions: [revision],
      conversion: {
        status: "saved" as const,
        execution_input: revision.execution_input,
        model_id: "gpt-test",
        error: null,
        saved_revision_id: revision.revision_id,
        base_fingerprint: "fingerprint-1",
        current_fingerprint: "fingerprint-1",
      },
    },
  };
  const empty = {
    ...base,
    preparation: {
      status: "empty" as const,
      dirty: false,
      draft: { text: "", sources: [] },
      saved: { text: "", sources: [] },
      revisions: [],
      conversion: {
        status: "pending" as const,
        draft: "",
        model_id: null,
        error: null,
        saved_revision_id: null,
        base_fingerprint: null,
        current_fingerprint: "fingerprint-empty",
      },
    },
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/discovery/preparation/reset")) {
      expect(init?.method).toBe("POST");
      return { ok: true, status: 200, json: async () => empty } as Response;
    }
    return { ok: true, status: 200, json: async () => populated } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByText("brief.md")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh Preparation" }));
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("dialog").className).toContain("discovery-reset-dialog");
  expect(request).not.toHaveBeenCalledWith(
    expect.stringContaining("/v1/discovery/preparation/reset"),
    expect.anything(),
  );

  fireEvent.click(screen.getByRole("button", { name: "Reset Preparation" }));
  await waitFor(() => expect(screen.getByText("Preparation reset")).toBeTruthy());
  expect(screen.queryByText("brief.md")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Formatted Discovery Input" })).toBeNull();
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining("/v1/discovery/preparation/reset"),
    expect.objectContaining({ method: "POST" }),
  );

  fireEvent.click(screen.getByRole("tab", { name: "Current Launch" }));
  expect(screen.queryByRole("button", { name: "Refresh Preparation" })).toBeNull();
});

it("converts a saved Preparation into structured inputs and saves an editor revision", async () => {
  const base = {
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    active_context: "preparation" as const,
    current_launch: null,
    history: [],
  };
  const source = {
    source_id: "source-1",
    filename: "brief.md",
    extension: ".md",
    size: 5,
    sha256: "hash-1",
  };
  const pending = {
    ...base,
    preparation: {
      status: "saved" as const,
      dirty: false,
      draft: { text: "Research salinity.", sources: [source] },
      saved: { text: "Research salinity.", sources: [source] },
      revisions: [],
      conversion: {
        status: "pending" as const,
        draft: "",
        model_id: null,
        error: null,
        saved_revision_id: null,
        base_fingerprint: null,
        current_fingerprint: "fingerprint-1",
      },
    },
  };
  const executionInput = {
    task_description: "Compare calibrated and uncalibrated surrogates.",
    domain: "Scientific ML",
    background: "baseline notes",
    constraints: ["No synthetic labels."],
  };
  const editing = {
    ...pending,
    preparation: {
      ...pending.preparation,
      conversion: {
        ...pending.preparation.conversion,
        status: "editing" as const,
        execution_input: executionInput,
        model_id: "gpt-test",
        base_fingerprint: "fingerprint-1",
      },
    },
  };
  const saved = {
    ...editing,
    preparation: {
      ...editing.preparation,
      revisions: [
        {
          revision_id: "revision-1",
          created_at: "2026-08-01T00:00:00.000Z",
          execution_input: { ...executionInput, task_description: "Reviewed objective." },
          model_id: "gpt-test",
          eligible: true,
        },
      ],
      conversion: {
        ...editing.preparation.conversion,
        status: "saved" as const,
        execution_input: { ...executionInput, task_description: "Reviewed objective." },
        saved_revision_id: "revision-1",
      },
    },
  };
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/discovery/preparation/convert")) {
      expect(init?.method).toBe("POST");
      return { ok: true, status: 200, json: async () => editing } as Response;
    }
    if (url.endsWith("/v1/discovery/preparation/revisions")) {
      const body = JSON.parse(String(init?.body));
      expect(body.execution_input.task_description).toBe("Reviewed objective.");
      return { ok: true, status: 200, json: async () => saved } as Response;
    }
    return { ok: true, status: 200, json: async () => pending } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByRole("button", { name: "Convert" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Convert" }));

  expect(await screen.findByTestId("execution-input-row")).toBeTruthy();
  fireEvent.click(screen.getByTestId("execution-input-row"));
  expect(await screen.findByRole("textbox", { name: "Task description" })).toBeTruthy();
  const schemaTabs = screen.getByRole("tablist", { name: "Execution schema" });
  expect(within(schemaTabs).getAllByRole("tab")).toHaveLength(5);
  expect(screen.getByRole("tabpanel", { name: /Task description/ })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Conversion prompt" })).toBeNull();
  fireEvent.click(within(schemaTabs).getByRole("tab", { name: /Constraints/ }));
  expect(await screen.findByRole("textbox", { name: "Constraints" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Previous field/ }));
  expect(await screen.findByRole("textbox", { name: "Background" })).toBeTruthy();
  fireEvent.click(within(schemaTabs).getByRole("tab", { name: /Task description/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), {
    target: { value: "Reviewed objective." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.queryByRole("textbox", { name: "Formatted Discovery Input" })).toBeNull();
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining("/v1/discovery/preparation/revisions"),
    expect.anything(),
  );
});

it("deletes one draft Source Entry without changing the saved state", async () => {
  const source = {
    source_id: "source-1",
    filename: "notes.md",
    extension: ".md",
    size: 5,
    sha256: "hash-1",
  };
  const snapshot = (draftSources: typeof source[], dirty: boolean) => ({
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    active_context: "preparation" as const,
    preparation: {
      status: dirty ? "draft" as const : "saved" as const,
      dirty,
      draft: { text: "Saved text.", sources: draftSources },
      saved: { text: "Saved text.", sources: [source] },
    },
    current_launch: null,
    history: [],
  });
  const request = vi.fn(async (url: string) => {
    if (url.includes("/sources/source-1")) {
      return { ok: true, status: 200, json: async () => snapshot([], true) } as Response;
    }
    return { ok: true, status: 200, json: async () => snapshot([source], false) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByText("notes.md")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove notes.md" }));

  await waitFor(() => expect(screen.queryByText("notes.md")).toBeNull());
  expect(screen.getByText(/Saved Preparation remains unchanged until Save/)).toBeTruthy();
});

it("requires confirmation before admitting an eligible Discovery Launch", async () => {
  const base = {
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    active_context: "preparation" as const,
    history: [],
  };
  const revision = {
    revision_id: "revision-1",
    created_at: "2026-08-01T00:00:00.000Z",
    execution_input: {
      task_description: "Reviewed input",
      domain: "Scientific ML",
      background: "",
      constraints: [],
    },
    model_id: "gpt-test",
    eligible: true,
  };
  const preparation = {
    status: "saved" as const,
    dirty: false,
    draft: { text: "Research question.", sources: [] },
    saved: { text: "Research question.", sources: [] },
    revisions: [revision],
    conversion: {
      status: "saved" as const,
      execution_input: revision.execution_input,
      model_id: "gpt-test",
      error: null,
      saved_revision_id: revision.revision_id,
      base_fingerprint: "fingerprint-1",
      current_fingerprint: "fingerprint-1",
    },
  };
  const launch = {
    launch_id: "launch-1",
    preparation_id: "preparation",
    revision_id: revision.revision_id,
    created_at: "2026-08-01T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    state: "starting" as const,
    stage: "admission",
    round: 0,
    attempts: [],
    runner_pid: null,
    outcome: null,
    error: null,
  };
  const initial = { ...base, preparation, current_launch: null };
  const admitted = { ...base, preparation, active_context: "launch" as const, current_launch: launch };
  let launchStarted = false;
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/discovery/launches")) {
      launchStarted = true;
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        preparation_id: "preparation",
        revision_id: revision.revision_id,
      });
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBeTruthy();
      return {
        ok: true,
        status: 201,
        json: async () => ({ launch_id: launch.launch_id, state: "starting", snapshot: admitted }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => (launchStarted ? admitted : initial) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByRole("button", { name: "Run" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(request).not.toHaveBeenCalledWith(
    expect.stringContaining("/v1/discovery/launches"),
    expect.anything(),
  );

  fireEvent.click(screen.getByRole("button", { name: "Start Launch" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Current Launch" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(screen.getByText(/Launch launch-1/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith(
    expect.stringContaining("/v1/discovery/launches"),
    expect.anything(),
  );
});

it("keeps a terminal failure on Current Launch instead of navigating to History", async () => {
  const launch = {
    launch_id: "launch-failed",
    preparation_id: "preparation",
    revision_id: "revision-1",
    created_at: "2026-08-01T00:00:00.000Z",
    started_at: "2026-08-01T00:00:01.000Z",
    completed_at: "2026-08-01T00:00:04.000Z",
    state: "failed" as const,
    stage: "research",
    round: 1,
    attempts: [],
    runner_pid: null,
    outcome: null,
    error: "runner crashed",
  };
  const preparation = {
    status: "saved" as const,
    dirty: false,
    draft: { text: "Research question.", sources: [] },
    saved: { text: "Research question.", sources: [] },
    revisions: [
      {
        revision_id: "revision-1",
        created_at: "2026-08-01T00:00:00.000Z",
        execution_input: { task_description: "Research question.", domain: "", background: "", constraints: [] },
        model_id: "gpt-test",
        eligible: true,
      },
    ],
    conversion: {
      status: "saved" as const,
      execution_input: { task_description: "Research question.", domain: "", background: "", constraints: [] },
      model_id: "gpt-test",
      error: null,
      saved_revision_id: "revision-1",
      base_fingerprint: "fingerprint-1",
      current_fingerprint: "fingerprint-1",
    },
  };
  const contexts = [
    { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
    { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
    { id: "history" as const, label: "History", description: "Review history." },
  ];
  const initial = {
    module: "discovery" as const,
    schema_version: 1,
    contexts,
    active_context: "preparation" as const,
    preparation,
    current_launch: null,
    history: [],
  };
  const terminalSnapshot = { ...initial, history: [launch] };
  const status = {
    launch,
    state: "failed" as const,
    stage: "research",
    round: 1,
    checkpoint: null,
    timeline: { revision: 1, percent: 33, current_milestone_id: null, milestones: [] },
    activity: { oldest_sequence: null, newest_sequence: null, truncated_before_sequence: 0, items: [] },
    allowed_actions: [],
    produced_outputs: [],
    latest_event_sequence: 0,
  };
  let started = false;
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/discovery/launches")) {
      started = true;
      expect(init?.method).toBe("POST");
      return { ok: true, status: 201, json: async () => ({ launch_id: launch.launch_id, state: "failed", snapshot: terminalSnapshot }) } as Response;
    }
    if (url.endsWith("/v1/discovery")) {
      return { ok: true, status: 200, json: async () => (started ? terminalSnapshot : initial) } as Response;
    }
    if (url.includes("/status")) return { ok: true, status: 200, json: async () => status } as Response;
    if (url.includes("/events")) return { ok: true, status: 200, json: async () => ({ events: [], latest_sequence: 0 }) } as Response;
    if (url.includes("/artifacts")) return { ok: true, status: 200, json: async () => ({ artifacts: [] }) } as Response;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Launch" }));

  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Current Launch" }).getAttribute("aria-selected")).toBe("true"),
  );
  expect(screen.getAllByText(/runner crashed/).length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Current Discovery Launch").className).toContain("is-error");
  expect(screen.getByText("Runtime pulse")).toBeTruthy();
});

it("keeps artifacts on Current Launch and makes History a consolidated list", async () => {
  const launch = {
    launch_id: "launch-artifacts",
    preparation_id: "preparation",
    revision_id: "revision-1",
    created_at: "2026-08-01T00:00:00.000Z",
    started_at: "2026-08-01T00:00:01.000Z",
    completed_at: null,
    state: "running" as const,
    stage: "research",
    round: 1,
    attempts: [],
    runner_pid: 42,
    outcome: null,
    error: null,
  };
  const base = {
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    preparation: {
      status: "empty" as const,
      dirty: false,
      draft: { text: "", sources: [] },
      saved: { text: "", sources: [] },
      revisions: [],
      conversion: {
        status: "pending" as const,
        draft: "",
        model_id: null,
        error: null,
        saved_revision_id: null,
        base_fingerprint: null,
        current_fingerprint: "",
      },
    },
    current_launch: launch,
    history: [launch],
  };
  const status = {
    launch,
    state: "running" as const,
    stage: "research",
    round: 1,
    checkpoint: null,
    timeline: { revision: 1, percent: 33, current_milestone_id: "research", milestones: [] },
    activity: { oldest_sequence: null, newest_sequence: null, truncated_before_sequence: 0, items: [] },
    allowed_actions: ["stop"],
    produced_outputs: [],
    latest_event_sequence: 0,
  };
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/v1/discovery")) {
      return { ok: true, status: 200, json: async () => ({ ...base, active_context: "launch" }) } as Response;
    }
    if (url.includes("/artifacts") && !url.includes("/read") && !url.includes("/reveal")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          launch_id: launch.launch_id,
          artifacts: [{ path: "report.md", name: "report.md", kind: "markdown", size: 12, modified_at: 1, previewable: true }],
        }),
      } as Response;
    }
    if (url.includes("/status")) return { ok: true, status: 200, json: async () => status } as Response;
    if (url.includes("/events")) return { ok: true, status: 200, json: async () => ({ events: [], latest_sequence: 0 }) } as Response;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);
  expect(await screen.findByTestId("discovery-artifacts")).toBeTruthy();
  expect(await screen.findByText("report.md")).toBeTruthy();
  expect(screen.queryByText("Access")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "History" }));
  expect(await screen.findByLabelText("Discovery Launch history")).toBeTruthy();
  expect(screen.getByLabelText("Scrollable launch history")).toBeTruthy();
  expect(screen.queryByText("Archive / immutable records")).toBeNull();
  expect(screen.queryByText("Past Launches")).toBeNull();
  expect(screen.queryByText("Terminal feedback remains on Current Launch")).toBeNull();
  expect(screen.queryByText(/archived launches/)).toBeNull();
  expect(screen.queryByText("More archived launches below")).toBeNull();
  expect(document.querySelector(".discovery-history-consolidated-moon")).toBeNull();
  expect(screen.getByText("Launch records")).toBeTruthy();
  expect(screen.getByText("Duration")).toBeTruthy();
  expect(screen.getByText("Sources")).toBeTruthy();
  expect(screen.getByText("Outputs")).toBeTruthy();
  expect(screen.getByLabelText("Current Discovery Launch")).toBeTruthy();
  expect(screen.getByTestId("discovery-artifacts")).toBeTruthy();
  expect(screen.getByText("report.md")).toBeTruthy();
  expect(screen.getByText("Runtime pulse")).toBeTruthy();
  expect(screen.queryByText("Research progress")).toBeNull();
  expect(screen.queryByText("Lifecycle")).toBeNull();
});

it("renders the Stage Strip with fixed seam slots and one inactive checkpoint Resume path", async () => {
  const launch = {
    launch_id: "launch-stage-strip",
    preparation_id: "preparation",
    revision_id: "revision-1",
    created_at: "2026-08-01T00:00:00.000Z",
    started_at: "2026-08-01T00:00:01.000Z",
    completed_at: null,
    state: "awaiting_review" as const,
    stage: "mas",
    round: 2,
    attempts: [],
    runner_pid: null,
    resumable: true,
    checkpoint: {
      checkpoint_id: "checkpoint-mas-2",
      seam: "mas",
      attempt_id: "attempt-1",
      stage: "mas",
      round: 2,
      reason: "human review",
      created_at: "2026-08-01T00:00:02.000Z",
    },
    outcome: null,
    error: null,
  };
  const base = {
    module: "discovery" as const,
    schema_version: 1,
    contexts: [
      { id: "preparation" as const, label: "Preparation", description: "Prepare inputs." },
      { id: "launch" as const, label: "Current Launch", description: "Observe a launch." },
      { id: "history" as const, label: "History", description: "Review history." },
    ],
    active_context: "launch" as const,
    preparation: {
      status: "empty" as const,
      dirty: false,
      draft: { text: "", sources: [] },
      saved: { text: "", sources: [] },
      revisions: [],
      conversion: {
        status: "pending" as const,
        model_id: null,
        error: null,
        saved_revision_id: null,
        base_fingerprint: null,
        current_fingerprint: "",
      },
    },
    current_launch: launch,
    history: [],
  };
  const status = {
    launch,
    state: "awaiting_review" as const,
    stage: "mas",
    round: 2,
    checkpoint: launch.checkpoint,
    timeline: {
      revision: 2,
      percent: 44,
      current_milestone_id: "mas",
      milestones: [
        {
          id: "preparing",
          key: "preparing",
          label: "Prepare sources",
          position: 1,
          state: "completed",
          summary: "Launch snapshot created",
          started_at: null,
          ended_at: null,
          attempts: [],
        },
        {
          id: "mas",
          key: "mas",
          label: "Run MAS",
          position: 2,
          state: "completed",
          summary: "Ranking bundle written",
          started_at: null,
          ended_at: null,
          attempts: [],
        },
      ],
    },
    activity: {
      oldest_sequence: null,
      newest_sequence: null,
      truncated_before_sequence: 0,
      items: [],
    },
    allowed_actions: ["resume"],
    produced_outputs: [],
    latest_event_sequence: 0,
  };
  let resumed = false;
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/v1/discovery")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...base, current_launch: resumed ? { ...launch, state: "running" } : launch }),
      } as Response;
    }
    if (url.includes("/artifacts") && !url.includes("/read") && !url.includes("/reveal")) {
      return { ok: true, status: 200, json: async () => ({ artifacts: [] }) } as Response;
    }
    if (url.includes("/status")) {
      return { ok: true, status: 200, json: async () => status } as Response;
    }
    if (url.includes("/events")) {
      return { ok: true, status: 200, json: async () => ({ events: [], latest_sequence: 0 }) } as Response;
    }
    if (url.includes("/resume")) {
      resumed = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ launch_id: launch.launch_id, state: "running", snapshot: { ...base, current_launch: { ...launch, state: "running" } } }),
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryView />);

  expect(await screen.findByTestId("discovery-checkpoint-strip")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Review checkpoints" })).toBeTruthy();
  expect(screen.getByTestId("discovery-checkpoint-slot-mas").querySelector("strong")?.textContent).toBe("After MAS ranking");
  expect(screen.getByTestId("discovery-checkpoint-slot-method").querySelector("strong")?.textContent).toBe("Before experiment");
  expect(screen.getByTestId("discovery-checkpoint-slot-handoff").querySelector("strong")?.textContent).toBe("Before PaperOrchestra");
  expect(screen.getByTestId("discovery-checkpoint-slot-mas").className).toContain("is-active");
  expect(screen.getByTestId("discovery-checkpoint-slot-method").getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("Execution inactive")).toBeTruthy();
  expect(screen.getByTestId("runtime-desk")).toBeTruthy();

  fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]);
  await waitFor(() => expect(request.mock.calls.some(([url]) => String(url).includes("/resume"))).toBe(true));
});

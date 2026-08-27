// Document Translation ▸ provider reuse. The behaviour under test is the contract between this
// settings surface and Settings ▸ Models: the Provider dropdown offers exactly the providers the
// user already configured AND that BabelDOC can actually drive (the OpenAI-compatible ones), and
// the chosen name is what gets saved — no key ever travels through this form.
//
// The Model field is part of the same contract. A model from a different vendor than the chosen
// provider is rejected on every paragraph while the run still reports success, so provider and
// model must move together and a foreign model must be visibly called out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  TranslationSettingsSection,
  modelForProvider,
  usableProviders,
} from "./TranslationSettingsSection";
import type { ProviderInfo, TranslationSettingsValues } from "../api";

const mocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getTranslationSettings: vi.fn(),
  setTranslationSettings: vi.fn(),
}));

vi.mock("../api", () => ({
  getProviders: mocks.getProviders,
  getTranslationSettings: mocks.getTranslationSettings,
  setTranslationSettings: mocks.setTranslationSettings,
}));

const { getProviders, getTranslationSettings, setTranslationSettings } = mocks;

const DEFAULTS = {
  provider: "",
  lang_in: "en",
  lang_out: "zh",
  openai_model: "gpt-4o-mini",
  openai_base_url: "",
  qps: 4,
  pool_max_workers: 0,
  ignore_cache: false,
  pages: "",
  primary_font_family: "auto",
  watermark_output_mode: "watermarked",
  custom_system_prompt: "",
} as unknown as TranslationSettingsValues;

const provider = (over: Partial<ProviderInfo>): ProviderInfo =>
  ({
    name: "x",
    title: "X",
    needs_key: true,
    fields: [],
    configured: true,
    values: {},
    suggested_models: [],
    recommended_model: null,
    openai_compatible: true,
    ...over,
  }) as ProviderInfo;

const doc = (values: Partial<TranslationSettingsValues> = {}) => ({
  schema_version: 1,
  values: { ...DEFAULTS, ...values },
  defaults: DEFAULTS,
  parameters: {},
});

const dropdown = () => screen.getByLabelText("Provider") as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  getTranslationSettings.mockResolvedValue(doc());
  getProviders.mockResolvedValue([
    provider({
      name: "openai",
      title: "OpenAI",
      suggested_models: ["gpt-5.6-sol", "gpt-5.5"],
      recommended_model: "gpt-5.6-sol",
    }),
    provider({
      name: "deepseek",
      title: "DeepSeek",
      suggested_models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      recommended_model: "deepseek-v4-flash",
    }),
  ]);
});

afterEach(cleanup);

describe("usableProviders", () => {
  it("keeps only providers that are configured AND OpenAI-compatible", () => {
    const list = usableProviders([
      provider({ name: "openai", title: "OpenAI" }),
      provider({ name: "deepseek", title: "DeepSeek", configured: false }),
      provider({ name: "anthropic", title: "Claude (Anthropic)", openai_compatible: false }),
      provider({ name: "ollama", title: "Ollama (local models)", needs_key: false }),
    ]);

    expect(list.map((p) => p.name)).toEqual(["openai", "ollama"]);
  });

  it("carries each provider's own model list, so the Model field can follow it", () => {
    const [only] = usableProviders([
      provider({
        name: "deepseek",
        title: "DeepSeek",
        suggested_models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        recommended_model: "deepseek-v4-flash",
      }),
    ]);

    expect(only.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(only.recommended).toBe("deepseek-v4-flash");
  });

  it("treats a sidecar that does not report compatibility as not offerable", () => {
    const legacy = provider({ name: "openai", title: "OpenAI" });
    delete (legacy as { openai_compatible?: boolean }).openai_compatible;

    expect(usableProviders([legacy])).toEqual([]);
  });
});

describe("Provider field", () => {
  it("offers the configured providers plus the default OpenAI slot", async () => {
    render(<TranslationSettingsSection />);

    const options = await waitFor(() => Array.from(dropdown().options).map((o) => o.value));
    expect(options).toEqual(["", "openai", "deepseek"]);
    expect(dropdown().value).toBe("");
  });

  it("saves the chosen provider by name, and never a credential", async () => {
    setTranslationSettings.mockImplementation((values: Partial<TranslationSettingsValues>) =>
      Promise.resolve(doc(values)),
    );
    render(<TranslationSettingsSection />);
    await waitFor(() => dropdown());

    fireEvent.change(dropdown(), { target: { value: "deepseek" } });
    // Two changes, not one: the provider carries its model with it.
    fireEvent.click(await screen.findByRole("button", { name: /Save 2 changes/ }));

    await waitFor(() => expect(setTranslationSettings).toHaveBeenCalled());
    const sent = setTranslationSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.provider).toBe("deepseek");
    expect(Object.keys(sent)).not.toContain("api_key");
  });

  it("keeps a stored provider visible after its key is removed", async () => {
    getTranslationSettings.mockResolvedValue(doc({ provider: "kimi" }));
    getProviders.mockResolvedValue([provider({ name: "openai", title: "OpenAI" })]);
    render(<TranslationSettingsSection />);

    await waitFor(() => expect(dropdown().value).toBe("kimi"));
    expect(screen.getByRole("option", { name: /kimi \(not configured\)/ })).toBeTruthy();
  });

  it("still renders the form when the provider list cannot be fetched", async () => {
    getProviders.mockRejectedValue(new Error("sidecar down"));
    render(<TranslationSettingsSection />);

    const options = await waitFor(() => Array.from(dropdown().options).map((o) => o.value));
    expect(options).toEqual([""]);
    expect(screen.getByLabelText("Target language")).toBeTruthy();
  });
});

describe("modelForProvider", () => {
  const list = usableProviders([
    provider({
      name: "deepseek",
      title: "DeepSeek",
      suggested_models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      recommended_model: "deepseek-v4-flash",
    }),
    provider({ name: "ollama", title: "Ollama", suggested_models: ["qwen3:8b"] }),
  ]);

  it("prefers the provider's own recommendation", () => {
    expect(modelForProvider(list, "deepseek", "gpt-4o-mini")).toBe("deepseek-v4-flash");
  });

  it("falls back to the first served model when nothing is recommended", () => {
    expect(modelForProvider(list, "ollama", "gpt-4o-mini")).toBe("qwen3:8b");
  });

  it("leaves the value alone for the OpenAI slot, which has no authoritative list", () => {
    expect(modelForProvider(list, "", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("Model field", () => {
  const modelBox = () => screen.getByLabelText("Model") as HTMLSelectElement;

  it("is free text until a provider is chosen", async () => {
    render(<TranslationSettingsSection />);

    await waitFor(() => expect(modelBox().tagName).toBe("INPUT"));
  });

  it("switches to the chosen provider's models and adopts its recommendation", async () => {
    render(<TranslationSettingsSection />);
    await waitFor(() => dropdown());

    fireEvent.change(dropdown(), { target: { value: "deepseek" } });

    await waitFor(() => expect(modelBox().tagName).toBe("SELECT"));
    expect(Array.from(modelBox().options).map((o) => o.value)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(modelBox().value).toBe("deepseek-v4-flash");
  });

  it("saves provider and model as one coherent pair", async () => {
    setTranslationSettings.mockImplementation((values: Partial<TranslationSettingsValues>) =>
      Promise.resolve(doc(values)),
    );
    render(<TranslationSettingsSection />);
    await waitFor(() => dropdown());

    fireEvent.change(dropdown(), { target: { value: "deepseek" } });
    fireEvent.click(await screen.findByRole("button", { name: /Save 2 changes/ }));

    await waitFor(() => expect(setTranslationSettings).toHaveBeenCalled());
    const sent = setTranslationSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ provider: "deepseek", openai_model: "deepseek-v4-flash" });
  });

  it("calls out a stored model the chosen provider does not serve", async () => {
    getTranslationSettings.mockResolvedValue(
      doc({ provider: "deepseek", openai_model: "gpt-4o-mini" }),
    );
    render(<TranslationSettingsSection />);

    await waitFor(() =>
      expect(screen.getByText(/DeepSeek does not serve this model/)).toBeTruthy(),
    );
    expect(screen.getByRole("option", { name: /gpt-4o-mini \(not served\)/ })).toBeTruthy();
  });
});

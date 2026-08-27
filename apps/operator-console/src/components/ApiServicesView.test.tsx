import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiServicesView } from "./ApiServicesView";
import type { ApiService } from "../api";

const mocks = vi.hoisted(() => ({
  getApiServices: vi.fn(),
  setApiService: vi.fn(),
  testApiService: vi.fn(),
}));

vi.mock("../api", () => ({
  getApiServices: mocks.getApiServices,
  setApiService: mocks.setApiService,
  testApiService: mocks.testApiService,
}));

const { getApiServices, setApiService, testApiService } = mocks;

const SERVICES: ApiService[] = [
  {
    name: "arxiv",
    title: "arXiv",
    description: "Preprint discovery",
    credential_label: "Contact email",
    credential_kind: "email",
    endpoint: "https://export.arxiv.org/api/query",
    docs_url: null,
    docs_url_editable: false,
    requires_credential: false,
    enabled: true,
    credential_configured: false,
    credential_source: null,
    status: "not_tested",
    last_test_at: null,
    last_error: null,
  },
  {
    name: "semantic-scholar",
    title: "Semantic Scholar",
    description: "Citation graph",
    credential_label: "API key",
    credential_kind: "api_key",
    endpoint: "https://api.semanticscholar.org/graph/v1",
    docs_url: null,
    docs_url_editable: false,
    requires_credential: false,
    enabled: true,
    credential_configured: false,
    credential_source: null,
    status: "not_tested",
    last_test_at: null,
    last_error: null,
  },
  {
    name: "crossref",
    title: "Crossref",
    description: "Metadata registry",
    credential_label: "Contact email",
    credential_kind: "email",
    endpoint: "https://api.crossref.org/works",
    docs_url: null,
    docs_url_editable: false,
    requires_credential: false,
    enabled: true,
    credential_configured: true,
    credential_source: "stored",
    status: "connected",
    last_test_at: "2026-08-05T08:00:00+00:00",
    last_error: null,
  },
  {
    name: "core",
    title: "CORE",
    description: "Open access index",
    credential_label: "API key",
    credential_kind: "api_key",
    endpoint: "https://api.core.ac.uk/v3/search/works",
    docs_url: null,
    docs_url_editable: false,
    requires_credential: true,
    enabled: false,
    credential_configured: false,
    credential_source: null,
    status: "disabled",
    last_test_at: null,
    last_error: null,
  },
  {
    name: "nlr_developer_network",
    title: "NLR",
    description: "Official research data",
    credential_label: "API key",
    credential_kind: "api_key",
    endpoint: null,
    docs_url: "https://developer.nlr.gov/docs/",
    docs_url_editable: true,
    requires_credential: true,
    enabled: false,
    credential_configured: false,
    credential_source: null,
    status: "disabled",
    last_test_at: null,
    last_error: null,
  },
];

beforeEach(() => {
  getApiServices.mockResolvedValue({ services: SERVICES });
  setApiService.mockImplementation(async (name: string, values: { enabled: boolean; credential?: string; docs_url?: string }) => ({
    ok: true,
    service: { ...SERVICES.find((service) => service.name === name)!, ...values, credential_configured: Boolean(values.credential) },
  }));
  testApiService.mockResolvedValue({ ok: true, status: "connected", checked_at: "2026-08-05T09:00:00+00:00" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApiServicesView", () => {
  it("renders the fixed five-source Quiet Stack", async () => {
    render(<ApiServicesView />);

    expect(await screen.findByText("Semantic Scholar")).toBeTruthy();
    expect(screen.getByText("arXiv")).toBeTruthy();
    expect(screen.getByText("Crossref")).toBeTruthy();
    expect(screen.getByText("CORE")).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    expect(screen.getByText("NLR")).toBeTruthy();
  });

  it("keeps the enabled toggle scoped to its own card", async () => {
    render(<ApiServicesView />);
    const arxivSwitch = await screen.findByRole("switch", { name: "Disable arXiv" });
    fireEvent.click(arxivSwitch);

    expect(screen.getByRole("switch", { name: "Enable arXiv" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Disable Semantic Scholar" }).getAttribute("aria-checked")).toBe("true");
  });

  it("saves only the edited card and keeps credentials out of the rendered response", async () => {
    render(<ApiServicesView />);
    fireEvent.click(await screen.findByRole("button", { name: /Expand Crossref details/ }));
    const input = await screen.findByLabelText("Crossref Contact email");
    fireEvent.change(input, { target: { value: "research@example.com" } });

    const card = input.closest("article");
    expect(card).toBeTruthy();
    fireEvent.click(within(card!).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(setApiService).toHaveBeenCalledWith("crossref", {
      enabled: true,
      credential: "research@example.com",
    }));
    expect(screen.queryByText("research@example.com")).toBeNull();
  });

  it("tests an unsaved credential without saving it automatically", async () => {
    render(<ApiServicesView />);
    fireEvent.click(await screen.findByRole("button", { name: /Expand CORE details/ }));
    const input = await screen.findByLabelText("CORE API key");
    fireEvent.click(screen.getByRole("switch", { name: "Enable CORE" }));
    fireEvent.change(input, { target: { value: "core-secret" } });
    const card = input.closest("article");
    fireEvent.click(within(card!).getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(testApiService).toHaveBeenCalledWith("core", "core-secret"));
    expect(await within(card!).findByText("Connected")).toBeTruthy();
    expect(setApiService).not.toHaveBeenCalled();
  });

  it("saves the NLR API key and editable documentation address together", async () => {
    render(<ApiServicesView />);
    fireEvent.click(await screen.findByRole("button", { name: /Expand NLR details/ }));
    const keyInput = await screen.findByLabelText("NLR API key");
    const docsInput = screen.getByLabelText("NLR API documentation address");
    fireEvent.click(screen.getByRole("switch", { name: "Enable NLR" }));
    fireEvent.change(keyInput, { target: { value: "nlr-secret" } });
    fireEvent.change(docsInput, { target: { value: "https://example.test/nlr/docs" } });

    const card = keyInput.closest("article");
    fireEvent.click(within(card!).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(setApiService).toHaveBeenCalledWith("nlr_developer_network", {
      enabled: true,
      credential: "nlr-secret",
      docs_url: "https://example.test/nlr/docs",
    }));
    expect(screen.queryByText("nlr-secret")).toBeNull();
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, render, waitFor } from "@testing-library/react";
import { DiscoveryArtifactPanel } from "./DiscoveryArtifacts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists only the selected Launch artifacts and previews human-readable output in-app", async () => {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/artifacts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          launch_id: "launch-1",
          artifacts: [
            {
              path: "report.md",
              name: "report.md",
              kind: "markdown",
              size: 12,
              modified_at: 1,
              previewable: true,
            },
            {
              path: "summary.json",
              name: "summary.json",
              kind: "structured",
              size: 15,
              modified_at: 1,
              previewable: true,
            },
          ],
        }),
      } as Response;
    }
    expect(url).toContain("/v1/discovery/launches/launch-1/artifacts/read?");
    expect(new URL(url, window.location.origin).searchParams.get("path")).toBe("report.md");
    expect(init).toBeDefined();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        path: "report.md",
        name: "report.md",
        kind: "markdown",
        size: 12,
        modified_at: 1,
        previewable: true,
        content: "# Launch report",
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryArtifactPanel launchId="launch-1" />);

  expect(await screen.findByText("report.md")).toBeTruthy();
  expect(screen.getByText("summary.json")).toBeTruthy();
  expect(screen.queryByText("Access")).toBeNull();
  expect(screen.queryByText("runner.log")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /report\.md/ }));
  expect(await screen.findByText("Launch report")).toBeTruthy();
  expect(screen.queryByText("Copy path")).toBeNull();
});

it("uses explicit native actions for binary artifacts without browsing arbitrary paths", async () => {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/artifacts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          artifacts: [
            {
              path: "paper.pdf",
              name: "paper.pdf",
              kind: "pdf",
              size: 100,
              modified_at: 1,
              previewable: false,
            },
          ],
        }),
      } as Response;
    }
    if (url.includes("/artifacts/read?")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          path: "paper.pdf",
          name: "paper.pdf",
          kind: "pdf",
          size: 100,
          modified_at: 1,
          previewable: false,
          content: null,
          data_url: null,
        }),
      } as Response;
    }
    expect(url).toBe("/v1/discovery/launches/launch-1/artifacts/reveal");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ path: "paper.pdf", mode: "open" });
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", request);

  render(<DiscoveryArtifactPanel launchId="launch-1" />);
  fireEvent.click(await screen.findByRole("button", { name: /paper\.pdf/ }));
  expect(await screen.findByText(/explicit native Open or Reveal/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Discovery artifact in default app" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    "/v1/discovery/launches/launch-1/artifacts/reveal",
    expect.objectContaining({ method: "POST" }),
  ));
  expect(screen.queryByRole("button", { name: "Copy path" })).toBeNull();
});

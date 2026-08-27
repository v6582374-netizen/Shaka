import { afterEach, describe, expect, it, vi } from "vitest";
import { installWebTauriBridge } from "./features/skills-manager/web-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (globalThis as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__;
});

describe("browser Skills Manager bridge", () => {
  it("provides the Tauri invoke seam before Skills Manager calls detect_tools", async () => {
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/v1/skills-manager/invoke");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { command?: string };
      expect(body.command).toBe("detect_tools");
      return {
        ok: true,
        json: async () => [{ id: "codex", detected: true }],
      } as Response;
    });
    vi.stubGlobal("__OPENWORKER_WEB__", true);
    vi.stubGlobal("fetch", request);

    installWebTauriBridge();
    const { invoke } = await import("@tauri-apps/api/core");
    await expect(invoke("detect_tools")).resolves.toEqual([{ id: "codex", detected: true }]);
    expect(request).toHaveBeenCalledOnce();
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { getDiscovery, getHealth, getPromptLibrary, Session } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("authenticates REST and session WebSocket calls with the launch token", async () => {
  vi.stubGlobal("__COWORKER_API_TOKEN__", "launch-token");
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("X-OpenWorker-Token")).toBe("launch-token");
    return { json: async () => ({ status: "ok" }) } as Response;
  });
  vi.stubGlobal("fetch", request);

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readyState = FakeWebSocket.CONNECTING;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    send = vi.fn();

    constructor(
      public readonly url: string,
      public readonly protocols?: string | string[],
    ) {}
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);

  await getHealth();
  expect(request).toHaveBeenCalledOnce();

  const session = new Session("s1", "/workspace", "code", { onEvent: vi.fn() });
  const socket = (session as unknown as { ws: FakeWebSocket }).ws;
  expect(socket.protocols).toEqual(["openworker", "launch-token"]);
});

it("uses the injected sidecar address and token for Discovery REST calls", async () => {
  vi.stubGlobal("__COWORKER_HTTP__", "http://127.0.0.1:43123");
  vi.stubGlobal("__COWORKER_API_TOKEN__", "discovery-token");
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("http://127.0.0.1:43123/v1/discovery");
    expect(new Headers(init?.headers).get("X-OpenWorker-Token")).toBe("discovery-token");
    return { ok: true, status: 200, json: async () => ({ module: "discovery" }) } as Response;
  });
  vi.stubGlobal("fetch", request);

  await getDiscovery();
  expect(request).toHaveBeenCalledOnce();
});

it("rejects an unauthenticated Discovery response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "missing token" }),
  }) as Response));

  await expect(getDiscovery()).rejects.toThrow("Discovery request failed (401)");
});

it("uses same-origin REST credentials for the Linux Web Counterpart", async () => {
  vi.stubGlobal("__OPENWORKER_WEB__", true);
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/v1/health");
    expect(init?.credentials).toBe("include");
    return { json: async () => ({ status: "ok" }) } as Response;
  });
  vi.stubGlobal("fetch", request);

  await getHealth();
  expect(request).toHaveBeenCalledOnce();
});

it("uses the Vite same-origin proxy for browser development", async () => {
  vi.stubEnv("DEV", true);
  vi.stubGlobal("__COWORKER_API_TOKEN__", "dev-token");
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    expect(["/v1/health", "/v1/prompt-library/prompts"]).toContain(url);
    expect(init?.credentials).toBeUndefined();
    expect(new Headers(init?.headers).get("X-OpenWorker-Token")).toBe("dev-token");
    return { ok: true, status: 200, json: async () => ({ status: "ok", prompts: [] }) } as Response;
  });
  vi.stubGlobal("fetch", request);

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readyState = FakeWebSocket.CONNECTING;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(public readonly url: string) {}

    send = vi.fn();
    close = vi.fn();
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);

  await getHealth();
  await getPromptLibrary();
  expect(request).toHaveBeenCalledTimes(2);
  const session = new Session("s1", "/workspace", "code", { onEvent: vi.fn() });
  const socket = (session as unknown as { ws: FakeWebSocket }).ws;
  expect(socket.url).toBe(
    `ws://${window.location.host}/ws/session/s1?workspace=%2Fworkspace&agent=code`,
  );
});

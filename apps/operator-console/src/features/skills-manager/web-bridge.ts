/**
 * Tauri compatibility layer for the browser-hosted Skills Manager.
 *
 * The production Skills Manager intentionally imports `@tauri-apps/api` directly.  Tauri's
 * packages resolve their IPC calls through `window.__TAURI_INTERNALS__`, which a normal LAN
 * browser never receives.  Installing this tiny compatible surface lets those unchanged
 * components call the sidecar command adapter while the native shell keeps its real IPC.
 */

declare const __COWORKER_DEV_TOKEN__: string;

type Callback = (event: { event: string; id: number; payload?: unknown }) => void;
type InvokeArgs = Record<string, unknown>;

const bridgeCallbacks = new Map<number, Callback>();
const bridgeEvents = new Map<string, Set<number>>();
let nextCallbackId = 1;

const isNativeTauri = (): boolean =>
  typeof (globalThis as any).__TAURI_INTERNALS__?.invoke === "function";

const hostedWeb = (): boolean => (globalThis as any).__OPENWORKER_WEB__ === true;

const viteDevProxy = (): boolean => {
  const env = (import.meta as any).env || {};
  return (env.DEV === true || env.DEV === "true") && !hostedWeb();
};

const httpBase = (): string => {
  const env = (import.meta as any).env || {};
  return (
    (globalThis as any).__COWORKER_HTTP__ ||
    env.VITE_COWORKER_HTTP ||
    (hostedWeb() || viteDevProxy() ? "" : "http://127.0.0.1:8765")
  );
};

const apiToken = (): string => {
  const env = (import.meta as any).env || {};
  return (
    (globalThis as any).__COWORKER_API_TOKEN__ ||
    env.VITE_COWORKER_API_TOKEN ||
    (typeof __COWORKER_DEV_TOKEN__ === "string" ? __COWORKER_DEV_TOKEN__ : "")
  );
};

const invokeLocalEvent = (event: string, payload: unknown): void => {
  for (const id of bridgeEvents.get(event) ?? []) {
    bridgeCallbacks.get(id)?.({ event, id, payload });
  }
};

const postJson = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
  const response = await fetch(`${httpBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiToken() ? { "X-OpenWorker-Token": apiToken() } : {}),
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result === "object" && result && "detail" in result ? String((result as { detail?: unknown }).detail) : "Web sidecar request failed");
  return result;
};

const browserFileUpload = async (file: File): Promise<string | null> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const response = (await postJson("/v1/skills-manager/upload", {
    name: file.name,
    data: btoa(binary),
  })) as { path?: string };
  return response.path ?? null;
};

const browserDialogOpen = async (options: Record<string, unknown>): Promise<unknown> => {
  // A browser file input cannot expose the absolute path needed by the sidecar.  For
  // directories, ask the local sidecar to open the OS picker instead; cancel/no-picker is
  // represented by null exactly like Tauri's dialog plugin.
  if (options.directory === true) {
    const response = await fetch(`${httpBase()}/v1/workspaces/pick`, {
      method: "POST",
      headers: {
        ...(apiToken() ? { "X-OpenWorker-Token": apiToken() } : {}),
      },
      credentials: "include",
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { ok?: boolean; path?: string };
    return result.ok && result.path ? result.path : null;
  }
  return new Promise< string | string[] | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple === true;
    input.accept = Array.isArray(options.filters)
      ? (options.filters as Array<{ extensions?: string[] }>).flatMap((filter) => filter.extensions ?? []).map((extension) => `.${extension}`).join(",")
      : "";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      void Promise.all(files.map((file) => browserFileUpload(file)))
        .then((paths) => {
          const valid = paths.filter((path): path is string => Boolean(path));
          resolve(options.multiple === true ? valid : valid[0] ?? null);
        })
        .catch(() => resolve(null));
    };
    input.click();
  });
};

const browserDialogSave = async (options: Record<string, unknown>): Promise<string | null> => {
  const defaultPath = typeof options.defaultPath === "string" ? options.defaultPath : "skills-export.zip";
  try {
    const response = (await postJson("/v1/skills-manager/reserve-export", { name: defaultPath })) as { path?: string };
    return response.path ?? null;
  } catch {
    return null;
  }
};

const downloadExport = async (path: string): Promise<void> => {
  try {
    const response = await fetch(`${httpBase()}/v1/skills-manager/file?path=${encodeURIComponent(path)}`, {
      credentials: "include",
      headers: apiToken() ? { "X-OpenWorker-Token": apiToken() } : undefined,
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.split(/[\\/]/).pop() || "skills-export.zip";
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    // Export itself already succeeded; a browser download is best effort.
  }
};

const bridgeInvoke = async (
  command: string,
  args: InvokeArgs = {},
): Promise<unknown> => {
  if (command === "plugin:event|listen") {
    const event = String(args.event ?? "");
    const id = Number(args.handler ?? nextCallbackId++);
    // `listen()` supplies the transformCallback id in `handler`; preserve it so the Tauri
    // event package can dispatch callbacks using the same contract.
    bridgeEvents.set(event, bridgeEvents.get(event) ?? new Set());
    bridgeEvents.get(event)!.add(id);
    return id;
  }
  if (command === "plugin:event|unlisten") {
    const event = String(args.event ?? "");
    const id = Number(args.eventId);
    bridgeEvents.get(event)?.delete(id);
    bridgeCallbacks.delete(id);
    return null;
  }
  if (command === "plugin:event|emit" || command === "plugin:event|emit_to") {
    invokeLocalEvent(String(args.event ?? ""), args.payload);
    return null;
  }
  if (command === "plugin:dialog|open") {
    return browserDialogOpen(((args.options as Record<string, unknown> | undefined) ?? {}));
  }
  if (command === "plugin:dialog|save") {
    return browserDialogSave(((args.options as Record<string, unknown> | undefined) ?? {}));
  }
  if (command === "plugin:dialog|message") {
    const message = String(args.message ?? "");
    const title = args.title ? `${String(args.title)}\n\n` : "";
    const buttons = args.buttons;
    if (buttons === "YesNo" || buttons === "OkCancel" || (buttons && typeof buttons === "object")) {
      return window.confirm(`${title}${message}`) ? (buttons === "YesNo" ? "Yes" : buttons === "OkCancel" ? "Ok" : "Ok") : (buttons === "YesNo" ? "No" : "Cancel");
    }
    window.alert(`${title}${message}`);
    return null;
  }
  if (command === "plugin:window|start_dragging") {
    return null;
  }
  if (command.startsWith("plugin:")) {
    return null;
  }

  const response = await fetch(`${httpBase()}/v1/skills-manager/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiToken() ? { "X-OpenWorker-Token": apiToken() } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ command, args }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail =
      typeof body === "string"
        ? body
        : body && typeof body === "object" && "detail" in body
          ? String((body as { detail?: unknown }).detail ?? "Skills Manager request failed")
          : "Skills Manager request failed";
    throw new Error(detail);
  }
  if (command === "export_skills" && typeof args.outputPath === "string") {
    await downloadExport(args.outputPath);
  }
  return body;
};

/** Install the bridge only in a normal browser. Native Tauri IPC always wins. */
export function installWebTauriBridge(): void {
  if (typeof window === "undefined" || isNativeTauri()) return;

  const existing = ((globalThis as any).__TAURI_INTERNALS__ ?? {}) as Record<string, unknown>;
  const callbacks = (existing.callbacks ?? {}) as Record<number, Callback>;
  existing.callbacks = callbacks;
  existing.transformCallback = (callback: Callback, _once = false): number => {
    const id = nextCallbackId++;
    bridgeCallbacks.set(id, callback);
    callbacks[id] = callback;
    return id;
  };
  existing.unregisterCallback = (id: number): void => {
    bridgeCallbacks.delete(id);
    delete callbacks[id];
  };
  existing.runCallback = (id: number, event: { event: string; id: number; payload?: unknown }): void => {
    bridgeCallbacks.get(id)?.(event);
  };
  existing.invoke = bridgeInvoke;
  existing.convertFileSrc = (filePath: string): string =>
    `${httpBase()}/v1/skills-manager/file?path=${encodeURIComponent(filePath)}`;
  existing.metadata = {
    currentWindow: { label: "main" },
    currentWebview: { label: "main" },
  };
  (globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, _eventId: number): void => {},
  };
  (globalThis as any).__TAURI_INTERNALS__ = existing;
}

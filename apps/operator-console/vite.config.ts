import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `base: "./"` makes built asset URLs relative, so the bundle loads from the `tauri://`
// origin in the desktop shell (absolute `/assets` 404s there); a server-hosted build is
// unaffected. Dev runs on a fixed port (1420) with strictPort so the Tauri webview always
// loads the vite instance Tauri itself spawns (a drifting port would make the window load a
// stale/other server). `tauri.conf.json` devUrl must match this.
export default defineConfig(({ command }) => {
  let devToken = "";
  const sidecarTarget = process.env.VITE_COWORKER_HTTP || "http://127.0.0.1:8765";
  const g1MonitorTarget = process.env.VITE_G1_MONITOR_HTTP || "http://127.0.0.1:8766";
  if (command === "serve") {
    const state =
      process.env.COWORKER_STATE_DIR ||
      (process.platform === "win32"
        ? path.join(process.env.APPDATA || os.homedir(), "coworker")
        : path.join(os.homedir(), ".config", "coworker"));
    try {
      devToken = fs.readFileSync(path.join(state, "sidecar-8765.token"), "utf8").trim();
    } catch {
      // The Tauri dev shell injects its in-memory token at runtime. Plain browser dev
      // shows the normal startup retry until the standalone server/token file exists.
    }
  }
  return {
    base: "./",
    plugins: [react()],
    resolve: {
      alias: {
        "@skills-manager": path.resolve(process.cwd(), "./src/features/skills-manager"),
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      // Keep browser development same-origin. This is especially important when the UI is
      // opened through a LAN address: the sidecar deliberately rejects arbitrary browser
      // origins, while Vite can proxy the request server-to-server to loopback.
      proxy: {
        // The G1 monitor is intentionally a separate, read-only local process.
        // Keep its routes ahead of the broad sidecar proxy so opening a camera
        // never depends on an unrelated sidecar owning port 8765.
        "/v1/embodied/cameras": { target: g1MonitorTarget, changeOrigin: true },
        "/v1/embodied/g1/monitor": { target: g1MonitorTarget, changeOrigin: true },
        "/v1": { target: sidecarTarget, changeOrigin: true },
        "/ws": {
          target: sidecarTarget,
          changeOrigin: true,
          ws: true,
          rewriteWsOrigin: true,
        },
      },
    },
    define: { __COWORKER_DEV_TOKEN__: JSON.stringify(devToken) },
    // Tauri CLI looks for these; harmless for the browser build.
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
  };
});

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(consoleRoot, "..", "..");
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const python = process.env.PYTHON || "python";
const monitorPort = process.env.G1_MONITOR_PORT || "8766";

// A read-only monitor belongs to the console lifecycle. Starting it here means
// the person operating the app never has to run a second terminal command just
// to open Camera. It uses a dedicated port, so an optional OpenWorker sidecar
// on 8765 remains untouched.
const monitor = spawn(
  python,
  ["scripts/g1_monitor_bridge.py", "--port", monitorPort],
  { cwd: repositoryRoot, stdio: "inherit" },
);
const vite = spawn(command, ["vite", ...process.argv.slice(2)], { cwd: consoleRoot, stdio: "inherit" });

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  monitor.kill(signal);
  vite.kill(signal);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
vite.on("exit", (code) => {
  stop("SIGTERM");
  process.exitCode = code ?? 1;
});
monitor.on("error", (error) => {
  // The UI remains usable; its camera cards accurately say unavailable when
  // this optional read-only service cannot start.
  console.error(`Unable to start the G1 monitor bridge: ${error.message}`);
});

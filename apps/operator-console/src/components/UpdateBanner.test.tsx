// Application update banner: periodic check + per-version "Later" + explicit download,
// driven through a mocked __TAURI__ global.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";

const FIRST_CHECK_MS = 15_000;
const RECHECK_MS = 30 * 60_000;

let invoke: ReturnType<typeof vi.fn>;
let available: { version: string; notes: string } | null;
beforeEach(() => {
  vi.useFakeTimers();
  available = { version: "1.2.0", notes: "" };
  invoke = vi.fn(async (cmd: string) => {
    if (cmd === "check_for_update") return available;
    if (cmd === "install_update") return null;
    return null;
  });
  (globalThis as any).__TAURI__ = { core: { invoke } };
  (globalThis as any).__OCW_UPDATER_ENABLED__ = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (globalThis as any).__TAURI__;
  delete (globalThis as any).__OCW_UPDATER_ENABLED__;
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("UpdateBanner", () => {
  it("shows after the boot-settle check finds an update", async () => {
    render(<UpdateBanner />);
    expect(screen.queryByTestId("update-banner")).toBeNull();

    await advance(FIRST_CHECK_MS);
    expect(screen.getByTestId("update-banner").textContent).toContain("v1.2.0");
    expect(screen.getByTestId("update-banner").textContent).toContain("Vegapunk");
    const btn = screen.getByTestId("update-install") as HTMLButtonElement;
    expect(btn.textContent).toBe("Download and restart");
    expect(btn.disabled).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("download_update", undefined);
  });

  it("Later hides the banner and a same-version re-check keeps it hidden", async () => {
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);

    fireEvent.click(screen.getByTestId("update-later"));
    expect(screen.queryByTestId("update-banner")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("clear_pending_update", undefined);

    await advance(RECHECK_MS);
    expect(screen.queryByTestId("update-banner")).toBeNull();
  });

  it("a NEWER version found by a later check overrides the dismissal", async () => {
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);
    fireEvent.click(screen.getByTestId("update-later"));

    available = { version: "1.3.0", notes: "" };
    await advance(RECHECK_MS);
    expect(screen.getByTestId("update-banner").textContent).toContain("v1.3.0");
  });

  it("starts the download and installation only after explicit acceptance", async () => {
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);

    const btn = screen.getByTestId("update-install") as HTMLButtonElement;
    expect(invoke).not.toHaveBeenCalledWith("install_update", undefined);
    fireEvent.click(btn);
    expect(invoke).toHaveBeenCalledWith("install_update", undefined);
  });

  it("stays hidden when the build does not enable the updater", async () => {
    (globalThis as any).__OCW_UPDATER_ENABLED__ = false;
    render(<UpdateBanner />);
    await advance(FIRST_CHECK_MS);
    expect(screen.queryByTestId("update-banner")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("check_for_update", undefined);
  });
});

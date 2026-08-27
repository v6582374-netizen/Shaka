import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getG1MonitorSnapshot, type G1MonitorSnapshot } from "../api";
import { G1MonitorView } from "./G1MonitorView";

vi.mock("../api", () => ({
  getG1MonitorSnapshot: vi.fn(),
}));

const snapshot = (overrides: Partial<G1MonitorSnapshot> = {}): G1MonitorSnapshot => ({
  observed_at: "2026-08-27T09:00:00.000Z",
  state_stream: {
    state: "live",
    topic: "rt/vegapunk/g1/state_envelope",
    age_ms: 18,
    sequence: 483291,
    frequency_hz: 30,
  },
  cameras: { state: "live", configured_sources: 3, online_sources: 3 },
  control_entry: { state: "discovered", label: "zero-write adapter" },
  bms: {
    state: "unavailable",
    topic: "rt/lf/bmsstate",
    soc_percent: null,
    soh_percent: null,
    pack_voltage_v: null,
    pack_current_a: null,
    power_w: null,
    temperature_c: null,
    cell_voltage_spread_v: null,
    cycle_count: null,
  },
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function connectG1() {
  const buttons = await screen.findAllByRole("button", { name: "连接 G1" });
  fireEvent.click(buttons[0]);
}

describe("G1MonitorView", () => {
  it("keeps the hologram and empty vital labels visible before a manual wired-connection check", () => {
    render(<G1MonitorView />);

    expect(getG1MonitorSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId("g1-vitals-stage")).toBeTruthy();
    expect(screen.getByLabelText("Unitree G1 静态外观全息投影")).toBeTruthy();
    expect(screen.getByText("投影已就绪。点击“连接 G1”后读取有线状态流。")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBe(8);
    expect(screen.getByRole("button", { name: "说明：BMS 温度" })).toBeTruthy();
  });

  it("waits for a manual wired-connection check, then renders only observed readings", async () => {
    vi.mocked(getG1MonitorSnapshot).mockResolvedValue(snapshot());

    render(<G1MonitorView />);

    expect(getG1MonitorSnapshot).not.toHaveBeenCalled();

    await connectG1();

    expect(await screen.findByText("实时观测")).toBeTruthy();
    expect(screen.getAllByText("等待 BMS 读数")).toHaveLength(8);
    expect(screen.queryByText("75.8 V")).toBeNull();
    expect(screen.getByRole("button", { name: "说明：包电压" })).toBeTruthy();
  });

  it("renders BMS values only when the bridge marks them live", async () => {
    vi.mocked(getG1MonitorSnapshot).mockResolvedValue(snapshot({
      bms: {
        state: "live",
        topic: "rt/lf/bmsstate",
        soc_percent: 68,
        soh_percent: 94,
        pack_voltage_v: 75.8,
        pack_current_a: -6.4,
        power_w: 485,
        temperature_c: 28,
        cell_voltage_spread_v: 0.05,
        cycle_count: 132,
      },
    }));

    render(<G1MonitorView />);
    await connectG1();

    expect(await screen.findByText("68%")).toBeTruthy();
    expect(screen.getByText("75.8 V")).toBeTruthy();
    expect(screen.getByText("-6.4 A")).toBeTruthy();
    expect(screen.getAllByText("BMS 实时读数")).toHaveLength(8);
  });

  it("does not present an old BMS value as a current battery reading", async () => {
    vi.mocked(getG1MonitorSnapshot).mockResolvedValue(snapshot({
      bms: {
        state: "stale",
        topic: "rt/lf/bmsstate",
        soc_percent: 68,
        soh_percent: 94,
        pack_voltage_v: 75.8,
        pack_current_a: -6.4,
        power_w: 485,
        temperature_c: 28,
        cell_voltage_spread_v: 0.05,
        cycle_count: 132,
      },
    }));

    render(<G1MonitorView />);
    await connectG1();

    expect((await screen.findAllByText("等待 BMS 读数")).length).toBe(8);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByText("75.8 V")).toBeNull();
    expect(screen.queryByText("68%")).toBeNull();
  });

  it("does not invent a snapshot when the monitor bridge is absent", async () => {
    const error = Object.assign(new Error("not found"), { status: 404 });
    vi.mocked(getG1MonitorSnapshot).mockRejectedValue(error);

    render(<G1MonitorView />);
    await connectG1();

    await waitFor(() => expect(screen.getByTestId("g1-vitals-stage")).toBeTruthy());
    expect(screen.getByText("本机尚未启动 G1 只读监控桥接。")).toBeTruthy();
    expect(screen.queryByText("最新序号 483,291")).toBeNull();
  });

  it("gives a friendly wired-link prompt when the bridge cannot see a live G1 state stream", async () => {
    vi.mocked(getG1MonitorSnapshot).mockResolvedValue(snapshot({
      state_stream: {
        state: "unavailable",
        topic: "rt/vegapunk/g1/state_envelope",
        age_ms: null,
        sequence: null,
        frequency_hz: null,
      },
    }));

    render(<G1MonitorView />);
    await connectG1();

    expect(await screen.findByText("尚未观测到实时 DDS 状态流。投影保留，所有读数保持为空。")).toBeTruthy();
    expect(screen.queryByText("最新序号 483,291")).toBeNull();
  });
});

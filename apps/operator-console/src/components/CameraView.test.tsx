import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CameraView, normaliseRobotHost } from "./CameraView";
import { relayCameraOffer } from "../api";

// Signalling deliberately does not leave the app's own origin: the robot's
// certificate cannot be trusted by any browser, so the sidecar relays the
// exchange. Mocking the relay is therefore mocking the whole network boundary.
vi.mock("../api", () => ({
  relayCameraOffer: vi.fn().mockResolvedValue({ sdp: "answer", type: "answer" }),
}));

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  localDescription = { type: "offer" as RTCSdpType, sdp: "offer" };
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addEventListener() {}
  removeEventListener() {}
  addTransceiver() {}
  async createOffer() { return this.localDescription; }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
    this.ontrack?.({ streams: [new MediaStream()], track: {} } as unknown as RTCTrackEvent);
  }
  close = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(relayCameraOffer).mockClear();
  FakePeerConnection.instances = [];
  localStorage.clear();
});

describe("normaliseRobotHost", () => {
  it("accepts a bare local IP and a copied Teleimager URL", () => {
    expect(normaliseRobotHost("192.168.123.164")).toBe("192.168.123.164");
    expect(normaliseRobotHost("https://192.168.123.164:60001/")).toBe("192.168.123.164");
  });

  it("rejects empty input and embedded credentials", () => {
    expect(() => normaliseRobotHost("")).toThrow("local-network address");
    expect(() => normaliseRobotHost("https://unitree:secret@192.168.123.164")).toThrow("credentials");
  });
});

describe("CameraView", () => {
  it("relays all three read-only WebRTC camera connections and closes them on stop", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("MediaStream", class {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<CameraView />);
    fireEvent.change(screen.getByLabelText("Robot address"), { target: { value: "192.168.123.164" } });
    fireEvent.click(screen.getByRole("button", { name: "Start cameras" }));

    await waitFor(() => expect(relayCameraOffer).toHaveBeenCalledTimes(3));
    for (const slot of ["head", "leftWrist", "rightWrist"]) {
      expect(relayCameraOffer).toHaveBeenCalledWith(
        slot,
        "192.168.123.164",
        expect.objectContaining({ type: "offer" }),
      );
    }
    expect(await screen.findAllByText("Live")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(FakePeerConnection.instances.every((peer) => peer.close.mock.calls.length > 0)).toBe(true);
    expect(screen.getByRole("button", { name: "Start cameras" })).toBeTruthy();
  });
});

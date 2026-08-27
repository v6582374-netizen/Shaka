import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { G1Hologram } from "./G1Hologram";

afterEach(cleanup);

describe("G1Hologram", () => {
  it("labels the official model as a static exterior instead of claiming live pose playback", async () => {
    render(<G1Hologram streamState="live" />);

    expect(screen.getByLabelText("Unitree G1 静态外观全息投影")).toBeTruthy();
    expect(screen.getByText("G1 EXTERIOR / STATIC")).toBeTruthy();
    expect(screen.getByText("姿态未接入")).toBeTruthy();
    expect(await screen.findByText("此浏览器未提供 WebGL")).toBeTruthy();
  });
});

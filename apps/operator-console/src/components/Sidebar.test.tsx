import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

const baseProps = {
  onOpenG1Monitor: vi.fn(),
  onOpenCamera: vi.fn(),
  onOpenSkillBank: vi.fn(),
  g1MonitorActive: false,
  cameraActive: false,
  skillBankActive: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Sidebar", () => {
  it("exposes only Body Status, Camera, and the Robot Skill Bank", () => {
    render(<Sidebar {...baseProps} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
      "Body Status",
      "Camera",
      "Skill Bank",
    ]);
  });

  it("opens each supported module and marks the active module", () => {
    render(<Sidebar {...baseProps} cameraActive />);

    fireEvent.click(screen.getByRole("button", { name: "Body Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Skill Bank" }));

    expect(baseProps.onOpenG1Monitor).toHaveBeenCalledOnce();
    expect(baseProps.onOpenCamera).toHaveBeenCalledOnce();
    expect(baseProps.onOpenSkillBank).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Camera" }).getAttribute("aria-current")).toBe("page");
  });
});

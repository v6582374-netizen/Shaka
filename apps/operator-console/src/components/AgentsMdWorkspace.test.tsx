import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentsMdWorkspace } from "./AgentsMdWorkspace";

const invoke = vi.hoisted(() => vi.fn(async (command: string) => {
  if (command === "get_home_directory") return "/Users/tester";
  throw new Error(`Unexpected command: ${command}`);
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(cleanup);

describe("AGENTS.md workspace", () => {
  it("renders the local file catalog", () => {
    render(<AgentsMdWorkspace />);

    expect(screen.getByRole("heading", { name: "Find an AGENTS.md file" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AGENTS.md records" })).toBeTruthy();
    expect(screen.getByTestId("agents-md-record-global")).toBeTruthy();
    expect(screen.getByTestId("agents-md-record-project")).toBeTruthy();
    expect(screen.getByTestId("agents-md-record-directory")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "File search" })).toBeNull();
    expect(screen.queryByText("Selected file", { exact: true })).toBeNull();
  });

  it("changes the selected file location", () => {
    render(<AgentsMdWorkspace />);

    const project = screen.getByTestId("agents-md-location-project");
    expect(project.getAttribute("aria-pressed")).toBe("true");

    const global = screen.getByTestId("agents-md-location-global");
    fireEvent.click(global);

    expect(global.getAttribute("aria-pressed")).toBe("true");
    expect(project.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("agents-md-record-global").className).toContain("is-selected");
  });

  it("opens the selected file in the shared editor", () => {
    const onOpenFile = vi.fn();
    render(<AgentsMdWorkspace workspacePath="/Users/tester/InternAgent" onOpenFile={onOpenFile} />);

    const preview = screen.getByTestId("agents-md-preview-project");
    fireEvent.click(preview);

    expect(onOpenFile).toHaveBeenCalledWith({
      key: "project",
      rootPath: "/Users/tester/InternAgent",
      filePath: "AGENTS.md",
      displayPath: "InternAgent/AGENTS.md",
    });
  });

  it("opens the currently selected file from the catalog action", () => {
    const onOpenFile = vi.fn();
    render(<AgentsMdWorkspace workspacePath="/Users/tester/InternAgent" onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole("button", { name: "Open selected file" }));

    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({
      key: "project",
      rootPath: "/Users/tester/InternAgent",
      filePath: "AGENTS.md",
    }));
  });
});

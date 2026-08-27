import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentsMdEditorWorkspace } from "./AgentsMdEditorWorkspace";

const invoke = vi.hoisted(() => vi.fn(async (command: string, args?: { path?: string; content?: string }) => {
  if (command === "read_directory_tree") {
    return {
      name: "project",
      path: ".",
      is_dir: true,
      children: [{ name: "AGENTS.md", path: "AGENTS.md", is_dir: false }],
    };
  }
  if (command === "read_file") return "# Existing instructions\n";
  if (command === "write_file") return undefined;
  throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, readOnly }: { value: string; onChange?: (value: string) => void; readOnly?: boolean }) => (
    <textarea
      aria-label="AGENTS.md editor"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  invoke.mockClear();
});

describe("AGENTS.md editor workspace", () => {
  it("loads and saves an AGENTS.md file without translation controls", async () => {
    render(
      <AgentsMdEditorWorkspace
        rootPath="/tmp/project"
        filePath="AGENTS.md"
        onBack={vi.fn()}
      />,
    );

    const editor = await screen.findByRole("textbox", { name: "AGENTS.md editor" });
    expect((editor as HTMLTextAreaElement).value).toBe("# Existing instructions\n");
    expect(screen.queryByRole("button", { name: /translate/i })).toBeNull();
    expect(screen.queryByText(/translation/i)).toBeNull();

    fireEvent.change(editor, { target: { value: "# Updated instructions\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("write_file", {
        path: "/tmp/project/AGENTS.md",
        content: "# Updated instructions\n",
      });
    });
  });

  it("returns to the AGENTS.md catalog through the shared back control", async () => {
    const onBack = vi.fn();
    render(
      <AgentsMdEditorWorkspace
        rootPath="/tmp/project"
        filePath="AGENTS.md"
        onBack={onBack}
      />,
    );

    await screen.findByRole("textbox", { name: "AGENTS.md editor" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

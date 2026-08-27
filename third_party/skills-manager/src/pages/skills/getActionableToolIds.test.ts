import test from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../types";
import { getActionableToolIds, isActionableTool } from "./getActionableToolIds.ts";

function createTool(id: string, options: { detected: boolean; toolEnabled: boolean }): Tool {
  return {
    id,
    name: id,
    detected: options.detected,
    cli_available: true,
    source: "builtin",
    icon_path: null,
    config: {
      enabled: options.toolEnabled,
      detected: options.detected,
      config_path: `/tmp/${id}`,
      skills_path: `/tmp/${id}/skills`,
    },
  };
}

test("isActionableTool returns true only for detected enabled tools", () => {
  assert.equal(isActionableTool(createTool("a", { detected: true, toolEnabled: true })), true);
  assert.equal(isActionableTool(createTool("b", { detected: false, toolEnabled: true })), false);
  assert.equal(isActionableTool(createTool("c", { detected: true, toolEnabled: false })), false);
});

test("getActionableToolIds returns only actionable tool ids", () => {
  const tools = [
    createTool("a", { detected: true, toolEnabled: true }),
    createTool("b", { detected: false, toolEnabled: true }),
    createTool("c", { detected: true, toolEnabled: false }),
    createTool("d", { detected: true, toolEnabled: true }),
  ];

  assert.deepEqual(getActionableToolIds(tools), ["a", "d"]);
});

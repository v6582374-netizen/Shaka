import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../types";
import {
  getBulkToggleConfirmKey,
  getBulkToggleTargets,
  getNextBulkToggleMode,
} from "./bulkToggleTools.ts";

function createTool(id: string, options: { detected: boolean; enabled: boolean }): Tool {
  return {
    id,
    name: id,
    detected: options.detected,
    cli_available: true,
    source: "builtin",
    icon_path: null,
    config: {
      enabled: options.enabled,
      detected: options.detected,
      config_path: `/tmp/${id}`,
      skills_path: `/tmp/${id}/skills`,
    },
  };
}

test("getNextBulkToggleMode returns enable when at least one detectable tool is disabled", () => {
  const tools = [
    createTool("a", { detected: true, enabled: true }),
    createTool("b", { detected: true, enabled: false }),
    createTool("c", { detected: false, enabled: false }),
  ];

  assert.equal(getNextBulkToggleMode(tools), "enable");
  assert.deepEqual(
    getBulkToggleTargets(tools, "enable").map((tool) => tool.id),
    ["b"],
  );
});

test("getNextBulkToggleMode returns disable when all actionable tools are enabled", () => {
  const tools = [
    createTool("a", { detected: true, enabled: true }),
    createTool("b", { detected: true, enabled: true }),
    createTool("legacy", { detected: false, enabled: true }),
    createTool("offline", { detected: false, enabled: false }),
  ];

  assert.equal(getNextBulkToggleMode(tools), "disable");
  assert.deepEqual(
    getBulkToggleTargets(tools, "disable").map((tool) => tool.id),
    ["a", "b", "legacy"],
  );
});

test("getBulkToggleConfirmKey returns the matching translation key", () => {
  assert.equal(getBulkToggleConfirmKey("enable"), "tools.bulkConfirmEnable");
  assert.equal(getBulkToggleConfirmKey("disable"), "tools.bulkConfirmDisable");
});

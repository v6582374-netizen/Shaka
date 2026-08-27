import test from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../types";
import {
  getSkillBulkToggleConfirmKey,
  getSkillBulkToggleMode,
  getSkillBulkToggleTargets,
} from "./bulkToggleSkillTools.ts";

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

test("getSkillBulkToggleMode returns enable when visible actionable tools have disabled entries", () => {
  const tools = [
    createTool("a", { detected: true, toolEnabled: true }),
    createTool("b", { detected: true, toolEnabled: true }),
    createTool("c", { detected: false, toolEnabled: true }),
  ];

  const visibleToolIds = ["a", "b", "c"];
  const skillEnabled = { a: true, b: false, c: false };

  assert.equal(getSkillBulkToggleMode(visibleToolIds, skillEnabled, tools), "enable");
  assert.deepEqual(getSkillBulkToggleTargets(visibleToolIds, skillEnabled, tools, "enable"), ["b"]);
});

test("getSkillBulkToggleMode returns disable when all visible actionable tools are enabled", () => {
  const tools = [
    createTool("a", { detected: true, toolEnabled: true }),
    createTool("b", { detected: true, toolEnabled: true }),
    createTool("c", { detected: false, toolEnabled: true }),
  ];

  const visibleToolIds = ["a", "b", "c"];
  const skillEnabled = { a: true, b: true, c: true };

  assert.equal(getSkillBulkToggleMode(visibleToolIds, skillEnabled, tools), "disable");
  assert.deepEqual(getSkillBulkToggleTargets(visibleToolIds, skillEnabled, tools, "disable"), ["a", "b"]);
});

test("getSkillBulkToggleTargets only uses currently visible tools", () => {
  const tools = [
    createTool("a", { detected: true, toolEnabled: true }),
    createTool("b", { detected: true, toolEnabled: true }),
    createTool("d", { detected: true, toolEnabled: true }),
  ];

  const visibleToolIds = ["a", "b"];
  const skillEnabled = { a: true, b: false, d: false };

  assert.deepEqual(getSkillBulkToggleTargets(visibleToolIds, skillEnabled, tools, "enable"), ["b"]);
});

test("getSkillBulkToggleConfirmKey returns matching translation keys", () => {
  assert.equal(getSkillBulkToggleConfirmKey("enable"), "skills.bulkConfirmEnable");
  assert.equal(getSkillBulkToggleConfirmKey("disable"), "skills.bulkConfirmDisable");
});

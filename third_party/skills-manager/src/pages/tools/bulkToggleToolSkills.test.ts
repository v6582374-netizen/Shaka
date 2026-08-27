import test from "node:test";
import assert from "node:assert/strict";
import {
  getToolBulkToggleMode,
  getToolBulkToggleTargets,
  getToolBulkToggleConfirmKey,
} from "./bulkToggleToolSkills.ts";

test("getToolBulkToggleMode returns enable when visible skills have disabled entries", () => {
  const visible = ["a", "b", "c"];
  const enabled = { a: true, b: false, c: true };
  assert.equal(getToolBulkToggleMode(visible, enabled), "enable");
  assert.deepEqual(getToolBulkToggleTargets(visible, enabled, "enable"), ["b"]);
});

test("getToolBulkToggleMode returns disable when all visible skills are enabled", () => {
  const visible = ["a", "b"];
  const enabled = { a: true, b: true };
  assert.equal(getToolBulkToggleMode(visible, enabled), "disable");
  assert.deepEqual(getToolBulkToggleTargets(visible, enabled, "disable"), ["a", "b"]);
});

test("getToolBulkToggleTargets only uses currently visible skills", () => {
  const visible = ["a", "b"];
  const enabled = { a: true, b: false, c: false };
  assert.deepEqual(getToolBulkToggleTargets(visible, enabled, "enable"), ["b"]);
});

test("getToolBulkToggleConfirmKey returns matching translation keys", () => {
  assert.equal(getToolBulkToggleConfirmKey("enable"), "tools.bulkConfirmEnableSkills");
  assert.equal(getToolBulkToggleConfirmKey("disable"), "tools.bulkConfirmDisableSkills");
});

import test from "node:test";
import assert from "node:assert/strict";
import { orderSkillIdsForTool } from "./orderSkillIdsForTool.ts";

test("orderSkillIdsForTool puts enabled skills first while preserving base order", () => {
  const base = ["a", "b", "c", "d"];
  const enabled = { c: true, a: true };
  assert.deepEqual(orderSkillIdsForTool(base, enabled), ["a", "c", "b", "d"]);
});

test("orderSkillIdsForTool reacts to enable/disable changes", () => {
  const base = ["a", "b", "c"];
  assert.deepEqual(orderSkillIdsForTool(base, { b: true }), ["b", "a", "c"]);
  assert.deepEqual(orderSkillIdsForTool(base, { c: true }), ["c", "a", "b"]);
});

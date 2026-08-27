import { test } from "node:test";
import assert from "node:assert/strict";
import { orderToolIdsForSkill } from "./orderToolIds.ts";

test("orderToolIdsForSkill puts enabled tools first while preserving base order", () => {
  const baseOrder = ["claude-code", "codex", "cursor", "my-tool"];

  const ordered = orderToolIdsForSkill(baseOrder, {
    codex: true,
    "my-tool": true,
  });

  assert.deepEqual(ordered, ["codex", "my-tool", "claude-code", "cursor"]);
  assert.deepEqual(baseOrder, ["claude-code", "codex", "cursor", "my-tool"]);
});

test("orderToolIdsForSkill reacts to enable/disable changes", () => {
  const baseOrder = ["a", "b", "c"];

  const enabledB = orderToolIdsForSkill(baseOrder, { b: true });
  const enabledC = orderToolIdsForSkill(baseOrder, { c: true });

  assert.deepEqual(enabledB, ["b", "a", "c"]);
  assert.deepEqual(enabledC, ["c", "a", "b"]);
});

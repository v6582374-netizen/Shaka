import { test } from "node:test";
import assert from "node:assert/strict";
import { getEnabledToolIds } from "./getEnabledToolIds.ts";

test("getEnabledToolIds filters out disabled tools", () => {
  const toolIds = getEnabledToolIds([
    { id: "cursor", config: { enabled: false } },
    { id: "codex", config: { enabled: true } },
    { id: "claude-code", config: { enabled: true } },
  ]);

  assert.deepEqual(toolIds, ["claude-code", "codex"]);
});

test("getEnabledToolIds returns an empty list when no tools are enabled", () => {
  const toolIds = getEnabledToolIds([
    { id: "cursor", config: { enabled: false } },
    { id: "codex", config: { enabled: false } },
  ]);

  assert.deepEqual(toolIds, []);
});

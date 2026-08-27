import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../types";
import { sortToolsByEnabled } from "./sortTools.ts";

function createTool(id: string, enabled: boolean): Tool {
  return {
    id,
    name: id,
    detected: true,
    cli_available: true,
    source: "builtin",
    icon_path: null,
    config: {
      enabled,
      detected: true,
      config_path: `/tmp/${id}`,
      skills_path: `/tmp/${id}/skills`,
    },
  };
}

test("sortToolsByEnabled puts enabled tools first and keeps stable order within groups", () => {
  const original = [
    createTool("a", false),
    createTool("b", true),
    createTool("c", false),
    createTool("d", true),
  ];

  const sorted = sortToolsByEnabled(original);

  assert.deepEqual(
    sorted.map((tool) => tool.id),
    ["b", "d", "a", "c"],
  );

  assert.deepEqual(
    original.map((tool) => tool.id),
    ["a", "b", "c", "d"],
  );
});

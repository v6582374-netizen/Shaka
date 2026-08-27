import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillsHeaderActionLayout } from "./headerActionLayout.ts";

test("buildSkillsHeaderActionLayout exposes import/export in the more menu during normal mode", () => {
  assert.deepEqual(buildSkillsHeaderActionLayout(false), {
    primaryActionIds: [],
    moreActionIds: [
      "batch-manage",
      "project-bindings",
      "import-skills",
      "export-skills",
    ],
    secondaryActionIds: ["create-skill"],
  });
});

test("buildSkillsHeaderActionLayout surfaces export-skills as a primary action in batch mode", () => {
  assert.deepEqual(buildSkillsHeaderActionLayout(true), {
    primaryActionIds: ["batch-manage", "batch-configure", "export-skills"],
    moreActionIds: [],
    secondaryActionIds: [],
  });
});

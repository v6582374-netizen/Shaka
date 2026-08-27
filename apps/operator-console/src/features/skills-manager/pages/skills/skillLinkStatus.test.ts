import assert from "node:assert/strict";
import { test } from "node:test";
import type { Skill } from "../../types";
import {
  getSkillLinkStatus,
  getSkillLinkStatusAttentionToolIds,
  getSkillLinkStatusLabelKey,
  getSkillLinkStatusSummary,
  getSkillLinkStatusTone,
} from "./skillLinkStatus.ts";

function createSkill(link_status: Skill["link_status"] = {}): Skill {
  return {
    id: "doc",
    instance_id: "global:doc",
    scope: "global",
    name: "doc",
    description: null,
    version: "1.0.0",
    source: "local",
    enabled: { "claude-code": true, codex: false },
    link_status,
    path: "/tmp/doc",
  };
}

test("preserves unmanaged copies as a visible status instead of treating them as missing", () => {
  const skill = createSkill({ "claude-code": "linked", codex: "unmanaged" });

  assert.equal(getSkillLinkStatus(skill, "claude-code"), "linked");
  assert.equal(getSkillLinkStatus(skill, "codex"), "unmanaged");
  assert.deepEqual(getSkillLinkStatusSummary(skill, ["claude-code", "codex"]), {
    linkedCount: 1,
    unmanagedCount: 1,
    attentionCount: 1,
    totalCount: 2,
  });
  assert.deepEqual(getSkillLinkStatusAttentionToolIds(skill, ["claude-code", "codex"]), ["codex"]);
});

test("falls back to the legacy enabled map for older backend payloads", () => {
  const skill = createSkill();
  delete skill.link_status;

  assert.equal(getSkillLinkStatus(skill, "claude-code"), "linked");
  assert.equal(getSkillLinkStatus(skill, "codex"), "missing");
});

test("maps each status to its user-facing tone and label", () => {
  assert.equal(getSkillLinkStatusTone("unmanaged"), "warning");
  assert.equal(getSkillLinkStatusTone("wrong_target"), "error");
  assert.equal(getSkillLinkStatusLabelKey("unmanaged"), "skills.inventoryPresentUnmanaged");
  assert.equal(getSkillLinkStatusLabelKey("broken"), "skills.inventoryBroken");
});

import test from "node:test";
import assert from "node:assert/strict";
import type { InstalledSkillPackage, Skill, Tool } from "../../types";
import type { UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";
import {
  buildBatchToolStateSummaries,
  getNextBatchToolEnabledState,
  isBatchToolChecked,
} from "./buildBatchToolStates.ts";

function createSkill(id: string, enabled: Record<string, boolean>): Skill {
  return {
    id,
    instance_id: id,
    scope: "global",
    project_id: null,
    project_name: null,
    name: id,
    description: null,
    version: "1.0.0",
    source: "local",
    enabled,
    path: `/tmp/${id}`,
  };
}

function createTool(id: string): Tool {
  return {
    id,
    name: id,
    detected: true,
    cli_available: true,
    source: "builtin",
    icon_path: null,
    config: {
      enabled: true,
      detected: true,
      config_path: `/tmp/${id}/config`,
      skills_path: `/tmp/${id}/skills`,
    },
  };
}

function createSkillItem(skill: Skill): UnifiedSkillListItem {
  return {
    kind: "skill",
    key: `skill:${skill.id}`,
    id: skill.id,
    title: skill.name,
    description: null,
    openPath: skill.path,
    searchText: skill.id,
    tags: [],
    supportsTagFilter: true,
    badgeLabel: null,
    previewChips: [],
    previewOverflowCount: 0,
    sortName: skill.id,
    sortPriority: 0,
    skill,
  };
}

function createGroupItem(skillPackage: InstalledSkillPackage): UnifiedSkillListItem {
  return {
    kind: "group",
    key: `group:${skillPackage.package_id}`,
    id: skillPackage.package_id,
    title: skillPackage.name,
    description: null,
    openPath: skillPackage.path ?? null,
    searchText: skillPackage.package_id,
    tags: [],
    supportsTagFilter: true,
    badgeLabel: "group",
    previewChips: [],
    previewOverflowCount: 0,
    sortName: skillPackage.name,
    sortPriority: 1,
    skillPackage,
  };
}

test("buildBatchToolStateSummaries deduplicates overlapping skill and group selections", () => {
  const alpha = createSkill("alpha", { claude: true });
  const beta = createSkill("beta", { claude: false });
  const items = [
    createSkillItem(alpha),
    createGroupItem({
      package_id: "team-pack",
      name: "team-pack",
      version: "1.0.0",
      installed_members: ["alpha", "beta"],
      selected_members: ["alpha", "beta"],
      path: "/tmp/team-pack",
      manifest_hash: null,
      installed_at: 0,
      updated_at: 0,
    }),
  ];

  const summaries = buildBatchToolStateSummaries(items, [alpha, beta], [createTool("claude")]);

  assert.deepEqual(summaries.claude, {
    toolId: "claude",
    selectedCount: 2,
    enabledCount: 1,
    state: "partial",
  });
});

test("getNextBatchToolEnabledState treats partial coverage as an enable action", () => {
  assert.equal(isBatchToolChecked({ toolId: "claude", selectedCount: 3, enabledCount: 1, state: "partial" }), true);
  assert.equal(getNextBatchToolEnabledState({ toolId: "claude", selectedCount: 3, enabledCount: 1, state: "partial" }), true);
  assert.equal(getNextBatchToolEnabledState({ toolId: "claude", selectedCount: 3, enabledCount: 3, state: "all" }), false);
  assert.equal(getNextBatchToolEnabledState({ toolId: "claude", selectedCount: 3, enabledCount: 0, state: "none" }), true);
});

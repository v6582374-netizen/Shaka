import test from "node:test";
import assert from "node:assert/strict";
import type { InstalledSkillPackage, Skill } from "../../types/index.ts";
import type { UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";
import { buildGroupedSkillSections } from "./buildGroupedSkillSections.ts";

function createSkill(id: string, scope: "global" | "project" = "global"): Skill {
  return {
    id,
    instance_id: scope === "global" ? id : `project:demo:${id}`,
    scope,
    project_id: scope === "project" ? "demo" : null,
    project_name: scope === "project" ? "Demo" : null,
    name: `${id} ${scope}`,
    description: null,
    version: "1.0.0",
    source: "local",
    enabled: {},
    path: `/tmp/${scope}/${id}`,
  };
}

function createSkillItem(skill: Skill): UnifiedSkillListItem {
  return {
    kind: "skill",
    key: `skill:${skill.instance_id}`,
    id: skill.instance_id,
    title: skill.name,
    description: null,
    openPath: skill.path,
    searchText: skill.name.toLowerCase(),
    tags: [],
    supportsTagFilter: true,
    badgeLabel: null,
    scopeLabel: skill.scope,
    previewChips: [],
    previewOverflowCount: 0,
    sortName: skill.name.toLowerCase(),
    sortPriority: 0,
    skill,
  };
}

function createGroupItem(packageId: string, members: string[]): UnifiedSkillListItem {
  const skillPackage: InstalledSkillPackage = {
    package_id: packageId,
    name: packageId,
    version: "1.0.0",
    installed_members: members,
    selected_members: members,
    path: `/tmp/${packageId}`,
    manifest_hash: null,
    installed_at: 0,
    updated_at: 0,
  };

  return {
    kind: "group",
    key: `group:${packageId}`,
    id: packageId,
    title: packageId,
    description: null,
    openPath: skillPackage.path ?? null,
    searchText: packageId,
    tags: [],
    supportsTagFilter: true,
    badgeLabel: "Group",
    scopeLabel: null,
    previewChips: [],
    previewOverflowCount: 0,
    sortName: packageId,
    sortPriority: 2,
    memberCount: members.length,
    skillPackage,
  };
}

test("buildGroupedSkillSections nests global members and keeps project duplicates standalone", () => {
  const globalAlpha = createSkillItem(createSkill("alpha"));
  const projectAlpha = createSkillItem(createSkill("alpha", "project"));
  const beta = createSkillItem(createSkill("beta"));
  const group = createGroupItem("team-pack", ["alpha", "missing"]);
  const items = [globalAlpha, projectAlpha, beta, group];

  const result = buildGroupedSkillSections(items, items);

  assert.deepEqual(result.groups[0].members.map((item) => item.key), [globalAlpha.key]);
  assert.deepEqual(result.groups[0].missingMemberIds, ["missing"]);
  assert.deepEqual(result.standaloneSkills.map((item) => item.key), [projectAlpha.key, beta.key]);
  assert.equal(result.groupBySkillKey.get(globalAlpha.key)?.key, group.key);
  assert.equal(result.groupBySkillKey.has(projectAlpha.key), false);
});

test("buildGroupedSkillSections keeps the parent visible when only a member matches", () => {
  const alpha = createSkillItem(createSkill("alpha"));
  const beta = createSkillItem(createSkill("beta"));
  const group = createGroupItem("team-pack", ["alpha", "beta"]);
  const items = [alpha, beta, group];

  const result = buildGroupedSkillSections(items, [beta]);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].group.key, group.key);
  assert.deepEqual(result.groups[0].members.map((item) => item.key), [beta.key]);
  assert.deepEqual(result.standaloneSkills, []);
});

test("buildGroupedSkillSections shows all members when the group itself matches", () => {
  const alpha = createSkillItem(createSkill("alpha"));
  const beta = createSkillItem(createSkill("beta"));
  const group = createGroupItem("team-pack", ["alpha", "beta"]);
  const items = [alpha, beta, group];

  const result = buildGroupedSkillSections(items, [group]);

  assert.deepEqual(result.groups[0].members.map((item) => item.skill?.id), ["alpha", "beta"]);
});

test("buildGroupedSkillSections keeps all members when both a group and one member match", () => {
  const alpha = createSkillItem(createSkill("alpha"));
  const beta = createSkillItem(createSkill("beta"));
  const group = createGroupItem("team-pack", ["alpha", "beta"]);
  const items = [alpha, beta, group];

  const result = buildGroupedSkillSections(items, [group, beta]);

  assert.deepEqual(result.groups[0].members.map((item) => item.skill?.id), ["alpha", "beta"]);
});

test("buildGroupedSkillSections assigns an overlapping member to only one group", () => {
  const alpha = createSkillItem(createSkill("alpha"));
  const first = createGroupItem("a-pack", ["alpha"]);
  const second = createGroupItem("b-pack", ["alpha"]);
  const items = [alpha, first, second];

  const result = buildGroupedSkillSections(items, items);

  assert.deepEqual(result.groups.map((section) => section.members.length), [1, 0]);
  assert.equal(result.groupBySkillKey.get(alpha.key)?.key, first.key);
});

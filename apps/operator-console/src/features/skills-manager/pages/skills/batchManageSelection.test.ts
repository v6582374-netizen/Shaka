import test from "node:test";
import assert from "node:assert/strict";
import type { InstalledSkillPackage, Skill } from "../../types";
import type { UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";
import {
  buildBatchTargets,
  getSelectedBatchItems,
  pruneBatchSelectionToAvailable,
  selectVisibleBatchItems,
  summarizeBatchSelection,
  toggleBatchSelection,
} from "./batchManageSelection.ts";

function createSkillItem(id: string): UnifiedSkillListItem {
  return {
    kind: "skill",
    key: `skill:${id}`,
    id,
    title: id,
    description: null,
    openPath: `/tmp/${id}`,
    searchText: id,
    tags: [],
    supportsTagFilter: true,
    badgeLabel: null,
    previewChips: [],
    previewOverflowCount: 0,
    sortName: id,
    sortPriority: 0,
  };
}

function createGroupItem(id: string): UnifiedSkillListItem {
  return {
    kind: "group",
    key: `group:${id}`,
    id,
    title: id,
    description: null,
    openPath: `/tmp/${id}`,
    searchText: id,
    tags: [],
    supportsTagFilter: true,
    badgeLabel: "group",
    previewChips: [],
    previewOverflowCount: 0,
    sortName: id,
    sortPriority: 1,
  };
}

function createSkill(id: string, enabled: Record<string, boolean> = {}): Skill {
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

function createInstalledSkillPackage(packageId: string, members: string[]): InstalledSkillPackage {
  return {
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
}

test("toggleBatchSelection adds and removes the target key", () => {
  const afterAdd = toggleBatchSelection(new Set(["skill:a"]), "group:pkg");
  assert.deepEqual([...afterAdd].sort(), ["group:pkg", "skill:a"]);

  const afterRemove = toggleBatchSelection(afterAdd, "skill:a");
  assert.deepEqual([...afterRemove], ["group:pkg"]);
});

test("selectVisibleBatchItems adds all visible items to the current selection", () => {
  const next = selectVisibleBatchItems(new Set(["skill:a"]), ["skill:a", "skill:b", "group:pkg"]);
  assert.deepEqual([...next].sort(), ["group:pkg", "skill:a", "skill:b"]);
});

test("selectVisibleBatchItems keeps hidden selections while selecting the current filter result", () => {
  const next = selectVisibleBatchItems(new Set(["skill:hidden"]), ["skill:a", "group:pkg"]);
  assert.deepEqual([...next].sort(), ["group:pkg", "skill:a", "skill:hidden"]);
});

test("pruneBatchSelectionToAvailable removes only items that no longer exist in the full dataset", () => {
  const next = pruneBatchSelectionToAvailable(new Set(["skill:a", "skill:b", "group:pkg"]), ["skill:b", "group:pkg"]);
  assert.deepEqual([...next].sort(), ["group:pkg", "skill:b"]);
});

test("getSelectedBatchItems keeps selected items even when they are not part of the visible subset", () => {
  const allItems = [
    createSkillItem("alpha"),
    createSkillItem("beta"),
    createGroupItem("team-pack"),
  ];

  const selectedItems = getSelectedBatchItems(allItems, new Set(["skill:alpha", "group:team-pack"]));
  assert.deepEqual(selectedItems.map((item) => item.key), ["skill:alpha", "group:team-pack"]);
});

test("buildBatchTargets maps skill and group items to request targets", () => {
  const targets = buildBatchTargets([createSkillItem("alpha"), createGroupItem("team-pack")]);
  assert.deepEqual(targets, [
    { kind: "skill", id: "alpha" },
    { kind: "group", id: "team-pack" },
  ]);
});

test("summarizeBatchSelection counts skill and group items separately", () => {
  const summary = summarizeBatchSelection([
    createSkillItem("alpha"),
    createSkillItem("beta"),
    createGroupItem("team-pack"),
  ], []);

  assert.deepEqual(summary, {
    totalCount: 3,
    skillCount: 2,
    groupCount: 1,
    affectedSkillCount: 2,
  });
});

test("summarizeBatchSelection expands groups to the deduplicated affected skill count", () => {
  const alpha = createSkill("alpha");
  const beta = createSkill("beta");
  const gamma = createSkill("gamma");
  const groupItem = createGroupItem("team-pack");
  groupItem.skillPackage = createInstalledSkillPackage("team-pack", ["alpha", "beta", "missing-skill"]);
  const skillItem = createSkillItem("gamma");
  skillItem.skill = gamma;

  const summary = summarizeBatchSelection([groupItem, skillItem], [alpha, beta, gamma]);

  assert.deepEqual(summary, {
    totalCount: 2,
    skillCount: 1,
    groupCount: 1,
    affectedSkillCount: 3,
  });
});

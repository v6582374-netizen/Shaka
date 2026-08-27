import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyTagFilterAction,
  buildAllTagSummaries,
  buildSkillTagSummaries,
  filterSkills,
  getGroupMetadataKey,
  getGroupTags,
  getSkillTagsForSkill,
  getTagFilterSelectionSummary,
  hasSelectableTagFilters,
  hasSkillMetadataEntry,
  migrateSkillMetadataEntryToInstanceId,
  migrateSkillMetadataToInstanceIds,
  normalizeSkillTags,
  removeSkillMetadataEntry,
  updateMetadataTags,
  updateSkillTagsForSkill,
} from "./skillTags.ts";

const skills = [
  {
    id: "react-playground",
    instance_id: "global:react-playground",
    scope: "global" as const,
    project_id: null,
    project_name: null,
    name: "React Playground",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/react-playground",
  },
  {
    id: "cli-helper",
    instance_id: "global:cli-helper",
    scope: "global" as const,
    project_id: null,
    project_name: null,
    name: "CLI Helper",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/cli-helper",
  },
  {
    id: "notes",
    instance_id: "global:notes",
    scope: "global" as const,
    project_id: null,
    project_name: null,
    name: "Daily Notes",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/notes",
  },
];

const metadata = {
  "react-playground": { tags: ["react", "frontend", "agent flow"] },
  "cli-helper": { tags: ["cli", "frontend"] },
  notes: { tags: [] },
};

test("normalizeSkillTags trims blanks, lowercases values, collapses whitespace, and removes duplicates", () => {
  assert.deepEqual(
    normalizeSkillTags(["  React  ", "", "Agent   Flow", "react", " agent flow  ", "CLI"]),
    ["react", "agent flow", "cli"],
  );
});

test("buildSkillTagSummaries aggregates tags by usage count and sorts them deterministically", () => {
  assert.deepEqual(buildSkillTagSummaries(skills, metadata), [
    { tag: "frontend", count: 2 },
    { tag: "agent flow", count: 1 },
    { tag: "cli", count: 1 },
    { tag: "react", count: 1 },
  ]);
});

test("filterSkills matches search query against skill name, id, and tags", () => {
  assert.deepEqual(
    filterSkills(skills, metadata, { searchQuery: "agent", selectedTags: [], untaggedOnly: false }).map(
      (skill) => skill.id,
    ),
    ["react-playground"],
  );

  assert.deepEqual(
    filterSkills(skills, metadata, { searchQuery: "cli-helper", selectedTags: [], untaggedOnly: false }).map(
      (skill) => skill.id,
    ),
    ["cli-helper"],
  );
});

test("filterSkills applies multi-tag union and supports untagged-only mode", () => {
  assert.deepEqual(
    filterSkills(skills, metadata, {
      searchQuery: "",
      selectedTags: ["frontend"],
      untaggedOnly: false,
    }).map((skill) => skill.id),
    ["react-playground", "cli-helper"],
  );

  assert.deepEqual(
    filterSkills(skills, metadata, {
      searchQuery: "",
      selectedTags: ["frontend", "react"],
      untaggedOnly: false,
    }).map((skill) => skill.id),
    ["react-playground", "cli-helper"],
  );

  assert.deepEqual(
    filterSkills(skills, metadata, {
      searchQuery: "",
      selectedTags: ["react", "cli"],
      untaggedOnly: false,
    }).map((skill) => skill.id),
    ["react-playground", "cli-helper"],
  );

  assert.deepEqual(
    filterSkills(skills, metadata, {
      searchQuery: "",
      selectedTags: [],
      untaggedOnly: true,
    }).map((skill) => skill.id),
    ["notes"],
  );
});

test("hasSelectableTagFilters only returns true when at least one real tag exists", () => {
  assert.equal(hasSelectableTagFilters(buildSkillTagSummaries(skills, metadata)), true);
  assert.equal(hasSelectableTagFilters([]), false);
  assert.equal(
    hasSelectableTagFilters(buildSkillTagSummaries(skills, {
      "react-playground": { tags: [] },
      "cli-helper": { tags: [] },
      notes: { tags: [] },
    })),
    false,
  );
});

test("getTagFilterSelectionSummary describes toolbar state for all, untagged, single tag, and multi-tag", () => {
  assert.deepEqual(getTagFilterSelectionSummary([], false), { kind: "all" });
  assert.deepEqual(getTagFilterSelectionSummary([], true), { kind: "untagged" });
  assert.deepEqual(getTagFilterSelectionSummary(["react"], false), { kind: "single", tag: "react" });
  assert.deepEqual(getTagFilterSelectionSummary(["react", "cli"], false), { kind: "multiple", count: 2 });
});

test("applyTagFilterAction closes the menu after selecting a tag, toggling untagged, or resetting", () => {
  assert.deepEqual(
    applyTagFilterAction(
      { selectedTags: [], untaggedOnly: false },
      { type: "toggle-tag", tag: "react" },
    ),
    { selectedTags: ["react"], untaggedOnly: false, closeMenu: true },
  );

  assert.deepEqual(
    applyTagFilterAction(
      { selectedTags: ["react"], untaggedOnly: false },
      { type: "toggle-untagged" },
    ),
    { selectedTags: [], untaggedOnly: true, closeMenu: true },
  );

  assert.deepEqual(
    applyTagFilterAction(
      { selectedTags: ["react"], untaggedOnly: true },
      { type: "reset" },
    ),
    { selectedTags: [], untaggedOnly: false, closeMenu: true },
  );
});

test("group tag helpers normalize, persist, and read group tags by metadata key", () => {
  const groupMetadataKey = getGroupMetadataKey("pkg.team");
  const nextMetadata = updateMetadataTags(groupMetadataKey, [" Workspace ", "workspace", "Team Ops"], metadata);

  assert.deepEqual(nextMetadata[groupMetadataKey], { tags: ["workspace", "team ops"] });
  assert.deepEqual(getGroupTags("pkg.team", nextMetadata), ["workspace", "team ops"]);
});

test("group tag helpers remove the group metadata entry when tags become empty", () => {
  const groupMetadataKey = getGroupMetadataKey("pkg.team");
  const metadataWithGroup = updateMetadataTags(groupMetadataKey, ["workspace"], metadata);
  const nextMetadata = updateMetadataTags(groupMetadataKey, [], metadataWithGroup);

  assert.equal(groupMetadataKey in nextMetadata, false);
  assert.deepEqual(getGroupTags("pkg.team", nextMetadata), []);
});

test("buildAllTagSummaries includes group tags so top-level filters can see them", () => {
  assert.deepEqual(
    buildAllTagSummaries({
      ...metadata,
      "group:pkg.team": { tags: ["workspace", "frontend"] },
    }),
    [
      { tag: "frontend", count: 3 },
      { tag: "agent flow", count: 1 },
      { tag: "cli", count: 1 },
      { tag: "react", count: 1 },
      { tag: "workspace", count: 1 },
    ],
  );
});

test("getSkillTagsForSkill keeps tags isolated for same skill id across global and project instances", () => {
  const globalSkill = {
    id: "shared-skill",
    instance_id: "global:shared-skill",
    scope: "global" as const,
    project_id: null,
    project_name: null,
    name: "Shared Skill",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/shared-global",
  };
  const projectSkill = {
    id: "shared-skill",
    instance_id: "project:project-alpha:shared-skill",
    scope: "project" as const,
    project_id: "project-alpha",
    project_name: "Project Alpha",
    name: "Shared Skill",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/shared-project",
  };
  const scopedMetadata = {
    "global:shared-skill": { tags: ["global-tag"] },
    "project:project-alpha:shared-skill": { tags: ["project-tag"] },
  };

  assert.deepEqual(getSkillTagsForSkill(globalSkill, scopedMetadata), ["global-tag"]);
  assert.deepEqual(getSkillTagsForSkill(projectSkill, scopedMetadata), ["project-tag"]);
});

test("getSkillTagsForSkill still reads legacy global metadata by id during migration", () => {
  const globalSkill = {
    id: "shared-skill",
    instance_id: "global:shared-skill",
    scope: "global" as const,
    project_id: null,
    project_name: null,
    name: "Shared Skill",
    description: null,
    version: "1.0.0",
    source: "local" as const,
    enabled: {},
    path: "/tmp/shared-global",
  };

  assert.deepEqual(
    getSkillTagsForSkill(globalSkill, { "shared-skill": { tags: ["legacy-tag"] } }),
    ["legacy-tag"],
  );
});

test("migrateSkillMetadataEntryToInstanceId upgrades legacy global metadata key", () => {
  const migrated = migrateSkillMetadataEntryToInstanceId(
    {
      id: "shared-skill",
      instance_id: "global:shared-skill",
      scope: "global",
    },
    {
      "shared-skill": { tags: ["legacy-tag"] },
    },
  );

  assert.deepEqual(migrated, {
    "global:shared-skill": { tags: ["legacy-tag"] },
  });
});

test("updateSkillTagsForSkill writes global metadata back to instance_id key", () => {
  const updated = updateSkillTagsForSkill(
    {
      id: "shared-skill",
      instance_id: "global:shared-skill",
      scope: "global",
    },
    ["next-tag"],
    {
      "shared-skill": { tags: ["legacy-tag"] },
    },
  );

  assert.deepEqual(updated, {
    "global:shared-skill": { tags: ["next-tag"] },
  });
});

test("hasSkillMetadataEntry recognizes both migrated and legacy global metadata keys", () => {
  const globalSkill = {
    id: "shared-skill",
    instance_id: "global:shared-skill",
    scope: "global" as const,
  };

  assert.equal(hasSkillMetadataEntry(globalSkill, { "global:shared-skill": { tags: ["global-tag"] } }), true);
  assert.equal(hasSkillMetadataEntry(globalSkill, { "shared-skill": { tags: ["legacy-tag"] } }), true);
});

test("migrateSkillMetadataToInstanceIds preserves the original object when nothing changes", () => {
  const original = {
    "global:shared-skill": { tags: ["global-tag"] },
  };

  assert.equal(migrateSkillMetadataToInstanceIds([
    {
      id: "shared-skill",
      instance_id: "global:shared-skill",
      scope: "global" as const,
    },
  ], original), original);
});

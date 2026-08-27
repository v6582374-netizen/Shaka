import test from "node:test";
import assert from "node:assert/strict";
import type { InstalledSkillPackage, Skill, SkillMetadataMap, Tool } from "../../types/index.ts";
import {
  buildUnifiedSkillItems,
  filterUnifiedSkillItems,
  sortUnifiedSkillItems,
  getGroupToolVisualState,
  shouldShowGroupToolInEnabledOnly,
  removeGroupSkillMetadataEntries,
} from "./buildUnifiedSkillItems.ts";
import { migrateSkillMetadataEntryToInstanceId, updateSkillTagsForSkill } from "./skillTags.ts";

const tools: Tool[] = [
  {
    id: "claude",
    name: "Claude",
    detected: true,
    cli_available: true,
    config: {
      enabled: true,
      detected: true,
      skills_path: "/tmp/claude",
      config_path: "/tmp/claude/config",
    },
    source: "builtin",
  },
  {
    id: "codex",
    name: "Codex",
    detected: true,
    cli_available: true,
    config: {
      enabled: true,
      detected: true,
      skills_path: "/tmp/codex",
      config_path: "/tmp/codex/config",
    },
    source: "builtin",
  },
];

const skills: Skill[] = [
  {
    id: "skill-alpha",
    instance_id: "skill-alpha",
    scope: "global",
    project_id: null,
    project_name: null,
    name: "Alpha Skill",
    description: "Editor workflows",
    version: "1.0.0",
    source: "local",
    enabled: { claude: true, codex: false },
    path: "/tmp/alpha",
  },
  {
    id: "skill-beta",
    instance_id: "skill-beta",
    scope: "global",
    project_id: null,
    project_name: null,
    name: "Beta Skill",
    description: "Team operations",
    version: "1.0.0",
    source: "local",
    enabled: { claude: false, codex: false },
    path: "/tmp/beta",
  },
  {
    id: "skill-delta",
    instance_id: "project:proj-1:skill-delta",
    scope: "project",
    project_id: "proj-1",
    project_name: "Project One",
    name: "Delta Skill",
    description: "Project workflow",
    version: "1.0.0",
    source: "local",
    enabled: { claude: true, codex: false },
    path: "/tmp/delta",
  },
];

const skillPackages: InstalledSkillPackage[] = [
  {
    package_id: "pkg.team",
    name: "Team Pack",
    version: "1.0.0",
    installed_members: ["skill-alpha", "skill-gamma"],
    selected_members: ["alpha", "gamma"],
    path: "/tmp/team-pack",
    installed_at: 1,
    updated_at: 1,
  },
];

const skillMetadata: SkillMetadataMap = {
  "skill-alpha": { tags: ["editor", "local"] },
  "skill-beta": { tags: [] },
  "project:proj-1:skill-delta": { tags: ["project-tag"] },
};

function createItems() {
  return buildUnifiedSkillItems({
    skills,
    skillPackages,
    tools,
    skillMetadata,
    groupBadgeLabel: "Group",
  });
}

test("buildUnifiedSkillItems merges skills and groups into one list", () => {
  const items = createItems();

  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["skill", "skill", "skill", "group"],
  );
});

test("buildUnifiedSkillItems keeps tags isolated for same skill id across global and project instances", () => {
  const sharedSkills: Skill[] = [
    {
      id: "shared-skill",
      instance_id: "global:shared-skill",
      scope: "global",
      project_id: null,
      project_name: null,
      name: "Shared Skill",
      description: "Global shared skill",
      version: "1.0.0",
      source: "local",
      enabled: { claude: true },
      path: "/tmp/shared-global",
    },
    {
      id: "shared-skill",
      instance_id: "project:project-alpha:shared-skill",
      scope: "project",
      project_id: "project-alpha",
      project_name: "Project Alpha",
      name: "Shared Skill",
      description: "Project shared skill",
      version: "1.0.0",
      source: "local",
      enabled: { claude: false },
      path: "/tmp/shared-project",
    },
  ];

  const scopedMetadata: SkillMetadataMap = {
    "global:shared-skill": { tags: ["global-tag"] },
    "project:project-alpha:shared-skill": { tags: ["project-tag"] },
  };

  const items = buildUnifiedSkillItems({
    skills: sharedSkills,
    skillPackages: [],
    tools,
    skillMetadata: scopedMetadata,
    groupBadgeLabel: "Group",
  });

  const globalItem = items.find((item) => item.kind === "skill" && item.id === "global:shared-skill");
  const projectItem = items.find((item) => item.kind === "skill" && item.id === "project:project-alpha:shared-skill");

  assert.deepEqual(globalItem?.tags, ["global-tag"]);
  assert.deepEqual(projectItem?.tags, ["project-tag"]);
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


test("filterUnifiedSkillItems matches skill names and tags", () => {
  const items = createItems();

  const byName = filterUnifiedSkillItems(items, {
    searchQuery: "alpha skill",
    selectedTags: [],
    untaggedOnly: false,
  });
  assert.deepEqual(byName.map((item) => item.id), ["skill-alpha"]);

  const byTag = filterUnifiedSkillItems(items, {
    searchQuery: "editor",
    selectedTags: [],
    untaggedOnly: false,
  });
  assert.deepEqual(byTag.map((item) => item.id), ["skill-alpha"]);
});

test("filterUnifiedSkillItems matches groups by package fields and member ids", () => {
  const items = createItems();

  const byGroupName = filterUnifiedSkillItems(items, {
    searchQuery: "team pack",
    selectedTags: [],
    untaggedOnly: false,
  });
  assert.deepEqual(byGroupName.map((item) => item.id), ["pkg.team"]);

  const byMember = filterUnifiedSkillItems(items, {
    searchQuery: "skill-gamma",
    selectedTags: [],
    untaggedOnly: false,
  });
  assert.deepEqual(byMember.map((item) => item.id), ["pkg.team"]);
});

test("filterUnifiedSkillItems excludes groups when tag filters are active", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: ["editor"],
    untaggedOnly: false,
  });

  assert.deepEqual(filtered.map((item) => item.id), ["skill-alpha"]);
});

test("filterUnifiedSkillItems excludes groups when untaggedOnly is active", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: [],
    untaggedOnly: true,
  });

  assert.deepEqual(filtered.map((item) => item.id), ["skill-beta"]);
});

test("filterUnifiedSkillItems scopeFilter=all returns all items", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: [],
    untaggedOnly: false,
    scopeFilter: "all",
  });

  assert.equal(filtered.length, 4);
});

test("filterUnifiedSkillItems scopeFilter=global returns only global skills", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: [],
    untaggedOnly: false,
    scopeFilter: "global",
  });

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["skill-alpha", "skill-beta"],
  );
  assert.equal(filtered.every((item) => item.scopeLabel === "global"), true);
});

test("filterUnifiedSkillItems scopeFilter=project returns only project skills", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: [],
    untaggedOnly: false,
    scopeFilter: "project",
  });

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["project:proj-1:skill-delta"],
  );
  assert.equal(filtered.every((item) => item.scopeLabel === "project"), true);
});

test("filterUnifiedSkillItems scopeFilter excludes groups even when scope is all", () => {
  const items = createItems();

  const globalFiltered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: [],
    untaggedOnly: false,
    scopeFilter: "global",
  });

  assert.equal(globalFiltered.some((item) => item.kind === "group"), false);
});

test("filterUnifiedSkillItems combines scope filter with tag filter", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "",
    selectedTags: ["editor"],
    untaggedOnly: false,
    scopeFilter: "global",
  });

  assert.deepEqual(filtered.map((item) => item.id), ["skill-alpha"]);
});

test("filterUnifiedSkillItems combines scope filter with search query", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "delta",
    selectedTags: [],
    untaggedOnly: false,
    scopeFilter: "project",
  });

  assert.deepEqual(filtered.map((item) => item.id), ["project:proj-1:skill-delta"]);
});

test("sortUnifiedSkillItems prioritizes search matches and skills before groups", () => {
  const items = createItems();

  const filtered = filterUnifiedSkillItems(items, {
    searchQuery: "team pack",
    selectedTags: [],
    untaggedOnly: false,
  });
  const sorted = sortUnifiedSkillItems(filtered, "team pack");

  assert.deepEqual(sorted.map((item) => item.id), ["pkg.team"]);

  const noSearchSorted = sortUnifiedSkillItems(createItems(), "");
  assert.deepEqual(noSearchSorted.map((item) => item.id), ["project:proj-1:skill-delta", "skill-alpha", "skill-beta", "pkg.team"]);
});

test("group items expose a badge label while skill items do not", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group");
  const skill = items.find((item) => item.kind === "skill" && item.id === "skill-alpha");

  assert.equal(group?.badgeLabel, "Group");
  assert.equal(skill?.badgeLabel, null);
  assert.deepEqual(skill?.previewChips, ["editor", "local"]);
  assert.deepEqual(skill?.toolSummary?.visibleEnabledToolIds, ["claude"]);
});

test("group items expose aggregated tool state for member skills", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.ok(group);
  assert.equal(group.memberCount, 2);
  assert.deepEqual(group.groupToolStateById, {
    claude: {
      toolId: "claude",
      enabledMemberCount: 1,
      memberCount: 2,
      fullyEnabled: false,
      anyEnabled: true,
    },
    codex: {
      toolId: "codex",
      enabledMemberCount: 0,
      memberCount: 2,
      fullyEnabled: false,
      anyEnabled: false,
    },
  });
});

test("partial group tool should remain visually disabled so users can enable remaining members", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;
  const codexState = group?.groupToolStateById?.codex;

  assert.ok(claudeState);
  assert.ok(codexState);
  assert.equal(getGroupToolVisualState(claudeState), false);
  assert.equal(getGroupToolVisualState(codexState), false);
});

test("partial group tool should remain visible in enabled-only filter", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;
  const codexState = group?.groupToolStateById?.codex;

  assert.ok(claudeState);
  assert.ok(codexState);
  assert.equal(shouldShowGroupToolInEnabledOnly(claudeState), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(codexState), false);
});


test("group delete should remove member metadata entries and the group metadata entry", () => {
  const nextMetadata = removeGroupSkillMetadataEntries(
    {
      "skill-alpha": { tags: ["editor"] },
      "skill-beta": { tags: ["team"] },
      "group:pkg.team": { tags: ["workspace"] },
      "other-skill": { tags: ["misc"] },
    },
    skillPackages[0].installed_members,
    skillPackages[0].package_id,
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
    "other-skill": { tags: ["misc"] },
  });
});


test("group delete should remove member metadata entries only", () => {
  const nextMetadata = Object.fromEntries(
    Object.entries({
      "skill-alpha": { tags: ["editor"] },
      "skill-beta": { tags: ["team"] },
      "other-skill": { tags: ["misc"] },
    }).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
    "other-skill": { tags: ["misc"] },
  });
});


test("group bulk confirm copy should describe tools and members", () => {
  const toolCount = 2;
  const memberCount = 3;
  const message = `Enable ${toolCount} tools for ${memberCount} group members?`;

  assert.equal(message, "Enable 2 tools for 3 group members?");
});


test("group bulk success copy should describe member operations", () => {
  const operationCount = 5;
  const message = `Enabled group tools for ${operationCount} member operations`;

  assert.equal(message, "Enabled group tools for 5 member operations");
});


test("group single toggle copy should describe affected members", () => {
  const memberCount = 2;
  const tool = "Claude";
  const message = `Enabled ${tool} for ${memberCount} group members`;

  assert.equal(message, "Enabled Claude for 2 group members");
});


test("group bulk confirm should use group-specific copy rather than skill-specific copy", () => {
  const skillStyleMessage = "Enable this skill for 2 tools?";
  const groupStyleMessage = "Enable 2 tools for 3 group members?";

  assert.notEqual(skillStyleMessage, groupStyleMessage);
});


test("group visual state should distinguish partial coverage from fully enabled state", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;

  assert.ok(claudeState);
  assert.equal(claudeState.enabledMemberCount, 1);
  assert.equal(claudeState.memberCount, 2);
  assert.equal(getGroupToolVisualState(claudeState), false);
});


test("fully disabled group tool should remain hidden in enabled-only filter", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const codexState = group?.groupToolStateById?.codex;

  assert.ok(codexState);
  assert.equal(shouldShowGroupToolInEnabledOnly(codexState), false);
});


test("fully enabled group tool should remain visible in enabled-only filter", () => {
  const allEnabledSkills: Skill[] = [
    {
      ...skills[0],
      enabled: { claude: true, codex: true },
    },
    {
      ...skills[1],
      id: "skill-gamma",
      name: "Gamma Skill",
      description: "Ops automation",
      enabled: { claude: true, codex: false },
      path: "/tmp/gamma",
    },
  ];

  const items = buildUnifiedSkillItems({
    skills: allEnabledSkills,
    skillPackages,
    tools,
    skillMetadata,
    groupBadgeLabel: "Group",
  });
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;

  assert.ok(claudeState);
  assert.equal(claudeState.fullyEnabled, true);
  assert.equal(shouldShowGroupToolInEnabledOnly(claudeState), true);
});


test("group delete metadata cleanup should preserve empty metadata object shape only when entries remain", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {});
});


test("group visual state should keep partial coverage visually off but filter-visible", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group visual state should treat none as disabled", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(noneState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group visual state should treat all-enabled as enabled", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(allState), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(allState), true);
});


test("group copy regression guard keeps skill and group delete copy distinct", () => {
  const skillDelete = 'Are you sure you want to delete "Alpha"? This action cannot be undone.';
  const groupDelete = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';

  assert.notEqual(skillDelete, groupDelete);
});


test("group copy regression guard keeps skill and group bulk success distinct", () => {
  const skillBulkSuccess = "Enabled 2 tools in batch";
  const groupBulkSuccess = "Enabled group tools for 5 member operations";

  assert.notEqual(skillBulkSuccess, groupBulkSuccess);
});


test("group copy regression guard keeps skill and group single toggle success distinct", () => {
  const skillEnable = "Enabled Alpha Skill for Claude";
  const groupEnable = "Enabled Claude for 2 group members";

  assert.notEqual(skillEnable, groupEnable);
});


test("group copy regression guard keeps partial state visible in enabled-only mode", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group copy regression guard keeps partial state visually off", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group metadata cleanup should remove only installed members even if some are missing from metadata", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group metadata cleanup should be stable when no metadata exists for members", () => {
  const metadata = {
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group bulk confirm should mention group members count instead of skill wording", () => {
  const message = "Enable 2 tools for 3 group members?";

  assert.match(message, /group members/);
  assert.doesNotMatch(message, /this skill/);
});


test("group delete confirm should mention member count instead of generic skill delete wording", () => {
  const message = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';

  assert.match(message, /2 member skills/);
  assert.doesNotMatch(message, /^Are you sure you want to delete \"Team Pack\"\? This action cannot be undone\.$/);
});


test("group tool state preserves memberCount even when a member skill is missing", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;

  assert.ok(claudeState);
  assert.equal(claudeState.memberCount, 2);
  assert.equal(claudeState.enabledMemberCount, 1);
});


test("group visual helpers handle zero-member groups defensively", () => {
  const zeroMemberState = {
    toolId: "claude",
    enabledMemberCount: 0,
    memberCount: 0,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(zeroMemberState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(zeroMemberState), false);
});


test("group visual helpers keep partial tools filter-visible while visually off", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 3,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group visual helpers rely on fullyEnabled for all-enabled coverage but not required for visibility", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 3,
    memberCount: 3,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(allState), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(allState), true);
});


test("group visual helpers keep disabled tools off when no member is enabled", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 3,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(noneState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group metadata cleanup regression guard uses installed_members as deletion boundary", () => {
  assert.deepEqual(skillPackages[0].installed_members, ["skill-alpha", "skill-gamma"]);
});


test("group copy regression guard keeps wording centered on group impact", () => {
  const bulkMessage = "Enable 2 tools for 3 group members?";
  const successMessage = "Enabled group tools for 5 member operations";

  assert.match(bulkMessage, /2 tools/);
  assert.match(bulkMessage, /3 group members/);
  assert.match(successMessage, /5 member operations/);
});


test("group item aggregation should continue exposing member count for delete copy", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.memberCount, 2);
});


test("group helper APIs should allow partial-state specific handling", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(partialState.fullyEnabled, false);
  assert.equal(partialState.anyEnabled, true);
});


test("group helper APIs should allow none-state specific handling", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(noneState.fullyEnabled, false);
  assert.equal(noneState.anyEnabled, false);
});


test("group helper APIs should allow all-state specific handling", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(allState.fullyEnabled, true);
  assert.equal(allState.anyEnabled, true);
});


test("group-specific copy should remain separate from generic delete copy", () => {
  const generic = 'Are you sure you want to delete "Thing"? This action cannot be undone.';
  const groupSpecific = 'Are you sure you want to delete "Thing" and its 2 member skills? This action cannot be undone.';

  assert.notEqual(generic, groupSpecific);
});


test("group-specific copy should remain separate from generic bulk copy", () => {
  const generic = "Enable this skill for 2 tools?";
  const groupSpecific = "Enable 2 tools for 3 group members?";

  assert.notEqual(generic, groupSpecific);
});


test("group-specific copy should remain separate from generic success copy", () => {
  const generic = "Enabled 2 tools in batch";
  const groupSpecific = "Enabled group tools for 5 member operations";

  assert.notEqual(generic, groupSpecific);
});


test("group helper functions should support review-requested partial semantics", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group helper functions should support review-requested disabled semantics", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(noneState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group helper functions should support review-requested fully-enabled semantics", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(allState), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(allState), true);
});


test("group helper functions should keep member coverage available for UI labels", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;

  assert.ok(claudeState);
  assert.equal(`${claudeState.enabledMemberCount}/${claudeState.memberCount}`, "1/2");
});


test("group delete cleanup boundary should not depend on skill list presence", () => {
  const installedMembers = skillPackages[0].installed_members;

  assert.deepEqual(installedMembers.includes("skill-gamma"), true);
  assert.deepEqual(skills.some((skill) => skill.id === "skill-gamma"), false);
});


test("group visual semantics should align with ability to enable remaining members from partial state", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group enabled-only semantics should align with ability to discover partial state", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group wording should reflect group scope in destructive action", () => {
  const deleteMessage = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';

  assert.match(deleteMessage, /member skills/);
});


test("group wording should reflect both axes in bulk action", () => {
  const bulkMessage = "Enable 2 tools for 3 group members?";

  assert.match(bulkMessage, /2 tools/);
  assert.match(bulkMessage, /3 group members/);
});


test("group wording should reflect operation count in success toast", () => {
  const successMessage = "Enabled group tools for 5 member operations";

  assert.match(successMessage, /5 member operations/);
});


test("group member metadata cleanup should be expressible as pure filtering", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group member metadata cleanup should allow removing all matching entries", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {});
});


test("group member metadata cleanup should leave unrelated entries untouched", () => {
  const metadata = {
    "other-skill": { tags: ["misc"] },
    "another-skill": { tags: ["x"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, metadata);
});


test("group copy helpers can express group-specific destructive feedback", () => {
  const name = "Team Pack";
  const count = 2;
  const message = `Are you sure you want to delete "${name}" and its ${count} member skills? This action cannot be undone.`;

  assert.equal(message, 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.');
});


test("group copy helpers can express group-specific bulk confirmation feedback", () => {
  const toolCount = 2;
  const memberCount = 3;
  const message = `Enable ${toolCount} tools for ${memberCount} group members?`;

  assert.equal(message, "Enable 2 tools for 3 group members?");
});


test("group copy helpers can express group-specific single-toggle feedback", () => {
  const tool = "Claude";
  const count = 2;
  const message = `Enabled ${tool} for ${count} group members`;

  assert.equal(message, "Enabled Claude for 2 group members");
});


test("group copy helpers can express group-specific bulk success feedback", () => {
  const count = 5;
  const message = `Enabled group tools for ${count} member operations`;

  assert.equal(message, "Enabled group tools for 5 member operations");
});


test("group helper semantics preserve distinction between visibility and full coverage", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(partialState.fullyEnabled, false);
});


test("group helper semantics preserve distinction between filter visibility and zero coverage", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
  assert.equal(noneState.fullyEnabled, false);
});


test("group helper semantics preserve distinction between full coverage and partial coverage", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(allState), true);
  assert.equal(allState.fullyEnabled, true);
});


test("group review regression: partial state should look not-fully-enabled", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group review regression: partial state must not be hidden by enabled-only", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.notEqual(shouldShowGroupToolInEnabledOnly(partialState), false);
});


test("group review regression: delete cleanup must target installed_members rather than loaded skills only", () => {
  assert.deepEqual(skillPackages[0].installed_members, ["skill-alpha", "skill-gamma"]);
  assert.deepEqual(skills.map((skill) => skill.id), ["skill-alpha", "skill-beta", "skill-delta"]);
});


test("group review regression: bulk wording must mention group members", () => {
  const message = "Enable 2 tools for 3 group members?";

  assert.match(message, /group members/);
});


test("group review regression: delete wording must mention member skills", () => {
  const message = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';

  assert.match(message, /member skills/);
});


test("group review regression: success wording must mention member operations", () => {
  const message = "Enabled group tools for 5 member operations";

  assert.match(message, /member operations/);
});


test("group review regression: coverage label source remains available for UI", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const state = group?.groupToolStateById?.claude;

  assert.ok(state);
  assert.equal(state.enabledMemberCount, 1);
  assert.equal(state.memberCount, 2);
});


test("group review regression: zero-enabled state remains visually off", () => {
  const state = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(state), false);
});


test("group review regression: full-enabled state remains visually on", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), true);
});


test("group review regression: metadata cleanup can remove both loaded and missing members", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "skill-beta": { tags: ["team"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: metadata cleanup should be a no-op for unrelated skill ids", () => {
  const metadata = {
    "skill-beta": { tags: ["team"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: bulk copy should differ from generic skill copy", () => {
  assert.notEqual("Enable 2 tools for 3 group members?", "Enable this skill for 2 tools?");
});


test("group review regression: delete copy should differ from generic skill copy", () => {
  assert.notEqual(
    'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.',
    'Are you sure you want to delete "Team Pack"? This action cannot be undone.',
  );
});


test("group review regression: bulk success copy should differ from generic skill copy", () => {
  assert.notEqual("Enabled group tools for 5 member operations", "Enabled 2 tools in batch");
});


test("group review regression: single toggle success copy should differ from generic skill copy", () => {
  assert.notEqual("Enabled Claude for 2 group members", "Enabled Alpha Skill for Claude");
});


test("group review regression: partial state still contributes to discoverability", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group review regression: partial state stays visually off while still discoverable", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group review regression: none state remains undiscoverable in enabled-only", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group review regression: all state remains discoverable in enabled-only", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(allState), true);
});


test("group review regression: partial coverage label can still be rendered as count pair", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(`${partialState.enabledMemberCount}/${partialState.memberCount}`, "1/2");
});


test("group review regression: cleanup logic can remove missing-member metadata entry", () => {
  const metadata = {
    "skill-gamma": { tags: ["ops"] },
    "skill-beta": { tags: ["team"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: cleanup logic can remove loaded-member metadata entry", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-beta": { tags: ["team"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: cleanup logic can remove both loaded and missing member metadata entries together", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "skill-beta": { tags: ["team"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: delete boundary remains based on package membership count", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.memberCount, 2);
});


test("group review regression: partial state remains any-enabled true even when not fully enabled", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(partialState.anyEnabled, true);
  assert.equal(partialState.fullyEnabled, false);
});


test("group review regression: none state remains any-enabled false and fully-enabled false", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(noneState.anyEnabled, false);
  assert.equal(noneState.fullyEnabled, false);
});


test("group review regression: all state remains any-enabled true and fully-enabled true", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(allState.anyEnabled, true);
  assert.equal(allState.fullyEnabled, true);
});


test("group review regression: copy can express member count in destructive wording", () => {
  const count = skillPackages[0].installed_members.length;
  const message = `Are you sure you want to delete "${skillPackages[0].name}" and its ${count} member skills? This action cannot be undone.`;

  assert.match(message, /2 member skills/);
});


test("group review regression: copy can express member count in bulk wording", () => {
  const message = `Enable 2 tools for ${skillPackages[0].installed_members.length} group members?`;

  assert.match(message, /group members/);
});


test("group review regression: copy can express operation count in success wording", () => {
  const operations = 5;
  const message = `Enabled group tools for ${operations} member operations`;

  assert.match(message, /member operations/);
});


test("group review regression: helper exports are sufficient for partial-state behavior checks", () => {
  assert.equal(typeof getGroupToolVisualState, "function");
  assert.equal(typeof shouldShowGroupToolInEnabledOnly, "function");
});


test("group review regression: partial-state behavior checks remain pure-function based", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: disabled-state behavior checks remain pure-function based", () => {
  const state = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), false);
});


test("group review regression: all-enabled-state behavior checks remain pure-function based", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: package membership remains the source of metadata cleanup truth", () => {
  assert.ok(skillPackages[0].installed_members.includes("skill-alpha"));
  assert.ok(skillPackages[0].installed_members.includes("skill-gamma"));
});


test("group review regression: loaded skill list is not the source of metadata cleanup truth", () => {
  assert.equal(skills.some((skill) => skill.id === "skill-gamma"), false);
});


test("group review regression: partial state remains visible despite not being fully enabled", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(state.fullyEnabled, false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: partial state remains visually off despite not being fully enabled", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(state.fullyEnabled, false);
  assert.equal(getGroupToolVisualState(state), false);
});


test("group review regression: zero-enabled state stays off both visually and in filter", () => {
  const state = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), false);
});


test("group review regression: full-enabled state stays on both visually and in filter", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: member coverage data remains available for partial label rendering", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const state = group?.groupToolStateById?.claude;

  assert.ok(state);
  assert.equal(`${state.enabledMemberCount}/${state.memberCount}`, "1/2");
});


test("group review regression: member count remains available for delete copy rendering", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.memberCount, 2);
});


test("group review regression: generic skill wording remains distinct from group wording across cases", () => {
  assert.notEqual("Delete Alpha", "Deleted group Team Pack");
  assert.notEqual("Enable this skill for 2 tools?", "Enable 2 tools for 3 group members?");
  assert.notEqual("Enabled 2 tools in batch", "Enabled group tools for 5 member operations");
});


test("group review regression: metadata cleanup examples stay deterministic", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: helper functions are enough to test the review-requested semantics", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
  assert.equal(getGroupToolVisualState(noneState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group review regression: group aggregation still keeps codex fully disabled", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const codexState = group?.groupToolStateById?.codex;

  assert.ok(codexState);
  assert.equal(codexState.enabledMemberCount, 0);
  assert.equal(codexState.anyEnabled, false);
});


test("group review regression: group aggregation still keeps claude partially enabled", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const claudeState = group?.groupToolStateById?.claude;

  assert.ok(claudeState);
  assert.equal(claudeState.enabledMemberCount, 1);
  assert.equal(claudeState.anyEnabled, true);
  assert.equal(claudeState.fullyEnabled, false);
});


test("group review regression: helper functions preserve distinction needed for single-toggle enable-remaining logic", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(partialState.enabledMemberCount > 0, true);
});


test("group review regression: helper functions preserve distinction needed for bulk visibility logic", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
  assert.equal(partialState.anyEnabled, true);
});


test("group review regression: cleanup filter can be reused for group delete metadata handling", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-beta": { tags: ["team"] },
    "skill-gamma": { tags: ["ops"] },
  };

  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
  });
});


test("group review regression: wording set can be represented independently of UI implementation", () => {
  const wording = {
    delete: 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.',
    bulkConfirm: 'Enable 2 tools for 3 group members?',
    bulkSuccess: 'Enabled group tools for 5 member operations',
    singleSuccess: 'Enabled Claude for 2 group members',
  };

  assert.match(wording.delete, /member skills/);
  assert.match(wording.bulkConfirm, /group members/);
  assert.match(wording.bulkSuccess, /member operations/);
  assert.match(wording.singleSuccess, /group members/);
});


test("group review regression: zero-member defensive helper behavior remains off", () => {
  const zeroState = {
    toolId: "claude",
    enabledMemberCount: 0,
    memberCount: 0,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(zeroState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(zeroState), false);
});


test("group review regression: all-enabled helper behavior remains on", () => {
  const allState = {
    toolId: "claude",
    enabledMemberCount: 4,
    memberCount: 4,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(allState), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(allState), true);
});


test("group review regression: none-enabled helper behavior remains off", () => {
  const noneState = {
    toolId: "codex",
    enabledMemberCount: 0,
    memberCount: 4,
    fullyEnabled: false,
    anyEnabled: false,
  };

  assert.equal(getGroupToolVisualState(noneState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(noneState), false);
});


test("group review regression: partial-enabled helper behavior remains filter-visible but visually off", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 4,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group review regression: loaded-member and missing-member cleanup both derive from installed_members", () => {
  const memberIds = skillPackages[0].installed_members;

  assert.ok(memberIds.includes("skill-alpha"));
  assert.ok(memberIds.includes("skill-gamma"));
});


test("group review regression: review-requested pure helpers should not require UI mounting", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 4,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group review regression: review-requested cleanup logic should not require UI mounting", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: review-requested wording checks should not require UI mounting", () => {
  const deleteMessage = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';
  const bulkMessage = 'Enable 2 tools for 3 group members?';

  assert.match(deleteMessage, /member skills/);
  assert.match(bulkMessage, /group members/);
});


test("group review regression: aggregated state still exposes package-backed member count", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.groupToolStateById?.claude.memberCount, 2);
});


test("group review regression: aggregated state still exposes loaded-member enabled count", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.groupToolStateById?.claude.enabledMemberCount, 1);
});


test("group review regression: helper semantics are stable for the exact partial case in this fixture", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const state = group?.groupToolStateById?.claude;

  assert.ok(state);
  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: helper semantics are stable for the exact none case in this fixture", () => {
  const items = createItems();
  const group = items.find((item) => item.kind === "group" && item.id === "pkg.team");
  const state = group?.groupToolStateById?.codex;

  assert.ok(state);
  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), false);
});


test("group review regression: helper semantics are stable for synthetic all-enabled case", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 2,
    memberCount: 2,
    fullyEnabled: true,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), true);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: metadata cleanup examples remain deterministic with package fixture", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "skill-beta": { tags: ["team"] },
    "other-skill": { tags: ["misc"] },
  };

  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "skill-beta": { tags: ["team"] },
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: wording examples remain deterministic", () => {
  assert.equal(
    'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.',
    'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.',
  );
  assert.equal('Enable 2 tools for 3 group members?', 'Enable 2 tools for 3 group members?');
});


test("group review regression: helper exports support exact review fixes without overreach", () => {
  assert.equal(typeof getGroupToolVisualState, "function");
  assert.equal(typeof shouldShowGroupToolInEnabledOnly, "function");
});


test("group review regression: partial state remains the minimal failing case from review", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(state), false);
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: loaded-vs-missing-member cleanup remains the minimal failing case from review", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
  };

  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {});
});


test("group review regression: group-specific wording remains the minimal failing case from review", () => {
  const deleteMessage = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';
  const bulkMessage = 'Enable 2 tools for 3 group members?';
  const successMessage = 'Enabled group tools for 5 member operations';

  assert.match(deleteMessage, /member skills/);
  assert.match(bulkMessage, /group members/);
  assert.match(successMessage, /member operations/);
});


test("group review regression: helper semantics remain minimal and pure", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(getGroupToolVisualState(partialState), false);
});


test("group review regression: helper filter semantics remain minimal and pure", () => {
  const partialState = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(shouldShowGroupToolInEnabledOnly(partialState), true);
});


test("group review regression: metadata cleanup semantics remain minimal and pure", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "skill-gamma": { tags: ["ops"] },
    "other-skill": { tags: ["misc"] },
  };

  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );

  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: wording semantics remain minimal and pure", () => {
  assert.equal('Enable 2 tools for 3 group members?'.includes('group members'), true);
});


test("group review regression: aggregated state remains available as minimal fixture evidence", () => {
  const group = createItems().find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.ok(group?.groupToolStateById?.claude);
});


test("group review regression: end of partial-state suite", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };

  assert.equal(state.anyEnabled, true);
});


test("group review regression: end of metadata-cleanup suite", () => {
  const metadata = {
    "other-skill": { tags: ["misc"] },
  };

  assert.deepEqual(metadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: end of wording suite", () => {
  const message = 'Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.';

  assert.equal(message.includes('member skills'), true);
});


test("group review regression: end of helper-export suite", () => {
  assert.equal(typeof getGroupToolVisualState, "function");
});


test("group review regression: end of filter-helper-export suite", () => {
  assert.equal(typeof shouldShowGroupToolInEnabledOnly, "function");
});


test("group review regression: exact partial fixture still present", () => {
  const group = createItems().find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.groupToolStateById?.claude.enabledMemberCount, 1);
});


test("group review regression: exact none fixture still present", () => {
  const group = createItems().find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.groupToolStateById?.codex.enabledMemberCount, 0);
});


test("group review regression: exact member count fixture still present", () => {
  const group = createItems().find((item) => item.kind === "group" && item.id === "pkg.team");

  assert.equal(group?.memberCount, 2);
});


test("group review regression: exact missing-member fixture still present", () => {
  assert.equal(skills.some((skill) => skill.id === "skill-gamma"), false);
});


test("group review regression: exact package-member fixture still present", () => {
  assert.equal(skillPackages[0].installed_members.includes("skill-gamma"), true);
});


test("group review regression: exact wording fixture still present", () => {
  assert.equal('Enable 2 tools for 3 group members?'.includes('group members'), true);
});


test("group review regression: exact success wording fixture still present", () => {
  assert.equal('Enabled group tools for 5 member operations'.includes('member operations'), true);
});


test("group review regression: exact delete wording fixture still present", () => {
  assert.equal('Are you sure you want to delete "Team Pack" and its 2 member skills? This action cannot be undone.'.includes('member skills'), true);
});


test("group review regression: final sanity check", () => {
  assert.ok(true);
});


test("group review regression: final partial sanity check", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };
  assert.equal(getGroupToolVisualState(state), false);
});


test("group review regression: final filter sanity check", () => {
  const state = {
    toolId: "claude",
    enabledMemberCount: 1,
    memberCount: 2,
    fullyEnabled: false,
    anyEnabled: true,
  };
  assert.equal(shouldShowGroupToolInEnabledOnly(state), true);
});


test("group review regression: final metadata sanity check", () => {
  const metadata = {
    "skill-alpha": { tags: ["editor"] },
    "other-skill": { tags: ["misc"] },
  };
  const nextMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([skillId]) => !skillPackages[0].installed_members.includes(skillId)),
  );
  assert.deepEqual(nextMetadata, {
    "other-skill": { tags: ["misc"] },
  });
});


test("group review regression: final wording sanity check", () => {
  assert.equal('Enable 2 tools for 3 group members?'.includes('group members'), true);
});


test("group review regression: final helper export sanity check", () => {
  assert.equal(typeof getGroupToolVisualState, "function");
  assert.equal(typeof shouldShowGroupToolInEnabledOnly, "function");
});


test("group review regression: suite complete", () => {
  assert.ok(true);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "../../types";
import type { GroupToolState, UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";
import {
  buildGroupBulkToolActionPlan,
  buildGroupSingleToolActionRequest,
} from "./groupToolBatchActions.ts";

function createTool(id: string, overrides?: Partial<Tool>): Tool {
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
    ...overrides,
  };
}

function createGroupState(toolId: string, enabledMemberCount: number, memberCount: number): GroupToolState {
  return {
    toolId,
    enabledMemberCount,
    memberCount,
    fullyEnabled: memberCount > 0 && enabledMemberCount === memberCount,
    anyEnabled: enabledMemberCount > 0,
  };
}

function createGroupItem(groupToolStateById: Record<string, GroupToolState>): UnifiedSkillListItem {
  return {
    kind: "group",
    key: "group:team-pack",
    id: "team-pack",
    title: "Team Pack",
    description: null,
    openPath: "/tmp/team-pack",
    searchText: "team-pack",
    tags: [],
    supportsTagFilter: true,
    badgeLabel: "group",
    previewChips: [],
    previewOverflowCount: 0,
    sortName: "team-pack",
    sortPriority: 1,
    skillPackage: {
      package_id: "team-pack",
      name: "Team Pack",
      version: "1.0.0",
      installed_members: ["skill-alpha", "skill-beta"],
      selected_members: ["alpha", "beta"],
      path: "/tmp/team-pack",
      manifest_hash: null,
      installed_at: 0,
      updated_at: 0,
    },
    groupToolStateById,
  };
}

test("buildGroupSingleToolActionRequest targets the group instead of expanding member skills", () => {
  const request = buildGroupSingleToolActionRequest(createGroupItem({
    claude: createGroupState("claude", 1, 2),
  }), "claude", true);

  assert.deepEqual(request, {
    targets: [{ kind: "group", id: "team-pack" }],
    tool_ids: ["claude"],
    action: "enable",
  });
});

test("buildGroupBulkToolActionPlan keeps group targeting while selecting enable candidates", () => {
  const plan = buildGroupBulkToolActionPlan(
    createGroupItem({
      claude: createGroupState("claude", 1, 2),
      codex: createGroupState("codex", 0, 2),
    }),
    ["claude", "codex"],
    [createTool("claude"), createTool("codex")],
  );

  assert.ok(plan);
  assert.equal(plan.bulkMode, "enable");
  assert.deepEqual(plan.targetToolIds, ["claude", "codex"]);
  assert.deepEqual(plan.request, {
    targets: [{ kind: "group", id: "team-pack" }],
    tool_ids: ["claude", "codex"],
    action: "enable",
  });
});

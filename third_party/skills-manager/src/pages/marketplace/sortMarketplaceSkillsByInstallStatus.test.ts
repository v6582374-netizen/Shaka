import { test } from "node:test";
import assert from "node:assert/strict";
import type { MarketplaceSkill } from "../../types";
import { sortMarketplaceSkillsByInstallStatus } from "./sortMarketplaceSkillsByInstallStatus.ts";

function createMarketplaceSkill(
  id: string,
  installStatus: MarketplaceSkill["install_status"],
): MarketplaceSkill {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    author: null,
    source_id: "source-a",
    source_name: "Source A",
    install_count: null,
    install_url: null,
    created_at: null,
    repo_url: null,
    skill_path: null,
    external_url: null,
    remote_revision: null,
    tags: [],
    install_status: installStatus,
  };
}

test("sortMarketplaceSkillsByInstallStatus puts installed skills first and keeps stable order within groups", () => {
  const original = [
    createMarketplaceSkill("alpha", "not_installed"),
    createMarketplaceSkill("beta", "installed"),
    createMarketplaceSkill("gamma", "not_installed"),
    createMarketplaceSkill("delta", "update_available"),
  ];

  const sorted = sortMarketplaceSkillsByInstallStatus(original);

  assert.deepEqual(
    sorted.map((skill) => skill.id),
    ["beta", "delta", "alpha", "gamma"],
  );

  assert.deepEqual(
    original.map((skill) => skill.id),
    ["alpha", "beta", "gamma", "delta"],
  );
});

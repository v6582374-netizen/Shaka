import type { MarketplaceSkill } from "../../types";

export function sortMarketplaceSkillsByInstallStatus(
  skills: MarketplaceSkill[],
): MarketplaceSkill[] {
  return skills
    .map((skill, index) => ({ skill, index }))
    .sort((a, b) => {
      const installRankDiff =
        getMarketplaceInstallStatusRank(a.skill.install_status)
        - getMarketplaceInstallStatusRank(b.skill.install_status);
      if (installRankDiff !== 0) {
        return installRankDiff;
      }

      return a.index - b.index;
    })
    .map(({ skill }) => skill);
}

function getMarketplaceInstallStatusRank(
  status: MarketplaceSkill["install_status"],
): number {
  return status === "not_installed" ? 1 : 0;
}

import type { UnifiedSkillListItem } from "./buildUnifiedSkillItems.ts";

export interface GroupedSkillSection {
  group: UnifiedSkillListItem;
  members: UnifiedSkillListItem[];
  allMembers: UnifiedSkillListItem[];
  missingMemberIds: string[];
}

export interface GroupedSkillCollection {
  groups: GroupedSkillSection[];
  standaloneSkills: UnifiedSkillListItem[];
  groupBySkillKey: Map<string, UnifiedSkillListItem>;
}

function isGlobalSkillItem(item: UnifiedSkillListItem): boolean {
  return item.kind === "skill" && item.skill?.scope === "global";
}

function sortByName(items: UnifiedSkillListItem[]): UnifiedSkillListItem[] {
  return [...items].sort((left, right) => left.sortName.localeCompare(right.sortName));
}

export function buildGroupedSkillSections(
  allItems: UnifiedSkillListItem[],
  visibleItems: UnifiedSkillListItem[],
): GroupedSkillCollection {
  const visibleKeys = new Set(visibleItems.map((item) => item.key));
  const visibleSkills = visibleItems.filter((item) => item.kind === "skill");
  const globalSkillsById = new Map<string, UnifiedSkillListItem>();

  allItems.forEach((item) => {
    if (isGlobalSkillItem(item) && item.skill && !globalSkillsById.has(item.skill.id)) {
      globalSkillsById.set(item.skill.id, item);
    }
  });

  const groupBySkillKey = new Map<string, UnifiedSkillListItem>();
  const assignedSkillKeys = new Set<string>();
  const groups = sortByName(allItems.filter((item) => item.kind === "group"))
    .map((group): GroupedSkillSection | null => {
      if (!group.skillPackage) {
        return null;
      }

      const missingMemberIds: string[] = [];
      const allMembers: UnifiedSkillListItem[] = [];

      group.skillPackage.installed_members.forEach((memberId) => {
        const member = globalSkillsById.get(memberId);
        if (!member) {
          missingMemberIds.push(memberId);
          return;
        }

        if (assignedSkillKeys.has(member.key)) {
          return;
        }

        assignedSkillKeys.add(member.key);
        groupBySkillKey.set(member.key, group);
        allMembers.push(member);
      });

      const sortedMembers = sortByName(allMembers);
      const visibleMembers = sortedMembers.filter((member) => visibleKeys.has(member.key));
      const groupIsVisible = visibleKeys.has(group.key);
      if (!groupIsVisible && visibleMembers.length === 0) {
        return null;
      }

      return {
        group,
        members: groupIsVisible ? sortedMembers : visibleMembers,
        allMembers: sortedMembers,
        missingMemberIds,
      };
    })
    .filter((section): section is GroupedSkillSection => section !== null);

  const standaloneSkills = visibleSkills.filter((item) => !groupBySkillKey.has(item.key));

  return {
    groups,
    standaloneSkills,
    groupBySkillKey,
  };
}

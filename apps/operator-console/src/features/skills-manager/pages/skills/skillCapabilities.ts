import type { Skill } from "../../types";

/**
 * Inventory capabilities are server-authoritative.  A missing capability field is
 * treated as the legacy managed-skill contract, but an explicitly read-only skill
 * fails closed unless the server explicitly reports a per-tool toggle decision.
 */
export function canEditSkill(skill: Skill): boolean {
  return skill.read_only !== true && skill.can_edit !== false;
}

export function canDeleteSkill(skill: Skill): boolean {
  return skill.read_only !== true && skill.can_delete !== false;
}

export function canToggleSkill(skill: Skill, toolId: string): boolean {
  if (skill.toggle_allowed && Object.prototype.hasOwnProperty.call(skill.toggle_allowed, toolId)) {
    return skill.toggle_allowed[toolId] === true;
  }

  return skill.read_only !== true;
}

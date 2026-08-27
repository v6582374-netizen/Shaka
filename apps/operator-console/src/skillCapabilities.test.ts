import { describe, expect, it } from "vitest";
import type { Skill } from "./features/skills-manager/types";
import { canDeleteSkill, canEditSkill, canToggleSkill } from "./features/skills-manager/pages/skills/skillCapabilities";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "example",
    instance_id: "global:example",
    scope: "global",
    name: "Example",
    description: null,
    version: "1.0",
    source: "local",
    enabled: {},
    path: "/tmp/example",
    ...overrides,
  };
}

describe("Skill inventory capabilities", () => {
  it("keeps legacy managed skills editable and deletable", () => {
    const value = skill();
    expect(canEditSkill(value)).toBe(true);
    expect(canDeleteSkill(value)).toBe(true);
    expect(canToggleSkill(value, "codex")).toBe(true);
  });

  it("fails closed for an external body without a toggle decision", () => {
    const value = skill({ read_only: true });
    expect(canEditSkill(value)).toBe(false);
    expect(canDeleteSkill(value)).toBe(false);
    expect(canToggleSkill(value, "codex")).toBe(false);
  });

  it("allows only explicitly permitted projections for an external body", () => {
    const value = skill({
      read_only: true,
      toggle_allowed: { codex: true, claude: false },
    });
    expect(canToggleSkill(value, "codex")).toBe(true);
    expect(canToggleSkill(value, "claude")).toBe(false);
    expect(canToggleSkill(value, "unknown")).toBe(false);
  });
});

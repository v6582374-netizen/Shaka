import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectBinding } from "../types";

import {
  buildProjectBindingFromSkillsDir,
  hasProjectSkillsDirConflict,
  resolveActiveProjectId,
  resolveNextActiveProjectIdAfterAddition,
  resolveNextProjectBindingsAfterRemoval,
} from "./projectBindings.ts";

test("buildProjectBindingFromSkillsDir keeps the selected skills dir and derives the name from the last path segment", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");

  assert.equal(binding.name, "custom-skills");
  assert.equal(binding.skills_dir, "/Users/yjw/code/project-alpha/custom-skills");
  assert.match(binding.id, /^custom-skills-[a-z0-9]+$/);
});

test("buildProjectBindingFromSkillsDir trims trailing slashes before deriving values", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills///");

  assert.equal(binding.skills_dir, "/Users/yjw/code/project-alpha/custom-skills");
});

test("buildProjectBindingFromSkillsDir keeps the same id after trimming trailing slashes", () => {
  const fromPlainDir = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const fromTrailingSlashDir = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills///");

  assert.equal(fromPlainDir.id, fromTrailingSlashDir.id);
});

test("buildProjectBindingFromSkillsDir uses the final Windows path segment when it is not a generic skills name", () => {
  const binding = buildProjectBindingFromSkillsDir("C:\\Users\\yjw\\code\\project-alpha\\custom-skills");

  assert.equal(binding.name, "custom-skills");
  assert.equal(binding.skills_dir, "C:/Users/yjw/code/project-alpha/custom-skills");
  assert.match(binding.id, /^custom-skills-[a-z0-9]+$/);
});

test("buildProjectBindingFromSkillsDir derives a stable fallback id for non-ascii names", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/项目技能管理");

  assert.equal(binding.name, "项目技能管理");
  assert.match(binding.id, /^project-[a-z0-9]+$/);
});

test("buildProjectBindingFromSkillsDir uses different ids for same-name directories under different roots", () => {
  const firstBinding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const secondBinding = buildProjectBindingFromSkillsDir("/Users/archive/project-alpha/custom-skills");

  assert.notEqual(firstBinding.id, secondBinding.id);
  assert.equal(firstBinding.name, secondBinding.name);
});

test("buildProjectBindingFromSkillsDir rejects empty paths", () => {
  assert.throws(() => buildProjectBindingFromSkillsDir("   "), /Project skills directory path is required/);
});

test("buildProjectBindingFromSkillsDir rejects selecting the filesystem root", () => {
  assert.throws(() => buildProjectBindingFromSkillsDir("/"), /Select a skills directory instead of the filesystem root/);
});

test("buildProjectBindingFromSkillsDir allows selecting the .claude directory itself", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/.claude");

  assert.equal(binding.name, ".claude");
  assert.equal(binding.skills_dir, "/Users/yjw/code/project-alpha/.claude");
});

test("buildProjectBindingFromSkillsDir allows selecting the .claude/skills directory itself and derives the name from its parent", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/.claude/skills");

  assert.equal(binding.name, "project-alpha");
  assert.equal(binding.skills_dir, "/Users/yjw/code/project-alpha/.claude/skills");
});

test("buildProjectBindingFromSkillsDir uses the parent directory name when the selected directory is named skills", () => {
  const binding = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-beta/skills");

  assert.equal(binding.name, "project-beta");
});

test("hasProjectSkillsDirConflict only checks normalized skills dir", () => {
  const existingProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const sameSkillsDir = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills///");
  const differentSkillsDirSameName = buildProjectBindingFromSkillsDir("/Users/archive/project-alpha/custom-skills");

  assert.equal(hasProjectSkillsDirConflict([existingProject], sameSkillsDir), true);
  assert.equal(hasProjectSkillsDirConflict([existingProject], differentSkillsDirSameName), false);
});

test("resolveActiveProjectId falls back to null when active project id is stale", () => {
  const existingProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");

  assert.equal(resolveActiveProjectId("missing-project", [existingProject]), null);
});

test("resolveActiveProjectId keeps the active project id when it still exists", () => {
  const existingProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");

  assert.equal(resolveActiveProjectId(existingProject.id, [existingProject]), existingProject.id);
});

test("resolveNextActiveProjectIdAfterAddition replaces a stale active project id with the new project", () => {
  const nextProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");

  assert.equal(resolveNextActiveProjectIdAfterAddition("missing-project", [], nextProject), nextProject.id);
});

test("resolveNextActiveProjectIdAfterAddition keeps a valid active project id", () => {
  const existingProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const nextProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-beta/custom-skills");

  assert.equal(resolveNextActiveProjectIdAfterAddition(existingProject.id, [existingProject], nextProject), existingProject.id);
});

test("resolveNextProjectBindingsAfterRemoval clears active project when removing the current project", () => {
  const firstProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const secondProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-beta/custom-skills");

  assert.deepEqual(
    resolveNextProjectBindingsAfterRemoval([firstProject, secondProject], secondProject.id, secondProject.id),
    {
      projects: [firstProject],
      activeProjectId: null,
    },
  );
});

test("resolveNextProjectBindingsAfterRemoval keeps a different active project", () => {
  const firstProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const secondProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-beta/custom-skills");

  assert.deepEqual(
    resolveNextProjectBindingsAfterRemoval([firstProject, secondProject], secondProject.id, firstProject.id),
    {
      projects: [firstProject],
      activeProjectId: firstProject.id,
    },
  );
});

test("resolveNextProjectBindingsAfterRemoval ignores unknown project ids", () => {
  const firstProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-alpha/custom-skills");
  const secondProject = buildProjectBindingFromSkillsDir("/Users/yjw/code/project-beta/custom-skills");
  const projects: ProjectBinding[] = [firstProject, secondProject];

  assert.deepEqual(
    resolveNextProjectBindingsAfterRemoval(projects, "missing-project", firstProject.id),
    {
      projects,
      activeProjectId: firstProject.id,
    },
  );
});

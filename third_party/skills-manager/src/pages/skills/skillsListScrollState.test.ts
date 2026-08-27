import { test } from "node:test";
import assert from "node:assert/strict";

import {
  saveSkillsListScrollOffset,
  takeSkillsListScrollOffset,
} from "./skillsListScrollState.ts";

test("takeSkillsListScrollOffset returns the saved offset once and clears it", () => {
  const storage = new Map<string, string>();
  const sessionStorageMock = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  saveSkillsListScrollOffset(320, sessionStorageMock);

  assert.equal(takeSkillsListScrollOffset(sessionStorageMock), 320);
  assert.equal(takeSkillsListScrollOffset(sessionStorageMock), null);
});

test("takeSkillsListScrollOffset ignores invalid saved values", () => {
  const storage = new Map<string, string>();
  const sessionStorageMock = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  sessionStorageMock.setItem("skills-manager:skills-list-scroll-offset", "invalid");

  assert.equal(takeSkillsListScrollOffset(sessionStorageMock), null);
  assert.equal(storage.has("skills-manager:skills-list-scroll-offset"), false);
});

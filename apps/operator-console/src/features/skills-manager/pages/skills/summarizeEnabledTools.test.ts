import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEnabledTools } from "./summarizeEnabledTools.ts";

test("summarizeEnabledTools returns none when no tools are enabled", () => {
  const summary = summarizeEnabledTools(["a", "b", "c"], {}, 2);

  assert.equal(summary.state, "none");
  assert.equal(summary.enabledCount, 0);
  assert.equal(summary.totalCount, 3);
  assert.deepEqual(summary.visibleEnabledToolIds, []);
  assert.equal(summary.remainingCount, 0);
});

test("summarizeEnabledTools returns all when every tool is enabled", () => {
  const summary = summarizeEnabledTools(["a", "b"], { a: true, b: true }, 2);

  assert.equal(summary.state, "all");
  assert.equal(summary.enabledCount, 2);
  assert.equal(summary.totalCount, 2);
  assert.deepEqual(summary.visibleEnabledToolIds, []);
  assert.equal(summary.remainingCount, 0);
});

test("summarizeEnabledTools returns visible tools and remaining count for partial selection", () => {
  const summary = summarizeEnabledTools(
    ["a", "b", "c", "d"],
    { a: true, b: true, c: true },
    2,
  );

  assert.equal(summary.state, "partial");
  assert.equal(summary.enabledCount, 3);
  assert.equal(summary.totalCount, 4);
  assert.deepEqual(summary.visibleEnabledToolIds, ["a", "b"]);
  assert.equal(summary.remainingCount, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildPollOptionStats } from "./buildPollOptionStats.ts";

test("buildPollOptionStats should calculate percentage and preserve order", () => {
  const stats = buildPollOptionStats([
    { id: "a", label: "A", votes: 3 },
    { id: "b", label: "B", votes: 1 },
    { id: "c", label: "C", votes: 0 },
  ]);

  assert.deepEqual(
    stats.map(({ id, percentage }) => ({ id, percentage })),
    [
      { id: "a", percentage: 75 },
      { id: "b", percentage: 25 },
      { id: "c", percentage: 0 },
    ],
  );
  assert.equal(stats[0].isLeading, true);
  assert.equal(stats[1].isLeading, false);
  assert.equal(stats[2].isLeading, false);
});

test("buildPollOptionStats should handle tie and zero votes", () => {
  const tieStats = buildPollOptionStats([
    { id: "x", label: "X", votes: 2 },
    { id: "y", label: "Y", votes: 2 },
  ]);

  assert.equal(tieStats[0].isLeading, true);
  assert.equal(tieStats[1].isLeading, true);

  const emptyStats = buildPollOptionStats([
    { id: "m", label: "M", votes: 0 },
    { id: "n", label: "N", votes: 0 },
  ]);
  assert.equal(emptyStats[0].percentage, 0);
  assert.equal(emptyStats[1].percentage, 0);
  assert.equal(emptyStats[0].isLeading, false);
  assert.equal(emptyStats[1].isLeading, false);
});

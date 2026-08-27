import { test } from "node:test";
import assert from "node:assert/strict";
import { formatInstallCountLabel } from "./formatInstallCount.ts";

test("formatInstallCountLabel returns null when install count is missing or not positive", () => {
  assert.equal(formatInstallCountLabel(undefined), null);
  assert.equal(formatInstallCountLabel(null), null);
  assert.equal(formatInstallCountLabel(0), null);
  assert.equal(formatInstallCountLabel(-3), null);
});

test("formatInstallCountLabel keeps counts below 1K as plain numbers", () => {
  assert.equal(formatInstallCountLabel(1), "1");
  assert.equal(formatInstallCountLabel(999), "999");
});

test("formatInstallCountLabel formats counts at or above 1K using K units with one decimal", () => {
  assert.equal(formatInstallCountLabel(1000), "1.0K");
  assert.equal(formatInstallCountLabel(12500), "12.5K");
  assert.equal(formatInstallCountLabel(12550), "12.6K");
});

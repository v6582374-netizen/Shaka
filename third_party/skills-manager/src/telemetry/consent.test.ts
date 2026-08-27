import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isTelemetryCollectionEnabled,
  resolveTelemetryConsent,
  shouldPromptForTelemetryConsent,
} from "./consent.ts";

test("unknown telemetry consent prompts the user before collection", () => {
  assert.equal(shouldPromptForTelemetryConsent("unknown"), true);
  assert.equal(isTelemetryCollectionEnabled("unknown"), false);
});

test("granted telemetry consent enables collection without prompting", () => {
  assert.equal(shouldPromptForTelemetryConsent("granted"), false);
  assert.equal(isTelemetryCollectionEnabled("granted"), true);
});

test("denied telemetry consent disables collection without prompting", () => {
  assert.equal(shouldPromptForTelemetryConsent("denied"), false);
  assert.equal(isTelemetryCollectionEnabled("denied"), false);
});

test("missing telemetry consent falls back to unknown", () => {
  assert.equal(resolveTelemetryConsent(undefined), "unknown");
  assert.equal(resolveTelemetryConsent(null), "unknown");
});

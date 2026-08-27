import assert from "node:assert/strict";
import { test } from "node:test";

import { registerTelemetryCloseHandler } from "./registerTelemetryCloseHandler.ts";

test("registerTelemetryCloseHandler ends telemetry before destroying the window", async () => {
  const calls: string[] = [];
  let closeHandler:
    | ((event: { preventDefault(): void }) => Promise<void> | void)
    | undefined;

  const appWindow = {
    async onCloseRequested(
      handler: (event: { preventDefault(): void }) => Promise<void> | void,
    ) {
      closeHandler = handler;
      return () => {
        calls.push("unlisten");
      };
    },
    async destroy() {
      calls.push("destroy");
    },
  };

  const cleanup = await registerTelemetryCloseHandler({
    appWindow,
    endSession: async (reason) => {
      calls.push(`end:${reason}`);
    },
  });

  assert.ok(closeHandler, "close handler should be registered");

  let prevented = false;
  await closeHandler?.({
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
  assert.deepEqual(calls, ["end:normal_close", "destroy"]);

  cleanup();
  assert.deepEqual(calls, ["end:normal_close", "destroy", "unlisten"]);
});

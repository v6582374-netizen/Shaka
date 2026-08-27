import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEDBACK_GROUP_CONTACT_CHANNELS } from "./feedbackDirectContacts.ts";

test("FEEDBACK_GROUP_CONTACT_CHANNELS includes wechat and feishu qr entries", () => {
  assert.deepEqual(
    FEEDBACK_GROUP_CONTACT_CHANNELS.map((channel) => channel.id),
    ["wechatGroup", "feishuGroup"],
  );
});

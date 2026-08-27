import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketplaceMetaItems } from "./buildMarketplaceMetaItems.ts";

test("buildMarketplaceMetaItems puts install count to the right of author when author exists", () => {
  const items = buildMarketplaceMetaItems("作者: composiohq", "2");

  assert.deepEqual(
    items.map((item) => item.kind),
    ["author", "install_count"],
  );
});

test("buildMarketplaceMetaItems keeps install count when author is missing", () => {
  const items = buildMarketplaceMetaItems(null, "2");

  assert.deepEqual(
    items.map((item) => item.kind),
    ["install_count"],
  );
});

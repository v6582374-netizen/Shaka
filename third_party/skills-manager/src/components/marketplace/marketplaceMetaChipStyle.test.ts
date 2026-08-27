import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketplaceMetaChipStyle } from "./marketplaceMetaChipStyle.ts";

test("getMarketplaceMetaChipStyle returns consistent compact chip sizing", () => {
  const style = getMarketplaceMetaChipStyle("compact");

  assert.equal(style.display, "inline-flex");
  assert.equal(style.alignItems, "center");
  assert.equal(style.padding, "2px 6px");
  assert.equal(style.lineHeight, "1");
  assert.equal(style.minHeight, "24px");
  assert.equal(style.boxSizing, "border-box");
});

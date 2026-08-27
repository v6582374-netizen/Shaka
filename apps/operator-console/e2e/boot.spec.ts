// The web app is useful before any optional service responds. A missing legacy sidecar
// must never turn initial navigation into a fixed startup retry window.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("opens the workspace immediately when health is unavailable", async ({ page }) => {
  // This is the browser-only deployment shape: the old sidecar no longer exists.
  // Register after the fixture so this handler wins over its normal health response.
  await page.route("**/v1/health", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".boot-splash")).toHaveCount(0, { timeout: 1_000 });
  await expect(page.getByText("What should we produce?")).toBeVisible();
});

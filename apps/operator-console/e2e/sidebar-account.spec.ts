// The sidebar bottom is exactly ONE row — the account anchor (UX-DECISIONS §26).
// Contract under test: no "Settings & more", no standalone Inbox/Connectors rows; the
// inbox chip is state-driven (accent + count when pending) and clicks STRAIGHT to Inbox
// while the rest of the row opens the account menu (Inbox, Settings, Activity).
import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("the bottom is one account row — the old rows are gone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("account-row")).toBeVisible();
  await expect(page.getByRole("button", { name: /Settings & more/i })).toHaveCount(0);
  // No standalone sidebar Inbox row: outside the menu, "Inbox" exists only as the chip.
  await expect(page.locator(".sidebar").getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
});

test("pending items: the chip carries the count and goes straight to Inbox — no menu", async ({
  page,
}) => {
  await page.goto("/");
  const chip = page.getByTestId("inbox-chip");
  await expect(chip).toContainText(/\d/); // fixtures seed pending attention → accent count
  await chip.click();
  await expect(page.getByTestId("account-menu")).toHaveCount(0); // the chip never opens the menu
  await expect(page.getByText("Approve: run_shell")).toBeVisible(); // Inbox opened directly
});

test("the account menu carries Inbox, Settings and Activity; Connectors and Automations are nav rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  const menu = page.getByTestId("account-menu");
  await expect(menu.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Settings/ })).toContainText("\u2318");
  await expect(menu.getByRole("button", { name: "Activity", exact: true })).toBeVisible();
  // Connectors and Automations are first-class sidebar rows, not menu items.
  await expect(menu.getByRole("button", { name: "Connectors", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("nav-connectors")).toBeVisible();
  await expect(page.getByTestId("nav-automations")).toBeVisible();
});
test("Activity in the menu is the audit log; Unrouted lives under Inbox ▸ Configure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

  // §28: Messaging routing left the Connectors sub-nav entirely (Connectors · MCP only)…
  await page.keyboard.press("Escape"); // close the menu — its overlay swallows nav clicks
  await page.getByTestId("nav-connectors").click();
  await expect(page.getByRole("button", { name: "MCP servers" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Messaging routing/ })).toHaveCount(0);
  // The old fourth sub-nav tab is gone — exactly one page is named Activity now.
  await expect(page.getByRole("button", { name: "Activity", exact: true })).toHaveCount(0);

  // …and Unrouted rides the Inbox's Configure tab.
  await page.getByTestId("account-row").click();
  await page.getByTestId("account-menu").getByRole("button", { name: "Inbox" }).click();
  await page.getByTestId("inbox-tab-configure").click();
  await expect(page.getByTestId("unrouted-section")).toBeVisible();
});

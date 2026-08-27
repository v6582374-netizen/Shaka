// The generic multi-account detail page (AccountsDetail), exercised via Notion —
// the pattern all batch-2 connectors share (accounts.py layer: AccountRow shape,
// Default badge, per-account ×). Every account arrives as a pasted token.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
}

/** Connect the first Notion workspace by pasting a token in the list's modal. */
async function connectFirstWorkspace(page) {
  await openConnectors(page);
  await page
    .getByTestId("connector-notion")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByPlaceholder("ntn_…").fill("ntn_secret");
  await page.getByTestId("add-connection-modal").getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("connector-notion")).toContainText("Rohit's Workspace", {
    timeout: 10_000,
  });
}

/** Add one more account from the detail page's own token form. */
async function addAccountFromPage(page) {
  await page.getByTestId("add-account-btn").click();
  const form = page.getByTestId("accounts-manual-add");
  await form.getByPlaceholder("ntn_…").fill("ntn_second");
  await form.getByRole("button", { name: "Connect" }).click();
}

test("add a second workspace from the page; the first stays default", async ({ page }) => {
  await connectFirstWorkspace(page);
  await page.getByTestId("connector-notion").click();
  await expect(page.getByTestId("accounts-detail")).toBeVisible();

  await addAccountFromPage(page);
  const first = page.getByTestId("account-ws-1");
  const second = page.getByTestId("account-ws-2");
  await expect(second).toBeVisible({ timeout: 10_000 });
  await expect(first).toContainText("Rohit's Workspace");
  await expect(first).toContainText("Default");
  await expect(second).not.toContainText("Default");
  // list row summarizes the multi-account state
  await page.getByTestId("connectors-breadcrumb").click();
  await expect(page.getByTestId("connector-notion")).toContainText("2 accounts");
});

test("Make default moves the badge; disconnecting the default repoints it", async ({
  page,
}) => {
  await connectFirstWorkspace(page);
  await page.getByTestId("connector-notion").click();
  await addAccountFromPage(page);
  await expect(page.getByTestId("account-ws-2")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("account-make-default-ws-2").click();
  await expect(page.getByTestId("account-ws-2")).toContainText("Default");
  await expect(page.getByTestId("account-ws-1")).not.toContainText("Default");

  await page.getByTestId("account-disconnect-ws-2").click();
  await expect(page.getByTestId("account-ws-2")).toHaveCount(0);
  await expect(page.getByTestId("account-ws-1")).toContainText("Default");
});

test("not connected: the page leads with the token form, no sign-in gate", async ({ page }) => {
  await openConnectors(page);
  await page.getByTestId("connector-notion").click();
  // Pre-connect goes through AvailableDetail → its Connect opens the token modal.
  await page.getByTestId("available-connect").click();
  await expect(page.getByPlaceholder("ntn_…")).toBeVisible();
  await expect(page.getByTestId("modal-pane-one")).toHaveCount(0); // no one-click pane
});

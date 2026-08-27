// The Google Calendar detail page: gmail-parity multi-account (Default badge,
// Make default, per-account disconnect, "＋ Add account" → token-paste modal).
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
}

// starts disconnected → Available row → modal → paste the OAuth token.
async function connectFirstAccount(page) {
  await openConnectors(page);
  await page
    .getByTestId("connector-google_calendar")
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  const modal = page.getByTestId("add-connection-modal");
  await modal.locator('input[type="password"]').first().fill("ya29.token");
  await modal.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("connector-google_calendar")).toContainText("rohit@gmail.com", {
    timeout: 10_000,
  });
}

async function addAnotherAccount(page) {
  await page.getByTestId("add-account-btn").click();
  const modal = page.getByTestId("add-connection-modal");
  await modal.locator('input[type="password"]').first().fill("ya29.token2");
  await modal.getByRole("button", { name: "Connect", exact: true }).click();
}

test("connect, then add a second account from the page; first stays default", async ({
  page,
}) => {
  await connectFirstAccount(page);
  await page.getByTestId("connector-google_calendar").click();
  await expect(page.getByTestId("gcal-detail")).toBeVisible();

  await addAnotherAccount(page);
  const rohit = page.getByTestId("gcal-account-rohit@gmail.com");
  const work = page.getByTestId("gcal-account-work@dlai.com");
  await expect(work).toBeVisible({ timeout: 10_000 });
  await expect(rohit).toContainText("Default");
  await expect(work).not.toContainText("Default");
  // list row summarizes the multi-account state
  await page.getByTestId("connectors-breadcrumb").click();
  await expect(page.getByTestId("connector-google_calendar")).toContainText("2 accounts");
});

test("Make default moves the badge; disconnecting the default repoints it", async ({
  page,
}) => {
  await connectFirstAccount(page);
  await page.getByTestId("connector-google_calendar").click();
  await addAnotherAccount(page);
  await expect(page.getByTestId("gcal-account-work@dlai.com")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("gcal-make-default-work@dlai.com").click();
  await expect(page.getByTestId("gcal-account-work@dlai.com")).toContainText("Default");
  await expect(page.getByTestId("gcal-account-rohit@gmail.com")).not.toContainText("Default");

  await page.getByTestId("gcal-disconnect-work@dlai.com").click();
  await expect(page.getByTestId("gcal-account-work@dlai.com")).toHaveCount(0);
  await expect(page.getByTestId("gcal-account-rohit@gmail.com")).toContainText("Default");
});

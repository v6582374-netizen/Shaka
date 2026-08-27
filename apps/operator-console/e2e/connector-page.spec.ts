// Slack config is a detail SUBPAGE under Connectors (UX-DECISIONS §21): the list row
// navigates to it, and the §19 flows — parked senders (Allow & deliver / Allow / ×)
// and "listening" sessions — live on the one connected workspace's card.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openSlackPage(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
  await page.getByTestId("connector-slack").click();
}

test("list row status + navigation to the Slack page", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();

  const row = page.getByTestId("connector-slack");
  await expect(row).toContainText("deeplearning.ai");
  await row.click();
  await expect(page.getByTestId("slack-detail")).toBeVisible();
  await expect(page.getByTestId("slack-mode-badge")).toContainText("Socket Mode");
});

test("parked sender shows on the workspace card; Allow & deliver adds them to the allow-list", async ({
  page,
}) => {
  await openSlackPage(page);

  const card = page.getByTestId("slack-socket-card");
  await expect(card.getByTestId("waiting-pk1")).toContainText("Maya");
  await expect(card.getByTestId("waiting-pk1")).toContainText("in #ocw-test");
  await expect(card.getByTestId("waiting-pk1")).toContainText("hey ocw, can you summarize this thread?");

  await page.getByTestId("parked-allow-deliver-pk1").click();
  await expect(page.getByTestId("waiting-pk1")).toHaveCount(0);
  await expect(card).toContainText("U0NEW"); // now a People chip
});

test("parked sender can be dismissed without allowing", async ({ page }) => {
  await openSlackPage(page);
  await page.getByTestId("parked-dismiss-pk1").click();
  await expect(page.getByTestId("waiting-pk1")).toHaveCount(0);
  await expect(page.getByTestId("slack-socket-card")).not.toContainText("U0NEW");
});

test("sessions listening in the workspace: listed with unsubscribe", async ({ page }) => {
  await openSlackPage(page);

  const card = page.getByTestId("slack-socket-card");
  await expect(card.getByTestId("listening-slack")).toContainText("Weekly plan 1");
  await expect(card.getByTestId("listening-slack")).toContainText("#ocw-test");

  await card.getByTitle("Unsubscribe this session").click();
  await expect(card.getByTestId("listening-slack")).toHaveCount(0); // row hides when empty
});

test("disconnect drops the stored tokens and returns the card to not-connected", async ({
  page,
}) => {
  await openSlackPage(page);
  await page.getByTestId("disconnect-slack").click();
  await expect(page.getByTestId("slack-socket-card")).toHaveCount(0);
  // Disconnected: the pre-connect page takes over, with the one connect entry point.
  await expect(page.getByTestId("available-detail")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("available-connect").click();
  const modal = page.getByTestId("add-connection-modal");
  await expect(modal).toContainText("Enable Socket Mode"); // bot + app token paste
  // No cloud remnants: no one-click pane, no sign-in gate.
  await expect(modal.getByTestId("modal-pane-one")).toHaveCount(0);
  await expect(modal).not.toContainText("Sign in");
});

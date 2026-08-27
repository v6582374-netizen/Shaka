// The GitHub detail page: a personal access token, ONE account. People (sender
// logins allowed to trigger work) / Waiting (parked mentions) rows, connect via
// the header MODAL (token paste), disconnect, and the park → allow & deliver flow
// that admits a new sender login into the allow-list.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openGithubPage(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
  await page.getByTestId("connector-github").click();
}

test("the connected page shows the token account with people and waiting rows", async ({
  page,
}) => {
  await openGithubPage(page);
  await expect(page.getByTestId("github-mode-badge")).toContainText("personal access token");
  const card = page.getByTestId("github-pat-card");
  await expect(card).toContainText("rohit-dev"); // logins ARE the readable identity
  await expect(card).toContainText("@rohit-dev"); // the allow-list chip
  // the parked mention shows on the page, quoting the trigger
  await expect(card).toContainText("@maya-dev");
  await expect(card).toContainText("please take a look");
});

test("allow & deliver admits the sender into the allow-list", async ({ page }) => {
  await openGithubPage(page);
  await page.getByTestId("parked-allow-deliver-gh-pk1").click();
  await expect(page.getByTestId("github-pat-card")).toContainText("@maya-dev"); // now a People chip
  await expect(page.getByTestId("waiting-gh-pk1")).toHaveCount(0);
});

test("disconnect drops the token and the page offers to connect again", async ({ page }) => {
  await openGithubPage(page);
  await page.getByTestId("disconnect-github").click();

  // Disconnected: the pre-connect page takes over, with the one connect entry point.
  await expect(page.getByTestId("available-detail")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("available-connect").click();
  const modal = page.getByTestId("add-connection-modal");
  await expect(modal).toContainText("Personal access token"); // token paste, the only mode
  // No cloud remnants: no one-click pane, no sign-in gate.
  await expect(modal.getByTestId("modal-pane-one")).toHaveCount(0);
  await expect(modal).not.toContainText("Sign in");
});

test("pasting a token connects and lands back on the PAT page", async ({ page }) => {
  await openGithubPage(page);
  await page.getByTestId("disconnect-github").click();
  await expect(page.getByTestId("available-detail")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("available-connect").click();
  const modal = page.getByTestId("add-connection-modal");
  await modal.locator('input[type="password"]').fill("ghp_e2e_token");
  await modal.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByTestId("github-pat-card")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("github-mode-badge")).toContainText("personal access token");
});

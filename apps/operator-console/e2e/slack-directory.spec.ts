// The Slack rosters: pick people from the workspace directory (instead of the
// park→approve-only flow) and resolve channel NAMES to ids in the channel picker.
// Both are reads on scopes every install already granted — no consent bump.
// Socket Mode is ONE workspace, so ids are bare (slack:C…) and the pickers need
// no workspace qualifier.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openSlackPage(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
  await page.getByTestId("connector-slack").click();
}

test("people picker: type a name, pick it, chip lands with the display name", async ({
  page,
}) => {
  await openSlackPage(page);
  await page.getByTestId("add-person-default").click();
  const picker = page.getByTestId("person-picker");
  await picker.getByPlaceholder("Type a name…").fill("ro");
  await page.getByTestId("pick-person-U8ROHIT").click();
  // The chip shows the display name immediately (no first message needed).
  await expect(page.getByTestId("slack-socket-card")).toContainText("Rohit Prasad");
  await expect(page.getByTestId("person-picker")).toHaveCount(0);
});

test("people picker: guests are tagged, allowed users drop out of the list", async ({
  page,
}) => {
  await openSlackPage(page);
  await page.getByTestId("add-person-default").click();
  const picker = page.getByTestId("person-picker");
  await expect(picker.getByTestId("pick-person-U7CAL")).toContainText("guest");
  await picker.getByPlaceholder("Type a name…").fill("maya");
  await picker.getByTestId("pick-person-U9MAYA").click();
  await expect(page.getByTestId("slack-socket-card")).toContainText("Maya Chen");
  // Reopen: Maya is allowed now, so she's no longer offered.
  await page.getByTestId("add-person-default").click();
  await expect(page.getByTestId("person-picker")).toBeVisible();
  await expect(page.getByTestId("pick-person-U9MAYA")).toHaveCount(0);
  await expect(page.getByTestId("pick-person-U8ROHIT")).toBeVisible();
});

test("channel typeahead: a NAME resolves to its id-address", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  await page.getByTestId("access-toggle").click();
  await page.getByRole("button", { name: /Channels · 0/ }).click();

  const input = page.getByPlaceholder("slack:C0123 or channel link");
  await input.fill("launch");
  const hit = page.getByTestId("roster-channel-slack:C9LAUNCH");
  await expect(hit).toContainText("#launch-team");
  await hit.click();
  // Display = the NAME after a pick (owner catch 2026-07-11: raw ids leaked into the box);
  // the raw address survives underneath — the tooltip carries it and Add subscribes by id.
  await expect(input).toHaveValue("#launch-team");
  await expect(input).toHaveAttribute("title", "slack:C9LAUNCH");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Subscribed channels · 1/)).toBeVisible();
});

test("channel typeahead: private and not-a-member states are honest", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();
  await page.getByTestId("access-toggle").click();
  await page.getByRole("button", { name: /Channels · 0/ }).click();

  await page.getByPlaceholder("slack:C0123 or channel link").fill("l");
  await expect(page.getByTestId("roster-channel-slack:C8LEADS")).toContainText("🔒");
  await expect(page.getByTestId("roster-channel-slack:C7LOBBY")).toContainText("invite @ocw");
});

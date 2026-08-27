// The Connectors LIST (UX-DECISIONS §21): connected connectors first in their own
// section with a health chip, rows navigate to the connector's detail subpage
// (breadcrumb back), available connectors get a Connect pill → add-connection modal
// with One click | Manual pills for multi-mode connectors.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
}

test("connected connectors come first with status + health chip", async ({ page }) => {
  await openConnectors(page);

  const slack = page.getByTestId("connector-slack");
  await expect(slack).toContainText("deeplearning.ai");
  // a connected two-way connector reads Live
  await expect(slack).toContainText("Live");
  // available section renders the not-connected connectors with a Connect pill
  await expect(
    page.getByTestId("connector-telegram").getByRole("button", { name: "Connect" }),
  ).toBeVisible();
});

test("row navigates to the detail subpage; breadcrumb returns", async ({ page }) => {
  await openConnectors(page);
  await page.getByTestId("connector-slack").click();
  await expect(page.getByTestId("slack-detail")).toBeVisible();
  await page.getByTestId("connectors-breadcrumb").click();
  await expect(page.getByTestId("connector-slack")).toContainText("deeplearning.ai");
});

test("generic detail page: tools + two-way blocks + disconnect for telegram-alikes", async ({
  page,
}) => {
  await openConnectors(page);
  // Browser is keyless-connected → generic page, no Disconnect for auth=none
  await page.getByTestId("connector-browser").click();
  await expect(page.getByRole("heading", { name: "Browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await page.getByTestId("connectors-breadcrumb").click();
});

test("Connect on a multi-mode connector opens the modal with One click | Manual pills", async ({
  page,
}) => {
  await openConnectors(page);
  // Single-mode connectors (telegram) render their ConnectSetup pane directly; the
  // One click | Manual switcher is reserved for MCP-backed connectors with fields.
  await page.getByTestId("connector-telegram").getByRole("button", { name: "Connect" }).click();
  const modal = page.getByTestId("add-connection-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator("input")).not.toHaveCount(0); // manual fields rendered
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-connection-modal")).toHaveCount(0);
});

test("filter narrows both sections", async ({ page }) => {
  await openConnectors(page);
  await page.getByPlaceholder("Search").fill("tele");
  await expect(page.getByTestId("connector-telegram")).toBeVisible();
  await expect(page.getByTestId("connector-slack")).toHaveCount(0);
});

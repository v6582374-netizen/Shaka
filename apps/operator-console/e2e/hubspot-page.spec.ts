// The HubSpot detail page (UX-DECISIONS §21): multi-portal with Default/Sandbox
// tags, the add-portal modal (private-app token paste), and the hidden-fields
// denylist that keeps properties away from the model.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
}

/** Paste a private-app token from whichever connect surface is open. */
async function pasteToken(page) {
  const modal = page.getByTestId("add-connection-modal");
  await modal.getByPlaceholder("pat-…").fill("pat-e2e-token");
  await modal.getByRole("button", { name: "Connect", exact: true }).click();
}

async function connectFirstPortal(page) {
  await openConnectors(page);
  await page.getByTestId("connector-hubspot").getByRole("button", { name: "Connect" }).click();
  await pasteToken(page);
  await expect(page.getByTestId("connector-hubspot")).toContainText("Acme Inc", {
    timeout: 10_000,
  });
}

test("connect via modal: the private-app token is the connect path", async ({ page }) => {
  await openConnectors(page);
  await page.getByTestId("connector-hubspot").getByRole("button", { name: "Connect" }).click();
  const modal = page.getByTestId("add-connection-modal");
  // One mode only — no One click | Manual pills now that the broker is gone.
  await expect(modal.getByTestId("modal-pane-manual")).toHaveCount(0);
  await expect(modal.getByPlaceholder("pat-…")).toBeVisible();

  await pasteToken(page);
  await expect(page.getByTestId("connector-hubspot")).toContainText("Acme Inc", {
    timeout: 10_000,
  });
  await page.getByTestId("connector-hubspot").click();
  await expect(page.getByTestId("hubspot-portal-111")).toContainText("Default");
});

test("second portal: sandbox tag, make-default, disconnect repoints", async ({ page }) => {
  await connectFirstPortal(page);
  await page.getByTestId("connector-hubspot").click();

  // add the sandbox portal from the page's header button
  await page.getByTestId("add-portal-btn").click();
  await pasteToken(page);
  const sandbox = page.getByTestId("hubspot-portal-222");
  await expect(sandbox).toContainText("Sandbox", { timeout: 10_000 });

  await page.getByTestId("hubspot-make-default-222").click();
  await expect(sandbox).toContainText("Default");
  await page.getByTestId("hubspot-disconnect-222").click();
  await expect(page.getByTestId("hubspot-portal-222")).toHaveCount(0);
  await expect(page.getByTestId("hubspot-portal-111")).toContainText("Default");
});

test("hidden fields round-trip and read back normalized", async ({ page }) => {
  await connectFirstPortal(page);
  await page.getByTestId("connector-hubspot").click();

  const row = page.getByTestId("hubspot-hidden-fields");
  await row.getByRole("textbox").fill("Salary");
  await row.getByRole("textbox").press("Enter");
  await expect(row).toContainText("salary"); // normalized lowercase from the PATCH echo
  await row.getByTitle("remove").click();
  await expect(row).not.toContainText("salary");
});

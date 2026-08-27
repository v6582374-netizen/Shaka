// MCP-backed connectors (UX-DECISIONS §42): monday/asana/jira connect through the
// vendor's hosted MCP server via a fully LOCAL OAuth flow — the one and only
// one-click left in the product — and agents get only the PINNED tool subset,
// surfaced on the connector detail page like any other curated tool set.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openConnectors(page) {
  await page.goto("/");
  await page.getByTestId("nav-connectors").click();
}

test("monday: local-OAuth MCP connect; card flips connected", async ({
  page,
}) => {
  await openConnectors(page);

  // The MCP one-click is fully local — no account anywhere in the flow.
  await page
    .getByTestId("connector-monday")
    .getByRole("button", { name: "Connect" })
    .click();
  const modal = page.getByTestId("add-connection-modal");
  await expect(modal).toBeVisible();
  // Single-mode: no One click | Manual pills — just the button.
  await expect(modal.getByTestId("modal-pane-manual")).toHaveCount(0);
  await expect(modal.getByText("sign-in runs entirely on this computer")).toBeVisible();

  await modal.getByTestId("modal-mcp-one-click").click();
  await expect(modal.getByText("Check your browser…")).toBeVisible();
  // The mock flow completes instantly; the modal's poll closes it and the card flips.
  await expect(page.getByTestId("add-connection-modal")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("connector-monday")).toContainText("Connected");
});

test("jira: two modes — MCP one-click pane plus the manual token form", async ({
  page,
}) => {
  await openConnectors(page);
  // jira sits past the available-list fold.
  await page.getByRole("button", { name: "show all" }).click();
  await page
    .getByTestId("connector-jira")
    .getByRole("button", { name: "Connect" })
    .click();
  const modal = page.getByTestId("add-connection-modal");

  // One click pane is the local MCP OAuth flow.
  await expect(modal.getByTestId("modal-pane-one")).toBeVisible();
  await expect(modal.getByTestId("modal-mcp-one-click")).toBeVisible();

  // Manual keeps the existing Atlassian token fields.
  await modal.getByTestId("modal-pane-manual").click();
  await expect(modal.getByText("Atlassian site URL")).toBeVisible();
  await expect(modal.getByText("API token")).toBeVisible();
});

test("monday detail page shows the pinned tool subset with approval badges", async ({
  page,
}) => {
  await openConnectors(page);
  await page.getByTestId("connector-monday").click();
  await expect(page.getByText("2 tools this connector adds")).toBeVisible();
  await page.getByText("View", { exact: true }).click();
  await expect(page.getByText("Read board", { exact: true })).toBeVisible();
  await expect(page.getByText("Create item", { exact: true })).toBeVisible();
});

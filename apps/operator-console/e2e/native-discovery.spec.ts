import { expect } from "@playwright/test";
import { test } from "./fixtures";

test.setTimeout(60_000);

test("Discovery is an independent shell on the native sidecar route", async ({ page }) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    paths.push(new URL(request.url()).pathname);
  });

  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await expect(view).toBeVisible();
  await expect(view.getByRole("heading", { name: "Discovery", exact: true })).toBeVisible();
  await expect(view.getByRole("tab", { name: "Preparation" })).toBeVisible();
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();

  // Preparation, Current Launch, and History are internal tabs, not new sidebar destinations.
  await expect(page.locator(".sidebar").getByRole("button", { name: "Preparation", exact: true })).toHaveCount(0);
  await view.getByRole("tab", { name: "Current Launch" }).click();
  await expect(view.getByRole("button", { name: "Refresh Preparation" })).toHaveCount(0);
  await expect(view.getByRole("heading", { name: "Preparation" })).toBeVisible();
  await expect(view.getByText("CURRENT OBSERVATION · PREPARATION")).toBeVisible();
  await expect(view.getByText("Ready to launch")).toBeVisible();
  await expect(view.getByText("No current Launch")).toHaveCount(0);
  await view.getByRole("tab", { name: "History" }).click();
  await expect(view.getByRole("button", { name: "Refresh Preparation" })).toHaveCount(0);
  await expect(view.getByRole("heading", { name: "No Launch history yet" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(view).toBeVisible();
  await expect(view.getByRole("tab", { name: "History" })).toBeVisible();

  await expect.poll(() => paths.includes("/v1/discovery")).toBe(true);
  expect(paths.filter((path) => /^\/api\/(workspace|admin)(\/|$)/.test(path))).toEqual([]);
});

test("Conversion Prompt opens the shared editor inside Preparation", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();
  await view.getByTestId("conversion-prompt-entry").click();

  await expect(view.getByTestId("discovery-conversion-prompt-editor")).toBeVisible();
  await expect(view.getByRole("heading", { name: "Discovery Input Conversion Prompt" })).toBeVisible();
  const prompt = view.getByRole("textbox", { name: "Discovery Input Conversion Prompt" });
  await expect(prompt).toHaveValue("Compile the saved Preparation into one structured Execution Input.");
  await prompt.fill("Compile the saved Preparation into one structured Execution Input with provenance.");
  const saveRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/input-conversion-prompt") && request.method() === "PUT",
  );
  await view.getByRole("button", { name: "Save" }).click();
  expect((await saveRequest).postDataJSON()).toEqual({
    instruction: "Compile the saved Preparation into one structured Execution Input with provenance.",
  });
  await expect(view.getByTestId("discovery-conversion-prompt-editor")).toHaveCount(0);
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompt Library" })).toHaveCount(0);
});

test("Gather accepts multiple files, saves explicitly, and keeps saved state separate", async ({ page }) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    paths.push(new URL(request.url()).pathname);
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();

  await view.getByRole("textbox", { name: "Research text" }).fill("Compare membrane performance in saline water.");
  const intake = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/intake") && request.method() === "POST",
  );
  await view.getByLabel("Source files").setInputFiles([
    {
      name: "brief.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("Membrane notes"),
    },
    {
      name: "measurements.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("salinity,flux\n10,42\n"),
    },
  ]);
  const intakeRequest = await intake;
  const intakeBody = intakeRequest.postDataJSON();
  expect(intakeBody.text).toBe("Compare membrane performance in saline water.");
  expect(intakeBody.files).toHaveLength(2);
  expect(intakeBody.files.map((file: { filename: string }) => file.filename)).toEqual([
    "brief.md",
    "measurements.csv",
  ]);

  await expect(view.getByText("brief.md")).toBeVisible();
  await expect(view.getByText("measurements.csv")).toBeVisible();
  await expect(view.getByText("Draft changes not saved")).toBeVisible();

  const firstSave = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/save") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Save Preparation" }).click();
  const firstSaveRequest = await firstSave;
  expect(firstSaveRequest.postDataJSON()).toEqual({
    text: "Compare membrane performance in saline water.",
  });
  await expect(view.getByText("Preparation saved")).toBeVisible();

  const deleteRequest = page.waitForRequest(
    (request) =>
      request.url().includes("/v1/discovery/preparation/sources/") && request.method() === "DELETE",
  );
  await view.getByRole("button", { name: "Remove brief.md" }).click();
  await deleteRequest;
  await expect(view.getByText("brief.md")).toHaveCount(0);
  await expect(view.getByText("measurements.csv")).toBeVisible();
  await expect(view.getByText(/Saved Preparation remains unchanged until Save/)).toBeVisible();

  const secondSave = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/save") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await secondSave;
  await expect(view.getByText("Preparation saved")).toBeVisible();
  await expect(view.getByText(/Saved Preparation remains unchanged until Save/)).toHaveCount(0);

  await view.getByRole("textbox", { name: "Research text" }).fill("");
  await view.getByRole("button", { name: "Remove measurements.csv" }).click();
  await expect(view.getByText("Draft changes not saved")).toBeVisible();
  const resetSave = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/save") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Save Preparation" }).click();
  expect((await resetSave).postDataJSON()).toEqual({ text: "" });
  await expect(view.getByText("Preparation reset")).toBeVisible();

  expect(paths.filter((path) => /^\/api\/(workspace|admin)(\/|$)/.test(path))).toEqual([]);
});

test("Preparation Refresh confirms, clears the next input, and stays out of launch views", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await view.getByRole("textbox", { name: "Research text" }).fill("Reset this next Preparation.");
  await view.getByLabel("Source files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("reset me"),
  });
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await expect(view.getByText("Preparation saved")).toBeVisible();
  await expect(view.locator(".discovery-context-nav-row .discovery-status-pill")).toContainText("Preparation committed");
  await expect(view.getByText("Preparation / stage canvas", { exact: false })).toHaveCount(0);
  await expect(view.getByText("Move one Preparation through four deliberate stages.", { exact: true })).toHaveCount(0);

  await expect(view.getByRole("button", { name: "Refresh Preparation" })).toBeVisible();
  const titleBox = await view.getByRole("heading", { name: "Discovery", exact: true }).boundingBox();
  const refreshBox = await view.getByRole("button", { name: "Refresh Preparation" }).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(refreshBox).not.toBeNull();
  expect(refreshBox!.height).toBeCloseTo(titleBox!.height, 0);
  await view.getByRole("button", { name: "Refresh Preparation" }).click();
  await expect(view.getByRole("dialog")).toContainText("Current and past Launches remain unchanged");
  await expect(view.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  const resetRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/reset") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Reset Preparation" }).click();
  await resetRequest;

  await expect(view.getByText("Preparation reset")).toBeVisible();
  await expect(view.getByText("brief.md")).toHaveCount(0);
  await expect(view.getByRole("textbox", { name: "Research text" })).toHaveValue("");

  await view.getByRole("tab", { name: "Current Launch" }).click();
  await expect(view.getByRole("button", { name: "Refresh Preparation" })).toHaveCount(0);
  await view.getByRole("tab", { name: "History" }).click();
  await expect(view.getByRole("button", { name: "Refresh Preparation" })).toHaveCount(0);
});

test("Gather surfaces validation errors without partially accepting a file batch", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();
  await view.getByLabel("Source files").setInputFiles([
    {
      name: "accepted.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("valid"),
    },
    {
      name: "unsupported.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("invalid"),
    },
  ]);

  await expect(view.getByRole("alert")).toContainText("unsupported source type");
  await expect(view.getByText("accepted.md")).toHaveCount(0);
  await expect(view.getByText("No files yet.")).toBeVisible();
});

test("Preparation follows the Stage Canvas flow with Reviewable input below Gather", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await view.getByRole("textbox", { name: "Research text" }).fill("Compare two constrained baselines.");
  await view.getByLabel("Source files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("baseline notes"),
  });

  const saveRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/save") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await saveRequest;
  await expect(view.getByText("Preparation saved")).toBeVisible();

  const order = await view.evaluate((root) => {
    const gather = root.querySelector("#discovery-gather-heading")?.closest("section");
    const review = root.querySelector("#discovery-review-heading")?.closest("section");
    return Boolean(gather && review && (gather.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
  await expect(view.getByRole("button", { name: "Convert" })).toBeEnabled();
  await expect(view.getByLabel("Preparation stages").getByLabel("Completed")).toHaveCount(1);
});

test("Conversion produces one backend-shaped Execution Input and Save review appends immutable history", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await view.getByRole("textbox", { name: "Research text" }).fill("Compare two constrained baselines.");
  await view.getByLabel("Source files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("baseline notes"),
  });
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await expect(view.getByText("Preparation saved")).toBeVisible();

  const convertRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/convert") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Convert" }).click();
  await convertRequest;
  await expect(view.getByTestId("execution-input-row")).toBeVisible();
  await expect(view.getByRole("textbox", { name: "Formatted Discovery Input" })).toHaveCount(0);

  await view.getByTestId("execution-input-row").click();
  await view.getByRole("textbox", { name: "Task description" }).fill("Reviewed baseline objective.");
  const revisionRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/discovery/preparation/revisions") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Save" }).click();
  expect((await revisionRequest).postDataJSON().execution_input.task_description).toBe("Reviewed baseline objective.");
  await expect(view.getByLabel("Preparation stages").getByLabel("Completed")).toHaveCount(3);

  await view.getByTestId("execution-input-row").click();
  await view.getByRole("textbox", { name: "Task description" }).fill("Revised again.");
  await expect(view.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("Run confirms before admitting one immutable Launch and exposes its history", async ({ page }) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    paths.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await view.getByRole("textbox", { name: "Research text" }).fill("Compare two constrained baselines.");
  await view.getByLabel("Source files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("baseline notes"),
  });
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await expect(view.getByText("Preparation saved")).toBeVisible();
  await view.getByRole("button", { name: "Convert" }).click();
  await view.getByTestId("execution-input-row").click();
  await view.getByRole("textbox", { name: "Task description" }).fill("Reviewed baseline objective.");
  await view.getByRole("button", { name: "Save" }).click();

  const startRequest = page.waitForRequest(
    (request) => request.url().endsWith("/v1/discovery/launches") && request.method() === "POST",
  );
  await view.getByRole("button", { name: "Run" }).click();
  await expect(view.getByRole("dialog")).toContainText("long-running Discovery Launch");
  await expect(view.getByRole("button", { name: "Start Launch" })).toBeVisible();
  await view.getByRole("button", { name: "Start Launch" }).click();
  const request = await startRequest;
  expect(request.postDataJSON()).toEqual({
    preparation_id: "preparation",
    revision_id: "fixture-revision-1",
  });
  expect(request.headers()["idempotency-key"]).toBeTruthy();

  await expect(view.getByRole("tab", { name: "Current Launch" })).toHaveAttribute("aria-selected", "true");
  await expect(view.getByLabel("Current Discovery Launch")).toBeVisible();
  await expect(view.getByTestId("runtime-desk")).toBeVisible();
  await expect(
    view.getByText("Launch timeline").or(view.getByRole("heading", { name: "Lifecycle" })).first(),
  ).toBeVisible();
  await page.waitForTimeout(5200);
  await view.getByRole("tab", { name: "History" }).click();
  await expect(view.getByLabel("Launch records")).toBeVisible();
  await expect(view.getByText("completed", { exact: true }).first()).toBeVisible();
  await expect(view.getByTestId("discovery-artifacts")).toBeVisible();
  const artifacts = view.getByTestId("discovery-artifacts");
  await expect(artifacts.getByText("report.md")).toBeVisible();
  await expect(artifacts.getByText("summary.json")).toBeVisible();
  await expect(artifacts.getByText("runner.log")).toHaveCount(0);
  await artifacts.getByRole("button", { name: /report\.md/ }).click();
  await expect(artifacts.getByText(/fixture-launch-1/)).toBeVisible();
  expect(paths.filter((path) => /^\/api\/(workspace|admin)(\/|$)/.test(path))).toEqual([]);
});

test("Current Launch exposes graceful Stop and reconciled history exposes Resume", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await view.getByRole("textbox", { name: "Research text" }).fill("Resume a stopped run.");
  await view.getByLabel("Source files").setInputFiles({
    name: "brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("checkpoint notes"),
  });
  await view.getByRole("button", { name: "Save Preparation" }).click();
  await expect(view.getByText("Preparation saved")).toBeVisible();
  await view.getByRole("button", { name: "Convert" }).click();
  await view.getByTestId("execution-input-row").click();
  await view.getByRole("textbox", { name: "Task description" }).fill("Stoppable input.");
  await view.getByRole("button", { name: "Save" }).click();

  await view.getByRole("button", { name: "Run" }).click();
  await view.getByRole("button", { name: "Start Launch" }).click();
  await expect(view.getByRole("tab", { name: "Current Launch" })).toHaveAttribute("aria-selected", "true");
  await expect(view.getByTestId("runtime-desk").getByRole("button", { name: "Stop" })).toBeVisible();
  await view.getByTestId("runtime-desk").getByRole("button", { name: "Stop" }).click();

  await page.waitForTimeout(250);
  await view.getByRole("tab", { name: "History" }).click();
  await expect(view.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  await expect(view.getByText("stopped", { exact: true }).first()).toBeVisible();
  const historyRecord = view.getByLabel("Launch records");
  await expect(historyRecord.getByRole("button", { name: "Resume" }).first()).toBeVisible();
  await historyRecord.getByRole("button", { name: "Resume" }).first().click();
  await expect(view.getByRole("tab", { name: "Current Launch" })).toHaveAttribute("aria-selected", "true");
  await expect(view.getByText("starting", { exact: true }).first()).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const PDF_PATH =
  "/home/vincent/Downloads/XA-202607应急管理部国家自然灾害防治研究院-类地行星感应磁层的离子动力学特性研究比赛方案.pdf";
const PDF_NAME = PDF_PATH.split("/").at(-1)!;

type DiscoverySnapshot = {
  current_launch?: DiscoveryLaunch | null;
  history?: DiscoveryLaunch[];
};

type DiscoveryLaunch = {
  launch_id?: string;
  state?: string;
  stage?: string;
  error?: string | null;
  activity?: Array<{ text?: string }>;
};

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/v1/discovery");
    if (!response.ok) throw new Error(`Discovery snapshot failed (${response.status})`);
    return (await response.json()) as DiscoverySnapshot;
  });
}

test.setTimeout(180_000);

test("real local PDF reaches the first Discovery stage seam", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  await page.goto("/");
  await page.getByTestId("nav-discovery").click();

  const view = page.getByTestId("discovery-view");
  await expect(view.getByRole("heading", { name: "Gather context" })).toBeVisible();

  const refresh = view.getByRole("button", { name: "Refresh Preparation" });
  if (await refresh.count()) {
    await refresh.click();
    await expect(view.getByRole("dialog")).toBeVisible();
    await view.getByRole("button", { name: "Reset Preparation" }).click();
    await expect(view.getByText("Preparation reset")).toBeVisible();
  }

  await view.getByLabel("Source files").setInputFiles(PDF_PATH);
  await expect(view.getByText(PDF_NAME)).toBeVisible();

  await view.getByRole("button", { name: "Save Preparation" }).click();
  await expect(view.getByText("Preparation saved")).toBeVisible();

  await view.getByRole("button", { name: "Convert" }).click();
  await expect(view.getByTestId("execution-input-row")).toBeVisible({ timeout: 120_000 });

  await view.getByTestId("execution-input-row").click();
  await view.getByRole("button", { name: "Save" }).click();
  await expect(view.getByLabel("Preparation stages").getByLabel("Completed")).toHaveCount(3);

  await view.getByRole("button", { name: "Run" }).click();
  await view.getByRole("button", { name: "Start Launch" }).click();

  let launchId: string | undefined;
  let reachedSeam = false;
  let latest: DiscoverySnapshot = {};
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    latest = await snapshot(page);
    const launch = latest.current_launch ?? latest.history?.[0];
    launchId = launch?.launch_id ?? launchId;
    if (launch?.state === "failed" || launch?.error) {
      let runnerLog = "";
      if (launchId) {
        try {
          runnerLog = readFileSync(
            `/home/vincent/.config/coworker/discovery/launches/${launchId}/runner.log`,
            "utf8",
          ).slice(-4000);
        } catch {
          // The API error is still useful if the durable log is not yet available.
        }
      }
      throw new Error(
        `Discovery launch failed before the first stage seam: ${launch.error ?? "unknown error"}\n${runnerLog}`,
      );
    }
    const started = (launch?.activity ?? []).some((item) =>
      item.text?.includes("Stage Prepare sources started"),
    );
    if (started) {
      await page.waitForTimeout(1_500);
      latest = await snapshot(page);
      const afterGrace = latest.current_launch ?? latest.history?.[0];
      if (afterGrace?.state !== "failed" && !afterGrace?.error) {
        reachedSeam = true;
        break;
      }
    }
    await page.waitForTimeout(500);
  }

  expect(reachedSeam, JSON.stringify(latest)).toBe(true);
  expect({ pageErrors, consoleErrors, requestFailures }).toEqual({
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
  });

  if (launchId && latest.current_launch?.state !== "failed") {
    const stop = await page.request.post(
      `/v1/discovery/launches/${encodeURIComponent(launchId)}/stop`,
    );
    expect(stop.ok()).toBe(true);
  }
});

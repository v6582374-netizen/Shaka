// LIVE smoke — the Physical AI › Embodied governance workbench against the REAL sidecar and a
// REAL MuJoCo run. No model tokens are spent: the bench is physics, not inference.
//
// This is the end-to-end path the user actually consumes: click the nav group, declare the room
// facts, start a run, and read the verdict. It asserts the two outcomes that matter — a nominal
// run that passes both simulated rungs and STILL refuses hardware, and a run whose declaration
// makes the supervisor refuse before anything moves.
import { expect, test } from "@playwright/test";
import { backendFetch } from "./helpers";

async function simulatorReady(): Promise<boolean> {
  try {
    const res = await backendFetch("/v1/embodied/environment");
    if (!res.ok) return false;
    const doc = await res.json();
    return doc?.simulator?.available === true;
  } catch {
    return false;
  }
}

// A bench run is ~1s of physics, but the UI polls on a 400ms/1000ms cadence.
const VERDICT_TIMEOUT = 90_000;

test("live: the workbench runs the ladder and still refuses hardware", async ({ page }) => {
  test.skip(!(await simulatorReady()), "MuJoCo/menagerie not available on :8765");

  await page.goto("/");

  // The nav group is the entry point this change added.
  await page.getByTestId("nav-embodied").click();
  await expect(page.getByTestId("embodied-workbench")).toBeVisible();

  // The declaration defaults to a supervised room, so the run should reach a verdict.
  await page.getByTestId("embodied-start").click();

  // The measured admitted rate proves calibration actually ran on physics.
  await expect(page.getByTestId("embodied-admitted-rate")).toContainText("rad/s", {
    timeout: VERDICT_TIMEOUT,
  });

  // The whole point: both simulated rungs pass and hardware is STILL blocked.
  await expect(page.getByTestId("embodied-halt")).toBeVisible({ timeout: VERDICT_TIMEOUT });
  const blocking = page.getByTestId("embodied-blocking");
  await expect(blocking).toContainText("shadow_mode");
  await expect(blocking).toContainText("approval");
});

test("live: withdrawing the guardian is refused before anything moves", async ({ page }) => {
  test.skip(!(await simulatorReady()), "MuJoCo/menagerie not available on :8765");

  await page.goto("/");
  await page.getByTestId("nav-embodied").click();
  await expect(page.getByTestId("embodied-workbench")).toBeVisible();

  // Withdraw the guardian. The surface must warn that this will be refused rather than
  // silently blocking the request itself — the refusal belongs to the supervisor.
  await page.getByRole("switch", { name: /guardian/i }).click();
  await expect(page.getByTestId("embodied-will-refuse")).toBeVisible();

  await page.getByTestId("embodied-start").click();

  // The refusal arrives as a recorded verdict, not an HTTP error. The halt line carries the
  // translated verdict a person reads; the backend's own halt code rides in the status pill
  // beside it, and its untranslated reason string is asserted below.
  await expect(page.getByTestId("embodied-halt")).toContainText("\u9636\u6bb5\u6ca1\u8dd1\u5b8c", {
    timeout: VERDICT_TIMEOUT,
  });

  // The reason is never paraphrased away: the supervisor's own precondition name survives to
  // the surface, which is what makes the refusal auditable rather than decorative.
  await expect(page.getByTestId("embodied-blocking")).toContainText("guardian_present", {
    timeout: VERDICT_TIMEOUT,
  });
});

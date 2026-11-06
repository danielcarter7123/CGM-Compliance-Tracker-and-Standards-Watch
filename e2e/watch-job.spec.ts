import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The weekly drafting job. A real run calls the Claude API and costs money, so the automated test checks only
// the parts that don't: the cron route's secret, the editor panel, and the clear "skipped" result when no
// ANTHROPIC_API_KEY is configured (as on a fresh machine). Drafts from a real run are tested by the unit tests
// on lib/watch-job-core.ts and by hand.

test("drafting job: the cron route needs its secret", async ({ request }) => {
  expect((await request.get("/api/jobs/watch-drafts")).status()).toBe(401);
  expect((await request.get("/api/jobs/watch-drafts", { headers: { authorization: "Bearer wrong-secret-wrong-secret-123" } })).status()).toBe(401);
});

test("drafting job: editors see the panel and its run log; without an API key a run is logged as skipped", async ({ page }) => {
  test.skip(!!process.env.ANTHROPIC_API_KEY, "a key is set: running would call the Claude API");
  await signIn(page, "admin@cgm.example", "/watch/review");
  const panel = page.getByRole("region", { name: "Weekly drafting job" });
  await expect(panel).toContainText("It never publishes anything.");
  await panel.getByRole("button", { name: "Run it now" }).click();
  await panel.getByRole("button", { name: /Click again to run it now/ }).click();
  await expect(panel.getByRole("status")).toContainText("ANTHROPIC_API_KEY isn't set");
  await page.reload();
  await expect(panel.locator(".jobruns li").first()).toContainText("Skipped");
});

test("drafting job: PMs and clients don't see it", async ({ page }) => {
  await signIn(page, "pm@cgm.example", "/watch");
  await page.goto("/watch/review");
  await expect(page).toHaveURL(/\/workspace$/); // back to the CGM Workspace launcher
});

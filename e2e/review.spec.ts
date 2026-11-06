import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// W3: review queue parity. Drafts arrive through /api/drafts exactly as the Monday task sends them.
// Everything here is obviously fake (TEST-000-1, example.com) and is removed again at the end.
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const run = Date.now().toString(36);
const STD = `TEST-000-${run}`;
const ITEM = `test-000-${run}`;

async function queue(drafts: Record<string, unknown>[]) {
  const res = await fetch("http://localhost:3000/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DRAFTS_API_TOKEN}` },
    body: JSON.stringify({ drafts: drafts.map((d) => ({ createdBy: "e2e test (fake)", refs: [], ...d })) }),
  });
  expect(res.status, await res.text()).toBe(200);
}
const draft = (page: Page, label: string) => page.getByRole("article", { name: `Draft: ${label}` });

test("review queue: edit with checks, reject, approve all, decision log", async ({ page }) => {
  await queue([
    { id: `e2e-src-${run}`, section: "sources", op: "upsert", key: `e2esrc${run}`, label: `Fake source ${run}`, value: { t: "Example source (fake)", u: "https://example.com/fake" } },
    {
      id: `e2e-item-${run}`, section: "items", op: "upsert", key: ITEM, label: `${STD} (fake)`, reason: "Automated test entry, not a real standard.",
      value: { std: STD, title: "Fake standard for automated tests", fn: ["GO"], topic: "ops", effective: "2099-01-01", what: "Nothing. This is test data.", todo: "Nothing.", src: [] },
    },
    { id: `e2e-dl-${run}`, section: "deadlines", op: "upsert", key: `e2e-dl-${run}`, label: `Fake deadline ${run}`, value: { d: "2099-02-01", t: "Fake comment period (test)", fn: null } },
  ]);

  await signIn(page, "admin@cgm.example", "/admin/review");
  const item = draft(page, `${STD} (fake)`);
  await expect(item).toContainText("Fake standard for automated tests");
  await expect(item).toContainText("U.S. effective date"); // field names, not raw keys

  // Edit first: problems block approval until they're fixed.
  await item.getByRole("button", { name: "Edit first" }).click();
  await item.getByLabel("Title *").fill("Fake standard for automated tests (edited)");
  await item.getByRole("button", { name: "Add a row" }).first().click();
  await item.getByLabel("Milestones 1 text").fill("Fake phase 2");
  await expect(item.getByRole("status", { name: "Fix before approving" })).toContainText("Milestones row 1: date must be YYYY-MM-DD.");
  await expect(item.getByRole("button", { name: "Approve edited" })).toBeDisabled();
  await item.getByLabel("Milestones 1 date").fill("2099-07-01");
  await expect(item.getByRole("status", { name: "Fix before approving" })).toHaveCount(0);
  await item.getByRole("button", { name: "Approve edited" }).click();
  await expect(page.getByText(`Published: ${STD} (fake)`)).toBeVisible();

  // Reject needs two clicks.
  const dl = draft(page, `Fake deadline ${run}`);
  await dl.getByRole("button", { name: "Reject" }).click();
  await dl.getByRole("button", { name: "Click again to reject" }).click();
  await expect(page.getByText(`Rejected: Fake deadline ${run}`)).toBeVisible();

  // The edited entry is live on Watch.
  await page.goto("/watch");
  await page.locator(".filters button.chip", { hasText: /^All$/ }).click();
  const card = page.locator("article.card", { has: page.locator(".std", { hasText: STD }) });
  await expect(card).toContainText("Fake standard for automated tests (edited)");
  await expect(card).toContainText("Fake phase 2");

  // Decision log: who, edited flag, filters.
  await page.goto("/admin/review/log");
  await expect(page.locator(".logrow", { hasText: `${STD} (fake)` })).toContainText("Approved · edited");
  await page.getByLabel("Decision").selectOption("rejected");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/status=rejected/);
  await expect(page.locator(".logrow", { hasText: `Fake deadline ${run}` })).toContainText("Rejected");
  await expect(page.locator(".logrow", { hasText: `${STD} (fake)` })).toHaveCount(0);

  // Approve all (two clicks), used here to take the fake entries off the page again.
  await queue([
    { id: `e2e-rm-item-${run}`, section: "items", op: "remove", key: ITEM, label: `Remove ${STD} (fake)` },
    { id: `e2e-rm-src-${run}`, section: "sources", op: "remove", key: `e2esrc${run}`, label: `Remove fake source ${run}` },
  ]);
  await page.goto("/admin/review");
  await page.getByRole("button", { name: "Approve all" }).click();
  await page.getByRole("button", { name: /Click again to publish all \d+/ }).click();
  await expect(page.getByText(/Published all \d+\./)).toBeVisible();
  await expect(page.getByText("Nothing waiting")).toBeVisible();
  await page.goto("/watch");
  await expect(page.locator(".std", { hasText: STD })).toHaveCount(0);
});

test("only CGM admins reach the review queue and the decision log", async ({ page }) => {
  await signIn(page, "pm@cgm.example", "/watch");
  for (const path of ["/admin/review", "/admin/review/log"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/watch$/);
  }
});

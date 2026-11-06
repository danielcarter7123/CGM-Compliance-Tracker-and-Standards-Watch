import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// W1: Standards Watch behaves like the pilot. Needs db:start, seed:dev and import:pilot.

const card = (page: import("@playwright/test").Page, std: string) => page.locator("article.card .std", { hasText: new RegExp(`^${std}$`) });

test("function filters show and hide the right standards, and are remembered", async ({ page }) => {
  await signIn(page, "admin@watch.example", "/watch");
  const chip = (name: string) => page.locator(".filters button.chip", { hasText: new RegExp(`^${name}$`) });

  await chip("All").click();
  await expect(card(page, "TPL-008-1")).toHaveCount(1);

  await chip("GO").click();
  await expect(chip("GO")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "CIP-014-4")).toHaveCount(0);
  await expect(card(page, "TPL-008-1")).toHaveCount(0);
  await expect(card(page, "EOP-004-5")).toHaveCount(1);

  await chip("GO").click();
  await chip("TP").click();
  await expect(card(page, "TPL-008-1")).toHaveCount(1);
  await expect(card(page, "EOP-004-5")).toHaveCount(0);

  // The choice survives a reload, like the pilot.
  await page.reload();
  await expect(chip("TP")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "EOP-004-5")).toHaveCount(0);

  await chip("All").click();
  await expect(card(page, "EOP-004-5")).toHaveCount(1);
});

test("page furniture: hero jump flashes the card; calendar, CTA, sources and disclaimer are there", async ({ page }) => {
  await signIn(page, "admin@watch.example", "/watch");
  await page.locator(".filters button.chip", { hasText: /^All$/ }).click();

  await expect(page.locator(".counts .count")).toHaveCount(4);
  await expect(page.locator(".cal .today")).toHaveCount(1);
  await page.locator(".next button", { hasText: "View details" }).click();
  await expect(page.locator("article.card.flash")).toHaveCount(1);

  await expect(page.getByRole("heading", { name: "Not sure which of these apply to your facilities?" })).toBeVisible();
  await expect(page.locator(".foot.sources li").first()).toBeVisible();
  await expect(page.getByText("for awareness only and is not a compliance determination")).toBeVisible();
});

test("CGM Standards Watch is its own app: back to CGM Workspace, no Tracker links", async ({ page }) => {
  await signIn(page, "member@peaker.example", "/watch");
  await expect(page.locator(".mast .bname")).toContainText("CGM Standards Watch");
  await expect(page.locator(".nextbar")).toHaveCount(0);
  await expect(page.locator('a[href="/tracker"]')).toHaveCount(0);
  await page.locator(".backlink").click();
  await expect(page).toHaveURL(/\/workspace$/);
});

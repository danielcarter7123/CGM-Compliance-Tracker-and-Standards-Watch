import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T3: each Dashboard tile, and the Reminders button, opens Tasks with a matching count. Clients see only themselves.

async function shown(page: Page) {
  return Number(((await page.locator(".trk-head .mono").innerText()).match(/\d+/) || ["-1"])[0]);
}

test("dashboard tiles and the Reminders button agree with the Tasks lists they open", async ({ page }) => {
  await signIn(page, "pm@cgm.example", "/tracker");
  await expect(page.getByRole("heading", { name: "All clients" })).toBeVisible();
  for (const label of ["Overdue", "Due ≤ 30 days", "Pending review", "Open tasks"]) {
    await page.goto("/tracker");
    const tile = page.locator(".strip .stat", { hasText: label });
    const value = Number(await tile.locator(".v").innerText());
    await tile.click();
    await expect(page).toHaveURL(/\/tracker\/tasks\?status=/);
    expect(await shown(page), `${label} tile = Tasks list`).toBe(value);
  }

  await page.goto("/tracker");
  const reminders = Number(await page.locator(".remindbtn .count").innerText());
  const panelItems = await page.getByRole("region", { name: "Reminders" }).locator(".item").count();
  expect(reminders).toBe(panelItems);
  await page.locator(".remindbtn").click();
  await expect(page).toHaveURL(/status=window/);
  expect(await shown(page)).toBe(reminders);

  // By client: a row opens Tasks for that client.
  await page.goto("/tracker");
  const row = page.getByRole("region", { name: "By client" }).locator("tbody tr").first();
  const open = Number(await row.locator("td").nth(1).innerText());
  await row.locator("a").click();
  await expect(page).toHaveURL(/client=/);
  expect(await shown(page)).toBe(open);

  // Items open the task.
  await page.goto("/tracker");
  const first = page.getByRole("region", { name: "Upcoming schedule" }).locator(".item").first();
  const title = await first.locator(".t").innerText();
  await first.click();
  await expect(page.getByRole("region", { name: title })).toBeVisible();
});

test("a client user's dashboard covers only their own company, without staff tools", async ({ page }) => {
  await signIn(page, "member@wind.example", "/tracker");
  await expect(page.getByRole("heading", { name: "Demo Wind Farm LLC (fake)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "By client" }).locator("tbody tr")).toHaveCount(1);
  await expect(page.locator(".strip .stat", { hasText: "Open tasks" })).toContainText("across 1 client");
  await expect(page.getByText("Sample Peaker LLC (fake)")).toHaveCount(0);
  await expect(page.locator(".navtools").getByRole("link", { name: "New task" })).toHaveCount(0);
  await expect(page.locator(".remindbtn")).toBeVisible();
});

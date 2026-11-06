import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T6 Team Tasks: CGM's internal work. Staff add, assign, filter, complete, export and delete team tasks;
// a client user can't reach the page, the export or the table. Fake records only.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const run = Date.now().toString(36);

async function service(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return res.json().catch(() => null);
}
async function tokenOf(page: Page) {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  let raw = decodeURIComponent(cookies.map((c) => c.value).join(""));
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
  return JSON.parse(raw).access_token as string;
}

test("CGM staff run team tasks; clients can't see them", async ({ page }) => {
  const title = `Fake internal procedure review ${run}`;
  try {
    await signIn(page, "pm@cgm.example", "/tracker");
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Team Tasks" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Team Tasks" })).toBeVisible();

    // Add one, assigned to me, with a link and a bad link refused first.
    await page.locator("main").getByRole("link", { name: "New team task" }).click();
    const panel = page.getByRole("region", { name: "New team task" });
    await panel.getByLabel("Task", { exact: true }).fill(title);
    await panel.getByLabel("Description").fill("Fake description for the test.");
    await panel.getByLabel("Links").fill("Fake folder | http://example.com/not-https");
    await panel.getByLabel("Client").selectOption({ label: "Demo Wind Farm LLC (fake)" });
    await panel.getByLabel("Assigned to").selectOption("me");
    await panel.getByLabel("Anticipated completion").fill("2026-01-15");
    await panel.getByLabel("Estimated hours").fill("2.5");
    await panel.getByRole("button", { name: "Add team task" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Links must start with https://" })).toBeVisible();

    await page.getByRole("region", { name: "New team task" }).getByLabel("Task", { exact: true }).fill(title);
    await page.getByRole("region", { name: "New team task" }).getByLabel("Links").fill("Fake folder | https://example.com/fake-folder");
    await page.getByRole("region", { name: "New team task" }).getByLabel("Client").selectOption({ label: "Demo Wind Farm LLC (fake)" });
    await page.getByRole("region", { name: "New team task" }).getByLabel("Assigned to").selectOption("me");
    await page.getByRole("region", { name: "New team task" }).getByLabel("Anticipated completion").fill("2026-01-15");
    await page.getByRole("region", { name: "New team task" }).getByLabel("Estimated hours").fill("2.5");
    await page.getByRole("region", { name: "New team task" }).getByLabel("Sam Staff").check();
    await page.getByRole("region", { name: "New team task" }).getByRole("button", { name: "Add team task" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Team task added." })).toBeVisible();

    // In the list (mine, open): late, with its link, client and hours.
    const row = page.locator("tbody tr").filter({ hasText: title });
    await expect(row).toContainText("Demo Wind Farm LLC (fake)");
    await expect(row).toContainText("Pat Manager");
    await expect(row).toContainText("Sam Staff");
    await expect(row).toContainText("Not started · late");
    await expect(page.locator("tfoot")).toContainText("Total estimated hours");
    await expect(row.getByRole("link", { name: "Fake folder ↗" })).toHaveAttribute("href", "https://example.com/fake-folder");
    await page.goto("/tracker/team?scope=everyone&status=late");
    await expect(page.locator("tbody tr").filter({ hasText: title })).toHaveCount(1);

    // Export follows the filters.
    const csv = await (await page.request.get(`/tracker/team/export?scope=everyone&status=all&q=${run}`)).text();
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"${title}"`);
    expect(lines[1]).toContain('"Fake folder: https://example.com/fake-folder"');

    // A future actual date is refused; Mark complete sets today.
    await page.locator("tbody tr").filter({ hasText: title }).getByRole("link", { name: title }).click();
    const drawer = page.getByRole("region", { name: title });
    await drawer.getByLabel("Actual completion").evaluate((el: HTMLInputElement) => { el.removeAttribute("max"); el.value = "2099-01-01"; });
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "can't be in the future" })).toBeVisible();
    await page.getByRole("region", { name: title }).getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Marked complete." })).toBeVisible();
    const [saved] = await service(`team_tasks?select=status,actual_date,owner_id&title=eq.${encodeURIComponent(title)}`);
    expect(saved.status).toBe("done");
    expect(saved.actual_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Delete needs the tick.
    await page.getByRole("region", { name: title }).getByLabel("Delete this team task").check();
    await page.getByRole("region", { name: title }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Team task deleted." })).toBeVisible();
    expect(await service(`team_tasks?select=id&title=eq.${encodeURIComponent(title)}`)).toEqual([]);

    // A client user: no tab, the page and export are refused, and the table reads empty.
    await page.context().clearCookies();
    await signIn(page, "member@wind.example", "/tracker");
    await expect(page.getByRole("navigation", { name: "Sections" }).getByText("Team Tasks")).toHaveCount(0);
    await page.goto("/tracker/team");
    await expect(page).toHaveURL(/\/tracker$/);
    expect((await page.request.get("/tracker/team/export?scope=everyone&status=all")).status()).toBe(403);
    const res = await fetch(`${URL_}/rest/v1/team_tasks?select=id`, { headers: { apikey: ANON, authorization: `Bearer ${await tokenOf(page)}` } });
    expect(await res.json()).toEqual([]);
  } finally {
    await service(`team_tasks?title=eq.${encodeURIComponent(title)}`, { method: "DELETE" });
  }
});

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T7 Activity Log: changes show with old values struck through; Revert puts them back (asking first when the record
// changed since); Restore brings a deleted task back; both are logged. Clients see their own company's history only,
// with no restore or revert. Fake records only; clean-up uses the local service key (local test database only).

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
async function asUser(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=minimal", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}
const row = (page: Page, text: string) => page.locator("tbody tr").filter({ hasText: text });

test("the log shows changes; staff revert and restore as logged changes; clients see only their own history", async ({ page }) => {
  const [wind] = await service(`companies?select=id&name=eq.${encodeURIComponent("Demo Wind Farm LLC (fake)")}`);
  const [task] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T7 relay test ${run}`, due_date: "2099-03-31" }) });
  const title = async () => (await service(`tasks?select=title&id=eq.${task.id}`))[0]?.title;

  try {
    await signIn(page, "admin@cgm.example", "/tracker");
    const token = await tokenOf(page);
    await asUser(token, `tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ title: `Fake T7 renamed ${run}` }) });

    // The change, with the old value struck through.
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Activity Log" }).click();
    await page.goto(`/tracker/activity?q=${run}`);
    const updated = row(page, "Updated").filter({ hasText: `Fake T7 renamed ${run}` });
    await expect(updated.locator("del")).toHaveText(`Fake T7 relay test ${run}`);
    await expect(updated).toContainText("Demo Wind Farm LLC (fake)");

    // Revert: logged, tagged, and the title is back.
    await updated.getByRole("button", { name: /Revert this change/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reverted the change" })).toBeVisible();
    expect(await title()).toBe(`Fake T7 relay test ${run}`);
    await expect(row(page, "Reverted").first()).toContainText(`Fake T7 relay test ${run}`);
    await expect(page.locator("tbody tr .chip").getByText("REVERTED", { exact: true })).toHaveCount(1);

    // Edited since: asks first; nothing changes until confirmed.
    await asUser(token, `tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ title: `Fake T7 second name ${run}` }) });
    await asUser(token, `tasks?id=eq.${task.id}`, { method: "PATCH", body: JSON.stringify({ notes: `Fake later note ${run}` }) });
    await page.goto(`/tracker/activity?q=${run}`);
    await row(page, "Updated").filter({ has: page.locator("del", { hasText: `Fake T7 relay test ${run}` }) }).filter({ hasText: `Fake T7 second name ${run}` })
      .getByRole("button", { name: /Revert this change/ }).click();
    const ask = page.getByRole("group", { name: "Confirm revert" });
    await expect(ask).toContainText("Revert anyway? Edited since");
    expect(await title()).toBe(`Fake T7 second name ${run}`);
    await ask.getByRole("button", { name: "Revert anyway" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reverted the change" })).toBeVisible();
    expect(await title()).toBe(`Fake T7 relay test ${run}`);

    // Restore a deleted task.
    await asUser(token, `tasks?id=eq.${task.id}`, { method: "DELETE" });
    expect(await title()).toBeUndefined();
    await page.goto(`/tracker/activity?q=${run}&kind=task`);
    await row(page, "Deleted").getByRole("button", { name: /^Restore / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Restored" })).toBeVisible();
    expect(await title()).toBe(`Fake T7 relay test ${run}`);
    await expect(row(page, "Deleted").locator(".chip").getByText("RESTORED", { exact: true })).toBeVisible();
    await expect(row(page, "Deleted").getByRole("button", { name: /^Restore / })).toHaveCount(0);

    // CSV: one row per field change.
    const csv = (await (await page.request.get(`/tracker/activity/export?q=${run}`)).text()).trim().split("\r\n");
    expect(csv[0]).toContain('"When","Who","Action","Record type","Record","Client","Field","From","To","Note"');
    expect(csv.some((l) => l.includes('"Title"') && l.includes(`"Fake T7 relay test ${run}"`) && l.includes(`"Fake T7 renamed ${run}"`))).toBe(true);

    // The client: their own history, no restore or revert; another company sees nothing.
    await page.context().clearCookies();
    await signIn(page, "member@wind.example", "/tracker");
    await page.goto(`/tracker/activity?q=${run}`);
    await expect(row(page, "Restored").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Revert|Restore/ })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Record type" }).locator("option")).toHaveText(["All record types", "Tasks", "Client tasks", "Evidence"]);
    await page.context().clearCookies();
    await signIn(page, "admin@peaker.example", "/tracker");
    await page.goto(`/tracker/activity?q=${run}&range=all`);
    await expect(page.getByText("No activity matches these filters.")).toBeVisible();
    expect((await (await page.request.get(`/tracker/activity/export?q=${run}&range=all`)).text()).trim().split("\r\n")).toHaveLength(1);
  } finally {
    await service(`tasks?id=eq.${task.id}`, { method: "DELETE" });
  }
});

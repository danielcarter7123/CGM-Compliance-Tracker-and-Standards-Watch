import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { uuidFrom } from "../lib/legacy-map";
import { signIn } from "./helpers";

// T9 prep: a CGM admin restores records deleted in the pilot before the move (from the pilot's saved copies, with the
// importer's own mapping and ids), links a pilot person to their login, and sets a client's project manager.
// Everything here is fake, shaped like the pilot's export; clean-up uses the local service key.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const run = Date.now().toString(36);

async function service(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return res.json().catch(() => null);
}

test("cutover prep: restore pilot deletions, link pilot people, set a client's PM", async ({ page }) => {
  const pc = `pc-${run}`, t1 = `pt1-${run}`, t2 = `pt2-${run}`, t3 = `pt3-${run}`, lp = `lp-${run}`;
  const company = uuidFrom("client", pc);
  const task = (id: string, extra: Record<string, unknown>) => ({ id, clientId: pc, title: `Fake pilot task ${id}`, dueDate: "2099-01-31", status: "open", recur: { n: 12, unit: "m" }, remindDays: [30, 7], ...extra });
  await service("legacy_snapshots", { method: "POST", body: JSON.stringify([
    { entry_id: `ec-${run}`, day: "2026-10-01", snap: { data: { id: pc, name: `Fake Pilot Client ${run}`, contact: "Fake Contact", contactEmail: `pc-${run}@fake.example`, functions: ["GO"], region: "WECC" },
      tasks: [task(t1, { nextId: t2 }), task(t2, { prevId: t1, dueDate: "2100-01-31" })] } },
    { entry_id: `et-${run}`, day: "2026-10-02", snap: { data: task(t3, { standard: "PRC-005", requirement: "R3" }) } },
  ]) });
  await service("activity_log", { method: "POST", body: JSON.stringify([
    { action: "deleted", kind: "client", target_id: pc, label: `Fake Pilot Client ${run}`, source: "legacy", at: "2026-10-01T15:00:00Z", legacy: { hasSnap: true, entryId: `ec-${run}`, note: "Fake deletion" } },
    { action: "deleted", kind: "task", target_id: t3, label: `Fake pilot task ${t3}`, source: "legacy", at: "2026-10-02T15:00:00Z", legacy: { hasSnap: true, entryId: `et-${run}` } },
  ]) });
  await service("legacy_people", { method: "POST", body: JSON.stringify({ legacy_id: lp, name: "Sam Staff" }) });
  const [team] = await service("team_tasks", { method: "POST", body: JSON.stringify({ title: `Fake pilot team task ${run}`, owner_legacy: lp }) });

  try {
    await signIn(page, "admin@cgm.example", "/tracker");
    await page.goto(`/tracker/activity?q=${run}&range=all`);
    const row = (text: string) => page.locator("tbody tr").filter({ hasText: text });

    // The task's client isn't in the app yet.
    await row(`Fake pilot task ${t3}`).getByRole("button", { name: /^Restore / }).click();
    await expect(page.locator("p.notice[role=alert]")).toContainText("Restore its client first");

    // Restore the client: company, contacts, products and its two tasks, linked as a chain, with the importer's ids.
    await row(`Fake Pilot Client ${run}`).filter({ hasText: "Deleted" }).getByRole("button", { name: /^Restore / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Restored" })).toBeVisible();
    const [co] = await service(`companies?select=name,region&id=eq.${company}`);
    expect(co).toEqual({ name: `Fake Pilot Client ${run}`, region: "WECC" });
    expect((await service(`contacts?select=kind&company_id=eq.${company}`)).map((c: { kind: string }) => c.kind)).toEqual(["compliance"]);
    expect((await service(`entitlements?select=product&company_id=eq.${company}&order=product`)).map((e: { product: string }) => e.product)).toEqual(["tracker", "watch"]);
    const chain = await service(`tasks?select=id,prev_id,next_id&company_id=eq.${company}&order=due_date`);
    expect(chain).toEqual([{ id: uuidFrom("task", t1), prev_id: null, next_id: uuidFrom("task", t2) }, { id: uuidFrom("task", t2), prev_id: uuidFrom("task", t1), next_id: null }]);

    // Now the task restores under it, with its standard.
    await page.goto(`/tracker/activity?q=${run}&range=all`);
    await row(`Fake pilot task ${t3}`).filter({ hasText: "Deleted" }).getByRole("button", { name: /^Restore / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Restored" })).toBeVisible();
    expect(await service(`tasks?select=company_id,standard_code,requirement&id=eq.${uuidFrom("task", t3)}`)).toEqual([{ company_id: company, standard_code: "PRC-005", requirement: "R3" }]);
    await expect(row(`Fake pilot task ${t3}`).filter({ hasText: "Deleted" }).locator(".chip").getByText("RESTORED", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Restore / })).toHaveCount(0);

    // Link a pilot person: the name match is suggested; their team task moves to the login.
    await page.goto("/admin#pilot-people");
    const pick = page.getByLabel("Login for Sam Staff");
    const [sam] = await service("profiles?select=id&email=eq.staff@cgm.example");
    await expect(pick.first()).toHaveValue(sam.id);
    await pick.first().locator("xpath=ancestor::form").getByRole("button", { name: "Link" }).click();
    await expect(page.getByText("Linked. Their team tasks and pilot history now show under that login.")).toBeVisible();
    expect(await service(`team_tasks?select=owner_id&id=eq.${team.id}`)).toEqual([{ owner_id: sam.id }]);

    // Set the client's CGM project manager.
    await page.goto(`/tracker/clients?c=${company}`);
    await page.getByLabel("CGM project manager (login)").selectOption({ label: "Pat Manager" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const [pm] = await service("profiles?select=id&email=eq.pm@cgm.example");
    await expect.poll(async () => (await service(`companies?select=pm_id&id=eq.${company}`))[0]?.pm_id).toBe(pm.id);
  } finally {
    await service(`tasks?company_id=eq.${company}`, { method: "PATCH", body: JSON.stringify({ prev_id: null, next_id: null }) });
    await service(`tasks?company_id=eq.${company}`, { method: "DELETE" });
    await service(`companies?id=eq.${company}`, { method: "DELETE" });
    await service(`team_tasks?id=eq.${team.id}`, { method: "DELETE" });
    await service(`legacy_people?legacy_id=eq.${lp}`, { method: "DELETE" });
    await service(`legacy_snapshots?entry_id=in.(ec-${run},et-${run})`, { method: "DELETE" });
  }
});
